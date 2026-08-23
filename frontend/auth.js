async function postJSON(url, data) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

async function parseJSONResponse(res) {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json();
  const text = await res.text();
  return { error: text.trim() || 'Unexpected server response' };
}

function getToken() {
  return sessionStorage.getItem('krewe_token');
}

// The effective role set for a profile object. Prefers the multi-role `roles`
// array, falling back to the legacy single `role`. A full `admin` satisfies any
// capability check.
function profileRoles(profile) {
  if (!profile) return [];
  if (Array.isArray(profile.roles) && profile.roles.length) return profile.roles;
  return profile.role ? [profile.role] : [];
}
function profileHasRole(profile, role) {
  const roles = profileRoles(profile);
  if (role !== 'admin' && roles.includes('admin')) return true;
  return roles.includes(role);
}

function isEditPreviewMode() {
  return new URLSearchParams(window.location.search).get('edit') === '1';
}

// Formats a phone number entry as (###) - ###-#### as the user types.
function formatPhoneNumber(value) {
  const digits = String(value == null ? '' : value).replace(/\D/g, '').slice(0, 10);
  if (digits.length === 0) return '';
  if (digits.length < 4) return '(' + digits;
  if (digits.length < 7) return '(' + digits.slice(0, 3) + ') - ' + digits.slice(3);
  return '(' + digits.slice(0, 3) + ') - ' + digits.slice(3, 6) + '-' + digits.slice(6);
}

// Wires live (###) - ###-#### formatting onto a phone input, formatting any
// existing value immediately.
function attachPhoneFormatter(input) {
  if (!input || input.dataset.phoneFmt) return;
  input.dataset.phoneFmt = '1';
  const apply = () => { input.value = formatPhoneNumber(input.value); };
  input.addEventListener('input', apply);
  input.addEventListener('blur', apply);
  if (input.value) apply();
}

// Persists the optional profile fields collected on the registration form.
// Used by both the verification step and the MFA enrollment step so a newly
// created account keeps its phone/address/etc. regardless of which path wins.
async function saveRegistrationProfile(token) {
  const regProfile = {
    phone:        (document.getElementById('reg-phone')?.value || '').trim(),
    birthdate:    document.getElementById('reg-birthdate')?.value || null,
    occupation:   (document.getElementById('reg-occupation')?.value || '').trim(),
    sponsor_name: (document.getElementById('reg-sponsor')?.value || '').trim(),
    address:      (document.getElementById('reg-address')?.value || '').trim(),
    city:         (document.getElementById('reg-city')?.value || '').trim(),
    state:        (document.getElementById('reg-state')?.value || '').trim().toUpperCase(),
    zip:          (document.getElementById('reg-zip')?.value || '').trim(),
    kids_names: [], kids_birthdays: [],
    grandchildren_names: [], grandchildren_birthdays: [],
    float_riders: [], rider_float_names: [], rider_float_numbers: [],
  };
  const hasData = Object.values(regProfile).some(v => v && (typeof v === 'string' ? v.length > 0 : true));
  if (!hasData) return;
  await fetch('/api/profile/details', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(regProfile),
  }).catch(() => {});
}

// Renders the MFA prompt copy. `info` may carry maskedTarget, notice and/or a
// devCode (surfaced by the server only in non-production environments).
function setMfaPrompt(promptEl, info) {
  if (!promptEl || !info) return;
  // For the authenticator-app method there is nothing to "send" — the user
  // simply opens their app and reads the rolling code.
  if (info.method === 'authenticator') {
    promptEl.textContent = 'Enter the 6-digit code from your authenticator app.';
    return;
  }
  const parts = [];
  if (info.maskedTarget) parts.push(`We sent a two-factor (MFA) sign-in code to ${info.maskedTarget}.`);
  if (info.notice) parts.push(info.notice);
  if (info.devCode) parts.push(`Dev code: ${info.devCode}`);
  promptEl.textContent = parts.join(' ').trim() || 'Enter the verification code.';
}

// Renders the authenticator-app provisioning UI (QR + manual key) into a
// container element. Falls back to a copyable key when no QR image is returned.
function renderOtpSetup(container, info) {
  if (!container) return;
  const qr = info && info.qr
    ? `<img src="${info.qr}" alt="Authenticator QR code" style="width:200px;height:200px;border:1px solid #ddd;border-radius:8px;" />`
    : '';
  const secret = (info && info.secret) || '';
  container.innerHTML = `
    <p class="field-hint">Scan this QR code with your authenticator app (Google or Microsoft Authenticator), then enter the 6-digit code below.</p>
    <div style="margin:0.5rem 0;">${qr}</div>
    <p class="field-hint">Or enter this setup key manually: <code>${secret}</code></p>
  `;
}

// Register form
const registerForm = document.getElementById('register-form');
if (registerForm) {
  if (getToken() && !isEditPreviewMode()) {
    window.location.href = '/dashboard.html';
  }
  attachPhoneFormatter(document.getElementById('reg-phone'));
  const submitButton = document.getElementById('register-submit-button');
  const feedback = document.getElementById('register-feedback');
  const verificationCodeGroup = document.getElementById('verification-code-group');
  const verificationCodeInput = document.getElementById('verification_code');
  const resendButton = document.getElementById('resend-code-button');
  const mfaCodeGroup = document.getElementById('mfa-code-group');
  const mfaCodeInput = document.getElementById('mfa_code');
  const mfaPrompt = document.getElementById('mfa-prompt');
  const mfaResendButton = document.getElementById('mfa-resend-button');
  const mfaMethodSwitch = document.getElementById('mfa-method-switch');
  let registerMfaToken = null;
  let registerMfaMethod = 'email';
  let registrationRequiresMfa = true; // default to the verification flow until policy is known
  let smsAvailable = true; // whether SMS MFA is offered (SMS gateway configured)

  // Reflect the site MFA policy on the registration button: when members don't
  // need MFA the form is a single "Register" action; otherwise it starts the
  // email-verification (and possibly MFA) code flow.
  (async () => {
    try {
      const policyRes = await fetch('/api/mfa-policy');
      if (policyRes.ok) {
        const policy = await policyRes.json();
        registrationRequiresMfa = !!policy.registrationRequiresMfa;
        smsAvailable = Array.isArray(policy.availableMethods)
          ? policy.availableMethods.includes('sms')
          : true;
      }
    } catch (_policyErr) { /* keep default (verification flow) */ }
    if (submitButton) {
      submitButton.textContent = registrationRequiresMfa ? 'Send verification code' : 'Register';
    }
  })();

  function setRegisterFeedback(message, isError) {
    if (!feedback) return;
    feedback.textContent = message;
    feedback.style.color = isError ? '#b42318' : '';
  }

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    // register.html submits via its own inline handler to /api/join-request
    // (the pending-approval, vendor-capable endpoint) and has no password
    // field. When this is that form, let the inline handler own submission so
    // we don't double-POST from two competing listeners.
    if (!document.getElementById('password')) return;
    const full_name = document.getElementById('full_name').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password')?.value || '';
    const phone = (document.getElementById('reg-phone')?.value || '').trim();

    submitButton.disabled = true;
    setRegisterFeedback('', false);
    try {
      if (registerForm.dataset.phase === 'mfa') {
        const code = mfaCodeInput.value.trim();
        const resp = await postJSON('/api/auth/mfa/verify', { mfaToken: registerMfaToken, code });
        if (resp.token) {
          sessionStorage.setItem('krewe_token', resp.token);
          await saveRegistrationProfile(resp.token);
          window.location.href = '/dashboard.html';
          return;
        }
        setRegisterFeedback(resp.error || 'Invalid code', true);
        return;
      }

      if (registerForm.dataset.phase === 'verify') {
        const code = verificationCodeInput.value.trim();
        const resp = await postJSON('/api/auth/register/verify-code', { email, code });
        if (resp.token) {
          sessionStorage.setItem('krewe_token', resp.token);
          await saveRegistrationProfile(resp.token);
          window.location.href = '/dashboard.html';
          return;
        }


        setRegisterFeedback(resp.error || 'Verification failed', true);
        return;
      }

      if (!registrationRequiresMfa) {
        const resp = await postJSON('/api/auth/register', { full_name, email, password, phone });
        if (resp.token) {
          sessionStorage.setItem('krewe_token', resp.token);
          await saveRegistrationProfile(resp.token);
          window.location.href = '/dashboard.html';
          return;
        }
        setRegisterFeedback(resp.error || 'Unable to create account', true);
        return;
      }

      const resp = await postJSON('/api/auth/register/request-code', {
        full_name,
        email,
        password,
        phone,
      });

      if (!resp.verificationRequired) {
        setRegisterFeedback(resp.error || 'Unable to send verification code', true);
        return;
      }

      registerForm.dataset.phase = 'verify';
      verificationCodeGroup.hidden = false;
      verificationCodeInput.required = true;
      verificationCodeInput.focus();
      if (resendButton) resendButton.hidden = false;
      submitButton.textContent = 'Verify and create account';

      setRegisterFeedback(resp.message || 'Verification code sent.', false);
    } finally {
      submitButton.disabled = false;
    }
  });

  if (resendButton) {
    resendButton.addEventListener('click', async () => {
      const full_name = document.getElementById('full_name').value.trim();
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;
      const phone = (document.getElementById('reg-phone')?.value || '').trim();
      resendButton.disabled = true;
      setRegisterFeedback('Sending new code…', false);
      try {
        const resp = await postJSON('/api/auth/register/request-code', { full_name, email, password, phone });
        verificationCodeInput.value = '';
        verificationCodeInput.focus();
        setRegisterFeedback(resp.error ? (resp.error) : (resp.message || 'New verification code sent.'), Boolean(resp.error));
      } finally {
        resendButton.disabled = false;
      }
    });
  }

}

// Login form
const loginForm = document.getElementById('login-form');
if (loginForm) {
  if (getToken() && !isEditPreviewMode()) {
    window.location.href = '/dashboard.html';
  }

  // Whether the SMS sign-in option is offered depends on the SMS gateway
  // being configured. Read it from the public MFA policy so we can hide
  // the "Text me a code" button when SMS is unavailable.
  let smsAvailable = true;
  (async () => {
    try {
      const policyRes = await fetch('/api/mfa-policy');
      if (policyRes.ok) {
        const policy = await policyRes.json();
        smsAvailable = Array.isArray(policy.availableMethods)
          ? policy.availableMethods.includes('sms')
          : true;
      }
    } catch (_policyErr) { /* assume SMS available; backend corrects if not */ }
  })();

  const mfaCodeGroup = document.getElementById('mfa-code-group');
  const mfaCodeInput = document.getElementById('mfa_code');
  const mfaPrompt = document.getElementById('mfa-prompt');
  const mfaResendButton = document.getElementById('mfa-resend-button');
  const mfaMethodSwitch = document.getElementById('mfa-method-switch');
  const loginSubmitButton = loginForm.querySelector('button[type="submit"]');
  let loginMfaToken = null;
  let loginMfaMethod = 'email';

  function showLoginMfa(info) {
    loginMfaToken = info.mfaToken;
    loginMfaMethod = info.method || 'email';
    if (mfaCodeGroup) mfaCodeGroup.hidden = false;
    setMfaPrompt(mfaPrompt, info);
    if (mfaCodeInput) { mfaCodeInput.value = ''; mfaCodeInput.focus(); }
    if (mfaResendButton) mfaResendButton.hidden = (loginMfaMethod === 'authenticator');
    if (mfaMethodSwitch) {
      mfaMethodSwitch.hidden = false;
      // Hide the SMS choice entirely when the gateway isn't configured.
      const smsBtn = mfaMethodSwitch.querySelector('button[data-mfa-method="sms"]');
      if (smsBtn) smsBtn.style.display = smsAvailable ? '' : 'none';
    }
    if (loginSubmitButton) loginSubmitButton.textContent = 'Verify code';
    loginForm.dataset.phase = 'mfa';
  }

  async function sendLoginMfa(method) {
    // Never attempt SMS when it isn't offered by the site.
    if (method === 'sms' && !smsAvailable) method = 'email';
    if (mfaResendButton) mfaResendButton.disabled = true;
    if (mfaPrompt) mfaPrompt.textContent = 'Sending a new code…';
    try {
      const resp = await postJSON('/api/auth/mfa/send', { mfaToken: loginMfaToken, method });
      if (resp.mfaChallengeSent) {
        loginMfaToken = resp.mfaToken;
        loginMfaMethod = resp.method || method;
        setMfaPrompt(mfaPrompt, resp);
        if (mfaCodeInput) { mfaCodeInput.value = ''; mfaCodeInput.focus(); }
      } else {
        setMfaPrompt(mfaPrompt, { notice: resp.error || 'Unable to send code' });
      }
    } finally {
      if (mfaResendButton) mfaResendButton.disabled = false;
    }
  }

  if (mfaMethodSwitch) {
    mfaMethodSwitch.querySelectorAll('button[data-mfa-method]').forEach((btn) => {
      btn.addEventListener('click', () => sendLoginMfa(btn.dataset.mfaMethod));
    });
  }

  if (mfaResendButton) {
    mfaResendButton.addEventListener('click', () => sendLoginMfa(loginMfaMethod));
  }

  async function submitLoginMfa() {
    const code = (mfaCodeInput && mfaCodeInput.value.trim()) || '';
    const resp = await postJSON('/api/auth/mfa/verify', { mfaToken: loginMfaToken, code });
    if (resp.token) {
      sessionStorage.setItem('krewe_token', resp.token);
      window.location.href = '/dashboard.html';
      return;
    }
    setMfaPrompt(mfaPrompt, { notice: resp.error || 'Invalid code' });
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (loginForm.dataset.phase === 'mfa') {
      await submitLoginMfa();
      return;
    }
    const email = document.getElementById('login_email').value.trim();
    const password = document.getElementById('login_password').value;
    const resp = await postJSON('/api/auth/login', { email, password });
    if (resp.token) {
      sessionStorage.setItem('krewe_token', resp.token);
      window.location.href = '/dashboard.html';
    } else if (resp.mfaRequired || resp.mfaEnrollmentRequired) {
      showLoginMfa(resp);
    } else {
      alert(resp.error || 'Login failed');
    }
  });
}

// Dashboard
async function fetchProfile() {
  const token = sessionStorage.getItem('krewe_token');
  if (!token) return null;
  const res = await fetch('/api/profile', { headers: { Authorization: 'Bearer ' + token } });
  if (res.ok) return parseJSONResponse(res);
  return null;
}

async function fetchAdminUsers() {
  const token = getToken();
  const endpoints = ['/api/admin/users', '/api/users'];

  for (const endpoint of endpoints) {
    const res = await fetch(endpoint, {
      headers: { Authorization: 'Bearer ' + token },
    });
    const data = await parseJSONResponse(res);

    if (res.ok) {
      return { ok: true, data };
    }

    if (res.status !== 404) {
      return { ok: false, data };
    }
  }

  return {
    ok: false,
    data: { error: 'User management routes are unavailable. Restart the server so the latest API routes are loaded.' },
  };
}

async function updateUserRole(userId, role) {
  const token = getToken();
  const endpoints = [`/api/admin/users/${userId}/role`, `/api/users/${userId}/role`];

  for (const endpoint of endpoints) {
    const res = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify({ role }),
    });
    const data = await parseJSONResponse(res);

    if (res.ok) {
      return { ok: true, data };
    }

    if (res.status !== 404) {
      return { ok: false, data };
    }
  }

  return {
    ok: false,
    data: { error: 'Role update routes are unavailable. Restart the server so the latest API routes are loaded.' },
  };
}

async function setUserDisabled(userId, disabled, previousRole) {
  const token = getToken();
  const restoreRole = (!disabled && ['member', 'store_admin', 'admin'].includes(previousRole))
    ? previousRole : 'member';
  const endpoints = [`/api/admin/users/${userId}/disable`, `/api/users/${userId}/disable`];

  for (const endpoint of endpoints) {
    const res = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify({ disabled, restore_role: restoreRole }),
    });
    const data = await parseJSONResponse(res);

    if (res.ok) {
      return { ok: true, data };
    }

    if (res.status !== 404) {
      return { ok: false, data };
    }
  }

  return {
    ok: false,
    data: { error: 'Disable route is unavailable. Restart the server so the latest API routes are loaded.' },
  };
}

async function deleteUser(userId) {
  const token = getToken();
  const endpoints = [`/api/admin/users/${userId}`, `/api/users/${userId}`];

  for (const endpoint of endpoints) {
    const res = await fetch(endpoint, {
      method: 'DELETE',
      headers: {
        Authorization: 'Bearer ' + token,
      },
    });
    const data = await parseJSONResponse(res);

    if (res.ok) {
      return { ok: true, data };
    }

    if (res.status !== 404) {
      return { ok: false, data };
    }
  }

  return {
    ok: false,
    data: { error: 'Delete route is unavailable. Restart the server so the latest API routes are loaded.' },
  };
}

async function resetUserPassword(userId, password) {
  const token = getToken();
  const endpoints = [`/api/admin/users/${userId}/password`, `/api/users/${userId}/password`];

  for (const endpoint of endpoints) {
    const res = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify({ password }),
    });
    const data = await parseJSONResponse(res);

    if (res.ok) {
      return { ok: true, data };
    }

    if (res.status !== 404) {
      return { ok: false, data };
    }
  }

  return {
    ok: false,
    data: { error: 'Password reset route is unavailable. Restart the server so the latest API routes are loaded.' },
  };
}

async function createUser(payload) {
  const token = getToken();
  const endpoints = ['/api/admin/users', '/api/users'];

  for (const endpoint of endpoints) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify(payload),
    });
    const data = await parseJSONResponse(res);

    if (res.ok) {
      return { ok: true, data };
    }

    if (res.status !== 404) {
      return { ok: false, data };
    }
  }

  return {
    ok: false,
    data: { error: 'Create user route is unavailable. Restart the server so the latest API routes are loaded.' },
  };
}

function setAdminFeedback(message, isError) {
  const feedback = document.getElementById('admin-user-feedback');
  if (!feedback) return;
  feedback.textContent = message || '';
  feedback.style.color = isError ? '#ff9b9b' : 'var(--muted)';
}

function getFilteredUsers(users, filterValue) {
  if (filterValue === 'all') return users;
  if (filterValue === 'member') return users.filter((user) => user.role === 'member' || user.role === 'store_admin');
  return users.filter((user) => user.role === filterValue);
}

function updateAdminSummary(users) {
  const summary = document.getElementById('admin-user-summary');
  if (!summary) return;

  const memberCount    = users.filter((user) => user.role === 'member').length;
  const storeAdminCount = users.filter((user) => user.role === 'store_admin').length;
  const vendorCount    = users.filter((user) => user.role === 'vendor').length;
  const adminCount     = users.filter((user) => user.role === 'admin').length;
  const disabledCount  = users.filter((user) => user.role === 'disabled').length;
  const guestCount     = users.filter((user) => user.role === 'guest').length;
  const totalCount     = users.length;
  const storeAdminPart = storeAdminCount > 0 ? `, ${storeAdminCount} store admin${storeAdminCount === 1 ? '' : 's'}` : '';
  const vendorPart     = vendorCount > 0 ? `, ${vendorCount} vendor${vendorCount === 1 ? '' : 's'}` : '';
  summary.textContent = `${memberCount} member${memberCount === 1 ? '' : 's'}${storeAdminPart}${vendorPart}, ${adminCount} admin${adminCount === 1 ? '' : 's'}, ${guestCount} guest${guestCount === 1 ? '' : 's'}, ${disabledCount} disabled, ${totalCount} total`;
}

