'use strict';

const crypto = require('crypto');
const axios = require('axios');
require('dotenv').config();

const SECRET = process.env.TICKET_TAILOR_WEBHOOK_SECRET || 'test_secret';
const URL = 'http://localhost:3000/webhook';

async function sendTest(event = 'order.created', referralTag = 'commodity-thursdays') {
  console.log(`\n🚀 Sending test webhook to ${URL}`);
  console.log(`   Event:         ${event}`);
  console.log(`   Referral Tag:  ${referralTag}`);

  const orderId = `ord_TEST_${Date.now()}`;
  
  const payload = {
    event: event,
    data: {
      id: orderId,
      total: 15000,
      currency: 'CHF',
      referral_tag: referralTag,
      occurred_at: new Date().toISOString(),
      event_details: { name: 'Sunbolon Summer Festival' },
      line_items: [{ quantity: 2 }]
    }
  };

  const body = JSON.stringify(payload);
  const signature = crypto
    .createHmac('sha256', SECRET)
    .update(body)
    .digest('hex');

  try {
    const res = await axios.post(URL, body, {
      headers: {
        'Content-Type': 'application/json',
        'X-TT-Signature': signature
      }
    });
    console.log(`\n✅ Response [${res.status}]:`, JSON.stringify(res.data));
    console.log('\n📧 Check your Resend Dashboard or server logs for the notification.');
  } catch (err) {
    console.error(`\n❌ Request failed:`, err.response ? err.response.data : err.message);
  }
}

const event = process.argv[2] || 'order.created';
const tag = process.argv[3] || 'commodity-thursdays';

sendTest(event, tag);
