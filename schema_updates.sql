-- 1. Add new columns to profiles table if they don't exist
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS phone text,
ADD COLUMN IF NOT EXISTS company_name text,
ADD COLUMN IF NOT EXISTS address text,
ADD COLUMN IF NOT EXISTS avatar_url text,
ADD COLUMN IF NOT EXISTS communication_prefs jsonb DEFAULT '{"email": true, "sms": false}'::jsonb;

-- Check and replace RLS to allow users to update their own profiles (non-primary columns)
-- Supabase allows UPDATE policies which are evaluated when updating rows
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;

CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- 2. Create system_notifications table
CREATE TABLE IF NOT EXISTS public.system_notifications (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  type text not null, -- 'system', 'message', 'alert'
  title text not null,
  message text not null,
  link text,
  is_read boolean default false not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- RLS for system_notifications
ALTER TABLE public.system_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own notifications" ON public.system_notifications;
CREATE POLICY "Users can view their own notifications"
ON public.system_notifications FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own notifications" ON public.system_notifications;
CREATE POLICY "Users can update their own notifications"
ON public.system_notifications FOR UPDATE
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Server can insert notifications" ON public.system_notifications;
CREATE POLICY "Server can insert notifications"
ON public.system_notifications FOR INSERT
WITH CHECK (true);

-- Enable Realtime for notifications
-- (Depending on Supabase settings, this might require dashboard access to enable via Replication)
BEGIN;
  DROP PUBLICATION IF EXISTS supabase_realtime CASCADE;
  CREATE PUBLICATION supabase_realtime;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.system_notifications;
COMMIT;
