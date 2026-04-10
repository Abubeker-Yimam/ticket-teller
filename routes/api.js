'use strict';

const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../services/supabaseClient');
const { formatAmount } = require('../utils/formatCurrency');
const logger = require('../utils/logger');

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
    .select('role, partner_id, email, name')
    .eq('id', user.id)
    .single();

  if (profileErr || !profile) {
    return res.status(403).json({ error: 'User profile not found' });
  }

  req.user = { id: user.id, ...profile };
  next();
}

// ─── GET /api/stats ───────────────────────────────────────────────────────────
router.get('/stats', requireAuth, async (req, res) => {
  const { role, partner_id } = req.user;

  let query = supabaseAdmin.from('referral_events').select('*');

  // PARTNER ISOLATION: Partners only see their own stats
  if (role === 'partner') {
    query = query.eq('referral_tag', partner_id);
  }

  const { data: events, error } = await query;

  if (error) return res.status(500).json({ error: error.message });

  const stats = events.reduce((acc, e) => {
    if (e.event_type === 'sale') {
      acc.totalSales += 1;
      acc.totalTickets += e.ticket_count || 0;
      acc.totalCommission += Number(e.commission_raw || 0);
    } else if (e.event_type === 'cancellation') {
      acc.totalCancellations += 1;
      acc.totalCommission -= Number(e.commission_raw || 0);
    }
    return acc;
  }, { totalSales: 0, totalCancellations: 0, totalTickets: 0, totalCommission: 0 });

  res.json({
    ...stats,
    totalCommission: formatAmount(stats.totalCommission, 'CHF'),
    uptime: Math.floor(process.uptime()),
  });
});

// ─── GET /api/events ──────────────────────────────────────────────────────────
router.get('/events', requireAuth, async (req, res) => {
  const { role, partner_id } = req.user;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);

  let query = supabaseAdmin
    .from('referral_events')
    .select(`
      *,
      profiles:referral_tag (
        name
      )
    `)
    .order('occurred_at', { ascending: false })
    .limit(limit);

  if (role === 'partner') {
    query = query.eq('referral_tag', partner_id);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Map database fields to what the frontend expects
  const formatted = data.map(evt => ({
    id: evt.id,
    type: evt.event_type,
    orderId: evt.order_id,
    referralTag: evt.referral_tag,
    partnerName: evt.profiles?.name || 'Partner',
    eventName: evt.event_name,
    ticketQuantity: evt.ticket_count,
    orderTotal: formatAmount(evt.order_total_raw, evt.currency),
    commission: formatAmount(evt.commission_raw, evt.currency),
    timestamp: evt.occurred_at
  }));

  res.json(formatted);
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
    .select('*')
    .eq('role', 'partner');

  if (error) return res.status(500).json({ error: error.message });

  // Map to the format the frontend expects
  const formatted = partners.map(p => ({
    id: p.partner_id,
    name: p.name || p.email,
    email: p.email,
    active: true, // simplified
    referralLink: `https://buytickets.at/sunbolonsa?ref=${p.partner_id}`,
    // Stats will be fetched per-partner if needed, or we can join
  }));

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

    if (role === 'partner') {
      const { data: events } = await supabaseAdmin
        .from('referral_events')
        .select('order_id')
        .eq('referral_tag', partner_id);
      
      const partnerOrderIds = new Set(events?.map(e => e.order_id) || []);
      tickets = tickets.filter(t => partnerOrderIds.has(t.order_id));
    }

    const formatted = tickets.slice(0, limit).map(t => ({
      id: t.id,
      orderId: t.order_id,
      attendeeName: t.full_name || 'Anonymous',
      email: t.email,
      ticketType: t.description,
      status: t.status,
      checkedIn: String(t.checked_in) === 'true',
      timestamp: new Date(t.created_at * 1000).toISOString()
    }));

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
    ticketTailor: ttStatus,
    registryMode: 'supabase',
    deployTarget: 'netlify',
    ts: new Date().toISOString()
  });
});

module.exports = router;
