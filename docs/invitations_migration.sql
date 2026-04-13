-- ══════════════════════════════════════════════════════════
--  INVITATION SYSTEM — SQL MIGRATION
--  Run this in Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════

-- 1. Invitations Table
CREATE TABLE IF NOT EXISTS invitations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL UNIQUE,
  token           text NOT NULL UNIQUE,
  name            text NOT NULL,
  partner_id      text NOT NULL,
  commission_rate text NOT NULL,
  discount_code   text,
  status          text NOT NULL DEFAULT 'pending', -- pending, accepted, expired, revoked
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 2. Add fields to Profiles
-- Check if columns exist before adding (Supabase SQL is Postgres)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='discount_code') THEN
        ALTER TABLE profiles ADD COLUMN discount_code text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='terms_accepted_at') THEN
        ALTER TABLE profiles ADD COLUMN terms_accepted_at timestamptz;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='invitation_id') THEN
        ALTER TABLE profiles ADD COLUMN invitation_id uuid REFERENCES invitations(id);
    END IF;
END$$;

-- 3. RLS for Invitations
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

-- Service role access
CREATE POLICY "service_all" ON invitations FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Index for token lookups
CREATE INDEX IF NOT EXISTS idx_invites_token ON invitations(token);
CREATE INDEX IF NOT EXISTS idx_invites_email ON invitations(email);
