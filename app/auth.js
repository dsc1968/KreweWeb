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
    <div style="width:min(720px,100%);background:#08102a;border:1px solid rgba(255,210,98,0.28);border-radius:20px;padding:1.5rem;box-shadow:0 24px 60px rgba(0,0,0,0.4);color:#f5f7ff;max-height:90vh;overflow-y:auto;" role="dialog" aria-modal="true" aria-labelledby="uem-title">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;">
        <h2 id="uem-title" style="margin:0;font-size:1.1rem;">Edit User</h2>
        <button type="button" id="uem-close" style="background:none;border:none;color:#b8c4e0;font-size:1.4rem;cursor:pointer;line-height:1;" aria-label="Close">&times;</button>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 1.25rem;">
        <div class="form-group"><label style="font-size:0.8rem;color:#b8c4e0;display:block;margin-bottom:0.3rem;">Full Name</label>
          <input id="uem-name" type="text" value="${escHtml(full.full_name)}" style="width:100%;padding:0.65rem 0.9rem;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#f5f7ff;font:inherit;box-sizing:border-box;" /></div>
        <div class="form-group"><label style="font-size:0.8rem;color:#b8c4e0;display:block;margin-bottom:0.3rem;">Email</label>
          <input id="uem-email" type="email" value="${escHtml(full.email)}" style="width:100%;padding:0.65rem 0.9rem;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#f5f7ff;font:inherit;box-sizing:border-box;" /></div>
        <div class="form-group"><label style="font-size:0.8rem;color:#b8c4e0;display:block;margin-bottom:0.3rem;">Role</label>
          <select id="uem-role" ${user.id === currentUserId ? 'disabled' : ''} style="width:100%;padding:0.65rem 0.9rem;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:#12203f;color:#f5f7ff;font:inherit;box-sizing:border-box;">
            <option value="member" ${full.role==='member'?'selected':''}>Member</option>
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

      <!-- Float Assignments -->
      <div style="margin-top:1rem;padding:1rem;border-radius:12px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02);">
        <p style="margin:0 0 0.75rem;font-size:0.8rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#ffd262;">Float Assignments</p>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0 1rem;">
          <div class="form-group"><label style="font-size:0.78rem;color:#b8c4e0;display:block;margin-bottom:0.3rem;">Member Float #</label>
            <input id="uem-member-float" type="text" value="${escHtml(full.member_float_number||'')}" placeholder="e.g. 3A" style="width:100%;padding:0.6rem 0.8rem;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#f5f7ff;font:inherit;box-sizing:border-box;" /></div>
          <div class="form-group"><label style="font-size:0.78rem;color:#b8c4e0;display:block;margin-bottom:0.3rem;">Spouse Float #</label>
            <input id="uem-spouse-float" type="text" value="${escHtml(full.spouse_float_number||'')}" placeholder="e.g. 3B" style="width:100%;padding:0.6rem 0.8rem;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#f5f7ff;font:inherit;box-sizing:border-box;" /></div>
          <div class="form-group"><label style="font-size:0.78rem;color:#b8c4e0;display:block;margin-bottom:0.3rem;">Guest Float #</label>
            <input id="uem-guest-float" type="text" value="${escHtml(full.guest_float_number||'')}" placeholder="e.g. 3C" style="width:100%;padding:0.6rem 0.8rem;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#f5f7ff;font:inherit;box-sizing:border-box;" /></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 1.25rem;margin-top:0.5rem;">
          <div class="form-group">
            <label style="font-size:0.78rem;color:#b8c4e0;display:block;margin-bottom:0.3rem;">Children <span style="font-weight:400;text-transform:none;letter-spacing:0;">(Name &amp; Float #)</span></label>
            <div id="uem-kids"></div>
            <button type="button" id="uem-add-kid" style="margin-top:0.4rem;padding:0.3rem 0.7rem;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:#b8c4e0;font:inherit;font-size:0.82rem;cursor:pointer;">+ Add Child</button>
          </div>
          <div class="form-group">
            <label style="font-size:0.78rem;color:#b8c4e0;display:block;margin-bottom:0.3rem;">Float Riders <span style="font-weight:400;text-transform:none;letter-spacing:0;">(Name &amp; Float #)</span></label>
            <div id="uem-riders"></div>
            <button type="button" id="uem-add-rider" style="margin-top:0.4rem;padding:0.3rem 0.7rem;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:#b8c4e0;font:inherit;font-size:0.82rem;cursor:pointer;">+ Add Rider</button>
          </div>
        </div>
      </div>

      <!-- Payment Status -->
      <div style="margin-top:1rem;padding:1rem;border-radius:12px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02);">
        <p style="margin:0 0 0.75rem;font-size:0.8rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#ffd262;">Payment Status</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem 1.5rem;">
          <label style="display:flex;align-items:center;gap:0.6rem;cursor:pointer;font-size:0.9rem;">
            <input type="checkbox" id="uem-dues-paid" ${full.dues_paid?'checked':''} style="accent-color:#ffd262;width:1rem;height:1rem;" />
            Membership Dues Paid
          </label>
          <label style="display:flex;align-items:center;gap:0.6rem;cursor:pointer;font-size:0.9rem;">
            <input type="checkbox" id="uem-guest-fee-paid" ${full.guest_fee_paid?'checked':''} style="accent-color:#ffd262;width:1rem;height:1rem;" />
            Guest Fee Paid
          </label>
          <label style="display:flex;align-items:center;gap:0.6rem;cursor:pointer;font-size:0.9rem;">
            <input type="checkbox" id="uem-beads-paid" ${full.beads_paid?'checked':''} style="accent-color:#ffd262;width:1rem;height:1rem;" />
            Beads Cost Paid
          </label>
          <label style="display:flex;align-items:center;gap:0.6rem;cursor:pointer;font-size:0.9rem;">
            <input type="checkbox" id="uem-costume-paid" ${full.costume_paid?'checked':''} style="accent-color:#ffd262;width:1rem;height:1rem;" />
            Costume Cost Paid
          </label>
        </div>
      </div>

      <div style="margin-top:1rem;padding:1rem;border-radius:12px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);">
        <p style="margin:0 0 0.6rem;font-size:0.8rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#ffd262;">Reset Password</p>
        <div style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap;">
          <input id="uem-password" type="password" placeholder="New password (min 8 chars)" autocomplete="new-password" style="flex:1;min-width:160px;padding:0.65rem 0.9rem;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#f5f7ff;font:inherit;" />
          <button type="button" id="uem-reset-pw" class="button secondary">Reset Password</button>
        </div>
      </div>

      <div id="uem-feedback" style="min-height:1.2em;font-size:0.88rem;color:#b8c4e0;margin:0.75rem 0;"></div>

      <div style="display:flex;gap:0.75rem;flex-wrap:wrap;justify-content:space-between;align-items:center;">
        <div style="display:flex;gap:0.6rem;flex-wrap:wrap;">
          <button type="button" id="uem-save" class="button">Save Changes</button>
          <button type="button" id="uem-toggle-disable" class="button secondary" ${user.id===currentUserId?'disabled':''}>${full.role==='disabled'?'Enable Account':'Disable Account'}</button>
        </div>
        <button type="button" id="uem-delete" class="button secondary" style="border-color:rgba(255,155,155,0.45);color:#ff9b9b;" ${user.id===currentUserId?'disabled':''}>Delete User</button>
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

  const kidsFloatNums = full.kids_float_numbers || [];
  const riderFloatNums = full.rider_float_numbers || [];
  const riderFloatNames = full.rider_float_names || [];
  (full.kids_names || []).forEach((n, i) => addListItem('uem-kids', n, kidsFloatNums[i] || ''));
  (full.float_riders || []).forEach((n, i) => addListItem('uem-riders', n, riderFloatNums[i] || '', riderFloatNames[i] || ''));

  backdrop.querySelector('#uem-add-kid').addEventListener('click', () => addListItem('uem-kids', '', ''));
  backdrop.querySelector('#uem-add-rider').addEventListener('click', () => addListItem('uem-riders', '', '', ''));

  const feedbackEl = backdrop.querySelector('#uem-feedback');
  function setFeedback(msg, isError) {
    feedbackEl.textContent = msg;
    feedbackEl.style.color = isError ? '#ff9b9b' : '#88d498';
  }

  function close() { backdrop.remove(); }
  backdrop.querySelector('#uem-close').addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

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
      member_float_number: backdrop.querySelector('#uem-member-float').value.trim(),
      spouse_float_number: backdrop.querySelector('#uem-spouse-float').value.trim(),
      guest_float_number: backdrop.querySelector('#uem-guest-float').value.trim(),
      kids_names: Array.from(backdrop.querySelectorAll('#uem-kids .uem-list-name')).map(i=>i.value.trim()).filter(Boolean),
      kids_float_numbers: Array.from(backdrop.querySelectorAll('#uem-kids .uem-list-name')).map((nameInp) => {
        const row = nameInp.closest('div');
        return row ? (row.querySelector('.uem-list-float')?.value.trim() || '') : '';
      }),
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
        const actionCell = buildCell('');

        row.appendChild(nameCell);
        row.appendChild(emailCell);
        row.appendChild(joinedCell);
        row.appendChild(roleCell);
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
  (profile.float_riders || []).forEach((name) => buildRemovableInput(ridersList, name, 'Rider name'));

  document.getElementById('add-kid-btn').addEventListener('click', () => {
    buildRemovableInput(kidsList, '', 'Child name');
  });
  document.getElementById('add-rider-btn').addEventListener('click', () => {
    buildRemovableInput(ridersList, '', 'Rider name');
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
          float_riders: getListValues(ridersList),
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

  el.innerHTML = `
    <div class="db-avatar" aria-hidden="true">${initials}</div>
    <div class="db-hero-info">
      <h1 class="db-hero-name">Welcome back, ${profile.full_name}</h1>
      <ul class="db-hero-meta">
        <li><strong>Email:</strong> ${profile.email}</li>
        <li><strong>Member since:</strong> ${new Date(profile.joined_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</li>
        <li><span class="db-badge ${badgeClass}">${badgeLabel}</span></li>
      </ul>
    </div>
  `;

  if (profile.role === 'admin') {
    const adminTab = document.getElementById('db-tab-admin');
    if (adminTab) adminTab.hidden = false;
    const adminTools = document.getElementById('admin-tools');
    if (adminTools) adminTools.style.display = 'block';
    const adminConfigCard = document.getElementById('admin-config-card');
    if (adminConfigCard) adminConfigCard.style.display = 'block';
    const adminBackupCard = document.getElementById('admin-backup-card');
    if (adminBackupCard) adminBackupCard.style.display = 'block';
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

function initAuthPages() {
  initDashboard();
  initUserManagementPage();
  initConfigurationPage();
  initBackupRestorePage();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAuthPages);
else initAuthPages();
