const path = require('path');
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8000;
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
const CONTACT_RECIPIENT = normalizeEmailAddress(process.env.CONTACT_RECIPIENT || 'dougscobb@hotmail.com');

const smtpTransport = SMTP_HOST && SMTP_PORT && SMTP_FROM
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: SMTP_USER || SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    })
  : null;

function normalizeEmailAddress(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isValidEmailAddress(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generateVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function maskVerificationTarget(target) {
  const [localPart = '', domain = ''] = target.split('@');
  const maskedLocal = localPart.length <= 2 ? `${localPart.charAt(0) || ''}*` : `${localPart.slice(0, 2)}***`;
  return domain ? `${maskedLocal}@${domain}` : 'your email';
}

async function sendVerificationMail({ to, subject, text, html }) {
  if (!smtpTransport) {
    const error = new Error('Email delivery is not configured. Set SMTP_HOST, SMTP_PORT, and SMTP_FROM.');
    error.statusCode = 503;
    throw error;
  }

  await smtpTransport.sendMail({
    from: SMTP_FROM,
    to,
    subject,
    text,
    html,
    replyTo: SMTP_REPLY_TO || undefined,
  });
}

async function dispatchVerificationCode(target, code) {
  const emailSubject = 'Your Krewe Mystique verification code';
  const emailText = [
    'Your verification code is below.',
    '',
    `Code: ${code}`,
    '',
    `This code expires in ${REGISTRATION_CODE_TTL_MINUTES} minutes.`,
    'If you did not request this code, you can ignore this message.',
  ].join('\n');
  const emailHtml = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
      <h2 style="margin-bottom: 0.5rem;">Krewe Mystique verification</h2>
      <p>Your verification code is:</p>
      <p style="font-size: 2rem; font-weight: 700; letter-spacing: 0.2rem; margin: 1rem 0;">${code}</p>
      <p>This code expires in ${REGISTRATION_CODE_TTL_MINUTES} minutes.</p>
      <p>If you did not request this code, you can ignore this message.</p>
    </div>
  `;

  if (smtpTransport) {
    await sendVerificationMail({
      to: target,
      subject: emailSubject,
      text: emailText,
      html: emailHtml,
    });
    return;
  }

  if (process.env.NODE_ENV !== 'production') {
    console.info(`[registration-verification] email code for ${target}: ${code}`);
    return;
  }

  const error = new Error('Email verification is not configured. Set SMTP_HOST, SMTP_PORT, and SMTP_FROM.');
  error.statusCode = 503;
  throw error;
}

function normalizePagePath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return '/';
  const [pathname] = rawPath.split('?');
  if (!pathname || pathname === '/') return '/';
  return pathname.startsWith('/') ? pathname : `/${pathname}`;
}

const ADMIN_EDIT_EXCLUDED_PAGES = new Set([
  '/dashboard.html',
  '/user-management.html',
  '/configuration.html',
  '/backup-restore.html',
  '/shop.html',
  '/shop-admin.html',
]);

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

  // Migrations for existing databases
  for (const col of [
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
  ]) {
    await pool.query(col);
  }

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
}

function isAdmin(req) {
  return Boolean(req.user && req.user.role === 'admin');
}

function isShopManager(req) {
  return Boolean(req.user && (req.user.role === 'admin' || req.user.role === 'store_admin'));
}


app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'app')));

// file upload support for admin image replacement
const fs = require('fs');
const multer = require('multer');
const imagesDir = path.join(__dirname, 'app', 'assets', 'images');
if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, imagesDir);
  },
  filename: function (req, file, cb) {
    // sanitize filename
    const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    // if target provided, use it
    const target = req.body.target;
    if (target) {
      const t = path.basename(target).replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, t);
    } else {
      const name = Date.now() + '_' + safeName;
      cb(null, name);
    }
  }
});
const upload = multer({ storage });

app.get('/api/status', (_req, res) => {
  res.json({ status: 'ok', environment: process.env.NODE_ENV || 'development' });
});

app.post('/api/contact', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const email = normalizeEmailAddress(req.body?.email);
  const subject = typeof req.body?.subject === 'string' ? req.body.subject.trim() : '';
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';

  if (!name || !email || !subject || !message) {
    return res.status(400).json({ error: 'Name, email, subject, and message are required.' });
  }

  if (!isValidEmailAddress(email)) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }

  if (!isValidEmailAddress(CONTACT_RECIPIENT)) {
    return res.status(500).json({ error: 'Contact recipient is not configured correctly.' });
  }

  const normalizedSubject = subject.replace(/\s+/g, ' ').slice(0, 120);
  const normalizedMessage = message.slice(0, 5000);

  const textBody = [
    'New contact form submission',
    '',
    `From: ${name} <${email}>`,
    `Subject: ${normalizedSubject}`,
    '',
    normalizedMessage,
  ].join('\n');

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; line-height: 1.55; color: #111827;">
      <h2 style="margin-bottom: 0.75rem;">New contact form submission</h2>
      <p style="margin: 0.25rem 0;"><strong>From:</strong> ${name} &lt;${email}&gt;</p>
      <p style="margin: 0.25rem 0;"><strong>Subject:</strong> ${normalizedSubject}</p>
      <hr style="margin: 1rem 0; border: none; border-top: 1px solid #e5e7eb;" />
      <p style="white-space: pre-wrap; margin: 0;">${normalizedMessage.replace(/[<>&]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[char]))}</p>
    </div>
  `;

  try {
    if (!smtpTransport) {
      return res.status(503).json({ error: 'Email delivery is not configured. Set SMTP settings first.' });
    }

    await smtpTransport.sendMail({
      from: SMTP_FROM,
      to: CONTACT_RECIPIENT,
      subject: `[Contact] ${normalizedSubject}`,
      text: textBody,
      html: htmlBody,
      replyTo: email,
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Failed to send contact form email', error);
    res.status(500).json({ error: 'Unable to send your message right now.' });
  }
});

app.get('/api/content', async (req, res) => {
  const pagePath = normalizePagePath(req.query.page);
  try {
    const result = await pool.query(
      `SELECT page_path, content_key, content_type, content_value, updated_at
       FROM content_blocks
       WHERE page_path = $1
       ORDER BY updated_at ASC`,
      [pagePath]
    );
    res.json({ pagePath, items: result.rows });
  } catch (error) {
    console.error('Failed to fetch content', error);
    res.status(500).json({ error: 'Unable to fetch content' });
  }
});

app.get('/api/page-sections', async (req, res) => {
  const pagePath = normalizePagePath(req.query.page);

  try {
    const result = await pool.query(
      `SELECT id, page_path, title, body, image_path, background_path, position, created_at, updated_at
       FROM page_sections
       WHERE page_path = $1
       ORDER BY position ASC, id ASC`,
      [pagePath]
    );
    res.json({ pagePath, items: result.rows });
  } catch (error) {
    console.error('Failed to fetch page sections', error);
    res.status(500).json({ error: 'Unable to fetch page sections' });
  }
});

app.get('/api/albums', async (req, res) => {
  const pagePath = normalizePagePath(req.query.page);

  try {
    const result = await pool.query(
      `SELECT
        a.id,
        a.page_path,
        a.title,
        a.description,
        COALESCE(a.cover_image_path, MIN(i.image_path)) AS cover_image_path,
        a.position,
        a.created_at,
        a.updated_at,
        COUNT(i.id)::INTEGER AS image_count
      FROM photo_albums a
      LEFT JOIN album_images i ON i.album_id = a.id
      WHERE a.page_path = $1
      GROUP BY a.id
      ORDER BY a.position ASC, a.id ASC`,
      [pagePath]
    );
    res.json({ pagePath, items: result.rows });
  } catch (error) {
    console.error('Failed to fetch albums', error);
    res.status(500).json({ error: 'Unable to fetch albums' });
  }
});

app.get('/api/albums/:albumId/images', async (req, res) => {
  const albumId = Number.parseInt(req.params.albumId, 10);
  if (!Number.isInteger(albumId) || albumId <= 0) {
    return res.status(400).json({ error: 'Valid album id is required' });
  }

  try {
    const result = await pool.query(
      `SELECT id, album_id, image_path, caption, position, created_at, updated_at
      FROM album_images
      WHERE album_id = $1
      ORDER BY position ASC, id ASC`,
      [albumId]
    );
    res.json({ albumId, items: result.rows });
  } catch (error) {
    console.error('Failed to fetch album images', error);
    res.status(500).json({ error: 'Unable to fetch album images' });
  }
});

app.get('/api/calendar-events', async (req, res) => {
  const pagePath = normalizePagePath(req.query.page);

  try {
    const result = await pool.query(
      `SELECT page_path, day_of_month, title, is_deleted, updated_at
       FROM calendar_events
       WHERE page_path = $1
       ORDER BY day_of_month ASC`,
      [pagePath]
    );
    res.json({ pagePath, items: result.rows });
  } catch (error) {
    console.error('Failed to fetch calendar events', error);
    res.status(500).json({ error: 'Unable to fetch calendar events' });
  }
});

app.get('/api/element-overrides', async (req, res) => {
  const pagePath = normalizePagePath(req.query.page);

  try {
    const result = await pool.query(
            `SELECT page_path, element_key, hidden, deleted, text_align, font_family, font_weight, font_style, text_transform, font_size, opacity_value, text_color,
              background_color, background_opacity_value, width_value, height_value, border_style, border_width, border_color, border_radius,
              position_mode, pos_x, pos_y, position, updated_at
       FROM element_overrides
       WHERE page_path = $1
       ORDER BY position ASC NULLS LAST, updated_at ASC`,
      [pagePath]
    );
    res.json({ pagePath, items: result.rows });
  } catch (error) {
    console.error('Failed to fetch element overrides', error);
    res.status(500).json({ error: 'Unable to fetch element overrides' });
  }
});

function generateToken(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

// Admin image upload (admin only)
app.post('/api/admin/upload-image', authenticateToken, upload.single('image'), (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  // return path relative to static root
  const rel = '/assets/images/' + path.basename(req.file.filename);
  res.json({ path: rel });
});

app.get('/api/admin/images', authenticateToken, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  try {
    const images = listImagesInDirectory(imagesDir).sort((left, right) => left.localeCompare(right));
    res.json({ items: images });
  } catch (error) {
    console.error('Failed to list images', error);
    res.status(500).json({ error: 'Unable to list images' });
  }
});

// File source editor endpoints (admin only) — reads/writes HTML and CSS files under app/
const appDir = path.join(__dirname, 'app');
const fileBackupsDir = path.join(__dirname, '_file_backups');

function resolveEditableFilePath(requestedPath) {
  if (!requestedPath || typeof requestedPath !== 'string') return null;
  const ext = path.extname(requestedPath).toLowerCase();
  if (!['.html', '.css'].includes(ext)) return null;
  const relative = requestedPath.startsWith('/') ? requestedPath.slice(1) : requestedPath;
  const resolved = path.resolve(appDir, relative);
  // Must remain inside the app/ directory
  if (!resolved.startsWith(appDir + path.sep) && resolved !== appDir) return null;
  return resolved;
}

app.get('/api/admin/file-source', authenticateToken, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const filePath = resolveEditableFilePath(req.query.path);
  if (!filePath) return res.status(400).json({ error: 'Valid .html or .css path under app/ is required' });
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ path: req.query.path, content });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    console.error('Failed to read file source', err);
    res.status(500).json({ error: 'Unable to read file' });
  }
});

app.put('/api/admin/file-source', authenticateToken, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const requestedPath = req.body.path;
  const content = req.body.content;
  if (typeof content !== 'string') return res.status(400).json({ error: 'content is required' });
  const filePath = resolveEditableFilePath(requestedPath);
  if (!filePath) return res.status(400).json({ error: 'Valid .html or .css path under app/ is required' });
  try {
    // Write backup before overwriting
    if (!fs.existsSync(fileBackupsDir)) fs.mkdirSync(fileBackupsDir, { recursive: true });
    const ext = path.extname(filePath);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = path.basename(filePath, ext) + '_' + ts + ext;
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, path.join(fileBackupsDir, backupName));
    }
    fs.writeFileSync(filePath, content, 'utf8');
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to write file source', err);
    res.status(500).json({ error: 'Unable to write file' });
  }
});

// Allowlisted .env keys that admins may read/write via the dashboard
const ENV_CONFIG_ALLOWLIST = [
  'REGISTRATION_CODE_TTL_MINUTES',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_FROM',
  'SMTP_REPLY_TO',
  'CONTACT_RECIPIENT',
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'PAYPAL_MODE',
];

const envFilePath = path.join(__dirname, '.env');

