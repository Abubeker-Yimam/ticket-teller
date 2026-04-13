const { supabaseAdmin } = require('./services/supabaseClient');
async function test() {
  const { data: partners, error } = await supabaseAdmin.from('profiles').select('*').eq('role', 'partner');
  console.log('partners:', partners);
}
test();
