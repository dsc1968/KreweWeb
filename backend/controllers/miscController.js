const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { pool, JWT_SECRET, REGISTRATION_CODE_TTL_MINUTES, SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_REPLY_TO, CONTACT_RECIPIENT, JOIN_REQUEST_RECIPIENTS, APPROVAL_EMAIL_SUBJECT, APPROVAL_EMAIL_BODY, DENIAL_EMAIL_SUBJECT, DENIAL_EMAIL_BODY } = require('../config/db');
const { ADMIN_EDIT_EXCLUDED_PAGES, HEX_COLOR_PATTERN, LENGTH_VALUE_PATTERN, BORDER_STYLE_VALUES, normalizePagePath, isAdminEditablePagePath, validateEditablePagePath, normalizeHexColor, normalizeLengthValue, normalizeBorderStyle, normalizePositionMode, normalizeCoordinate, normalizeOpacityValue, isAdmin, isShopManager } = require('../utils/validation');
const { smtpTransport, normalizeEmailAddress, isValidEmailAddress, generateVerificationCode, maskVerificationTarget, sendVerificationMail, dispatchVerificationCode } = require('../utils/email');
const { appDir, fileBackupsDir, imagesDir, listImagesInDirectory, resolveEditableFilePath, storage, upload } = require('../utils/files');
const { ashWednesdayDate, ashWednesdayISO, checkAndRunSeasonReset, currentSeasonYear, easterDate, parseSeasonEndConfig, performSeasonReset, resolveSeasonEndDate, seasonEndISO } = require('../utils/season');
const { ENV_CONFIG_ALLOWLIST, envFilePath, parseEnvFile, serializeEnvFile } = require('../utils/envConfig');
const { appDir: _bAppDir, BACKUP_CONFIG_KEYS, backupIdSafe, collectBackupAppFiles, DB_TABLES_INSERT_ORDER, execFileAsync, extractZip, fileBackupsDir: _bFb, isSafeColumnName, isSafeRclonePath, listLocalBackupsFromDir, listRcloneBackupManifests, listS3BackupManifests, makeS3Client, rcloneDeleteFile, rcloneDownloadFile, rcloneListFiles, rcloneRun, rcloneUploadFile, readBackupConfig, removeDir, zipDirectory } = require('../utils/backup');

// Replace {{placeholder}} tokens in a template string with provided values.
function renderTemplate(template, vars) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match
  );
}

// Parse the configured join-request recipient list into a clean array of
// addresses. Used to CC a copy of approval/denial emails to the registrars.
function joinRequestRecipients() {
  if (!JOIN_REQUEST_RECIPIENTS) return [];
  return JOIN_REQUEST_RECIPIENTS.split(',').map((s) => s.trim()).filter(Boolean);
}

// Default email copy (used when the admin has not configured a custom template).
const DEFAULT_APPROVAL_SUBJECT = 'Krewe Registration Approved';
const DEFAULT_APPROVAL_BODY = `Your Krewe registration has been approved!

Email: {{email}}
Temporary Password: {{temp_password}}

Please log in and change your password immediately.`;

const DEFAULT_DENIAL_SUBJECT = 'Krewe Registration Denied';
const DEFAULT_DENIAL_BODY = `Thank you for your interest in joining Krewe Mystique.

Unfortunately, your registration request has been denied at this time. If you believe this is an error, please contact the krewe leadership.`;

async function get__api_calendar_events(req, res) {
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
}

async function post__api_admin_upload_image(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  // return path relative to static root
  const rel = '/assets/images/' + path.basename(req.file.filename);
  res.json({ path: rel });
}

async function get__api_admin_images(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  try {
    const images = listImagesInDirectory(imagesDir).sort((left, right) => left.localeCompare(right));
    res.json({ items: images });
  } catch (error) {
    console.error('Failed to list images', error);
    res.status(500).json({ error: 'Unable to list images' });
  }
}

async function put__api_admin_calendar_events(req, res) {
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
}