// ── Mardi Gras season helpers ─────────────────────────────────────────────
// Ash Wednesday is 46 days before Easter (Gregorian algorithm)
function easterDate(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}
function ashWednesdayDate(year) {
  return new Date(easterDate(year).getTime() - 46 * 24 * 60 * 60 * 1000);
}
// The "season year" is the year of the UPCOMING Ash Wednesday.
// After Ash Wednesday passes, dues are considered due for the next season.
function currentSeasonYear() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const ash = ashWednesdayDate(year);
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return todayMs >= ash.getTime() ? year + 1 : year;
}
function ashWednesdayISO(year) {
  return ashWednesdayDate(year).toISOString().slice(0, 10);
}

function parseEnvFile(content) {
  const map = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    map[key] = value;
  }
  return map;
}

function serializeEnvFile(originalContent, updates) {
  const lines = originalContent.split('\n');
  const written = new Set();

  const result = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) return line;
    const key = trimmed.slice(0, eqIdx).trim();
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      written.add(key);
      const val = updates[key];
      const needsQuotes = val.includes(' ') || val.includes('#') || val.includes('"');
      return `${key}=${needsQuotes ? `"${val.replace(/"/g, '\\"')}"` : val}`;
    }
    return line;
  });

  // Append any keys that weren't already in the file
  for (const key of Object.keys(updates)) {
    if (!written.has(key)) {
      const val = updates[key];
      const needsQuotes = val.includes(' ') || val.includes('#') || val.includes('"');
      result.push(`${key}=${needsQuotes ? `"${val.replace(/"/g, '\\"')}"` : val}`);
    }
  }

  return result.join('\n');
}

app.get('/api/admin/config', authenticateToken, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const content = fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, 'utf8') : '';
    const all = parseEnvFile(content);
    const config = {};
    for (const key of ENV_CONFIG_ALLOWLIST) {
      config[key] = all[key] ?? '';
    }
    res.json({ config, allowlist: ENV_CONFIG_ALLOWLIST });
  } catch (err) {
    console.error('Failed to read config', err);
    res.status(500).json({ error: 'Unable to read config' });
  }
});

app.put('/api/admin/config', authenticateToken, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const updates = req.body.config;
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    return res.status(400).json({ error: 'config object is required' });
  }
  // Strip any keys not on the allowlist
  const safe = {};
  for (const key of ENV_CONFIG_ALLOWLIST) {
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      if (typeof updates[key] !== 'string') return res.status(400).json({ error: `Value for ${key} must be a string` });
      safe[key] = updates[key].trim();
    }
  }
  try {
    const original = fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, 'utf8') : '';
    const updated = serializeEnvFile(original, safe);
    fs.writeFileSync(envFilePath, updated, 'utf8');
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to write config', err);
    res.status(500).json({ error: 'Unable to write config' });
  }
});

// ── Backup / Restore ──────────────────────────────────────────────────────────
const os = require('os');
const archiver = require('archiver');
const unzipper = require('unzipper');

const BACKUP_CONFIG_KEYS = [
  'BACKUP_PROVIDER',
  'BACKUP_LOCAL_PATH',
  'BACKUP_S3_BUCKET',
  'BACKUP_S3_PREFIX',
  'BACKUP_S3_REGION',
  'BACKUP_S3_ENDPOINT',
  'BACKUP_AWS_ACCESS_KEY_ID',
  'BACKUP_AWS_SECRET_ACCESS_KEY',
];

function readBackupConfig() {
  const content = fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, 'utf8') : '';
  const env = parseEnvFile(content);
  const rawLocal = env.BACKUP_LOCAL_PATH || '';
  return {
    provider: env.BACKUP_PROVIDER || 'local',
    localPath: rawLocal
      ? (path.isAbsolute(rawLocal) ? rawLocal : path.resolve(__dirname, rawLocal))
      : path.join(__dirname, '_backups'),
    s3Bucket: env.BACKUP_S3_BUCKET || '',
    s3Prefix: (env.BACKUP_S3_PREFIX || 'krewe-backups').replace(/\/?$/, '/'),
    s3Region: env.BACKUP_S3_REGION || 'us-east-1',
    s3Endpoint: env.BACKUP_S3_ENDPOINT || '',
    s3AccessKeyId: env.BACKUP_AWS_ACCESS_KEY_ID || '',
    s3SecretAccessKey: env.BACKUP_AWS_SECRET_ACCESS_KEY || '',
  };
}

function makeS3Client(cfg) {
  const { S3Client } = require('@aws-sdk/client-s3');
  const clientCfg = { region: cfg.s3Region };
  if (cfg.s3AccessKeyId && cfg.s3SecretAccessKey) {
    clientCfg.credentials = { accessKeyId: cfg.s3AccessKeyId, secretAccessKey: cfg.s3SecretAccessKey };
  }
  if (cfg.s3Endpoint) clientCfg.endpoint = cfg.s3Endpoint;
  return new S3Client(clientCfg);
}

function backupIdSafe(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id);
}

function isSafeColumnName(name) {
  return typeof name === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(name);
}

function zipDirectory(sourceDir, destPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destPath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

async function extractZip(zipPath, destDir) {
  await fs.createReadStream(zipPath).pipe(unzipper.Extract({ path: destDir })).promise();
}

function collectBackupAppFiles(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'images') collectBackupAppFiles(full, results);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (['.html', '.css', '.js'].includes(ext)) results.push(full);
    }
  }
  return results;
}

function removeDir(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) removeDir(full);
    else fs.unlinkSync(full);
  }
  fs.rmdirSync(dirPath);
}

const DB_TABLES_INSERT_ORDER = [
  'users', 'user_profiles', 'pending_registrations',
  'content_blocks', 'element_overrides', 'calendar_events',
  'page_sections', 'photo_albums', 'album_images',
];

async function listLocalBackupsFromDir(localPath) {
  if (!fs.existsSync(localPath)) return [];
  return fs.readdirSync(localPath)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try { return JSON.parse(fs.readFileSync(path.join(localPath, f), 'utf8')); }
      catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => (!a.created_at ? 1 : !b.created_at ? -1 : b.created_at.localeCompare(a.created_at)));
}

async function listS3BackupManifests(cfg) {
  const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
  const client = makeS3Client(cfg);
  const manifests = [];
  let ContinuationToken;
  do {
    const resp = await client.send(new ListObjectsV2Command({ Bucket: cfg.s3Bucket, Prefix: cfg.s3Prefix, ContinuationToken }));
    for (const obj of (resp.Contents || [])) {
      if (!obj.Key.endsWith('.json')) continue;
      try {
        const data = await client.send(new GetObjectCommand({ Bucket: cfg.s3Bucket, Key: obj.Key }));
        manifests.push(JSON.parse(await data.Body.transformToString()));
      } catch {}
    }
    ContinuationToken = resp.NextContinuationToken;
  } while (ContinuationToken);
  return manifests.sort((a, b) => (!a.created_at ? 1 : !b.created_at ? -1 : b.created_at.localeCompare(a.created_at)));
}

app.get('/api/admin/backup-location', authenticateToken, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const content = fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, 'utf8') : '';
    const all = parseEnvFile(content);
    const config = {};
    for (const key of BACKUP_CONFIG_KEYS) config[key] = all[key] ?? '';
    res.json({ config });
  } catch (err) {
    console.error('Failed to read backup location config', err);
    res.status(500).json({ error: 'Unable to read config' });
  }
});

app.put('/api/admin/backup-location', authenticateToken, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const updates = req.body.config;
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    return res.status(400).json({ error: 'config object is required' });
  }
  const safe = {};
  for (const key of BACKUP_CONFIG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      if (typeof updates[key] !== 'string') return res.status(400).json({ error: `Value for ${key} must be a string` });
      safe[key] = updates[key].trim();
    }
  }
  try {
    const original = fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, 'utf8') : '';
    const updated = serializeEnvFile(original, safe);
    fs.writeFileSync(envFilePath, updated, 'utf8');
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to write backup location config', err);
    res.status(500).json({ error: 'Unable to save config' });
  }
});

app.get('/api/admin/backups', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const page = Math.max(1, Number.parseInt(req.query.page || '1', 10));
  const perPage = 10;
  try {
    const cfg = readBackupConfig();
    let all;
    if (cfg.provider === 's3') {
      if (!cfg.s3Bucket) return res.status(400).json({ error: 'S3 bucket is not configured' });
      all = await listS3BackupManifests(cfg);
    } else {
      all = await listLocalBackupsFromDir(cfg.localPath);
    }
    const total = all.length;
    const items = all.slice((page - 1) * perPage, page * perPage);
    res.json({ items, total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)) });
  } catch (err) {
    console.error('Failed to list backups', err);
    res.status(500).json({ error: 'Unable to list backups: ' + err.message });
  }
});

app.post('/api/admin/backups', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const type = req.body.type;
  if (!['files', 'database', 'full'].includes(type)) {
    return res.status(400).json({ error: 'type must be files, database, or full' });
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const id = `backup_${ts}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'krewe-bk-'));
  const tmpZip = path.join(os.tmpdir(), `${id}.zip`);

  try {
    const manifest = { id, type, created_at: new Date().toISOString(), created_by: req.user.email || String(req.user.userId), contains: [] };

    if (type === 'files' || type === 'full') {
      const appFiles = collectBackupAppFiles(appDir);
      for (const src of appFiles) {
        const rel = path.relative(appDir, src);
        const dest = path.join(tmpDir, 'files', 'app', rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
      }
      if (fs.existsSync(envFilePath)) {
        fs.copyFileSync(envFilePath, path.join(tmpDir, 'files', '.env'));
      }
      manifest.contains.push('files');
    }

    if (type === 'database' || type === 'full') {
      const dump = {};
      for (const table of DB_TABLES_INSERT_ORDER) {
        try {
          const result = await pool.query(`SELECT * FROM "${table}" ORDER BY 1`);
          dump[table] = result.rows;
        } catch { dump[table] = []; }
      }
      fs.writeFileSync(path.join(tmpDir, 'database.json'), JSON.stringify(dump, null, 2), 'utf8');
      manifest.contains.push('database');
    }

    fs.writeFileSync(path.join(tmpDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    await zipDirectory(tmpDir, tmpZip);

    const cfg = readBackupConfig();
    if (cfg.provider === 's3') {
      if (!cfg.s3Bucket) return res.status(400).json({ error: 'S3 bucket is not configured' });
      const { PutObjectCommand } = require('@aws-sdk/client-s3');
      const s3 = makeS3Client(cfg);
      await s3.send(new PutObjectCommand({
        Bucket: cfg.s3Bucket, Key: cfg.s3Prefix + id + '.zip',
        Body: fs.readFileSync(tmpZip), ContentType: 'application/zip',
      }));
      await s3.send(new PutObjectCommand({
        Bucket: cfg.s3Bucket, Key: cfg.s3Prefix + id + '.json',
        Body: JSON.stringify(manifest, null, 2), ContentType: 'application/json',
      }));
    } else {
      fs.mkdirSync(cfg.localPath, { recursive: true });
      fs.copyFileSync(tmpZip, path.join(cfg.localPath, id + '.zip'));
      fs.writeFileSync(path.join(cfg.localPath, id + '.json'), JSON.stringify(manifest, null, 2), 'utf8');
    }

    res.status(201).json({ ok: true, backup: manifest });
  } catch (err) {
    console.error('Failed to create backup', err);
    res.status(500).json({ error: 'Unable to create backup: ' + err.message });
  } finally {
    try { removeDir(tmpDir); } catch {}
    try { if (fs.existsSync(tmpZip)) fs.unlinkSync(tmpZip); } catch {}
  }
});

app.post('/api/admin/backups/:id/restore', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const { id } = req.params;
  if (!backupIdSafe(id)) return res.status(400).json({ error: 'Invalid backup id' });
  const scope = req.body.scope;
  if (!['files', 'database', 'full'].includes(scope)) {
    return res.status(400).json({ error: 'scope must be files, database, or full' });
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'krewe-rs-'));
  const tmpZip = path.join(os.tmpdir(), `${id}_restore.zip`);

  try {
    const cfg = readBackupConfig();
    let manifest;

    if (cfg.provider === 's3') {
      if (!cfg.s3Bucket) return res.status(400).json({ error: 'S3 bucket is not configured' });
      const { GetObjectCommand } = require('@aws-sdk/client-s3');
      const s3 = makeS3Client(cfg);
      try {
        const mRes = await s3.send(new GetObjectCommand({ Bucket: cfg.s3Bucket, Key: cfg.s3Prefix + id + '.json' }));
        manifest = JSON.parse(await mRes.Body.transformToString());
      } catch { return res.status(404).json({ error: 'Backup not found' }); }
      const zRes = await s3.send(new GetObjectCommand({ Bucket: cfg.s3Bucket, Key: cfg.s3Prefix + id + '.zip' }));
      fs.writeFileSync(tmpZip, Buffer.from(await zRes.Body.transformToByteArray()));
    } else {
      const localManifest = path.join(cfg.localPath, id + '.json');
      const localZip = path.join(cfg.localPath, id + '.zip');
      if (!localManifest.startsWith(cfg.localPath)) return res.status(400).json({ error: 'Invalid backup id' });
      if (!fs.existsSync(localManifest)) return res.status(404).json({ error: 'Backup not found' });
      manifest = JSON.parse(fs.readFileSync(localManifest, 'utf8'));
      fs.copyFileSync(localZip, tmpZip);
    }

    await extractZip(tmpZip, tmpDir);

    const wantFiles = scope === 'files' || scope === 'full';
    const wantDb = scope === 'database' || scope === 'full';
    const restored = [];

    if (wantFiles) {
      if (!manifest.contains.includes('files')) return res.status(400).json({ error: 'This backup does not contain file data' });
      const srcAppDir = path.join(tmpDir, 'files', 'app');
      if (fs.existsSync(srcAppDir)) {
        const walkRestore = (src, dest) => {
          fs.mkdirSync(dest, { recursive: true });
          for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
            const s = path.join(src, entry.name);
            const d = path.join(dest, entry.name);
            if (entry.isDirectory()) walkRestore(s, d);
            else fs.copyFileSync(s, d);
          }
        };
        walkRestore(srcAppDir, appDir);
      }
      const envSrc = path.join(tmpDir, 'files', '.env');
      if (fs.existsSync(envSrc)) fs.copyFileSync(envSrc, envFilePath);
      restored.push('files');
    }

    if (wantDb) {
      if (!manifest.contains.includes('database')) return res.status(400).json({ error: 'This backup does not contain database data' });
      const dump = JSON.parse(fs.readFileSync(path.join(tmpDir, 'database.json'), 'utf8'));
      const pgClient = await pool.connect();
      try {
        await pgClient.query('BEGIN');
        for (const table of [...DB_TABLES_INSERT_ORDER].reverse()) {
          try { await pgClient.query(`TRUNCATE "${table}" RESTART IDENTITY CASCADE`); } catch {}
        }
        for (const table of DB_TABLES_INSERT_ORDER) {
          const rows = dump[table];
          if (!Array.isArray(rows) || rows.length === 0) continue;
          for (const row of rows) {
            const cols = Object.keys(row).filter(isSafeColumnName);
            if (cols.length === 0) continue;
            const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
            await pgClient.query(
              `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
              cols.map((c) => row[c])
            );
          }
        }
        await pgClient.query('COMMIT');
        restored.push('database');
      } catch (err) {
        await pgClient.query('ROLLBACK');
        throw err;
      } finally {
        pgClient.release();
      }
    }

    if (restored.length === 0) return res.status(400).json({ error: 'Nothing was restored' });
    res.json({ ok: true, restored });
  } catch (err) {
    console.error('Failed to restore backup', err);
    res.status(500).json({ error: 'Restore failed: ' + err.message });
  } finally {
    try { removeDir(tmpDir); } catch {}
    try { if (fs.existsSync(tmpZip)) fs.unlinkSync(tmpZip); } catch {}
  }
});

