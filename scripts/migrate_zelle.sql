-- Migration: add Zelle payment support to shop_orders
-- Run against an existing database (the canonical schema in db-schema.sql already
-- includes these columns for fresh installs). Safe to re-run.

ALTER TABLE shop_orders
  ADD COLUMN IF NOT EXISTS order_number text,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS zelle_reference text,
  ADD COLUMN IF NOT EXISTS zelle_bank_name text;

-- Ensure uniqueness on generated order numbers (KM-#######).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shop_orders_order_number_key'
  ) THEN
    ALTER TABLE shop_orders ADD CONSTRAINT shop_orders_order_number_key UNIQUE (order_number);
  END IF;
END $$;

-- Backfill order_number for any pre-existing orders that don't have one yet,
-- using the same KM-####### format the app generates for new orders.
UPDATE shop_orders
SET order_number = 'KM-' || lpad(id::text, 7, '0')
WHERE order_number IS NULL OR order_number = '';
