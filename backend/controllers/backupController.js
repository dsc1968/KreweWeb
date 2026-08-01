const fs = require('fs');
const path = require('path');
const os = require('os');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { pool, JWT_SECRET, REGISTRATION_CODE_TTL_MINUTES, SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_REPLY_TO, CONTACT_RECIPIENT } = require('../config/db');
const { ADMIN_EDIT_EXCLUDED_PAGES, HEX_COLOR_PATTERN, LENGTH_VALUE_PATTERN, BORDER_STYLE_VALUES, normalizePagePath, isAdminEditablePagePath, validateEditablePagePath, normalizeHexColor, normalizeLengthValue, normalizeBorderStyle, normalizePositionMode, normalizeCoordinate, normalizeOpacityValue, isAdmin, isShopManager } = require('../utils/validation');
const { smtpTransport, normalizeEmailAddress, isValidEmailAddress, generateVerificationCode, maskVerificationTarget, sendVerificationMail, dispatchVerificationCode } = require('../utils/email');
const { appDir, fileBackupsDir, imagesDir, listImagesInDirectory, resolveEditableFilePath, storage, upload } = require('../utils/files');
const { ashWednesdayDate, ashWednesdayISO, checkAndRunSeasonReset, currentSeasonYear, easterDate, parseSeasonEndConfig, performSeasonReset, resolveSeasonEndDate, seasonEndISO } = require('../utils/season');
const { ENV_CONFIG_ALLOWLIST, envFilePath, parseEnvFile, serializeEnvFile } = require('../utils/envConfig');
const { appDir: _bAppDir, BACKUP_CONFIG_KEYS, BACKUP_SCHEDULE_KEYS, backupIdSafe, collectBackupAppFiles, computeNextScheduledBackup, computeRestoreInsertOrder, createBackup, DB_TABLES_INSERT_ORDER, execFileAsync, extractZip, fileBackupsDir: _bFb, isSafeColumnName, isSafeRclonePath, listLocalBackupsFromDir, listRcloneBackupManifests, listS3BackupManifests, listZipEntries, makeS3Client, readBackupConfig, readBackupSchedule, removeDir, rcloneDeleteFile, rcloneDownloadFile, rcloneListFiles, rcloneRun, rcloneUploadFile, zipDirectory } = require('../utils/backup');

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
  const label = typeof req.body.label === 'string' ? req.body.label : '';
  try {
    const manifest = await createBackup({ type, label, createdBy: req.user.email || String(req.user.userId) });
    res.status(201).json({ ok: true, backup: manifest });
  } catch (err) {
    console.error('Failed to create backup', err);
    res.status(500).json({ error: 'Unable to create backup: ' + err.message });
  }
}

async function get__api_admin_backup_schedule(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const content = fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, 'utf8') : '';
    const all = parseEnvFile(content);
    const config = {};
    for (const key of BACKUP_SCHEDULE_KEYS) config[key] = all[key] ?? '';
    const sched = readBackupSchedule();
    const nextRun = sched.enabled ? computeNextScheduledBackup(sched).toISOString() : null;
    res.json({ config, nextRun, serverTime: new Date().toISOString() });
  } catch (err) {
    console.error('Failed to read backup schedule', err);
    res.status(500).json({ error: 'Unable to read schedule' });
  }
}

