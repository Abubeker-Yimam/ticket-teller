-- ============================================================
-- Payout & Partner Payment-Information Schema Migration
-- Referral Hub — SunBolon SA
-- Run this in Supabase SQL Editor (once)
-- ============================================================

-- ─── 1. partner_payment_methods ──────────────────────────────
-- Stores payment info entered by the partner from their own portal.
-- One active record per partner (is_active = true).

CREATE TABLE IF NOT EXISTS public.partner_payment_methods (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  partner_id            text NOT NULL REFERENCES public.profiles(partner_id) ON DELETE CASCADE,
  payment_method_type   text NOT NULL CHECK (payment_method_type IN ('bank_transfer', 'paypal', 'mobile_money', 'other')),
  account_holder_name   text,
  bank_name             text,
  account_number_iban   text,
  swift_bic             text,
  paypal_email          text,
  mobile_money_number   text,
  country               text,
  payment_notes         text,
  is_active             boolean DEFAULT true NOT NULL,
  created_at            timestamptz DEFAULT timezone('utc', now()) NOT NULL,
  updated_at            timestamptz DEFAULT timezone('utc', now()) NOT NULL
);

-- Ensure only one active payment method per partner
CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_payment_active
  ON public.partner_payment_methods(partner_id)
  WHERE is_active = true;

-- General index for lookups
CREATE INDEX IF NOT EXISTS idx_partner_payment_methods_partner
  ON public.partner_payment_methods(partner_id);

-- ─── RLS for partner_payment_methods ─────────────────────────

ALTER TABLE public.partner_payment_methods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Partners can manage their own payment methods" ON public.partner_payment_methods;
CREATE POLICY "Partners can manage their own payment methods"
ON public.partner_payment_methods
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.partner_id = partner_payment_methods.partner_id
  )
);

DROP POLICY IF EXISTS "Admins can view all payment methods" ON public.partner_payment_methods;
CREATE POLICY "Admins can view all payment methods"
ON public.partner_payment_methods
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
  )
);

-- Service role bypass (used by server-side admin operations)
DROP POLICY IF EXISTS "Service role full access payment methods" ON public.partner_payment_methods;
CREATE POLICY "Service role full access payment methods"
ON public.partner_payment_methods
FOR ALL
USING (auth.role() = 'service_role');


-- ─── 2. payout_transactions ──────────────────────────────────
-- Records each admin-initiated payout sent to a partner.

CREATE TABLE IF NOT EXISTS public.payout_transactions (
  id                      uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  partner_id              text NOT NULL REFERENCES public.profiles(partner_id) ON DELETE RESTRICT,
  amount                  numeric(12, 2) NOT NULL CHECK (amount > 0),
  currency                text NOT NULL DEFAULT 'CHF',
  payout_status           text NOT NULL DEFAULT 'pending'
                            CHECK (payout_status IN ('pending', 'processing', 'paid', 'cancelled')),
  payment_method_snapshot jsonb,          -- snapshot of payment details at time of payout
  payment_reference       text,           -- bank ref / transaction ID
  payout_date             date,           -- date payment was sent
  admin_note              text,
  approved_by             uuid REFERENCES public.profiles(id),
  created_at              timestamptz DEFAULT timezone('utc', now()) NOT NULL,
  updated_at              timestamptz DEFAULT timezone('utc', now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payout_transactions_partner
  ON public.payout_transactions(partner_id);

CREATE INDEX IF NOT EXISTS idx_payout_transactions_status
  ON public.payout_transactions(payout_status);

-- ─── RLS for payout_transactions ────────────────────────────

ALTER TABLE public.payout_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Partners can view own payout transactions" ON public.payout_transactions;
CREATE POLICY "Partners can view own payout transactions"
ON public.payout_transactions
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.partner_id = payout_transactions.partner_id
  )
);

DROP POLICY IF EXISTS "Admins can manage all payout transactions" ON public.payout_transactions;
CREATE POLICY "Admins can manage all payout transactions"
ON public.payout_transactions
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
  )
);

DROP POLICY IF EXISTS "Service role full access payout transactions" ON public.payout_transactions;
CREATE POLICY "Service role full access payout transactions"
ON public.payout_transactions
FOR ALL
USING (auth.role() = 'service_role');


-- ─── 3. payout_status_logs ───────────────────────────────────
-- Immutable audit trail for every payout status change and
-- every payment method save/update. Append-only by design.

CREATE TABLE IF NOT EXISTS public.payout_status_logs (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  partner_id    text NOT NULL,
  actor_id      uuid,               -- user who performed the action (null = system)
  actor_role    text,               -- 'admin' | 'partner' | 'system'
  event_type    text NOT NULL,      -- e.g. 'payment_method_saved', 'commission_approved', 'payout_created', 'payout_paid'
  description   text,
  metadata      jsonb,              -- arbitrary context (amounts, refs, etc.)
  ip_address    text,
  created_at    timestamptz DEFAULT timezone('utc', now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payout_status_logs_partner
  ON public.payout_status_logs(partner_id);

CREATE INDEX IF NOT EXISTS idx_payout_status_logs_event
  ON public.payout_status_logs(event_type);

-- ─── RLS for payout_status_logs ─────────────────────────────

ALTER TABLE public.payout_status_logs ENABLE ROW LEVEL SECURITY;

-- Partners see only their own log entries
DROP POLICY IF EXISTS "Partners can view own payout logs" ON public.payout_status_logs;
CREATE POLICY "Partners can view own payout logs"
ON public.payout_status_logs
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.partner_id = payout_status_logs.partner_id
  )
);

-- Admins can see all logs
DROP POLICY IF EXISTS "Admins can view all payout logs" ON public.payout_status_logs;
CREATE POLICY "Admins can view all payout logs"
ON public.payout_status_logs
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
  )
);

-- Only service role can insert (server-side only — no client inserts)
DROP POLICY IF EXISTS "Service role can insert payout logs" ON public.payout_status_logs;
CREATE POLICY "Service role can insert payout logs"
ON public.payout_status_logs
FOR INSERT
WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access payout logs" ON public.payout_status_logs;
CREATE POLICY "Service role full access payout logs"
ON public.payout_status_logs
FOR ALL
USING (auth.role() = 'service_role');


-- ─── 4. Add approved_commission column to referral_events ────
-- Track per-order commission approval status separately from payout_status.
-- 'approved' means admin has confirmed the commission is valid and payable.

ALTER TABLE public.referral_events
  ADD COLUMN IF NOT EXISTS commission_approved boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS commission_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS commission_approved_by uuid;

-- ─── 5. Realtime — enable for payout_transactions ────────────
-- (Run separately in Supabase Dashboard > Database > Replication if needed)
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.payout_transactions;

-- ─── Done ────────────────────────────────────────────────────
-- Tables created:
--   public.partner_payment_methods
--   public.payout_transactions
--   public.payout_status_logs
-- Columns added to referral_events:
--   commission_approved, commission_approved_at, commission_approved_by
