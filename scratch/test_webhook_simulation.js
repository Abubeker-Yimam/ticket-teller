'use strict';
/**
 * test_webhook_simulation.js
 * --------------------------
 * Simulates webhook calls for order.created, order.placed, and order.updated
 * to verify:
 *   1. All three event types are handled and persisted correctly.
 *   2. Referral tag is read from multiple field names (referral_tag, ref, referral).
 *   3. Event name is resolved from multiple payload paths.
 *   4. Duplicate calls for the same order_id are idempotent (update, not insert).
 *
 * Usage: node scratch/test_webhook_simulation.js
 *
 * IMPORTANT: Uses .env credentials — will write real records to Supabase.
 * Use a test order ID (e.g. or_TEST_SIM_001) that doesn't conflict with production data.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { handleOrderEvent } = require('../handlers/orderPlaced');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TEST_ORDER_ID = 'or_TEST_SIM_001';

// ── Helpers ──────────────────────────────────────────────────────────────────

function pass(msg) { console.log(`  ✅ PASS: ${msg}`); }
function fail(msg) { console.error(`  ❌ FAIL: ${msg}`); process.exitCode = 1; }

async function cleanUp() {
  await supabase.from('referral_events').delete().eq('order_id', TEST_ORDER_ID);
  await supabase.from('webhook_logs').delete().eq('tt_order_id', TEST_ORDER_ID);
}

async function getReferralEvent() {
  const { data } = await supabase
    .from('referral_events')
    .select('*')
    .eq('order_id', TEST_ORDER_ID);
  return data || [];
}

async function getWebhookLogs() {
  const { data } = await supabase
    .from('webhook_logs')
    .select('*')
    .eq('tt_order_id', TEST_ORDER_ID);
  return data || [];
}

// ── Test Payloads ─────────────────────────────────────────────────────────────

/** Uses `event_details.name` for event name, `referral_tag` for tag */
const payload_OrderCreated = {
  id: TEST_ORDER_ID,
  referral_tag: 'hr-maritime',  // Standard field
  total: 15000,
  currency: 'CHF',
  occurred_at: new Date().toISOString(),
  quantity: 2,
  event_details: { name: 'Maritime Safety Summit', event_id: 'ev_99999' },
};

/** order.placed uses `ref` instead of `referral_tag`, and `event.name` for event name */
const payload_OrderPlaced = {
  id: TEST_ORDER_ID,
  ref: 'hr-maritime',            // Alternative tag field
  total: 15000,
  currency: 'CHF',
  occurred_at: new Date().toISOString(),
  quantity: 2,
  event: { name: 'Maritime Safety Summit', id: 'ev_99999' },
};

/** order.updated — should update existing record, not send email */
const payload_OrderUpdated = {
  id: TEST_ORDER_ID,
  referral_tag: 'hr-maritime',
  total: 16000,                  // Price changed
  currency: 'CHF',
  occurred_at: new Date().toISOString(),
  quantity: 3,
  event_summary: { name: 'Maritime Safety Summit (Updated)' },
};

/** Order with no referral tag — should be logged but not create referral_event */
const payload_DirectOrder = {
  id: 'or_TEST_SIM_DIRECT',
  total: 5000,
  currency: 'CHF',
  occurred_at: new Date().toISOString(),
};

// ── Test Runner ───────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n🧪 Webhook Simulation Test Suite\n');

  // Cleanup before tests
  await cleanUp();
  await supabase.from('referral_events').delete().eq('order_id', 'or_TEST_SIM_DIRECT');
  await supabase.from('webhook_logs').delete().eq('tt_order_id', 'or_TEST_SIM_DIRECT');

  // ── Test 1: order.created ─────────────────────────────────────────────────
  console.log('Test 1: order.created with event_details.name + referral_tag');
  await handleOrderEvent('order.created', payload_OrderCreated);
  {
    const logs = await getWebhookLogs();
    const events = await getReferralEvent();
    logs.length >= 1     ? pass('webhook_logs row created') : fail('webhook_logs row missing');
    events.length === 1  ? pass('referral_events row created') : fail(`referral_events: expected 1, got ${events.length}`);
    events[0]?.referral_tag === 'hr-maritime' ? pass('referral_tag correct')   : fail(`referral_tag: ${events[0]?.referral_tag}`);
    events[0]?.event_name === 'Maritime Safety Summit' ? pass('event_name resolved from event_details') : fail(`event_name: ${events[0]?.event_name}`);
    events[0]?.ticket_count === 2 ? pass('ticket_count correct') : fail(`ticket_count: ${events[0]?.ticket_count}`);
  }

  // ── Test 2: order.placed (idempotency) ───────────────────────────────────
  console.log('\nTest 2: order.placed with `ref` field + event.name (idempotency)');
  await handleOrderEvent('order.placed', payload_OrderPlaced);
  {
    const events = await getReferralEvent();
    events.length === 1 ? pass('still only 1 row (idempotent)') : fail(`referral_events: expected 1, got ${events.length}`);
    events[0]?.referral_tag === 'hr-maritime' ? pass('referral_tag still correct') : fail(`referral_tag: ${events[0]?.referral_tag}`);
  }

  // ── Test 3: order.updated (idempotency + no double email) ────────────────
  console.log('\nTest 3: order.updated — should update totals, skip email');
  await handleOrderEvent('order.updated', payload_OrderUpdated);
  {
    const events = await getReferralEvent();
    events.length === 1 ? pass('still only 1 row after update') : fail(`referral_events: expected 1, got ${events.length}`);
    Number(events[0]?.order_total_raw) === 16000 ? pass('order_total_raw updated') : fail(`order_total_raw: ${events[0]?.order_total_raw}`);
    events[0]?.ticket_count === 3 ? pass('ticket_count updated') : fail(`ticket_count: ${events[0]?.ticket_count}`);
    events[0]?.event_name === 'Maritime Safety Summit (Updated)' ? pass('event_name resolved from event_summary') : fail(`event_name: ${events[0]?.event_name}`);
  }

  // ── Test 4: direct order (no referral tag) ───────────────────────────────
  console.log('\nTest 4: order.created with no referral tag — webhook_log only');
  await handleOrderEvent('order.created', payload_DirectOrder);
  {
    const { data: directLogs } = await supabase
      .from('webhook_logs')
      .select('*')
      .eq('tt_order_id', 'or_TEST_SIM_DIRECT');
    const { data: directEvents } = await supabase
      .from('referral_events')
      .select('*')
      .eq('order_id', 'or_TEST_SIM_DIRECT');

    (directLogs || []).length >= 1 ? pass('direct order logged in webhook_logs') : fail('direct order not logged');
    (directEvents || []).length === 0 ? pass('direct order NOT inserted into referral_events') : fail('direct order incorrectly added to referral_events');
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  console.log('\nCleaning up test data...');
  await cleanUp();
  await supabase.from('referral_events').delete().eq('order_id', 'or_TEST_SIM_DIRECT');
  await supabase.from('webhook_logs').delete().eq('tt_order_id', 'or_TEST_SIM_DIRECT');

  console.log('\n✅ All simulation tests complete.\n');
  process.exit(process.exitCode || 0);
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