async function openUserEditModal(user, currentUserId, onUpdate) {
  const token = getToken();

  // Load full profile
  const res = await fetch(`/api/admin/users/${user.id}`, { headers: { Authorization: 'Bearer ' + token } });
  const data = await parseJSONResponse(res);
  if (!res.ok) { alert(data.error || 'Unable to load user details'); return; }
  const full = data;

  // Decompose the user's role set into a single base status plus additive admin
  // capabilities for the edit form. `admin` implies every capability.
  const uemRoleSet = new Set(Array.isArray(full.roles) && full.roles.length ? full.roles : [full.role]);
  const uemBaseStatus = uemRoleSet.has('disabled') ? 'disabled'
    : uemRoleSet.has('admin') ? 'admin'
    : uemRoleSet.has('vendor') ? 'vendor'
    : uemRoleSet.has('guest') ? 'guest'
    : 'member';
  const uemHasStore = uemRoleSet.has('store_admin');
  const uemHasFloat = uemRoleSet.has('float_admin');
  const uemHasFinance = uemRoleSet.has('finance_admin');

  // Lock state for the current admin (mirrors the dashboard/profile lock UX).
  // `profile` is not in scope here, so read it from the current user's profile.
  let uemFloatsLocked = false;
  let uemIsFloatAdmin = false;
  try {
    const profRes = await fetch('/api/profile', { headers: { Authorization: 'Bearer ' + token } });
    if (profRes.ok) {
      const prof = await parseJSONResponse(profRes);
      uemFloatsLocked = Boolean(prof.float_locked);
      const profRoles = Array.isArray(prof.roles) && prof.roles.length ? prof.roles : [prof.role];
      uemIsFloatAdmin = profRoles.includes('admin') || profRoles.includes('float_admin');
    }
  } catch (_e) { /* default to unlocked if the lookup fails */ }

  // Load floats BEFORE building the modal so every button handler (Save, etc.)
  // is wired synchronously once the modal is in the DOM. Fetching after the
  // modal is shown left a window where clicking Save did nothing.
  let adminFloats = [];
  try {
    const afRes = await fetch('/api/floats', { headers: { Authorization: 'Bearer ' + getToken() } });
    if (afRes.ok) adminFloats = await afRes.json();
  } catch { /* floats list empty; selects fall back to "No float" */ }

  // Build modal backdrop
  const existing = document.getElementById('admin-user-edit-modal');
  if (existing) existing.remove();

  const backdrop = document.createElement('div');
  backdrop.id = 'admin-user-edit-modal';
  backdrop.style.cssText = 'position:fixed;inset:0;z-index:11000;display:flex;align-items:flex-start;justify-content:center;padding:1rem;background:rgba(2,8,22,0.8);overflow-y:auto;';

  backdrop.innerHTML = `
    <div style="width:min(780px,100%);max-height:calc(100vh - 2rem);overflow-y:auto;margin:auto 0;background:#08102a;border:1px solid rgba(255,210,98,0.28);border-radius:20px;padding:1.5rem;box-shadow:0 24px 60px rgba(0,0,0,0.4);color:#f5f7ff;" role="dialog" aria-modal="true" aria-labelledby="uem-title">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">
        <h2 id="uem-title" style="margin:0;font-size:1.05rem;">Edit: ${escHtml(full.full_name)}</h2>
        <button type="button" id="uem-close" style="background:none;border:none;color:#b8c4e0;font-size:1.4rem;cursor:pointer;line-height:1;" aria-label="Close">&times;</button>
      </div>

      <!-- Tab nav -->
      <div class="uem-tabs">
        <button type="button" class="uem-tab-btn is-active" data-uem-tab="personal">Personal</button>
        <button type="button" class="uem-tab-btn" data-uem-tab="floats">Float &amp; Riders</button>
        <button type="button" class="uem-tab-btn" data-uem-tab="payment">Payments</button>
        <button type="button" class="uem-tab-btn" data-uem-tab="orders">Orders</button>
        <button type="button" class="uem-tab-btn" data-uem-tab="security">Security</button>
      </div>

      <!-- Panel: Personal -->
      <div class="uem-panel is-active" data-uem-panel="personal">
        <div class="uem-grid-2">
          <div class="form-group"><label style="font-size:0.8rem;color:#b8c4e0;display:block;margin-bottom:0.3rem;">Full Name</label>
            <input id="uem-name" type="text" value="${escHtml(full.full_name)}" style="width:100%;padding:0.65rem 0.9rem;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#f5f7ff;font:inherit;box-sizing:border-box;" /></div>
          <div class="form-group"><label style="font-size:0.8rem;color:#b8c4e0;display:block;margin-bottom:0.3rem;">Email</label>
            <input id="uem-email" type="email" value="${escHtml(full.email)}" style="width:100%;padding:0.65rem 0.9rem;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#f5f7ff;font:inherit;box-sizing:border-box;" /></div>
          <div class="form-group"><label style="font-size:0.8rem;color:#b8c4e0;display:block;margin-bottom:0.3rem;">Base Status</label>
            <select id="uem-role" ${user.id === currentUserId ? 'disabled' : ''} style="width:100%;padding:0.65rem 0.9rem;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:#12203f;color:#f5f7ff;font:inherit;box-sizing:border-box;">
              <option value="member" ${uemBaseStatus==='member'?'selected':''}>Member</option>
              <option value="vendor" ${uemBaseStatus==='vendor'?'selected':''}>Vendor</option>
              <option value="guest" ${uemBaseStatus==='guest'?'selected':''}>Guest</option>
              <option value="admin" ${uemBaseStatus==='admin'?'selected':''}>Admin (all access)</option>
              ${uemBaseStatus==='disabled'?'<option value="disabled" selected>Disabled</option>':''}
            </select></div>
          <div class="form-group" id="uem-caps-group"><label style="font-size:0.8rem;color:#b8c4e0;display:block;margin-bottom:0.3rem;">Admin Capabilities</label>
            <div id="uem-caps" style="display:flex;flex-direction:column;gap:0.35rem;padding:0.15rem 0;">
              <label style="display:flex;align-items:center;gap:0.5rem;font-size:0.88rem;color:#f5f7ff;font-weight:500;"><input type="checkbox" id="uem-cap-store" ${uemHasStore?'checked':''} ${user.id === currentUserId ? 'disabled' : ''} style="width:1rem;height:1rem;accent-color:#ffd262;" /> Store Admin</label>
              <label style="display:flex;align-items:center;gap:0.5rem;font-size:0.88rem;color:#f5f7ff;font-weight:500;"><input type="checkbox" id="uem-cap-float" ${uemHasFloat?'checked':''} ${user.id === currentUserId ? 'disabled' : ''} style="width:1rem;height:1rem;accent-color:#ffd262;" /> Float Admin</label>
              <label style="display:flex;align-items:center;gap:0.5rem;font-size:0.88rem;color:#f5f7ff;font-weight:500;"><input type="checkbox" id="uem-cap-finance" ${uemHasFinance?'checked':''} ${user.id === currentUserId ? 'disabled' : ''} style="width:1rem;height:1rem;accent-color:#ffd262;" /> Finance Admin</label>
            </div>
            <p style="font-size:0.72rem;color:#8ea0c4;margin:0.35rem 0 0;">Capabilities apply to Members. Admin already includes all; Guests and Disabled accounts have none.</p>
          </div>
          <div class="form-group"><label style="font-size:0.8rem;color:#b8c4e0;display:block;margin-bottom:0.3rem;">Phone</label>
            <input id="uem-phone" type="tel" value="${escHtml(full.phone||'')}" placeholder="555-867-5309" style="width:100%;padding:0.65rem 0.9rem;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#f5f7ff;font:inherit;box-sizing:border-box;" /></div>
          <div class="form-group" style="grid-column:1/-1;"><label style="font-size:0.8rem;color:#b8c4e0;display:block;margin-bottom:0.3rem;">Home Address</label>
            <input id="uem-address" type="text" value="${escHtml(full.address||'')}" placeholder="123 Main St, New Orleans, LA 70130" style="width:100%;padding:0.65rem 0.9rem;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#f5f7ff;font:inherit;box-sizing:border-box;" /></div>
          <div class="form-group"><label style="font-size:0.8rem;color:#b8c4e0;display:block;margin-bottom:0.3rem;">Spouse / Partner</label>
            <input id="uem-spouse" type="text" value="${escHtml(full.spouse_name||'')}" style="width:100%;padding:0.65rem 0.9rem;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#f5f7ff;font:inherit;box-sizing:border-box;" /></div>
          <div class="form-group"><label style="font-size:0.8rem;color:#b8c4e0;display:block;margin-bottom:0.3rem;">Guest Name</label>
            <input id="uem-guest" type="text" value="${escHtml(full.guest_name||'')}" style="width:100%;padding:0.65rem 0.9rem;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#f5f7ff;font:inherit;box-sizing:border-box;" /></div>
        </div>
      </div>

      <!-- Panel: Float & Riders -->
      <div class="uem-panel" data-uem-panel="floats">

        <div class="form-group" style="margin-bottom:0.75rem;">
          <label style="display:flex;align-items:center;gap:0.6rem;font-size:0.9rem;font-weight:600;padding:0.7rem 1rem;border-radius:10px;border:1px solid rgba(255,210,98,0.2);background:rgba(255,210,98,0.06);">
            <input type="checkbox" id="uem-float-captain" ${full.captain_of ? 'checked' : ''} disabled style="width:1.1rem;height:1.1rem;accent-color:#ffd262;opacity:0.85;" />
            Float Captain
            ${full.captain_of ? `<span style="margin-left:0.7rem;color:#ffffff;font-weight:500;">Captain of Float #${escHtml(full.captain_of.float_number || '?')} – ${escHtml(full.captain_of.name || 'Unnamed')}</span>` : ''}
          </label>
        </div>
        <div class="form-group">
          <label style="font-size:0.78rem;color:#b8c4e0;display:block;margin-bottom:0.3rem;">Float Riders <span style="font-weight:400;text-transform:none;letter-spacing:0;">(Rider Name, Assigned Float &amp; Comment)</span></label>
          <div id="uem-riders"></div>
          <button type="button" id="uem-add-rider" style="margin-top:0.4rem;padding:0.3rem 0.7rem;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:#b8c4e0;font:inherit;font-size:0.82rem;cursor:pointer;">+ Add Rider</button>
          <div id="uem-float-lock-note" style="display:none;background:rgba(255,98,98,0.12);border:1px solid rgba(255,98,98,0.45);color:#ffb3b3;padding:0.5rem 0.8rem;border-radius:10px;margin-top:0.5rem;font-size:0.85rem;">
            Floats are locked — only the Float Admin can change float assignments.
          </div>
        </div>
      </div>

      <!-- Panel: Payment -->
      <div class="uem-panel" data-uem-panel="payment">
        <p style="font-size:0.78rem;color:#b8c4e0;margin:0 0 0.65rem;">Toggle items paid for this member:</p>
        <div style="display:flex;flex-direction:column;gap:0.55rem;padding:0.25rem 0;">
          ${[['uem-dues-paid', 'Dues', full.dues_paid], ['uem-guest-fee-paid', 'Guest Fee', full.guest_fee_paid], ['uem-costume-paid', 'Costume', full.costume_paid]].map(([id, lbl, chk]) => {
            const paid = !!chk;
            const rowBg  = paid ? 'rgba(74,222,128,0.08)'  : 'rgba(248,113,113,0.08)';
            const rowBdr = paid ? 'rgba(74,222,128,0.3)'   : 'rgba(248,113,113,0.3)';
            const pillBg = paid ? 'rgba(74,222,128,0.12)'  : 'rgba(248,113,113,0.12)';
            const pillC  = paid ? '#4ade80' : '#f87171';
            const pillTx = paid ? 'Paid' : 'Unpaid';
            return `<label data-uem-pay-row style="display:flex;align-items:center;gap:0.9rem;cursor:pointer;font-size:0.92rem;font-weight:600;padding:0.75rem 1rem;border-radius:12px;border:1px solid ${rowBdr};background:${rowBg};transition:background 0.15s,border-color 0.15s;">
              <input type="checkbox" id="${id}" ${chk?'checked':''} style="position:absolute;opacity:0;width:0;height:0;" />
              <span data-pay-icon style="width:1.6rem;height:1.6rem;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:${pillC};">
                <svg viewBox="0 0 24 24" style="width:1rem;height:1rem;" aria-hidden="true">${paid
                  ? '<path fill="#fff" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>'
                  : '<path fill="#fff" d="M18.3 5.71L12 12.01 5.7 5.71 4.29 7.12 10.59 13.42 4.29 19.72l1.41 1.41L12 14.83l6.3 6.3 1.41-1.41-6.3-6.3 6.3-6.3z"/>'
                }</svg>
              </span>
              <span style="flex:1;">${lbl}</span>
              <span data-pay-pill style="font-size:0.75rem;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;padding:0.18rem 0.65rem;border-radius:999px;border:1px solid ${pillC}4d;background:${pillBg};color:${pillC};">${pillTx}</span>
            </label>`;
          }).join('')}
        </div>
      </div>

      <!-- Panel: Orders -->
      <div class="uem-panel" data-uem-panel="orders">
        <div id="uem-orders-content">
          <p style="color:#b8c4e0;font-size:0.88rem;">Loading orders…</p>
        </div>
      </div>

      <!-- Panel: Security -->
      <div class="uem-panel" data-uem-panel="security">
        <p style="margin:0 0 0.65rem;font-size:0.85rem;color:#b8c4e0;">Reset this user's password:</p>
        <div style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap;">
          <input id="uem-password" type="password" placeholder="New password (min 8 chars)" autocomplete="new-password" style="flex:1;min-width:180px;padding:0.65rem 0.9rem;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#f5f7ff;font:inherit;" />
          <button type="button" id="uem-reset-pw" class="button secondary">Reset Password</button>
        </div>
        <div style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid rgba(255,255,255,0.08);">
          <p style="margin:0 0 0.5rem;font-size:0.85rem;color:#b8c4e0;">Multi-factor authentication (MFA) method:</p>
          <select id="uem-mfa-method" style="width:100%;padding:0.65rem 0.9rem;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:#12203f;color:#f5f7ff;font:inherit;box-sizing:border-box;">
            <option value="email" ${full.mfa_method==='email'?'selected':''}>Email</option>
            <option value="sms" ${full.mfa_method==='sms'?'selected':''}>Text message (SMS)</option>
            <option value="authenticator" ${full.mfa_method==='authenticator'?'selected':''}>Authenticator app</option>
            <option value="none" ${(!full.mfa_method || full.mfa_method==='none')?'selected':''}>None (MFA disabled)</option>
          </select>
          <p id="uem-mfa-note" style="font-size:0.78rem;color:#b8c4e0;margin:0.4rem 0 0;"></p>
        </div>
        <div style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid rgba(255,255,255,0.08);">
          <p style="margin:0 0 0.65rem;font-size:0.85rem;color:#b8c4e0;">Account status:</p>
          <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
            <button type="button" id="uem-toggle-disable" class="button secondary" ${user.id===currentUserId?'disabled':''}>${full.role==='disabled'?'Enable Account':'Disable Account'}</button>
            <button type="button" id="uem-delete" class="button secondary" style="border-color:rgba(255,155,155,0.45);color:#ff9b9b;" ${user.id===currentUserId?'disabled':''}>Delete User</button>
          </div>
        </div>
      </div>

      <!-- Always-visible footer -->
      <div style="margin-top:1.25rem;padding-top:1rem;border-top:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;gap:1rem;flex-wrap:wrap;">
        <button type="button" id="uem-save" class="button">Save Changes</button>
        <div id="uem-feedback" style="flex:1;min-height:1.2em;font-size:0.88rem;color:#b8c4e0;"></div>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);

  attachPhoneFormatter(backdrop.querySelector('#uem-phone'));

  // Wire the close controls first — before any await or DOM step below that
  // could throw — so the overlay can always be dismissed and never traps the
  // whole page in an unresponsive backdrop.
  function close() {
    document.removeEventListener('keydown', onModalKeydown);
    backdrop.remove();
  }
  function onModalKeydown(e) { if (e.key === 'Escape') close(); }
  const closeBtn = backdrop.querySelector('#uem-close');
  if (closeBtn) closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onModalKeydown);

  // Capability checkboxes only apply to Members. When the base status is Admin
  // (implies all), Guest or Disabled, the individual capabilities are locked.
  const uemRoleSel = backdrop.querySelector('#uem-role');
  const uemCapBoxes = ['uem-cap-store', 'uem-cap-float', 'uem-cap-finance'].map((id) => backdrop.querySelector('#' + id));
  function syncCapabilityState() {
    const isSelf = user.id === currentUserId;
    const base = full.role === 'disabled' ? 'disabled' : (uemRoleSel ? uemRoleSel.value : uemBaseStatus);
    const capsGroup = backdrop.querySelector('#uem-caps-group');
    if (capsGroup) capsGroup.style.opacity = base === 'member' ? '1' : '0.5';
    uemCapBoxes.forEach((box) => {
      if (!box) return;
      if (base === 'admin') { box.checked = true; box.disabled = true; }
      else if (base === 'guest' || base === 'disabled') { box.checked = false; box.disabled = true; }
      else { box.disabled = isSelf; }
    });
  }
  if (uemRoleSel) uemRoleSel.addEventListener('change', syncCapabilityState);
  syncCapabilityState();

  // Populate list inputs
  // Kids: Name | Float # | ×
  // Riders: Name | Float Name | Float # | ×
  function addListItem(containerId, name, comment, riderFloatId, isMember, floats) {
    const isRider = containerId === 'uem-riders';
    const container = backdrop.querySelector('#' + containerId);
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;gap:0.35rem;margin-bottom:0.4rem;align-items:center;flex-wrap:wrap;';

    // The member themselves appears in the rider list as a read-only row so the
    // admin sees them alongside the riders they sponsor. They carry no
    // .uem-list-name / .uem-list-comment classes, so they are never saved back
    // as a rider on submit.
    if (isMember) {
      wrapper.style.cssText += 'background:rgba(255,210,98,0.06);border-radius:8px;padding:0.25rem 0.4rem;';
      const tag = document.createElement('span');
      tag.textContent = name || '(member)';
      tag.style.cssText = 'flex:2;min-width:0;font-weight:600;color:#f5f7ff;';
      wrapper.appendChild(tag);
      const fl = (Array.isArray(floats) ? floats : []).find((f) => String(f.id) === String(riderFloatId));
      const flSpan = document.createElement('span');
      flSpan.textContent = fl ? `Float #${(fl.float_number || '?')} – ${fl.name || ''}`.trim() : '';
      flSpan.style.cssText = 'flex:2;min-width:0;color:#b8c4e0;font-size:0.82rem;';
      wrapper.appendChild(flSpan);
      const cm = document.createElement('span');
      cm.textContent = comment || '—';
      cm.style.cssText = 'flex:3;min-width:0;color:#b8c4e0;font-size:0.82rem;';
      wrapper.appendChild(cm);
      const badge = document.createElement('span');
      badge.textContent = 'Member';
      badge.style.cssText = 'flex-shrink:0;font-size:0.6rem;text-transform:uppercase;letter-spacing:0.05em;padding:0.12rem 0.45rem;border-radius:999px;border:1px solid rgba(255,210,98,0.4);color:#ffd262;';
      wrapper.appendChild(badge);
      wrapper.classList.add('uem-member-row');
      container.appendChild(wrapper);
      return;
    }

    const nameInp = document.createElement('input');
    nameInp.type = 'text';
    nameInp.value = name || '';
    nameInp.placeholder = 'Rider name';
    nameInp.className = 'uem-list-name';
    nameInp.style.cssText = 'flex:2;padding:0.55rem 0.7rem;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#f5f7ff;font:inherit;min-width:0;';
    wrapper.appendChild(nameInp);
    if (isRider) {
      const commentInp = document.createElement('input');
      commentInp.type = 'text';
      commentInp.value = comment || '';
      commentInp.placeholder = 'Comment';
      commentInp.className = 'uem-list-comment';
      commentInp.style.cssText = 'flex:3;padding:0.55rem 0.7rem;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#f5f7ff;font:inherit;min-width:0;';
      wrapper.appendChild(commentInp);
      // Editable float picker: a rider may be assigned to ANY float defined by
      // the float admin (Option B) — independent of the sponsoring member.
      const floatSel = document.createElement('select');
      floatSel.className = 'uem-list-float';
      floatSel.style.cssText = 'flex:2;min-width:120px;padding:0.55rem 0.7rem;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#f5f7ff;font:inherit;';
      const fl = Array.isArray(floats) ? floats : [];
      floatSel.innerHTML = '<option value="">No float</option>' + fl
        .map((f) => {
          const num = (f.float_number || '').toString().trim();
          const label = `Float #${escHtml(num || '?')} – ${escHtml(f.name || 'Unnamed')}`;
          const val = f.id != null ? String(f.id) : '';
          return `<option value="${escHtml(val)}"${String(val) === String(riderFloatId || '') ? ' selected' : ''}>${label}</option>`;
        }).join('');
      floatSel.value = String(riderFloatId || '');
      wrapper.appendChild(floatSel);
    }
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.textContent = '×';
    rm.style.cssText = 'padding:0.25rem 0.6rem;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:#b8c4e0;cursor:pointer;font:inherit;flex-shrink:0;';
    rm.addEventListener('click', () => wrapper.remove());
    wrapper.appendChild(rm);
    container.appendChild(wrapper);
  }

  // The member is shown in the rider list too (read-only). Sometimes a member
  // rides, sometimes they don't — either way they appear here like any entry.
  const assignedFloatLabel = (full.assigned_float && (full.assigned_float.name || full.assigned_float.float_number))
    ? `Float #${full.assigned_float.float_number || '?'} – ${full.assigned_float.name || ''}`.trim()
    : '';
  // Never let a bad rider row abort the rest of setup — otherwise the tab and
  // Save handlers below never wire and the backdrop traps the page.
  try {
    if (full.float_id) {
      addListItem('uem-riders', full.full_name, '', full.float_id, true, adminFloats);
    }

    (full.float_riders || []).forEach((r) => {
      const name = (r && typeof r === 'object') ? (r.name || '') : (typeof r === 'string' ? r : '');
      const comment = (r && typeof r === 'object') ? (r.comment || '') : '';
      addListItem('uem-riders', name, comment, (r && r.float_id) || '', false, adminFloats);
    });
  } catch (e) { console.error('Failed to render rider rows', e); }

  const uemAddRiderBtn = backdrop.querySelector('#uem-add-rider');
  if (uemAddRiderBtn) uemAddRiderBtn.addEventListener('click', () => addListItem('uem-riders', '', '', '', false, adminFloats));

  // When floats are locked, only the Float Admin may change float assignments.
  // Mirror the dashboard/profile lock UX: show a note and disable the rider
  // controls for everyone except the Float Admin.
  const uemCanEditFloats = !uemFloatsLocked || uemIsFloatAdmin;
  if (!uemCanEditFloats) {
    const ridersWrap = backdrop.querySelector('#uem-riders');
    if (ridersWrap) ridersWrap.querySelectorAll('input, select, button').forEach((el) => { el.disabled = true; });
    const addRiderBtn = backdrop.querySelector('#uem-add-rider');
    if (addRiderBtn) addRiderBtn.disabled = true;
    const note = backdrop.querySelector('#uem-float-lock-note');
    if (note) note.style.display = 'block';
  }

  const feedbackEl = backdrop.querySelector('#uem-feedback');
  function setFeedback(msg, isError) {
    feedbackEl.textContent = msg;
    feedbackEl.style.color = isError ? '#ff9b9b' : '#88d498';
  }

  // Payment rows — auto-save on every toggle so no "Save Changes" click is required
  const iconSvgPaid   = '<path fill="#fff" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>';
  const iconSvgUnpaid = '<path fill="#fff" d="M18.3 5.71L12 12.01 5.7 5.71 4.29 7.12 10.59 13.42 4.29 19.72l1.41 1.41L12 14.83l6.3 6.3 1.41-1.41-6.3-6.3 6.3-6.3z"/>';

  async function savePaymentStatus(changedRow) {
    const payload = {
      dues_paid:      backdrop.querySelector('#uem-dues-paid').checked,
      guest_fee_paid: backdrop.querySelector('#uem-guest-fee-paid').checked,
      costume_paid:   backdrop.querySelector('#uem-costume-paid').checked,
    };
    // Disable all payment rows while saving
    backdrop.querySelectorAll('[data-uem-pay-row] input').forEach(cb => cb.disabled = true);
    setFeedback('Saving payment status…', false);
    try {
      const r = await fetch(`/api/admin/users/${user.id}/payments`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(payload),
      });
      const d = await parseJSONResponse(r);
      if (r.ok) {
        setFeedback('✓ Payment status saved.', false);
        onUpdate({ ...user, ...payload });
      } else {
        setFeedback('⚠ ' + (d.error || 'Unable to save payment status.'), true);
        // Revert the visual toggle since save failed
        const cb = changedRow.querySelector('input[type="checkbox"]');
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('_revert'));
      }
    } catch {
      setFeedback('⚠ Network error — payment NOT saved. Is the server running?', true);
      // Revert
      const cb = changedRow.querySelector('input[type="checkbox"]');
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event('_revert'));
    } finally {
      backdrop.querySelectorAll('[data-uem-pay-row] input').forEach(cb => cb.disabled = false);
    }
  }

  backdrop.querySelectorAll('[data-uem-pay-row]').forEach((row) => {
    const cb   = row.querySelector('input[type="checkbox"]');
    const icon = row.querySelector('[data-pay-icon]');
    const pill = row.querySelector('[data-pay-pill]');

    function applyVisual(paid) {
      const pillC  = paid ? '#4ade80' : '#f87171';
      const pillBg = paid ? 'rgba(74,222,128,0.12)'  : 'rgba(248,113,113,0.12)';
      row.style.background    = paid ? 'rgba(74,222,128,0.08)'  : 'rgba(248,113,113,0.08)';
      row.style.borderColor   = paid ? 'rgba(74,222,128,0.3)'   : 'rgba(248,113,113,0.3)';
      icon.style.background   = pillC;
      icon.querySelector('svg').innerHTML = paid ? iconSvgPaid : iconSvgUnpaid;
      pill.style.color        = pillC;
      pill.style.borderColor  = pillC + '4d';
      pill.style.background   = pillBg;
      pill.textContent        = paid ? 'Paid' : 'Unpaid';
    }

    cb.addEventListener('change', (e) => {
      if (e.type === '_revert') { applyVisual(cb.checked); return; }
      applyVisual(cb.checked);
      savePaymentStatus(row);
    });
    cb.addEventListener('_revert', () => applyVisual(cb.checked));
  });

  // Tab switching
  backdrop.querySelectorAll('.uem-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      backdrop.querySelectorAll('.uem-tab-btn').forEach((b) => b.classList.remove('is-active'));
      backdrop.querySelectorAll('.uem-panel').forEach((p) => p.classList.remove('is-active'));
      btn.classList.add('is-active');
      const panel = backdrop.querySelector(`[data-uem-panel="${btn.dataset.uemTab}"]`);
      if (panel) panel.classList.add('is-active');
      // Lazy-load orders the first time the tab is opened
      if (btn.dataset.uemTab === 'orders' && !btn.dataset.ordersLoaded) {
        btn.dataset.ordersLoaded = 'true';
        loadUserOrders();
      }
    });
  });

  // Load and render this user's orders
  async function loadUserOrders() {
    const container = backdrop.querySelector('#uem-orders-content');
    if (!container) return;
    container.innerHTML = '<p style="color:#b8c4e0;font-size:0.88rem;">Loading orders…</p>';
    try {
      const res = await fetch(`/api/admin/users/${user.id}/orders`, {
        headers: { Authorization: 'Bearer ' + token },
      });
      const data = await parseJSONResponse(res);
      if (!res.ok) {
        container.innerHTML = `<p style="color:#ff9b9b;font-size:0.88rem;">${escHtml(data.error || 'Unable to load orders.')}</p>`;
        return;
      }
      const orders = data.orders || [];
      if (orders.length === 0) {
        container.innerHTML = '<p style="color:#b8c4e0;font-size:0.88rem;">No orders found for this member.</p>';
        return;
      }
      const statusColor = { pending: '#facc15', processing: '#60a5fa', shipped: '#a78bfa', completed: '#4ade80', cancelled: '#f87171' };
      container.innerHTML = orders.map((o) => {
        const sc = statusColor[o.status] || '#b8c4e0';
        const items = (o.items || []).map((i) =>
          `<div style="display:flex;justify-content:space-between;padding:0.25rem 0;font-size:0.82rem;color:#b8c4e0;border-bottom:1px solid rgba(255,255,255,0.05);">
             <span>${escHtml(i.product_name)}</span>
             <span style="white-space:nowrap;margin-left:1rem;">${i.quantity} &times; $${Number(i.unit_price).toFixed(2)}</span>
           </div>`).join('');
        const dateStr = new Date(o.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
        return `<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:0.9rem 1rem;margin-bottom:0.75rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;flex-wrap:wrap;gap:0.4rem;">
            <span style="font-size:0.82rem;color:#b8c4e0;">${escHtml(dateStr)}</span>
            <span style="font-size:0.75rem;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;padding:0.15rem 0.6rem;border-radius:999px;border:1px solid ${sc}66;background:${sc}1a;color:${sc};">${escHtml(o.status || 'pending')}</span>
          </div>
          ${items}
          <div style="display:flex;justify-content:space-between;margin-top:0.55rem;font-weight:700;font-size:0.9rem;">
            <span>Total</span>
            <span>$${Number(o.total_amount).toFixed(2)}</span>
          </div>
          ${o.notes ? `<p style="margin:0.4rem 0 0;font-size:0.78rem;color:#b8c4e0;">Note: ${escHtml(o.notes)}</p>` : ''}
        </div>`;
      }).join('');
    } catch (_) {
      container.innerHTML = '<p style="color:#ff9b9b;font-size:0.88rem;">Network error loading orders.</p>';
    }
  }

  // Save changes
  backdrop.querySelector('#uem-save').addEventListener('click', async () => {
    const btn = backdrop.querySelector('#uem-save');
    btn.disabled = true;
    setFeedback('Saving…', false);
    const baseSel = full.role === 'disabled' ? 'disabled' : (backdrop.querySelector('#uem-role').value);
    let rolesPayload;
    if (baseSel === 'admin') rolesPayload = ['admin'];
    else if (baseSel === 'disabled') rolesPayload = ['disabled'];
    else if (baseSel === 'guest') rolesPayload = ['guest'];
    else if (baseSel === 'vendor') rolesPayload = ['vendor'];
    else {
      rolesPayload = ['member'];
      if (backdrop.querySelector('#uem-cap-store').checked) rolesPayload.push('store_admin');
      if (backdrop.querySelector('#uem-cap-float').checked) rolesPayload.push('float_admin');
      if (backdrop.querySelector('#uem-cap-finance').checked) rolesPayload.push('finance_admin');
    }
    const payload = {
      full_name: backdrop.querySelector('#uem-name').value.trim(),
      email: backdrop.querySelector('#uem-email').value.trim(),
      role: baseSel,
      roles: rolesPayload,
      phone: backdrop.querySelector('#uem-phone').value.trim(),
      address: backdrop.querySelector('#uem-address').value.trim(),
      spouse_name: backdrop.querySelector('#uem-spouse').value.trim(),
      guest_name: backdrop.querySelector('#uem-guest').value.trim(),
      float_riders: Array.from(backdrop.querySelectorAll('#uem-riders .uem-list-name')).map((nameInp) => {
        const row = nameInp.closest('div');
        const fidRaw = row ? (row.querySelector('.uem-list-float')?.value || '') : '';
        const float_id = fidRaw ? parseInt(fidRaw, 10) : null;
        return {
          name: nameInp.value.trim(),
          comment: row ? (row.querySelector('.uem-list-comment')?.value.trim() || '') : '',
          float_id,
        };
      }).filter((r) => r.name || r.comment || r.float_id),
      float_captain: !!full.captain_of,
      member_float_number: full.member_float_number || '',
      mfa_method: (backdrop.querySelector('#uem-mfa-method')?.value) || 'email',
      mfa_enrolled: backdrop.querySelector('#uem-mfa-method')?.value !== 'none',
    };
    // Read current payment state from checkboxes (managed exclusively by PATCH /payments)
    const currentPayments = {
      dues_paid: backdrop.querySelector('#uem-dues-paid').checked,
      guest_fee_paid: backdrop.querySelector('#uem-guest-fee-paid').checked,
      costume_paid: backdrop.querySelector('#uem-costume-paid').checked,
    };
    try {
      const r = await fetch(`/api/admin/users/${user.id}/details`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(payload),
      });
      const d = await parseJSONResponse(r);
      if (r.ok) {
        setFeedback(d.mfa_note ? ('Saved. ' + d.mfa_note) : 'Saved successfully.', false);
        onUpdate({ ...d.user, ...currentPayments });
      } else { setFeedback(d.error || 'Unable to save', true); }
    } catch { setFeedback('Network error.', true); }
    btn.disabled = false;
  });

  // Reset password
  backdrop.querySelector('#uem-reset-pw').addEventListener('click', async () => {
    const pw = backdrop.querySelector('#uem-password').value.trim();
    if (pw.length < 8) { setFeedback('Password must be at least 8 characters.', true); return; }
    const btn = backdrop.querySelector('#uem-reset-pw');
    btn.disabled = true;
    setFeedback('Resetting password…', false);
    const result = await resetUserPassword(user.id, pw);
    if (result.ok) { setFeedback('Password reset.', false); backdrop.querySelector('#uem-password').value = ''; }
    else { setFeedback(result.data.error || 'Unable to reset password.', true); }
    btn.disabled = false;
  });

  // Disable / Enable
  backdrop.querySelector('#uem-toggle-disable').addEventListener('click', async () => {
    const btn = backdrop.querySelector('#uem-toggle-disable');
    btn.disabled = true;
    try {
      const shouldDisable = full.role !== 'disabled';
      setFeedback(shouldDisable ? 'Disabling account…' : 'Enabling account…', false);
      // Pass the user's pre-disable role so re-enable restores it correctly (e.g. store_admin)
      const prevRole = full.role;
      const restoreRole = shouldDisable ? prevRole : (full._preDisableRole || 'member');
      const result = await setUserDisabled(user.id, shouldDisable, restoreRole);
      if (result.ok && result.data && result.data.user) {
        full.role = result.data.user.role;
        if (shouldDisable) full._preDisableRole = prevRole;
        btn.textContent = full.role === 'disabled' ? 'Enable Account' : 'Disable Account';
        onUpdate(result.data.user);
        setFeedback(shouldDisable ? 'Account disabled.' : 'Account enabled.', false);
      } else {
        const msg = (result.data && result.data.error) || 'Unable to update account.';
        setFeedback(msg, true);
      }
    } catch (err) {
      console.error('Disable/enable failed', err);
      setFeedback('Network or server error while updating account. Is the server running the latest code?', true);
    } finally {
      btn.disabled = false;
    }
  });

  // Delete
  backdrop.querySelector('#uem-delete').addEventListener('click', async () => {
    if (!window.confirm(`Delete ${full.email}? This cannot be undone.`)) return;
    if (window.prompt(`Type DELETE to confirm removal of ${full.email}.`) !== 'DELETE') {
      setFeedback('Delete cancelled.', true); return;
    }
    const result = await deleteUser(user.id);
    if (result.ok) { onUpdate(null); close(); }
    else { setFeedback(result.data.error || 'Unable to delete.', true); }
  });
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Shared pagination control: prev/next arrows always visible (greyed when disabled) + numbered pages.
function renderOrdersPagination(pagEl, page, pageCount, goFn) {
  if (!pagEl) return;
  pagEl.innerHTML = '';
  pagEl.style.cssText = 'display:flex;flex-wrap:wrap;gap:0.4rem;justify-content:center;align-items:center;margin-top:1rem;';
  const mkBtn = (label, targetPage, { active = false, disabled = false } = {}) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = label;
    btn.disabled = disabled;
    const border = active ? '#ffd262' : 'rgba(255,255,255,0.16)';
    const bg = active ? '#ffd262' : 'rgba(255,255,255,0.06)';
    const color = active ? '#1a1206' : 'var(--text, #e6ecff)';
    btn.style.cssText = `min-width:2rem;padding:0.35rem 0.6rem;border-radius:8px;border:1px solid ${border};`
      + `background:${bg};color:${color};font:inherit;font-size:0.82rem;font-weight:${active ? '700' : '400'};`
      + `cursor:${disabled ? 'default' : 'pointer'};opacity:${disabled ? '0.35' : '1'};line-height:1;`;
    if (!disabled && !active) btn.addEventListener('click', () => goFn(targetPage));
    return btn;
  };
  const total = Math.max(1, pageCount);
  pagEl.appendChild(mkBtn('&lsaquo;', page - 1, { disabled: page <= 1 }));
  for (let i = 1; i <= total; i++) {
    pagEl.appendChild(mkBtn(String(i), i, { active: i === page }));
  }
  pagEl.appendChild(mkBtn('&rsaquo;', page + 1, { disabled: page >= total }));
}

