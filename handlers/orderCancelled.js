'use strict';

const { supabaseAdmin } = require('../services/supabaseClient');
const { sendCancellationNotification } = require('../services/emailService');
const { formatAmount, calculateCommission, formatDateTime } = require('../utils/formatCurrency');
const logger = require('../utils/logger');

/**
 * Handles the Ticket Tailor `order.cancelled` webhook event.
 */
async function handleOrderCancelled(order) {
  if (!order || !order.id) {
    logger.warn('handleOrderCancelled: received malformed order object');
    return;
  }

  const referralTag = order.referral_tag || order.ref || null;

  // 1. Audit Trail
  await supabaseAdmin.from('webhook_logs').insert({
    tt_event_type: 'order.cancelled',
    tt_order_id: order.id,
    raw_payload: order
  });

  if (!referralTag) {
    logger.debug('Cancelled order has no referral tag — skipping', { orderId: order.id });
    return;
  }

  // 2. Lookup partner (normalize to lowercase)
  const normalizedTag = referralTag.trim().toLowerCase();

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select('name, email, partner_id, commission_rate')
    .eq('partner_id', normalizedTag)
    .single();

  if (profileErr || !profile) {
    logger.warn('Cancelled order has unknown referral tag', { normalizedTag, orderId: order.id });
    return;
  }

  // 3. Process the event
  const currency = order.currency || 'CHF';
  const rawTotal = order.total || 0;
  const rate = profile.commission_rate || 0.10;
  const commission = calculateCommission(rawTotal, rate, currency);
  const occurredAt = order.occurred_at || new Date().toISOString();

  const ticketQuantity = order.quantity ?? (Array.isArray(order.line_items) ? order.line_items.reduce((sum, item) => sum + (item.quantity || 0), 0) : 1);

  // 4. Record cancellation in Supabase
  await supabaseAdmin.from('referral_events').insert({
    event_type: 'cancellation',
    order_id: order.id,
    referral_tag: profile.partner_id,
    event_name: order.event_details?.name || 'Unnamed Event',
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
    eventName: order.event_details?.name || 'Unnamed Event',
    ticketQuantity,
    orderTotalFormatted: formatAmount(rawTotal, currency),
    commissionFormatted: commission.formatted,
    currency,
    occurredAtFormatted: formatDateTime(occurredAt),
  };

  await sendCancellationNotification(notificationData);

  logger.info('Partner cancellation notification dispatched ✓', {
    partner: profile.name,
    orderId: order.id
  });
}

module.exports = { handleOrderCancelled };
