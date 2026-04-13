'use strict';

/* ═══════════════════════════════════════════════════════════
   Referral Hub — SPA Application
   ═══════════════════════════════════════════════════════════ */

// ── State ──────────────────────────────────────────────────
const state = {
  currentPage: 'dashboard',
  user: null, // Current profile from Supabase
  session: null,
  stats: {},
  events: [],
  partners: [],
  health: {},
  logs: [],
  invitations: [],
  tickets: [], // Attendees from TT
  activityFilter: 'all',
  partnerSearch: '',
  ticketSearch: '',
  globalPartnerFilter: '',
  refreshInterval: null,
  lastEventCount: 0,
  // Sort state per page
  sort: {
    partners: { col: 'totalSales', dir: 'desc' },
    tickets: { col: 'timestamp', dir: 'desc' },
    orders: { col: 'purchase_date', dir: 'desc' },
  },
  // Unread tracking per section
  unread: {
    activity: 0,
    orders: 0,
    tickets: 0,
    chat: 0,
  },
  seenEventIds: new Set(),
};
window.state = state; // Export globally for other modules like orders.js

// ── Page metadata ─────────────────────────────────────────
const pages = {
  dashboard: { title: 'Dashboard', subtitle: 'Real-time referral partner overview' },
  profile: { title: 'My Profile', subtitle: 'View and manage your account details' },
  partners: { title: 'Registry', subtitle: 'Manage your referral partner network' },
  activity: { title: 'Activity', subtitle: 'Full webhook event log' },
  orders: { title: 'Orders', subtitle: 'Privacy-safe view of your attributed orders' },
  tickets: { title: 'Attendance', subtitle: 'Live attendee list and check-in status' },
  reports: { title: 'Reports', subtitle: 'Analytics, rankings, and exports' },
  system: { title: 'System', subtitle: 'Health, config, and audit logs' },
  // Payout pages
  payouts: { title: 'Payout Management', subtitle: 'Partner balances, approvals, and payout tracking' },
  earnings: { title: 'My Earnings', subtitle: 'Your commission balance and payout history' },
  'payout-settings': { title: 'Payout Settings', subtitle: 'Manage your payment details for commission payouts' },
};

// ── Navigation ─────────────────────────────────────────────
function navigate(page) {
  if (page === 'chat') {
    if (typeof toggleChatExpanded === 'function') toggleChatExpanded();
    return;
  }

  if (!pages[page]) return;

  state.currentPage = page;

  // Update sidebar active state
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const navEl = document.getElementById(`nav-${page}`);
  if (navEl) navEl.classList.add('active');

  // Show correct page section
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');

  // Update topbar text
  const titleEl = document.getElementById('page-title');
  const subtitleEl = document.getElementById('page-subtitle');
  if (titleEl) titleEl.textContent = pages[page].title;
  if (subtitleEl) subtitleEl.textContent = pages[page].subtitle;

  // Clear filters if navigating between main pages (unless coming from a "jump" like viewPartnerActivity)
  if (page === 'activity' && !state._isJumpingToActivity) {
    state.activitySearch = '';
    const searchEl = document.getElementById('activity-search');
    if (searchEl) {
      searchEl.value = '';
      // Force an 'input' event to trigger any reactive UI if needed
      searchEl.dispatchEvent(new Event('input'));
    }
    state.activityFilter = 'all';
    document.querySelectorAll('#page-activity .filter-tab').forEach(el => el.classList.remove('active'));
    document.querySelector('#page-activity .filter-tab[data-type="all"]')?.classList.add('active');
  }
  state._isJumpingToActivity = false;

  // Clear unread tracking for the newly selected page
  if (state.unread) {
    if (page === 'activity' && state.unread.activity > 0) {
      state.unread.activity = 0;
      updateActivityBadge();
    }
    if (page === 'orders' && state.unread.orders > 0) {
      state.unread.orders = 0;
      updateActivityBadge(); // Orders relies on activity badge logic right now
    }
    if (page === 'tickets' && state.unread.tickets > 0) {
      state.unread.tickets = 0;
      updateTicketBadge();
    }
    if (page === 'chat' && state.unread.chat > 0) {
      state.unread.chat = 0;
      updateChatNavBadge(0); // Pass 0 assuming unread are cleared, specific count happens via chat.js
    }
  }

  // Trigger targeted refresh
  renderCurrentPage();

  // Close sidebar on mobile after navigation
  document.getElementById('sidebar')?.classList.remove('mobile-show');
}

// ── Data Fetching ──────────────────────────────────────────
async function fetchJSON(url) {
  try {
    const headers = {};
    if (state.session?.access_token) {
      headers['Authorization'] = `Bearer ${state.session.access_token}`;
    }

    const res = await fetch(url, { headers });
    if (res.status === 401) {
      console.warn('Session expired, logging out...');
      auth.logout();
      return null;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`[RH] fetch failed: ${url}`, err.message);
    return null;
  }
}

async function refreshAll() {
  const btn = document.getElementById('refresh-btn');
  if (btn) btn.classList.add('spinning');

  await Promise.all([
    fetchStats().catch(err => console.warn('fetchStats:', err)),
    fetchEvents().catch(err => console.warn('fetchEvents:', err)),
    fetchPartners().catch(err => console.warn('fetchPartners:', err)),
    fetchTickets().catch(err => console.warn('fetchTickets:', err)),
    (typeof forceRefreshOrders === 'function' ? forceRefreshOrders() : Promise.resolve()).catch(err => console.warn('forceRefreshOrders:', err)),
  ]);

  renderCurrentPage();
  if (btn) btn.classList.remove('spinning');
  updateLastUpdated();
}

async function fetchStats() {
  const url = state.globalPartnerFilter ? `/api/stats?partner_id=${state.globalPartnerFilter}` : '/api/stats';
  const data = await fetchJSON(url);
  if (data) state.stats = data;
}

async function fetchEvents() {
  const url = state.globalPartnerFilter ? `/api/events?limit=100&partner_id=${state.globalPartnerFilter}` : '/api/events?limit=100';
  const data = await fetchJSON(url);
  if (data) {
    state.events = data;
    updateActivityBadge();
  }
}

async function fetchPartners() {
  const data = await fetchJSON('/api/partners');
  if (data) {
    state.partners = data;
    updatePartnerBadge();
    updatePartnerDropdown();
  }
  // Admin also fetches pending invitations
  if (state.user?.role === 'admin') {
    const invites = await fetchJSON('/api/invitations');
    if (invites) state.invitations = invites;
  }
}

async function fetchTickets() {
  const url = state.globalPartnerFilter ? `/api/tickets?limit=50&partner_id=${state.globalPartnerFilter}` : '/api/tickets?limit=50';
  const data = await fetchJSON(url);
  if (data) {
    state.tickets = data;

    if (!state.seenTicketIds) state.seenTicketIds = new Set();

    let newTickets = 0;
    data.forEach(t => {
      if (t.orderId && !state.seenTicketIds.has(t.orderId)) {
        state.seenTicketIds.add(t.orderId);
        // Only count as "new" if this is not the first fetch
        if (state.lastTicketCount !== undefined) {
          newTickets++;
        }
      }
    });

    state.lastTicketCount = data.length;
    updateTicketBadge(newTickets);
  }
}