async function put__api_admin_backup_schedule(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const updates = req.body.config;
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    return res.status(400).json({ error: 'config object is required' });
  }
  const safe = {};
  for (const key of BACKUP_SCHEDULE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      if (typeof updates[key] !== 'string') return res.status(400).json({ error: `Value for ${key} must be a string` });
      safe[key] = updates[key].trim();
    }
  }
  const bool = (safe.BACKUP_SCHEDULE_ENABLED || '').toLowerCase();
  if (bool && bool !== 'true' && bool !== 'false') return res.status(400).json({ error: 'BACKUP_SCHEDULE_ENABLED must be true or false' });
  const freq = safe.BACKUP_SCHEDULE_FREQUENCY || '';
  if (freq && !['daily', 'weekly', 'monthly'].includes(freq)) return res.status(400).json({ error: 'BACKUP_SCHEDULE_FREQUENCY must be daily, weekly, or monthly' });
  const type = safe.BACKUP_SCHEDULE_TYPE || '';
  if (type && !['full', 'files', 'database'].includes(type)) return res.status(400).json({ error: 'BACKUP_SCHEDULE_TYPE must be full, files, or database' });
  const bounds = { BACKUP_SCHEDULE_HOUR: [0, 23], BACKUP_SCHEDULE_MINUTE: [0, 59], BACKUP_SCHEDULE_DOW: [0, 6], BACKUP_SCHEDULE_DOM: [1, 31], BACKUP_SCHEDULE_RETENTION: [0, 9999] };
  for (const [k, [lo, hi]] of Object.entries(bounds)) {
    if (safe[k] && (!/^\d+$/.test(safe[k]) || Number(safe[k]) < lo || Number(safe[k]) > hi)) {
      return res.status(400).json({ error: `${k} must be an integer between ${lo} and ${hi}` });
    }
  }
  try {
    const original = fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, 'utf8') : '';
    const updated = serializeEnvFile(original, safe);
    fs.writeFileSync(envFilePath, updated, 'utf8');
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to write backup schedule', err);
    res.status(500).json({ error: 'Unable to save schedule' });
  }
}

