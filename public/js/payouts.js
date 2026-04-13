'use strict';

/* ═══════════════════════════════════════════════════════════
   payouts.js — Payout & Partner Payment-Information Module
   Referral Hub — SunBolon SA
   ═══════════════════════════════════════════════════════════ */

// ── State ────────────────────────────────────────────────────
const payoutState = {
  myBalance: null,
  myPaymentMethod: null,
  myHistory: [],
  adminPayoutSummary: [],         // All partners payout summary
  adminTransactions: [],          // All payout transactions
  adminCurrentTab: 'overview',    // 'overview' | 'transactions' | 'audit'
  adminFilters: {
    partner_id: '',
    status: '',
  },
};

// ── API Helpers ──────────────────────────────────────────────
async function payoutFetch(url, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (window.state?.session?.access_token) {
    headers['Authorization'] = `Bearer ${window.state.session.access_token}`;
  }
  const res = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function payoutPost(url, body) {
  return payoutFetch(url, { method: 'POST', body: JSON.stringify(body) });
}

async function payoutPut(url, body) {
  return payoutFetch(url, { method: 'PUT', body: JSON.stringify(body) });
}

// ── Formatting ───────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function payoutBadgeHtml(status) {
  const labels = {
    pending: '⏳ Pending',
    approved: '✓ Approved',
    processing: '⚡ Processing',
    paid: '✅ Paid',
    cancelled: '✗ Cancelled',
  };
  return `<span class="payout-badge ${status}">${labels[status] || status}</span>`;
}

function methodLabel(type) {
  const m = { bank_transfer: '🏦 Bank Transfer', paypal: '💙 PayPal', mobile_money: '📱 Mobile Money', other: '💳 Other' };
  return m[type] || type;
}

// ══════════════════════════════════════════════════════════════
// PARTNER — EARNINGS PAGE
// ══════════════════════════════════════════════════════════════

async function initEarningsPage() {
  renderEarningsLoading();
  try {
    const [balance, history, pm] = await Promise.all([
      payoutFetch('/api/payouts/my-balance'),
      payoutFetch('/api/payouts/my-history'),
      payoutFetch('/api/payouts/my-payment-method').catch(() => null),
    ]);
    payoutState.myBalance = balance;
    payoutState.myHistory = history;
    payoutState.myPaymentMethod = pm;
    renderEarningsBalanceCards(balance);
    renderEarningsWarnings(balance, pm);
    renderPayoutHistoryTable('earnings-history-tbody', history);
    renderPaymentMethodSummary('earnings-pm-section', pm);
  } catch (err) {
    showToast('Failed to load earnings: ' + err.message, 'error');
  }
}

function renderEarningsLoading() {
  const cards = document.getElementById('earnings-balance-cards');
  if (cards) cards.innerHTML = '<div style="color:var(--text-muted);padding:20px">Loading balances…</div>';
}

function renderEarningsBalanceCards(balance) {
  const container = document.getElementById('earnings-balance-cards');
  if (!container || !balance) return;

  container.innerHTML = `
    <div class="balance-card earned">
      <div class="balance-card-icon">💰</div>
      <div class="balance-card-label">Total Earned</div>
      <div class="balance-card-value">${fmtChf(balance.totalEarned)}</div>
      <div class="balance-card-sub">All-time gross commission</div>
    </div>
    <div class="balance-card pending">
      <div class="balance-card-icon">⏳</div>
      <div class="balance-card-label">Pending Approval</div>
      <div class="balance-card-value">${fmtChf(balance.pendingAmount)}</div>
      <div class="balance-card-sub">Awaiting admin review</div>
    </div>
    <div class="balance-card available">
      <div class="balance-card-icon">💎</div>
      <div class="balance-card-label">Available Balance</div>
      <div class="balance-card-value">${fmtChf(balance.availableAmount)}</div>
      <div class="balance-card-sub">Ready for payout</div>
    </div>
    <div class="balance-card paid">
      <div class="balance-card-icon">✅</div>
      <div class="balance-card-label">Total Paid</div>
      <div class="balance-card-value">${fmtChf(balance.paidAmount)}</div>
      <div class="balance-card-sub">Already received</div>
    </div>
  `;
  if (balance.processingAmount > 0) {
    container.insertAdjacentHTML('beforeend', `
      <div class="balance-card processing">
        <div class="balance-card-icon">⚡</div>
        <div class="balance-card-label">Processing</div>
        <div class="balance-card-value">${fmtChf(balance.processingAmount)}</div>
        <div class="balance-card-sub">Payment in transit</div>
      </div>
    `);
  }
}