async function fetchHealth() {
  const data = await fetchJSON('/api/health');
  if (data) state.health = data;
}

async function fetchLogs() {
  const data = await fetchJSON('/api/logs?limit=50');
  if (data) state.logs = data.lines || [];
}

async function fetchSecurityLogs() {
  const data = await fetchJSON('/api/activity-logs?limit=100');
  if (data) state.securityLogs = data;
}

// ── Render Router ──────────────────────────────────────────
function renderCurrentPage() {
  switch (state.currentPage) {
    case 'dashboard': renderDashboard(); break;
    case 'profile': if (typeof loadProfilePage === 'function') loadProfilePage(); break;
    case 'partners': renderPartners(); renderInvitations(); break;
    case 'activity': renderActivity(); break;
    case 'orders': if (typeof initOrders === 'function') initOrders(); break;
    case 'tickets': renderTickets(); break;
    case 'reports': initReports(); break;
    case 'system': renderSystem(); break;
    // ─ Payout pages ─
    case 'payouts': if (typeof initPayoutsPage === 'function') initPayoutsPage(); break;
    case 'earnings': if (typeof initEarningsPage === 'function') initEarningsPage(); break;
    case 'payout-settings': if (typeof initPayoutSettingsPage === 'function') initPayoutSettingsPage(); break;
  }
}

// Alias used by chat.js to navigate programmatically
function navigateTo(page) { navigate(page); }
window.navigateTo = navigateTo;

// ── Render: Dashboard ──────────────────────────────────────
function renderDashboard() {
  updateStatCards();
  const dashEvents = state.events.slice(0, 30);
  renderFeed('feed-dashboard', dashEvents);
  // Update count badges
  const actCount = document.getElementById('dashboard-activity-count');
  if (actCount) actCount.textContent = state.events.length;
  renderTopPartners();
  renderRecentTickets();

  // Show Partner Toolkit only for Partners
  const toolkitCard = document.getElementById('partner-toolkit-card');
  if (toolkitCard) {
    if (state.user?.role === 'partner') {
      toolkitCard.style.display = 'block';
      // If generateToolkitQR is available in the profile or dashboard script, ensure it's called
      if (typeof updateToolkitLink === 'function') {
        updateToolkitLink();
      }
    } else {
      toolkitCard.style.display = 'none';
    }
  }
}

function updateStatCards() {
  const s = state.stats;
  setStatValue('stat-sales', s.totalSales ?? 0);
  setStatValue('stat-commission', s.totalCommission ?? 'CHF 0.00');
  setStatValue('stat-tickets', s.totalTickets ?? 0);
  setStatValue('stat-cancellations', s.totalCancellations ?? 0);

  // Contextual modifications based on Role
  if (state.user?.role === 'admin') {
    const revCard = document.getElementById('card-revenue');
    if (revCard) {
      revCard.style.display = 'flex';
      setStatValue('stat-revenue', s.totalRevenue ?? 'CHF 0.00');
    }
    const commLabel = document.getElementById('label-commission');
    if (commLabel) {
      commLabel.textContent = 'System Commission';
    }
  } else {
    // For Partners
    const commLabel = document.getElementById('label-commission');
    if (commLabel) {
      commLabel.textContent = 'Your Earnings';
    }
  }

  // Uptime
  if (s.uptime !== undefined) {
    const uptimeBadge = document.getElementById('uptime-badge');
    if (uptimeBadge) uptimeBadge.textContent = `⏱ ${formatUptime(s.uptime)}`;
  }
}

function setStatValue(id, newValue) {
  const el = document.getElementById(id);
  if (!el) return;
  const old = el.textContent.trim();
  const next = String(newValue);
  if (old !== next) {
    el.textContent = next;
    el.classList.remove('bump');
    // Force reflow for re-animation
    void el.offsetWidth;
    el.classList.add('bump');
  }
}

function renderTopPartners() {
  const container = document.getElementById('top-partners-list');
  if (!container) return;

  if (state.user.role !== 'admin') {
    const card = container.closest('.card');
    if (card) card.style.display = 'none';
    return;
  }

  // Sort partners by total sales descending; show top 8
  const top = [...state.partners]
    .filter(p => p.totalSales > 0 || p.totalTickets > 0)
    .sort((a, b) => b.totalSales - a.totalSales)
    .slice(0, 8);

  // Update count badge
  const countBadge = document.getElementById('dashboard-partners-count');
  if (countBadge) countBadge.textContent = state.partners.length;

  if (top.length === 0) {
    container.innerHTML = `
      <div class="feed-empty" style="padding:40px 20px;">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--yellow); filter:drop-shadow(0 0 8px rgba(255,165,0,0.4)); margin-bottom:12px;"><path d="M12 15l-3-3m0 0l3-3m-3 3h8"/><path d="M12 21a9 9 0 100-18 9 9 0 000 18z"/></svg>
        <p style="color:var(--text-primary); font-weight:500; margin-bottom:4px;">No Sales Recorded</p>
        <p style="font-size:12px; color:var(--text-subtle);">Partner sales performance metrics will appear here.</p>
      </div>`;
    return;
  }

  container.innerHTML = top.map((p, i) => {
    const rankClass = i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
    return `
      <div class="top-partner-item">
        <div class="partner-rank ${rankClass}">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}</div>
        <div class="partner-avatar">${initials(p.name)}</div>
        <div class="partner-info">
          <div class="partner-name">${esc(p.name)}</div>
          <div class="partner-sales">${p.totalSales} sale${p.totalSales !== 1 ? 's' : ''} · ${p.totalTickets} ticket${p.totalTickets !== 1 ? 's' : ''}</div>
        </div>
        <div class="partner-commission">${esc(p.totalCommission)}</div>
      </div>`;
  }).join('');
}

// ── Render: Feed ───────────────────────────────────────────
function renderFeed(containerId, events) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!events || events.length === 0) {
    container.innerHTML = `
      <div class="feed-empty" style="padding:40px 20px;">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--green); filter:drop-shadow(0 0 8px rgba(34,197,94,0.4)); margin-bottom:12px;"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
        <p style="color:var(--text-primary); font-weight:500; margin-bottom:4px;">System Active</p>
        <p style="font-size:12px; color:var(--text-subtle);">Waiting for real-time webhook payloads...</p>
      </div>`;
    return;
  }

  container.innerHTML = events.map(evt => buildFeedItem(evt)).join('');
}

