'use strict';

/**
 * profile.js — Profile view/edit, password strength checker,
 *               notification panel, user dropdown, nav groups,
 *               real-time notifications via Supabase.
 *
 * Depends on: auth.js (window.auth, initSupabase), app.js (showToast, navigate)
 */

/* ─────────────────────────────────────────────────────────────
   SECTION 1: COLLAPSIBLE NAV GROUPS + SIDEBAR COLLAPSE
   ───────────────────────────────────────────────────────────── */

function toggleNavGroup(groupId) {
  const group = document.getElementById(`nav-group-${groupId}`);
  if (!group) return;
  group.classList.toggle('collapsed');
  // Persist state
  const collapsed = Array.from(document.querySelectorAll('.nav-group.collapsed'))
    .map(g => g.id);
  localStorage.setItem('nav_collapsed_groups', JSON.stringify(collapsed));
}

function restoreNavGroupStates() {
  try {
    const collapsed = JSON.parse(localStorage.getItem('nav_collapsed_groups') || '[]');
    collapsed.forEach(id => {
      const g = document.getElementById(id);
      if (g) g.classList.add('collapsed');
    });
  } catch (_) {}
}

function toggleSidebarCollapse() {
  const sidebar = document.getElementById('sidebar');
  const main    = document.getElementById('main');
  if (!sidebar) return;
  sidebar.classList.toggle('collapsed');
  const isCollapsed = sidebar.classList.contains('collapsed');
  main.style.marginLeft = isCollapsed ? '64px' : 'var(--sidebar-w)';
  localStorage.setItem('sidebar_collapsed', isCollapsed ? '1' : '0');
}

function restoreSidebarState() {
  if (localStorage.getItem('sidebar_collapsed') === '1') {
    const sidebar = document.getElementById('sidebar');
    const main    = document.getElementById('main');
    if (sidebar) sidebar.classList.add('collapsed');
    if (main)    main.style.marginLeft = '64px';
  }
}

// Mobile menu toggle
function initMobileMenu() {
  const btn = document.getElementById('mobile-menu-toggle');
  const overlay = document.createElement('div');
  overlay.id = 'sidebar-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:199;display:none;';
  document.body.appendChild(overlay);

  if (btn) {
    btn.addEventListener('click', () => {
      const sidebar = document.getElementById('sidebar');
      sidebar.classList.toggle('mobile-open');
      overlay.style.display = sidebar.classList.contains('mobile-open') ? 'block' : 'none';
    });
  }
  overlay.addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.remove('mobile-open');
    overlay.style.display = 'none';
  });
}

// Add collapse toggle button to sidebar
function injectSidebarCollapseBtn() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar || document.getElementById('sidebar-collapse-btn')) return;
  const btn = document.createElement('button');
  btn.id = 'sidebar-collapse-btn';
  btn.className = 'sidebar-collapse-btn';
  btn.title = 'Toggle Sidebar';
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"></polyline></svg>`;
  btn.onclick = toggleSidebarCollapse;
  sidebar.appendChild(btn);
}


/* ─────────────────────────────────────────────────────────────
   SECTION 2: USER DROPDOWN (avatar menu)
   ───────────────────────────────────────────────────────────── */

function toggleUserDropdown(e) {
  if (e) e.stopPropagation();
  const panel = document.getElementById('user-dropdown-panel');
  const notifPanel = document.getElementById('notification-panel');
  if (!panel) return;
  // Close notifications if open
  if (notifPanel) notifPanel.style.display = 'none';
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

document.addEventListener('click', () => {
  const panel = document.getElementById('user-dropdown-panel');
  const notifPanel = document.getElementById('notification-panel');
  if (panel) panel.style.display = 'none';
  if (notifPanel) notifPanel.style.display = 'none';
});

function populateUserMenuFromProfile(profile) {
  if (!profile) return;
  const initial  = document.getElementById('user-avatar-initial');
  const nameEl   = document.getElementById('dropdown-user-name');
  const roleEl   = document.getElementById('dropdown-user-role');
  const topAvatar = document.getElementById('profile-avatar-initial');
  const name = profile.name || profile.email || 'User';
  const letter = name.charAt(0).toUpperCase();
  if (initial)  initial.textContent  = letter;
  if (topAvatar) topAvatar.textContent = letter;
  if (nameEl)   nameEl.textContent   = name;
  if (roleEl)   roleEl.textContent   = (profile.role || 'partner').toUpperCase();
}

function toggleMutePreference() {
  const isMuted = localStorage.getItem('sounds_muted') === '1';
  const newState = !isMuted;
  localStorage.setItem('sounds_muted', newState ? '1' : '0');
  const textEl = document.getElementById('sound-status-text');
  if (textEl) textEl.textContent = newState ? 'Sound: OFF' : 'Sound: ON';
  if (window.showToast) window.showToast(newState ? '🔇 Sounds muted' : '🔊 Sounds enabled', 'info');
}

function restoreSoundState() {
  const isMuted = localStorage.getItem('sounds_muted') === '1';
  const textEl  = document.getElementById('sound-status-text');
  if (textEl) textEl.textContent = isMuted ? 'Sound: OFF' : 'Sound: ON';
}


/* ─────────────────────────────────────────────────────────────
   SECTION 3: NOTIFICATION PANEL + REAL-TIME SUBSCRIPTION
   ───────────────────────────────────────────────────────────── */

let _notifications = [];
let _notifChannel  = null;

function toggleNotificationPanel(e) {
  if (e) e.stopPropagation();
  const panel    = document.getElementById('notification-panel');
  const dropdown = document.getElementById('user-dropdown-panel');
  if (!panel) return;
  if (dropdown) dropdown.style.display = 'none';
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) renderNotificationList();
}