function fmtChf(amount) {
  const n = Number(amount || 0);
  return `CHF ${n.toFixed(2)}`;
}

function renderEarningsWarnings(balance, pm) {
  const container = document.getElementById('earnings-warnings');
  if (!container) return;
  container.innerHTML = '';

  if (balance?.availableAmount > 0 && !pm) {
    container.innerHTML = `
      <div class="payout-warning-banner">
        <div class="warn-icon">⚠️</div>
        <div class="warn-body">
          <div class="warn-title">Payment Details Missing</div>
          <div class="warn-text">You have <strong>${fmtChf(balance.availableAmount)}</strong> available for payout, but you haven't saved your payment information yet. Add your payment details so we can process your payout.</div>
          <button class="warn-action" onclick="navigate('payout-settings')">➕ Add Payment Details</button>
        </div>
      </div>`;
  } else if (balance?.processingAmount > 0) {
    container.innerHTML = `
      <div class="payment-saved-banner">
        <div class="ps-icon">⚡</div>
        <div class="ps-body">
          <div class="ps-title">Payout In Progress</div>
          <div class="ps-text">${fmtChf(balance.processingAmount)} is currently being processed. You'll receive an email confirmation when it's sent.</div>
        </div>
      </div>`;
  }
}

function renderPaymentMethodSummary(containerId, pm) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!pm) {
    container.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;padding:16px;background:var(--surface-2);border-radius:var(--radius);border:1px dashed var(--border);">
        <span style="font-size:20px;">💳</span>
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--text-secondary)">No payment method saved</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">Add your payment details in Payout Settings</div>
        </div>
        <button class="btn btn-secondary btn-sm" style="margin-left:auto" onclick="navigate('payout-settings')">Add Now</button>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="payment-saved-banner">
      <div class="ps-icon">✅</div>
      <div class="ps-body">
        <div class="ps-title">${methodLabel(pm.payment_method_type)}</div>
        <div class="ps-text">
          ${pm.account_holder_name ? `${pm.account_holder_name} · ` : ''}
          ${pm.bank_name ? `${pm.bank_name} · ` : ''}
          ${pm.account_number_iban ? `IBAN: ${maskIban(pm.account_number_iban)}` : ''}
          ${pm.paypal_email ? `PayPal: ${pm.paypal_email}` : ''}
          ${pm.mobile_money_number ? `📱 ${pm.mobile_money_number}` : ''}
          · Updated ${fmtDate(pm.updated_at)}
        </div>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="navigate('payout-settings')">Edit</button>
    </div>`;
}

function maskIban(iban) {
  if (!iban || iban.length < 8) return iban;
  return iban.slice(0, 4) + '••••' + iban.slice(-4);
}

function renderPayoutHistoryTable(tbodyId, history) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;

  if (!history || history.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="table-empty">No payout transactions yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = history.map(tx => `
    <tr>
      <td><span class="tx-amount">${fmtChf(tx.amount)}</span></td>
      <td>${payoutBadgeHtml(tx.payout_status)}</td>
      <td><span class="tx-ref">${esc(tx.payment_reference || '—')}</span></td>
      <td style="font-size:12px;color:var(--text-muted)">${fmtDate(tx.payout_date || tx.created_at)}</td>
      <td style="font-size:12px;color:var(--text-muted);max-width:200px;overflow:hidden;text-overflow:ellipsis">${esc(tx.admin_note || '—')}</td>
    </tr>
  `).join('');
}

// ══════════════════════════════════════════════════════════════
// PARTNER — PAYOUT SETTINGS PAGE
// ══════════════════════════════════════════════════════════════

async function initPayoutSettingsPage() {
  try {
    const pm = await payoutFetch('/api/payouts/my-payment-method').catch(() => null);
    payoutState.myPaymentMethod = pm;
    renderPayoutSettingsCurrentMethod(pm);
    initMethodTabs('bank_transfer');
    if (pm) {
      // Pre-fill form with existing data
      prefillPaymentForm(pm);
    }
  } catch (err) {
    showToast('Failed to load payment settings: ' + err.message, 'error');
  }
}

function renderPayoutSettingsCurrentMethod(pm) {
  const section = document.getElementById('current-payment-method-display');
  if (!section) return;

  if (!pm) {
    section.innerHTML = `
      <div style="padding:16px 0;color:var(--text-muted);font-size:13px;">
        You haven't added a payment method yet. Fill in the form below to save your details.
      </div>`;
    return;
  }

  section.innerHTML = `
    <div class="payment-info-card" style="margin-top:0">
      <div class="pim-header">
        <div class="pim-title">💳 Current Payment Method — ${methodLabel(pm.payment_method_type)}</div>
        <span style="font-size:11px;color:var(--text-muted)">Updated ${fmtDate(pm.updated_at)}</span>
      </div>
      <div class="payment-info-grid">
        ${pm.account_holder_name ? `<div class="payment-info-field"><label>Account Holder</label><div class="pif-value">${esc(pm.account_holder_name)}</div></div>` : ''}
        ${pm.bank_name ? `<div class="payment-info-field"><label>Bank</label><div class="pif-value">${esc(pm.bank_name)}</div></div>` : ''}
        ${pm.account_number_iban ? `<div class="payment-info-field"><label>IBAN / Account</label><div class="pif-value mono">${maskIban(pm.account_number_iban)}</div></div>` : ''}
        ${pm.swift_bic ? `<div class="payment-info-field"><label>SWIFT/BIC</label><div class="pif-value mono">${esc(pm.swift_bic)}</div></div>` : ''}
        ${pm.paypal_email ? `<div class="payment-info-field"><label>PayPal Email</label><div class="pif-value">${esc(pm.paypal_email)}</div></div>` : ''}
        ${pm.mobile_money_number ? `<div class="payment-info-field"><label>Mobile Number</label><div class="pif-value mono">${esc(pm.mobile_money_number)}</div></div>` : ''}
        ${pm.country ? `<div class="payment-info-field"><label>Country</label><div class="pif-value">${esc(pm.country)}</div></div>` : ''}
        ${pm.payment_notes ? `<div class="payment-info-field" style="grid-column:1/-1"><label>Notes</label><div class="pif-value">${esc(pm.payment_notes)}</div></div>` : ''}
      </div>
    </div>`;
}

function initMethodTabs(defaultTab) {
  const tabs = document.querySelectorAll('#payout-settings-form .method-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('#payout-settings-form .method-fields').forEach(f => f.classList.remove('active'));
      const targetFields = document.getElementById(`fields-${tab.dataset.method}`);
      if (targetFields) targetFields.classList.add('active');
    });
  });
  // Activate default
  const defaultTabEl = document.querySelector(`#payout-settings-form .method-tab[data-method="${defaultTab}"]`);
  if (defaultTabEl) defaultTabEl.click();
}

