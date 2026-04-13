'use strict';

/**
 * routes/payouts.js
 * Payout & Partner Payment-Information Workflow
 * Referral Hub — SunBolon SA
 */

const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../services/supabaseClient');
const { requireAuth } = require('./api');
const logger = require('../utils/logger');

// Currency is CHF throughout
const CURRENCY = 'CHF';

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Write an immutable entry to payout_status_logs.
 */
async function logPayoutEvent({ partnerId, actorId, actorRole, eventType, description, metadata, ipAddress }) {
  try {
    await supabaseAdmin.from('payout_status_logs').insert({
      partner_id: partnerId,
      actor_id: actorId || null,
      actor_role: actorRole || 'system',
      event_type: eventType,
      description: description || '',
      metadata: metadata || null,
      ip_address: ipAddress || null,
    });
  } catch (err) {
    logger.error('[Payouts] Failed to write payout_status_log', { error: err.message });
  }
}

/**
 * Push a system notification to ALL admin users via system_notifications table.
 * The Supabase realtime subscription in profile.js will pick this up instantly
 * and show it in the admin's notification bell with a sound.
 */
async function pushAdminNotification(title, message, type = 'payout', link = null) {
  try {
    // Find all admin user IDs
    const { data: admins, error } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('role', 'admin');

    if (error || !admins || admins.length === 0) return;

    const now = new Date().toISOString();
    const rows = admins.map(a => ({
      user_id: a.id,
      type,
      title,
      message,
      link,
      is_read: false,
      created_at: now,
    }));

    await supabaseAdmin.from('system_notifications').insert(rows);
  } catch (err) {
    logger.warn('[Payouts] Failed to push admin notification', { error: err.message });
  }
}

/**
 * Compute balance summary for a given partner_id from raw DB data.
 * 
 * Total Earned  = sum of commission_raw for sale events minus cancellations
 * Pending       = sum of commission for events where commission_approved = false
 * Available     = sum of commission for approved events, minus paid payout_transactions
 * Paid          = sum of amount in payout_transactions where status = 'paid'
 */
async function computeBalance(partnerId) {
  const [eventsResult, txResult] = await Promise.all([
    supabaseAdmin
      .from('referral_events')
      .select('event_type, commission_raw, commission_approved')
      .eq('referral_tag', partnerId),
    supabaseAdmin
      .from('payout_transactions')
      .select('amount, payout_status')
      .eq('partner_id', partnerId),
  ]);

  const events = eventsResult.data || [];
  const transactions = txResult.data || [];

  let totalEarned   = 0;
  let pendingAmount = 0;
  let approvedTotal = 0;

  for (const e of events) {
    const raw = Number(e.commission_raw || 0);
    if (e.event_type === 'sale') {
      totalEarned += raw;
      if (!e.commission_approved) {
        pendingAmount += raw;
      } else {
        approvedTotal += raw;
      }
    } else if (e.event_type === 'cancellation') {
      totalEarned -= raw;
      if (!e.commission_approved) {
        pendingAmount -= raw;
      } else {
        approvedTotal -= raw;
      }
    }
  }

  const paidAmount = transactions
    .filter(t => t.payout_status === 'paid')
    .reduce((sum, t) => sum + Number(t.amount || 0), 0);

  const processingAmount = transactions
    .filter(t => t.payout_status === 'processing')
    .reduce((sum, t) => sum + Number(t.amount || 0), 0);

  // Available = approved commissions minus what's already been paid out or is processing
  const availableAmount = Math.max(0, approvedTotal - paidAmount - processingAmount);

  const fmt = (n) => `CHF ${Math.max(0, n).toFixed(2)}`;

  return {
    currency: CURRENCY,
    totalEarned:        Math.max(0, totalEarned),
    pendingAmount:      Math.max(0, pendingAmount),
    availableAmount,
    paidAmount,
    processingAmount,
    totalEarnedFmt:    fmt(totalEarned),
    pendingAmountFmt:  fmt(pendingAmount),
    availableFmt:      fmt(availableAmount),
    paidFmt:           fmt(paidAmount),
    processingFmt:     fmt(processingAmount),
  };
}