app.delete('/api/admin/backups/:id', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const { id } = req.params;
  if (!backupIdSafe(id)) return res.status(400).json({ error: 'Invalid backup id' });

  try {
    const cfg = readBackupConfig();
    if (cfg.provider === 's3') {
      if (!cfg.s3Bucket) return res.status(400).json({ error: 'S3 bucket is not configured' });
      const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
      const s3 = makeS3Client(cfg);
      await s3.send(new DeleteObjectCommand({ Bucket: cfg.s3Bucket, Key: cfg.s3Prefix + id + '.zip' }));
      await s3.send(new DeleteObjectCommand({ Bucket: cfg.s3Bucket, Key: cfg.s3Prefix + id + '.json' }));
    } else {
      const localZip = path.join(cfg.localPath, id + '.zip');
      const localJson = path.join(cfg.localPath, id + '.json');
      if (!localJson.startsWith(cfg.localPath)) return res.status(400).json({ error: 'Invalid backup id' });
      if (!fs.existsSync(localJson)) return res.status(404).json({ error: 'Backup not found' });
      if (fs.existsSync(localZip)) fs.unlinkSync(localZip);
      fs.unlinkSync(localJson);
    }
    res.json({ ok: true, deleted: id });
  } catch (err) {
    console.error('Failed to delete backup', err);
    res.status(500).json({ error: 'Unable to delete backup: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────

app.put('/api/admin/content', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const pagePath = normalizePagePath(req.body.pagePath);
  if (!validateEditablePagePath(res, pagePath)) return;
  const { contentKey, contentType, contentValue } = req.body;

  if (!contentKey || typeof contentKey !== 'string') {
    return res.status(400).json({ error: 'Content key is required' });
  }

  if (!['text', 'image'].includes(contentType)) {
    return res.status(400).json({ error: 'Content type must be text or image' });
  }

  if (typeof contentValue !== 'string') {
    return res.status(400).json({ error: 'Content value is required' });
  }

  const normalizedContentValue = contentValue.trim();

  try {
    const result = await pool.query(
      `INSERT INTO content_blocks (page_path, content_key, content_type, content_value, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, NOW(), $5)
       ON CONFLICT (page_path, content_key, content_type)
       DO UPDATE SET content_value = EXCLUDED.content_value, updated_at = NOW(), updated_by = EXCLUDED.updated_by
       RETURNING page_path, content_key, content_type, content_value, updated_at`,
      [pagePath, contentKey, contentType, normalizedContentValue, req.user.userId]
    );

    res.json({ item: result.rows[0] });
  } catch (error) {
    console.error('Failed to save content', error);
    res.status(500).json({ error: 'Unable to save content' });
  }
});

app.put('/api/admin/calendar-events', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const pagePath = normalizePagePath(req.body.pagePath);
  if (!validateEditablePagePath(res, pagePath)) return;
  const dayOfMonth = Number.parseInt(req.body.dayOfMonth, 10);
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';

  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
    return res.status(400).json({ error: 'Valid day of month is required' });
  }

  if (!title) {
    return res.status(400).json({ error: 'Event title is required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO calendar_events (page_path, day_of_month, title, is_deleted, updated_at, updated_by)
       VALUES ($1, $2, $3, FALSE, NOW(), $4)
       ON CONFLICT (page_path, day_of_month)
       DO UPDATE SET
         title = EXCLUDED.title,
         is_deleted = FALSE,
         updated_at = NOW(),
         updated_by = EXCLUDED.updated_by
       RETURNING page_path, day_of_month, title, is_deleted, updated_at`,
      [pagePath, dayOfMonth, title, req.user.userId]
    );

    res.json({ item: result.rows[0] });
  } catch (error) {
    console.error('Failed to save calendar event', error);
    res.status(500).json({ error: 'Unable to save calendar event' });
  }
});

app.delete('/api/admin/calendar-events', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const pagePath = normalizePagePath(req.body.pagePath);
  if (!validateEditablePagePath(res, pagePath)) return;
  const dayOfMonth = Number.parseInt(req.body.dayOfMonth, 10);

  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
    return res.status(400).json({ error: 'Valid day of month is required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO calendar_events (page_path, day_of_month, title, is_deleted, updated_at, updated_by)
       VALUES ($1, $2, NULL, TRUE, NOW(), $3)
       ON CONFLICT (page_path, day_of_month)
       DO UPDATE SET
         title = NULL,
         is_deleted = TRUE,
         updated_at = NOW(),
         updated_by = EXCLUDED.updated_by
       RETURNING page_path, day_of_month, title, is_deleted, updated_at`,
      [pagePath, dayOfMonth, req.user.userId]
    );

    res.json({ item: result.rows[0], deleted: true });
  } catch (error) {
    console.error('Failed to delete calendar event', error);
    res.status(500).json({ error: 'Unable to delete calendar event' });
  }
});

app.delete('/api/admin/content', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const pagePath = normalizePagePath(req.body.pagePath);
  if (!validateEditablePagePath(res, pagePath)) return;
  const { contentKey, contentType } = req.body;

  if (!contentKey || typeof contentKey !== 'string') {
    return res.status(400).json({ error: 'Content key is required' });
  }

  if (!['text', 'image'].includes(contentType)) {
    return res.status(400).json({ error: 'Content type must be text or image' });
  }

  try {
    const result = await pool.query(
      'DELETE FROM content_blocks WHERE page_path = $1 AND content_key = $2 AND content_type = $3 RETURNING page_path, content_key, content_type',
      [pagePath, contentKey, contentType]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Content not found' });
    }

    res.json({ deleted: true, item: result.rows[0] });
  } catch (error) {
    console.error('Failed to delete content', error);
    res.status(500).json({ error: 'Unable to delete content' });
  }
});

app.post('/api/admin/content/new', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const pagePath = normalizePagePath(req.body.pagePath);
  if (!validateEditablePagePath(res, pagePath)) return;
  const { parentKey, contentType, contentValue } = req.body;

  if (!parentKey || typeof parentKey !== 'string') {
    return res.status(400).json({ error: 'Parent key is required' });
  }

  if (!['text', 'image'].includes(contentType)) {
    return res.status(400).json({ error: 'Content type must be text or image' });
  }

  if (typeof contentValue !== 'string') {
    return res.status(400).json({ error: 'Content value is required' });
  }

  const normalizedContentValue = contentValue.trim();
  if (contentType === 'text' && !normalizedContentValue) {
    return res.status(400).json({ error: 'Content value cannot be empty' });
  }

  try {
    // Generate a unique key for the new element
    const timestamp = Date.now();
    const contentKey = `${parentKey}>dynamic-${contentType}-${timestamp}|${contentType}`;

    const result = await pool.query(
      `INSERT INTO content_blocks (page_path, content_key, content_type, content_value, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, NOW(), $5)
       RETURNING page_path, content_key, content_type, content_value, updated_at`,
      [pagePath, contentKey, contentType, normalizedContentValue, req.user.userId]
    );

    res.json({ item: result.rows[0] });
  } catch (error) {
    console.error('Failed to create new content', error);
    res.status(500).json({ error: 'Unable to create new content' });
  }
});

