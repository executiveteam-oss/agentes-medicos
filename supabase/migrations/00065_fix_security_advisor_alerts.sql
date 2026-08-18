-- ============================================================
-- Migration 00065: Fix Supabase Security Advisor alerts
-- Enables RLS on tables that were missing it and adds missing policy
-- ============================================================

-- FIX 1: invitations — enable RLS (all access is via service_role)
-- No policies needed: INSERT/SELECT/UPDATE all go through supabaseAdmin
-- which bypasses RLS. Zero policies = invisible to anon/authenticated.
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

-- FIX 2: access_waitlist — enable RLS (all access is via service_role)
-- No policies needed: INSERT goes through server action with supabaseAdmin.
-- No client-side reads exist. Zero policies = invisible to anon/authenticated.
ALTER TABLE access_waitlist ENABLE ROW LEVEL SECURITY;

-- FIX 3: chatbot_conversations — add missing SELECT policy
-- INSERT and UPDATE policies exist (00063) but SELECT was omitted,
-- preventing users from reading their own conversation history.
CREATE POLICY "chatbot_select_own" ON chatbot_conversations
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
