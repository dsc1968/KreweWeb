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
      submitButton.textContent = 'Verify and create account';

      let message = resp.message || 'Verification code sent.';
      if (resp.devVerificationCode) {
        message += ` Dev code: ${resp.devVerificationCode}`;
      }
      setRegisterFeedback(message, false);
    } finally {
      submitButton.disabled = false;
    }
  });
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

        const select = document.createElement('select');
        select.className = 'admin-user-select';
        select.innerHTML = `
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        `;
        select.value = user.role === 'disabled' ? 'member' : user.role;
        select.disabled = user.id === currentUserId;

        select.addEventListener('change', async () => {
          const previousRole = user.role;
          const nextRole = select.value;
          setAdminFeedback(`Saving role change for ${user.email}...`, false);
          select.disabled = true;

          const result = await updateUserRole(user.id, nextRole);
          if (!result.ok || !result.data.user) {
            user.role = previousRole;
            select.value = previousRole === 'disabled' ? 'member' : previousRole;
            setAdminFeedback(result.data.error || 'Unable to update role', true);
            select.disabled = user.id === currentUserId;
            return;
          }

          user.role = result.data.user.role;
          roleCell.textContent = user.role;
          updateAdminSummary(users);
          drawRows();
          setAdminFeedback(`Updated ${user.email} to ${user.role}.`, false);
        });

        const disableButton = document.createElement('button');
        disableButton.type = 'button';
        disableButton.className = 'button secondary';
        disableButton.style.marginLeft = '0.5rem';
        disableButton.textContent = user.role === 'disabled' ? 'Enable' : 'Disable';
        disableButton.disabled = user.id === currentUserId;
        disableButton.addEventListener('click', async () => {
          const shouldDisable = user.role !== 'disabled';
          const actionLabel = shouldDisable ? 'disable' : 'enable';
          setAdminFeedback(`${actionLabel.charAt(0).toUpperCase() + actionLabel.slice(1)} ${user.email}...`, false);
          disableButton.disabled = true;
          select.disabled = true;

          const result = await setUserDisabled(user.id, shouldDisable);
          if (!result.ok || !result.data.user) {
            setAdminFeedback(result.data.error || 'Unable to update user state', true);
            disableButton.disabled = user.id === currentUserId;
            select.disabled = user.id === currentUserId;
            return;
          }

          user.role = result.data.user.role;
          roleCell.textContent = user.role;
          updateAdminSummary(users);
          drawRows();
          setAdminFeedback(`${shouldDisable ? 'Disabled' : 'Enabled'} ${user.email}.`, false);
        });

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'button secondary';
        deleteButton.style.marginLeft = '0.5rem';
        deleteButton.style.borderColor = 'rgba(255, 155, 155, 0.45)';
        deleteButton.textContent = 'Delete';
        deleteButton.disabled = user.id === currentUserId;
        deleteButton.addEventListener('click', async () => {
          const confirmed = window.confirm(`Delete ${user.email}? This cannot be undone.`);
          if (!confirmed) return;

          const verifyText = window.prompt(`Type DELETE to permanently remove ${user.email}.`);
          if (verifyText !== 'DELETE') {
            setAdminFeedback('Delete cancelled. Confirmation text did not match.', true);
            return;
          }

          setAdminFeedback(`Deleting ${user.email}...`, false);
          deleteButton.disabled = true;
          disableButton.disabled = true;
          select.disabled = true;

          const result = await deleteUser(user.id);
          if (!result.ok) {
            setAdminFeedback(result.data.error || 'Unable to delete user', true);
            deleteButton.disabled = user.id === currentUserId;
            disableButton.disabled = user.id === currentUserId;
            select.disabled = user.id === currentUserId;
            return;
          }

          const index = users.findIndex((item) => item.id === user.id);
          if (index >= 0) {
            users.splice(index, 1);
          }
          updateAdminSummary(users);
          drawRows();
          setAdminFeedback(`Deleted ${user.email}.`, false);
        });

        const resetPasswordButton = document.createElement('button');
        resetPasswordButton.type = 'button';
        resetPasswordButton.className = 'button secondary';
        resetPasswordButton.style.marginLeft = '0.5rem';
        resetPasswordButton.textContent = 'Reset Password';
        resetPasswordButton.addEventListener('click', async () => {
          const nextPassword = window.prompt(`Enter a new password for ${user.email} (minimum 8 characters).`);
          if (nextPassword === null) return;

          const password = nextPassword.trim();
          if (password.length < 8) {
            setAdminFeedback('Password reset cancelled. Password must be at least 8 characters.', true);
            return;
          }

          setAdminFeedback(`Resetting password for ${user.email}...`, false);
          resetPasswordButton.disabled = true;
          deleteButton.disabled = true;
          disableButton.disabled = true;
          select.disabled = true;

          const result = await resetUserPassword(user.id, password);
          if (!result.ok) {
            setAdminFeedback(result.data.error || 'Unable to reset password', true);
            resetPasswordButton.disabled = false;
            deleteButton.disabled = user.id === currentUserId;
            disableButton.disabled = user.id === currentUserId;
            select.disabled = user.id === currentUserId;
            return;
          }

          setAdminFeedback(`Password reset for ${user.email}.`, false);
          resetPasswordButton.disabled = false;
          deleteButton.disabled = user.id === currentUserId;
          disableButton.disabled = user.id === currentUserId;
          select.disabled = user.id === currentUserId;
        });

        actionCell.appendChild(select);
        actionCell.appendChild(resetPasswordButton);
        actionCell.appendChild(disableButton);
        actionCell.appendChild(deleteButton);
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

async function initDashboard() {
  const el = document.getElementById('profile');
  if (!el) return;
  const profile = await fetchProfile();
  if (!profile) {
    window.location.href = '/login.html';
    return;
  }
  el.innerHTML = `\n    <h2>Welcome, ${profile.full_name}</h2>\n    <p><strong>Email:</strong> ${profile.email}</p>\n    <p><strong>Member Since:</strong> ${new Date(profile.joined_at).toLocaleDateString()}</p>\n    <p><strong>Role:</strong> ${profile.role}</p>\n  `;

  if (profile.role === 'admin') {
    const adminTools = document.getElementById('admin-tools');
    if (adminTools) {
      adminTools.style.display = 'block';
    }
  }
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

function initAuthPages() {
  initDashboard();
  initUserManagementPage();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAuthPages);
else initAuthPages();
