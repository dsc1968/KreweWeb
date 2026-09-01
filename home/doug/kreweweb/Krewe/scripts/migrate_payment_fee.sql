-- migrate_payment_fee.sql
-- ---------------------------------------------------------------------------
-- Adds a `payment_fee` column to shop_orders so each order can record the
-- processing fee that was charged for the chosen payment method. This makes
-- the fee visible on orders and lets the store reconcile processor payouts.
--
-- Safe to re-run: the column add is guarded with IF NOT EXISTS.
-- Applied automatically by scripts/sync_schema.sh (it runs every migrate_*.sql).
-- ---------------------------------------------------------------------------

ALTER TABLE public.shop_orders
  ADD COLUMN IF NOT EXISTS payment_fee numeric(10,2) DEFAULT 0 NOT NULL;
