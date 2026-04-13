'use strict';

/* ═══════════════════════════════════════════════════════════
   Orders Page Module — Privacy-Safe Partner Reporting
   ═══════════════════════════════════════════════════════════

   Shows masked order data by default. Partners with PII
   exception enabled can reveal individual order details.
   Admins see the PII Access Log beneath the table.
   ═══════════════════════════════════════════════════════════ */

// ── State ──────────────────────────────────────────────────
const ordersState = {
  orders: [],
  piiLogs: [],
  search: '',
  statusFilter: 'all',      // 'all' | 'confirmed' | 'cancelled'
  dateFrom: '',
  dateTo: '',
  loading: false,
  piiLogsLoading: false,
  initialized: false,       // guard against double-fetch on navigation
  lastError: null,
};

// ── Fetch ──────────────────────────────────────────────────
async function fetchOrders() {
  ordersState.loading   = true;
  ordersState.lastError = null;
  renderOrdersLoadingState();

  const params = new URLSearchParams();
  if (ordersState.dateFrom) params.set('from', ordersState.dateFrom);
  if (ordersState.dateTo)   params.set('to',   ordersState.dateTo);
  
  // Apply global partner filter if the user is an admin
  if (window.state?.user?.role === 'admin' && window.state?.globalPartnerFilter) {
    params.set('partner_id', window.state.globalPartnerFilter);
  }

  const url = `/api/partner-orders?${params.toString()}`;

  try {
    const data = await fetchJSON(url);

    if (Array.isArray(data)) {
      ordersState.orders      = data;
      ordersState.initialized = true;
    } else {
      // fetchJSON returned null — API error or network failure
      ordersState.lastError = 'Unable to load orders. Check your connection or try refreshing.';
      console.warn('[Orders] fetchOrders returned null — API may have errored.');
    }
  } catch (err) {
    ordersState.lastError = err.message || 'Unknown error loading orders.';
    console.error('[Orders] fetchOrders exception:', err);
  } finally {
    ordersState.loading = false;
    renderOrders();        // always clear the loading spinner
    updateOrdersBadge();
  }
}

async function forceRefreshOrders() {
  // Reset the initialized guard so fetchOrders always makes a fresh network request
  ordersState.initialized = false;
  ordersState.lastError   = null;
  await fetchOrders();
}

async function fetchPiiLogs(partnerId = '') {
  ordersState.piiLogsLoading = true;
  const params = new URLSearchParams();
  params.set('limit', '100');
  if (partnerId) params.set('partner_id', partnerId);

  const data = await fetchJSON(`/api/pii-access-logs?${params.toString()}`);
  ordersState.piiLogsLoading = false;

  if (data) {
    ordersState.piiLogs = data;
    renderPiiLogs();
  }
}

// ── Init ───────────────────────────────────────────────────
async function initOrders() {
  // If already loaded, just re-render cached data — no extra network request
  if (ordersState.initialized) {
    renderOrders();
    if (window.state?.user?.role === 'admin') renderPiiLogs();
    return;
  }

  await fetchOrders();

  // Admins also load the audit trail on first visit
  if (window.state?.user?.role === 'admin') {
    fetchPiiLogs();
  }
}

