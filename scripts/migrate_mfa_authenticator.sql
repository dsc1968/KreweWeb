-- Migration: add TOTP "authenticator app" (Google / Microsoft Authenticator)
-- support to the existing MFA system.
--
-- Run ONCE on a deployed database AFTER pulling this code:
--     psql "$DATABASE_URL" -f scripts/migrate_mfa_authenticator.sql
--
-- This is idempotent and safe to re-run:
--   * ADD COLUMN IF NOT EXISTS
--   * DROP CONSTRAINT IF EXISTS before re-adding
-- It does NOT touch any user data.
--
-- NOTE: scripts/sync_schema.sh deliberately skips CHECK-constraint
-- changes (it only adds new columns / guarded objects), so the existing
-- mfa_method / mfa_challenges.method CHECK constraints must be widened
-- here instead.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS mfa_secret text;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_mfa_method_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_mfa_method_check
  CHECK ((mfa_method = ANY (ARRAY['none'::text, 'email'::text, 'sms'::text, 'authenticator'::text])));

ALTER TABLE public.mfa_challenges DROP CONSTRAINT IF EXISTS mfa_challenges_method_check;
ALTER TABLE public.mfa_challenges
  ADD CONSTRAINT mfa_challenges_method_check
  CHECK ((method = ANY (ARRAY['email'::text, 'sms'::text, 'authenticator'::text])));
