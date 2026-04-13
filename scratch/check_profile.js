require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('partner_id', 'hr-maritime');

  if (error) {
    console.error('Error fetching profile:', error);
    return;
  }

  console.log('Profile for hr-maritime:', data);
}

run();