function buildFeedItem(evt) {
  const typeLabel = { sale: 'Sale', cancellation: 'Cancelled', unknown_tag: 'Unknown Tag', error: 'Error' }[evt.type] || evt.type;
  const time = evt.timestamp ? timeAgo(evt.timestamp) : '';

  let title = '';
  let meta = '';

  if (evt.type === 'sale') {
    title = `${esc(evt.partnerName || 'Partner')} — ${esc(evt.eventName || 'Event')}`;
    meta = `
      <span>🎟 ${evt.ticketQuantity ?? 1} ticket${(evt.ticketQuantity ?? 1) !== 1 ? 's' : ''}</span>
      <span>💰 ${esc(evt.commission ?? '')}</span>
      <span>🪙 ${esc(evt.orderTotal ?? '')}</span>
      <span>#${esc(evt.orderId ?? '')}</span>`;
  } else if (evt.type === 'cancellation') {
    title = `Cancelled — ${esc(evt.partnerName || 'Partner')}`;
    meta = `
      <span>↩ ${esc(evt.commission ?? '')} reversed</span>
      <span>#${esc(evt.orderId ?? '')}</span>`;
  } else if (evt.type === 'unknown_tag') {
    title = `Unknown referral tag: ${esc(evt.referralTag ?? '')}`;
    meta = `<span>Order #${esc(evt.orderId ?? '')} · ${esc(evt.orderTotal ?? '')}</span>`;
  } else {
    title = esc(evt.message || evt.type);
  }

  return `
    <div class="feed-item">
      <span class="feed-badge badge-${evt.type}">${typeLabel}</span>
      <div class="feed-content">
        <div class="feed-title">${title}</div>
        <div class="feed-meta">${meta}</div>
      </div>
      <div class="feed-time">${time}</div>
    </div>`;
}

// ── Render: Partners ───────────────────────────────────────
function renderPartners() {
  const tbody = document.getElementById('partners-tbody');
  const query = state.partnerSearch.toLowerCase();

  let filtered = state.partners;
  if (query) {
    filtered = filtered.filter(p =>
      (p.name || '').toLowerCase().includes(query) ||
      (p.email || '').toLowerCase().includes(query) ||
      (p.id || '').toLowerCase().includes(query)
    );
  }

  // Apply sort
  const { col, dir } = state.sort.partners;
  filtered = sortArray(filtered, col, dir);

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="table-empty">${query ? 'No partners match your search.' : 'Loading partners…'}</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(p => {
    const piiEnabled = p.pii_exception_enabled === true || p.piiExceptionEnabled === true;
    const piiToggleLabel = piiEnabled ? '🛡 PII On' : '🔒 PII Off';
    const piiToggleClass = piiEnabled ? 'enabled' : 'disabled';
    return `
    <tr>
      <td>
        <div class="partner-cell">
          <div class="partner-cell-avatar">${initials(p.name)}</div>
          <div>
            <div class="partner-cell-name">${esc(p.name)}</div>
            <div class="partner-cell-email">${esc(p.email)}</div>
          </div>
        </div>
      </td>
      <td><span class="mono">${esc(p.id)}</span></td>
      <td>
        <!-- Commission Rate — inline editable, only editable here not in orders -->
        <div class="commission-rate-cell" id="cr-cell-${p.id}">
          <span class="green-text commission-rate-display" 
                title="Click to edit commission rate"
                onclick="startEditCommissionRate('${p.id}', '${esc(p.commissionRate)}')">
            ${esc(p.commissionRate)}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-left:4px;opacity:0.5"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
          </span>
          <div class="commission-rate-edit" style="display:none;align-items:center;gap:4px">
            <input type="number" min="0" max="100" step="0.1" 
                   id="cr-input-${p.id}"
                   class="form-input" style="width:80px;padding:4px 8px;font-size:12px;height:28px"
                   onkeydown="if(event.key==='Enter') savePartnerCommissionRate('${p.id}'); if(event.key==='Escape') cancelEditCommissionRate('${p.id}')" />
            <button class="action-icon-btn" onclick="savePartnerCommissionRate('${p.id}')" title="Save" style="color:var(--green)">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            </button>
            <button class="action-icon-btn" onclick="cancelEditCommissionRate('${p.id}')" title="Cancel">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
      </td>
      <td>${p.totalSales}</td>
      <td>${p.totalTickets}</td>
      <td><span class="green-text">${esc(p.totalCommission)}</span></td>
      <td>${p.lastSale ? `<span style="font-size:11px;color:var(--text-muted)">${timeAgo(p.lastSale)}</span>` : '<span style="color:var(--text-muted);font-size:11px">—</span>'}</td>
      <td>
        
        <span class="badge-status ${p.status === 'active' ? 'badge-active' : 'badge-inactive'}">
          ${p.status === 'active' ? '● Active' : '○ Inactive'}
        </span>

      </td>
      <td class="table-actions-cell">
        <button class="action-icon-btn" onclick="viewPartnerActivity('${p.id}')" title="View Activity">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
        <button class="action-icon-btn" onclick="openPartnerModal('${p.id}')" title="Edit Partner Details">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
        </button>
        <button class="action-icon-btn pii-toggle-btn ${piiToggleClass}" 
                onclick="togglePiiException('${p.id}', ${piiEnabled})"
                title="${piiEnabled ? 'Disable PII exception' : 'Enable PII exception'}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
        </button>
        <button class="action-icon-btn" onclick="togglePartnerStatus('${p.id}', '${p.status}')" title="${p.status === 'active' ? 'Deactivate Partner' : 'Activate Partner'}">
          ${p.status === 'active'
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>'}
        </button>
        <button class="action-icon-btn" onclick="adminResetPassword('${p.id}')" title="Reset Password">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg>
        </button>

        <button class="action-icon-btn delete" 
                onclick="${p.totalCommissionRaw > 0 ? '' : `deletePartner('${p.id}')`}" 
                ${p.totalCommissionRaw > 0 ? 'disabled' : ''}
                title="${p.totalCommissionRaw > 0 ? 'Partner cannot be deleted because they have active earnings' : 'Delete Partner'}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
        <button class="action-icon-btn copy" onclick="copyLink('${esc(p.referralLink)}', this)" title="Copy Link">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
      </td>
    </tr>`;
  }).join('');
}

// ── Inline Commission Rate Edit ─────────────────────────────
function startEditCommissionRate(partnerId, currentRate) {
  const cell = document.getElementById(`cr-cell-${partnerId}`);
  if (!cell) return;
  const display = cell.querySelector('.commission-rate-display');
  const edit = cell.querySelector('.commission-rate-edit');
  const input = document.getElementById(`cr-input-${partnerId}`);
  // Parse numeric value from formatted string like "10%" or "0.1"
  const numericRate = parseFloat(String(currentRate).replace(/[^0-9.]/g, '')) || 0;
  input.value = numericRate;
  if (display) display.style.display = 'none';
  if (edit) edit.style.display = 'flex';
  input.focus();
  input.select();
}

function cancelEditCommissionRate(partnerId) {
  const cell = document.getElementById(`cr-cell-${partnerId}`);
  if (!cell) return;
  const display = cell.querySelector('.commission-rate-display');
  const edit = cell.querySelector('.commission-rate-edit');
  if (display) display.style.display = 'flex';
  if (edit) edit.style.display = 'none';
}

async function savePartnerCommissionRate(partnerId) {
  const input = document.getElementById(`cr-input-${partnerId}`);
  if (!input) return;
  const newRate = parseFloat(input.value);
  if (isNaN(newRate) || newRate < 0 || newRate > 100) {
    showToast('Commission rate must be between 0 and 100', 'error');
    return;
  }

  try {
    const res = await fetch(`/api/partners/${partnerId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.session.access_token}`,
      },
      body: JSON.stringify({ commission_rate: newRate }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to update commission rate');
    }
    showToast(`Commission rate updated to ${newRate}%`, 'success');
    await fetchPartners();
    renderPartners();
  } catch (err) {
    showToast(err.message, 'error');
    cancelEditCommissionRate(partnerId);
  }
}
window.startEditCommissionRate = startEditCommissionRate;
window.cancelEditCommissionRate = cancelEditCommissionRate;
window.savePartnerCommissionRate = savePartnerCommissionRate;



