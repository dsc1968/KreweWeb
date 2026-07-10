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

async function get__api_admin_file_source(req, res) {
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
}

async function put__api_admin_file_source(req, res) {
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
}

async function get__api_admin_config(req, res) {
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
}

async function put__api_admin_config(req, res) {
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
}

async function post__api_admin_season_reset(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  try {
    await performSeasonReset();
    res.json({ ok: true, reset_date: new Date().toISOString().slice(0, 10) });
  } catch (err) {
    console.error('Manual season reset failed', err);
    res.status(500).json({ error: 'Season reset failed' });
  }
}
module.exports = { get__api_admin_config,get__api_admin_file_source,post__api_admin_season_reset,put__api_admin_config,put__api_admin_file_source, };
