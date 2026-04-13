require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
async function run() {
  const { data, error } = await supabaseAdmin.from('webhook_logs').select('*').limit(5);
  if (error) console.error("Error:", error);
  if (data && data.length > 0) {
    console.log("Columns:", Object.keys(data[0]));
    const target = data.find(d => d.tt_order_id === 'or_74380965');
    if (target) {
      console.log("Target found:", target.raw_payload?.referral_tag, target.raw_payload?.ref);
    } else {
      const { data: d2 } = await supabaseAdmin.from('webhook_logs').select('*').eq('tt_order_id', 'or_74380965');
      if (d2 && d2.length > 0) {
        console.log("Target found directly:", d2[0].raw_payload?.referral_tag, d2[0].raw_payload?.ref);
        console.log("Full payload ref logic:", JSON.stringify(d2[0].raw_payload, null, 2));
      } else {
        console.log("Target missing from webhook logs!");
      }
    }
  }
}
run();
