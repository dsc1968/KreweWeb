const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { pool, JWT_SECRET, REGISTRATION_CODE_TTL_MINUTES, SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_REPLY_TO, CONTACT_RECIPIENT } = require('../config/db');
const { ADMIN_EDIT_EXCLUDED_PAGES, HEX_COLOR_PATTERN, LENGTH_VALUE_PATTERN, BORDER_STYLE_VALUES, normalizePagePath, isAdminEditablePagePath, validateEditablePagePath, normalizeHexColor, normalizeLengthValue, normalizeBorderStyle, normalizePositionMode, normalizeCoordinate, normalizeOpacityValue, isAdmin, isShopManager } = require('../utils/validation');
const { smtpTransport, normalizeEmailAddress, isValidEmailAddress, generateVerificationCode, maskVerificationTarget, sendVerificationMail, dispatchVerificationCode, dispatchMfaCode, verifyPlivoOtp, isSmsConfigured } = require('../utils/email');
const { randomBase32Secret, verifyTotp, buildOtpauthUri } = require('../utils/totp');

// Optional QR-code rendering for authenticator-app provisioning. When the
// `qrcode` package is installed we return a PNG data URI so the client can
// show a scannable code; otherwise we fall back to a copyable secret + URI.
let QRCode = null;
try { QRCode = require('qrcode'); } catch (_qrErr) { QRCode = null; }

// Builds the provisioning details an authenticator app needs to enroll: the
// otpauth:// URI (for QR scanning) plus the raw base32 secret (for manual
// entry) and, when available, a scannable QR image data URI.
async function buildAuthenticatorProvisioning(email, secret, issuer = 'Krewe Mystique') {
  const otpauthUri = buildOtpauthUri({ issuer, account: email, secretBase32: secret });
  let qr = null;
  if (QRCode && QRCode.toDataURL) {
    try {
      qr = await QRCode.toDataURL(otpauthUri, { margin: 2, width: 240 });
    } catch (_qrErr) {
      qr = null;
    }
  }
  return { method: 'authenticator', otpauthUri, secret, qr, issuer };
}
const { appDir, fileBackupsDir, imagesDir, listImagesInDirectory, resolveEditableFilePath, storage, upload } = require('../utils/files');
const { ashWednesdayDate, ashWednesdayISO, checkAndRunSeasonReset, currentSeasonYear, easterDate, parseSeasonEndConfig, performSeasonReset, resolveSeasonEndDate, seasonEndISO } = require('../utils/season');
const { ENV_CONFIG_ALLOWLIST, envFilePath, parseEnvFile, serializeEnvFile } = require('../utils/envConfig');
const { appDir: _bAppDir, getSiteSetting, setSiteSetting, BACKUP_CONFIG_KEYS, backupIdSafe, collectBackupAppFiles, DB_TABLES_INSERT_ORDER, execFileAsync, extractZip, fileBackupsDir: _bFb, isSafeColumnName, isSafeRclonePath, listLocalBackupsFromDir, listRcloneBackupManifests, listS3BackupManifests, makeS3Client, rcloneDeleteFile, rcloneDownloadFile, rcloneListFiles, rcloneRun, rcloneUploadFile, readBackupConfig, removeDir, zipDirectory } = require('../utils/backup');

// ── MFA configuration & helpers ──────────────────────────────────────────────

const MFA_MODES = ['off', 'admins_only', 'registration', 'registration_and_login'];

const MFA_METHODS = ['email', 'sms', 'authenticator'];

// The MFA methods the site can actually offer right now. SMS is only included
// when the SMS gateway (Plivo) is configured — the same condition
// dispatchMfaCode() uses — so dropping it here hides the SMS option in the UI.
// The TOTP "authenticator" method needs no gateway, so it is always offered.
// Email remains the default/primary method (see policy + UI defaults).
function getAvailableMfaMethods() {

  const methods = ['email', 'authenticator'];
  if (isSmsConfigured()) methods.push('sms');
  return methods;
}
const MFA_CODE_TTL_MINUTES = REGISTRATION_CODE_TTL_MINUTES; // reuse verification TTL
const MFA_MAX_ATTEMPTS = 5;

async function getMfaMode() {
  try {
    const v = await getSiteSetting('mfa_mode');
    return MFA_MODES.includes(v) ? v : 'off';
  } catch {
    return 'off';
  }
}

