'use strict';

const { supabaseAdmin } = require('../services/supabaseClient');
const { sendSaleNotification, sendAdminAlert } = require('../services/emailService');
const { formatAmount, calculateCommission, formatDateTime } = require('../utils/formatCurrency');
const logger = require('../utils/logger');

/**
 * Resolves the human-readable event name from multiple possible payload locations.
 * Ticket Tailor payloads differ slightly between webhooks and API responses.
 */
function resolveEventName(order) {
  // Try each known path in order of preference
  if (order.event_details?.name) return order.event_details.name;
  if (order.event?.name)         return order.event.name;
  if (order.event_summary?.name) return order.event_summary.name;
  if (typeof order.event === 'string' && order.event.trim()) return order.event.trim();
  return 'Unnamed Event';
}

/**
 * Resolves the Ticket Tailor internal event ID from multiple possible
 * payload locations so we can store it for cross-referencing.
 */
function resolveEventId(order) {
  return order.event_details?.event_id
    || order.event_id
    || order.event?.id
    || order.event_series_id
    || null;
}

/**
 * Writes (insert or update) a record to referral_events.
 * Automatically retries without `tt_event_id` if the column doesn't exist yet
 * in the Supabase schema cache (i.e. the migration hasn't run yet).
 */
async function persistEvent(orderId, record, isUpdate) {
  const isMissingColumn = (err) =>
    err?.message?.includes('tt_event_id') ||
    err?.message?.includes('column') && err?.message?.includes('schema cache');

  if (isUpdate) {
    let { error } = await supabaseAdmin
      .from('referral_events')
      .update(record)
      .eq('order_id', orderId);

    if (error && isMissingColumn(error)) {
      const { tt_event_id: _dropped, ...safeRecord } = record;
      logger.warn('tt_event_id column missing — retrying update without it', { orderId });
      ({ error } = await supabaseAdmin.from('referral_events').update(safeRecord).eq('order_id', orderId));
    }
    return error;
  } else {
    let { error } = await supabaseAdmin
      .from('referral_events')
      .insert({ order_id: orderId, ...record });

    if (error && isMissingColumn(error)) {
      const { tt_event_id: _dropped, ...safeRecord } = record;
      logger.warn('tt_event_id column missing — retrying insert without it', { orderId });
      ({ error } = await supabaseAdmin.from('referral_events').insert({ order_id: orderId, ...safeRecord }));
    }
    return error;
  }
}

/**
 * Handles Ticket Tailor Order Events (order.created, order.placed, order.updated).
 */