function getNotifIcon(type) {
  const icons = {
    sale:    '🎟️',
    message: '💬',
    alert:   '⚠️',
    system:  '⚙️',
    payout:  '💰',
    profile: '👤',
    password:'🔐',
    invitation: '✉️',
  };
  return icons[type] || '🔔';
}

function renderNotificationList() {
  const list = document.getElementById('notification-list');
  if (!list) return;

  if (_notifications.length === 0) {
    list.innerHTML = `<div class="feed-empty" style="padding:24px;">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path></svg>
      <p>No notifications yet</p>
    </div>`;
    return;
  }

  list.innerHTML = _notifications.slice(0, 20).map(n => `
    <div class="notif-item ${n.is_read ? '' : 'unread'}" onclick="markNotificationRead('${n.id}')">
      <div class="notif-icon ${n.type || 'system'}">${getNotifIcon(n.type)}</div>
      <div class="notif-content">
        <div class="notif-title">${escapeHtml(n.title)}</div>
        <div class="notif-msg">${escapeHtml(n.message)}</div>
        <div class="notif-time">${timeAgo(n.created_at)}</div>
      </div>
    </div>
  `).join('');
}

function updateNotificationBadge() {
  const unread = _notifications.filter(n => !n.is_read).length;
  const badge  = document.getElementById('top-notification-badge');
  if (!badge) return;
  if (unread > 0) {
    badge.textContent = unread > 99 ? '99+' : unread;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

async function fetchNotifications() {
  try {
    const client = window._supabaseClient;
    if (!client) return;
    const session = await window.auth.getSession();
    if (!session) return;

    const { data, error } = await client
      .from('system_notifications')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) { console.warn('[Notif] fetch error:', error.message); return; }
    _notifications = data || [];
    updateNotificationBadge();
    renderNotificationList();
  } catch (err) {
    console.warn('[Notif] exception:', err.message);
  }
}

async function markNotificationRead(id) {
  _notifications = _notifications.map(n => n.id === id ? { ...n, is_read: true } : n);
  updateNotificationBadge();
  renderNotificationList();

  try {
    const client = window._supabaseClient;
    if (!client) return;
    await client.from('system_notifications').update({ is_read: true }).eq('id', id);
  } catch (_) {}
}

async function markAllNotificationsRead() {
  _notifications = _notifications.map(n => ({ ...n, is_read: true }));
  updateNotificationBadge();
  renderNotificationList();

  try {
    const client = window._supabaseClient;
    if (!client) return;
    const session = await window.auth.getSession();
    if (!session) return;
    await client.from('system_notifications')
      .update({ is_read: true })
      .eq('user_id', session.user.id)
      .eq('is_read', false);
  } catch (_) {}
}

function subscribeToNotifications(userId) {
  if (_notifChannel) return; // already subscribed
  const client = window._supabaseClient;
  if (!client) return;

  _notifChannel = client
    .channel(`notif-${userId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'system_notifications',
      filter: `user_id=eq.${userId}`,
    }, payload => {
      const notif = payload.new;
      _notifications.unshift(notif);
      updateNotificationBadge();
      renderNotificationList();

      // IF it's a message, refresh the chat UI automatically
      if (notif.type === 'message' && typeof window.refreshChat === 'function') {
        window.refreshChat();
      }

      // Play sound
      playNotificationSound(notif.type);

      // Show toast
      if (window.showToast) {
        window.showToast(`${getNotifIcon(notif.type)} ${notif.title}`, 'info');
      }
    })
    .subscribe();

  console.log('[Notif] Realtime subscription active for user:', userId);
}

function playNotificationSound(type) {
  if (localStorage.getItem('sounds_muted') === '1') return;
  const audioId = type === 'message' ? 'chat-ping-sound' : 'sys-notification-sound';
  const audio = document.getElementById(audioId);
  if (audio) {
    audio.currentTime = 0;
    audio.play().catch(() => {}); // Ignore autoplay policy errors
  }
}


/* ─────────────────────────────────────────────────────────────
   SECTION 4: PASSWORD STRENGTH CHECKER
   ───────────────────────────────────────────────────────────── */

function checkPasswordStrength() {
  const val    = document.getElementById('new_password')?.value || '';
  const bars   = [1,2,3,4].map(i => document.getElementById(`str-${i}`));
  const label  = document.getElementById('str-label');
  const reqs   = {
    len:   val.length >= 8,
    upper: /[A-Z]/.test(val),
    lower: /[a-z]/.test(val),
    num:   /[0-9]/.test(val),
    spec:  /[^A-Za-z0-9]/.test(val),
  };

  // Update req checklist
  Object.entries(reqs).forEach(([key, met]) => {
    const el = document.getElementById(`req-${key}`);
    if (el) el.classList.toggle('req-met', met);
  });

  const score = Object.values(reqs).filter(Boolean).length;
  const colors   = ['#f87171', '#f59e0b', '#60a5fa', '#52b788']; // red, gold, blue, green
  const labels   = ['Weak', 'Fair', 'Good', 'Strong'];
  const barColor = score === 0 ? 'var(--surface-3)' : colors[score - 1];
  const strLabel = score === 0 ? 'Strength' : labels[score - 1];

  bars.forEach((bar, i) => {
    if (bar) {
      bar.style.background = i < score ? barColor : 'var(--surface-3)';
      bar.style.transition = 'background 0.3s ease';
    }
  });
  if (label) {
    label.textContent = strLabel;
    label.style.color = score === 0 ? 'var(--text-muted)' : barColor;
  }

  checkPasswordMatch(); // re-validate match after strength changes
}

function checkPasswordMatch() {
  const newPwd  = document.getElementById('new_password')?.value  || '';
  const confPwd = document.getElementById('confirm_password')?.value || '';
  const matchEl = document.getElementById('match-error');
  const saveBtn = document.getElementById('btn-save-password');

  const match = newPwd === confPwd && confPwd.length > 0;
  const len   = newPwd.length >= 8;

  if (matchEl) matchEl.style.display = (confPwd.length > 0 && !match) ? 'block' : 'none';
  if (saveBtn) saveBtn.disabled = !(match && len);
}

function togglePwd(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = 'Hide';
  } else {
    input.type = 'password';
    btn.textContent = 'Show';
  }
}

function resetPasswordModal() {
  ['current_password','new_password','confirm_password'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  [1,2,3,4].forEach(i => {
    const bar = document.getElementById(`str-${i}`);
    if (bar) bar.style.background = 'var(--surface-3)';
  });
  const label = document.getElementById('str-label');
  if (label) { label.textContent = 'Strength'; label.style.color = 'var(--text-muted)'; }
  const match = document.getElementById('match-error');
  if (match) match.style.display = 'none';
  const err = document.getElementById('password-modal-error');
  if (err) err.style.display = 'none';
  const btn = document.getElementById('btn-save-password');
  if (btn) btn.disabled = true;
  const reqs = ['req-len','req-upper','req-lower','req-num','req-spec'];
  reqs.forEach(id => { const el = document.getElementById(id); if (el) el.classList.remove('req-met'); });
}

// Override openPasswordModal to also reset the form
window.openPasswordModal = function() {
  resetPasswordModal();
  const modal = document.getElementById('password-modal');
  if (modal) modal.style.display = 'flex';
};


/* ─────────────────────────────────────────────────────────────
   SECTION 5: PROFILE VIEW / EDIT
   ───────────────────────────────────────────────────────────── */

let _currentProfile = null;

async function loadProfilePage() {
  try {
    const profile = await window.auth.getProfile();
    _currentProfile = profile;
    if (!profile) return;

    populateUserMenuFromProfile(profile);
    const fields = {
      'prof-name':    profile.name || '',
      'prof-email':   profile.email || '',
      'prof-tag':     profile.referral_tag || profile.tag || '',
      'prof-id':      profile.id || '',
      'prof-phone':   profile.phone || '',
      'prof-company': profile.company_name || '',
      'prof-address': profile.address || '',
    };
    Object.entries(fields).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el) el.value = val;
    });
    const initial = document.getElementById('profile-avatar-initial');
    if (initial) {
      const name = profile.name || profile.email || '?';
      initial.textContent = name.charAt(0).toUpperCase();
    }
  } catch (err) {
    console.error('[Profile] load error:', err.message);
  }
}

function enableProfileEdit() {
  const editableIds = ['prof-name', 'prof-phone', 'prof-company', 'prof-address'];
  editableIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = false;
  });
  const editBtn    = document.getElementById('btn-edit-profile');
  const actionBtns = document.getElementById('btn-profile-actions');
  if (editBtn)    editBtn.style.display    = 'none';
  if (actionBtns) { actionBtns.style.display = 'flex'; }
}

function cancelProfileEdit() {
  // Restore original values
  if (_currentProfile) {
    const vals = {
      'prof-name':    _currentProfile.name || '',
      'prof-phone':   _currentProfile.phone || '',
      'prof-company': _currentProfile.company_name || '',
      'prof-address': _currentProfile.address || '',
    };
    Object.entries(vals).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el) { el.value = val; el.disabled = true; }
    });
  }
  const editBtn    = document.getElementById('btn-edit-profile');
  const actionBtns = document.getElementById('btn-profile-actions');
  if (editBtn)    editBtn.style.display    = '';
  if (actionBtns) actionBtns.style.display = 'none';
}

async function saveProfileChanges() {
  const name    = document.getElementById('prof-name')?.value.trim();
  const phone   = document.getElementById('prof-phone')?.value.trim();
  const company = document.getElementById('prof-company')?.value.trim();
  const address = document.getElementById('prof-address')?.value.trim();

  if (!name) {
    if (window.showToast) window.showToast('Name cannot be empty', 'error');
    return;
  }

  // Phone validation (basic)
  if (phone && !/^\+?[\d\s\-()]{7,20}$/.test(phone)) {
    if (window.showToast) window.showToast('Please enter a valid phone number', 'error');
    return;
  }

  try {
    const client = window._supabaseClient;
    if (!client) throw new Error('Supabase not initialised');
    const session = await window.auth.getSession();
    if (!session) throw new Error('No active session');

    const { error } = await client
      .from('profiles')
      .update({ name, phone, company_name: company, address })
      .eq('id', session.user.id);

    if (error) throw error;

    // Update local cache
    _currentProfile = { ..._currentProfile, name, phone, company_name: company, address };
    populateUserMenuFromProfile(_currentProfile);

    // Lock inputs again
    ['prof-name','prof-phone','prof-company','prof-address'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = true;
    });
    const editBtn    = document.getElementById('btn-edit-profile');
    const actionBtns = document.getElementById('btn-profile-actions');
    if (editBtn)    editBtn.style.display    = '';
    if (actionBtns) actionBtns.style.display = 'none';

    if (window.showToast) window.showToast('✅ Profile updated successfully', 'success');

    // Push a system notification for audit
    pushLocalNotification('Profile Updated', 'Your profile details were updated.', 'profile');

  } catch (err) {
    if (window.showToast) window.showToast('❌ ' + (err.message || 'Update failed'), 'error');
  }
}

/** Push a notification row to Supabase for audit */
async function pushLocalNotification(title, message, type = 'system', link = null) {
  try {
    const client = window._supabaseClient;
    if (!client) return;
    const session = await window.auth.getSession();
    if (!session) return;
    await client.from('system_notifications').insert({
      user_id: session.user.id,
      type, title, message, link, is_read: false
    });
  } catch (_) {}
}


/* ─────────────────────────────────────────────────────────────
   SECTION 6: INITIALISATION
   ───────────────────────────────────────────────────────────── */

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60)   return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function initProfileModule() {
  restoreNavGroupStates();
  restoreSidebarState();
  restoreSoundState();
  injectSidebarCollapseBtn();
  initMobileMenu();

  // Wait for auth
  const profile = await window.auth.getProfile().catch(() => null);
  if (!profile) return;

  populateUserMenuFromProfile(profile);

  // Expose supabase client globally for notification module
  if (!window._supabaseClient) {
    const { createClient } = supabase;
    window._supabaseClient = createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  }

  // Fetch notifications and subscribe
  await fetchNotifications();
  const session = await window.auth.getSession().catch(() => null);
  if (session) subscribeToNotifications(session.user.id);
}

// Expose globals
window.toggleNavGroup            = toggleNavGroup;
window.toggleSidebarCollapse     = toggleSidebarCollapse;
window.toggleNotificationPanel   = toggleNotificationPanel;
window.markAllNotificationsRead  = markAllNotificationsRead;
window.markNotificationRead      = markNotificationRead;
window.toggleUserDropdown        = toggleUserDropdown;
window.toggleMutePreference      = toggleMutePreference;
window.checkPasswordStrength     = checkPasswordStrength;
window.checkPasswordMatch        = checkPasswordMatch;
window.togglePwd                 = togglePwd;
window.enableProfileEdit         = enableProfileEdit;
window.cancelProfileEdit         = cancelProfileEdit;
window.saveProfileChanges        = saveProfileChanges;
window.loadProfilePage           = loadProfilePage;
window.pushLocalNotification     = pushLocalNotification;
window.playNotificationSound     = playNotificationSound;

// Boot when DOM is ready (after auth.js has loaded)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initProfileModule);
} else {
  initProfileModule();
}