app.put('/api/admin/content/move', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const pagePath = normalizePagePath(req.body.pagePath);
  if (!validateEditablePagePath(res, pagePath)) return;

  const oldContentKey = typeof req.body.oldContentKey === 'string' ? req.body.oldContentKey.trim() : '';
  const newParentKey = typeof req.body.newParentKey === 'string' ? req.body.newParentKey.trim() : '';
  const contentType = typeof req.body.contentType === 'string' ? req.body.contentType.trim() : '';

  if (!oldContentKey) {
    return res.status(400).json({ error: 'Source content key is required' });
  }

  if (!newParentKey) {
    return res.status(400).json({ error: 'Destination parent key is required' });
  }

  if (!['text', 'image'].includes(contentType)) {
    return res.status(400).json({ error: 'Content type must be text or image' });
  }

  const oldKeyParts = oldContentKey.split('>');
  const suffix = oldKeyParts[oldKeyParts.length - 1] || '';
  if (!suffix || !suffix.endsWith(`|${contentType}`)) {
    return res.status(400).json({ error: 'Content key does not match the requested content type' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sourceResult = await client.query(
      `SELECT page_path, content_key, content_type, content_value, updated_at
       FROM content_blocks
       WHERE page_path = $1 AND content_key = $2 AND content_type = $3
       FOR UPDATE`,
      [pagePath, oldContentKey, contentType]
    );

    if (sourceResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Content not found' });
    }

    let nextContentKey = `${newParentKey}>${suffix}`;
    if (nextContentKey === oldContentKey) {
      await client.query('COMMIT');
      return res.json({ item: sourceResult.rows[0] });
    }

    const conflictCheck = await client.query(
      `SELECT 1
       FROM content_blocks
       WHERE page_path = $1 AND content_key = $2 AND content_type = $3`,
      [pagePath, nextContentKey, contentType]
    );

    if (conflictCheck.rowCount > 0) {
      const timestamp = Date.now();
      nextContentKey = `${newParentKey}>dynamic-${contentType}-${timestamp}|${contentType}`;
    }

    const updateResult = await client.query(
      `UPDATE content_blocks
       SET content_key = $1, updated_at = NOW(), updated_by = $2
       WHERE page_path = $3 AND content_key = $4 AND content_type = $5
       RETURNING page_path, content_key, content_type, content_value, updated_at`,
      [nextContentKey, req.user.userId, pagePath, oldContentKey, contentType]
    );

    await client.query(
      `UPDATE element_overrides
       SET element_key = $1, updated_at = NOW(), updated_by = $2
       WHERE page_path = $3 AND element_key = $4`,
      [nextContentKey, req.user.userId, pagePath, oldContentKey]
    );

    await client.query('COMMIT');
    res.json({ item: updateResult.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to move content', error);
    res.status(500).json({ error: 'Unable to move content' });
  } finally {
    client.release();
  }
});

app.post('/api/admin/page-sections', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const pagePath = normalizePagePath(req.body.pagePath);
  if (!validateEditablePagePath(res, pagePath)) return;
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';

  try {
    const positionResult = await pool.query(
      'SELECT COALESCE(MAX(position), 0) + 1 AS next_position FROM page_sections WHERE page_path = $1',
      [pagePath]
    );
    const nextPosition = positionResult.rows[0].next_position;

    const result = await pool.query(
      `INSERT INTO page_sections (page_path, title, body, image_path, background_path, position, created_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING id, page_path, title, body, image_path, background_path, position, created_at, updated_at`,
      [
        pagePath,
        title,
        body,
        '',
        null,
        nextPosition,
        req.user.userId,
      ]
    );

    res.status(201).json({ item: result.rows[0] });
  } catch (error) {
    console.error('Failed to create page section', error);
    res.status(500).json({ error: 'Unable to create page section' });
  }
});

app.put('/api/admin/element-overrides', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const pagePath = normalizePagePath(req.body.pagePath);
  if (!validateEditablePagePath(res, pagePath)) return;
  const elementKey = typeof req.body.elementKey === 'string' ? req.body.elementKey.trim() : '';
  if (!elementKey) {
    return res.status(400).json({ error: 'Element key is required' });
  }

  const hidden = Boolean(req.body.hidden);
  const deleted = Boolean(req.body.deleted);
  const textAlign = typeof req.body.textAlign === 'string' && req.body.textAlign ? req.body.textAlign : null;
  const fontFamily = typeof req.body.fontFamily === 'string' && req.body.fontFamily.trim() ? req.body.fontFamily.trim() : null;
  const fontWeight = typeof req.body.fontWeight === 'string' && req.body.fontWeight ? req.body.fontWeight : null;
  const fontStyle = typeof req.body.fontStyle === 'string' && req.body.fontStyle ? req.body.fontStyle : null;
  const textTransform = typeof req.body.textTransform === 'string' && req.body.textTransform ? req.body.textTransform : null;
  const fontSize = normalizeLengthValue(req.body.fontSize);
  const opacityValue = normalizeOpacityValue(req.body.opacityValue);
  const textColor = normalizeHexColor(req.body.textColor);
  const backgroundColor = normalizeHexColor(req.body.backgroundColor);
  const backgroundOpacityValue = normalizeOpacityValue(req.body.backgroundOpacityValue);
  const widthValue = normalizeLengthValue(req.body.widthValue);
  const heightValue = normalizeLengthValue(req.body.heightValue);
  const borderStyle = normalizeBorderStyle(req.body.borderStyle);
  const borderWidth = normalizeLengthValue(req.body.borderWidth);
  const borderColor = normalizeHexColor(req.body.borderColor);
  const borderRadius = normalizeLengthValue(req.body.borderRadius);
  const positionMode = normalizePositionMode(req.body.positionMode);
  const posX = normalizeCoordinate(req.body.posX);
  const posY = normalizeCoordinate(req.body.posY);
  const position = Number.isInteger(req.body.position) ? req.body.position : null;

  try {
    const result = await pool.query(
      `INSERT INTO element_overrides (
        page_path, element_key, hidden, deleted, text_align, font_family, font_weight, font_style, text_transform, font_size, opacity_value, text_color,
        background_color, background_opacity_value, width_value, height_value, border_style, border_width, border_color, border_radius,
        position_mode, pos_x, pos_y, position, updated_at, updated_by
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, NOW(), $25)
       ON CONFLICT (page_path, element_key)
       DO UPDATE SET
         hidden = EXCLUDED.hidden,
         deleted = EXCLUDED.deleted,
         text_align = EXCLUDED.text_align,
         font_family = EXCLUDED.font_family,
         font_weight = EXCLUDED.font_weight,
         font_style = EXCLUDED.font_style,
         text_transform = EXCLUDED.text_transform,
         font_size = EXCLUDED.font_size,
         opacity_value = EXCLUDED.opacity_value,
         text_color = EXCLUDED.text_color,
         background_color = EXCLUDED.background_color,
         background_opacity_value = EXCLUDED.background_opacity_value,
         width_value = EXCLUDED.width_value,
         height_value = EXCLUDED.height_value,
         border_style = EXCLUDED.border_style,
         border_width = EXCLUDED.border_width,
         border_color = EXCLUDED.border_color,
         border_radius = EXCLUDED.border_radius,
         position_mode = EXCLUDED.position_mode,
         pos_x = EXCLUDED.pos_x,
         pos_y = EXCLUDED.pos_y,
         position = EXCLUDED.position,
         updated_at = NOW(),
         updated_by = EXCLUDED.updated_by
      RETURNING page_path, element_key, hidden, deleted, text_align, font_family, font_weight, font_style, text_transform, font_size, opacity_value, text_color,
             background_color, background_opacity_value, width_value, height_value, border_style, border_width, border_color, border_radius,
                 position_mode, pos_x, pos_y, position, updated_at`,
      [
        pagePath,
        elementKey,
        hidden,
        deleted,
        textAlign,
        fontFamily,
        fontWeight,
        fontStyle,
        textTransform,
        fontSize,
        opacityValue,
        textColor,
        backgroundColor,
        backgroundOpacityValue,
        widthValue,
        heightValue,
        borderStyle,
        borderWidth,
        borderColor,
        borderRadius,
        positionMode,
        posX,
        posY,
        position,
        req.user.userId,
      ]
    );
    res.json({ item: result.rows[0] });
  } catch (error) {
    console.error('Failed to save element override', error);
    res.status(500).json({ error: 'Unable to save element override' });
  }
});

app.put('/api/admin/page-sections/:sectionId(\\d+)', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const sectionId = Number.parseInt(req.params.sectionId, 10);
  if (!Number.isInteger(sectionId) || sectionId <= 0) {
    return res.status(400).json({ error: 'Valid section id is required' });
  }

  const allowedFields = new Map([
    ['title', 'title'],
    ['body', 'body'],
    ['image_path', 'image_path'],
    ['background_path', 'background_path'],
  ]);

  const field = allowedFields.get(req.body.field);
  const value = typeof req.body.value === 'string' ? req.body.value.trim() : '';

  if (!field) {
    return res.status(400).json({ error: 'Unsupported section field' });
  }

  // Empty string is allowed for title/body so editor delete can clear those fields.

  // image_path is NOT NULL in the schema; keep empty string when clearing image.
  const persistedValue = field === 'background_path' ? (value || null) : value;

  try {
    const sectionLookup = await pool.query('SELECT page_path FROM page_sections WHERE id = $1', [sectionId]);
    if (sectionLookup.rowCount === 0) {
      return res.status(404).json({ error: 'Section not found' });
    }

    if (!validateEditablePagePath(res, normalizePagePath(sectionLookup.rows[0].page_path))) return;

    const result = await pool.query(
      `UPDATE page_sections
       SET ${field} = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, page_path, title, body, image_path, background_path, position, created_at, updated_at`,
      [persistedValue, sectionId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Section not found' });
    }

    res.json({ item: result.rows[0] });
  } catch (error) {
    console.error('Failed to update page section', error);
    res.status(500).json({ error: 'Unable to update page section' });
  }
});

app.delete('/api/admin/page-sections/:sectionId(\\d+)', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const sectionId = Number.parseInt(req.params.sectionId, 10);
  if (!Number.isInteger(sectionId) || sectionId <= 0) {
    return res.status(400).json({ error: 'Valid section id is required' });
  }

  try {
    const sectionLookup = await pool.query('SELECT page_path FROM page_sections WHERE id = $1', [sectionId]);
    if (sectionLookup.rowCount === 0) {
      return res.status(404).json({ error: 'Section not found' });
    }

    if (!validateEditablePagePath(res, normalizePagePath(sectionLookup.rows[0].page_path))) return;

    const result = await pool.query('DELETE FROM page_sections WHERE id = $1 RETURNING id', [sectionId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Section not found' });
    }

    res.json({ deleted: true, id: sectionId });
  } catch (error) {
    console.error('Failed to delete page section', error);
    res.status(500).json({ error: 'Unable to delete page section' });
  }
});

app.put('/api/admin/page-sections/reorder', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const orderedIds = Array.isArray(req.body.orderedIds) ? req.body.orderedIds : [];
  const cleanIds = orderedIds
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (cleanIds.length === 0) {
    return res.status(400).json({ error: 'Ordered section ids are required' });
  }

  const client = await pool.connect();
  try {
    const pagePathLookup = await client.query(
      'SELECT DISTINCT page_path FROM page_sections WHERE id = ANY($1::int[])',
      [cleanIds]
    );
    const blocked = pagePathLookup.rows.some((row) => !isAdminEditablePagePath(normalizePagePath(row.page_path)));
    if (blocked) {
      return res.status(403).json({ error: 'Editing is disabled for one or more selected pages' });
    }

    await client.query('BEGIN');
    for (let index = 0; index < cleanIds.length; index += 1) {
      await client.query('UPDATE page_sections SET position = $1, updated_at = NOW() WHERE id = $2', [index + 1, cleanIds[index]]);
    }
    await client.query('COMMIT');
    res.json({ updated: true, orderedIds: cleanIds });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to reorder page sections', error);
    res.status(500).json({ error: 'Unable to reorder page sections' });
  } finally {
    client.release();
  }
});

app.post('/api/admin/albums', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const pagePath = normalizePagePath(req.body.pagePath);
  if (!validateEditablePagePath(res, pagePath)) return;

  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
  const coverImagePath = typeof req.body.coverImagePath === 'string' ? req.body.coverImagePath.trim() : '';

  if (!title) {
    return res.status(400).json({ error: 'Album title is required' });
  }

  try {
    const positionResult = await pool.query(
      'SELECT COALESCE(MAX(position), 0) + 1 AS next_position FROM photo_albums WHERE page_path = $1',
      [pagePath]
    );
    const nextPosition = positionResult.rows[0].next_position;

    const result = await pool.query(
      `INSERT INTO photo_albums (page_path, title, description, cover_image_path, position, created_by, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING id, page_path, title, description, cover_image_path, position, created_at, updated_at`,
      [pagePath, title, description || null, coverImagePath || null, nextPosition, req.user.userId]
    );
    res.status(201).json({ item: result.rows[0] });
  } catch (error) {
    console.error('Failed to create album', error);
    res.status(500).json({ error: 'Unable to create album' });
  }
});

app.put('/api/admin/albums/:albumId(\\d+)', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const albumId = Number.parseInt(req.params.albumId, 10);
  if (!Number.isInteger(albumId) || albumId <= 0) {
    return res.status(400).json({ error: 'Valid album id is required' });
  }

  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
  const coverImagePath = typeof req.body.coverImagePath === 'string' ? req.body.coverImagePath.trim() : '';
  const position = Number.isInteger(req.body.position) ? req.body.position : null;

  if (!title) {
    return res.status(400).json({ error: 'Album title is required' });
  }

  try {
    const lookup = await pool.query('SELECT page_path, position FROM photo_albums WHERE id = $1', [albumId]);
    if (lookup.rowCount === 0) {
      return res.status(404).json({ error: 'Album not found' });
    }

    const pagePath = normalizePagePath(lookup.rows[0].page_path);
    if (!validateEditablePagePath(res, pagePath)) return;

    const result = await pool.query(
      `UPDATE photo_albums
      SET title = $1,
          description = $2,
          cover_image_path = $3,
          position = $4,
          updated_at = NOW()
      WHERE id = $5
      RETURNING id, page_path, title, description, cover_image_path, position, created_at, updated_at`,
      [title, description || null, coverImagePath || null, position || lookup.rows[0].position, albumId]
    );

    res.json({ item: result.rows[0] });
  } catch (error) {
    console.error('Failed to update album', error);
    res.status(500).json({ error: 'Unable to update album' });
  }
});

