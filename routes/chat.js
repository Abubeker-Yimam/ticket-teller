'use strict';

/* ═══════════════════════════════════════════════════════════
   Chat Routes  —  /api/chat/*
   ═══════════════════════════════════════════════════════════
   All access control is enforced server-side.
   Partners can only ever reach their own conversation.
   Admin can reach any conversation.
   ═══════════════════════════════════════════════════════════ */

const express     = require('express');
const router      = express.Router();
const rateLimit   = require('express-rate-limit');
const { supabaseAdmin } = require('../services/supabaseClient');
const logger      = require('../utils/logger');

// ── Rate limiter: 30 messages per minute per IP ──────────────────
const msgLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many messages. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Auth Middleware ──────────────────────────────────────────────
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No authorization header' });

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid or expired session' });

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select('role, partner_id, email, name')
    .eq('id', user.id)
    .single();

  if (profileErr || !profile) return res.status(403).json({ error: 'User profile not found' });

  req.user = { id: user.id, ...profile };
  next();
}

// ── Helper: fetch & verify caller owns this conversation ─────────
async function getConversation(id, user) {
  const { data, error } = await supabaseAdmin
    .from('conversations')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) return null;

  // Admin can access any conversation; partner only their own
  if (user.role === 'admin') return data;
  if (data.partner_id === user.partner_id || data.partner_user_id === user.id) return data;
  return null; // forbidden
}

