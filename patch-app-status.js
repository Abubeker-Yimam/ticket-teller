const fs = require('fs');

let appJs = fs.readFileSync('public/js/app.js', 'utf8');

// Also Add status toggle JS function
const statusFunctions = `
async function togglePartnerStatus(partnerId, currentStatus) {
  const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
  const confirmMsg = newStatus === 'inactive' 
    ? 'Are you sure you want to deactivate this partner? They will not be able to log in.'
    : 'Reactivate this partner? They will regain access immediately.';
    
  // Assuming a generic confirm modal logic exists or just use browser confirm for now
  if (!confirm(confirmMsg)) return;
  
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
  } catch(e) {
    showToast(e.message, 'error');
  }
}
`;

appJs = appJs.replace(
  "// ── UI Actions ─────────────────────────────────────────────",
  statusFunctions + "\n// ── UI Actions ─────────────────────────────────────────────"
);

// Add the button natively in renderPartners
const originalActions = `
        <button class="action-icon-btn pii-toggle-btn \${piiToggleClass}" 
                onclick="togglePiiException('\${p.id}', \${piiEnabled})"
                title="\${piiEnabled ? 'Disable PII exception' : 'Enable PII exception'}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
        </button>
`.trim();

const newActions = `${originalActions}
        <button class="action-icon-btn" onclick="togglePartnerStatus('\${p.id}', '\${p.status}')" title="\${p.status === 'active' ? 'Deactivate Partner' : 'Activate Partner'}">
          \${p.status === 'active' 
             ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>'
             : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>'}
        </button>
        <button class="action-icon-btn" onclick="adminResetPassword('\${p.id}')" title="Reset Password">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg>
        </button>
`;

appJs = appJs.replace(originalActions, newActions);

const originalBadge = `
        <span class="badge-status \${p.active ? 'badge-active' : 'badge-inactive'}">
          \${p.active ? '● Active' : '○ Inactive'}
        </span>
`.trim();

const newBadge = `
        <span class="badge-status \${p.status === 'active' ? 'badge-active' : 'badge-inactive'}">
          \${p.status === 'active' ? '● Active' : '○ Inactive'}
        </span>
`;

appJs = appJs.replace(originalBadge, newBadge);

fs.writeFileSync('public/js/app.js', appJs);
console.log("Patched app.js with status controls!");