async function delete__api_admin_calendar_events(req, res) {
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
}
async function post__api_join_request(req, res) {
  const { full_name, email, phone, birthdate, occupation, sponsor_name, address, city, state, zip } = req.body;

  // Validate required fields
  if (!full_name || !email) {
    return res.status(400).json({ error: 'Full name and email are required' });
  }

  if (!isValidEmailAddress(email)) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }

  // Normalize email
  const normEmail = normalizeEmailAddress(email);
  // Normalize phone: treat empty string as null
  const normPhone = phone && phone.trim() !== '' ? phone.trim() : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if email already exists
    const existingUser = await client.query('SELECT id FROM users WHERE email = $1', [normEmail]);
    if (existingUser.rowCount > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Email already in use' });
    }

    // Check pending registration email duplicate (optional, we will delete anyway)
    // Check phone duplicate if provided
    if (normPhone) {
      const existingPhone = await client.query('SELECT 1 FROM user_profiles WHERE phone = $1', [normPhone]);
      if (existingPhone.rowCount > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Phone number already in use' });
      }
      // Check pending registration phone duplicate
      const pendingPhone = await client.query('SELECT 1 FROM pending_registrations WHERE phone = $1', [normPhone]);
      if (pendingPhone.rowCount > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Phone number already in use' });
      }
    }
    // Clean up any pending registration for this email
    await client.query('DELETE FROM pending_registrations WHERE email = $1', [normEmail]);

    // Insert disabled user with empty password hash (login blocked by role)
    const userResult = await client.query(
      `INSERT INTO users (email, full_name, role, password_hash)
       VALUES ($1, $2, 'disabled', '')
       RETURNING id, email, full_name`,
      [normEmail, full_name]
    );
    const user = userResult.rows[0];

    // Insert basic profile (optional fields)
    await client.query(
      `INSERT INTO user_profiles (
         user_id, phone, address, city, state, zip, birthdate, occupation, sponsor_name
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [user.id, normPhone, address || null, city || null, state || null, zip || null, birthdate || null, occupation || null, sponsor_name || null]
    );

    await client.query('COMMIT');

    // Notify admins of new pending registration
    try {
      if (JOIN_REQUEST_RECIPIENTS) {
        const recipients = JOIN_REQUEST_RECIPIENTS
          .split(',')
          .map(e => e.trim())
          .filter(e => e.length > 0);
        if (recipients.length > 0) {
          const emailBody = `
            New Krewe Registration Pending Approval

            Email: ${normEmail}
            Full Name: ${full_name}
            Phone: ${normPhone || 'Not provided'}
            Date of Birth: ${birthdate || 'Not provided'}
            Occupation: ${occupation || 'Not provided'}
            Sponsor Name: ${sponsor_name || 'Not provided'}
            Address: ${address || 'Not provided'}
            City: ${city || 'Not provided'}
            State: ${state || 'Not provided'}
            Zip: ${zip || 'Not provided'}
          `;
          await smtpTransport.sendMail({
            from: SMTP_FROM,
            to: recipients.join(', '),
            subject: 'New Krewe Registration Pending Approval',
            text: emailBody.trim()
          });
        }
      }
    } catch (emailError) {
      console.error('Failed to send registration approval notification:', emailError);
    }

    // Optionally notify user that request received and pending approval
    try {
      const userEmailBody = `
        Thank you for your interest in joining Krewe Mystique.

        We have received your request and it is pending approval. An administrator will review your application and contact you via email.

        Please do not reply to this automated message.
      `;
      await smtpTransport.sendMail({
        from: SMTP_FROM,
        to: normEmail,
        subject: 'Krewe Join Request Received',
        text: userEmailBody.trim()
      });
    } catch (userEmailError) {
      console.error('Failed to send user confirmation email:', userEmailError);
    }

    res.json({ message: 'Join request submitted successfully', userId: user.id });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to process join request:', error);
    res.status(500).json({ error: 'Unable to submit join request' });
  } finally {
    client.release();
  }
}
async function get__api_pending_users(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.full_name, u.joined_at, p.phone
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       WHERE u.role = $1
         -- Only show NEW registrations (join requests), not accounts that were
         -- disabled after being active. applyDisabledState() populates
         -- roles_before_disable only when an existing member is turned off, so
         -- pending registrations always have it NULL.
         AND u.roles_before_disable IS NULL
       ORDER BY u.joined_at DESC`,
      ['disabled']
    );
    res.json({ items: result.rows });
  } catch (error) {
    console.error('Failed to fetch pending users', error);
    res.status(500).json({ error: 'Unable to fetch pending users' });
  }
}