function prefillPaymentForm(pm) {
  // Select the correct tab
  const tabEl = document.querySelector(`#payout-settings-form .method-tab[data-method="${pm.payment_method_type}"]`);
  if (tabEl) tabEl.click();

  // Fill fields
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  setVal('pm-account-holder', pm.account_holder_name);
  setVal('pm-bank-name', pm.bank_name);
  setVal('pm-account-iban', pm.account_number_iban);
  setVal('pm-swift-bic', pm.swift_bic);
  setVal('pm-paypal-email', pm.paypal_email);
  setVal('pm-mobile-number', pm.mobile_money_number);
  setVal('pm-country', pm.country);
  setVal('pm-payment-notes', pm.payment_notes);
}

async function savePaymentMethod() {
  const btn = document.getElementById('btn-save-payment-method');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  try {
    const activeTab = document.querySelector('#payout-settings-form .method-tab.active');
    if (!activeTab) throw new Error('Please select a payment method type');
    const methodType = activeTab.dataset.method;

    const getVal = id => (document.getElementById(id)?.value || '').trim();

    const payload = {
      payment_method_type: methodType,
      account_holder_name: getVal('pm-account-holder'),
      bank_name: getVal('pm-bank-name'),
      account_number_iban: getVal('pm-account-iban'),
      swift_bic: getVal('pm-swift-bic'),
      paypal_email: getVal('pm-paypal-email'),
      mobile_money_number: getVal('pm-mobile-number'),
      country: getVal('pm-country'),
      payment_notes: getVal('pm-payment-notes'),
    };

    // Client-side validation
    if (methodType === 'bank_transfer' && !payload.account_number_iban) {
      throw new Error('Bank transfer requires an IBAN or account number');
    }
    if (methodType === 'paypal' && !payload.paypal_email) {
      throw new Error('PayPal requires an email address');
    }
    if (methodType === 'mobile_money' && !payload.mobile_money_number) {
      throw new Error('Mobile money requires a phone number');
    }
    if (methodType !== 'other' && !payload.account_holder_name) {
      throw new Error('Account holder name is required');
    }

    await payoutPost('/api/payouts/my-payment-method', payload);
    payoutState.myPaymentMethod = payload;
    showToast('✅ Payment method saved successfully!', 'success');
    // Refresh the current method display
    const pm = await payoutFetch('/api/payouts/my-payment-method').catch(() => null);
    renderPayoutSettingsCurrentMethod(pm);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save Payment Details'; }
  }
}
window.savePaymentMethod = savePaymentMethod;

