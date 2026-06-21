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
  const editableTextSelector = 'h1, h2, h3, h4, h5, h6, p, a, span, small, strong, em, i, b, blockquote, li, button, label, figcaption, td, th, dt, dd, div, div[data-admin-editable-target="text"]';
  const leafTextSelector = 'h1,h2,h3,h4,h5,h6,p,a,span,small,strong,em,i,b,blockquote,li,button,label,figcaption,td,th,dt,dd,div,div[data-admin-editable-target="text"]';
  const editableContainerSelector = 'main section, main article, main aside, main div';
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
    freeDragHandlersBound: false,
    draggingElement: null,
    dragStartX: 0,
    dragStartY: 0,
    dragOriginX: 0,
    dragOriginY: 0,
    suppressEditClickUntil: 0,
    elementToolbar: null,
    selectedEditableElement: null,
    draggedTextElement: null,
    isAdmin: false,
    albums: [],
    albumImagesById: new Map(),
    albumViewerModal: null,
    albumViewerImages: [],
    albumViewerIndex: -1,
    albumViewerTitle: '',
    albumUiBound: false,
  };
  const albumRootElementKey = 'media-albums-root|container';
  const nonEditablePagePaths = new Set(['/dashboard.html', '/user-management.html']);
  const resizeEdgeThreshold = 10;
  const minResizableWidth = 40;
  const minResizableHeight = 32;

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

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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

  async function fetchAdminImageLibrary() {
    const token = getStoredToken();
    const res = await fetch('/api/admin/images', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const data = await parseApiResponse(res);
    if (!res.ok) {
      throw new Error(data.error || 'Unable to load image library');
    }
    return Array.isArray(data.items) ? data.items : [];
  }

  function isAlbumEnabledPage() {
    return state.pagePath === '/photos.html' || state.pagePath === '/royal-court.html';
  }

  async function fetchAlbums() {
    const res = await fetch(`/api/albums?page=${encodeURIComponent(state.pagePath)}`);
    if (!res.ok) return [];
    const data = await parseApiResponse(res);
    return Array.isArray(data.items) ? data.items : [];
  }

  async function fetchAlbumImages(albumId) {
    const res = await fetch(`/api/albums/${albumId}/images`);
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
      deleted: patch.deleted ?? current.deleted ?? false,
      textAlign: patch.textAlign ?? current.text_align ?? null,
      fontFamily: patch.fontFamily ?? current.font_family ?? null,
      fontWeight: patch.fontWeight ?? current.font_weight ?? null,
      fontStyle: patch.fontStyle ?? current.font_style ?? null,
      textTransform: patch.textTransform ?? current.text_transform ?? null,
      fontSize: patch.fontSize ?? current.font_size ?? null,
      opacityValue: patch.opacityValue ?? current.opacity_value ?? null,
      textColor: patch.textColor ?? current.text_color ?? null,
      backgroundColor: patch.backgroundColor ?? current.background_color ?? null,
      backgroundOpacityValue: patch.backgroundOpacityValue ?? current.background_opacity_value ?? null,
      widthValue: patch.widthValue ?? current.width_value ?? null,
      heightValue: patch.heightValue ?? current.height_value ?? null,
      borderStyle: patch.borderStyle ?? current.border_style ?? null,
      borderWidth: patch.borderWidth ?? current.border_width ?? null,
      borderColor: patch.borderColor ?? current.border_color ?? null,
      borderRadius: patch.borderRadius ?? current.border_radius ?? null,
      positionMode: patch.positionMode ?? current.position_mode ?? null,
      posX: Number.isFinite(patch.posX) ? Math.round(patch.posX) : (Number.isFinite(current.pos_x) ? Math.round(current.pos_x) : null),
      posY: Number.isFinite(patch.posY) ? Math.round(patch.posY) : (Number.isFinite(current.pos_y) ? Math.round(current.pos_y) : null),
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

  async function moveContentBlock(oldContentKey, newParentKey, contentType) {
    const token = getStoredToken();
    const res = await fetch('/api/admin/content/move', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        pagePath: state.pagePath,
        oldContentKey,
        newParentKey,
        contentType,
      }),
    });
    const data = await parseApiResponse(res);
    if (!res.ok) {
      throw new Error(data.error || 'Unable to move content');
    }
    return data.item;
  }

  async function createAlbum(payload) {
    const token = getStoredToken();
    const res = await fetch('/api/admin/albums', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        pagePath: state.pagePath,
        title: payload.title,
        description: payload.description || '',
        coverImagePath: payload.coverImagePath || '',
      }),
    });

    const data = await parseApiResponse(res);
    if (!res.ok) throw new Error(data.error || 'Unable to create album');
    return data.item;
  }

  async function updateAlbum(albumId, payload) {
    const token = getStoredToken();
    const res = await fetch(`/api/admin/albums/${albumId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await parseApiResponse(res);
    if (!res.ok) throw new Error(data.error || 'Unable to update album');
    return data.item;
  }

  async function deleteAlbum(albumId) {
    const token = getStoredToken();
    const res = await fetch(`/api/admin/albums/${albumId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const data = await parseApiResponse(res);
    if (!res.ok) throw new Error(data.error || 'Unable to delete album');
    return data;
  }

  async function reorderAlbums(orderedIds) {
    const token = getStoredToken();
    const res = await fetch('/api/admin/albums-reorder', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        pagePath: state.pagePath,
        orderedIds,
      }),
    });
    const data = await parseApiResponse(res);
    if (!res.ok) throw new Error(data.error || 'Unable to reorder albums');
    return data;
  }

  async function createAlbumImage(albumId, payload) {
    const token = getStoredToken();
    const res = await fetch(`/api/admin/albums/${albumId}/images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await parseApiResponse(res);
    if (!res.ok) throw new Error(data.error || 'Unable to add photo');
    return data.item;
  }

  async function updateAlbumImage(albumId, imageId, payload) {
    const token = getStoredToken();
    const res = await fetch(`/api/admin/albums/${albumId}/images/${imageId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await parseApiResponse(res);
    if (!res.ok) throw new Error(data.error || 'Unable to update photo');
    return data.item;
  }

  async function deleteAlbumImage(albumId, imageId) {
    const token = getStoredToken();
    const res = await fetch(`/api/admin/albums/${albumId}/images/${imageId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const data = await parseApiResponse(res);
    if (!res.ok) throw new Error(data.error || 'Unable to delete photo');
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

    const existingDashboardLink = document.getElementById('nav-dashboard-link');
    if (existingDashboardLink) {
      existingDashboardLink.remove();
    }

    const existingLogoutLink = document.getElementById('nav-logout-link');
    if (existingLogoutLink) {
      existingLogoutLink.remove();
    }

    if (nav && !isLoggedIn) {
      const authLink = document.createElement('a');
      authLink.id = 'nav-auth-link';
      authLink.href = '/login.html';
      authLink.textContent = 'Login';
      nav.appendChild(authLink);
    } else if (nav && isLoggedIn) {
      const dashboardLink = document.createElement('a');
      dashboardLink.id = 'nav-dashboard-link';
      dashboardLink.href = '/dashboard.html';
      dashboardLink.textContent = 'Dashboard';

      const logoutLink = document.createElement('a');
      logoutLink.id = 'nav-logout-link';
      logoutLink.href = '#';
      logoutLink.textContent = 'Log Off';
      logoutLink.addEventListener('click', (event) => {
        event.preventDefault();
        localStorage.removeItem('krewe_token');
        window.location.href = '/';
      });

      nav.appendChild(dashboardLink);
      nav.appendChild(logoutLink);
    }

    const existingLoginActions = document.getElementById('login-actions');
    if (existingLoginActions) {
      existingLoginActions.remove();
    }

    if (headerInner && isLoggedIn && !nav) {
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
    return Boolean(element.closest('.admin-edit-nav-button, .admin-add-section-button, .admin-editor-modal, .admin-editor-backdrop, .admin-section-tools, .admin-element-toolbar'));
  }

  function hasNestedEditableText(element) {
    return Array.from(element.children).some((child) => child.matches(leafTextSelector));
  }

  function hasDirectTextNode(element) {
    if (!element) return false;
    return Array.from(element.childNodes).some((node) => (
      node.nodeType === Node.TEXT_NODE && String(node.textContent || '').trim().length > 0
    ));
  }

  function isInsideSiteMenu(element) {
    if (!element || !(element instanceof Element)) return false;
    const menuHost = element.closest('.site-nav');
    if (!menuHost) return false;
    return !isInsideAdminUi(element);
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

  function getStaticSectionToolTargets() {
    const main = document.querySelector('main');
    if (!main) return [];
    return Array.from(main.querySelectorAll('section')).filter((element) => {
      if (element.dataset.adminDynamicSection === 'true') return false;
      if (element.closest('[data-admin-dynamic-section="true"]')) return false;
      return true;
    });
  }

  function ensureStaticSectionKey(section, fallbackIndex) {
    if (!section) return;
    if (!section.dataset.adminStaticSectionKey) {
      const fallbackKey = Number.isInteger(fallbackIndex) ? `static-section:${fallbackIndex}` : buildContentKey(section, 'section');
      section.dataset.adminStaticSectionKey = section.id ? `static-section:${section.id}` : fallbackKey;
    }
    section.dataset.adminSectionType = 'static';
    if (!section.dataset.adminBackgroundVar) {
      section.dataset.adminBackgroundVar = '--admin-section-bg';
      section.dataset.adminBgVarAuto = 'true';
    }
  }

  async function persistStaticSectionOrderForParent(parentElement) {
    if (!parentElement) return;
    const siblings = Array.from(parentElement.children).filter((element) => element.tagName === 'SECTION' && !element.dataset.adminDynamicSection);
    await Promise.all(
      siblings.map((section, index) => saveElementOverride(section.dataset.adminStaticSectionKey, { position: index + 1, hidden: false }))
    );
  }

  function assignStaticSectionKeys() {
    getStaticSections().forEach((section, index) => {
      const key = section.id ? `static-section:${section.id}` : `static-section:${index}`;
      section.dataset.adminStaticSectionKey = key;
      section.dataset.adminSectionType = 'static';
      if (!section.dataset.adminBackgroundVar) {
        section.dataset.adminBackgroundVar = '--admin-section-bg';
        section.dataset.adminBgVarAuto = 'true';
      }
    });
  }

  function registerEditableElements() {
    state.registry.clear();
    assignStaticSectionKeys();

    getStaticSections().forEach((section) => {
      if (isInsideAdminUi(section)) return;
      if (!state.editMode && section.classList.contains('admin-hidden-element')) return;
      if (window.getComputedStyle(section).display === 'none') return;

      const key = buildContentKey(section, 'image');
      section.dataset.adminEditable = 'background-image';
      section.dataset.adminKey = key;
      state.registry.set(`image:${key}`, section);
    });

    document.querySelectorAll(editableTextSelector).forEach((element) => {
      if (!element.textContent.trim()) return;
      if (isInsideAdminUi(element)) return;
      if (isInsideSiteMenu(element)) return;
      if (element.tagName === 'DIV' && !hasDirectTextNode(element)) return;
      if (element.closest('[data-admin-dynamic-section]') && !element.dataset.adminKey) return;
      if (!state.editMode && element.classList.contains('admin-hidden-element')) return;
      if (window.getComputedStyle(element).display === 'none') return;
      if (element.querySelector('img, input, textarea, select')) return;
      if (hasNestedEditableText(element) && element.tagName !== 'LI') return;

      const key = buildContentKey(element, 'text');
      element.dataset.adminEditable = 'text';
      element.dataset.adminKey = key;
      state.registry.set(`text:${key}`, element);
    });

    document.querySelectorAll('img').forEach((element) => {
      if (isInsideAdminUi(element)) return;
      if (isInsideSiteMenu(element)) return;
      if (element.closest('[data-admin-dynamic-section]') && !element.dataset.adminKey) return;
      if (!state.editMode && element.classList.contains('admin-hidden-element')) return;
      if (window.getComputedStyle(element).display === 'none') return;
      const key = buildContentKey(element, 'image');
      element.dataset.adminEditable = 'image';
      element.dataset.adminKey = key;
      state.registry.set(`image:${key}`, element);
    });

    document.querySelectorAll('[data-admin-background-var]').forEach((element) => {
      if (isInsideAdminUi(element)) return;
      if (isInsideSiteMenu(element)) return;
      if (element.closest('[data-admin-dynamic-section]')) return;
      if (!state.editMode && element.classList.contains('admin-hidden-element')) return;
      if (window.getComputedStyle(element).display === 'none') return;
      const key = buildContentKey(element, 'image');
      element.dataset.adminEditable = 'background-image';
      element.dataset.adminKey = key;
      state.registry.set(`image:${key}`, element);
    });

    document.querySelectorAll(editableContainerSelector).forEach((element) => {
      if (isInsideAdminUi(element)) return;
      if (isInsideSiteMenu(element)) return;
      if (element.classList.contains('container')) return;
      if (element.closest('.admin-section-tools, .admin-editor-backdrop, .site-header, .footer')) return;
      if (element.id === 'dynamic-page-sections') return;
      if (element.dataset.adminDynamicSection === 'true') return;
      if (!state.editMode && element.classList.contains('admin-hidden-element')) return;
      if (window.getComputedStyle(element).display === 'none') return;
      if (element.dataset.adminEditable === 'text' || element.dataset.adminEditable === 'image' || element.dataset.adminEditable === 'background-image' || element.dataset.adminEditable === 'album-root') return;

      const key = buildContentKey(element, 'container');
      element.dataset.adminEditable = 'container';
      element.dataset.adminKey = key;
      state.registry.set(`container:${key}`, element);
    });

    const albumsRoot = getAlbumsRoot();
    if (albumsRoot && albumsRoot.dataset.adminKey) {
      state.registry.set(`album-root:${albumsRoot.dataset.adminKey}`, albumsRoot);
    }
  }

  function applyElementStyles(element, override) {
    if (!element || !override) return;
    element.style.textAlign = override.text_align || '';
    element.style.fontFamily = override.font_family || '';
    element.style.fontWeight = override.font_weight || '';
    element.style.fontStyle = override.font_style || '';
    element.style.textTransform = override.text_transform || '';
    element.style.fontSize = override.font_size || '';
    element.style.opacity = override.opacity_value || '';
    element.style.color = override.text_color || '';
    element.style.backgroundColor = toRgbaWithOpacity(override.background_color, override.background_opacity_value);
    element.style.width = override.width_value || '';
    element.style.height = override.height_value || '';
    element.style.borderStyle = override.border_style || '';
    element.style.borderWidth = override.border_width || '';
    element.style.borderColor = override.border_color || '';
    element.style.borderRadius = override.border_radius || '';

    const isAbsolute = override.position_mode === 'absolute';
    element.classList.toggle('admin-free-positioned', isAbsolute);
    if (isAbsolute) {
      if (element.dataset.adminEditable === 'album-root') {
        ensureAlbumRootPlaceholder(element);
      }
      if (element.parentElement && window.getComputedStyle(element.parentElement).position === 'static') {
        element.parentElement.style.position = 'relative';
      }
      element.style.position = 'absolute';
      element.style.left = `${Number.isFinite(override.pos_x) ? override.pos_x : 0}px`;
      element.style.top = `${Number.isFinite(override.pos_y) ? override.pos_y : 0}px`;
      element.style.margin = '0';
      element.style.zIndex = element.dataset.adminEditable === 'text' ? '12' : '8';
    } else {
      if (element.dataset.adminEditable === 'album-root') {
        removeAlbumRootPlaceholder(element);
      }
      element.style.position = '';
      element.style.left = '';
      element.style.top = '';
      element.style.margin = '';
      element.style.zIndex = '';
    }
  }

  function ensureAlbumRootPlaceholder(element) {
    if (!element || element.dataset.adminEditable !== 'album-root' || !element.parentElement) return;

    let placeholder = element.parentElement.querySelector('[data-admin-album-placeholder="true"]');
    if (!placeholder) {
      placeholder = document.createElement('div');
      placeholder.dataset.adminAlbumPlaceholder = 'true';
      element.parentElement.insertBefore(placeholder, element);
    }

    const styles = window.getComputedStyle(element);
    placeholder.style.display = 'block';
    placeholder.style.height = `${Math.max(1, element.offsetHeight)}px`;
    placeholder.style.marginTop = styles.marginTop;
    placeholder.style.marginRight = styles.marginRight;
    placeholder.style.marginBottom = styles.marginBottom;
    placeholder.style.marginLeft = styles.marginLeft;
  }

  function removeAlbumRootPlaceholder(element) {
    if (!element || !element.parentElement) return;
    const placeholder = element.parentElement.querySelector('[data-admin-album-placeholder="true"]');
    if (placeholder) {
      placeholder.remove();
    }
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

  function toRgbaWithOpacity(colorValue, opacityValue) {
    const normalized = normalizeColorValue(colorValue);
    if (!normalized) return '';
    if (opacityValue === null || opacityValue === undefined || opacityValue === '') return normalized;
    const parsed = Number(opacityValue);
    if (!Number.isFinite(parsed)) return normalized;
    const clamped = Math.max(0, Math.min(1, parsed));
    const alpha = Math.round(clamped * 1000) / 1000;
    const r = Number.parseInt(normalized.slice(1, 3), 16);
    const g = Number.parseInt(normalized.slice(3, 5), 16);
    const b = Number.parseInt(normalized.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function rememberInlineDisplay(element) {
    if (!element) return;
    if (!Object.prototype.hasOwnProperty.call(element.dataset, 'adminOriginalDisplay')) {
      element.dataset.adminOriginalDisplay = element.style.display || '';
    }
  }

  function setAdminHiddenState(element, hidden, deleted) {
    if (!element) return;
    rememberInlineDisplay(element);
    element.classList.toggle('admin-hidden-element', Boolean(hidden));
    element.classList.toggle('admin-deleted-element', Boolean(deleted));
    if (deleted) {
      element.style.display = 'none';
      return;
    }
    if (hidden) {
      if (state.editMode) {
        element.style.display = element.dataset.adminOriginalDisplay || '';
        return;
      }
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
      setAdminHiddenState(element, override && override.hidden, override && override.deleted);
      if (!override) return;
      applyElementStyles(element, override);
    });

    getStaticSections().forEach((section) => {
      const key = section.dataset.adminStaticSectionKey;
      const override = key ? state.elementOverrides.get(key) : null;
      setAdminHiddenState(section, override && override.hidden, override && override.deleted);
    });

    applySectionSizeOverrides();
  }

  function getSectionResizeKey(section) {
    if (!section) return '';
    if (section.dataset.adminDynamicSection === 'true') {
      const sectionId = Number.parseInt(section.dataset.adminSectionId || '', 10);
      return Number.isInteger(sectionId) ? `dynamic-section:${sectionId}` : '';
    }
    return section.dataset.adminStaticSectionKey || '';
  }

  function applySectionSizeOverrides() {
    const sections = [
      ...getStaticSections(),
      ...Array.from(document.querySelectorAll('[data-admin-dynamic-section="true"]')),
    ];

    sections.forEach((section) => {
      const key = getSectionResizeKey(section);
      const override = key ? state.elementOverrides.get(key) : null;
      const heightValue = override && override.height_value ? override.height_value : '';
      section.style.minHeight = heightValue || '';
      section.dataset.adminResizeKey = key || '';
    });
  }

  function applyStaticSectionOrder() {
    const main = document.querySelector('main');
    if (!main) return;

    const footer = document.querySelector('.footer');
    const sections = getStaticSections();
    const sorted = sections.slice().sort((left, right) => {
      const leftOverride = state.elementOverrides.get(left.dataset.adminStaticSectionKey);
      const rightOverride = state.elementOverrides.get(right.dataset.adminStaticSectionKey);
      const leftPosition = Number.isInteger(leftOverride && leftOverride.position) ? leftOverride.position : Number.MAX_SAFE_INTEGER;
      const rightPosition = Number.isInteger(rightOverride && rightOverride.position) ? rightOverride.position : Number.MAX_SAFE_INTEGER;
      return leftPosition - rightPosition;
    });

    const anchor = footer;
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

    if (!host.parentNode) {
      if (footer && footer.parentNode) {
        footer.parentNode.insertBefore(host, footer);
      } else {
        main.appendChild(host);
      }
    } else if (host.parentNode !== main) {
      main.appendChild(host);
    }

    host.innerHTML = '';

    state.pageSections.forEach((section) => {
      const wrapper = document.createElement('section');
      wrapper.className = 'section dynamic-page-section';
      wrapper.dataset.adminDynamicSection = 'true';
      wrapper.dataset.adminSectionId = String(section.id);
      wrapper.dataset.adminResizeKey = `dynamic-section:${section.id}`;
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

      const contentHost = document.createElement('div');
      contentHost.className = 'dynamic-page-section-content-host';

      const hasCoreContent = Boolean(section.title || section.body || section.image_path);

      if (hasCoreContent) {
        const card = document.createElement('div');
        card.className = `dynamic-page-section-card${section.image_path ? ' grid-two' : ''}`;

        const copy = document.createElement('div');
        copy.className = 'dynamic-page-section-copy';

        const tag = document.createElement('span');
        tag.className = 'section-tag';
        tag.textContent = 'Custom Section';
        copy.appendChild(tag);

        if (section.title) {
          const title = document.createElement('h2');
          title.dataset.adminSectionId = String(section.id);
          title.dataset.adminSectionField = 'title';
          title.dataset.adminEditable = 'text';
          title.dataset.adminSectionEmpty = 'false';
          title.textContent = section.title;
          copy.appendChild(title);
        }

        if (section.body) {
          const body = document.createElement('p');
          body.className = 'section-copy';
          body.dataset.adminSectionId = String(section.id);
          body.dataset.adminSectionField = 'body';
          body.dataset.adminEditable = 'text';
          body.dataset.adminSectionEmpty = 'false';
          body.textContent = section.body;
          copy.appendChild(body);
        }

        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'button secondary admin-remove-section';
        removeButton.dataset.adminRemoveSection = String(section.id);
        removeButton.textContent = 'Remove Section';
        copy.appendChild(removeButton);

        card.appendChild(copy);

        if (section.image_path) {
          const media = document.createElement('div');
          media.className = 'dynamic-page-section-media';

          const image = document.createElement('img');
          image.src = withCacheBust(section.image_path, section.updated_at);
          image.alt = section.title || 'Custom section image';
          image.dataset.adminSectionId = String(section.id);
          image.dataset.adminSectionField = 'image_path';
          image.dataset.adminEditable = 'image';
          image.dataset.adminImagePath = section.image_path;
          media.appendChild(image);

          card.appendChild(media);
        }

        contentHost.appendChild(card);
      }

      container.appendChild(contentHost);
      wrapper.appendChild(container);
      host.appendChild(wrapper);
    });

    applySectionSizeOverrides();
  }

  function placeDynamicSectionsHostRelative(staticSectionKey, insertPosition) {
    if (!staticSectionKey) return;
    const main = document.querySelector('main');
    const host = document.getElementById('dynamic-page-sections');
    if (!main || !host) return;

    assignStaticSectionKeys();
    const target = document.querySelector(`section[data-admin-static-section-key="${staticSectionKey}"]`);
    if (!target || !target.parentNode) return;

    if (insertPosition === 'before') {
      target.parentNode.insertBefore(host, target);
      return;
    }

    target.parentNode.insertBefore(host, target.nextElementSibling);
  }

  function getAlbumsRoot() {
    if (!isAlbumEnabledPage()) return null;
    const existing = document.getElementById('media-albums-root');
    if (existing) {
      existing.dataset.adminEditable = 'album-root';
      existing.dataset.adminKey = albumRootElementKey;
      return existing;
    }

    const main = document.querySelector('main');
    const footer = document.querySelector('.footer');
    if (!main) return null;

    const root = document.createElement('div');
    root.id = 'media-albums-root';
    root.className = 'media-albums-root';
    root.dataset.adminEditable = 'album-root';
    root.dataset.adminKey = albumRootElementKey;
    if (footer && footer.parentNode) {
      footer.parentNode.insertBefore(root, footer);
    } else {
      main.appendChild(root);
    }
    return root;
  }

  async function loadAlbumImages(albumId, force) {
    if (!force && state.albumImagesById.has(albumId)) {
      return state.albumImagesById.get(albumId);
    }
    const items = await fetchAlbumImages(albumId);
    state.albumImagesById.set(albumId, items);
    return items;
  }

  function ensureAlbumViewerModal() {
    if (state.albumViewerModal) return state.albumViewerModal;

    const backdrop = document.createElement('div');
    backdrop.className = 'admin-editor-backdrop';
    backdrop.innerHTML = `
      <div class="admin-editor-modal" role="dialog" aria-modal="true" aria-labelledby="album-viewer-title" style="width:min(1200px,100%);max-height:95vh;overflow:auto;">
        <h2 id="album-viewer-title">Album</h2>
        <div class="album-viewer-toolbar" style="display:flex;justify-content:space-between;gap:0.6rem;align-items:center;margin:0 0 1rem;flex-wrap:wrap;">
          <div id="album-viewer-subtitle" style="color:#b8c4e0;"></div>
          <div style="display:flex;gap:0.5rem;">
            <button type="button" data-action="upload-photo">Upload Photo</button>
            <button type="button" data-action="close">Close</button>
          </div>
        </div>
        <div id="album-lightbox" class="album-lightbox" style="display:none;">
          <button type="button" class="album-lightbox-nav" data-action="lightbox-prev" aria-label="Previous photo">&lsaquo;</button>
          <div class="album-lightbox-stage">
            <img id="album-lightbox-image" src="" alt="Album photo" />
            <div id="album-lightbox-caption" class="album-lightbox-caption"></div>
          </div>
          <button type="button" class="album-lightbox-nav" data-action="lightbox-next" aria-label="Next photo">&rsaquo;</button>
          <button type="button" class="album-lightbox-close" data-action="lightbox-close" aria-label="Close large image">&times;</button>
        </div>
        <div id="album-viewer-grid" class="album-photos-grid"></div>
      </div>
    `;

    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop || event.target.dataset.action === 'close') {
        backdrop.style.display = 'none';
      }
    });

    window.addEventListener('keydown', (event) => {
      if (!state.albumViewerModal || state.albumViewerModal.style.display !== 'flex') return;
      const lightbox = state.albumViewerModal.querySelector('#album-lightbox');
      if (!lightbox || lightbox.style.display === 'none') return;

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        navigateAlbumLightbox(1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        navigateAlbumLightbox(-1);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeAlbumLightbox();
      }
    });

    document.body.appendChild(backdrop);
    state.albumViewerModal = backdrop;
    return backdrop;
  }

  async function renderAlbumViewer(albumId) {
    const album = state.albums.find((item) => item.id === albumId);
    if (!album) return;

    const modal = ensureAlbumViewerModal();
    const title = modal.querySelector('#album-viewer-title');
    const subtitle = modal.querySelector('#album-viewer-subtitle');
    const grid = modal.querySelector('#album-viewer-grid');
    const uploadButton = modal.querySelector('[data-action="upload-photo"]');
    const lightbox = modal.querySelector('#album-lightbox');

    if (lightbox) {
      const prevButton = lightbox.querySelector('[data-action="lightbox-prev"]');
      const nextButton = lightbox.querySelector('[data-action="lightbox-next"]');
      const closeButton = lightbox.querySelector('[data-action="lightbox-close"]');
      prevButton.onclick = () => navigateAlbumLightbox(-1);
      nextButton.onclick = () => navigateAlbumLightbox(1);
      closeButton.onclick = () => closeAlbumLightbox();
    }

    title.textContent = album.title;
    subtitle.textContent = album.description || '';

    const images = await loadAlbumImages(albumId, true);
    state.albumViewerImages = images;
    state.albumViewerTitle = album.title;
    state.albumViewerIndex = images.length > 0 ? 0 : -1;
    closeAlbumLightbox();
    grid.innerHTML = '';

    images.forEach((image, index) => {
      const item = document.createElement('article');
      item.className = 'album-photo-item';
      item.innerHTML = `
        <img src="${withCacheBust(image.image_path, image.updated_at)}" alt="${escapeHtml(album.title)}" />
        <div class="album-photo-caption">${escapeHtml(image.caption || '')}</div>
      `;

      const photo = item.querySelector('img');
      if (photo) {
        photo.style.cursor = 'zoom-in';
        photo.addEventListener('click', () => {
          openAlbumLightbox(index);
        });
      }

      if (state.isAdmin && state.editMode) {
        const tools = document.createElement('div');
        tools.style.display = 'flex';
        tools.style.gap = '0.35rem';
        tools.style.padding = '0 0.5rem 0.6rem';

        const captionButton = document.createElement('button');
        captionButton.type = 'button';
        captionButton.textContent = 'Caption';
        captionButton.addEventListener('click', async () => {
          const nextCaption = window.prompt('Photo caption:', image.caption || '');
          if (nextCaption === null) return;
          await updateAlbumImage(albumId, image.id, { caption: nextCaption });
          await renderAlbumViewer(albumId);
          await loadMediaAlbums();
        });

        const coverButton = document.createElement('button');
        coverButton.type = 'button';
        coverButton.textContent = 'Set Cover';
        coverButton.addEventListener('click', async () => {
          await updateAlbum(albumId, {
            title: album.title,
            description: album.description || '',
            coverImagePath: image.image_path,
            position: album.position,
          });
          await loadMediaAlbums();
          await renderAlbumViewer(albumId);
        });

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.textContent = 'Delete';
        deleteButton.style.color = '#ff9b9b';
        deleteButton.addEventListener('click', async () => {
          if (!window.confirm('Delete this photo?')) return;
          await deleteAlbumImage(albumId, image.id);
          await renderAlbumViewer(albumId);
          await loadMediaAlbums();
        });

        tools.append(captionButton, coverButton, deleteButton);
        item.appendChild(tools);
      }

      grid.appendChild(item);
    });

    uploadButton.style.display = state.isAdmin && state.editMode ? 'inline-flex' : 'none';
    uploadButton.onclick = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return;

        try {
          const pathValue = await uploadAdminImage(file, '');
          const caption = window.prompt('Photo caption (optional):', '') || '';
          await createAlbumImage(albumId, {
            imagePath: pathValue,
            caption,
            setAsCover: images.length === 0,
          });
          await loadMediaAlbums();
          modal.style.display = 'none';
        } catch (error) {
          alert(error.message);
        }
      };
      input.click();
    };

    modal.style.display = 'flex';
  }

  function openAlbumLightbox(index) {
    if (!state.albumViewerModal) return;
    if (!Array.isArray(state.albumViewerImages) || state.albumViewerImages.length === 0) return;

    const clamped = Math.max(0, Math.min(state.albumViewerImages.length - 1, index));
    state.albumViewerIndex = clamped;
    const lightbox = state.albumViewerModal.querySelector('#album-lightbox');
    if (!lightbox) return;

    lightbox.style.display = 'grid';
    updateAlbumLightbox();
  }

  function closeAlbumLightbox() {
    if (!state.albumViewerModal) return;
    const lightbox = state.albumViewerModal.querySelector('#album-lightbox');
    if (!lightbox) return;
    lightbox.style.display = 'none';
  }

  function navigateAlbumLightbox(direction) {
    const total = state.albumViewerImages.length;
    if (!total) return;

    const current = Number.isInteger(state.albumViewerIndex) ? state.albumViewerIndex : 0;
    const next = (current + direction + total) % total;
    state.albumViewerIndex = next;
    updateAlbumLightbox();
  }

  function updateAlbumLightbox() {
    if (!state.albumViewerModal) return;
    const current = state.albumViewerImages[state.albumViewerIndex];
    if (!current) return;

    const image = state.albumViewerModal.querySelector('#album-lightbox-image');
    const caption = state.albumViewerModal.querySelector('#album-lightbox-caption');
    if (!image || !caption) return;

    image.src = withCacheBust(current.image_path, current.updated_at);
    image.alt = state.albumViewerTitle || 'Album photo';

    const indexLabel = `${state.albumViewerIndex + 1} / ${state.albumViewerImages.length}`;
    const captionText = current.caption ? escapeHtml(current.caption) : '';
    caption.innerHTML = captionText ? `${captionText}<span>${indexLabel}</span>` : `<span>${indexLabel}</span>`;
  }

  function renderMediaAlbums() {
    if (!isAlbumEnabledPage()) return;

    const root = getAlbumsRoot();
    if (!root) return;

    const cards = state.albums.map((album) => {
      const cover = album.cover_image_path
        ? `<img src="${withCacheBust(album.cover_image_path, album.updated_at)}" alt="${escapeHtml(album.title)}" />`
        : '<div class="album-cover-empty">No cover image</div>';
      const description = album.description ? `<p>${escapeHtml(album.description)}</p>` : '';

      return `
        <article class="album-card" data-album-id="${album.id}">
          <button type="button" class="album-cover" data-album-action="open" data-album-id="${album.id}" title="Open album">
            ${cover}
          </button>
          <div class="album-meta">
            <h3>${escapeHtml(album.title)}</h3>
            ${description}
            <p>${album.image_count || 0} photos</p>
          </div>
          <div class="album-tools">
            <button type="button" data-album-action="move-up" data-album-id="${album.id}">Up</button>
            <button type="button" data-album-action="move-down" data-album-id="${album.id}">Down</button>
            <button type="button" data-album-action="add-photo" data-album-id="${album.id}">Add Photo</button>
            <button type="button" data-album-action="manage" data-album-id="${album.id}">Manage</button>
            <button type="button" data-album-action="edit" data-album-id="${album.id}">Edit</button>
            <button type="button" data-album-action="delete" data-album-id="${album.id}" style="color:#ff9b9b;">Delete</button>
          </div>
        </article>
      `;
    }).join('');

    root.innerHTML = `
      <div class="album-admin-toolbar">
        <button type="button" data-album-action="create">Create Album</button>
      </div>
      <div class="album-grid">
        ${cards || '<p class="section-intro">No albums yet.</p>'}
      </div>
    `;
  }

  async function loadMediaAlbums() {
    if (!isAlbumEnabledPage()) return;
    try {
      state.albums = await fetchAlbums();
      renderMediaAlbums();
    } catch (_error) {
      state.albums = [];
      renderMediaAlbums();
    }
  }

  function bindAlbumUiEvents() {
    if (state.albumUiBound) return;
    state.albumUiBound = true;

    document.addEventListener('click', async (event) => {
      const trigger = event.target.closest('[data-album-action]');
      if (!trigger || !isAlbumEnabledPage()) return;

      const action = trigger.dataset.albumAction;
      const albumId = Number.parseInt(trigger.dataset.albumId || '', 10);
      const album = state.albums.find((item) => item.id === albumId);

      event.preventDefault();
      event.stopPropagation();

      try {
        if (action === 'open' && album) {
          await renderAlbumViewer(album.id);
          return;
        }

        if (!state.isAdmin || !state.editMode) {
          return;
        }

        if (action === 'create') {
          const title = window.prompt('Album title:', '');
          if (!title) return;
          const description = window.prompt('Album description (optional):', '') || '';
          await createAlbum({ title, description });
          await loadMediaAlbums();
          return;
        }

        if (!album) return;

        if (action === 'edit') {
          const title = window.prompt('Album title:', album.title);
          if (!title) return;
          const description = window.prompt('Album description (optional):', album.description || '') || '';
          await updateAlbum(album.id, {
            title,
            description,
            coverImagePath: album.cover_image_path || '',
            position: album.position,
          });
          await loadMediaAlbums();
          return;
        }

        if (action === 'delete') {
          if (!window.confirm('Delete this album and all photos?')) return;
          await deleteAlbum(album.id);
          await loadMediaAlbums();
          return;
        }

        if (action === 'move-up' || action === 'move-down') {
          const ids = state.albums.map((item) => item.id);
          const currentIndex = ids.indexOf(album.id);
          if (currentIndex < 0) return;

          const delta = action === 'move-up' ? -1 : 1;
          const nextIndex = currentIndex + delta;
          if (nextIndex < 0 || nextIndex >= ids.length) return;

          const [movedId] = ids.splice(currentIndex, 1);
          ids.splice(nextIndex, 0, movedId);
          await reorderAlbums(ids);
          await loadMediaAlbums();
          return;
        }

        if (action === 'manage') {
          await renderAlbumViewer(album.id);
          return;
        }

        if (action === 'add-photo') {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.onchange = async () => {
            const file = input.files && input.files[0];
            if (!file) return;

            const pathValue = await uploadAdminImage(file, '');
            const caption = window.prompt('Photo caption (optional):', '') || '';
            await createAlbumImage(album.id, {
              imagePath: pathValue,
              caption,
              setAsCover: Number(album.image_count || 0) === 0,
            });
            await loadMediaAlbums();
          };
          input.click();
        }
      } catch (error) {
        alert(error.message);
      }
    }, true);
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
        const cssVarName = element.dataset.adminBackgroundVar;
        const bgVarAuto = element.dataset.adminBgVarAuto === 'true';

        if (!item.content_value) {
          if (cssVarName) element.style.removeProperty(cssVarName);
          element.style.removeProperty('background-image');
          element.style.removeProperty('background-position');
          element.style.removeProperty('background-size');
          element.style.removeProperty('background-repeat');
          return;
        }

        if (cssVarName && !bgVarAuto) {
          // Element's CSS rule already references this var (e.g. home hero, history hero)
          element.style.setProperty(cssVarName, `url("${nextValue}")`);
          element.style.removeProperty('background-image');
        } else {
          // Auto-assigned var or no var — set inline so it's always visible
          if (cssVarName) element.style.setProperty(cssVarName, `url("${nextValue}")`);
          element.style.backgroundImage = `url("${nextValue}")`;
          element.style.backgroundPosition = 'center';
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

    // Find the parent section in the DOM. Parent may be:
    // - static section key: static-section:...
    // - static DOM id key: section#some-id
    // - dynamic section key: section#<numericId>
    if (parentPath.startsWith('static-section:')) {
      parentSection = document.querySelector(`[data-admin-static-section-key="${parentPath}"]`);
    } else if (parentPath.includes('#')) {
      const rawId = parentPath.split('#')[1] || '';
      const dynamicId = Number.parseInt(rawId, 10);

      if (Number.isInteger(dynamicId)) {
        parentSection = document.querySelector(`[data-admin-dynamic-section="true"][data-admin-section-id="${dynamicId}"]`);
      }

      if (!parentSection) {
        parentSection = document.getElementById(rawId);
      }

      if (!parentSection) {
        parentSection = document.querySelector(`[data-admin-static-section-key="${parentPath}"]`);
      }
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
    const parentHost = getSectionContentHost(parentSection) || parentSection;
    parentHost.appendChild(newElement);
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

      .admin-format-grid select,
      .admin-format-grid input[type="text"] {
        width: 100%;
        padding: 0.75rem 0.9rem;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.3);
        background: rgba(3, 9, 22, 0.96);
        color: #ffffff;
        font: inherit;
      }

      .admin-format-grid input[type="text"]::placeholder {
        color: rgba(216, 226, 250, 0.78);
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
      body.admin-edit-mode [data-admin-editable="background-image"],
      body.admin-edit-mode [data-admin-editable="container"],
      body.admin-edit-mode [data-admin-editable="album-root"] {
        outline: 2px dashed rgba(255, 210, 98, 0.6);
        outline-offset: 4px;
        cursor: pointer;
      }

      body.admin-edit-mode.admin-free-drag-mode [data-admin-editable="text"],
      body.admin-edit-mode.admin-free-drag-mode [data-admin-editable="image"],
      body.admin-edit-mode.admin-free-drag-mode [data-admin-editable="background-image"],
      body.admin-edit-mode.admin-free-drag-mode [data-admin-editable="container"],
      body.admin-edit-mode.admin-free-drag-mode [data-admin-editable="album-root"] {
        cursor: grab;
      }

      body.admin-edit-mode.admin-free-drag-mode [data-admin-editable="text"].admin-is-dragging,
      body.admin-edit-mode.admin-free-drag-mode [data-admin-editable="image"].admin-is-dragging,
      body.admin-edit-mode.admin-free-drag-mode [data-admin-editable="background-image"].admin-is-dragging,
      body.admin-edit-mode.admin-free-drag-mode [data-admin-editable="container"].admin-is-dragging,
      body.admin-edit-mode.admin-free-drag-mode [data-admin-editable="album-root"].admin-is-dragging {
        cursor: grabbing;
        opacity: 0.92;
      }

      body.admin-edit-mode .admin-free-positioned {
        box-shadow: 0 0 0 2px rgba(102, 204, 255, 0.75);
      }

      /* Enforce layer order while editing: text above image/background elements. */
      body.admin-edit-mode .admin-free-positioned[data-admin-editable="text"] {
        z-index: 12 !important;
      }

      body.admin-edit-mode .admin-free-positioned[data-admin-editable="image"],
      body.admin-edit-mode .admin-free-positioned[data-admin-editable="background-image"],
      body.admin-edit-mode .admin-free-positioned[data-admin-editable="container"],
      body.admin-edit-mode .admin-free-positioned[data-admin-editable="album-root"] {
        z-index: 8 !important;
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
        border: 1px solid rgba(255, 255, 255, 0.3);
        background: rgba(3, 9, 22, 0.96);
        color: #ffffff;
        resize: vertical;
        font: inherit;
      }

      .admin-editor-modal textarea::placeholder {
        color: rgba(216, 226, 250, 0.78);
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

      .admin-add-section-button.is-active {
        border-color: rgba(255, 210, 98, 0.75);
        background: rgba(255, 210, 98, 0.22);
        color: #ffd262;
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

      .dynamic-page-section-content-host {
        display: grid;
        gap: 1rem;
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

      .admin-element-toolbar {
        position: fixed;
        z-index: 10030;
        display: none;
        align-items: center;
        gap: 0.35rem;
        padding: 0.45rem;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: rgba(2, 8, 22, 0.95);
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
      }

      .admin-element-toolbar button {
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.08);
        color: #f5f7ff;
        border-radius: 999px;
        padding: 0.35rem 0.7rem;
        cursor: pointer;
        font-size: 0.8rem;
      }

      .admin-element-toolbar button:hover,
      .admin-element-toolbar button:focus-visible {
        border-color: rgba(255, 210, 98, 0.55);
        background: rgba(255, 210, 98, 0.14);
      }

      .admin-element-toolbar button[disabled] {
        opacity: 0.45;
        cursor: not-allowed;
      }

      body.admin-edit-mode .admin-empty-section-field {
        color: #9ec5ff;
        font-style: italic;
        min-height: 1.4em;
        cursor: pointer;
      }

      body.admin-edit-mode [data-admin-drag-target="true"] {
        outline: 2px dashed rgba(255, 210, 98, 0.75);
        outline-offset: 8px;
        position: relative;
      }

      body.admin-edit-mode [data-admin-drag-target="true"][data-admin-drag-position="before"] {
        box-shadow: inset 0 4px 0 0 rgba(255, 210, 98, 0.85);
      }

      body.admin-edit-mode [data-admin-drag-target="true"][data-admin-drag-position="before"]::before {
        content: "Insert Here";
        position: absolute;
        top: -1.35rem;
        left: 50%;
        transform: translateX(-50%);
        padding: 0.2rem 0.55rem;
        border-radius: 999px;
        border: 1px solid rgba(255, 210, 98, 0.7);
        background: rgba(2, 8, 22, 0.96);
        color: #ffd262;
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.04em;
        z-index: 6;
        pointer-events: none;
      }

      body.admin-edit-mode [data-admin-drag-target="true"][data-admin-drag-position="after"] {
        box-shadow: inset 0 -4px 0 0 rgba(255, 210, 98, 0.85);
      }

      body.admin-edit-mode [data-admin-drag-target="true"][data-admin-drag-position="after"]::after {
        content: "Insert Here";
        position: absolute;
        bottom: -1.35rem;
        left: 50%;
        transform: translateX(-50%);
        padding: 0.2rem 0.55rem;
        border-radius: 999px;
        border: 1px solid rgba(255, 210, 98, 0.7);
        background: rgba(2, 8, 22, 0.96);
        color: #ffd262;
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.04em;
        z-index: 6;
        pointer-events: none;
      }

      body.admin-edit-mode [data-admin-text-drop-target="true"] {
        outline: 2px dashed rgba(102, 204, 255, 0.9);
        outline-offset: 8px;
      }

      body.admin-edit-mode [data-admin-editable="text"][draggable="true"] {
        cursor: move;
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
          <label>Font Family
            <select id="admin-format-family">
              <option value="">Default</option>
              <option value="Georgia, \"Times New Roman\", serif">Serif (Georgia)</option>
              <option value="\"Trebuchet MS\", \"Lucida Grande\", \"Lucida Sans Unicode\", sans-serif">Trebuchet</option>
              <option value="\"Segoe UI\", Tahoma, Geneva, Verdana, sans-serif">Segoe UI</option>
              <option value="\"Courier New\", Courier, monospace">Monospace (Courier)</option>
              <option value="\"Brush Script MT\", \"Comic Sans MS\", cursive">Script</option>
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
          <label>Font Size
            <input id="admin-format-font-size" type="text" placeholder="16px, 1.125rem" />
          </label>
          <label>Opacity
            <input id="admin-format-opacity" type="text" placeholder="1, 0.85, 0.5" />
          </label>
          <label>Text Color
            <div class="admin-color-row">
              <input id="admin-format-color" type="color" value="#ffffff" />
              <button type="button" class="admin-color-reset" id="admin-format-color-reset">Default</button>
            </div>
          </label>
          <label>Background Color
            <div class="admin-color-row">
              <input id="admin-format-bg-color" type="color" value="#ffffff" />
              <button type="button" class="admin-color-reset" id="admin-format-bg-color-reset">Default</button>
            </div>
          </label>
          <label>Background Opacity
            <input id="admin-format-bg-opacity" type="text" placeholder="1, 0.85, 0.5" />
          </label>
          <label>Width
            <input id="admin-format-width" type="text" placeholder="auto, 320px, 50%" />
          </label>
          <label>Height
            <input id="admin-format-height" type="text" placeholder="auto, 180px" />
          </label>
          <label>Border Style
            <select id="admin-format-border-style">
              <option value="">Default</option>
              <option value="none">None</option>
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
              <option value="double">Double</option>
            </select>
          </label>
          <label>Border Width
            <input id="admin-format-border-width" type="text" placeholder="1px, 0" />
          </label>
          <label>Border Color
            <div class="admin-color-row">
              <input id="admin-format-border-color" type="color" value="#ffffff" />
              <button type="button" class="admin-color-reset" id="admin-format-border-color-reset">Default</button>
            </div>
          </label>
          <label>Corner Radius
            <input id="admin-format-radius" type="text" placeholder="0, 8px, 50%" />
          </label>
        </div>
        <textarea id="admin-editor-textarea"></textarea>
        <div class="admin-editor-actions">
          <button type="button" class="button secondary" data-action="position-toggle">Enable Free Position</button>
          <button type="button" class="button secondary" data-action="position-reset">Reset Position</button>
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
    const familySelect = modal.querySelector('#admin-format-family');
    const weightSelect = modal.querySelector('#admin-format-weight');
    const styleSelect = modal.querySelector('#admin-format-style');
    const transformSelect = modal.querySelector('#admin-format-transform');
    const fontSizeInput = modal.querySelector('#admin-format-font-size');
    const opacityInput = modal.querySelector('#admin-format-opacity');
    const colorInput = modal.querySelector('#admin-format-color');
    const colorReset = modal.querySelector('#admin-format-color-reset');
    const bgColorInput = modal.querySelector('#admin-format-bg-color');
    const bgColorReset = modal.querySelector('#admin-format-bg-color-reset');
    const bgOpacityInput = modal.querySelector('#admin-format-bg-opacity');
    const widthInput = modal.querySelector('#admin-format-width');
    const heightInput = modal.querySelector('#admin-format-height');
    const borderStyleSelect = modal.querySelector('#admin-format-border-style');
    const borderWidthInput = modal.querySelector('#admin-format-border-width');
    const borderColorInput = modal.querySelector('#admin-format-border-color');
    const borderColorReset = modal.querySelector('#admin-format-border-color-reset');
    const borderRadiusInput = modal.querySelector('#admin-format-radius');
    const positionToggleButton = modal.querySelector('[data-action="position-toggle"]');
    const positionResetButton = modal.querySelector('[data-action="position-reset"]');
    const formatGrid = modal.querySelector('.admin-format-grid');
    const existingColor = normalizeColorValue(options.formatting.textColor);
    const existingBgColor = normalizeColorValue(options.formatting.backgroundColor);
    const existingBorderColor = normalizeColorValue(options.formatting.borderColor);

    title.textContent = heading;
    copy.textContent = description;
    const showTextInput = options.showTextInput !== false;
    textarea.value = initialValue;
    textarea.style.display = showTextInput ? '' : 'none';
    formatGrid.style.display = '';
    alignSelect.value = options.formatting.textAlign || '';
    familySelect.value = options.formatting.fontFamily || '';
    weightSelect.value = options.formatting.fontWeight || '';
    styleSelect.value = options.formatting.fontStyle || '';
    transformSelect.value = options.formatting.textTransform || '';
    fontSizeInput.value = options.formatting.fontSize || '';
    opacityInput.value = options.formatting.opacityValue || '';
    colorInput.value = existingColor || '#ffffff';
    bgColorInput.value = existingBgColor || '#ffffff';
    bgOpacityInput.value = options.formatting.backgroundOpacityValue || '';
    widthInput.value = options.formatting.widthValue || '';
    heightInput.value = options.formatting.heightValue || '';
    borderStyleSelect.value = options.formatting.borderStyle || '';
    borderWidthInput.value = options.formatting.borderWidth || '';
    borderColorInput.value = existingBorderColor || '#ffffff';
    borderRadiusInput.value = options.formatting.borderRadius || '';
    colorInput.dataset.custom = existingColor ? 'true' : 'false';
    bgColorInput.dataset.custom = existingBgColor ? 'true' : 'false';
    borderColorInput.dataset.custom = existingBorderColor ? 'true' : 'false';
    hideButton.style.display = options.allowHide ? 'inline-flex' : 'none';
    hideButton.textContent = options.hideLabel || 'Hide Element';
    saveButton.textContent = 'Save';
    if (positionToggleButton) {
      positionToggleButton.style.display = options.allowPosition ? 'inline-flex' : 'none';
      positionToggleButton.textContent = options.isFreePositioned ? 'Disable Free Position' : 'Enable Free Position';
    }
    if (positionResetButton) {
      positionResetButton.style.display = options.allowPosition ? 'inline-flex' : 'none';
    }
    if (showTextInput) {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }

    colorReset.onclick = () => {
      colorInput.dataset.custom = 'false';
    };

    colorInput.oninput = () => {
      colorInput.dataset.custom = 'true';
    };

    bgColorReset.onclick = () => {
      bgColorInput.dataset.custom = 'false';
    };

    bgColorInput.oninput = () => {
      bgColorInput.dataset.custom = 'true';
    };

    borderColorReset.onclick = () => {
      borderColorInput.dataset.custom = 'false';
    };

    borderColorInput.oninput = () => {
      borderColorInput.dataset.custom = 'true';
    };

    if (positionToggleButton) {
      positionToggleButton.onclick = async () => {
        if (!options.onPositionToggle) return;
        positionToggleButton.disabled = true;
        try {
          await options.onPositionToggle();
          closeAdminModal();
        } catch (error) {
          alert(error.message);
        } finally {
          positionToggleButton.disabled = false;
        }
      };
    }

    if (positionResetButton) {
      positionResetButton.onclick = async () => {
        if (!options.onPositionReset) return;
        positionResetButton.disabled = true;
        try {
          await options.onPositionReset();
          closeAdminModal();
        } catch (error) {
          alert(error.message);
        } finally {
          positionResetButton.disabled = false;
        }
      };
    }

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
      if (showTextInput && !nextValue) {
        alert('Text cannot be empty.');
        return;
      }

      saveButton.disabled = true;
      try {
        const formatting = {
          textAlign: alignSelect.value,
          fontFamily: familySelect.value,
          fontWeight: weightSelect.value,
          fontStyle: styleSelect.value,
          textTransform: transformSelect.value,
          fontSize: fontSizeInput.value.trim(),
          opacityValue: opacityInput.value.trim(),
          textColor: colorInput.dataset.custom === 'true' ? colorInput.value : '',
          backgroundColor: bgColorInput.dataset.custom === 'true' ? bgColorInput.value : '',
          backgroundOpacityValue: bgOpacityInput.value.trim(),
          widthValue: widthInput.value.trim(),
          heightValue: heightInput.value.trim(),
          borderStyle: borderStyleSelect.value,
          borderWidth: borderWidthInput.value.trim(),
          borderColor: borderColorInput.dataset.custom === 'true' ? borderColorInput.value : '',
          borderRadius: borderRadiusInput.value.trim(),
        };
        if (showTextInput) {
          await options.onSave(nextValue, formatting);
        } else if (options.onSaveFormatting) {
          await options.onSaveFormatting(formatting);
        }
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
          fontFamily: override.font_family || '',
          fontWeight: override.font_weight || '',
          fontStyle: override.font_style || '',
          textTransform: override.text_transform || '',
          fontSize: override.font_size || '',
          opacityValue: override.opacity_value || '',
          textColor: override.text_color || '',
          backgroundColor: override.background_color || '',
          backgroundOpacityValue: override.background_opacity_value || '',
          widthValue: override.width_value || '',
          heightValue: override.height_value || '',
          borderStyle: override.border_style || '',
          borderWidth: override.border_width || '',
          borderColor: override.border_color || '',
          borderRadius: override.border_radius || '',
        },
        allowHide: true,
        hideLabel: isHidden ? 'Show Element' : 'Hide Element',
        allowDelete: true,
        allowPosition: true,
        isFreePositioned: override.position_mode === 'absolute',
        onPositionToggle: async () => {
          const isAbsolute = override.position_mode === 'absolute';
          const item = await saveElementOverride(key, {
            positionMode: isAbsolute ? 'flow' : 'absolute',
            posX: isAbsolute ? null : (Number.isFinite(override.pos_x) ? override.pos_x : 12),
            posY: isAbsolute ? null : (Number.isFinite(override.pos_y) ? override.pos_y : 12),
          });
          applyElementStyles(element, item);
        },
        onPositionReset: async () => {
          const item = await saveElementOverride(key, {
            positionMode: 'flow',
            posX: null,
            posY: null,
          });
          applyElementStyles(element, item);
        },
        onHide: async () => {
          await saveElementOverride(key, { hidden: !isHidden, deleted: false });
          setAdminHiddenState(element, !isHidden, false);
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

          await saveElementOverride(key, { hidden: true, deleted: true });
          element.remove();
          state.registry.delete(`text:${key}`);
        },
        onSave: async (nextValue, formatting) => {
          const item = await saveContentUpdate({
          contentKey: element.dataset.adminKey,
          contentType: 'text',
          contentValue: nextValue,
        });
        applyContentItem(item);
          const savedOverride = await saveElementOverride(key, { ...formatting, hidden: false, deleted: false });
          setAdminHiddenState(element, false, false);
          applyElementStyles(element, savedOverride);
        },
      }
    );
  }

  function openContainerEditor(element) {
    const key = element.dataset.adminKey;
    const override = (key && state.elementOverrides.get(key)) || {};
    const isHidden = Boolean(override.hidden);

    openTextModal(
      '',
      'Edit container',
      'Adjust styles, visibility, positioning, and delete this container if needed.',
      {
        showTextInput: false,
        formatting: {
          textAlign: override.text_align || '',
          fontFamily: override.font_family || '',
          fontWeight: override.font_weight || '',
          fontStyle: override.font_style || '',
          textTransform: override.text_transform || '',
          fontSize: override.font_size || '',
          opacityValue: override.opacity_value || '',
          textColor: override.text_color || '',
          backgroundColor: override.background_color || '',
          backgroundOpacityValue: override.background_opacity_value || '',
          widthValue: override.width_value || '',
          heightValue: override.height_value || '',
          borderStyle: override.border_style || '',
          borderWidth: override.border_width || '',
          borderColor: override.border_color || '',
          borderRadius: override.border_radius || '',
        },
        allowHide: true,
        hideLabel: isHidden ? 'Show Element' : 'Hide Element',
        allowDelete: true,
        allowPosition: true,
        isFreePositioned: override.position_mode === 'absolute',
        onPositionToggle: async () => {
          const isAbsolute = override.position_mode === 'absolute';
          const item = await saveElementOverride(key, {
            positionMode: isAbsolute ? 'flow' : 'absolute',
            posX: isAbsolute ? null : (Number.isFinite(override.pos_x) ? override.pos_x : 12),
            posY: isAbsolute ? null : (Number.isFinite(override.pos_y) ? override.pos_y : 12),
            deleted: false,
          });
          applyElementStyles(element, item);
        },
        onPositionReset: async () => {
          const item = await saveElementOverride(key, {
            positionMode: 'flow',
            posX: null,
            posY: null,
            deleted: false,
          });
          applyElementStyles(element, item);
        },
        onHide: async () => {
          await saveElementOverride(key, { hidden: !isHidden, deleted: false });
          setAdminHiddenState(element, !isHidden, false);
        },
        onDelete: async () => {
          await saveElementOverride(key, { hidden: true, deleted: true });
          element.remove();
          state.registry.delete(`container:${key}`);
        },
        onSaveFormatting: async (formatting) => {
          const item = await saveElementOverride(key, {
            ...formatting,
            hidden: false,
            deleted: false,
          });
          setAdminHiddenState(element, false, false);
          applyElementStyles(element, item);
        },
      }
    );
  }

  function getSelectedEditableElement() {
    const element = state.selectedEditableElement;
    if (!element || !document.body.contains(element)) return null;
    if (!element.dataset || !element.dataset.adminEditable) return null;
    return element;
  }

  function getParentEditableElement(element) {
    if (!element) return null;
    let current = element.parentElement;
    while (current) {
      if (current.dataset && current.dataset.adminEditable && !isInsideAdminUi(current)) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function hideElementToolbar() {
    if (!state.elementToolbar) return;
    state.elementToolbar.style.display = 'none';
    state.selectedEditableElement = null;
  }

  function ensureElementToolbar() {
    if (state.elementToolbar) return state.elementToolbar;

    const toolbar = document.createElement('div');
    toolbar.className = 'admin-element-toolbar';
    toolbar.innerHTML = `
      <button type="button" data-action="edit">Edit</button>
      <button type="button" data-action="style">Style</button>
      <button type="button" data-action="parent">Parent</button>
      <button type="button" data-action="move">Move</button>
      <button type="button" data-action="duplicate">Duplicate</button>
      <button type="button" data-action="delete" style="color:#ff9b9b;">Delete</button>
    `;

    toolbar.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();

      const element = getSelectedEditableElement();
      if (!element) {
        hideElementToolbar();
        return;
      }

      const action = button.dataset.action;
      try {
        if (action === 'edit' || action === 'style') {
          hideElementToolbar();
          openEditorForSelectedElement(element, action);
          return;
        }

        if (action === 'move') {
          await enableMoveForElement(element);
          hideElementToolbar();
          return;
        }

        if (action === 'parent') {
          const parent = getParentEditableElement(element);
          if (!parent) return;
          const rect = parent.getBoundingClientRect();
          const centerX = rect.left + (rect.width / 2);
          const topY = rect.top;
          showElementToolbarFor(parent, centerX, topY);
          return;
        }

        if (action === 'duplicate') {
          await duplicateSelectedElement(element);
          hideElementToolbar();
          return;
        }

        if (action === 'delete') {
          if (!window.confirm('Delete this selected element?')) return;
          await deleteSelectedElement(element);
          hideElementToolbar();
        }
      } catch (error) {
        alert(error.message);
      }
    });

    document.body.appendChild(toolbar);
    state.elementToolbar = toolbar;
    return toolbar;
  }

  function openEditorForSelectedElement(element, action) {
    if (!element) return;
    const editableType = element.dataset.adminEditable;

    if (element.dataset.adminSectionField && editableType === 'text') {
      openSectionTextEditor(element);
      return;
    }

    if (element.dataset.adminSectionField && (editableType === 'image' || editableType === 'background-image')) {
      openSectionImageEditor(element);
      return;
    }

    if (editableType === 'text') {
      openTextEditor(element);
      return;
    }

    if (editableType === 'image' || editableType === 'background-image') {
      openStaticImageEditor(element);
      return;
    }

    if (editableType === 'container') {
      openContainerEditor(element);
      return;
    }

    if (editableType === 'album-root') {
      if (action === 'style') {
        openContainerEditor(element);
      } else {
        alert('Use album controls to manage album content.');
      }
    }
  }

  async function enableMoveForElement(element) {
    const key = element.dataset.adminKey;
    if (!key) return;
    const override = state.elementOverrides.get(key) || {};
    const item = await saveElementOverride(key, {
      hidden: false,
      deleted: false,
      positionMode: 'absolute',
      posX: Number.isFinite(override.pos_x) ? override.pos_x : element.offsetLeft,
      posY: Number.isFinite(override.pos_y) ? override.pos_y : element.offsetTop,
    });
    applyElementStyles(element, item);
  }

  async function duplicateSelectedElement(element) {
    if (!element) return;
    if (element.dataset.adminSectionField) {
      throw new Error('Duplicate is not supported for section field elements.');
    }

    const editableType = element.dataset.adminEditable;
    if (!['text', 'image'].includes(editableType)) {
      throw new Error('Duplicate is supported for text and image elements.');
    }

    const hostSection = getHostSectionForElement(element);
    const parentKey = getSectionParentKey(hostSection);
    if (!parentKey) {
      throw new Error('Unable to determine parent section for duplicate.');
    }

    const contentType = editableType === 'text' ? 'text' : 'image';
    const contentValue = editableType === 'text'
      ? (element.textContent || '').trim()
      : ((element.dataset.adminImagePath || element.getAttribute('src') || '').split('?')[0]);
    if (!contentValue) {
      throw new Error('Nothing to duplicate for this element.');
    }

    const item = await createNewContentElement(parentKey, contentType, contentValue);
    const sectionHost = getSectionContentHost(hostSection) || hostSection;
    if (!sectionHost) throw new Error('Unable to place duplicated element.');

    let newElement;
    if (contentType === 'text') {
      newElement = document.createElement('p');
      newElement.textContent = contentValue;
      newElement.style.marginTop = '1rem';
      newElement.dataset.adminEditable = 'text';
      newElement.dataset.adminKey = item.content_key;
    } else {
      newElement = document.createElement('img');
      newElement.src = contentValue;
      newElement.alt = element.alt || 'Duplicated image';
      newElement.style.marginTop = '1rem';
      newElement.style.maxWidth = '100%';
      newElement.style.borderRadius = '8px';
      newElement.dataset.adminEditable = 'image';
      newElement.dataset.adminKey = item.content_key;
      newElement.dataset.adminImagePath = contentValue;
    }

    sectionHost.appendChild(newElement);
    state.registry.set(`${contentType}:${item.content_key}`, newElement);

    const sourceKey = element.dataset.adminKey;
    const sourceOverride = sourceKey ? state.elementOverrides.get(sourceKey) : null;
    if (sourceOverride) {
      const copiedOverride = await saveElementOverride(item.content_key, {
        hidden: false,
        deleted: false,
        textAlign: sourceOverride.text_align,
        fontFamily: sourceOverride.font_family,
        fontWeight: sourceOverride.font_weight,
        fontStyle: sourceOverride.font_style,
        textTransform: sourceOverride.text_transform,
        fontSize: sourceOverride.font_size,
        opacityValue: sourceOverride.opacity_value,
        textColor: sourceOverride.text_color,
        backgroundColor: sourceOverride.background_color,
        backgroundOpacityValue: sourceOverride.background_opacity_value,
        widthValue: sourceOverride.width_value,
        heightValue: sourceOverride.height_value,
        borderStyle: sourceOverride.border_style,
        borderWidth: sourceOverride.border_width,
        borderColor: sourceOverride.border_color,
        borderRadius: sourceOverride.border_radius,
      });
      applyElementStyles(newElement, copiedOverride);
    }

    registerEditableElements();
    applyElementOverrides();
    registerSectionEditing();
  }

  async function deleteSelectedElement(element) {
    if (!element) return;
    const editableType = element.dataset.adminEditable;

    if (editableType === 'text') {
      if (element.dataset.adminSectionField) {
        throw new Error('Delete is not supported for section title/body fields.');
      }
      const key = element.dataset.adminKey;
      if (!key) return;
      if (isDynamicContentKey(key)) {
        await deleteContentItem(key, 'text');
      } else {
        await saveElementOverride(key, { hidden: true, deleted: true });
      }
      element.remove();
      state.registry.delete(`text:${key}`);
      return;
    }

    if (editableType === 'image' || editableType === 'background-image') {
      if (element.dataset.adminSectionField) {
        if (['background_path', 'image_path'].includes(element.dataset.adminSectionField)) {
          const sectionId = Number.parseInt(element.dataset.adminSectionId, 10);
          const item = await updatePageSection(sectionId, element.dataset.adminSectionField, '');
          upsertPageSection(item);
          renderPageSections();
          registerSectionEditing();
          return;
        }
        throw new Error('Delete is not supported for this section field.');
      }

      const key = element.dataset.adminKey;
      if (!key) return;
      if (isDynamicContentKey(key)) {
        await deleteContentItem(key, 'image');
      } else {
        await saveElementOverride(key, { hidden: true, deleted: true });
      }
      element.remove();
      state.registry.delete(`image:${key}`);
      return;
    }

    if (editableType === 'container') {
      const key = element.dataset.adminKey;
      if (!key) return;
      await saveElementOverride(key, { hidden: true, deleted: true });
      element.remove();
      state.registry.delete(`container:${key}`);
      return;
    }

    throw new Error('Delete is not supported for this element type.');
  }

  function showElementToolbarFor(element, clientX, clientY) {
    if (!state.editMode || !element) return;
    const toolbar = ensureElementToolbar();
    state.selectedEditableElement = element;

    const type = element.dataset.adminEditable || '';
    const isSectionField = Boolean(element.dataset.adminSectionField);
    const duplicateAllowed = !isSectionField && (type === 'text' || type === 'image');
    const deleteAllowed = type !== 'album-root' && !(isSectionField && type === 'text');
    const parentAllowed = Boolean(getParentEditableElement(element));

    const parentButton = toolbar.querySelector('button[data-action="parent"]');
    const duplicateButton = toolbar.querySelector('button[data-action="duplicate"]');
    const deleteButton = toolbar.querySelector('button[data-action="delete"]');
    if (parentButton) parentButton.disabled = !parentAllowed;
    if (duplicateButton) duplicateButton.disabled = !duplicateAllowed;
    if (deleteButton) deleteButton.disabled = !deleteAllowed;

    toolbar.style.display = 'inline-flex';
    const x = Number.isFinite(clientX) ? clientX : 0;
    const y = Number.isFinite(clientY) ? clientY : 0;
    toolbar.style.left = `${Math.max(8, x + 10)}px`;
    toolbar.style.top = `${Math.max(8, y + 10)}px`;

    const rect = toolbar.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) {
      toolbar.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`;
    }
    if (rect.bottom > window.innerHeight - 8) {
      toolbar.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`;
    }
  }

  function openSectionTextEditor(element) {
    const sectionId = Number.parseInt(element.dataset.adminSectionId, 10);
    const field = element.dataset.adminSectionField;
    const label = field === 'title' ? 'Edit section title' : 'Edit section body';
    const initialValue = element.dataset.adminSectionEmpty === 'true' ? '' : element.textContent.trim();
    openTextModal(
      initialValue,
      label,
      'Update this custom section and save it for the page.',
      {
        formatting: {
          textAlign: '',
          fontFamily: '',
          fontWeight: '',
          fontStyle: '',
          textTransform: '',
          fontSize: '',
          opacityValue: '',
          textColor: '',
          backgroundColor: '',
          backgroundOpacityValue: '',
          widthValue: '',
          heightValue: '',
          borderStyle: '',
          borderWidth: '',
          borderColor: '',
          borderRadius: '',
        },
        allowHide: false,
        allowPosition: false,
        onSave: async (nextValue) => {
          const item = await updatePageSection(sectionId, field, nextValue);
          upsertPageSection(item);
          renderPageSections();
          registerSectionEditing();
        },
      }
    );
  }

  async function uploadAdminImage(file, target) {
    const form = new FormData();
    form.append('image', file);
    form.append('target', target || '');

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
    return uploadData.path;
  }

  function ensureImageEditorModal() {
    let modal = document.getElementById('admin-image-editor-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'admin-image-editor-modal';
    modal.className = 'admin-editor-backdrop';
    modal.innerHTML = `
      <div class="admin-editor-modal" role="dialog" aria-modal="true" aria-labelledby="admin-image-editor-title">
        <h2 id="admin-image-editor-title">Edit image</h2>
        <p id="admin-image-editor-copy">Upload a new image, select one from the library, and adjust border/corners.</p>
        <div class="admin-format-grid" style="grid-template-columns: 1fr 1fr;">
          <label>Select existing image
            <select id="admin-image-library-select"></select>
          </label>
          <label>Border Style
            <select id="admin-image-border-style">
              <option value="">Default</option>
              <option value="none">None</option>
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
              <option value="double">Double</option>
            </select>
          </label>
          <label>Border Width
            <input id="admin-image-border-width" type="text" placeholder="1px, 0" />
          </label>
          <label>Border Color
            <div class="admin-color-row">
              <input id="admin-image-border-color" type="color" value="#ffffff" />
              <button type="button" class="admin-color-reset" id="admin-image-border-color-reset">Default</button>
            </div>
          </label>
          <label>Corner Radius
            <input id="admin-image-border-radius" type="text" placeholder="0, 8px, 50%" />
          </label>
          <label>Opacity
            <input id="admin-image-opacity" type="text" placeholder="1, 0.85, 0.5" />
          </label>
          <label id="admin-image-bg-color-wrap" style="display:none;">Background Color
            <div class="admin-color-row">
              <input id="admin-image-bg-color" type="color" value="#ffffff" />
              <button type="button" class="admin-color-reset" id="admin-image-bg-color-reset">Default</button>
            </div>
          </label>
          <label id="admin-image-bg-opacity-wrap" style="display:none;">Background Opacity
            <input id="admin-image-bg-opacity" type="text" placeholder="1, 0.85, 0.5" />
          </label>
        </div>
        <div class="admin-editor-actions">
          <button type="button" class="button secondary" data-action="save-image-style">Save Style</button>
          <button type="button" class="button secondary" data-action="refresh-images">Refresh</button>
          <button type="button" class="button secondary" data-action="choose-image">Use Selected</button>
          <button type="button" class="button secondary" data-action="upload-image">Upload New</button>
          <button type="button" class="button secondary" data-action="remove-image" style="color: #ff6b6b;">Remove Image</button>
          <button type="button" class="button secondary" data-action="cancel">Cancel</button>
        </div>
      </div>
    `;

    modal.addEventListener('click', (event) => {
      if (event.target === modal || event.target.dataset.action === 'cancel') {
        modal.style.display = 'none';
      }
    });

    document.body.appendChild(modal);
    return modal;
  }

  async function openImageEditor(element, onUploaded, options) {
    const imageOptions = options || {};
    const modal = ensureImageEditorModal();
    const modalTitle = modal.querySelector('#admin-image-editor-title');
    const modalCopy = modal.querySelector('#admin-image-editor-copy');
    const select = modal.querySelector('#admin-image-library-select');
    const saveStyleButton = modal.querySelector('[data-action="save-image-style"]');
    const refreshButton = modal.querySelector('[data-action="refresh-images"]');
    const chooseButton = modal.querySelector('[data-action="choose-image"]');
    const uploadButton = modal.querySelector('[data-action="upload-image"]');
    const removeButton = modal.querySelector('[data-action="remove-image"]');
    const borderStyleSelect = modal.querySelector('#admin-image-border-style');
    const borderWidthInput = modal.querySelector('#admin-image-border-width');
    const borderColorInput = modal.querySelector('#admin-image-border-color');
    const borderColorReset = modal.querySelector('#admin-image-border-color-reset');
    const borderRadiusInput = modal.querySelector('#admin-image-border-radius');
    const opacityInput = modal.querySelector('#admin-image-opacity');
    const bgColorWrap = modal.querySelector('#admin-image-bg-color-wrap');
    const bgColorInput = modal.querySelector('#admin-image-bg-color');
    const bgColorReset = modal.querySelector('#admin-image-bg-color-reset');
    const bgOpacityWrap = modal.querySelector('#admin-image-bg-opacity-wrap');
    const bgOpacityInput = modal.querySelector('#admin-image-bg-opacity');
    const key = element.dataset.adminKey;
    const override = (key && state.elementOverrides.get(key)) || {};
    const currentPath = (element.dataset.adminImagePath || element.getAttribute('src') || '').split('?')[0];
    const allowBackgroundColor = Boolean(imageOptions.allowBackgroundColor && key);

    const existingBorderColor = normalizeColorValue(override.border_color || '');
    const existingBgColor = normalizeColorValue(override.background_color || '');
    borderStyleSelect.value = override.border_style || '';
    borderWidthInput.value = override.border_width || '';
    borderRadiusInput.value = override.border_radius || '';
    opacityInput.value = override.opacity_value || '';
    borderColorInput.value = existingBorderColor || '#ffffff';
    borderColorInput.dataset.custom = existingBorderColor ? 'true' : 'false';
    bgColorInput.value = existingBgColor || '#ffffff';
    bgColorInput.dataset.custom = existingBgColor ? 'true' : 'false';
    bgColorWrap.style.display = allowBackgroundColor ? '' : 'none';
    bgOpacityInput.value = override.background_opacity_value || '';
    bgOpacityWrap.style.display = allowBackgroundColor ? '' : 'none';

    if (modalTitle) {
      modalTitle.textContent = allowBackgroundColor ? 'Edit background' : 'Edit image';
    }
    if (modalCopy) {
      modalCopy.textContent = allowBackgroundColor
        ? 'Choose a background image, set a background color, and adjust style.'
        : 'Upload a new image, select one from the library, and adjust border/corners.';
    }

    borderColorReset.onclick = () => {
      borderColorInput.dataset.custom = 'false';
    };

    borderColorInput.oninput = () => {
      borderColorInput.dataset.custom = 'true';
    };

    bgColorReset.onclick = () => {
      bgColorInput.dataset.custom = 'false';
    };

    bgColorInput.oninput = () => {
      bgColorInput.dataset.custom = 'true';
    };

    removeButton.style.display = imageOptions.onRemove ? 'inline-flex' : 'none';

    async function loadOptions() {
      select.innerHTML = '<option value="">Loading images...</option>';
      try {
        const items = await fetchAdminImageLibrary();
        select.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Select an image';
        select.appendChild(placeholder);

        items.forEach((pathValue) => {
          const option = document.createElement('option');
          option.value = pathValue;
          option.textContent = pathValue;
          select.appendChild(option);
        });

        if (currentPath) {
          select.value = currentPath;
        }
      } catch (error) {
        select.innerHTML = '<option value="">Unable to load images</option>';
        alert(error.message);
      }
    }

    modal.style.display = 'flex';
    await loadOptions();

    refreshButton.onclick = () => {
      loadOptions().catch((error) => alert(error.message));
    };

    saveStyleButton.onclick = async () => {
      if (!key) {
        alert('This image does not support style overrides yet.');
        return;
      }

      saveStyleButton.disabled = true;
      try {
        const stylePatch = {
          hidden: false,
          borderStyle: borderStyleSelect.value,
          borderWidth: borderWidthInput.value.trim(),
          borderColor: borderColorInput.dataset.custom === 'true' ? borderColorInput.value : '',
          borderRadius: borderRadiusInput.value.trim(),
          opacityValue: opacityInput.value.trim(),
        };

        if (allowBackgroundColor) {
          stylePatch.backgroundColor = bgColorInput.dataset.custom === 'true' ? bgColorInput.value : '';
          stylePatch.backgroundOpacityValue = bgOpacityInput.value.trim();
        }

        const item = await saveElementOverride(key, stylePatch);
        applyElementStyles(element, item);
      } catch (error) {
        alert(error.message);
      } finally {
        saveStyleButton.disabled = false;
      }
    };

    chooseButton.onclick = async () => {
      const selectedPath = select.value.trim();
      if (!selectedPath) {
        alert('Choose an image from the list.');
        return;
      }

      chooseButton.disabled = true;
      element.style.opacity = '0.6';
      try {
        await onUploaded(selectedPath);
        modal.style.display = 'none';
      } catch (error) {
        alert(error.message);
      } finally {
        chooseButton.disabled = false;
        element.style.opacity = '';
      }
    };

    uploadButton.onclick = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return;

        uploadButton.disabled = true;
        element.style.opacity = '0.6';
        try {
          const uploadedPath = await uploadAdminImage(file, currentPath);
          await onUploaded(uploadedPath);
          modal.style.display = 'none';
        } catch (error) {
          alert(error.message);
        } finally {
          uploadButton.disabled = false;
          element.style.opacity = '';
        }
      };

      input.click();
    };

    removeButton.onclick = async () => {
      if (!imageOptions.onRemove) return;
      if (!confirm('Remove this image?')) return;

      removeButton.disabled = true;
      element.style.opacity = '0.6';
      try {
        await imageOptions.onRemove();
        modal.style.display = 'none';
      } catch (error) {
        alert(error.message);
      } finally {
        removeButton.disabled = false;
        element.style.opacity = '';
      }
    };
  }

  function openStaticImageEditor(element) {
    openImageEditor(element, async (nextPath) => {
      const contentKey = element.dataset.adminKey || buildContentKey(element, 'image');
      if (!contentKey) {
        throw new Error('Unable to update image for this section');
      }
      element.dataset.adminKey = contentKey;
      const item = await saveContentUpdate({
        contentKey,
        contentType: 'image',
        contentValue: nextPath,
      });
      applyContentItem(item);
    }, {
      allowBackgroundColor: element.dataset.adminEditable === 'background-image',
      onRemove: async () => {
        const key = element.dataset.adminKey || buildContentKey(element, 'image');
        if (!key) return;
        element.dataset.adminKey = key;

        if (element.dataset.adminEditable === 'background-image') {
          const item = await saveContentUpdate({
            contentKey: key,
            contentType: 'image',
            contentValue: '',
          });
          applyContentItem(item);
          return;
        }

        if (isDynamicContentKey(key)) {
          try {
            await deleteContentItem(key, 'image');
          } catch (error) {
            const message = String(error && error.message ? error.message : '').toLowerCase();
            if (!message.includes('not found')) {
              throw error;
            }
          }

          element.remove();
          state.registry.delete(`image:${key}`);
          return;
        }

        await saveElementOverride(key, { hidden: true, deleted: true });
        element.remove();
        state.registry.delete(`image:${key}`);
      },
    });
  }

  function openSectionImageEditor(element) {
    const sectionId = Number.parseInt(element.dataset.adminSectionId, 10);
    const field = element.dataset.adminSectionField;
    openImageEditor(element, async (nextPath) => {
      const item = await updatePageSection(sectionId, field, nextPath);
      upsertPageSection(item);
      renderPageSections();
    }, {
      onRemove: ['background_path', 'image_path'].includes(field)
        ? async () => {
          const item = await updatePageSection(sectionId, field, '');
          upsertPageSection(item);
          renderPageSections();
          registerSectionEditing();
        }
        : null,
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

    const contentKey = section.dataset.adminKey || buildContentKey(section, 'image');
    if (!contentKey) return;
    section.dataset.adminKey = contentKey;
    const item = await saveContentUpdate({
      contentKey,
      contentType: 'image',
      contentValue: '',
    });
    applyContentItem(item);
  }

  async function openSectionSizeEditor(section) {
    const key = getSectionResizeKey(section);
    if (!key) return;

    const override = state.elementOverrides.get(key) || {};
    const currentHeight = override.height_value || '';
    const nextHeight = window.prompt(
      'Section height (examples: 420px, 60vh). Leave blank to reset:',
      currentHeight
    );

    if (nextHeight === null) return;

    const item = await saveElementOverride(key, {
      hidden: false,
      heightValue: nextHeight.trim(),
    });
    state.elementOverrides.set(key, item);
    applySectionSizeOverrides();
  }

  async function openAddSectionModal(options) {
    const addOptions = options || {};
    try {
      const item = await createPageSection({ title: '', body: '' });
      upsertPageSection(item);

      const relativeSectionId = Number.parseInt(addOptions.relativeSectionId, 10);
      const relativeStaticSectionKey = typeof addOptions.relativeStaticSectionKey === 'string'
        ? addOptions.relativeStaticSectionKey
        : '';
      const insertPosition = addOptions.insertPosition === 'before' ? 'before' : 'after';
      if (Number.isInteger(relativeSectionId)) {
        const targetIndex = state.pageSections.findIndex((section) => section.id === relativeSectionId);
        const newIndex = state.pageSections.findIndex((section) => section.id === item.id);
        if (targetIndex >= 0 && newIndex >= 0) {
          const [newSection] = state.pageSections.splice(newIndex, 1);
          const rawInsertIndex = insertPosition === 'before' ? targetIndex : targetIndex + 1;
          const insertIndex = Math.max(0, Math.min(rawInsertIndex, state.pageSections.length));
          state.pageSections.splice(insertIndex, 0, newSection);
          state.pageSections.forEach((entry, index) => {
            entry.position = index + 1;
          });
          await persistDynamicSectionOrder();
        }
      } else if (relativeStaticSectionKey) {
        placeDynamicSectionsHostRelative(relativeStaticSectionKey, insertPosition);

        const newIndex = state.pageSections.findIndex((section) => section.id === item.id);
        if (newIndex >= 0) {
          const [newSection] = state.pageSections.splice(newIndex, 1);
          if (insertPosition === 'before') {
            state.pageSections.push(newSection);
          } else {
            state.pageSections.unshift(newSection);
          }
          state.pageSections.forEach((entry, index) => {
            entry.position = index + 1;
          });
          await persistDynamicSectionOrder();
        }
      }

      renderPageSections();
      registerSectionEditing();
    } catch (error) {
      alert(error.message);
    }
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
    const nextDeleted = !Boolean(override.deleted);
    await saveElementOverride(key, { hidden: nextDeleted, deleted: nextDeleted });
    setAdminHiddenState(section, nextDeleted, nextDeleted);
    ensureSectionTools(section, 'static');
  }

  async function persistStaticSectionOrder() {
    const sections = getStaticSectionToolTargets();
    await Promise.all(
      sections.map((section, index) => saveElementOverride(section.dataset.adminStaticSectionKey, { position: index + 1, hidden: false }))
    );
  }

  async function persistDynamicSectionOrder() {
    await reorderDynamicSections(state.pageSections.map((section) => section.id));
  }

  function getDynamicBoundarySectionId(position) {
    if (!Array.isArray(state.pageSections) || state.pageSections.length === 0) return null;
    if (position === 'first') {
      return state.pageSections[0].id;
    }
    return state.pageSections[state.pageSections.length - 1].id;
  }

  function moveSectionByDelta(section, kind, delta) {
    if (!section || !Number.isInteger(delta) || delta === 0) return;

    if (kind === 'static') {
      const parent = section.parentElement;
      const sections = parent
        ? Array.from(parent.children).filter((element) => element.tagName === 'SECTION' && !element.dataset.adminDynamicSection)
        : [];
      const index = sections.indexOf(section);
      const nextIndex = index + delta;
      if (index < 0 || nextIndex < 0 || nextIndex >= sections.length) return;

      const main = section.parentNode;
      const target = sections[nextIndex];
      if (!main || !target) return;

      if (delta < 0) {
        main.insertBefore(section, target);
      } else {
        main.insertBefore(target, section);
      }

      persistStaticSectionOrderForParent(main).catch((error) => alert(error.message));
      return;
    }

    if (kind === 'dynamic') {
      const sectionId = Number.parseInt(section.dataset.adminSectionId, 10);
      const index = state.pageSections.findIndex((item) => item.id === sectionId);
      const nextIndex = index + delta;
      if (index < 0 || nextIndex < 0 || nextIndex >= state.pageSections.length) return;

      const [moved] = state.pageSections.splice(index, 1);
      state.pageSections.splice(nextIndex, 0, moved);
      state.pageSections.forEach((item, positionIndex) => {
        item.position = positionIndex + 1;
      });

      renderPageSections();
      registerSectionEditing();
      persistDynamicSectionOrder().catch((error) => alert(error.message));
    }
  }

  function isDynamicTextElement(element) {
    if (!element) return false;
    if (element.dataset.adminEditable !== 'text') return false;
    const key = element.dataset.adminKey || '';
    return key.includes('>dynamic-text-') && key.endsWith('|text');
  }

  function getSectionParentKey(section) {
    if (!section) return '';
    if (section.dataset.adminDynamicSection === 'true') {
      const sectionId = Number.parseInt(section.dataset.adminSectionId || '', 10);
      return Number.isInteger(sectionId) ? `section#${sectionId}` : '';
    }
    return section.dataset.adminStaticSectionKey || '';
  }

  function getHostSectionForElement(element) {
    if (!element) return null;
    return element.closest('section[data-admin-section-type="static"], section[data-admin-dynamic-section="true"]');
  }

  function getSectionContentHost(section) {
    if (!section) return null;
    if (section.dataset.adminDynamicSection === 'true') {
      return section.querySelector(':scope > .container > .dynamic-page-section-content-host')
        || section.querySelector(':scope > .container')
        || section;
    }
    return section;
  }

  function clearTextDragTargets() {
    document.querySelectorAll('[data-admin-text-drop-target="true"]').forEach((element) => {
      element.removeAttribute('data-admin-text-drop-target');
    });
  }

  function setTextElementDraggableState(element) {
    if (!element) return;
    element.draggable = state.editMode && isDynamicTextElement(element);
  }

  function registerTextDrag(element) {
    if (!isDynamicTextElement(element)) {
      if (element) {
        element.draggable = false;
      }
      return;
    }

    setTextElementDraggableState(element);
    if (element.dataset.adminTextDragBound === 'true') return;
    element.dataset.adminTextDragBound = 'true';

    element.addEventListener('dragstart', (event) => {
      if (!state.editMode) {
        event.preventDefault();
        return;
      }

      state.draggedTextElement = element;
      element.classList.add('admin-is-dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', element.dataset.adminKey || '');
      }
      event.stopPropagation();
    });

    element.addEventListener('dragend', () => {
      if (state.draggedTextElement === element) {
        state.draggedTextElement = null;
      }
      element.classList.remove('admin-is-dragging');
      clearTextDragTargets();
    });
  }

  async function moveDraggedTextToSection(targetSection) {
    const dragged = state.draggedTextElement;
    if (!dragged || !targetSection) return;

    const sourceSection = getHostSectionForElement(dragged);
    if (!sourceSection || sourceSection === targetSection) return;

    const oldKey = dragged.dataset.adminKey;
    const nextParentKey = getSectionParentKey(targetSection);
    if (!oldKey || !nextParentKey) return;

    const nextItem = await moveContentBlock(oldKey, nextParentKey, 'text');

    state.registry.delete(`text:${oldKey}`);
    dragged.dataset.adminKey = nextItem.content_key;
    state.registry.set(`text:${nextItem.content_key}`, dragged);

    const targetHost = getSectionContentHost(targetSection) || targetSection;
    targetHost.appendChild(dragged);

    try {
      const item = await saveElementOverride(nextItem.content_key, {
        hidden: false,
        positionMode: 'flow',
      });
      applyElementStyles(dragged, item);
      dragged.classList.remove('admin-free-positioned');
    } catch (_error) {
      // Keep move successful even when override reset fails.
    }

    state.draggedTextElement = null;
    clearTextDragTargets();
  }

  function moveDraggedSection(targetSection, dropPosition) {
    if (!state.draggedSection || !targetSection) return;
    const position = dropPosition === 'after' ? 'after' : 'before';

    const dragged = state.draggedSection;
    if (dragged.kind === 'static') {
      const draggedElement = document.querySelector(`[data-admin-static-section-key="${dragged.key}"]`);
      if (!draggedElement || draggedElement === targetSection) return;

      if (position === 'after') {
        targetSection.parentNode.insertBefore(draggedElement, targetSection.nextElementSibling);
      } else {
        targetSection.parentNode.insertBefore(draggedElement, targetSection);
      }

      persistStaticSectionOrderForParent(targetSection.parentNode).catch((error) => alert(error.message));
      return;
    }

    if (dragged.kind === 'dynamic') {
      const targetId = Number.parseInt(targetSection.dataset.adminSectionId, 10);
      const draggedIndex = state.pageSections.findIndex((section) => section.id === dragged.id);
      const targetIndex = state.pageSections.findIndex((section) => section.id === targetId);
      if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) return;

      let insertIndex = position === 'after' ? targetIndex + 1 : targetIndex;
      if (draggedIndex < insertIndex) insertIndex -= 1;

      const [section] = state.pageSections.splice(draggedIndex, 1);
      state.pageSections.splice(insertIndex, 0, section);
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
    const positionToggleButton = modal.querySelector('[data-action="position-toggle"]');
    const positionResetButton = modal.querySelector('[data-action="position-reset"]');

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
    if (positionToggleButton) {
      positionToggleButton.style.display = 'none';
      positionToggleButton.onclick = null;
    }
    if (positionResetButton) {
      positionResetButton.style.display = 'none';
      positionResetButton.onclick = null;
    }

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
          const sectionHost = getSectionContentHost(section) || section;
          sectionHost.appendChild(newElement);

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
          const sectionHost = getSectionContentHost(section) || section;
          sectionHost.appendChild(newImage);

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
    section.draggable = state.editMode;
    if (section.dataset.adminDragBound === kind) return;
    section.dataset.adminDragBound = kind;
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
      if (state.editMode && state.draggedTextElement) {
        event.preventDefault();
        section.dataset.adminTextDropTarget = 'true';
        return;
      }

      if (!state.editMode || !state.draggedSection || state.draggedSection.kind !== kind) return;
      event.preventDefault();
      section.dataset.adminDragTarget = 'true';
      const rect = section.getBoundingClientRect();
      const midpoint = rect.top + (rect.height / 2);
      section.dataset.adminDragPosition = event.clientY > midpoint ? 'after' : 'before';
    });
    section.addEventListener('dragleave', () => {
      section.removeAttribute('data-admin-drag-target');
      section.removeAttribute('data-admin-drag-position');
      section.removeAttribute('data-admin-text-drop-target');
    });
    section.addEventListener('drop', async (event) => {
      if (state.editMode && state.draggedTextElement) {
        event.preventDefault();
        section.removeAttribute('data-admin-text-drop-target');
        try {
          await moveDraggedTextToSection(section);
        } catch (error) {
          alert(error.message);
        }
        return;
      }

      if (!state.editMode || !state.draggedSection || state.draggedSection.kind !== kind) return;
      event.preventDefault();
      const dropPosition = section.dataset.adminDragPosition || 'before';
      section.removeAttribute('data-admin-drag-target');
      section.removeAttribute('data-admin-drag-position');
      moveDraggedSection(section, dropPosition);
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

      const moveUpButton = document.createElement('button');
      moveUpButton.type = 'button';
      moveUpButton.className = 'admin-section-tool admin-section-move-up-button';
      moveUpButton.textContent = 'Up';
      moveUpButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        moveSectionByDelta(section, kind, -1);
      });

      const moveDownButton = document.createElement('button');
      moveDownButton.type = 'button';
      moveDownButton.className = 'admin-section-tool admin-section-move-down-button';
      moveDownButton.textContent = 'Down';
      moveDownButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        moveSectionByDelta(section, kind, 1);
      });

      const addBeforeButton = document.createElement('button');
      addBeforeButton.type = 'button';
      addBeforeButton.className = 'admin-section-tool admin-section-add-before-button';
      addBeforeButton.textContent = 'Add Before';
      addBeforeButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (kind !== 'dynamic') {
          openAddSectionModal({
            relativeStaticSectionKey: section.dataset.adminStaticSectionKey,
            insertPosition: 'before',
          });
          return;
        }
        openAddSectionModal({
          relativeSectionId: Number.parseInt(section.dataset.adminSectionId, 10),
          insertPosition: 'before',
        });
      });

      const addAfterButton = document.createElement('button');
      addAfterButton.type = 'button';
      addAfterButton.className = 'admin-section-tool admin-section-add-after-button';
      addAfterButton.textContent = 'Add After';
      addAfterButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (kind !== 'dynamic') {
          openAddSectionModal({
            relativeStaticSectionKey: section.dataset.adminStaticSectionKey,
            insertPosition: 'after',
          });
          return;
        }
        openAddSectionModal({
          relativeSectionId: Number.parseInt(section.dataset.adminSectionId, 10),
          insertPosition: 'after',
        });
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

        const sizeButton = document.createElement('button');
        sizeButton.type = 'button';
        sizeButton.className = 'admin-section-tool admin-section-size-button';
        sizeButton.textContent = 'Size';
        sizeButton.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          openSectionSizeEditor(section).catch((error) => alert(error.message));
        });
        tools.appendChild(sizeButton);
      }

      tools.appendChild(addTextButton);
      tools.appendChild(addImageButton);
      tools.appendChild(addBeforeButton);
      tools.appendChild(addAfterButton);
      tools.appendChild(moveUpButton);
      tools.appendChild(moveDownButton);
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
        : 'Delete';
    }
  }

  function registerSectionEditing() {
    getStaticSectionToolTargets().forEach((section, index) => {
      ensureStaticSectionKey(section, index);
      ensureSectionTools(section, 'static');
      registerSectionDrag(section, 'static');
    });

    document.querySelectorAll('[data-admin-dynamic-section="true"]').forEach((section) => {
      ensureSectionTools(section, 'dynamic');
      registerSectionDrag(section, 'dynamic');
    });

    document.querySelectorAll('[data-admin-editable="text"]').forEach((element) => {
      registerTextDrag(element);
    });
  }

  function findFreeDragTarget(source) {
    if (!source || !state.editMode) return null;
    if (isInsideAdminUi(source)) return null;
    const candidate = source.closest('[data-admin-editable="text"], [data-admin-editable="image"], [data-admin-editable="background-image"], [data-admin-editable="container"], [data-admin-editable="album-root"]');
    if (!candidate) return null;
    if (!candidate.dataset.adminKey) return null;
    if (isInsideAdminUi(candidate)) return null;
    return candidate;
  }

  function getResizeEdges(target, event) {
    if (!target || !event) return null;

    const rect = target.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;

    const nearLeft = event.clientX - rect.left <= resizeEdgeThreshold;
    const nearRight = rect.right - event.clientX <= resizeEdgeThreshold;
    const nearTop = event.clientY - rect.top <= resizeEdgeThreshold;
    const nearBottom = rect.bottom - event.clientY <= resizeEdgeThreshold;

    const horizontal = nearLeft ? 'w' : (nearRight ? 'e' : '');
    const vertical = nearTop ? 'n' : (nearBottom ? 's' : '');
    const edges = `${vertical}${horizontal}`;
    return edges || null;
  }

  function getCursorForEdges(edges) {
    switch (edges) {
      case 'n': return 'n-resize';
      case 's': return 's-resize';
      case 'e': return 'e-resize';
      case 'w': return 'w-resize';
      case 'ne': return 'ne-resize';
      case 'nw': return 'nw-resize';
      case 'se': return 'se-resize';
      case 'sw': return 'sw-resize';
      default: return 'move';
    }
  }

  function clearFreeDragCursors() {
    document.body.style.cursor = '';
    document.querySelectorAll('[data-admin-editable="text"], [data-admin-editable="image"], [data-admin-editable="background-image"], [data-admin-editable="container"], [data-admin-editable="album-root"]').forEach((element) => {
      element.style.cursor = '';
    });
  }

  function ensureAbsoluteForFreeDrag(target, override) {
    if (!target) return;

    if (target.offsetParent && window.getComputedStyle(target.offsetParent).position === 'static') {
      target.offsetParent.style.position = 'relative';
    }

    if (override.position_mode !== 'absolute') {
      if (target.dataset.adminEditable === 'album-root') {
        ensureAlbumRootPlaceholder(target);
      }
      target.style.position = 'absolute';
      target.style.left = `${target.offsetLeft}px`;
      target.style.top = `${target.offsetTop}px`;
      target.style.zIndex = target.dataset.adminEditable === 'text' ? '12' : '8';
      target.classList.add('admin-free-positioned');
    }
  }

  function beginFreeDrag(target, event) {
    const key = target.dataset.adminKey;
    if (!key) return;

    const override = state.elementOverrides.get(key) || {};
    ensureAbsoluteForFreeDrag(target, override);

    const resizeEdges = getResizeEdges(target, event);
    const isResizeAction = Boolean(resizeEdges);
    const activeCursor = isResizeAction ? getCursorForEdges(resizeEdges) : 'move';

    const startLeft = Number.parseFloat(target.style.left || `${target.offsetLeft}`) || 0;
    const startTop = Number.parseFloat(target.style.top || `${target.offsetTop}`) || 0;
    const startWidth = Math.max(minResizableWidth, target.offsetWidth);
    const startHeight = Math.max(minResizableHeight, target.offsetHeight);
    let didMove = false;

    state.draggingElement = target;
    state.dragStartX = event.clientX;
    state.dragStartY = event.clientY;
    state.dragOriginX = startLeft;
    state.dragOriginY = startTop;
    target.classList.add('admin-is-dragging');
    document.body.style.cursor = activeCursor;

    const onMove = (moveEvent) => {
      if (!state.draggingElement) return;
      const parent = state.draggingElement.offsetParent || state.draggingElement.parentElement;
      const dx = moveEvent.clientX - state.dragStartX;
      const dy = moveEvent.clientY - state.dragStartY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        didMove = true;
      }
      let nextX = state.dragOriginX;
      let nextY = state.dragOriginY;
      let nextWidth = startWidth;
      let nextHeight = startHeight;

      if (!isResizeAction) {
        const rawX = state.dragOriginX + dx;
        const rawY = state.dragOriginY + dy;
        nextX = rawX;
        nextY = rawY;
        if (parent) {
          const parentWidth = Math.max(parent.clientWidth, parent.scrollWidth);
          const parentHeight = Math.max(parent.clientHeight, parent.scrollHeight);
          const maxX = Math.max(0, parentWidth - state.draggingElement.offsetWidth);
          const maxY = Math.max(0, parentHeight - state.draggingElement.offsetHeight);
          nextX = Math.max(0, Math.min(maxX, rawX));
          nextY = Math.max(0, Math.min(maxY, rawY));
        }
      } else {
        if (resizeEdges.includes('e')) nextWidth = startWidth + dx;
        if (resizeEdges.includes('s')) nextHeight = startHeight + dy;
        if (resizeEdges.includes('w')) {
          nextWidth = startWidth - dx;
          nextX = state.dragOriginX + dx;
        }
        if (resizeEdges.includes('n')) {
          nextHeight = startHeight - dy;
          nextY = state.dragOriginY + dy;
        }

        nextWidth = Math.max(minResizableWidth, nextWidth);
        nextHeight = Math.max(minResizableHeight, nextHeight);

        if (resizeEdges.includes('w')) {
          nextX = state.dragOriginX + (startWidth - nextWidth);
        }
        if (resizeEdges.includes('n')) {
          nextY = state.dragOriginY + (startHeight - nextHeight);
        }

        if (parent) {
          const parentWidth = Math.max(parent.clientWidth, parent.scrollWidth);
          const parentHeight = Math.max(parent.clientHeight, parent.scrollHeight);

          if (nextX < 0) {
            const overflowX = 0 - nextX;
            nextX = 0;
            nextWidth = Math.max(minResizableWidth, nextWidth - overflowX);
          }
          if (nextY < 0) {
            const overflowY = 0 - nextY;
            nextY = 0;
            nextHeight = Math.max(minResizableHeight, nextHeight - overflowY);
          }

          const maxWidth = Math.max(minResizableWidth, parentWidth - nextX);
          const maxHeight = Math.max(minResizableHeight, parentHeight - nextY);
          nextWidth = Math.min(nextWidth, maxWidth);
          nextHeight = Math.min(nextHeight, maxHeight);
        }
      }

      state.draggingElement.style.left = `${Math.round(nextX)}px`;
      state.draggingElement.style.top = `${Math.round(nextY)}px`;
      if (isResizeAction) {
        state.draggingElement.style.width = `${Math.round(nextWidth)}px`;
        state.draggingElement.style.height = `${Math.round(nextHeight)}px`;
      }
    };

    const onUp = async () => {
      window.removeEventListener('pointermove', onMove);
      const dragged = state.draggingElement;
      state.draggingElement = null;
      if (!dragged) return;

      dragged.classList.remove('admin-is-dragging');
      document.body.style.cursor = '';
      if (didMove || isResizeAction) {
        state.suppressEditClickUntil = Date.now() + 250;
      }
      const posX = Number.parseInt(dragged.style.left || '0', 10) || 0;
      const posY = Number.parseInt(dragged.style.top || '0', 10) || 0;

      try {
        const patch = {
          hidden: false,
          positionMode: 'absolute',
          posX,
          posY,
        };
        if (isResizeAction) {
          patch.widthValue = `${Math.max(minResizableWidth, Math.round(dragged.offsetWidth))}px`;
          patch.heightValue = `${Math.max(minResizableHeight, Math.round(dragged.offsetHeight))}px`;
        }

        const item = await saveElementOverride(key, patch);
        applyElementStyles(dragged, item);
      } catch (error) {
        alert(error.message);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }

  function bindFreeDragHandlers() {
    if (state.freeDragHandlersBound) return;
    state.freeDragHandlersBound = true;

    document.addEventListener('pointermove', (event) => {
      if (!state.editMode || state.draggingElement) return;

      const target = findFreeDragTarget(event.target);
      if (!target) {
        document.body.style.cursor = '';
        return;
      }

      const edges = getResizeEdges(target, event);
      const cursor = getCursorForEdges(edges || '');
      target.style.cursor = cursor;
      document.body.style.cursor = cursor;
    }, true);

    document.addEventListener('pointerdown', (event) => {
      if (!state.editMode) return;
      if (event.button !== 0) return;

      const target = findFreeDragTarget(event.target);
      if (!target) return;

      event.preventDefault();
      event.stopPropagation();
      beginFreeDrag(target, event);
    }, true);
  }

  function setEditMode(nextValue) {
    state.editMode = nextValue;
    document.body.classList.toggle('admin-edit-mode', nextValue);
    document.body.classList.toggle('admin-free-drag-mode', nextValue);
    if (!nextValue) {
      clearFreeDragCursors();
      hideElementToolbar();
    }
    applyElementOverrides();
    registerSectionEditing();
    document.querySelectorAll('[data-admin-editable="text"]').forEach((element) => {
      setTextElementDraggableState(element);
    });
    renderMediaAlbums();
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

    bindFreeDragHandlers();
    ensureElementToolbar();

    window.addEventListener('resize', () => {
      hideElementToolbar();
    });
    window.addEventListener('scroll', () => {
      hideElementToolbar();
    }, true);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        hideElementToolbar();
      }
    });

    document.addEventListener('click', (event) => {
      if (!state.editMode) return;
      if (Date.now() < state.suppressEditClickUntil) return;
      if (event.target.closest('.admin-edit-nav-button, .admin-add-section-button, .admin-editor-modal, .admin-section-tools, .admin-element-toolbar')) return;

      const siteNavLink = event.target.closest('.site-nav a');
      if (siteNavLink) {
        event.preventDefault();
        event.stopPropagation();
        hideElementToolbar();
        return;
      }

      const calendarCell = event.target.closest('.event-calendar td[data-calendar-day]');
      if (calendarCell) {
        event.preventDefault();
        event.stopPropagation();
        hideElementToolbar();
        editCalendarCell(calendarCell).catch((error) => alert(error.message));
        return;
      }

      const removeButton = event.target.closest('[data-admin-remove-section]');
      if (removeButton) {
        event.preventDefault();
        event.stopPropagation();
        hideElementToolbar();
        removeSection(Number.parseInt(removeButton.dataset.adminRemoveSection, 10));
        return;
      }

      const editableTarget = event.target.closest('[data-admin-editable]');
      if (editableTarget) {
        event.preventDefault();
        event.stopPropagation();
        showElementToolbarFor(editableTarget, event.clientX, event.clientY);
        return;
      }

      hideElementToolbar();
    }, true);
  }

  async function initEditableContent() {
    initContactForm();
    bindAlbumUiEvents();

    if (!isPageEditable()) {
      initHeaderState();
      return;
    }

    initHeaderState();
    await loadMediaAlbums();
    await loadPageSections();
    registerEditableElements();
    await loadElementOverrides();
    await loadSavedContent();
    applyElementOverrides();
    initializeCalendarUi();
    await loadCalendarEvents();

    const profile = await fetchCurrentProfile();
    state.isAdmin = Boolean(profile && profile.role === 'admin');
    if (!state.isAdmin) return;
    renderMediaAlbums();

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