async function post__api_approve_user(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const userId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch user info
    const userResult = await client.query(
      `SELECT u.id, u.email, u.full_name
       FROM users u
       WHERE u.id = $1`,
      [userId]
    );
    if (userResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }
    const user = userResult.rows[0];

    // Generate temporary password
    const tempPassword = crypto.randomBytes(4).toString('hex'); // 8 hex chars
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(tempPassword, salt);

    // Update user: set role to 'member' and update password hash
    await client.query(
      `UPDATE users SET role = $1, roles = '["member"]'::jsonb, roles_before_disable = NULL, password_hash = $2 WHERE id = $3`,
      ['member', hash, userId]
    );

    // Optionally, we could also clear any pending registration flags, but not needed.

    await client.query('COMMIT');

    // Notify user of approval and temporary password (configurable template)
    try {
      const subject = (APPROVAL_EMAIL_SUBJECT && APPROVAL_EMAIL_SUBJECT.trim())
        ? APPROVAL_EMAIL_SUBJECT.trim()
        : DEFAULT_APPROVAL_SUBJECT;
      const bodyTemplate = (APPROVAL_EMAIL_BODY && APPROVAL_EMAIL_BODY.trim())
        ? APPROVAL_EMAIL_BODY
        : DEFAULT_APPROVAL_BODY;
      const emailBody = renderTemplate(bodyTemplate, {
        full_name: user.full_name || '',
        email: user.email,
        temp_password: tempPassword,
      });
      const approvalMail = {
        from: SMTP_FROM,
        to: user.email,
        subject,
        text: emailBody.trim()
      };
      // Cc the registrant as well so the notice is guaranteed to reach them even
      // if the mail infrastructure only honors Cc recipients. Registrars still
      // receive their copy via Cc.
      const ccRecipients = Array.from(new Set([user.email, ...joinRequestRecipients()])).filter(Boolean);
      if (ccRecipients.length) approvalMail.cc = ccRecipients;
      await smtpTransport.sendMail(approvalMail);
    } catch (emailError) {
      console.error('Failed to send approval email to user:', emailError);
      // Still consider approval successful
    }

    res.json({ message: 'User approved and notified.' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to approve user:', error);
    res.status(500).json({ error: 'Unable to approve user' });
  } finally {
    client.release();
  }
}

async function post__api_deny_user(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const userId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch user to get email for logging
    const userResult = await client.query(
      `SELECT u.email, u.full_name
       FROM users u
       WHERE u.id = $1`,
      [userId]
    );
    if (userResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }
    const user = userResult.rows[0];

    // Delete user and associated profile
    await client.query('DELETE FROM user_profiles WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM users WHERE id = $1', [userId]);
    // Also remove the pending registration row (mirrors the approve flow) so the
    // email/phone can be re-used if the person later re-registers.
    await client.query('DELETE FROM pending_registrations WHERE email = $1', [user.email]);

    await client.query('COMMIT');

    // Notify the user that their registration was denied (configurable template)
    try {
      const subject = (DENIAL_EMAIL_SUBJECT && DENIAL_EMAIL_SUBJECT.trim())
        ? DENIAL_EMAIL_SUBJECT.trim()
        : DEFAULT_DENIAL_SUBJECT;
      const bodyTemplate = (DENIAL_EMAIL_BODY && DENIAL_EMAIL_BODY.trim())
        ? DENIAL_EMAIL_BODY
        : DEFAULT_DENIAL_BODY;
      const emailBody = renderTemplate(bodyTemplate, {
        full_name: user.full_name || '',
        email: user.email,
      });
      const denialMail = {
        from: SMTP_FROM,
        to: user.email,
        subject,
        text: emailBody.trim()
      };
      // Cc the registrant as well so the notice is guaranteed to reach them even
      // if the mail infrastructure only honors Cc recipients. Registrars still
      // receive their copy via Cc.
      const ccRecipients = Array.from(new Set([user.email, ...joinRequestRecipients()])).filter(Boolean);
      if (ccRecipients.length) denialMail.cc = ccRecipients;
      await smtpTransport.sendMail(denialMail);
    } catch (emailError) {
      console.error('Failed to send denial email to user:', emailError);
      // Account was already removed; email failure is non-fatal
    }

    res.json({ message: 'User denied and removed.' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to deny user:', error);
    res.status(500).json({ error: 'Unable to deny user' });
  } finally {
    client.release();
  }
}

module.exports = { delete__api_admin_calendar_events,get__api_admin_images,get__api_calendar_events,post__api_admin_upload_image,put__api_admin_calendar_events,post__api_join_request,get__api_pending_users,post__api_approve_user,post__api_deny_user };