// ── Render ─────────────────────────────────────────────────
function renderOrdersLoadingState() {
  const tbody = document.getElementById('orders-tbody');
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="9" class="table-empty">
      <span class="spinner-inline"></span> Loading orders…
    </td></tr>`;
  }
}

function getFilteredOrders() {
  let list = ordersState.orders;

  // Status filter
  if (ordersState.statusFilter !== 'all') {
    list = list.filter(o => o.status === ordersState.statusFilter);
  }

  // Text search
  const q = ordersState.search.toLowerCase();
  if (q) {
    list = list.filter(o =>
      (o.orderId    || '').toLowerCase().includes(q) ||
      (o.eventName  || '').toLowerCase().includes(q) ||
      (o.status     || '').toLowerCase().includes(q)
    );
  }

  // Apply sort using global sortArray utility from app.js
  if (window.state && window.state.sort && window.state.sort.orders && typeof sortArray === 'function') {
    const { col, dir } = window.state.sort.orders;
    list = sortArray(list, col, dir);
  }

  return list;
}

function renderOrders() {
  const tbody = document.getElementById('orders-tbody');
  if (!tbody) return;

  // Error state
  if (ordersState.lastError) {
    tbody.innerHTML = `<tr><td colspan="9" class="table-empty" style="color:var(--red);">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:8px;opacity:.6">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <p>${esc(ordersState.lastError)}</p>
      <button class="btn btn-secondary btn-sm" onclick="fetchOrders()" style="margin-top:8px;">Retry</button>
    </td></tr>`;
    return;
  }

  const filtered  = getFilteredOrders();
  const canReveal = window.state?.user?.pii_exception_enabled === true ||
                    window.state?.user?.role === 'admin';

  // Row count hint
  const countEl = document.getElementById('orders-row-count');
  if (countEl) countEl.textContent = `${filtered.length} order${filtered.length !== 1 ? 's' : ''}`;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="table-empty">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:8px;opacity:.4">
        <rect x="2" y="5" width="20" height="14" rx="2"/>
        <line x1="2" y1="10" x2="22" y2="10"/>
      </svg>
      <p>${ordersState.search ? 'No orders match your search.' : 'No attributed orders found.'}</p>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(o => buildOrderRow(o, canReveal)).join('');
}

function buildOrderRow(o, canReveal) {
  const isMasked     = !o.piiRevealed;
  const isConfirmed  = o.status === 'confirmed';
  const statusClass  = isConfirmed ? 'badge-active' : 'badge-inactive';
  const statusIcon   = isConfirmed ? '✓' : '↩';
  const rowClass     = o.piiRevealed ? 'revealed-row' : '';
  const isAdmin      = window.state?.user?.role === 'admin';

  const orderRefCell = isMasked
    ? `<span class="mono masked-ref">${esc(o.orderId)}</span>
       <span class="pii-shield" title="Customer PII is protected">🔒</span>`
    : `<span class="mono revealed-ref">${esc(o.orderId)}</span>
       <span class="pii-revealed-badge" title="PII Revealed">🔓</span>`;

  const revealCell = canReveal && isMasked
    ? `<button class="btn btn-secondary btn-sm pii-reveal-btn"
               id="reveal-btn-${esc(o.id)}"
               onclick="revealOrderPii('${esc(o.id)}', '${esc(o.orderId)}')"
               title="Reveal full order reference — access will be logged">
         🔍 Reveal
       </button>`
    : canReveal && !isMasked
      ? `<span class="pii-ok-label">Revealed</span>`
      : `<span class="pii-protected-label" title="Contact admin to enable PII access">🔒 Protected</span>`;

  const date = o.purchaseDate
    ? new Date(o.purchaseDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';

  // Attribution icon
  const attrIcon = o.attributionMethod === 'discount_code' ? '🎟️' : '🔗';
  const attrTitle = o.attributionMethod === 'discount_code' ? 'Attributed via Discount Code' : 'Attributed via Referral Link';

  // Payout Status Badge/Toggle
  const payoutStatus = o.payoutStatus || 'pending';
  const payoutClass = payoutStatus === 'paid' ? 'badge-active' : payoutStatus === 'scheduled' ? 'badge-info' : 'badge-inactive';
  const payoutToggle = isAdmin
    ? `<select class="badge-status ${payoutClass}" style="border:none; cursor:pointer;" onchange="updatePayoutStatus('${esc(o.orderId)}', this.value)">
         <option value="pending" ${payoutStatus === 'pending' ? 'selected' : ''}>Pending</option>
         <option value="scheduled" ${payoutStatus === 'scheduled' ? 'selected' : ''}>Scheduled</option>
         <option value="paid" ${payoutStatus === 'paid' ? 'selected' : ''}>Paid</option>
       </select>`
    : `<span class="badge-status ${payoutClass}">${payoutStatus.charAt(0).toUpperCase() + payoutStatus.slice(1)}</span>`;

  // Commission Display (with adjustment hint)
  // NOTE: Base commission rate is set on the Partners page only.
  // The adjustment button here adds a one-off correction to a specific order only.
  const adjHint = o.adjustmentAmount !== 0 
    ? `<span class="commission-adj ${o.adjustmentAmount > 0 ? 'pos' : 'neg'}" title="One-off adjustment: ${o.adjustmentAmount} (${esc(o.adjustmentNotes)})">
        ${o.adjustmentAmount > 0 ? '+' : ''}${o.adjustmentAmount}
       </span>`
    : '';

  const adjBtn = '';

  return `
    <tr class="${rowClass}" id="order-row-${esc(o.id)}">
      <td><span title="${attrTitle}">${attrIcon}</span> ${orderRefCell}</td>
      <td class="text-subtle" style="font-size:12px; white-space:nowrap">${date}</td>
      <td>${esc(o.eventName)}</td>
      <td style="text-align:center">${o.ticketQty}</td>
      <td><span class="mono">${esc(o.grossAmount)}</span></td>
      <td><span class="text-subtle" style="font-size:12px">${esc(o.discount)}</span></td>
      <td>
        <div style="display:flex; align-items:center; gap:6px;">
          <span class="green-text mono">${esc(o.commission)}</span>
          ${adjHint}
          ${adjBtn}
        </div>
      </td>
      <td>
        <div style="display:flex; flex-direction:column; gap:4px;">
          <span class="badge-status ${statusClass}" style="font-size:10px;">${statusIcon} ${o.status.toUpperCase()}</span>
          ${payoutToggle}
        </div>
      </td>
      <td>${revealCell}</td>
    </tr>`;
}

// ── Admin: Payout & Adjustment Handlers ──────────────────────

async function updatePayoutStatus(orderId, newStatus) {
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/payout`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${window.state?.session?.access_token}`,
      },
      body: JSON.stringify({ status: newStatus }),
    });

    if (!res.ok) throw new Error('Failed to update payout status');

    // Update local state and re-render
    const idx = ordersState.orders.findIndex(o => o.orderId === orderId);
    if (idx !== -1) ordersState.orders[idx].payoutStatus = newStatus;
    
    showToast(`Order ${orderId} marked as ${newStatus}`, 'success');
    renderOrders();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function promptCommissionAdjustment(orderId, currentAdj) {
  const amountStr = prompt(`Enter commission adjustment for order ${orderId} (e.g. 5, -5):`, currentAdj);
  if (amountStr === null) return;
  const amount = parseFloat(amountStr);
  if (isNaN(amount)) return showToast('Invalid amount', 'error');

  const notes = prompt('Adjustment notes (optional):');
  
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/adjust`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${window.state?.session?.access_token}`,
      },
      body: JSON.stringify({ amount, notes }),
    });

    if (!res.ok) throw new Error('Failed to save adjustment');

    showToast(`Commission adjusted for ${orderId}`, 'success');
    await forceRefreshOrders(); // Refresh to get recalculated commissions
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ── PII Reveal ─────────────────────────────────────────────
async function revealOrderPii(eventId, maskedRef) {
  // Pull the raw order_id from our orders state
  const order = ordersState.orders.find(o => o.id === eventId);
  if (!order) return showToast('Order not found in local state', 'error');

  // The reveal endpoint uses the raw order_id stored before masking
  const rawOrderId = order.orderIdRaw || '';

  if (!rawOrderId) {
    showToast('Cannot reveal — raw order reference unavailable.', 'error');
    return;
  }

  const btn = document.getElementById(`reveal-btn-${eventId}`);
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }

  try {
    const headers = {};
    if (window.state?.session?.access_token) {
      headers['Authorization'] = `Bearer ${window.state.session.access_token}`;
    }

    const res = await fetch(`/api/partner-orders/${encodeURIComponent(rawOrderId)}/reveal`, { headers });

    if (res.status === 403) {
      showToast('PII access denied. Ask your admin to enable the PII exception.', 'error', 6000);
      return;
    }

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();

    // Update this order in local state so the row re-renders as revealed
    const idx = ordersState.orders.findIndex(o => o.id === eventId);
    if (idx !== -1) {
      ordersState.orders[idx] = { ...ordersState.orders[idx], ...data, piiRevealed: true };
    }

    // Open the PII detail modal
    openPiiRevealModal(data);

    // Re-render the specific row
    renderOrders();

    showToast('PII access logged. Access record has been saved to the audit trail.', 'info', 5000);

    // Admins — refresh the audit log panel
    if (window.state?.user?.role === 'admin') {
      fetchPiiLogs();
    }
  } catch (err) {
    showToast(err.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '🔍 Reveal'; }
  }
}

// ── PII Detail Modal ────────────────────────────────────────
function openPiiRevealModal(data) {
  const modal = document.getElementById('pii-reveal-modal');
  if (!modal) return;

  const date = data.purchaseDate
    ? new Date(data.purchaseDate).toLocaleString('en-GB')
    : '—';

  document.getElementById('pii-modal-order-id').textContent   = data.orderIdRaw || data.orderId;
  document.getElementById('pii-modal-event').textContent      = data.eventName  || '—';
  document.getElementById('pii-modal-date').textContent       = date;
  document.getElementById('pii-modal-qty').textContent        = data.ticketQty  || 0;
  document.getElementById('pii-modal-gross').textContent      = data.grossAmount;
  document.getElementById('pii-modal-discount').textContent   = data.discount;
  document.getElementById('pii-modal-commission').textContent = data.commission;
  document.getElementById('pii-modal-status').textContent     = data.status;

  const warning = document.getElementById('pii-modal-warning');
  if (warning) {
    warning.textContent = `⚠ This access has been logged at ${new Date().toLocaleString('en-GB')}.`;
  }

  modal.style.display = 'flex';
}

// ── PII Audit Log ───────────────────────────────────────────
function renderPiiLogs() {
  const tbody = document.getElementById('pii-log-tbody');
  if (!tbody) return;

  const logs = ordersState.piiLogs;

  if (ordersState.piiLogsLoading) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty">Loading audit log…</td></tr>`;
    return;
  }

  if (!logs || logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty">No PII access events recorded yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = logs.map(entry => {
    const date = new Date(entry.accessed_at).toLocaleString('en-GB');
    const fields = Array.isArray(entry.fields) ? entry.fields.join(', ') : entry.fields;
    return `
      <tr>
        <td class="text-subtle" style="font-size:11px; white-space:nowrap">${esc(date)}</td>
        <td><span class="mono" style="font-size:11px">${esc(entry.accessor_id?.slice(0,8))}…</span></td>
        <td><span class="badge-status ${entry.accessor_role === 'admin' ? 'badge-active' : 'badge-inactive'}">${esc(entry.accessor_role)}</span></td>
        <td><span class="mono" style="font-size:11px">${esc(entry.partner_id || '—')}</span></td>
        <td><span class="mono" style="font-size:11px">${esc(entry.order_id)}</span></td>
        <td class="text-subtle" style="font-size:11px">${esc(fields)}</td>
      </tr>`;
  }).join('');
}

