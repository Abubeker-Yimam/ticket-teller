'use strict';

require('dotenv').config();
const { supabaseAdmin } = require('../services/supabaseClient');

async function resetAdmin() {
  const email = 'sunbolonsa@gmail.com';
  const newPassword = 'SunB@2026@#'; // The password you requested

  console.log(`🔐 Resetting Admin password for ${email}...`);

  const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers();
  if (listError) throw listError;
  
  const user = users.find(u => u.email === email);
  if (!user) {
    console.error('❌ Admin user not found in Auth.');
    return;
  }

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
    user.id,
    { password: newPassword }
  );

  if (updateError) {
    console.error('❌ Reset failed:', updateError.message);
  } else {
    // Ensure profile exists too
    await supabaseAdmin.from('profiles').upsert({
      id: user.id,
      email: email,
      role: 'admin',
      updated_at: new Date()
    });
    
    console.log(`✅ Admin password has been reset to: ${newPassword}`);
    console.log('👉 Please try logging in as Admin now.');
  }
}

resetAdmin();
