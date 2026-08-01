const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');
const { envFilePath, parseEnvFile } = require('./envConfig');
// The "site" we back up is the entire project root (frontend/ + backend/ + config),
// so a full restore can rebuild everything to its proper location.
const appDir = path.join(__dirname, '..', '..');
const fileBackupsDir = path.join(__dirname, '..', '_file_backups');
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
  'BACKUP_RCLONE_REMOTE',
  'BACKUP_RCLONE_FOLDER',
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
    rcloneRemote: env.BACKUP_RCLONE_REMOTE || '',
    rcloneFolder: (env.BACKUP_RCLONE_FOLDER || 'krewe-backups'),
  };
}

// ── rclone helpers ─────────────────────────────────────────────────────────
// rclone is a free, open-source CLI that supports OneDrive (personal & business),
// Google Drive, Dropbox, S3, and 70+ other cloud storage providers.
// Install: https://rclone.org/install/
// Configure: run `rclone config` once on the server to create a named remote.
// rclone has its own built-in Microsoft app credentials, so no Azure app
// registration is needed for personal OneDrive.

const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

// Basic safety check: remote names and folder paths must not contain shell-special chars.
// execFile is used (not exec) so this is defense-in-depth, not the primary boundary.
function isSafeRclonePath(v) {
  return typeof v === 'string' && v.length > 0 && v.length <= 200 && /^[A-Za-z0-9_.\-/:]+$/.test(v);
}

async function rcloneRun(args) {
  const { stdout, stderr } = await execFileAsync('rclone', args, {
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  }).catch((err) => {
    throw new Error(`rclone ${args[0] || ''} failed: ${(err.stderr || err.message || '').toString().slice(0, 500)}`);
  });
  return { stdout, stderr };
}

async function rcloneListFiles(remote, folder) {
  try {
    const { stdout } = await rcloneRun(['lsjson', `${remote}:${folder}`, '--files-only', '--no-modtime']);
    return JSON.parse(stdout || '[]');
  } catch (err) {
    // Treat "directory not found" / "not exist" as empty folder rather than error
    if (/not found|doesn.t exist|directory not found|object not found/i.test(err.message)) return [];
    throw err;
  }
}

async function rcloneUploadFile(remote, folder, filename, localPath) {
  await rcloneRun(['copyto', localPath, `${remote}:${folder}/${filename}`]);
}

async function rcloneDownloadFile(remote, folder, filename, localPath) {
  await rcloneRun(['copyto', `${remote}:${folder}/${filename}`, localPath]);
}

async function rcloneDeleteFile(remote, folder, filename) {
  try {
    await rcloneRun(['deletefile', `${remote}:${folder}/${filename}`]);
  } catch (err) {
    if (!/not found|doesn.t exist|object not found/i.test(err.message)) throw err;
  }
}