function renderAdminUsers(users, currentUserId) {
  const section = document.getElementById('admin-user-management') || document.getElementById('admin-user-management-page');
  const tbody = document.getElementById('admin-user-table-body');
  const filter = document.getElementById('admin-user-filter');
  const summary = document.getElementById('admin-user-summary');
  if (!section || !tbody) return;

  section.style.display = 'block';
  updateAdminSummary(users);

  if (summary && !document.getElementById('admin-add-user-button')) {
    const addUserButton = document.createElement('button');
    addUserButton.type = 'button';
    addUserButton.id = 'admin-add-user-button';
    addUserButton.className = 'button secondary';
    addUserButton.style.marginLeft = '0.75rem';
    addUserButton.textContent = 'Add User';
    addUserButton.addEventListener('click', async () => {
      const fullNameInput = window.prompt('Enter full name for new user.');
      if (fullNameInput === null) return;
      const full_name = fullNameInput.trim();
      if (!full_name) {
        setAdminFeedback('Name is required.', true);
        return;
      }

      const emailInput = window.prompt('Enter email for new user.');
      if (emailInput === null) return;
      const email = emailInput.trim();
      if (!email) {
        setAdminFeedback('Email is required.', true);
        return;
      }

      const roleInput = window.prompt('Role for new user (member / store_admin / admin).', 'member');
      if (roleInput === null) return;
      const roleNorm = roleInput.trim().toLowerCase();
      const role = roleNorm === 'admin' ? 'admin' : roleNorm === 'store_admin' ? 'store_admin' : 'member';

      const passwordInput = window.prompt('Enter temporary password (minimum 8 characters).');
      if (passwordInput === null) return;
      const password = passwordInput.trim();
      if (password.length < 8) {
        setAdminFeedback('Password must be at least 8 characters.', true);
        return;
      }

      setAdminFeedback(`Creating user ${email}...`, false);
      addUserButton.disabled = true;
      const result = await createUser({ full_name, email, role, password });
      addUserButton.disabled = false;

      if (!result.ok || !result.data.user) {
        setAdminFeedback((result.data && result.data.error) || 'Unable to create user', true);
        return;
      }

      users.unshift(result.data.user);
      updateAdminSummary(users);
      drawRows();
      setAdminFeedback(`Created ${result.data.user.email} as ${result.data.user.role}.`, false);
    });

    summary.insertAdjacentElement('afterend', addUserButton);
  }

  function buildCell(value) {
    const cell = document.createElement('td');
    cell.style.padding = '0.75rem';
    cell.style.borderBottom = '1px solid rgba(255,255,255,0.08)';
    cell.textContent = value;
    return cell;
  }

  function drawRows() {
    const filterValue = filter ? filter.value : 'all';
    const visibleUsers = getFilteredUsers(users, filterValue);
    tbody.innerHTML = '';

    if (visibleUsers.length === 0) {
      const emptyRow = document.createElement('tr');
      const emptyCell = buildCell(
        filterValue === 'member'
          ? 'No members found.'
          : filterValue === 'vendor'
            ? 'No vendors found.'
            : filterValue === 'admin'
              ? 'No admins found.'
              : filterValue === 'disabled'
                ? 'No disabled users found.'
                : 'No users found.'
      );
      emptyCell.colSpan = 6;
      emptyRow.appendChild(emptyCell);
      tbody.appendChild(emptyRow);
      return;
    }

    visibleUsers
      .slice()
      .sort((left, right) => {
        const roleRank = { admin: 0, member: 1, disabled: 2, guest: 3 };
        if (left.role !== right.role) return (roleRank[left.role] ?? 99) - (roleRank[right.role] ?? 99);
        return new Date(right.joined_at) - new Date(left.joined_at);
      })
      .forEach((user) => {
        const row = document.createElement('tr');
        const nameCell = buildCell(user.full_name || '');
        const emailCell = buildCell(user.email || '');
        const joinedCell = buildCell(new Date(user.joined_at).toLocaleDateString());
        const roleCell = buildCell(user.role || 'member');
        const isDisabled = user.role === 'disabled';
        // A user is a brand-new "pending registration" (never approved) when they
        // are disabled AND have no prior roles stashed. Any other disabled user is an
        // existing account an admin turned off — re-enable via the Enable action.
        const isPendingReg = isDisabled && (!Array.isArray(user.roles_before_disable) || user.roles_before_disable.length === 0);
        const isDisabledExisting = isDisabled && !isPendingReg;

        // Status cell — clearly shows Enabled / Disabled
        const statusCell = document.createElement('td');
        statusCell.style.cssText = 'padding:0.75rem;border-bottom:1px solid rgba(255,255,255,0.08);white-space:nowrap;';
        const statusPill = document.createElement('span');
        const statusLabel = isPendingReg ? 'Pending' : (isDisabled ? 'Disabled' : 'Enabled');
        statusPill.textContent = statusLabel;
        const statusStyle = isPendingReg
          ? { border: 'rgba(251,191,36,0.45)', bg: 'rgba(251,191,36,0.12)', fg: '#fbbf24' }
          : isDisabled
            ? { border: 'rgba(248,113,113,0.45)', bg: 'rgba(248,113,113,0.12)', fg: '#f87171' }
            : { border: 'rgba(74,222,128,0.45)', bg: 'rgba(74,222,128,0.12)', fg: '#4ade80' };
        statusPill.style.cssText = `display:inline-block;font-size:0.72rem;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;padding:0.18rem 0.6rem;border-radius:999px;border:1px solid ${statusStyle.border};background:${statusStyle.bg};color:${statusStyle.fg};`;
        statusCell.appendChild(statusPill);
        if (isDisabledExisting) {
          row.style.opacity = '0.6';
        }

        // Payment status cell
        const payCell = document.createElement('td');
        payCell.style.cssText = 'padding:0.75rem;border-bottom:1px solid rgba(255,255,255,0.08);white-space:nowrap;';
        function dot(paid, title) {
          const span = document.createElement('span');
          span.title = title;
          span.style.cssText = `display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:4px;background:${paid ? '#4ade80' : '#f87171'};flex-shrink:0;`;
          return span;
        }
        // Guests carry no dues / guest-fee / costume statuses
        if (user.role !== 'guest') {
          payCell.appendChild(dot(user.dues_paid, `Dues: ${user.dues_paid ? 'Paid' : 'Unpaid'}`));
          payCell.appendChild(dot(user.guest_fee_paid, `Guest Fee: ${user.guest_fee_paid ? 'Paid' : 'Unpaid'}`));
          payCell.appendChild(dot(user.costume_paid, `Costume: ${user.costume_paid ? 'Paid' : 'Unpaid'}`));
        }
        if (user.float_captain) {
          const cap = document.createElement('span');
          cap.textContent = '⚓';
          cap.title = 'Float Captain';
          cap.style.cssText = 'font-size:0.75rem;margin-left:4px;';
          payCell.appendChild(cap);
        }
        const actionCell = buildCell('');

        row.appendChild(nameCell);
        row.appendChild(emailCell);
        row.appendChild(joinedCell);
        row.appendChild(roleCell);
        row.appendChild(statusCell);
        row.appendChild(payCell);
        row.appendChild(actionCell);

        // Make name clickable
        nameCell.style.cursor = 'pointer';
        nameCell.style.color = '#ffd262';
        nameCell.title = 'Click to edit user';

        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'button secondary';
        editButton.textContent = 'Edit';
        editButton.addEventListener('click', () => {
          openUserEditModal(user, currentUserId, (updated) => {
            if (!updated) {
              const idx = users.findIndex((u) => u.id === user.id);
              if (idx >= 0) users.splice(idx, 1);
            } else {
              Object.assign(user, updated);
              nameCell.textContent = user.full_name || '';
              emailCell.textContent = user.email || '';
              roleCell.textContent = user.role || 'member';
              // Re-render payment dots with updated values
              payCell.innerHTML = '';
              // Guests carry no dues / guest-fee / costume statuses
              if (user.role !== 'guest') {
                payCell.appendChild(dot(user.dues_paid,      `Dues: ${user.dues_paid      ? 'Paid' : 'Unpaid'}`));
                payCell.appendChild(dot(user.guest_fee_paid, `Guest Fee: ${user.guest_fee_paid ? 'Paid' : 'Unpaid'}`));
                payCell.appendChild(dot(user.costume_paid,   `Costume: ${user.costume_paid   ? 'Paid' : 'Unpaid'}`));
              }
              if (user.float_captain) {
                const cap = document.createElement('span');
                cap.textContent = '⚓';
                cap.title = 'Float Captain';
                cap.style.cssText = 'font-size:0.75rem;margin-left:4px;';
                payCell.appendChild(cap);
              }
            }
            updateAdminSummary(users);
            drawRows();
          });
        });

        nameCell.addEventListener('click', () => editButton.click());

        // Disable / Enable / Approve / Deny buttons directly in the list (not shown for self)
        if (user.id !== currentUserId) {
          if (isPendingReg) {
            // Approve - enables account and emails temporary password to the user
            const approveButton = document.createElement('button');
            approveButton.type = 'button';
            approveButton.className = 'button secondary';
            approveButton.style.marginLeft = '0.5rem';
            approveButton.style.borderColor = 'rgba(74,222,128,0.45)';
            approveButton.style.color = '#88d498';
            approveButton.textContent = 'Approve';
            approveButton.addEventListener('click', async () => {
              approveButton.disabled = true;
              setAdminFeedback(`Approving ${user.email}…`, false);
              try {
                const res = await fetch(`/api/admin/approve-user/${user.id}`, {
                  method: 'POST',
                  headers: { Authorization: 'Bearer ' + getToken(), 'Content-Type': 'application/json' }
                });
                if (res.ok) {
                  const idx = users.findIndex((u) => u.id === user.id);
                  if (idx >= 0) users.splice(idx, 1);
                  drawRows();
                  setAdminFeedback(`${user.email} approved and notified.`, false);
                } else {
                  const data = await res.json().catch(() => ({}));
                  setAdminFeedback(data.error || 'Unable to approve user', true);
                }
              } catch (e) {
                console.error(e);
                setAdminFeedback('Error approving user', true);
              } finally {
                approveButton.disabled = false;
              }
            });
            actionCell.appendChild(approveButton);

            // Deny - deletes the pending registration / account
            const denyButton = document.createElement('button');
            denyButton.type = 'button';
            denyButton.className = 'button secondary';
            denyButton.style.marginLeft = '0.5rem';
            denyButton.style.borderColor = 'rgba(255,155,155,0.45)';
            denyButton.style.color = '#ff9b9b';
            denyButton.textContent = 'Deny';
            denyButton.addEventListener('click', async () => {
              if (!window.confirm(`Deny (delete) registration for ${user.email}? This cannot be undone.`)) return;
              denyButton.disabled = true;
              setAdminFeedback(`Denying ${user.email}…`, false);
              try {
                const res = await fetch(`/api/admin/deny-user/${user.id}`, {
                  method: 'POST',
                  headers: { Authorization: 'Bearer ' + getToken(), 'Content-Type': 'application/json' }
                });
                if (res.ok) {
                  const idx = users.findIndex((u) => u.id === user.id);
                  if (idx >= 0) users.splice(idx, 1);
                  drawRows();
                  setAdminFeedback(`${user.email} denied and removed.`, false);
                } else {
                  const data = await res.json().catch(() => ({}));
                  setAdminFeedback(data.error || 'Unable to deny user', true);
                }
              } catch (e) {
                console.error(e);
                setAdminFeedback('Error denying user', true);
              } finally {
                denyButton.disabled = false;
              }
            });
            actionCell.appendChild(denyButton);
          } else if (isDisabledExisting) {
            // Re-enable an existing account an admin previously disabled (restores its prior roles).
            const enableButton = document.createElement('button');
            enableButton.type = 'button';
            enableButton.className = 'button secondary';
            enableButton.style.marginLeft = '0.5rem';
            enableButton.textContent = 'Enable';
            enableButton.style.borderColor = 'rgba(74,222,128,0.45)';
            enableButton.style.color = '#88d498';
            enableButton.addEventListener('click', async () => {
              enableButton.disabled = true;
              setAdminFeedback(`Enabling ${user.email}…`, false);
              const result = await setUserDisabled(user.id, false, user.role);
              enableButton.disabled = false;
              if (result.ok && result.data.user) {
                Object.assign(user, result.data.user);
                roleCell.textContent = user.role || 'member';
                drawRows();
                setAdminFeedback(`${user.email} enabled.`, false);
              } else {
                setAdminFeedback((result.data && result.data.error) || 'Unable to update account.', true);
              }
            });
            actionCell.appendChild(enableButton);
          } else {
            // Standard Disable button for active accounts
            const disableButton = document.createElement('button');
            disableButton.type = 'button';
            disableButton.className = 'button secondary';
            disableButton.style.marginLeft = '0.5rem';
            disableButton.textContent = 'Disable';
            disableButton.style.borderColor = 'rgba(255,155,155,0.45)';
            disableButton.style.color = '#ff9b9b';
            disableButton.addEventListener('click', async () => {
              disableButton.disabled = true;
              setAdminFeedback(`Disabling ${user.email}…`, false);
              const priorRoles = (Array.isArray(user.roles) && user.roles.length) ? user.roles : [user.role];
              const result = await setUserDisabled(user.id, true, user.role);
              disableButton.disabled = false;
              if (result.ok && result.data.user) {
                Object.assign(user, result.data.user);
                // Keep a non-empty stash so a freshly disabled account renders as a
                // disabled existing account (Enable), not a pending registration (Approve/Deny).
                if (user.role === 'disabled' && !Array.isArray(user.roles_before_disable)) {
                  user.roles_before_disable = priorRoles;
                }
                roleCell.textContent = user.role || 'member';
                drawRows();
                setAdminFeedback(`${user.email} disabled.`, false);
              } else {
                setAdminFeedback((result.data && result.data.error) || 'Unable to update account.', true);
              }
            });
            actionCell.appendChild(disableButton);
          }
        }

        actionCell.appendChild(editButton);
        tbody.appendChild(row);
      });
  }

  if (filter && !filter.dataset.bound) {
    filter.dataset.bound = 'true';
    filter.addEventListener('change', drawRows);
  }

  if (filter && !filter.value) {
    filter.value = 'member';
  }

  drawRows();
}

function buildRemovableInput(container, value, placeholder) {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex; gap:0.4rem; margin-bottom:0.4rem; align-items:center;';

  const input = document.createElement('input');
  input.type = 'text';
  input.value = value || '';
  input.placeholder = placeholder;
  input.style.flex = '1';
  input.className = 'profile-list-input';

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'button secondary';
  removeBtn.textContent = '×';
  removeBtn.style.padding = '0.25rem 0.6rem';
  removeBtn.addEventListener('click', () => wrapper.remove());

  wrapper.appendChild(input);
  wrapper.appendChild(removeBtn);
  container.appendChild(wrapper);
  input.focus();
}

function buildRiderInput(container, rider, floats) {
  rider = rider || {};
  const name = (rider && typeof rider === 'object') ? (rider.name || '') : (typeof rider === 'string' ? rider : '');
  const comment = (rider && typeof rider === 'object') ? (rider.comment || '') : '';
  const riderFloatId = (rider && typeof rider === 'object' && rider.float_id) ? rider.float_id : '';
  const wrapper = document.createElement('div');
  wrapper.className = 'rider-row';
  wrapper.style.cssText = 'display:flex; gap:0.4rem; margin-bottom:0.4rem; align-items:center; flex-wrap:wrap;';

  const mkInp = (value, placeholder, cls, maxWidth) => {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = value || '';
    inp.placeholder = placeholder;
    inp.className = cls;
    inp.style.cssText = `flex:1; min-width:0;${maxWidth ? ' max-width:' + maxWidth + ';' : ''}`;
    return inp;
  };

  wrapper.appendChild(mkInp(name, 'Rider name', 'rider-name-input'));
  wrapper.appendChild(mkInp(comment, 'Comment', 'rider-comment-input'));

  // A rider may be assigned to ANY float defined by the float admin (Option B)
  // — independent of the sponsoring member.
  const floatSel = document.createElement('select');
  floatSel.className = 'rider-float-input';
  floatSel.style.cssText = 'flex:1; min-width:120px; padding:0.55rem 0.7rem; border-radius:8px; border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.04); color:#f5f7ff; font:inherit;';
  const fl = Array.isArray(floats) ? floats : [];
  floatSel.innerHTML = '<option value="">No float</option>' + fl
    .map((f) => {
      const num = (f.float_number || '').toString().trim();
      const label = `Float #${escHtml(num || '?')} – ${escHtml(f.name || 'Unnamed')}`;
      const val = f.id != null ? String(f.id) : '';
      return `<option value="${escHtml(val)}"${String(val) === String(riderFloatId) ? ' selected' : ''}>${label}</option>`;
    }).join('');
  floatSel.value = String(riderFloatId || '');
  wrapper.appendChild(floatSel);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'button secondary';
  removeBtn.textContent = '×';
  removeBtn.style.padding = '0.25rem 0.6rem';
  removeBtn.addEventListener('click', () => wrapper.remove());

  wrapper.appendChild(removeBtn);
  container.appendChild(wrapper);
  wrapper.querySelector('.rider-name-input').focus();
}

function getListValues(container) {
  return Array.from(container.querySelectorAll('.profile-list-input'))
    .map((i) => i.value.trim())
    .filter(Boolean);
}

async function initProfileDetailsForm(profile) {
  const section = document.getElementById('profile-details-section');
  const form = document.getElementById('profile-details-form');
  if (!section || !form) return;

  // Helper: compute age from birthdate string
  function computeAge(bd) {
    if (!bd) return '';
    const birth = new Date(bd);
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const m = now.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
    return age >= 0 ? String(age) : '';
  }

  // Populate simple fields
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  set('pd-phone',         profile.phone);
  attachPhoneFormatter(document.getElementById('pd-phone'));
  set('pd-mfa-method',    ['sms', 'authenticator'].includes(profile.mfa_method) ? profile.mfa_method : 'email');

  // Only show the "Text message (SMS)" option when the SMS gateway is actually
  // configured. The backend drops 'sms' from mfa_available_methods when it is
  // not, so we remove the option here and fall back to email. This also covers
  // a user who enrolled in SMS earlier but whose gateway was later removed.
  const mfaMethodSelect = document.getElementById('pd-mfa-method');
  if (mfaMethodSelect) {
    const smsAvailable = Array.isArray(profile.mfa_available_methods)
      ? profile.mfa_available_methods.includes('sms')
      : true;
    if (!smsAvailable) {
      const smsOption = mfaMethodSelect.querySelector('option[value="sms"]');
      if (smsOption) smsOption.remove();
      // If the saved preference was SMS but it is no longer offered, switch to
      // email so the stored value can't point at an unavailable method.
      if (profile.mfa_method === 'sms') mfaMethodSelect.value = 'email';
      const mfaHint = mfaMethodSelect.closest('.form-group')?.querySelector('.field-hint');
      if (mfaHint) {
        const extra = profile.mfa_method === 'sms'
          ? ' SMS sign-in is unavailable because the SMS gateway is not configured, so codes are now sent by email.'
          : ' (SMS is currently unavailable - the SMS gateway is not configured.)';
        mfaHint.textContent += extra;
      }
    }
  }
  set('pd-address',       profile.address);
  set('pd-city',          profile.city);
  set('pd-state',         profile.state);
  set('pd-zip',           profile.zip);
  set('pd-birthdate',     profile.birthdate ? profile.birthdate.slice(0, 10) : '');
  set('pd-age',           computeAge(profile.birthdate));
  set('pd-occupation',    profile.occupation);
  set('pd-sponsor',       profile.sponsor_name);
  set('pd-organizations', profile.organizations);
  set('pd-spouse',        profile.spouse_name);
  set('pd-guest',         profile.guest_name);

  // Vendor company + secondary-contact details. Only vendor accounts see and
  // edit these, so reveal the section for them and pre-fill from the profile.
  const isVendorProfile = profile.role === 'vendor';
  const vendorSection = document.getElementById('pd-vendor-section');
  if (vendorSection) {
    vendorSection.style.display = isVendorProfile ? 'block' : 'none';
    if (isVendorProfile) {
      set('pd-company-name',     profile.company_name);
      set('pd-company-address',  profile.company_address);
      set('pd-company-city',     profile.company_city);
      set('pd-company-state',    profile.company_state);
      set('pd-company-zip',      profile.company_zip);
      set('pd-secondary-name',   profile.secondary_contact_name);
      set('pd-secondary-email',  profile.secondary_contact_email);
      set('pd-secondary-phone',  profile.secondary_contact_phone);
    }
  }

  // Load the floats defined by the float admin so both the member's own float
  // and each rider row can offer a constrained, consistent float picker.
  let profileFloats = [];
  try {
    const pfRes = await fetch('/api/floats', { headers: { Authorization: 'Bearer ' + getToken() } });
    if (pfRes.ok) profileFloats = await pfRes.json();
  } catch { /* leave empty; selects fall back to "No float" */ }

  // Member's current float (keyed by float number; the backend links a member
  // to a float by number). Used to preselect the editable member row below.
  const memberFloatCur = (profile.member_float_number || '').toString().trim();

  // Float Captain checkbox
  // Float Captain is read-only on the member profile: it reflects what the
  // Float Admin set (captain_of is the source of truth). The member cannot
  // self-appoint, so the checkbox is disabled and driven by captain_of.
  const floatCaptainEl = document.getElementById('pd-float-captain');
  if (floatCaptainEl) floatCaptainEl.checked = Boolean(profile.captain_of);
  const captainLabelEl = document.getElementById('pd-captain-label');
  if (captainLabelEl) {
    captainLabelEl.textContent = profile.captain_of
      ? `Captain of Float #${(profile.captain_of.float_number || '?')} – ${profile.captain_of.name || 'Unnamed'}`.trim()
      : 'Float Captain';
  }

  // Auto-update age when birthdate changes
  const bdEl = document.getElementById('pd-birthdate');
  const ageEl = document.getElementById('pd-age');
  if (bdEl && ageEl) {
    bdEl.addEventListener('change', () => { ageEl.value = computeAge(bdEl.value); });
  }

  // Helper: build a name + date row (for children / grandchildren)
  function buildPersonRow(container, name, birthday, namePlaceholder) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:0.35rem;margin-bottom:0.4rem;align-items:center;flex-wrap:wrap;';
    const nameInp = document.createElement('input');
    nameInp.type = 'text';
    nameInp.value = name || '';
    nameInp.placeholder = namePlaceholder || 'Name';
    nameInp.className = 'person-name-input';
    nameInp.style.cssText = 'flex:2;min-width:120px;padding:0.55rem 0.7rem;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#f5f7ff;font:inherit;';
    const bdInp = document.createElement('input');
    bdInp.type = 'date';
    bdInp.value = birthday ? birthday.slice(0, 10) : '';
    bdInp.className = 'person-bd-input';
    bdInp.style.cssText = 'flex:1;min-width:120px;padding:0.55rem 0.7rem;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#f5f7ff;font:inherit;';
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.textContent = '×';
    rm.style.cssText = 'padding:0.25rem 0.6rem;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:#b8c4e0;cursor:pointer;font:inherit;flex-shrink:0;';
    rm.addEventListener('click', () => row.remove());
    row.appendChild(nameInp);
    row.appendChild(bdInp);
    row.appendChild(rm);
    container.appendChild(row);
  }

  const kidsList = document.getElementById('kids-list');
  const gcList   = document.getElementById('grandchildren-list');
  const ridersList = document.getElementById('riders-list');

  const kidsBdays = profile.kids_birthdays || [];
  (profile.kids_names || []).forEach((name, i) => buildPersonRow(kidsList, name, kidsBdays[i] || '', 'Child name'));

  const gcBdays = profile.grandchildren_birthdays || [];
  (profile.grandchildren_names || []).forEach((name, i) => buildPersonRow(gcList, name, gcBdays[i] || '', 'Grandchild name'));

  (profile.float_riders || []).forEach((r) => buildRiderInput(ridersList, r, profileFloats));

  document.getElementById('add-kid-btn').addEventListener('click', () => buildPersonRow(kidsList, '', '', 'Child name'));
  document.getElementById('add-grandchild-btn').addEventListener('click', () => buildPersonRow(gcList, '', '', 'Grandchild name'));
  document.getElementById('add-rider-btn').addEventListener('click', () => buildRiderInput(ridersList, '', profileFloats));

  // The member appears as an editable row in the "Float Riders" list — just
  // like any rider entry — so they can change their own float here. There is no
  // separate "Your Float" section. Uses class "profile-member-row" (not
  // "rider-row") so it is never saved back as one of their sponsored riders,
  // and it has no remove button (a member can't remove themselves).
  const memberName = profile.full_name || profile.name || 'Member';
  const memberFloatObj = (profileFloats || []).find((f) => String(f.float_number) === String(memberFloatCur));
  const memberFloatId = memberFloatObj ? memberFloatObj.id : '';
  const memberRow = document.createElement('div');
  memberRow.className = 'profile-member-row';
  memberRow.style.cssText = 'display:flex;gap:0.35rem;margin-bottom:0.4rem;align-items:center;flex-wrap:wrap;background:rgba(255,210,98,0.06);border-radius:8px;padding:0.25rem 0.4rem;';
  const mTag = document.createElement('span');
  mTag.textContent = memberName;
  mTag.style.cssText = 'flex:2;min-width:0;font-weight:600;color:#f5f7ff;';
  const mCm = document.createElement('span');
  mCm.textContent = '—';
  mCm.style.cssText = 'flex:3;min-width:0;color:#b8c4e0;font-size:0.82rem;';
  // Editable float picker — the member can change which float they're on.
  const mFloatSel = document.createElement('select');
  mFloatSel.className = 'profile-member-float';
  mFloatSel.style.cssText = 'flex:1;min-width:120px;padding:0.55rem 0.7rem;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#f5f7ff;font:inherit;';
  mFloatSel.innerHTML = '<option value="">No float</option>' + (profileFloats || []).map((f) => {
    const num = (f.float_number || '').toString().trim();
    const label = `Float #${escHtml(num || '?')} – ${escHtml(f.name || 'Unnamed')}`;
    const val = f.id != null ? String(f.id) : '';
    return `<option value="${escHtml(val)}"${String(val) === String(memberFloatId || '') ? ' selected' : ''}>${label}</option>`;
  }).join('');
  mFloatSel.value = String(memberFloatId || '');
  const mBadge = document.createElement('span');
  mBadge.textContent = 'Member';
  mBadge.style.cssText = 'flex-shrink:0;font-size:0.6rem;text-transform:uppercase;letter-spacing:0.05em;padding:0.12rem 0.45rem;border-radius:999px;border:1px solid rgba(255,210,98,0.4);color:#ffd262;';
  memberRow.appendChild(mTag);
  memberRow.appendChild(mCm);
  memberRow.appendChild(mFloatSel);
  memberRow.appendChild(mBadge);
  ridersList.insertBefore(memberRow, ridersList.firstChild);

  const feedback = document.getElementById('profile-details-feedback');
  function setFeedback(msg, isError, isInfo) {
    feedback.textContent = msg;
    feedback.classList.toggle('is-error', Boolean(isError));
    feedback.classList.toggle('is-info', Boolean(isInfo) && !isError);
    feedback.classList.toggle('is-success', Boolean(msg) && !isError && !isInfo);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    setFeedback('Saving…', false, true);

    const token = getToken();
    try {
      const mfaMethodSel = document.getElementById('pd-mfa-method');
      const mfaMethod = mfaMethodSel ? mfaMethodSel.value : 'email';
      if (mfaMethod === 'sms' && !document.getElementById('pd-phone').value.trim()) {
        setFeedback('Please enter a phone number to use SMS for MFA.', true);
        return;
      }
      const res = await fetch('/api/profile/details', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          phone:         document.getElementById('pd-phone').value.trim(),
          address:       document.getElementById('pd-address').value.trim(),
          city:          document.getElementById('pd-city').value.trim(),
          state:         document.getElementById('pd-state').value.trim().toUpperCase(),
          zip:           document.getElementById('pd-zip').value.trim(),
          mfa_method:    (document.getElementById('pd-mfa-method')?.value || 'email'),
          birthdate:     document.getElementById('pd-birthdate').value || null,
          occupation:    document.getElementById('pd-occupation').value.trim(),
          sponsor_name:  document.getElementById('pd-sponsor').value.trim(),
          organizations: document.getElementById('pd-organizations').value.trim(),
          spouse_name:   document.getElementById('pd-spouse').value.trim(),
          guest_name:    document.getElementById('pd-guest').value.trim(),
          member_float_number: (() => {
            const mr = ridersList.querySelector('.profile-member-row');
            const fidRaw = mr ? (mr.querySelector('.profile-member-float')?.value || '') : '';
            const fid = fidRaw ? parseInt(fidRaw, 10) : null;
            const obj = (profileFloats || []).find((f) => f.id === fid);
            return obj ? (obj.float_number || '').toString().trim() : '';
          })(),
          kids_names:       Array.from(kidsList.querySelectorAll('.person-name-input')).map(i => i.value.trim()).filter(Boolean),
          kids_birthdays:   Array.from(kidsList.querySelectorAll('.person-name-input')).map(i => { const r = i.closest('div'); return r ? (r.querySelector('.person-bd-input')?.value || null) : null; }),
          grandchildren_names:       Array.from(gcList.querySelectorAll('.person-name-input')).map(i => i.value.trim()).filter(Boolean),
          grandchildren_birthdays:   Array.from(gcList.querySelectorAll('.person-name-input')).map(i => { const r = i.closest('div'); return r ? (r.querySelector('.person-bd-input')?.value || null) : null; }),
          float_riders: Array.from(ridersList.querySelectorAll('.rider-row')).map((row) => {
            const fidRaw = row.querySelector('.rider-float-input') ? row.querySelector('.rider-float-input').value : '';
            const float_id = fidRaw ? parseInt(fidRaw, 10) : null;
            return {
              name: row.querySelector('.rider-name-input').value.trim(),
              comment: row.querySelector('.rider-comment-input').value.trim(),
              float_id,
            };
          }).filter((r) => r.name || r.comment || r.float_id),
          // Vendor company + secondary-contact details (only sent for vendors;
          // non-vendors keep these null so an unrelated profile can't clear them).
          company_name: isVendorProfile ? (document.getElementById('pd-company-name')?.value.trim() || null) : null,
          company_address: isVendorProfile ? (document.getElementById('pd-company-address')?.value.trim() || null) : null,
          company_city: isVendorProfile ? (document.getElementById('pd-company-city')?.value.trim() || null) : null,
          company_state: isVendorProfile ? (document.getElementById('pd-company-state')?.value.trim().toUpperCase() || null) : null,
          company_zip: isVendorProfile ? (document.getElementById('pd-company-zip')?.value.trim() || null) : null,
          secondary_contact_name: isVendorProfile ? (document.getElementById('pd-secondary-name')?.value.trim() || null) : null,
          secondary_contact_email: isVendorProfile ? (document.getElementById('pd-secondary-email')?.value.trim() || null) : null,
          secondary_contact_phone: isVendorProfile ? (document.getElementById('pd-secondary-phone')?.value.trim() || null) : null,
          float_captain: !!profile.captain_of,
        }),
      });
      const data = await parseJSONResponse(res);
      if (res.ok) {
        setFeedback('Information saved.', false);
        if (data.mfaChallenge && data.mfaChallenge.mfaChallengeSent) {
          showProfileMfaVerify(data.mfaChallenge);
        } else if (data.mfaChallenge && data.mfaChallenge.error) {
          setFeedback(data.mfaChallenge.error, true);
        }
      } else {
        setFeedback(data.error || 'Unable to save.', true);
      }
    } catch (_err) {
      setFeedback('Network error. Please try again.', true);
    } finally {
      submitBtn.disabled = false;
    }
  });

  // When floats are locked, only the Float Admin may change float assignments.
  // Disable the float/riders controls for everyone else.
  const floatsLocked = Boolean(profile.float_locked);
  const canEditFloats = !floatsLocked || profileHasRole(profile, 'float_admin');
  if (!canEditFloats) {
    const rl = document.getElementById('riders-list');
    if (rl) rl.querySelectorAll('input, select, button').forEach((el) => { el.disabled = true; });
    const addRiderBtn = document.getElementById('add-rider-btn');
    if (addRiderBtn) addRiderBtn.disabled = true;
    const lockNote = document.getElementById('float-lock-note');
    if (lockNote) lockNote.style.display = 'block';
  }

  section.style.display = 'block';
}

