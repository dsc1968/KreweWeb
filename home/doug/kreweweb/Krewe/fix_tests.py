import io, sys

path = "backend/mfa_test.js"
with io.open(path, "r", encoding="utf-8") as f:
    src = f.read()

old1 = """  check('verify-code mfaEnrollmentRequired', r.status === 201 && j.mfaEnrollmentRequired === true);
  // Finish the required enrollment the same way the UI does: request the email
  // code (which stages the MFA challenge), then verify it. Registration does
  // not pre-create a challenge.
  r = await fetch(base + '/api/auth/mfa/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mfaToken: j.mfaToken, method: 'email' }) }); j = await r.json();
  check('enrollment mfa/send', r.status === 200 && j.mfaChallengeSent === true);
  const mc1 = await getCode(e1);
  r = await fetch(base + '/api/auth/mfa/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mfaToken: j.mfaToken, code: mc1 }) }); j = await r.json();
  check('mfa/verify enroll', r.status === 200 && j.token && j.mfaEnrolled === true); const mem1 = j.token;"""
new1 = """  // Registration now completes with a single email verification code, which
  // doubles as email MFA enrollment - no second MFA code is sent.
  check('verify-code enrolls MFA and logs in', r.status === 201 && j.token && j.mfaEnrolled === true); const mem1 = j.token;"""

old2 = """  r = await fetch(base + '/api/auth/register/verify-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e2, code: ec2 }) }); j = await r.json();
  // Registration now always defaults new members to email MFA, ignoring any client-sent mfa_method.
  const su = (await pool.query('SELECT mfa_method FROM users WHERE email=$1', [e2])).rows[0];
  check('user.mfa_method=email', su && su.mfa_method === 'email', 'got=' + (su && su.mfa_method));
  // Finish required enrollment via email first (stages a challenge), then the
  // supported path is to switch to SMS later from the profile.
  r = await fetch(base + '/api/auth/mfa/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mfaToken: j.mfaToken, method: 'email' }) }); j = await r.json();
  check('enrollment mfa/send', r.status === 200 && j.mfaChallengeSent === true);
  const mc2 = await getCode(e2);
  r = await fetch(base + '/api/auth/mfa/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mfaToken: j.mfaToken, code: mc2 }) }); j = await r.json();
  check('register mfa/verify email', r.status === 200 && j.token);
  const e2Token = j.token;"""
new2 = """  r = await fetch(base + '/api/auth/register/verify-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e2, code: ec2 }) }); j = await r.json();
  // Registration now completes with a single email verification code, which
  // doubles as email MFA enrollment - no second MFA code is sent.
  check('register logs in with email MFA', r.status === 201 && j.token && j.mfaEnrolled === true);
  // New members always default to email MFA, ignoring any client-sent mfa_method.
  const su = (await pool.query('SELECT mfa_method FROM users WHERE email=$1', [e2])).rows[0];
  check('user.mfa_method=email', su && su.mfa_method === 'email', 'got=' + (su && su.mfa_method));
  const e2Token = j.token;"""

old3 = """  check('authenticator: registration requires enrollment', r.status === 201 && j.mfaEnrollmentRequired === true && !!j.mfaToken);
  // Enroll the authenticator app using the enrollment mfaToken (not a login token).
  r = await fetch(base + '/api/auth/mfa/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mfaToken: j.mfaToken, method: 'authenticator' }) }); j = await r.json();
  check('authenticator: enrollment provisioning', r.status === 200 && j.method === 'authenticator' && !!j.secret, 'method=' + j.method);
  const secret3 = j.secret;
  r = await fetch(base + '/api/auth/mfa/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mfaToken: j.mfaToken, code: totpForTest(secret3) }) }); j = await r.json();
  check('authenticator: verify enroll', r.status === 200 && (j.token || j.mfaEnrolled), JSON.stringify(j).slice(0, 80));
  const mem3 = j.token;"""
new3 = """  // Registration now completes with the single email verification code (email MFA
  // enrolled). The member can still enroll an authenticator app afterward.
  check('authenticator: registration logs in with MFA', r.status === 201 && j.token && j.mfaEnrolled === true); const mem3 = j.token;
  // Enroll the authenticator app via the profile MFA endpoint (auth required).
  r = await fetch(base + '/api/profile/mfa', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + mem3 }, body: JSON.stringify({ method: 'authenticator' }) }); j = await r.json();
  check('authenticator: enrollment provisioning', r.status === 200 && j.method === 'authenticator' && !!j.secret, 'method=' + j.method);
  const secret3 = j.secret;
  r = await fetch(base + '/api/auth/mfa/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mfaToken: j.mfaToken, code: totpForTest(secret3) }) }); j = await r.json();
  check('authenticator: verify enroll', r.status === 200 && j.token && j.mfaEnrolled === true, JSON.stringify(j).slice(0, 80));"""

for name, old, new in (("e1", old1, new1), ("e2", old2, new2), ("e3", old3, new3)):
    c = src.count(old)
    if c != 1:
        print("FAIL", name, "occurrences:", c)
        sys.exit(1)
    src = src.replace(old, new, 1)
    print("OK", name)

with io.open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("ALL DONE")
