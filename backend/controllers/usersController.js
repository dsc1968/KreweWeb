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

async function get__api_users(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  try {
    const result = await pool.query('SELECT id, email, full_name, role FROM users ORDER BY id ASC');
    res.json(result.rows);
  } catch (error) {
    console.error('Failed to fetch users', error);
    res.status(500).json({ error: 'Unable to fetch users' });
  }
}

async function get__api_current_season(req, res) {
  const sy = currentSeasonYear();
  const now = new Date();
  const year = now.getUTCFullYear();
  const end = resolveSeasonEndDate(year);
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const nextEnd = todayMs >= end.getTime() ? resolveSeasonEndDate(year + 1) : end;
  res.json({
    season_year: sy,
    ash_wednesday: ashWednesdayISO(sy),
    season_end_date: nextEnd.toISOString().slice(0, 10),
    season_end_config: parseSeasonEndConfig(),
  });
}

async function get__api_admin_users(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.full_name, u.role, u.joined_at,
              COALESCE(p.dues_paid,      false) AS dues_paid,
              COALESCE(p.guest_fee_paid, false) AS guest_fee_paid,
              COALESCE(p.beads_paid,     false) AS beads_paid,
              COALESCE(p.costume_paid,   false) AS costume_paid,
              COALESCE(p.float_captain,  false) AS float_captain
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       ORDER BY u.joined_at DESC, u.id DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Failed to fetch admin users', error);
    res.status(500).json({ error: 'Unable to fetch users' });
  }
}

async function get__api_admin_users__userId(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const userId = Number.parseInt(req.params.userId, 10);
  if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: 'Valid user id is required' });
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
      [userId]
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
    console.error('Failed to fetch user details', error);
    res.status(500).json({ error: 'Unable to fetch user details' });
  }
}

