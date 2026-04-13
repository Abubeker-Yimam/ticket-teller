require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabaseAdmin
    .from('webhook_logs')
    .select('*')
    .order('id', { ascending: false })
    .limit(5);

  if (error) {
    console.error('Error fetching webhook logs:', error);
    return;
  }

  console.log('Last 5 Webhook Logs:');
  data.forEach(log => {
    console.log(`ID: ${log.id}, Event: ${log.tt_event_type}, Order ID: ${log.tt_order_id}`);
    console.log('Payload:', JSON.stringify(log.raw_payload, null, 2));
    console.log('---');
  });
}

run();
