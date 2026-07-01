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
  return localStorage.getItem('krewe_token');
}

function isEditPreviewMode() {
  return new URLSearchParams(window.location.search).get('edit') === '1';
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
      if (registerForm.dataset.phase === 'verify') {
        const code = verificationCodeInput.value.trim();
        const resp = await postJSON('/api/auth/register/verify-code', { email, code });
        if (resp.token) {
          localStorage.setItem('krewe_token', resp.token);
          window.location.href = '/dashboard.html';
          return;
        }

        setRegisterFeedback(resp.error || 'Verification failed', true);
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
}

// Login form
const loginForm = document.getElementById('login-form');
if (loginForm) {
  if (getToken() && !isEditPreviewMode()) {
    window.location.href = '/dashboard.html';
  }
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login_email').value.trim();
    const password = document.getElementById('login_password').value;
    const resp = await postJSON('/api/auth/login', { email, password });
    if (resp.token) {
      localStorage.setItem('krewe_token', resp.token);
      window.location.href = '/dashboard.html';
    } else {
      alert(resp.error || 'Login failed');
    }
  });
}

// Dashboard
async function fetchProfile() {
  const token = localStorage.getItem('krewe_token');
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

async function setUserDisabled(userId, disabled) {
  const token = getToken();
  const endpoints = [`/api/admin/users/${userId}/disable`, `/api/users/${userId}/disable`];

  for (const endpoint of endpoints) {
    const res = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify({ disabled }),
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
  return users.filter((user) => user.role === filterValue);
}

function updateAdminSummary(users) {
  const summary = document.getElementById('admin-user-summary');
  if (!summary) return;

  const memberCount = users.filter((user) => user.role === 'member').length;
  const adminCount = users.filter((user) => user.role === 'admin').length;
  const disabledCount = users.filter((user) => user.role === 'disabled').length;
  const totalCount = users.length;
  summary.textContent = `${memberCount} member${memberCount === 1 ? '' : 's'}, ${adminCount} admin${adminCount === 1 ? '' : 's'}, ${disabledCount} disabled, ${totalCount} total`;
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
        <button type="button" class="uem-tab-btn" data-uem-tab="payment">Payment</button>
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
        <div class="form-group">
          <label style="font-size:0.78rem;color:#b8c4e0;display:block;margin-bottom:0.3rem;">Float Riders <span style="font-weight:400;text-transform:none;letter-spacing:0;">(Name, Float Name &amp; #)</span></label>
          <div id="uem-riders"></div>
          <button type="button" id="uem-add-rider" style="margin-top:0.4rem;padding:0.3rem 0.7rem;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:#b8c4e0;font:inherit;font-size:0.82rem;cursor:pointer;">+ Add Rider</button>
        </div>
      </div>

      <!-- Panel: Payment -->
      <div class="uem-panel" data-uem-panel="payment">
        <p style="font-size:0.78rem;color:#b8c4e0;margin:0 0 0.65rem;">${full.current_season_year || ''} Mardi Gras Season &mdash; check items paid for this season:</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0.65rem 1rem;padding:0.25rem 0;">
          <label style="display:flex;align-items:center;gap:0.7rem;cursor:pointer;font-size:0.92rem;padding:0.7rem 0.9rem;border-radius:10px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02);">
            <input type="checkbox" id="uem-dues-paid" ${full.dues_paid?'checked':''} style="accent-color:#ffd262;width:1.1rem;height:1.1rem;flex-shrink:0;" />
            Membership Dues
          </label>
          <label style="display:flex;align-items:center;gap:0.7rem;cursor:pointer;font-size:0.92rem;padding:0.7rem 0.9rem;border-radius:10px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02);">
            <input type="checkbox" id="uem-guest-fee-paid" ${full.guest_fee_paid?'checked':''} style="accent-color:#ffd262;width:1.1rem;height:1.1rem;flex-shrink:0;" />
            Guest Fee
          </label>
          <label style="display:flex;align-items:center;gap:0.7rem;cursor:pointer;font-size:0.92rem;padding:0.7rem 0.9rem;border-radius:10px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02);">
            <input type="checkbox" id="uem-beads-paid" ${full.beads_paid?'checked':''} style="accent-color:#ffd262;width:1.1rem;height:1.1rem;flex-shrink:0;" />
            Beads &amp; Throws
          </label>
          <label style="display:flex;align-items:center;gap:0.7rem;cursor:pointer;font-size:0.92rem;padding:0.7rem 0.9rem;border-radius:10px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02);">
            <input type="checkbox" id="uem-costume-paid" ${full.costume_paid?'checked':''} style="accent-color:#ffd262;width:1.1rem;height:1.1rem;flex-shrink:0;" />
            Costume
          </label>
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

  // Tab switching
  backdrop.querySelectorAll('.uem-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      backdrop.querySelectorAll('.uem-tab-btn').forEach((b) => b.classList.remove('is-active'));
      backdrop.querySelectorAll('.uem-panel').forEach((p) => p.classList.remove('is-active'));
      btn.classList.add('is-active');
      const panel = backdrop.querySelector(`[data-uem-panel="${btn.dataset.uemTab}"]`);
      if (panel) panel.classList.add('is-active');
    });
  });

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
      dues_paid: backdrop.querySelector('#uem-dues-paid').checked,
      guest_fee_paid: backdrop.querySelector('#uem-guest-fee-paid').checked,
      beads_paid: backdrop.querySelector('#uem-beads-paid').checked,
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
        onUpdate(d.user);
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
    const result = await setUserDisabled(user.id, shouldDisable);
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

      const roleInput = window.prompt('Role for new user (member/admin).', 'member');
      if (roleInput === null) return;
      const role = roleInput.trim().toLowerCase() === 'admin' ? 'admin' : 'member';

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
        payCell.appendChild(dot(user.beads_paid, `Beads & Throws: ${user.beads_paid ? 'Paid' : 'Unpaid'}`));
        payCell.appendChild(dot(user.costume_paid, `Costume: ${user.costume_paid ? 'Paid' : 'Unpaid'}`));
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

  // Populate fields
  document.getElementById('pd-phone').value = profile.phone || '';
  document.getElementById('pd-address').value = profile.address || '';
  document.getElementById('pd-spouse').value = profile.spouse_name || '';
  document.getElementById('pd-guest').value = profile.guest_name || '';

  const kidsList = document.getElementById('kids-list');
  const ridersList = document.getElementById('riders-list');

  (profile.kids_names || []).forEach((name) => buildRemovableInput(kidsList, name, 'Child name'));
  const riderFloatNames = profile.rider_float_names || [];
  const riderFloatNums  = profile.rider_float_numbers || [];
  (profile.float_riders || []).forEach((name, i) =>
    buildRiderInput(ridersList, name, riderFloatNames[i] || '', riderFloatNums[i] || '')
  );

  document.getElementById('add-kid-btn').addEventListener('click', () => {
    buildRemovableInput(kidsList, '', 'Child name');
  });
  document.getElementById('add-rider-btn').addEventListener('click', () => {
    buildRiderInput(ridersList, '', '', '');
  });

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
      const res = await fetch('/api/profile/details', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          phone: document.getElementById('pd-phone').value.trim(),
          address: document.getElementById('pd-address').value.trim(),
          spouse_name: document.getElementById('pd-spouse').value.trim(),
          guest_name: document.getElementById('pd-guest').value.trim(),
          kids_names: getListValues(kidsList),
          float_riders: Array.from(ridersList.querySelectorAll('.rider-name-input')).map(i => i.value.trim()).filter(Boolean),
          rider_float_names: Array.from(ridersList.querySelectorAll('.rider-name-input')).map(i => {
            const row = i.closest('div');
            return row ? (row.querySelector('.rider-float-name-input')?.value.trim() || '') : '';
          }),
          rider_float_numbers: Array.from(ridersList.querySelectorAll('.rider-name-input')).map(i => {
            const row = i.closest('div');
            return row ? (row.querySelector('.rider-float-num-input')?.value.trim() || '') : '';
          }),
        }),
      });
      const data = await parseJSONResponse(res);
      if (res.ok) {
        setFeedback('Information saved.', false);
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

  const badgeClass = profile.role === 'admin' ? 'db-badge--admin' : 'db-badge--member';
  const badgeLabel = profile.role === 'admin' ? 'Admin' : 'Member';

  function payBadge(paid, label) {
    const cls = paid ? 'db-badge--paid' : 'db-badge--unpaid';
    const icon = paid ? '✓' : '✗';
    return `<span class="db-badge ${cls}" title="${label}: ${paid ? 'Paid' : 'Unpaid'} (${profile.current_season_year || ''} Season)">${icon} ${label}</span>`;
  }

  const seasonLabel = profile.current_season_year ? `<span style="font-size:0.75rem;color:var(--muted);display:block;margin-bottom:0.25rem;">${profile.current_season_year} Mardi Gras Season</span>` : '';

  const paymentHtml = seasonLabel + [
    payBadge(profile.dues_paid,      'Dues'),
    payBadge(profile.guest_fee_paid, 'Guest Fee'),
    payBadge(profile.beads_paid,     'Beads &amp; Throws'),
    payBadge(profile.costume_paid,   'Costume'),
  ].join('');

  el.innerHTML = `
    <div class="db-avatar" aria-hidden="true">${initials}</div>
    <div class="db-hero-info">
      <p class="db-hero-label">Welcome back</p>
      <h1 class="db-hero-name">${profile.full_name}</h1>
      <ul class="db-hero-meta">
        <li><strong>Email:</strong> ${profile.email}</li>
        <li><strong>Member since:</strong> ${new Date(profile.joined_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</li>
        <li><span class="db-badge ${badgeClass}">${badgeLabel}</span></li>
      </ul>
      <div class="db-payment-status">${paymentHtml}</div>
    </div>
  `;

  const isShopMgr = profile.role === 'admin' || profile.role === 'store_admin';
  if (profile.role === 'admin' || isShopMgr) {
    const adminTab = document.getElementById('db-tab-admin');
    if (adminTab) adminTab.hidden = false;
    const adminTools = document.getElementById('admin-tools');
    if (adminTools) adminTools.style.display = 'block';
    const shopAdminLink = document.getElementById('open-shop-admin');
    if (shopAdminLink) shopAdminLink.style.display = '';
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
    });
  });

  initProfileDetailsForm(profile);
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
      if (el) el.value = value;
    }
    setFeedback('', false);
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
      config[el.name] = el.value;
    });

    try {
      const res = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ config }),
      });
      const data = await parseJSONResponse(res);
      setFeedback(res.ok ? 'Configuration saved. Restart the server to apply changes.' : (data.error || 'Unable to save config'), !res.ok);
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

  function updateProviderFields() {
    const chosen = document.querySelector('input[name="br-provider"]:checked');
    const val = chosen ? chosen.value : 'local';
    if (localFields) localFields.style.display = val === 'local' ? '' : 'none';
    if (s3Fields) s3Fields.style.display = val === 's3' ? '' : 'none';
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

  function showRestoreModal(backup) {
    modalFeedback.textContent = '';
    modalFeedback.style.color = 'var(--muted)';
    modalConfirm.disabled = false;

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
    modalScopeOptions.querySelectorAll('input').forEach((r) => r.addEventListener('change', updateWarning));
    updateWarning();

    modal.style.display = 'flex';

    modalConfirm.onclick = async () => {
      const chosen = modalScopeOptions.querySelector('input[name="br-restore-scope"]:checked');
      if (!chosen) { modalFeedback.textContent = 'Please select a restore scope.'; return; }
      const scope = chosen.value;
      modalConfirm.disabled = true;
      modalFeedback.textContent = 'Restoring… please wait.';
      modalFeedback.style.color = 'var(--muted)';

      try {
        const res = await fetch(`/api/admin/backups/${encodeURIComponent(backup.id)}/restore`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ scope }),
        });
        const data = await parseJSONResponse(res);
        if (!res.ok) {
          modalFeedback.textContent = data.error || 'Restore failed.';
          modalFeedback.style.color = '#b42318';
          modalConfirm.disabled = false;
          return;
        }
        modalFeedback.textContent = `Restored: ${data.restored.join(' & ')}.${data.restored.includes('files') ? ' Reload the page to see changes.' : ''}`;
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
    tbody.innerHTML = '<tr><td colspan="5" class="br-empty">Loading…</td></tr>';
    pager.innerHTML = '';
    setListFeedback('', false);

    try {
      const res = await fetch(`/api/admin/backups?page=${page}`, {
        headers: { Authorization: 'Bearer ' + token },
      });
      const data = await parseJSONResponse(res);
      if (!res.ok) { setListFeedback(data.error || 'Unable to load backups.', true); tbody.innerHTML = '<tr><td colspan="5" class="br-empty">—</td></tr>'; return; }

      const { items, total, totalPages } = data;
      currentPage = data.page;

      if (!items || items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="br-empty">No backups yet.</td></tr>';
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
      tbody.innerHTML = '<tr><td colspan="5" class="br-empty">—</td></tr>';
    }
  }

  // ── Create backup ────────────────────────────────────────────────────────
  const createBtn = document.getElementById('br-create-btn');
  createBtn.addEventListener('click', async () => {
    const checked = document.querySelector('input[name="br-create-type"]:checked');
    const type = checked ? checked.value : 'full';
    createBtn.disabled = true;
    setCreateFeedback('Creating backup… this may take a moment.', false);

    try {
      const res = await fetch('/api/admin/backups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ type }),
      });
      const data = await parseJSONResponse(res);
      if (!res.ok) {
        setCreateFeedback(data.error || 'Unable to create backup.', true);
      } else {
        setCreateFeedback(`Backup created: ${formatDate(data.backup.created_at)}`, false);
        loadBackupList(1);
      }
    } catch {
      setCreateFeedback('Network error. Please try again.', true);
    } finally {
      createBtn.disabled = false;
    }
  });

  loadBackupList(1);
}

// ── Shop: Member-facing page ──────────────────────────────────────────────
async function initShopPage() {
  const pageContent = document.getElementById('shop-page-content');
  if (!pageContent) return;

  const token = getToken();
  if (!token) { window.location.href = '/login.html'; return; }

  pageContent.style.display = '';

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

  checkoutBtn.addEventListener('click', async () => {
    if (cartItems.length === 0) { cartFeedEl.textContent = 'Your cart is empty.'; return; }
    checkoutBtn.disabled = true;
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
        // Switch to orders tab
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

  // ── PayPal setup ────────────────────────────────────────────────────────
  try {
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
