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
  activityFilter: 'all',
  partnerSearch: '',
  refreshInterval: null,
  lastEventCount: 0,
};

// ── Page metadata ─────────────────────────────────────────
const pages = {
  dashboard: { title: 'Dashboard',  subtitle: 'Real-time referral partner overview' },
  partners:  { title: 'Partners',   subtitle: 'Manage your referral partner network' },
  activity:  { title: 'Activity',   subtitle: 'Full webhook event log' },
  system:    { title: 'System',     subtitle: 'Health, config, and audit logs' },
};

// ── Navigation ─────────────────────────────────────────────
function navigate(page) {
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
  document.getElementById('page-title').textContent = pages[page].title;
  document.getElementById('page-subtitle').textContent = pages[page].subtitle;

  // Trigger targeted refresh
  renderCurrentPage();
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
  btn.classList.add('spinning');

  await Promise.all([
    fetchStats(),
    fetchEvents(),
    fetchPartners(),
  ]);

  renderCurrentPage();
  btn.classList.remove('spinning');
  updateLastUpdated();
}

async function fetchStats() {
  const data = await fetchJSON('/api/stats');
  if (data) state.stats = data;
}

async function fetchEvents() {
  const data = await fetchJSON('/api/events?limit=100');
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

// ── Render Router ──────────────────────────────────────────
function renderCurrentPage() {
  switch (state.currentPage) {
    case 'dashboard': renderDashboard(); break;
    case 'partners':  renderPartners();  break;
    case 'activity':  renderActivity();  break;
    case 'system':    renderSystem();    break;
  }
}

// ── Render: Dashboard ──────────────────────────────────────
function renderDashboard() {
  updateStatCards();
  renderFeed('feed-dashboard', state.events.slice(0, 15));
  renderTopPartners();
}

function updateStatCards() {
  const s = state.stats;
  setStatValue('stat-sales',         s.totalSales        ?? 0);
  setStatValue('stat-commission',    s.totalCommission   ?? 'GHS 0.00');
  setStatValue('stat-tickets',       s.totalTickets      ?? 0);
  setStatValue('stat-cancellations', s.totalCancellations ?? 0);

  // Uptime
  if (s.uptime !== undefined) {
    document.getElementById('uptime-badge').textContent = `⏱ ${formatUptime(s.uptime)}`;
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
  // Sort by sales sessions events
  const top = [...state.partners]
    .filter(p => p.totalSales > 0)
    .sort((a, b) => b.totalSales - a.totalSales)
    .slice(0, 6);

  if (top.length === 0) {
    container.innerHTML = `
      <div class="feed-empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
        <p>No sales recorded yet this session</p>
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
      <div class="feed-empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        <p>Waiting for webhook events…</p>
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
      p.name.toLowerCase().includes(query) ||
      p.email.toLowerCase().includes(query) ||
      p.id.toLowerCase().includes(query)
    );
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="table-empty">${query ? 'No partners match your search.' : 'Loading partners…'}</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(p => `
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
      <td><span class="green-text">${esc(p.commissionRate)}</span></td>
      <td>${p.totalSales}</td>
      <td>${p.totalTickets}</td>
      <td><span class="green-text">${esc(p.totalCommission)}</span></td>
      <td>${p.lastSale ? `<span style="font-size:11px;color:var(--text-muted)">${timeAgo(p.lastSale)}</span>` : '<span style="color:var(--text-muted);font-size:11px">—</span>'}</td>
      <td>
        <span class="badge-status ${p.active ? 'badge-active' : 'badge-inactive'}">
          ${p.active ? '● Active' : '○ Inactive'}
        </span>
      </td>
      <td>
        <button class="copy-btn" onclick="copyLink('${esc(p.referralLink)}', this)" title="${esc(p.referralLink)}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          Copy Link
        </button>
      </td>
    </tr>
  `).join('');
}

// ── Render: Activity ───────────────────────────────────────
function renderActivity() {
  const filtered = state.activityFilter === 'all'
    ? state.events
    : state.events.filter(e => e.type === state.activityFilter);

  renderFeed('feed-activity', filtered);
}

// ── Render: System ─────────────────────────────────────────
async function renderSystem() {
  await Promise.all([fetchHealth(), fetchLogs()]);

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

  // Logs
  const logViewer = document.getElementById('log-viewer');
  if (state.logs.length === 0) {
    logViewer.innerHTML = `<code style="color:var(--text-muted)">No log entries yet — logs appear after the first webhook event.</code>`;
  } else {
    logViewer.innerHTML = state.logs.map(line => {
      const cls = line.includes('[ERROR]') ? 'error' : line.includes('[WARN]') ? 'warn' : 'info';
      return `<span class="log-line ${cls}">${esc(line)}</span>`;
    }).join('');
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

async function invalidateCache() {
  try {
    const res = await fetch('/api/cache/invalidate', { method: 'POST' });
    const data = await res.json();
    showToast(data.message || 'Cache invalidated', 'success');
    await fetchPartners();
    renderPartners();
  } catch {
    showToast('Failed to invalidate cache', 'error');
  }
}

// ── Badge Updates ──────────────────────────────────────────
function updateActivityBadge() {
  const el = document.getElementById('badge-activity');
  if (el) el.textContent = state.events.length;

  // Flash badge if new events arrived
  if (state.events.length > state.lastEventCount && state.lastEventCount > 0) {
    el.style.background = 'var(--green-glow)';
    el.style.color = 'var(--green)';
    setTimeout(() => {
      el.style.background = '';
      el.style.color = '';
    }, 2000);
  }
  state.lastEventCount = state.events.length;
}

function updatePartnerBadge() {
  const el = document.getElementById('badge-partners');
  if (el) el.textContent = state.partners.length;
}

// ── Utilities ──────────────────────────────────────────────
function esc(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function timeAgo(isoStr) {
  if (!isoStr) return '';
  const diff = Math.floor((Date.now() - new Date(isoStr)) / 1000);
  if (diff < 5)   return 'just now';
  if (diff < 60)  return `${diff}s ago`;
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

function showToast(msg, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast show ${type}`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// ── Auto-Refresh ───────────────────────────────────────────
function startAutoRefresh() {
  if (state.refreshInterval) clearInterval(state.refreshInterval);
  state.refreshInterval = setInterval(async () => {
    await fetchStats();
    await fetchEvents();
    await fetchPartners();
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
  
  // Sidebar visibility
  const pNav = document.getElementById('nav-partners');
  const sNav = document.getElementById('nav-system');
  if (pNav) pNav.style.display = isAdmin ? '' : 'none';
  if (sNav) sNav.style.display = isAdmin ? '' : 'none';
}

async function promptPasswordChange() {
  const newPass = prompt("Welcome! For security, please set a new password for your account:");
  if (newPass && newPass.length >= 6) {
    try {
      await auth.changePassword(newPass);
      showToast('Password updated successfully!', 'success');
      state.user.temp_password = null;
    } catch (err) {
      alert("Failed to update password: " + err.message);
      promptPasswordChange(); // Retry
    }
  } else {
    alert("Password must be at least 6 characters.");
    promptPasswordChange();
  }
}

// ── Boot ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