function showProfileMfaVerify(challenge) {
  const block = document.getElementById('pd-mfa-verify');
  const promptEl = document.getElementById('pd-mfa-verify-prompt');
  const codeInput = document.getElementById('pd-mfa-code');
  const verifyBtn = document.getElementById('pd-mfa-verify-btn');
  const resendBtn = document.getElementById('pd-mfa-resend-btn');
  const setupEl = document.getElementById('pd-mfa-otp-setup');
  const feedback = document.getElementById('profile-details-feedback');
  if (!block) return;
  block.hidden = false;

  if (challenge.method === 'authenticator') {
    // Enrolling an authenticator app: show the QR / manual key and ask
    // for the rolling code (nothing was sent by email/SMS).
    if (setupEl) { renderOtpSetup(setupEl, challenge); setupEl.hidden = false; }
    if (promptEl) promptEl.textContent = 'Scan the QR code with your authenticator app, then enter the 6-digit code below to finish enabling it.';
    if (resendBtn) resendBtn.hidden = true;
  } else {
    if (setupEl) setupEl.hidden = true;
    if (resendBtn) resendBtn.hidden = false;
    let msg = 'Enter the code we sent to ' + (challenge.maskedTarget || 'your device') + '.';
    if (challenge.deliveryNotice) msg += ' ' + challenge.deliveryNotice;
    if (challenge.devCode) msg += ' (dev code: ' + challenge.devCode + ')';
    if (promptEl) promptEl.textContent = msg;
  }
  if (codeInput) { codeInput.value = ''; codeInput.focus(); }

  const onVerify = async () => {
    const code = (codeInput && codeInput.value.trim()) || '';
    try {
      const v = await postJSON('/api/auth/mfa/verify', { mfaToken: challenge.mfaToken, code });
      if (v.token || v.mfaEnrolled) {
        block.hidden = true;
        if (feedback) {
          feedback.textContent = challenge.method === 'authenticator'
            ? 'Two-factor authentication enabled via your authenticator app.'
            : 'Two-factor authentication enabled via SMS.';
          feedback.style.color = 'var(--muted)';
        }
      } else {
        if (promptEl) promptEl.textContent = v.error || 'Invalid code. Try again.';
      }
    } catch (_e) {
      if (promptEl) promptEl.textContent = 'Unable to verify. Please try again.';
    }
  };
  const onResend = async () => {
    try {
      const phone = (document.getElementById('pd-phone') || {}).value;
      const resendMethod = (document.getElementById('pd-mfa-method')?.value || 'sms');
      const r = await fetch('/api/profile/mfa', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
        body: JSON.stringify({ method: resendMethod, phone: phone ? phone.trim() : '' }),
      });
      const j = await parseJSONResponse(r);
      if (j.mfaChallengeSent) {
        if (resendMethod === 'authenticator' && setupEl) { renderOtpSetup(setupEl, j); setupEl.hidden = false; }
        challenge.mfaToken = j.mfaToken;
        if (promptEl) promptEl.textContent = resendMethod === 'authenticator'
          ? 'A new setup code was generated. Scan the QR code or use the key below.'
          : 'A new code was sent to ' + (j.maskedTarget || 'your device') + '.' + (j.devCode ? ' (dev code: ' + j.devCode + ')' : '');
      } else {
        if (promptEl) promptEl.textContent = j.error || 'Unable to resend code.';
      }
    } catch (_e) {
      if (promptEl) promptEl.textContent = 'Unable to resend. Please try again.';
    }
  };
  if (verifyBtn) verifyBtn.onclick = onVerify;
  if (resendBtn) resendBtn.onclick = onResend;
}

async function initDashboard() {
  const el = document.getElementById('profile');
  if (!el) return;
  const profile = await fetchProfile();
  if (!profile) {
    window.location.href = '/login.html';
    return;
  }

  // Build avatar initials
  const initials = (profile.full_name || '?')
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase())
    .slice(0, 2)
    .join('');

  const badgeClass = profile.role === 'admin' ? 'db-badge--admin' : profile.role === 'store_admin' ? 'db-badge--store-admin' : profile.role === 'float_admin' ? 'db-badge--float-admin' : profile.role === 'finance_admin' ? 'db-badge--finance-admin' : profile.role === 'vendor' ? 'db-badge--vendor' : 'db-badge--member';
  const badgeLabel = profile.role === 'admin' ? 'Admin' : profile.role === 'store_admin' ? 'Store Admin' : profile.role === 'float_admin' ? 'Float Admin' : profile.role === 'finance_admin' ? 'Finance Admin' : profile.role === 'vendor' ? 'Vendor' : profile.role === 'guest' ? 'Guest' : 'Member';

  function payBadgeHtml(paid, label) {
    const c = paid ? '#4ade80' : '#f87171';
    const svg = paid
      ? `<svg viewBox="0 0 24 24" style="width:1rem;height:1rem;vertical-align:middle;flex-shrink:0;" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="${c}"/><path fill="#fff" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`
      : `<svg viewBox="0 0 24 24" style="width:1rem;height:1rem;vertical-align:middle;flex-shrink:0;" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="${c}"/><path fill="#fff" d="M18.3 5.71L12 12.01 5.7 5.71 4.29 7.12 10.59 13.42 4.29 19.72l1.41 1.41L12 14.83l6.3 6.3 1.41-1.41-6.3-6.3 6.3-6.3z"/></svg>`;
    return `<span style="display:inline-flex;align-items:center;gap:0.3rem;color:${c};font-size:0.85rem;font-weight:600;">${svg} ${label}: ${paid ? 'Paid' : 'Unpaid'}</span>`;
  }

  el.innerHTML = `
    <div class="db-avatar" aria-hidden="true">${initials}</div>
    <div class="db-hero-info">
      <p class="db-hero-label">Welcome back</p>
      <h1 class="db-hero-name">${profile.full_name}</h1>
      <ul class="db-hero-meta">
        <li><strong>Email:</strong> ${profile.email}</li>
        <li><strong>Member since:</strong> ${new Date(profile.joined_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</li>
        <li><span class="db-badge ${badgeClass}">${badgeLabel}</span></li>
        <li id="db-payment-status-li" style="display:${profile.role !== 'guest' ? 'flex' : 'none'};gap:0.75rem;flex-wrap:wrap;align-items:center;">
          ${profile.role !== 'guest' ? payBadgeHtml(Boolean(profile.role === 'vendor' ? profile.vendor_fee_paid : profile.dues_paid), profile.role === 'vendor' ? 'Vendor Fee' : 'Dues') : ''}
          ${profile.role !== 'guest' ? payBadgeHtml(Boolean(profile.guest_fee_paid), 'Guest Fee') : ''}
          ${profile.role !== 'guest' ? payBadgeHtml(Boolean(profile.costume_paid), 'Costume') : ''}
        </li>
      </ul>
    </div>
  `;

  // Any elevated role sees the Admin tab + the admin-tools card, but each
  // role only gets the specific console links it is allowed to use. A user may
  // hold several capabilities at once, so the visible links are the union of
  // every role they hold (a full admin sees them all).
  const adminToolLinksByRole = {
    admin: ['open-user-management', 'open-site-config', 'open-backup-restore', 'open-shop-admin', 'open-float-admin', 'open-finance-admin', 'open-pending-registrations'],
    store_admin: ['open-shop-admin'],
    float_admin: ['open-float-admin'],
    finance_admin: ['open-finance-admin'],
  };
  const myAdminLinks = Array.from(new Set(
    profileRoles(profile).flatMap((r) => adminToolLinksByRole[r] || [])
  ));
  if (myAdminLinks.length) {
    const adminTab = document.getElementById('db-tab-admin');
    if (adminTab) adminTab.hidden = false;
    const adminTools = document.getElementById('admin-tools');
    if (adminTools) adminTools.style.display = 'block';
    // Every admin-tool link starts hidden; reveal only this role's allowed set.
    ['open-user-management', 'open-site-config', 'open-backup-restore', 'open-shop-admin', 'open-float-admin', 'open-finance-admin', 'open-pending-registrations']
      .forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
    myAdminLinks.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = '';
    });
  }

  // Guests may only maintain their own personal/contact details. Hide the
  // family (children / grandchildren) and float-roster sections so they
  // cannot see or add them.
  if (profile.role === 'guest') {
    ['pd-children-section', 'pd-grandchildren-section', 'pd-float-riders-section', 'pd-guest-section'].forEach((id) => {
      const sec = document.getElementById(id);
      if (sec) sec.style.display = 'none';
    });
  }

  // Wire up tabs
  const tabs = document.querySelectorAll('.db-tab');
  const panels = document.querySelectorAll('.db-tab-panel');
  function activateTab(tab) {
    tabs.forEach((t) => t.classList.remove('is-active'));
    panels.forEach((p) => p.classList.remove('is-active'));
    tab.classList.add('is-active');
    const target = document.getElementById('db-panel-' + tab.dataset.tab);
    if (target) target.classList.add('is-active');
    if (tab.dataset.tab === 'orders') loadDashboardOrders();
  }
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => activateTab(tab));
  });

  // Open a specific tab when linked with a hash (e.g. #admin from an admin tool).
  const hashTab = (location.hash || '').replace('#', '');
  if (hashTab) {
    const target = Array.from(tabs).find((t) => t.dataset.tab === hashTab && !t.hidden);
    if (target) activateTab(target);
  }

  async function loadDashboardOrders() {
    const feedEl = document.getElementById('db-orders-feedback');
    const listEl = document.getElementById('db-orders-list');
    const pagEl  = document.getElementById('db-orders-pagination');
    if (!feedEl || !listEl) return;
    feedEl.textContent = 'Loading orders…';
    listEl.innerHTML = '';
    if (pagEl) pagEl.innerHTML = '';
    try {
      const res = await fetch('/api/shop/orders', { headers: { Authorization: 'Bearer ' + getToken() } });
      const data = await parseJSONResponse(res);
      feedEl.textContent = '';
      if (!res.ok) { listEl.innerHTML = `<p style="color:#f87171;">${data.error || 'Unable to load orders.'}</p>`; return; }
      if (data.orders.length === 0) { listEl.innerHTML = '<p style="color:var(--muted);">You have no orders yet. <a href="/shop.html" style="color:#ffd262;">Visit the shop</a> to place one.</p>'; return; }
      const statusColor = { pending:'#ffd262', processing:'#60a5fa', shipped:'#a78bfa', completed:'#4ade80', cancelled:'#f87171' };
      const perPage = 5;
      const pageCount = Math.ceil(data.orders.length / perPage);

      function renderDashOrdersPage(page) {
        const start = (page - 1) * perPage;
        const pageOrders = data.orders.slice(start, start + perPage);
        listEl.innerHTML = pageOrders.map((o) => {
          const itemLines = (o.items || []).map((i) =>
            `<span style="display:block;font-size:0.82rem;color:var(--muted);">${escHtml(i.product_name)} &times; ${i.quantity} &mdash; $${(parseFloat(i.unit_price)*i.quantity).toFixed(2)}</span>`
          ).join('');
          const col = statusColor[o.status] || '#b8c4e0';
          return `<div style="padding:0.75rem 0;border-bottom:1px solid rgba(255,255,255,0.07);">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.4rem;">
              <span style="font-weight:600;">Order #${o.id}</span>
              <span style="font-size:0.78rem;color:${col};border:1px solid ${col};border-radius:999px;padding:0.1rem 0.55rem;">${o.status}</span>
            </div>
            <div style="font-size:0.82rem;color:var(--muted);margin:0.15rem 0;">${new Date(o.created_at).toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'})}</div>
            ${itemLines}
            <div style="margin-top:0.25rem;font-size:0.9rem;">Total: <strong style="color:#ffd262;">$${parseFloat(o.total_amount).toFixed(2)}</strong></div>
          </div>`;
        }).join('');
        renderOrdersPagination(pagEl, page, pageCount, renderDashOrdersPage);
      }

      renderDashOrdersPage(1);
    } catch { feedEl.textContent = 'Network error loading orders.'; }
  }

  // Refresh all payment statuses when tab becomes visible or on poll
  async function refreshPaymentStatus() {
    const li = document.getElementById('db-payment-status-li');
    if (!li) return;
    if (profile.role === 'guest') { li.innerHTML = ''; return; }
    try {
      const res = await fetch('/api/profile', { headers: { Authorization: 'Bearer ' + getToken() } });
      if (!res.ok) return;
      const data = await parseJSONResponse(res);
      li.innerHTML = [
        [Boolean(data.dues_paid),      'Dues'],
        [Boolean(data.guest_fee_paid), 'Guest Fee'],
        [Boolean(data.costume_paid),   'Costume'],
      ].map(([paid, label]) => payBadgeHtml(paid, label)).join('');
    } catch { /* silent */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshPaymentStatus();
  });
  // Poll every 5 s so payment status stays current without a page reload
  setInterval(refreshPaymentStatus, 5000);
  // Run once after a short delay to self-correct any load-time race
  setTimeout(refreshPaymentStatus, 1000);

  initProfileDetailsForm(profile);
  initChangePasswordForm();
}

// ── Change Password (self-service, all profile types) ───────────────
function initChangePasswordForm() {
  const section = document.getElementById('change-password-section');
  const form = document.getElementById('change-password-form');
  if (!section || !form) return;

  const feedback = document.getElementById('change-password-feedback');
  function setFeedback(msg, isError, isInfo) {
    feedback.textContent = msg;
    feedback.classList.toggle('is-error', Boolean(isError));
    feedback.classList.toggle('is-info', Boolean(isInfo) && !isError);
    feedback.classList.toggle('is-success', Boolean(msg) && !isError && !isInfo);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    const currentEl = document.getElementById('cp-current');
    const newEl = document.getElementById('cp-new');
    const confirmEl = document.getElementById('cp-confirm');

    const current = currentEl.value;
    const next = newEl.value;
    const confirm = confirmEl.value;

    if (!current || !next || !confirm) {
      setFeedback('All three fields are required.', true);
      return;
    }
    if (next.length < 8) {
      setFeedback('New password must be at least 8 characters.', true);
      return;
    }
    if (next !== confirm) {
      setFeedback('New password and confirmation do not match.', true);
      return;
    }

    submitBtn.disabled = true;
    setFeedback('Updating…', false, true);

    const token = getToken();
    try {
      const res = await fetch('/api/profile/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          current_password: current,
          new_password: next,
          confirm_password: confirm,
        }),
      });
      const data = await parseJSONResponse(res);
      if (res.ok) {
        form.reset();
        setFeedback('Password updated.', false);
      } else {
        setFeedback(data.error || 'Unable to update password.', true);
      }
    } catch (_err) {
      setFeedback('Network error. Please try again.', true);
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// ── Season end-date UI ────────────────────────────────────────────────────
// Mirrors the server-side resolveSeasonEndDate() logic in the browser so the
// admin can see a live preview of the next reset date as they configure it.
// Shows only the fields for the payment processor chosen in the dropdown.
function setupPaymentProcessorUI(form) {
  const sel = document.getElementById('cfg-payment-processor');
  const paypal = document.getElementById('cfg-provider-paypal');
  const stripe = document.getElementById('cfg-provider-stripe');
  if (!sel || !paypal || !stripe) return;

  function updateVisibility() {
    const p = sel.value;
    paypal.style.display = p === 'paypal' ? '' : 'none';
    stripe.style.display = p === 'stripe' ? '' : 'none';
  }

  sel.addEventListener('change', updateVisibility);
  updateVisibility();
}

function setupSeasonEndDateUI(form) {
  const typeEl        = document.getElementById('cfg-season-end-type');
  const fixedFields   = document.getElementById('cfg-season-fixed-fields');
  const relFields     = document.getElementById('cfg-season-relative-fields');
  const fixedMonthEl  = document.getElementById('cfg-season-fixed-month');
  const fixedDayEl    = document.getElementById('cfg-season-fixed-day');
  const relOrdinalEl  = document.getElementById('cfg-season-rel-ordinal');
  const relDowEl      = document.getElementById('cfg-season-rel-dow');
  const relMonthEl    = document.getElementById('cfg-season-rel-month');
  const hiddenEl      = document.getElementById('cfg-season-end-date-value');
  const previewEl     = document.getElementById('cfg-season-next-reset-label');
  const resetBtn      = document.getElementById('cfg-season-reset-btn');
  const resetFeedback = document.getElementById('cfg-season-reset-feedback');

  if (!typeEl || !hiddenEl) return;

  const MONTH_NAMES = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ];

  function updateVisibility() {
    const t = typeEl.value;
    fixedFields.style.display    = t === 'fixed'    ? '' : 'none';
    relFields.style.display      = t === 'relative' ? '' : 'none';
  }

  function buildValue() {
    const t = typeEl.value;
    if (t === 'fixed') {
      const m = fixedMonthEl.value;
      const d = fixedDayEl.value;
      return (m && d && Number(d) >= 1 && Number(d) <= 31) ? `fixed:${m}:${d}` : '';
    }
    if (t === 'relative') {
      return `relative:${relOrdinalEl.value}:${relDowEl.value}:${relMonthEl.value}`;
    }
    return '';
  }

  // Client-side mirror of server resolveSeasonEndDate()
  function resolveEndDate(year, cfg) {
    if (!cfg) return null;
    const MS = 24 * 60 * 60 * 1000;
    if (cfg.type === 'fixed') {
      return new Date(Date.UTC(year, cfg.month - 1, cfg.day));
    }
    const { ordinal, dow, month } = cfg;
    if (ordinal === -1) {
      const last = new Date(Date.UTC(year, month, 0));
      const diff = (last.getUTCDay() - dow + 7) % 7;
      return new Date(last.getTime() - diff * MS);
    }
    const first = new Date(Date.UTC(year, month - 1, 1));
    const diff  = (dow - first.getUTCDay() + 7) % 7;
    return new Date(Date.UTC(year, month - 1, 1 + diff + (ordinal - 1) * 7));
  }

  function parseCfg(val) {
    if (!val) return null;
    const parts = val.split(':');
    if (parts[0] === 'fixed' && parts.length === 3) {
      const month = parseInt(parts[1], 10), day = parseInt(parts[2], 10);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return { type: 'fixed', month, day };
    }
    if (parts[0] === 'relative' && parts.length === 4) {
      const ordinal = parseInt(parts[1], 10), dow = parseInt(parts[2], 10), month = parseInt(parts[3], 10);
      if ((ordinal >= 1 && ordinal <= 4 || ordinal === -1) && dow >= 0 && dow <= 6 && month >= 1 && month <= 12)
        return { type: 'relative', ordinal, dow, month };
    }
    return null;
  }

  function updatePreview() {
    if (!previewEl) return;
    const val = buildValue();
    const cfg = parseCfg(val);

    if (!val && typeEl.value === '') {
      previewEl.textContent = 'Season ends on Ash Wednesday (varies each year).';
      return;
    }
    if (!cfg) { previewEl.textContent = ''; return; }

    const now   = new Date();
    const year  = now.getUTCFullYear();
    const end   = resolveEndDate(year, cfg);
    if (!end) { previewEl.textContent = ''; return; }

    const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const nextEnd = todayMs >= end.getTime() ? resolveEndDate(year + 1, cfg) : end;
    previewEl.textContent = `Next automatic reset: ${nextEnd.toLocaleDateString(undefined, {
      year: 'numeric', month: 'long', day: 'numeric',
    })}`;
  }

  function syncHidden() {
    hiddenEl.value = buildValue();
    updatePreview();
  }

  // Populate sub-fields from the hidden input value (already set by the generic config loader)
  function loadFromHidden() {
    const val = hiddenEl.value;
    if (!val) { typeEl.value = ''; updateVisibility(); updatePreview(); return; }
    const parts = val.split(':');
    if (parts[0] === 'fixed' && parts.length === 3) {
      typeEl.value       = 'fixed';
      fixedMonthEl.value = parts[1];
      fixedDayEl.value   = parts[2];
    } else if (parts[0] === 'relative' && parts.length === 4) {
      typeEl.value        = 'relative';
      relOrdinalEl.value  = parts[1];
      relDowEl.value      = parts[2];
      relMonthEl.value    = parts[3];
    } else {
      typeEl.value = '';
    }
    updateVisibility();
    updatePreview();
  }

  typeEl.addEventListener('change',       () => { updateVisibility(); syncHidden(); });
  fixedMonthEl.addEventListener('change', syncHidden);
  fixedDayEl.addEventListener('input',    syncHidden);
  relOrdinalEl.addEventListener('change', syncHidden);
  relDowEl.addEventListener('change',     syncHidden);
  relMonthEl.addEventListener('change',   syncHidden);

  loadFromHidden();

  // Manual reset button
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      if (!confirm('Reset all member dues and fees to unpaid now?')) return;
      resetBtn.disabled = true;
      if (resetFeedback) { resetFeedback.textContent = 'Resetting…'; resetFeedback.style.color = 'var(--muted)'; }
      try {
        const res = await fetch('/api/admin/season-reset', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + getToken() },
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          resetFeedback.textContent = `All dues and fees reset (${data.reset_date || 'today'}).`;
          resetFeedback.style.color = 'var(--muted)';
        } else {
          resetFeedback.textContent = data.error || 'Reset failed.';
          resetFeedback.style.color = '#b42318';
        }
      } catch (_) {
        if (resetFeedback) { resetFeedback.textContent = 'Network error.'; resetFeedback.style.color = '#b42318'; }
      } finally {
        resetBtn.disabled = false;
      }
    });
  }
}

