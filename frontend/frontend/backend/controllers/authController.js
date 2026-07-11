const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { pool, JWT_SECRET, REGISTRATION_CODE_TTL_MINUTES, SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_REPLY_TO, CONTACT_RECIPIENT } = require('../config/db');
const { ADMIN_EDIT_EXCLUDED_PAGES, HEX_COLOR_PATTERN, LENGTH_VALUE_PATTERN, BORDER_STYLE_VALUES, normalizePagePath, isAdminEditablePagePath, validateEditablePagePath, normalizeHexColor, normalizeLengthValue, normalizeBorderStyle, normalizePositionMode, normalizeCoordinate, normalizeOpacityValue, isAdmin, isShopManager } = require('../utils/validation');
const { smtpTransport, normalizeEmailAddress, isValidEmailAddress, generateVerificationCode, maskVerificationTarget, sendVerificationMail, dispatchVerificationCode } = require('../utils/email');
const { appDir, fileBackupsDir, imagesDir, listImagesInDirectory, resolveEditableFilePath, storage, upload } = require('../utils/files');
const { ashWednesdayDate, ashWednesdayISO, checkAndRunSeasonReset, currentSeasonYear, easterDate, parseSeasonEndConfig, performSeasonReset, resolveSeasonEndDate, seasonEndISO } = require('../utils/season');
const { ENV_CONFIG_ALLOWLIST, envFilePath, parseEnvFile, serializeEnvFile } = require('../utils/envConfig');
const { appDir: _bAppDir, BACKUP_CONFIG_KEYS, backupIdSafe, collectBackupAppFiles, DB_TABLES_INSERT_ORDER, execFileAsync, extractZip, fileBackupsDir: _bFb, isSafeColumnName, isSafeRclonePath, listLocalBackupsFromDir, listRcloneBackupManifests, listS3BackupManifests, makeS3Client, rcloneDeleteFile, rcloneDownloadFile, rcloneListFiles, rcloneRun, rcloneUploadFile, readBackupConfig, removeDir, zipDirectory } = require('../utils/backup');

async function post__api_auth_register_request_code(req, res) {
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
}

async function post__api_auth_register_verify_code(req, res) {
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
    res.cookie('krewe_token', token, { path: '/', sameSite: 'lax' });
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
}

async function post__api_auth_login(req, res) {
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
    res.cookie('krewe_token', token, { path: '/', sameSite: 'lax' });
    res.json({ user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role }, token });
  } catch (error) {
    console.error('Login failed', error);
    res.status(500).json({ error: 'Unable to login' });
  }
}

