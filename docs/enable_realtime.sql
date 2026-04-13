-- ══════════════════════════════════════════════════════════
--  Enable Supabase Realtime for Chat Tables
--  Run this in Supabase → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════

-- Step 1: Make sure tables track full row changes (already done in main migration,
-- but run again to be safe)
ALTER TABLE messages      REPLICA IDENTITY FULL;
ALTER TABLE conversations REPLICA IDENTITY FULL;

-- Step 2: Add both tables to the supabase_realtime publication
-- This is what actually enables live events from the database
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;

-- Step 3: Verify it worked — you should see 'messages' and 'conversations' in the results
SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;
