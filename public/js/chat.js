'use strict';

/* ═══════════════════════════════════════════════════════════
   Chat Frontend Module — Secure In-App Messaging
   ═══════════════════════════════════════════════════════════

   • Partners see only their own conversation with Admin
   • Admin sees all partner threads
   • Real-time via Supabase Realtime (postgres_changes + presence)
   • Typing indicators via Presence channels
   • Optimistic UI — messages appear instantly before server confirms
   ═══════════════════════════════════════════════════════════ */

// ── Module State ─────────────────────────────────────────────────
const chatState = {
  conversations:   [],
  openConvs:       [],   // Array of open conversation IDs
  messages:        {},   // { [convId]: Message[] }
  initialized:     false,
  realtimeChannel: null, // No longer used if we do per-conversation sockets, but wait: we do subscribeRealtime per conv, so maybe an object { [convId]: channel }
  realtimeChannels:{},
  supabaseClient:  null,
  typingTimer:     null,
  expanded:        false,
  muted:           false,
  partnerDirectory: [],
};

function toggleChatMute(e) {
  if (e) e.stopPropagation();
  chatState.muted = !chatState.muted;
  const btn = document.getElementById('chat-mute-btn');
  if (btn) {
    if (chatState.muted) {
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="red" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`;
    } else {
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;
    }
  }
}

function playPingSound() {
  if (chatState.muted) return;
  const audio = document.getElementById('chat-ping-sound');
  if (audio) {
    audio.currentTime = 0;
    audio.play().catch(e => console.log('Audio autoplay blocked', e));
  }
}

function toggleChatExpanded() {
  chatState.expanded = !chatState.expanded;
  const widget = document.getElementById('floating-chat-widget');
  const expandedPanel = document.getElementById('chat-expanded-panel');
  if (!widget || !expandedPanel) return;

  const isAdmin = window.state?.user?.role === 'admin';

  if (chatState.expanded) {
    if (isAdmin) {
      widget.classList.add('chat-widget-expanded');
      widget.classList.remove('chat-widget-minimized');
      expandedPanel.style.display = 'flex';
      document.getElementById('chat-conv-list-container').style.display = 'flex';
      document.getElementById('chat-partner-search-container').style.display = 'none';
      const startBtn = document.getElementById('chat-start-new-btn');
      if (startBtn) startBtn.style.display = 'inline-block';
    } else if (chatState.conversations.length > 0) {
       // Partners only pop out their dedicated chat window, the dock stays minimized.
       chatState.expanded = false; // toggle doesn't apply to dock for partner
       openConversation(chatState.conversations[0].id);
    }
  } else {
    // Dock collapse (admin only)
    widget.classList.remove('chat-widget-expanded');
    widget.classList.add('chat-widget-minimized');
    expandedPanel.style.display = 'none';
  }
}

function minimizeChat(e) {
  if (e) e.stopPropagation();
  chatState.expanded = false;
  const widget = document.getElementById('floating-chat-widget');
  if (widget) {
    widget.classList.remove('chat-widget-expanded');
    widget.classList.add('chat-widget-minimized');
  }
  document.getElementById('chat-expanded-panel').style.display = 'none';
}

function closeActiveChat(e, convId) {
  if (e) e.stopPropagation();
  chatState.openConvs = chatState.openConvs.filter(id => id !== convId);
  const win = document.getElementById(`chat-window-${convId}`);
  if (win) {
    win.style.animation = 'slideUp 0.2s reverse forwards';
    setTimeout(() => win.remove(), 200);
  }
}

async function toggleAdminPartnerSearch(e) {
  if (e) e.stopPropagation();
  const clc = document.getElementById('chat-conv-list-container');
  const psc = document.getElementById('chat-partner-search-container');
  if (!clc || !psc) return;

  if (clc.style.display !== 'none') {
    clc.style.display = 'none';
    psc.style.display = 'flex';
    // Fetch if needed
    if (chatState.partnerDirectory.length === 0) {
      document.getElementById('chat-partner-directory-list').innerHTML = '<div class="chat-loading-state">Loading partners...</div>';
      try {
        const token = window.state?.session?.access_token;
        const res = await fetch('/api/partners', {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        if (!res.ok) throw new Error('API error');
        const partners = await res.json();
        chatState.partnerDirectory = partners || [];
        renderPartnerDirectory();
      } catch (err) {
        document.getElementById('chat-partner-directory-list').innerHTML = `<div class="chat-loading-state" style="color:var(--red)">Failed to load.</div>`;
      }
    } else {
      renderPartnerDirectory();
    }
  } else {
    psc.style.display = 'none';
    clc.style.display = 'flex';
  }
}

function searchPartnerDirectory() {
  const q = (document.getElementById('chat-partner-search-input')?.value || '').toLowerCase();
  const items = document.querySelectorAll('.chat-partner-search-item');
  items.forEach(item => {
    const text = item.textContent.toLowerCase();
    item.style.display = !q || text.includes(q) ? '' : 'none';
  });
}

function renderPartnerDirectory() {
  const container = document.getElementById('chat-partner-directory-list');
  if (!container) return;
  if (chatState.partnerDirectory.length === 0) {
    container.innerHTML = '<div class="chat-empty-state">No partners found.</div>';
    return;
  }
  container.innerHTML = chatState.partnerDirectory.map(p => `
    <div class="chat-conv-item chat-partner-search-item" onclick="openAdminConversation('${p.id}'); toggleAdminPartnerSearch();">
      <div class="chat-avatar chat-avatar-admin" style="font-size:12px;">${(p.name || 'P').slice(0,2).toUpperCase()}</div>
      <div class="chat-conv-body">
        <div class="chat-conv-name">${p.name}</div>
        <div class="chat-conv-preview">${p.email}</div>
      </div>
    </div>
  `).join('');
}

// ── Supabase client for Realtime (separate from auth) ────────────
function getChatSupabaseClient() {
  if (chatState.supabaseClient) return chatState.supabaseClient;
  const url = window.SUPABASE_URL;
  const key = window.SUPABASE_ANON_KEY;
  if (!url || !key || !window.supabase) {
    console.warn('[Chat] Supabase not available — Realtime disabled');
    return null;
  }
  chatState.supabaseClient = window.supabase.createClient(url, key);
  return chatState.supabaseClient;
}

// ── Authenticated fetch helper ────────────────────────────────────
async function chatFetch(method, path, body) {
  const token = window.state?.session?.access_token;
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res  = await fetch(`/api/chat${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ═══════════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════════
async function initChat() {
  // Re-render cached state when navigating back
  if (chatState.initialized) {
    renderConversationList();
    chatState.openConvs.forEach(convId => renderMessages(convId));
    return;
  }

  // renderChatSkeleton();  // no longer needed
  await loadConversations();

  // Partners auto-open their single thread locally on boot
  if (window.state?.user?.role === 'partner' && chatState.conversations.length > 0) {
    chatState.openConvs = [chatState.conversations[0].id];
    subscribeRealtime(chatState.conversations[0].id); // subscribe silently for notifications
  } else if (window.state?.user?.role === 'partner') {
    // Partner has no thread yet — create one
    try {
       const conv = await chatFetch('POST', '/conversations');
       chatState.conversations = [conv];
       chatState.openConvs = [conv.id];
       renderConversationList();
       subscribeRealtime(conv.id); // subscribe silently
    } catch (err) {
      console.error('[Chat] Failed to create conversation:', err.message);
    }
  }

  chatState.initialized = true;
}

// ── Load all conversations ────────────────────────────────────────
async function loadConversations() {
  try {
    const data = await chatFetch('GET', '/conversations');
    chatState.conversations = Array.isArray(data) ? data : [];
    renderConversationList();
    updateChatBadge();
  } catch (err) {
    console.error('[Chat] loadConversations error:', err.message);
    showToast('Could not load conversations', 'error');
  }
}

// ── Force refresh (called by global filter changes) ───────────────
async function refreshChat() {
  chatState.initialized = false;
  await loadConversations();
  for (const convId of chatState.openConvs) {
    await loadMessages(convId);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  OPEN CONVERSATION
// ═══════════════════════════════════════════════════════════════════
async function openConversation(convId) {
  if (!chatState.openConvs.includes(convId)) {
    chatState.openConvs.push(convId);
  }

  // Ensure window is in DOM
  renderChatWindow(convId);

  // Focus the input
  document.getElementById(`chat-input-${convId}`)?.focus();

  await loadMessages(convId);
  await markAsRead(convId);
  subscribeRealtime(convId);
}

// ── Load messages for a conversation ─────────────────────────────
async function loadMessages(convId) {
  try {
    const data = await chatFetch('GET', `/conversations/${convId}/messages?limit=100`);
    chatState.messages[convId] = Array.isArray(data) ? data : [];
    renderMessages(convId);
  } catch (err) {
    console.error('[Chat] loadMessages error:', err.message);
  }
}

// ── Mark conversation as read ─────────────────────────────────────
async function markAsRead(convId) {
  try {
    await chatFetch('POST', `/conversations/${convId}/read`);

    const conv   = chatState.conversations.find(c => c.id === convId);
    const field  = window.state?.user?.role === 'admin' ? 'unread_admin' : 'unread_partner';
    if (conv) conv[field] = 0;

    updateChatBadge();
    renderConversationList();
  } catch (err) {
    console.error('[Chat] markAsRead error:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  SEND MESSAGE
// ═══════════════════════════════════════════════════════════════════
async function sendChatMessage(convId) {
  const input   = document.getElementById(`chat-input-${convId}`);
  const content = (input?.value || '').trim();
  if (!content || !convId) return;

  input.value = '';
  input.style.height = 'auto';

  // Optimistic message
  const temp = {
    id:              `temp-${Date.now()}`,
    conversation_id: convId,
    sender_id:       window.state?.user?.id,
    sender_role:     window.state?.user?.role,
    content,
    status:          'sending',
    is_internal:     false,
    created_at:      new Date().toISOString(),
  };

  if (!chatState.messages[convId]) {
    chatState.messages[convId] = [];
  }
  chatState.messages[convId].push(temp);
  renderMessages(convId);

  try {
    const confirmed = await chatFetch('POST', `/conversations/${convId}/messages`, { content });

    // Swap temp with confirmed
    const arr = chatState.messages[convId];
    const idx = arr.findIndex(m => m.id === temp.id);
    if (idx !== -1) arr[idx] = confirmed;
    renderMessages(convId);
    _updateConvPreview(convId, content);
  } catch (err) {
    showToast('Send failed: ' + err.message, 'error');
    chatState.messages[convId] =
      chatState.messages[convId].filter(m => m.id !== temp.id);
    renderMessages(convId);
    input.value = content; // restore
  }
}

function _updateConvPreview(convId, content) {
  const conv = chatState.conversations.find(c => c.id === convId);
  if (conv) {
    conv.last_message_at      = new Date().toISOString();
    conv.last_message_preview = content.length > 80 ? content.slice(0, 80) + '…' : content;
    renderConversationList();
  }
}

// ═══════════════════════════════════════════════════════════════════
//  ADMIN ACTIONS
// ═══════════════════════════════════════════════════════════════════
async function updateConversationStatus(convId, status) {
  try {
    await chatFetch('PATCH', `/conversations/${convId}`, { status });
    const conv = chatState.conversations.find(c => c.id === convId);
    if (conv) conv.status = status;
    renderChatWindowHeader(convId);
    renderConversationList();
    showToast(`Conversation marked as ${status}`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function toggleConvPin(convId) {
  const conv = chatState.conversations.find(c => c.id === convId);
  if (!conv) return;
  try {
    await chatFetch('PATCH', `/conversations/${convId}`, { pinned: !conv.pinned });
    conv.pinned = !conv.pinned;
    renderConversationList();
    renderChatWindowHeader(convId);
    showToast(conv.pinned ? 'Conversation pinned' : 'Unpinned', 'info');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function addInternalNote(convId) {
  const input   = document.getElementById(`chat-note-input-${convId}`);
  const content = (input?.value || '').trim();
  if (!content || !convId) return;

  try {
    const note = await chatFetch('POST', `/conversations/${convId}/notes`, { content });
    // Render note inline as an internal message bubble
    const internalMsg = {
      ...note,
      sender_role: 'admin',
      is_internal: true,
      status:      'sent',
    };
    if (!chatState.messages[convId]) chatState.messages[convId] = [];
    chatState.messages[convId].push(internalMsg);
    renderMessages(convId);
    input.value = '';
    document.getElementById(`chat-note-bar-${convId}`).style.display = 'none';
    showToast('Internal note added', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function openAdminConversation(partnerId) {
  try {
    const conv = await chatFetch('POST', '/conversations', { partnerId });
    if (!chatState.conversations.find(c => c.id === conv.id)) {
      chatState.conversations.unshift(conv);
    }
    renderConversationList();
    await openConversation(conv.id);
    if (!chatState.expanded) toggleChatExpanded();
  } catch (err) {
    showToast('Could not open conversation: ' + err.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════
//  REALTIME
// ═══════════════════════════════════════════════════════════════════
function subscribeRealtime(convId) {
  const client = getChatSupabaseClient();
  if (!client) return;

  // Unsubscribe previous channel
  if (chatState.realtimeChannel) {
    client.removeChannel(chatState.realtimeChannel);
    chatState.realtimeChannel = null;
  }

  chatState.realtimeChannel = client
    .channel(`chat-conv-${convId}`, { config: { presence: { key: window.state?.user?.id || 'anon' } } })

    // New message arrived
    .on('postgres_changes', {
      event:  'INSERT',
      schema: 'public',
      table:  'messages',
      filter: `conversation_id=eq.${convId}`,
    }, (payload) => {
      const msg = payload.new;
      if (!msg) return;
      const arr = chatState.messages[convId] || [];
      if (!arr.find(m => m.id === msg.id)) {
        // Don't show internal notes to partners
        if (msg.is_internal && window.state?.user?.role !== 'admin') return;
        arr.push(msg);
        chatState.messages[convId] = arr;
        renderMessages(convId);
        _updateConvPreview(convId, msg.content);

        // Auto-mark as read if this conversation is open
        if (msg.sender_id !== window.state?.user?.id && chatState.openConvs.includes(convId)) {
          markAsRead(convId);
        } else {
          // Update badge
          const conv  = chatState.conversations.find(c => c.id === convId);
          const field = window.state?.user?.role === 'admin' ? 'unread_admin' : 'unread_partner';
          if (conv && msg.sender_id !== window.state?.user?.id) {
             conv[field] = (conv[field] || 0) + 1;
             playPingSound();
          }
          if (!chatState.expanded) playPingSound();
          updateChatBadge();
          renderConversationList();
        }
      }
    })

    // Conversation metadata updated (unread counts, status, etc.)
    .on('postgres_changes', {
      event:  'UPDATE',
      schema: 'public',
      table:  'conversations',
      filter: `id=eq.${convId}`,
    }, (payload) => {
      const updated = payload.new;
      if (!updated) return;
      const idx = chatState.conversations.findIndex(c => c.id === convId);
      if (idx !== -1) chatState.conversations[idx] = { ...chatState.conversations[idx], ...updated };
      updateChatBadge();
      renderConversationList();
    })

    // Typing indicator via Presence
    .on('presence', { event: 'sync' }, () => {
      const presenceState = chatState.realtimeChannel.presenceState();
      const isTyping = Object.values(presenceState).some(presences =>
        presences.some(p => p.typing === true && p.user_id !== window.state?.user?.id)
      );
      renderTypingIndicator(convId, isTyping);
    })

    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await chatState.realtimeChannel.track({
          user_id: window.state?.user?.id,
          typing:  false,
        });
      }
    });
}

async function emitTyping(convId) {
  if (!chatState.realtimeChannel) return;
  await chatState.realtimeChannel.track({
    user_id: window.state?.user?.id,
    typing:  true,
  });
  clearTimeout(chatState.typingTimer);
  chatState.typingTimer = setTimeout(async () => {
    if (chatState.realtimeChannel) {
      await chatState.realtimeChannel.track({
        user_id: window.state?.user?.id,
        typing:  false,
      });
    }
  }, 2500);
}

// ═══════════════════════════════════════════════════════════════════
//  RENDER: Skeleton
// ═══════════════════════════════════════════════════════════════════
function renderChatSkeleton() {
  // Unused in floating layout
}

// ═══════════════════════════════════════════════════════════════════
//  RENDER: Conversation List
// ═══════════════════════════════════════════════════════════════════
function renderConversationList() {
  const list    = document.getElementById('chat-conv-list');
  if (!list) return;

  const isAdmin = window.state?.user?.role === 'admin';
  const convs   = chatState.conversations;

  if (convs.length === 0) {
    list.innerHTML = `<div class="chat-empty-state">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" style="opacity:.3">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      <p>${isAdmin ? 'No conversations yet.' : 'No messages yet.'}</p>
    </div>`;
    return;
  }

  // Sort: pinned first → then by last message time
  const sorted = [...convs].sort((a, b) => {
    if (a.pinned !== b.pinned) return b.pinned - a.pinned;
    return new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0);
  });

  list.innerHTML = sorted.map(c => _buildConvRow(c, isAdmin)).join('');
}

function _buildConvRow(conv, isAdmin) {
  const unread  = isAdmin ? conv.unread_admin : conv.unread_partner;
  const isActive = conv.id === chatState.activeConvId;
  const preview  = esc(conv.last_message_preview || 'Start a conversation…');
  const time     = conv.last_message_at ? _formatTime(conv.last_message_at) : '';
  const pinIcon  = conv.pinned ? '📌 ' : '';
  const resolved = conv.status === 'resolved' ? '<span class="chat-status-chip resolved">✓ Resolved</span>' : '';
  const archived = conv.status === 'archived' ? '<span class="chat-status-chip archived">📦 Archived</span>' : '';

  const name   = isAdmin ? esc(conv.partner_name || conv.partner_id || 'Partner') : 'Support Admin';
  const initA  = isAdmin
    ? (conv.partner_id || 'P').slice(0, 2).toUpperCase()
    : '🛡';
  const avatar = `<div class="chat-avatar ${!isAdmin ? 'chat-avatar-admin' : ''}">${initA}</div>`;

  return `
    <div class="chat-conv-item${isActive ? ' active' : ''}${conv.status !== 'active' ? ' conv-inactive' : ''}"
         data-id="${esc(conv.id)}"
         onclick="openConversation('${esc(conv.id)}')">
      ${avatar}
      <div class="chat-conv-body">
        <div class="chat-conv-row1">
          <span class="chat-conv-name">${pinIcon}${name}${resolved}${archived}</span>
          <span class="chat-conv-time">${esc(time)}</span>
        </div>
        <div class="chat-conv-preview">${preview}</div>
      </div>
      ${unread > 0 ? `<span class="chat-unread-dot">${unread}</span>` : ''}
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════
//  RENDER: Chat Window
// ═══════════════════════════════════════════════════════════════════
function renderChatWindow(convId) {
  const area = document.getElementById('chat-windows-area');
  if (!area) return;

  let win = document.getElementById(`chat-window-${convId}`);
  if (!win) {
    win = document.createElement('div');
    win.id = `chat-window-${convId}`;
    win.className = 'floating-chat-window';
    area.appendChild(win);
  }

  const conv    = chatState.conversations.find(c => c.id === convId);
  const isAdmin = window.state?.user?.role === 'admin';
  const name    = isAdmin ? esc(conv?.partner_name || conv?.partner_id || 'Partner') : 'Support Admin';
  const initA   = isAdmin ? (conv?.partner_id || 'P').slice(0, 2).toUpperCase() : '🛡';
  const statusOptions = ['active', 'resolved', 'archived'];

  win.innerHTML = `
    <!-- Header -->
    <div class="chat-win-hdr bg-purple">
      <div class="chat-win-hdr-left">
        <div class="chat-avatar ${!isAdmin ? 'chat-avatar-admin' : ''}" style="width:34px;height:34px;font-size:13px;border-color:rgba(255,255,255,.2);color:#fff;background:rgba(0,0,0,.1);">${initA}</div>
        <div>
          <div class="chat-win-name" style="color:#fff;">${name}</div>
          <div class="chat-win-sub" style="color:rgba(255,255,255,.8);">${isAdmin ? 'Partner' : 'Admin Support'} · <span id="conv-status-label">${esc(conv?.status || 'active')}</span></div>
        </div>
      </div>
      <div class="chat-win-hdr-actions">
        ${isAdmin ? `
        <select class="form-select" style="width:auto;padding:3px 8px;font-size:11px; margin-right:4px;"
                onchange="updateConversationStatus('${esc(convId)}', this.value)">
          ${statusOptions.map(s => `<option value="${s}"${conv?.status===s?' selected':''}>${s.charAt(0).toUpperCase()+s.slice(1)}</option>`).join('')}
        </select>
        <button class="chat-hdr-btn" onclick="openNoteBar('${esc(convId)}')" title="Internal note">
           🔒
        </button>
        ` : ''}
        <button class="chat-hdr-btn" onclick="closeActiveChat(event, '${esc(convId)}')" title="Close Chat">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
    </div>

    <!-- Messages scroll area -->
    <div class="chat-messages" id="chat-messages-${esc(convId)}">
      <div class="chat-loading-state"><span class="spinner-inline"></span> Loading…</div>
    </div>

    <!-- Typing indicator -->
    <div class="chat-typing" id="chat-typing-${esc(convId)}" style="display:none">
      <span></span><span></span><span></span>
      <span class="chat-typing-label">${isAdmin ? name : 'Admin'} is typing</span>
    </div>

    <!-- Internal note bar (admin-only) -->
    ${isAdmin ? `
    <div class="chat-note-bar" id="chat-note-bar-${esc(convId)}" style="display:none">
      <div class="chat-note-label">🔒 Internal note — only admins can see this</div>
      <div class="chat-composer-row">
        <textarea class="chat-textarea" id="chat-note-input-${esc(convId)}" rows="1"
                  placeholder="Write an internal note…"
                  oninput="autoResizeChatInput(this)"></textarea>
        <button class="chat-send-btn note" onclick="addInternalNote('${esc(convId)}')">Add</button>
      </div>
    </div>` : ''}

    <!-- Composer -->
    <div class="chat-composer">
      <div class="chat-composer-row">
        <textarea class="chat-textarea" id="chat-input-${esc(convId)}" rows="1"
                  placeholder="Type a message…"
                  oninput="autoResizeChatInput(this); emitTyping('${esc(convId)}');"
                  onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChatMessage('${esc(convId)}');}"></textarea>
        <button class="chat-send-btn" onclick="sendChatMessage('${esc(convId)}')" id="chat-send-btn-${esc(convId)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
    </div>`;
}

function renderChatWindowHeader(convId) {
  renderChatWindow(convId);
  // Re-load messages (cheaper than full re-render)
  if (chatState.messages[convId]) renderMessages(convId);
}

function openNoteBar(convId) {
  const bar = document.getElementById(`chat-note-bar-${convId}`);
  if (bar) {
    const isVisible = bar.style.display !== 'none';
    bar.style.display = isVisible ? 'none' : 'block';
    if (!isVisible) document.getElementById(`chat-note-input-${convId}`)?.focus();
  }
}

// ═══════════════════════════════════════════════════════════════════
//  RENDER: Messages
// ═══════════════════════════════════════════════════════════════════
function renderMessages(convId) {
  const container = document.getElementById(`chat-messages-${convId}`);
  if (!container) return;

  const msgs = chatState.messages[convId] || [];
  const myId = window.state?.user?.id;

  if (msgs.length === 0) {
    container.innerHTML = `
      <div class="chat-panel-empty" style="margin:auto">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" style="opacity:.25">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <p>No messages yet. Say hello! 👋</p>
      </div>`;
    return;
  }

  let html      = '';
  let lastDate  = null;

  msgs.forEach(msg => {
    const msgDate = new Date(msg.created_at).toDateString();
    if (msgDate !== lastDate) {
      html += `<div class="chat-date-sep"><span>${_formatDate(msg.created_at)}</span></div>`;
      lastDate = msgDate;
    }
    html += _buildBubble(msg, myId);
  });

  container.innerHTML = html;
  container.scrollTop = container.scrollHeight; // auto-scroll to newest
}

function _buildBubble(msg, myId) {
  const isMe      = msg.sender_id === myId;
  const isSending = msg.status === 'sending';
  const time      = new Date(msg.created_at)
    .toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  if (msg.is_internal) {
    return `
      <div class="bubble-internal">
        <span class="bubble-internal-lbl">🔒 Internal note</span>
        <div class="bubble-internal-body">${esc(msg.content)}</div>
        <span class="bubble-meta">${esc(time)}</span>
      </div>`;
  }

  const tick = isMe
    ? msg.status === 'read'    ? '<span class="msg-tick read">✓✓</span>'
    : msg.status === 'sending' ? '<span class="msg-tick">⋯</span>'
    : '<span class="msg-tick">✓</span>'
    : '';

  return `
    <div class="bubble-wrap ${isMe ? 'is-me' : 'is-them'}">
      <div class="bubble ${isMe ? 'bubble-out' : 'bubble-in'}${isSending ? ' bubble-sending' : ''}">
        <div class="bubble-text">${esc(msg.content)}</div>
        <div class="bubble-meta">${esc(time)}${tick}</div>
      </div>
    </div>`;
}

function renderTypingIndicator(convId, isTyping) {
  const el = document.getElementById(`chat-typing-${convId}`);
  if (el) el.style.display = isTyping ? 'flex' : 'none';
}

// ═══════════════════════════════════════════════════════════════════
//  ADMIN SEARCH
// ═══════════════════════════════════════════════════════════════════
function searchConversations() {
  const q     = (document.getElementById('chat-search-input')?.value || '').toLowerCase();
  const items = document.querySelectorAll('.chat-conv-item');
  items.forEach(item => {
    const text = item.textContent.toLowerCase();
    item.style.display = !q || text.includes(q) ? '' : 'none';
  });
}

function filterConvsByStatus(status) {
  document.querySelectorAll('.chat-filter-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  const items = document.querySelectorAll('.chat-conv-item');
  items.forEach(item => {
    if (!status) { item.style.display = ''; return; }
    const convId = item.dataset.id;
    const conv   = chatState.conversations.find(c => c.id === convId);
    item.style.display = conv?.status === status ? '' : 'none';
  });
}

// ═══════════════════════════════════════════════════════════════════
//  BADGE + UTILITIES
// ═══════════════════════════════════════════════════════════════════
function updateChatBadge() {
  const isAdmin = window.state?.user?.role === 'admin';
  const total   = chatState.conversations.reduce(
    (sum, c) => sum + (isAdmin ? (c.unread_admin || 0) : (c.unread_partner || 0)), 0
  );
  
  // Main nav badge (if exists)
  const navBadge = document.getElementById('badge-chat');
  if (navBadge) navBadge.textContent = total > 0 ? String(total) : '0';

  // Floating widget badge
  const floatBadge = document.getElementById('chat-floating-badge');
  if (floatBadge) {
    if (total > 0) {
      floatBadge.style.display = 'inline-flex';
      floatBadge.textContent = String(total);
    } else {
      floatBadge.style.display = 'none';
      floatBadge.textContent = '0';
    }
  }
}

function autoResizeChatInput(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function _formatTime(isoStr) {
  const d    = new Date(isoStr);
  const now  = new Date();
  const diff = now - d;
  if (diff < 60000)        return 'just now';
  if (diff < 3600000)      return `${Math.floor(diff / 60000)}m ago`;
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function _formatDate(isoStr) {
  const d   = new Date(isoStr);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ═══════════════════════════════════════════════════════════════════
//  GLOBAL EXPORTS
// ═══════════════════════════════════════════════════════════════════
window.initChat                  = initChat;
window.refreshChat               = refreshChat;
window.openConversation          = openConversation;
window.sendChatMessage           = sendChatMessage;
window.emitTyping                = emitTyping;
window.openNoteBar               = openNoteBar;
window.addInternalNote           = addInternalNote;
window.updateConversationStatus  = updateConversationStatus;
window.toggleConvPin             = toggleConvPin;
window.openAdminConversation     = openAdminConversation;
window.searchConversations       = searchConversations;
window.filterConvsByStatus       = filterConvsByStatus;
window.updateChatBadge           = updateChatBadge;
window.autoResizeChatInput       = autoResizeChatInput;
window.toggleChatExpanded        = toggleChatExpanded;
window.minimizeChat              = minimizeChat;
window.closeActiveChat           = closeActiveChat;
window.toggleChatMute            = toggleChatMute;
