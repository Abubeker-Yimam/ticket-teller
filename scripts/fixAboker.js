'use strict';

require('dotenv').config();
const { supabaseAdmin } = require('../services/supabaseClient');

async function fix() {
  const correctEmail = 'aboker.y@gmail.com';
  const tag = 'PARTNER_005';

  console.log(`🔧 Fixing profile for ${tag} -> ${correctEmail}...`);

  // 1. Find correct Auth user
  const { data: { users } } = await supabaseAdmin.auth.admin.listUsers();
  const user = users.find(u => u.email === correctEmail);

  if (!user) {
    console.error(`❌ Auth user ${correctEmail} not found.`);
    return;
  }

  // 2. Delete the old "ab@gmail.com" profile if it exists for this tag
  await supabaseAdmin.from('profiles').delete().eq('partner_id', tag);

  // 3. Create the correct profile
  const { error } = await supabaseAdmin.from('profiles').insert({
    id: user.id,
    email: correctEmail,
    name: 'abubeker yimam',
    partner_id: tag,
    role: 'partner',
    commission_rate: 0.10
  });

  if (error) {
    console.error('❌ Fix failed:', error.message);
  } else {
    console.log('✅ Profile fixed! Abubeker should be able to log in now.');
  }
}

fix();