// ─── PARTNER ENDPOINTS ────────────────────────────────────────

/**
 * GET /api/payouts/my-payment-method
 * Partner: Get their own active payment method.
 */
router.get('/my-payment-method', requireAuth, async (req, res) => {
  if (req.user.role !== 'partner') {
    return res.status(403).json({ error: 'Partners only' });
  }
  try {
    const { data, error } = await supabaseAdmin
      .from('partner_payment_methods')
      .select('*')
      .eq('partner_id', req.user.partner_id)
      .eq('is_active', true)
      .maybeSingle();

    if (error) throw error;
    res.json(data || null);
  } catch (err) {
    logger.error('GET /payouts/my-payment-method', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/payouts/my-payment-method
 * Partner: Save or update their own payment method.
 * Deactivates previous record and inserts a new one (immutable history).
 */
router.post('/my-payment-method', requireAuth, express.json(), async (req, res) => {
  if (req.user.role !== 'partner') {
    return res.status(403).json({ error: 'Partners only' });
  }

  const {
    payment_method_type,
    account_holder_name,
    bank_name,
    account_number_iban,
    swift_bic,
    paypal_email,
    mobile_money_number,
    country,
    payment_notes,
  } = req.body;

  // Validate method type
  const validTypes = ['bank_transfer', 'paypal', 'mobile_money', 'other'];
  if (!payment_method_type || !validTypes.includes(payment_method_type)) {
    return res.status(400).json({ error: 'Invalid payment method type' });
  }

  // Method-specific validation
  if (payment_method_type === 'bank_transfer' && !account_number_iban) {
    return res.status(400).json({ error: 'Bank transfer requires an account number or IBAN' });
  }
  if (payment_method_type === 'paypal' && !paypal_email) {
    return res.status(400).json({ error: 'PayPal requires an email address' });
  }
  if (payment_method_type === 'mobile_money' && !mobile_money_number) {
    return res.status(400).json({ error: 'Mobile money requires a phone number' });
  }
  if (!account_holder_name && payment_method_type !== 'other') {
    return res.status(400).json({ error: 'Account holder name is required' });
  }

  const partnerId = req.user.partner_id;

  try {
    // Deactivate existing active record (if any)
    await supabaseAdmin
      .from('partner_payment_methods')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('partner_id', partnerId)
      .eq('is_active', true);

    // Insert new record
    const { data: newRecord, error: insertError } = await supabaseAdmin
      .from('partner_payment_methods')
      .insert({
        partner_id: partnerId,
        payment_method_type,
        account_holder_name,
        bank_name,
        account_number_iban,
        swift_bic,
        paypal_email,
        mobile_money_number,
        country,
        payment_notes,
        is_active: true,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    // Audit log
    await logPayoutEvent({
      partnerId,
      actorId: req.user.id,
      actorRole: 'partner',
      eventType: 'payment_method_saved',
      description: `Partner saved payment method: ${payment_method_type}`,
      metadata: { method_type: payment_method_type, country },
      ipAddress: req.callerIp,
    });

    // Get partner name for notifications
    const { data: partnerProfile } = await supabaseAdmin
      .from('profiles')
      .select('name, email')
      .eq('partner_id', partnerId)
      .maybeSingle();
    const partnerName = partnerProfile?.name || partnerId;

    // Push system notification to all admins (shows in notification bell immediately)
    await pushAdminNotification(
      `💳 Payment Method Updated`,
      `Partner ${partnerName} (${partnerId}) saved a new ${payment_method_type.replace('_', ' ')} payment method.`,
      'payout'
    );

    // Notify admin via email
    if (partnerProfile && global.emailService?.sendPaymentMethodSavedAlert) {
      global.emailService.sendPaymentMethodSavedAlert({
        partnerName,
        partnerEmail: partnerProfile.email,
        partnerTag: partnerId,
        methodType: payment_method_type,
      }).catch(e => logger.warn('Email alert failed', { error: e.message }));
    }

    res.json({ success: true, record: newRecord });
  } catch (err) {
    logger.error('POST /payouts/my-payment-method', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/payouts/my-balance
 * Partner: Get own balance summary.
 */
router.get('/my-balance', requireAuth, async (req, res) => {
  if (req.user.role !== 'partner') {
    return res.status(403).json({ error: 'Partners only' });
  }
  try {
    const balance = await computeBalance(req.user.partner_id);
    res.json(balance);
  } catch (err) {
    logger.error('GET /payouts/my-balance', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/payouts/my-history
 * Partner: Get own payout transaction history.
 */
router.get('/my-history', requireAuth, async (req, res) => {
  if (req.user.role !== 'partner') {
    return res.status(403).json({ error: 'Partners only' });
  }
  try {
    const { data, error } = await supabaseAdmin
      .from('payout_transactions')
      .select('*')
      .eq('partner_id', req.user.partner_id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    logger.error('GET /payouts/my-history', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/payouts/my-audit-log
 * Partner: Get own payout status log entries.
 */
router.get('/my-audit-log', requireAuth, async (req, res) => {
  if (req.user.role !== 'partner') {
    return res.status(403).json({ error: 'Partners only' });
  }
  try {
    const { data, error } = await supabaseAdmin
      .from('payout_status_logs')
      .select('*')
      .eq('partner_id', req.user.partner_id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    logger.error('GET /payouts/my-audit-log', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── ADMIN ENDPOINTS ─────────────────────────────────────────

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  next();
}

/**
 * GET /api/payouts/partner/:id/payment-method
 * Admin: View a specific partner's active payment method.
 */
router.get('/partner/:id/payment-method', requireAuth, adminOnly, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('partner_payment_methods')
      .select('*')
      .eq('partner_id', req.params.id)
      .eq('is_active', true)
      .maybeSingle();

    if (error) throw error;
    res.json(data || null);
  } catch (err) {
    logger.error('GET /payouts/partner/:id/payment-method', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/payouts/partner/:id/balance
 * Admin: View a specific partner's balance summary.
 */
router.get('/partner/:id/balance', requireAuth, adminOnly, async (req, res) => {
  try {
    const balance = await computeBalance(req.params.id);
    res.json(balance);
  } catch (err) {
    logger.error('GET /payouts/partner/:id/balance', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/payouts/all
 * Admin: List all partners with their payout summary.
 */
router.get('/all', requireAuth, adminOnly, async (req, res) => {
  try {
    // Get all partners
    const { data: partners, error: partnersError } = await supabaseAdmin
      .from('profiles')
      .select('partner_id, name, email, commission_rate, status')
      .eq('role', 'partner');

    if (partnersError) throw partnersError;

    // Get all events
    const { data: events } = await supabaseAdmin
      .from('referral_events')
      .select('referral_tag, event_type, commission_raw, commission_approved');

    // Get all payment methods
    const { data: paymentMethods } = await supabaseAdmin
      .from('partner_payment_methods')
      .select('partner_id, payment_method_type, updated_at')
      .eq('is_active', true);

    // Get all payout transactions
    const { data: transactions } = await supabaseAdmin
      .from('payout_transactions')
      .select('partner_id, amount, payout_status');

    const pmMap = {};
    (paymentMethods || []).forEach(pm => { pmMap[pm.partner_id] = pm; });

    const txMap = {};
    (transactions || []).forEach(tx => {
      if (!txMap[tx.partner_id]) txMap[tx.partner_id] = { paid: 0, processing: 0 };
      if (tx.payout_status === 'paid') txMap[tx.partner_id].paid += Number(tx.amount || 0);
      if (tx.payout_status === 'processing') txMap[tx.partner_id].processing += Number(tx.amount || 0);
    });

    const evMap = {};
    (events || []).forEach(e => {
      const pid = e.referral_tag;
      if (!evMap[pid]) evMap[pid] = { totalEarned: 0, pending: 0, approvedTotal: 0 };
      const raw = Number(e.commission_raw || 0);
      const mult = e.event_type === 'sale' ? 1 : -1;
      evMap[pid].totalEarned += mult * raw;
      if (!e.commission_approved) {
        evMap[pid].pending += mult * raw;
      } else {
        evMap[pid].approvedTotal += mult * raw;
      }
    });

    const fmt = n => `CHF ${Math.max(0, n).toFixed(2)}`;

    const result = (partners || []).map(p => {
      const ev = evMap[p.partner_id] || { totalEarned: 0, pending: 0, approvedTotal: 0 };
      const tx = txMap[p.partner_id] || { paid: 0, processing: 0 };
      const pm = pmMap[p.partner_id] || null;
      const available = Math.max(0, ev.approvedTotal - tx.paid - tx.processing);

      return {
        partnerId:        p.partner_id,
        partnerName:      p.name || p.email,
        partnerEmail:     p.email,
        commissionRate:   p.commission_rate,
        partnerStatus:    p.status,
        totalEarned:      Math.max(0, ev.totalEarned),
        pendingAmount:    Math.max(0, ev.pending),
        availableAmount:  available,
        paidAmount:       tx.paid,
        processingAmount: tx.processing,
        totalEarnedFmt:   fmt(ev.totalEarned),
        pendingFmt:       fmt(ev.pending),
        availableFmt:     fmt(available),
        paidFmt:          fmt(tx.paid),
        processingFmt:    fmt(tx.processing),
        hasPaymentMethod: !!pm,
        paymentMethodType: pm?.payment_method_type || null,
        paymentMethodUpdatedAt: pm?.updated_at || null,
        needsAttention:   available > 0 && !pm,
      };
    });

    // Sort: needs attention first, then by available amount desc
    result.sort((a, b) => {
      if (a.needsAttention && !b.needsAttention) return -1;
      if (!a.needsAttention && b.needsAttention) return 1;
      return b.availableAmount - a.availableAmount;
    });

    res.json(result);
  } catch (err) {
    logger.error('GET /payouts/all', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/payouts/approve-commission
 * Admin: Approve all pending commission for a partner (or specific order IDs).
 * Body: { partner_id, order_ids?: string[] }
 */
router.post('/approve-commission', requireAuth, adminOnly, express.json(), async (req, res) => {
  const { partner_id, order_ids } = req.body;
  if (!partner_id) return res.status(400).json({ error: 'partner_id is required' });

  try {
    let query = supabaseAdmin
      .from('referral_events')
      .update({
        commission_approved: true,
        commission_approved_at: new Date().toISOString(),
        commission_approved_by: req.user.id,
      })
      .eq('referral_tag', partner_id)
      .eq('commission_approved', false)
      .eq('event_type', 'sale');

    if (order_ids && order_ids.length > 0) {
      query = query.in('order_id', order_ids);
    }

    const { error, count } = await query;
    if (error) throw error;

    // Also update payout_status if still 'pending'
    await supabaseAdmin
      .from('referral_events')
      .update({ payout_status: 'approved' })
      .eq('referral_tag', partner_id)
      .eq('commission_approved', true)
      .eq('payout_status', 'pending');

    // Compute new balance
    const balance = await computeBalance(partner_id);

    // Audit log
    await logPayoutEvent({
      partnerId: partner_id,
      actorId: req.user.id,
      actorRole: 'admin',
      eventType: 'commission_approved',
      description: `Admin approved pending commission for partner ${partner_id}`,
      metadata: { order_ids: order_ids || 'all', newAvailable: balance.availableAmount },
      ipAddress: req.callerIp,
    });

    // Notify partner via email
    const { data: partnerProfile2 } = await supabaseAdmin
      .from('profiles')
      .select('name, email')
      .eq('partner_id', partner_id)
      .maybeSingle();

    if (partnerProfile2 && global.emailService?.sendCommissionApprovedNotification) {
      global.emailService.sendCommissionApprovedNotification({
        partnerName: partnerProfile2.name,
        partnerEmail: partnerProfile2.email,
        availableAmount: balance.availableFmt,
      }).catch(e => logger.warn('Email notification failed', { error: e.message }));
    }

    // Push system notification to admins (confirmation in their own bell)
    await pushAdminNotification(
      `✅ Commission Approved`,
      `Commission for partner ${partnerProfile2?.name || partner_id} approved. Available: ${balance.availableFmt}.`,
      'payout'
    );

    res.json({ success: true, balance });
  } catch (err) {
    logger.error('POST /payouts/approve-commission', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/payouts/transactions
 * Admin: Create a new payout transaction for a partner.
 * Body: { partner_id, amount, payment_reference?, payout_date?, admin_note? }
 */
router.post('/transactions', requireAuth, adminOnly, express.json(), async (req, res) => {
  const { partner_id, amount, payment_reference, payout_date, admin_note } = req.body;

  if (!partner_id) return res.status(400).json({ error: 'partner_id is required' });
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Valid positive amount is required' });
  }

  try {
    // Snapshot current payment method
    const { data: pm } = await supabaseAdmin
      .from('partner_payment_methods')
      .select('*')
      .eq('partner_id', partner_id)
      .eq('is_active', true)
      .maybeSingle();

    const { data: tx, error } = await supabaseAdmin
      .from('payout_transactions')
      .insert({
        partner_id,
        amount: Number(amount),
        currency: CURRENCY,
        payout_status: 'pending',
        payment_method_snapshot: pm || null,
        payment_reference: payment_reference || null,
        payout_date: payout_date || null,
        admin_note: admin_note || null,
        approved_by: req.user.id,
      })
      .select()
      .single();

    if (error) throw error;

    await logPayoutEvent({
      partnerId: partner_id,
      actorId: req.user.id,
      actorRole: 'admin',
      eventType: 'payout_created',
      description: `Admin created payout of CHF ${Number(amount).toFixed(2)} for partner ${partner_id}`,
      metadata: { transaction_id: tx.id, amount, payment_reference },
      ipAddress: req.callerIp,
    });

    // Push system notification to admins
    await pushAdminNotification(
      `💸 Payout Created`,
      `A payout of CHF ${Number(amount).toFixed(2)} was created for partner ${partner_id}.`,
      'payout'
    );

    res.json({ success: true, transaction: tx });
  } catch (err) {
    logger.error('POST /payouts/transactions', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/payouts/transactions/:id
 * Admin: Update payout status, reference, or notes.
 * Body: { payout_status?, payment_reference?, payout_date?, admin_note? }
 */
router.put('/transactions/:id', requireAuth, adminOnly, express.json(), async (req, res) => {
  const { payout_status, payment_reference, payout_date, admin_note } = req.body;
  const validStatuses = ['pending', 'processing', 'paid', 'cancelled'];

  if (payout_status && !validStatuses.includes(payout_status)) {
    return res.status(400).json({ error: 'Invalid payout_status' });
  }

  try {
    // Fetch current transaction to get partner_id for logging
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('payout_transactions')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (fetchErr || !existing) return res.status(404).json({ error: 'Transaction not found' });

    const updates = { updated_at: new Date().toISOString() };
    if (payout_status)      updates.payout_status = payout_status;
    if (payment_reference !== undefined) updates.payment_reference = payment_reference;
    if (payout_date !== undefined) updates.payout_date = payout_date;
    if (admin_note !== undefined)  updates.admin_note = admin_note;

    const { data: updated, error } = await supabaseAdmin
      .from('payout_transactions')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;

    await logPayoutEvent({
      partnerId: existing.partner_id,
      actorId: req.user.id,
      actorRole: 'admin',
      eventType: payout_status === 'paid' ? 'payout_paid' : 'payout_status_updated',
      description: `Admin updated payout ${req.params.id}: status=${payout_status || 'unchanged'}, ref=${payment_reference || existing.payment_reference || '-'}`,
      metadata: { transaction_id: req.params.id, previous_status: existing.payout_status, new_status: payout_status },
      ipAddress: req.callerIp,
    });

    // If marked as paid — notify partner and push admin notification
    if (payout_status === 'paid') {
      try {
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('name, email')
          .eq('partner_id', existing.partner_id)
          .single();

        if (profile && global.emailService?.sendPayoutPaidNotification) {
          global.emailService.sendPayoutPaidNotification({
            partnerName: profile.name,
            partnerEmail: profile.email,
            amount: `CHF ${Number(existing.amount).toFixed(2)}`,
            paymentReference: payment_reference || existing.payment_reference,
            payoutDate: payout_date || existing.payout_date,
          }).catch(e => logger.warn('Email notification failed', { error: e.message }));
        }
      } catch (e) { /* non-fatal */ }

      // Push admin notification
      await pushAdminNotification(
        `✅ Payout Marked as Paid`,
        `Payout of CHF ${Number(existing.amount).toFixed(2)} for partner ${existing.partner_id} has been marked as paid. Ref: ${payment_reference || existing.payment_reference || '—'}.`,
        'payout'
      );
    }

    // If marked as processing — notify partner and push admin notification
    if (payout_status === 'processing') {
      try {
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('name, email')
          .eq('partner_id', existing.partner_id)
          .single();

        if (profile && global.emailService?.sendPayoutProcessingNotification) {
          global.emailService.sendPayoutProcessingNotification({
            partnerName: profile.name,
            partnerEmail: profile.email,
            amount: `CHF ${Number(existing.amount).toFixed(2)}`,
          }).catch(e => logger.warn('Email notification failed', { error: e.message }));
        }
      } catch (e) { /* non-fatal */ }

      // Push admin notification
      await pushAdminNotification(
        `⚡ Payout Processing`,
        `Payout of CHF ${Number(existing.amount).toFixed(2)} for partner ${existing.partner_id} is now processing.`,
        'payout'
      );
    }

    res.json({ success: true, transaction: updated });
  } catch (err) {
    logger.error('PUT /payouts/transactions/:id', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/payouts/transactions
 * Admin: List all payout transactions (with optional partner_id filter).
 */
router.get('/transactions', requireAuth, adminOnly, async (req, res) => {
  try {
    let query = supabaseAdmin
      .from('payout_transactions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    if (req.query.partner_id) {
      query = query.eq('partner_id', req.query.partner_id);
    }
    if (req.query.status) {
      query = query.eq('payout_status', req.query.status);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    logger.error('GET /payouts/transactions', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/payouts/audit-log
 * Admin: View payout status logs (all partners).
 */
router.get('/audit-log', requireAuth, adminOnly, async (req, res) => {
  try {
    let query = supabaseAdmin
      .from('payout_status_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    if (req.query.partner_id) {
      query = query.eq('partner_id', req.query.partner_id);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    logger.error('GET /payouts/audit-log', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/payouts/export
 * Admin: Export payout transactions as CSV.
 */
router.get('/export', requireAuth, adminOnly, async (req, res) => {
  try {
    let query = supabaseAdmin
      .from('payout_transactions')
      .select('*')
      .order('created_at', { ascending: false });

    if (req.query.partner_id) query = query.eq('partner_id', req.query.partner_id);
    if (req.query.status) query = query.eq('payout_status', req.query.status);

    const { data, error } = await query;
    if (error) throw error;

    const rows = data || [];
    const headers = ['id', 'partner_id', 'amount', 'currency', 'payout_status', 'payment_reference', 'payout_date', 'admin_note', 'created_at'];
    const csvLines = [
      headers.join(','),
      ...rows.map(r =>
        headers.map(h => {
          const val = r[h] ?? '';
          return `"${String(val).replace(/"/g, '""')}"`;
        }).join(',')
      )
    ];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="payouts-export-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csvLines.join('\r\n'));
  } catch (err) {
    logger.error('GET /payouts/export', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
