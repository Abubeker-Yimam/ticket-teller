require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabaseAdmin
    .from('referral_events')
    .select('*')
    .eq('referral_tag', 'hr-maritime');

  if (error) {
    console.error('Error fetching events:', error);
    return;
  }

  console.log('Events for hr-maritime:', data);
}

run();