// ── Render: Activity ───────────────────────────────────────
function renderActivity() {
  let filtered = state.activityFilter === 'all'
    ? state.events
    : state.events.filter(e => e.type === state.activityFilter);

  const query = (state.activitySearch || '').toLowerCase();
  if (query) {
    filtered = filtered.filter(e =>
      (e.partnerName || '').toLowerCase().includes(query) ||
      (e.eventName || '').toLowerCase().includes(query) ||
      (e.orderId || '').toLowerCase().includes(query) ||
      (e.referralTag || '').toLowerCase().includes(query)
    );
  }

  renderFeed('feed-activity', filtered);
}

// ── Render: Tickets ────────────────────────────────────────
function renderTickets() {
  const tbody = document.getElementById('tickets-tbody');
  const query = (state.ticketSearch || '').toLowerCase();

  let filtered = state.tickets;
  if (query) {
    filtered = filtered.filter(t =>
      (t.attendeeName || '').toLowerCase().includes(query) ||
      (t.email || '').toLowerCase().includes(query) ||
      (t.orderId || '').toLowerCase().includes(query) ||
      (t.referralTag || '').toLowerCase().includes(query) ||
      (t.ticketType || '').toLowerCase().includes(query)
    );
  }

  // Apply sort
  const { col, dir } = state.sort.tickets;
  filtered = sortArray(filtered, col, dir);

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty">${query ? 'No attendees match your search.' : 'No tickets found.'}</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(t => `
    <tr>
      <td>
        <div class="partner-cell">
          <div class="partner-cell-avatar" style="background:var(--blue-glow);color:var(--blue)">${initials(t.attendeeName)}</div>
          <div>
            <div class="partner-cell-name">${esc(t.attendeeName)} ${t.checkedIn ? '<span title="Checked In">✅</span>' : ''}</div>
            <div class="partner-cell-email">${esc(t.email)}</div>
          </div>
        </div>
      </td>
      <td><span class="mono">${esc(t.orderId)}</span></td>
      <td><span class="text-subtle">${esc(t.ticketType)}</span></td>
      <td><span class="badge-status ${t.referralTag === 'direct' ? 'badge-inactive' : 'badge-active'}" style="font-size:10px">${esc(t.referralTag)}</span></td>
      <td><span class="badge-status ${t.status === 'valid' ? 'badge-active' : 'badge-inactive'}">${esc(t.status)}</span></td>
      <td>
        <span class="status-indicator ${t.checkedIn ? 'ok' : ''}">
          ${t.checkedIn ? 'Scanned' : 'Pending'}
        </span>
      </td>
      <td class="text-subtle" style="font-size:11px">${timeAgo(t.timestamp)}</td>
    </tr>
  `).join('');
}

function renderRecentTickets() {
  const container = document.getElementById('recent-tickets-list');
  if (!container) return;

  // Show up to 8 most recent tickets
  const tickets = [...state.tickets]
    .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
    .slice(0, 8);

  // Update count badge
  const countBadge = document.getElementById('dashboard-tickets-count');
  if (countBadge) countBadge.textContent = state.tickets.length;

  if (tickets.length === 0) {
    container.innerHTML = `
      <div class="feed-empty" style="padding:40px 20px;">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--blue); filter:drop-shadow(0 0 8px rgba(59,130,246,0.4)); margin-bottom:12px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
        <p style="color:var(--text-primary); font-weight:500; margin-bottom:4px;">No Tickets Issued</p>
        <p style="font-size:12px; color:var(--text-subtle);">Ticket details will instantly populate after purchase.</p>
      </div>`;
    return;
  }

  container.innerHTML = tickets.map(t => `
    <div class="top-partner-item">
      <div class="partner-avatar" style="background:var(--blue-glow);color:var(--blue)">${initials(t.attendeeName)}</div>
      <div class="partner-info">
        <div class="partner-name">${esc(t.attendeeName)} ${t.checkedIn ? '✅' : ''}</div>
        <div class="partner-sales">${esc(t.ticketType)} · #${esc(t.orderId)}</div>
      </div>
      <div style="text-align:right;">
        <div class="status-indicator ${t.checkedIn ? 'ok' : ''}" title="${t.checkedIn ? 'Checked In' : 'Pending'}">
          ${t.checkedIn ? 'Scanned' : 'Pending'}
        </div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${timeAgo(t.timestamp)}</div>
      </div>
    </div>`).join('');
}

// ── Render: System ─────────────────────────────────────────
async function renderSystem() {
  await Promise.all([fetchHealth(), fetchLogs(), fetchSecurityLogs()]);

  const h = state.health;

  // Health checks
  const checks = [
    {
      label: 'Server Status',
      value: `Uptime: ${formatUptime(h.uptime || 0)}`,
      ok: h.status === 'ok',
      icon: '🟢',
    },
    {
      label: 'Webhook Secret',
      value: h.webhookSecretSet ? 'Configured' : 'NOT SET — webhooks will be rejected',
      ok: h.webhookSecretSet,
      icon: '🔐',
    },
    {
      label: 'Resend Email',
      value: h.resendConfigured ? 'API key present' : 'NOT SET — emails won\'t send',
      ok: h.resendConfigured,
      icon: '📧',
    },
    {
      label: 'Admin Alerts',
      value: h.adminEmailSet ? 'Admin email set' : 'Not configured',
      ok: h.adminEmailSet,
      icon: '🔔',
    },
    {
      label: 'Ticket Tailor API',
      value: h.ticketTailor === 'connected' ? 'Connected' : 'Connection Error',
      ok: h.ticketTailor === 'connected',
      icon: '🎫',
    },
    {
      label: 'Node.js Version',
      value: h.nodeVersion || 'Unknown',
      ok: true,
      icon: '⚙️',
    },
  ];

  document.getElementById('health-list').innerHTML = checks.map(c => `
    <div class="health-item">
      <div class="health-icon ${c.ok ? 'ok' : 'bad'}">${c.icon}</div>
      <div>
        <div class="health-label">${esc(c.label)}</div>
        <div class="health-value">${esc(c.value)}</div>
      </div>
      <div class="health-status ${c.ok ? 'ok' : 'bad'}">${c.ok ? '✓ OK' : '✗ Error'}</div>
    </div>`).join('');

  // Update system dot in sidebar
  const allOk = checks.every(c => c.ok);
  const dot = document.getElementById('system-status-dot');
  if (dot) { dot.className = `status-dot ${allOk ? 'ok' : ''}`; }

  // Config
  const configItems = [
    { label: 'Registry Mode', value: h.registryMode || 'json', icon: '📋' },
    { label: 'Webhook Endpoint', value: `POST ${window.location.origin}/webhook`, icon: '🔗' },
    { label: 'Dashboard', value: window.location.origin, icon: '🖥️' },
    { label: 'Server Time', value: h.timestamp ? new Date(h.timestamp).toLocaleString() : 'N/A', icon: '🕐' },
  ];

  document.getElementById('config-list').innerHTML = configItems.map(c => `
    <div class="config-item">
      <div class="health-icon ok">${c.icon}</div>
      <div>
        <div class="health-label">${esc(c.label)}</div>
        <div class="health-value mono" style="font-size:11px">${esc(c.value)}</div>
      </div>
    </div>`).join('');

  // PII Logs
  const logViewer = document.getElementById('log-viewer');
  if (state.logs.length === 0) {
    logViewer.innerHTML = `<code style="color:var(--text-muted)">No log entries yet.</code>`;
  } else {
    logViewer.innerHTML = state.logs.map(line => {
      const cls = line.includes('[ERROR]') ? 'error' : line.includes('[WARN]') ? 'warn' : 'info';
      return `<span class="log-line ${cls}">${esc(line)}</span>`;
    }).join('');
  }

  // Security Logs
  const secViewer = document.getElementById('security-log-viewer');
  if (!state.securityLogs || state.securityLogs.length === 0) {
    secViewer.innerHTML = `<code style="color:var(--text-muted)">No security logs yet.</code>`;
  } else {
    secViewer.innerHTML = state.securityLogs.map(log => {
      const ts = new Date(log.created_at).toISOString().replace('T', ' ').split('.')[0];
      const cls = log.activity_type.includes('failed') ? 'error' : 'info';
      const actor = log.user_id ? `[User: ${log.user_id.slice(0, 8)}] ` : '';
      return `<span class="log-line ${cls}">[${ts}] [INFO] SECURITY: ${actor}${esc(log.activity_type)} - ${esc(log.description)}</span>`;
    }).join('');
  }
}


// ── Theme & Notifications ──────────────────────────────────────────────
function toggleTheme(e) {
  if (e) e.preventDefault();
  const root = document.documentElement;
  const isLight = root.classList.contains('light-theme');
  if (isLight) {
    root.classList.remove('light-theme');
    localStorage.setItem('theme', 'dark');
    document.getElementById('theme-icon').innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>';
    document.getElementById('theme-text').textContent = 'Dark Theme';
  } else {
    root.classList.add('light-theme');
    localStorage.setItem('theme', 'light');
    document.getElementById('theme-icon').innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    document.getElementById('theme-text').textContent = 'Light Theme';
  }
}

function applySavedTheme() {
  const saved = localStorage.getItem('theme');
  const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  if (saved === 'light' || (!saved && prefersLight)) {
    toggleTheme(null);
  }
}

function playSysNotification() {
  const audio = document.getElementById('sys-notification-sound');
  if (audio && (!window.chatState || !window.chatState.muted)) {
    audio.currentTime = 0;
    audio.play().catch(e => console.log('Audio autoplay blocked', e));
  }
}


async function togglePartnerStatus(partnerId, currentStatus) {
  const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
  const confirmMsg = newStatus === 'inactive'
    ? 'Are you sure you want to deactivate this partner? They will not be able to log in.'
    : 'Reactivate this partner? They will regain access immediately.';

  const confirmed = await showConfirm({
    title: newStatus === 'inactive' ? 'Deactivate Partner' : 'Activate Partner',
    message: confirmMsg,
    confirmText: newStatus === 'inactive' ? 'Deactivate' : 'Activate',
    type: newStatus === 'inactive' ? 'danger' : 'info'
  });
  if (!confirmed) return;

  try {
    const res = await fetch('/api/partners/' + partnerId + '/status', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + state.session.access_token
      },
      body: JSON.stringify({ status: newStatus })
    });

    if (!res.ok) throw new Error('Failed to update status');
    showToast('Partner status updated to ' + newStatus, 'success');
    await fetchPartners();
    renderPartners();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function adminResetPassword(partnerId) {
  const confirmed = await showConfirm({
    title: 'Reset Password',
    message: 'Are you sure you want to reset the password for this partner? They will receive an email and must choose a new password upon next login.',
    confirmText: 'Reset Password',
    type: 'danger'
  });
  if (!confirmed) return;
  try {
    const res = await fetch('/api/partners/' + partnerId + '/reset-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + state.session.access_token
      }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to reset password');
    showToast('Password reset requested! Temp password: ' + data.tempPassword, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ── UI Actions ─────────────────────────────────────────────
function copyLink(url, btn) {
  navigator.clipboard.writeText(url).then(() => {
    btn.textContent = '✓ Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy Link`;
      btn.classList.remove('copied');
    }, 2000);
    showToast('Referral link copied!', 'success');
  }).catch(() => showToast('Copy failed — check browser permissions', 'error'));
}

