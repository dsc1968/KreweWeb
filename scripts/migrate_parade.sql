-- Migration: store the latest parade application on a user's profile so the
-- member dashboard can surface "Vendor information" for parade vendors.
--
-- Vendors register by submitting the Join the Parade form. Whether they are a
-- new submitter (a pending vendor login is created) or an existing member who
-- is badged as a vendor, the submitted application is kept here and shown on
-- the dashboard's Vendor tab.
--
-- Run with:  psql "$DATABASE_URL" -f scripts/migrate_parade.sql
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS parade_application jsonb DEFAULT '{}'::jsonb NOT NULL;