// Anyone with elevated privilege over a plain member: full admins plus the
// scoped limited-admin roles (store, float, finance). All require MFA.
function isElevatedRole(role) {
  return role === 'admin' || role === 'store_admin' || role === 'float_admin' || role === 'finance_admin';
}

// Whether MFA is mandated for this user under the current system policy.
function mfaPolicyRequires(role, mode, email) {
  // The bootstrap admin (admin@krewe.local) is exempt from MFA so the initial
  // login works before email/SMS delivery is configured.
  if (email && email.toLowerCase() === 'admin@krewe.local') return false;
  if (mode === 'off') return false;
  if (mode === 'admins_only') return isElevatedRole(role);
  return true;
}

// Whether a plain member must enroll MFA during registration (sign-up).
function registrationRequiresMfa(mode) {
  return mode === 'registration' || mode === 'registration_and_login';
}



function issueMfaToken(userId) {
  return jwt.sign({ userId, mfaChallenge: true }, JWT_SECRET, { expiresIn: '10m' });
}

function verifyMfaToken(token) {
  const decoded = jwt.verify(token, JWT_SECRET);
  if (!decoded || !decoded.mfaChallenge) throw new Error('invalid mfa token');
  return decoded.userId;
}

function maskMfaTarget(method, target) {
  if (method === 'sms') {
    const digits = String(target || '').replace(/\D/g, '');
    return digits.length >= 4 ? `***-***-${digits.slice(-4)}` : 'your phone';
  }
  return maskVerificationTarget(target);
}

async function startMfaChallenge(userId, method, target, secret) {
  const expiresAt = new Date(Date.now() + MFA_CODE_TTL_MINUTES * 60 * 1000);
  await pool.query('DELETE FROM mfa_challenges WHERE user_id = $1', [userId]);
  let code = null;
  let requestUuid = null;
  let delivery;
  if (method === 'authenticator') {
    // TOTP: there is no code to "send". The shared secret is either one
    // we just generated (enrollment) or the user's stored secret (login).
    // We stash it in the `code` column so mfa/verify can recompute the TOTP.
    let sec = secret || null;
    if (!sec) {
      const r = await pool.query('SELECT mfa_secret FROM users WHERE id = $1', [userId]);
      sec = (r.rows[0] && r.rows[0].mfa_secret) || null;
    }
    code = sec;
    target = target || '';
    delivery = undefined;
  } else if (method === 'email') {
    code = generateVerificationCode();
    delivery = await dispatchMfaCode('email', target, code);
  } else {
    // SMS: Plivo generates the code (Verify API) or we generate it locally
    // (Messaging API / dev fallback). Store whichever applies.
    delivery = await dispatchMfaCode('sms', target, null);
    if (delivery && delivery.requestUuid) requestUuid = delivery.requestUuid;
    if (delivery && delivery.code) code = delivery.code;
    else if (delivery && delivery.devCode) code = delivery.devCode;
  }
  await pool.query(
    `INSERT INTO mfa_challenges (user_id, method, target, code, request_uuid, attempts, expires_at)
     VALUES ($1, $2, $3, $4, $5, 0, $6)`,
    [userId, method, target, code, requestUuid, expiresAt]
  );
  return delivery;
}


