'use strict';

const express = require('express');
const router = express.Router();
const axios = require('axios');
const { supabaseAdmin } = require('../services/supabaseClient');
const { formatAmount } = require('../utils/formatCurrency');
const logger = require('../utils/logger');
const {
  canRevealPii,
  buildOrderRecord,
  logPiiAccess,
} = require('../services/piiService');

/**
 * Auth Middleware: Verifies the Supabase JWT from the Authorization header.
 * Attaches the user's profile (role and partner_id) to the request.
 */
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No authorization header' });

  const token = authHeader.replace('Bearer ', '');

  // Use admin client to verify the token (this is required in serverless environments)
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  // Fetch role and partner_id from our profiles table
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select('role, partner_id, email, name, status, pii_exception_enabled, force_password_change')
    .eq('id', user.id)
    .single();

  if (profileErr || !profile) {
    return res.status(403).json({ error: 'User profile not found' });
  }

  
  if (profile.status === 'inactive') {
    return res.status(403).json({ error: 'Your account is currently inactive. Please contact the administrator.' });
  }

  req.user = { id: user.id, ...profile };

  // Capture caller IP for audit trail
  req.callerIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null;
  next();
}

// ─── GET /api/stats ───────────────────────────────────────────────────────────
router.get('/stats', requireAuth, async (req, res) => {
  const { role, partner_id } = req.user;

  let query = supabaseAdmin.from('referral_events').select('*');

  // PARTNER ISOLATION: Partners only see their own stats. Admins can optionally filter.
  const targetPartner = role === 'partner' ? partner_id : req.query.partner_id;
  if (targetPartner) {
    query = query.eq('referral_tag', targetPartner);
  }

  const { data: events, error } = await query;

  if (error) return res.status(500).json({ error: error.message });

  const stats = events.reduce((acc, e) => {
    if (e.event_type === 'sale') {
      acc.totalSales += 1;
      acc.totalTickets += e.ticket_count || 0;
      acc.totalCommission += Number(e.commission_raw || 0);
      acc.totalRevenue += Number(e.order_total_raw || 0);
    } else if (e.event_type === 'cancellation') {
      acc.totalCancellations += 1;
      acc.totalCommission -= Number(e.commission_raw || 0);
      acc.totalRevenue -= Number(e.order_total_raw || 0);
    }
    return acc;
  }, { totalSales: 0, totalCancellations: 0, totalTickets: 0, totalCommission: 0, totalRevenue: 0 });

  res.json({
    ...stats,
    totalCommission: formatAmount(Math.max(0, stats.totalCommission), 'CHF'),
    totalRevenue: formatAmount(Math.max(0, stats.totalRevenue), 'CHF'),
    uptime: Math.floor(process.uptime()),
  });
});