async function put__api_admin_users__userId_details(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const userId = Number.parseInt(req.params.userId, 10);
  if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: 'Valid user id is required' });

  const fullName = typeof req.body.full_name === 'string' ? req.body.full_name.trim() : '';
  const email = normalizeEmailAddress(req.body.email);
  const role = ['admin', 'store_admin', 'member', 'disabled'].includes(req.body.role) ? req.body.role : null;

  if (!fullName) return res.status(400).json({ error: 'Full name is required' });
  if (!email || !isValidEmailAddress(email)) return res.status(400).json({ error: 'Valid email is required' });
  if (!role) return res.status(400).json({ error: 'Role must be member, store_admin, admin, or disabled' });

  const phone = typeof req.body.phone === 'string' ? req.body.phone.trim().slice(0, 30) : null;
  const address = typeof req.body.address === 'string' ? req.body.address.trim().slice(0, 200) : null;
  const city    = typeof req.body.city    === 'string' ? req.body.city.trim().slice(0, 100)    : null;
  const state   = typeof req.body.state   === 'string' ? req.body.state.trim().slice(0, 50)    : null;
  const zip     = typeof req.body.zip     === 'string' ? req.body.zip.trim().slice(0, 20)      : null;
  const birthdate     = typeof req.body.birthdate     === 'string' && req.body.birthdate ? req.body.birthdate : null;
  const occupation    = typeof req.body.occupation    === 'string' ? req.body.occupation.trim().slice(0, 150)    : null;
  const organizations = typeof req.body.organizations === 'string' ? req.body.organizations.trim().slice(0, 500) : null;
  const sponsor_name  = typeof req.body.sponsor_name  === 'string' ? req.body.sponsor_name.trim().slice(0, 100)  : null;
  const spouse_name = typeof req.body.spouse_name === 'string' ? req.body.spouse_name.trim().slice(0, 100) : null;
  const guest_name = typeof req.body.guest_name === 'string' ? req.body.guest_name.trim().slice(0, 100) : null;
  const kidsRaw = Array.isArray(req.body.kids_names) ? req.body.kids_names : [];
  const ridersRaw = Array.isArray(req.body.float_riders) ? req.body.float_riders : [];
  const kids_names = kidsRaw.map((k) => String(k).trim().slice(0, 100)).filter(Boolean);
  const float_riders = ridersRaw.map((r) => String(r).trim().slice(0, 100)).filter(Boolean);

  const kidsBdRaw = Array.isArray(req.body.kids_birthdays) ? req.body.kids_birthdays : [];
  const kids_birthdays = kidsBdRaw.map((v) => (typeof v === 'string' && v ? v : null));
  const gcNamesRaw = Array.isArray(req.body.grandchildren_names) ? req.body.grandchildren_names : [];
  const grandchildren_names = gcNamesRaw.map((k) => String(k).trim().slice(0, 100)).filter(Boolean);
  const gcBdRaw = Array.isArray(req.body.grandchildren_birthdays) ? req.body.grandchildren_birthdays : [];
  const grandchildren_birthdays = gcBdRaw.map((v) => (typeof v === 'string' && v ? v : null));

  const kidsFloatRaw = Array.isArray(req.body.kids_float_numbers) ? req.body.kids_float_numbers : [];
  const riderFloatRaw = Array.isArray(req.body.rider_float_numbers) ? req.body.rider_float_numbers : [];
  const riderFloatNamesRaw = Array.isArray(req.body.rider_float_names) ? req.body.rider_float_names : [];
  const kids_float_numbers = kidsFloatRaw.map((v) => String(v ?? '').trim().slice(0, 20));
  const rider_float_numbers = riderFloatRaw.map((v) => String(v ?? '').trim().slice(0, 20));
  const rider_float_names = riderFloatNamesRaw.map((v) => String(v ?? '').trim().slice(0, 100));

  const member_float_number = typeof req.body.member_float_number === 'string' ? req.body.member_float_number.trim().slice(0, 20) : null;
  const spouse_float_number = typeof req.body.spouse_float_number === 'string' ? req.body.spouse_float_number.trim().slice(0, 20) : null;
  const guest_float_number = typeof req.body.guest_float_number === 'string' ? req.body.guest_float_number.trim().slice(0, 20) : null;
  const float_captain = Boolean(req.body.float_captain);

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
         user_id, phone, address, city, state, zip, birthdate, occupation, organizations,
         sponsor_name, spouse_name, kids_names, kids_birthdays,
         grandchildren_names, grandchildren_birthdays,
         guest_name, float_riders,
         member_float_number, spouse_float_number, guest_float_number,
         kids_float_numbers, rider_float_numbers, rider_float_names,
         float_captain, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17::jsonb,$18,$19,$20,$21::jsonb,$22::jsonb,$23::jsonb,$24,NOW())
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
         member_float_number=EXCLUDED.member_float_number,
         spouse_float_number=EXCLUDED.spouse_float_number,
         guest_float_number=EXCLUDED.guest_float_number,
         kids_float_numbers=EXCLUDED.kids_float_numbers,
         rider_float_numbers=EXCLUDED.rider_float_numbers,
         rider_float_names=EXCLUDED.rider_float_names,
         float_captain=EXCLUDED.float_captain,
         updated_at=NOW()`,
      [
        userId, phone||null, address||null, city||null, state||null, zip||null,
        birthdate||null, occupation||null, organizations||null,
        sponsor_name||null, spouse_name||null,
        JSON.stringify(kids_names), JSON.stringify(kids_birthdays),
        JSON.stringify(grandchildren_names), JSON.stringify(grandchildren_birthdays),
        guest_name||null, JSON.stringify(float_riders),
        member_float_number||null, spouse_float_number||null, guest_float_number||null,
        JSON.stringify(kids_float_numbers), JSON.stringify(rider_float_numbers), JSON.stringify(rider_float_names),
        float_captain,
      ]
    );
    await client.query('COMMIT');
    const u = userResult.rows[0];
    res.json({ user: { ...u } });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'Email already in use by another account' });
    console.error('Failed to update user details', error);
    res.status(500).json({ error: 'Unable to update user details' });
  } finally {
    client.release();
  }
}

async function post__api_admin_users(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const email = normalizeEmailAddress(req.body.email);
  const fullName = typeof req.body.full_name === 'string' ? req.body.full_name.trim() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const role = ['admin', 'store_admin'].includes(req.body.role) ? req.body.role : 'member';

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
}

async function post__api_users(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const email = normalizeEmailAddress(req.body.email);
  const fullName = typeof req.body.full_name === 'string' ? req.body.full_name.trim() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const role = ['admin', 'store_admin'].includes(req.body.role) ? req.body.role : 'member';

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
}

async function put__api_admin_users__userId_role(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const userId = Number.parseInt(req.params.userId, 10);
  const { role } = req.body;

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Valid user id is required' });
  }

  if (!['member', 'store_admin', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Role must be member, store_admin, or admin' });
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
}

async function put__api_users__userId_role(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const userId = Number.parseInt(req.params.userId, 10);
  const { role } = req.body;

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Valid user id is required' });
  }

  if (!['member', 'store_admin', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Role must be member, store_admin, or admin' });
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
}

async function put__api_admin_users__userId_disable(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const userId = Number.parseInt(req.params.userId, 10);
  const disabled = req.body && typeof req.body.disabled === 'boolean' ? req.body.disabled : null;
  // When re-enabling, caller may pass restore_role so a store_admin comes back as store_admin
  const restoreRole = ['member', 'store_admin', 'admin'].includes(req.body && req.body.restore_role)
    ? req.body.restore_role : 'member';

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
    const nextRole = disabled ? 'disabled' : restoreRole;
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
}

async function put__api_users__userId_disable(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const userId = Number.parseInt(req.params.userId, 10);
  const disabled = req.body && typeof req.body.disabled === 'boolean' ? req.body.disabled : null;
  const restoreRole = ['member', 'store_admin', 'admin'].includes(req.body && req.body.restore_role)
    ? req.body.restore_role : 'member';

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
    const nextRole = disabled ? 'disabled' : restoreRole;
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
}

async function delete__api_admin_users__userId(req, res) {
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
}

async function delete__api_users__userId(req, res) {
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
}

async function put__api_admin_users__userId_password(req, res) {
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
}

async function put__api_users__userId_password(req, res) {
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
}

async function get__api_admin_users__userId_orders(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const userId = Number.parseInt(req.params.userId, 10);
  if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: 'Valid user id is required' });
  try {
    const orders = await pool.query(
      `SELECT id, total_amount, status, notes, created_at
       FROM shop_orders WHERE user_id=$1 ORDER BY created_at DESC`,
      [userId],
    );
    const orderIds = orders.rows.map((r) => r.id);
    let itemRows = [];
    if (orderIds.length > 0) {
      const itemResult = await pool.query(
        `SELECT order_id, product_name, unit_price, quantity
         FROM shop_order_items WHERE order_id = ANY($1::int[])`,
        [orderIds],
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
    console.error('Failed to fetch user orders (admin)', err);
    res.status(500).json({ error: 'Unable to fetch orders' });
  }
}
module.exports = { delete__api_admin_users__userId,delete__api_users__userId,get__api_admin_users,get__api_admin_users__userId,get__api_admin_users__userId_orders,get__api_current_season,get__api_users,post__api_admin_users,post__api_users,put__api_admin_users__userId_details,put__api_admin_users__userId_disable,put__api_admin_users__userId_password,put__api_admin_users__userId_role,put__api_users__userId_disable,put__api_users__userId_password,put__api_users__userId_role, };