app.delete('/api/admin/albums/:albumId(\\d+)', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const albumId = Number.parseInt(req.params.albumId, 10);
  if (!Number.isInteger(albumId) || albumId <= 0) {
    return res.status(400).json({ error: 'Valid album id is required' });
  }

  try {
    const lookup = await pool.query('SELECT page_path FROM photo_albums WHERE id = $1', [albumId]);
    if (lookup.rowCount === 0) {
      return res.status(404).json({ error: 'Album not found' });
    }

    const pagePath = normalizePagePath(lookup.rows[0].page_path);
    if (!validateEditablePagePath(res, pagePath)) return;

    await pool.query('DELETE FROM photo_albums WHERE id = $1', [albumId]);
    res.json({ deleted: true, id: albumId });
  } catch (error) {
    console.error('Failed to delete album', error);
    res.status(500).json({ error: 'Unable to delete album' });
  }
});

async function handleAlbumReorder(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const pagePath = normalizePagePath(req.body.pagePath);
  if (!validateEditablePagePath(res, pagePath)) return;

  const orderedIds = Array.isArray(req.body.orderedIds) ? req.body.orderedIds : [];
  const cleanIds = orderedIds
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (cleanIds.length === 0) {
    return res.status(400).json({ error: 'Ordered album ids are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ownership = await client.query(
      'SELECT id FROM photo_albums WHERE page_path = $1 AND id = ANY($2::int[])',
      [pagePath, cleanIds]
    );
    if (ownership.rowCount !== cleanIds.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Album list contains invalid ids for this page' });
    }

    for (let index = 0; index < cleanIds.length; index += 1) {
      await client.query(
        'UPDATE photo_albums SET position = $1, updated_at = NOW() WHERE id = $2',
        [index + 1, cleanIds[index]]
      );
    }

    await client.query('COMMIT');
    res.json({ updated: true, orderedIds: cleanIds });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to reorder albums', error);
    res.status(500).json({ error: 'Unable to reorder albums' });
  } finally {
    client.release();
  }
}

app.put('/api/admin/albums-reorder', authenticateToken, handleAlbumReorder);

// Backward-compatible path for clients that still call the legacy endpoint.
app.put('/api/admin/albums/reorder', authenticateToken, handleAlbumReorder);

app.post('/api/admin/albums/:albumId(\\d+)/images', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const albumId = Number.parseInt(req.params.albumId, 10);
  if (!Number.isInteger(albumId) || albumId <= 0) {
    return res.status(400).json({ error: 'Valid album id is required' });
  }

  const imagePath = typeof req.body.imagePath === 'string' ? req.body.imagePath.trim() : '';
  const caption = typeof req.body.caption === 'string' ? req.body.caption.trim() : '';
  const setAsCover = Boolean(req.body.setAsCover);

  if (!imagePath) {
    return res.status(400).json({ error: 'Image path is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const albumLookup = await client.query(
      'SELECT page_path, cover_image_path FROM photo_albums WHERE id = $1 FOR UPDATE',
      [albumId]
    );
    if (albumLookup.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Album not found' });
    }

    const pagePath = normalizePagePath(albumLookup.rows[0].page_path);
    if (!isAdminEditablePagePath(pagePath)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Editing is disabled for this page' });
    }

    const positionResult = await client.query(
      'SELECT COALESCE(MAX(position), 0) + 1 AS next_position FROM album_images WHERE album_id = $1',
      [albumId]
    );
    const nextPosition = positionResult.rows[0].next_position;

    const imageResult = await client.query(
      `INSERT INTO album_images (album_id, image_path, caption, position, created_by, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING id, album_id, image_path, caption, position, created_at, updated_at`,
      [albumId, imagePath, caption || null, nextPosition, req.user.userId]
    );

    if (setAsCover || !albumLookup.rows[0].cover_image_path) {
      await client.query('UPDATE photo_albums SET cover_image_path = $1, updated_at = NOW() WHERE id = $2', [imagePath, albumId]);
    }

    await client.query('COMMIT');
    res.status(201).json({ item: imageResult.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to create album image', error);
    res.status(500).json({ error: 'Unable to create album image' });
  } finally {
    client.release();
  }
});

app.put('/api/admin/albums/:albumId(\\d+)/images/:imageId(\\d+)', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const albumId = Number.parseInt(req.params.albumId, 10);
  const imageId = Number.parseInt(req.params.imageId, 10);
  if (!Number.isInteger(albumId) || albumId <= 0 || !Number.isInteger(imageId) || imageId <= 0) {
    return res.status(400).json({ error: 'Valid album and image ids are required' });
  }

  const caption = typeof req.body.caption === 'string' ? req.body.caption.trim() : null;
  const imagePath = typeof req.body.imagePath === 'string' ? req.body.imagePath.trim() : null;
  const setAsCover = Boolean(req.body.setAsCover);
  const position = Number.isInteger(req.body.position) ? req.body.position : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const albumLookup = await client.query('SELECT page_path FROM photo_albums WHERE id = $1 FOR UPDATE', [albumId]);
    if (albumLookup.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Album not found' });
    }

    const pagePath = normalizePagePath(albumLookup.rows[0].page_path);
    if (!isAdminEditablePagePath(pagePath)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Editing is disabled for this page' });
    }

    const current = await client.query('SELECT image_path, caption, position FROM album_images WHERE id = $1 AND album_id = $2', [imageId, albumId]);
    if (current.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Image not found' });
    }

    const nextImagePath = imagePath !== null ? imagePath : current.rows[0].image_path;
    const nextCaption = caption !== null ? caption : current.rows[0].caption;
    const nextPosition = position || current.rows[0].position;

    const result = await client.query(
      `UPDATE album_images
      SET image_path = $1, caption = $2, position = $3, updated_at = NOW()
      WHERE id = $4 AND album_id = $5
      RETURNING id, album_id, image_path, caption, position, created_at, updated_at`,
      [nextImagePath, nextCaption, nextPosition, imageId, albumId]
    );

    if (setAsCover) {
      await client.query('UPDATE photo_albums SET cover_image_path = $1, updated_at = NOW() WHERE id = $2', [nextImagePath, albumId]);
    }

    await client.query('COMMIT');
    res.json({ item: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to update album image', error);
    res.status(500).json({ error: 'Unable to update album image' });
  } finally {
    client.release();
  }
});

app.delete('/api/admin/albums/:albumId(\\d+)/images/:imageId(\\d+)', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const albumId = Number.parseInt(req.params.albumId, 10);
  const imageId = Number.parseInt(req.params.imageId, 10);
  if (!Number.isInteger(albumId) || albumId <= 0 || !Number.isInteger(imageId) || imageId <= 0) {
    return res.status(400).json({ error: 'Valid album and image ids are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const albumLookup = await client.query('SELECT page_path, cover_image_path FROM photo_albums WHERE id = $1 FOR UPDATE', [albumId]);
    if (albumLookup.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Album not found' });
    }

    const pagePath = normalizePagePath(albumLookup.rows[0].page_path);
    if (!isAdminEditablePagePath(pagePath)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Editing is disabled for this page' });
    }

    const deleted = await client.query(
      'DELETE FROM album_images WHERE id = $1 AND album_id = $2 RETURNING image_path',
      [imageId, albumId]
    );
    if (deleted.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Image not found' });
    }

    if (albumLookup.rows[0].cover_image_path === deleted.rows[0].image_path) {
      const nextCover = await client.query(
        'SELECT image_path FROM album_images WHERE album_id = $1 ORDER BY position ASC, id ASC LIMIT 1',
        [albumId]
      );
      await client.query(
        'UPDATE photo_albums SET cover_image_path = $1, updated_at = NOW() WHERE id = $2',
        [nextCover.rowCount ? nextCover.rows[0].image_path : null, albumId]
      );
    }

    await client.query('COMMIT');
    res.json({ deleted: true, id: imageId });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to delete album image', error);
    res.status(500).json({ error: 'Unable to delete album image' });
  } finally {
    client.release();
  }
});

async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Missing token' });

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (_error) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  try {
    const userResult = await pool.query('SELECT id, role FROM users WHERE id = $1', [payload.userId]);
    if (userResult.rowCount === 0) {
      return res.status(401).json({ error: 'User no longer exists' });
    }

    const currentUser = userResult.rows[0];
    if (currentUser.role === 'disabled') {
      return res.status(403).json({ error: 'Account is disabled' });
    }

    req.user = {
      ...payload,
      role: currentUser.role,
    };
    next();
  } catch (error) {
    console.error('Token authentication lookup failed', error);
    res.status(500).json({ error: 'Unable to validate token' });
  }
}


app.get('/api/users', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  try {
    const result = await pool.query('SELECT id, email, full_name, role FROM users ORDER BY id ASC');
    res.json(result.rows);
  } catch (error) {
    console.error('Failed to fetch users', error);
    res.status(500).json({ error: 'Unable to fetch users' });
  }
});

app.get('/api/current-season', authenticateToken, (req, res) => {
  const sy = currentSeasonYear();
  res.json({ season_year: sy, ash_wednesday: ashWednesdayISO(sy) });
});

app.get('/api/admin/users', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const sy = currentSeasonYear();
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.full_name, u.role, u.joined_at,
              (p.dues_paid_season = ${sy}) AS dues_paid,
              (p.guest_fee_paid_season = ${sy}) AS guest_fee_paid,
              (p.beads_paid_season = ${sy}) AS beads_paid,
              (p.costume_paid_season = ${sy}) AS costume_paid
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       ORDER BY u.joined_at DESC, u.id DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Failed to fetch admin users', error);
    res.status(500).json({ error: 'Unable to fetch users' });
  }
});

// Get full details for one user (admin only)
app.get('/api/admin/users/:userId', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const userId = Number.parseInt(req.params.userId, 10);
  if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: 'Valid user id is required' });
  try {
    const sy = currentSeasonYear();
    const result = await pool.query(
      `SELECT u.id, u.email, u.full_name, u.role, u.joined_at,
              p.phone, p.address, p.spouse_name, p.kids_names, p.guest_name, p.float_riders,
              p.member_float_number, p.spouse_float_number, p.guest_float_number,
              p.kids_float_numbers, p.rider_float_numbers, p.rider_float_names,
              p.dues_paid_season, p.guest_fee_paid_season, p.beads_paid_season, p.costume_paid_season
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       WHERE u.id = $1`,
      [userId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    const row = result.rows[0];
    res.json({
      ...row,
      current_season_year: sy,
      dues_paid: row.dues_paid_season === sy,
      guest_fee_paid: row.guest_fee_paid_season === sy,
      beads_paid: row.beads_paid_season === sy,
      costume_paid: row.costume_paid_season === sy,
      kids_names: row.kids_names || [],
      float_riders: row.float_riders || [],
      kids_float_numbers: row.kids_float_numbers || [],
      rider_float_numbers: row.rider_float_numbers || [],
      rider_float_names: row.rider_float_names || [],
    });
  } catch (error) {
    console.error('Failed to fetch user details', error);
    res.status(500).json({ error: 'Unable to fetch user details' });
  }
});

