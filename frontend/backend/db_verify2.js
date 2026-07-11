const fs = require('fs'); const os = require('os'); const path = require('path');
const { envFilePath: ep, parseEnvFile } = require('./utils/envConfig');
const env = parseEnvFile(fs.readFileSync(ep, 'utf8'));
process.env.DATABASE_URL = env.DATABASE_URL;
const jwt = require('jsonwebtoken'); const { pool } = require('./config/db'); const unzipper = require('unzipper');
const BACKUPS = '/home/doug/OneDrive/krewe-backups';
const ALL = ['album_images','calendar_events','content_blocks','element_overrides','page_sections','pending_registrations','photo_albums','shop_cart_items','shop_order_items','shop_orders','shop_products','site_settings','user_profiles','users'];
async function snap() { const o={}; for (const x of ALL) { const r = await pool.query(`SELECT count(*)::int n FROM "${x}"`); o[x]=r.rows[0].n; } return o; }
(async () => {
  const u = await pool.query("SELECT id, role FROM users WHERE role='admin' LIMIT 1");
  const token = jwt.sign({ userId: u.rows[0].id }, env.JWT_SECRET);
  const H = { 'Content-Type':'application/json', Authorization:'Bearer '+token };
  const base = 'http://localhost:8000';
  // clean orphaned backup from crashed run
  try { const od = await fetch(base+'/api/admin/backups/'+encodeURIComponent('backup_2026-07-11T23-24-44-935Z'), { method:'DELETE', headers:{Authorization:'Bearer '+token} }); console.log('cleanup orphan:', od.status); } catch(e){}
  const before = await snap(); console.log('BEFORE:', JSON.stringify(before));
  const c = await fetch(base+'/api/admin/backups', { method:'POST', headers:H, body: JSON.stringify({ type:'full', label:'db-test' }) });
  const cd = await c.json(); const id = cd.backup && cd.backup.id; console.log('CREATE', c.status, id || cd.error);
  const zip = path.join(BACKUPS, id + '.zip');
  console.log('zip exists?', fs.existsSync(zip));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'krewe-db-'));
  await fs.createReadStream(zip).pipe(unzipper.Extract({ path: tmp })).promise();
  const dump = JSON.parse(fs.readFileSync(path.join(tmp, 'database.json'), 'utf8'));
  const keys = Object.keys(dump).sort();
  console.log('DUMP TABLES ('+keys.length+'):', keys.join(', '));
  const missing = ALL.filter(k=>!dump[k]); console.log('MISSING:', missing.length? missing.join(','):'(none)');
  console.log('site_settings rows:', (dump.site_settings||[]).length, '| shop_products rows:', (dump.shop_products||[]).length);
  console.log('USER ROLES+PERMISSIONS:', (dump.users||[]).map(x=>`${x.email}=${x.role}`).join(' | '));
  const r = await fetch(base+'/api/admin/backups/'+encodeURIComponent(id)+'/restore', { method:'POST', headers:H, body: JSON.stringify({ scope:'full', restoreConfig:false }) });
  console.log('RESTORE full', r.status, JSON.stringify(await r.json()));
  const after = await snap(); console.log('AFTER :', JSON.stringify(after));
  console.log('NO DATA LOSS (before==after):', JSON.stringify(before)===JSON.stringify(after));
  const s = await pool.query(`SELECT pg_get_serial_sequence('users','id') AS seq`); const seqName=s.rows[0].seq;
  const lv = await pool.query(`SELECT last_value FROM ${seqName}`); const mx = await pool.query(`SELECT MAX(id) m FROM users`);
  console.log('users seq last_value=', lv.rows[0].last_value, 'max(id)=', mx.rows[0].m, '=> OK?', lv.rows[0].last_value >= mx.rows[0].m);
  const d = await fetch(base+'/api/admin/backups/'+encodeURIComponent(id), { method:'DELETE', headers:{Authorization:'Bearer '+token} });
  console.log('DELETE', d.status);
  await pool.end(); process.exit(0);
})().catch(e=>{ console.error('TEST ERR', e); process.exit(1); });