// Reject paths that could escape the app directory (path traversal).
function isSafeRelativePath(rel) {
  if (typeof rel !== 'string' || rel.length === 0 || rel.length > 4096) return false;
  if (/[\0]/.test(rel)) return false;
  const normalized = path.normalize(rel).replace(/\\/g, '/');
  if (normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/')) return false;
  if (normalized.split('/').includes('..')) return false;
  return true;
}

// Download a backup's manifest + zip to a temp file, returning their locations.
// Shared by the file-listing and restore endpoints. The caller owns cleanup of tmpZip.
async function fetchBackupArtifacts(id, cfg) {
  const tmpZip = path.join(os.tmpdir(), `${id}_restore.zip`);
  let manifest;
  if (cfg.provider === 's3') {
    if (!cfg.s3Bucket) { const e = new Error('S3 bucket is not configured'); e.status = 400; throw e; }
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const s3 = makeS3Client(cfg);
    try {
      const mRes = await s3.send(new GetObjectCommand({ Bucket: cfg.s3Bucket, Key: cfg.s3Prefix + id + '.json' }));
      manifest = JSON.parse(await mRes.Body.transformToString());
    } catch { const e = new Error('Backup not found'); e.status = 404; throw e; }
    const zRes = await s3.send(new GetObjectCommand({ Bucket: cfg.s3Bucket, Key: cfg.s3Prefix + id + '.zip' }));
    fs.writeFileSync(tmpZip, Buffer.from(await zRes.Body.transformToByteArray()));
  } else if (cfg.provider === 'rclone') {
    if (!cfg.rcloneRemote) { const e = new Error('rclone remote name is not configured'); e.status = 400; throw e; }
    if (!isSafeRclonePath(cfg.rcloneRemote)) { const e = new Error('Invalid rclone remote name'); e.status = 400; throw e; }
    const tmpManJson = path.join(os.tmpdir(), `krewe-man-${id}.json`);
    try {
      await rcloneDownloadFile(cfg.rcloneRemote, cfg.rcloneFolder, id + '.json', tmpManJson);
      manifest = JSON.parse(fs.readFileSync(tmpManJson, 'utf8'));
    } catch (err) {
      if (/not found|does not exist/i.test(err.message)) { const e = new Error('Backup not found'); e.status = 404; throw e; }
      throw err;
    } finally {
      try { fs.unlinkSync(tmpManJson); } catch { }
    }
    await rcloneDownloadFile(cfg.rcloneRemote, cfg.rcloneFolder, id + '.zip', tmpZip);
  } else {
    const localManifest = path.join(cfg.localPath, id + '.json');
    const localZip = path.join(cfg.localPath, id + '.zip');
    if (!localManifest.startsWith(cfg.localPath)) { const e = new Error('Invalid backup id'); e.status = 400; throw e; }
    if (!fs.existsSync(localManifest)) { const e = new Error('Backup not found'); e.status = 404; throw e; }
    manifest = JSON.parse(fs.readFileSync(localManifest, 'utf8'));
    fs.copyFileSync(localZip, tmpZip);
  }
  return { tmpZip, manifest };
}

async function get__api_admin_backups__id_files(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const { id } = req.params;
  if (!backupIdSafe(id)) return res.status(400).json({ error: 'Invalid backup id' });
  try {
    const cfg = readBackupConfig();
    const { tmpZip, manifest } = await fetchBackupArtifacts(id, cfg);
    try {
      const entries = await listZipEntries(tmpZip);
      const prefix = 'files/app/';
      const files = entries
        .filter((p) => p.startsWith(prefix) && !p.endsWith('/'))
        .map((p) => p.slice(prefix.length))
        .sort();
      const hasConfig = entries.includes('files/.env');
      res.json({ id, contains: manifest.contains || [], files, hasConfig });
    } catch (err) {
      res.status(500).json({ error: 'Unable to read backup contents: ' + err.message });
    } finally {
      try { if (fs.existsSync(tmpZip)) fs.unlinkSync(tmpZip); } catch { }
    }
  } catch (err) {
    const code = err.status || 500;
    res.status(code).json({ error: err.message || 'Unable to list backup files' });
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
  const selectedFiles = Array.isArray(req.body.selectedFiles) ? req.body.selectedFiles : null;
  const restoreConfig = req.body.restoreConfig === true;

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
      const wantConfig = restoreConfig === true || selectedFiles == null;

      if (Array.isArray(selectedFiles)) {
        // Selective restore: only the explicitly chosen pages (empty array = none).
        for (const rel of selectedFiles) {
          if (!isSafeRelativePath(rel)) return res.status(400).json({ error: 'Invalid file path: ' + rel });
          const src = path.join(srcAppDir, rel);
          if (src !== srcAppDir && !src.startsWith(srcAppDir + path.sep)) continue;
          if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
          const dest = path.join(appDir, rel);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(src, dest);
        }
        if (selectedFiles.length > 0) restored.push('files');
      } else if (fs.existsSync(srcAppDir)) {
        // Full file restore (previous behaviour) when no selection was supplied.
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
        restored.push('files');
      }

      if (wantConfig) {
        const envSrc = path.join(tmpDir, 'files', '.env');
        if (fs.existsSync(envSrc)) { fs.copyFileSync(envSrc, envFilePath); restored.push('config'); }
      }
    }

    if (wantDb) {
      if (!manifest.contains.includes('database')) return res.status(400).json({ error: 'This backup does not contain database data' });
      const dump = JSON.parse(fs.readFileSync(path.join(tmpDir, 'database.json'), 'utf8'));

      // Only restore tables that exist in the current schema and have safe names,
      // keeping restores robust against schema drift.
      const existingRes = await pool.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`
      );
      const existing = new Set(existingRes.rows.map((r) => r.table_name));
      const tables = Object.keys(dump).filter((t) => existing.has(t) && isSafeColumnName(t));
      const insertOrder = await computeRestoreInsertOrder(pool, tables);
      if (tables.length === 0) return res.status(400).json({ error: 'Backup contains no restorable tables' });

      const pgClient = await pool.connect();
      try {
        await pgClient.query('BEGIN');
        // Single multi-table TRUNCATE: PostgreSQL orders it by foreign keys and
        // does NOT cascade to tables outside this list, so no unrelated data is
        // wiped. (We back up every application table, so this set is complete.)
        await pgClient.query(`TRUNCATE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY`);
        for (const table of insertOrder) {
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
        // After re-inserting explicit ids, realign identity sequences so the next
        // auto-generated id won't collide with restored rows.
        for (const table of tables) {
          const pkRes = await pgClient.query(
            `SELECT kcu.column_name
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
               ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
             WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public' AND tc.table_name = $1`,
            [table]
          );
          for (const pk of pkRes.rows) {
            const seqRes = await pgClient.query(`SELECT pg_get_serial_sequence($1, $2) AS seq`, [table, pk.column_name]);
            const seqName = seqRes.rows[0] && seqRes.rows[0].seq;
            if (seqName) {
              await pgClient.query(
                `SELECT setval($1, COALESCE((SELECT MAX("${pk.column_name}") FROM "${table}"), 1), true)`,
                [seqName]
              );
            }
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
module.exports = { delete__api_admin_backups__id,get__api_admin_backup_location,get__api_admin_backup_rclone_check,get__api_admin_backups,get__api_admin_backup_schedule,get__api_admin_backups__id_files,post__api_admin_backups,post__api_admin_backups__id_restore,put__api_admin_backup_location,put__api_admin_backup_schedule, };