async function handleOrderEvent(event, order) {
  if (!order || !order.id) {
    logger.warn(`handleOrderEvent: received malformed order object for ${event}`);
    return;
  }

  // Support all known tag field names from Ticket Tailor payloads
  const referralTag = order.referral_tag || order.ref || order.referral || null;
  const discountCode = order.discount_code || null;
  const eventName   = resolveEventName(order);
  const ttEventId   = resolveEventId(order);

  logger.info('handleOrderEvent: processing', {
    event,
    orderId: order.id,
    referralTag,
    discountCode,
    eventName,
    ttEventId,
  });

  // 1. Audit Trail — always record every inbound webhook
  await supabaseAdmin.from('webhook_logs').insert({
    tt_event_type: event,
    tt_order_id: order.id,
    raw_payload: order
  });

  let profile = null;
  let attributionMethod = 'referral_tag';

  // 2. Lookup partner
  if (referralTag) {
    const normalizedTag = referralTag.trim().toLowerCase();
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('name, email, role, partner_id, commission_rate')
      .eq('partner_id', normalizedTag)
      .single();
    profile = data;
  }

  // FALLBACK: If no referral tag (or unknown tag), try matching via Discount Code
  if (!profile && discountCode) {
    const normalizedCode = discountCode.trim().toUpperCase();
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('name, email, role, partner_id, commission_rate')
      .eq('discount_code', normalizedCode)
      .single();
    
    if (data) {
      profile = data;
      attributionMethod = 'discount_code';
      logger.info('Partner matched via Discount Code ✓', { discountCode: normalizedCode, partnerId: profile.partner_id });
    }
  }

  if (!profile) {
    if (referralTag) {
      const normalizedTag = referralTag.trim().toLowerCase();
      logger.warn('Unknown referral tag', { normalizedTag, orderId: order.id });
      
      if (event === 'order.created' || event === 'order.placed') {
        await supabaseAdmin.from('referral_events').insert({
          event_type: 'unknown_tag',
          order_id: order.id,
          referral_tag: referralTag,
          event_name: eventName,
          order_total_raw: order.total,
          currency: order.currency || 'CHF',
          occurred_at: order.occurred_at,
          attribution_method: 'referral_tag'
        });
        await sendAdminAlert(
          `Unknown referral tag: ${referralTag}`,
          `Order ID: ${order.id}\nTag: ${referralTag}\nEvent: ${eventName}`
        );
      }
    } else {
      logger.debug('Order has no referral tag or and no matching discount code — skipping', { orderId: order.id });
    }
    return;
  }

  // 3. Process the Event
  const currency = typeof order.currency === 'object' && order.currency.code 
    ? order.currency.code.toUpperCase() 
    : String(order.currency || 'CHF').toUpperCase();
  const rawTotal = order.total || 0;
  const rate = profile.commission_rate || 0.10;
  const commission = calculateCommission(rawTotal, rate, currency);
  const occurredAt = order.occurred_at || new Date().toISOString();
  const ticketQuantity = order.quantity ?? (Array.isArray(order.line_items) ? order.line_items.reduce((sum, item) => sum + (item.quantity || 0), 0) : 1);

  // 4. Persistence — idempotent upsert keyed on order_id
  const { data: existingEvent } = await supabaseAdmin
    .from('referral_events')
    .select('id')
    .eq('order_id', order.id)
    .single();

  const eventRecord = {
    event_type:      'sale',
    referral_tag:    profile.partner_id,
    event_name:      eventName,
    tt_event_id:     ttEventId,
    ticket_count:    ticketQuantity,
    order_total_raw: rawTotal,
    commission_raw:  commission.raw,
    currency,
    occurred_at:     occurredAt,
    attribution_method: attributionMethod
  };

  if (existingEvent) {
    const updateErr = await persistEvent(order.id, eventRecord, true);
    if (updateErr) {
      logger.error('Failed to update referral event', { error: updateErr.message, orderId: order.id });
      return;
    }
    logger.info('Referral event updated (idempotent) ✓', { orderId: order.id });
  } else {
    const insertErr = await persistEvent(order.id, eventRecord, false);
    if (insertErr) {
      logger.error('Failed to insert referral event', { error: insertErr.message, orderId: order.id });
      return;
    }
    logger.info('Referral event inserted ✓', { orderId: order.id, partner: profile.partner_id });
  }

  // 5. Build and send notification (Only for new creations to avoid double-emailing on updates)
  if (event === 'order.created' || event === 'order.placed') {
    const notificationData = {
      partnerName: profile.name,
      partnerEmail: profile.email,
      orderId: order.id,
      eventName,                         // resolved from all known payload paths
      ticketQuantity,
      orderTotalFormatted: formatAmount(rawTotal, currency),
      commissionFormatted: commission.formatted,
      currency,
      referralTag: profile.partner_id,
      occurredAtFormatted: formatDateTime(occurredAt),
    };

    if (global.activityLogger) {
      global.activityLogger.logActivity(
        null, 'system', 'sale_recorded',
        `New sale for partner ${profile.name} (${profile.partner_id}) - Commission: ${commission.formatted}`,
        { orderId: order.id, commissionRaw: commission.raw, referralTag: profile.partner_id }
      );
    }

    await sendSaleNotification(notificationData);
    logger.info('Partner sale notification dispatched ✓', { partner: profile.name, orderId: order.id });
  } else {
    logger.info('Order update processed (Notification skipped)', { orderId: order.id });
  }
}

module.exports = { handleOrderEvent };
