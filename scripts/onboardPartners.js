'use strict';

require('dotenv').config();
const { supabaseAdmin } = require('../services/supabaseClient');
const partnerMap = require('../config/partnerMap.json');

async function onboard() {
  console.log('👥 Syncing partners from partnerMap.json...');

  // 1. Get all current Auth users
  const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers();
  if (listError) throw listError;

  const results = [];

  for (const [tag, info] of Object.entries(partnerMap)) {
    console.log(`\nProcessing ${tag} (${info.email})...`);

    try {
      let user = users.find(u => u.email === info.email);
      let userId;
      let tempPassUsed = false;

      if (user) {
        console.log(` - User exists in Auth.`);
        userId = user.id;
      } else {
        const tempPass = `Temp_Test123!`;
        console.log(` - Creating new Auth user...`);
        const { data: { user: newUser }, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email: info.email,
          password: tempPass,
          email_confirm: true
        });
        if (createError) throw createError;
        userId = newUser.id;
        tempPassUsed = true;
      }

      // 3. Upsert Profile
      const { error: profileError } = await supabaseAdmin.from('profiles').upsert({
        id: userId,
        email: info.email,
        name: info.name,
        partner_id: tag,
        role: 'partner',
        commission_rate: info.commission_rate || 0.10,
        temp_password: tempPassUsed ? 'Temp_Test123!' : null,
        updated_at: new Date()
      });

      if (profileError) throw profileError;

      console.log(` ✅ Profile synced for ${tag}.`);
      results.push({ tag, email: info.email, status: user ? 'Updated' : 'Created' });

    } catch (err) {
      console.error(` ❌ Error for ${tag}:`, err.message);
    }
  }

  console.log('\n✅ Onboarding complete!');
  console.table(results);
}

onboard();
