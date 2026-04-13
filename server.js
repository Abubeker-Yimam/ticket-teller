'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { verifyWebhookSignature } = require('./middleware/verifyWebhook');
const { handleOrderPlaced } = require('./handlers/orderPlaced');
const { handleOrderCancelled } = require('./handlers/orderCancelled');
const { router: apiRouter } = require('./routes/api');
const logger = require('./utils/logger');
const activityLogger = require('./services/activityLogger');
const emailService = require('./services/emailService');

// Hooking to global object for easy access across the system (already referenced in api.js)
global.activityLogger = activityLogger;
global.emailService = emailService;

const app = express();

// ─── Middleware ─────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.static('public'));

// Webhook needs raw body for HMAC signature verification
// This middleware will only run for /webhook
app.use('/webhook', express.raw({ type: 'application/json' }));

// API needs JSON (except for webhook)
app.use(express.json());

// ─── Health Check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'referral-notifier-serverless', ts: new Date().toISOString() });
});

const chatRouter       = require('./routes/chat');
const invitationRouter = require('./routes/invitations');
const payoutsRouter    = require('./routes/payouts');
// ─── Dashboard API ─────────────────────────────────────────────────
app.use('/api', apiRouter);
// ─── Chat API ──────────────────────────────────────────────────────
app.use('/api/chat', chatRouter);
// ─── Invitation API ────────────────────────────────────────────────
app.use('/api/invitations', invitationRouter);
// ─── Payouts API ───────────────────────────────────────────────────
app.use('/api/payouts', payoutsRouter);

// ─── Webhook Endpoint ──────────────────────────────────────────────────────────
app.post(
  '/webhook',
  verifyWebhookSignature,
  async (req, res) => {
    // Acknowledge immediately
    res.status(200).json({ received: true });

    let payload;
    try {
      payload = JSON.parse(req.body.toString('utf8'));
    } catch (parseErr) {
      logger.error('Failed to parse webhook body as JSON', { error: parseErr.message });
      return;
    }

    const { event, data } = payload;
    logger.info('Webhook received', { event, orderId: data?.id });

    try {
      const eventType = (event || '').toLowerCase();
      if (eventType === 'order.created' || eventType === 'order.updated' || eventType === 'order.placed') {
        const { handleOrderEvent } = require('./handlers/orderPlaced');
        await handleOrderEvent(eventType, data);
      } else if (eventType === 'order.cancelled') {
        const { handleOrderCancelled } = require('./handlers/orderCancelled');
        await handleOrderCancelled(data);
      }
    } catch (handlerErr) {
      logger.error('Unhandled error in event handler', { error: handlerErr.message });
    }
  }
);

// ─── Local Development Start ──────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production' && !process.env.NETLIFY) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    logger.info(`Local dev server started on port ${PORT}`);
  });
}

module.exports = app;