async function get__api_profile(req, res) {
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.full_name, u.role, u.joined_at,
              p.phone, p.address, p.city, p.state, p.zip,
              p.birthdate, p.occupation, p.organizations, p.sponsor_name,
              p.spouse_name, p.kids_names, p.kids_birthdays,
              p.grandchildren_names, p.grandchildren_birthdays,
              p.guest_name, p.float_riders,
              p.member_float_number, p.spouse_float_number, p.guest_float_number,
              p.kids_float_numbers, p.rider_float_numbers, p.rider_float_names,
              COALESCE(p.dues_paid, false)        AS dues_paid,
              COALESCE(p.guest_fee_paid, false)   AS guest_fee_paid,
              COALESCE(p.beads_paid, false)       AS beads_paid,
              COALESCE(p.costume_paid, false)     AS costume_paid,
              COALESCE(p.float_captain, false)    AS float_captain
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       WHERE u.id = $1`,
      [req.user.userId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    const row = result.rows[0];
    res.json({
      ...row,
      kids_names: row.kids_names || [],
      kids_birthdays: row.kids_birthdays || [],
      grandchildren_names: row.grandchildren_names || [],
      grandchildren_birthdays: row.grandchildren_birthdays || [],
      float_riders: row.float_riders || [],
      kids_float_numbers: row.kids_float_numbers || [],
      rider_float_numbers: row.rider_float_numbers || [],
      rider_float_names: row.rider_float_names || [],
    });
  } catch (error) {
    console.error('Failed to fetch profile', error);
    res.status(500).json({ error: 'Unable to fetch profile' });
  }
}

async function put__api_profile_details(req, res) {
  const userId = req.user.userId;
  const phone       = typeof req.body.phone       === 'string' ? req.body.phone.trim().slice(0, 30)    : null;
  const address     = typeof req.body.address     === 'string' ? req.body.address.trim().slice(0, 200)  : null;
  const city        = typeof req.body.city        === 'string' ? req.body.city.trim().slice(0, 100)     : null;
  const state       = typeof req.body.state       === 'string' ? req.body.state.trim().slice(0, 50)     : null;
  const zip         = typeof req.body.zip         === 'string' ? req.body.zip.trim().slice(0, 20)       : null;
  const birthdate   = typeof req.body.birthdate   === 'string' && req.body.birthdate ? req.body.birthdate : null;
  const occupation  = typeof req.body.occupation  === 'string' ? req.body.occupation.trim().slice(0, 150) : null;
  const organizations = typeof req.body.organizations === 'string' ? req.body.organizations.trim().slice(0, 500) : null;
  const sponsor_name  = typeof req.body.sponsor_name  === 'string' ? req.body.sponsor_name.trim().slice(0, 100)  : null;
  const spouse_name   = typeof req.body.spouse_name   === 'string' ? req.body.spouse_name.trim().slice(0, 100)   : null;
  const guest_name    = typeof req.body.guest_name    === 'string' ? req.body.guest_name.trim().slice(0, 100)    : null;

  const kidsRaw = req.body.kids_names;
  if (!Array.isArray(kidsRaw)) return res.status(400).json({ error: 'kids_names must be an array' });
  const kids_names = kidsRaw.map((k) => String(k).trim().slice(0, 100)).filter(Boolean);

  const kidsBdRaw = Array.isArray(req.body.kids_birthdays) ? req.body.kids_birthdays : [];
  const kids_birthdays = kidsBdRaw.map((v) => (typeof v === 'string' && v ? v : null));

  const gcNamesRaw = Array.isArray(req.body.grandchildren_names) ? req.body.grandchildren_names : [];
  const grandchildren_names = gcNamesRaw.map((k) => String(k).trim().slice(0, 100)).filter(Boolean);

  const gcBdRaw = Array.isArray(req.body.grandchildren_birthdays) ? req.body.grandchildren_birthdays : [];
  const grandchildren_birthdays = gcBdRaw.map((v) => (typeof v === 'string' && v ? v : null));

  const ridersRaw = req.body.float_riders;
  if (!Array.isArray(ridersRaw)) return res.status(400).json({ error: 'float_riders must be an array' });
  const float_riders = ridersRaw.map((r) => String(r).trim().slice(0, 100)).filter(Boolean);

  const riderFloatNamesRaw = Array.isArray(req.body.rider_float_names)   ? req.body.rider_float_names   : [];
  const riderFloatNumsRaw  = Array.isArray(req.body.rider_float_numbers) ? req.body.rider_float_numbers : [];
  const rider_float_names   = riderFloatNamesRaw.map((v) => String(v ?? '').trim().slice(0, 100));
  const rider_float_numbers = riderFloatNumsRaw.map((v)  => String(v ?? '').trim().slice(0, 20));
  const float_captain = Boolean(req.body.float_captain);

  try {
    await pool.query(
      `INSERT INTO user_profiles (
         user_id, phone, address, city, state, zip, birthdate, occupation, organizations,
         sponsor_name, spouse_name, kids_names, kids_birthdays,
         grandchildren_names, grandchildren_birthdays,
         guest_name, float_riders, rider_float_names, rider_float_numbers, float_captain, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17::jsonb,$18::jsonb,$19::jsonb,$20,NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         phone=EXCLUDED.phone, address=EXCLUDED.address,
         city=EXCLUDED.city, state=EXCLUDED.state, zip=EXCLUDED.zip,
         birthdate=EXCLUDED.birthdate, occupation=EXCLUDED.occupation,
         organizations=EXCLUDED.organizations, sponsor_name=EXCLUDED.sponsor_name,
         spouse_name=EXCLUDED.spouse_name,
         kids_names=EXCLUDED.kids_names, kids_birthdays=EXCLUDED.kids_birthdays,
         grandchildren_names=EXCLUDED.grandchildren_names,
         grandchildren_birthdays=EXCLUDED.grandchildren_birthdays,
         guest_name=EXCLUDED.guest_name, float_riders=EXCLUDED.float_riders,
         rider_float_names=EXCLUDED.rider_float_names,
         rider_float_numbers=EXCLUDED.rider_float_numbers,
         float_captain=EXCLUDED.float_captain,
         updated_at=NOW()`,
      [
        userId, phone||null, address||null, city||null, state||null, zip||null,
        birthdate||null, occupation||null, organizations||null,
        sponsor_name||null, spouse_name||null,
        JSON.stringify(kids_names), JSON.stringify(kids_birthdays),
        JSON.stringify(grandchildren_names), JSON.stringify(grandchildren_birthdays),
        guest_name||null, JSON.stringify(float_riders),
        JSON.stringify(rider_float_names), JSON.stringify(rider_float_numbers), float_captain,
      ]
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('Failed to update profile details', error);
    res.status(500).json({ error: 'Unable to update profile details' });
  }
}

async function get__api_members(req, res) {
  try {
    const result = await pool.query('SELECT id, email, full_name, role, joined_at FROM users WHERE role = $1 ORDER BY joined_at DESC', ['member']);
    res.json(result.rows);
  } catch (error) {
    console.error('Failed to fetch members', error);
    res.status(500).json({ error: 'Unable to fetch members' });
  }
}
function generateToken(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}
module.exports = { generateToken,get__api_members,get__api_profile,post__api_auth_login,post__api_auth_register_request_code,post__api_auth_register_verify_code,put__api_profile_details, };
