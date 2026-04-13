require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const { handleOrderEvent } = require('./handlers/orderPlaced');

const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  try {
    const auth = { username: process.env.TICKET_TAILOR_API_KEY, password: '' };
    console.log("Fetching last 50 orders from Ticket Tailor...");
    const response = await axios.get('https://api.tickettailor.com/v1/orders', { auth, params: { limit: 50 } });
    
    const orders = response.data.data;
    console.log(`Retrieved ${orders.length} orders.`);

    const { data: dbEvents, error } = await supabaseAdmin.from('referral_events').select('order_id');
    const existingOrders = new Set((dbEvents || []).map(e => e.order_id));

    let synced = 0;
    for (const o of orders) {
      if (!existingOrders.has(o.id) && o.referral_tag) {
        console.log(`Order ${o.id} is missing in DB but has tag ${o.referral_tag}. Syncing...`);
        // Normalize object payload to match webhook string format
        o.currency = o.currency?.code ? o.currency.code.toUpperCase() : 'CHF';
        await handleOrderEvent('order.created', o);
        console.log(`Synced ${o.id}`);
        synced++;
      }
    }
    console.log(`Finished! Synced ${synced} missing orders.`);
  } catch (err) {
    console.error("Error:", err);
  }
  process.exit(0);
}
run();