// Update all editable fields for a user (admin only)
app.put('/api/admin/users/:userId/details', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const userId = Number.parseInt(req.params.userId, 10);
  if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: 'Valid user id is required' });

  const fullName = typeof req.body.full_name === 'string' ? req.body.full_name.trim() : '';
  const email = normalizeEmailAddress(req.body.email);
  const role = ['admin', 'member'].includes(req.body.role) ? req.body.role : null;

  if (!fullName) return res.status(400).json({ error: 'Full name is required' });
  if (!email || !isValidEmailAddress(email)) return res.status(400).json({ error: 'Valid email is required' });
  if (!role) return res.status(400).json({ error: 'Role must be member or admin' });

  const phone = typeof req.body.phone === 'string' ? req.body.phone.trim().slice(0, 30) : null;
  const address = typeof req.body.address === 'string' ? req.body.address.trim().slice(0, 200) : null;
  const spouse_name = typeof req.body.spouse_name === 'string' ? req.body.spouse_name.trim().slice(0, 100) : null;
  const guest_name = typeof req.body.guest_name === 'string' ? req.body.guest_name.trim().slice(0, 100) : null;
  const kidsRaw = Array.isArray(req.body.kids_names) ? req.body.kids_names : [];
  const ridersRaw = Array.isArray(req.body.float_riders) ? req.body.float_riders : [];
  const kids_names = kidsRaw.map((k) => String(k).trim().slice(0, 100)).filter(Boolean);
  const float_riders = ridersRaw.map((r) => String(r).trim().slice(0, 100)).filter(Boolean);

  const kidsFloatRaw = Array.isArray(req.body.kids_float_numbers) ? req.body.kids_float_numbers : [];
  const riderFloatRaw = Array.isArray(req.body.rider_float_numbers) ? req.body.rider_float_numbers : [];
  const riderFloatNamesRaw = Array.isArray(req.body.rider_float_names) ? req.body.rider_float_names : [];
  const kids_float_numbers = kidsFloatRaw.map((v) => String(v ?? '').trim().slice(0, 20));
  const rider_float_numbers = riderFloatRaw.map((v) => String(v ?? '').trim().slice(0, 20));
  const rider_float_names = riderFloatNamesRaw.map((v) => String(v ?? '').trim().slice(0, 100));

  const member_float_number = typeof req.body.member_float_number === 'string' ? req.body.member_float_number.trim().slice(0, 20) : null;
  const spouse_float_number = typeof req.body.spouse_float_number === 'string' ? req.body.spouse_float_number.trim().slice(0, 20) : null;
  const guest_float_number = typeof req.body.guest_float_number === 'string' ? req.body.guest_float_number.trim().slice(0, 20) : null;

  const dues_paid = Boolean(req.body.dues_paid);
  const guest_fee_paid = Boolean(req.body.guest_fee_paid);
  const beads_paid = Boolean(req.body.beads_paid);
  const costume_paid = Boolean(req.body.costume_paid);
  const sy = currentSeasonYear();
  const dues_paid_season = dues_paid ? sy : null;
  const guest_fee_paid_season = guest_fee_paid ? sy : null;
  const beads_paid_season = beads_paid ? sy : null;
  const costume_paid_season = costume_paid ? sy : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userResult = await client.query(
      `UPDATE users SET full_name = $1, email = $2, role = $3 WHERE id = $4
       RETURNING id, email, full_name, role, joined_at`,
      [fullName, email, role, userId]
    );
    if (userResult.rowCount === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'User not found' }); }

    await client.query(
      `INSERT INTO user_profiles (
         user_id, phone, address, spouse_name, kids_names, guest_name, float_riders,
         member_float_number, spouse_float_number, guest_float_number,
         kids_float_numbers, rider_float_numbers, rider_float_names,
         dues_paid, guest_fee_paid, beads_paid, costume_paid,
         dues_paid_season, guest_fee_paid_season, beads_paid_season, costume_paid_season,
         updated_at
       ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15,$16,$17,$18,$19,$20,$21,NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         phone=EXCLUDED.phone, address=EXCLUDED.address, spouse_name=EXCLUDED.spouse_name,
         kids_names=EXCLUDED.kids_names, guest_name=EXCLUDED.guest_name,
         float_riders=EXCLUDED.float_riders,
         member_float_number=EXCLUDED.member_float_number,
         spouse_float_number=EXCLUDED.spouse_float_number,
         guest_float_number=EXCLUDED.guest_float_number,
         kids_float_numbers=EXCLUDED.kids_float_numbers,
         rider_float_numbers=EXCLUDED.rider_float_numbers,
         rider_float_names=EXCLUDED.rider_float_names,
         dues_paid=EXCLUDED.dues_paid, guest_fee_paid=EXCLUDED.guest_fee_paid,
         beads_paid=EXCLUDED.beads_paid, costume_paid=EXCLUDED.costume_paid,
         dues_paid_season=EXCLUDED.dues_paid_season,
         guest_fee_paid_season=EXCLUDED.guest_fee_paid_season,
         beads_paid_season=EXCLUDED.beads_paid_season,
         costume_paid_season=EXCLUDED.costume_paid_season,
         updated_at=NOW()`,
      [
        userId, phone||null, address||null, spouse_name||null,
        JSON.stringify(kids_names), guest_name||null, JSON.stringify(float_riders),
        member_float_number||null, spouse_float_number||null, guest_float_number||null,
        JSON.stringify(kids_float_numbers), JSON.stringify(rider_float_numbers), JSON.stringify(rider_float_names),
        dues_paid, guest_fee_paid, beads_paid, costume_paid,
        dues_paid_season, guest_fee_paid_season, beads_paid_season, costume_paid_season,
      ]
    );
    await client.query('COMMIT');
    res.json({ user: userResult.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'Email already in use by another account' });
    console.error('Failed to update user details', error);
    res.status(500).json({ error: 'Unable to update user details' });
  } finally {
    client.release();
  }
});

app.post('/api/admin/users', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const email = normalizeEmailAddress(req.body.email);
  const fullName = typeof req.body.full_name === 'string' ? req.body.full_name.trim() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const role = req.body.role === 'admin' ? 'admin' : 'member';

  if (!email || !fullName || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }

  if (!isValidEmailAddress(email)) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);
    const result = await pool.query(
      `INSERT INTO users (email, full_name, role, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, full_name, role, joined_at`,
      [email, fullName, role, hash]
    );

    res.status(201).json({ user: result.rows[0], created: true });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Email already in use' });
    }
    console.error('Failed to create user', error);
    res.status(500).json({ error: 'Unable to create user' });
  }
});

app.post('/api/users', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const email = normalizeEmailAddress(req.body.email);
  const fullName = typeof req.body.full_name === 'string' ? req.body.full_name.trim() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const role = req.body.role === 'admin' ? 'admin' : 'member';

  if (!email || !fullName || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }

  if (!isValidEmailAddress(email)) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);
    const result = await pool.query(
      `INSERT INTO users (email, full_name, role, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, full_name, role, joined_at`,
      [email, fullName, role, hash]
    );

    res.status(201).json({ user: result.rows[0], created: true });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Email already in use' });
    }
    console.error('Failed to create user', error);
    res.status(500).json({ error: 'Unable to create user' });
  }
});

app.put('/api/admin/users/:userId/role', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const userId = Number.parseInt(req.params.userId, 10);
  const { role } = req.body;

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Valid user id is required' });
  }

  if (!['member', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Role must be member or admin' });
  }

  if (userId === req.user.userId && role !== 'admin') {
    return res.status(400).json({ error: 'You cannot remove your own admin role' });
  }

  try {
    const result = await pool.query(
      'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, email, full_name, role, joined_at',
      [role, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Failed to update user role', error);
    res.status(500).json({ error: 'Unable to update role' });
  }
});

app.put('/api/users/:userId/role', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const userId = Number.parseInt(req.params.userId, 10);
  const { role } = req.body;

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Valid user id is required' });
  }

  if (!['member', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Role must be member or admin' });
  }

  if (userId === req.user.userId && role !== 'admin') {
    return res.status(400).json({ error: 'You cannot remove your own admin role' });
  }

  try {
    const result = await pool.query(
      'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, email, full_name, role, joined_at',
      [role, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Failed to update user role', error);
    res.status(500).json({ error: 'Unable to update role' });
  }
});

app.put('/api/admin/users/:userId/disable', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const userId = Number.parseInt(req.params.userId, 10);
  const disabled = req.body && typeof req.body.disabled === 'boolean' ? req.body.disabled : null;

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Valid user id is required' });
  }

  if (disabled === null) {
    return res.status(400).json({ error: 'disabled must be true or false' });
  }

  if (userId === req.user.userId && disabled) {
    return res.status(400).json({ error: 'You cannot disable your own account' });
  }

  try {
    const nextRole = disabled ? 'disabled' : 'member';
    const result = await pool.query(
      'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, email, full_name, role, joined_at',
      [nextRole, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Failed to update user disabled state', error);
    res.status(500).json({ error: 'Unable to update user state' });
  }
});

app.put('/api/users/:userId/disable', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const userId = Number.parseInt(req.params.userId, 10);
  const disabled = req.body && typeof req.body.disabled === 'boolean' ? req.body.disabled : null;

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Valid user id is required' });
  }

  if (disabled === null) {
    return res.status(400).json({ error: 'disabled must be true or false' });
  }

  if (userId === req.user.userId && disabled) {
    return res.status(400).json({ error: 'You cannot disable your own account' });
  }

  try {
    const nextRole = disabled ? 'disabled' : 'member';
    const result = await pool.query(
      'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, email, full_name, role, joined_at',
      [nextRole, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Failed to update user disabled state', error);
    res.status(500).json({ error: 'Unable to update user state' });
  }
});

app.delete('/api/admin/users/:userId', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const userId = Number.parseInt(req.params.userId, 10);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Valid user id is required' });
  }

  if (userId === req.user.userId) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }

  try {
    const result = await pool.query(
      'DELETE FROM users WHERE id = $1 RETURNING id, email, full_name, role, joined_at',
      [userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ deleted: true, user: result.rows[0] });
  } catch (error) {
    console.error('Failed to delete user', error);
    res.status(500).json({ error: 'Unable to delete user' });
  }
});

app.delete('/api/users/:userId', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const userId = Number.parseInt(req.params.userId, 10);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Valid user id is required' });
  }

  if (userId === req.user.userId) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }

  try {
    const result = await pool.query(
      'DELETE FROM users WHERE id = $1 RETURNING id, email, full_name, role, joined_at',
      [userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ deleted: true, user: result.rows[0] });
  } catch (error) {
    console.error('Failed to delete user', error);
    res.status(500).json({ error: 'Unable to delete user' });
  }
});

app.put('/api/admin/users/:userId/password', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const userId = Number.parseInt(req.params.userId, 10);
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Valid user id is required' });
  }

  if (!password.trim()) {
    return res.status(400).json({ error: 'Password is required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);
    const result = await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id, email, full_name, role, joined_at',
      [hash, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: result.rows[0], passwordReset: true });
  } catch (error) {
    console.error('Failed to reset user password', error);
    res.status(500).json({ error: 'Unable to reset password' });
  }
});

app.put('/api/users/:userId/password', authenticateToken, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const userId = Number.parseInt(req.params.userId, 10);
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Valid user id is required' });
  }

  if (!password.trim()) {
    return res.status(400).json({ error: 'Password is required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);
    const result = await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id, email, full_name, role, joined_at',
      [hash, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: result.rows[0], passwordReset: true });
  } catch (error) {
    console.error('Failed to reset user password', error);
    res.status(500).json({ error: 'Unable to reset password' });
  }
});

// Registration verification request
app.post('/api/auth/register/request-code', async (req, res) => {
  const email = normalizeEmailAddress(req.body.email);
  const fullName = typeof req.body.full_name === 'string' ? req.body.full_name.trim() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const verificationMethod = 'email';

  if (!email || !fullName || !password) {
    return res.status(400).json({ error: 'Email, full name and password are required' });
  }

  if (!isValidEmailAddress(email)) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }

  try {
    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rowCount > 0) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);
    const verificationCode = generateVerificationCode();
    const verificationTarget = email;
    const expiresAt = new Date(Date.now() + REGISTRATION_CODE_TTL_MINUTES * 60 * 1000);

    await pool.query('DELETE FROM pending_registrations WHERE expires_at < NOW()', []);
    await pool.query(
      `INSERT INTO pending_registrations (
         email, phone, full_name, password_hash, verification_method, verification_target, verification_code, attempts, expires_at, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, NOW())
       ON CONFLICT (email)
       DO UPDATE SET
         phone = EXCLUDED.phone,
         full_name = EXCLUDED.full_name,
         password_hash = EXCLUDED.password_hash,
         verification_method = EXCLUDED.verification_method,
         verification_target = EXCLUDED.verification_target,
         verification_code = EXCLUDED.verification_code,
         attempts = 0,
         expires_at = EXCLUDED.expires_at,
         created_at = NOW()`,
      [email, null, fullName, hash, verificationMethod, verificationTarget, verificationCode, expiresAt]
    );

    let deliveryWarning = '';
    try {
      await dispatchVerificationCode(verificationTarget, verificationCode);
    } catch (deliveryError) {
      if (process.env.NODE_ENV === 'production') {
        throw deliveryError;
      }

      console.warn('Verification delivery failed in development; using dev fallback', deliveryError);
      deliveryWarning = 'Verification delivery is not configured, using development fallback code.';
    }

    const response = {
      message: deliveryWarning || `Verification code sent to ${maskVerificationTarget(verificationTarget)}.`,
      verificationRequired: true,
      verificationMethod,
      expiresInMinutes: REGISTRATION_CODE_TTL_MINUTES,
    };

    res.status(202).json(response);
  } catch (error) {
    console.error('Registration verification request failed', error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res.status(500).json({ error: 'Unable to start registration verification' });
  }
});