// ─── GET /api/events ──────────────────────────────────────────────────────────
router.get('/events', requireAuth, async (req, res) => {
  const { role, partner_id } = req.user;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);

  try {
    // 1. Fetch Events
    let query = supabaseAdmin
      .from('referral_events')
      .select('*')
      .order('occurred_at', { ascending: false })
      .limit(limit);

    const targetPartner = role === 'partner' ? partner_id : req.query.partner_id;
    if (targetPartner) {
      query = query.eq('referral_tag', targetPartner);
    }

    const { data: events, error: eventsError } = await query;
    if (eventsError) throw eventsError;

    // 2. Enrich with Partner Names (Manual join since DB might lack FK constraint)
    const tags = [...new Set(events.map(e => e.referral_tag))].filter(Boolean);
    let partnerMap = {};
    
    if (tags.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('partner_id, name')
        .in('partner_id', tags);
      
      if (profiles) {
        profiles.forEach(p => {
          partnerMap[p.partner_id] = p.name;
        });
      }
    }

    // 3. Format and Respond
    const formatted = events.map(evt => ({
      id: evt.id,
      type: evt.event_type,
      orderId: evt.order_id,
      referralTag: evt.referral_tag,
      partnerName: partnerMap[evt.referral_tag] || 'Partner',
      eventName: evt.event_name,
      ticketQuantity: evt.ticket_count,
      orderTotal: formatAmount(evt.order_total_raw, evt.currency),
      commission: formatAmount(evt.commission_raw, evt.currency),
      timestamp: evt.occurred_at
    }));

    res.json(formatted);
  } catch (err) {
    logger.error('Failed to fetch events', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/partners ────────────────────────────────────────────────────────
// Only Admins can see the list of all partners
router.get('/partners', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  // Fetch profiles with role 'partner'
  const { data: partners, error } = await supabaseAdmin
    .from('profiles')
    .select('partner_id, name, email, commission_rate, status, pii_exception_enabled, company_name, phone, discount_code')
    .eq('role', 'partner');

  if (error) return res.status(500).json({ error: error.message });

  // Fetch all events to compute realtime stats per partner
  const { data: events } = await supabaseAdmin.from('referral_events').select('*');

  const statsMap = events?.reduce((acc, evt) => {
    const pId = evt.referral_tag;
    if (!acc[pId]) acc[pId] = { totalSales: 0, totalTickets: 0, totalCommission: 0, lastSale: null };
    if (evt.event_type === 'sale') {
      acc[pId].totalSales += 1;
      acc[pId].totalTickets += evt.ticket_count || 0;
      acc[pId].totalCommission += Number(evt.commission_raw || 0);
      
      const evtDate = new Date(evt.occurred_at);
      if (!acc[pId].lastSale || evtDate > new Date(acc[pId].lastSale)) {
        acc[pId].lastSale = evt.occurred_at;
      }
    } else if (evt.event_type === 'cancellation') {
      acc[pId].totalCommission -= Number(evt.commission_raw || 0);
    }
    return acc;
  }, {}) || {};

  // Map to the format the frontend expects
  const formatted = (partners || []).map(p => {
    const st = statsMap[p.partner_id] || { totalSales: 0, totalTickets: 0, totalCommission: 0, lastSale: null };
    return {
      id: p.partner_id,
      name: p.name || p.email,
      email: p.email,
      commissionRate: p.commission_rate || '10%',
      active: p.status !== 'inactive',
      referralLink: `https://buytickets.at/sunbolonsa?ref=${p.partner_id}`,
      pii_exception_enabled: p.pii_exception_enabled === true,
      status: p.status || 'active',
      companyName: p.company_name,
      phoneNumber: p.phone,
      discountCode: p.discount_code,
      totalSales: st.totalSales,
      totalTickets: st.totalTickets,
      totalCommissionRaw: st.totalCommission,
      totalCommission: formatAmount(Math.max(0, st.totalCommission), 'CHF'),
      lastSale: st.lastSale,
    };
  });

  res.json(formatted);
});

// ─── GET /api/tickets ────────────────────────────────────────────────────────
router.get('/tickets', requireAuth, async (req, res) => {
  const { role, partner_id } = req.user;
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);

  try {
    const auth = { username: process.env.TICKET_TAILOR_API_KEY, password: '' };
    const response = await axios.get('https://api.tickettailor.com/v1/issued_tickets', { 
      auth, 
      params: { limit: 100 } 
    });
    let tickets = response.data.data;
    tickets.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    // 1. Build order → tag map from our referral_events table (most authoritative)
    const { data: events } = await supabaseAdmin
      .from('referral_events')
      .select('order_id, referral_tag');
    
    const orderTagMap = events?.reduce((acc, e) => {
      if (e.referral_tag) acc[e.order_id] = e.referral_tag;
      return acc;
    }, {}) || {};

    // 2. Secondary Fallback: Fetch recent orders from TT directly
    // This catches orders where the webhook might have failed (like the 503 errors we saw)
    const ordersRes = await axios.get('https://api.tickettailor.com/v1/orders', { 
      auth, 
      params: { limit: 50 } 
    });
    const recentOrders = ordersRes.data.data;
    recentOrders.forEach(o => {
      if (o.referral_tag && !orderTagMap[o.id]) {
        orderTagMap[o.id] = o.referral_tag.trim().toLowerCase();
      }
    });

    const targetPartner = role === 'partner' ? partner_id : req.query.partner_id;
    if (targetPartner) {
      const partnerOrderIds = new Set(
        Object.keys(orderTagMap).filter(id => orderTagMap[id] === targetPartner)
      );
      tickets = tickets.filter(t => partnerOrderIds.has(t.order_id));
    }

    const formatted = tickets.slice(0, limit).map(t => {
      // Attribution Flow:
      //  1. check local DB map (from webhook)
      //  2. check live order map (from recent Orders API fetched above)
      //  3. fallback to 'direct'
      const attribution = orderTagMap[t.order_id] || 'direct';

      return {
        id: t.id,
        orderId: t.order_id,
        attendeeName: t.full_name || 'Anonymous',
        email: t.email,
        ticketType: t.description,
        status: t.status,
        checkedIn: String(t.checked_in) === 'true',
        timestamp: new Date(t.created_at * 1000).toISOString(),
        referralTag: attribution,
      };
    });

    res.json(formatted);
  } catch (err) {
    logger.error('Failed to fetch tickets from Ticket Tailor', { error: err.message });
    res.status(500).json({ error: 'Failed to synchronize with Ticket Tailor' });
  }
});

// ─── GET /api/health ─────────────────────────────────────────────────────────
router.get('/health', async (req, res) => {
  let ttStatus = 'unknown';
  try {
    const auth = { username: process.env.TICKET_TAILOR_API_KEY, password: '' };
    await axios.get('https://api.tickettailor.com/v1/orders', { auth, params: { limit: 1 } });
    ttStatus = 'connected';
  } catch (err) {
    ttStatus = 'error';
    logger.error('Health check: Ticket Tailor API unreachable', { error: err.message });
  }

  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    nodeVersion: process.version,
    ticketTailor: ttStatus,
    resendConfigured: !!process.env.RESEND_API_KEY,
    webhookSecretSet: !!process.env.TICKET_TAILOR_WEBHOOK_SECRET,
    adminEmailSet: !!process.env.ADMIN_EMAIL,
    registryMode: 'supabase',
    deployTarget: 'netlify',
    ts: new Date().toISOString()
  });
});