function filterPartners() {
  state.partnerSearch = document.getElementById('partner-search').value;
  renderPartners();
}

function setActivityFilter(type, btn) {
  state.activityFilter = type;
  document.querySelectorAll('.filter-tab').forEach(el => el.classList.remove('active'));
  btn.classList.add('active');
  renderActivity();
}

function filterActivity() {
  state.activitySearch = document.getElementById('activity-search').value;
  renderActivity();
}

function filterTickets() {
  state.ticketSearch = document.getElementById('ticket-search').value;
  renderTickets();
}

function updatePartnerDropdown() {
  const dropdown = document.getElementById('global-partner-filter');
  if (!dropdown || state.user?.role !== 'admin') return;
  dropdown.style.display = 'inline-block';

  const currentVal = dropdown.value || state.globalPartnerFilter;
  dropdown.innerHTML = '<option value="">All Partners</option>' +
    state.partners.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  dropdown.value = currentVal;
}

window.performGlobalSearch = function (event) {
  const query = event.target.value;
  if (state.currentPage === 'partners') {
    const el = document.getElementById('partner-search');
    if (el) { el.value = query; searchPartners(); }
  } else if (state.currentPage === 'activity') {
    const el = document.getElementById('activity-search');
    if (el) { el.value = query; filterActivity(); }
  } else if (state.currentPage === 'tickets') {
    const el = document.getElementById('ticket-search');
    if (el) { el.value = query; filterTickets(); }
  } else if (state.currentPage === 'chat') {
    const el = document.getElementById('chat-search-input');
    if (el && typeof searchConversations === 'function') { el.value = query; searchConversations(); }
  } else if (state.currentPage === 'orders') {
    const el = document.getElementById('order-search');
    if (el && typeof orderSearch === 'function') { el.value = query; orderSearch(query); }
  }
};

async function applyGlobalFilter() {
  state.globalPartnerFilter = document.getElementById('global-partner-filter').value;
  await refreshAll();
}

async function invalidateCache() {
  // Directly refresh from API
  try {
    await fetchPartners();
    renderPartners();
    showToast('Registry refreshed', 'success');
  } catch (err) {
    showToast('Failed to refresh registry', 'error');
  }
}

