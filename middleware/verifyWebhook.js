'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * Express middleware that verifies the Ticket Tailor webhook HMAC-SHA256 signature.
 *
 * Ticket Tailor signs every webhook payload with a shared secret and sends
 * the hex digest in the "X-Webhook-Signature" (or "X-TT-Signature") header.
 *
 * We re-compute the digest from the raw request body and compare with
 * crypto.timingSafeEqual to prevent timing attacks.
 *
 * IMPORTANT: req.body must be a raw Buffer — do NOT run express.json()
 * before this middleware or the comparison will fail.
 */
function verifyWebhookSignature(req, res, next) {
  const secret = process.env.TICKET_TAILOR_WEBHOOK_SECRET;

  if (!secret) {
    logger.error('TICKET_TAILOR_WEBHOOK_SECRET is not set — cannot verify webhooks');
    return res.status(500).json({ error: 'Server misconfiguration: missing webhook secret' });
  }

  // Ticket Tailor may use either of these header names depending on the plan version
  const receivedSig =
    req.headers['x-webhook-signature'] ||
    req.headers['x-tt-signature'] ||
    req.headers['x-tickettailor-signature'];

  if (!receivedSig) {
    logger.warn('Webhook received without signature header — rejected');
    return res.status(401).json({ error: 'Missing webhook signature' });
  }

  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    logger.warn('Webhook body is empty or not a raw Buffer — rejected');
    return res.status(400).json({ error: 'Empty or malformed body' });
  }

  // Compute expected HMAC-SHA256 digest
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(req.body)
    .digest('hex');

  let signaturesMatch = false;
  try {
    // timingSafeEqual requires both buffers to have the same byte length
    signaturesMatch = crypto.timingSafeEqual(
      Buffer.from(receivedSig.toLowerCase(), 'hex'),
      Buffer.from(expectedSig, 'hex')
    );
  } catch (_) {
    // Buffer length mismatch or invalid hex — treat as invalid
    signaturesMatch = false;
  }

  if (!signaturesMatch) {
    logger.warn('Webhook signature mismatch — rejected', {
      received: receivedSig.substring(0, 12) + '…', // log partial only
    });
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  logger.info('Webhook signature verified ✓');
  next();
}

module.exports = { verifyWebhookSignature };
