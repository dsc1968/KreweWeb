const fs = require('fs');
const { envFilePath, parseEnvFile } = require('./utils/envConfig');
const env = parseEnvFile(fs.readFileSync(envFilePath, 'utf8'));
process.env.DATABASE_URL = env.DATABASE_URL;
const jwt = require('jsonwebtoken');
const { pool } = require('./config/db');
const base = 'http://localhost:8000';
const results = [];
const check = (n, c, e = '') => results.push([c ? 'PASS' : 'FAIL', n, e]);
const uniq = () => 'mfa_' + Date.now() + '_' + Math.floor(Math.random() * 1000);

(async () => {
  const admin = (await pool.query("SELECT id,email FROM users WHERE role='admin' LIMIT 1")).rows[0];
  const adminToken = jwt.sign({ userId: admin.id, email: admin.email, role: 'admin' }, env.JWT_SECRET, { expiresIn: '1h' });
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + adminToken };
  const getCode = async (e) => (await pool.query(`SELECT code FROM mfa_challenges mc JOIN users u ON u.id=mc.user_id WHERE u.email=$1 ORDER BY mc.created_at DESC LIMIT 1`, [e])).rows[0]?.code;

  await fetch(base + '/api/admin/mfa-config', { method: 'PUT', headers: H, body: JSON.stringify({ mfaMode: 'off' }) });
  let r = await fetch(base + '/api/mfa-policy'); let j = await r.json();

  check('default mfa_mode=off', j.mfaMode === 'off'); check('elevatedForcedMfa (mode off)', j.elevatedForcedMfa === false);
  await fetch(base + '/api/admin/mfa-config', { method: 'PUT', headers: H, body: JSON.stringify({ mfaMode: 'registration_and_login' }) });
  r = await fetch(base + '/api/mfa-policy'); j = await r.json(); check('policy registrationRequiresMfa', j.registrationRequiresMfa === true);

  const e1 = uniq() + '@test.com', pw = 'Test1234!';
  r = await fetch(base + '/api/auth/register/request-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ full_name: 'M1', email: e1, password: pw, mfa_method: 'email' }) }); j = await r.json();
  check('request-code 202', r.status === 202 && j.verificationRequired);
  const ec1 = (await pool.query('SELECT verification_code FROM pending_registrations WHERE email=$1', [e1])).rows[0].verification_code;
  r = await fetch(base + '/api/auth/register/verify-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e1, code: ec1 }) }); j = await r.json();
  check('verify-code enrolls MFA and logs in', r.status === 201 && j.token && j.mfaEnrolled === true); const mem1 = j.token;
  r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e1, password: pw }) }); j = await r.json();
  check('login mfaRequired', j.mfaRequired === true && !!j.mfaToken);
  r = await fetch(base + '/api/auth/mfa/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mfaToken: j.mfaToken, code: await getCode(e1) }) }); j = await r.json();
  check('login mfa/verify', r.status === 200 && j.token);

  await fetch(base + '/api/admin/mfa-config', { method: 'PUT', headers: H, body: JSON.stringify({ mfaMode: 'off' }) });
  r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e1, password: pw }) }); j = await r.json();
  check('mode off -> member no MFA', !!j.token && !j.mfaRequired);

  // admins_only: members may skip MFA, but admins/limited-admins are still forced.
  await fetch(base + '/api/admin/mfa-config', { method: 'PUT', headers: H, body: JSON.stringify({ mfaMode: 'admins_only' }) });
  r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e1, password: pw }) }); j = await r.json();
  check('admins_only -> member no MFA', !!j.token && !j.mfaRequired && !j.mfaEnrollmentRequired);

  await pool.query("UPDATE users SET role='store_admin', mfa_enrolled=false, mfa_method='none' WHERE email=$1", [e1]);
  r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e1, password: pw }) }); j = await r.json();
  check('admins_only -> elevated forced enrollment', j.mfaEnrollmentRequired === true, JSON.stringify(j).slice(0, 80));
  const enfTok = j.mfaToken;
  r = await fetch(base + '/api/auth/mfa/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mfaToken: enfTok, method: 'email' }) }); j = await r.json();
  check('admins_only elevated mfa/send', j.mfaChallengeSent === true);
  r = await fetch(base + '/api/auth/mfa/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mfaToken: enfTok, code: await getCode(e1) }) }); j = await r.json();
  check('admins_only elevated mfa/verify', r.status === 200 && j.token);
  await pool.query("UPDATE users SET role='member', mfa_enrolled=true, mfa_method='email' WHERE email=$1", [e1]);

  await fetch(base + '/api/admin/mfa-config', { method: 'PUT', headers: H, body: JSON.stringify({ mfaMode: 'registration_and_login' }) });
  const e2 = uniq() + '@test.com';
  r = await fetch(base + '/api/auth/register/request-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ full_name: 'M2', email: e2, password: pw, mfa_method: 'sms', phone: '5551234567' }) });
  const ec2 = (await pool.query('SELECT verification_code FROM pending_registrations WHERE email=$1', [e2])).rows[0].verification_code;
  r = await fetch(base + '/api/auth/register/verify-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e2, code: ec2 }) }); j = await r.json();
  check('register logs in with email MFA', r.status === 201 && j.token && j.mfaEnrolled === true);
  // New members always default to email MFA, ignoring any client-sent mfa_method.
  const su = (await pool.query('SELECT mfa_method FROM users WHERE email=$1', [e2])).rows[0];
  check('user.mfa_method=email', su && su.mfa_method === 'email', 'got=' + (su && su.mfa_method));
  const e2Token = j.token;
  // Switching to SMS later from the profile is the supported path.
  r = await fetch(base + '/api/profile/mfa', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + e2Token }, body: JSON.stringify({ method: 'sms', phone: '+15551234567' }) }); j = await r.json();
  check('profile switch to sms', j.mfaChallengeSent === true && j.method === 'sms', 'method=' + j.method);
  r = await fetch(base + '/api/auth/mfa/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mfaToken: j.mfaToken, code: await getCode(e2) }) }); j = await r.json();
  check('profile sms verified', j.mfaEnrolled === true);
  const su2 = (await pool.query('SELECT mfa_method FROM users WHERE email=$1', [e2])).rows[0];
  check('user.mfa_method now sms', su2 && su2.mfa_method === 'sms', 'got=' + (su2 && su2.mfa_method));

  r = await fetch(base + '/api/profile/mfa', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + mem1 }, body: JSON.stringify({ method: 'email' }) }); j = await r.json();
  check('profile/mfa send', j.mfaChallengeSent === true);
  r = await fetch(base + '/api/auth/mfa/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mfaToken: j.mfaToken, code: await getCode(e1) }) }); j = await r.json();
  check('profile mfa/verify', j.mfaEnrolled === true);
  r = await fetch(base + '/api/profile', { headers: { Authorization: 'Bearer ' + mem1 } }); j = await r.json();
  check('profile mfa fields', j.mfa_method === 'email' && j.mfa_enrolled === true);

  // ---- Authenticator app (TOTP) MFA ----
  const { totpToken: totpForTest } = require('./utils/totp');
  const e3 = uniq() + '@test.com';
  r = await fetch(base + '/api/auth/register/request-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ full_name: 'M3', email: e3, password: pw, mfa_method: 'email' }) }); j = await r.json();
  check('authenticator: request-code 202', r.status === 202 && j.verificationRequired);
  const ec3 = (await pool.query('SELECT verification_code FROM pending_registrations WHERE email=$1', [e3])).rows[0].verification_code;
  r = await fetch(base + '/api/auth/register/verify-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e3, code: ec3 }) }); j = await r.json();
  // Registration under an MFA-required policy does NOT log the user in yet; it
  // returns an enrollment mfaToken the client uses to finish 2FA setup.
  check('authenticator: registration logs in with MFA', r.status === 201 && j.token && j.mfaEnrolled === true); const mem3 = j.token;
  // Enroll the authenticator app via the profile MFA endpoint (auth required).
  r = await fetch(base + '/api/profile/mfa', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + mem3 }, body: JSON.stringify({ method: 'authenticator' }) }); j = await r.json();
  check('authenticator: enrollment provisioning', r.status === 200 && j.method === 'authenticator' && !!j.secret, 'method=' + j.method);
  const secret3 = j.secret;
  r = await fetch(base + '/api/auth/mfa/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mfaToken: j.mfaToken, code: totpForTest(secret3) }) }); j = await r.json();
  check('authenticator: verify enroll', r.status === 200 && j.token && j.mfaEnrolled === true, JSON.stringify(j).slice(0, 80));
  // Login should now require the authenticator method and a fresh TOTP.
  r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e3, password: pw }) }); j = await r.json();
  check('authenticator: login mfaRequired', j.mfaRequired === true && j.method === 'authenticator', 'method=' + j.method);
  r = await fetch(base + '/api/auth/mfa/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mfaToken: j.mfaToken, code: totpForTest(secret3) }) }); j = await r.json();
  check('authenticator: login verify', r.status === 200 && j.token, JSON.stringify(j).slice(0, 80));

  await fetch(base + '/api/admin/mfa-config', { method: 'PUT', headers: H, body: JSON.stringify({ mfaMode: 'off' }) });
  await pool.query('DELETE FROM mfa_challenges'); await pool.query('DELETE FROM pending_registrations');
  await pool.query("DELETE FROM user_profiles WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'mfa_%@test.com')");
  await pool.query("DELETE FROM users WHERE email LIKE 'mfa_%@test.com'");
  await pool.end();
  let f = 0; for (const [s, n, e] of results) { if (s === 'FAIL') f++; console.log(s, '-', n, e ? ('| ' + e) : ''); }
  console.log('\n=== ' + (f ? ('FAILURES: ' + f) : 'ALL PASS') + ' (' + results.length + ') ===');
  process.exit(f ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(2); });