// ── Badge Updates ──────────────────────────────────────────
function updateActivityBadge() {
  const el = document.getElementById('badge-activity');
  if (el) {
    el.textContent = state.events.length;
    el.style.display = state.events.length > 0 ? 'inline-block' : 'none';
  }

  // Detect new events since last check
  let newEvents = 0;
  state.events.forEach(evt => {
    if (evt.id && !state.seenEventIds.has(evt.id)) {
      state.seenEventIds.add(evt.id);
      newEvents++;
    }
  });

  // Flash badge green if new events arrived and we're NOT on the activity page
  if (newEvents > 0 && state.lastEventCount > 0) {
    if (el) {
      el.classList.add('unread');
      el.style.background = 'var(--green)';
      el.style.color = '#0a1628';
      // Only auto-reset if user is viewing activity page
      if (state.currentPage === 'activity') {
        el.classList.remove('unread');
        el.style.background = '';
        el.style.color = '';
      }
    }
    // Track unread count if not on activity page
    if (state.currentPage !== 'activity') {
      state.unread.activity = (state.unread.activity || 0) + newEvents;
    }
    playSysNotification();
  }

  // Clear unread when viewing activity
  if (state.currentPage === 'activity' && el) {
    state.unread.activity = 0;
    el.classList.remove('unread');
    el.style.background = '';
    el.style.color = '';
  }

  state.lastEventCount = state.events.length;

  // Also update Orders badge based on sale events
  const ordersBadge = document.getElementById('badge-orders');
  if (ordersBadge) {
    const saleCount = state.events.filter(e => e.type === 'sale').length;
    ordersBadge.textContent = saleCount;
    ordersBadge.style.display = saleCount > 0 ? 'inline-block' : 'none';

    // Check if new sales arrived
    const newSales = state.events.filter(e => e.type === 'sale' && !state.seenEventIds.has(e.id)).length;
    if (newSales > 0 && state.currentPage !== 'orders') {
      state.unread.orders = (state.unread.orders || 0) + newSales;
    }

    if (state.currentPage === 'orders') {
      state.unread.orders = 0;
      ordersBadge.classList.remove('unread');
    } else if (state.unread.orders > 0) {
      ordersBadge.classList.add('unread');
    }
  }
}

function updatePartnerBadge() {
  const el = document.getElementById('badge-partners');
  if (el) {
    el.textContent = state.partners.length;
    el.style.display = state.partners.length > 0 ? 'inline-block' : 'none';
  }
}

function updateTicketBadge(newTicketsCount = 0) {
  const el = document.getElementById('badge-tickets');
  if (el) {
    el.textContent = state.tickets.length;
    el.style.display = state.tickets.length > 0 ? 'inline-block' : 'none';

    if (newTicketsCount > 0 && state.currentPage !== 'tickets') {
      state.unread.tickets = (state.unread.tickets || 0) + newTicketsCount;
    }

    if (state.currentPage === 'tickets') {
      state.unread.tickets = 0;
      el.classList.remove('unread');
    } else if (state.unread.tickets > 0) {
      el.classList.add('unread');
    }
  }
}

// ── Chat Badge — enhanced to show unread dot ──────────────
function updateChatNavBadge(total) {
  const navBadge = document.getElementById('badge-chat');
  const dot = document.getElementById('chat-unread-dot');
  if (navBadge) {
    navBadge.textContent = total > 0 ? String(total) : '0';
    navBadge.style.display = total > 0 ? 'inline-block' : 'none';
    if (total > 0) {
      navBadge.classList.add('unread');
    } else {
      navBadge.classList.remove('unread');
    }
  }
  if (dot) {
    dot.style.display = total > 0 && state.currentPage !== 'chat' ? 'inline-block' : 'none';
  }
}

// ── Utilities ──────────────────────────────────────────────
function esc(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

// ── Sort Utility ───────────────────────────────────────────
/**
 * Sorts an array of objects by a given column key.
 * Handles strings, numbers, dates, and booleans.
 */
function sortArray(arr, col, dir) {
  return [...arr].sort((a, b) => {
    let va = a[col], vb = b[col];
    // Treat null/undefined as smallest
    if (va == null) va = '';
    if (vb == null) vb = '';
    // Detect ISO date strings
    if (typeof va === 'string' && /^\d{4}-\d{2}-\d{2}/.test(va)) {
      va = new Date(va).getTime();
      vb = new Date(vb).getTime();
    }
    // Coerce numbers
    if (typeof va === 'string' && !isNaN(parseFloat(va))) {
      va = parseFloat(va);
      vb = parseFloat(vb);
    }
    let cmp = 0;
    if (typeof va === 'number' && typeof vb === 'number') {
      cmp = va - vb;
    } else if (typeof va === 'boolean') {
      cmp = Number(va) - Number(vb);
    } else {
      cmp = String(va).localeCompare(String(vb));
    }
    return dir === 'asc' ? cmp : -cmp;
  });
}

/**
 * Wire up sortable column header click handlers.
 * Call once on DOMContentLoaded.
 */
function initSortableHeaders() {
  document.querySelectorAll('.data-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sortCol;
      const page = th.dataset.sortPage;
      if (!col || !page || !state.sort[page]) return;

      const current = state.sort[page];
      const newDir = (current.col === col && current.dir === 'desc') ? 'asc' : 'desc';

      // Update state
      state.sort[page] = { col, dir: newDir };

      // Update visual indicators in this table
      const table = th.closest('table');
      table.querySelectorAll('th.sortable').forEach(h => {
        h.classList.remove('sort-asc', 'sort-desc');
      });
      th.classList.add(newDir === 'asc' ? 'sort-asc' : 'sort-desc');

      // Re-render the affected page
      if (page === 'partners') renderPartners();
      if (page === 'tickets') renderTickets();
      if (page === 'orders' && typeof renderOrders === 'function') renderOrders();
    });
  });
}



function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function timeAgo(isoStr) {
  if (!isoStr) return '';
  const diff = Math.floor((Date.now() - new Date(isoStr)) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatUptime(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function updateLastUpdated() {
  const el = document.getElementById('last-updated-label');
  if (el) el.textContent = 'Updated ' + timeAgo(new Date().toISOString());
}

function showConfirm({ title, message, confirmText = 'Confirm', type = 'info' }) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirm-modal');
    const titleEl = document.getElementById('confirm-title');
    const msgEl = document.getElementById('confirm-message');
    const iconEl = document.getElementById('confirm-icon-area');
    const proceedBtn = document.getElementById('confirm-proceed-btn');
    const cancelBtn = document.getElementById('confirm-cancel-btn');

    titleEl.textContent = title;
    msgEl.textContent = message;
    proceedBtn.textContent = confirmText;

    // Set icon base on type
    iconEl.textContent = type === 'danger' ? '⚠️' : '❓';

    // Style proceed button
    proceedBtn.className = type === 'danger' ? 'btn btn-danger' : 'btn btn-primary';

    const cleanup = (result) => {
      modal.style.display = 'none';
      proceedBtn.onclick = null;
      cancelBtn.onclick = null;
      resolve(result);
    };

    proceedBtn.onclick = () => cleanup(true);
    cancelBtn.onclick = () => cleanup(false);

    modal.style.display = 'flex';
  });
}

function showToast(msg, type = 'info', duration = 3000) {
  const toast = document.getElementById('toast');
  toast.innerHTML = msg; // Support HTML
  toast.className = `toast show ${type}`;
  clearTimeout(toast._timer);
  if (duration > 0) {
    toast._timer = setTimeout(() => {
      toast.classList.remove('show');
    }, duration);
    toast.onclick = null;
  } else {
    toast.onclick = () => toast.classList.remove('show');
  }
}

