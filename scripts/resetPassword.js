'use strict';

require('dotenv').config();
const { supabaseAdmin } = require('../services/supabaseClient');

async function reset() {
  const email = 'esmael228@gmail.com';
  const newPassword = 'TestPassword123!'; // Use a known password

  console.log(`🔐 Resetting password for ${email}...`);

  // 1. Find user ID
  const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers();
  if (listError) throw listError;
  
  const user = users.find(u => u.email === email);
  if (!user) {
    console.error('❌ User not found in Auth.');
    return;
  }

  // 2. Update password
  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
    user.id,
    { password: newPassword }
  );

  if (updateError) {
    console.error('❌ Reset failed:', updateError.message);
  } else {
    // 3. Mark in profiles
    await supabaseAdmin.from('profiles').update({ 
      temp_password: newPassword,
      updated_at: new Date()
    }).eq('id', user.id);

    console.log(`✅ Password has been reset to: ${newPassword}`);
    console.log('👉 Please log in with this password now.');
  }
}

reset();
