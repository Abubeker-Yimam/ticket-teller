'use strict';
/**
 * migrate_add_tt_event_id.js
 * --------------------------
 * Adds the `tt_event_id` column to the `referral_events` table.
 * This column stores the Ticket Tailor internal event ID for cross-referencing
 * orders back to the originating TT event.
 *
 * Safe to run multiple times — uses IF NOT EXISTS.
 *
 * Usage: node scripts/migrate_add_tt_event_id.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  console.log('Running migration: add tt_event_id to referral_events...');

  const { error } = await supabase.rpc('exec_sql', {
    sql: `
      ALTER TABLE referral_events
      ADD COLUMN IF NOT EXISTS tt_event_id TEXT DEFAULT NULL;
    `
  });

  if (error) {
    // If exec_sql RPC doesn't exist, print the SQL for manual execution
    if (error.message.includes('exec_sql') || error.message.includes('function') || error.code === '42883') {
      console.error('\n⚠️  The exec_sql RPC is not available on this Supabase instance.');
      console.log('\nPlease run the following SQL manually in the Supabase SQL Editor:\n');
      console.log('─'.repeat(60));
      console.log('ALTER TABLE referral_events');
      console.log('ADD COLUMN IF NOT EXISTS tt_event_id TEXT DEFAULT NULL;');
      console.log('─'.repeat(60));
      console.log('\nSQL Editor: https://app.supabase.com/project/_/sql/new');
    } else {
      console.error('Migration failed:', error.message);
      process.exit(1);
    }
  } else {
    console.log('✅ Migration complete: tt_event_id column added (or already exists).');
  }

  process.exit(0);
}

run();
