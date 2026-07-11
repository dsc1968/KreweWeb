const fs = require('fs');
const crypto = require('crypto');
const { envFilePath: ep, parseEnvFile } = require('./utils/envConfig');
const env = parseEnvFile(fs.readFileSync(ep, 'utf8'));
process.env.DATABASE_URL = env.DATABASE_URL;
const jwt = require('jsonwebtoken');
const { pool } = require('./config/db');
const ROOT = '/home/doug/kreweweb/Krewe';
const md5 = (f) => fs.existsSync(f) ? crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex') : '(missing)';
(async () => {
  const u = await pool.query("SELECT id, role FROM users WHERE role='admin' LIMIT 1");
  const token = jwt.sign({ userId: u.rows[0].id }, env.JWT_SECRET);
  const H = { 'Content-Type':'application/json', Authorization:'Bearer '+token };
  const base = 'http://localhost:8000';
  const c = await fetch(base+'/api/admin/backups', { method:'POST', headers:H, body: JSON.stringify({ type:'full', label:'restore-test5' }) });
  const cd = await c.json(); const id = cd.backup && cd.backup.id;
  console.log('CREATE', c.status, id || cd.error);
  const f = await fetch(base+'/api/admin/backups/'+encodeURIComponent(id)+'/files', { headers:{Authorization:'Bearer '+token} });
  const fd = await f.json();
  console.log('FILES count=', (fd.files||[]).length, 'hasConfig=', fd.hasConfig);
  console.log('includes server.js?', (fd.files||[]).includes('backend/server.js'));
  console.log('includes frontend/index.html?', (fd.files||[]).includes('frontend/index.html'));
  console.log('includes package.json?', (fd.files||[]).includes('package.json'));
  console.log('includes .env?', (fd.files||[]).includes('.env'));
  console.log('includes an image?', (fd.files||[]).some(x=>x.startsWith('frontend/assets/images/')));

  // selective restore of backend/server.js
  const before = md5(ROOT+'/backend/server.js');
  const r1 = await fetch(base+'/api/admin/backups/'+encodeURIComponent(id)+'/restore', { method:'POST', headers:H, body: JSON.stringify({ scope:'files', selectedFiles:['backend/server.js'], restoreConfig:false }) });
  console.log('RESTORE server.js', r1.status, JSON.stringify(await r1.json()));
  console.log('md5 server.js before/after:', before, '==', md5(ROOT+'/backend/server.js'));

  // full file restore (all files + config)
  const probe = ['backend/server.js','frontend/index.html','frontend/assets/images/MardiGras_Pic.jpg','package.json','.env'];
  const beforeP = {}; probe.forEach(p => beforeP[p] = md5(ROOT+'/'+p));
  const r2 = await fetch(base+'/api/admin/backups/'+encodeURIComponent(id)+'/restore', { method:'POST', headers:H, body: JSON.stringify({ scope:'files', restoreConfig:true }) });
  console.log('FULL FILE RESTORE', r2.status, JSON.stringify(await r2.json()));
  let ok = true; probe.forEach(p => { if (md5(ROOT+'/'+p) !== beforeP[p]) { ok=false; console.log('MISMATCH', p); } });
  console.log('all probed files intact after full restore:', ok);

  const d = await fetch(base+'/api/admin/backups/'+encodeURIComponent(id), { method:'DELETE', headers:{Authorization:'Bearer '+token} });
  console.log('DELETE', d.status);
  await pool.end(); process.exit(0);
})().catch(e=>{ console.error('TEST ERR', e); process.exit(1); });