async function initSiteConfig() {
  const card = document.getElementById('site-config-card');
  const form = document.getElementById('site-config-form');
  if (!card || !form) return;

  const feedback = document.getElementById('site-config-feedback');
  function setFeedback(msg, isError) {
    feedback.textContent = msg;
    feedback.style.color = isError ? '#b42318' : 'var(--muted)';
  }

  const token = getToken();
  setFeedback('Loading configuration…', false);
  card.style.display = '';

  try {
    const res = await fetch('/api/admin/config', {
      headers: { Authorization: 'Bearer ' + token },
    });
    const data = await parseJSONResponse(res);
    if (!res.ok) { setFeedback(data.error || 'Unable to load config', true); return; }

    const config = data.config || {};
    for (const [key, value] of Object.entries(config)) {
      const el = form.querySelector(`[name="${key}"]`);
      if (!el) continue;
      if (el.type === 'checkbox') { el.checked = value === 'true'; } else { el.value = value; }
    }
    // MFA requirement lives in a separate site setting, not the env config
    try {
      const mfaRes = await fetch('/api/admin/mfa-config', { headers: { Authorization: 'Bearer ' + token } });
      const mfaData = await parseJSONResponse(mfaRes);
      const mfaSel = form.querySelector('[name="mfa_mode"]');
      if (mfaRes.ok && mfaSel) mfaSel.value = mfaData.mfaMode || 'off';
    } catch (_mfaErr) { /* non-fatal */ }
    // UI theme is also a site setting (applied instantly, no restart)
    try {
      const themeRes = await fetch('/api/admin/theme-config', { headers: { Authorization: 'Bearer ' + token } });
      const themeData = await parseJSONResponse(themeRes);
      const themeSel = form.querySelector('[name="ui_theme"]');
      if (themeRes.ok && themeSel) themeSel.value = themeData.theme || 'dark';
    } catch (_themeErr) { /* non-fatal */ }
    setFeedback('', false);
    // Wire up the season end-date sub-fields now that the hidden input has been populated
    setupSeasonEndDateUI(form);
    // Show only the selected payment processor's fields
    setupPaymentProcessorUI(form);
  } catch (_err) {
    setFeedback('Network error loading config.', true);
    return;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    setFeedback('Saving…', false, true);

    const config = {};
    form.querySelectorAll('input[name], select[name], textarea[name]').forEach((el) => {
      config[el.name] = el.type === 'checkbox' ? (el.checked ? 'true' : 'false') : el.value;
    });

    try {
      const res = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ config }),
      });
      const data = await parseJSONResponse(res);
      if (!res.ok) {
        setFeedback(data.error || 'Unable to save config', true);
        return;
      }
      // Persist the MFA requirement (separate site setting from env config)
      let extra = '';
      const mfaSel = form.querySelector('[name="mfa_mode"]');
      if (mfaSel) {
        try {
          const mfaRes = await fetch('/api/admin/mfa-config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify({ mfaMode: mfaSel.value }),
          });
          const mfaData = await parseJSONResponse(mfaRes);
          if (!mfaRes.ok) extra = ' (MFA setting not saved: ' + (mfaData.error || 'error') + ')';
        } catch (_mfaErr) {
          extra = ' (MFA setting not saved: network error)';
        }
      }
      // Persist the UI theme (separate site setting; applies without a restart)
      const themeSel = form.querySelector('[name="ui_theme"]');
      if (themeSel) {
        try {
          const themeRes = await fetch('/api/admin/theme-config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify({ theme: themeSel.value }),
          });
          const themeData = await parseJSONResponse(themeRes);
          if (themeRes.ok) { applyTheme(themeSel.value); }
          else { extra += ' (Theme not saved: ' + (themeData.error || 'error') + ')'; }
        } catch (_themeErr) {
          extra += ' (Theme not saved: network error)';
        }
      }
      setFeedback('Configuration saved. Restart the server to apply environment changes.' + extra, Boolean(extra));
    } catch (_err) {
      setFeedback('Network error. Please try again.', true);
    } finally {
      submitBtn.disabled = false;
    }
  });
}

async function initConfigurationPage() {
  const section = document.getElementById('admin-configuration-page');
  if (!section) return;

  const profile = await fetchProfile();
  if (!profile) {
    window.location.href = '/login.html';
    return;
  }

  if (!profileHasRole(profile, 'admin')) {
    window.location.href = '/dashboard.html';
    return;
  }

  section.style.display = 'block';
  initSiteConfig();
}

async function initUserManagementPage() {
  const section = document.getElementById('admin-user-management-page') || document.getElementById('admin-user-management');
  if (!section) return;

  const profile = await fetchProfile();
  if (!profile) {
    window.location.href = '/login.html';
    return;
  }

  if (!profileHasRole(profile, 'admin')) {
    window.location.href = '/dashboard.html';
    return;
  }

  section.style.display = 'block';
  setAdminFeedback('Loading users...', false);
  const result = await fetchAdminUsers();
  if (result.ok && Array.isArray(result.data)) {
    renderAdminUsers(result.data, profile.id);
    setAdminFeedback('Manage users below.', false);
    return;
  }

  setAdminFeedback((result.data && result.data.error) || 'Unable to load users', true);
}

async function initBackupRestorePage() {
  const section = document.getElementById('admin-backup-restore-page');
  if (!section) return;

  const profile = await fetchProfile();
  if (!profile) { window.location.href = '/login.html'; return; }
  if (!profileHasRole(profile, 'admin')) { window.location.href = '/dashboard.html'; return; }

  section.style.display = 'block';

  const token = getToken();
  let currentPage = 1;

  // ── Helpers ──────────────────────────────────────────────────────────────
  function setCreateFeedback(msg, isError) {
    const el = document.getElementById('br-create-feedback');
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? '#b42318' : 'var(--muted)';
  }

  function setListFeedback(msg, isError) {
    const el = document.getElementById('br-list-feedback');
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? '#b42318' : 'var(--muted)';
  }

  function formatDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch { return iso; }
  }

  function typeLabel(type) {
    return type === 'full' ? 'Full' : type === 'files' ? 'Pages & Config' : type === 'database' ? 'Database' : type || '—';
  }

  // ── Location config ──────────────────────────────────────────────────────────
  const locationFeedback = document.getElementById('br-location-feedback');
  function setLocationFeedback(msg, isError) {
    if (!locationFeedback) return;
    locationFeedback.textContent = msg;
    locationFeedback.style.color = isError ? '#b42318' : 'var(--muted)';
  }

  const providerRadios = document.querySelectorAll('input[name="br-provider"]');
  const localFields = document.getElementById('br-local-fields');
  const s3Fields = document.getElementById('br-s3-fields');
  const rcloneFields = document.getElementById('br-rclone-fields');

  function updateProviderFields() {
    const chosen = document.querySelector('input[name="br-provider"]:checked');
    const val = chosen ? chosen.value : 'local';
    if (localFields)   localFields.style.display  = val === 'local'  ? '' : 'none';
    if (s3Fields)      s3Fields.style.display     = val === 's3'     ? '' : 'none';
    if (rcloneFields)  rcloneFields.style.display = val === 'rclone' ? '' : 'none';
  }
  providerRadios.forEach((r) => r.addEventListener('change', updateProviderFields));
  updateProviderFields();

  // Load current location config
  setLocationFeedback('Loading location config…', false);
  try {
    const lcRes = await fetch('/api/admin/backup-location', { headers: { Authorization: 'Bearer ' + token } });
    const lcData = await parseJSONResponse(lcRes);
    if (lcRes.ok) {
      const c = lcData.config || {};
      const radio = document.querySelector(`input[name="br-provider"][value="${c.BACKUP_PROVIDER || 'local'}"]`);
      if (radio) radio.checked = true;
      const lp = document.getElementById('br-local-path');
      if (lp) lp.value = c.BACKUP_LOCAL_PATH || '';
      [
        ['br-s3-bucket', 'BACKUP_S3_BUCKET'],
        ['br-s3-region', 'BACKUP_S3_REGION'],
        ['br-s3-prefix', 'BACKUP_S3_PREFIX'],
        ['br-s3-endpoint', 'BACKUP_S3_ENDPOINT'],
        ['br-s3-key-id', 'BACKUP_AWS_ACCESS_KEY_ID'],
        ['br-s3-secret', 'BACKUP_AWS_SECRET_ACCESS_KEY'],
        ['br-rclone-remote', 'BACKUP_RCLONE_REMOTE'],
        ['br-rclone-folder', 'BACKUP_RCLONE_FOLDER'],
      ].forEach(([elId, key]) => {
        const el = document.getElementById(elId);
        if (el) el.value = c[key] || '';
      });
      updateProviderFields();
      setLocationFeedback('', false);
    } else {
      setLocationFeedback(lcData.error || 'Unable to load config.', true);
    }
  } catch {
    setLocationFeedback('Network error loading config.', true);
  }

  const saveLocationBtn = document.getElementById('br-save-location-btn');
  if (saveLocationBtn) {
    saveLocationBtn.addEventListener('click', async () => {
      saveLocationBtn.disabled = true;
      setLocationFeedback('Saving…', false);
      const chosen = document.querySelector('input[name="br-provider"]:checked');
      const config = {
        BACKUP_PROVIDER: chosen ? chosen.value : 'local',
        BACKUP_LOCAL_PATH: document.getElementById('br-local-path')?.value || '',
        BACKUP_S3_BUCKET: document.getElementById('br-s3-bucket')?.value || '',
        BACKUP_S3_REGION: document.getElementById('br-s3-region')?.value || '',
        BACKUP_S3_PREFIX: document.getElementById('br-s3-prefix')?.value || '',
        BACKUP_S3_ENDPOINT: document.getElementById('br-s3-endpoint')?.value || '',
        BACKUP_AWS_ACCESS_KEY_ID: document.getElementById('br-s3-key-id')?.value || '',
        BACKUP_AWS_SECRET_ACCESS_KEY: document.getElementById('br-s3-secret')?.value || '',
        BACKUP_RCLONE_REMOTE: document.getElementById('br-rclone-remote')?.value || '',
        BACKUP_RCLONE_FOLDER: document.getElementById('br-rclone-folder')?.value || '',
      };
      try {
        const res = await fetch('/api/admin/backup-location', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ config }),
        });
        const data = await parseJSONResponse(res);
        setLocationFeedback(res.ok ? 'Location saved.' : (data.error || 'Unable to save.'), !res.ok);
        if (res.ok) loadBackupList(1);
      } catch {
        setLocationFeedback('Network error. Please try again.', true);
      } finally {
        saveLocationBtn.disabled = false;
      }
    });
  }

  // ── rclone connection test ────────────────────────────────────────────────
  const rcloneStatusLabel = document.getElementById('br-rclone-status-label');
  const rcloneTestBtn     = document.getElementById('br-rclone-test-btn');

  if (rcloneTestBtn) {
    rcloneTestBtn.addEventListener('click', async () => {
      rcloneTestBtn.disabled = true;
      if (rcloneStatusLabel) { rcloneStatusLabel.textContent = 'Testing…'; rcloneStatusLabel.style.color = 'var(--muted)'; }
      try {
        const r = await fetch('/api/admin/backup/rclone-check', { headers: { Authorization: 'Bearer ' + token } });
        const d = await parseJSONResponse(r);
        if (d.ok) {
          if (rcloneStatusLabel) { rcloneStatusLabel.textContent = '✅ Connected to remote "' + d.remote + '"'; rcloneStatusLabel.style.color = '#4ade80'; }
        } else {
          if (rcloneStatusLabel) { rcloneStatusLabel.textContent = '❌ ' + (d.error || 'Connection failed'); rcloneStatusLabel.style.color = '#f87171'; }
        }
      } catch {
        if (rcloneStatusLabel) { rcloneStatusLabel.textContent = '❌ Network error'; rcloneStatusLabel.style.color = '#f87171'; }
      } finally {
        rcloneTestBtn.disabled = false;
      }
    });
  }

  // ── Restore modal ────────────────────────────────────────────────────────
  const modal = document.getElementById('br-restore-modal');
  const modalDesc = document.getElementById('br-modal-desc');
  const modalScopeOptions = document.getElementById('br-modal-scope-options');
  const modalWarning = document.getElementById('br-modal-warning');
  const modalFeedback = document.getElementById('br-modal-feedback');
  const modalConfirm = document.getElementById('br-modal-confirm');
  const modalCancel = document.getElementById('br-modal-cancel');

  function hideRestoreModal() {
    modal.style.display = 'none';
  }

  modalCancel.addEventListener('click', hideRestoreModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) hideRestoreModal(); });

  const modalFilesArea = document.getElementById('br-modal-files-area');
  const modalFileList = document.getElementById('br-modal-file-list');
  const modalRestoreConfig = document.getElementById('br-modal-restore-config');
  const fileSelectAll = document.getElementById('br-file-select-all');
  const fileSelectNone = document.getElementById('br-file-select-none');

  if (fileSelectAll) fileSelectAll.addEventListener('click', () => {
    modalFileList.querySelectorAll('input.br-file-cb').forEach((cb) => { cb.checked = true; });
  });
  if (fileSelectNone) fileSelectNone.addEventListener('click', () => {
    modalFileList.querySelectorAll('input.br-file-cb').forEach((cb) => { cb.checked = false; });
  });

  async function loadBackupFileList(backup) {
    if (!(Array.isArray(backup.contains) && backup.contains.includes('files'))) {
      modalFilesArea.style.display = 'none';
      modalFileList.innerHTML = '';
      return;
    }
    modalFileList.innerHTML = '<div style="font-size:0.82rem;color:var(--muted);">Loading pages…</div>';
    try {
      const res = await fetch(`/api/admin/backups/${encodeURIComponent(backup.id)}/files`, {
        headers: { Authorization: 'Bearer ' + token },
      });
      const data = await parseJSONResponse(res);
      if (!res.ok) throw new Error(data.error || 'Unable to list pages');
      const files = Array.isArray(data.files) ? data.files : [];
      if (files.length === 0) {
        modalFileList.innerHTML = '<div style="font-size:0.82rem;color:var(--muted);">No page files in this backup.</div>';
        return;
      }
      modalFileList.innerHTML = files.map((f) => `
        <label title="${escHtml(f)}">
          <input type="checkbox" class="br-file-cb" value="${escHtml(f)}" checked />
          <span>${escHtml(f)}</span>
        </label>`).join('');
    } catch (err) {
      modalFileList.innerHTML = `<div style="font-size:0.82rem;color:#b42318;">${escHtml(err.message || 'Unable to list pages')}</div>`;
    }
  }

  function getSelectedFiles() {
    return Array.from(modalFileList.querySelectorAll('input.br-file-cb:checked')).map((cb) => cb.value);
  }

  function updateFilesAreaVisibility() {
    const chosen = modalScopeOptions.querySelector('input[name="br-restore-scope"]:checked');
    const val = chosen ? chosen.value : '';
    modalFilesArea.style.display = (val === 'files' || val === 'full') ? 'block' : 'none';
  }


  function showRestoreModal(backup) {
    modalFeedback.textContent = '';
    modalFeedback.style.color = 'var(--muted)';
    modalConfirm.disabled = false;
    if (modalRestoreConfig) modalRestoreConfig.checked = true;

    modalDesc.textContent = `Backup: ${formatDate(backup.created_at)} (${typeLabel(backup.type)})`;

    const contains = Array.isArray(backup.contains) ? backup.contains : [];
    const scopeOptions = [];
    if (contains.includes('files') && contains.includes('database')) {
      scopeOptions.push({ value: 'full', label: 'Full restore (pages & database)' });
    }
    if (contains.includes('files')) {
      scopeOptions.push({ value: 'files', label: 'Pages & config only' });
    }
    if (contains.includes('database')) {
      scopeOptions.push({ value: 'database', label: 'Database only' });
    }

    modalScopeOptions.innerHTML = scopeOptions.map((opt, i) => `
      <label class="br-scope-label">
        <input type="radio" name="br-restore-scope" value="${opt.value}" ${i === 0 ? 'checked' : ''} />
        ${opt.label}
      </label>`).join('');

    function updateWarning() {
      const chosen = modalScopeOptions.querySelector('input[name="br-restore-scope"]:checked');
      const val = chosen ? chosen.value : '';
      modalWarning.style.display = (val === 'database' || val === 'full') ? 'block' : 'none';
    }
    modalScopeOptions.querySelectorAll('input').forEach((r) => r.addEventListener('change', () => { updateWarning(); updateFilesAreaVisibility(); }));
    updateWarning();
    updateFilesAreaVisibility();
    loadBackupFileList(backup);

    modal.style.display = 'flex';

    modalConfirm.onclick = async () => {
      const chosen = modalScopeOptions.querySelector('input[name="br-restore-scope"]:checked');
      if (!chosen) { modalFeedback.textContent = 'Please select a restore scope.'; return; }
      const scope = chosen.value;
      const selectedFiles = getSelectedFiles();
      const restoreConfig = !!(modalRestoreConfig && modalRestoreConfig.checked);
      modalConfirm.disabled = true;
      modalFeedback.textContent = 'Restoring… please wait.';
      modalFeedback.style.color = 'var(--muted)';

      try {
        const res = await fetch(`/api/admin/backups/${encodeURIComponent(backup.id)}/restore`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ scope, selectedFiles, restoreConfig }),
        });
        const data = await parseJSONResponse(res);
        if (!res.ok) {
          modalFeedback.textContent = data.error || 'Restore failed.';
          modalFeedback.style.color = '#b42318';
          modalConfirm.disabled = false;
          return;
        }
        const parts = Array.isArray(data.restored) ? data.restored : [];
        let msg;
        if (parts.length === 0) msg = 'No changes were applied.';
        else if (scope === 'database') msg = `Database restored (${parts.join(', ')}).`;
        else msg = `Restore complete: ${parts.join(', ')}.`;
        modalFeedback.textContent = msg + ' Reload the page to see page changes.';
        modalFeedback.style.color = 'var(--muted)';
        modalConfirm.disabled = true;
      } catch {
        modalFeedback.textContent = 'Network error. Please try again.';
        modalFeedback.style.color = '#b42318';
        modalConfirm.disabled = false;
      }
    };
  }

  // ── Backup list ──────────────────────────────────────────────────────────
  async function loadBackupList(page) {
    const tbody = document.getElementById('br-table-body');
    const pager = document.getElementById('br-pagination');
    tbody.innerHTML = '<tr><td colspan="6" class="br-empty">Loading…</td></tr>';
    pager.innerHTML = '';
    setListFeedback('', false);

    try {
      const res = await fetch(`/api/admin/backups?page=${page}`, {
        headers: { Authorization: 'Bearer ' + token },
      });
      const data = await parseJSONResponse(res);
      if (!res.ok) { setListFeedback(data.error || 'Unable to load backups.', true); tbody.innerHTML = '<tr><td colspan="6" class="br-empty">—</td></tr>'; return; }

      const { items, total, totalPages } = data;
      currentPage = data.page;

      if (!items || items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="br-empty">No backups yet.</td></tr>';
        return;
      }

      tbody.innerHTML = items.map((b) => {
        const contains = Array.isArray(b.contains) ? b.contains : [];
        const badges = [
          contains.includes('files') ? '<span class="br-badge">Files</span>' : '',
          contains.includes('database') ? '<span class="br-badge db">DB</span>' : '',
        ].join('');
        return `
          <tr>
            <td style="white-space:nowrap;">${formatDate(b.created_at)}</td>
            <td>${typeLabel(b.type)}</td>
            <td style="font-size:0.82rem; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escHtml(b.label || '')}">${b.label ? escHtml(b.label) : '<span style="color:var(--muted)">—</span>'}</td>
            <td style="color:var(--muted); font-size:0.82rem;">${b.created_by || '—'}</td>
            <td>${badges || '—'}</td>
            <td style="white-space:nowrap;">
              <button class="br-action-btn" data-action="restore" data-id="${b.id}">Restore</button>
              <button class="br-action-btn danger" data-action="delete" data-id="${b.id}">Delete</button>
            </td>
          </tr>`;
      }).join('');

      // Wire row buttons
      tbody.querySelectorAll('button[data-action]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const { action, id } = btn.dataset;
          const backup = items.find((b) => b.id === id);
          if (!backup) return;

          if (action === 'restore') {
            showRestoreModal(backup);
          } else if (action === 'delete') {
            if (!window.confirm(`Delete backup from ${formatDate(backup.created_at)}? This cannot be undone.`)) return;
            btn.disabled = true;
            setListFeedback('Deleting…', false);
            try {
              const res2 = await fetch(`/api/admin/backups/${encodeURIComponent(id)}`, {
                method: 'DELETE',
                headers: { Authorization: 'Bearer ' + token },
              });
              const d2 = await parseJSONResponse(res2);
              if (!res2.ok) { setListFeedback(d2.error || 'Delete failed.', true); btn.disabled = false; return; }
              setListFeedback('Backup deleted.', false);
              loadBackupList(currentPage);
            } catch {
              setListFeedback('Network error.', true);
              btn.disabled = false;
            }
          }
        });
      });

      // Pagination
      if (totalPages > 1) {
        const prevBtn = document.createElement('button');
        prevBtn.className = 'br-page-btn';
        prevBtn.textContent = '← Prev';
        prevBtn.disabled = currentPage <= 1;
        prevBtn.addEventListener('click', () => loadBackupList(currentPage - 1));
        pager.appendChild(prevBtn);

        for (let p = 1; p <= totalPages; p++) {
          const pb = document.createElement('button');
          pb.className = 'br-page-btn' + (p === currentPage ? ' active' : '');
          pb.textContent = String(p);
          pb.addEventListener('click', () => loadBackupList(p));
          pager.appendChild(pb);
        }

        const nextBtn = document.createElement('button');
        nextBtn.className = 'br-page-btn';
        nextBtn.textContent = 'Next →';
        nextBtn.disabled = currentPage >= totalPages;
        nextBtn.addEventListener('click', () => loadBackupList(currentPage + 1));
        pager.appendChild(nextBtn);

        const info = document.createElement('span');
        info.style.cssText = 'font-size:0.8rem; color:var(--muted); margin-left:0.5rem;';
        info.textContent = `${total} backup${total !== 1 ? 's' : ''}`;
        pager.appendChild(info);
      }
    } catch {
      setListFeedback('Network error loading backups.', true);
      tbody.innerHTML = '<tr><td colspan="6" class="br-empty">—</td></tr>';
    }
  }

  // ── Create backup ────────────────────────────────────────────────────────
  const createBtn = document.getElementById('br-create-btn');
  createBtn.addEventListener('click', async () => {
    const checked = document.querySelector('input[name="br-create-type"]:checked');
    const type = checked ? checked.value : 'full';
    const labelInput = document.getElementById('br-create-label');
    const label = labelInput ? labelInput.value.trim().slice(0, 120) : '';
    createBtn.disabled = true;
    setCreateFeedback('Creating backup… this may take a moment.', false);

    try {
      const res = await fetch('/api/admin/backups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ type, label }),
      });
      const data = await parseJSONResponse(res);
      if (!res.ok) {
        setCreateFeedback(data.error || 'Unable to create backup.', true);
      } else {
        setCreateFeedback(`Backup created: ${formatDate(data.backup.created_at)}`, false);
        if (labelInput) labelInput.value = '';
        loadBackupList(1);
      }
    } catch {
      setCreateFeedback('Network error. Please try again.', true);
    } finally {
      createBtn.disabled = false;
    }
  });

  // ── Automatic backup schedule ──────────────────────────────────────────
  const schedEnabled  = document.getElementById('br-sched-enabled');
  const schedFields   = document.getElementById('br-sched-fields');
  const schedFreq     = document.getElementById('br-sched-frequency');
  const schedTime     = document.getElementById('br-sched-time');
  const schedDow      = document.getElementById('br-sched-dow');
  const schedDom      = document.getElementById('br-sched-dom');
  const schedType     = document.getElementById('br-sched-type');
  const schedRetention = document.getElementById('br-sched-retention');
  const schedDowGroup = document.getElementById('br-sched-dow-group');
  const schedDomGroup = document.getElementById('br-sched-dom-group');
  const schedNext     = document.getElementById('br-sched-next');
  const schedFeedback = document.getElementById('br-sched-feedback');
  const schedSaveBtn  = document.getElementById('br-sched-save-btn');

  function setSchedFeedback(msg, isError) {
    if (!schedFeedback) return;
    schedFeedback.textContent = msg;
    schedFeedback.style.color = isError ? '#b42318' : 'var(--muted)';
  }

  function updateSchedFields() {
    const on = schedEnabled ? schedEnabled.checked : false;
    if (schedFields) schedFields.style.display = on ? '' : 'none';
    const val = schedFreq ? schedFreq.value : 'daily';
    if (schedDowGroup) schedDowGroup.style.display = on && val === 'weekly' ? '' : 'none';
    if (schedDomGroup) schedDomGroup.style.display = on && val === 'monthly' ? '' : 'none';
  }

  function computeNextScheduledBackupClient(sched) {
    const at = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), sched.hour, sched.minute, 0, 0);
    const now = new Date();
    if (sched.frequency === 'daily') {
      let c = at(now);
      if (c <= now) c = new Date(c.getTime() + 24 * 60 * 60 * 1000);
      return c;
    }
    if (sched.frequency === 'weekly') {
      let c = at(now), g = 0;
      while (c.getDay() !== sched.dow || c <= now) { c = new Date(c.getTime() + 24 * 60 * 60 * 1000); if (++g > 14) break; }
      return c;
    }
    let y = now.getFullYear(), mo = now.getMonth();
    const tryMonth = () => {
      const days = new Date(y, mo + 1, 0).getDate();
      const dom = Math.min(sched.dom, days);
      return new Date(y, mo, dom, sched.hour, sched.minute, 0, 0);
    };
    let c = tryMonth();
    if (c <= now) { mo += 1; if (mo > 11) { mo = 0; y += 1; } c = tryMonth(); }
    return c;
  }

  function renderSchedNext() {
    if (!schedNext) return;
    if (!schedEnabled || !schedEnabled.checked) { schedNext.textContent = ''; return; }
    try {
      const [h, m] = (schedTime && schedTime.value ? schedTime.value : '03:00').split(':').map(Number);
      const sched = {
        enabled: true,
        frequency: schedFreq ? schedFreq.value : 'daily',
        hour: Number.isFinite(h) ? h : 3,
        minute: Number.isFinite(m) ? m : 0,
        dow: schedDow ? Number(schedDow.value) : 0,
        dom: schedDom ? Number(schedDom.value) : 1,
        type: schedType ? schedType.value : 'full',
      };
      const next = computeNextScheduledBackupClient(sched);
      const keepNote = (schedRetention && Number(schedRetention.value) > 0) ? ' · keeping last ' + Number(schedRetention.value) : '';
      schedNext.textContent = 'Next run: ' + next.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) + keepNote + ' (server local time)';
    } catch {
      schedNext.textContent = '';
    }
  }

  if (schedEnabled)  schedEnabled.addEventListener('change', () => { updateSchedFields(); renderSchedNext(); });
  if (schedFreq)     schedFreq.addEventListener('change', () => { updateSchedFields(); renderSchedNext(); });
  if (schedTime)     schedTime.addEventListener('input', renderSchedNext);
  if (schedDow)      schedDow.addEventListener('change', renderSchedNext);
  if (schedDom)      schedDom.addEventListener('change', renderSchedNext);
  if (schedType)      schedType.addEventListener('change', renderSchedNext);

  async function loadSchedule() {
    try {
      const res = await fetch('/api/admin/backup-schedule', { headers: { Authorization: 'Bearer ' + token } });
      const data = await parseJSONResponse(res);
      if (!res.ok) return;
      const c = data.config || {};
      if (schedEnabled) schedEnabled.checked = (c.BACKUP_SCHEDULE_ENABLED || 'false') === 'true';
      if (schedFreq) schedFreq.value = c.BACKUP_SCHEDULE_FREQUENCY || 'daily';
      const hh = String(c.BACKUP_SCHEDULE_HOUR || '3').padStart(2, '0');
      const mm = String(c.BACKUP_SCHEDULE_MINUTE || '0').padStart(2, '0');
      if (schedTime) schedTime.value = `${hh}:${mm}`;
      if (schedDow) schedDow.value = c.BACKUP_SCHEDULE_DOW || '0';
      if (schedDom) schedDom.value = c.BACKUP_SCHEDULE_DOM || '1';
      if (schedType) schedType.value = c.BACKUP_SCHEDULE_TYPE || 'full';
      if (schedRetention) schedRetention.value = c.BACKUP_SCHEDULE_RETENTION || '0';
      updateSchedFields();
      renderSchedNext();
    } catch { /* ignore */ }
  }

  if (schedSaveBtn) {
    schedSaveBtn.addEventListener('click', async () => {
      schedSaveBtn.disabled = true;
      setSchedFeedback('Saving…', false);
      const [h, m] = (schedTime && schedTime.value ? schedTime.value : '03:00').split(':').map(Number);
      const config = {
        BACKUP_SCHEDULE_ENABLED: schedEnabled && schedEnabled.checked ? 'true' : 'false',
        BACKUP_SCHEDULE_FREQUENCY: schedFreq ? schedFreq.value : 'daily',
        BACKUP_SCHEDULE_HOUR: String(Number.isFinite(h) ? h : 3),
        BACKUP_SCHEDULE_MINUTE: String(Number.isFinite(m) ? m : 0),
        BACKUP_SCHEDULE_DOW: schedDow ? String(Number(schedDow.value) || 0) : '0',
        BACKUP_SCHEDULE_DOM: schedDom ? String(Number(schedDom.value) || 1) : '1',
        BACKUP_SCHEDULE_TYPE: schedType ? schedType.value : 'full',
        BACKUP_SCHEDULE_RETENTION: schedRetention ? String(Number(schedRetention.value) || 0) : '0',
      };
      try {
        const res = await fetch('/api/admin/backup-schedule', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ config }),
        });
        const data = await parseJSONResponse(res);
        setSchedFeedback(res.ok ? 'Schedule saved.' : (data.error || 'Unable to save.'), !res.ok);
        if (res.ok) renderSchedNext();
      } catch {
        setSchedFeedback('Network error. Please try again.', true);
      } finally {
        schedSaveBtn.disabled = false;
      }
    });
  }

  loadSchedule();



  loadBackupList(1);
}

