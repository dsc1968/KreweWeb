const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { pool, JWT_SECRET, REGISTRATION_CODE_TTL_MINUTES, SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_REPLY_TO, CONTACT_RECIPIENT } = require('../config/db');
const { ADMIN_EDIT_EXCLUDED_PAGES, HEX_COLOR_PATTERN, LENGTH_VALUE_PATTERN, BORDER_STYLE_VALUES, normalizePagePath, isAdminEditablePagePath, validateEditablePagePath, normalizeHexColor, normalizeLengthValue, normalizeBorderStyle, normalizePositionMode, normalizeCoordinate, normalizeOpacityValue, isAdmin, isShopManager, isFloatAdmin, isFinanceAdmin } = require('../utils/validation');
const { floatLockEnabled, setFloatLock } = require('../utils/floatsLock');
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
      `SELECT u.id, u.email, u.full_name, u.role, u.joined_at, u.mfa_method, u.mfa_enrolled,
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
      `SELECT u.id, u.email, u.full_name, u.role, u.joined_at, u.mfa_method, u.mfa_enrolled,
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

    // Tie the user-admin view to the float-admin data. A member links to one
    // float via user_profiles.float_id, and may also be the captain_user_id of
    // a float. Both are surfaced so the admin profile shows the same
    // floats/riders/captain as the float admin tool.
    let assigned_float = null;
    let captain_of = null;
    const fl = await pool.query('SELECT float_id FROM user_profiles WHERE user_id = $1', [userId]);
    const floatId = fl.rowCount > 0 ? fl.rows[0].float_id : null;
    if (floatId) {
      const af = await pool.query('SELECT id, name, float_number FROM floats WHERE id = $1', [floatId]);
      if (af.rowCount > 0) assigned_float = { id: af.rows[0].id, name: af.rows[0].name, float_number: af.rows[0].float_number };
    }
    const cap = await pool.query('SELECT id, name, float_number FROM floats WHERE captain_user_id = $1', [userId]);
    if (cap.rowCount > 0) captain_of = { id: cap.rows[0].id, name: cap.rows[0].name, float_number: cap.rows[0].float_number };

    res.json({
      ...row,
      float_id: floatId,
      assigned_float,
      captain_of,
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
  const role = ['admin', 'store_admin', 'member', 'disabled', 'float_admin', 'finance_admin', 'guest'].includes(req.body.role) ? req.body.role : null;

  if (!fullName) return res.status(400).json({ error: 'Full name is required' });
  if (!email || !isValidEmailAddress(email)) return res.status(400).json({ error: 'Valid email is required' });
  if (!role) return res.status(400).json({ error: 'Role must be member, store_admin, admin, float_admin, finance_admin, guest, or disabled' });

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
  // Each rider is { name, comment }; tolerate legacy string entries.
  let float_riders = ridersRaw.map((r) => {
    if (r && typeof r === 'object') {
      const name = typeof r.name === 'string' ? r.name.trim().slice(0, 100) : '';
      const comment = typeof r.comment === 'string' ? r.comment.trim().slice(0, 500) : '';
      const rawFid = typeof r.float_id === 'string' ? parseInt(r.float_id, 10) : r.float_id;
      const float_id = Number.isInteger(rawFid) && rawFid > 0 ? rawFid : null;
      if (!name && !comment && !float_id) return null;
      return { name, comment, float_id };
    }
    const name = String(r).trim().slice(0, 100);
    return name ? { name, comment: '', float_id: null } : null;
  }).filter(Boolean);

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

  let member_float_number = typeof req.body.member_float_number === 'string' ? req.body.member_float_number.trim().slice(0, 20) : null;
  const spouse_float_number = typeof req.body.spouse_float_number === 'string' ? req.body.spouse_float_number.trim().slice(0, 20) : null;
  const guest_float_number = typeof req.body.guest_float_number === 'string' ? req.body.guest_float_number.trim().slice(0, 20) : null;
  const float_captain = Boolean(req.body.float_captain);

  // Admin-managed MFA preference (Security tab of the user admin tool). Lets an
  // administrator set the user's MFA method directly, mirroring what a user can
  // choose in their own profile but with the authority to disable MFA or pick a
  // method. Methods must stay in sync with authController's allowed set.
  let mfaMethod = null;
  let mfaEnrolled = false;
  let mfaNote = null;
  let mfaSetCols = '';
  let mfaSetVals = [];
  if (typeof req.body.mfa_method === 'string') {
    const allowedMfa = ['none', 'email', 'sms', 'authenticator'];
    if (!allowedMfa.includes(req.body.mfa_method)) {
      return res.status(400).json({ error: 'Invalid MFA method' });
    }
    mfaMethod = req.body.mfa_method;
    mfaEnrolled = req.body.mfa_enrolled === true || req.body.mfa_enrolled === 'true' || req.body.mfa_enrolled === 1;
    // SMS requires a phone number on the user's profile.
    if (mfaMethod === 'sms') {
      let phoneForMfa = phone;
      if (!phoneForMfa) {
        try {
          const pr = await pool.query('SELECT phone FROM user_profiles WHERE user_id = $1', [userId]);
          phoneForMfa = (pr.rows[0] && pr.rows[0].phone) || '';
        } catch (_e) { /* fall through to the phone check below */ }
      }
      if (!phoneForMfa) return res.status(400).json({ error: 'A phone number is required to use SMS for MFA.' });
    }
    // Authenticator: if enabling but the user has no secret yet, force
    // re-enrollment on next sign-in instead of locking them out.
    if (mfaMethod === 'authenticator' && mfaEnrolled) {
      try {
        const sr = await pool.query('SELECT mfa_secret FROM users WHERE id = $1', [userId]);
        if (!(sr.rows[0] && sr.rows[0].mfa_secret)) {
          mfaEnrolled = false;
          mfaNote = 'User has no authenticator secret yet and must enroll from their profile on next sign-in.';
        }
      } catch (_e) { /* fall through */ }
    }
    const mfaCols = ['mfa_method = $5', 'mfa_enrolled = $6'];
    const mfaValues = [mfaMethod, mfaEnrolled];
    if (mfaMethod === 'none') mfaCols.push('mfa_secret = NULL');
    mfaSetCols = mfaCols.join(', ');
    mfaSetVals = mfaValues;
  }

  // Link the member to a float when their float number matches an existing
  // float. This keeps the float admin roster in sync with the profile.
  let adminFloatId = null;
  if (member_float_number) {
    try {
      const fr = await pool.query('SELECT id FROM floats WHERE float_number = $1 LIMIT 1', [member_float_number]);
      if (fr.rowCount > 0) adminFloatId = fr.rows[0].id;
    } catch (_e) { /* leave unlinked if lookup fails */ }
  }

  // When floats are locked, only the Float Admin may edit float assignments.
  if (await floatLockEnabled() && req.user.role !== 'float_admin') {
    try {
      const cur = await pool.query(
        'SELECT float_riders, member_float_number, float_id FROM user_profiles WHERE user_id = $1',
        [userId]
      );
      const c = cur.rows.length ? cur.rows[0] : {};
      const asArray = (v) => (Array.isArray(v) ? v : []);
      float_riders = asArray(c.float_riders);
      member_float_number = c.member_float_number != null ? c.member_float_number : null;
      adminFloatId = c.float_id != null ? c.float_id : null;
    } catch (_e) { /* keep computed values if lookup fails */ }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userResult = await client.query(
      `UPDATE users SET full_name = $1, email = $2, role = $3${mfaSetCols ? ', ' + mfaSetCols : ''} WHERE id = $4
       RETURNING id, email, full_name, role, joined_at, mfa_method, mfa_enrolled`,
      [fullName, email, role, userId, ...mfaSetVals]
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
         float_captain, float_id, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17::jsonb,$18,$19,$20,$21::jsonb,$22::jsonb,$23::jsonb,$24,$25,NOW())
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
         float_captain=EXCLUDED.float_captain, float_id=EXCLUDED.float_id,
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
        float_captain, adminFloatId,
      ]
    );
    await client.query('COMMIT');
    const u = userResult.rows[0];
    res.json({ user: { ...u }, mfa_note: mfaNote });
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
  const role = ['admin', 'store_admin', 'member', 'float_admin', 'finance_admin', 'guest'].includes(req.body.role) ? req.body.role : 'member';

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
  const role = ['admin', 'store_admin', 'member', 'float_admin', 'finance_admin', 'guest'].includes(req.body.role) ? req.body.role : 'member';

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

  if (!['member', 'store_admin', 'admin', 'float_admin', 'finance_admin', 'guest'].includes(role)) {
    return res.status(400).json({ error: 'Role must be member, store_admin, admin, float_admin, or finance_admin' });
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

  if (!['member', 'store_admin', 'admin', 'float_admin', 'finance_admin', 'guest'].includes(role)) {
    return res.status(400).json({ error: 'Role must be member, store_admin, admin, float_admin, or finance_admin' });
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
  const restoreRole = ['member', 'store_admin', 'admin', 'float_admin', 'finance_admin', 'guest'].includes(req.body && req.body.restore_role)
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
  const restoreRole = ['member', 'store_admin', 'admin', 'float_admin', 'finance_admin', 'guest'].includes(req.body && req.body.restore_role)
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
async function patch__api_admin_users__userId_payments(req, res) {
  if (!isFinanceAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const userId = Number.parseInt(req.params.userId, 10);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Valid user id is required' });
  }

  // Partial update: only the payment flags actually present in the body are
  // changed. This keeps the full admin modal (which sends all four) working
  // while also supporting the finance console's single-toggle updates without
  // wiping the other three flags.
  const fieldMap = {
    dues_paid: req.body && req.body.dues_paid,
    guest_fee_paid: req.body && req.body.guest_fee_paid,
    beads_paid: req.body && req.body.beads_paid,
    costume_paid: req.body && req.body.costume_paid,
  };
  const updates = Object.keys(fieldMap).filter((k) => fieldMap[k] !== undefined);
  if (updates.length === 0) {
    return res.status(400).json({ error: 'No payment field provided' });
  }

  try {
    // Ensure a profile row exists, then update only the provided payment flags.
    await pool.query(
      `INSERT INTO user_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );
    const sets = updates.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const params = updates.map((k) => Boolean(fieldMap[k]));
    params.push(userId);
    const result = await pool.query(
      `UPDATE user_profiles
       SET ${sets}
       WHERE user_id = $${params.length}
       RETURNING dues_paid, guest_fee_paid, beads_paid, costume_paid`,
      params
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const row = result.rows[0];
    res.json({
      user: {
        dues_paid: row.dues_paid,
        guest_fee_paid: row.guest_fee_paid,
        beads_paid: row.beads_paid,
        costume_paid: row.costume_paid,
      },
    });
  } catch (error) {
    console.error('Failed to update payment status', error);
    res.status(500).json({ error: 'Unable to update payment status' });
  }
}

// ── Float admin (scoped): list every member's float roster ──────────────────
// Gated to float admins (and full admins). Returns only the float-related
// columns so a float admin never sees unrelated PII or admin powers.
async function get__api_floats(req, res) {
  try {
    const result = await pool.query(
      `SELECT id, name, float_number
       FROM floats
       ORDER BY float_number NULLS LAST, name`,
    );
    res.json(result.rows.map((r) => ({ id: r.id, name: r.name, float_number: r.float_number })));
  } catch (error) {
    console.error('Failed to fetch floats', error);
    res.status(500).json({ error: 'Unable to fetch floats' });
  }
}

async function get__api_admin_floats(req, res) {
  if (!isFloatAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const floatsRes = await pool.query(
      `SELECT f.id, f.name, f.float_number, f.captain_user_id, f.description, f.capacity, f.position
       FROM floats f
       ORDER BY f.position ASC, f.name ASC`
    );
    const floats = floatsRes.rows.map((r) => ({
      id: r.id,
      name: r.name,
      float_number: r.float_number,
      captain_user_id: r.captain_user_id,
      description: r.description || '',
      capacity: (typeof r.capacity === 'number') ? r.capacity : (r.capacity != null ? parseInt(r.capacity, 10) : null),
      position: r.position,
      riders: [],
      current_riders: 0,
    }));
    // Riders live on each sponsoring member's profile (user_profiles
    // .float_riders, stored as { name, comment }); reconstruct a flat per-float
    // rider list so the admin tool can render one user list.
    const membersRes = await pool.query(
      `SELECT p.float_id AS float_id, u.id AS user_id, u.full_name, u.email,
              p.float_riders, p.member_float_number
       FROM user_profiles p
       JOIN users u ON u.id = p.user_id
       WHERE p.float_id IS NOT NULL
       ORDER BY u.full_name ASC`
    );
    const ridersByFloat = {};
    membersRes.rows.forEach((r) => {
      const memberFid = r.float_id;
      const riders = Array.isArray(r.float_riders) ? r.float_riders : [];
      const pushRider = (name, comment, fid) => {
        if (!ridersByFloat[fid]) ridersByFloat[fid] = [];
        ridersByFloat[fid].push({ user_id: r.user_id, name, comment, float_id: fid });
      };
      if (riders.length === 0) {
        // A sponsoring member with no riders still appears in the list (under
        // their own float, if they have one).
        if (memberFid) pushRider('', '', memberFid);
        return;
      }
      riders.forEach((rider) => {
        const name = (rider && typeof rider === 'object') ? (rider.name || '') : String(rider || '');
        const comment = (rider && typeof rider === 'object') ? (rider.comment || '') : '';
        // A rider may be assigned to any float, not just the sponsoring
        // member's float (Option B: riders carry their own float_id).
        const fid = (rider && typeof rider === 'object' && rider.float_id) ? rider.float_id : memberFid;
        if (!fid) return;
        if (name || comment) pushRider(name, comment, fid);
      });
    });
    // Defensive: collapse any residual duplicate riders per float (keyed by
    // sponsoring member + name + comment) so the admin tool never shows a
    // rider twice even if stored data still carries legacy duplicates.
    Object.keys(ridersByFloat).forEach((fid) => {
      const seen = new Set();
      ridersByFloat[fid] = ridersByFloat[fid].filter((r) => {
        const key = (r.user_id || '') + '|' + (r.name || '') + '|' + (r.comment || '');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    });
    const usersRes = await pool.query(
      `SELECT u.id, u.full_name, u.email
       FROM users u
       WHERE u.role <> 'disabled'
       ORDER BY u.full_name ASC`
    );
    floats.forEach((f) => { f.riders = ridersByFloat[f.id] || []; f.current_riders = f.riders.length; });
    res.json({ floats, users: usersRes.rows, locked: await floatLockEnabled() });
  } catch (error) {
    console.error('Failed to fetch floats', error);
    res.status(500).json({ error: 'Unable to fetch floats' });
  }
}

// ── Float admin (scoped): create / update / delete floats and manage members ──
// Floats are first-class entities. A member added to a float gets their
// user_profiles.float_id set (and member_float_number synced to the float's
// number) so the user's profile reflects the float they belong to. A float
// admin cannot touch role, email, password, or any other field.
// A rider entry in the admin tool is a flat row: the sponsoring member it
// belongs to (user_id) plus the rider's name and an optional comment.
function normalizeFloatRider(r) {
  if (r == null || typeof r !== 'object') return null;
  let user_id = null;
  const rawUid = typeof r.user_id === 'string' ? parseInt(r.user_id, 10) : r.user_id;
  if (Number.isInteger(rawUid) && rawUid > 0) user_id = rawUid;
  const name = typeof r.name === 'string' ? r.name.trim().slice(0, 100) : '';
  const comment = typeof r.comment === 'string' ? r.comment.trim().slice(0, 500) : '';
  const rawFid = typeof r.float_id === 'string' ? parseInt(r.float_id, 10) : r.float_id;
  const float_id = Number.isInteger(rawFid) && rawFid > 0 ? rawFid : null;
  // Drop fully empty rows; keep rows that reference a member (a sponsoring
  // member may have no riders of their own yet) or carry any rider text.
  if (!user_id && !name && !comment) return null;
  return { user_id, name, comment, float_id };
}

// Persist a float's flat rider list onto member profiles. Each rider's
// sponsoring member gets user_profiles.float_riders set to that member's riders
// and is linked to the float (float_id, with member_float_number synced to the
// float's number). Members who were on this float but are no longer referenced
// are detached and have their riders cleared (a member belongs to one float).
async function applyFloatRiders(client, floatId, floatNumber, riders) {
  // Group incoming riders by sponsoring member. Each rider carries its own
  // float_id (may differ from the float being saved when a member has riders
  // on several floats); a missing float_id defaults to the float being saved.
  const byMember = {};
  riders.forEach((r) => {
    if (!r.user_id) return;
    if (!byMember[r.user_id]) byMember[r.user_id] = [];
    if (r.name || r.comment) {
      const fid = r.float_id ? r.float_id : floatId;
      byMember[r.user_id].push({ name: r.name, comment: r.comment, float_id: fid });
    }
  });
  const newMemberIds = new Set(Object.keys(byMember).map(Number));

  const prev = await client.query('SELECT user_id FROM user_profiles WHERE float_id = $1', [floatId]);
  const prevIds = new Set(prev.rows.map((r) => r.user_id));

  for (const userId of newMemberIds) {
    await client.query('INSERT INTO user_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
    // Preserve this member's riders that belong to OTHER floats; replace only
    // the riders for the float currently being saved.
    const ex = await client.query('SELECT float_riders FROM user_profiles WHERE user_id = $1', [userId]);
    const existing = Array.isArray(ex.rows[0] && ex.rows[0].float_riders) ? ex.rows[0].float_riders : [];
    const kept = existing.filter((rr) => rr && rr.float_id && rr.float_id !== floatId);
    const merged = kept.concat(byMember[userId]);
    await client.query(
      `UPDATE user_profiles
       SET float_id = $1, member_float_number = $2, float_riders = $3::jsonb, updated_at = NOW()
       WHERE user_id = $4`,
      [floatId, floatNumber, JSON.stringify(merged), userId]
    );
  }
  for (const userId of prevIds) {
    if (!newMemberIds.has(userId)) {
      // Detach only this float's riders; keep riders the member has on other
      // floats. If none remain, also clear their personal float link.
      const ex = await client.query('SELECT float_riders, float_id FROM user_profiles WHERE user_id = $1 AND float_id = $2', [userId, floatId]);
      if (ex.rowCount > 0) {
        const existing = Array.isArray(ex.rows[0].float_riders) ? ex.rows[0].float_riders : [];
        const kept = existing.filter((rr) => rr && rr.float_id && rr.float_id !== floatId);
        if (kept.length > 0) {
          await client.query(
            `UPDATE user_profiles SET float_riders = $1::jsonb, updated_at = NOW() WHERE user_id = $2 AND float_id = $3`,
            [JSON.stringify(kept), userId, floatId]
          );
        } else {
          await client.query(
            `UPDATE user_profiles SET float_id = NULL, member_float_number = NULL, float_riders = '[]'::jsonb, updated_at = NOW() WHERE user_id = $1 AND float_id = $2`,
            [userId, floatId]
          );
        }
      }
    }
  }
}

async function post__api_admin_floats(req, res) {
  if (!isFloatAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'Float name is required' });
  const float_number = typeof req.body.float_number === 'string' ? req.body.float_number.trim().slice(0, 20) : null;
  const description = typeof req.body.description === 'string' ? req.body.description.trim().slice(0, 2000) : null;
  const captainRaw = req.body.captain_user_id;
  const captain_user_id = Number.isInteger(captainRaw) && captainRaw > 0 ? captainRaw : null;
  const capacityRaw = req.body.capacity;
  const capacity = Number.isInteger(capacityRaw) && capacityRaw > 0 ? capacityRaw : null;
  const created_by = req.user && req.user.userId ? req.user.userId : null;
  const riders = Array.isArray(req.body.riders) ? req.body.riders.map(normalizeFloatRider).filter(Boolean) : [];

  // Block duplicates: no two floats may share a name (case-insensitive) or a
  // float number (when one is supplied). This keeps the float admin from
  // creating "Parade 1" twice or reusing another float's number.
  const dup = await pool.query(
    `SELECT id, name, float_number FROM floats
     WHERE LOWER(name) = LOWER($1::text)
        OR (float_number IS NOT NULL AND $2::text IS NOT NULL AND LOWER(float_number) = LOWER($2::text))`,
    [name, float_number || null]
  );
  if (dup.rowCount > 0) {
    const clash = dup.rows[0];
    const field = (clash.float_number && float_number && clash.float_number.toLowerCase() === float_number.toLowerCase())
      ? 'number' : 'name';
    return res.status(409).json({
      error: `A float with that ${field} already exists`,
      field,
      existing: { id: clash.id, name: clash.name, float_number: clash.float_number },
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await pool.query(
      `INSERT INTO floats (name, float_number, captain_user_id, description, capacity, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, float_number, captain_user_id, description, capacity, position`,
      [name, float_number || null, captain_user_id, description || null, capacity, created_by]
    );
    const row = result.rows[0];
    await applyFloatRiders(client, row.id, float_number || null, riders);
    await client.query('COMMIT');
    res.status(201).json({
      id: row.id, name: row.name, float_number: row.float_number,
      captain_user_id: row.captain_user_id, description: row.description || '',
      capacity: row.capacity, position: row.position, riders: [],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to create float', error);
    res.status(500).json({ error: 'Unable to create float' });
  } finally {
    client.release();
  }
}

async function put__api_admin_floats__floatId(req, res) {
  const floatId = Number.parseInt(req.params.floatId, 10);
  if (!Number.isInteger(floatId) || floatId <= 0) return res.status(400).json({ error: 'Valid float id is required' });
  if (!isFloatAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'Float name is required' });
  const float_number = typeof req.body.float_number === 'string' ? req.body.float_number.trim().slice(0, 20) : null;
  const description = typeof req.body.description === 'string' ? req.body.description.trim().slice(0, 2000) : null;
  const captainRaw = req.body.captain_user_id;
  const captain_user_id = Number.isInteger(captainRaw) && captainRaw > 0 ? captainRaw : null;
  const capacityRaw = req.body.capacity;
  const capacity = Number.isInteger(capacityRaw) && capacityRaw > 0 ? capacityRaw : null;
  const riders = Array.isArray(req.body.riders) ? req.body.riders.map(normalizeFloatRider).filter(Boolean) : [];

  // Block duplicates, but ignore this float itself (a float may keep its own
  // name/number). Name is matched case-insensitively; float number is matched
  // only when the incoming number is non-empty.
  const dup = await pool.query(
    `SELECT id, name, float_number FROM floats
     WHERE id <> $3
       AND (LOWER(name) = LOWER($1::text)
            OR (float_number IS NOT NULL AND $2::text IS NOT NULL AND LOWER(float_number) = LOWER($2::text)))`,
    [name, float_number || null, floatId]
  );
  if (dup.rowCount > 0) {
    const clash = dup.rows[0];
    const field = (clash.float_number && float_number && clash.float_number.toLowerCase() === float_number.toLowerCase())
      ? 'number' : 'name';
    return res.status(409).json({
      error: `A float with that ${field} already exists`,
      field,
      existing: { id: clash.id, name: clash.name, float_number: clash.float_number },
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const upd = await client.query(
      `UPDATE floats
       SET name=$1, float_number=$2, captain_user_id=$3, description=$4, capacity=$5, updated_at=NOW()
       WHERE id=$6
       RETURNING id, name, float_number, captain_user_id, description, capacity, position`,
      [name, float_number || null, captain_user_id, description || null, capacity, floatId]
    );
    if (upd.rowCount === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Float not found' }); }
    // Riders live on each sponsoring member's profile and the member is linked
    // to the float, so the data entered here also appears in that member's own
    // profile "Float Riders" section.
    await applyFloatRiders(client, floatId, float_number || null, riders);
    await client.query('COMMIT');
    const row = upd.rows[0];
    res.json({
      id: row.id, name: row.name, float_number: row.float_number,
      captain_user_id: row.captain_user_id, description: row.description || '',
      capacity: row.capacity, position: row.position,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to update float', error);
    res.status(500).json({ error: 'Unable to update float' });
  } finally {
    client.release();
  }
}

async function delete__api_admin_floats__floatId(req, res) {
  const floatId = Number.parseInt(req.params.floatId, 10);
  if (!Number.isInteger(floatId) || floatId <= 0) return res.status(400).json({ error: 'Valid float id is required' });
  if (!isFloatAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Detach members (and clear their riders) so their profile no longer
    // references the deleted float.
    await client.query(
      `UPDATE user_profiles SET float_id = NULL, member_float_number = NULL, float_riders = '[]'::jsonb, updated_at = NOW() WHERE float_id = $1`,
      [floatId]
    );
    const del = await client.query('DELETE FROM floats WHERE id = $1 RETURNING id', [floatId]);
    if (del.rowCount === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Float not found' }); }
    await client.query('COMMIT');
    res.json({ deleted: true, id: floatId });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to delete float', error);
    res.status(500).json({ error: 'Unable to delete float' });
  } finally {
    client.release();
  }
}



async function delete__api_admin_floats__floatId_riders(req, res) {
  const floatId = Number.parseInt(req.params.floatId, 10);
  if (!Number.isInteger(floatId) || floatId <= 0) return res.status(400).json({ error: 'Valid float id is required' });
  if (!isFloatAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const userId = Number(req.body.user_id) || null;
  if (!userId) return res.status(400).json({ error: 'user_id is required' });
  const name = typeof req.body.name === 'string' ? req.body.name : '';
  const comment = typeof req.body.comment === 'string' ? req.body.comment : '';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ex = await client.query('SELECT float_riders, float_id FROM user_profiles WHERE user_id = $1', [userId]);
    if (ex.rowCount === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Member not found' }); }
    const existing = Array.isArray(ex.rows[0].float_riders) ? ex.rows[0].float_riders : [];
    const kept = existing.filter((rr) => {
      if (!rr || rr.float_id !== floatId) return true;
      const rn = rr.name || '';
      const rc = rr.comment || '';
      return !(rn === name && rc === comment);
    });
    if (kept.length === existing.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Rider not found on this float' });
    }
    if (kept.length > 0 || ex.rows[0].float_id !== floatId) {
      // Keep the member's own float link if they still have other riders here,
      // or if this float was never their own float.
      await client.query(
        `UPDATE user_profiles SET float_riders = $1::jsonb, updated_at = NOW() WHERE user_id = $2`,
        [JSON.stringify(kept), userId]
      );
    } else {
      // No riders remain for this float and it was the member's own float: detach.
      await client.query(
        `UPDATE user_profiles SET float_id = NULL, member_float_number = NULL, float_riders = '[]'::jsonb, updated_at = NOW() WHERE user_id = $1`,
        [userId]
      );
    }
    await client.query('COMMIT');
    res.json({ deleted: true, remaining: kept.length });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to delete rider', error);
    res.status(500).json({ error: 'Unable to delete rider' });
  } finally {
    client.release();
  }
}

// ── Finance admin (scoped): list every member's payment status ──────────────
// Gated to finance admins (and full admins). Returns only payment flags plus
// the guest name so dues can be reconciled; no other PII or admin powers.
async function get__api_admin_payments(req, res) {
  if (!isFinanceAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.full_name,
              p.guest_name,
              COALESCE(p.dues_paid, false)      AS dues_paid,
              COALESCE(p.guest_fee_paid, false) AS guest_fee_paid,
              COALESCE(p.beads_paid, false)     AS beads_paid,
              COALESCE(p.costume_paid, false)   AS costume_paid
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       WHERE u.role <> 'disabled'
       ORDER BY u.full_name ASC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Failed to fetch payments', error);
    res.status(500).json({ error: 'Unable to fetch payments' });
  }
}

async function put__api_admin_floats_lock(req, res) {
  // Guarded by requireFloatChange: when locked only the Float Admin may toggle;
  // when unlocked any float admin (admin or float_admin) may.
  if (!isFloatAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const locked = !!(req.body && req.body.locked === true);
  try {
    await setFloatLock(locked);
  } catch (error) {
    console.error('Failed to update float lock', error);
    return res.status(500).json({ error: 'Unable to update float lock' });
  }
  res.json({ locked });
}


function csvCell(value) {
  const s = value == null ? '' : String(value);
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

async function get__api_admin_floats_report(req, res) {
  if (!isFloatAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const format = (req.query.format || 'json').toLowerCase();
    const floatIdRaw = req.query.floatId;
    const floatId = floatIdRaw != null ? parseInt(floatIdRaw, 10) : null;
    if (floatId != null && Number.isNaN(floatId)) {
      return res.status(400).json({ error: 'Invalid floatId' });
    }

    const floatsRes = await pool.query(
      `SELECT f.id, f.name, f.float_number, f.description, f.capacity
       FROM floats f
       ${floatId != null ? 'WHERE f.id = $1' : ''}
       ORDER BY f.position ASC, f.name ASC`,
      floatId != null ? [floatId] : []
    );
    const floats = floatsRes.rows.map((r) => ({
      id: r.id,
      name: r.name || '',
      float_number: r.float_number || '',
      description: r.description || '',
      capacity: (typeof r.capacity === 'number') ? r.capacity : (r.capacity != null ? parseInt(r.capacity, 10) : null),
    }));

    const membersRes = await pool.query(
      `SELECT p.float_id AS float_id, u.id AS user_id, u.full_name, u.email, u.phone,
              p.sponsor_name, p.member_float_number, p.address, p.city, p.state, p.zip,
              p.float_riders
       FROM user_profiles p
       JOIN users u ON u.id = p.user_id
       ORDER BY u.full_name ASC`
    );

    const memberById = {};
    const ridersByFloat = {};
    membersRes.rows.forEach((r) => {
      memberById[r.user_id] = {
        user_id: r.user_id,
        full_name: r.full_name || '',
        email: r.email || '',
        phone: r.phone || '',
        sponsor_name: r.sponsor_name || '',
        member_float_number: r.member_float_number || '',
        address: r.address || '',
        city: r.city || '',
        state: r.state || '',
        zip: r.zip || '',
      };
      const memberFid = r.float_id;
      const riders = Array.isArray(r.float_riders) ? r.float_riders : [];
      const pushRider = (name, comment, fid) => {
        if (!ridersByFloat[fid]) ridersByFloat[fid] = [];
        ridersByFloat[fid].push({ name, comment, user_id: r.user_id });
      };
      if (riders.length === 0) {
        if (memberFid) pushRider('', '', memberFid);
        return;
      }
      riders.forEach((rider) => {
        const name = (rider && typeof rider === 'object') ? (rider.name || '') : String(rider || '');
        const comment = (rider && typeof rider === 'object') ? (rider.comment || '') : '';
        const fid = (rider && typeof rider === 'object' && rider.float_id) ? rider.float_id : memberFid;
        if (!fid) return;
        if (name || comment) pushRider(name, comment, fid);
      });
    });

    const reportFloats = floats.map((f) => ({
      id: f.id,
      name: f.name,
      float_number: f.float_number,
      description: f.description,
      capacity: f.capacity,
      riders: (ridersByFloat[f.id] || []).map((r) => ({
        name: r.name,
        comment: r.comment,
        member: memberById[r.user_id] || null,
      })),
    }));

    if (format === 'csv') {
      const header = ['Float', 'Float #', 'Rider Name', 'Comment', 'Sponsoring Member', 'Sponsor Name', 'Email', 'Phone', 'Member #', 'Address', 'City', 'State', 'Zip'];
      const rows = [];
      reportFloats.forEach((f) => {
        if (!f.riders.length) {
          rows.push([f.name, f.float_number, '', '', '', '', '', '', '', '', '', '', '']);
          return;
        }
        f.riders.forEach((r) => {
          const m = r.member || {};
          rows.push([
            f.name, f.float_number, r.name, r.comment,
            m.full_name || '', m.sponsor_name || '', m.email || '', m.phone || '',
            m.member_float_number || '', m.address || '', m.city || '', m.state || '', m.zip || '',
          ]);
        });
      });
      const csv = [header].concat(rows).map((row) => row.map(csvCell).join(',')).join('\r\n');
      const filename = (floatId != null ? 'float-' + floatId : 'floats') + '-report.csv';
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
      return res.status(200).send('\uFEFF' + csv);
    }

    res.json({ generatedAt: new Date().toISOString(), floats: reportFloats });
  } catch (error) {
    console.error('Failed to generate float report', error);
    res.status(500).json({ error: 'Unable to generate float report' });
  }
}

async function get__api_admin_users_report(req, res) {
  // Full admins or finance admins may view the users report (it is
  // payment-focused, so finance admins need access too).
  if (!isAdmin(req) && !isFinanceAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const format = (req.query.format || 'json').toLowerCase();

    // Display order for role groups — most privileged first, disabled last.
    const ROLE_ORDER = ['admin', 'float_admin', 'finance_admin', 'store_admin', 'member', 'guest', 'disabled'];
    const ROLE_LABELS = {
      admin: 'Admins',
      float_admin: 'Float Admins',
      finance_admin: 'Finance Admins',
      store_admin: 'Store Admins',
      member: 'Members',
      guest: 'Guests',
      disabled: 'Disabled',
    };

    const usersRes = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.phone AS user_phone, u.role, u.joined_at,
              p.phone AS profile_phone, p.sponsor_name, p.address, p.city, p.state, p.zip,
              p.member_float_number, p.birthdate, p.occupation, p.organizations,
              p.float_captain,
              COALESCE(p.dues_paid,      false) AS dues_paid,
              COALESCE(p.guest_fee_paid, false) AS guest_fee_paid,
              COALESCE(p.beads_paid,     false) AS beads_paid,
              COALESCE(p.costume_paid,   false) AS costume_paid
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       ORDER BY u.full_name ASC, u.id ASC`
    );

    const normPhone = (u) =>
      (u.profile_phone && String(u.profile_phone).trim()) ||
      (u.user_phone && String(u.user_phone).trim()) || '';

    // Group users by role; each group is already name-sorted by the query.
    const byRole = {};
    usersRes.rows.forEach((u) => {
      const role = u.role || 'member';
      if (!byRole[role]) byRole[role] = [];
      byRole[role].push({
        id: u.id,
        full_name: u.full_name || '',
        email: u.email || '',
        phone: normPhone(u),
        role: role,
        status: role === 'disabled' ? 'Disabled' : 'Active',
        joined_at: u.joined_at ? new Date(u.joined_at).toISOString() : '',
        dues_paid: Boolean(u.dues_paid),
        guest_fee_paid: Boolean(u.guest_fee_paid),
        beads_paid: Boolean(u.beads_paid),
        costume_paid: Boolean(u.costume_paid),
        float_captain: Boolean(u.float_captain),
        sponsor_name: u.sponsor_name || '',
        address: u.address || '',
        city: u.city || '',
        state: u.state || '',
        zip: u.zip || '',
        member_float_number: u.member_float_number || '',
        birthdate: u.birthdate ? String(u.birthdate) : '',
        occupation: u.occupation || '',
        organizations: u.organizations || '',
      });
    });

    const roles = ROLE_ORDER
      .filter((r) => byRole[r] && byRole[r].length)
      .map((r) => ({ role: r, label: ROLE_LABELS[r] || r, users: byRole[r] }));
    // Defensive: surface any role not in the known ordering.
    Object.keys(byRole).forEach((r) => {
      if (ROLE_ORDER.indexOf(r) === -1) {
        roles.push({ role: r, label: ROLE_LABELS[r] || r, users: byRole[r] });
      }
    });

    if (format === 'csv') {
      const header = [
        'Role', 'Name', 'Email', 'Phone', 'Status', 'Joined',
        'Dues', 'Guest Fee', 'Beads', 'Costume', 'Captain',
        'Sponsor', 'Address', 'City', 'State', 'Zip', 'Member #', 'Occupation', 'Organizations',
      ];
      const rows = [];
      roles.forEach((group) => {
        group.users.forEach((u) => {
          rows.push([
            group.label,
            u.full_name, u.email, u.phone, u.status,
            u.joined_at ? u.joined_at.slice(0, 10) : '',
            u.dues_paid ? 'Paid' : 'Unpaid',
            u.guest_fee_paid ? 'Paid' : 'Unpaid',
            u.beads_paid ? 'Paid' : 'Unpaid',
            u.costume_paid ? 'Paid' : 'Unpaid',
            u.float_captain ? 'Yes' : 'No',
            u.sponsor_name, u.address, u.city, u.state, u.zip,
            u.member_float_number, u.occupation, u.organizations,
          ]);
        });
      });
      const csv = [header].concat(rows).map((row) => row.map(csvCell).join(',')).join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="users-report.csv"');
      return res.status(200).send('\uFEFF' + csv);
    }

    res.json({ generatedAt: new Date().toISOString(), roles: roles });
  } catch (error) {
    console.error('Failed to generate users report', error);
    res.status(500).json({ error: 'Unable to generate users report' });
  }
}

module.exports = {
 get__api_admin_floats_report,
 get__api_admin_users_report,
 delete__api_admin_users__userId,delete__api_users__userId,get__api_floats,get__api_admin_floats,get__api_admin_payments,get__api_admin_users,get__api_admin_users__userId,get__api_admin_users__userId_orders,get__api_current_season,get__api_users,post__api_admin_users,post__api_users,put__api_admin_users__userId_details,put__api_admin_users__userId_disable,put__api_admin_users__userId_password,put__api_admin_users__userId_role,put__api_users__userId_disable,put__api_users__userId_password,put__api_users__userId_role,post__api_admin_floats,put__api_admin_floats__floatId,delete__api_admin_floats__floatId,delete__api_admin_floats__floatId_riders,put__api_admin_floats_lock,patch__api_admin_users__userId_payments, };
