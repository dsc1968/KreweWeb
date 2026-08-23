// Reproduction for the requirement:
//   "members (including vendors) cannot change float assignment after the
//    Float Admin locks floats"
//
// WHAT THIS SCRIPT PROVES (against a running backend + Postgres):
//   The lock is enforced inside PUT /api/profile/details. When `float_admin_lock`
//   is on, a non-float-admin's float fields (member_float_number, float_id,
//   float_riders, rider_float_names, rider_float_numbers) are restored to their
//   current values and the incoming change is dropped. Since the fix, the API
//   returns an explicit signal when it ignored a float change, instead of a
//   misleading { ok: true }.
//
//   1) LOCK OFF  -> a member's member_float_number persists.
//   2) LOCK ON   -> a member's change is DROPPED (value unchanged) AND the
//                   response flags floatChangesIgnored / floatLocked (HTTP 200).
//   3) LOCK ON   -> a VENDOR's change is ALSO dropped + flagged.
//   4) LOCK ON   -> a Float Admin CAN still change (no flag).
//   5) LOCK ON   -> a member who only edits non-float fields (phone) gets NO
//                   false "floatChangesIgnored" flag.
//
// SIDE EFFECTS (run on a test/staging instance, not prod):
//   - Creates a demo member, vendor, and uses an existing float-capable admin.
//   - Toggles the GLOBAL float lock and resets it to false at the end (the lock
//     is write-only over the API, so it cannot be read back; a warning is printed
//     if it was on before the run).
//
// RUN:
//   ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=**** \
//     BASE_URL=http://localhost:8000 node backend/scripts/reproduce-float-lock.mjs

import crypto from 'node:crypto';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD environment variables.');
  process.exit(1);
}

const unique = () => crypto.randomBytes(4).toString('hex');

async function call(method, path, { body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

async function login(email, password) {
  const { status, data } = await call('POST', '/api/auth/login', { body: { email, password } });
  if (status !== 200 || !data?.token) {
    throw new Error(`login failed (${status}): ${JSON.stringify(data)}`);
  }
  return data.token;
}

async function createUser(adminToken, { role }) {
  const email = `repro_${role}_${unique()}@example.com`;
  const password = 'ReproPassw0rd!';
  const full_name = `Repro ${role}`;
  const { status, data } = await call('POST', '/api/admin/users', { token: adminToken, body: { email, full_name, password, role } });
  if (status !== 201) throw new Error(`create ${role} failed (${status}): ${JSON.stringify(data)}`);
  return { id: data.user.id, email, password };
}

async function setLock(adminToken, locked) {
  const { status, data } = await call('PUT', '/api/admin/floats/lock', { token: adminToken, body: { locked } });
  if (status !== 200) throw new Error(`setLock failed (${status}): ${JSON.stringify(data)}`);
  return data.locked;
}

async function updateDetails(token, body) {
  return call('PUT', '/api/profile/details', { token, body });
}

async function getProfile(token) {
  const { status, data } = await call('GET', '/api/profile', { token });
  if (status !== 200) throw new Error(`getProfile failed (${status}): ${JSON.stringify(data)}`);
  return data;
}

function assert(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? `  -> ${extra}` : ''}`);
  if (!cond) process.exitCode = 1;
}

async function main() {
  const adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);

  // Make sure the lock is OFF so the "allowed when unlocked" baseline is real.
  const beforeLock = await setLock(adminToken, false);

  const member = await createUser(adminToken, { role: 'member' });
  const vendor = await createUser(adminToken, { role: 'vendor' });
  const memberToken = await login(member.email, member.password);
  const vendorToken = await login(vendor.email, vendor.password);

  // ---- Scenario 1: lock OFF, member can set a float number ------------------
  {
    const upd = await updateDetails(memberToken, { member_float_number: '5' });
    const prof = await getProfile(memberToken);
    assert('[lock OFF] member update persisted',
      upd.status === 200 && prof.member_float_number === '5',
      `status=${upd.status} member_float_number=${JSON.stringify(prof.member_float_number)}`);
  }

  // ---- Scenario 2: lock ON, member change is DROPPED + flagged --------------
  await setLock(adminToken, true);
  {
    const upd = await updateDetails(memberToken, { member_float_number: '9' }); // different value
    const prof = await getProfile(memberToken);
    assert('[lock ON] member change PREVENTED (value unchanged)',
      prof.member_float_number === '5',
      `member_float_number=${JSON.stringify(prof.member_float_number)} float_locked=${prof.float_locked}`);
    assert('[lock ON] response flags floatChangesIgnored (no more misleading 200)',
      upd.status === 200 && upd.data.floatChangesIgnored === true && upd.data.floatLocked === true,
      `status=${upd.status} body=${JSON.stringify(upd.data)}`);
  }

  // ---- Scenario 3: lock ON, vendor change is ALSO dropped + flagged --------
  {
    const upd = await updateDetails(vendorToken, { member_float_number: '9' });
    const prof = await getProfile(vendorToken);
    assert('[lock ON] vendor change PREVENTED (value unchanged)',
      prof.member_float_number === null || prof.member_float_number === '',
      `member_float_number=${JSON.stringify(prof.member_float_number)} float_locked=${prof.float_locked}`);
    assert('[lock ON] vendor response flags floatChangesIgnored',
      upd.data.floatChangesIgnored === true,
      `body=${JSON.stringify(upd.data)}`);
  }

  // ---- Scenario 4: lock ON, Float Admin can still change --------------------
  {
    const upd = await updateDetails(adminToken, { member_float_number: '7' });
    const prof = await getProfile(adminToken);
    assert('[lock ON] Float Admin change ALLOWED (no flag)',
      upd.status === 200 && prof.member_float_number === '7' && !('floatChangesIgnored' in upd.data),
      `status=${upd.status} member_float_number=${JSON.stringify(prof.member_float_number)}`);
  }

  // ---- Scenario 5: lock ON, member edits ONLY non-float field -> no flag ----
  {
    const upd = await updateDetails(memberToken, { phone: '555-0100' });
    const prof = await getProfile(memberToken);
    assert('[lock ON] non-float edit saved, no false float flag',
      prof.phone === '555-0100' && prof.member_float_number === '5' && !('floatChangesIgnored' in upd.data),
      `phone=${JSON.stringify(prof.phone)} member_float_number=${JSON.stringify(prof.member_float_number)} body=${JSON.stringify(upd.data)}`);
  }

  // ---- Cleanup ---------------------------------------------------------------
  await setLock(adminToken, false);
  await call('DELETE', `/api/admin/users/${member.id}`, { token: adminToken });
  await call('DELETE', `/api/admin/users/${vendor.id}`, { token: adminToken });
  console.log('\nCleanup done: deleted demo users and reset lock to false.');
  if (beforeLock === true) {
    console.log('WARNING: the lock was ON before this script ran; it has been reset to false. Set it back manually if needed.');
  }
}

main().catch((err) => { console.error('ERROR:', err.message); process.exit(1); });