// ── Shop: Member-facing page ──────────────────────────────────────────────
async function initShopPage() {
  const pageContent = document.getElementById('shop-page-content');
  if (!pageContent) return;

  const token = getToken();
  if (!token) { window.location.href = '/login.html'; return; }

  pageContent.style.display = '';

  // Show "Manage Store" button for admins and store admins
  const profile = await fetchProfile();
  if (profile && (profileHasRole(profile, 'store_admin'))) {
    const manageBtn = document.getElementById('shop-manage-btn');
    if (manageBtn) manageBtn.style.display = '';
  }

  let cartItems = [];

  // ── Cart helpers ────────────────────────────────────────────────────────
  const cartOverlay = document.getElementById('shop-cart-overlay');
  const cartDrawer  = document.getElementById('shop-cart-drawer');
  const cartClose   = document.getElementById('shop-cart-close');
  const cartItemsEl = document.getElementById('shop-cart-items');
  const cartTotalEl = document.getElementById('shop-cart-total-val');
  const cartCountEl = document.getElementById('shop-cart-count');
  const openCartBtn = document.getElementById('shop-open-cart-btn');
  const checkoutBtn = document.getElementById('shop-checkout-btn');
  const cartFeedEl  = document.getElementById('shop-cart-feedback');

  function openCart()  { cartOverlay.classList.add('is-open');  cartDrawer.classList.add('is-open'); exitPaymentMode(); }
  function closeCart() { cartOverlay.classList.remove('is-open'); cartDrawer.classList.remove('is-open'); }
  openCartBtn.addEventListener('click', openCart);
  cartClose.addEventListener('click', closeCart);
  cartOverlay.addEventListener('click', closeCart);

  function fmtPrice(v) { return '$' + parseFloat(v).toFixed(2); }

  // Computes cart totals including coupon discounts (mirrors the server's
  // computeCartPricing). Coupon lines discount the subtotal of their eligible
  // products by a percentage or a fixed amount.
  function computeCartTotals(items) {
    const coupons = items.filter((i) => i.is_coupon);
    const goods = items.filter((i) => !i.is_coupon);
    const subtotal = goods.reduce((s, i) => s + parseFloat(i.price) * i.quantity, 0);
    const discountByItemId = {};
    let totalDiscount = 0;
    coupons.forEach((c) => {
      let targets = c.coupon_product_ids || [];
      if (typeof targets === 'string') { try { targets = JSON.parse(targets); } catch { targets = []; } }
      const set = new Set((Array.isArray(targets) ? targets : []).map(Number));
      const eligible = goods
        .filter((g) => set.has(Number(g.product_id)))
        .reduce((s, g) => s + parseFloat(g.price) * g.quantity, 0);
      const val = parseFloat(c.coupon_discount_value) || 0;
      let d = c.coupon_discount_type === 'percent' ? eligible * (val / 100) : Math.min(val, eligible);
      d = Math.max(0, Math.round(d * 100) / 100);
      discountByItemId[c.id] = d;
      totalDiscount += d;
    });
    const total = Math.max(0, Math.round((subtotal - totalDiscount) * 100) / 100);
    return { subtotal, totalDiscount, total, discountByItemId };
  }

  // Member directory for the "pay on behalf of" picker on membership/guest
  // cart lines. Loaded lazily and cached; a null value means "not loaded yet".
  let shopMembers = null;
  let shopMembersLoading = false;
  async function ensureShopMembersLoaded() {
    if (shopMembers !== null || shopMembersLoading) return;
    shopMembersLoading = true;
    try {
      const res = await fetch('/api/shop/members', { headers: { Authorization: 'Bearer ' + token } });
      const data = await parseJSONResponse(res);
      shopMembers = res.ok && Array.isArray(data.members) ? data.members : [];
    } catch { shopMembers = []; }
    shopMembersLoading = false;
    renderCart();
  }

  async function updateCartBeneficiary(itemId, beneficiaryId) {
    try {
      const res = await fetch(`/api/shop/cart/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ beneficiary_user_id: beneficiaryId || null }),
      });
      if (res.ok) await loadCart();
    } catch { /* leave the cart as-is on network error */ }
  }

  function renderCart() {
    const totals = computeCartTotals(cartItems);
    cartTotalEl.textContent = fmtPrice(totals.total);
    cartCountEl.textContent = cartItems.reduce((s, i) => s + i.quantity, 0);
    if (cartItems.length === 0) {
      cartItemsEl.innerHTML = '<p class="shop-cart-empty">Your cart is empty.</p>';
      return;
    }
    const needsMembers = cartItems.some((i) => i.fulfills_membership || i.fulfills_guest);
    if (needsMembers && shopMembers === null) ensureShopMembersLoaded();
    cartItemsEl.innerHTML = '';
    cartItems.forEach((item) => {
      const div = document.createElement('div');
      div.className = 'shop-cart-item';
      const nameHtml = `${escHtml(item.name)}${item.size ? ` <span style="color:var(--muted);font-size:0.82em;">(${escHtml(item.size)})</span>` : ''}`;
      const isCoupon = item.is_coupon === true;
      const controlsHtml = (item.is_donation || isCoupon)
        ? `<div class="shop-cart-item-controls"><span class="shop-cart-qty-val">${isCoupon ? 'Coupon' : 'Donation'}</span></div>`
        : `<div class="shop-cart-item-controls">
          <button class="shop-cart-qty-btn" data-action="dec" data-id="${item.id}">−</button>
          <span class="shop-cart-qty-val">${item.quantity}</span>
          <button class="shop-cart-qty-btn" data-action="inc" data-id="${item.id}">+</button>
        </div>`;
      const priceHtml = isCoupon
        ? `−${fmtPrice(totals.discountByItemId[item.id] || 0)}`
        : fmtPrice(parseFloat(item.price) * item.quantity);
      let beneficiaryHtml = '';
      if (item.fulfills_membership || item.fulfills_guest) {
        const fee = item.fulfills_membership ? 'membership dues' : 'guest fee';
        const selected = String(item.beneficiary_user_id || '');
        const opts = ['<option value="">Myself</option>']
          .concat((shopMembers || []).map((m) =>
            `<option value="${m.id}"${String(m.id) === selected ? ' selected' : ''}>${escHtml(m.full_name || ('Member #' + m.id))}</option>`))
          .join('');
        beneficiaryHtml = `
          <div class="shop-cart-item-beneficiary">
            <label>Apply ${fee} to</label>
            <select data-beneficiary-for="${item.id}" ${shopMembers === null ? 'disabled' : ''}>${opts}</select>
          </div>`;
      }
      div.innerHTML = `
        <span class="shop-cart-item-name">${nameHtml}</span>
        <span class="shop-cart-item-price">${priceHtml}</span>
        ${controlsHtml}
        <button class="shop-cart-item-remove" data-id="${item.id}">Remove</button>
        ${beneficiaryHtml}
      `;
      cartItemsEl.appendChild(div);
    });
    cartItemsEl.querySelectorAll('select[data-beneficiary-for]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const id = parseInt(sel.dataset.beneficiaryFor, 10);
        updateCartBeneficiary(id, sel.value);
      });
    });
    cartItemsEl.querySelectorAll('.shop-cart-qty-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id, 10);
        const item = cartItems.find((i) => i.id === id);
        if (!item) return;
        const newQty = btn.dataset.action === 'inc' ? item.quantity + 1 : item.quantity - 1;
        await updateCartQty(id, newQty);
      });
    });
    cartItemsEl.querySelectorAll('.shop-cart-item-remove').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id, 10);
        await removeCartItem(id);
      });
    });
  }

  async function loadCart() {
    try {
      const res = await fetch('/api/shop/cart', { headers: { Authorization: 'Bearer ' + token } });
      const data = await parseJSONResponse(res);
      cartItems = res.ok ? data.items : [];
      renderCart();
    } catch { cartItems = []; renderCart(); }
  }

  async function postCartItem(productId, size) {
    const res = await fetch('/api/shop/cart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ product_id: productId, quantity: 1, size: size || '' }),
    });
    const data = await parseJSONResponse(res);
    return { ok: res.ok, data };
  }

  async function addToCart(productId, size) {
    const btn = document.querySelector(`.shop-add-btn[data-product-id="${productId}"]`);
    if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
    try {
      const { ok, data } = await postCartItem(productId, size);
      if (!ok) {
        if (btn) { btn.disabled = false; btn.textContent = 'Add to Cart'; }
        alert(data.error || 'Unable to add to cart');
        return;
      }
      await loadCart();
      if (btn) {
        btn.textContent = 'Added ✓';
        btn.style.background = '#166534';
        btn.style.color = '#fff';
        setTimeout(() => {
          btn.disabled = false;
          btn.textContent = 'Add to Cart';
          btn.style.background = '';
          btn.style.color = '';
        }, 1500);
      }
    } catch {
      if (btn) { btn.disabled = false; btn.textContent = 'Add to Cart'; }
      alert('Network error. Please try again.');
    }
  }

  async function updateCartQty(itemId, qty) {
    try {
      const res = await fetch(`/api/shop/cart/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ quantity: qty }),
      });
      if (res.ok) await loadCart();
    } catch { /* ignore */ }
  }

  async function removeCartItem(itemId) {
    try {
      await fetch(`/api/shop/cart/${itemId}`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + token },
      });
      await loadCart();
    } catch { /* ignore */ }
  }

  let simulatePayment = false;
  let paypalConfigured = false;
  let stripeConfigured = false;
  let activeMethod = 'paypal';
  let paymentMode = false;
  // Set by setupStripePayment so the payment-mode handlers can mount/tear down
  // the Stripe Payment Element when the card UI is shown or cancelled.
  let mountStripeCardEl = null;
  let unmountStripeCardEl = null;

  async function completeOrder() {
    checkoutBtn.disabled = true;
    checkoutBtn.style.display = '';
    cartFeedEl.innerHTML = '';
    cartFeedEl.style.color = 'var(--muted)';
    cartFeedEl.textContent = 'Placing order…';
    try {
      const res = await fetch('/api/shop/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({}),
      });
      const data = await parseJSONResponse(res);
      if (res.ok) {
        cartFeedEl.style.color = '#4ade80';
        cartFeedEl.textContent = `Order #${data.order_id} placed! Total: $${parseFloat(data.total).toFixed(2)}`;
        await loadCart();
        document.querySelectorAll('.shop-tab-btn').forEach((b) => b.classList.remove('is-active'));
        document.querySelectorAll('.shop-panel').forEach((p) => p.classList.remove('is-active'));
        const ordersBtn = document.querySelector('[data-shop-tab="orders"]');
        const ordersPanel = document.querySelector('[data-shop-panel="orders"]');
        if (ordersBtn) ordersBtn.classList.add('is-active');
        if (ordersPanel) ordersPanel.classList.add('is-active');
        closeCart();
        loadOrders();
      } else {
        cartFeedEl.style.color = '#f87171';
        cartFeedEl.textContent = data.error || 'Checkout failed.';
      }
    } catch {
      cartFeedEl.style.color = '#f87171';
      cartFeedEl.textContent = 'Network error.';
    }
    checkoutBtn.disabled = false;
  }

  checkoutBtn.addEventListener('click', async () => {
    if (cartItems.length === 0) { cartFeedEl.textContent = 'Your cart is empty.'; return; }
    if (!simulatePayment && (paypalConfigured || stripeConfigured)) {
      enterPaymentMode();
      return;
    }
    if (simulatePayment) {
      checkoutBtn.style.display = 'none';
      const total = computeCartTotals(cartItems).total.toFixed(2);
      cartFeedEl.style.color = '';
      cartFeedEl.innerHTML = `
        <div style="text-align:center;padding:0.4rem 0;">
          <p style="margin:0 0 0.35rem;font-size:0.82rem;color:#ffd262;font-weight:600;">&#x1F9EA; Simulated Payment &mdash; $${total}</p>
          <div style="display:flex;gap:0.5rem;justify-content:center;">
            <button id="sim-accept" class="button" style="font-size:0.82rem;padding:0.4rem 0.9rem;">Accept</button>
            <button id="sim-decline" class="button secondary" style="font-size:0.82rem;padding:0.4rem 0.9rem;border-color:#f87171;color:#f87171;">Decline</button>
          </div>
        </div>
      `;
      document.getElementById('sim-accept').addEventListener('click', () => completeOrder());
      document.getElementById('sim-decline').addEventListener('click', () => {
        cartFeedEl.innerHTML = '';
        cartFeedEl.style.color = '#f87171';
        cartFeedEl.textContent = 'Payment declined.';
        checkoutBtn.style.display = '';
      });
      return;
    }
    await completeOrder();
  });

  // ── Products ─────────────────────────────────────────────────────────────
  let allProducts = [];
  let activeCategory = 'all';
  // Multi-select state: product id -> chosen size (string, '' when sizeless).
  const selectedProducts = new Map();

  function updateBatchBar() {
    const bar = document.getElementById('shop-batch-bar');
    const info = document.getElementById('shop-batch-info');
    if (!bar) return;
    const count = selectedProducts.size;
    bar.style.display = count > 0 ? 'flex' : 'none';
    if (info) info.textContent = count + ' item' + (count === 1 ? '' : 's') + ' selected';
  }

  function clearSelection() {
    selectedProducts.clear();
    document.querySelectorAll('.shop-select-cb').forEach((cb) => { cb.checked = false; });
    document.querySelectorAll('.shop-product-card.is-selected').forEach((c) => c.classList.remove('is-selected'));
    updateBatchBar();
  }

  async function addSelectedToCart() {
    if (selectedProducts.size === 0) return;
    const feed = document.getElementById('shop-product-feedback');
    // Any selected sized product must have a size chosen first.
    const missing = [];
    selectedProducts.forEach((size, id) => {
      const p = allProducts.find((x) => x.id === id);
      if (!p) return;
      const sizes = (p.sizes || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (sizes.length && !size) missing.push(p.name);
    });
    if (missing.length) {
      if (feed) { feed.style.color = '#f87171'; feed.textContent = 'Please choose a size for: ' + missing.join(', ') + '.'; }
      return;
    }

    const addBtn = document.getElementById('shop-batch-add');
    if (addBtn) { addBtn.disabled = true; addBtn.textContent = 'Adding…'; }
    const entries = Array.from(selectedProducts.entries());
    const failed = [];
    for (const [id, size] of entries) {
      try {
        const { ok, data } = await postCartItem(id, size);
        if (!ok) {
          const p = allProducts.find((x) => x.id === id);
          failed.push((p ? p.name : 'Item') + (data && data.error ? ' (' + data.error + ')' : ''));
        }
      } catch {
        const p = allProducts.find((x) => x.id === id);
        failed.push((p ? p.name : 'Item') + ' (network error)');
      }
    }
    await loadCart();
    const added = entries.length - failed.length;
    clearSelection();
    if (addBtn) { addBtn.disabled = false; addBtn.textContent = 'Add Selected to Cart'; }
    if (feed) {
      if (failed.length) {
        feed.style.color = '#f87171';
        feed.textContent = added + ' added. Could not add: ' + failed.join(', ') + '.';
      } else {
        feed.style.color = '#4ade80';
        feed.textContent = added + ' item' + (added === 1 ? '' : 's') + ' added to cart.';
      }
    }
    if (added > 0) openCart();
  }

  async function loadProducts() {
    const feedEl = document.getElementById('shop-product-feedback');
    feedEl.textContent = 'Loading products…';
    try {
      const res = await fetch('/api/shop/products', { headers: { Authorization: 'Bearer ' + token } });
      const data = await parseJSONResponse(res);
      if (!res.ok) { feedEl.textContent = data.error || 'Unable to load products.'; return; }
      allProducts = data.products;
      feedEl.textContent = '';
      renderFilters();
      renderProducts();
      renderDonation();

      const batchAddBtn = document.getElementById('shop-batch-add');
      const batchClearBtn = document.getElementById('shop-batch-clear');
      if (batchAddBtn && !batchAddBtn.dataset.bound) {
        batchAddBtn.dataset.bound = 'true';
        batchAddBtn.addEventListener('click', addSelectedToCart);
      }
      if (batchClearBtn && !batchClearBtn.dataset.bound) {
        batchClearBtn.dataset.bound = 'true';
        batchClearBtn.addEventListener('click', clearSelection);
      }
      updateBatchBar();
    } catch { feedEl.textContent = 'Network error loading products.'; }
  }

  function renderFilters() {
    const filterEl = document.getElementById('shop-filters');
    const categories = ['all', ...new Set(allProducts.filter((p) => !p.is_donation).map((p) => p.category).filter(Boolean))];
    filterEl.innerHTML = '';
    categories.forEach((cat) => {
      const btn = document.createElement('button');
      btn.className = 'shop-filter-btn' + (cat === activeCategory ? ' is-active' : '');
      btn.textContent = cat === 'all' ? 'All' : cat;
      btn.addEventListener('click', () => {
        activeCategory = cat;
        filterEl.querySelectorAll('.shop-filter-btn').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        renderProducts();
      });
      filterEl.appendChild(btn);
    });
  }

  function renderProducts() {
    const grid = document.getElementById('shop-grid');
    const shopProducts = allProducts.filter((p) => !p.is_donation);
    const filtered = activeCategory === 'all'
      ? shopProducts
      : shopProducts.filter((p) => p.category === activeCategory);

    if (filtered.length === 0) {
      grid.innerHTML = '<p style="color:var(--muted);">No products found.</p>';
      return;
    }

    grid.innerHTML = '';
    filtered.forEach((p) => {
      const outOfStock = p.stock_qty != null && p.stock_qty <= 0;
      const sizes = (p.sizes || '').split(',').map((s) => s.trim()).filter(Boolean);
      // Restore any prior selection/size so it survives filter re-renders.
      let selectedSize = selectedProducts.has(p.id) ? (selectedProducts.get(p.id) || '') : '';
      const card = document.createElement('div');
      card.className = 'shop-product-card' + (selectedProducts.has(p.id) ? ' is-selected' : '');
      const imgHtml = p.image_path
        ? `<img class="shop-product-img" src="${escHtml(p.image_path)}" alt="${escHtml(p.name)}" loading="lazy" />`
        : `<div class="shop-product-img-placeholder">🛍</div>`;
      const selectHtml = outOfStock
        ? ''
        : `<label class="shop-select-overlay"><input type="checkbox" class="shop-select-cb" data-product-id="${p.id}" ${selectedProducts.has(p.id) ? 'checked' : ''} /> Select</label>`;
      const sizesHtml = sizes.length
        ? `<div class="shop-size-label">${p.size_label ? escHtml(p.size_label) : 'Size'}</div><div class="shop-size-chips">${sizes.map((s) => `<button type="button" class="shop-size-chip${s === selectedSize ? ' is-active' : ''}" data-size="${escHtml(s)}">${escHtml(s)}</button>`).join('')}</div>`
        : '';
      card.innerHTML = `
        ${selectHtml}
        ${imgHtml}
        <div class="shop-product-body">
          ${p.category ? `<span class="shop-product-category">${escHtml(p.category)}</span>` : ''}
          <h3 class="shop-product-name">${escHtml(p.name)}</h3>
          ${p.description ? `<p class="shop-product-desc">${escHtml(p.description)}</p>` : ''}
          ${p.is_coupon ? `<p class="shop-product-desc" style="color:#c4b5fd;">Coupon: ${p.coupon_discount_type === 'percent' ? (parseFloat(p.coupon_discount_value) || 0) + '% off' : fmtPrice(p.coupon_discount_value || 0) + ' off'} eligible items.</p>` : ''}
          ${sizesHtml}
          <div class="shop-product-footer">
            <span class="shop-product-price">${fmtPrice(p.price)}</span>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:0.25rem;">
              ${p.stock_qty != null ? `<span class="shop-product-stock">${p.stock_qty} left</span>` : ''}
              <button class="shop-add-btn" data-product-id="${p.id}" ${outOfStock ? 'disabled' : ''}>
                ${outOfStock ? 'Out of Stock' : 'Add to Cart'}
              </button>
            </div>
          </div>
        </div>
      `;
      card.querySelectorAll('.shop-size-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          selectedSize = chip.dataset.size;
          card.querySelectorAll('.shop-size-chip').forEach((c) => c.classList.remove('is-active'));
          chip.classList.add('is-active');
          // Keep the multi-select size in sync when the item is selected.
          if (selectedProducts.has(p.id)) selectedProducts.set(p.id, selectedSize);
        });
      });
      const selectCb = card.querySelector('.shop-select-cb');
      if (selectCb) {
        selectCb.addEventListener('change', () => {
          if (selectCb.checked) {
            selectedProducts.set(p.id, selectedSize);
            card.classList.add('is-selected');
          } else {
            selectedProducts.delete(p.id);
            card.classList.remove('is-selected');
          }
          updateBatchBar();
        });
      }
      card.querySelector('.shop-add-btn:not(:disabled)')?.addEventListener('click', () => {
        if (sizes.length && !selectedSize) {
          const feed = document.getElementById('shop-product-feedback');
          if (feed) { feed.style.color = '#f87171'; feed.textContent = `Please choose a size for ${p.name}.`; }
          return;
        }
        addToCart(p.id, selectedSize);
      });
      grid.appendChild(card);
    });
    updateBatchBar();
  }

  function renderDonation() {
    const mount = document.getElementById('shop-donation-mount');
    if (!mount) return;
    const donation = allProducts.find((p) => p.is_donation);
    if (!donation) { mount.innerHTML = ''; return; }
    mount.innerHTML = `
      <div class="shop-donation">
        <h3 class="shop-donation-title">${escHtml(donation.name || 'Add a donation')}</h3>
        ${donation.description ? `<p class="shop-donation-desc">${escHtml(donation.description)}</p>` : ''}
        <div class="shop-donation-row">
          <div class="shop-donation-input-wrap">
            <span class="shop-donation-currency">$</span>
            <input id="shop-donation-amount" class="shop-donation-input" type="number" min="1" step="0.01" placeholder="0.00" inputmode="decimal" />
          </div>
          <button id="shop-donation-add" class="shop-add-btn">Add Donation</button>
        </div>
        <div id="shop-donation-feedback" class="shop-donation-feedback"></div>
      </div>
    `;
    const input = document.getElementById('shop-donation-amount');
    const addBtn = document.getElementById('shop-donation-add');
    addBtn.addEventListener('click', () => addDonation(parseFloat(input.value)));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') addDonation(parseFloat(input.value)); });
  }

  async function addDonation(amount) {
    const feed = document.getElementById('shop-donation-feedback');
    if (!isFinite(amount) || amount <= 0) {
      if (feed) { feed.style.color = '#f87171'; feed.textContent = 'Enter a donation amount greater than $0.'; }
      return;
    }
    const addBtn = document.getElementById('shop-donation-add');
    if (addBtn) { addBtn.disabled = true; addBtn.textContent = 'Adding…'; }
    try {
      const res = await fetch('/api/shop/donation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ amount }),
      });
      const data = await parseJSONResponse(res);
      if (!res.ok) {
        if (feed) { feed.style.color = '#f87171'; feed.textContent = data.error || 'Unable to add donation.'; }
        return;
      }
      await loadCart();
      if (feed) { feed.style.color = '#4ade80'; feed.textContent = 'Donation added to cart. Thank you!'; }
      openCart();
    } catch {
      if (feed) { feed.style.color = '#f87171'; feed.textContent = 'Network error. Please try again.'; }
    } finally {
      if (addBtn) { addBtn.disabled = false; addBtn.textContent = 'Add Donation'; }
    }
  }

  // ── Orders ───────────────────────────────────────────────────────────────
  async function loadOrders() {
    const feedEl = document.getElementById('shop-orders-feedback');
    const listEl = document.getElementById('shop-orders-list');
    const pagEl  = document.getElementById('shop-orders-pagination');
    feedEl.textContent = 'Loading orders…';
    try {
      const res = await fetch('/api/shop/orders', { headers: { Authorization: 'Bearer ' + token } });
      const data = await parseJSONResponse(res);
      feedEl.textContent = '';
      if (pagEl) pagEl.innerHTML = '';
      if (!res.ok) { listEl.innerHTML = `<p style="color:#f87171;">${data.error || 'Unable to load orders.'}</p>`; return; }
      if (data.orders.length === 0) { listEl.innerHTML = '<p style="color:var(--muted);">No orders yet.</p>'; return; }

      const perPage = 5;
      const pageCount = Math.ceil(data.orders.length / perPage);

      function renderOrdersPage(page) {
        const start = (page - 1) * perPage;
        const pageOrders = data.orders.slice(start, start + perPage);
        listEl.innerHTML = '';
        pageOrders.forEach((o) => {
          const div = document.createElement('div');
          div.className = 'shop-order-card';
          const itemLines = (o.items || []).map((i) =>
            `${escHtml(i.product_name)}${i.size ? ` (${escHtml(i.size)})` : ''} × ${i.quantity} — ${fmtPrice(parseFloat(i.unit_price) * i.quantity)}`
          ).join('<br>');
          div.innerHTML = `
            <div class="shop-order-head">
              <span class="shop-order-id">Order #${o.id}</span>
              <span class="shop-order-date">${new Date(o.created_at).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' })}</span>
              <span class="shop-order-total">${fmtPrice(o.total_amount)}</span>
              <span class="shop-order-status ${o.status}">${o.status}</span>
            </div>
            <div class="shop-order-items">${itemLines || '—'}</div>
          `;
          listEl.appendChild(div);
        });
        renderOrdersPagination(pagEl, page, pageCount, renderOrdersPage);
      }

      renderOrdersPage(1);
    } catch { feedEl.textContent = 'Network error loading orders.'; }
  }

  // Tab wiring
  document.querySelectorAll('.shop-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.shop-tab-btn').forEach((b) => b.classList.remove('is-active'));
      document.querySelectorAll('.shop-panel').forEach((p) => p.classList.remove('is-active'));
      btn.classList.add('is-active');
      const panel = document.querySelector(`[data-shop-panel="${btn.dataset.shopTab}"]`);
      if (panel) panel.classList.add('is-active');
      if (btn.dataset.shopTab === 'orders') loadOrders();
    });
  });

  await loadCart();
  await loadProducts();

  // Fetch simulation mode (must happen before PayPal setup so the flag is set)
  try {
    const pmRes = await fetch('/api/shop/payment-mode', { headers: { Authorization: 'Bearer ' + token } });
    const pmData = await pmRes.json();
    simulatePayment = pmData.simulate === true;
  } catch { /* default false */ }

  // ── PayPal setup ────────────────────────────────────────────────────────
  if (!simulatePayment) try {
    const ppRes = await fetch('/api/shop/paypal/config', { headers: { Authorization: 'Bearer ' + token } });
    const ppData = await ppRes.json();
    if (ppData.configured && ppData.client_id) {
      paypalConfigured = true;
      await new Promise((resolve, reject) => {
        const existing = document.getElementById('paypal-sdk-script');
        if (existing) { resolve(); return; }
        const script = document.createElement('script');
        script.id = 'paypal-sdk-script';
        script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(ppData.client_id)}&currency=USD`;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
      // Hide the plain checkout button, show PayPal buttons instead
      if (checkoutBtn) checkoutBtn.style.display = 'none';
      const ppContainer = document.getElementById('paypal-button-container');
      if (ppContainer && window.paypal) {
        window.paypal.Buttons({
          style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'pay' },
          createOrder: async () => {
            cartFeedEl.textContent = '';
            cartFeedEl.style.color = 'var(--muted)';
            const r = await fetch('/api/shop/paypal/create-order', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
              body: JSON.stringify({}),
            });
            const d = await r.json();
            if (!r.ok) {
              cartFeedEl.style.color = '#f87171';
              cartFeedEl.textContent = d.error || 'Unable to start payment';
              throw new Error(d.error);
            }
            return d.paypal_order_id;
          },
          onApprove: async (ppData) => {
            cartFeedEl.style.color = 'var(--muted)';
            cartFeedEl.textContent = 'Processing payment…';
            const r = await fetch('/api/shop/paypal/capture-order', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
              body: JSON.stringify({ paypal_order_id: ppData.orderID }),
            });
            const result = await r.json();
            if (r.ok) {
              cartFeedEl.style.color = '#4ade80';
              cartFeedEl.textContent = `Order #${result.order_id} placed! Total: $${parseFloat(result.total).toFixed(2)}`;
              await loadCart();
              document.querySelectorAll('.shop-tab-btn').forEach((b) => b.classList.remove('is-active'));
              document.querySelectorAll('.shop-panel').forEach((p) => p.classList.remove('is-active'));
              const ordersBtn = document.querySelector('[data-shop-tab="orders"]');
              const ordersPanel = document.querySelector('[data-shop-panel="orders"]');
              if (ordersBtn) ordersBtn.classList.add('is-active');
              if (ordersPanel) ordersPanel.classList.add('is-active');
              closeCart();
              loadOrders();
            } else {
              cartFeedEl.style.color = '#f87171';
              cartFeedEl.textContent = result.error || 'Payment capture failed.';
            }
          },
          onCancel: () => {
            cartFeedEl.textContent = 'Payment cancelled.';
            cartFeedEl.style.color = 'var(--muted)';
          },
          onError: (err) => {
            console.error('PayPal error', err);
            cartFeedEl.style.color = '#f87171';
            cartFeedEl.textContent = 'Payment error. Please try again.';
          },
        }).render('#paypal-button-container');
      }
    }
  } catch (err) {
    // PayPal not configured or failed to load — plain checkout button remains
    console.warn('PayPal setup skipped:', err.message);
  }

  // ── Stripe setup (added alongside PayPal; only runs when not simulating) ──
  if (!simulatePayment) try {
    const stripeRes = await fetch('/api/shop/stripe/config', { headers: { Authorization: 'Bearer ' + token } });
    const stripeData = await stripeRes.json();
    if (stripeData.configured && stripeData.publishable_key) {
      const stripe = await loadStripeScript(stripeData.publishable_key);
      setupStripePayment(stripe);
      handleStripeReturn();
      stripeConfigured = true;
    }
  } catch (err) {
    // Stripe not configured or failed to load — PayPal/plain checkout remain
    console.warn('Stripe setup skipped:', err && err.message);
  }

  // Reveals the payment UI (chooser + the appropriate provider panel) plus a
  // Cancel control, and hides the plain Checkout button.
  function enterPaymentMode() {
    if (simulatePayment || !(paypalConfigured || stripeConfigured)) return;
    paymentMode = true;
    const chooser = document.getElementById('payment-method-chooser');
    const cancelBtn = document.getElementById('shop-pay-cancel-btn');
    const ppContainer = document.getElementById('paypal-button-container');
    const spContainer = document.getElementById('stripe-payment-container');
    if (checkoutBtn) checkoutBtn.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = '';
    if (paypalConfigured && stripeConfigured) {
      if (chooser) chooser.style.display = '';
      showPaymentMethod(activeMethod || 'paypal');
    } else if (paypalConfigured) {
      if (chooser) chooser.style.display = 'none';
      if (ppContainer) ppContainer.style.display = '';
      if (spContainer) spContainer.style.display = 'none';
    } else if (stripeConfigured) {
      if (chooser) chooser.style.display = 'none';
      if (spContainer) spContainer.style.display = '';
      if (ppContainer) ppContainer.style.display = 'none';
      if (mountStripeCardEl) mountStripeCardEl();
    }
  }

  // Collapses the payment UI back to the neutral state (Checkout button shown).
  function exitPaymentMode() {
    paymentMode = false;
    const chooser = document.getElementById('payment-method-chooser');
    const cancelBtn = document.getElementById('shop-pay-cancel-btn');
    const ppContainer = document.getElementById('paypal-button-container');
    const spContainer = document.getElementById('stripe-payment-container');
    if (chooser) chooser.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (ppContainer) ppContainer.style.display = 'none';
    if (spContainer) spContainer.style.display = 'none';
    if (checkoutBtn) { checkoutBtn.style.display = ''; checkoutBtn.disabled = false; }
    if (cartFeedEl) { cartFeedEl.innerHTML = ''; cartFeedEl.style.color = ''; }
    if (unmountStripeCardEl) unmountStripeCardEl();
  }

  // ── Payment provider visibility / chooser ───────────────────────────────
  if (!simulatePayment && (paypalConfigured || stripeConfigured)) {
    // Wire the method chooser (only meaningful when both providers are enabled).
    document.querySelectorAll('.shop-pay-method-btn').forEach((b) => {
      b.addEventListener('click', () => showPaymentMethod(b.dataset.method));
    });
    // Wire the Cancel control that returns the panel to the neutral state.
    const cancelBtn = document.getElementById('shop-pay-cancel-btn');
    if (cancelBtn) cancelBtn.addEventListener('click', exitPaymentMode);
    // Start neutral: show Checkout; reveal the payment UI only when it's clicked.
    exitPaymentMode();
  }

  // True on phones/tablets, where the Apple Pay / Google Pay wallets are offered.
  function isMobileDevice() {
    try {
      if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') {
        return navigator.userAgentData.mobile;
      }
    } catch (_e) { /* fall through to UA sniffing */ }
    const ua = navigator.userAgent || '';
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    return /Android|iPhone|iPad|iPod|IEMobile|BlackBerry|Opera Mini|Mobile/i.test(ua) || (coarse && window.innerWidth <= 900);
  }

  // Loads Stripe.js and returns a Stripe instance for the given publishable key.
  async function loadStripeScript(publishableKey) {
    if (window.Stripe) return window.Stripe(publishableKey);
    return await new Promise((resolve, reject) => {
      const existing = document.getElementById('stripe-js-script');
      if (existing) { resolve(window.Stripe(publishableKey)); return; }
      const script = document.createElement('script');
      script.id = 'stripe-js-script';
      script.src = 'https://js.stripe.com/v3/';
      script.onload = () => resolve(window.Stripe(publishableKey));
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  // Mounts the Stripe card Element and wires the "Pay with Card" button.
  // Mounts the Stripe Payment Element (cards, wallets, bank redirects, Link,
  // etc. - every method enabled in the Stripe dashboard) and wires "Pay".
  function setupStripePayment(stripe) {
    const payBtn = document.getElementById('stripe-pay-btn');
    const errEl = document.getElementById('stripe-payment-errors');
    const mountEl = document.getElementById('stripe-payment-element');
    if (!payBtn || !mountEl || !stripe) return;

    // Re-created on each pay attempt (the PaymentIntent amount is per-attempt).
    let stripeElements = null;
    let paymentElement = null;

    async function reportStripeDecline() {
      try {
        await fetch('/api/shop/stripe/declined', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({}),
        });
      } catch (_e) { /* non-fatal: the shopper already sees the error */ }
    }

    async function getClientSecret() {
      const r = await fetch('/api/shop/stripe/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({}),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Unable to start payment');
      return d.client_secret;
    }

    let mounting = null;

    // Fetches a PaymentIntent and mounts the Payment Element so the shopper can
    // enter their card details. Idempotent: reuses an already-mounted element,
    // which is essential — the element the shopper types into must be the same
    // one passed to confirmPayment (re-mounting it wipes the entered card data).
    function ensureElementMounted() {
      if (paymentElement) return Promise.resolve();
      if (mounting) return mounting;
      mounting = (async () => {
        const clientSecret = await getClientSecret();
        stripeElements = stripe.elements({
          clientSecret,
          appearance: {
            theme: 'night',
            variables: {
              colorPrimary: '#ffd262',
              colorBackground: '#0a132c',
              colorText: '#f5f7fb',
              colorDanger: '#f87171',
              colorTextPlaceholder: '#8a93a6',
              borderRadius: '10px',
              fontFamily: 'inherit',
            },
          },
        });
        // Offer the Apple Pay / Google Pay wallets wherever the browser and
        // device support them (Stripe hides them when unavailable). These ride
        // on the "card" payment method; Samsung Pay is not offered by Stripe's
        // web Payment Element, so it cannot be surfaced here.
        paymentElement = stripeElements.create('payment', {
          layout: { type: 'tabs' },
          wallets: { applePay: 'auto', googlePay: 'auto' },
        });
        paymentElement.mount('#stripe-payment-element');
      })();
      // Allow a retry if creating the intent / mounting failed.
      mounting.catch(() => { mounting = null; });
      return mounting;
    }

    // Tears down the element so a fresh PaymentIntent is created next time the
    // shopper enters payment mode (e.g. after Cancel or a completed order).
    function unmountElement() {
      if (paymentElement) { try { paymentElement.unmount(); } catch (_e) {} }
      paymentElement = null;
      stripeElements = null;
      mounting = null;
      if (errEl) errEl.textContent = '';
    }

    // Exposed so the payment-mode handlers can mount the card fields as soon as
    // the Stripe UI is shown, letting the shopper fill them in before paying.
    mountStripeCardEl = () => { ensureElementMounted().catch((err) => {
      if (errEl) errEl.textContent = (err && err.message) || 'Unable to start payment';
    }); };
    unmountStripeCardEl = unmountElement;

    payBtn.addEventListener('click', async () => {
      payBtn.disabled = true;
      if (errEl) errEl.textContent = '';
      cartFeedEl.style.color = 'var(--muted)';
      cartFeedEl.textContent = 'Processing payment...';
      try {
        await ensureElementMounted();
        if (!stripeElements) throw new Error('Payment form is not ready. Please try again.');
        const result = await stripe.confirmPayment({
          elements: stripeElements,
          confirmParams: { return_url: window.location.origin + '/shop.html?stripe_return=1' },
          redirect: 'if_required',
        });
        if (result.error) {
          cartFeedEl.style.color = '#f87171';
          cartFeedEl.textContent = result.error.message || 'Payment failed';
          if (result.error.type !== 'validation_error') await reportStripeDecline();
          payBtn.disabled = false;
        } else if (result.paymentIntent && result.paymentIntent.status === 'succeeded') {
          const cr = await fetch('/api/shop/stripe/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify({ payment_intent_id: result.paymentIntent.id }),
          });
          const cdata = await cr.json();
          if (cr.ok) {
            cartFeedEl.style.color = '#4ade80';
            cartFeedEl.textContent = 'Order #' + cdata.order_id + ' placed! Total: $' + parseFloat(cdata.total).toFixed(2);
            await loadCart();
            document.querySelectorAll('.shop-tab-btn').forEach((b) => b.classList.remove('is-active'));
            document.querySelectorAll('.shop-panel').forEach((p) => p.classList.remove('is-active'));
            const ordersBtn = document.querySelector('[data-shop-tab="orders"]');
            const ordersPanel = document.querySelector('[data-shop-panel="orders"]');
            if (ordersBtn) ordersBtn.classList.add('is-active');
            if (ordersPanel) ordersPanel.classList.add('is-active');
            closeCart();
            loadOrders();
            unmountElement();
          } else {
            cartFeedEl.style.color = '#f87171';
            cartFeedEl.textContent = cdata.error || 'Payment confirmation failed.';
            payBtn.disabled = false;
          }
        } else {
          cartFeedEl.style.color = '#f87171';
          cartFeedEl.textContent = 'Payment was not completed.';
          await reportStripeDecline();
          payBtn.disabled = false;
        }
      } catch (err) {
        console.error('Stripe payment error', err);
        cartFeedEl.style.color = '#f87171';
        cartFeedEl.textContent = (err && err.message) || 'Payment error. Please try again.';
        payBtn.disabled = false;
      }
    });
  }

  // If Stripe redirected the customer back after a bank redirect / wallet
  // authorization, verify and record the order now (the PaymentIntent was already
  // confirmed server-side by Stripe).
  async function handleStripeReturn() {
    const params = new URLSearchParams(window.location.search);
    if (!params.get('stripe_return') || !params.get('payment_intent')) return;
    const intentId = params.get('payment_intent');
    history.replaceState({}, document.title, window.location.pathname);
    if (!token || !cartFeedEl) return;
    cartFeedEl.style.color = 'var(--muted)';
    cartFeedEl.textContent = 'Verifying payment...';
    try {
      const cr = await fetch('/api/shop/stripe/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ payment_intent_id: intentId }),
      });
      const cdata = await cr.json();
      if (cr.ok) {
        cartFeedEl.style.color = '#4ade80';
        cartFeedEl.textContent = 'Order #' + cdata.order_id + ' placed! Total: $' + parseFloat(cdata.total).toFixed(2);
        await loadCart();
        document.querySelectorAll('.shop-tab-btn').forEach((b) => b.classList.remove('is-active'));
        document.querySelectorAll('.shop-panel').forEach((p) => p.classList.remove('is-active'));
        const ordersBtn = document.querySelector('[data-shop-tab="orders"]');
        const ordersPanel = document.querySelector('[data-shop-panel="orders"]');
        if (ordersBtn) ordersBtn.classList.add('is-active');
        if (ordersPanel) ordersPanel.classList.add('is-active');
        closeCart();
        loadOrders();
      } else {
        cartFeedEl.style.color = '#f87171';
        cartFeedEl.textContent = cdata.error || 'Payment verification failed.';
      }
    } catch (e) {
      cartFeedEl.style.color = '#f87171';
      cartFeedEl.textContent = 'Payment verification failed.';
    }
  }

  // Shows the selected payment method's UI and hides the other.
  function showPaymentMethod(method) {
    activeMethod = method;
    document.querySelectorAll('.shop-pay-method-btn').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.method === method);
    });
    const ppContainer = document.getElementById('paypal-button-container');
    const spContainer = document.getElementById('stripe-payment-container');
    if (ppContainer) ppContainer.style.display = method === 'paypal' ? '' : 'none';
    if (spContainer) spContainer.style.display = method === 'card' ? '' : 'none';
    if (method === 'card' && mountStripeCardEl) mountStripeCardEl();
  }

}