// Registration verification confirm
app.post('/api/auth/register/verify-code', async (req, res) => {
  const email = normalizeEmailAddress(req.body.email);
  const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';

  if (!email || !code) {
    return res.status(400).json({ error: 'Email and verification code are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM pending_registrations WHERE expires_at < NOW()');

    const pendingResult = await client.query(
      `SELECT email, full_name, password_hash, verification_code, attempts
       FROM pending_registrations
       WHERE email = $1
       FOR UPDATE`,
      [email]
    );

    if (pendingResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No pending registration found. Request a new verification code.' });
    }

    const pending = pendingResult.rows[0];
    if (pending.verification_code !== code) {
      await client.query('UPDATE pending_registrations SET attempts = attempts + 1 WHERE email = $1', [email]);
      await client.query('COMMIT');
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    const insertResult = await client.query(
      `INSERT INTO users (email, full_name, role, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, full_name, role, joined_at`,
      [pending.email, pending.full_name, 'member', pending.password_hash]
    );

    await client.query('DELETE FROM pending_registrations WHERE email = $1', [email]);
    await client.query('COMMIT');

    const user = insertResult.rows[0];
    const token = generateToken(user);
    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        phone: null,
        full_name: user.full_name,
        role: user.role,
      },
      token,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Registration verification failed', error);
    if (error.code === '23505') {
      return res.status(409).json({ error: 'That email is already in use' });
    }
    res.status(500).json({ error: 'Unable to complete registration' });
  } finally {
    client.release();
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const email = normalizeEmailAddress(req.body.email);
  const password = req.body.password;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const result = await pool.query('SELECT id, email, full_name, role, password_hash FROM users WHERE email = $1', [email]);
    if (result.rowCount === 0) return res.status(401).json({ error: 'Invalid credentials' });
    const user = result.rows[0];
    if (user.role === 'disabled') return res.status(403).json({ error: 'Account is disabled' });
    const ok = bcrypt.compareSync(password, user.password_hash || '');
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const token = generateToken(user);
    res.json({ user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role }, token });
  } catch (error) {
    console.error('Login failed', error);
    res.status(500).json({ error: 'Unable to login' });
  }
});

// Protected profile route
app.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    const sy = currentSeasonYear();
    const result = await pool.query(
      `SELECT u.id, u.email, u.full_name, u.role, u.joined_at,
              p.phone, p.address, p.spouse_name, p.kids_names, p.guest_name, p.float_riders,
              p.member_float_number, p.spouse_float_number, p.guest_float_number,
              p.kids_float_numbers, p.rider_float_numbers, p.rider_float_names,
              p.dues_paid_season, p.guest_fee_paid_season, p.beads_paid_season, p.costume_paid_season
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       WHERE u.id = $1`,
      [req.user.userId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    const row = result.rows[0];
    res.json({
      ...row,
      current_season_year: sy,
      dues_paid: row.dues_paid_season === sy,
      guest_fee_paid: row.guest_fee_paid_season === sy,
      beads_paid: row.beads_paid_season === sy,
      costume_paid: row.costume_paid_season === sy,
      kids_names: row.kids_names || [],
      float_riders: row.float_riders || [],
      kids_float_numbers: row.kids_float_numbers || [],
      rider_float_numbers: row.rider_float_numbers || [],
      rider_float_names: row.rider_float_names || [],
    });
  } catch (error) {
    console.error('Failed to fetch profile', error);
    res.status(500).json({ error: 'Unable to fetch profile' });
  }
});

app.put('/api/profile/details', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const phone = typeof req.body.phone === 'string' ? req.body.phone.trim().slice(0, 30) : null;
  const address = typeof req.body.address === 'string' ? req.body.address.trim().slice(0, 200) : null;
  const spouse_name = typeof req.body.spouse_name === 'string' ? req.body.spouse_name.trim().slice(0, 100) : null;
  const guest_name = typeof req.body.guest_name === 'string' ? req.body.guest_name.trim().slice(0, 100) : null;

  const kidsRaw = req.body.kids_names;
  if (!Array.isArray(kidsRaw)) return res.status(400).json({ error: 'kids_names must be an array' });
  const kids_names = kidsRaw.map((k) => String(k).trim().slice(0, 100)).filter(Boolean);

  const ridersRaw = req.body.float_riders;
  if (!Array.isArray(ridersRaw)) return res.status(400).json({ error: 'float_riders must be an array' });
  const float_riders = ridersRaw.map((r) => String(r).trim().slice(0, 100)).filter(Boolean);

  const riderFloatNamesRaw = Array.isArray(req.body.rider_float_names) ? req.body.rider_float_names : [];
  const riderFloatNumsRaw  = Array.isArray(req.body.rider_float_numbers) ? req.body.rider_float_numbers : [];
  const rider_float_names   = riderFloatNamesRaw.map((v) => String(v ?? '').trim().slice(0, 100));
  const rider_float_numbers = riderFloatNumsRaw.map((v) => String(v ?? '').trim().slice(0, 20));

  try {
    await pool.query(
      `INSERT INTO user_profiles (user_id, phone, address, spouse_name, kids_names, guest_name, float_riders, rider_float_names, rider_float_numbers, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8::jsonb, $9::jsonb, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         phone = EXCLUDED.phone,
         address = EXCLUDED.address,
         spouse_name = EXCLUDED.spouse_name,
         kids_names = EXCLUDED.kids_names,
         guest_name = EXCLUDED.guest_name,
         float_riders = EXCLUDED.float_riders,
         rider_float_names = EXCLUDED.rider_float_names,
         rider_float_numbers = EXCLUDED.rider_float_numbers,
         updated_at = NOW()`,
      [userId, phone || null, address || null, spouse_name || null, JSON.stringify(kids_names), guest_name || null, JSON.stringify(float_riders), JSON.stringify(rider_float_names), JSON.stringify(rider_float_numbers)]
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('Failed to update profile details', error);
    res.status(500).json({ error: 'Unable to update profile details' });
  }
});

app.get('/api/members', async (_req, res) => {
  try {
    const result = await pool.query('SELECT id, email, full_name, role, joined_at FROM users WHERE role = $1 ORDER BY joined_at DESC', ['member']);
    res.json(result.rows);
  } catch (error) {
    console.error('Failed to fetch members', error);
    res.status(500).json({ error: 'Unable to fetch members' });
  }
});

// Dev only: seed demo users
if (process.env.NODE_ENV !== 'production') {
  app.post('/api/dev/seed', async (req, res) => {
    const demoUsers = [
      { email: 'demo@krewe.local', full_name: 'Demo Member', role: 'member', password: 'demo123' },
      { email: 'admin@krewe.local', full_name: 'Admin User', role: 'admin', password: 'admin123' },
    ];
    try {
      const results = [];
      for (const user of demoUsers) {
        const salt = bcrypt.genSaltSync(10);
        const hash = bcrypt.hashSync(user.password, salt);
        const result = await pool.query(
          'INSERT INTO users (email, full_name, role, password_hash) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING RETURNING id, email, role',
          [user.email, user.full_name, user.role, hash]
        );
        if (result.rowCount > 0) {
          results.push({ email: user.email, role: user.role, status: 'created', password: user.password });
        } else {
          results.push({ email: user.email, status: 'exists' });
        }
      }
      res.json({ message: 'Demo users seeded', users: results });
    } catch (error) {
      console.error('Seed failed', error);
      res.status(500).json({ error: 'Seed failed' });
    }
  });
}

// ── Shop: Products (members) ──────────────────────────────────────────────
app.get('/api/shop/products', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, description, price, image_path, category, stock_qty
       FROM shop_products WHERE active = TRUE
       ORDER BY position ASC, id ASC`
    );
    res.json({ products: result.rows });
  } catch (err) {
    console.error('Failed to fetch shop products', err);
    res.status(500).json({ error: 'Unable to fetch products' });
  }
});

// ── Shop: Products (admin/store_admin) ────────────────────────────────────
app.get('/api/admin/shop/products', authenticateToken, async (req, res) => {
  if (!isShopManager(req)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const result = await pool.query(
      `SELECT id, name, description, price, image_path, category, stock_qty, active, position, created_at
       FROM shop_products ORDER BY position ASC, id ASC`
    );
    res.json({ products: result.rows });
  } catch (err) {
    console.error('Failed to fetch admin shop products', err);
    res.status(500).json({ error: 'Unable to fetch products' });
  }
});

app.post('/api/admin/shop/products', authenticateToken, async (req, res) => {
  if (!isShopManager(req)) return res.status(403).json({ error: 'Forbidden' });
  const { name, description, price, image_path, category, stock_qty, active } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Product name is required' });
  }
  const parsedPrice = parseFloat(price);
  if (!isFinite(parsedPrice) || parsedPrice < 0) {
    return res.status(400).json({ error: 'Invalid price' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO shop_products (name, description, price, image_path, category, stock_qty, active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        name.trim(),
        description ? description.trim() : null,
        parsedPrice,
        image_path ? image_path.trim() : null,
        category ? category.trim() : null,
        stock_qty != null && stock_qty !== '' ? parseInt(stock_qty, 10) : null,
        active !== false,
        req.user.userId,
      ]
    );
    res.json({ product: result.rows[0] });
  } catch (err) {
    console.error('Failed to create product', err);
    res.status(500).json({ error: 'Unable to create product' });
  }
});

app.put('/api/admin/shop/products/:id(\\d+)', authenticateToken, async (req, res) => {
  if (!isShopManager(req)) return res.status(403).json({ error: 'Forbidden' });
  const id = parseInt(req.params.id, 10);
  const { name, description, price, image_path, category, stock_qty, active, position } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Product name is required' });
  }
  const parsedPrice = parseFloat(price);
  if (!isFinite(parsedPrice) || parsedPrice < 0) {
    return res.status(400).json({ error: 'Invalid price' });
  }
  try {
    const result = await pool.query(
      `UPDATE shop_products
       SET name=$1, description=$2, price=$3, image_path=$4, category=$5,
           stock_qty=$6, active=$7, position=COALESCE($8, position), updated_at=NOW()
       WHERE id=$9 RETURNING *`,
      [
        name.trim(),
        description ? description.trim() : null,
        parsedPrice,
        image_path ? image_path.trim() : null,
        category ? category.trim() : null,
        stock_qty != null && stock_qty !== '' ? parseInt(stock_qty, 10) : null,
        active !== false,
        position != null && position !== '' ? parseInt(position, 10) : null,
        id,
      ]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Product not found' });
    res.json({ product: result.rows[0] });
  } catch (err) {
    console.error('Failed to update product', err);
    res.status(500).json({ error: 'Unable to update product' });
  }
});

app.delete('/api/admin/shop/products/:id(\\d+)', authenticateToken, async (req, res) => {
  if (!isShopManager(req)) return res.status(403).json({ error: 'Forbidden' });
  const id = parseInt(req.params.id, 10);
  try {
    await pool.query('DELETE FROM shop_products WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete product', err);
    res.status(500).json({ error: 'Unable to delete product' });
  }
});

// ── Shop: Cart ────────────────────────────────────────────────────────────
app.get('/api/shop/cart', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.id, c.quantity, p.id AS product_id, p.name, p.price, p.image_path, p.stock_qty, p.active
       FROM shop_cart_items c
       JOIN shop_products p ON p.id = c.product_id
       WHERE c.user_id = $1 ORDER BY c.added_at ASC`,
      [req.user.userId]
    );
    res.json({ items: result.rows });
  } catch (err) {
    console.error('Failed to fetch cart', err);
    res.status(500).json({ error: 'Unable to fetch cart' });
  }
});

app.post('/api/shop/cart', authenticateToken, async (req, res) => {
  const { product_id, quantity = 1 } = req.body;
  const qty = parseInt(quantity, 10);
  if (!product_id || !Number.isInteger(qty) || qty < 1) {
    return res.status(400).json({ error: 'Invalid product or quantity' });
  }
  try {
    const prod = await pool.query(
      'SELECT id FROM shop_products WHERE id=$1 AND active=TRUE', [product_id]
    );
    if (prod.rowCount === 0) return res.status(404).json({ error: 'Product not found' });
    const result = await pool.query(
      `INSERT INTO shop_cart_items (user_id, product_id, quantity) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, product_id)
       DO UPDATE SET quantity = shop_cart_items.quantity + EXCLUDED.quantity
       RETURNING *`,
      [req.user.userId, product_id, qty]
    );
    res.json({ item: result.rows[0] });
  } catch (err) {
    console.error('Failed to add to cart', err);
    res.status(500).json({ error: 'Unable to add to cart' });
  }
});