// ══════════════════════════════════════════════════════════════
// ADMIN — PAYOUTS MANAGEMENT PAGE
// ══════════════════════════════════════════════════════════════

async function initPayoutsPage() {
  renderPayoutsLoading();
  try {
    await refreshPayoutsData();
    populatePayoutsPartnerFilter();
    renderPayoutsOverview();
    initPayoutsTabNavigation();
  } catch (err) {
    showToast('Failed to load payout data: ' + err.message, 'error');
  }
}
window.initPayoutsPage = initPayoutsPage;

function populatePayoutsPartnerFilter() {
  const select = document.getElementById('payouts-filter-partner');
  if (!select) return;
  const currentVal = select.value;
  select.innerHTML = `<option value="">All Partners</option>` +
    payoutState.adminPayoutSummary.map(p =>
      `<option value="${esc(p.partnerId)}">${esc(p.partnerName)}</option>`
    ).join('');
  select.value = currentVal || '';
}

async function refreshPayoutsData() {
  const [summary, transactions] = await Promise.all([
    payoutFetch('/api/payouts/all'),
    payoutFetch('/api/payouts/transactions'),
  ]);
  payoutState.adminPayoutSummary = summary;
  payoutState.adminTransactions = transactions;
}

function renderPayoutsLoading() {
  const el = document.getElementById('payouts-table-body');
  if (el) el.innerHTML = `<tr><td colspan="9" class="table-empty">Loading payout data…</td></tr>`;
}

function initPayoutsTabNavigation() {
  document.querySelectorAll('#page-payouts .payout-page-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#page-payouts .payout-page-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('#page-payouts .payout-tab-content').forEach(c => c.classList.remove('active'));
      const content = document.getElementById(`payout-tab-${tab.dataset.tab}`);
      if (content) content.classList.add('active');
      payoutState.adminCurrentTab = tab.dataset.tab;
      if (tab.dataset.tab === 'transactions') renderTransactionsTable();
      if (tab.dataset.tab === 'audit') renderAuditLogTable();
    });
  });

  // Activate overview by default
  const overviewTab = document.querySelector('#page-payouts .payout-page-tab[data-tab="overview"]');
  if (overviewTab) overviewTab.click();
}

// ── Admin Overview Tab ───────────────────────────────────────

function renderPayoutsOverview() {
  const summary = payoutState.adminPayoutSummary;

  // Summary metrics
  const totalPending = summary.reduce((s, p) => s + p.pendingAmount, 0);
  const totalAvailable = summary.reduce((s, p) => s + p.availableAmount, 0);
  const totalPaid = summary.reduce((s, p) => s + p.paidAmount, 0);
  const needsAttentionCount = summary.filter(p => p.needsAttention).length;

  const metricsEl = document.getElementById('payouts-summary-metrics');
  if (metricsEl) {
    metricsEl.innerHTML = `
      <div class="balance-card pending" style="cursor:default">
        <div class="balance-card-icon">⏳</div>
        <div class="balance-card-label">Total Pending</div>
        <div class="balance-card-value">${fmtChf(totalPending)}</div>
        <div class="balance-card-sub">Across all partners</div>
      </div>
      <div class="balance-card available" style="cursor:default">
        <div class="balance-card-icon">💎</div>
        <div class="balance-card-label">Total Available</div>
        <div class="balance-card-value">${fmtChf(totalAvailable)}</div>
        <div class="balance-card-sub">Ready to pay out</div>
      </div>
      <div class="balance-card paid" style="cursor:default">
        <div class="balance-card-icon">✅</div>
        <div class="balance-card-label">Total Paid</div>
        <div class="balance-card-value">${fmtChf(totalPaid)}</div>
        <div class="balance-card-sub">All-time paid out</div>
      </div>
      ${needsAttentionCount > 0 ? `
      <div class="balance-card" style="cursor:default;border-color:rgba(245,158,11,0.4)">
        <div class="balance-card-icon" style="background:var(--gold-glow);font-size:18px">⚠️</div>
        <div class="balance-card-label">Needs Attention</div>
        <div class="balance-card-value" style="color:var(--gold);font-size:28px">${needsAttentionCount}</div>
        <div class="balance-card-sub">Partners with balance but no payment method</div>
      </div>` : ''}
    `;
  }

  renderPayoutsTable();
}

