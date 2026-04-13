require('dotenv').config();
const axios = require('axios');

async function run() {
  try {
    const auth = { username: process.env.TICKET_TAILOR_API_KEY, password: '' };
    const response = await axios.get('https://api.tickettailor.com/v1/issued_tickets', { auth, params: { limit: 2 } });
    console.log("Ticket returned:");
    console.log(JSON.stringify(response.data.data[0], null, 2));
  } catch (err) {
    console.error("Failed:", err.response?.data || err.message);
  }
}
run();