async function listRcloneBackupManifests(cfg) {
  const files = await rcloneListFiles(cfg.rcloneRemote, cfg.rcloneFolder);
  const manifests = [];
  for (const f of files) {
    if (!f.Name || !f.Name.endsWith('.json')) continue;
    const tmp = path.join(os.tmpdir(), `krewe-rc-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    try {
      await rcloneDownloadFile(cfg.rcloneRemote, cfg.rcloneFolder, f.Name, tmp);
      manifests.push(JSON.parse(fs.readFileSync(tmp, 'utf8')));
    } catch { /* skip corrupted/unreadable */ } finally {
      try { fs.unlinkSync(tmp); } catch { }
    }
  }
  return manifests.sort((a, b) => (!a.created_at ? 1 : !b.created_at ? -1 : b.created_at.localeCompare(a.created_at)));
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

// Directories that are not part of the restorable site and must be excluded to
// avoid recursion / bloat (backup storage, dependency caches, VCS, temp junk).
const BACKUP_EXCLUDED_DIRS = new Set(['node_modules', '.git', '_backups', '_file_backups', 'tmp', 'home']);
function collectBackupAppFiles(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (BACKUP_EXCLUDED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectBackupAppFiles(full, results);
    } else {
      results.push(full);
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

// Legacy explicit table list (kept for export compatibility). The actual backup
// now enumerates every application table dynamically via listAppTables(), so
// newly added tables (e.g. shop_*, site_settings) are always included without
// code changes.
const DB_TABLES_INSERT_ORDER = [
  'users', 'user_profiles', 'pending_registrations',
  'content_blocks', 'element_overrides', 'calendar_events',
  'page_sections', 'photo_albums', 'album_images',
];

// Bookkeeping/migration state, not restorable application data.
const BACKUP_EXCLUDED_TABLES = new Set(['knex_migrations', 'knex_migrations_lock']);

// Returns every restorable application table in the public schema.
async function listAppTables(pool) {
  const res = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`
  );
  return res.rows
    .map((r) => r.table_name)
    .filter((t) => !BACKUP_EXCLUDED_TABLES.has(t) && /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(t));
}




// Order the given tables so that parent tables (those referenced by foreign
// keys) are restored before the child tables that depend on them. This keeps
// INSERTs from violating foreign-key constraints when a database backup is
// restored.
//
// The ordering is computed from the live foreign-key graph in information_schema
// rather than a hard-coded list, so it (a) needs no special privileges, (b)
// adapts automatically when tables are added/removed, and (c) tolerates a
// table being absent from the backup (edges to tables outside `tables` are
// ignored, since those rows are never truncated and therefore still exist).
//
// `client` must be an active pg client/connection. Returns `tables` sorted so
// that dependencies come first; any tables left over from a cycle are appended
// at the end so the restore still proceeds rather than silently skipping data.
async function computeRestoreInsertOrder(client, tables) {
  if (!Array.isArray(tables) || tables.length === 0) return [];
  const tableSet = new Set(tables);

  const depsRes = await client.query(
    `SELECT tc.table_name AS child, ccu.table_name AS parent
     FROM information_schema.table_constraints tc
     JOIN information_schema.constraint_column_usage ccu
       ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
     WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
       AND tc.table_name = ANY($1::text[]) AND ccu.table_name = ANY($1::text[])`,
    [tables]
  );

  // dependents: parent -> children that must come after it.
  // indegree: how many parents each table still needs before it can be emitted.
  const dependents = new Map();
  const indegree = new Map();
  for (const t of tables) { dependents.set(t, new Set()); indegree.set(t, 0); }
  for (const row of depsRes.rows) {
    const { child, parent } = row;
    if (child === parent) continue;
    if (!tableSet.has(child) || !tableSet.has(parent)) continue;
    if (!dependents.get(parent).has(child)) {
      dependents.get(parent).add(child);
      indegree.set(child, indegree.get(child) + 1);
    }
  }

  // Kahn's algorithm: emit tables with no outstanding dependencies first.
  const queue = tables.filter((t) => indegree.get(t) === 0);
  const order = [];
  const seen = new Set();
  while (queue.length) {
    const t = queue.shift();
    if (seen.has(t)) continue;
    seen.add(t);
    order.push(t);
    for (const child of dependents.get(t)) {
      indegree.set(child, indegree.get(child) - 1);
      if (indegree.get(child) === 0) queue.push(child);
    }
  }
  // Append anything left behind by a cycle so no data is silently dropped.
  for (const t of tables) if (!seen.has(t)) order.push(t);
  return order;
}

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

const BACKUP_SCHEDULE_KEYS = [
  'BACKUP_SCHEDULE_ENABLED',
  'BACKUP_SCHEDULE_FREQUENCY',
  'BACKUP_SCHEDULE_HOUR',
  'BACKUP_SCHEDULE_MINUTE',
  'BACKUP_SCHEDULE_DOW',
  'BACKUP_SCHEDULE_DOM',
  'BACKUP_SCHEDULE_TYPE',
  'BACKUP_SCHEDULE_RETENTION',
];

// Create a backup archive (files and/or database) and store it using the
// configured provider. Returns the backup manifest. `createdBy` is recorded in
// the manifest (an admin email, or "scheduled" for automatic runs).
async function createBackup({ type, label = '', createdBy = 'system' } = {}) {
  if (!['files', 'database', 'full'].includes(type)) {
    throw new Error('type must be files, database, or full');
  }
  const { pool } = require('../config/db');
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const id = `backup_${ts}`;
  const rawLabel = typeof label === 'string' ? label.trim().slice(0, 120) : '';
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'krewe-bk-'));
  const tmpZip = path.join(os.tmpdir(), `${id}.zip`);

  try {
    const manifest = {
      id, type, label: rawLabel,
      created_at: new Date().toISOString(),
      created_by: createdBy,
      contains: [],
    };

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
      for (const table of await listAppTables(pool)) {
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
      if (!cfg.s3Bucket) throw new Error('S3 bucket is not configured');
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
      if (!cfg.rcloneRemote) throw new Error('rclone remote name is not configured');
      if (!isSafeRclonePath(cfg.rcloneRemote)) throw new Error('Invalid rclone remote name');
      if (!isSafeRclonePath(cfg.rcloneFolder)) throw new Error('Invalid rclone folder name');
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

    return manifest;
  } finally {
    try { removeDir(tmpDir); } catch { }
    try { if (fs.existsSync(tmpZip)) fs.unlinkSync(tmpZip); } catch { }
  }
}