function renderPayoutsTable() {
  const tbody = document.getElementById('payouts-table-body');
  if (!tbody) return;

  let data = [...payoutState.adminPayoutSummary];

  // Apply filters
  const filterPartner = payoutState.adminFilters.partner_id;
  const filterStatus = payoutState.adminFilters.status;
  if (filterPartner) data = data.filter(p => p.partnerId === filterPartner);
  if (filterStatus === 'has-balance') data = data.filter(p => p.availableAmount > 0);
  if (filterStatus === 'no-method') data = data.filter(p => !p.hasPaymentMethod);
  if (filterStatus === 'needs-attention') data = data.filter(p => p.needsAttention);

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="table-empty">No partners match your filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(p => `
    <tr class="${p.needsAttention ? 'partner-payout-row' : ''}">
      <td>
        <div class="partner-cell">
          <div class="partner-cell-avatar">${initials(p.partnerName)}</div>
          <div>
            <div class="partner-cell-name">${esc(p.partnerName)}</div>
            <div class="partner-cell-email">${esc(p.partnerEmail)}</div>
            ${p.needsAttention ? '<span class="attention-tag">⚠️ Needs Info</span>' : ''}
          </div>
        </div>
      </td>
      <td><span class="mono">${esc(p.partnerId)}</span></td>
      <td><span style="color:var(--green);font-family:'JetBrains Mono',monospace;font-weight:600">${fmtChf(p.totalEarned)}</span></td>
      <td><span style="color:var(--gold);font-family:'JetBrains Mono',monospace">${fmtChf(p.pendingAmount)}</span></td>
      <td><span style="color:var(--blue);font-family:'JetBrains Mono',monospace;font-weight:700">${fmtChf(p.availableAmount)}</span></td>
      <td><span style="color:#a78bfa;font-family:'JetBrains Mono',monospace">${fmtChf(p.paidAmount)}</span></td>
      <td>
        ${p.hasPaymentMethod
      ? `<span class="payout-badge approved">${methodLabel(p.paymentMethodType)}</span>`
      : `<span class="payout-badge no-method">Not Set</span>`}
      </td>
      <td style="font-size:11px;color:var(--text-muted)">${p.paymentMethodUpdatedAt ? fmtDate(p.paymentMethodUpdatedAt) : '—'}</td>
      <td class="table-actions-cell">
        ${p.pendingAmount > 0 ? `
        <button class="action-icon-btn" onclick="adminApproveCommission('${p.partnerId}')" title="Approve pending commission">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        </button>` : ''}
        ${p.availableAmount > 0 && p.hasPaymentMethod ? `
        <button class="action-icon-btn" onclick="openPayoutTransactionModal('${p.partnerId}', ${p.availableAmount})" title="Create payout">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        </button>` : ''}
        <button class="action-icon-btn" onclick="adminViewPaymentInfo('${p.partnerId}')" title="View payment info">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
        <button class="action-icon-btn" onclick="filterPayoutsToPartner('${p.partnerId}')" title="View this partner's transactions">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        </button>
      </td>
    </tr>
  `).join('');
}

// Apply partner filter
function applyPayoutsFilter() {
  payoutState.adminFilters.partner_id = document.getElementById('payouts-filter-partner')?.value || '';
  payoutState.adminFilters.status = document.getElementById('payouts-filter-status')?.value || '';
  if (payoutState.adminCurrentTab === 'overview') {
    renderPayoutsTable();
  } else if (payoutState.adminCurrentTab === 'transactions') {
    renderTransactionsTable();
  }
}
window.applyPayoutsFilter = applyPayoutsFilter;

