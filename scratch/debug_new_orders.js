'use strict';
/**
 * debug_new_orders.js
 * -------------------
 * Fetches the most recent orders from Ticket Tailor and checks
 * whether they arrived as webhooks and whether they have a referral_tag.
 *
 * Usage: node scratch/debug_new_orders.js
 */
require('dotenv').config();
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Orders visible in the screenshot as "direct"
const SUSPECT_IDS = ['or_74308965', 'or_74359414', 'or_74357863'];

async function run() {
  const auth = { username: process.env.TICKET_TAILOR_API_KEY, password: '' };

  console.log('\n🔍 Fetching recent orders from Ticket Tailor API...\n');
  const res = await axios.get('https://api.tickettailor.com/v1/orders', {
    auth, params: { limit: 20 }
  });
  const orders = res.data.data;

  // Report referral_tag for suspect orders
  console.log('─── Ticket Tailor API — referral_tag per order ───────────────');
  for (const o of orders) {
    if (SUSPECT_IDS.includes(o.id) || true) { // show all recent ones
      const tag = o.referral_tag || o.ref || null;
      const marker = SUSPECT_IDS.includes(o.id) ? '⚠️ ' : '   ';
      console.log(`${marker}Order ${o.id}  referral_tag="${tag}"  currency="${typeof o.currency === 'object' ? o.currency?.code : o.currency}"  total=${o.total}`);
    }
  }

  console.log('\n─── Supabase webhook_logs — did we receive a webhook? ────────');
  for (const id of SUSPECT_IDS) {
    const { data: logs } = await supabase
      .from('webhook_logs')
      .select('tt_event_type, created_at, raw_payload')
      .eq('tt_order_id', id)
      .order('created_at', { ascending: false });

    if (!logs || logs.length === 0) {
      console.log(`❌ ${id}: NO webhook received at all`);
    } else {
      for (const l of logs) {
        const tag = l.raw_payload?.referral_tag || l.raw_payload?.ref || '(none)';
        console.log(`✅ ${id}: webhook "${l.tt_event_type}" received at ${l.created_at}  referral_tag_in_payload="${tag}"`);
      }
    }
  }

  console.log('\n─── Supabase referral_events — attribution stored? ───────────');
  for (const id of SUSPECT_IDS) {
    const { data: evts } = await supabase
      .from('referral_events')
      .select('event_type, referral_tag, event_name, occurred_at')
      .eq('order_id', id);

    if (!evts || evts.length === 0) {
      console.log(`❌ ${id}: NOT in referral_events`);
    } else {
      for (const e of evts) {
        console.log(`✅ ${id}: type="${e.event_type}"  tag="${e.referral_tag}"  event="${e.event_name}"  at=${e.occurred_at}`);
      }
    }
  }

  console.log('\n─── Netlify deployment status ────────────────────────────────');
  console.log('ℹ️  If webhooks above show "NO webhook received", your new code is NOT');
  console.log('   live on Netlify yet. Run: git add -A && git commit -m "fix: webhook attribution" && git push');

  process.exit(0);
}

run().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
