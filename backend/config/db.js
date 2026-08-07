// Database connection + environment-derived configuration constants.
// Split out of the original server.js so the Express app (app.js) and the
// entry point (server.js) can share a single pool and config.
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';
const REGISTRATION_CODE_TTL_MINUTES = Number.parseInt(process.env.REGISTRATION_CODE_TTL_MINUTES || '10', 10);
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number.parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_SECURE = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || '';
const SMTP_REPLY_TO = process.env.SMTP_REPLY_TO || '';
const CONTACT_RECIPIENT = (typeof process.env.CONTACT_RECIPIENT === 'string'
  ? process.env.CONTACT_RECIPIENT.trim().toLowerCase()
  : 'dougscobb@hotmail.com');

// currentSeasonYear is defined in utils/season.js (it depends on resolveSeasonEndDate,
// which also lives there). Import it here for use by ensureContentTable() without
// creating a load-time circular dependency with config/db.
const { currentSeasonYear } = require('../utils/season');

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const LENGTH_VALUE_PATTERN = /^(?:-?\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw)|0)$/;
const BORDER_STYLE_VALUES = new Set(['none', 'solid', 'dashed', 'dotted', 'double']);

function isAdminEditablePagePath(pagePath) {
  return !ADMIN_EDIT_EXCLUDED_PAGES.has(pagePath);
}

function validateEditablePagePath(res, pagePath) {
  if (!isAdminEditablePagePath(pagePath)) {
    res.status(403).json({ error: 'Editing is disabled for this page' });
    return false;
  }
  return true;
}

function normalizeHexColor(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (!HEX_COLOR_PATTERN.test(normalized)) return null;
  return normalized.toLowerCase();
}

function normalizeLengthValue(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return LENGTH_VALUE_PATTERN.test(normalized) ? normalized : null;
}

function normalizeBorderStyle(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return BORDER_STYLE_VALUES.has(normalized) ? normalized : null;
}

function normalizePositionMode(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return ['flow', 'absolute'].includes(normalized) ? normalized : null;
}

function normalizeCoordinate(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const clamped = Math.max(-10000, Math.min(10000, parsed));
  return Math.round(clamped);
}

function normalizeOpacityValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const clamped = Math.max(0, Math.min(1, parsed));
  return String(Math.round(clamped * 1000) / 1000);
}

function listImagesInDirectory(baseDir, currentDir = baseDir, files = []) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  entries.forEach((entry) => {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      listImagesInDirectory(baseDir, fullPath, files);
      return;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(extension)) return;
    const relativePath = path.relative(baseDir, fullPath).split(path.sep).join('/');
    files.push(`/assets/images/${relativePath}`);
  });
  return files;
}