// ── Shop: Admin management page ───────────────────────────────────────────
async function initShopAdminPage() {
  const page = document.getElementById('shop-admin-page');
  if (!page) return;

  const token = getToken();
  if (!token) { window.location.href = '/login.html'; return; }

  const profile = await fetchProfile();
  if (!profile || !profileHasRole(profile, 'store_admin')) {
    window.location.href = '/dashboard.html';
    return;
  }
  page.style.display = '';

  const prodFeed = document.getElementById('sa-products-feedback');
  const ordFeed  = document.getElementById('sa-orders-feedback');
  let editingId = null;
  // Latest loaded products, used to populate the coupon "applies to" list and
  // to drive drag-free up/down reordering.
  let adminProducts = [];

  // Tab wiring (reuse shop-tab-btn / shop-panel classes)
  document.querySelectorAll('[data-shop-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-shop-tab]').forEach((b) => b.classList.remove('is-active'));
      document.querySelectorAll('[data-shop-panel]').forEach((p) => p.classList.remove('is-active'));
      btn.classList.add('is-active');
      const panel = document.querySelector(`[data-shop-panel="${btn.dataset.shopTab}"]`);
      if (panel) panel.classList.add('is-active');
      if (btn.dataset.shopTab === 'orders') loadAdminOrders(1);
      if (btn.dataset.shopTab === 'reports' && typeof window.initShopReports === 'function') window.initShopReports();
    });
  });
  const payFilterEl = document.getElementById('sa-payment-filter');
  if (payFilterEl) payFilterEl.addEventListener('change', () => loadAdminOrders(1));

  // Product modal helpers
  const modal    = document.getElementById('sa-product-modal');
  const form     = document.getElementById('sa-product-form');
  const formFeed = document.getElementById('sa-form-feedback');

  function openModal(product) {
    editingId = product ? product.id : null;
    document.getElementById('sa-modal-title').textContent = product ? 'Edit Product' : 'Add Product';
    document.getElementById('sa-product-id').value = product ? product.id : '';
    document.getElementById('sa-name').value = product ? product.name : '';
    document.getElementById('sa-price').value = product ? product.price : '';
    document.getElementById('sa-category').value = product ? (product.category || '') : '';
    document.getElementById('sa-stock').value = product && product.stock_qty != null ? product.stock_qty : '';
    document.getElementById('sa-active').value = product ? String(product.active) : 'true';
    document.getElementById('sa-image').value = product ? (product.image_path || '') : '';
    document.getElementById('sa-desc').value = product ? (product.description || '') : '';
    document.getElementById('sa-sizes').value = product ? (product.sizes || '') : '';
    document.getElementById('sa-size-label').value = product ? (product.size_label || '') : '';
    document.getElementById('sa-fulfills-membership').checked = product ? product.fulfills_membership === true : false;
    document.getElementById('sa-fulfills-guest').checked = product ? product.fulfills_guest === true : false;
    // Coupon fields
    const isCoupon = product ? product.is_coupon === true : false;
    document.getElementById('sa-is-coupon').checked = isCoupon;
    document.getElementById('sa-coupon-type').value = product && product.coupon_discount_type === 'fixed' ? 'fixed' : 'percent';
    document.getElementById('sa-coupon-value').value = product && product.coupon_discount_value != null ? product.coupon_discount_value : '';
    populateCouponTargets(product);
    toggleCouponFields();
    formFeed.textContent = '';
    modal.style.display = 'flex';
  }
  function closeModal() { modal.style.display = 'none'; }

  // Shows/hides the coupon detail fields based on the "is a coupon" checkbox.
  function toggleCouponFields() {
    const on = document.getElementById('sa-is-coupon').checked;
    document.getElementById('sa-coupon-fields').style.display = on ? '' : 'none';
    // A coupon is free, so default its price to 0 when none was entered.
    const priceEl = document.getElementById('sa-price');
    if (on && !priceEl.value) priceEl.value = '0';
  }

  // Fills the coupon "applies to" multi-select with all non-coupon, non-donation
  // products (excluding the product being edited), preselecting current targets.
  function populateCouponTargets(product) {
    const sel = document.getElementById('sa-coupon-products');
    if (!sel) return;
    const selected = new Set(
      (product && Array.isArray(product.coupon_product_ids) ? product.coupon_product_ids : []).map(Number)
    );
    const targets = adminProducts.filter((p) => !p.is_coupon && !p.is_donation && (!product || p.id !== product.id));
    sel.innerHTML = targets
      .map((p) => `<option value="${p.id}"${selected.has(p.id) ? ' selected' : ''}>${escHtml(p.name)}</option>`)
      .join('');
  }

  document.getElementById('sa-is-coupon').addEventListener('change', toggleCouponFields);

  document.getElementById('sa-add-product-btn').addEventListener('click', () => openModal(null));
  document.getElementById('sa-modal-close').addEventListener('click', closeModal);
  document.getElementById('sa-form-cancel').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    formFeed.textContent = 'Saving…';
    formFeed.style.color = 'var(--muted)';

    const payload = {
      name:        document.getElementById('sa-name').value.trim(),
      price:       document.getElementById('sa-price').value,
      category:    document.getElementById('sa-category').value.trim(),
      stock_qty:   document.getElementById('sa-stock').value,
      active:      document.getElementById('sa-active').value === 'true',
      image_path:  document.getElementById('sa-image').value.trim(),
      description: document.getElementById('sa-desc').value.trim(),
      sizes:       document.getElementById('sa-sizes').value.trim(),
      size_label:  document.getElementById('sa-size-label').value.trim(),
      fulfills_membership: document.getElementById('sa-fulfills-membership').checked,
      fulfills_guest:      document.getElementById('sa-fulfills-guest').checked,
      is_coupon:   document.getElementById('sa-is-coupon').checked,
      coupon_discount_type: document.getElementById('sa-coupon-type').value,
      coupon_discount_value: document.getElementById('sa-coupon-value').value,
      coupon_product_ids: Array.from(document.getElementById('sa-coupon-products').selectedOptions).map((o) => parseInt(o.value, 10)),
    };

    const url    = editingId ? `/api/admin/shop/products/${editingId}` : '/api/admin/shop/products';
    const method = editingId ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(payload),
      });
      const data = await parseJSONResponse(res);
      if (res.ok) {
        formFeed.style.color = '#4ade80';
        formFeed.textContent = 'Saved.';
        closeModal();
        loadAdminProducts();
      } else {
        formFeed.style.color = '#f87171';
        formFeed.textContent = data.error || 'Unable to save.';
      }
    } catch {
      formFeed.style.color = '#f87171';
      formFeed.textContent = 'Network error.';
    }
    submitBtn.disabled = false;
  });

  // Product image — simple Browse: pick an image from the existing library.
  const imagePreview = document.getElementById('sa-image-preview');
  const imageName    = document.getElementById('sa-image-name');
  const clearImageBtn = document.getElementById('sa-clear-image');
  const imageModal   = document.getElementById('sa-image-modal');
  const imageGrid    = document.getElementById('sa-image-grid');
  const imageEmpty   = document.getElementById('sa-image-empty');
  let selectedImagePath = null;

  function setImageValue(path) {
    document.getElementById('sa-image').value = path || '';
    if (path) {
      imagePreview.src = path;
      imagePreview.style.display = 'block';
      imageName.textContent = path;
      clearImageBtn.style.display = '';
    } else {
      imagePreview.style.display = 'none';
      imagePreview.removeAttribute('src');
      imageName.textContent = '';
      clearImageBtn.style.display = 'none';
    }
  }

  function renderImageGrid(items) {
    imageGrid.innerHTML = '';
    imageEmpty.style.display = (items && items.length) ? 'none' : '';

    // "No image" option at the start of the grid
    const none = document.createElement('div');
    none.style.cssText = 'cursor:pointer;border:2px solid transparent;border-radius:10px;overflow:hidden;background:rgba(255,255,255,0.04);display:flex;align-items:center;justify-content:center;height:84px;color:#b8c4e0;font-size:0.8rem;text-align:center;';
    none.dataset.path = '__none__';
    none.textContent = 'No image';
    if (!selectedImagePath) none.style.borderColor = '#ffd262';
    none.addEventListener('click', () => { setImageValue(''); closeImagePicker(); });
    imageGrid.appendChild(none);

    (items || []).forEach((path) => {
      const cell = document.createElement('div');
      cell.style.cssText = 'cursor:pointer;border:2px solid transparent;border-radius:10px;overflow:hidden;background:rgba(255,255,255,0.04);';
      cell.dataset.path = path;
      const img = document.createElement('img');
      img.src = path;
      img.loading = 'lazy';
      img.style.cssText = 'width:100%;height:84px;object-fit:contain;display:block;';
      cell.appendChild(img);
      if (path === selectedImagePath) cell.style.borderColor = '#ffd262';
      cell.addEventListener('click', () => {
        if (selectedImagePath === path) {
          setImageValue('');
        } else {
          setImageValue(path);
        }
        closeImagePicker();
      });
      imageGrid.appendChild(cell);
    });
  }

  async function openImagePicker() {
    selectedImagePath = document.getElementById('sa-image').value.trim() || null;
    const upFeed = document.getElementById('sa-image-upload-feedback');
    if (upFeed) upFeed.textContent = '';
    imageModal.style.display = 'flex';
    try {
      const res = await fetch('/api/admin/images', { headers: { Authorization: 'Bearer ' + token } });
      const data = await parseJSONResponse(res);
      if (res.ok) renderImageGrid(data.items);
      else imageEmpty.textContent = (data && data.error) || 'Unable to load images.';
    } catch {
      imageEmpty.style.display = '';
      imageEmpty.textContent = 'Unable to load images.';
    }
  }

  function closeImagePicker() { imageModal.style.display = 'none'; }

  document.getElementById('sa-browse-image').addEventListener('click', openImagePicker);
  document.getElementById('sa-image-close').addEventListener('click', closeImagePicker);
  document.getElementById('sa-image-cancel').addEventListener('click', closeImagePicker);
  imageModal.addEventListener('click', (e) => { if (e.target === imageModal) closeImagePicker(); });
  clearImageBtn.addEventListener('click', () => setImageValue(''));

  // Upload an image from the local machine, then select it for the product.
  const imageFileInput  = document.getElementById('sa-image-file');
  const uploadImageBtn  = document.getElementById('sa-image-upload');
  const uploadFeedback  = document.getElementById('sa-image-upload-feedback');
  if (uploadImageBtn && imageFileInput) {
    uploadImageBtn.addEventListener('click', () => imageFileInput.click());
    imageFileInput.addEventListener('change', async () => {
      const file = imageFileInput.files && imageFileInput.files[0];
      if (!file) return;
      uploadImageBtn.disabled = true;
      if (uploadFeedback) { uploadFeedback.style.color = '#b8c4e0'; uploadFeedback.textContent = 'Uploading ' + file.name + '…'; }
      try {
        const fd = new FormData();
        fd.append('image', file);
        fd.append('target', 'shop-product');
        const res = await fetch('/api/admin/upload-image', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token },
          body: fd,
        });
        const data = await parseJSONResponse(res);
        if (res.ok && data.path) {
          setImageValue(data.path);
          if (uploadFeedback) uploadFeedback.textContent = '';
          closeImagePicker();
        } else if (uploadFeedback) {
          uploadFeedback.style.color = '#f87171';
          uploadFeedback.textContent = (data && data.error) || 'Upload failed.';
        }
      } catch {
        if (uploadFeedback) { uploadFeedback.style.color = '#f87171'; uploadFeedback.textContent = 'Network error during upload.'; }
      } finally {
        uploadImageBtn.disabled = false;
        imageFileInput.value = '';
      }
    });
  }

  // ── Products table ───────────────────────────────────────────────────────
  // Persists a new product ordering (array of ids) to the server.
  async function reorderProducts(orderIds) {
    try {
      const res = await fetch('/api/admin/shop/products/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ order: orderIds }),
      });
      if (res.ok) loadAdminProducts();
      else { const d = await parseJSONResponse(res); alert(d.error || 'Reorder failed.'); }
    } catch { alert('Network error.'); }
  }

  // Moves a product up or down one position and saves the new order.
  function moveProduct(id, dir) {
    const idx = adminProducts.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const swap = dir === 'up' ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= adminProducts.length) return;
    const ids = adminProducts.map((p) => p.id);
    [ids[idx], ids[swap]] = [ids[swap], ids[idx]];
    reorderProducts(ids);
  }

  async function loadAdminProducts() {
    prodFeed.textContent = 'Loading…';
    const tbody = document.getElementById('sa-products-tbody');
    try {
      const res = await fetch('/api/admin/shop/products', { headers: { Authorization: 'Bearer ' + token } });
      const data = await parseJSONResponse(res);
      prodFeed.textContent = '';
      if (!res.ok) { prodFeed.textContent = data.error || 'Unable to load products.'; return; }
      adminProducts = data.products;
      if (data.products.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="color:var(--muted);padding:1.5rem;text-align:center;">No products yet.</td></tr>';
        return;
      }
      tbody.innerHTML = '';
      data.products.forEach((p, idx) => {
        const tr = document.createElement('tr');
        const couponBadge = p.is_coupon
          ? ` <span class="sa-badge" style="background:#7c3aed;color:#fff;">Coupon</span>`
          : '';
        tr.innerHTML = `
          <td>${escHtml(p.name)}${couponBadge}</td>
          <td>${p.image_path ? `<img src="${escHtml(p.image_path)}" alt="${escHtml(p.name)}" style="width:48px;height:48px;object-fit:contain;border-radius:8px;" />` : '<span style="color:var(--muted);font-size:0.8rem;">—</span>'}</td>
          <td>${escHtml(p.category || '—')}</td>
          <td>$${parseFloat(p.price).toFixed(2)}</td>
          <td>${p.stock_qty != null ? p.stock_qty : '∞'}</td>
          <td><span class="sa-badge ${p.active ? 'active' : 'inactive'}">${p.active ? 'Active' : 'Inactive'}</span></td>
          <td>
            <button class="sa-action-btn sa-move-up" data-id="${p.id}" title="Move up" ${idx === 0 ? 'disabled' : ''}>↑</button>
            <button class="sa-action-btn sa-move-down" data-id="${p.id}" title="Move down" ${idx === data.products.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="sa-action-btn sa-edit" data-id="${p.id}">Edit</button>
            <button class="sa-action-btn danger sa-delete" data-id="${p.id}">Delete</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
      tbody.querySelectorAll('.sa-move-up').forEach((btn) => {
        btn.addEventListener('click', () => moveProduct(parseInt(btn.dataset.id, 10), 'up'));
      });
      tbody.querySelectorAll('.sa-move-down').forEach((btn) => {
        btn.addEventListener('click', () => moveProduct(parseInt(btn.dataset.id, 10), 'down'));
      });
      tbody.querySelectorAll('.sa-edit').forEach((btn) => {
        btn.addEventListener('click', () => {
          const prod = data.products.find((p) => p.id === parseInt(btn.dataset.id, 10));
          if (prod) openModal(prod);
        });
      });
      tbody.querySelectorAll('.sa-delete').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this product?')) return;
          btn.disabled = true;
          try {
            const res = await fetch(`/api/admin/shop/products/${btn.dataset.id}`, {
              method: 'DELETE',
              headers: { Authorization: 'Bearer ' + token },
            });
            if (res.ok) loadAdminProducts();
            else { const d = await parseJSONResponse(res); alert(d.error || 'Delete failed'); btn.disabled = false; }
          } catch { alert('Network error.'); btn.disabled = false; }
        });
      });
    } catch { prodFeed.textContent = 'Network error loading products.'; }
  }

  // ── Orders table ──────────────────────────────────────────────────────────
  function payBadge(ps) {
    const map = { succeeded: 'Paid', declined: 'Declined', unpaid: 'Unpaid' };
    const cls = ['succeeded', 'declined', 'unpaid'].includes(ps) ? ps : 'pending';
    const text = map[cls] || 'Pending';
    return '<span class="sa-pay-status ' + cls + '">' + escHtml(text) + '</span>';
  }

  async function loadAdminOrders(page) {
    ordFeed.textContent = 'Loading…';
    const tbody   = document.getElementById('sa-orders-tbody');
    const pagEl   = document.getElementById('sa-orders-pagination');
    const payFilterEl = document.getElementById('sa-payment-filter');
    const payParam = payFilterEl && payFilterEl.value ? '&payment_status=' + encodeURIComponent(payFilterEl.value) : '';
    try {
      const res = await fetch(`/api/admin/shop/orders?page=${page}${payParam}`, { headers: { Authorization: 'Bearer ' + token } });
      const data = await parseJSONResponse(res);
      ordFeed.textContent = '';
      if (!res.ok) { ordFeed.textContent = data.error || 'Unable to load orders.'; return; }
      if (data.orders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="color:var(--muted);padding:1.5rem;text-align:center;">No orders yet.</td></tr>';
        pagEl.innerHTML = '';
        return;
      }
      tbody.innerHTML = '';
      const statusOptions = ['pending','processing','shipped','completed','cancelled'];
      data.orders.forEach((o) => {
        const itemSummary = (o.items || []).map((i) => `${escHtml(i.product_name)}${i.size ? ` (${escHtml(i.size)})` : ''} ×${i.quantity}`).join(', ');
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>#${o.id}</td>
          <td>${escHtml(o.buyer_name)}<br><small style="color:var(--muted);">${escHtml(o.buyer_email)}</small></td>
          <td>${new Date(o.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</td>
          <td>$${parseFloat(o.total_amount).toFixed(2)}</td>
          <td style="font-size:0.82rem;color:var(--muted);">${itemSummary}</td>
          <td style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;">
            <select class="sa-status-select" data-order-id="${o.id}">
              ${statusOptions.map((s) => `<option value="${s}" ${s===o.status?'selected':''}>${s.charAt(0).toUpperCase()+s.slice(1)}</option>`).join('')}
            </select>
            <button class="sa-action-btn danger sa-order-delete" data-order-id="${o.id}" title="Remove order">Remove</button>
          </td>
          <td>${payBadge(o.payment_status)}</td>
        `;
        tbody.appendChild(tr);
      });
      tbody.querySelectorAll('.sa-status-select').forEach((sel) => {
        sel.addEventListener('change', async () => {
          const ordId = sel.dataset.orderId;
          try {
            const res = await fetch(`/api/admin/shop/orders/${ordId}/status`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
              body: JSON.stringify({ status: sel.value }),
            });
            if (!res.ok) { const d = await parseJSONResponse(res); alert(d.error || 'Update failed'); }
          } catch { alert('Network error.'); }
        });
      });
      tbody.querySelectorAll('.sa-order-delete').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm(`Remove order #${btn.dataset.orderId}? This cannot be undone.`)) return;
          btn.disabled = true;
          try {
            const res = await fetch(`/api/admin/shop/orders/${btn.dataset.orderId}`, {
              method: 'DELETE',
              headers: { Authorization: 'Bearer ' + token },
            });
            if (res.ok) {
              btn.closest('tr').remove();
            } else {
              const d = await parseJSONResponse(res);
              alert(d.error || 'Delete failed');
              btn.disabled = false;
            }
          } catch { alert('Network error.'); btn.disabled = false; }
        });
      });
      // Pagination
      renderOrdersPagination(pagEl, data.page, data.pages, loadAdminOrders);
    } catch { ordFeed.textContent = 'Network error loading orders.'; }
  }

  loadAdminProducts();
}

