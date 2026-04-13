-- ══════════════════════════════════════════════════════════
--  CHAT SYSTEM — SQL MIGRATION
--  Run this ONCE in Supabase → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════

-- 1. Conversations: one dedicated thread per admin↔partner pair
CREATE TABLE IF NOT EXISTS conversations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id           text NOT NULL,
  partner_user_id      uuid NOT NULL,
  admin_user_id        uuid,
  status               text NOT NULL DEFAULT 'active',
  priority             text NOT NULL DEFAULT 'normal',
  pinned               boolean NOT NULL DEFAULT false,
  unread_admin         int  NOT NULL DEFAULT 0,
  unread_partner       int  NOT NULL DEFAULT 0,
  last_message_at      timestamptz,
  last_message_preview text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- 2. Messages
CREATE TABLE IF NOT EXISTS messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       uuid NOT NULL,
  sender_role     text NOT NULL CHECK (sender_role IN ('admin', 'partner')),
  content         text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4000),
  status          text NOT NULL DEFAULT 'sent',
  is_internal     boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 3. Message read receipts
CREATE TABLE IF NOT EXISTS message_reads (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  read_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(message_id, user_id)
);

-- 4. Notification events
CREATE TABLE IF NOT EXISTS notification_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id    uuid NOT NULL,
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
  message_id      uuid REFERENCES messages(id) ON DELETE SET NULL,
  type            text NOT NULL,
  read            boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 5. Admin internal notes (never shown to partners)
CREATE TABLE IF NOT EXISTS admin_notes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  admin_id        uuid NOT NULL,
  content         text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 6. Conversation tags
CREATE TABLE IF NOT EXISTS conversation_tags (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tag             text NOT NULL
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_messages_conv_time ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_convs_partner      ON conversations(partner_id);
CREATE INDEX IF NOT EXISTS idx_convs_status_time  ON conversations(status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_recipient    ON notification_events(recipient_id, read);

-- Row Level Security (all access goes through /api/chat/* via service role)
ALTER TABLE conversations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages            ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reads       ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_notes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_tags   ENABLE ROW LEVEL SECURITY;

-- Grant full access to service role (used by the Node backend)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='conversations' AND policyname='service_all') THEN
    CREATE POLICY "service_all" ON conversations      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='messages' AND policyname='service_all') THEN
    CREATE POLICY "service_all" ON messages           FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='message_reads' AND policyname='service_all') THEN
    CREATE POLICY "service_all" ON message_reads      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='notification_events' AND policyname='service_all') THEN
    CREATE POLICY "service_all" ON notification_events FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='admin_notes' AND policyname='service_all') THEN
    CREATE POLICY "service_all" ON admin_notes        FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='conversation_tags' AND policyname='service_all') THEN
    CREATE POLICY "service_all" ON conversation_tags  FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END$$;

-- Enable Supabase Realtime (required for live messages + typing indicators)
-- Also go to: Supabase Dashboard → Database → Replication
-- and enable the 'messages' and 'conversations' tables under supabase_realtime publication
ALTER TABLE messages      REPLICA IDENTITY FULL;
ALTER TABLE conversations REPLICA IDENTITY FULL;

-- ══════════════════════════════════════════════════════════
--  SEED DATA FOR TESTING
--  Replace the UUIDs below with real auth.users IDs
--  (create the users in Supabase Dashboard → Authentication first)
-- ══════════════════════════════════════════════════════════
-- INSERT INTO profiles (id, email, name, role, partner_id, commission_rate) VALUES
--   ('<admin-uuid>',  'admin@yourdomain.com', 'Support Admin',  'admin',   null,             null),
--   ('<p1-uuid>',     'alice@example.com',    'Alice Events',   'partner', 'alice-events',   '10%'),
--   ('<p2-uuid>',     'bob@example.com',      'Bob Promotions', 'partner', 'bob-promotions', '12%'),
--   ('<p3-uuid>',     'carol@example.com',    'Carol Arts',     'partner', 'carol-arts',     '8%');