// ── Auto-Refresh ───────────────────────────────────────────
function startAutoRefresh() {
  if (state.refreshInterval) clearInterval(state.refreshInterval);
  state.refreshInterval = setInterval(async () => {
    await fetchStats();
    await fetchEvents();
    await fetchPartners();
    await fetchTickets();
    if (typeof updateChatBadge === 'function') updateChatBadge();
    renderCurrentPage();
    updateLastUpdated();
  }, 10000); // every 10 seconds
}

// ── Init ───────────────────────────────────────────────────
async function init() {
  console.log('[RH] Starting dashboard initialization...');

  // 1. Session & Auth Check
  state.session = await auth.getSession();
  if (!state.session) {
    console.warn('[RH] No active session found, redirecting to login...');
    window.location.href = '/login.html';
    return;
  }

  // 2. Load User Profile
  state.user = await auth.getProfile();
  if (!state.user) {
    console.error('[RH] CRITICAL: Profile not found for this user account.');
    console.warn('[RH] Logging out to clear invalid session...');
    auth.logout();
    return;
  }

  applySavedTheme();

  // Expose supabase client globally for profile/notification module
  if (!window._supabaseClient) {
    window._supabaseClient = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  }

  // 3. UI Customization (Admin vs Partner)
  applyRoleUI();

  // 4. Force password change if temp_password exists
  if (state.user.temp_password) {
    promptPasswordChange();
  }

  // Handle hash-based routing
  const hash = location.hash.replace('#', '') || 'dashboard';
  if (pages[hash]) state.currentPage = hash;

  // Initial data load
  await refreshAll();

  // Initialize global chat widget
  if (typeof initChat === 'function') initChat();

  // Activate page
  navigate(state.currentPage);

  // Start live polling
  startAutoRefresh();

  // Uptime counter (client-side tick)
  setInterval(() => {
    if (state.stats.uptime !== undefined) {
      state.stats.uptime += 1;
      const el = document.getElementById('uptime-badge');
      if (el) el.textContent = `⏱ ${formatUptime(state.stats.uptime)}`;
    }
  }, 1000);

  console.log(`[Referral Hub] Logged in as ${state.user.role}: ${state.user.email}`);
}

function applyRoleUI() {
  const isAdmin = state.user.role === 'admin';
  const isPartner = state.user.role === 'partner';
  const piiOn = state.user.pii_exception_enabled === true;

  // Hide admin-only nav groups entirely for partners
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin ? '' : 'none';
  });

  // Orders nav always visible
  const oNav = document.getElementById('nav-orders');
  if (oNav) oNav.style.display = '';

  // PII notice banner state
  const banner = document.getElementById('pii-notice-banner');
  const noticeEl = document.getElementById('pii-notice-text');
  if (banner) {
    if (isAdmin || piiOn) {
      banner.classList.add('pii-exception-active');
      if (noticeEl) noticeEl.textContent = isAdmin
        ? 'Admin view — all order references visible. Every reveal is audit-logged.'
        : 'PII exception active — you can reveal masked order references. All access is audit-logged.';
    } else {
      banner.classList.remove('pii-exception-active');
      if (noticeEl) noticeEl.textContent = 'Order references are masked to protect customer privacy. Contact your administrator to enable restricted PII access.';
    }
  }

  // Admin-only: show PII audit log panel on Orders page
  const piiLogCard = document.getElementById('pii-log-card');
  if (piiLogCard) piiLogCard.style.display = isAdmin ? '' : 'none';

  // Display Information for Partners and Admins
  const sidebarTitle = document.getElementById('sidebar-logo-title');
  const sidebarSub = document.getElementById('sidebar-logo-sub');

  if (isPartner) {
    if (sidebarTitle) sidebarTitle.textContent = 'Partner Portal';
    if (sidebarSub) {
      const displayName = state.user.name || state.user.partner_id || state.user.email;
      sidebarSub.textContent = displayName;
      sidebarSub.style.color = 'var(--green)';
      sidebarSub.style.fontWeight = '600';
    }
    if (state.user.partner_id) {
      const subtitle = document.getElementById('page-subtitle');
      if (subtitle) {
        subtitle.innerHTML = `Connected as <code>${esc(state.user.partner_id)}</code> · Real-time earnings in CHF`;
      }
    }
  } else if (isAdmin) {
    if (sidebarTitle) sidebarTitle.textContent = 'Admin Dashboard';
    if (sidebarSub) {
      sidebarSub.textContent = state.user.name || 'Administrator';
      sidebarSub.style.color = 'var(--blue)';
    }
    const addBtn = document.getElementById('btn-add-partner');
    if (addBtn) addBtn.style.display = 'inline-block';

    // Admin-only: show conversation search/filter tools in chat sidebar
    const chatAdminTools = document.getElementById('chat-admin-tools');
    if (chatAdminTools) chatAdminTools.style.display = 'block';
  }

  // Messages nav is visible to both admins and partners
  const chatNav = document.getElementById('nav-chat');
  if (chatNav) chatNav.style.display = '';

  // Show partner-only payout nav items and hide chat dock
  if (isPartner) {
    document.querySelectorAll('.partner-only').forEach(el => { el.style.display = ''; });
    
    // Partners don't need the floating chat dock, just the chat window from the sidebar
    const chatDock = document.getElementById('floating-chat-widget');
    if (chatDock) chatDock.style.display = 'none';
  }
}

function promptPasswordChange() {
  document.getElementById('password-form').reset();
  document.getElementById('password-modal-error').style.display = 'none';

  const modal = document.getElementById('password-modal');
  modal.style.display = 'flex';

  const title = modal.querySelector('h3');
  if (title) title.textContent = 'Action Required: Change Password';

  const cancelBtn = modal.querySelector('.btn-secondary');
  if (cancelBtn) cancelBtn.style.display = 'none';

  showToast('For security, you must set a new password to continue.', 'error');
}

// ── Modals & Actions ───────────────────────────────────────
function openPartnerModal(id = null) {
  const isEdit = !!id;
  document.getElementById('modal-partner-title').textContent = isEdit ? 'Edit Partner' : 'Add Partner';
  document.getElementById('partner-modal-error').style.display = 'none';
  const form = document.getElementById('partner-form');
  form.reset();

  if (isEdit) {
    const p = state.partners.find(x => x.id === id);
    if (p) {
      document.getElementById('partner_id_edit').value = p.id;
      document.getElementById('partner_name').value = p.name;
      document.getElementById('partner_email').value = p.email;
      document.getElementById('partner_tag').value = p.partner_id || p.id;
      document.getElementById('partner_commission').value = p.commissionRate;
      document.getElementById('partner_discount').value = p.discountCode || '';
      document.getElementById('partner_company').value = p.companyName || '';
      document.getElementById('partner_phone').value = p.phoneNumber || '';
      document.getElementById('partner_country').value = p.country || '';

      document.getElementById('partner_tag').disabled = true;
      document.getElementById('partner_email').disabled = true;
    }
  } else {
    document.getElementById('partner_id_edit').value = '';
    document.getElementById('partner_tag').disabled = false;
    document.getElementById('partner_email').disabled = false;
  }

  document.getElementById('partner-modal').style.display = 'flex';
}

