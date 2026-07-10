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

async function get__api_admin_backup_location(req, res) {
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
}

async function put__api_admin_backup_location(req, res) {
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
}

async function get__api_admin_backup_rclone_check(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const cfg = readBackupConfig();
  if (!cfg.rcloneRemote) return res.json({ ok: false, error: 'BACKUP_RCLONE_REMOTE not set' });
  if (!isSafeRclonePath(cfg.rcloneRemote)) return res.json({ ok: false, error: 'Invalid remote name' });
  try {
    await rcloneRun(['lsd', `${cfg.rcloneRemote}:`, '--max-depth', '1']);
    res.json({ ok: true, remote: cfg.rcloneRemote });
  } catch (err) {
    res.json({ ok: false, error: err.message.slice(0, 300) });
  }
}

async function get__api_admin_backups(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const page = Math.max(1, Number.parseInt(req.query.page || '1', 10));
  const perPage = 10;
  try {
    const cfg = readBackupConfig();
    let all;
    if (cfg.provider === 's3') {
      if (!cfg.s3Bucket) return res.status(400).json({ error: 'S3 bucket is not configured' });
      all = await listS3BackupManifests(cfg);
    } else if (cfg.provider === 'rclone') {
      if (!cfg.rcloneRemote) return res.status(400).json({ error: 'rclone remote name is not configured' });
      if (!isSafeRclonePath(cfg.rcloneRemote)) return res.status(400).json({ error: 'Invalid rclone remote name' });
      all = await listRcloneBackupManifests(cfg);
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
}

async function post__api_admin_backups(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const type = req.body.type;
  if (!['files', 'database', 'full'].includes(type)) {
    return res.status(400).json({ error: 'type must be files, database, or full' });
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const id = `backup_${ts}`;
  const rawLabel = typeof req.body.label === 'string' ? req.body.label.trim().slice(0, 120) : '';
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'krewe-bk-'));
  const tmpZip = path.join(os.tmpdir(), `${id}.zip`);

  try {
    const manifest = { id, type, label: rawLabel, created_at: new Date().toISOString(), created_by: req.user.email || String(req.user.userId), contains: [] };

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
    } else if (cfg.provider === 'rclone') {
      if (!cfg.rcloneRemote) return res.status(400).json({ error: 'rclone remote name is not configured' });
      if (!isSafeRclonePath(cfg.rcloneRemote)) return res.status(400).json({ error: 'Invalid rclone remote name' });
      if (!isSafeRclonePath(cfg.rcloneFolder)) return res.status(400).json({ error: 'Invalid rclone folder name' });
      const tmpManifestJson = path.join(os.tmpdir(), `krewe-manifest-${id}.json`);
      fs.writeFileSync(tmpManifestJson, JSON.stringify(manifest, null, 2), 'utf8');
      try {
        await rcloneUploadFile(cfg.rcloneRemote, cfg.rcloneFolder, id + '.zip', tmpZip);
        await rcloneUploadFile(cfg.rcloneRemote, cfg.rcloneFolder, id + '.json', tmpManifestJson);
      } finally {
        try { fs.unlinkSync(tmpManifestJson); } catch { }
      }
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
}

async function post__api_admin_backups__id_restore(req, res) {
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
    } else if (cfg.provider === 'rclone') {
      if (!cfg.rcloneRemote) return res.status(400).json({ error: 'rclone remote name is not configured' });
      if (!isSafeRclonePath(cfg.rcloneRemote)) return res.status(400).json({ error: 'Invalid rclone remote name' });
      const tmpManJson = path.join(os.tmpdir(), `krewe-man-${id}.json`);
      try {
        await rcloneDownloadFile(cfg.rcloneRemote, cfg.rcloneFolder, id + '.json', tmpManJson);
        manifest = JSON.parse(fs.readFileSync(tmpManJson, 'utf8'));
      } catch (err) {
        if (/not found|doesn.t exist/i.test(err.message)) return res.status(404).json({ error: 'Backup not found' });
        throw err;
      } finally {
        try { fs.unlinkSync(tmpManJson); } catch { }
      }
      await rcloneDownloadFile(cfg.rcloneRemote, cfg.rcloneFolder, id + '.zip', tmpZip);
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
}

async function delete__api_admin_backups__id(req, res) {
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
    } else if (cfg.provider === 'rclone') {
      if (!cfg.rcloneRemote) return res.status(400).json({ error: 'rclone remote name is not configured' });
      if (!isSafeRclonePath(cfg.rcloneRemote)) return res.status(400).json({ error: 'Invalid rclone remote name' });
      await rcloneDeleteFile(cfg.rcloneRemote, cfg.rcloneFolder, id + '.zip');
      await rcloneDeleteFile(cfg.rcloneRemote, cfg.rcloneFolder, id + '.json');
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
}
module.exports = { delete__api_admin_backups__id,get__api_admin_backup_location,get__api_admin_backup_rclone_check,get__api_admin_backups,post__api_admin_backups,post__api_admin_backups__id_restore,put__api_admin_backup_location, };
