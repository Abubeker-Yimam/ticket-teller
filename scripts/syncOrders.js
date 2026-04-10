'use strict';

require('dotenv').config();
const axios = require('axios');
const { supabaseAdmin } = require('../services/supabaseClient');
const { calculateCommission } = require('../utils/formatCurrency');

const TT_API_KEY = process.env.TICKET_TAILOR_API_KEY;
const AUTH = { username: TT_API_KEY, password: '' };

async function sync() {
  console.log('🔄 Starting historical order synchronization...');

  if (!TT_API_KEY) {
    console.error('❌ TICKET_TAILOR_API_KEY not found in .env');
    return;
  }

  try {
    // 1. Fetch all orders from Ticket Tailor
    console.log('📡 Fetching orders from Ticket Tailor...');
    const response = await axios.get('https://api.tickettailor.com/v1/orders', { auth: AUTH });
    const orders = response.data.data;
    console.log(`✅ Fetched ${orders.length} orders.`);

    // 2. Fetch all partner profiles for lookup
    const { data: profiles } = await supabaseAdmin.from('profiles').select('*');
    const partnerMap = profiles.reduce((acc, p) => {
      if (p.partner_id) {
        acc[p.partner_id.toLowerCase()] = p;
      }
      return acc;
    }, {});

    let newCount = 0;
    let skipCount = 0;

    for (const ttOrder of orders) {
      const orderId = ttOrder.id;
      const rawTag = ttOrder.referral_tag || '';
      const normalizedTag = rawTag.trim().toLowerCase();
      const profile = partnerMap[normalizedTag];

      // Determine event type and attribution
      let eventType = 'sale';
      let referralTag = rawTag || 'direct';
      let rate = 0;

      if (profile) {
        rate = profile.commission_rate || 0.10;
        referralTag = profile.partner_id;
      } else if (normalizedTag === 'website_widget') {
        referralTag = 'website_widget';
        rate = 0; // No commission for general widget sales
      } else if (normalizedTag) {
        eventType = 'unknown_tag';
        rate = 0;
      } else {
        referralTag = 'direct';
        rate = 0;
      }

      const currency = (ttOrder.currency?.code || 'CHF').toUpperCase();
      const rawTotal = ttOrder.total || 0;
      const commission = calculateCommission(rawTotal, rate, currency);
      const occurredAt = new Date(ttOrder.created_at * 1000).toISOString();
      const ticketQuantity = ttOrder.line_items?.reduce((sum, item) => sum + (item.quantity || 0), 0) || 1;

      // 3. Upsert into Supabase
      // First check if exists
      const { data: existing } = await supabaseAdmin
        .from('referral_events')
        .select('id')
        .eq('order_id', orderId)
        .single();

      if (!existing) {
        const { error: insertErr } = await supabaseAdmin.from('referral_events').insert({
          order_id: orderId,
          event_type: eventType,
          referral_tag: referralTag,
          event_name: ttOrder.event_summary?.name || 'Historical Sale',
          ticket_count: ticketQuantity,
          order_total_raw: rawTotal,
          commission_raw: commission.raw,
          currency,
          occurred_at: occurredAt
        });

        if (insertErr) {
          console.error(` ❌ Failed to insert ${orderId}:`, insertErr.message);
        } else {
          console.log(` ✅ Imported order ${orderId} (${referralTag})`);
          newCount++;
        }
      } else {
        skipCount++;
      }
    }

    console.log('\n✨ Sync Complete!');
    console.log(` - New orders imported: ${newCount}`);
    console.log(` - Orders skipped (already exist): ${skipCount}`);

  } catch (err) {
    console.error('❌ Sync failed:', err.response ? err.response.data : err.message);
  }
}

sync();