function filterPayoutsToPartner(partnerId) {
  const partnerFilter = document.getElementById('payouts-filter-partner');
  if (partnerFilter) partnerFilter.value = partnerId;
  payoutState.adminFilters.partner_id = partnerId;
  // Switch to transactions tab
  const txTab = document.querySelector('#page-payouts .payout-page-tab[data-tab="transactions"]');
  if (txTab) txTab.click();
}
window.filterPayoutsToPartner = filterPayoutsToPartner;

// ── Admin: Approve Commission ────────────────────────────────
async function adminApproveCommission(partnerId) {
  const confirmed = await showConfirm({
    title: 'Approve Commission',
    message: `Approve all pending commission for this partner? This will move their balance to "Available" and notify them via email.`,
    confirmText: 'Approve',
    type: 'info',
  });
  if (!confirmed) return;

  try {
    const result = await payoutPost('/api/payouts/approve-commission', { partner_id: partnerId });
    showToast(`Commission approved! Available: ${result.balance?.availableFmt}`, 'success');
    await refreshPayoutsData();
    renderPayoutsOverview();
  } catch (err) {
    showToast('Failed to approve commission: ' + err.message, 'error');
  }
}
window.adminApproveCommission = adminApproveCommission;

// ── Admin: View Partner Payment Info ─────────────────────────
async function adminViewPaymentInfo(partnerId) {
  try {
    const pm = await payoutFetch(`/api/payouts/partner/${partnerId}/payment-method`);
    const partner = payoutState.adminPayoutSummary.find(p => p.partnerId === partnerId);

    const modal = document.getElementById('payment-info-modal');
    const body = document.getElementById('payment-info-modal-body');
    if (!modal || !body) return;

    const partnerName = partner?.partnerName || partnerId;

    if (!pm) {
      body.innerHTML = `
        <div style="text-align:center;padding:32px;color:var(--text-muted)">
          <div style="font-size:40px;margin-bottom:12px">💳</div>
          <div style="font-size:15px;font-weight:600;margin-bottom:8px">${esc(partnerName)}</div>
          <div>This partner hasn't saved their payment information yet.</div>
        </div>`;
    } else {
      body.innerHTML = `
        <div style="padding:4px 0 16px">
          <div style="font-size:14px;font-weight:700;margin-bottom:4px">${esc(partnerName)}</div>
          <span class="payout-badge approved">${methodLabel(pm.payment_method_type)}</span>
        </div>
        <div class="payment-info-grid">
          ${pm.account_holder_name ? `<div class="payment-info-field"><label>Account Holder</label><div class="pif-value">${esc(pm.account_holder_name)}</div></div>` : ''}
          ${pm.bank_name ? `<div class="payment-info-field"><label>Bank Name</label><div class="pif-value">${esc(pm.bank_name)}</div></div>` : ''}
          ${pm.account_number_iban ? `<div class="payment-info-field"><label>IBAN / Account Number</label><div class="pif-value mono">${esc(pm.account_number_iban)}</div></div>` : ''}
          ${pm.swift_bic ? `<div class="payment-info-field"><label>SWIFT / BIC</label><div class="pif-value mono">${esc(pm.swift_bic)}</div></div>` : ''}
          ${pm.paypal_email ? `<div class="payment-info-field"><label>PayPal Email</label><div class="pif-value">${esc(pm.paypal_email)}</div></div>` : ''}
          ${pm.mobile_money_number ? `<div class="payment-info-field"><label>Mobile Number</label><div class="pif-value mono">${esc(pm.mobile_money_number)}</div></div>` : ''}
          ${pm.country ? `<div class="payment-info-field"><label>Country</label><div class="pif-value">${esc(pm.country)}</div></div>` : ''}
          <div class="payment-info-field"><label>Last Updated</label><div class="pif-value">${fmtDateTime(pm.updated_at)}</div></div>
          ${pm.payment_notes ? `<div class="payment-info-field" style="grid-column:1/-1"><label>Notes</label><div class="pif-value">${esc(pm.payment_notes)}</div></div>` : ''}
        </div>`;
    }

    modal.style.display = 'flex';
  } catch (err) {
    showToast('Failed to load payment info: ' + err.message, 'error');
  }
}
window.adminViewPaymentInfo = adminViewPaymentInfo;

