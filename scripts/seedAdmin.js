'use strict';

require('dotenv').config();
const { supabaseAdmin } = require('../services/supabaseClient');

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error('ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env');
    return;
  }

  console.log(`🚀 Seeding Admin user: ${email}...`);

  // 1. Check if user exists
  const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers();
  if (listError) throw listError;
  
  let user = users.find(u => u.email === email);
  let userId;

  if (user) {
    console.log('✅ Admin user found in Auth.');
    userId = user.id;
  } else {
    console.log('✨ Creating new Admin user...');
    const { data: { user: newUser }, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });
    if (createError) throw createError;
    userId = newUser.id;
  }

  // 2. Upsert profile
  const { error: profileError } = await supabaseAdmin.from('profiles').upsert({
    id: userId,
    email: email,
    role: 'admin',
    updated_at: new Date()
  });

  if (profileError) {
    console.error('❌ Profile error:', profileError.message);
  } else {
    console.log('✅ Admin profile verified in public.profiles table.');
  }

  console.log('\n🎉 Admin setup complete! You can now log in at /login.');
}

seedAdmin();
