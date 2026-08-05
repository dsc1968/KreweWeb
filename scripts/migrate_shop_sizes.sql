-- migrate_shop_sizes.sql
-- ---------------------------------------------------------------------------
-- One-off, idempotent migration for the per-size shop cart.
--
-- The size / custom_amount / sizes / is_donation COLUMNS and the
-- (user_id, product_id, size) unique index are now applied automatically by
-- scripts/sync_schema.sh from the db-schema.sql snapshot (the sync adds any
-- missing columns via ALTER TABLE ... ADD COLUMN IF NOT EXISTS). The only
-- thing the additive sync cannot do is DROP the obsolete cart uniqueness,
-- which this migration handles.
--
-- Runs before the snapshot, so the old (user_id, product_id) constraint is
-- gone before the new (user_id, product_id, size) unique index is created.
-- ---------------------------------------------------------------------------

ALTER TABLE shop_cart_items DROP CONSTRAINT IF EXISTS shop_cart_items_user_id_product_id_key;