// ── Admin: Create Payout Transaction Modal ───────────────────
function openPayoutTransactionModal(partnerId, availableAmount) {
  const modal = document.getElementById('payout-transaction-modal');
  if (!modal) return;

  const partner = payoutState.adminPayoutSummary.find(p => p.partnerId === partnerId);
  document.getElementById('ptt-partner-id').value = partnerId;
  document.getElementById('ptt-partner-name').textContent = partner?.partnerName || partnerId;
  document.getElementById('ptt-available').textContent = fmtChf(availableAmount);
  document.getElementById('ptt-amount').value = availableAmount.toFixed(2);
  document.getElementById('ptt-amount').max = availableAmount.toFixed(2);
  document.getElementById('ptt-reference').value = '';
  document.getElementById('ptt-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('ptt-note').value = '';
  document.getElementById('ptt-error').style.display = 'none';

  modal.style.display = 'flex';
}
window.openPayoutTransactionModal = openPayoutTransactionModal;

async function savePayoutTransaction() {
  const btn = document.getElementById('btn-save-payout-tx');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }
  const errEl = document.getElementById('ptt-error');

  try {
    const partner_id = document.getElementById('ptt-partner-id').value;
    const amount = parseFloat(document.getElementById('ptt-amount').value);
    const payment_reference = document.getElementById('ptt-reference').value.trim();
    const payout_date = document.getElementById('ptt-date').value;
    const admin_note = document.getElementById('ptt-note').value.trim();

    if (!partner_id) throw new Error('Partner is required');
    if (!amount || amount <= 0) throw new Error('Valid positive amount is required');

    await payoutPost('/api/payouts/transactions', { partner_id, amount, payment_reference, payout_date, admin_note });

    closeModal('payout-transaction-modal');
    showToast('Payout created successfully!', 'success');
    await refreshPayoutsData();
    renderPayoutsOverview();
    if (payoutState.adminCurrentTab === 'transactions') renderTransactionsTable();
  } catch (err) {
    if (errEl) { errEl.textContent = err.message; errEl.style.display = 'block'; }
    showToast(err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Create Payout'; }
  }
}
window.savePayoutTransaction = savePayoutTransaction;

// ── Admin: Transactions Tab ──────────────────────────────────
function renderTransactionsTable() {
  const tbody = document.getElementById('transactions-table-body');
  if (!tbody) return;

  let data = [...payoutState.adminTransactions];
  const filterPartner = payoutState.adminFilters.partner_id;
  if (filterPartner) data = data.filter(tx => tx.partner_id === filterPartner);

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-empty">No payout transactions found.</td></tr>`;
    return;
  }

  // Enrich with partner names
  const partnerMap = {};
  payoutState.adminPayoutSummary.forEach(p => { partnerMap[p.partnerId] = p.partnerName; });

  tbody.innerHTML = data.map(tx => `
    <tr>
      <td style="font-size:11px;color:var(--text-muted);font-family:'JetBrains Mono',monospace">${tx.id.slice(0, 8)}…</td>
      <td>
        <div style="font-size:13px;font-weight:600">${esc(partnerMap[tx.partner_id] || tx.partner_id)}</div>
        <div style="font-size:11px;color:var(--text-muted);font-family:'JetBrains Mono',monospace">${esc(tx.partner_id)}</div>
      </td>
      <td><span class="tx-amount">${fmtChf(tx.amount)}</span></td>
      <td>${payoutBadgeHtml(tx.payout_status)}</td>
      <td><span class="tx-ref">${esc(tx.payment_reference || '—')}</span></td>
      <td style="font-size:12px;color:var(--text-muted)">${fmtDate(tx.payout_date)}</td>
      <td style="font-size:11px;color:var(--text-muted);max-width:150px">${esc(tx.admin_note || '—')}</td>
      <td class="table-actions-cell">
        ${tx.payout_status === 'pending' ? `
        <button class="action-icon-btn" onclick="updateTransactionStatus('${tx.id}', 'processing')" title="Mark as Processing">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
        </button>` : ''}
        ${tx.payout_status === 'processing' ? `
        <button class="action-icon-btn" onclick="openMarkPaidModal('${tx.id}', ${tx.amount})" title="Mark as Paid">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        </button>` : ''}
        ${tx.payout_status !== 'cancelled' && tx.payout_status !== 'paid' ? `
        <button class="action-icon-btn" onclick="updateTransactionStatus('${tx.id}', 'cancelled')" title="Cancel Payout">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>` : ''}
      </td>
    </tr>
  `).join('');
}