async function post__api_auth_register_request_code(req, res) {
  const email = normalizeEmailAddress(req.body.email);
  const fullName = typeof req.body.full_name === 'string' ? req.body.full_name.trim() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const verificationMethod = 'email';
  const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';
  // Registration defaults new members to email MFA; they can switch to SMS later
  // from their profile. We deliberately ignore any mfa_method sent by the client.
  const mfaMethod = 'email';

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

    // A phone number is optional at registration, but when supplied it must be
    // unique - just like the email. Reject duplicates against existing profiles
    // and any other in-flight (non-expired) pending registration. Exclude the
    // caller's own pending row (matched by email) so re-requesting a code does
    // not flag their own number as taken.
    if (phone) {
      const existingPhone = await pool.query('SELECT 1 FROM user_profiles WHERE phone = $1 LIMIT 1', [phone]);
      if (existingPhone.rowCount > 0) {
        return res.status(409).json({ error: 'Phone number already in use' });
      }
      const pendingPhone = await pool.query(
        'SELECT 1 FROM pending_registrations WHERE phone = $1 AND email <> $2 AND expires_at > NOW() LIMIT 1',
        [phone, email]
      );
      if (pendingPhone.rowCount > 0) {
        return res.status(409).json({ error: 'Phone number already in use' });
      }
    }

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);
    const verificationCode = generateVerificationCode();
    const verificationTarget = email;
    const expiresAt = new Date(Date.now() + REGISTRATION_CODE_TTL_MINUTES * 60 * 1000);

    await pool.query('DELETE FROM pending_registrations WHERE expires_at < NOW()', []);
    await pool.query(
      `INSERT INTO pending_registrations (
         email, phone, full_name, password_hash, verification_method, verification_target, verification_code, desired_mfa_method, attempts, expires_at, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, NOW())
       ON CONFLICT (email)
       DO UPDATE SET
         phone = EXCLUDED.phone,
         full_name = EXCLUDED.full_name,
         password_hash = EXCLUDED.password_hash,
         verification_method = EXCLUDED.verification_method,
         verification_target = EXCLUDED.verification_target,
         verification_code = EXCLUDED.verification_code,
         desired_mfa_method = EXCLUDED.desired_mfa_method,
         attempts = 0,
         expires_at = EXCLUDED.expires_at,
         created_at = NOW()`,
      [email, phone || null, fullName, hash, verificationMethod, verificationTarget, verificationCode, mfaMethod, expiresAt]
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
      `SELECT email, full_name, password_hash, verification_code, attempts, phone, desired_mfa_method
       FROM pending_registrations WHERE email = $1 FOR UPDATE`,
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

    if (pending.phone) {
      const dupPhone = await client.query('SELECT 1 FROM user_profiles WHERE phone = $1 LIMIT 1', [pending.phone]);
      if (dupPhone.rowCount > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Phone number already in use' });
      }
    }

    const insertResult = await client.query(
      `INSERT INTO users (email, full_name, role, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, full_name, role, joined_at`,
      [pending.email, pending.full_name, 'guest', pending.password_hash]
    );
    const user = insertResult.rows[0];

    const mode = await getMfaMode();
    await client.query('DELETE FROM pending_registrations WHERE email = $1', [email]);

    // When MFA is required at registration we seed email as the default method
    // and treat the email verification code just entered as the single required
    // MFA step (it already proves ownership of the address). We enroll email MFA
    // and log the user straight in below - there is no need to send a second,
    // separate MFA code to the same address. Members who prefer SMS or an
    // authenticator app can switch from their profile later.
    if (registrationRequiresMfa(mode)) {
      await client.query(
        "UPDATE users SET mfa_method = 'email', mfa_enrolled = TRUE WHERE id = $1",
        [user.id]
      );
    }

    await client.query('COMMIT');
    const token = generateToken(user);
    res.cookie('krewe_token', token, { path: '/', sameSite: 'lax' });
    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        phone: pending.phone,
        full_name: user.full_name,
        role: user.role,
      },
      token,
      mfaEnrolled: registrationRequiresMfa(mode),
      message: 'Account created.',
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