function openPasswordModal() {
  if (typeof resetPasswordModal === 'function') {
    resetPasswordModal();
  } else {
    document.getElementById('password-form')?.reset();
    document.getElementById('password-modal-error').style.display = 'none';
  }
  document.getElementById('password-modal').style.display = 'flex';
}

function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

function viewPartnerActivity(id) {
  state._isJumpingToActivity = true;
  state.activitySearch = id;
  const searchEl = document.getElementById('activity-search');
  if (searchEl) searchEl.value = id;

  state.activityFilter = 'all';
  document.querySelectorAll('#page-activity .filter-tab').forEach(el => el.classList.remove('active'));
  document.querySelector('#page-activity .filter-tab[data-type="all"]')?.classList.add('active');

  navigate('activity');
}

async function deletePartner(id) {
  const confirmed = await showConfirm({
    title: 'Delete Partner',
    message: 'Are you sure you want to delete this partner? This action cannot be undone and will remove their access immediately.',
    confirmText: 'Delete',
    type: 'danger'
  });

  if (!confirmed) return;

  try {
    const res = await fetch(`/api/partners/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${state.session.access_token}` }
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to delete');
    }
    showToast('Partner deleted successfully', 'success');
    await fetchPartners();
    renderPartners();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function testResendEmail() {
  const confirmed = await showConfirm({
    title: 'Test Email Connection',
    message: 'Send a test email using Resend to the Admin Email to verify configuration?',
    confirmText: 'Send Test',
    type: 'info'
  });

  if (!confirmed) return;
  try {
    const res = await fetch('/api/test-email', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.session.access_token}` }
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to send');
    }
    showToast('Test email sent successfully', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ── Boot ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  init();

  // Init sortable table column headers
  initSortableHeaders();

  // Set copyright year
  const yearEl = document.getElementById('copyright-year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // Mobile menu toggle
  const menuToggle = document.getElementById('mobile-menu-toggle');
  const sidebar = document.getElementById('sidebar');
  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', () => {
      sidebar.classList.toggle('mobile-show');
    });
  }

  // Modal handlers
  document.getElementById('partner-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-save-partner');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    try {
      const isEdit = !!document.getElementById('partner_id_edit').value;
      const url = isEdit ? `/api/partners/${document.getElementById('partner_id_edit').value}` : '/api/invitations';
      const method = isEdit ? 'PUT' : 'POST';

      const payload = {
        name: document.getElementById('partner_name').value,
        email: document.getElementById('partner_email').value,
        partner_id: document.getElementById('partner_tag').value,
        commission_rate: document.getElementById('partner_commission').value,
        discount_code: document.getElementById('partner_discount').value,
        company_name: document.getElementById('partner_company').value,
        phone: document.getElementById('partner_phone').value,
        country: document.getElementById('partner_country').value,
      };

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.session.access_token}`
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to save');
      }

      closeModal('partner-modal');
      await invalidateCache();

      if (isEdit) {
        showToast('Partner updated successfully', 'success');
      } else {
        showToast('Invitation sent successfully!', 'success');
      }
    } catch (err) {
      const errEl = document.getElementById('partner-modal-error');
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save';
    }
  });

  document.getElementById('password-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-save-password');
    btn.disabled = true;
    btn.textContent = 'Changing...';
    try {
      const currentPass = document.getElementById('current_password').value;
      const newPass = document.getElementById('new_password').value;
      const confPass = document.getElementById('confirm_password')?.value;

      // Final guard: confirm must match
      if (confPass !== undefined && newPass !== confPass) {
        throw new Error('New passwords do not match.');
      }
      if (newPass.length < 8) {
        throw new Error('Password must be at least 8 characters.');
      }

      await auth.changePassword(newPass, currentPass);

      // Cleanup forced reset UI modifications
      if (state.user) state.user.temp_password = null;
      const modal = document.getElementById('password-modal');
      const cancelBtn = modal.querySelector('.btn-secondary');
      if (cancelBtn) cancelBtn.style.display = '';
      const title = modal.querySelector('h3');
      if (title) title.textContent = 'Change Password';

      closeModal('password-modal');
      showToast('🔐 Password changed successfully!', 'success', 5000);

      // Audit notification
      if (typeof pushLocalNotification === 'function') {
        pushLocalNotification('Password Changed', 'Your password was updated successfully.', 'password');
      }
    } catch (err) {
      const errEl = document.getElementById('password-modal-error');
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Change Password';
      if (typeof checkPasswordMatch === 'function') checkPasswordMatch();
    }
  });
});

// ── Invitations ──────────────────────────────────────────
function renderInvitations() {
  const tbody = document.getElementById('invitations-tbody');
  if (!tbody || state.user?.role !== 'admin') return;

  if (state.invitations.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No pending invitations.</td></tr>';
    return;
  }

  tbody.innerHTML = state.invitations.map(inv => {
    const expires = new Date(inv.expires_at);
    const isExpired = expires < new Date();

    return `
      <tr class="${isExpired ? 'expired-row' : ''}">
        <td><div style="font-weight:600">${esc(inv.email)}</div></td>
        <td>${esc(inv.name)}</td>
        <td class="mono">${esc(inv.commission_rate)}</td>
        <td>
          <div style="font-size:12px">${expires.toLocaleDateString()}</div>
          <div style="font-size:10px; color:var(--text-muted)">${expires.toLocaleTimeString()}</div>
        </td>
        <td>
          <span class="status-badge ${inv.status}">
            ${inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
          </span>
        </td>
        <td class="table-actions">
          <button class="btn btn-secondary btn-sm" onclick="resendInvitation('${inv.id}')" title="Resend Invite">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </button>
          <button class="btn btn-secondary btn-sm" onclick="revokeInvitation('${inv.id}')" title="Revoke Invite" style="color:var(--red)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

async function resendInvitation(id) {
  const confirmed = await showConfirm({
    title: 'Resend Invitation',
    message: 'Resend this invitation? This will refresh the token and reset the expiry.',
    confirmText: 'Resend',
    type: 'info'
  });

  if (!confirmed) return;
  try {
    const res = await fetch(`/api/invitations/${id}/resend`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.session.access_token}` }
    });
    if (!res.ok) throw new Error('Failed to resend');
    showToast('Invitation resent successfully', 'success');
    await fetchPartners();
    renderInvitations();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function revokeInvitation(id) {
  const confirmed = await showConfirm({
    title: 'Revoke Invitation',
    message: 'Are you sure you want to revoke this invitation? The partner will no longer be able to use the link.',
    confirmText: 'Revoke',
    type: 'danger'
  });

  if (!confirmed) return;
  try {
    const res = await fetch(`/api/invitations/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${state.session.access_token}` }
    });
    if (!res.ok) throw new Error('Failed to revoke');
    showToast('Invitation revoked', 'info');
    await fetchPartners();
    renderInvitations();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openInvitationModal() {
  document.getElementById('modal-partner-title').textContent = 'Invite New Partner';
  document.getElementById('partner_id_edit').value = '';
  document.getElementById('partner-modal-error').style.display = 'none';
  const form = document.getElementById('partner-form');
  form.reset();

  // Enable fields that might be disabled from edit mode
  document.getElementById('partner_tag').disabled = false;
  document.getElementById('partner_email').disabled = false;

  document.getElementById('partner-modal').style.display = 'flex';
}