app.put('/api/shop/cart/:itemId(\\d+)', authenticateToken, async (req, res) => {
  const itemId = parseInt(req.params.itemId, 10);
  const qty = parseInt(req.body.quantity, 10);
  if (!Number.isInteger(qty) || qty < 0) {
    return res.status(400).json({ error: 'Invalid quantity' });
  }
  try {
    if (qty === 0) {
      await pool.query('DELETE FROM shop_cart_items WHERE id=$1 AND user_id=$2', [itemId, req.user.userId]);
      return res.json({ removed: true });
    }
    const result = await pool.query(
      'UPDATE shop_cart_items SET quantity=$1 WHERE id=$2 AND user_id=$3 RETURNING *',
      [qty, itemId, req.user.userId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Cart item not found' });
    res.json({ item: result.rows[0] });
  } catch (err) {
    console.error('Failed to update cart item', err);
    res.status(500).json({ error: 'Unable to update cart' });
  }
});

app.delete('/api/shop/cart/:itemId(\\d+)', authenticateToken, async (req, res) => {
  const itemId = parseInt(req.params.itemId, 10);
  try {
    await pool.query('DELETE FROM shop_cart_items WHERE id=$1 AND user_id=$2', [itemId, req.user.userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to remove cart item', err);
    res.status(500).json({ error: 'Unable to remove item' });
  }
});

// ── Shop: Checkout & Orders ───────────────────────────────────────────────
app.post('/api/shop/checkout', authenticateToken, async (req, res) => {
  const { notes } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cartResult = await client.query(
      `SELECT c.id AS cart_id, c.quantity, p.id AS product_id, p.name, p.price, p.stock_qty, p.active
       FROM shop_cart_items c
       JOIN shop_products p ON p.id = c.product_id
       WHERE c.user_id = $1`,
      [req.user.userId]
    );
    if (cartResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cart is empty' });
    }
    const inactive = cartResult.rows.filter((r) => !r.active);
    if (inactive.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Some items are no longer available: ${inactive.map((r) => r.name).join(', ')}`,
      });
    }
    const userResult = await client.query(
      'SELECT full_name, email FROM users WHERE id=$1', [req.user.userId]
    );
    const buyer = userResult.rows[0];
    const total = cartResult.rows.reduce(
      (sum, row) => sum + parseFloat(row.price) * row.quantity, 0
    );
    const orderResult = await client.query(
      `INSERT INTO shop_orders (user_id, buyer_name, buyer_email, total_amount, notes)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [req.user.userId, buyer.full_name, buyer.email, total.toFixed(2), notes || null]
    );
    const orderId = orderResult.rows[0].id;
    for (const item of cartResult.rows) {
      await client.query(
        `INSERT INTO shop_order_items (order_id, product_id, product_name, unit_price, quantity)
         VALUES ($1,$2,$3,$4,$5)`,
        [orderId, item.product_id, item.name, item.price, item.quantity]
      );
      if (item.stock_qty != null) {
        await client.query(
          'UPDATE shop_products SET stock_qty = GREATEST(0, stock_qty - $1) WHERE id=$2',
          [item.quantity, item.product_id]
        );
      }
    }
    await client.query('DELETE FROM shop_cart_items WHERE user_id=$1', [req.user.userId]);
    await client.query('COMMIT');
    res.json({ ok: true, order_id: orderId, total: total.toFixed(2) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Checkout failed', err);
    res.status(500).json({ error: 'Checkout failed. Please try again.' });
  } finally {
    client.release();
  }
});

app.get('/api/shop/orders', authenticateToken, async (req, res) => {
  try {
    const orders = await pool.query(
      `SELECT id, total_amount, status, notes, created_at
       FROM shop_orders WHERE user_id=$1 ORDER BY created_at DESC`,
      [req.user.userId]
    );
    const orderIds = orders.rows.map((r) => r.id);
    let itemRows = [];
    if (orderIds.length > 0) {
      const itemResult = await pool.query(
        `SELECT order_id, product_name, unit_price, quantity
         FROM shop_order_items WHERE order_id = ANY($1::int[])`,
        [orderIds]
      );
      itemRows = itemResult.rows;
    }
    const byOrder = {};
    itemRows.forEach((i) => {
      if (!byOrder[i.order_id]) byOrder[i.order_id] = [];
      byOrder[i.order_id].push(i);
    });
    res.json({ orders: orders.rows.map((o) => ({ ...o, items: byOrder[o.id] || [] })) });
  } catch (err) {
    console.error('Failed to fetch orders', err);
    res.status(500).json({ error: 'Unable to fetch orders' });
  }
});

app.get('/api/admin/shop/orders', authenticateToken, async (req, res) => {
  if (!isShopManager(req)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = 20;
    const offset = (page - 1) * limit;
    const orders = await pool.query(
      `SELECT id, buyer_name, buyer_email, total_amount, status, notes, created_at
       FROM shop_orders ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const countResult = await pool.query('SELECT COUNT(*) FROM shop_orders');
    const total = parseInt(countResult.rows[0].count, 10);
    const orderIds = orders.rows.map((r) => r.id);
    let itemRows = [];
    if (orderIds.length > 0) {
      const itemResult = await pool.query(
        `SELECT order_id, product_name, unit_price, quantity
         FROM shop_order_items WHERE order_id = ANY($1::int[])`,
        [orderIds]
      );
      itemRows = itemResult.rows;
    }
    const byOrder = {};
    itemRows.forEach((i) => {
      if (!byOrder[i.order_id]) byOrder[i.order_id] = [];
      byOrder[i.order_id].push(i);
    });
    res.json({
      orders: orders.rows.map((o) => ({ ...o, items: byOrder[o.id] || [] })),
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('Failed to fetch admin orders', err);
    res.status(500).json({ error: 'Unable to fetch orders' });
  }
});

app.delete('/api/admin/shop/orders/:id(\\d+)', authenticateToken, async (req, res) => {
  if (!isShopManager(req)) return res.status(403).json({ error: 'Forbidden' });
  const id = parseInt(req.params.id, 10);
  try {
    const result = await pool.query('DELETE FROM shop_orders WHERE id=$1 RETURNING id', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Order not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete order', err);
    res.status(500).json({ error: 'Unable to delete order' });
  }
});

app.put('/api/admin/shop/orders/:id(\\d+)/status', authenticateToken, async (req, res) => {
  if (!isShopManager(req)) return res.status(403).json({ error: 'Forbidden' });
  const id = parseInt(req.params.id, 10);
  const { status } = req.body;
  const validStatuses = ['pending', 'processing', 'shipped', 'completed', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  try {
    const result = await pool.query(
      'UPDATE shop_orders SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
      [status, id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Order not found' });
    res.json({ order: result.rows[0] });
  } catch (err) {
    console.error('Failed to update order status', err);
    res.status(500).json({ error: 'Unable to update order' });
  }
});

// ── PayPal helpers ─────────────────────────────────────────────────────────
function getPayPalConfig() {
  const env = parseEnvFile(fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, 'utf8') : '');
  const mode = env.PAYPAL_MODE === 'live' ? 'live' : 'sandbox';
  const baseUrl = mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  return { clientId: env.PAYPAL_CLIENT_ID || '', clientSecret: env.PAYPAL_CLIENT_SECRET || '', mode, baseUrl };
}

function paypalHttpRequest(hostname, urlPath, method, headers, body) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const bodyStr = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const reqHeaders = { ...headers };
    if (bodyStr) reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request({ hostname, path: urlPath, method, headers: reqHeaders }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (_e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function getPayPalAccessToken(cfg) {
  if (!cfg.clientId || !cfg.clientSecret) throw new Error('PayPal credentials not configured');
  const credentials = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
  const hostname = cfg.mode === 'live' ? 'api-m.paypal.com' : 'api-m.sandbox.paypal.com';
  const result = await paypalHttpRequest(hostname, '/v1/oauth2/token', 'POST', {
    'Authorization': 'Basic ' + credentials,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json',
  }, 'grant_type=client_credentials');
  if (!result.body.access_token) throw new Error('Failed to obtain PayPal access token');
  return result.body.access_token;
}

app.get('/api/shop/paypal/config', authenticateToken, (req, res) => {
  const cfg = getPayPalConfig();
  res.json({ client_id: cfg.clientId, mode: cfg.mode, configured: !!(cfg.clientId && cfg.clientSecret) });
});

app.post('/api/shop/paypal/create-order', authenticateToken, async (req, res) => {
  try {
    const cfg = getPayPalConfig();
    if (!cfg.clientId || !cfg.clientSecret) return res.status(503).json({ error: 'PayPal is not configured' });
    const cartResult = await pool.query(
      `SELECT c.quantity, p.price, p.name, p.active
       FROM shop_cart_items c JOIN shop_products p ON p.id = c.product_id
       WHERE c.user_id = $1`,
      [req.user.userId]
    );
    if (cartResult.rowCount === 0) return res.status(400).json({ error: 'Cart is empty' });
    const inactive = cartResult.rows.filter((r) => !r.active);
    if (inactive.length) return res.status(400).json({ error: `Items unavailable: ${inactive.map((r) => r.name).join(', ')}` });
    const total = cartResult.rows.reduce((s, r) => s + parseFloat(r.price) * r.quantity, 0);
    const accessToken = await getPayPalAccessToken(cfg);
    const hostname = cfg.mode === 'live' ? 'api-m.paypal.com' : 'api-m.sandbox.paypal.com';
    const ppOrder = await paypalHttpRequest(hostname, '/v2/checkout/orders', 'POST', {
      'Authorization': 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    }, { intent: 'CAPTURE', purchase_units: [{ amount: { currency_code: 'USD', value: total.toFixed(2) }, description: 'Krewe Mystique Shop' }] });
    if (ppOrder.status !== 201) {
      console.error('PayPal create-order failed', ppOrder.body);
      return res.status(502).json({ error: 'Payment provider error. Please try again.' });
    }
    res.json({ paypal_order_id: ppOrder.body.id });
  } catch (err) {
    console.error('PayPal create-order error', err);
    res.status(500).json({ error: 'Unable to initiate payment' });
  }
});

app.post('/api/shop/paypal/capture-order', authenticateToken, async (req, res) => {
  const { paypal_order_id, notes } = req.body;
  if (!paypal_order_id || typeof paypal_order_id !== 'string') {
    return res.status(400).json({ error: 'paypal_order_id is required' });
  }
  try {
    const cfg = getPayPalConfig();
    if (!cfg.clientId || !cfg.clientSecret) return res.status(503).json({ error: 'PayPal is not configured' });
    const accessToken = await getPayPalAccessToken(cfg);
    const hostname = cfg.mode === 'live' ? 'api-m.paypal.com' : 'api-m.sandbox.paypal.com';
    const capture = await paypalHttpRequest(hostname, `/v2/checkout/orders/${paypal_order_id}/capture`, 'POST', {
      'Authorization': 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    }, {});
    if (capture.status !== 201 || capture.body.status !== 'COMPLETED') {
      console.error('PayPal capture failed', capture.body);
      return res.status(402).json({ error: 'Payment was not completed' });
    }
    // Payment confirmed — record order in DB
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const cartResult = await client.query(
        `SELECT c.id AS cart_id, c.quantity, p.id AS product_id, p.name, p.price, p.stock_qty, p.active
         FROM shop_cart_items c JOIN shop_products p ON p.id = c.product_id
         WHERE c.user_id = $1`,
        [req.user.userId]
      );
      if (cartResult.rowCount === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Cart is empty' }); }
      const userResult = await client.query('SELECT full_name, email FROM users WHERE id=$1', [req.user.userId]);
      const buyer = userResult.rows[0];
      const total = cartResult.rows.reduce((s, r) => s + parseFloat(r.price) * r.quantity, 0);
      const orderResult = await client.query(
        `INSERT INTO shop_orders (user_id, buyer_name, buyer_email, total_amount, notes, status)
         VALUES ($1,$2,$3,$4,$5,'processing') RETURNING id`,
        [req.user.userId, buyer.full_name, buyer.email, total.toFixed(2), notes || null]
      );
      const orderId = orderResult.rows[0].id;
      for (const item of cartResult.rows) {
        await client.query(
          `INSERT INTO shop_order_items (order_id, product_id, product_name, unit_price, quantity) VALUES ($1,$2,$3,$4,$5)`,
          [orderId, item.product_id, item.name, item.price, item.quantity]
        );
        if (item.stock_qty != null) {
          await client.query('UPDATE shop_products SET stock_qty = GREATEST(0, stock_qty - $1) WHERE id=$2', [item.quantity, item.product_id]);
        }
      }
      await client.query('DELETE FROM shop_cart_items WHERE user_id=$1', [req.user.userId]);
      await client.query('COMMIT');
      res.json({ ok: true, order_id: orderId, total: total.toFixed(2) });
    } catch (dbErr) {
      await client.query('ROLLBACK');
      console.error('DB order recording failed after PayPal capture', dbErr);
      res.status(500).json({ error: 'Payment received but order recording failed. Contact support.' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('PayPal capture-order error', err);
    res.status(500).json({ error: 'Payment capture failed' });
  }
});

ensureContentTable()
  .then(() => {
    app.listen(port, () => {
      console.log(`Server listening on port ${port}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize database schema', error);
    process.exit(1);
  });
