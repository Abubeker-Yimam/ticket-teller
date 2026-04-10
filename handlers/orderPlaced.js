'use strict';

const { supabaseAdmin } = require('../services/supabaseClient');
const { sendSaleNotification, sendAdminAlert } = require('../services/emailService');
const { formatAmount, calculateCommission, formatDateTime } = require('../utils/formatCurrency');
const logger = require('../utils/logger');

/**
 * Handles Ticket Tailor Order Events (CREATED and UPDATED).
 */
async function handleOrderEvent(event, order) {
  if (!order || !order.id) {
    logger.warn(`handleOrderEvent: received malformed order object for ${event}`);
    return;
  }

  const referralTag = order.referral_tag || order.ref || null;

  // 1. Audit Trail
  await supabaseAdmin.from('webhook_logs').insert({
    tt_event_type: event,
    tt_order_id: order.id,
    raw_payload: order
  });

  if (!referralTag) {
    logger.debug('Order has no referral tag — skipping partner logic', { orderId: order.id });
    return;
  }

  // 2. Lookup partner (normalize to lowercase to match our new map)
  const normalizedTag = referralTag.trim().toLowerCase();
  
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select('name, email, role, partner_id, commission_rate')
    .eq('partner_id', normalizedTag)
    .single();

  if (profileErr || !profile) {
    logger.warn('Unknown referral tag', { normalizedTag, orderId: order.id });
    
    // Only record unknown events for creation
    if (event === 'order.created') {
       await supabaseAdmin.from('referral_events').insert({
        event_type: 'unknown_tag',
        order_id: order.id,
        referral_tag: referralTag,
        order_total_raw: order.total,
        currency: order.currency || 'CHF',
        occurred_at: order.occurred_at
      });
      await sendAdminAlert(`Unknown referral tag: ${referralTag}`, `Order ID: ${order.id}\nTag: ${referralTag}`);
    }
    return;
  }

  // 3. Process the Event
  const currency = order.currency || 'CHF';
  const rawTotal = order.total || 0;
  const rate = profile.commission_rate || 0.10;
  const commission = calculateCommission(rawTotal, rate, currency);
  const occurredAt = order.occurred_at || new Date().toISOString();
  const ticketQuantity = order.quantity ?? (Array.isArray(order.line_items) ? order.line_items.reduce((sum, item) => sum + (item.quantity || 0), 0) : 1);

  // 4. Persistence
  // Check if this order already exists to support idempotency (safe for updates)
  const { data: existingEvent } = await supabaseAdmin
    .from('referral_events')
    .select('id')
    .eq('order_id', order.id)
    .single();

  if (existingEvent) {
    // Update existing record
    const { error: updateErr } = await supabaseAdmin.from('referral_events').update({
      event_type: 'sale',
      referral_tag: profile.partner_id,
      event_name: order.event_details?.name || 'Your Event',
      ticket_count: ticketQuantity,
      order_total_raw: rawTotal,
      commission_raw: commission.raw,
      currency,
      occurred_at: occurredAt
    }).eq('order_id', order.id);

    if (updateErr) {
      logger.error('Failed to update referral event', { error: updateErr.message });
      return;
    }
  } else {
    // Insert new record
    const { error: insertErr } = await supabaseAdmin.from('referral_events').insert({
      order_id: order.id,
      event_type: 'sale',
      referral_tag: profile.partner_id,
      event_name: order.event_details?.name || 'Your Event',
      ticket_count: ticketQuantity,
      order_total_raw: rawTotal,
      commission_raw: commission.raw,
      currency,
      occurred_at: occurredAt
    });

    if (insertErr) {
      logger.error('Failed to insert referral event', { error: insertErr.message });
      return;
    }
  }

  // 5. Build and send notification (Only for new creations to avoid double-emailing on updates)
  if (event === 'order.created') {
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
    logger.info('Partner sale notification dispatched ✓', { partner: profile.name, orderId: order.id });
  } else {
    logger.info('Order update processed (Notification skipped)', { orderId: order.id });
  }
}

module.exports = { handleOrderEvent };