async function getSiteSetting(key) {
  const { pool } = require('../config/db');
  const res = await pool.query(`SELECT value FROM site_settings WHERE key = $1`, [key]);
  return res.rows.length ? res.rows[0].value : null;
}

async function setSiteSetting(key, value) {
  const { pool } = require('../config/db');
  await pool.query(
    `INSERT INTO site_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value],
  );
}

function readBackupSchedule() {
  const content = fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, 'utf8') : '';
  const env = parseEnvFile(content);
  const between = (v, d, lo, hi) => {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
  };
  return {
    enabled: (env.BACKUP_SCHEDULE_ENABLED || 'false').toLowerCase() === 'true',
    frequency: ['daily', 'weekly', 'monthly'].includes(env.BACKUP_SCHEDULE_FREQUENCY) ? env.BACKUP_SCHEDULE_FREQUENCY : 'daily',
    hour: between(env.BACKUP_SCHEDULE_HOUR, 3, 0, 23),
    minute: between(env.BACKUP_SCHEDULE_MINUTE, 0, 0, 59),
    dow: between(env.BACKUP_SCHEDULE_DOW, 0, 0, 6),
    dom: between(env.BACKUP_SCHEDULE_DOM, 1, 1, 31),
    type: ['full', 'files', 'database'].includes(env.BACKUP_SCHEDULE_TYPE) ? env.BACKUP_SCHEDULE_TYPE : 'full',
    retention: between(env.BACKUP_SCHEDULE_RETENTION, 0, 0, 9999),
  };
}

// Compute the next scheduled run (server local time) — used for display.
function computeNextScheduledBackup(sched, from = new Date()) {
  const at = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), sched.hour, sched.minute, 0, 0);
  if (sched.frequency === 'daily') {
    let c = at(from);
    if (c <= from) c = new Date(c.getTime() + 24 * 60 * 60 * 1000);
    return c;
  }
  if (sched.frequency === 'weekly') {
    let c = at(from), guard = 0;
    while (c.getDay() !== sched.dow || c <= from) {
      c = new Date(c.getTime() + 24 * 60 * 60 * 1000);
      if (++guard > 14) break;
    }
    return c;
  }
  // monthly
  let year = from.getFullYear(), month = from.getMonth();
  const tryMonth = () => {
    const days = new Date(year, month + 1, 0).getDate();
    const dom = Math.min(sched.dom, days);
    return new Date(year, month, dom, sched.hour, sched.minute, 0, 0);
  };
  let c = tryMonth();
  if (c <= from) {
    month += 1;
    if (month > 11) { month = 0; year += 1; }
    c = tryMonth();
  }
  return c;
}

// Compute the most recent scheduled occurrence that is <= `from` for the
// given schedule. Daily has no day constraint; weekly/monthly walk backwards
// until the day-of-week / day-of-month matches. This lets the tick recover
// a slot that was missed due to event-loop jitter, a brief outage, or a
// server restart, instead of only firing if a tick lands exactly on the minute.
function mostRecentOccurrence(sched, from) {
  const at = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), sched.hour, sched.minute, 0, 0);
  const dayMatches = (d) => {
    if (sched.frequency === 'weekly' && d.getDay() !== sched.dow) return false;
    if (sched.frequency === 'monthly' && d.getDate() !== sched.dom) return false;
    return true;
  };
  if (sched.frequency === 'weekly') {
    let c = at(from), guard = 0;
    while ((!dayMatches(c) || c > from) && guard < 14) { c = new Date(c.getTime() - 24 * 60 * 60 * 1000); guard++; }
    return c;
  }
  if (sched.frequency === 'monthly') {
    let c = at(from), guard = 0;
    while ((!dayMatches(c) || c > from) && guard < 400) { c = new Date(c.getTime() - 24 * 60 * 60 * 1000); guard++; }
    return c;
  }
  // daily
  let c = at(from);
  if (c > from) c = new Date(c.getTime() - 24 * 60 * 60 * 1000);
  return c;
}


// Delete a single backup's manifest + zip artifacts from the configured
// provider. Reused by both the API delete route helpers and retention pruning.
async function deleteBackupArtifact(cfg, id) {
  if (!backupIdSafe(id)) return;
  if (cfg.provider === 's3') {
    if (!cfg.s3Bucket) return;
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    const s3 = makeS3Client(cfg);
    await s3.send(new DeleteObjectCommand({ Bucket: cfg.s3Bucket, Key: cfg.s3Prefix + id + '.zip' })).catch(() => {});
    await s3.send(new DeleteObjectCommand({ Bucket: cfg.s3Bucket, Key: cfg.s3Prefix + id + '.json' })).catch(() => {});
  } else if (cfg.provider === 'rclone') {
    if (!cfg.rcloneRemote) return;
    await rcloneDeleteFile(cfg.rcloneRemote, cfg.rcloneFolder, id + '.zip');
    await rcloneDeleteFile(cfg.rcloneRemote, cfg.rcloneFolder, id + '.json');
  } else {
    if (!cfg.localPath) return;
    const localZip = path.join(cfg.localPath, id + '.zip');
    const localJson = path.join(cfg.localPath, id + '.json');
    if (fs.existsSync(localZip)) fs.unlinkSync(localZip);
    if (fs.existsSync(localJson)) fs.unlinkSync(localJson);
  }
}

// Enforce a retention policy: keep the most recent `retention` scheduled
// backups and delete the older ones. `retention` <= 0 keeps everything.
// Only backups created by the scheduler are pruned, so manually created
// backups are never auto-deleted. Returns the number of backups removed.
async function pruneScheduledBackups(cfg, retention) {
  const keep = Number.parseInt(retention, 10);
  if (!Number.isFinite(keep) || keep < 1) return 0;
  let all;
  if (cfg.provider === 's3') all = await listS3BackupManifests(cfg);
  else if (cfg.provider === 'rclone') all = await listRcloneBackupManifests(cfg);
  else all = await listLocalBackupsFromDir(cfg.localPath);
  // Lists are sorted newest-first; scheduled ones only.
  const scheduled = all.filter((m) => m && m.created_by === 'scheduled');
  if (scheduled.length <= keep) return 0;
  const toDelete = scheduled.slice(keep);
  let removed = 0;
  for (const m of toDelete) {
    if (!m.id || !backupIdSafe(m.id)) continue;
    try {
      await deleteBackupArtifact(cfg, m.id);
      removed++;
    } catch (err) {
      console.error('[Scheduled Backup] Prune failed for', m.id, err);
    }
  }
  return removed;
}

// Drives automatic backups. Invoked on a timer from server.js. Finds the most
// recent scheduled occurrence that has not yet executed and is recent enough
// to count as a missed window (jitter / short outage / restart) rather than a
// stale slot left behind by a schedule change or a long downtime we
// deliberately do not replay. Pure timers/fs/Date — identical on Linux and
// Windows hosts.
let scheduledBackupInFlight = false;
async function runScheduledBackupTick() {
  let sched;
  try { sched = readBackupSchedule(); } catch { return; }
  if (!sched.enabled) return;
  if (scheduledBackupInFlight) return;

  const now = new Date();
  const occ = mostRecentOccurrence(sched, now);
  // Only act on occurrences within the last hour so a schedule edit to a future
  // time, or a multi-hour outage, does not trigger an unexpected immediate run.
  const TOLERANCE_MS = 60 * 60 * 1000;
  if (now.getTime() - occ.getTime() > TOLERANCE_MS) return;

  const occKey = occ.toISOString();
  try {
    const last = await getSiteSetting('last_scheduled_backup');
    if (last === occKey) return;
    scheduledBackupInFlight = true;
    const cfg = readBackupConfig();
    const manifest = await createBackup({ type: sched.type, label: 'Scheduled backup', createdBy: 'scheduled' });
    await setSiteSetting('last_scheduled_backup', occKey);
    const removed = await pruneScheduledBackups(cfg, sched.retention);
    console.log(`[Scheduled Backup] Created ${manifest.id} (${sched.frequency} @ ${String(sched.hour).padStart(2, '0')}:${String(sched.minute).padStart(2, '0')})` + (removed > 0 ? ' — pruned ' + removed + ' old backup(s) to retain ' + sched.retention : ''));
  } catch (err) {
    console.error('[Scheduled Backup] Failed:', err);
  } finally {
    scheduledBackupInFlight = false;
  }
}

// List the entry paths inside a zip archive without extracting it. Used to
// enumerate the pages available inside a backup before restoring.
async function listZipEntries(zipPath) {
  const directory = await unzipper.Open.file(zipPath);
  return directory.files.map((f) => f.path);
}

module.exports = { appDir,BACKUP_CONFIG_KEYS,BACKUP_SCHEDULE_KEYS,backupIdSafe,collectBackupAppFiles,computeNextScheduledBackup,computeRestoreInsertOrder,createBackup,DB_TABLES_INSERT_ORDER,execFileAsync,extractZip,fileBackupsDir,getSiteSetting,isSafeColumnName,isSafeRclonePath,listLocalBackupsFromDir,listRcloneBackupManifests,listS3BackupManifests,listZipEntries,makeS3Client,readBackupConfig,readBackupSchedule,removeDir,runScheduledBackupTick,pruneScheduledBackups,deleteBackupArtifact,rcloneDeleteFile,rcloneDownloadFile,rcloneListFiles,rcloneRun,rcloneUploadFile,setSiteSetting,zipDirectory, };