// ─── GET /api/logs ───────────────────────────────────────────────────────────
// Admin-only: Returns human-readable audit lines for the System page
router.get('/logs', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);

  try {
    const { data: logs, error } = await supabaseAdmin
      .from('pii_access_logs')
      .select('*')
      .order('accessed_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    const lines = (logs || []).map(l => {
      const ts = new Date(l.accessed_at).toISOString().replace('T', ' ').split('.')[0];
      return `[${ts}] [INFO] PII ACCESS: Order ${l.order_id} revealed by user ID ${l.accessor_id.slice(0,8)} (${l.accessor_role})`;
    });

    res.json({ lines });
  } catch (err) {
    logger.error('Failed to fetch audit logs', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/partners ──────────────────────────────────────────────────────
router.post('/partners', requireAuth, express.json(), async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
  const { name, email, partner_id, commission_rate, company_name, phone, discount_code } = req.body;
  if (!name || !email || !partner_id || !commission_rate) return res.status(400).json({ error: 'Missing required fields' });

  try {
    const tempPassword = Math.random().toString(36).slice(-8) + 'X8!';
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { role: 'partner', partner_id }
    });

    if (authError) throw authError;

    const { error: profileError } = await supabaseAdmin.from('profiles').upsert({
      id: authData.user.id,
      email,
      name,
      role: 'partner',
      partner_id,
      commission_rate,
      company_name,
      phone,
      discount_code: (discount_code || '').trim().toUpperCase() || null,
      temp_password: tempPassword
    });

    if (profileError) throw profileError;

    res.json({ success: true, tempPassword });
  } catch (err) {
    logger.error('Failed to create partner', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/partners/:id ───────────────────────────────────────────────────
router.put('/partners/:id', requireAuth, express.json(), async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
  const { name, commission_rate, company_name, phone, discount_code } = req.body;
  try {
    const { error } = await supabaseAdmin.from('profiles')
      .update({ 
        name, 
        commission_rate, 
        company_name, 
        phone,
        discount_code: (discount_code || '').trim().toUpperCase() || null
      })
      .eq('partner_id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to update partner', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});


// ─── PUT /api/partners/:id/status ────────────────────────────────────────────
// Admin-only — toggle activate/deactivate partner profile.
router.put('/partners/:id/status', requireAuth, express.json(), async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { status } = req.body;
  if (!['active', 'inactive'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({ status })
      .eq('partner_id', req.params.id);

    if (error) throw error;

    logger.info('Partner status toggled', {
      adminId:   req.user.id,
      partnerId: req.params.id,
      status
    });
    
    // We will hook email and activity log here later when those modules are ready
    if (global.activityLogger) {
      global.activityLogger.logActivity(
        req.user.id, 'admin', 
        status === 'active' ? 'partner_activated' : 'partner_deactivated',
        `Admin ${req.user.email} changed status of ${req.params.id} to ${status}`,
        { targetPartnerId: req.params.id }, req.callerIp
      );
    }
    if (global.emailService) {
        // Find partner email
        const { data: profile } = await supabaseAdmin.from('profiles').select('email, name').eq('partner_id', req.params.id).single();
        if (profile) {
            global.emailService.sendAccountStatusAlert({
              email: profile.email,
              name: profile.name,
              status
            });
        }
    }

    res.json({ success: true, partnerId: req.params.id, status });
  } catch (err) {
    logger.error('PUT /partners/status error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/partners/:id ────────────────────────────────────────────────
router.delete('/partners/:id', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
  const partnerId = req.params.id;

  try {
    // Safety check: Don't allow deleting partners with earnings > 0
    // Paid tickets have order_total_raw > 0 or commission_raw > 0
    const { data: events, error: eventError } = await supabaseAdmin
      .from('referral_events')
      .select('commission_raw')
      .eq('referral_tag', partnerId);
    
    if (eventError) throw eventError;

    const totalEarning = (events || []).reduce((sum, e) => sum + Number(e.commission_raw || 0), 0);

    if (totalEarning > 0) {
      return res.status(403).json({ 
        error: `Cannot delete partner with active earnings (${totalEarning.toFixed(2)}). Please deactivate them instead to preserve audit logs.` 
      });
    }

    const { data: profile } = await supabaseAdmin.from('profiles').select('id').eq('partner_id', partnerId).single();
    if (profile) {
      // Delete from Auth and Profiles
      await supabaseAdmin.auth.admin.deleteUser(profile.id);
      await supabaseAdmin.from('profiles').delete().eq('id', profile.id);
    }
    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to delete partner', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/partners/:id/reset-password ───────────────────────────────────
router.post('/partners/:id/reset-password', requireAuth, express.json(), async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
  const partnerId = req.params.id;
  try {
    const { data: profile } = await supabaseAdmin.from('profiles').select('id, email, name').eq('partner_id', partnerId).single();
    if (!profile) return res.status(404).json({ error: 'Partner not found' });
    
    // Generate secure temp password
    const tempPassword = Math.random().toString(36).slice(-8) + 'X8!';
    
    // Update Supabase Auth layer manually
    const { error: updateAuthErr } = await supabaseAdmin.auth.admin.updateUserById(profile.id, { password: tempPassword });
    if (updateAuthErr) throw updateAuthErr;

    // Set force_password_change and temp_password in profiles
    const { error: profileErr } = await supabaseAdmin.from('profiles').update({
      temp_password: tempPassword,
      force_password_change: true
    }).eq('id', profile.id);
    if (profileErr) throw profileErr;

    if (global.activityLogger) {
      global.activityLogger.logActivity(
        req.user.id, 'admin', 'admin_reset_password',
        `Admin ${req.user.email} reset password for partner ${profile.name}`,
        { targetPartnerId: partnerId }, req.callerIp
      );
    }

    if (global.emailService) {
        await global.emailService.sendPasswordResetAdminAlert({
          email: profile.email,
          name: profile.name,
          tempPassword
        });
    }

    res.json({ success: true, tempPassword });
  } catch (err) {
    logger.error('Failed to reset partner password', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/test-email ────────────────────────────────────────────────────
router.post('/test-email', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
  try {
    const { sendAdminAlert } = require('../services/emailService');
    await sendAdminAlert('Test Connection', 'Resend Email integration is configured successfully.');
    res.json({ success: true });
  } catch (err) {
    logger.error('Test email failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports ────────────────────────────────────────────────────────
// Admin-only: returns all events + partner profiles for client-side reporting
router.get('/reports', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });

  try {
    const [eventsResult, partnersResult] = await Promise.all([
      supabaseAdmin.from('referral_events').select('*').order('occurred_at', { ascending: false }),
      supabaseAdmin.from('profiles').select('partner_id, name, email, commission_rate').eq('role', 'partner')
    ]);

    // Build partner lookup map
    const partnerMap = {};
    (partnersResult.data || []).forEach(p => {
      partnerMap[p.partner_id] = { name: p.name || p.email, email: p.email, commissionRate: p.commission_rate };
    });

    // Enrich events with partner name
    const events = (eventsResult.data || []).map(e => ({
      id: e.id,
      orderId: e.order_id,
      eventType: e.event_type,
      referralTag: e.referral_tag,
      partnerName: partnerMap[e.referral_tag]?.name || 'Unknown',
      partnerEmail: partnerMap[e.referral_tag]?.email || '',
      eventName: e.event_name || 'Unknown Event',
      ticketCount: e.ticket_count || 0,
      orderTotalRaw: Number(e.order_total_raw || 0),
      commissionRaw: Number(e.commission_raw || 0),
      currency: e.currency || 'CHF',
      occurredAt: e.occurred_at,
    }));

    const partners = (partnersResult.data || []).map(p => ({
      id: p.partner_id,
      name: p.name || p.email,
      email: p.email,
      commissionRate: p.commission_rate,
    }));

    res.json({ events, partners });
  } catch (err) {
    logger.error('Reports endpoint error', { error: err.message });
    // Return empty data so the frontend can render gracefully
    res.json({ events: [], partners: [], error: err.message });
  }
});

// ─── GET /api/partner-orders ─────────────────────────────────────────────────
// Partners see their attributed orders with PII masked by default.
// Admins can query any partner's orders by passing ?partner_id=
router.get('/partner-orders', requireAuth, async (req, res) => {
  const { role, partner_id } = req.user;

  // Determine the target partner scope
  const targetPartner = role === 'partner' ? partner_id : req.query.partner_id || null;

  try {
    let query = supabaseAdmin
      .from('referral_events')
      .select('*')
      .in('event_type', ['sale', 'cancellation'])
      .order('occurred_at', { ascending: false })
      .limit(200);

    if (targetPartner) {
      query = query.eq('referral_tag', targetPartner);
    } else if (role === 'partner') {
      // Safety: partner with no partner_id sees nothing
      return res.json([]);
    }

    // Optional search filters
    if (req.query.event_name) {
      query = query.ilike('event_name', `%${req.query.event_name}%`);
    }
    if (req.query.from) {
      query = query.gte('occurred_at', req.query.from);
    }
    if (req.query.to) {
      query = query.lte('occurred_at', req.query.to);
    }

    const { data: events, error } = await query;
    if (error) throw error;

    // Determine if caller can see unmasked PII
    const reveal = canRevealPii(req.user);

    // Log the query if PII is being revealed
    if (reveal && role !== 'admin') {
      // Bulk query reveal — log as a range access
      await logPiiAccess({
        accessorId:   req.user.id,
        accessorRole: role,
        partnerId:    partner_id,
        orderId:      'BULK_QUERY',
        fields:       ['orderId'],
        ipAddress:    req.callerIp,
        reason:       'bulk_partner_orders_query',
      });
    }

    const formatted = events.map(evt => {
      const record = buildOrderRecord(evt, reveal);
      return {
        ...record,
        grossAmount:  formatAmount(record.grossAmount, record.currency),
        discount:     record.discount > 0 ? formatAmount(record.discount, record.currency) : 'N/A',
        commission:   formatAmount(record.commission + (evt.adjustment_amount || 0), record.currency),
        payoutStatus: evt.payout_status || 'pending',
        attributionMethod: evt.attribution_method || 'referral_tag',
        adjustmentAmount: evt.adjustment_amount || 0,
        adjustmentNotes: evt.adjustment_notes || ''
      };
    });

    res.json(formatted);
  } catch (err) {
    logger.error('GET /partner-orders error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/partner-orders/:orderId/reveal ─────────────────────────────────
// Returns the full unmasked record for ONE order (raw order_id in URL param).
// Caller MUST have pii_exception_enabled or be admin.
// ALWAYS writes an audit log entry regardless of role.
router.get('/partner-orders/:orderId/reveal', requireAuth, async (req, res) => {
  const { role, partner_id } = req.user;
  const { orderId } = req.params;

  // Gate: only authorised callers may reveal
  if (!canRevealPii(req.user)) {
    logger.warn('PII reveal denied', { userId: req.user.id, orderId });
    return res.status(403).json({
      error: 'PII access not authorised for this account. Contact your administrator.',
    });
  }

  try {
    // Partners may only reveal orders attributed to themselves
    let query = supabaseAdmin
      .from('referral_events')
      .select('*')
      .eq('order_id', orderId);

    if (role === 'partner') {
      query = query.eq('referral_tag', partner_id);
    }

    const { data: events, error } = await query;
    if (error) throw error;

    if (!events || events.length === 0) {
      return res.status(404).json({ error: 'Order not found or not attributed to this partner' });
    }

    // Use the most recent event for this order_id
    const evt = events.sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at))[0];

    // ── AUDIT LOG — mandatory, happens for every successful reveal ──
    await logPiiAccess({
      accessorId:   req.user.id,
      accessorRole: role,
      partnerId:    evt.referral_tag,
      orderId:      orderId,
      fields:       ['orderId', 'customerName', 'customerEmail'],
      ipAddress:    req.callerIp,
      reason:       req.query.reason || null,
    });

    const record = buildOrderRecord(evt, true /* reveal = true */);
    res.json({
      ...record,
      grossAmount: formatAmount(record.grossAmount, record.currency),
      discount:    record.discount > 0 ? formatAmount(record.discount, record.currency) : 'N/A',
      commission:  formatAmount(record.commission, record.currency),
    });
  } catch (err) {
    logger.error('GET /partner-orders/reveal error', { error: err.message, orderId });
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/pii-access-logs ────────────────────────────────────────────────
// Admin-only — returns the immutable PII access audit trail.
router.get('/pii-access-logs', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);

    let query = supabaseAdmin
      .from('pii_access_logs')
      .select('*')
      .order('accessed_at', { ascending: false })
      .limit(limit);

    if (req.query.partner_id) {
      query = query.eq('partner_id', req.query.partner_id);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json(data || []);
  } catch (err) {
    logger.error('GET /pii-access-logs error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/activity-logs ──────────────────────────────────────────────────
router.get('/activity-logs', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const limit = Math.min(parseInt(req.query.limit) || 100, 500);

  try {
    let query = supabaseAdmin
      .from('activity_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (req.query.partner_id) {
       query = query.contains('metadata', { targetPartnerId: req.query.partner_id });
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    logger.error('GET /activity-logs error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/partners/:id/pii-exception ─────────────────────────────────────
// Admin-only — toggle pii_exception_enabled for a given partner profile.
router.put('/partners/:id/pii-exception', requireAuth, express.json(), async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'Body must contain { "enabled": true|false }' });
  }

  try {
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({ pii_exception_enabled: enabled })
      .eq('partner_id', req.params.id);

    if (error) throw error;

    logger.info('PII exception toggled', {
      adminId:   req.user.id,
      partnerId: req.params.id,
      enabled,
    });

    res.json({ success: true, partnerId: req.params.id, pii_exception_enabled: enabled });
  } catch (err) {
    logger.error('PUT /partners/pii-exception error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/orders/:id/payout ─────────────────────────────────────────────
// Deprecated: Order-level payouts are obsolete. The Payouts module handles all tracking.
router.put('/orders/:id/payout', requireAuth, express.json(), async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
  // Silent success to prevent legacy frontend UI from crashing the system.
  res.json({ success: true, orderId: req.params.id, payoutStatus: req.body.status || 'pending', deprecated: true });
});

// ─── POST /api/orders/:id/adjust ────────────────────────────────────────────
// Admin-only: add manual adjustment to a commission.
router.post('/orders/:id/adjust', requireAuth, express.json(), async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
  const { amount, notes } = req.body;
  if (typeof amount !== 'number') return res.status(400).json({ error: 'Invalid amount' });

  try {
    const { error } = await supabaseAdmin
      .from('referral_events')
      .update({ 
        adjustment_amount: amount,
        adjustment_notes: notes || ''
      })
      .eq('order_id', req.params.id);

    if (error) throw error;

    if (global.activityLogger) {
      global.activityLogger.logActivity(
        req.user.id, 'admin', 'commission_adjusted',
        `Admin adjusted commission for order ${req.params.id} by ${amount}`,
        { orderId: req.params.id, adjustment: amount, notes },
        req.callerIp
      );
    }

    res.json({ success: true, orderId: req.params.id, adjustment: amount });
  } catch (err) {
    logger.error('POST /orders/adjust error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, requireAuth };