async function initFloatAdminPage() {
  const section = document.getElementById('float-admin-page');
  if (!section) return;
  const feedback = document.getElementById('float-admin-feedback');
  const summaryEl = document.getElementById('float-admin-summary');
  const listEl = document.getElementById('float-admin-list');
  const deniedEl = document.getElementById('float-admin-denied');

  let profile;
  try { profile = await fetchProfile(); } catch (err) { return; }
  if (!profile || !profileHasRole(profile, 'float_admin')) {
    section.style.display = 'none';
    if (deniedEl) deniedEl.style.display = 'block';
    return;
  }
  section.style.display = 'block';

  const token = getToken();
  function api(path, opts) {
    return fetch(path, Object.assign({ headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } }, opts));
  }
  function setFeedback(msg, isError) {
    if (!feedback) return;
    feedback.textContent = msg || '';
    feedback.style.color = isError ? '#ff9b9b' : '#88d498';
  }

  let floats = [];
  let users = [];
  let lockState = false;

  function userOptions(selectedId, excludeIds) {
    const opts = ['<option value="">- None -</option>'];
    users.forEach((u) => {
      if (excludeIds && excludeIds.has(u.id)) return;
      const sel = u.id === selectedId ? ' selected' : '';
      opts.push('<option value="' + u.id + '"' + sel + '>' + escHtml(u.full_name || u.email) + '</option>');
    });
    return opts.join('');
  }

  function riderRow(r) {
    r = r || {};
    const memberSel = Number(r.user_id) || null;
    return (
      '<div class="fa-rider" style="display:flex;gap:0.35rem;margin-bottom:0.4rem;align-items:center;flex-wrap:wrap;">' +
        '<select class="fa-rider-member" title="Sponsoring Member" style="flex:2;min-width:160px;">' + userOptions(memberSel, null) + '</select>' +
        '<input type="text" class="fa-rider-name" value="' + escHtml(r.name || '') + '" placeholder="Rider Name" style="flex:2;min-width:140px;" />' +
        '<input type="text" class="fa-rider-comment" value="' + escHtml(r.comment || '') + '" placeholder="Comment" style="flex:3;min-width:160px;" />' +
        '<button type="button" class="fa-rider-remove button secondary" style="flex-shrink:0;">X</button>' +
      '</div>'
    );
  }

  function floatCardHtml(f) {
    const riders = (f.riders || []).map(riderRow).join('');
    return (
      '<div class="fa-card" data-float-id="' + f.id + '">' +
        '<div class="fa-card-head">' +
          '<div style="display:flex;gap:0.6rem;flex:1;flex-wrap:wrap;align-items:flex-end;">' +
          '<div class="form-group" style="flex:2;min-width:160px;margin:0;">' +
            '<label>Float name</label>' +
            '<input type="text" class="fa-name" value="' + escHtml(f.name || '') + '" placeholder="Float name" />' +
          '</div>' +
          '<div class="form-group" style="flex:1;max-width:120px;margin:0;">' +
            '<label>Float #</label>' +
            '<input type="text" class="fa-float-number" value="' + escHtml(f.float_number || '') + '" placeholder="Float #" />' +
          '</div>' +
          '<div class="form-group" style="flex:1;max-width:110px;margin:0;">' +
            '<label>Capacity</label>' +
            '<input type="number" min="0" class="fa-capacity" value="' + (f.capacity != null ? escHtml(String(f.capacity)) : '') + '" placeholder="Capacity" title="Maximum riders for this float" />' +
          '</div>' +
        '</div>' +
          '<button type="button" class="fa-delete button secondary">Delete</button>' +
        '</div>' +
        '<div class="form-group" style="grid-column:1 / -1;margin-top:0.6rem;"><label>Float Captain</label><select class="fa-captain">' + userOptions(f.captain_user_id, null) + '</select></div>' +
        '<div class="form-group">' +
          '<label>Description / Comments</label>' +
          '<textarea class="fa-desc" rows="2" maxlength="2000">' + escHtml(f.description || '') + '</textarea>' +
        '</div>' +
        '<div class="form-group">' +
          '<label>Sponsoring Members &amp; Riders</label>' +
          '<div class="fa-riders">' + riders + '</div>' +
          '<button type="button" class="fa-add-rider button secondary">+ Add Row</button>' +
        '</div>' +
        '<div class="fa-capacity-info" style="font-size:0.85rem;margin-top:0.4rem;color:' + (f.capacity != null && (f.current_riders || 0) > f.capacity ? '#ff9b9b' : '#b8c4e0') + ';">' +
          'Riders: ' + (f.current_riders || 0) + (f.capacity != null ? ' / ' + f.capacity : '') +
        '</div>' +
        '<div style="display:flex;justify-content:flex-end;margin-top:0.6rem;">' +
          '<button type="button" class="fa-save button">Save Changes</button>' +
        '</div>' +
        '<div class="fa-row-feedback" style="font-size:0.85rem;min-height:1.1em;margin-top:0.4rem;"></div>' +
      '</div>'
    );
  }
  function collectRiders(card) {
    const riders = [];
    card.querySelectorAll('.fa-rider').forEach((r) => {
      const memberVal = r.querySelector('.fa-rider-member').value;
      const user_id = Number(memberVal) || null;
      riders.push({
        user_id: user_id,
        name: r.querySelector('.fa-rider-name').value.trim(),
        comment: r.querySelector('.fa-rider-comment').value.trim(),
      });
    });
    return riders;
  }


  function updateRiderCount(card, delta) {
    const info = card.querySelector('.fa-capacity-info');
    if (!info) return;
    const capRaw = card.querySelector('.fa-capacity').value;
    const capacity = (capRaw !== '' && !Number.isNaN(parseInt(capRaw, 10))) ? parseInt(capRaw, 10) : null;
    const m = /Riders:\s*(\d+)/.exec(info.textContent);
    const current = m ? parseInt(m[1], 10) : 0;
    const next = Math.max(0, current + delta);
    info.textContent = 'Riders: ' + next + (capacity != null ? ' / ' + capacity : '');
    info.style.color = (capacity != null && next > capacity) ? '#ff9b9b' : '#b8c4e0';
  }
  function render() {
    const canEdit = !lockState || profileHasRole(profile, 'float_admin');
    if (summaryEl) {
      summaryEl.textContent = floats.length + ' float' + (floats.length === 1 ? '' : 's') + ' - ' + users.length + ' member' + (users.length === 1 ? '' : 's') + (lockState ? '  (LOCKED)' : '');
    }
    listEl.innerHTML = floats.map(floatCardHtml).join('');
    wireList();

    // When floats are locked, say so plainly and prevent edits for everyone
    // except the Float Admin - mirroring the user-profile lock behaviour.
    const lockToggleEl = document.getElementById('fa-lock-toggle');
    if (lockToggleEl) { lockToggleEl.checked = lockState; lockToggleEl.disabled = !canEdit; }
    const bannerEl = document.getElementById('float-lock-banner');
    if (bannerEl) bannerEl.style.display = lockState ? 'block' : 'none';
    if (!canEdit) {
      listEl.querySelectorAll('input, select, textarea, button').forEach((el) => { el.disabled = true; });
      ['fac-name', 'fac-number', 'fac-capacity', 'fac-create'].forEach((id) => {
        const e = document.getElementById(id);
        if (e) e.disabled = true;
      });
    }
  }

  function wireList() {
    listEl.querySelectorAll('.fa-card').forEach((card) => {
      const fb = card.querySelector('.fa-row-feedback');
      const floatId = card.dataset.floatId;

      card.querySelector('.fa-add-rider').addEventListener('click', () => {
        const wrap = document.createElement('div');
        wrap.innerHTML = riderRow();
        card.querySelector('.fa-riders').appendChild(wrap.firstElementChild);
      });
      card.querySelectorAll('.fa-rider-remove').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const row = btn.closest('.fa-rider');
          if (!row) return;
          const riderUserId = Number(row.querySelector('.fa-rider-member').value) || null;
          const riderName = row.querySelector('.fa-rider-name').value.trim();
          const riderComment = row.querySelector('.fa-rider-comment').value.trim();
          // Remove the row from the UI immediately; restore it if the server rejects.
          row.remove();
          try {
            const res = await api('/api/admin/floats/' + floatId + '/riders', {
              method: 'DELETE',
              body: JSON.stringify({ user_id: riderUserId, name: riderName, comment: riderComment }),
            });
            const data = await parseJSONResponse(res);
            if (!res.ok) throw new Error(data.error || 'Unable to remove rider');
            updateRiderCount(card, -1);
          } catch (err) {
            if (fb) { fb.style.color = '#ff9b9b'; fb.textContent = err.message || 'Unable to remove rider'; }
            load(); // resync from the server (re-adds the row)
          }
        });
      });
      card.querySelector('.fa-save').addEventListener('click', async () => {
        const btn = card.querySelector('.fa-save');
        const capRaw = card.querySelector('.fa-capacity').value;
        const capacityVal = (capRaw !== '' && !Number.isNaN(parseInt(capRaw, 10))) ? parseInt(capRaw, 10) : null;
        const body = {
          name: card.querySelector('.fa-name').value.trim(),
          float_number: card.querySelector('.fa-float-number').value.trim(),
          captain_user_id: Number(card.querySelector('.fa-captain').value) || null,
          description: card.querySelector('.fa-desc').value.trim(),
          capacity: capacityVal,
          riders: collectRiders(card),
        };
        if (!body.name) { fb.style.color = '#ff9b9b'; fb.textContent = 'Float name is required'; return; }
        btn.disabled = true;
        fb.style.color = '#b8c4e0'; fb.textContent = 'Saving...';
        try {
          const res = await api('/api/admin/floats/' + floatId, { method: 'PUT', body: JSON.stringify(body) });
          const data = await parseJSONResponse(res);
          if (!res.ok) throw new Error(data.error || 'Unable to save');
          fb.style.color = '#88d498'; fb.textContent = 'Saved.';
        } catch (err) {
          fb.style.color = '#ff9b9b'; fb.textContent = err.message || 'Unable to save';
        } finally { btn.disabled = false; }
      });
      card.querySelector('.fa-delete').addEventListener('click', async () => {
        if (!confirm('Delete this float? Assigned members will be detached (not deleted).')) return;
        try {
          const res = await api('/api/admin/floats/' + floatId, { method: 'DELETE' });
          const data = await parseJSONResponse(res);
          if (!res.ok) throw new Error(data.error || 'Unable to delete');
          await load();
        } catch (err) { setFeedback(err.message || 'Unable to delete', true); }
      });

    });
  }

  const createName = document.getElementById('fac-name');
  const createNumber = document.getElementById('fac-number');
  const createBtn = document.getElementById('fac-create');
  const createFb = document.getElementById('fac-feedback');
  if (createBtn) {
    createBtn.addEventListener('click', async () => {
      const name = (createName ? createName.value : '').trim();
      const float_number = (createNumber ? createNumber.value : '').trim();
      const createCapacity = document.getElementById('fac-capacity');
      const capRaw = createCapacity ? createCapacity.value : '';
      const capacity = (capRaw !== '' && !Number.isNaN(parseInt(capRaw, 10))) ? parseInt(capRaw, 10) : null;
      if (!name) { if (createFb) { createFb.textContent = 'Float name is required'; createFb.style.color = '#ff9b9b'; } return; }
      createBtn.disabled = true;
      try {
        const res = await api('/api/admin/floats', { method: 'POST', body: JSON.stringify({ name, float_number, capacity }) });
        const data = await parseJSONResponse(res);
        if (!res.ok) throw new Error(data.error || 'Unable to create float');
        if (createName) createName.value = '';
        if (createNumber) createNumber.value = '';
        if (createFb) { createFb.textContent = 'Created.'; createFb.style.color = '#88d498'; }
        await load();
      } catch (err) {
        if (createFb) { createFb.textContent = err.message || 'Unable to create float'; createFb.style.color = '#ff9b9b'; }
      } finally { createBtn.disabled = false; }
    });
  }

  // Float-lock toggle: persists the lock state. Guarded server-side so only
  // the Float Admin (or any float admin while unlocked) may change it.
  const lockToggle = document.getElementById('fa-lock-toggle');
  if (lockToggle && !lockToggle.dataset.wired) {
    lockToggle.dataset.wired = '1';
    lockToggle.addEventListener('change', async () => {
      try {
        const res = await api('/api/admin/floats/lock', { method: 'PUT', body: JSON.stringify({ locked: lockToggle.checked }) });
        const data = await parseJSONResponse(res);
        if (!res.ok) throw new Error(data.error || 'Unable to update lock');
        lockState = !!(data.locked);
        await load();
      } catch (err) {
        setFeedback(err.message || 'Unable to update lock', true);
        await load();
      }
    });
  }

  async function load() {
    try {
      const res = await api('/api/admin/floats');
      const data = await parseJSONResponse(res);
      if (!res.ok) throw new Error(data.error || 'Unable to load floats');
      floats = Array.isArray(data.floats) ? data.floats : [];
      users = Array.isArray(data.users) ? data.users : [];
      lockState = !!(data.locked);
      render();
      setFeedback('');
    } catch (err) {
      setFeedback(err.message || 'Unable to load floats', true);
    }
  }

  await load();
}

async function initFinanceAdminPage() {
  const section = document.getElementById('finance-admin-page');
  if (!section) return;
  const feedback = document.getElementById('finance-admin-feedback');
  const summaryEl = document.getElementById('finance-admin-summary');
  const listEl = document.getElementById('finance-admin-list');
  const deniedEl = document.getElementById('finance-admin-denied');

  let profile;
  try { profile = await fetchProfile(); } catch (err) { return; }
  if (!profile || !profileHasRole(profile, 'finance_admin')) {
    section.style.display = 'none';
    if (deniedEl) deniedEl.style.display = 'block';
    return;
  }
  section.style.display = 'block';

  const token = getToken();
  function api(path, opts) {
    return fetch(path, Object.assign({ headers: { Authorization: 'Bearer ' + token } }, opts));
  }

  const FIELDS = [['dues_paid', 'Dues'], ['guest_fee_paid', 'Guest Fee'], ['costume_paid', 'Costume']];

  function rowHtml(m) {
    const toggles = FIELDS.map((entry) => {
      const key = entry[0];
      const label = entry[1];
      const checked = m[key] ? ' checked' : '';
      return '<label class="fin-toggle"><input type="checkbox" data-key="' + key + '"' + checked + ' /><span>' + label + '</span></label>';
    }).join('');
    return (
      '<div class="fin-card" data-user-id="' + m.id + '">' +
        '<div class="fin-head"><div><strong>' + escHtml(m.full_name || 'Unnamed') + '</strong> &nbsp;<span style="color:#b8c4e0;">' + escHtml(m.email || '') + '</span></div>' +
          '<div class="fin-guest">Guest: <strong>' + escHtml(m.guest_name || '—') + '</strong></div></div>' +
        '<div class="fin-toggles">' + toggles + '</div>' +
      '</div>'
    );
  }

  function wireList() {
    listEl.querySelectorAll('.fin-card').forEach((card) => {
      card.querySelectorAll('.fin-toggle input').forEach((cb) => {
        cb.addEventListener('change', async () => {
          const key = cb.dataset.key;
          cb.disabled = true;
          try {
            const res = await api('/api/admin/users/' + card.dataset.userId + '/payments', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
              body: JSON.stringify({ [key]: cb.checked }),
            });
            const data = await parseJSONResponse(res);
            if (!res.ok) throw new Error(data.error || 'Unable to update');
          } catch (err) {
            cb.checked = !cb.checked;
            if (feedback) { feedback.textContent = (err.message || 'Unable to update') + ' (reverted)'; feedback.style.color = '#ff9b9b'; }
          } finally {
            cb.disabled = false;
          }
        });
      });
    });
  }

  async function load() {
    try {
      const res = await api('/api/admin/payments');
      const data = await parseJSONResponse(res);
      if (!res.ok) throw new Error(data.error || 'Unable to load payments');
      if (summaryEl) summaryEl.textContent = data.length + ' member' + (data.length === 1 ? '' : 's');
      listEl.innerHTML = data.map(rowHtml).join('');
      wireList();
      if (feedback) feedback.textContent = '';
    } catch (err) {
      if (feedback) { feedback.textContent = err.message || 'Unable to load payments'; feedback.style.color = '#ff9b9b'; }
    }
  }

  await load();
}

function initAuthPages() {
  initDashboard();
  initUserManagementPage();
  initConfigurationPage();
  initBackupRestorePage();
  initShopPage();
  initShopAdminPage();
  initFloatAdminPage();
  initFinanceAdminPage();
  // Show shop nav link for any logged-in user
  if (getToken()) {
    const shopNavLink = document.getElementById('nav-shop-link');
    if (shopNavLink) shopNavLink.style.display = '';
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAuthPages);
else initAuthPages();

