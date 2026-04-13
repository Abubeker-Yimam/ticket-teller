require('dotenv').config();
const { supabaseAdmin } = require('./services/supabaseClient');

async function test() {
  const { data, error } = await supabaseAdmin.from('referral_events').select('*').order('occurred_at', { ascending: false }).limit(5);
  console.log("EVENTS:", data);

  const { data: profiles } = await supabaseAdmin.from('profiles').select('*');
  console.log("PROFILES:", profiles);
}
test();
