'use strict';

require('dotenv').config();
const { supabaseAdmin } = require('../services/supabaseClient');

async function reset() {
  const email = 'aboker.y@gmail.com';
  const newPassword = 'TestPassword123!';

  console.log(`🔐 Resetting password for ${email}...`);

  const { data: { users } } = await supabaseAdmin.auth.admin.listUsers();
  const user = users.find(u => u.email === email);
  
  if (!user) {
    console.error('❌ User not found.'); return;
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, { password: newPassword });

  if (error) {
    console.error('❌ Reset failed:', error.message);
  } else {
    await supabaseAdmin.from('profiles').update({ temp_password: newPassword }).eq('id', user.id);
    console.log(`✅ Password reset to: ${newPassword}`);
  }
}

reset();
