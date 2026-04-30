-- ============================================================
-- Migration 00067: Fix pending_contacts RLS recursion
-- The original policies used a subquery to clinic_users, which
-- triggers infinite recursion because clinic_users has its own
-- RLS policies that also reference clinic_users.
-- Fix: SECURITY DEFINER function that bypasses RLS internally.
-- ============================================================

-- Helper function: get clinic_id for the authenticated user
-- SECURITY DEFINER bypasses RLS on clinic_users, avoiding recursion.
CREATE OR REPLACE FUNCTION public.get_user_clinic_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT clinic_id FROM public.clinic_users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_clinic_id() TO authenticated;

-- Drop old recursive policies
DROP POLICY IF EXISTS "pending_contacts_select" ON pending_contacts;
DROP POLICY IF EXISTS "pending_contacts_update" ON pending_contacts;

-- New policies using the SECURITY DEFINER function
CREATE POLICY "pending_contacts_select" ON pending_contacts
  FOR SELECT TO authenticated
  USING (clinic_id = public.get_user_clinic_id());

CREATE POLICY "pending_contacts_update" ON pending_contacts
  FOR UPDATE TO authenticated
  USING (clinic_id = public.get_user_clinic_id());