// Direct registration — only used when MFA is disabled for members
// (mfa_mode === 'off'). It skips the email-verification code step entirely so
// the registration form can behave as a plain "Register" button. When MFA is
// required at registration the client must use the request-code/verify-code
// flow instead (enforced below as a safety net).
async function post__api_auth_register(req, res) {
  const email = normalizeEmailAddress(req.body.email);
  const fullName = typeof req.body.full_name === 'string' ? req.body.full_name.trim() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';

  if (!email || !fullName || !password) {
    return res.status(400).json({ error: 'Email, full name and password are required' });
  }
  if (!isValidEmailAddress(email)) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }

  if (phone) {
    const existingPhone = await pool.query('SELECT 1 FROM user_profiles WHERE phone = $1 LIMIT 1', [phone]);
    if (existingPhone.rowCount > 0) {
      return res.status(409).json({ error: 'Phone number already in use' });
    }
  }

  const mode = await getMfaMode();
  if (registrationRequiresMfa(mode)) {
    // MFA is required at registration, so a verification code flow is mandatory.
    return res.status(400).json({ error: 'Registration requires verification. Please request a verification code.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existingUser = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rowCount > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Email already in use' });
    }

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);
    const insertResult = await client.query(
      `INSERT INTO users (email, full_name, role, password_hash)
       VALUES ($1, $2, 'guest', $3)
       RETURNING id, email, full_name, role, joined_at`,
      [email, fullName, hash]
    );
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
    console.error('Direct registration failed', error);
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
    const result = await pool.query(
      `SELECT u.id, u.email, u.full_name, u.role, u.password_hash, u.mfa_method, u.mfa_enrolled,
              p.phone AS profile_phone
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       WHERE u.email = $1`,
      [email]
    );
    if (result.rowCount === 0) return res.status(401).json({ error: 'Invalid credentials' });
    const user = result.rows[0];
    if (user.role === 'disabled') return res.status(403).json({ error: 'Account is disabled' });
    const ok = bcrypt.compareSync(password, user.password_hash || '');
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const mode = await getMfaMode();
    if (mfaPolicyRequires(user.role, mode, user.email)) {
      if (!user.mfa_enrolled) {
        return res.json({
          mfaEnrollmentRequired: true,
          mfaToken: issueMfaToken(user.id),
          availableMethods: getAvailableMfaMethods(),
          message: 'Multi-factor authentication is required for your account. Choose a sign-in method to continue.',
        });
      }
      let method = user.mfa_method;
      let target = user.email;
      let notice = null;
      if (method === 'authenticator') {
        target = user.email;
      } else if (method === 'sms') {
        target = user.profile_phone || user.email;
        const smsBlockedNoPhone = !user.profile_phone;
        const smsBlockedNoGateway = !isSmsConfigured();
        if (smsBlockedNoPhone || smsBlockedNoGateway) {
          method = 'email';
          target = user.email;
          notice = smsBlockedNoPhone
            ? 'SMS was selected but no phone number is on file, so email was used instead.'
            : 'SMS is not configured on this site, so email was used instead.';
        }
      }
      const delivery = await startMfaChallenge(user.id, method, target);
      return res.json({
        mfaRequired: true,
        mfaToken: issueMfaToken(user.id),
        method,
        maskedTarget: maskMfaTarget(method, target),
        deliveryNotice: (delivery && delivery.notice) || notice,
      });
    }

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
    const mode = await getMfaMode();
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
      [req.user.userId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    const row = result.rows[0];
    // The Float Admin is the source of truth for captaincy: it is recorded as
    // floats.captain_user_id. Surface it as `captain_of` so the profile page
    // can display it read-only (a member cannot self-appoint as captain).
    let captain_of = null;
    const capRes = await pool.query('SELECT id, name, float_number FROM floats WHERE captain_user_id = $1', [req.user.userId]);
    if (capRes.rowCount > 0) captain_of = { id: capRes.rows[0].id, name: capRes.rows[0].name, float_number: capRes.rows[0].float_number };
    // Older rows may have stored these JSON columns as an empty object `{}`
    // rather than an array; normalise so the client can always use .forEach().
    const asArray = (v) => (Array.isArray(v) ? v : []);
    res.json({
      ...row,
      captain_of,
      mfa_mode: mode,
      mfa_available_methods: getAvailableMfaMethods(),
      mfa_registration_required: registrationRequiresMfa(mode),

      mfa_elevated_forced: mode !== 'off',
      kids_names: asArray(row.kids_names),
      kids_birthdays: asArray(row.kids_birthdays),
      grandchildren_names: asArray(row.grandchildren_names),
      grandchildren_birthdays: asArray(row.grandchildren_birthdays),
      float_riders: asArray(row.float_riders),
      kids_float_numbers: asArray(row.kids_float_numbers),
      rider_float_numbers: asArray(row.rider_float_numbers),
      rider_float_names: asArray(row.rider_float_names),
      float_locked: (await getSiteSetting('float_admin_lock')) === 'true',
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
  // The member's chosen MFA method (from the profile form). Accept the values
  // the UI offers; coerce anything unexpected back to the default 'email'.
  const mfa_method = (typeof req.body.mfa_method === 'string' && ['none', 'email', 'sms', 'authenticator'].includes(req.body.mfa_method))
    ? req.body.mfa_method
    : 'email';

  const kidsRaw = req.body.kids_names;
  if (!Array.isArray(kidsRaw)) return res.status(400).json({ error: 'kids_names must be an array' });
  let kids_names = kidsRaw.map((k) => String(k).trim().slice(0, 100)).filter(Boolean);

  const kidsBdRaw = Array.isArray(req.body.kids_birthdays) ? req.body.kids_birthdays : [];
  let kids_birthdays = kidsBdRaw.map((v) => (typeof v === 'string' && v ? v : null));

  const gcNamesRaw = Array.isArray(req.body.grandchildren_names) ? req.body.grandchildren_names : [];
  let grandchildren_names = gcNamesRaw.map((k) => String(k).trim().slice(0, 100)).filter(Boolean);

  const gcBdRaw = Array.isArray(req.body.grandchildren_birthdays) ? req.body.grandchildren_birthdays : [];
  let grandchildren_birthdays = gcBdRaw.map((v) => (typeof v === 'string' && v ? v : null));

  const ridersRaw = req.body.float_riders;
  if (!Array.isArray(ridersRaw)) return res.status(400).json({ error: 'float_riders must be an array' });
  // Each rider is { name, comment, float_id }; tolerate legacy string entries.
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

  // Legacy parallel-array fields are no longer edited; keep them in sync if
  // supplied, otherwise reset to empty.
  let rider_float_names = Array.isArray(req.body.rider_float_names)
    ? req.body.rider_float_names.map((v) => String(v ?? '').trim().slice(0, 100))
    : [];
  let rider_float_numbers = Array.isArray(req.body.rider_float_numbers)
    ? req.body.rider_float_numbers.map((v) => String(v ?? '').trim().slice(0, 20))
    : [];
  let float_captain = Boolean(req.body.float_captain);
  const memberFloatRaw = typeof req.body.member_float_number === 'string' ? req.body.member_float_number.trim() : '';
  
  let member_float_number = memberFloatRaw ? memberFloatRaw.slice(0, 20) : null;
  // Link the member to a float when they supply a float number that matches an
  // existing float. This makes them appear on that float's roster in the admin
  // tool (the float admin lists members by float_id).
  let floatIdForProfile = null;
  if (member_float_number) {
    try {
      const fr = await pool.query('SELECT id FROM floats WHERE float_number = $1 LIMIT 1', [member_float_number]);
      if (fr.rowCount > 0) floatIdForProfile = fr.rows[0].id;
    } catch (_e) { /* leave unlinked if lookup fails */ }
  }

  if (mfa_method === 'sms' && !phone) {
    return res.status(400).json({ error: 'A phone number is required to use SMS for MFA.' });
  }

  // Capture the member's prior MFA settings so we only force an SMS
  // verification when something actually changed: they switched their
  // method TO "sms", or they edited the phone number the code is sent to.
  // Saving unrelated profile fields must not re-prompt on every save.
  let prevMfaMethod = 'email';
  let prevPhone = '';
  try {
    const prevRes = await pool.query(
      'SELECT u.mfa_method, p.phone FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = $1',
      [userId]
    );
    const prevRow = prevRes.rows[0] || {};
    prevMfaMethod = prevRow.mfa_method || 'email';
    prevPhone = (prevRow.phone || '').toString().trim();
  } catch (_prevErr) {
    // If we can't read the prior values, fail safe to re-prompting (treat as a
    // change) so we never silently skip a security step.
    prevMfaMethod = 'email';
    prevPhone = '';
  }

  // When floats are locked, only the Float Admin may change float assignments.
  // Keep the member's existing float/riders data and ignore incoming changes.
  const floatsLocked = (await getSiteSetting('float_admin_lock')) === 'true';
  if (floatsLocked && req.user.role !== 'float_admin') {
    try {
      const cur = await pool.query(
        'SELECT float_riders, rider_float_names, rider_float_numbers, member_float_number, float_id FROM user_profiles WHERE user_id = $1',
        [userId]
      );
      const c = cur.rows.length ? cur.rows[0] : {};
      const asArray = (v) => (Array.isArray(v) ? v : []);
      float_riders = asArray(c.float_riders);
      rider_float_names = asArray(c.rider_float_names);
      rider_float_numbers = asArray(c.rider_float_numbers);
      member_float_number = c.member_float_number != null ? c.member_float_number : null;
      floatIdForProfile = c.float_id != null ? c.float_id : null;
    } catch (_e) { /* keep computed values if lookup fails */ }
  }

  // Guests may only maintain their own personal/contact details. Ignore any
  // family or float-roster fields they submit so they can never appear on a
  // float or in another member's family tree via the API.
  if (req.user.role === 'guest') {
    kids_names = []; kids_birthdays = [];
    grandchildren_names = []; grandchildren_birthdays = [];
    float_riders = []; rider_float_names = []; rider_float_numbers = [];
    float_captain = false; member_float_number = null; floatIdForProfile = null;
  }

  try {
    await pool.query(
      `INSERT INTO user_profiles (
         user_id, phone, address, city, state, zip, birthdate, occupation, organizations,
         sponsor_name, spouse_name, kids_names, kids_birthdays,
         grandchildren_names, grandchildren_birthdays,
         guest_name, float_riders, rider_float_names, rider_float_numbers, float_captain, member_float_number, float_id, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17::jsonb,$18::jsonb,$19::jsonb,$20,$21,$22,NOW())
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
         member_float_number=EXCLUDED.member_float_number, float_id=EXCLUDED.float_id,
         updated_at=NOW()`,
      [
        userId, phone||null, address||null, city||null, state||null, zip||null,
        birthdate||null, occupation||null, organizations||null,
        sponsor_name||null, spouse_name||null,
        JSON.stringify(kids_names), JSON.stringify(kids_birthdays),
        JSON.stringify(grandchildren_names), JSON.stringify(grandchildren_birthdays),
        guest_name||null, JSON.stringify(float_riders),
        JSON.stringify(rider_float_names), JSON.stringify(rider_float_numbers), float_captain,
        member_float_number||null, floatIdForProfile,
      ]
    );
    // For the authenticator app we defer committing mfa_method until the
    // TOTP code is verified (enrollment), so we don't update it here.
    if (mfa_method !== 'authenticator') {
      await pool.query('UPDATE users SET mfa_method = $1 WHERE id = $2', [mfa_method, userId]);
    }

    // Start an MFA challenge only when the member is actually (re)enrolling a
    // method. For SMS that means they switched TO "sms" or changed the phone
    // number; for the authenticator app it means they switched TO it. This
    // keeps re-prompting off for saves of unrelated profile fields.
    const switchedToSms = mfa_method === 'sms' && prevMfaMethod !== 'sms';
    const switchedToAuth = mfa_method === 'authenticator' && prevMfaMethod !== 'authenticator';
    const phoneChanged = (phone || '').trim() !== prevPhone;
    const needSmsChallenge = mfa_method === 'sms' && !!phone && (switchedToSms || phoneChanged);

    let mfaChallenge = null;
    if (mfa_method === 'authenticator' && switchedToAuth) {
      // Begin authenticator enrollment: generate a secret, stash it on the
      // challenge, and return the provisioning details (QR + secret).
      try {
        const u = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
        const secret = randomBase32Secret();
        await startMfaChallenge(userId, 'authenticator', u.rows[0].email, secret);
        const info = await buildAuthenticatorProvisioning(u.rows[0].email, secret);
        mfaChallenge = { ...info, mfaChallengeSent: true, mfaToken: issueMfaToken(userId) };
      } catch (authErr) {
        mfaChallenge = { mfaChallengeSent: false, error: 'Unable to start authenticator setup: ' + (authErr.message || authErr) };
      }
    } else if (needSmsChallenge) {
      try {
        const delivery = await startMfaChallenge(userId, 'sms', phone);
        mfaChallenge = {
          mfaChallengeSent: true,
          mfaToken: issueMfaToken(userId),
          method: 'sms',
          maskedTarget: maskMfaTarget('sms', phone),
          deliveryNotice: (delivery && delivery.notice) || null,
        };
      } catch (smsErr) {
        mfaChallenge = { mfaChallengeSent: false, error: 'SMS could not be sent: ' + (smsErr.message || smsErr) };
      }
    }

    res.json({ ok: true, mfaChallenge });
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
async function get__api_mfa_policy(req, res) {
  try {
    const mode = await getMfaMode();
    res.json({
      mfaMode: mode,
      registrationRequiresMfa: registrationRequiresMfa(mode),
      elevatedForcedMfa: mode !== 'off',
      availableMethods: getAvailableMfaMethods(),
    });
  } catch (error) {
    console.error('Failed to read MFA policy', error);
    res.status(500).json({ error: 'Unable to read MFA policy' });
  }
}

async function post__api_auth_mfa_send(req, res) {
  const auth = typeof req.body.mfaToken === 'string' ? req.body.mfaToken : '';
  let userId;
  try { userId = verifyMfaToken(auth); } catch { return res.status(401).json({ error: 'Invalid or expired session' }); }
  const method = req.body.method;
  if (!MFA_METHODS.includes(method)) return res.status(400).json({ error: 'Invalid MFA method' });
  try {
    const u = await pool.query('SELECT u.email, p.phone FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = $1', [userId]);
    const user = u.rows[0];
    if (method === 'authenticator') {
      // Surface the provisioning details (QR + secret) for the client to scan.
      // Prefer a secret already staged on an in-flight challenge; otherwise fall
      // back to the user's stored secret (re-scanning an already-enrolled app).
      let secret = null;
      const ch = await pool.query(
        'SELECT code FROM mfa_challenges WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [userId]
      );
      if (ch.rowCount > 0 && ch.rows[0].code) secret = ch.rows[0].code;
      if (!secret) {
        const ur = await pool.query('SELECT mfa_secret, email FROM users WHERE id = $1', [userId]);
        if (ur.rows[0] && ur.rows[0].mfa_secret) {
          secret = ur.rows[0].mfa_secret;
          await startMfaChallenge(userId, 'authenticator', ur.rows[0].email, secret);
        }
      }
      if (!secret) {
        // First-time enrollment: generate a fresh secret and stage it on the
        // challenge. It is committed to users.mfa_secret only after the TOTP
        // code is verified, so an aborted enrollment leaves the account as-is.
        secret = randomBase32Secret();
        await startMfaChallenge(userId, 'authenticator', user.email, secret);
      }
      const info = await buildAuthenticatorProvisioning(user.email, secret);
      return res.json({ ...info, mfaChallengeSent: true, mfaToken: issueMfaToken(userId) });
    }
    let target;
    if (method === 'sms') {
      target = (req.body.phone && String(req.body.phone).trim()) || user.phone || null;
      if (!target) return res.status(400).json({ error: 'A phone number is required to use SMS.' });
    } else {
      target = user.email;
    }
    const delivery = await startMfaChallenge(userId, method, target);
    res.json({
      mfaChallengeSent: true,
      mfaToken: issueMfaToken(userId),
      method,
      maskedTarget: maskMfaTarget(method, target),
      deliveryNotice: delivery && delivery.notice,
    });
  } catch (error) {
    console.error('Failed to send MFA code', error);
    res.status(500).json({ error: 'Unable to send MFA code' });
  }
}

async function post__api_auth_mfa_verify(req, res) {
  const auth = typeof req.body.mfaToken === 'string' ? req.body.mfaToken : '';
  const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';
  if (!auth || !code) return res.status(400).json({ error: 'MFA token and code are required' });
  let userId;
  try { userId = verifyMfaToken(auth); } catch { return res.status(401).json({ error: 'Invalid or expired session' }); }
  const client = await pool.connect();
  try {
    const ch = await client.query('SELECT * FROM mfa_challenges WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [userId]);
    if (ch.rowCount === 0) return res.status(400).json({ error: 'No MFA challenge is pending. Start over.' });
    const c = ch.rows[0];
    if (new Date(c.expires_at) < new Date()) {
      await client.query('DELETE FROM mfa_challenges WHERE user_id = $1', [userId]);
      return res.status(400).json({ error: 'That code has expired. Request a new one.' });
    }
    if (c.attempts >= MFA_MAX_ATTEMPTS) {
      await client.query('DELETE FROM mfa_challenges WHERE user_id = $1', [userId]);
      return res.status(429).json({ error: 'Too many attempts. Request a new code.' });
    }
    let verified = false;

    if (c.method === 'authenticator') {
      // TOTP: validate the submitted code against the shared secret
      // (stored in the challenge's `code` column) with a ±1 step window.
      verified = verifyTotp(c.code, code, { window: 1 });
    } else if (c.request_uuid) {
      // SMS delivered via the Plivo Verify API: let Plivo validate the OTP.
      try {
        verified = await verifyPlivoOtp(
          process.env.PLIVO_AUTH_ID,
          process.env.PLIVO_AUTH_TOKEN,
          process.env.PLIVO_VERIFY_APP_ID,
          c.request_uuid,
          code
        );
      } catch (_e) {
        verified = false;
      }
    } else {
      verified = c.code === code;
    }
    if (!verified) {
      await client.query('UPDATE mfa_challenges SET attempts = attempts + 1 WHERE user_id = $1', [userId]);
      return res.status(400).json({ error: 'Invalid code' });
    }
    await client.query('DELETE FROM mfa_challenges WHERE user_id = $1', [userId]);
    // For the authenticator (TOTP) method the shared secret is staged on the
    // challenge (in the `code` column) only until it is verified. Persist it to
    // users.mfa_secret here so future logins can recompute the rolling code —
    // otherwise deleting the challenge would lose the secret and lock the user
    // out of their account. Email/SMS have no secret to store.
    if (c.method === 'authenticator') {
      await client.query(
        'UPDATE users SET mfa_method = $1, mfa_enrolled = TRUE, mfa_secret = $3 WHERE id = $2',
        [c.method, userId, c.code]
      );
    } else {
      await client.query('UPDATE users SET mfa_method = $1, mfa_enrolled = TRUE WHERE id = $2', [c.method, userId]);
    }
    const userRes = await client.query('SELECT id, email, full_name, role FROM users WHERE id = $1', [userId]);
    const user = userRes.rows[0];
    const token = generateToken(user);
    res.cookie('krewe_token', token, { path: '/', sameSite: 'lax' });
    res.json({
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
      token,
      mfaEnrolled: true,
    });
  } catch (error) {
    console.error('MFA verification failed', error);
    res.status(500).json({ error: 'Unable to verify MFA code' });
  } finally {
    client.release();
  }
}

async function put__api_profile_mfa(req, res) {
  const userId = req.user.userId;
  const method = req.body.method;
  if (!MFA_METHODS.includes(method)) return res.status(400).json({ error: 'Invalid MFA method' });
  try {
    if (method === 'authenticator') {
      const u = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
      const secret = randomBase32Secret();
      await startMfaChallenge(userId, 'authenticator', u.rows[0].email, secret);
      const info = await buildAuthenticatorProvisioning(u.rows[0].email, secret);
      return res.json({ ...info, mfaChallengeSent: true, mfaToken: issueMfaToken(userId) });
    }
    let phone = null;
    if (method === 'sms') {
      phone = (req.body.phone && String(req.body.phone).trim()) || null;
      if (!phone) return res.status(400).json({ error: 'A phone number is required to use SMS.' });
    }
    if (phone) {
      await pool.query(
        `INSERT INTO user_profiles (user_id, phone, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (user_id) DO UPDATE SET phone = EXCLUDED.phone, updated_at = NOW()`,
        [userId, phone]
      );
    }
    const u = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
    const target = method === 'sms' ? phone : u.rows[0].email;
    const delivery = await startMfaChallenge(userId, method, target);
    res.json({
      mfaChallengeSent: true,
      mfaToken: issueMfaToken(userId),
      method,
      maskedTarget: maskMfaTarget(method, target),
      deliveryNotice: delivery && delivery.notice,
    });
  } catch (error) {
    console.error('Failed to start MFA enrollment', error);
    res.status(500).json({ error: 'Unable to start MFA enrollment' });
  }
}


// -- Self-service change password --
// Lets any authenticated user change their own password. The current password
// is verified before the new one is stored, so a stolen session token cannot be
// used to silently reset the password. Available to every role/profile type
// (member, guest, admin, store_admin, etc.) since it only ever touches the
// caller's own account.
async function put__api_profile_password(req, res) {
  const userId = req.user.userId;
  const currentPassword = typeof req.body.current_password === 'string' ? req.body.current_password : '';
  const newPassword = typeof req.body.new_password === 'string' ? req.body.new_password : '';

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  // Reject reusing the current password to encourage a distinct new password.
  if (newPassword === currentPassword) {
    return res.status(400).json({ error: 'New password must be different from your current password' });
  }

  try {
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    const user = result.rows[0];

    const ok = bcrypt.compareSync(currentPassword, user.password_hash || '');
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(newPassword, salt);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, userId]);

    res.json({ ok: true, passwordChanged: true });
  } catch (error) {
    console.error('Failed to change password', error);
    res.status(500).json({ error: 'Unable to change password' });
  }
}

function generateToken(user) {
  return jwt.sign({ userId: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}
module.exports = { generateToken, get__api_mfa_policy, get__api_members, get__api_profile, post__api_auth_login, post__api_auth_mfa_send, post__api_auth_mfa_verify, post__api_auth_register, post__api_auth_register_request_code, post__api_auth_register_verify_code, put__api_profile_details, put__api_profile_mfa, put__api_profile_password };
