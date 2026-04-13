'use strict';

/* ═══════════════════════════════════════════════════════════
   Referral Hub — Reports Module
   All report generation, filtering, export, and preset logic
   ═══════════════════════════════════════════════════════════ */

const REPORTS = {
  data: null,  // { events: [], partners: [] }
  tableData: [],  // Current rendered rows (for export)
  tableHeaders: [], // Current column headers
};

const PRESET_KEY = 'referralHub_presets';

// ── Fetch Report Data ──────────────────────────────────────
async function fetchReportData() {
  if (!state?.session?.access_token) return { events: [], partners: [] };
  try {
    const res = await fetch('/api/reports', {
      headers: { Authorization: `Bearer ${state.session.access_token}` }
    });
    if (!res.ok) return { events: [], partners: [], error: `HTTP ${res.status}` };
    return res.json();
  } catch (err) {
    return { events: [], partners: [], error: err.message };
  }
}

// ── Initialize Reports Page ────────────────────────────────
async function initReports() {
  document.getElementById('report-tbody').innerHTML =
    '<tr><td colspan="10" class="table-empty">Loading report data…</td></tr>';

  REPORTS.data = await fetchReportData();

  if (!REPORTS.data || REPORTS.data.error) {
    const msg = REPORTS.data?.error || 'Network error — is the server running?';
    document.getElementById('report-tbody').innerHTML =
      `<tr><td colspan="10" class="table-empty" style="color:var(--red)">⚠️ ${msg}<br><br><button class="btn btn-secondary" onclick="refreshReports()">Retry</button></td></tr>`;
    if (REPORTS.data?.error) showToast(msg, 'error', 5000);
    return;
  }

  // Populate partner dropdown
  const sel = document.getElementById('report-partner');
  // Clear existing options except first
  while (sel.options.length > 1) sel.remove(1);
  REPORTS.data.partners.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} (${p.id})`;
    sel.appendChild(opt);
  });

  loadPresetChips();
  renderReport();
}

function refreshReports() {
  REPORTS.data = null; // clear cache to force re-fetch
  initReports();
}

// ── Get Filtered Events ────────────────────────────────────
function getFilteredEvents() {
  if (!REPORTS.data) return [];
  let events = REPORTS.data.events.filter(e => e.eventType === 'sale');

  const partner = document.getElementById('report-partner')?.value;
  const from = document.getElementById('report-date-from')?.value;
  const to = document.getElementById('report-date-to')?.value;

  if (partner) events = events.filter(e => e.referralTag === partner);
  if (from) events = events.filter(e => e.occurredAt >= from);
  if (to) events = events.filter(e => e.occurredAt <= to + 'T23:59:59');

  return events;
}

// ── Format currency ────────────────────────────────────────
function fmtCHF(val) {
  return 'CHF ' + Number(val || 0).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Summary Cards ──────────────────────────────────────────
function renderSummaryCards(events) {
  const totalRevenue = events.reduce((s, e) => s + e.orderTotalRaw, 0) / 100;
  const totalCommission = events.reduce((s, e) => s + e.commissionRaw, 0) / 100;
  const totalTickets = events.reduce((s, e) => s + e.ticketCount, 0);
  const uniquePartners = new Set(events.map(e => e.referralTag)).size;

  const cards = [
    { label: 'Total Sales', value: events.length, icon: '📦', color: 'green' },
    { label: 'Total Revenue', value: fmtCHF(totalRevenue), icon: '💰', color: 'blue' },
    { label: 'Total Commission', value: fmtCHF(totalCommission), icon: '💵', color: 'gold' },
    { label: 'Tickets Sold', value: totalTickets, icon: '🎟', color: 'blue' },
    { label: 'Active Partners', value: uniquePartners, icon: '👥', color: 'green' },
  ];

  document.getElementById('report-summary-cards').innerHTML = cards.map(c => `
    <div class="stat-card">
      <div class="stat-icon ${c.color}" style="font-size:18px;">${c.icon}</div>
      <div class="stat-body">
        <div class="stat-value" style="font-size:20px;">${esc(String(c.value))}</div>
        <div class="stat-label">${c.label}</div>
      </div>
    </div>`).join('');
}

// ── Main Render Dispatcher ─────────────────────────────────
function renderReport() {
  if (!REPORTS.data) return;
  const type = document.getElementById('report-type')?.value || 'partner';
  const events = getFilteredEvents();

  // Show/hide rank-sort only for rankings
  const rankGroup = document.getElementById('rank-sort-group');
  if (rankGroup) rankGroup.style.display = type === 'rankings' ? '' : 'none';

  renderSummaryCards(events);

  switch (type) {
    case 'partner':     renderByPartner(events); break;
    case 'event':       renderByEvent(events); break;
    case 'order':       renderByOrder(events); break;
    case 'attribution': renderByAttribution(); break;
    case 'commission':  renderByCommission(events); break;
    case 'payout':      renderByPayout(events); break;
    case 'rankings':    renderRankings(events); break;
  }
}

// ── Helper: Set Table ──────────────────────────────────────
function setTable(title, headers, rows) {
  REPORTS.tableHeaders = headers;
  REPORTS.tableData = rows;

  document.getElementById('report-table-title').textContent = title;
  document.getElementById('report-row-count').textContent = `${rows.length} row${rows.length !== 1 ? 's' : ''}`;

  document.getElementById('report-thead').innerHTML =
    '<tr>' + headers.map(h => `<th>${esc(h)}</th>`).join('') + '</tr>';

  if (rows.length === 0) {
    document.getElementById('report-tbody').innerHTML =
      `<tr><td colspan="${headers.length}" class="table-empty">No data for the selected filters.</td></tr>`;
    return;
  }

  document.getElementById('report-tbody').innerHTML = rows.map(row =>
    '<tr>' + row.map((cell, i) => {
      const isNum = typeof cell === 'number';
      const isMoney = headers[i]?.toLowerCase().includes('revenue') ||
                      headers[i]?.toLowerCase().includes('commission') ||
                      headers[i]?.toLowerCase().includes('chf');
      return `<td>${isMoney && isNum ? `<span class="green-text">${fmtCHF(cell)}</span>` : esc(String(cell ?? '—'))}</td>`;
    }).join('') + '</tr>'
  ).join('');
}

// ── 1. By Partner ──────────────────────────────────────────
function renderByPartner(events) {
  const map = {};
  events.forEach(e => {
    if (!map[e.referralTag]) map[e.referralTag] = { partner: e.partnerName, tag: e.referralTag, sales: 0, tickets: 0, revenue: 0, commission: 0 };
    map[e.referralTag].sales++;
    map[e.referralTag].tickets += e.ticketCount;
    map[e.referralTag].revenue += e.orderTotalRaw;
    map[e.referralTag].commission += e.commissionRaw;
  });
  const rows = Object.values(map).sort((a, b) => b.revenue - a.revenue)
    .map(r => [r.partner, r.tag, r.sales, r.tickets, r.revenue / 100, r.commission / 100]);
  setTable('Report by Partner', ['Partner', 'Referral Tag', 'Sales', 'Tickets', 'Revenue (CHF)', 'Commission (CHF)'], rows);
}

// ── 2. By Event ────────────────────────────────────────────
function renderByEvent(events) {
  const map = {};
  events.forEach(e => {
    const key = e.eventName;
    if (!map[key]) map[key] = { event: e.eventName, sales: 0, tickets: 0, revenue: 0, commission: 0, partners: new Set() };
    map[key].sales++;
    map[key].tickets += e.ticketCount;
    map[key].revenue += e.orderTotalRaw;
    map[key].commission += e.commissionRaw;
    map[key].partners.add(e.referralTag);
  });
  const rows = Object.values(map).sort((a, b) => b.revenue - a.revenue)
    .map(r => [r.event, r.sales, r.tickets, r.revenue / 100, r.commission / 100, r.partners.size]);
  setTable('Report by Event', ['Event Name', 'Sales', 'Tickets', 'Revenue (CHF)', 'Commission (CHF)', 'Partners'], rows);
}

// ── 3. By Order ────────────────────────────────────────────
function renderByOrder(events) {
  const rows = events.map(e => [
    e.orderId, fmtDate(e.occurredAt), e.partnerName, e.referralTag,
    e.eventName, e.ticketCount, e.orderTotalRaw / 100, e.commissionRaw / 100
  ]);
  setTable('Report by Order', ['Order ID', 'Date', 'Partner', 'Tag', 'Event', 'Tickets', 'Revenue (CHF)', 'Commission (CHF)'], rows);
}

// ── 4. By Attribution Source ───────────────────────────────
function renderByAttribution() {
  if (!REPORTS.data) return;
  const allEvents = REPORTS.data.events;
  const partner = document.getElementById('report-partner')?.value;
  const from = document.getElementById('report-date-from')?.value;
  const to = document.getElementById('report-date-to')?.value;

  let filtered = allEvents;
  if (from) filtered = filtered.filter(e => e.occurredAt >= from);
  if (to) filtered = filtered.filter(e => e.occurredAt <= to + 'T23:59:59');
  if (partner) filtered = filtered.filter(e => e.referralTag === partner);

  const groups = { referred: { type: 'Referred (valid tag)', count: 0, revenue: 0, commission: 0 },
                   unknown:  { type: 'Unknown Tag',          count: 0, revenue: 0, commission: 0 },
                   direct:   { type: 'Direct (no tag)',       count: 0, revenue: 0, commission: 0 } };

  filtered.forEach(e => {
    const g = e.eventType === 'sale' ? 'referred' : e.eventType === 'unknown_tag' ? 'unknown' : 'direct';
    groups[g].count++;
    groups[g].revenue += e.orderTotalRaw;
    groups[g].commission += e.commissionRaw;
  });

  const rows = Object.values(groups).map(g => [g.type, g.count, g.revenue / 100, g.commission / 100]);
  setTable('Report by Attribution Source', ['Source', 'Orders', 'Revenue (CHF)', 'Commission (CHF)'], rows);
}

// ── 5. By Commission Status ────────────────────────────────
function renderByCommission(events) {
  const statusFilter = document.getElementById('report-comm-status')?.value || 'all';
  const map = {};
  events.forEach(e => {
    if (!map[e.referralTag]) map[e.referralTag] = { partner: e.partnerName, tag: e.referralTag, pending: 0, paid: 0, sales: 0 };
    // Treat all as "pending" since there's no payout tracking yet
    map[e.referralTag].pending += e.commissionRaw;
    map[e.referralTag].sales++;
  });
  let rows = Object.values(map);
  if (statusFilter === 'paid') rows = rows.map(r => ({ ...r, pending: 0 }));
  if (statusFilter === 'pending') rows = rows.filter(r => r.pending > 0);
  const finalRows = rows.map(r => [r.partner, r.tag, r.sales, r.pending / 100, r.paid / 100]);
  setTable('Report by Commission Status',
    ['Partner', 'Referral Tag', 'Sales', 'Pending Commission (CHF)', 'Paid Commission (CHF)'], finalRows);
}

// ── 6. By Payout Period ────────────────────────────────────
function renderByPayout(events) {
  const period = document.getElementById('report-period')?.value || 'month';
  const getPeriodKey = (iso) => {
    const d = new Date(iso);
    if (period === 'week') {
      const wk = getISOWeek(d);
      return `${d.getFullYear()}-W${String(wk).padStart(2, '0')}`;
    }
    if (period === 'quarter') {
      return `${d.getFullYear()}-Q${Math.ceil((d.getMonth() + 1) / 3)}`;
    }
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  const map = {};
  events.forEach(e => {
    const key = getPeriodKey(e.occurredAt);
    if (!map[key]) map[key] = { period: key, sales: 0, tickets: 0, revenue: 0, commission: 0 };
    map[key].sales++;
    map[key].tickets += e.ticketCount;
    map[key].revenue += e.orderTotalRaw;
    map[key].commission += e.commissionRaw;
  });
  const rows = Object.keys(map).sort().map(k => [map[k].period, map[k].sales, map[k].tickets, map[k].revenue / 100, map[k].commission / 100]);
  setTable(`Report by Payout Period (${period})`, ['Period', 'Sales', 'Tickets', 'Revenue (CHF)', 'Commission (CHF)'], rows);
}

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// ── 7. Rankings ────────────────────────────────────────────
function renderRankings(events) {
  const rankBy = document.getElementById('report-rank-by')?.value || 'totalSales';
  const map = {};
  events.forEach(e => {
    if (!map[e.referralTag]) map[e.referralTag] = { partner: e.partnerName, tag: e.referralTag, totalSales: 0, totalTickets: 0, totalRevenue: 0, totalCommission: 0 };
    map[e.referralTag].totalSales++;
    map[e.referralTag].totalTickets += e.ticketCount;
    map[e.referralTag].totalRevenue += e.orderTotalRaw;
    map[e.referralTag].totalCommission += e.commissionRaw;
  });
  const sorted = Object.values(map).sort((a, b) => b[rankBy] - a[rankBy]);
  const medals = ['🥇', '🥈', '🥉'];
  const rows = sorted.map((r, i) => [
    medals[i] || `#${i + 1}`, r.partner, r.tag,
    r.totalSales, r.totalTickets, r.totalRevenue / 100, r.totalCommission / 100
  ]);
  setTable('Partner Rankings', ['Rank', 'Partner', 'Tag', 'Sales', 'Tickets', 'Revenue (CHF)', 'Commission (CHF)'], rows);
}

