require('dotenv').config();
const { supabaseAdmin } = require('./services/supabaseClient.js');

async function getPassword() {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('name, email, temp_password')
    .ilike('name', '%abubeker%yimam%');
  console.log(data, error);
}

getPassword();