// ── Helper: sanitize message text ────────────────────────────────
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ═══════════════════════════════════════════════════════════════════
//  POST /api/chat/conversations
//  Get-or-create the caller's conversation with Admin.
// ═══════════════════════════════════════════════════════════════════
router.post('/conversations', requireAuth, async (req, res) => {
  const { role, partner_id, id: userId } = req.user;

  try {
    if (role === 'admin') {
      // Admin specifies which partner they want to open a thread with
      const { partnerId: targetId } = req.body;
      if (!targetId) return res.status(400).json({ error: 'partnerId required' });

      const { data: partnerProfile } = await supabaseAdmin
        .from('profiles')
        .select('id, partner_id, name, email')
        .eq('partner_id', targetId)
        .eq('role', 'partner')
        .single();

      if (!partnerProfile) return res.status(404).json({ error: 'Partner not found' });

      // Return existing if present
      const { data: existing } = await supabaseAdmin
        .from('conversations')
        .select('*')
        .eq('partner_id', targetId)
        .maybeSingle();

      if (existing) {
      if (existing.partner_user_id !== userId) {
        // sync the auth ID if partner was recreated
        await supabaseAdmin.from('conversations').update({ partner_user_id: userId }).eq('id', existing.id);
        existing.partner_user_id = userId;
      }
      return res.json(existing);
    }

      const { data: newConv, error } = await supabaseAdmin
        .from('conversations')
        .insert({ partner_id: targetId, partner_user_id: partnerProfile.id, admin_user_id: userId })
        .select()
        .single();

      if (error) throw error;
      return res.status(201).json(newConv);
    }

    // Partner: get-or-create their own support thread
    const { data: existing } = await supabaseAdmin
      .from('conversations')
      .select('*')
      .eq('partner_id', partner_id)
      .maybeSingle();

    if (existing) return res.json(existing);

    const { data: newConv, error } = await supabaseAdmin
      .from('conversations')
      .insert({ partner_id, partner_user_id: userId })
      .select()
      .single();

    if (error) throw error;
    return res.status(201).json(newConv);
  } catch (err) {
    logger.error('[Chat] POST /conversations', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  GET /api/chat/conversations
//  Admin: all conversations. Partner: only their own.
// ═══════════════════════════════════════════════════════════════════
router.get('/conversations', requireAuth, async (req, res) => {
  const { role, id: userId } = req.user;

  try {
    let query = supabaseAdmin
      .from('conversations')
      .select('*')
      .order('last_message_at', { ascending: false, nullsFirst: false });

    if (role === 'partner') {
      // Hard isolation — partner sees only their own row
      query = query.eq('partner_id', req.user.partner_id);
    } else {
      // Admin filters
      if (req.query.status)         query = query.eq('status', req.query.status);
      if (req.query.pinned === 'true') query = query.eq('pinned', true);
      if (req.query.unread === 'true') query = query.gt('unread_admin', 0);
    }

    const { data, error } = await query;
    if (error) throw error;

    let result = data || [];

    // Admin: text search across partner_id, preview
    if (role === 'admin' && req.query.search) {
      const q = req.query.search.toLowerCase();
      result = result.filter(c =>
        (c.partner_id || '').toLowerCase().includes(q) ||
        (c.last_message_preview || '').toLowerCase().includes(q)
      );
    }

    // Enrich with partner names for admin
    if (role === 'admin' && result.length > 0) {
      const partnerIds = result.map(c => c.partner_id).filter(Boolean);
      if (partnerIds.length > 0) {
        const { data: profiles } = await supabaseAdmin.from('profiles').select('partner_id, name').in('partner_id', partnerIds);
        const nameMap = (profiles || []).reduce((acc, p) => ({ ...acc, [p.partner_id]: p.name }), {});
        result = result.map(c => ({
          ...c,
          partner_name: nameMap[c.partner_id] || c.partner_id
        }));
      }
    }

    res.json(result);
  } catch (err) {
    logger.error('[Chat] GET /conversations', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  GET /api/chat/conversations/:id
// ═══════════════════════════════════════════════════════════════════
router.get('/conversations/:id', requireAuth, async (req, res) => {
  const conv = await getConversation(req.params.id, req.user);
  if (!conv) return res.status(403).json({ error: 'Forbidden' });
  res.json(conv);
});

// ═══════════════════════════════════════════════════════════════════
//  GET /api/chat/conversations/:id/messages
// ═══════════════════════════════════════════════════════════════════
router.get('/conversations/:id/messages', requireAuth, async (req, res) => {
  const conv = await getConversation(req.params.id, req.user);
  if (!conv) return res.status(403).json({ error: 'Forbidden' });

  const limit  = Math.min(parseInt(req.query.limit) || 50, 100);
  const page   = Math.max(parseInt(req.query.page)  || 1,  1);
  const offset = (page - 1) * limit;

  try {
    let query = supabaseAdmin
      .from('messages')
      .select('*')
      .eq('conversation_id', req.params.id)
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);

    // Partners never see internal notes
    if (req.user.role !== 'admin') {
      query = query.eq('is_internal', false);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    logger.error('[Chat] GET /messages', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  POST /api/chat/conversations/:id/messages
// ═══════════════════════════════════════════════════════════════════
router.post('/conversations/:id/messages', requireAuth, msgLimiter, async (req, res) => {
  const conv = await getConversation(req.params.id, req.user);
  if (!conv) return res.status(403).json({ error: 'Forbidden' });

  const content    = sanitize(req.body.content || '');
  const isInternal = req.user.role === 'admin' && req.body.is_internal === true;

  if (!content)            return res.status(400).json({ error: 'Message content required' });
  if (content.length > 4000) return res.status(400).json({ error: 'Message too long (max 4000 chars)' });

  try {
    const { data: message, error } = await supabaseAdmin
      .from('messages')
      .insert({
        conversation_id: conv.id,
        sender_id:   req.user.id,
        sender_role: req.user.role,
        content,
        is_internal: isInternal,
        status: 'sent',
      })
      .select()
      .single();

    if (error) throw error;

    // Update conversation metadata
    const preview     = content.length > 80 ? content.slice(0, 80) + '…' : content;
    const unreadField = req.user.role === 'admin' ? 'unread_partner' : 'unread_admin';
    const unreadDelta = isInternal ? {} : { [unreadField]: conv[unreadField] + 1 };

    await supabaseAdmin
      .from('conversations')
      .update({
        last_message_at:      new Date().toISOString(),
        last_message_preview: isInternal ? conv.last_message_preview : preview,
        updated_at:           new Date().toISOString(),
        ...unreadDelta,
      })
      .eq('id', conv.id);

    // Create notification for the other party via system_notifications
    if (!isInternal) {
      if (req.user.role === 'admin') {
        const recipientId = conv.partner_user_id;
        if (recipientId) {
          await supabaseAdmin.from('system_notifications').insert({
            user_id: recipientId,
            type: 'message',
            title: 'New Message from Support',
            message: preview,
            link: '#chat'
          });
        }
      } else {
        // Push notification to all admins
        const { data: admins } = await supabaseAdmin.from('profiles').select('id').eq('role', 'admin');
        if (admins && admins.length > 0) {
          const rows = admins.map(a => ({
            user_id: a.id,
            type: 'message',
            title: `Message from ${req.user.name || req.user.partner_id}`,
            message: preview,
            link: '#chat'
          }));
          await supabaseAdmin.from('system_notifications').insert(rows);
        }
      }
    }

    logger.info('[Chat] Message sent', {
      convId: conv.id,
      sender: req.user.id,
      role:   req.user.role,
      internal: isInternal,
    });

    res.status(201).json(message);
  } catch (err) {
    logger.error('[Chat] POST /messages', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  POST /api/chat/conversations/:id/read
//  Reset unread counter + mark notifications read
// ═══════════════════════════════════════════════════════════════════
router.post('/conversations/:id/read', requireAuth, async (req, res) => {
  const conv = await getConversation(req.params.id, req.user);
  if (!conv) return res.status(403).json({ error: 'Forbidden' });

  try {
    const counterField = req.user.role === 'admin' ? 'unread_admin' : 'unread_partner';

    await supabaseAdmin
      .from('conversations')
      .update({ [counterField]: 0, updated_at: new Date().toISOString() })
      .eq('id', conv.id);

    // Mark notifications as read
    await supabaseAdmin
      .from('notification_events')
      .update({ read: true })
      .eq('conversation_id', conv.id)
      .eq('recipient_id', req.user.id)
      .eq('read', false);

    // Update message statuses
    const filterRole = req.user.role === 'admin' ? 'partner' : 'admin';
    await supabaseAdmin
      .from('messages')
      .update({ status: 'read', updated_at: new Date().toISOString() })
      .eq('conversation_id', conv.id)
      .eq('sender_role', filterRole)
      .neq('status', 'read')
      .eq('is_internal', false);

    res.json({ ok: true });
  } catch (err) {
    logger.error('[Chat] POST /read', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  PATCH /api/chat/conversations/:id  —  Admin only
//  Update status / priority / pinned
// ═══════════════════════════════════════════════════════════════════
router.patch('/conversations/:id', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const VALID_STATUS   = ['active', 'resolved', 'archived'];
  const VALID_PRIORITY = ['normal', 'high', 'urgent'];
  const update = { updated_at: new Date().toISOString() };

  if (req.body.status   !== undefined && VALID_STATUS.includes(req.body.status))       update.status   = req.body.status;
  if (req.body.priority !== undefined && VALID_PRIORITY.includes(req.body.priority))   update.priority = req.body.priority;
  if (req.body.pinned   !== undefined && typeof req.body.pinned === 'boolean')         update.pinned   = req.body.pinned;

  if (Object.keys(update).length < 2) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('conversations')
      .update(update)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    logger.error('[Chat] PATCH /conversations', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  GET /api/chat/notifications
// ═══════════════════════════════════════════════════════════════════
router.get('/notifications', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('notification_events')
      .select('*')
      .eq('recipient_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    const unread = (data || []).filter(n => !n.read).length;
    res.json({ unread, notifications: data || [] });
  } catch (err) {
    logger.error('[Chat] GET /notifications', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  POST /api/chat/notifications/read
// ═══════════════════════════════════════════════════════════════════
router.post('/notifications/read', requireAuth, async (req, res) => {
  try {
    await supabaseAdmin
      .from('notification_events')
      .update({ read: true })
      .eq('recipient_id', req.user.id)
      .eq('read', false);

    res.json({ ok: true });
  } catch (err) {
    logger.error('[Chat] POST /notifications/read', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  POST /api/chat/conversations/:id/notes  —  Admin only
// ═══════════════════════════════════════════════════════════════════
router.post('/conversations/:id/notes', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const content = sanitize(req.body.content || '');
  if (!content) return res.status(400).json({ error: 'Note content required' });

  try {
    const { data, error } = await supabaseAdmin
      .from('admin_notes')
      .insert({ conversation_id: req.params.id, admin_id: req.user.id, content })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    logger.error('[Chat] POST /notes', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  GET /api/chat/conversations/:id/notes  —  Admin only
// ═══════════════════════════════════════════════════════════════════
router.get('/conversations/:id/notes', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  try {
    const { data, error } = await supabaseAdmin
      .from('admin_notes')
      .select('*')
      .eq('conversation_id', req.params.id)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    logger.error('[Chat] GET /notes', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  POST /api/chat/conversations/:id/tags  —  Admin only
// ═══════════════════════════════════════════════════════════════════
router.post('/conversations/:id/tags', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const VALID_TAGS = ['payout', 'referral_link', 'commission', 'ticket_issue', 'onboarding', 'technical_support'];
  const tags = (req.body.tags || []).filter(t => VALID_TAGS.includes(t));

  try {
    await supabaseAdmin.from('conversation_tags').delete().eq('conversation_id', req.params.id);
    if (tags.length > 0) {
      await supabaseAdmin.from('conversation_tags').insert(
        tags.map(tag => ({ conversation_id: req.params.id, tag }))
      );
    }
    res.json({ tags });
  } catch (err) {
    logger.error('[Chat] POST /tags', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