// ── Export: CSV ────────────────────────────────────────────
function exportCSV() {
  if (!REPORTS.tableData.length) { showToast('No data to export', 'error'); return; }
  const lines = [REPORTS.tableHeaders.join(',')];
  REPORTS.tableData.forEach(row => {
    lines.push(row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `report_${Date.now()}.csv`;
  a.click();
  showToast('CSV exported successfully', 'success');
}

// ── Export: XLSX ───────────────────────────────────────────
function exportXLSX() {
  if (!REPORTS.tableData.length) { showToast('No data to export', 'error'); return; }
  if (typeof XLSX === 'undefined') { showToast('XLSX library not loaded yet, try again', 'error'); return; }
  const wsData = [REPORTS.tableHeaders, ...REPORTS.tableData.map(row => row.map(c => c ?? ''))];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  // Auto-width columns
  const colWidths = REPORTS.tableHeaders.map((h, i) =>
    Math.max(h.length, ...REPORTS.tableData.map(r => String(r[i] ?? '').length)) + 4
  );
  ws['!cols'] = colWidths.map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  const sheetName = (document.getElementById('report-type')?.options[document.getElementById('report-type')?.selectedIndex]?.text || 'Report').slice(0, 31);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `report_${Date.now()}.xlsx`);
  showToast('XLSX exported successfully', 'success');
}

// ── Presets ────────────────────────────────────────────────
function getPresets() {
  try { return JSON.parse(localStorage.getItem(PRESET_KEY) || '[]'); } catch { return []; }
}

function savePreset() {
  const name = document.getElementById('preset-name-input')?.value.trim();
  if (!name) { showToast('Enter a preset name first', 'error'); return; }
  const preset = {
    name,
    reportType: document.getElementById('report-type')?.value,
    partnerFilter: document.getElementById('report-partner')?.value,
    dateFrom: document.getElementById('report-date-from')?.value,
    dateTo: document.getElementById('report-date-to')?.value,
    periodGroup: document.getElementById('report-period')?.value,
    commStatus: document.getElementById('report-comm-status')?.value,
    rankBy: document.getElementById('report-rank-by')?.value,
  };
  const presets = getPresets().filter(p => p.name !== name); // replace duplicate name
  presets.push(preset);
  localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
  document.getElementById('preset-name-input').value = '';
  loadPresetChips();
  showToast(`Preset "${name}" saved`, 'success');
}

function loadPreset(name) {
  const preset = getPresets().find(p => p.name === name);
  if (!preset) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.value = val; };
  set('report-type', preset.reportType);
  set('report-partner', preset.partnerFilter);
  set('report-date-from', preset.dateFrom);
  set('report-date-to', preset.dateTo);
  set('report-period', preset.periodGroup);
  set('report-comm-status', preset.commStatus);
  set('report-rank-by', preset.rankBy);
  renderReport();
  showToast(`Loaded preset "${name}"`, 'info');
}

function deletePreset(name) {
  const presets = getPresets().filter(p => p.name !== name);
  localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
  loadPresetChips();
  showToast(`Preset "${name}" deleted`, 'info');
}

function loadPresetChips() {
  const presets = getPresets();
  const container = document.getElementById('preset-chips');
  if (!container) return;
  if (presets.length === 0) {
    container.innerHTML = '<span style="font-size:13px; color:var(--text-muted);">No presets saved yet</span>';
    return;
  }
  container.innerHTML = presets.map(p => `
    <span class="preset-chip" onclick="loadPreset('${esc(p.name)}')">
      ${esc(p.name)}
      <span class="preset-chip-del" onclick="event.stopPropagation(); deletePreset('${esc(p.name)}')">×</span>
    </span>`).join('');
}

// esc is defined in app.js — used here too
