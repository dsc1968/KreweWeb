const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');
const appDir = path.join(__dirname, '..', 'frontend');
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

function collectBackupAppFiles(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'images') collectBackupAppFiles(full, results);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (['.html', '.css', '.js'].includes(ext)) results.push(full);
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

const DB_TABLES_INSERT_ORDER = [
  'users', 'user_profiles', 'pending_registrations',
  'content_blocks', 'element_overrides', 'calendar_events',
  'page_sections', 'photo_albums', 'album_images',
];

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

module.exports = { appDir,BACKUP_CONFIG_KEYS,backupIdSafe,collectBackupAppFiles,DB_TABLES_INSERT_ORDER,execFileAsync,extractZip,fileBackupsDir,isSafeColumnName,isSafeRclonePath,listLocalBackupsFromDir,listRcloneBackupManifests,listS3BackupManifests,makeS3Client,rcloneDeleteFile,rcloneDownloadFile,rcloneListFiles,rcloneRun,rcloneUploadFile,readBackupConfig,removeDir,zipDirectory, };
