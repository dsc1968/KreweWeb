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
module.exports = { delete__api_admin_calendar_events,get__api_admin_images,get__api_calendar_events,post__api_admin_upload_image,put__api_admin_calendar_events, };
