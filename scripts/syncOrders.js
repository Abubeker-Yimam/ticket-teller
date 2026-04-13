require('dotenv').config();
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const { handleOrderEvent } = require('../handlers/orderPlaced');
const logger = require('../utils/logger');

// Initialize Admin Supabase Client
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function syncRecentOrders() {
  logger.info('Starting sync of recent Ticket Tailor orders...');
  
  const auth = { username: process.env.TICKET_TAILOR_API_KEY, password: '' };
  
  try {
    // 1. Fetch last 100 orders from Ticket Tailor
    const response = await axios.get('https://api.tickettailor.com/v1/orders', {
      auth,
      params: { limit: 100 }
    });
    
    const orders = response.data.data;
    logger.info(`Fetched ${orders.length} orders from Ticket Tailor.`);

    // 2. Identify missing or "skipped" orders
    const { data: existingEvents } = await supabaseAdmin
      .from('referral_events')
      .select('order_id');
    
    const processedIds = new Set((existingEvents || []).map(e => e.order_id));
    
    let syncedCount = 0;
    
    for (const order of orders) {
      // If order has a referral tag but isn't in our events table, process it
      const referralTag = order.referral_tag || order.ref;
      
      if (referralTag && !processedIds.has(order.id)) {
        logger.info(`Processing missing attributed order: ${order.id} (Tag: ${referralTag})`);
        
        try {
          // Normalize currency if it's an object (API returns object, Webhook returns string or object)
          const normalizedOrder = { ...order };
          if (typeof normalizedOrder.currency === 'object' && normalizedOrder.currency.code) {
            normalizedOrder.currency = normalizedOrder.currency.code.toUpperCase();
          }

          // Trigger the handler (it will insert into referral_events and send email)
          await handleOrderEvent('order.sync', normalizedOrder);
          syncedCount++;
        } catch (err) {
          logger.error(`Failed to sync order ${order.id}`, { error: err.message });
        }
      }
    }
    
    logger.info(`Sync complete. Successfully processed ${syncedCount} missing orders.`);
    
  } catch (err) {
    logger.error('Sync failed', { error: err.message });
  }
}

// Run the sync
syncRecentOrders().then(() => {
  logger.info('Sync process terminated.');
  process.exit(0);
});
