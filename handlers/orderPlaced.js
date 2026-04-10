'use strict';

const { supabaseAdmin } = require('../services/supabaseClient');
const { sendSaleNotification, sendAdminAlert } = require('../services/emailService');
const { formatAmount, calculateCommission, formatDateTime } = require('../utils/formatCurrency');
const logger = require('../utils/logger');

/**
 * Handles the Ticket Tailor `order.placed` webhook event.
 * Writes to Supabase `referral_events` and sends partner notification.
 */
async function handleOrderPlaced(order) {
  if (!order || !order.id) {
    logger.warn('handleOrderPlaced: received malformed order object');
    return;
  }

  const referralTag = order.referral_tag || order.ref || null;

  // 1. Log the raw webhook in Supabase regardless of tag (Audit Trail)
  await supabaseAdmin.from('webhook_logs').insert({
    tt_event_type: 'order.placed',
    tt_order_id: order.id,
    raw_payload: order
  });

  if (!referralTag) {
    logger.info('Order has no referral tag — skipping partner notification', { orderId: order.id });
    return;
  }

  // 2. Lookup partner in Supabase profiles (registry)
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select('name, email, role, partner_id, commission_rate')
    .eq('partner_id', referralTag.trim().toUpperCase())
    .single();

  if (profileErr || !profile) {
    logger.warn('Unknown referral tag — no matching partner found', { referralTag, orderId: order.id });
    
    // Record as unknown event
    await supabaseAdmin.from('referral_events').insert({
      event_type: 'unknown_tag',
      order_id: order.id,
      referral_tag: referralTag,
      order_total_raw: order.total,
      currency: order.currency || 'GHS',
      occurred_at: order.occurred_at
    });

    await sendAdminAlert(`Unknown referral tag: ${referralTag}`, `Order ID: ${order.id}\nTag: ${referralTag}`);
    return;
  }

  // 3. Process the sale
  const currency = order.currency || 'GHS';
  const rawTotal = order.total || 0;
  // Use commission_rate from profile or default to 10%
  const rate = profile.commission_rate || 0.10;
  const commission = calculateCommission(rawTotal, rate, currency);
  const occurredAt = order.occurred_at || new Date().toISOString();

  const ticketQuantity = order.quantity ?? (Array.isArray(order.line_items) ? order.line_items.reduce((sum, item) => sum + (item.quantity || 0), 0) : 1);

  // 4. Record event in Supabase
  await supabaseAdmin.from('referral_events').insert({
    event_type: 'sale',
    order_id: order.id,
    referral_tag: profile.partner_id,
    event_name: order.event_details?.name || 'Your Event',
    ticket_count: ticketQuantity,
    order_total_raw: rawTotal,
    commission_raw: commission.raw,
    currency,
    occurred_at: occurredAt
  });

  // 5. Build and send notification
  const notificationData = {
    partnerName: profile.name,
    partnerEmail: profile.email,
    orderId: order.id,
    eventName: order.event_details?.name || 'Your Event',
    ticketQuantity,
    orderTotalFormatted: formatAmount(rawTotal, currency),
    commissionFormatted: commission.formatted,
    currency,
    occurredAtFormatted: formatDateTime(occurredAt),
  };

  await sendSaleNotification(notificationData);

  logger.info('Partner sale notification dispatched ✓', {
    partner: profile.name,
    orderId: order.id
  });
}

module.exports = { handleOrderPlaced };
