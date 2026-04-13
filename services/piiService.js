'use strict';

/**
 * piiService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Centralises all PII masking logic and the immutable audit trail for sensitive
 * data access.  This is the ONLY module that may produce unmasked order PII;
 * every other layer receives pre-masked values or goes through canRevealPii().
 */

const { supabaseAdmin } = require('./supabaseClient');
const logger = require('../utils/logger');

// ─── Masking Helpers ──────────────────────────────────────────────────────────

/**
 * Mask a person's full name.
 * e.g. "Jane Doe"  →  "J*** D***"
 *      "Alice"     →  "A****"
 */
function maskName(fullName) {
  if (!fullName || typeof fullName !== 'string') return '*** ***';
  return fullName
    .trim()
    .split(/\s+/)
    .map(word => {
      if (!word) return '';
      return word[0] + '*'.repeat(Math.max(word.length - 1, 3));
    })
    .join(' ');
}

/**
 * Mask an email address.
 * e.g. "jane.doe@example.com"  →  "j***@***.com"
 */
function maskEmail(email) {
  if (!email || typeof email !== 'string') return '***@***.***';
  const [local, domain] = email.split('@');
  if (!domain) return email[0] + '*'.repeat(Math.max(email.length - 1, 5));

  const [domainName, ...tldParts] = domain.split('.');
  const tld = tldParts.join('.');
  return `${local[0]}***@***.${tld || 'com'}`;
}

/**
 * Mask an order ID — keep the last 4 characters visible.
 * e.g. "ord_aBcDeFgH1234"  →  "ORD-****1234"
 *      "abc123"            →  "ORD-****3"
 */
function maskOrderId(orderId) {
  if (!orderId || typeof orderId !== 'string') return 'ORD-****';
  const clean = String(orderId).replace(/^ord_/i, '');
  const tail  = clean.slice(-4);
  return `ORD-****${tail.toUpperCase()}`;
}

/**
 * Generic field masker. Dispatches by type.
 * @param {*}      value  Raw value
 * @param {string} type   'name' | 'email' | 'orderId' | 'phone'
 */
function maskField(value, type) {
  switch (type) {
    case 'name':    return maskName(value);
    case 'email':   return maskEmail(value);
    case 'orderId': return maskOrderId(value);
    case 'phone':   return value ? '***-***-****' : '';
    default:        return '***';
  }
}

// ─── Access Gate ──────────────────────────────────────────────────────────────

/**
 * Returns true if the given profile is allowed to see raw PII.
 * Admins always can; partners need explicit exception.
 *
 * @param {{ role: string, pii_exception_enabled?: boolean }} profile
 */
function canRevealPii(profile) {
  if (!profile) return false;
  if (profile.role === 'admin') return true;
  return profile.pii_exception_enabled === true;
}

// ─── Order Record Masking ─────────────────────────────────────────────────────

/**
 * Takes a raw referral_event row and returns a partner-safe representation.
 * PII fields are masked; financial aggregates remain clear.
 *
 * @param {Object} event        Raw referral_event row
 * @param {boolean} revealPii   If true, PII fields are NOT masked
 * @returns {Object}
 */
function buildOrderRecord(event, revealPii = false) {
  const orderId = event.order_id || '';

  return {
    id:           event.id,
    orderId:      revealPii ? orderId : maskOrderId(orderId),
    orderIdRaw:   revealPii ? orderId : null,  // null unless caller is authorised
    purchaseDate: event.occurred_at,
    eventName:    event.event_name || 'Unknown Event',
    ticketQty:    event.ticket_count || 0,
    grossAmount:  Number(event.order_total_raw || 0),
    discount:     Number(event.discount_raw  || 0),  // 0 until TT exposes it
    commission:   Number(event.commission_raw || 0),
    currency:     event.currency || 'CHF',
    status:       event.event_type === 'cancellation' ? 'cancelled' : 'confirmed',
    referralTag:  event.referral_tag,
    piiRevealed:  revealPii,
  };
}

// ─── Audit Logger ─────────────────────────────────────────────────────────────

/**
 * Writes an immutable record to pii_access_logs.
 * Failures are swallowed & logged — they must never block the caller.
 *
 * @param {Object} params
 * @param {string} params.accessorId    UUID of the user who accessed PII
 * @param {string} params.accessorRole  'admin' | 'partner'
 * @param {string} params.partnerId     Referral tag / partner_id of data owner
 * @param {string} params.orderId       Raw order_id that was revealed
 * @param {string[]} params.fields      Which fields were exposed, e.g. ['orderId','name']
 * @param {string} [params.ipAddress]   Caller IP for forensic trail
 * @param {string} [params.reason]      Optional justification string
 */
async function logPiiAccess({ accessorId, accessorRole, partnerId, orderId, fields, ipAddress, reason }) {
  try {
    const { error } = await supabaseAdmin.from('pii_access_logs').insert({
      accessor_id:   accessorId,
      accessor_role: accessorRole,
      partner_id:    partnerId || null,
      order_id:      orderId,
      fields:        fields || ['orderId'],
      ip_address:    ipAddress || null,
      reason:        reason   || null,
    });

    if (error) {
      logger.error('PII audit log write failed', { error: error.message, accessorId, orderId });
    } else {
      logger.info('PII access logged', { accessorId, accessorRole, orderId, fields });
    }
  } catch (err) {
    logger.error('PII audit log exception', { error: err.message });
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  maskField,
  maskName,
  maskEmail,
  maskOrderId,
  canRevealPii,
  buildOrderRecord,
  logPiiAccess,
};
