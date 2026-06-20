const countdownTarget = new Date('2027-03-01T12:00:00').getTime();
const countdownElements = {
  days: document.getElementById('days'),
  hours: document.getElementById('hours'),
  minutes: document.getElementById('minutes'),
  seconds: document.getElementById('seconds'),
};

function formatTime(value) {
  return String(value).padStart(2, '0');
}

function updateCountdown() {
  if (!countdownElements.days || !countdownElements.hours || !countdownElements.minutes || !countdownElements.seconds) {
    return;
  }
  const now = Date.now();
  const distance = countdownTarget - now;

  if (distance <= 0) {
    const countdown = document.getElementById('countdown');
    if (countdown) countdown.innerHTML = '<span class="countdown-complete">Parade day is here!</span>';
    return;
  }

  const days = Math.floor(distance / (1000 * 60 * 60 * 24));
  const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((distance % (1000 * 60)) / 1000);

  countdownElements.days.textContent = formatTime(days);
  countdownElements.hours.textContent = formatTime(hours);
  countdownElements.minutes.textContent = formatTime(minutes);
  countdownElements.seconds.textContent = formatTime(seconds);
}

if (countdownElements.days) {
  updateCountdown();
  setInterval(updateCountdown, 1000);
}

(function () {
  const editableTextSelector = 'h1, h2, h3, h4, h5, h6, p, a, span, small, strong, li, button, label, figcaption';
  const leafTextSelector = 'h1,h2,h3,h4,h5,h6,p,a,span,small,strong,li,button,label,figcaption';
  const state = {
    pagePath: normalizePagePath(window.location.pathname),
    profilePromise: null,
    editMode: false,
    registry: new Map(),
    modal: null,
    sectionModal: null,
    pageSections: [],
    elementOverrides: new Map(),
    draggedSection: null,
    calendarDefaultsByContext: new Map(),
    calendarDefaults: new Map(),
    calendarOverrides: new Map(),
    calendarYear: null,
    calendarMonth: null,
    calendarDefaultYear: 2027,
    calendarDefaultMonth: 2,
  };
  const nonEditablePagePaths = new Set(['/dashboard.html']);

  function isPageEditable() {
    return !nonEditablePagePaths.has(state.pagePath);
  }

  function getStoredToken() {
    return localStorage.getItem('krewe_token');
  }

  function normalizePagePath(pathname) {
    if (!pathname || pathname === '/' || pathname === '/index.html') return '/';
    return pathname.startsWith('/') ? pathname : `/${pathname}`;
  }

  function withCacheBust(pathValue, updatedAt) {
    if (!updatedAt) return pathValue;
    const separator = pathValue.includes('?') ? '&' : '?';
    return `${pathValue}${separator}v=${encodeURIComponent(updatedAt)}`;
  }

  function persistImageCache(contentKey, imagePath) {
    try {
      const cacheKey = `adminCachedImage:${state.pagePath}:${contentKey}`;
      if (imagePath) {
        localStorage.setItem(cacheKey, imagePath);
      } else {
        localStorage.removeItem(cacheKey);
      }
    } catch (_error) {
      // Ignore localStorage failures in restricted browser contexts.
    }
  }

  function syncHomeHeroBootImage(contentKey, imagePath) {
    if (state.pagePath !== '/' || contentKey !== 'header#home|image') return;
    document.documentElement.style.setProperty('--home-hero-image', `url("${imagePath}")`);
  }

  async function parseApiResponse(response) {
    const responseType = response.headers.get('content-type') || '';

    if (responseType.includes('application/json')) {
      return response.json();
    }

    const text = await response.text();
    return {
      error: text.trim() || 'The server returned a non-JSON response. Restart the server and try again.',
    };
  }

  function ensureContactStatusNode(form) {
    let status = form.querySelector('.contact-form-status');
    if (status) return status;

    status = document.createElement('p');
    status.className = 'contact-form-status';
    status.setAttribute('aria-live', 'polite');
    status.style.marginTop = '0.75rem';
    status.style.fontSize = '0.95rem';
    form.appendChild(status);
    return status;
  }

  function initContactForm() {
    if (state.pagePath !== '/contact.html') return;

    const form = document.querySelector('.contact-form');
    if (!form || form.dataset.bound === 'true') return;

    const submitButton = form.querySelector('button[type="submit"]');
    const status = ensureContactStatusNode(form);

    form.dataset.bound = 'true';
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!submitButton) return;

      const formData = new FormData(form);
      const payload = {
        name: String(formData.get('name') || '').trim(),
        email: String(formData.get('email') || '').trim(),
        subject: String(formData.get('subject') || '').trim(),
        message: String(formData.get('message') || '').trim(),
      };

      submitButton.disabled = true;
      status.textContent = 'Sending your message...';
      status.style.color = '#9ec5ff';

      try {
        const response = await fetch('/api/contact', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        const data = await parseApiResponse(response);
        if (!response.ok) {
          throw new Error(data.error || 'Unable to send your message right now.');
        }

        form.reset();
        status.textContent = 'Message sent. We will get back to you soon.';
        status.style.color = '#88d498';
      } catch (error) {
        status.textContent = error.message;
        status.style.color = '#ff9b9b';
      } finally {
        submitButton.disabled = false;
      }
    });
  }

  async function fetchPageSections() {
    const res = await fetch(`/api/page-sections?page=${encodeURIComponent(state.pagePath)}`);
    if (!res.ok) return [];
    const data = await parseApiResponse(res);
    return Array.isArray(data.items) ? data.items : [];
  }

  async function fetchElementOverrides() {
    const res = await fetch(`/api/element-overrides?page=${encodeURIComponent(state.pagePath)}`);
    if (!res.ok) return [];
    const data = await parseApiResponse(res);
    return Array.isArray(data.items) ? data.items : [];
  }

  function getCalendarContextKey(year, monthIndex) {
    return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  }

  function getCalendarMonthName(monthIndex) {
    return new Date(2000, monthIndex, 1).toLocaleString(undefined, { month: 'long' });
  }

  async function fetchCalendarEvents() {
    const page = encodeURIComponent(state.pagePath);
    const month = encodeURIComponent(String(state.calendarMonth + 1));
    const year = encodeURIComponent(String(state.calendarYear));
    const res = await fetch(`/api/calendar-events?page=${page}&month=${month}&year=${year}`);
    if (!res.ok) return [];
    const data = await parseApiResponse(res);
    return (Array.isArray(data.items) ? data.items : [])
      .map((item) => {
        const day = Number.parseInt(item.day_of_month, 10);
        if (!Number.isInteger(day) || day < 1 || day > 31) return null;

        const yearValue = Number.parseInt(item.event_year, 10);
        const monthValue = Number.parseInt(item.event_month, 10);
        return {
          ...item,
          day_of_month: day,
          event_year: Number.isInteger(yearValue) ? yearValue : null,
          event_month: Number.isInteger(monthValue) ? monthValue : null,
        };
      })
      .filter(Boolean);
  }

  async function fetchCalendarEventsFallback() {
    const res = await fetch(`/api/content?page=${encodeURIComponent(state.pagePath)}`);
    if (!res.ok) return [];
    const data = await parseApiResponse(res);
    const items = Array.isArray(data.items) ? data.items : [];

    return items
      .map((item) => {
        if (item.content_type !== 'text') return null;
        const monthlyMatch = /^calendar-(\d{4})-(\d{2})-day-(\d+)\|text$/.exec(item.content_key || '');
        const legacyMatch = /^calendar-day-(\d+)\|text$/.exec(item.content_key || '');
        if (!monthlyMatch && !legacyMatch) return null;

        let year;
        let month;
        let day;

        if (monthlyMatch) {
          year = Number.parseInt(monthlyMatch[1], 10);
          month = Number.parseInt(monthlyMatch[2], 10);
          day = Number.parseInt(monthlyMatch[3], 10);
        } else {
          year = state.calendarDefaultYear;
          month = state.calendarDefaultMonth + 1;
          day = Number.parseInt(legacyMatch[1], 10);
        }

        if (!Number.isInteger(day) || day < 1 || day > 31) return null;
        if (!Number.isInteger(month) || month < 1 || month > 12) return null;
        if (!Number.isInteger(year) || year < 1900 || year > 3000) return null;

        const rawValue = typeof item.content_value === 'string' ? item.content_value.trim() : '';
        const isDeleted = rawValue === '__deleted__';
        return {
          event_year: year,
          event_month: month,
          day_of_month: day,
          title: isDeleted ? null : rawValue,
          is_deleted: isDeleted,
          updated_at: item.updated_at,
        };
      })
      .filter(Boolean);
  }

  function getCalendarFallbackContentKey(dayOfMonth, year, monthIndex) {
    const month = String(monthIndex + 1).padStart(2, '0');
    return `calendar-${year}-${month}-day-${dayOfMonth}|text`;
  }

  function getCalendarDefaultContextKey() {
    return getCalendarContextKey(state.calendarDefaultYear, state.calendarDefaultMonth);
  }

  function getCurrentCalendarContextKey() {
    return getCalendarContextKey(state.calendarYear, state.calendarMonth);
  }

  async function saveCalendarEvent(dayOfMonth, title) {
    const fallbackItem = await saveContentUpdate({
      contentKey: getCalendarFallbackContentKey(dayOfMonth, state.calendarYear, state.calendarMonth),
      contentType: 'text',
      contentValue: title,
    });

    return {
      event_year: state.calendarYear,
      event_month: state.calendarMonth + 1,
      day_of_month: dayOfMonth,
      title,
      is_deleted: false,
      updated_at: fallbackItem.updated_at,
    };
  }

  async function deleteCalendarEvent(dayOfMonth) {
    const fallbackItem = await saveContentUpdate({
      contentKey: getCalendarFallbackContentKey(dayOfMonth, state.calendarYear, state.calendarMonth),
      contentType: 'text',
      contentValue: '__deleted__',
    });

    return {
      event_year: state.calendarYear,
      event_month: state.calendarMonth + 1,
      day_of_month: dayOfMonth,
      title: null,
      is_deleted: true,
      updated_at: fallbackItem.updated_at,
    };
  }

  async function createPageSection(payload) {
    const token = getStoredToken();
    const res = await fetch('/api/admin/page-sections', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        pagePath: state.pagePath,
        title: payload.title,
        body: payload.body,
      }),
    });
    const data = await parseApiResponse(res);
    if (!res.ok) {
      throw new Error(data.error || 'Unable to create section');
    }
    return data.item;
  }

  async function updatePageSection(sectionId, field, value) {
    const token = getStoredToken();
    const res = await fetch(`/api/admin/page-sections/${sectionId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ field, value }),
    });
    const data = await parseApiResponse(res);
    if (!res.ok) {
      throw new Error(data.error || 'Unable to update section');
    }
    return data.item;
  }

  async function deletePageSection(sectionId) {
    const token = getStoredToken();
    const res = await fetch(`/api/admin/page-sections/${sectionId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await parseApiResponse(res);
    if (!res.ok) {
      throw new Error(data.error || 'Unable to delete section');
    }
    return data;
  }

  async function saveElementOverride(elementKey, patch) {
    const token = getStoredToken();
    const current = state.elementOverrides.get(elementKey) || {};
    const payload = {
      pagePath: state.pagePath,
      elementKey,
      hidden: patch.hidden ?? current.hidden ?? false,
      textAlign: patch.textAlign ?? current.text_align ?? null,
      fontWeight: patch.fontWeight ?? current.font_weight ?? null,
      fontStyle: patch.fontStyle ?? current.font_style ?? null,
      textTransform: patch.textTransform ?? current.text_transform ?? null,
      textColor: patch.textColor ?? current.text_color ?? null,
      position: Number.isInteger(patch.position) ? patch.position : (Number.isInteger(current.position) ? current.position : null),
    };

    const res = await fetch('/api/admin/element-overrides', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await parseApiResponse(res);
    if (!res.ok) {
      throw new Error(data.error || 'Unable to save element settings');
    }

    state.elementOverrides.set(elementKey, data.item);
    return data.item;
  }

  async function reorderDynamicSections(orderedIds) {
    const token = getStoredToken();
    const res = await fetch('/api/admin/page-sections/reorder', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ orderedIds }),
    });
    const data = await parseApiResponse(res);
    if (!res.ok) {
      throw new Error(data.error || 'Unable to reorder sections');
    }
    return data;
  }

  function initHeaderState() {
    const token = getStoredToken();
    const isLoggedIn = Boolean(token);
    const headerButton = document.querySelector('.header-button');
    const headerInner = document.querySelector('.header-inner');
    const nav = document.querySelector('.site-nav');
    const joinLink = nav ? Array.from(nav.querySelectorAll('a')).find((link) => {
      try {
        return new URL(link.getAttribute('href'), window.location.origin).pathname === '/register.html';
      } catch (_error) {
        return false;
      }
    }) : null;

    if (headerButton) {
      headerButton.setAttribute('href', isLoggedIn ? '/dashboard.html' : '/login.html');
      headerButton.textContent = isLoggedIn ? 'Dashboard' : 'Member Portal';
    }

    if (joinLink) {
      joinLink.style.display = isLoggedIn ? 'none' : '';
    }

    const existingAuthLink = document.getElementById('nav-auth-link');
    if (existingAuthLink) {
      existingAuthLink.remove();
    }

    if (nav && !isLoggedIn) {
      const authLink = document.createElement('a');
      authLink.id = 'nav-auth-link';
      authLink.href = '/login.html';
      authLink.textContent = 'Login';
      nav.appendChild(authLink);
    }

    const existingLoginActions = document.getElementById('login-actions');
    if (existingLoginActions) {
      existingLoginActions.remove();
    }

    if (headerInner && isLoggedIn) {
      const actions = document.createElement('span');
      actions.id = 'login-actions';
      actions.style.display = 'inline-flex';
      actions.style.alignItems = 'center';
      actions.style.gap = '0.5rem';

      const dashboardLink = document.createElement('a');
      dashboardLink.id = 'dashboard-badge';
      dashboardLink.className = 'login-badge';
      dashboardLink.href = '/dashboard.html';
      dashboardLink.textContent = 'Dashboard';

      const logoutLink = document.createElement('a');
      logoutLink.id = 'logout-badge';
      logoutLink.className = 'login-badge';
      logoutLink.href = '#';
      logoutLink.textContent = 'Log Off';
      logoutLink.addEventListener('click', (event) => {
        event.preventDefault();
        localStorage.removeItem('krewe_token');
        window.location.href = '/';
      });

      actions.appendChild(dashboardLink);
      actions.appendChild(logoutLink);
      headerInner.appendChild(actions);
    }
  }

  async function fetchCurrentProfile() {
    if (state.profilePromise) return state.profilePromise;

    const token = getStoredToken();
    if (!token) {
      state.profilePromise = Promise.resolve(null);
      return state.profilePromise;
    }

    state.profilePromise = fetch('/api/profile', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);

    return state.profilePromise;
  }

  function isInsideAdminUi(element) {
    return Boolean(element.closest('.admin-edit-nav-button, .admin-add-section-button, .admin-editor-modal, .admin-editor-backdrop, .admin-section-tools'));
  }

  function hasNestedEditableText(element) {
    return Array.from(element.children).some((child) => child.matches(leafTextSelector));
  }

  function getNthOfType(element) {
    let index = 1;
    let sibling = element.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === element.tagName) index += 1;
      sibling = sibling.previousElementSibling;
    }
    return index;
  }

  function buildContentKey(element, contentType) {
    const segments = [];
    let current = element;

    while (current && current !== document.body) {
      if (current.id) {
        segments.unshift(`${current.tagName.toLowerCase()}#${current.id}`);
        break;
      }
      segments.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${getNthOfType(current)})`);
      current = current.parentElement;
    }

    return `${segments.join('>')}|${contentType}`;
  }

  function getStaticSections() {
    const main = document.querySelector('main');
    if (!main) return [];
    return Array.from(main.children).filter((element) => element.tagName === 'SECTION' && !element.dataset.adminDynamicSection);
  }

  function assignStaticSectionKeys() {
    getStaticSections().forEach((section, index) => {
      const key = section.id ? `static-section:${section.id}` : `static-section:${index}`;
      section.dataset.adminStaticSectionKey = key;
      section.dataset.adminSectionType = 'static';
      if (!section.dataset.adminBackgroundVar) {
        section.dataset.adminBackgroundVar = '--admin-section-bg';
      }
    });
  }

  function registerEditableElements() {
    state.registry.clear();
    assignStaticSectionKeys();

    document.querySelectorAll(editableTextSelector).forEach((element) => {
      if (!element.textContent.trim()) return;
      if (isInsideAdminUi(element)) return;
      if (element.closest('[data-admin-dynamic-section]')) return;
      if (element.querySelector('img, input, textarea, select')) return;
      if (hasNestedEditableText(element) && element.tagName !== 'LI') return;

      const key = buildContentKey(element, 'text');
      element.dataset.adminEditable = 'text';
      element.dataset.adminKey = key;
      state.registry.set(`text:${key}`, element);
    });

    document.querySelectorAll('img').forEach((element) => {
      if (isInsideAdminUi(element)) return;
      if (element.closest('[data-admin-dynamic-section]')) return;
      const key = buildContentKey(element, 'image');
      element.dataset.adminEditable = 'image';
      element.dataset.adminKey = key;
      state.registry.set(`image:${key}`, element);
    });

    document.querySelectorAll('[data-admin-background-var]').forEach((element) => {
      if (isInsideAdminUi(element)) return;
      if (element.closest('[data-admin-dynamic-section]')) return;
      const key = buildContentKey(element, 'image');
      element.dataset.adminEditable = 'background-image';
      element.dataset.adminKey = key;
      state.registry.set(`image:${key}`, element);
    });
  }

  function applyElementStyles(element, override) {
    if (!element || !override) return;
    element.style.textAlign = override.text_align || '';
    element.style.fontWeight = override.font_weight || '';
    element.style.fontStyle = override.font_style || '';
    element.style.textTransform = override.text_transform || '';
    element.style.color = override.text_color || '';
  }

  function normalizeColorValue(value) {
    if (typeof value !== 'string') return '';
    const normalized = value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(normalized)) return normalized;
    if (/^#[0-9a-fA-F]{3}$/.test(normalized)) {
      const r = normalized[1];
      const g = normalized[2];
      const b = normalized[3];
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    return '';
  }

  function rememberInlineDisplay(element) {
    if (!element) return;
    if (!Object.prototype.hasOwnProperty.call(element.dataset, 'adminOriginalDisplay')) {
      element.dataset.adminOriginalDisplay = element.style.display || '';
    }
  }

  function setAdminHiddenState(element, hidden) {
    if (!element) return;
    rememberInlineDisplay(element);
    element.classList.toggle('admin-hidden-element', Boolean(hidden));
    if (hidden && !state.editMode) {
      element.style.display = 'none';
      return;
    }

    element.style.display = element.dataset.adminOriginalDisplay || '';
  }

  function getCalendarDayCells() {
    return Array.from(document.querySelectorAll('.event-calendar tbody td'));
  }

  function getCalendarElements() {
    const card = document.querySelector('.event-calendar-card');
    if (!card) return null;

    return {
      card,
      title: card.querySelector('#event-calendar-title'),
      table: card.querySelector('.event-calendar'),
      tbody: card.querySelector('.event-calendar tbody'),
      monthSelect: card.querySelector('#event-calendar-month'),
      yearSelect: card.querySelector('#event-calendar-year'),
    };
  }

  function renderCalendarGrid(year, monthIndex) {
    const elements = getCalendarElements();
    if (!elements || !elements.tbody) return;

    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const startWeekday = new Date(year, monthIndex, 1).getDay();

    if (elements.title) {
      elements.title.textContent = `${getCalendarMonthName(monthIndex)} ${year}`;
    }

    if (elements.table) {
      elements.table.setAttribute('aria-label', `Krewe events calendar for ${getCalendarMonthName(monthIndex)} ${year}`);
    }

    const fragment = document.createDocumentFragment();
    let day = 1;

    for (let week = 0; week < 6; week += 1) {
      const row = document.createElement('tr');

      for (let weekday = 0; weekday < 7; weekday += 1) {
        const cell = document.createElement('td');
        const cellIndex = (week * 7) + weekday;

        if (cellIndex >= startWeekday && day <= daysInMonth) {
          cell.textContent = String(day);
          cell.dataset.calendarDay = String(day);
          day += 1;
        }

        row.appendChild(cell);
      }

      fragment.appendChild(row);
      if (day > daysInMonth) break;
    }

    elements.tbody.replaceChildren(fragment);
  }

  function populateCalendarSelectors() {
    const elements = getCalendarElements();
    if (!elements || !elements.monthSelect || !elements.yearSelect) return;

    if (!elements.monthSelect.options.length) {
      for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
        const option = document.createElement('option');
        option.value = String(monthIndex + 1);
        option.textContent = getCalendarMonthName(monthIndex);
        elements.monthSelect.appendChild(option);
      }
    }

    if (!elements.yearSelect.options.length) {
      const startYear = state.calendarDefaultYear - 5;
      const endYear = state.calendarDefaultYear + 8;
      for (let year = startYear; year <= endYear; year += 1) {
        const option = document.createElement('option');
        option.value = String(year);
        option.textContent = String(year);
        elements.yearSelect.appendChild(option);
      }
    }

    elements.monthSelect.value = String(state.calendarMonth + 1);
    elements.yearSelect.value = String(state.calendarYear);
  }

  function initializeCalendarUi() {
    if (state.pagePath !== '/events.html') return;

    const elements = getCalendarElements();
    if (!elements || !elements.card) return;

    const defaultYear = Number.parseInt(elements.card.dataset.calendarDefaultYear || '', 10);
    const defaultMonth = Number.parseInt(elements.card.dataset.calendarDefaultMonth || '', 10);

    if (Number.isInteger(defaultYear) && defaultYear > 1900 && defaultYear < 3000) {
      state.calendarDefaultYear = defaultYear;
    }

    if (Number.isInteger(defaultMonth) && defaultMonth >= 1 && defaultMonth <= 12) {
      state.calendarDefaultMonth = defaultMonth - 1;
    }

    if (!Number.isInteger(state.calendarYear)) {
      state.calendarYear = state.calendarDefaultYear;
    }

    if (!Number.isInteger(state.calendarMonth)) {
      state.calendarMonth = state.calendarDefaultMonth;
    }

    populateCalendarSelectors();
    renderCalendarGrid(state.calendarYear, state.calendarMonth);

    if (elements.monthSelect && !elements.monthSelect.dataset.calendarBound) {
      elements.monthSelect.dataset.calendarBound = 'true';
      elements.monthSelect.addEventListener('change', () => {
        const nextMonth = Number.parseInt(elements.monthSelect.value, 10);
        if (!Number.isInteger(nextMonth) || nextMonth < 1 || nextMonth > 12) return;
        state.calendarMonth = nextMonth - 1;
        renderCalendarGrid(state.calendarYear, state.calendarMonth);
        loadCalendarEvents().catch(() => {
          state.calendarOverrides = new Map();
          applyCalendarEventsToDom();
        });
      });
    }

    if (elements.yearSelect && !elements.yearSelect.dataset.calendarBound) {
      elements.yearSelect.dataset.calendarBound = 'true';
      elements.yearSelect.addEventListener('change', () => {
        const nextYear = Number.parseInt(elements.yearSelect.value, 10);
        if (!Number.isInteger(nextYear) || nextYear < 1900 || nextYear > 3000) return;
        state.calendarYear = nextYear;
        renderCalendarGrid(state.calendarYear, state.calendarMonth);
        loadCalendarEvents().catch(() => {
          state.calendarOverrides = new Map();
          applyCalendarEventsToDom();
        });
      });
    }
  }

  function parseDayValue(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 31) return null;
    return parsed;
  }

  function getDayFromCalendarCell(cell) {
    const span = cell.querySelector('span');
    if (span && span.textContent.trim()) {
      return parseDayValue(span.textContent.trim());
    }

    const text = cell.childNodes.length > 0 ? cell.childNodes[0].textContent : cell.textContent;
    return parseDayValue((text || '').trim());
  }

  function getEventTitleFromCell(cell) {
    const small = cell.querySelector('small');
    return small ? small.textContent.trim() : '';
  }

  function setCalendarCellEvent(cell, day, title) {
    cell.textContent = '';
    if (!Number.isInteger(day)) return;

    if (!title) {
      cell.classList.remove('is-event');
      cell.textContent = String(day);
      cell.dataset.calendarDay = String(day);
      return;
    }

    cell.classList.add('is-event');
    const dayLabel = document.createElement('span');
    dayLabel.textContent = String(day);
    const eventLabel = document.createElement('small');
    eventLabel.textContent = title;
    cell.appendChild(dayLabel);
    cell.appendChild(eventLabel);
    cell.dataset.calendarDay = String(day);
  }

  function applyCalendarEventsToDom() {
    const contextDefaults = state.calendarDefaultsByContext.get(getCurrentCalendarContextKey()) || new Map();
    state.calendarDefaults = contextDefaults;

    getCalendarDayCells().forEach((cell) => {
      const day = getDayFromCalendarCell(cell);
      if (!Number.isInteger(day)) {
        cell.removeAttribute('data-calendar-day');
        return;
      }

      const defaultTitle = state.calendarDefaults.get(day) || '';
      const override = state.calendarOverrides.get(day);
      if (override && override.is_deleted) {
        setCalendarCellEvent(cell, day, '');
        return;
      }

      const nextTitle = override && typeof override.title === 'string' ? override.title : defaultTitle;
      setCalendarCellEvent(cell, day, nextTitle);
    });
  }

  function captureCalendarDefaults() {
    if (state.pagePath !== '/events.html') return;

    if (getCurrentCalendarContextKey() !== getCalendarDefaultContextKey()) {
      state.calendarDefaults = state.calendarDefaultsByContext.get(getCurrentCalendarContextKey()) || new Map();
      return;
    }

    if (state.calendarDefaultsByContext.has(getCalendarDefaultContextKey())) {
      state.calendarDefaults = state.calendarDefaultsByContext.get(getCalendarDefaultContextKey()) || new Map();
      return;
    }

    const defaults = new Map();
    getCalendarDayCells().forEach((cell) => {
      const day = getDayFromCalendarCell(cell);
      if (!Number.isInteger(day)) return;
      const title = getEventTitleFromCell(cell);
      if (title) {
        defaults.set(day, title);
      }
      cell.dataset.calendarDay = String(day);
    });

    state.calendarDefaultsByContext.set(getCalendarDefaultContextKey(), defaults);
    state.calendarDefaults = defaults;
  }

  async function loadCalendarEvents() {
    if (state.pagePath !== '/events.html') return;
    captureCalendarDefaults();

    try {
      const [items, fallbackItems] = await Promise.all([
        fetchCalendarEvents(),
        fetchCalendarEventsFallback(),
      ]);
      const merged = [...items, ...fallbackItems].filter((item) => {
        const itemYear = Number.parseInt(item.event_year, 10);
        const itemMonth = Number.parseInt(item.event_month, 10);

        if (Number.isInteger(itemYear) && Number.isInteger(itemMonth)) {
          return itemYear === state.calendarYear && itemMonth === (state.calendarMonth + 1);
        }

        return getCurrentCalendarContextKey() === getCalendarDefaultContextKey();
      });

      state.calendarOverrides = new Map(
        merged
          .map((item) => {
            const day = Number.parseInt(item.day_of_month, 10);
            return Number.isInteger(day) ? [day, item] : null;
          })
          .filter(Boolean)
      );
    } catch (_error) {
      state.calendarOverrides = new Map();
    }

    applyCalendarEventsToDom();
  }

  async function editCalendarCell(cell) {
    const day = Number.parseInt(cell.dataset.calendarDay || '', 10);
    if (!Number.isInteger(day)) return;

    const override = state.calendarOverrides.get(day);
    const currentTitle = override
      ? (override.is_deleted ? '' : (override.title || ''))
      : (state.calendarDefaults.get(day) || '');
    const monthName = getCalendarMonthName(state.calendarMonth);
    const nextTitle = window.prompt(`Event title for ${monthName} ${day}, ${state.calendarYear} (leave empty to remove):`, currentTitle);
    if (nextTitle === null) return;

    const trimmedTitle = nextTitle.trim();
    if (!trimmedTitle) {
      const item = await deleteCalendarEvent(day);
      state.calendarOverrides.set(day, item);
      applyCalendarEventsToDom();
      return;
    }

    const item = await saveCalendarEvent(day, trimmedTitle);
    state.calendarOverrides.set(day, item);
    applyCalendarEventsToDom();
  }

  function applyElementOverrides() {
    state.registry.forEach((element) => {
      const key = element.dataset.adminKey;
      if (!key) return;
      const override = state.elementOverrides.get(key);
      setAdminHiddenState(element, override && override.hidden);
      if (!override) return;

      if (element.dataset.adminEditable === 'text') {
        applyElementStyles(element, override);
      }
    });

    getStaticSections().forEach((section) => {
      const key = section.dataset.adminStaticSectionKey;
      const override = key ? state.elementOverrides.get(key) : null;
      setAdminHiddenState(section, override && override.hidden);
    });
  }

  function applyStaticSectionOrder() {
    const main = document.querySelector('main');
    if (!main) return;

    const host = document.getElementById('dynamic-page-sections');
    const sections = getStaticSections();
    const sorted = sections.slice().sort((left, right) => {
      const leftOverride = state.elementOverrides.get(left.dataset.adminStaticSectionKey);
      const rightOverride = state.elementOverrides.get(right.dataset.adminStaticSectionKey);
      const leftPosition = Number.isInteger(leftOverride && leftOverride.position) ? leftOverride.position : Number.MAX_SAFE_INTEGER;
      const rightPosition = Number.isInteger(rightOverride && rightOverride.position) ? rightOverride.position : Number.MAX_SAFE_INTEGER;
      return leftPosition - rightPosition;
    });

    const anchor = host || document.querySelector('.footer');
    sorted.forEach((section) => {
      if (anchor && anchor.parentNode === main) {
        main.insertBefore(section, anchor);
      } else {
        main.appendChild(section);
      }
    });
  }

  function upsertPageSection(item) {
    const existingIndex = state.pageSections.findIndex((section) => section.id === item.id);
    if (existingIndex >= 0) {
      state.pageSections.splice(existingIndex, 1, item);
    } else {
      state.pageSections.push(item);
    }
    state.pageSections.sort((left, right) => left.position - right.position || left.id - right.id);
  }

  function renderPageSections() {
    const main = document.querySelector('main');
    const footer = document.querySelector('.footer');
    if (!main) return;

    let host = document.getElementById('dynamic-page-sections');
    if (!host) {
      host = document.createElement('div');
      host.id = 'dynamic-page-sections';
    }

    if (footer && footer.parentNode) {
      footer.parentNode.insertBefore(host, footer);
    } else if (host.parentNode !== main) {
      main.appendChild(host);
    }

    host.innerHTML = '';

    state.pageSections.forEach((section) => {
      const wrapper = document.createElement('section');
      wrapper.className = 'section dynamic-page-section';
      wrapper.dataset.adminDynamicSection = 'true';
      wrapper.dataset.adminSectionId = String(section.id);
      wrapper.dataset.adminSectionField = 'background_path';
      wrapper.dataset.adminEditable = 'background-image';
      wrapper.dataset.adminImagePath = section.background_path || '';

      if (section.background_path) {
        wrapper.style.setProperty('--dynamic-section-bg', `url("${withCacheBust(section.background_path, section.updated_at)}")`);
      } else {
        wrapper.style.removeProperty('--dynamic-section-bg');
      }

      const container = document.createElement('div');
      container.className = 'container';

      const card = document.createElement('div');
      card.className = 'dynamic-page-section-card grid-two';

      const copy = document.createElement('div');
      copy.className = 'dynamic-page-section-copy';

      const tag = document.createElement('span');
      tag.className = 'section-tag';
      tag.textContent = 'Custom Section';

      const title = document.createElement('h2');
      title.dataset.adminSectionId = String(section.id);
      title.dataset.adminSectionField = 'title';
      title.dataset.adminEditable = 'text';
      title.textContent = section.title;

      const body = document.createElement('p');
      body.className = 'section-copy';
      body.dataset.adminSectionId = String(section.id);
      body.dataset.adminSectionField = 'body';
      body.dataset.adminEditable = 'text';
      body.textContent = section.body;

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'button secondary admin-remove-section';
      removeButton.dataset.adminRemoveSection = String(section.id);
      removeButton.textContent = 'Remove Section';

      copy.appendChild(tag);
      copy.appendChild(title);
      copy.appendChild(body);
      copy.appendChild(removeButton);

      const media = document.createElement('div');
      media.className = 'dynamic-page-section-media';

      const image = document.createElement('img');
      image.src = withCacheBust(section.image_path, section.updated_at);
      image.alt = section.title;
      image.dataset.adminSectionId = String(section.id);
      image.dataset.adminSectionField = 'image_path';
      image.dataset.adminEditable = 'image';
      image.dataset.adminImagePath = section.image_path;

      media.appendChild(image);
      card.appendChild(copy);
      card.appendChild(media);
      container.appendChild(card);
      wrapper.appendChild(container);
      host.appendChild(wrapper);
    });
  }

  function applyContentItem(item) {
    const element = state.registry.get(`${item.content_type}:${item.content_key}`);
    if (!element) return;

    if (item.content_type === 'image') {
      const nextValue = withCacheBust(item.content_value, item.updated_at);
      element.dataset.adminImagePath = item.content_value;
      persistImageCache(item.content_key, item.content_value);
      syncHomeHeroBootImage(item.content_key, item.content_value);

      if (element.dataset.adminEditable === 'background-image') {
        if (!item.content_value) {
          if (element.tagName === 'HEADER') {
            const cssVarName = element.dataset.adminBackgroundVar;
            if (cssVarName) {
              element.style.removeProperty(cssVarName);
            }
          } else {
            element.style.removeProperty('background-image');
            element.style.removeProperty('background-position');
            element.style.removeProperty('background-size');
            element.style.removeProperty('background-repeat');
          }
          return;
        }

        const cssVarName = element.dataset.adminBackgroundVar;
        if (cssVarName && element.tagName === 'HEADER') {
          element.style.setProperty(cssVarName, `url("${nextValue}")`);
        } else {
          element.style.backgroundImage = `url("${nextValue}")`;
          element.style.backgroundPosition = 'top center';
          element.style.backgroundSize = 'cover';
          element.style.backgroundRepeat = 'no-repeat';
        }
        return;
      }

      element.src = nextValue;
      return;
    }

    element.textContent = item.content_value;
  }

  async function loadSavedContent() {
    try {
      const res = await fetch(`/api/content?page=${encodeURIComponent(state.pagePath)}`);
      if (!res.ok) return;
      const data = await parseApiResponse(res);
      (data.items || []).forEach((item) => {
        // Check if this is a dynamically added element
        if (item.content_key.includes('dynamic-text-') || item.content_key.includes('dynamic-image-')) {
          createAndRenderDynamicElement(item);
        } else {
          applyContentItem(item);
        }
      });
    } catch (_error) {
      // Ignore content load failures on the public site.
    }
  }

  function createAndRenderDynamicElement(item) {
    // Parse the content_key to find the parent section
    // Format: section#id>dynamic-text-timestamp|text or section#id>dynamic-image-timestamp|image
    const keyParts = item.content_key.split('>');
    if (keyParts.length < 2) return;

    const parentPath = keyParts.slice(0, -1).join('>');
    let parentSection = null;

    // Find the parent section in the DOM
    if (parentPath.includes('#')) {
      const id = parentPath.split('#')[1];
      parentSection = document.getElementById(id) || document.querySelector(`[data-admin-static-section-key="${parentPath}"]`);
    }

    if (!parentSection) return;

    // Create the element
    let newElement;
    if (item.content_type === 'text') {
      newElement = document.createElement('p');
      newElement.textContent = item.content_value;
      newElement.style.marginTop = '1rem';
    } else if (item.content_type === 'image') {
      newElement = document.createElement('img');
      newElement.src = item.content_value;
      newElement.alt = 'Added image';
      newElement.style.marginTop = '1rem';
      newElement.style.maxWidth = '100%';
      newElement.style.borderRadius = '8px';
    } else {
      return;
    }

    newElement.dataset.adminEditable = item.content_type;
    newElement.dataset.adminKey = item.content_key;
    parentSection.appendChild(newElement);
    state.registry.set(`${item.content_type}:${item.content_key}`, newElement);
  }

  async function loadPageSections() {
    try {
      state.pageSections = await fetchPageSections();
      renderPageSections();
    } catch (_error) {
      state.pageSections = [];
    }
  }

  async function loadElementOverrides() {
    try {
      const items = await fetchElementOverrides();
      state.elementOverrides = new Map(items.map((item) => [item.element_key, item]));
      applyStaticSectionOrder();
      applyElementOverrides();
    } catch (_error) {
      state.elementOverrides = new Map();
    }
  }

  function ensureAdminStyles() {
    if (document.getElementById('admin-editor-styles')) return;

    const style = document.createElement('style');
    style.id = 'admin-editor-styles';
    style.textContent = `
      .admin-edit-nav-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 2.8rem;
        height: 2.8rem;
        padding: 0;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.08);
        color: #f5f7ff;
        cursor: pointer;
        transition: transform 0.2s ease, border-color 0.2s ease, background-color 0.2s ease;
      }

      .admin-edit-nav-button:hover,
      .admin-edit-nav-button:focus-visible {
        transform: translateY(-1px);
        border-color: rgba(255, 210, 98, 0.55);
        background: rgba(255, 210, 98, 0.14);
      }

      .admin-edit-nav-button.is-active {
        border-color: rgba(255, 210, 98, 0.75);
        background: rgba(255, 210, 98, 0.22);
        color: #ffd262;
      }

      .admin-edit-nav-button svg {
        width: 1rem;
        height: 1rem;
        fill: currentColor;
      }

      .admin-nav-controls {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
      }

      .admin-format-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.75rem;
        margin-bottom: 1rem;
      }

      .admin-format-grid label {
        display: grid;
        gap: 0.4rem;
        color: #b8c4e0;
        font-size: 0.9rem;
      }

      .admin-format-grid select {
        width: 100%;
        padding: 0.75rem 0.9rem;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.06);
        color: #f5f7ff;
        font: inherit;
      }

      .admin-color-row {
        display: flex;
        align-items: center;
        gap: 0.6rem;
      }

      .admin-format-grid input[type="color"] {
        width: 3rem;
        height: 2.4rem;
        padding: 0.15rem;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.06);
      }

      .admin-color-reset {
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.06);
        color: #f5f7ff;
        border-radius: 999px;
        padding: 0.35rem 0.7rem;
        cursor: pointer;
      }

      body.admin-edit-mode [data-admin-editable="text"],
      body.admin-edit-mode [data-admin-editable="image"],
      body.admin-edit-mode [data-admin-editable="background-image"] {
        outline: 2px dashed rgba(255, 210, 98, 0.6);
        outline-offset: 4px;
        cursor: pointer;
      }

      body.admin-edit-mode .admin-hidden-element {
        opacity: 0.55;
      }

      .admin-editor-backdrop {
        position: fixed;
        inset: 0;
        z-index: 10000;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 1rem;
        background: rgba(2, 8, 22, 0.72);
      }

      .admin-editor-modal {
        width: min(680px, 100%);
        background: #08102a;
        color: #f5f7ff;
        border: 1px solid rgba(255, 210, 98, 0.24);
        border-radius: 20px;
        padding: 1.25rem;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
      }

      .admin-editor-modal h2,
      .admin-editor-modal p {
        margin-top: 0;
      }

      .admin-editor-modal textarea {
        width: 100%;
        min-height: 220px;
        margin: 1rem 0;
        padding: 1rem;
        border-radius: 14px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.06);
        color: #f5f7ff;
        resize: vertical;
        font: inherit;
      }

      .admin-editor-actions {
        display: flex;
        gap: 0.75rem;
        justify-content: flex-end;
      }

      .admin-add-section-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 2.8rem;
        height: 2.8rem;
        padding: 0;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.08);
        color: #f5f7ff;
        cursor: pointer;
      }

      .admin-add-section-button:hover,
      .admin-add-section-button:focus-visible {
        border-color: rgba(255, 210, 98, 0.55);
        background: rgba(255, 210, 98, 0.14);
      }

      .admin-add-section-button svg {
        width: 1rem;
        height: 1rem;
        fill: currentColor;
      }

      .dynamic-page-section {
        background-image: linear-gradient(180deg, rgba(2, 8, 22, 0.78), rgba(2, 8, 22, 0.92)), var(--dynamic-section-bg, none);
        background-size: cover;
        background-position: center;
      }

      .dynamic-page-section-card {
        position: relative;
        padding: 2rem;
        border-radius: 24px;
        background: rgba(10, 19, 44, 0.84);
        border: 1px solid rgba(255, 210, 98, 0.18);
        box-shadow: 0 35px 90px rgba(0, 0, 0, 0.28);
      }

      .dynamic-page-section-media img {
        width: 100%;
        max-height: 340px;
        border-radius: 20px;
        object-fit: cover;
      }

      .admin-remove-section {
        display: none;
        margin-top: 1rem;
      }

      body.admin-edit-mode .admin-remove-section {
        display: inline-flex;
      }

      .admin-section-builder label {
        display: block;
        margin-top: 1rem;
        color: #b8c4e0;
      }

      .admin-section-builder input,
      .admin-section-builder textarea {
        width: 100%;
        margin-top: 0.5rem;
        padding: 0.85rem 1rem;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.06);
        color: #f5f7ff;
        font: inherit;
      }

      .admin-section-builder textarea {
        min-height: 180px;
        resize: vertical;
      }

      .admin-section-tools {
        position: absolute;
        top: 1rem;
        right: 1rem;
        z-index: 5;
        display: none;
        gap: 0.5rem;
      }

      body.admin-edit-mode .admin-section-tools {
        display: inline-flex;
      }

      .admin-section-tool {
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(2, 8, 22, 0.86);
        color: #f5f7ff;
        border-radius: 999px;
        padding: 0.45rem 0.8rem;
        cursor: pointer;
      }

      .admin-section-tool.dragging {
        opacity: 0.65;
      }

      body.admin-edit-mode [data-admin-drag-target="true"] {
        outline: 2px dashed rgba(255, 210, 98, 0.75);
        outline-offset: 8px;
      }

      body.admin-edit-mode .event-calendar td[data-calendar-day] {
        outline: 2px dashed rgba(255, 210, 98, 0.55);
        outline-offset: -4px;
        cursor: pointer;
      }
    `;

    document.head.appendChild(style);
  }

  function ensureAdminModal() {
    if (state.modal) return state.modal;

    const backdrop = document.createElement('div');
    backdrop.className = 'admin-editor-backdrop';
    backdrop.innerHTML = `
      <div class="admin-editor-modal" role="dialog" aria-modal="true" aria-labelledby="admin-editor-title">
        <h2 id="admin-editor-title">Edit text</h2>
        <p>Update the selected text and save it for this page.</p>
        <div class="admin-format-grid">
          <label>Alignment
            <select id="admin-format-align">
              <option value="">Default</option>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </label>
          <label>Weight
            <select id="admin-format-weight">
              <option value="">Default</option>
              <option value="400">Regular</option>
              <option value="600">Semi Bold</option>
              <option value="700">Bold</option>
            </select>
          </label>
          <label>Style
            <select id="admin-format-style">
              <option value="">Default</option>
              <option value="normal">Normal</option>
              <option value="italic">Italic</option>
            </select>
          </label>
          <label>Case
            <select id="admin-format-transform">
              <option value="">Default</option>
              <option value="uppercase">Uppercase</option>
              <option value="capitalize">Capitalize</option>
              <option value="lowercase">Lowercase</option>
            </select>
          </label>
          <label>Text Color
            <div class="admin-color-row">
              <input id="admin-format-color" type="color" value="#ffffff" />
              <button type="button" class="admin-color-reset" id="admin-format-color-reset">Default</button>
            </div>
          </label>
        </div>
        <textarea id="admin-editor-textarea"></textarea>
        <div class="admin-editor-actions">
          <button type="button" class="button secondary" data-action="hide">Hide Element</button>
          <button type="button" class="button secondary" data-action="delete" style="color: #ff6b6b;">Delete Element</button>
          <button type="button" class="button secondary" data-action="cancel">Cancel</button>
          <button type="button" class="button primary" data-action="save">Save</button>
        </div>
      </div>
    `;

    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop || event.target.dataset.action === 'cancel') {
        closeAdminModal();
      }
    });

    document.body.appendChild(backdrop);
    state.modal = backdrop;
    return backdrop;
  }

  function closeAdminModal() {
    if (!state.modal) return;
    state.modal.style.display = 'none';
    state.modal.dataset.targetKey = '';
  }

  function ensureSectionModal() {
    if (state.sectionModal) return state.sectionModal;

    const backdrop = document.createElement('div');
    backdrop.className = 'admin-editor-backdrop';
    backdrop.innerHTML = `
      <div class="admin-editor-modal admin-section-builder" role="dialog" aria-modal="true" aria-labelledby="admin-section-title">
        <h2 id="admin-section-title">Add section</h2>
        <p>Create a new editable section for this page.</p>
        <label for="admin-section-name">Section title</label>
        <input id="admin-section-name" type="text" />
        <label for="admin-section-body">Section body</label>
        <textarea id="admin-section-body"></textarea>
        <div class="admin-editor-actions">
          <button type="button" class="button secondary" data-action="cancel">Cancel</button>
          <button type="button" class="button primary" data-action="save">Add Section</button>
        </div>
      </div>
    `;

    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop || event.target.dataset.action === 'cancel') {
        backdrop.style.display = 'none';
      }
    });

    document.body.appendChild(backdrop);
    state.sectionModal = backdrop;
    return backdrop;
  }

  async function deleteContentItem(contentKey, contentType) {
    const token = getStoredToken();
    const res = await fetch('/api/admin/content', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        pagePath: state.pagePath,
        contentKey,
        contentType,
      }),
    });

    const data = await parseApiResponse(res);
    if (!res.ok) {
      throw new Error(data.error || 'Delete failed');
    }

    return data.item;
  }

  function isDynamicContentKey(key) {
    return typeof key === 'string' && /(^|>)dynamic-(text|image)-\d+\|(text|image)$/.test(key);
  }

  async function saveContentUpdate(payload) {
    const token = getStoredToken();
    const res = await fetch('/api/admin/content', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        pagePath: state.pagePath,
        contentKey: payload.contentKey,
        contentType: payload.contentType,
        contentValue: payload.contentValue,
      }),
    });

    const data = await parseApiResponse(res);
    if (!res.ok) {
      throw new Error(data.error || 'Save failed');
    }

    return data.item;
  }

  function openTextModal(initialValue, heading, description, options) {
    const modal = ensureAdminModal();
    modal.style.display = 'flex';
    const title = modal.querySelector('#admin-editor-title');
    const copy = modal.querySelector('p');
    const textarea = modal.querySelector('#admin-editor-textarea');
    const saveButton = modal.querySelector('[data-action="save"]');
    const hideButton = modal.querySelector('[data-action="hide"]');
    const deleteButton = modal.querySelector('[data-action="delete"]');
    const alignSelect = modal.querySelector('#admin-format-align');
    const weightSelect = modal.querySelector('#admin-format-weight');
    const styleSelect = modal.querySelector('#admin-format-style');
    const transformSelect = modal.querySelector('#admin-format-transform');
    const colorInput = modal.querySelector('#admin-format-color');
    const colorReset = modal.querySelector('#admin-format-color-reset');
      const formatGrid = modal.querySelector('.admin-format-grid');
    const existingColor = normalizeColorValue(options.formatting.textColor);

    title.textContent = heading;
    copy.textContent = description;
    textarea.value = initialValue;
      textarea.style.display = '';
      formatGrid.style.display = '';
    alignSelect.value = options.formatting.textAlign || '';
    weightSelect.value = options.formatting.fontWeight || '';
    styleSelect.value = options.formatting.fontStyle || '';
    transformSelect.value = options.formatting.textTransform || '';
    colorInput.value = existingColor || '#ffffff';
    colorInput.dataset.custom = existingColor ? 'true' : 'false';
    hideButton.style.display = options.allowHide ? 'inline-flex' : 'none';
    hideButton.textContent = options.hideLabel || 'Hide Element';
      saveButton.textContent = 'Save';
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    colorReset.onclick = () => {
      colorInput.dataset.custom = 'false';
    };

    colorInput.oninput = () => {
      colorInput.dataset.custom = 'true';
    };

    hideButton.onclick = async () => {
      if (!options.onHide) return;
      hideButton.disabled = true;
      try {
        await options.onHide();
        closeAdminModal();
      } catch (error) {
        alert(error.message);
      } finally {
        hideButton.disabled = false;
      }
    };

    deleteButton.onclick = async () => {
      if (!options.onDelete) return;
      if (!confirm('Are you sure you want to delete this element? This action cannot be undone.')) return;
      deleteButton.disabled = true;
      try {
        await options.onDelete();
        closeAdminModal();
      } catch (error) {
        alert(error.message);
      } finally {
        deleteButton.disabled = false;
      }
    };

    deleteButton.style.display = options.allowDelete ? 'inline-flex' : 'none';

    saveButton.onclick = async () => {
      const nextValue = textarea.value.trim();
      if (!nextValue) {
        alert('Text cannot be empty.');
        return;
      }

      saveButton.disabled = true;
      try {
        await options.onSave(nextValue, {
          textAlign: alignSelect.value,
          fontWeight: weightSelect.value,
          fontStyle: styleSelect.value,
          textTransform: transformSelect.value,
          textColor: colorInput.dataset.custom === 'true' ? colorInput.value : '',
        });
        closeAdminModal();
      } catch (error) {
        alert(error.message);
      } finally {
        saveButton.disabled = false;
      }
    };
  }

  function openTextEditor(element) {
    const key = element.dataset.adminKey;
    const override = (key && state.elementOverrides.get(key)) || {};
    const isHidden = Boolean(override.hidden);
    openTextModal(
      element.textContent.trim(),
      'Edit text',
      'Update the selected text and save it for this page.',
      {
        formatting: {
          textAlign: override.text_align || '',
          fontWeight: override.font_weight || '',
          fontStyle: override.font_style || '',
          textTransform: override.text_transform || '',
          textColor: override.text_color || '',
        },
        allowHide: true,
        hideLabel: isHidden ? 'Show Element' : 'Hide Element',
        allowDelete: true,
        onHide: async () => {
          await saveElementOverride(key, { hidden: !isHidden });
          setAdminHiddenState(element, !isHidden);
        },
        onDelete: async () => {
          if (isDynamicContentKey(key)) {
            try {
              await deleteContentItem(key, 'text');
            } catch (error) {
              const message = String(error && error.message ? error.message : '').toLowerCase();
              if (!message.includes('not found')) {
                throw error;
              }
            }

            element.remove();
            state.registry.delete(`text:${key}`);
            return;
          }

          await saveElementOverride(key, { hidden: true });
          setAdminHiddenState(element, true);
        },
        onSave: async (nextValue, formatting) => {
          const item = await saveContentUpdate({
          contentKey: element.dataset.adminKey,
          contentType: 'text',
          contentValue: nextValue,
        });
        applyContentItem(item);
          await saveElementOverride(key, { ...formatting, hidden: false });
          setAdminHiddenState(element, false);
          applyElementStyles(element, {
            text_align: formatting.textAlign,
            font_weight: formatting.fontWeight,
            font_style: formatting.fontStyle,
            text_transform: formatting.textTransform,
            text_color: formatting.textColor,
          });
        },
      }
    );
  }

  function openSectionTextEditor(element) {
    const sectionId = Number.parseInt(element.dataset.adminSectionId, 10);
    const field = element.dataset.adminSectionField;
    const label = field === 'title' ? 'Edit section title' : 'Edit section body';
    openTextModal(
      element.textContent.trim(),
      label,
      'Update this custom section and save it for the page.',
      {
        formatting: {
          textAlign: '',
          fontWeight: '',
          fontStyle: '',
          textTransform: '',
          textColor: '',
        },
        allowHide: false,
        onSave: async (nextValue) => {
          const item = await updatePageSection(sectionId, field, nextValue);
          upsertPageSection(item);
          renderPageSections();
          registerSectionEditing();
        },
      }
    );
  }

  async function openImageEditor(element, onUploaded) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;

      const form = new FormData();
      form.append('image', file);
      form.append('target', (element.dataset.adminImagePath || element.getAttribute('src') || '').split('?')[0]);

      const token = getStoredToken();
      element.style.opacity = '0.6';
      try {
        const uploadRes = await fetch('/api/admin/upload-image', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });
        const uploadData = await parseApiResponse(uploadRes);
        if (!uploadRes.ok || !uploadData.path) {
          throw new Error(uploadData.error || 'Image upload failed');
        }

        await onUploaded(uploadData.path);
      } catch (error) {
        alert(error.message);
      } finally {
        element.style.opacity = '';
      }
    };

    input.click();
  }

  function openStaticImageEditor(element) {
    openImageEditor(element, async (nextPath) => {
      const item = await saveContentUpdate({
        contentKey: element.dataset.adminKey,
        contentType: 'image',
        contentValue: nextPath,
      });
      applyContentItem(item);
    });
  }

  function openSectionImageEditor(element) {
    const sectionId = Number.parseInt(element.dataset.adminSectionId, 10);
    const field = element.dataset.adminSectionField;
    openImageEditor(element, async (nextPath) => {
      const item = await updatePageSection(sectionId, field, nextPath);
      upsertPageSection(item);
      renderPageSections();
    });
  }

  async function clearSectionBackground(section, kind) {
    if (kind === 'dynamic') {
      const sectionId = Number.parseInt(section.dataset.adminSectionId, 10);
      if (!Number.isInteger(sectionId)) return;
      const item = await updatePageSection(sectionId, 'background_path', '');
      upsertPageSection(item);
      renderPageSections();
      registerSectionEditing();
      return;
    }

    const contentKey = section.dataset.adminKey;
    if (!contentKey) return;
    const item = await saveContentUpdate({
      contentKey,
      contentType: 'image',
      contentValue: '',
    });
    applyContentItem(item);
  }

  function openAddSectionModal() {
    const modal = ensureSectionModal();
    modal.style.display = 'flex';
    const titleInput = modal.querySelector('#admin-section-name');
    const bodyInput = modal.querySelector('#admin-section-body');
    const saveButton = modal.querySelector('[data-action="save"]');

    titleInput.value = '';
    bodyInput.value = '';
    titleInput.focus();

    saveButton.onclick = async () => {
      const title = titleInput.value.trim();
      const body = bodyInput.value.trim();

      if (!title || !body) {
        alert('Section title and body are required.');
        return;
      }

      saveButton.disabled = true;
      try {
        const item = await createPageSection({ title, body });
        upsertPageSection(item);
        renderPageSections();
        modal.style.display = 'none';
      } catch (error) {
        alert(error.message);
      } finally {
        saveButton.disabled = false;
      }
    };
  }

  async function removeSection(sectionId) {
    const confirmed = window.confirm('Remove this section from the page?');
    if (!confirmed) return;

    await deletePageSection(sectionId);
    state.pageSections = state.pageSections.filter((section) => section.id !== sectionId);
    renderPageSections();
    registerSectionEditing();
  }

  async function hideStaticSection(section) {
    const key = section.dataset.adminStaticSectionKey;
    if (!key) return;
    const override = state.elementOverrides.get(key) || {};
    const nextHidden = !override.hidden;
    await saveElementOverride(key, { hidden: nextHidden });
    setAdminHiddenState(section, nextHidden);
    ensureSectionTools(section, 'static');
  }

  async function persistStaticSectionOrder() {
    const sections = getStaticSections();
    await Promise.all(
      sections.map((section, index) => saveElementOverride(section.dataset.adminStaticSectionKey, { position: index + 1, hidden: false }))
    );
  }

  async function persistDynamicSectionOrder() {
    await reorderDynamicSections(state.pageSections.map((section) => section.id));
  }

  function moveDraggedSection(targetSection) {
    if (!state.draggedSection || !targetSection) return;

    const dragged = state.draggedSection;
    if (dragged.kind === 'static') {
      const draggedElement = document.querySelector(`[data-admin-static-section-key="${dragged.key}"]`);
      if (!draggedElement || draggedElement === targetSection) return;
      targetSection.parentNode.insertBefore(draggedElement, targetSection);
      persistStaticSectionOrder().catch((error) => alert(error.message));
      return;
    }

    if (dragged.kind === 'dynamic') {
      const targetId = Number.parseInt(targetSection.dataset.adminSectionId, 10);
      const draggedIndex = state.pageSections.findIndex((section) => section.id === dragged.id);
      const targetIndex = state.pageSections.findIndex((section) => section.id === targetId);
      if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) return;
      const [section] = state.pageSections.splice(draggedIndex, 1);
      state.pageSections.splice(targetIndex, 0, section);
      state.pageSections.forEach((item, index) => {
        item.position = index + 1;
      });
      renderPageSections();
      registerSectionEditing();
      persistDynamicSectionOrder().catch((error) => alert(error.message));
    }
  }

  async function addNewTextElement(section, kind) {
    const modal = ensureAdminModal();
    modal.style.display = 'flex';
    const title = modal.querySelector('#admin-editor-title');
    const copy = modal.querySelector('p');
    const textarea = modal.querySelector('#admin-editor-textarea');
    const formatGrid = modal.querySelector('.admin-format-grid');
    const saveButton = modal.querySelector('[data-action="save"]');
    const cancelButton = modal.querySelector('[data-action="cancel"]');
    const hideButton = modal.querySelector('[data-action="hide"]');
    const deleteButton = modal.querySelector('[data-action="delete"]');

    title.textContent = 'Add new text element';
    copy.textContent = 'Enter the text content for this new element.';
    textarea.value = '';
    textarea.style.display = '';
    if (formatGrid) {
      formatGrid.style.display = 'none';
    }
    saveButton.textContent = 'Add Text';
    saveButton.disabled = false;
    hideButton.disabled = false;
    deleteButton.disabled = false;

    // Clear stale handlers from previous modal usage so Add Text has a single save flow.
    saveButton.onclick = null;
    cancelButton.onclick = null;
    hideButton.onclick = null;
    deleteButton.onclick = null;

    hideButton.style.display = 'none';
    deleteButton.style.display = 'none';
    textarea.focus();

    return new Promise((resolve, reject) => {
      saveButton.onclick = async () => {
        const textValue = textarea.value.trim();
        if (!textValue) {
          alert('Text cannot be empty.');
          return;
        }

        saveButton.disabled = true;
        try {
          assignStaticSectionKeys();
          const parentKey = kind === 'static'
            ? section.dataset.adminStaticSectionKey
            : `section#${section.dataset.adminSectionId}`;

          if (!parentKey) {
            throw new Error('Unable to determine target section key');
          }

          const item = await createNewContentElement(parentKey, 'text', textValue);
          const newElement = document.createElement('p');
          newElement.textContent = item.content_value;
          newElement.dataset.adminEditable = 'text';
          newElement.dataset.adminKey = item.content_key;
          newElement.style.marginTop = '1rem';
          section.appendChild(newElement);

          state.registry.set(`text:${item.content_key}`, newElement);
          registerEditableElements();
          closeAdminModal();
          resolve();
        } catch (error) {
          reject(error);
        } finally {
          saveButton.disabled = false;
        }
      };

      cancelButton.onclick = () => {
        closeAdminModal();
        resolve();
      };
    });
  }

  async function addNewImageElement(section, kind) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';

    return new Promise((resolve, reject) => {
      input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) {
          resolve();
          return;
        }

        try {
          const form = new FormData();
          form.append('image', file);
          form.append('target', 'assets/images/user-added/');

          const token = getStoredToken();
          const uploadRes = await fetch('/api/admin/upload-image', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: form,
          });
          const uploadData = await parseApiResponse(uploadRes);
          if (!uploadRes.ok || !uploadData.path) {
            throw new Error(uploadData.error || 'Image upload failed');
          }

          const parentKey = kind === 'static'
            ? section.dataset.adminStaticSectionKey
            : `section#${section.dataset.adminSectionId}`;

          const item = await createNewContentElement(parentKey, 'image', uploadData.path);
          const newImage = document.createElement('img');
          newImage.src = uploadData.path;
          newImage.alt = 'Added image';
          newImage.dataset.adminEditable = 'image';
          newImage.dataset.adminKey = item.content_key;
          newImage.style.marginTop = '1rem';
          newImage.style.maxWidth = '100%';
          newImage.style.borderRadius = '8px';
          section.appendChild(newImage);

          state.registry.set(`image:${item.content_key}`, newImage);
          registerEditableElements();
          resolve();
        } catch (error) {
          reject(error);
        }
      };

      input.click();
    });
  }

  async function createNewContentElement(parentKey, contentType, contentValue) {
    const token = getStoredToken();
    const res = await fetch('/api/admin/content/new', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        pagePath: state.pagePath,
        parentKey,
        contentType,
        contentValue,
      }),
    });

    const data = await parseApiResponse(res);
    if (!res.ok) {
      throw new Error(data.error || 'Failed to create element');
    }

    return data.item;
  }

  function registerSectionDrag(section, kind) {
    if (section.dataset.adminDragBound === kind) return;
    section.dataset.adminDragBound = kind;
    section.draggable = state.editMode;
    section.addEventListener('dragstart', () => {
      state.draggedSection = kind === 'static'
        ? { kind, key: section.dataset.adminStaticSectionKey }
        : { kind, id: Number.parseInt(section.dataset.adminSectionId, 10) };
      section.dataset.adminDragTarget = 'true';
    });
    section.addEventListener('dragend', () => {
      state.draggedSection = null;
      section.removeAttribute('data-admin-drag-target');
      document.querySelectorAll('[data-admin-drag-target="true"]').forEach((element) => {
        element.removeAttribute('data-admin-drag-target');
      });
    });
    section.addEventListener('dragover', (event) => {
      if (!state.editMode || !state.draggedSection || state.draggedSection.kind !== kind) return;
      event.preventDefault();
      section.dataset.adminDragTarget = 'true';
    });
    section.addEventListener('dragleave', () => {
      section.removeAttribute('data-admin-drag-target');
    });
    section.addEventListener('drop', (event) => {
      if (!state.editMode || !state.draggedSection || state.draggedSection.kind !== kind) return;
      event.preventDefault();
      section.removeAttribute('data-admin-drag-target');
      moveDraggedSection(section);
    });
  }

  function ensureSectionTools(section, kind) {
    let tools = section.querySelector(':scope > .admin-section-tools');
    if (!tools) {
      tools = document.createElement('div');
      tools.className = 'admin-section-tools';

      const dragButton = document.createElement('button');
      dragButton.type = 'button';
      dragButton.className = 'admin-section-tool';
      dragButton.textContent = 'Drag';
      dragButton.addEventListener('mousedown', () => {
        dragButton.classList.add('dragging');
      });
      dragButton.addEventListener('mouseup', () => {
        dragButton.classList.remove('dragging');
      });

      const addTextButton = document.createElement('button');
      addTextButton.type = 'button';
      addTextButton.className = 'admin-section-tool admin-section-add-text-button';
      addTextButton.textContent = 'Add Text';
      addTextButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        addNewTextElement(section, kind).catch((error) => alert(error.message));
      });

      const addImageButton = document.createElement('button');
      addImageButton.type = 'button';
      addImageButton.className = 'admin-section-tool admin-section-add-image-button';
      addImageButton.textContent = 'Add Image';
      addImageButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        addNewImageElement(section, kind).catch((error) => alert(error.message));
      });

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'admin-section-tool admin-section-remove-button';
      removeButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (kind === 'dynamic') {
          removeSection(Number.parseInt(section.dataset.adminSectionId, 10)).catch((error) => alert(error.message));
        } else {
          hideStaticSection(section).catch((error) => alert(error.message));
        }
      });

      if (kind === 'dynamic' || kind === 'static') {
        const bgButton = document.createElement('button');
        bgButton.type = 'button';
        bgButton.className = 'admin-section-tool admin-section-bg-button';
        bgButton.textContent = 'Background';
        bgButton.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (kind === 'dynamic') {
            openSectionImageEditor(section);
          } else {
            openStaticImageEditor(section);
          }
        });
        tools.appendChild(bgButton);

        const clearBgButton = document.createElement('button');
        clearBgButton.type = 'button';
        clearBgButton.className = 'admin-section-tool admin-section-clear-bg-button';
        clearBgButton.textContent = 'Clear Bg';
        clearBgButton.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          clearSectionBackground(section, kind).catch((error) => alert(error.message));
        });
        tools.appendChild(clearBgButton);
      }

      tools.appendChild(addTextButton);
      tools.appendChild(addImageButton);
      tools.appendChild(dragButton);
      tools.appendChild(removeButton);
      section.style.position = section.style.position || 'relative';
      section.prepend(tools);
    }

    const removeButton = tools.querySelector('.admin-section-remove-button');
    if (removeButton) {
      const override = kind === 'static'
        ? state.elementOverrides.get(section.dataset.adminStaticSectionKey)
        : null;
      removeButton.textContent = kind === 'dynamic'
        ? 'Delete'
        : (override && override.hidden ? 'Show' : 'Hide');
    }
  }

  function registerSectionEditing() {
    getStaticSections().forEach((section) => {
      ensureSectionTools(section, 'static');
      registerSectionDrag(section, 'static');
    });

    document.querySelectorAll('[data-admin-dynamic-section="true"]').forEach((section) => {
      ensureSectionTools(section, 'dynamic');
      registerSectionDrag(section, 'dynamic');
    });
  }

  function setEditMode(nextValue) {
    state.editMode = nextValue;
    document.body.classList.toggle('admin-edit-mode', nextValue);
    applyElementOverrides();
    registerSectionEditing();
    const toggleButton = document.getElementById('admin-edit-toggle');
    if (toggleButton) {
      toggleButton.classList.toggle('is-active', nextValue);
      toggleButton.setAttribute(
        'title',
        nextValue
          ? 'Edit mode is on. Click text, images, or backgrounds to update this page.'
          : 'Turn on page edit mode'
      );
      toggleButton.setAttribute(
        'aria-label',
        nextValue ? 'Exit page edit mode' : 'Enter page edit mode'
      );
      toggleButton.setAttribute('aria-pressed', String(nextValue));
    }
  }

  function attachAdminNavButton() {
    if (document.getElementById('admin-edit-toggle')) return;

    const nav = document.querySelector('.site-nav');
    if (!nav) return;

    let controls = document.getElementById('admin-nav-controls');
    if (!controls) {
      controls = document.createElement('span');
      controls.id = 'admin-nav-controls';
      controls.className = 'admin-nav-controls';
    }

    const button = document.createElement('button');
    button.id = 'admin-edit-toggle';
    button.type = 'button';
    button.className = 'admin-edit-nav-button';
    button.setAttribute('aria-label', 'Enter page edit mode');
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('title', 'Turn on page edit mode');
    button.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.04a1.003 1.003 0 0 0 0-1.42l-2.5-2.5a1.003 1.003 0 0 0-1.42 0l-1.96 1.96 3.75 3.75 2.13-2.09z" />
      </svg>
    `;

    const addButton = document.createElement('button');
    addButton.id = 'admin-add-section-toggle';
    addButton.type = 'button';
    addButton.className = 'admin-add-section-button';
    addButton.setAttribute('aria-label', 'Add page section');
    addButton.setAttribute('title', 'Add a new page section');
    addButton.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M19 11h-6V5h-2v6H5v2h6v6h2v-6h6z" />
      </svg>
    `;

    controls.replaceChildren(button, addButton);

    const logoutLink = document.getElementById('nav-logout-link');
    if (logoutLink) {
      nav.insertBefore(controls, logoutLink);
    } else {
      nav.appendChild(controls);
    }

    button.addEventListener('click', () => {
      setEditMode(!state.editMode);
    });
    addButton.addEventListener('click', openAddSectionModal);

    document.addEventListener('click', (event) => {
      if (!state.editMode) return;
      if (event.target.closest('.admin-edit-nav-button, .admin-add-section-button, .admin-editor-modal, .admin-section-tools')) return;

      const calendarCell = event.target.closest('.event-calendar td[data-calendar-day]');
      if (calendarCell) {
        event.preventDefault();
        event.stopPropagation();
        editCalendarCell(calendarCell).catch((error) => alert(error.message));
        return;
      }

      const removeButton = event.target.closest('[data-admin-remove-section]');
      if (removeButton) {
        event.preventDefault();
        event.stopPropagation();
        removeSection(Number.parseInt(removeButton.dataset.adminRemoveSection, 10));
        return;
      }

      const sectionTextElement = event.target.closest('[data-admin-section-field][data-admin-editable="text"]');
      if (sectionTextElement) {
        event.preventDefault();
        event.stopPropagation();
        openSectionTextEditor(sectionTextElement);
        return;
      }

      const sectionImageElement = event.target.closest('[data-admin-section-field][data-admin-editable="image"]');
      if (sectionImageElement) {
        event.preventDefault();
        event.stopPropagation();
        openSectionImageEditor(sectionImageElement);
        return;
      }

      const sectionBackgroundElement = event.target.closest('[data-admin-section-field="background_path"][data-admin-editable="background-image"]');
      if (sectionBackgroundElement) {
        event.preventDefault();
        event.stopPropagation();
        openSectionImageEditor(sectionBackgroundElement);
        return;
      }

      const textElement = event.target.closest('[data-admin-editable="text"]');
      if (textElement) {
        event.preventDefault();
        event.stopPropagation();
        openTextEditor(textElement);
        return;
      }

      const image = event.target.closest('[data-admin-editable="image"]');
      if (image) {
        event.preventDefault();
        event.stopPropagation();
        openStaticImageEditor(image);
        return;
      }

      const backgroundElement = event.target.closest('[data-admin-editable="background-image"]');
      if (backgroundElement) {
        event.preventDefault();
        event.stopPropagation();
        openStaticImageEditor(backgroundElement);
      }
    }, true);
  }

  async function initEditableContent() {
    initContactForm();

    if (!isPageEditable()) {
      initHeaderState();
      return;
    }

    initHeaderState();
    await loadPageSections();
    registerEditableElements();
    await loadSavedContent();
    initializeCalendarUi();
    await loadCalendarEvents();
    await loadElementOverrides();

    const profile = await fetchCurrentProfile();
    if (!profile || profile.role !== 'admin') return;

    ensureAdminStyles();
    attachAdminNavButton();
    registerSectionEditing();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEditableContent);
  } else {
    initEditableContent();
  }
})();