async function updateTransactionStatus(txId, newStatus) {
  const labels = { processing: 'mark as Processing', cancelled: 'cancel', paid: 'mark as Paid' };
  const confirmed = await showConfirm({
    title: 'Update Payout Status',
    message: `Are you sure you want to ${labels[newStatus] || newStatus} this payout transaction?`,
    confirmText: 'Confirm',
    type: newStatus === 'cancelled' ? 'danger' : 'info',
  });
  if (!confirmed) return;

  try {
    await payoutPut(`/api/payouts/transactions/${txId}`, { payout_status: newStatus });
    showToast(`Payout ${newStatus}`, 'success');
    await refreshPayoutsData();
    renderTransactionsTable();
    renderPayoutsOverview();
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.updateTransactionStatus = updateTransactionStatus;

function openMarkPaidModal(txId, amount) {
  const modal = document.getElementById('mark-paid-modal');
  if (!modal) return;
  document.getElementById('mpm-tx-id').value = txId;
  document.getElementById('mpm-amount').textContent = fmtChf(amount);
  document.getElementById('mpm-reference').value = '';
  document.getElementById('mpm-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('mpm-error').style.display = 'none';
  modal.style.display = 'flex';
}
window.openMarkPaidModal = openMarkPaidModal;

async function confirmMarkPaid() {
  const btn = document.getElementById('btn-confirm-paid');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  const errEl = document.getElementById('mpm-error');

  try {
    const txId = document.getElementById('mpm-tx-id').value;
    const payment_reference = document.getElementById('mpm-reference').value.trim();
    const payout_date = document.getElementById('mpm-date').value;

    if (!payment_reference) throw new Error('Please enter a payment reference number');

    await payoutPut(`/api/payouts/transactions/${txId}`, {
      payout_status: 'paid',
      payment_reference,
      payout_date,
    });

    closeModal('mark-paid-modal');
    showToast('✅ Payout marked as paid!', 'success');
    await refreshPayoutsData();
    renderTransactionsTable();
    renderPayoutsOverview();
  } catch (err) {
    if (errEl) { errEl.textContent = err.message; errEl.style.display = 'block'; }
    showToast(err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Mark as Paid'; }
  }
}
window.confirmMarkPaid = confirmMarkPaid;

// ── Admin: Audit Log Tab ─────────────────────────────────────
async function renderAuditLogTable() {
  const tbody = document.getElementById('audit-log-table-body');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="5" class="table-empty">Loading…</td></tr>`;

  try {
    const data = await payoutFetch('/api/payouts/audit-log');

    if (data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="table-empty">No audit log entries yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.map(log => `
      <tr>
        <td style="font-size:11px;color:var(--text-muted);white-space:nowrap">${fmtDateTime(log.created_at)}</td>
        <td><span class="mono">${esc(log.partner_id)}</span></td>
        <td><span class="badge-status badge-active" style="font-size:10px">${esc(log.actor_role || 'system')}</span></td>
        <td><span class="payout-badge ${log.event_type.includes('paid') ? 'paid' : log.event_type.includes('approv') ? 'approved' : 'pending'}" style="font-size:10px">${esc(log.event_type)}</span></td>
        <td style="font-size:12px;color:var(--text-secondary)">${esc(log.description || '—')}</td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="table-empty" style="color:var(--red)">Error loading logs: ${esc(err.message)}</td></tr>`;
  }
}

// Export CSV
async function exportPayoutsCSV() {
  try {
    const params = new URLSearchParams();
    if (payoutState.adminFilters.partner_id) params.set('partner_id', payoutState.adminFilters.partner_id);
    const token = window.state?.session?.access_token || '';
    const url = `/api/payouts/export?${params}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Export failed: HTTP ${res.status}`);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `payouts-export-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('Payout export downloaded!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.exportPayoutsCSV = exportPayoutsCSV;

async function refreshPayoutsPage() {
  try {
    await refreshPayoutsData();
    renderPayoutsOverview();
    if (payoutState.adminCurrentTab === 'transactions') renderTransactionsTable();
    showToast('Payout data refreshed', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.refreshPayoutsPage = refreshPayoutsPage;

// Expose for app.js routing
window.initEarningsPage = initEarningsPage;
window.initPayoutSettingsPage = initPayoutSettingsPage;