async function ensureContentTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS content_blocks (
      page_path TEXT NOT NULL,
      content_key TEXT NOT NULL,
      content_type TEXT NOT NULL CHECK (content_type IN ('text', 'image')),
      content_value TEXT NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      PRIMARY KEY (page_path, content_key, content_type)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS element_overrides (
      page_path TEXT NOT NULL,
      element_key TEXT NOT NULL,
      hidden BOOLEAN NOT NULL DEFAULT FALSE,
      deleted BOOLEAN NOT NULL DEFAULT FALSE,
      text_align TEXT,
      font_family TEXT,
      font_weight TEXT,
      font_style TEXT,
      text_transform TEXT,
      font_size TEXT,
      opacity_value TEXT,
      text_color TEXT,
      background_color TEXT,
      background_opacity_value TEXT,
      width_value TEXT,
      height_value TEXT,
      border_style TEXT,
      border_width TEXT,
      border_color TEXT,
      border_radius TEXT,
      position_mode TEXT,
      pos_x INTEGER,
      pos_y INTEGER,
      position INTEGER,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      PRIMARY KEY (page_path, element_key)
    )
  `);

  await pool.query(`
    ALTER TABLE element_overrides
    ADD COLUMN IF NOT EXISTS text_color TEXT
  `);

  await pool.query(`
    ALTER TABLE element_overrides
    ADD COLUMN IF NOT EXISTS font_size TEXT
  `);

  await pool.query(`
    ALTER TABLE element_overrides
    ADD COLUMN IF NOT EXISTS opacity_value TEXT
  `);

  await pool.query(`
    ALTER TABLE element_overrides
    ADD COLUMN IF NOT EXISTS font_family TEXT
  `);

  await pool.query(`
    ALTER TABLE element_overrides
    ADD COLUMN IF NOT EXISTS deleted BOOLEAN NOT NULL DEFAULT FALSE
  `);

  await pool.query(`
    ALTER TABLE element_overrides
    ADD COLUMN IF NOT EXISTS background_color TEXT
  `);

  await pool.query(`
    ALTER TABLE element_overrides
    ADD COLUMN IF NOT EXISTS background_opacity_value TEXT
  `);

  await pool.query(`
    ALTER TABLE element_overrides
    ADD COLUMN IF NOT EXISTS width_value TEXT
  `);

  await pool.query(`
    ALTER TABLE element_overrides
    ADD COLUMN IF NOT EXISTS height_value TEXT
  `);

  await pool.query(`
    ALTER TABLE element_overrides
    ADD COLUMN IF NOT EXISTS border_style TEXT
  `);

  await pool.query(`
    ALTER TABLE element_overrides
    ADD COLUMN IF NOT EXISTS border_width TEXT
  `);

  await pool.query(`
    ALTER TABLE element_overrides
    ADD COLUMN IF NOT EXISTS border_color TEXT
  `);

  await pool.query(`
    ALTER TABLE element_overrides
    ADD COLUMN IF NOT EXISTS border_radius TEXT
  `);

  await pool.query(`
    ALTER TABLE element_overrides
    ADD COLUMN IF NOT EXISTS position_mode TEXT
  `);

  await pool.query(`
    ALTER TABLE element_overrides
    ADD COLUMN IF NOT EXISTS pos_x INTEGER
  `);

  await pool.query(`
    ALTER TABLE element_overrides
    ADD COLUMN IF NOT EXISTS pos_y INTEGER
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS page_sections (
      id SERIAL PRIMARY KEY,
      page_path TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      image_path TEXT NOT NULL,
      background_path TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS photo_albums (
      id SERIAL PRIMARY KEY,
      page_path TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      cover_image_path TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS album_images (
      id SERIAL PRIMARY KEY,
      album_id INTEGER NOT NULL REFERENCES photo_albums(id) ON DELETE CASCADE,
      image_path TEXT NOT NULL,
      caption TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS photo_albums_page_position_idx
    ON photo_albums (page_path, position)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS album_images_album_position_idx
    ON album_images (album_id, position)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS calendar_events (
      page_path TEXT NOT NULL,
      day_of_month INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
      title TEXT,
      is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      PRIMARY KEY (page_path, day_of_month)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pending_registrations (
      email TEXT PRIMARY KEY,
      phone TEXT,
      full_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      verification_method TEXT NOT NULL CHECK (verification_method IN ('email', 'phone')),
      verification_target TEXT NOT NULL,
      verification_code TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS pending_registrations_expires_idx
    ON pending_registrations (expires_at)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mfa_challenges (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      method      TEXT NOT NULL CHECK (method IN ('email', 'sms')),
      target      TEXT NOT NULL,
      code        TEXT,
      request_uuid TEXT,
      attempts    INTEGER NOT NULL DEFAULT 0,
      expires_at  TIMESTAMP WITH TIME ZONE NOT NULL,
      created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`ALTER TABLE mfa_challenges ADD COLUMN IF NOT EXISTS request_uuid TEXT;`);
  await pool.query(`ALTER TABLE mfa_challenges ALTER COLUMN code DROP NOT NULL;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      phone TEXT,
      address TEXT,
      spouse_name TEXT,
      kids_names JSONB NOT NULL DEFAULT '[]',
      guest_name TEXT,
      float_riders JSONB NOT NULL DEFAULT '[]',
      member_float_number TEXT,
      spouse_float_number TEXT,
      guest_float_number TEXT,
      kids_float_numbers JSONB NOT NULL DEFAULT '[]',
      rider_float_numbers JSONB NOT NULL DEFAULT '[]',
      rider_float_names JSONB NOT NULL DEFAULT '[]',
      dues_paid BOOLEAN NOT NULL DEFAULT FALSE,
      guest_fee_paid BOOLEAN NOT NULL DEFAULT FALSE,
      beads_paid BOOLEAN NOT NULL DEFAULT FALSE,
      costume_paid BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS floats (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      float_number TEXT,
      captain_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      description TEXT,
      capacity INTEGER,
      riders JSONB NOT NULL DEFAULT '[]',
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // Ensure floats.id is unique. Older deployments created the floats table
  // without a primary key (CREATE TABLE IF NOT EXISTS and sync_schema.sh
  // never add one to an existing table). A foreign key that references
  // floats(id) requires floats(id) to be unique, so add a unique constraint
  // if it is missing. The id column is known to exist (otherwise the FK would
  // fail with a "column does not exist" error instead of 42830).
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'floats' AND column_name = 'id'
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_index i
        WHERE i.indrelid = 'public.floats'::regclass
          AND i.indisunique
          AND i.indnatts = 1
          AND (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = i.indexrelid AND a.attnum = 1) = 'id'
      ) THEN
        ALTER TABLE public.floats ADD UNIQUE (id);
      END IF;
    END $$;
  `);

  // Migrations for existing databases
  for (const col of [
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_method TEXT NOT NULL DEFAULT 'none' CHECK (mfa_method IN ('none', 'email', 'sms'))",
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enrolled BOOLEAN NOT NULL DEFAULT FALSE',
    // Multi-role support: a user can hold one base status (member/guest/admin/
    // disabled) plus additive admin capabilities (store_admin/float_admin/
    // finance_admin). The legacy single `role` column is kept in sync as the
    // derived "primary" role for backward compatibility. Backfill seeds `roles`
    // from the existing single role for pre-existing accounts.
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS roles JSONB NOT NULL DEFAULT '[]'::jsonb",
    "UPDATE users SET roles = to_jsonb(ARRAY[role]) WHERE (roles IS NULL OR roles = '[]'::jsonb) AND role IS NOT NULL",
    // Stash of the role set held before an account was disabled, so enabling it
    // restores every capability the member had rather than a single role.
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS roles_before_disable JSONB',
    'ALTER TABLE pending_registrations ADD COLUMN IF NOT EXISTS desired_mfa_method TEXT',
    'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS member_float_number TEXT',
    'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS spouse_float_number TEXT',
    'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS guest_float_number TEXT',
    "ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS kids_float_numbers JSONB NOT NULL DEFAULT '[]'",
    "ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS rider_float_numbers JSONB NOT NULL DEFAULT '[]'",
    "ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS rider_float_names JSONB NOT NULL DEFAULT '[]'",
    'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS dues_paid BOOLEAN NOT NULL DEFAULT FALSE',
    'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS guest_fee_paid BOOLEAN NOT NULL DEFAULT FALSE',
    'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS beads_paid BOOLEAN NOT NULL DEFAULT FALSE',
    'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS costume_paid BOOLEAN NOT NULL DEFAULT FALSE',
    'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS dues_paid_season INTEGER',
    'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS guest_fee_paid_season INTEGER',
    'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS beads_paid_season INTEGER',
    'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS costume_paid_season INTEGER',
    'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS sponsor_name TEXT',
    'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS city TEXT',
    'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS state TEXT',
    'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS zip TEXT',
    'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS birthdate DATE',
    'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS occupation TEXT',
    'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS organizations TEXT',
    "ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS kids_birthdays JSONB NOT NULL DEFAULT '[]'",
    "ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS grandchildren_names JSONB NOT NULL DEFAULT '[]'",
    "ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS grandchildren_birthdays JSONB NOT NULL DEFAULT '[]'",
    'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS float_captain BOOLEAN NOT NULL DEFAULT FALSE',
    'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS float_description TEXT',
    'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS float_captain_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL',
    'ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS float_id INTEGER REFERENCES floats(id) ON DELETE SET NULL',
    'ALTER TABLE floats ADD COLUMN IF NOT EXISTS capacity INTEGER',
    "ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending'",
  ]) {
    await pool.query(col);
  }

  // One-time migration: backfill season columns from old boolean columns
  {
    const sy = currentSeasonYear();
    await pool.query(`
      UPDATE user_profiles SET
        dues_paid_season        = CASE WHEN dues_paid        = TRUE AND dues_paid_season        IS NULL THEN $1 ELSE dues_paid_season        END,
        guest_fee_paid_season   = CASE WHEN guest_fee_paid   = TRUE AND guest_fee_paid_season   IS NULL THEN $1 ELSE guest_fee_paid_season   END,
        beads_paid_season       = CASE WHEN beads_paid       = TRUE AND beads_paid_season       IS NULL THEN $1 ELSE beads_paid_season       END,
        costume_paid_season     = CASE WHEN costume_paid     = TRUE AND costume_paid_season     IS NULL THEN $1 ELSE costume_paid_season     END
    `, [sy]);
  }

  // ── Site settings table ──────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  // ── Shop tables ─────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shop_products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      price NUMERIC(10,2) NOT NULL DEFAULT 0,
      image_path TEXT,
      category TEXT,
      stock_qty INTEGER,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS shop_cart_items (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES shop_products(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
      added_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, product_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS shop_orders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      buyer_name TEXT NOT NULL,
      buyer_email TEXT NOT NULL,
      total_amount NUMERIC(10,2) NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      payment_status TEXT NOT NULL DEFAULT 'pending',
      notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS shop_order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES shop_products(id) ON DELETE SET NULL,
      product_name TEXT NOT NULL,
      unit_price NUMERIC(10,2) NOT NULL,
      quantity INTEGER NOT NULL
    )
  `);

  // ── Shop migrations: per-item sizes + variable-amount donation product ────
  await pool.query(`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS sizes TEXT`);
  await pool.query(`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS size_label TEXT`);
  await pool.query(`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS is_donation BOOLEAN NOT NULL DEFAULT FALSE`);
  // Products that, when paid for, mark the buyer's (or a chosen member's)
  // membership dues or guest fee as paid on their profile.
  await pool.query(`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS fulfills_membership BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS fulfills_guest BOOLEAN NOT NULL DEFAULT FALSE`);
  // Coupon products: when added to the cart, they discount the eligible
  // products (coupon_product_ids) by either a percentage or a fixed dollar
  // amount (coupon_discount_type / coupon_discount_value).
  await pool.query(`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS is_coupon BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS coupon_discount_type TEXT`);
  await pool.query(`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS coupon_discount_value NUMERIC(10,2)`);
  await pool.query(`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS coupon_product_ids JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await pool.query(`ALTER TABLE shop_cart_items ADD COLUMN IF NOT EXISTS size TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE shop_cart_items ADD COLUMN IF NOT EXISTS custom_amount NUMERIC(10,2)`);
  // The member a membership/guest purchase is credited to (defaults to buyer).
  await pool.query(`ALTER TABLE shop_cart_items ADD COLUMN IF NOT EXISTS beneficiary_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);
  await pool.query(`ALTER TABLE shop_order_items ADD COLUMN IF NOT EXISTS size TEXT`);
  await pool.query(`ALTER TABLE shop_order_items ADD COLUMN IF NOT EXISTS beneficiary_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);
  // The same product in different sizes must be separate cart lines, so the
  // uniqueness key now includes size.
  await pool.query(`ALTER TABLE shop_cart_items DROP CONSTRAINT IF EXISTS shop_cart_items_user_id_product_id_key`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS shop_cart_items_user_product_size_key ON shop_cart_items (user_id, product_id, size)`);
  // Seed the single variable-amount donation product backing the "Donate" option.
  await pool.query(`
    INSERT INTO shop_products (name, description, price, category, active, is_donation, position)
    SELECT 'Donation to Krewe of Mystique', 'Support the Krewe of Mystique with a donation of any amount.', 0, NULL, TRUE, TRUE, 1000
    WHERE NOT EXISTS (SELECT 1 FROM shop_products WHERE is_donation = TRUE)
  `);
}

module.exports = {
  pool,
  JWT_SECRET,
  REGISTRATION_CODE_TTL_MINUTES,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM,
  SMTP_REPLY_TO,
  CONTACT_RECIPIENT,
  ensureContentTable,
};
