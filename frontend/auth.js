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

function isEditPreviewMode() {
  return new URLSearchParams(window.location.search).get('edit') === '1';
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
  const parts = [];
  if (info.maskedTarget) parts.push(`We sent a two-factor (MFA) sign-in code to ${info.maskedTarget}.`);
  if (info.notice) parts.push(info.notice);
  if (info.devCode) parts.push(`Dev code: ${info.devCode}`);
  promptEl.textContent = parts.join(' ').trim() || 'Enter the verification code.';
}

// Register form
const registerForm = document.getElementById('register-form');
if (registerForm) {
  if (getToken() && !isEditPreviewMode()) {
    window.location.href = '/dashboard.html';
  }
  const submitButton = document.getElementById('register-submit-button');
  const feedback = document.getElementById('register-feedback');
  const verificationCodeGroup = document.getElementById('verification-code-group');
  const verificationCodeInput = document.getElementById('verification_code');
  const resendButton = document.getElementById('resend-code-button');
  const mfaCodeGroup = document.getElementById('mfa-code-group');
  const mfaCodeInput = document.getElementById('mfa_code');
  const mfaPrompt = document.getElementById('mfa-prompt');
  const mfaResendButton = document.getElementById('mfa-resend-button');
  let registerMfaToken = null;
  let registerMfaMethod = 'email';
  let registrationRequiresMfa = true; // default to the verification flow until policy is known

  // Reflect the site MFA policy on the registration button: when members don't
  // need MFA the form is a single "Register" action; otherwise it starts the
  // email-verification (and possibly MFA) code flow.
  (async () => {
    try {
      const policyRes = await fetch('/api/mfa-policy');
      if (policyRes.ok) {
        const policy = await policyRes.json();
        registrationRequiresMfa = !!policy.registrationRequiresMfa;
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
    const full_name = document.getElementById('full_name').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

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

        if (resp.mfaEnrollmentRequired) {
          showRegisterMfa(resp);
          return;
        }

        setRegisterFeedback(resp.error || 'Verification failed', true);
        return;
      }

      if (!registrationRequiresMfa) {
        const resp = await postJSON('/api/auth/register', { full_name, email, password });
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
      resendButton.disabled = true;
      setRegisterFeedback('Sending new code…', false);
      try {
        const resp = await postJSON('/api/auth/register/request-code', { full_name, email, password });
        verificationCodeInput.value = '';
        verificationCodeInput.focus();
        setRegisterFeedback(resp.error ? (resp.error) : (resp.message || 'New verification code sent.'), Boolean(resp.error));
      } finally {
        resendButton.disabled = false;
      }
    });
  }

  function showRegisterMfa(info) {
    registerMfaToken = info.mfaToken;
    registerMfaMethod = info.method || 'email';
    if (verificationCodeGroup) verificationCodeGroup.hidden = true;
    if (mfaCodeGroup) mfaCodeGroup.hidden = false;
    setMfaPrompt(mfaPrompt, info);
    if (mfaCodeInput) { mfaCodeInput.required = true; mfaCodeInput.value = ''; mfaCodeInput.focus(); }
    if (mfaResendButton) mfaResendButton.hidden = false;
    registerForm.dataset.phase = 'mfa';
    submitButton.textContent = 'Verify and finish';
    setRegisterFeedback(info.notice || 'A separate two-factor (MFA) code was just emailed to confirm your sign-in method. This is different from the email verification code you entered above \u2014 enter the new MFA code below.', false);
  }

  if (mfaResendButton) {
    mfaResendButton.addEventListener('click', async () => {
      mfaResendButton.disabled = true;
      setRegisterFeedback('Sending new code…', false);
      try {
        const resp = await postJSON('/api/auth/mfa/send', { mfaToken: registerMfaToken, method: registerMfaMethod });
        if (resp.mfaChallengeSent) {
          registerMfaToken = resp.mfaToken;
          registerMfaMethod = resp.method || registerMfaMethod;
          setMfaPrompt(mfaPrompt, resp);
          if (mfaCodeInput) { mfaCodeInput.value = ''; mfaCodeInput.focus(); }
          setRegisterFeedback(resp.deliveryNotice || 'New code sent.', false);
        } else {
          setRegisterFeedback(resp.error || 'Unable to resend code', true);
        }
      } finally {
        mfaResendButton.disabled = false;
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
    if (mfaResendButton) mfaResendButton.hidden = false;
    if (mfaMethodSwitch) mfaMethodSwitch.hidden = false;
    if (loginSubmitButton) loginSubmitButton.textContent = 'Verify code';
    loginForm.dataset.phase = 'mfa';
  }

  async function sendLoginMfa(method) {
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
  const adminCount     = users.filter((user) => user.role === 'admin').length;
  const disabledCount  = users.filter((user) => user.role === 'disabled').length;
  const totalCount     = users.length;
  const storeAdminPart = storeAdminCount > 0 ? `, ${storeAdminCount} store admin${storeAdminCount === 1 ? '' : 's'}` : '';
  summary.textContent = `${memberCount} member${memberCount === 1 ? '' : 's'}${storeAdminPart}, ${adminCount} admin${adminCount === 1 ? '' : 's'}, ${disabledCount} disabled, ${totalCount} total`;
}

async function openUserEditModal(user, currentUserId, onUpdate) {
  const token = getToken();

  // Load full profile
  const res = await fetch(`/api/admin/users/${user.id}`, { headers: { Authorization: 'Bearer ' + token } });
  const data = await parseJSONResponse(res);
  if (!res.ok) { alert(data.error || 'Unable to load user details'); return; }
  const full = data;

  // Build modal backdrop
  const existing = document.getElementById('admin-user-edit-modal');
  if (existing) existing.remove();

  const backdrop = document.createElement('div');
  backdrop.id = 'admin-user-edit-modal';
  backdrop.style.cssText = 'position:fixed;inset:0;z-index:11000;display:flex;align-items:center;justify-content:center;padding:1rem;background:rgba(2,8,22,0.8);overflow-y:auto;';

  backdrop.innerHTML = `
    <div style="width:min(780px,100%);background:#08102a;border:1px solid rgba(255,210,98,0.28);border-radius:20px;padding:1.5rem;box-shadow:0 24px 60px rgba(0,0,0,0.4);color:#f5f7ff;" role="dialog" aria-modal="true" aria-labelledby="uem-title">
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
          <div class="form-group"><label style="font-size:0.8rem;color:#b8c4e0;display:block;margin-bottom:0.3rem;">Role</label>
            <select id="uem-role" ${user.id === currentUserId ? 'disabled' : ''} style="width:100%;padding:0.65rem 0.9rem;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:#12203f;color:#f5f7ff;font:inherit;box-sizing:border-box;">
              <option value="member" ${full.role==='member'?'selected':''}>Member</option>
              <option value="store_admin" ${full.role==='store_admin'?'selected':''}>Store Admin</option>
              <option value="admin" ${full.role==='admin'?'selected':''}>Admin</option>
            </select></div>
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
          <label style="display:flex;align-items:center;gap:0.6rem;cursor:pointer;font-size:0.9rem;font-weight:600;padding:0.7rem 1rem;border-radius:10px;border:1px solid rgba(255,210,98,0.2);background:rgba(255,210,98,0.06);">
            <input type="checkbox" id="uem-float-captain" ${full.float_captain ? 'checked' : ''} style="width:1.1rem;height:1.1rem;cursor:pointer;accent-color:#ffd262;" />
            Float Captain
          </label>
        </div>
        <div class="form-group">
          <label style="font-size:0.78rem;color:#b8c4e0;display:block;margin-bottom:0.3rem;">Float Riders <span style="font-weight:400;text-transform:none;letter-spacing:0;">(Name, Float Name &amp; #)</span></label>
          <div id="uem-riders"></div>
          <button type="button" id="uem-add-rider" style="margin-top:0.4rem;padding:0.3rem 0.7rem;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:#b8c4e0;font:inherit;font-size:0.82rem;cursor:pointer;">+ Add Rider</button>
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

  // Populate list inputs
  // Kids: Name | Float # | ×
  // Riders: Name | Float Name | Float # | ×
  function addListItem(containerId, name, floatNum, floatName) {
    const isRider = containerId === 'uem-riders';
    const container = backdrop.querySelector('#' + containerId);
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;gap:0.35rem;margin-bottom:0.4rem;align-items:center;';
    const nameInp = document.createElement('input');
    nameInp.type = 'text';
    nameInp.value = name || '';
    nameInp.placeholder = 'Name';
    nameInp.className = 'uem-list-name';
    nameInp.style.cssText = 'flex:2;padding:0.55rem 0.7rem;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#f5f7ff;font:inherit;min-width:0;';
    wrapper.appendChild(nameInp);
    if (isRider) {
      const floatNameInp = document.createElement('input');
      floatNameInp.type = 'text';
      floatNameInp.value = floatName || '';
      floatNameInp.placeholder = 'Float name';
      floatNameInp.className = 'uem-list-float-name';
      floatNameInp.style.cssText = 'flex:2;padding:0.55rem 0.7rem;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#f5f7ff;font:inherit;min-width:0;';
      wrapper.appendChild(floatNameInp);
    }
    const floatInp = document.createElement('input');
    floatInp.type = 'text';
    floatInp.value = floatNum || '';
    floatInp.placeholder = 'Float #';
    floatInp.className = 'uem-list-float';
    floatInp.style.cssText = 'flex:1;padding:0.55rem 0.7rem;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#f5f7ff;font:inherit;min-width:0;max-width:75px;';
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.textContent = '×';
    rm.style.cssText = 'padding:0.25rem 0.6rem;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:#b8c4e0;cursor:pointer;font:inherit;flex-shrink:0;';
    rm.addEventListener('click', () => wrapper.remove());
    wrapper.appendChild(floatInp);
    wrapper.appendChild(rm);
    container.appendChild(wrapper);
  }

  const riderFloatNums = full.rider_float_numbers || [];
  const riderFloatNames = full.rider_float_names || [];
  (full.float_riders || []).forEach((n, i) => addListItem('uem-riders', n, riderFloatNums[i] || '', riderFloatNames[i] || ''));

  backdrop.querySelector('#uem-add-rider').addEventListener('click', () => addListItem('uem-riders', '', '', ''));

  const feedbackEl = backdrop.querySelector('#uem-feedback');
  function setFeedback(msg, isError) {
    feedbackEl.textContent = msg;
    feedbackEl.style.color = isError ? '#ff9b9b' : '#88d498';
  }

  function close() { backdrop.remove(); }
  backdrop.querySelector('#uem-close').addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

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
    const payload = {
      full_name: backdrop.querySelector('#uem-name').value.trim(),
      email: backdrop.querySelector('#uem-email').value.trim(),
      role: backdrop.querySelector('#uem-role').value,
      phone: backdrop.querySelector('#uem-phone').value.trim(),
      address: backdrop.querySelector('#uem-address').value.trim(),
      spouse_name: backdrop.querySelector('#uem-spouse').value.trim(),
      guest_name: backdrop.querySelector('#uem-guest').value.trim(),
      float_riders: Array.from(backdrop.querySelectorAll('#uem-riders .uem-list-name')).map(i=>i.value.trim()).filter(Boolean),
      rider_float_names: Array.from(backdrop.querySelectorAll('#uem-riders .uem-list-name')).map((nameInp) => {
        const row = nameInp.closest('div');
        return row ? (row.querySelector('.uem-list-float-name')?.value.trim() || '') : '';
      }),
      rider_float_numbers: Array.from(backdrop.querySelectorAll('#uem-riders .uem-list-name')).map((nameInp) => {
        const row = nameInp.closest('div');
        return row ? (row.querySelector('.uem-list-float')?.value.trim() || '') : '';
      }),
      float_captain: backdrop.querySelector('#uem-float-captain')?.checked ?? false,
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
        setFeedback('Saved successfully.', false);
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
    const shouldDisable = full.role !== 'disabled';
    const btn = backdrop.querySelector('#uem-toggle-disable');
    btn.disabled = true;
    setFeedback(shouldDisable ? 'Disabling account…' : 'Enabling account…', false);
    // Pass the user's pre-disable role so re-enable restores it correctly (e.g. store_admin)
    const result = await setUserDisabled(user.id, shouldDisable, full.role);
    if (result.ok && result.data.user) {
      full.role = result.data.user.role;
      btn.textContent = full.role === 'disabled' ? 'Enable Account' : 'Disable Account';
      onUpdate(result.data.user);
      setFeedback(shouldDisable ? 'Account disabled.' : 'Account enabled.', false);
    } else { setFeedback(result.data.error || 'Unable to update account.', true); }
    btn.disabled = false;
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
    const filterValue = filter ? filter.value : 'member';
    const visibleUsers = getFilteredUsers(users, filterValue);
    tbody.innerHTML = '';

    if (visibleUsers.length === 0) {
      const emptyRow = document.createElement('tr');
      const emptyCell = buildCell(
        filterValue === 'member'
          ? 'No members found.'
          : filterValue === 'admin'
            ? 'No admins found.'
            : filterValue === 'disabled'
              ? 'No disabled users found.'
              : 'No users found.'
      );
      emptyCell.colSpan = 5;
      emptyRow.appendChild(emptyCell);
      tbody.appendChild(emptyRow);
      return;
    }

    visibleUsers
      .slice()
      .sort((left, right) => {
        const roleRank = { admin: 0, member: 1, disabled: 2 };
        if (left.role !== right.role) return (roleRank[left.role] ?? 99) - (roleRank[right.role] ?? 99);
        return new Date(right.joined_at) - new Date(left.joined_at);
      })
      .forEach((user) => {
        const row = document.createElement('tr');
        const nameCell = buildCell(user.full_name || '');
        const emailCell = buildCell(user.email || '');
        const joinedCell = buildCell(new Date(user.joined_at).toLocaleDateString());
        const roleCell = buildCell(user.role || 'member');

        // Payment status cell
        const payCell = document.createElement('td');
        payCell.style.cssText = 'padding:0.75rem;border-bottom:1px solid rgba(255,255,255,0.08);white-space:nowrap;';
        function dot(paid, title) {
          const span = document.createElement('span');
          span.title = title;
          span.style.cssText = `display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:4px;background:${paid ? '#4ade80' : '#f87171'};flex-shrink:0;`;
          return span;
        }
        payCell.appendChild(dot(user.dues_paid, `Dues: ${user.dues_paid ? 'Paid' : 'Unpaid'}`));
        payCell.appendChild(dot(user.guest_fee_paid, `Guest Fee: ${user.guest_fee_paid ? 'Paid' : 'Unpaid'}`));
        payCell.appendChild(dot(user.costume_paid, `Costume: ${user.costume_paid ? 'Paid' : 'Unpaid'}`));
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
              payCell.appendChild(dot(user.dues_paid,      `Dues: ${user.dues_paid      ? 'Paid' : 'Unpaid'}`));
              payCell.appendChild(dot(user.guest_fee_paid, `Guest Fee: ${user.guest_fee_paid ? 'Paid' : 'Unpaid'}`));
              payCell.appendChild(dot(user.costume_paid,   `Costume: ${user.costume_paid   ? 'Paid' : 'Unpaid'}`));
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

function buildRiderInput(container, name, floatName, floatNum) {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex; gap:0.4rem; margin-bottom:0.4rem; align-items:center;';

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
  wrapper.appendChild(mkInp(floatName, 'Float name', 'rider-float-name-input'));
  wrapper.appendChild(mkInp(floatNum, 'Float #', 'rider-float-num-input', '75px'));

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

function initProfileDetailsForm(profile) {
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
  set('pd-mfa-method',    profile.mfa_method === 'sms' ? 'sms' : 'email');
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

  // Float Captain checkbox
  const floatCaptainEl = document.getElementById('pd-float-captain');
  if (floatCaptainEl) floatCaptainEl.checked = Boolean(profile.float_captain);

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

  const riderFloatNames = profile.rider_float_names || [];
  const riderFloatNums  = profile.rider_float_numbers || [];
  (profile.float_riders || []).forEach((name, i) =>
    buildRiderInput(ridersList, name, riderFloatNames[i] || '', riderFloatNums[i] || '')
  );

  document.getElementById('add-kid-btn').addEventListener('click', () => buildPersonRow(kidsList, '', '', 'Child name'));
  document.getElementById('add-grandchild-btn').addEventListener('click', () => buildPersonRow(gcList, '', '', 'Grandchild name'));
  document.getElementById('add-rider-btn').addEventListener('click', () => buildRiderInput(ridersList, '', '', ''));

  const feedback = document.getElementById('profile-details-feedback');
  function setFeedback(msg, isError) {
    feedback.textContent = msg;
    feedback.style.color = isError ? '#b42318' : 'var(--muted)';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    setFeedback('Saving…', false);

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
          kids_names:       Array.from(kidsList.querySelectorAll('.person-name-input')).map(i => i.value.trim()).filter(Boolean),
          kids_birthdays:   Array.from(kidsList.querySelectorAll('.person-name-input')).map(i => { const r = i.closest('div'); return r ? (r.querySelector('.person-bd-input')?.value || null) : null; }),
          grandchildren_names:       Array.from(gcList.querySelectorAll('.person-name-input')).map(i => i.value.trim()).filter(Boolean),
          grandchildren_birthdays:   Array.from(gcList.querySelectorAll('.person-name-input')).map(i => { const r = i.closest('div'); return r ? (r.querySelector('.person-bd-input')?.value || null) : null; }),
          float_riders: Array.from(ridersList.querySelectorAll('.rider-name-input')).map(i => i.value.trim()).filter(Boolean),
          rider_float_names: Array.from(ridersList.querySelectorAll('.rider-name-input')).map(i => {
            const row = i.closest('div');
            return row ? (row.querySelector('.rider-float-name-input')?.value.trim() || '') : '';
          }),
          rider_float_numbers: Array.from(ridersList.querySelectorAll('.rider-name-input')).map(i => {
            const row = i.closest('div');
            return row ? (row.querySelector('.rider-float-num-input')?.value.trim() || '') : '';
          }),
          float_captain: document.getElementById('pd-float-captain')?.checked ?? false,
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

  section.style.display = 'block';
}

function showProfileMfaVerify(challenge) {
  const block = document.getElementById('pd-mfa-verify');
  const promptEl = document.getElementById('pd-mfa-verify-prompt');
  const codeInput = document.getElementById('pd-mfa-code');
  const verifyBtn = document.getElementById('pd-mfa-verify-btn');
  const resendBtn = document.getElementById('pd-mfa-resend-btn');
  const feedback = document.getElementById('profile-details-feedback');
  if (!block) return;
  block.hidden = false;
  let msg = 'Enter the code we sent to ' + (challenge.maskedTarget || 'your device') + '.';
  if (challenge.deliveryNotice) msg += ' ' + challenge.deliveryNotice;
  if (challenge.devCode) msg += ' (dev code: ' + challenge.devCode + ')';
  if (promptEl) promptEl.textContent = msg;
  if (codeInput) { codeInput.value = ''; codeInput.focus(); }

  const onVerify = async () => {
    const code = (codeInput && codeInput.value.trim()) || '';
    try {
      const v = await postJSON('/api/auth/mfa/verify', { mfaToken: challenge.mfaToken, code });
      if (v.token || v.mfaEnrolled) {
        block.hidden = true;
        if (feedback) { feedback.textContent = 'Two-factor authentication enabled via SMS.'; feedback.style.color = 'var(--muted)'; }
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
      const r = await fetch('/api/profile/mfa', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
        body: JSON.stringify({ method: 'sms', phone: phone ? phone.trim() : '' }),
      });
      const j = await parseJSONResponse(r);
      if (j.mfaChallengeSent) {
        challenge.mfaToken = j.mfaToken;
        if (promptEl) promptEl.textContent = 'A new code was sent to ' + (j.maskedTarget || 'your device') + '.' + (j.devCode ? ' (dev code: ' + j.devCode + ')' : '');
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

  const badgeClass = profile.role === 'admin' ? 'db-badge--admin' : profile.role === 'store_admin' ? 'db-badge--store-admin' : 'db-badge--member';
  const badgeLabel = profile.role === 'admin' ? 'Admin' : profile.role === 'store_admin' ? 'Store Admin' : 'Member';

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
        <li id="db-payment-status-li" style="display:flex;gap:0.75rem;flex-wrap:wrap;align-items:center;">
          ${payBadgeHtml(Boolean(profile.dues_paid), 'Dues')}
          ${payBadgeHtml(Boolean(profile.guest_fee_paid), 'Guest Fee')}
          ${payBadgeHtml(Boolean(profile.costume_paid), 'Costume')}
        </li>
      </ul>
    </div>
  `;

  const isShopMgr = profile.role === 'admin' || profile.role === 'store_admin';
  if (profile.role === 'admin' || isShopMgr) {
    const adminTab = document.getElementById('db-tab-admin');
    if (adminTab) adminTab.hidden = false;
    const adminTools = document.getElementById('admin-tools');
    if (adminTools) adminTools.style.display = 'block';
    // Shop Management is visible to both admin and store_admin
    const shopAdminLink = document.getElementById('open-shop-admin');
    if (shopAdminLink) shopAdminLink.style.display = '';
    // Full-admin-only links: hide for store_admin
    if (profile.role === 'store_admin') {
      const adminOnlyIds = ['open-user-management', 'open-site-config', 'open-backup-restore'];
      adminOnlyIds.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
    }
  }

  // Wire up tabs
  const tabs = document.querySelectorAll('.db-tab');
  const panels = document.querySelectorAll('.db-tab-panel');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('is-active'));
      panels.forEach((p) => p.classList.remove('is-active'));
      tab.classList.add('is-active');
      const target = document.getElementById('db-panel-' + tab.dataset.tab);
      if (target) target.classList.add('is-active');
      if (tab.dataset.tab === 'orders') loadDashboardOrders();
    });
  });

  async function loadDashboardOrders() {
    const feedEl = document.getElementById('db-orders-feedback');
    const listEl = document.getElementById('db-orders-list');
    if (!feedEl || !listEl) return;
    feedEl.textContent = 'Loading orders…';
    listEl.innerHTML = '';
    try {
      const res = await fetch('/api/shop/orders', { headers: { Authorization: 'Bearer ' + getToken() } });
      const data = await parseJSONResponse(res);
      feedEl.textContent = '';
      if (!res.ok) { listEl.innerHTML = `<p style="color:#f87171;">${data.error || 'Unable to load orders.'}</p>`; return; }
      if (data.orders.length === 0) { listEl.innerHTML = '<p style="color:var(--muted);">You have no orders yet. <a href="/shop.html" style="color:#ffd262;">Visit the shop</a> to place one.</p>'; return; }
      const statusColor = { pending:'#ffd262', processing:'#60a5fa', shipped:'#a78bfa', completed:'#4ade80', cancelled:'#f87171' };
      listEl.innerHTML = data.orders.map((o) => {
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
    } catch { feedEl.textContent = 'Network error loading orders.'; }
  }

  // Refresh all payment statuses when tab becomes visible or on poll
  async function refreshPaymentStatus() {
    const li = document.getElementById('db-payment-status-li');
    if (!li) return;
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
}

// ── Season end-date UI ────────────────────────────────────────────────────
// Mirrors the server-side resolveSeasonEndDate() logic in the browser so the
// admin can see a live preview of the next reset date as they configure it.
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
    setFeedback('', false);
    // Wire up the season end-date sub-fields now that the hidden input has been populated
    setupSeasonEndDateUI(form);
  } catch (_err) {
    setFeedback('Network error loading config.', true);
    return;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    setFeedback('Saving…', false);

    const config = {};
    form.querySelectorAll('input[name], select[name]').forEach((el) => {
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

  if (profile.role !== 'admin') {
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

  if (profile.role !== 'admin') {
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
  if (profile.role !== 'admin') { window.location.href = '/dashboard.html'; return; }

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
      schedNext.textContent = 'Next run: ' + next.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) + ' (server local time)';
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
  if (profile && (profile.role === 'admin' || profile.role === 'store_admin')) {
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

  function openCart()  { cartOverlay.classList.add('is-open');  cartDrawer.classList.add('is-open'); }
  function closeCart() { cartOverlay.classList.remove('is-open'); cartDrawer.classList.remove('is-open'); }
  openCartBtn.addEventListener('click', openCart);
  cartClose.addEventListener('click', closeCart);
  cartOverlay.addEventListener('click', closeCart);

  function fmtPrice(v) { return '$' + parseFloat(v).toFixed(2); }

  function renderCart() {
    const total = cartItems.reduce((s, i) => s + parseFloat(i.price) * i.quantity, 0);
    cartTotalEl.textContent = fmtPrice(total);
    cartCountEl.textContent = cartItems.reduce((s, i) => s + i.quantity, 0);
    if (cartItems.length === 0) {
      cartItemsEl.innerHTML = '<p class="shop-cart-empty">Your cart is empty.</p>';
      return;
    }
    cartItemsEl.innerHTML = '';
    cartItems.forEach((item) => {
      const div = document.createElement('div');
      div.className = 'shop-cart-item';
      div.innerHTML = `
        <span class="shop-cart-item-name">${escHtml(item.name)}</span>
        <span class="shop-cart-item-price">${fmtPrice(parseFloat(item.price) * item.quantity)}</span>
        <div class="shop-cart-item-controls">
          <button class="shop-cart-qty-btn" data-action="dec" data-id="${item.id}">−</button>
          <span class="shop-cart-qty-val">${item.quantity}</span>
          <button class="shop-cart-qty-btn" data-action="inc" data-id="${item.id}">+</button>
        </div>
        <button class="shop-cart-item-remove" data-id="${item.id}">Remove</button>
      `;
      cartItemsEl.appendChild(div);
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

  async function addToCart(productId) {
    const btn = document.querySelector(`.shop-add-btn[data-product-id="${productId}"]`);
    if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
    try {
      const res = await fetch('/api/shop/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ product_id: productId, quantity: 1 }),
      });
      const data = await parseJSONResponse(res);
      if (!res.ok) {
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
    if (simulatePayment) {
      checkoutBtn.style.display = 'none';
      const total = cartItems.reduce((s, i) => s + parseFloat(i.price) * i.quantity, 0).toFixed(2);
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
    } catch { feedEl.textContent = 'Network error loading products.'; }
  }

  function renderFilters() {
    const filterEl = document.getElementById('shop-filters');
    const categories = ['all', ...new Set(allProducts.map((p) => p.category).filter(Boolean))];
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
    const filtered = activeCategory === 'all'
      ? allProducts
      : allProducts.filter((p) => p.category === activeCategory);

    if (filtered.length === 0) {
      grid.innerHTML = '<p style="color:var(--muted);">No products found.</p>';
      return;
    }

    grid.innerHTML = '';
    filtered.forEach((p) => {
      const outOfStock = p.stock_qty != null && p.stock_qty <= 0;
      const card = document.createElement('div');
      card.className = 'shop-product-card';
      const imgHtml = p.image_path
        ? `<img class="shop-product-img" src="${escHtml(p.image_path)}" alt="${escHtml(p.name)}" loading="lazy" />`
        : `<div class="shop-product-img-placeholder">🛍</div>`;
      card.innerHTML = `
        ${imgHtml}
        <div class="shop-product-body">
          ${p.category ? `<span class="shop-product-category">${escHtml(p.category)}</span>` : ''}
          <h3 class="shop-product-name">${escHtml(p.name)}</h3>
          ${p.description ? `<p class="shop-product-desc">${escHtml(p.description)}</p>` : '<p class="shop-product-desc"></p>'}
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
      card.querySelector('.shop-add-btn:not(:disabled)')?.addEventListener('click', () => addToCart(p.id));
      grid.appendChild(card);
    });
  }

  // ── Orders ───────────────────────────────────────────────────────────────
  async function loadOrders() {
    const feedEl = document.getElementById('shop-orders-feedback');
    const listEl = document.getElementById('shop-orders-list');
    feedEl.textContent = 'Loading orders…';
    try {
      const res = await fetch('/api/shop/orders', { headers: { Authorization: 'Bearer ' + token } });
      const data = await parseJSONResponse(res);
      feedEl.textContent = '';
      if (!res.ok) { listEl.innerHTML = `<p style="color:#f87171;">${data.error || 'Unable to load orders.'}</p>`; return; }
      if (data.orders.length === 0) { listEl.innerHTML = '<p style="color:var(--muted);">No orders yet.</p>'; return; }
      listEl.innerHTML = '';
      data.orders.forEach((o) => {
        const div = document.createElement('div');
        div.className = 'shop-order-card';
        const itemLines = (o.items || []).map((i) =>
          `${escHtml(i.product_name)} × ${i.quantity} — ${fmtPrice(parseFloat(i.unit_price) * i.quantity)}`
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
}

// ── Shop: Admin management page ───────────────────────────────────────────
async function initShopAdminPage() {
  const page = document.getElementById('shop-admin-page');
  if (!page) return;

  const token = getToken();
  if (!token) { window.location.href = '/login.html'; return; }

  const profile = await fetchProfile();
  if (!profile || (profile.role !== 'admin' && profile.role !== 'store_admin')) {
    window.location.href = '/dashboard.html';
    return;
  }
  page.style.display = '';

  const prodFeed = document.getElementById('sa-products-feedback');
  const ordFeed  = document.getElementById('sa-orders-feedback');
  let editingId = null;

  // Tab wiring (reuse shop-tab-btn / shop-panel classes)
  document.querySelectorAll('[data-shop-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-shop-tab]').forEach((b) => b.classList.remove('is-active'));
      document.querySelectorAll('[data-shop-panel]').forEach((p) => p.classList.remove('is-active'));
      btn.classList.add('is-active');
      const panel = document.querySelector(`[data-shop-panel="${btn.dataset.shopTab}"]`);
      if (panel) panel.classList.add('is-active');
      if (btn.dataset.shopTab === 'orders') loadAdminOrders(1);
    });
  });

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
    formFeed.textContent = '';
    modal.style.display = 'flex';
  }
  function closeModal() { modal.style.display = 'none'; }

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

  // ── Products table ───────────────────────────────────────────────────────
  async function loadAdminProducts() {
    prodFeed.textContent = 'Loading…';
    const tbody = document.getElementById('sa-products-tbody');
    try {
      const res = await fetch('/api/admin/shop/products', { headers: { Authorization: 'Bearer ' + token } });
      const data = await parseJSONResponse(res);
      prodFeed.textContent = '';
      if (!res.ok) { prodFeed.textContent = data.error || 'Unable to load products.'; return; }
      if (data.products.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="color:var(--muted);padding:1.5rem;text-align:center;">No products yet.</td></tr>';
        return;
      }
      tbody.innerHTML = '';
      data.products.forEach((p) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escHtml(p.name)}</td>
          <td>${escHtml(p.category || '—')}</td>
          <td>$${parseFloat(p.price).toFixed(2)}</td>
          <td>${p.stock_qty != null ? p.stock_qty : '∞'}</td>
          <td><span class="sa-badge ${p.active ? 'active' : 'inactive'}">${p.active ? 'Active' : 'Inactive'}</span></td>
          <td>
            <button class="sa-action-btn sa-edit" data-id="${p.id}">Edit</button>
            <button class="sa-action-btn danger sa-delete" data-id="${p.id}">Delete</button>
          </td>
        `;
        tbody.appendChild(tr);
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
  async function loadAdminOrders(page) {
    ordFeed.textContent = 'Loading…';
    const tbody   = document.getElementById('sa-orders-tbody');
    const pagEl   = document.getElementById('sa-orders-pagination');
    try {
      const res = await fetch(`/api/admin/shop/orders?page=${page}`, { headers: { Authorization: 'Bearer ' + token } });
      const data = await parseJSONResponse(res);
      ordFeed.textContent = '';
      if (!res.ok) { ordFeed.textContent = data.error || 'Unable to load orders.'; return; }
      if (data.orders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="color:var(--muted);padding:1.5rem;text-align:center;">No orders yet.</td></tr>';
        pagEl.innerHTML = '';
        return;
      }
      tbody.innerHTML = '';
      const statusOptions = ['pending','processing','shipped','completed','cancelled'];
      data.orders.forEach((o) => {
        const itemSummary = (o.items || []).map((i) => `${escHtml(i.product_name)} ×${i.quantity}`).join(', ');
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
      pagEl.innerHTML = '';
      for (let i = 1; i <= data.pages; i++) {
        const btn = document.createElement('button');
        btn.className = 'br-page-btn' + (i === data.page ? ' active' : '');
        btn.textContent = i;
        btn.addEventListener('click', () => loadAdminOrders(i));
        pagEl.appendChild(btn);
      }
    } catch { ordFeed.textContent = 'Network error loading orders.'; }
  }

  loadAdminProducts();
}

function initAuthPages() {
  initDashboard();
  initUserManagementPage();
  initConfigurationPage();
  initBackupRestorePage();
  initShopPage();
  initShopAdminPage();
  // Show shop nav link for any logged-in user
  if (getToken()) {
    const shopNavLink = document.getElementById('nav-shop-link');
    if (shopNavLink) shopNavLink.style.display = '';
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAuthPages);
else initAuthPages();
