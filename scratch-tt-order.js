require('dotenv').config();
const axios = require('axios');

async function run() {
  try {
    const auth = { username: process.env.TICKET_TAILOR_API_KEY, password: '' };
    const response = await axios.get('https://api.tickettailor.com/v1/orders/or_74300965', { auth });
    console.log("Order retrieved:");
    console.log("referral_tag:", response.data.referral_tag);
    console.log("ref:", response.data.ref);
    // Print payload properties
    console.log(JSON.stringify(response.data, null, 2).split('\n').slice(0, 15).join('\n'));
  } catch (err) {
    console.error("Failed:", err.response?.data || err.message);
  }
}
run();