// ── Filter Handlers ─────────────────────────────────────────
function filterOrders() {
  ordersState.search = (document.getElementById('orders-search')?.value || '').trim();
  renderOrders();
}

function setOrderStatusFilter(status, btn) {
  ordersState.statusFilter = status;
  document.querySelectorAll('#orders-filter-tabs .filter-tab').forEach(el => el.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderOrders();
}

async function applyOrderDateFilter() {
  ordersState.dateFrom      = document.getElementById('orders-date-from')?.value || '';
  ordersState.dateTo        = document.getElementById('orders-date-to')?.value   || '';
  ordersState.initialized   = false;   // force re-fetch with new date range
  await fetchOrders();
}

function updateOrdersBadge() {
  const el = document.getElementById('badge-orders');
  if (el) el.textContent = ordersState.orders.length;
}

// ── Admin: PII Exception Toggle ─────────────────────────────
async function togglePiiException(partnerId, currentState) {
  const newState = !currentState;
  // Removed confirm dialog as requested by user

  try {
    const res = await fetch(`/api/partners/${encodeURIComponent(partnerId)}/pii-exception`, {
      method:  'PUT',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${window.state?.session?.access_token}`,
      },
      body: JSON.stringify({ enabled: newState }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to update PII exception');
    }

    showToast(
      `PII exception ${newState ? 'enabled' : 'disabled'} for partner ${partnerId}`,
      newState ? 'success' : 'info'
    );

    // Refresh the partners table to reflect the new state
    await fetchPartners();
    renderPartners();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Expose globally so HTML onclick attributes and app.js can call these
window.initOrders           = initOrders;
window.fetchOrders          = fetchOrders;
window.forceRefreshOrders   = forceRefreshOrders;
window.fetchPiiLogs         = fetchPiiLogs;
window.filterOrders         = filterOrders;
window.setOrderStatusFilter = setOrderStatusFilter;
window.applyOrderDateFilter = applyOrderDateFilter;
window.revealOrderPii       = revealOrderPii;
window.openPiiRevealModal   = openPiiRevealModal;
window.togglePiiException   = togglePiiException;
window.renderOrders         = renderOrders;
window.renderPiiLogs        = renderPiiLogs;
window.updateOrdersBadge    = updateOrdersBadge;
window.updatePayoutStatus   = updatePayoutStatus;
window.promptCommissionAdjustment = promptCommissionAdjustment;
