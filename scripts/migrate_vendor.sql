-- Migration: add "vendor" account type support.
--
-- Vendors register for a single parade season (like members) but pay a vendor
-- fee instead of membership dues. They supply company + secondary-contact
-- details at registration and can manage their own float riders.
--
-- This script is idempotent: every statement uses IF NOT EXISTS / ON CONFLICT
-- so it can be re-run safely. The same columns are also created automatically
-- at runtime by backend/config/db.js (ensureContentTable), so this file is
-- provided for operators who prefer to apply schema changes explicitly.
--
-- Run with:  psql "$DATABASE_URL" -f scripts/migrate_vendor.sql

-- 1) Vendor company + secondary-contact details on the profile table.
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS company_name            TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS company_address         TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS company_city            TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS company_state           TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS company_zip             TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS secondary_contact_name  TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS secondary_contact_email TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS secondary_contact_phone TEXT;

-- 2) Per-season vendor-fee paid flag (mirrors dues_paid / guest_fee_paid).
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS vendor_fee_paid       BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS vendor_fee_paid_season INTEGER;

-- 3) Shop products that, when paid for, mark the buyer's (or a chosen vendor's)
--    vendor fee as paid.
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS fulfills_vendor BOOLEAN NOT NULL DEFAULT FALSE;

-- 4) Role model: 'vendor' is a base role. The legacy single `role` column can
--    already hold any string; the runtime code validates it against
--    ALL_ROLES. No schema change is required for the users table.
