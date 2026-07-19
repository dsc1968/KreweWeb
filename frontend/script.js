const countdownTarget = new Date('2027-03-01T12:00:00').getTime();

// ── Mobile hamburger nav ──────────────────────────────────────
(function () {
  const nav = document.querySelector('.site-nav');
  const headerInner = document.querySelector('.header-inner');
  if (!nav || !headerInner) return;

  const btn = document.createElement('button');
  btn.className = 'nav-toggle';
  btn.setAttribute('aria-label', 'Toggle navigation');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '&#9776;';
  headerInner.appendChild(btn);

  btn.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open');
    btn.setAttribute('aria-expanded', String(open));
    btn.innerHTML = open ? '&times;' : '&#9776;';
  });

  // Close nav when a link is clicked
  nav.addEventListener('click', (e) => {
    if (e.target.tagName === 'A') {
      nav.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
      btn.innerHTML = '&#9776;';
    }
  });
})();

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
  const staticSectionRootTags = new Set(['SECTION', 'DIV', 'ARTICLE', 'ASIDE']);
  const genericStyleIgnoreTags = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'BR', 'HR', 'SOURCE', 'TRACK', 'TEMPLATE']);
  const state = {
    pagePath: normalizePagePath(window.location.pathname),
    profilePromise: null,
    editMode: false,
    inspectorShownFor: null,
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
    editModeClassGuardAttached: false,
    draggingElement: null,
    dragStartX: 0,
    dragStartY: 0,
    dragOriginX: 0,
    dragOriginY: 0,
    suppressEditClickUntil: 0,
    elementToolbar: null,
    inspectorPanel: null,
    selectedEditableElement: null,
    editorSyncTimer: null,
    isSyncingEditorState: false,
    domObserver: null,
    draggedTextElement: null,
    isAdmin: false,
    albums: [],
    albumImagesById: new Map(),
    albumViewerModal: null,
    albumViewerImages: [],
    albumViewerIndex: -1,
    albumViewerTitle: '',
    albumUiBound: false,
    savePendingCount: 0,
    saveStatusNode: null,
    selectionHandlesOverlay: null,
    // Snapshot of the published page HTML captured the moment edit mode is
    // entered, so the admin can revert to the original if edits go wrong.
    pageBackup: null,
    revertButton: null,
  };
  const albumRootElementKey = 'media-albums-root|container';
  const nonEditablePagePaths = new Set(['/dashboard.html', '/user-management.html']);
  const resizeEdgeThreshold = 10;
  const minResizableWidth = 40;
  const minResizableHeight = 32;
  const gridSnapSize = 12;

  // Snap a value to the editing grid for predictable, controlled movement.
  function snapToGrid(value) {
    return Math.round(value / gridSnapSize) * gridSnapSize;
  }

  function isPageEditable() {
    return !nonEditablePagePaths.has(state.pagePath);
  }

  function getStoredToken() {
    return sessionStorage.getItem('krewe_token');
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

  function getDeletedImageCacheKey(contentKey) {
    return `adminDeletedImage:${state.pagePath}:${contentKey}`;
  }

  function persistDeletedImageCache(contentKey, deleted) {
    if (!contentKey) return;
    try {
      const cacheKey = getDeletedImageCacheKey(contentKey);
      if (deleted) {
        localStorage.setItem(cacheKey, '1');
      } else {
        localStorage.removeItem(cacheKey);
      }
    } catch (_error) {
      // Ignore localStorage failures in restricted browser contexts.
    }
  }

  function isDeletedImageCached(contentKey) {
    if (!contentKey) return false;
    try {
      return localStorage.getItem(getDeletedImageCacheKey(contentKey)) === '1';
    } catch (_error) {
      return false;
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

  function wait(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function ensureSaveStatusNode() {
    if (state.saveStatusNode && document.body.contains(state.saveStatusNode)) {
      return state.saveStatusNode;
    }

    const controls = document.getElementById('admin-nav-controls');
    if (!controls) return null;

    let status = controls.querySelector('.admin-save-status');
    if (!status) {
      status = document.createElement('span');
      status.className = 'admin-save-status';
      status.dataset.state = 'idle';
      status.textContent = 'Saved';
      controls.appendChild(status);
    }

    state.saveStatusNode = status;
    return status;
  }

  function updateSaveStatus(mode, message) {
    const node = ensureSaveStatusNode();
    if (!node) return;

    node.dataset.state = mode;
    if (message) {
      node.textContent = message;
      return;
    }

    if (mode === 'saving') {
      node.textContent = 'Saving...';
      return;
    }

    if (mode === 'error') {
      node.textContent = 'Save failed';
      return;
    }

    node.textContent = 'Saved';
  }

  function beginSaveAttempt() {
    state.savePendingCount += 1;
    updateSaveStatus('saving');
  }

  function finishSaveAttempt(success, errorMessage) {
    state.savePendingCount = Math.max(0, state.savePendingCount - 1);
    if (!success) {
      updateSaveStatus('error', errorMessage || 'Save failed');
      return;
    }

    if (state.savePendingCount === 0) {
      updateSaveStatus('idle', 'Saved');
    }
  }

  async function fetchWithRetry(url, requestOptions, retryOptions) {
    const maxRetries = Number.isInteger(retryOptions && retryOptions.maxRetries) ? retryOptions.maxRetries : 2;
    let attempt = 0;
    let lastNetworkError = null;

    while (attempt <= maxRetries) {
      try {
        const response = await fetch(url, requestOptions);
        if ([408, 425, 429, 500, 502, 503, 504].includes(response.status) && attempt < maxRetries) {
          const delayMs = (retryOptions && retryOptions.baseDelayMs ? retryOptions.baseDelayMs : 180) * (attempt + 1);
          await wait(delayMs);
          attempt += 1;
          continue;
        }

        const data = await parseApiResponse(response);
        return { response, data };
      } catch (error) {
        lastNetworkError = error;
        if (attempt >= maxRetries) break;
        const delayMs = (retryOptions && retryOptions.baseDelayMs ? retryOptions.baseDelayMs : 180) * (attempt + 1);
        await wait(delayMs);
        attempt += 1;
      }
    }

    throw new Error(`Network error while saving. ${lastNetworkError && lastNetworkError.message ? lastNetworkError.message : ''}`.trim());
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
    beginSaveAttempt();
    try {
      const item = {
        id: Date.now(),
        title: payload.title || '',
        body: payload.body || '',
        image_path: '',
        background_path: '',
        position: (state.pageSections.length || 0) + 1,
        updated_at: new Date().toISOString(),
      };
      savePageToFile();
      finishSaveAttempt(true);
      return item;
    } catch (error) {
      finishSaveAttempt(false, error.message);
      throw error;
    }
  }

  async function updatePageSection(sectionId, field, value) {
    beginSaveAttempt();
    try {
      const section = state.pageSections.find((s) => s.id === sectionId);
      if (section) {
        section[field] = value;
        section.updated_at = new Date().toISOString();
      }
      savePageToFile();
      finishSaveAttempt(true);
      return section ? { ...section } : { id: sectionId, [field]: value, updated_at: new Date().toISOString() };
    } catch (error) {
      finishSaveAttempt(false, error.message);
      throw error;
    }
  }

  async function deletePageSection(_sectionId) {
    beginSaveAttempt();
    try {
      savePageToFile();
      finishSaveAttempt(true);
      return {};
    } catch (error) {
      finishSaveAttempt(false, error.message);
      throw error;
    }
  }

  async function saveElementOverride(elementKey, patch) {
    beginSaveAttempt();
    try {
      const current = state.elementOverrides.get(elementKey) || {};
      const merged = {
        element_key: elementKey,
        hidden: patch.hidden ?? current.hidden ?? false,
        deleted: patch.deleted ?? current.deleted ?? false,
        text_align: patch.textAlign ?? current.text_align ?? null,
        font_family: patch.fontFamily ?? current.font_family ?? null,
        font_weight: patch.fontWeight ?? current.font_weight ?? null,
        font_style: patch.fontStyle ?? current.font_style ?? null,
        text_transform: patch.textTransform ?? current.text_transform ?? null,
        font_size: patch.fontSize ?? current.font_size ?? null,
        opacity_value: patch.opacityValue ?? current.opacity_value ?? null,
        text_color: patch.textColor ?? current.text_color ?? null,
        background_color: patch.backgroundColor ?? current.background_color ?? null,
        background_opacity_value: patch.backgroundOpacityValue ?? current.background_opacity_value ?? null,
        width_value: patch.widthValue ?? current.width_value ?? null,
        height_value: patch.heightValue ?? current.height_value ?? null,
        border_style: patch.borderStyle ?? current.border_style ?? null,
        border_width: patch.borderWidth ?? current.border_width ?? null,
        border_color: patch.borderColor ?? current.border_color ?? null,
        border_radius: patch.borderRadius ?? current.border_radius ?? null,
        position_mode: patch.positionMode ?? current.position_mode ?? null,
        pos_x: Number.isFinite(patch.posX) ? Math.round(patch.posX) : (Number.isFinite(current.pos_x) ? Math.round(current.pos_x) : null),
        pos_y: Number.isFinite(patch.posY) ? Math.round(patch.posY) : (Number.isFinite(current.pos_y) ? Math.round(current.pos_y) : null),
        position: Number.isInteger(patch.position) ? patch.position : (Number.isInteger(current.position) ? current.position : null),
      };
      state.elementOverrides.set(elementKey, merged);
      savePageToFile();
      finishSaveAttempt(true);
      return merged;
    } catch (error) {
      finishSaveAttempt(false, error.message);
      throw error;
    }
  }

  async function reorderDynamicSections(orderedIds) {
    beginSaveAttempt();
    try {
      if (Array.isArray(orderedIds)) {
        const ordered = orderedIds.map((id, index) => {
          const s = state.pageSections.find((item) => item.id === id);
          if (s) s.position = index + 1;
          return s;
        }).filter(Boolean);
        if (ordered.length) state.pageSections = ordered;
      }
      savePageToFile();
      finishSaveAttempt(true);
      return {};
    } catch (error) {
      finishSaveAttempt(false, error.message);
      throw error;
    }
  }

  async function moveContentBlock(oldContentKey, newParentKey, contentType) {
    beginSaveAttempt();
    try {
      const token = getStoredToken();
      const { response, data } = await fetchWithRetry('/api/admin/content/move', {
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
      if (!response.ok) {
        throw new Error(data.error || 'Unable to move content');
      }
      finishSaveAttempt(true);
      return data.item;
    } catch (error) {
      finishSaveAttempt(false, error.message);
      throw error;
    }
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
        sessionStorage.removeItem('krewe_token');
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
        sessionStorage.removeItem('krewe_token');
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
    return Boolean(element.closest('.admin-nav-controls, .admin-edit-nav-button, .admin-add-section-button, .admin-revert-button, .admin-save-status, .admin-editor-modal, .admin-editor-backdrop, .admin-code-editor-backdrop, .admin-section-tools, .admin-element-toolbar, .admin-inspector-panel, .admin-selection-handles-overlay'));
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
    // Always exclude header/nav from being registered as editable content —
    // even in edit mode.  Nav reordering uses its own drag system (bindNavReorderEvents).
    return Boolean(element.closest('.site-header, .site-nav, .nav-toggle'));
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

  function buildStableBackgroundImageKey(element) {
    if (!element) return '';
    const staticSection = element.closest('[data-admin-section-type="static"]');
    if (staticSection && staticSection.dataset.adminStaticSectionKey) {
      return `${staticSection.dataset.adminStaticSectionKey}|background-image`;
    }
    return buildContentKey(element, 'image');
  }

  function buildStableImageKey(element) {
    if (!element) return '';
    if (element.dataset && element.dataset.adminKey) return element.dataset.adminKey;

    const staticSection = element.closest('[data-admin-section-type="static"]');
    if (staticSection && staticSection.dataset.adminStaticSectionKey) {
      const staticImages = Array.from(staticSection.querySelectorAll('img')).filter((candidate) => {
        if (candidate.closest('[data-admin-dynamic-section="true"]')) return false;
        const candidateKey = candidate.dataset && candidate.dataset.adminKey;
        if (candidateKey && candidateKey.includes('dynamic-image-')) return false;
        return true;
      });
      const index = staticImages.indexOf(element);
      if (index >= 0) {
        return `${staticSection.dataset.adminStaticSectionKey}>static-image:${index + 1}|image`;
      }
    }

    return buildContentKey(element, 'image');
  }

  function getStaticSections() {
    const main = document.querySelector('main');
    if (!main) return [];
    return Array.from(main.children).filter((element) => {
      if (!staticSectionRootTags.has(element.tagName)) return false;
      if (element.id === 'dynamic-page-sections') return false;
      if (element.dataset.adminDynamicSection === 'true') return false;
      return true;
    });
  }

  function getStaticSectionToolTargets() {
    const main = document.querySelector('main');
    if (!main) return [];
    return Array.from(main.querySelectorAll('[data-admin-section-type="static"]')).filter((element) => {
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
    const siblings = Array.from(parentElement.children).filter((element) => element.dataset.adminSectionType === 'static' && element.dataset.adminDynamicSection !== 'true');
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
    const assignedElements = new WeakSet();

    const main = document.querySelector('main');
    if (main && !isInsideAdminUi(main)) {
      main.dataset.adminEditable = 'page-root';
      main.dataset.adminKey = 'page-root';
      state.registry.set('page-root:page-root', main);
      assignedElements.add(main);
    }

    getStaticSections().forEach((section) => {
      if (isInsideAdminUi(section)) return;
      if (!state.editMode && section.classList.contains('admin-hidden-element')) return;
      if (window.getComputedStyle(section).display === 'none') return;

      const key = `${section.dataset.adminStaticSectionKey}|background-image`;
      section.dataset.adminEditable = 'background-image';
      section.dataset.adminKey = key;
      state.registry.set(`image:${key}`, section);
      assignedElements.add(section);
    });

    document.querySelectorAll('[data-admin-dynamic-section="true"]').forEach((section) => {
      if (!(section instanceof HTMLElement)) return;
      if (isInsideAdminUi(section)) return;
      if (!state.editMode && section.classList.contains('admin-hidden-element')) return;
      if (window.getComputedStyle(section).display === 'none') return;

      const sectionId = Number.parseInt(section.dataset.adminSectionId || '', 10);
      if (!Number.isInteger(sectionId)) return;
      const key = `dynamic-section:${sectionId}|background-image`;
      section.dataset.adminEditable = 'background-image';
      section.dataset.adminKey = key;
      state.registry.set(`image:${key}`, section);
      assignedElements.add(section);
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
      assignedElements.add(element);
    });

    document.querySelectorAll('img').forEach((element) => {
      if (isInsideAdminUi(element)) return;
      if (isInsideSiteMenu(element)) return;
      if (element.closest('[data-admin-dynamic-section]') && !element.dataset.adminKey) return;
      if (!state.editMode && element.classList.contains('admin-hidden-element')) return;
      if (window.getComputedStyle(element).display === 'none') return;
      const key = buildStableImageKey(element);
      if (isDeletedImageCached(key)) {
        element.remove();
        return;
      }
      element.dataset.adminEditable = 'image';
      element.dataset.adminKey = key;
      state.registry.set(`image:${key}`, element);
      assignedElements.add(element);
    });

    document.querySelectorAll('[data-admin-background-var]').forEach((element) => {
      if (isInsideAdminUi(element)) return;
      if (isInsideSiteMenu(element)) return;
      if (element.closest('[data-admin-dynamic-section]')) return;
      if (!state.editMode && element.classList.contains('admin-hidden-element')) return;
      if (window.getComputedStyle(element).display === 'none') return;
      const key = buildStableBackgroundImageKey(element);
      element.dataset.adminEditable = 'background-image';
      element.dataset.adminKey = key;
      state.registry.set(`image:${key}`, element);
      assignedElements.add(element);
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
      if (assignedElements.has(element)) return;

      const key = buildContentKey(element, 'container');
      element.dataset.adminEditable = 'container';
      element.dataset.adminKey = key;
      state.registry.set(`container:${key}`, element);
      assignedElements.add(element);
    });

    if (document.body) {
      Array.from(document.body.querySelectorAll('*')).forEach((element) => {
        if (!(element instanceof HTMLElement)) return;
        if (assignedElements.has(element)) return;
        if (element.id === 'dynamic-page-sections') return;
        if (element.dataset.adminDynamicSection === 'true') return;
        if (element.dataset.adminEditable) return;
        if (genericStyleIgnoreTags.has(element.tagName)) return;
        if (isInsideAdminUi(element)) return;
        if (isInsideSiteMenu(element)) return;
        if (!state.editMode && element.classList.contains('admin-hidden-element')) return;
        if (window.getComputedStyle(element).display === 'none') return;

        const key = buildContentKey(element, 'style');
        element.dataset.adminEditable = 'generic';
        element.dataset.adminKey = key;
        state.registry.set(`generic:${key}`, element);
      });
    }

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
      // Position absolute relative to the element's own positioning context
      // (its container/section), matching what ensureAbsoluteForFreeDrag stores.
      const ctx = getPositioningContext(element);
      if (ctx !== document.body && window.getComputedStyle(ctx).position === 'static') {
        ctx.style.position = 'relative';
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
      if (!override) return; // Preserve existing HTML state; only apply session overrides

      // Compatibility: old image deletes stored as element-overrides.
      if (
        override.deleted &&
        element.dataset.adminEditable === 'image' &&
        !isDynamicContentKey(key)
      ) {
        persistDeletedImageCache(key, true);
        element.remove();
        state.registry.delete(`image:${key}`);
        return;
      }

      setAdminHiddenState(element, override.hidden, override.deleted);
      applyElementStyles(element, override);
    });

    getStaticSections().forEach((section) => {
      const key = section.dataset.adminStaticSectionKey;
      const override = key ? state.elementOverrides.get(key) : null;
      if (override) {
        setAdminHiddenState(section, override.hidden, override.deleted);
      }
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
      if (override && override.height_value) {
        section.style.minHeight = override.height_value;
      }
      // Don't clear minHeight when no override — preserve the value from the HTML file.
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

    // Remove any dynamic sections that were orphaned outside the host
    // (e.g. previously free-dragged out of #dynamic-page-sections). renderPageSections
    // rebuilds the host from state, so anything not inside the host is stale.
    if (main) {
      main.querySelectorAll('[data-admin-dynamic-section="true"]').forEach((node) => {
        if (!host.contains(node)) node.remove();
      });
    }

    // Reconcile existing wrappers with state instead of wiping the host, which would
    // destroy editor-added content living inside each section's content host (text/image
    // elements added through the editor). Build a lookup of the current wrappers first.
    const existingById = new Map();
    Array.from(host.children).forEach((child) => {
      if (child.dataset && child.dataset.adminDynamicSection === 'true' && child.dataset.adminSectionId) {
        existingById.set(child.dataset.adminSectionId, child);
      }
    });

    const desiredIds = new Set();
    state.pageSections.forEach((section) => {
      const idStr = String(section.id);
      desiredIds.add(idStr);

      // Reuse the existing wrapper when present so its content host (and any
      // text/image elements added through the editor) is preserved.
      let wrapper = existingById.get(idStr);
      if (wrapper) {
        wrapper.dataset.adminImagePath = section.background_path || '';
        wrapper.classList.toggle('has-background', Boolean(section.background_path));
        if (section.background_path) {
          wrapper.style.setProperty('--dynamic-section-bg', `url("${withCacheBust(section.background_path, section.updated_at)}")`);
        } else {
          wrapper.style.removeProperty('--dynamic-section-bg');
        }
        const contentHost = wrapper.querySelector(':scope > .container > .dynamic-page-section-content-host')
          || wrapper.querySelector(':scope > .container')
          || wrapper;
        const existingCard = contentHost.querySelector(':scope > .dynamic-page-section-card');
        const newCard = buildDynamicSectionCard(section);
        if (existingCard && newCard) {
          contentHost.replaceChild(newCard, existingCard);
        } else if (newCard && !existingCard) {
          contentHost.appendChild(newCard);
        } else if (!newCard && existingCard) {
          existingCard.remove();
        }
        return;
      }

      wrapper = document.createElement('section');
      wrapper.className = 'section dynamic-page-section';
      wrapper.dataset.adminDynamicSection = 'true';
      wrapper.dataset.adminSectionId = String(section.id);
      wrapper.dataset.adminResizeKey = `dynamic-section:${section.id}`;
      wrapper.dataset.adminSectionField = 'background_path';
      wrapper.dataset.adminEditable = 'background-image';
      wrapper.dataset.adminImagePath = section.background_path || '';
      wrapper.style.backgroundColor = getPageBackgroundColor();
      wrapper.classList.toggle('has-background', Boolean(section.background_path));

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

    // Remove wrappers that are no longer part of state.
    existingById.forEach((wrapper, idStr) => {
      if (!desiredIds.has(idStr)) wrapper.remove();
    });

    // Reorder the wrappers in the DOM to match the order in state.pageSections.
    state.pageSections.forEach((section) => {
      const wrapper = existingById.get(String(section.id))
        || host.querySelector(`:scope > [data-admin-dynamic-section="true"][data-admin-section-id="${section.id}"]`);
      if (wrapper && wrapper.parentNode === host) host.appendChild(wrapper);
    });

    applySectionSizeOverrides();
  }

  // Builds the "core content" card (title / body / image / remove button) for a
  // dynamic section. Returns null when the section has no core content, so callers
  // can decide whether to render anything at all. Kept as a separate helper so the
  // same card markup can be produced both for brand-new wrappers and for in-place
  // updates of existing ones.
  function buildDynamicSectionCard(section) {
    const hasCoreContent = Boolean(section.title || section.body || section.image_path);
    if (!hasCoreContent) return null;

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

    return card;
  }

  function placeDynamicSectionsHostRelative(staticSectionKey, insertPosition) {
    if (!staticSectionKey) return;
    const main = document.querySelector('main');
    const host = document.getElementById('dynamic-page-sections');
    if (!main || !host) return;

    assignStaticSectionKeys();
    const target = document.querySelector(`[data-admin-static-section-key="${staticSectionKey}"]`);
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

    const isAdminEdit = state.isAdmin && state.editMode;

    const cards = state.albums.map((album) => {
      const cover = album.cover_image_path
        ? `<img src="${withCacheBust(album.cover_image_path, album.updated_at)}" alt="${escapeHtml(album.title)}" />`
        : '<div class="album-cover-empty">No cover image</div>';
      const description = album.description ? `<p>${escapeHtml(album.description)}</p>` : '';
      const adminTools = isAdminEdit ? `
          <div class="album-tools">
            <button type="button" data-album-action="move-up" data-album-id="${album.id}">Up</button>
            <button type="button" data-album-action="move-down" data-album-id="${album.id}">Down</button>
            <button type="button" data-album-action="add-photo" data-album-id="${album.id}">Add Photo</button>
            <button type="button" data-album-action="manage" data-album-id="${album.id}">Manage</button>
            <button type="button" data-album-action="edit" data-album-id="${album.id}">Edit</button>
            <button type="button" data-album-action="delete" data-album-id="${album.id}" style="color:#ff9b9b;">Delete</button>
          </div>` : '';

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
          ${adminTools}
        </article>
      `;
    }).join('');

    const adminToolbar = isAdminEdit
      ? '<div class="album-admin-toolbar"><button type="button" data-album-action="create">Create Album</button></div>'
      : '';
    const emptyMsg = isAdminEdit ? '<p class="section-intro">No albums yet.</p>' : '';

    root.innerHTML = `
      ${adminToolbar}
      <div class="album-grid">
        ${cards || emptyMsg}
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
      const isDeletedImageValue = item.content_value === '__deleted__';
      if (isDeletedImageValue) {
        if (element.dataset.adminEditable === 'background-image') {
          const cssVarName = element.dataset.adminBackgroundVar;
          if (cssVarName) element.style.removeProperty(cssVarName);
          element.style.removeProperty('background-image');
          element.style.removeProperty('background-position');
          element.style.removeProperty('background-size');
          element.style.removeProperty('background-repeat');
          return;
        }

        persistDeletedImageCache(item.content_key, true);
        element.remove();
        state.registry.delete(`image:${item.content_key}`);
        return;
      }

      const nextValue = withCacheBust(item.content_value, item.updated_at);
      if (item.content_value) {
        element.dataset.adminImagePath = item.content_value;
        persistImageCache(item.content_key, item.content_value);
        persistDeletedImageCache(item.content_key, false);
        syncHomeHeroBootImage(item.content_key, item.content_value);
      }

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

      if (!item.content_value) {
        // Ignore empty persisted values for normal <img> tags to avoid flash-then-disappear on refresh.
        return;
      }

      element.src = nextValue;
      return;
    }

    element.textContent = item.content_value;
  }

  async function loadSavedContent() {
    // Content is stored directly in HTML files — no DB load needed.
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

  function loadPageSectionsFromDom() {
    state.pageSections = [];
    const host = document.getElementById('dynamic-page-sections');
    const seen = new Set();
    let position = 1;
    const collect = (section) => {
      const id = Number.parseInt(section.dataset.adminSectionId || '', 10);
      if (!Number.isFinite(id) || seen.has(id)) return;
      seen.add(id);
      const titleEl = section.querySelector('[data-admin-section-field="title"]');
      const bodyEl = section.querySelector('[data-admin-section-field="body"]');
      const imageEl = section.querySelector('[data-admin-section-field="image_path"]');
      state.pageSections.push({
        id,
        position: position++,
        title: titleEl && titleEl.dataset.adminSectionEmpty !== 'true' ? titleEl.textContent.trim() : '',
        body: bodyEl && bodyEl.dataset.adminSectionEmpty !== 'true' ? bodyEl.textContent.trim() : '',
        image_path: imageEl ? (imageEl.dataset.adminImagePath || '') : '',
        background_path: section.dataset.adminImagePath || '',
        updated_at: new Date().toISOString(),
      });
    };
    if (host) {
      host.querySelectorAll('[data-admin-dynamic-section="true"]').forEach(collect);
    }
    // Also pick up sections that were orphaned outside the host (e.g. free-dragged out
    // of #dynamic-page-sections). Without this they are not tracked and can't be deleted.
    document.querySelectorAll('main [data-admin-dynamic-section="true"]').forEach((section) => {
      if (!host || !host.contains(section)) collect(section);
    });
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
    // Element overrides are stored as inline styles in HTML files — no DB load needed.
    state.elementOverrides = new Map();
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

      .admin-save-status {
        display: inline-flex;
        align-items: center;
        padding: 0.2rem 0.55rem;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.06);
        color: #b8c4e0;
        font-size: 0.72rem;
        font-weight: 600;
        letter-spacing: 0.02em;
      }

      .admin-save-status[data-state="saving"] {
        border-color: rgba(158, 197, 255, 0.5);
        color: #9ec5ff;
      }

      .admin-save-status[data-state="error"] {
        border-color: rgba(255, 155, 155, 0.6);
        color: #ffb7b7;
      }

      .admin-save-status[data-state="idle"] {
        border-color: rgba(136, 212, 152, 0.55);
        color: #88d498;
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

      body.admin-edit-mode {
        padding-right: 340px !important;
      }

      /* ── Type-colour hierarchy outlines ─────────────────────── */
      /* Sections / backgrounds = purple */
      body.admin-edit-mode [data-admin-editable="background-image"] {
        outline: 1px dashed rgba(167, 139, 250, 0.45);
        outline-offset: 0;
        cursor: pointer;
        transition: outline-color 0.14s ease, box-shadow 0.14s ease;
      }
      /* Containers = green */
      body.admin-edit-mode [data-admin-editable="container"],
      body.admin-edit-mode [data-admin-editable="generic"] {
        outline: 1px dashed rgba(74, 222, 128, 0.35);
        outline-offset: 0;
        cursor: pointer;
        transition: outline-color 0.14s ease, box-shadow 0.14s ease;
      }
      /* Text / image = gold */
      body.admin-edit-mode [data-admin-editable="text"],
      body.admin-edit-mode [data-admin-editable="image"],
      body.admin-edit-mode [data-admin-editable="album-root"] {
        outline: 1px dashed rgba(255, 210, 98, 0.32);
        outline-offset: 0;
        cursor: pointer;
        transition: outline-color 0.14s ease, box-shadow 0.14s ease;
      }
      /* Page root = blue */
      body.admin-edit-mode [data-admin-editable="page-root"] {
        outline: 1px dashed rgba(99, 179, 237, 0.25);
        outline-offset: 0;
        cursor: default;
        min-height: 40vh;
      }

      /* Hover brightens outline */
      body.admin-edit-mode [data-admin-editable="background-image"]:hover { outline-color: rgba(167,139,250,0.8); }
      body.admin-edit-mode [data-admin-editable="container"]:hover,
      body.admin-edit-mode [data-admin-editable="generic"]:hover { outline-color: rgba(74,222,128,0.7); }
      body.admin-edit-mode [data-admin-editable="text"]:hover,
      body.admin-edit-mode [data-admin-editable="image"]:hover,
      body.admin-edit-mode [data-admin-editable="album-root"]:hover { outline-color: rgba(255,210,98,0.7); }

      /* Selected element — always gold solid */
      body.admin-edit-mode [data-admin-editable].admin-current-selection {
        outline: 2px solid rgba(255, 210, 98, 0.95) !important;
        outline-offset: 0;
        box-shadow: 0 0 0 3px rgba(255, 210, 98, 0.2) !important;
      }

      body.admin-edit-mode.admin-free-drag-mode [data-admin-editable="text"],
      body.admin-edit-mode.admin-free-drag-mode [data-admin-editable="image"],
      body.admin-edit-mode.admin-free-drag-mode [data-admin-editable="background-image"],
      body.admin-edit-mode.admin-free-drag-mode [data-admin-editable="container"],
      body.admin-edit-mode.admin-free-drag-mode [data-admin-editable="generic"],
      body.admin-edit-mode.admin-free-drag-mode [data-admin-editable="album-root"] {
        cursor: pointer;
      }

      body.admin-edit-mode.admin-free-drag-mode [data-admin-editable="text"].admin-is-dragging,
      body.admin-edit-mode.admin-free-drag-mode [data-admin-editable="image"].admin-is-dragging,
      body.admin-edit-mode.admin-free-drag-mode [data-admin-editable="background-image"].admin-is-dragging,
      body.admin-edit-mode.admin-free-drag-mode [data-admin-editable="container"].admin-is-dragging,
      body.admin-edit-mode.admin-free-drag-mode [data-admin-editable="generic"].admin-is-dragging,
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
      body.admin-edit-mode .admin-free-positioned[data-admin-editable="generic"],
      body.admin-edit-mode .admin-free-positioned[data-admin-editable="album-root"] {
        z-index: 8 !important;
      }

      body.admin-edit-mode .admin-drag-placeholder {
        outline: 2px dashed rgba(255, 210, 98, 0.55);
        outline-offset: 0;
        background: rgba(255, 210, 98, 0.06);
        border-radius: 6px;
        box-sizing: border-box;
        pointer-events: none;
      }

      body.admin-edit-mode .admin-hidden-element {
        opacity: 0.55;
      }

      body.admin-edit-mode .admin-deleted-element {
        opacity: 0.45;
        outline: 2px dashed rgba(255, 107, 107, 0.9) !important;
        outline-offset: 4px;
      }

      .admin-editor-backdrop {
        position: fixed;
        inset: 0;
        z-index: 10050;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 1rem;
        background: rgba(2, 8, 22, 0.72);
      }

      .admin-editor-modal {
        width: min(680px, 100%);
        max-height: 90vh;
        overflow-y: auto;
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
        max-height: 50vh;
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
        flex-wrap: wrap;
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

      .admin-revert-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.35rem;
        width: 34px;
        height: 34px;
        padding: 0;
        border: 1px solid rgba(255, 210, 98, 0.35);
        border-radius: 10px;
        background: rgba(255, 210, 98, 0.10);
        color: #ffd262;
        cursor: pointer;
        transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease;
      }
      .admin-revert-button:hover,
      .admin-revert-button:focus-visible {
        transform: translateY(-1px);
        border-color: rgba(255, 210, 98, 0.55);
        background: rgba(255, 210, 98, 0.18);
      }
      .admin-revert-button svg {
        width: 1rem;
        height: 1rem;
        fill: currentColor;
      }

      .dynamic-page-section {
        background-color: transparent;
        background-image: var(--dynamic-section-bg, none);
        background-size: cover;
        background-position: center;
      }

      /* Only darken the section when an actual background image is present, so a
         blank/new section shows the page background color through. */
      .dynamic-page-section.has-background {
        /* Lighter scrim so the chosen background image stays visible (text
           remains readable). The previous 0.78-0.92 overlay hid it almost
           completely. */
        background-image: linear-gradient(180deg, rgba(2, 8, 22, 0.35), rgba(2, 8, 22, 0.55)), var(--dynamic-section-bg, none);
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
        display: none !important;
        gap: 0.5rem;
      }

      body.admin-edit-mode .admin-section-tools {
        display: none !important;
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

      /* Floating element toolbar — suppressed; all controls are in the sidebar */
      .admin-element-toolbar {
        display: none !important;
      }

      /* ── Inspector sidebar (full-height right panel) ──────────── */
      .admin-inspector-panel {
        position: fixed;
        top: var(--admin-header-h, 64px);
        right: 0;
        width: 340px;
        height: calc(100vh - var(--admin-header-h, 64px));
        z-index: 10020;
        display: none;
        flex-direction: column;
        overflow: hidden;
        background: #060e22;
        border-left: 1px solid rgba(255,210,98,0.18);
        box-shadow: -6px 0 28px rgba(0,0,0,0.45);
        user-select: none;
      }

      /* Allow text selection and normal interaction in form controls */
      .admin-inspector-panel input,
      .admin-inspector-panel textarea,
      .admin-inspector-panel select {
        user-select: text;
      }

      /* ── Selection resize handles overlay ──────────────────────── */
      .admin-selection-handles-overlay {
        position: fixed;
        pointer-events: none;
        z-index: 10015;
        box-sizing: border-box;
        outline: 1.5px solid rgba(255, 210, 98, 0.65);
        outline-offset: 0;
      }
      .admin-resize-handle {
        position: absolute;
        width: 10px;
        height: 10px;
        background: rgba(255, 255, 255, 0.95);
        border: 1.5px solid rgba(255, 210, 98, 0.9);
        border-radius: 2px;
        box-shadow: 0 1px 4px rgba(0,0,0,0.35);
        pointer-events: auto;
        box-sizing: border-box;
      }
      /* Corner handles */
      .admin-resize-handle[data-handle="nw"] { top:-5px; left:-5px; cursor:nw-resize; }
      .admin-resize-handle[data-handle="n"]  { top:-5px; left:calc(50% - 5px); cursor:n-resize; }
      .admin-resize-handle[data-handle="ne"] { top:-5px; right:-5px; cursor:ne-resize; }
      .admin-resize-handle[data-handle="e"]  { top:calc(50% - 5px); right:-5px; cursor:e-resize; }
      .admin-resize-handle[data-handle="se"] { bottom:-5px; right:-5px; cursor:se-resize; }
      .admin-resize-handle[data-handle="s"]  { bottom:-5px; left:calc(50% - 5px); cursor:s-resize; }
      .admin-resize-handle[data-handle="sw"] { bottom:-5px; left:-5px; cursor:sw-resize; }
      .admin-resize-handle[data-handle="w"]  { top:calc(50% - 5px); left:-5px; cursor:w-resize; }

      /* header */
      .admin-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.6rem 0.9rem;
        background: #070f25;
        border-bottom: 1px solid rgba(255,255,255,0.07);
        flex-shrink: 0;
      }
      .admin-panel-header h3 {
        margin: 0;
        font-size: 0.88rem;
        color: #ffd262;
        font-weight: 700;
        letter-spacing: 0.03em;
      }

      /* breadcrumb */
      .admin-panel-breadcrumb {
        padding: 0.4rem 0.9rem;
        font-size: 0.72rem;
        color: #8fa0c8;
        background: rgba(255,255,255,0.025);
        border-bottom: 1px solid rgba(255,255,255,0.06);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex-shrink: 0;
      }
      .admin-panel-breadcrumb .admin-bc-sep { opacity: 0.4; margin: 0 0.3em; }
      .admin-panel-breadcrumb .admin-bc-item { cursor: pointer; }
      .admin-panel-breadcrumb .admin-bc-item:hover { color: #ffd262; }
      .admin-panel-breadcrumb .admin-bc-item.active { color: #f5f7ff; font-weight: 600; }

      /* type badge */
      .admin-kind-badge {
        display: inline-flex;
        align-items: center;
        padding: 0.18rem 0.55rem;
        border-radius: 999px;
        font-size: 0.68rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .admin-kind-badge.kind-section  { background:rgba(167,139,250,0.15); color:#c4b5fd; border:1px solid rgba(167,139,250,0.3); }
      .admin-kind-badge.kind-container { background:rgba(74,222,128,0.12); color:#86efac; border:1px solid rgba(74,222,128,0.25); }
      .admin-kind-badge.kind-text     { background:rgba(255,210,98,0.12); color:#ffd262; border:1px solid rgba(255,210,98,0.25); }
      .admin-kind-badge.kind-image    { background:rgba(99,179,237,0.12); color:#93c5fd; border:1px solid rgba(99,179,237,0.25); }
      .admin-kind-badge.kind-page     { background:rgba(99,179,237,0.1); color:#93c5fd; border:1px solid rgba(99,179,237,0.2); }
      .admin-kind-badge.kind-other    { background:rgba(255,255,255,0.07); color:#b8c4e0; border:1px solid rgba(255,255,255,0.12); }

      /* tabs */
      .admin-panel-tabs {
        display: flex;
        border-bottom: 1px solid rgba(255,255,255,0.08);
        flex-shrink: 0;
        background: #070f25;
      }
      .admin-panel-tab {
        flex: 1;
        padding: 0.5rem 0.2rem;
        background: transparent;
        border: none;
        border-bottom: 2px solid transparent;
        color: #8fa0c8;
        font: inherit;
        font-size: 0.76rem;
        font-weight: 600;
        letter-spacing: 0.04em;
        cursor: pointer;
        transition: color 0.15s, border-color 0.15s;
        touch-action: manipulation;
      }
      .admin-panel-tab:hover { color: #d8e2fa; }
      .admin-panel-tab.is-active { color: #ffd262; border-bottom-color: #ffd262; }

      /* scrollable pane area */
      .admin-panel-panes {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
      }
      .admin-panel-pane { display: none; padding: 0.75rem 0.9rem; }
      .admin-panel-pane.is-active { display: block; }

      /* sticky footer with insert + page-bg */
      .admin-panel-footer {
        flex-shrink: 0;
        border-top: 1px solid rgba(255,255,255,0.07);
        background: #070f25;
        padding: 0.6rem 0.9rem;
      }

      /* compact form fields inside panel */
      .admin-panel-field {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        margin-bottom: 0.6rem;
      }
      .admin-panel-field label {
        font-size: 0.72rem;
        color: #8fa0c8;
        font-weight: 600;
        letter-spacing: 0.03em;
      }
      .admin-panel-field input,
      .admin-panel-field select,
      .admin-panel-field textarea {
        width: 100%;
        padding: 0.38rem 0.6rem;
        border-radius: 8px;
        border: 1px solid rgba(255,255,255,0.12);
        background: rgba(255,255,255,0.05);
        color: #f5f7ff;
        font: inherit;
        font-size: 0.8rem;
        box-sizing: border-box;
      }
      .admin-panel-field textarea {
        min-height: 80px;
        resize: vertical;
        line-height: 1.5;
      }
      .admin-panel-field input:focus,
      .admin-panel-field select:focus,
      .admin-panel-field textarea:focus {
        outline: none;
        border-color: rgba(255,210,98,0.5);
        background: rgba(255,255,255,0.07);
      }

      /* panel buttons */
      .admin-panel-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0.35rem 0.7rem;
        border-radius: 8px;
        border: 1px solid rgba(255,255,255,0.14);
        background: rgba(255,255,255,0.07);
        color: #f5f7ff;
        font: inherit;
        font-size: 0.78rem;
        cursor: pointer;
        transition: border-color 0.15s, background 0.15s;
        white-space: nowrap;
        touch-action: manipulation;
        -webkit-tap-highlight-color: rgba(255,210,98,0.18);
      }
      .admin-panel-btn:hover { border-color: rgba(255,210,98,0.5); background: rgba(255,210,98,0.12); }
      .admin-panel-btn.primary { background: rgba(255,210,98,0.18); border-color: rgba(255,210,98,0.5); color:#ffd262; }
      .admin-panel-btn.primary:hover { background: rgba(255,210,98,0.28); }
      .admin-panel-btn.danger { color:#ff9b9b; border-color:rgba(255,155,155,0.3); }
      .admin-panel-btn.danger:hover { background:rgba(255,107,107,0.15); border-color:rgba(255,155,155,0.6); }
      .admin-panel-btn[disabled] { opacity:0.4; cursor:not-allowed; }
      .admin-panel-btn-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        margin-bottom: 0.5rem;
      }

      /* section divider inside panel */
      .admin-panel-section-title {
        font-size: 0.68rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #6b7fa8;
        margin: 0.7rem 0 0.35rem;
        padding-top: 0.5rem;
        border-top: 1px solid rgba(255,255,255,0.06);
      }
      .admin-panel-section-title:first-child { margin-top: 0; border-top: none; padding-top: 0; }

      /* color row */
      .admin-color-row {
        display: flex;
        align-items: center;
        gap: 0.4rem;
      }
      .admin-color-row input[type="color"] {
        width: 2rem;
        height: 2rem;
        padding: 0.1rem;
        border-radius: 6px;
        border: 1px solid rgba(255,255,255,0.18);
        background: transparent;
        cursor: pointer;
        flex-shrink: 0;
      }
      .admin-color-reset {
        padding: 0.2rem 0.5rem;
        border-radius: 6px;
        border: 1px solid rgba(255,255,255,0.14);
        background: rgba(255,255,255,0.06);
        color: #b8c4e0;
        font: inherit;
        font-size: 0.72rem;
        cursor: pointer;
      }

      /* insert grid */
      .admin-insert-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 0.35rem;
      }

      /* no-selection prompt */
      .admin-panel-empty {
        padding: 1rem 0;
        text-align: center;
        color: #6b7fa8;
        font-size: 0.8rem;
        line-height: 1.6;
      }
      .admin-panel-empty svg {
        display: block;
        margin: 0 auto 0.6rem;
        width: 2rem;
        height: 2rem;
        opacity: 0.3;
        fill: #b8c4e0;
      }

      /* keep old .admin-inspector-drag-handle compat (no-op now) */
      .admin-inspector-drag-handle { display: none; }
      .admin-inspector-meta { display: none; }
      .admin-inspector-group { display: none; }
      .admin-inspector-grid  { display: none; }

      body.admin-edit-mode main[data-admin-canvas-dropzone="true"] {
        outline: 2px dashed rgba(255, 210, 98, 0.3);
        outline-offset: -2px;
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

      .admin-code-editor-backdrop {
        position: fixed;
        inset: 0;
        z-index: 10100;
        display: flex;
        align-items: stretch;
        justify-content: center;
        background: rgba(2, 8, 22, 0.78);
        padding: 0;
      }

      .admin-code-editor-modal {
        display: flex;
        flex-direction: column;
        width: 100%;
        max-width: 1100px;
        background: #08102a;
        color: #f5f7ff;
        border-left: 1px solid rgba(255, 210, 98, 0.24);
        border-right: 1px solid rgba(255, 210, 98, 0.24);
        overflow: hidden;
      }

      .admin-code-editor-header {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem 1.25rem;
        border-bottom: 1px solid rgba(255,255,255,0.1);
        background: #0b162e;
        flex-shrink: 0;
      }

      .admin-code-editor-header h2 {
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
        flex: 1;
      }

      .admin-code-editor-tabs {
        display: flex;
        gap: 0.25rem;
        padding: 0.5rem 1.25rem 0;
        border-bottom: 1px solid rgba(255,255,255,0.1);
        flex-shrink: 0;
      }

      .admin-code-tab {
        padding: 0.4rem 1rem;
        border-radius: 8px 8px 0 0;
        border: 1px solid transparent;
        border-bottom: none;
        background: transparent;
        color: #8fa0c8;
        cursor: pointer;
        font: inherit;
        font-size: 0.85rem;
        transition: background 0.15s, color 0.15s;
      }

      .admin-code-tab:hover {
        background: rgba(255,255,255,0.06);
        color: #d8e2fa;
      }

      .admin-code-tab.is-active {
        background: #08102a;
        border-color: rgba(255,210,98,0.3);
        color: #ffd262;
        position: relative;
        bottom: -1px;
      }

      .admin-code-editor-body {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        padding: 0;
      }

      .admin-code-editor-textarea {
        flex: 1;
        width: 100%;
        height: 100%;
        padding: 1rem 1.25rem;
        background: #030916;
        color: #c9d7f5;
        border: none;
        outline: none;
        resize: none;
        font-family: 'Cascadia Code', 'Fira Code', 'Consolas', 'Monaco', monospace;
        font-size: 0.85rem;
        line-height: 1.6;
        tab-size: 2;
        white-space: pre;
        overflow-wrap: normal;
        overflow-x: auto;
        overflow-y: auto;
        box-sizing: border-box;
      }

      .admin-code-editor-footer {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem 1.25rem;
        border-top: 1px solid rgba(255,255,255,0.1);
        background: #0b162e;
        flex-shrink: 0;
      }

      .admin-code-editor-status {
        flex: 1;
        font-size: 0.82rem;
        color: #8fa0c8;
      }

      body.admin-edit-mode .site-nav a.admin-nav-draggable {
        cursor: grab;
      }

      body.admin-edit-mode .site-nav a.admin-nav-dragging {
        opacity: 0.35;
        outline: 1px dashed rgba(255, 210, 98, 0.4);
        outline-offset: 0;
      }

      body.admin-edit-mode .site-nav a.admin-nav-drag-over {
        outline: 2px solid rgba(255, 210, 98, 0.95);
        outline-offset: 0;
        background: rgba(255, 210, 98, 0.18) !important;
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

  async function deleteContentItem(_contentKey, _contentType) {
    beginSaveAttempt();
    try {
      savePageToFile();
      finishSaveAttempt(true);
      return {};
    } catch (error) {
      finishSaveAttempt(false, error.message);
      throw error;
    }
  }

  function serializePageHtml() {
    const clone = document.documentElement.cloneNode(true);

    // Remove admin-injected UI elements
    [
      '#admin-nav-controls',
      '#nav-auth-link', '#nav-dashboard-link', '#nav-logout-link', '#login-actions',
      '.admin-inspector-panel', '.admin-element-toolbar',
      '.admin-editor-backdrop', '.admin-code-editor-backdrop',
      '#admin-editor-styles',
    ].forEach((sel) => {
      clone.querySelectorAll(sel).forEach((el) => el.remove());
    });

    // Remove transient admin attributes
    const transientAttrs = [
      'data-admin-editable', 'data-admin-key', 'data-admin-canvas-dropzone',
      'data-admin-drag-target', 'data-admin-drag-position', 'data-admin-text-drop-target',
      'data-admin-resize-key', 'data-admin-nav-drag-bound',
    ];
    const transientClasses = [
      'admin-is-dragging', 'admin-current-selection', 'admin-free-positioned',
      'admin-nav-draggable', 'admin-nav-drag-over', 'admin-nav-dragging',
      'admin-empty-section-field',
    ];
    clone.querySelectorAll('[draggable]').forEach((el) => el.removeAttribute('draggable'));
    clone.querySelectorAll('*').forEach((el) => {
      transientAttrs.forEach((attr) => el.removeAttribute(attr));
      transientClasses.forEach((cls) => el.classList.remove(cls));
      if (el.classList.length === 0 && el.hasAttribute('class')) el.removeAttribute('class');
    });

    // Clean body edit-mode state
    const body = clone.querySelector('body');
    if (body) {
      body.classList.remove('admin-edit-mode', 'admin-free-drag-mode');
      if (body.style.paddingRight) body.style.paddingRight = '';
      if (body.classList.length === 0) body.removeAttribute('class');
    }

    // Strip any editor-injected inline styles from header/nav elements
    clone.querySelectorAll('.site-header, .site-header *, .site-nav, .site-nav *, .nav-toggle').forEach((el) => {
      // Remove only editor-added cursor/position styles; leave intentional display:none on shop link
      if (el.tagName === 'A' || el.tagName === 'NAV' || el.tagName === 'HEADER' || el.tagName === 'DIV') {
        ['position', 'left', 'top', 'width', 'height', 'margin', 'zIndex', 'cursor', 'z-index'].forEach((prop) => {
          el.style.removeProperty(prop);
        });
        if (el.style.length === 0) el.removeAttribute('style');
      }
    });

    // Remove any browser-extension injected elements (1Password etc.) from clone
    clone.querySelectorAll('[id^="1p-"]').forEach((el) => el.remove());

    return '<!DOCTYPE html>\n' + clone.outerHTML;
  }

  let _pageSaveTimer = null;

  function savePageToFile() {
    if (_pageSaveTimer) clearTimeout(_pageSaveTimer);
    _pageSaveTimer = setTimeout(async () => {
      _pageSaveTimer = null;
      const pagePath = state.pagePath === '/' ? '/index.html' : state.pagePath;
      const token = getStoredToken();
      updateSaveStatus('saving', 'Saving\u2026');
      try {
        const content = serializePageHtml();
        const res = await fetch('/api/admin/file-source', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ path: pagePath, content }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Save failed');
        updateSaveStatus('saved', 'Saved');
      } catch (err) {
        console.error('Page save error:', err);
        updateSaveStatus('error', err.message);
      }
    }, 400);
  }

  function isDynamicContentKey(key) {
    return typeof key === 'string' && /(^|>)dynamic-(text|image)-\d+\|(text|image)$/.test(key);
  }

  async function saveContentUpdate(payload) {
    beginSaveAttempt();
    try {
      const fakeItem = {
        content_key: payload.contentKey,
        content_type: payload.contentType,
        content_value: payload.contentValue,
        updated_at: new Date().toISOString(),
      };
      savePageToFile();
      finishSaveAttempt(true);
      return fakeItem;
    } catch (error) {
      finishSaveAttempt(false, error.message);
      throw error;
    }
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
    const editableType = element.dataset.adminEditable || 'container';

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
          state.registry.delete(`${editableType}:${key}`);
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

  function removeSelectionHandleOverlay() {
    if (state.selectionHandlesOverlay) {
      state.selectionHandlesOverlay.remove();
      state.selectionHandlesOverlay = null;
    }
    document.querySelectorAll('.admin-selection-handles-overlay').forEach((el) => el.remove());
  }

  function showSelectionHandleOverlay(element) {
    removeSelectionHandleOverlay();
    if (!element || !state.editMode) return;
    // Only show handles for elements that have a key (can be saved)
    if (!element.dataset.adminKey) return;
    // Don't show handles for the page root
    if (element.dataset.adminEditable === 'page-root') return;

    const rect = element.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    const overlay = document.createElement('div');
    overlay.className = 'admin-selection-handles-overlay';

    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;

    const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    for (const pos of HANDLES) {
      const span = document.createElement('span');
      span.className = 'admin-resize-handle';
      span.dataset.handle = pos;

      // Initiate a resize drag from a specific handle widget
      span.addEventListener('pointerdown', (e) => {
        if (!state.editMode) return;
        if (e.button !== 0) return;
        e.preventDefault();  // OK here — handle click has no meaningful default
        e.stopPropagation();
        beginFreeDrag(element, e, pos);
      });

      overlay.appendChild(span);
    }

    document.body.appendChild(overlay);
    state.selectionHandlesOverlay = overlay;
  }

  function hideElementToolbar() {
    if (!state.elementToolbar) return;
    removeSelectionHandleOverlay();
    document.querySelectorAll('.admin-current-selection').forEach((node) => node.classList.remove('admin-current-selection'));
    state.elementToolbar.style.display = 'none';
    state.selectedEditableElement = null;
    updateInspectorPanel(null);
  }

  function getPageBackgroundColor() {
    if (document.body.dataset.pageBgColor) {
      return document.body.dataset.pageBgColor;
    }
    const rootStyle = getComputedStyle(document.documentElement);
    const fallback = rootStyle.getPropertyValue('--background');
    return (fallback || '#020816').trim();
  }

  async function createBlankDynamicSection() {
    const item = await createPageSection({ title: '', body: '' });
    upsertPageSection(item);
    renderPageSections();
    registerEditableElements();
    applyElementOverrides();
    registerSectionEditing();
    return document.querySelector(`[data-admin-dynamic-section="true"][data-admin-section-id="${item.id}"]`);
  }

  async function addContainerToSection(section) {
    const sectionHost = getSectionContentHost(section) || section;
    if (!sectionHost) return;

    const newContainer = document.createElement('div');
    newContainer.textContent = 'New container';
    newContainer.style.minHeight = '90px';
    newContainer.style.padding = '0.85rem';
    newContainer.style.marginTop = '1rem';
    newContainer.style.border = '1px dashed rgba(255, 255, 255, 0.35)';
    newContainer.style.borderRadius = '10px';
    newContainer.style.backgroundColor = getPageBackgroundColor();
    sectionHost.appendChild(newContainer);

    const key = buildContentKey(newContainer, 'container');
    newContainer.dataset.adminEditable = 'container';
    newContainer.dataset.adminKey = key;
    state.registry.set(`container:${key}`, newContainer);
    registerEditableElements();
    applyElementOverrides();
    registerSectionEditing();
  }

  async function insertIntoTarget(targetElement, insertType) {
    const target = targetElement || document.querySelector('main[data-admin-editable="page-root"]');
    if (!target) return;

    let section = null;
    let kind = null;

    if (target.dataset.adminEditable === 'page-root') {
      section = await createBlankDynamicSection();
      kind = 'dynamic';
      if (insertType === 'section') return;
    } else if (isSectionRootEditable(target)) {
      section = target;
      kind = getSectionKindFromElement(target);
    } else {
      section = getHostSectionForElement(target);
      kind = getSectionKindFromElement(section);
    }

    if (!section || !kind) return;
    if (insertType === 'text') {
      await addNewTextElement(section, kind);
      registerEditableElements();
      applyElementOverrides();
      registerSectionEditing();
      return;
    }

    if (insertType === 'image') {
      await addNewImageElement(section, kind);
      registerEditableElements();
      applyElementOverrides();
      registerSectionEditing();
      return;
    }

    if (insertType === 'container') {
      await addContainerToSection(section);
    }
  }

  // Keep the inspector panel below the fixed site header so it never
  // covers the navigation menu. Measures the header and exposes its height
  // via the --admin-header-h CSS variable used by .admin-inspector-panel.
  function syncInspectorTop() {
    const header = document.querySelector('.site-header');
    const h = header ? header.getBoundingClientRect().height : 64;
    document.documentElement.style.setProperty('--admin-header-h', Math.ceil(h) + 'px');
  }

  function ensureInspectorPanel() {
    if (state.inspectorPanel) return state.inspectorPanel;

    const panel = document.createElement('aside');
    panel.className = 'admin-inspector-panel';
    panel.innerHTML = `
      <div class="admin-panel-header">
        <h3>&#9998; Page Editor</h3>
        <div style="display:flex;gap:0.3rem;align-items:center;" title="Outline color guide">
          <span style="width:8px;height:8px;border-radius:2px;border:1px solid rgba(167,139,250,0.7);display:inline-block;" title="Section"></span>
          <span style="width:8px;height:8px;border-radius:2px;border:1px solid rgba(74,222,128,0.7);display:inline-block;" title="Container"></span>
          <span style="width:8px;height:8px;border-radius:2px;border:1px solid rgba(255,210,98,0.7);display:inline-block;" title="Text/Image"></span>
        </div>
      </div>
      <div class="admin-panel-breadcrumb" id="admin-panel-breadcrumb">
        <span style="color:#6b7fa8">Click any element to select it</span>
      </div>
      <div class="admin-panel-tabs">
        <button class="admin-panel-tab is-active" data-panel-tab="props">Properties</button>
        <button class="admin-panel-tab" data-panel-tab="style">Style</button>
        <button class="admin-panel-tab" data-panel-tab="actions">Actions</button>
      </div>
      <div class="admin-panel-panes">
        <div class="admin-panel-pane is-active" data-panel-pane="props">
          <div class="admin-panel-empty" id="admin-panel-props-empty">
            <svg viewBox="0 0 24 24"><path d="M13 9h-2V7h2m0 10h-2v-6h2m-1-9A10 10 0 002 12a10 10 0 0010 10 10 10 0 0010-10A10 10 0 0012 2z"/></svg>
            Click any element on the page to edit its properties.
          </div>
          <div id="admin-panel-props-content" style="display:none;"></div>
        </div>
        <div class="admin-panel-pane" data-panel-pane="style">
          <div class="admin-panel-empty" id="admin-panel-style-empty">Select an element to edit its style.</div>
          <div id="admin-panel-style-content" style="display:none;">
            <div class="admin-panel-section-title">Text</div>
            <div class="admin-panel-field"><label>Color</label>
              <div class="admin-color-row">
                <input type="color" id="ap-text-color" value="#ffffff" />
                <button type="button" class="admin-color-reset" id="ap-text-color-reset">Default</button>
              </div>
            </div>
            <div class="admin-panel-field"><label>Alignment</label>
              <select id="ap-text-align"><option value="">Default</option><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select>
            </div>
            <div class="admin-panel-field"><label>Font Family</label>
              <select id="ap-font-family">
                <option value="">Default</option>
                <option value="Georgia, &quot;Times New Roman&quot;, serif">Serif (Georgia)</option>
                <option value="&quot;Trebuchet MS&quot;, &quot;Lucida Grande&quot;, sans-serif">Trebuchet</option>
                <option value="&quot;Segoe UI&quot;, Tahoma, Geneva, Verdana, sans-serif">Segoe UI</option>
                <option value="&quot;Courier New&quot;, Courier, monospace">Monospace</option>
                <option value="&quot;Brush Script MT&quot;, &quot;Comic Sans MS&quot;, cursive">Script</option>
              </select>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.35rem;">
              <div class="admin-panel-field"><label>Font Size</label><input type="text" id="ap-font-size" placeholder="1rem, 18px" /></div>
              <div class="admin-panel-field"><label>Opacity</label><input type="text" id="ap-opacity" placeholder="1, 0.85" /></div>
            </div>
            <div class="admin-panel-field"><label>Weight</label>
              <select id="ap-font-weight"><option value="">Default</option><option value="400">Regular (400)</option><option value="600">Semi Bold (600)</option><option value="700">Bold (700)</option></select>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.35rem;">
              <div class="admin-panel-field"><label>Style</label>
                <select id="ap-font-style"><option value="">Default</option><option value="normal">Normal</option><option value="italic">Italic</option></select>
              </div>
              <div class="admin-panel-field"><label>Case</label>
                <select id="ap-text-transform"><option value="">Default</option><option value="uppercase">UPPER</option><option value="capitalize">Title</option><option value="lowercase">lower</option></select>
              </div>
            </div>
            <div class="admin-panel-section-title">Background</div>
            <div class="admin-panel-field"><label>Color</label>
              <div class="admin-color-row">
                <input type="color" id="ap-bg-color" value="#000000" />
                <button type="button" class="admin-color-reset" id="ap-bg-color-reset">Default</button>
              </div>
            </div>
            <div class="admin-panel-field"><label>Bg Opacity</label><input type="text" id="ap-bg-opacity" placeholder="1, 0.85, 0.5" /></div>
            <div class="admin-panel-section-title">Size</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.35rem;">
              <div class="admin-panel-field"><label>Width</label><input type="text" id="ap-width" placeholder="auto, 50%" /></div>
              <div class="admin-panel-field"><label>Height</label><input type="text" id="ap-height" placeholder="auto, 180px" /></div>
            </div>
            <div class="admin-panel-section-title">Border</div>
            <div class="admin-panel-field"><label>Style</label>
              <select id="ap-border-style"><option value="">Default</option><option value="none">None</option><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option><option value="double">Double</option></select>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.35rem;">
              <div class="admin-panel-field"><label>Width</label><input type="text" id="ap-border-width" placeholder="1px" /></div>
              <div class="admin-panel-field"><label>Radius</label><input type="text" id="ap-border-radius" placeholder="8px, 50%" /></div>
            </div>
            <div class="admin-panel-field"><label>Border Color</label>
              <div class="admin-color-row">
                <input type="color" id="ap-border-color" value="#ffffff" />
                <button type="button" class="admin-color-reset" id="ap-border-color-reset">Default</button>
              </div>
            </div>
            <div class="admin-panel-btn-row" style="margin-top:0.75rem;">
              <button type="button" class="admin-panel-btn primary" id="ap-apply-style">Apply Style</button>
              <button type="button" class="admin-panel-btn" id="ap-restore-defaults">Restore All</button>
            </div>
          </div>
        </div>
        <div class="admin-panel-pane" data-panel-pane="actions">
          <div class="admin-panel-empty" id="admin-panel-actions-empty">Select an element to see available actions.</div>
          <div id="admin-panel-actions-content" style="display:none;"></div>
        </div>
      </div>
      <div class="admin-panel-footer">
        <div class="admin-panel-section-title">Insert</div>
        <div class="admin-insert-grid">
          <button type="button" class="admin-panel-btn" data-inspector-action="insert-section">+ Section</button>
          <button type="button" class="admin-panel-btn" data-inspector-action="insert-text">+ Text</button>
          <button type="button" class="admin-panel-btn" data-inspector-action="insert-image">+ Image</button>
          <button type="button" class="admin-panel-btn" data-inspector-action="insert-container">+ Container</button>
        </div>
        <div class="admin-panel-section-title">Page Background</div>
        <div class="admin-panel-field"><label>Color</label>
          <div class="admin-color-row">
            <input type="color" id="admin-page-bg-color" value="#020816" />
            <button type="button" id="admin-page-bg-color-apply" class="admin-panel-btn">Apply</button>
            <button type="button" id="admin-page-bg-color-clear" class="admin-panel-btn">Clear</button>
          </div>
        </div>
        <div class="admin-panel-field"><label>Image</label>
          <div class="admin-panel-btn-row">
            <button type="button" id="admin-page-bg-image-upload" class="admin-panel-btn">Upload</button>
            <button type="button" id="admin-page-bg-image-clear" class="admin-panel-btn">Remove</button>
          </div>
        </div>
        <span id="admin-page-bg-status" style="font-size:0.7rem;color:#b8c4e0;min-height:1em;display:block;"></span>
      </div>
    `;

    // ── Tab switching ───────────────────────────────────────────────────────
    panel.querySelectorAll('.admin-panel-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.panelTab;
        panel.querySelectorAll('.admin-panel-tab').forEach((t) => t.classList.remove('is-active'));
        panel.querySelectorAll('.admin-panel-pane').forEach((p) => p.classList.remove('is-active'));
        tab.classList.add('is-active');
        const pane = panel.querySelector(`[data-panel-pane="${tabName}"]`);
        if (pane) pane.classList.add('is-active');
      });
    });

    // ── Insert & element action buttons ────────────────────────────────────
    panel.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-inspector-action]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();

      const action = button.dataset.inspectorAction;
      const selected = getSelectedEditableElement() || document.querySelector('main[data-admin-editable="page-root"]');
      if (!selected) return;

      try {
        if (action.startsWith('insert-')) {
          await insertIntoTarget(selected, action.replace('insert-', ''));
          scheduleEditorSync();
          return;
        }
        await performEditorAction(action, selected);
      } catch (error) {
        alert(error.message);
      }
    });

    // ── Style pane: Apply Style ─────────────────────────────────────────────
    panel.querySelector('#ap-apply-style')?.addEventListener('click', async () => {
      const el = getSelectedEditableElement();
      if (!el || !el.dataset.adminKey) return;
      const textColorInput = panel.querySelector('#ap-text-color');
      const bgColorInput = panel.querySelector('#ap-bg-color');
      const borderColorInput = panel.querySelector('#ap-border-color');
      const patch = {
        textAlign:              panel.querySelector('#ap-text-align')?.value || '',
        fontFamily:             panel.querySelector('#ap-font-family')?.value || '',
        fontWeight:             panel.querySelector('#ap-font-weight')?.value || '',
        fontStyle:              panel.querySelector('#ap-font-style')?.value || '',
        textTransform:          panel.querySelector('#ap-text-transform')?.value || '',
        fontSize:               panel.querySelector('#ap-font-size')?.value.trim() || '',
        opacityValue:           panel.querySelector('#ap-opacity')?.value.trim() || '',
        textColor:              textColorInput?.dataset.isReset === 'true' ? '' : (textColorInput?.value || ''),
        backgroundColor:        bgColorInput?.dataset.isReset === 'true' ? '' : (bgColorInput?.value || ''),
        backgroundOpacityValue: panel.querySelector('#ap-bg-opacity')?.value.trim() || '',
        widthValue:             panel.querySelector('#ap-width')?.value.trim() || '',
        heightValue:            panel.querySelector('#ap-height')?.value.trim() || '',
        borderStyle:            panel.querySelector('#ap-border-style')?.value || '',
        borderWidth:            panel.querySelector('#ap-border-width')?.value.trim() || '',
        borderColor:            borderColorInput?.dataset.isReset === 'true' ? '' : (borderColorInput?.value || ''),
        borderRadius:           panel.querySelector('#ap-border-radius')?.value.trim() || '',
      };
      try {
        const item = await saveElementOverride(el.dataset.adminKey, patch);
        applyElementStyles(el, item);
      } catch (err) {
        alert(err.message);
      }
    });

    // ── Style pane: Restore All defaults ────────────────────────────────────
    panel.querySelector('#ap-restore-defaults')?.addEventListener('click', async () => {
      const el = getSelectedEditableElement();
      if (!el || !el.dataset.adminKey) return;
      if (!confirm('Restore all style defaults for this element?')) return;
      try {
        const item = await saveElementOverride(el.dataset.adminKey, {
          textAlign: '', fontFamily: '', fontWeight: '', fontStyle: '', textTransform: '',
          fontSize: '', opacityValue: '', textColor: '', backgroundColor: '', backgroundOpacityValue: '',
          widthValue: '', heightValue: '', borderStyle: '', borderWidth: '', borderColor: '', borderRadius: '',
        });
        applyElementStyles(el, item);
        updateInspectorPanel(el);
      } catch (err) {
        alert(err.message);
      }
    });

    // ── Color "Default" reset buttons ────────────────────────────────────────
    function makeColorResetable(inputId, resetBtnId) {
      const input = panel.querySelector(`#${inputId}`);
      const btn = panel.querySelector(`#${resetBtnId}`);
      if (!input || !btn) return;
      input.dataset.isReset = 'false';
      input.addEventListener('input', () => { input.dataset.isReset = 'false'; });
      btn.addEventListener('click', () => {
        input.dataset.isReset = 'true';
        const orig = btn.textContent;
        btn.textContent = '✓ Reset';
        setTimeout(() => { btn.textContent = orig; }, 1200);
      });
    }
    makeColorResetable('ap-text-color', 'ap-text-color-reset');
    makeColorResetable('ap-bg-color', 'ap-bg-color-reset');
    makeColorResetable('ap-border-color', 'ap-border-color-reset');

    // ── Page background controls ────────────────────────────────────────────
    const pageBgStatus = panel.querySelector('#admin-page-bg-status');

    function setPageBgStatus(msg, isErr) {
      if (!pageBgStatus) return;
      pageBgStatus.textContent = msg;
      pageBgStatus.style.color = isErr ? '#f87171' : '#b8c4e0';
    }

    function applyPageBgColor(hex) {
      document.body.style.background = hex;
      document.body.dataset.pageBgColor = hex;
      savePageToFile();
    }

    function clearPageBgColor() {
      document.body.style.background = '';
      delete document.body.dataset.pageBgColor;
      savePageToFile();
    }

    function applyPageBgImage(url) {
      document.body.style.backgroundImage = `url("${url}")`;
      document.body.style.backgroundSize = 'cover';
      document.body.style.backgroundPosition = 'center';
      document.body.style.backgroundRepeat = 'no-repeat';
      document.body.dataset.pageBgImage = url;
      savePageToFile();
    }

    function clearPageBgImage() {
      document.body.style.backgroundImage = '';
      document.body.style.backgroundSize = '';
      document.body.style.backgroundPosition = '';
      document.body.style.backgroundRepeat = '';
      delete document.body.dataset.pageBgImage;
      savePageToFile();
    }

    const colorInput = panel.querySelector('#admin-page-bg-color');
    if (colorInput && document.body.dataset.pageBgColor) {
      colorInput.value = document.body.dataset.pageBgColor;
    }

    panel.querySelector('#admin-page-bg-color-apply')?.addEventListener('click', () => {
      const hex = colorInput?.value || '#020816';
      applyPageBgColor(hex);
      setPageBgStatus('Color applied.', false);
    });

    panel.querySelector('#admin-page-bg-color-clear')?.addEventListener('click', () => {
      clearPageBgColor();
      setPageBgStatus('Color cleared.', false);
    });

    panel.querySelector('#admin-page-bg-image-upload')?.addEventListener('click', () => {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.style.display = 'none';
      document.body.appendChild(fileInput);
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        document.body.removeChild(fileInput);
        if (!file) return;
        setPageBgStatus('Uploading…', false);
        try {
          const url = await uploadAdminImage(file, 'page-background');
          applyPageBgImage(url);
          setPageBgStatus('Image applied.', false);
        } catch (err) {
          setPageBgStatus(err.message || 'Upload failed.', true);
        }
      });
      fileInput.click();
    });

    panel.querySelector('#admin-page-bg-image-clear')?.addEventListener('click', () => {
      clearPageBgImage();
      setPageBgStatus('Image removed.', false);
    });

    document.body.appendChild(panel);
    syncInspectorTop();
    state.inspectorPanel = panel;
    return panel;
  }

  function updateInspectorPanel(element) {
    const panel = ensureInspectorPanel();

    if (!state.editMode) {
      panel.style.display = 'none';
      state.inspectorShownFor = null;
      return;
    }
    panel.style.display = 'flex';
    syncInspectorTop();
    state.inspectorShownFor = element || null;

    const breadcrumb = panel.querySelector('#admin-panel-breadcrumb');
    const propsEmpty = panel.querySelector('#admin-panel-props-empty');
    const propsContent = panel.querySelector('#admin-panel-props-content');
    const styleEmpty = panel.querySelector('#admin-panel-style-empty');
    const styleContent = panel.querySelector('#admin-panel-style-content');
    const actionsEmpty = panel.querySelector('#admin-panel-actions-empty');
    const actionsContent = panel.querySelector('#admin-panel-actions-content');

    if (!element) {
      if (breadcrumb) breadcrumb.innerHTML = '<span style="color:#6b7fa8">Click any element to select it</span>';
      if (propsEmpty) propsEmpty.style.display = '';
      if (propsContent) propsContent.style.display = 'none';
      if (styleEmpty) styleEmpty.style.display = '';
      if (styleContent) styleContent.style.display = 'none';
      if (actionsEmpty) actionsEmpty.style.display = '';
      if (actionsContent) actionsContent.style.display = 'none';
      return;
    }

    if (propsEmpty) propsEmpty.style.display = 'none';
    if (propsContent) propsContent.style.display = '';
    if (styleEmpty) styleEmpty.style.display = 'none';
    if (styleContent) styleContent.style.display = '';
    if (actionsEmpty) actionsEmpty.style.display = 'none';
    if (actionsContent) actionsContent.style.display = '';

    const editableType = element.dataset.adminEditable || 'generic';
    const key = element.dataset.adminKey || '';
    const override = key ? (state.elementOverrides.get(key) || {}) : {};
    const isSectionRoot = isSectionRootEditable(element);
    const isPageRoot = editableType === 'page-root';

    // ── Breadcrumb ─────────────────────────────────────────────────────────
    if (breadcrumb) {
      const crumbs = ['<span class="admin-bc-item">Page</span>'];
      const ancestors = [];
      let cursor = element.parentElement;
      while (cursor && cursor !== document.body) {
        if (cursor.dataset && cursor.dataset.adminEditable) ancestors.unshift(cursor);
        cursor = cursor.parentElement;
      }
      ancestors.forEach((anc) => {
        crumbs.push(`<span class="admin-bc-sep">›</span><span class="admin-bc-item">${getElementKindLabel(anc)}</span>`);
      });
      crumbs.push(`<span class="admin-bc-sep">›</span><span class="admin-bc-item active">${getElementKindLabel(element)}</span>`);
      breadcrumb.innerHTML = crumbs.join('');
    }

    // ── Properties pane ────────────────────────────────────────────────────
    if (propsContent) {
      const kindClass = editableType === 'background-image' ? 'kind-section' :
                        (editableType === 'container' || editableType === 'generic') ? 'kind-container' :
                        editableType === 'text' ? 'kind-text' :
                        editableType === 'image' ? 'kind-image' :
                        editableType === 'page-root' ? 'kind-page' : 'kind-other';

      let html = `<div class="admin-panel-btn-row" style="margin-bottom:0.55rem;align-items:center;gap:0.4rem;">
        <span class="admin-kind-badge ${kindClass}">${getElementKindLabel(element)}</span>
        ${key ? `<span style="font-size:0.68rem;color:#6b7fa8;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${key}">${key}</span>` : ''}
      </div>`;

      if (isPageRoot) {
        html += `<p style="font-size:0.8rem;color:#b8c4e0;margin:0.3rem 0;">Select a section or element to edit it. Use the Insert buttons below to add content.</p>`;
      } else if (editableType === 'text') {
        const isSectionField = Boolean(element.dataset.adminSectionField);
        const currentText = element.dataset.adminSectionEmpty === 'true' ? '' : (element.textContent || '');
        html += `<div class="admin-panel-field">
          <label>${isSectionField ? 'Section Text' : 'Content'}</label>
          <textarea id="ap-text-content" rows="4">${currentText.replace(/&/g,'&amp;').replace(/</g,'&lt;').trim()}</textarea>
        </div>
        <div class="admin-panel-btn-row">
          <button type="button" class="admin-panel-btn primary" id="ap-save-text">Save Text</button>
          <button type="button" class="admin-panel-btn" id="ap-open-editor">Full Editor &#8599;</button>
        </div>`;
      } else if (editableType === 'image') {
        const imgSrc = element.src || element.dataset.src || '';
        html += `<div class="admin-panel-field">
          ${imgSrc ? `<img src="${imgSrc}" alt="" style="width:100%;max-height:110px;object-fit:cover;border-radius:8px;margin-bottom:0.45rem;" />` : '<p style="font-size:0.8rem;color:#8fa0c8;margin:0 0 0.45rem;">No image set.</p>'}
          <div class="admin-panel-btn-row">
            <button type="button" class="admin-panel-btn primary" id="ap-upload-image">&#128444; Upload</button>
            <button type="button" class="admin-panel-btn" id="ap-open-editor">Full Editor &#8599;</button>
          </div>
        </div>`;
      } else if (editableType === 'background-image') {
        // Show current background info and quick edit button
        const bgPath = element.dataset.adminImagePath || element.style.getPropertyValue('--dynamic-section-bg') || '';
        const hasBg = Boolean(bgPath && bgPath !== 'url("")');
        html += `<div class="admin-panel-field">
          ${hasBg ? `<p style="font-size:0.78rem;color:#b8c4e0;margin:0 0 0.4rem;">Background image is set.</p>` : `<p style="font-size:0.78rem;color:#8fa0c8;margin:0 0 0.4rem;">No background image set.</p>`}
          <div class="admin-panel-btn-row">
            <button type="button" class="admin-panel-btn primary" id="ap-edit-section-bg">&#128444; Edit Background</button>
          </div>
        </div>`;
      } else if (isSectionRoot) {
        html += `<p style="font-size:0.8rem;color:#b8c4e0;margin:0.3rem 0;">Section element. Use the <strong>Style</strong> tab to change appearance, or <strong>Actions</strong> tab to add, move, or delete.</p>`;
      } else {
        html += `<p style="font-size:0.8rem;color:#b8c4e0;margin:0.3rem 0;">Container element. Use the <strong>Style</strong> tab to change appearance.</p>`;
      }

      propsContent.innerHTML = html;

      // Wire: inline text save
      propsContent.querySelector('#ap-save-text')?.addEventListener('click', async () => {
        const textarea = propsContent.querySelector('#ap-text-content');
        if (!textarea) return;
        const nextValue = textarea.value;
        try {
          if (element.dataset.adminSectionField) {
            const sectionId = Number.parseInt(element.dataset.adminSectionId, 10);
            const field = element.dataset.adminSectionField;
            const item = await updatePageSection(sectionId, field, nextValue);
            upsertPageSection(item);
            renderPageSections();
            registerSectionEditing();
          } else {
            element.textContent = nextValue;
            element.classList.remove('admin-empty-section-field');
            delete element.dataset.adminSectionEmpty;
            await saveElementOverride(key, {});
          }
        } catch (err) {
          alert(err.message || 'Save failed.');
        }
      });

      // Wire: image upload
      propsContent.querySelector('#ap-upload-image')?.addEventListener('click', () => {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);
        fileInput.addEventListener('change', async () => {
          const file = fileInput.files && fileInput.files[0];
          document.body.removeChild(fileInput);
          if (!file) return;
          try {
            const url = await uploadAdminImage(file, 'content');
            element.src = url;
            element.removeAttribute('srcset');
            await saveElementOverride(key, { imageSrc: url });
            updateInspectorPanel(element);
          } catch (err) {
            alert(err.message || 'Upload failed.');
          }
        });
        fileInput.click();
      });

      // Wire: edit section background
      propsContent.querySelector('#ap-edit-section-bg')?.addEventListener('click', () => {
        openEditorForSelectedElement(element, 'edit');
      });

      // Wire: open full editor modal
      propsContent.querySelector('#ap-open-editor')?.addEventListener('click', () => {
        openEditorForSelectedElement(element, 'edit');
      });
    }

    // ── Style pane — pre-fill from override ──────────────────────────────
    if (styleContent) {
      const setVal = (id, v) => { const el2 = styleContent.querySelector(`#${id}`); if (el2) el2.value = v || ''; };
      setVal('ap-text-align', override.textAlign);
      setVal('ap-font-family', override.fontFamily);
      setVal('ap-font-weight', override.fontWeight);
      setVal('ap-font-style', override.fontStyle);
      setVal('ap-text-transform', override.textTransform);
      setVal('ap-font-size', override.fontSize);
      setVal('ap-opacity', override.opacityValue);
      setVal('ap-bg-opacity', override.backgroundOpacityValue);
      setVal('ap-width', override.widthValue);
      setVal('ap-height', override.heightValue);
      setVal('ap-border-style', override.borderStyle);
      setVal('ap-border-width', override.borderWidth);
      setVal('ap-border-radius', override.borderRadius);

      const textColorEl = styleContent.querySelector('#ap-text-color');
      if (textColorEl) {
        textColorEl.dataset.isReset = override.textColor ? 'false' : 'true';
        if (override.textColor) textColorEl.value = override.textColor;
      }
      const bgColorEl = styleContent.querySelector('#ap-bg-color');
      if (bgColorEl) {
        bgColorEl.dataset.isReset = override.backgroundColor ? 'false' : 'true';
        if (override.backgroundColor) bgColorEl.value = override.backgroundColor;
      }
      const borderColorEl = styleContent.querySelector('#ap-border-color');
      if (borderColorEl) {
        borderColorEl.dataset.isReset = override.borderColor ? 'false' : 'true';
        if (override.borderColor) borderColorEl.value = override.borderColor;
      }
    }

    // ── Actions pane ───────────────────────────────────────────────────────
    if (actionsContent) {
      const isHidden = Boolean(override.hidden && !override.deleted);
      const isDeleted = Boolean(override.deleted);
      const duplicateAllowed = !element.dataset.adminSectionField && (editableType === 'text' || editableType === 'image');
      const deleteAllowed = editableType !== 'album-root' && editableType !== 'page-root';
      const parentAllowed = Boolean(getParentEditableElement(element));
      const isFreePos = override.position_mode === 'absolute';

      const allSections = Array.from(document.querySelectorAll('[data-admin-editable="background-image"],[data-admin-editable="page-root"]'));
      const sectionOptions = allSections.map((s, i) => {
        const heading = s.querySelector('h1,h2,h3,h4,h5,h6');
        const label = heading ? heading.textContent.trim().slice(0, 40) : `Section ${i + 1}`;
        return `<option value="${i}">${label}</option>`;
      }).join('');

      let html = '';

      if (!isPageRoot) {
        html += `<div class="admin-panel-section-title">Edit</div>
        <div class="admin-panel-btn-row">
          <button type="button" class="admin-panel-btn" data-inspector-action="edit">&#9998; Edit Content</button>
          <button type="button" class="admin-panel-btn" data-inspector-action="style">&#9635; Full Style</button>
        </div>`;
      }

      if (!isPageRoot && !isSectionRoot) {
        html += `<div class="admin-panel-section-title">Move to Section</div>
        <div class="admin-panel-field">
          <select id="ap-move-to-section">${sectionOptions || '<option>No sections found</option>'}</select>
        </div>
        <div class="admin-panel-btn-row">
          <button type="button" class="admin-panel-btn" id="ap-do-move">Move Here</button>
          ${parentAllowed ? '<button type="button" class="admin-panel-btn" data-inspector-action="parent">&#8679; Parent</button>' : ''}
        </div>`;
      }

      if (isSectionRoot || isPageRoot) {
        html += `<div class="admin-panel-section-title">Section</div>
        <div class="admin-panel-btn-row">
          ${isPageRoot ? '<button type="button" class="admin-panel-btn" data-inspector-action="add-before">+ Add Section</button>' : ''}
          ${isSectionRoot ? '<button type="button" class="admin-panel-btn" data-inspector-action="add-before">+ Before</button>' : ''}
          ${isSectionRoot ? '<button type="button" class="admin-panel-btn" data-inspector-action="add-after">+ After</button>' : ''}
          ${isSectionRoot ? '<button type="button" class="admin-panel-btn danger" data-inspector-action="remove-section">&#10006; Remove Section</button>' : ''}
        </div>`;
      }

      if (!isPageRoot) {
        html += `<div class="admin-panel-section-title">Visibility &amp; Position</div>
        <div class="admin-panel-btn-row">
          <button type="button" class="admin-panel-btn${isFreePos ? ' primary' : ''}" data-inspector-action="move">${isFreePos ? '&#9650; Fixed' : '&#8660; Free Position'}</button>
          ${isFreePos ? '<button type="button" class="admin-panel-btn" data-inspector-action="position-reset">Reset</button>' : ''}
        </div>
        <div class="admin-panel-btn-row">
          ${isDeleted
            ? '<button type="button" class="admin-panel-btn" data-inspector-action="restore">&#9099; Restore</button>'
            : isHidden
              ? '<button type="button" class="admin-panel-btn" data-inspector-action="restore">&#9679; Show</button>'
              : '<button type="button" class="admin-panel-btn" data-inspector-action="hide">&#9675; Hide</button>'}
        </div>`;
      }

      if (deleteAllowed || duplicateAllowed) {
        html += `<div class="admin-panel-section-title">Element</div>
        <div class="admin-panel-btn-row">
          ${duplicateAllowed ? '<button type="button" class="admin-panel-btn" data-inspector-action="duplicate">&#10064; Duplicate</button>' : ''}
          ${deleteAllowed ? '<button type="button" class="admin-panel-btn danger" data-inspector-action="delete">&#10006; Delete</button>' : ''}
        </div>`;
      }

      actionsContent.innerHTML = html;

      // Wire: Edit Content and Full Style buttons directly (element from closure)
      actionsContent.querySelector('[data-inspector-action="edit"]')?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openEditorForSelectedElement(element, 'edit');
      });
      actionsContent.querySelector('[data-inspector-action="style"]')?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openEditorForSelectedElement(element, 'style');
      });

      // Wire: move-to-section
      actionsContent.querySelector('#ap-do-move')?.addEventListener('click', () => {
        const select = actionsContent.querySelector('#ap-move-to-section');
        if (!select) return;
        const targetSection = allSections[Number(select.value)];
        if (!targetSection) return;
        // moveDraggedTextToSection relies on state.draggedTextElement
        state.draggedTextElement = element;
        moveDraggedTextToSection(targetSection);
        scheduleEditorSync();
      });
    }
  }

  function scheduleEditorSync() {
    if (state.editorSyncTimer || state.isSyncingEditorState || !state.editMode) return;
    state.editorSyncTimer = window.setTimeout(() => {
      state.editorSyncTimer = null;
      if (!state.editMode) return;

      state.isSyncingEditorState = true;
      try {
        registerEditableElements();
        applyElementOverrides();
        registerSectionEditing();

        const current = getSelectedEditableElement();
        const target = current || document.querySelector('main[data-admin-editable="page-root"]') || null;
        // Skip re-rendering the inspector panel when the selection hasn't changed.
        // Re-rendering recreates the panel buttons under the cursor and drops the
        // in-flight click, which is what made the editor feel sluggish / require
        // multiple clicks to register.
        if (target !== state.inspectorShownFor) {
          updateInspectorPanel(target);
        }
      } finally {
        state.isSyncingEditorState = false;
      }
    }, 60);
  }

  function ensureEditorDomObserver() {
    if (state.domObserver) return state.domObserver;
    const root = document.body;
    if (!root) return null;

    const observer = new MutationObserver((mutations) => {
      if (!state.editMode || state.isSyncingEditorState) return;
      // Only react to structural DOM changes (elements added/removed).
      // Attribute changes — including class (admin-current-selection), style (cursor),
      // and data-admin-* (set by registerEditableElements) — must NOT trigger a sync
      // because they fire mid-tap and destroy direct event listeners on panel buttons
      // before the click event arrives, making inspector buttons unresponsive.
      // Ignore mutations that originate from the editor's OWN UI (the inspector
      // panel, element toolbar, selection overlay, modals). Re-rendering the panel in
      // response to its own DOM changes creates a feedback loop that re-creates the
      // very buttons being clicked, so the first click is lost and the editor feels
      // sluggish / requires several clicks to register.
      const hasRealDomChange = mutations.some((m) => {
        if (m.type !== 'childList') return false;
        if (m.addedNodes.length === 0 && m.removedNodes.length === 0) return false;
        if (isInsideAdminUi(m.target)) return false;
        return true;
      });
      if (!hasRealDomChange) return;
      scheduleEditorSync();
    });

    observer.observe(root, {
      childList: true,
      subtree: true,
    });
    state.domObserver = observer;
    return observer;
  }

  function isSectionRootEditable(element) {
    if (!element || !element.dataset) return false;
    return element.dataset.adminSectionType === 'static' || element.dataset.adminDynamicSection === 'true';
  }

  function getSectionKindFromElement(element) {
    if (!isSectionRootEditable(element)) return null;
    return element.dataset.adminDynamicSection === 'true' ? 'dynamic' : 'static';
  }

  function getElementKindLabel(element) {
    if (!element) return 'Element';
    if (element.dataset && element.dataset.adminEditable === 'page-root') {
      return 'Page';
    }
    if (isSectionRootEditable(element)) {
      return element.dataset.adminDynamicSection === 'true' ? 'Dynamic Section' : 'Section';
    }

    const type = element.dataset.adminEditable;
    if (type === 'text') return 'Text';
    if (type === 'image') return 'Image';
    if (type === 'background-image') return 'Background';
    if (type === 'container') return 'Container';
    if (type === 'generic') return 'Element';
    if (type === 'album-root') return 'Albums';
    return 'Element';
  }

  async function performEditorAction(action, element) {
    if (!element) return;

    if (action === 'edit' || action === 'style') {
      openEditorForSelectedElement(element, action);
      return;
    }

    if (action === 'move') {
      await enableMoveForElement(element);
      updateInspectorPanel(element);
      return;
    }

    if (action === 'add-text' || action === 'add-image' || action === 'add-container' || action === 'add-before' || action === 'add-after' || action === 'remove-section') {
      const isPageRoot = element.dataset.adminEditable === 'page-root';
      if (!isSectionRootEditable(element) && !isPageRoot) return;
      const kind = getSectionKindFromElement(element);
      if (!kind && !isPageRoot) return;

      if (isPageRoot) {
        if (action === 'add-text') await insertIntoTarget(element, 'text');
        if (action === 'add-image') await insertIntoTarget(element, 'image');
        if (action === 'add-container') await insertIntoTarget(element, 'container');
        if (action === 'add-before' || action === 'add-after') await insertIntoTarget(element, 'section');
        scheduleEditorSync();
        hideElementToolbar();
        return;
      }

      if (action === 'add-text') {
        await addNewTextElement(element, kind);
        registerEditableElements();
        applyElementOverrides();
        registerSectionEditing();
        scheduleEditorSync();
        hideElementToolbar();
        return;
      }

      if (action === 'add-image') {
        await addNewImageElement(element, kind);
        registerEditableElements();
        applyElementOverrides();
        registerSectionEditing();
        scheduleEditorSync();
        hideElementToolbar();
        return;
      }

      if (action === 'add-container') {
        await addContainerToSection(element);
        scheduleEditorSync();
        hideElementToolbar();
        return;
      }

      if (action === 'add-before' || action === 'add-after') {
        const insertPosition = action === 'add-before' ? 'before' : 'after';
        if (kind === 'dynamic') {
          openAddSectionModal({
            relativeSectionId: Number.parseInt(element.dataset.adminSectionId, 10),
            insertPosition,
          });
        } else {
          openAddSectionModal({
            relativeStaticSectionKey: element.dataset.adminStaticSectionKey,
            insertPosition,
          });
        }
        hideElementToolbar();
        return;
      }

      if (action === 'remove-section') {
        if (kind === 'dynamic') {
          await removeSection(Number.parseInt(element.dataset.adminSectionId, 10));
        } else {
          await hideStaticSection(element);
        }
        scheduleEditorSync();
        hideElementToolbar();
      }
      return;
    }

    if (action === 'parent') {
      const parent = getParentEditableElement(element);
      if (!parent) return;
      document.querySelectorAll('.admin-current-selection').forEach((n) => n.classList.remove('admin-current-selection'));
      parent.classList.add('admin-current-selection');
      state.selectedEditableElement = parent;
      updateInspectorPanel(parent);
      return;
    }

    if (action === 'duplicate') {
      await duplicateSelectedElement(element);
      scheduleEditorSync();
      return;
    }

    if (action === 'restore') {
      const key = element.dataset.adminKey;
      if (!key) return;
      const item = await saveElementOverride(key, { hidden: false, deleted: false });
      setAdminHiddenState(element, false, false);
      applyElementStyles(element, item);
      scheduleEditorSync();
      updateInspectorPanel(element);
      return;
    }

    if (action === 'hide') {
      const key = element.dataset.adminKey;
      if (!key) return;
      const currentOvr = state.elementOverrides.get(key) || {};
      const isHidden = Boolean(currentOvr.hidden && !currentOvr.deleted);
      await saveElementOverride(key, { hidden: !isHidden, deleted: false });
      setAdminHiddenState(element, !isHidden, false);
      updateInspectorPanel(element);
      return;
    }

    if (action === 'position-reset') {
      const key = element.dataset.adminKey;
      if (!key) return;
      const item = await saveElementOverride(key, { positionMode: 'flow', posX: null, posY: null });
      applyElementStyles(element, item);
      updateInspectorPanel(element);
      return;
    }

    if (action === 'delete') {
      if (!window.confirm('Delete this selected element?')) return;
      await deleteSelectedElement(element);
      scheduleEditorSync();
      hideElementToolbar();
    }
  }

  function ensureElementToolbar() {
    if (state.elementToolbar) return state.elementToolbar;

    const toolbar = document.createElement('div');
    toolbar.className = 'admin-element-toolbar';
    toolbar.innerHTML = `
      <span class="admin-element-kind" data-role="kind">Element</span>
      <button type="button" data-action="edit">Edit</button>
      <button type="button" data-action="style">Style</button>
      <button type="button" data-action="add-text">+Text</button>
      <button type="button" data-action="add-image">+Image</button>
      <button type="button" data-action="add-container">+Container</button>
      <button type="button" data-action="add-before">+Before</button>
      <button type="button" data-action="add-after">+After</button>
      <button type="button" data-action="remove-section" style="color:#ffb1b1;">Section Delete</button>
      <button type="button" data-action="parent">Parent</button>
      <button type="button" data-action="move">Move</button>
      <button type="button" data-action="duplicate">Duplicate</button>
      <button type="button" data-action="restore" style="color:#9ef3b0;">Restore</button>
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

      try {
        await performEditorAction(button.dataset.action, element);
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

    if (editableType === 'page-root') {
      if (action === 'style') {
        openContainerEditor(element);
      } else {
        alert('Use the page actions to add sections and start building the page.');
      }
      return;
    }

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

    if (editableType === 'generic') {
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
    // Compute absolute coordinates relative to the element's own positioning
    // context (container/section), matching the free-drag model.
    const ctx = getPositioningContext(element);
    const ctxRect = ctx.getBoundingClientRect();
    const elemRect = element.getBoundingClientRect();
    const item = await saveElementOverride(key, {
      hidden: false,
      deleted: false,
      positionMode: 'absolute',
      posX: Number.isFinite(override.pos_x) ? override.pos_x : Math.round(elemRect.left - ctxRect.left),
      posY: Number.isFinite(override.pos_y) ? override.pos_y : Math.round(elemRect.top - ctxRect.top),
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
        const sectionId = Number.parseInt(element.dataset.adminSectionId, 10);
        const field = element.dataset.adminSectionField;
        if (!['title', 'body'].includes(field)) {
          throw new Error('Delete is not supported for this section field.');
        }
        const item = await updatePageSection(sectionId, field, '');
        upsertPageSection(item);
        renderPageSections();
        registerSectionEditing();
        return;
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
        persistDeletedImageCache(key, false);
      } else {
        if (editableType === 'background-image') {
          await saveContentUpdate({
            contentKey: key,
            contentType: 'image',
            contentValue: '',
          });
          applyContentItem({
            content_key: key,
            content_type: 'image',
            content_value: '',
            updated_at: new Date().toISOString(),
          });
          return;
        }

        const item = await saveContentUpdate({
          contentKey: key,
          contentType: 'image',
          contentValue: '__deleted__',
        });
        applyContentItem(item);
        return;
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

    if (editableType === 'generic') {
      const key = element.dataset.adminKey;
      if (!key) return;
      await saveElementOverride(key, { hidden: true, deleted: true });
      element.remove();
      state.registry.delete(`generic:${key}`);
      return;
    }

    throw new Error('Delete is not supported for this element type.');
  }

  function showElementToolbarFor(element, clientX, clientY) {
    if (!state.editMode || !element) return;
    const toolbar = ensureElementToolbar();
    document.querySelectorAll('.admin-current-selection').forEach((node) => node.classList.remove('admin-current-selection'));
    element.classList.add('admin-current-selection');
    state.selectedEditableElement = element;
    showSelectionHandleOverlay(element);
    updateInspectorPanel(element);

    const type = element.dataset.adminEditable || '';
    const isSectionField = Boolean(element.dataset.adminSectionField);
    const isSectionRoot = isSectionRootEditable(element);
    const isPageRoot = type === 'page-root';
    const key = element.dataset.adminKey;
    const override = key ? state.elementOverrides.get(key) : null;
    const restoreAllowed = Boolean(override && (override.hidden || override.deleted));
    const duplicateAllowed = !isSectionField && (type === 'text' || type === 'image');
    const deleteAllowed = type !== 'album-root' && type !== 'page-root';
    const parentAllowed = Boolean(getParentEditableElement(element));
    const sectionActionsAllowed = isSectionRoot || isPageRoot;

    const kindLabel = toolbar.querySelector('[data-role="kind"]');
    const editButton = toolbar.querySelector('button[data-action="edit"]');
    const styleButton = toolbar.querySelector('button[data-action="style"]');
    const addTextButton = toolbar.querySelector('button[data-action="add-text"]');
    const addImageButton = toolbar.querySelector('button[data-action="add-image"]');
    const addContainerButton = toolbar.querySelector('button[data-action="add-container"]');
    const addBeforeButton = toolbar.querySelector('button[data-action="add-before"]');
    const addAfterButton = toolbar.querySelector('button[data-action="add-after"]');
    const removeSectionButton = toolbar.querySelector('button[data-action="remove-section"]');
    const parentButton = toolbar.querySelector('button[data-action="parent"]');
    const duplicateButton = toolbar.querySelector('button[data-action="duplicate"]');
    const restoreButton = toolbar.querySelector('button[data-action="restore"]');
    const deleteButton = toolbar.querySelector('button[data-action="delete"]');
    if (kindLabel) kindLabel.textContent = getElementKindLabel(element);
    if (editButton) editButton.style.display = isPageRoot ? 'none' : 'inline-flex';
    if (styleButton) styleButton.style.display = isPageRoot ? 'none' : 'inline-flex';
    if (addTextButton) addTextButton.style.display = sectionActionsAllowed ? 'inline-flex' : 'none';
    if (addImageButton) addImageButton.style.display = sectionActionsAllowed ? 'inline-flex' : 'none';
    if (addContainerButton) addContainerButton.style.display = sectionActionsAllowed ? 'inline-flex' : 'none';
    if (addBeforeButton) addBeforeButton.style.display = sectionActionsAllowed ? 'inline-flex' : 'none';
    if (addAfterButton) addAfterButton.style.display = isSectionRoot ? 'inline-flex' : 'none';
    if (removeSectionButton) removeSectionButton.style.display = isSectionRoot ? 'inline-flex' : 'none';
    if (addBeforeButton) addBeforeButton.textContent = isPageRoot ? '+Section' : '+Before';
    if (parentButton) parentButton.disabled = !parentAllowed;
    if (duplicateButton) duplicateButton.disabled = !duplicateAllowed;
    if (restoreButton) {
      restoreButton.style.display = restoreAllowed ? 'inline-flex' : 'none';
      restoreButton.disabled = !restoreAllowed;
    }
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
            persistDeletedImageCache(key, false);
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

        const item = await saveContentUpdate({
          contentKey: key,
          contentType: 'image',
          contentValue: '__deleted__',
        });
        applyContentItem(item);
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
      registerEditableElements();
      applyElementOverrides();
      registerSectionEditing();
    } catch (error) {
      alert(error.message);
    }
  }

  function removeDynamicSectionFromDom(sectionId) {
    document.querySelectorAll(`[data-admin-dynamic-section="true"][data-admin-section-id="${sectionId}"]`)
      .forEach((node) => node.remove());
  }

  async function removeSection(sectionId) {
    const confirmed = window.confirm('Remove this section from the page?');
    if (!confirmed) return;

    await deletePageSection(sectionId);
    state.pageSections = state.pageSections.filter((section) => section.id !== sectionId);
    // Remove the DOM node directly so orphaned sections (those reparented outside the
    // host) are deleted too, not just the ones tracked in state.
    removeDynamicSectionFromDom(sectionId);
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
    disableLegacySectionControls();
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
        ? Array.from(parent.children).filter((element) => element.dataset.adminSectionType === 'static' && element.dataset.adminDynamicSection !== 'true')
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
    return element.closest('[data-admin-section-type="static"], [data-admin-dynamic-section="true"]');
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
          newElement.style.backgroundColor = getPageBackgroundColor();
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
    beginSaveAttempt();
    try {
      const token = getStoredToken();
      const { response, data } = await fetchWithRetry('/api/admin/content/new', {
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

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create element');
      }

      finishSaveAttempt(true);
      return data.item;
    } catch (error) {
      finishSaveAttempt(false, error.message);
      throw error;
    }
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

  function disableLegacySectionControls() {
    document.querySelectorAll('.admin-section-tools').forEach((tools) => {
      tools.remove();
    });

    const sections = [
      ...getStaticSectionToolTargets(),
      ...Array.from(document.querySelectorAll('[data-admin-dynamic-section="true"]')),
    ];

    sections.forEach((section) => {
      section.draggable = false;
      delete section.dataset.adminDragBound;
      section.removeAttribute('data-admin-drag-target');
      section.removeAttribute('data-admin-drag-position');
      section.removeAttribute('data-admin-text-drop-target');
    });
  }

  function disableLegacyTextDrag() {
    state.draggedTextElement = null;
    clearTextDragTargets();
    document.querySelectorAll('[data-admin-editable="text"]').forEach((element) => {
      element.draggable = false;
    });
  }

  function registerSectionEditing() {
    getStaticSectionToolTargets().forEach((section, index) => {
      ensureStaticSectionKey(section, index);
    });

    disableLegacySectionControls();
    disableLegacyTextDrag();
  }

  function findFreeDragTarget(source) {
    if (!source || !state.editMode) return null;
    if (isInsideAdminUi(source)) return null;
    // Never begin a free-drag from an interactive control (button, input, link, …).
    // Otherwise clicking a control inside an editable element — e.g. a section's
    // "Remove Section" button — would start a drag and swallow the click, making
    // buttons feel sluggish/unresponsive.
    if (source.closest('button, input, select, textarea, a, label, [data-admin-remove-section]')) return null;
    const candidate = source.closest('[data-admin-editable="text"], [data-admin-editable="image"], [data-admin-editable="background-image"], [data-admin-editable="container"], [data-admin-editable="generic"], [data-admin-editable="album-root"]');
    if (!candidate) return null;
    if (!candidate.dataset.adminKey) return null;
    if (isInsideAdminUi(candidate)) return null;
    // Section roots are managed by the section-reorder system, not free-drag.
    // Free-dragging a section root reparents it out of its container and orphans it,
    // after which it can no longer be deleted or reordered normally.
    if (candidate.dataset.adminDynamicSection === 'true' || candidate.dataset.adminSectionType === 'static') return null;
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
    document.querySelectorAll('[data-admin-editable="text"], [data-admin-editable="image"], [data-admin-editable="background-image"], [data-admin-editable="container"], [data-admin-editable="generic"], [data-admin-editable="album-root"]').forEach((element) => {
      element.style.cursor = '';
    });
  }

  // Position an element absolutely relative to its OWN positioned ancestor
  // (usually its direct container/section). Keeping the element inside its
  // original parent — instead of reparenting it into <main> — avoids large,
  // unexpected layout shifts and lets sibling elements reflow predictably when
  // the element leaves normal flow.
  function getPositioningContext(target) {
    let ctx = target.parentElement;
    while (ctx && ctx !== document.body) {
      const pos = window.getComputedStyle(ctx).position;
      if (pos === 'relative' || pos === 'absolute' || pos === 'fixed' || pos === 'sticky') return ctx;
      ctx = ctx.parentElement;
    }
    // No positioned ancestor — make the direct parent the positioning context.
    return target.parentElement || document.body;
  }

  function ensureAbsoluteForFreeDrag(target, override) {
    if (!target) return;

    if (override.position_mode !== 'absolute') {
      if (target.dataset.adminEditable === 'album-root') {
        ensureAlbumRootPlaceholder(target);
      }
      // Establish a positioning context on the element's own parent so the
      // absolute coordinates are local to that container (predictable movement).
      const ctx = getPositioningContext(target);
      if (ctx !== document.body && window.getComputedStyle(ctx).position === 'static') {
        ctx.style.position = 'relative';
      }
      const rect = target.getBoundingClientRect();
      const ctxRect = ctx.getBoundingClientRect();
      const posX = Math.round(rect.left - ctxRect.left);
      const posY = Math.round(rect.top  - ctxRect.top);
      target.style.position = 'absolute';
      target.style.left = `${posX}px`;
      target.style.top  = `${posY}px`;
      target.style.margin = '0';
      target.style.zIndex = target.dataset.adminEditable === 'text' ? '12' : '8';
      target.classList.add('admin-free-positioned');
    }
  }

  // Text elements reorder in normal document flow (not absolute positioning)
  // so sibling text reflows to make room — the predictable, professional
  // behaviour users expect when rearranging paragraphs/headings.
  function beginTextReorderDrag(target, event) {
    const key = target.dataset.adminKey;
    if (!key) return;

    let dragInitialized = false;
    let didMove = false;
    state.draggingElement = target;
    state.dragStartX = event.clientX;
    state.dragStartY = event.clientY;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'move';

    // Placeholder that occupies the dragged text's space and reflows siblings.
    const placeholder = document.createElement(target.tagName || 'p');
    placeholder.className = target.className;
    placeholder.classList.add('admin-drag-placeholder');
    placeholder.style.height = `${target.offsetHeight}px`;
    placeholder.style.marginTop = window.getComputedStyle(target).marginTop;
    placeholder.style.marginBottom = window.getComputedStyle(target).marginBottom;
    placeholder.dataset.adminDragPlaceholder = 'true';

    const parent = target.parentElement;
    const siblings = () => Array.from(parent.children).filter(
      (el) => el !== target && el !== placeholder && el.dataset && el.dataset.adminEditable === 'text' && !isInsideAdminUi(el)
    );

    const positionPlaceholder = (clientY) => {
      const list = siblings();
      if (list.length === 0) {
        parent.insertBefore(placeholder, target.nextSibling === placeholder ? target : target.nextSibling);
        return;
      }
      let inserted = false;
      for (const el of list) {
        const r = el.getBoundingClientRect();
        if (clientY < r.top + r.height / 2) {
          parent.insertBefore(placeholder, el);
          inserted = true;
          break;
        }
      }
      if (!inserted) parent.appendChild(placeholder);
    };

    const onMove = (moveEvent) => {
      if (!state.draggingElement) return;
      const rawDx = moveEvent.clientX - state.dragStartX;
      const rawDy = moveEvent.clientY - state.dragStartY;
      if (!dragInitialized && (Math.abs(rawDx) > 3 || Math.abs(rawDy) > 3)) {
        dragInitialized = true;
        // Hide the original; the placeholder takes its place and reflows siblings.
        target.style.display = 'none';
        parent.insertBefore(placeholder, target);
        removeSelectionHandleOverlay();
        const canvas = document.querySelector('main');
        if (canvas) canvas.dataset.adminCanvasDropzone = 'true';
      }
      if (!dragInitialized) return;
      didMove = true;
      positionPlaceholder(moveEvent.clientY);
    };

    const onUp = async () => {
      window.removeEventListener('pointermove', onMove);
      const dragged = state.draggingElement;
      state.draggingElement = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      const canvas = document.querySelector('main');
      if (canvas) delete canvas.dataset.adminCanvasDropzone;
      if (!dragged) return;

      if (!dragInitialized) return; // treated as a plain click (selection)

      if (didMove) state.suppressEditClickUntil = Date.now() + 300;

      try {
        // Drop the text at the placeholder location, back in normal flow.
        if (placeholder.parentElement) {
          placeholder.parentElement.insertBefore(dragged, placeholder);
        }
        placeholder.remove();
        dragged.style.display = '';
        dragged.classList.remove('admin-is-dragging', 'admin-free-positioned');
        // Clear any stale absolute positioning so it sits in flow.
        dragged.style.position = '';
        dragged.style.left = '';
        dragged.style.top = '';
        dragged.style.margin = '';
        dragged.style.zIndex = '';
        const item = await saveElementOverride(key, {
          hidden: false,
          deleted: false,
          positionMode: 'flow',
          posX: null,
          posY: null,
        });
        applyElementStyles(dragged, item);
        registerEditableElements();
      } catch (error) {
        alert(error.message);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }

  // forcedResizeEdges: pass edge string (e.g. 'se') when called from a handle widget
  function beginFreeDrag(target, event, forcedResizeEdges = null) {
    const key = target.dataset.adminKey;
    if (!key) return;

    const override = state.elementOverrides.get(key) || {};
    const resizeEdges = forcedResizeEdges || getResizeEdges(target, event);
    const isResizeAction = Boolean(resizeEdges);
    const activeCursor = isResizeAction ? getCursorForEdges(resizeEdges) : 'move';

    // Text elements reorder in flow (siblings reflow) rather than going absolute.
    if (!isResizeAction && target.dataset.adminEditable === 'text') {
      beginTextReorderDrag(target, event);
      return;
    }

    let startLeft = 0;
    let startTop = 0;
    let startWidth = 0;
    let startHeight = 0;
    let didMove = false;
    let dragInitialized = false;

    state.draggingElement = target;
    state.dragStartX = event.clientX;
    state.dragStartY = event.clientY;
    // Prevent text selection while the pointer is held down
    document.body.style.userSelect = 'none';
    document.body.style.cursor = activeCursor;
    const canvas = document.querySelector('main');

    const onMove = (moveEvent) => {
      if (!state.draggingElement) return;
      const rawDx = moveEvent.clientX - state.dragStartX;
      const rawDy = moveEvent.clientY - state.dragStartY;

      // Defer making the element absolute until the pointer has actually moved
      if (!dragInitialized && (Math.abs(rawDx) > 3 || Math.abs(rawDy) > 3)) {
        dragInitialized = true;
        ensureAbsoluteForFreeDrag(target, override);
        startLeft = Number.parseFloat(target.style.left || `${target.offsetLeft}`) || 0;
        startTop = Number.parseFloat(target.style.top || `${target.offsetTop}`) || 0;
        startWidth = Math.max(minResizableWidth, target.offsetWidth);
        startHeight = Math.max(minResizableHeight, target.offsetHeight);
        state.dragOriginX = startLeft;
        state.dragOriginY = startTop;
        target.classList.add('admin-is-dragging');
        removeSelectionHandleOverlay();
        if (canvas) canvas.dataset.adminCanvasDropzone = 'true';
      }
      if (!dragInitialized) return;

      const dx = moveEvent.clientX - state.dragStartX;
      const dy = moveEvent.clientY - state.dragStartY;
      didMove = true;

      let nextX = state.dragOriginX;
      let nextY = state.dragOriginY;
      let nextWidth = startWidth;
      let nextHeight = startHeight;

      if (!isResizeAction) {
        // No floor — element can move freely above/left of its origin (page-wide movement)
        nextX = state.dragOriginX + dx;
        nextY = state.dragOriginY + dy;
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
      }

      state.draggingElement.style.left = `${snapToGrid(nextX)}px`;
      state.draggingElement.style.top = `${snapToGrid(nextY)}px`;
      if (isResizeAction) {
        state.draggingElement.style.width = `${snapToGrid(nextWidth)}px`;
        state.draggingElement.style.height = `${snapToGrid(nextHeight)}px`;
      }
    };

    const onUp = async () => {
      window.removeEventListener('pointermove', onMove);
      const dragged = state.draggingElement;
      state.draggingElement = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      if (!dragged) return;
      if (canvas) delete canvas.dataset.adminCanvasDropzone;
      dragged.classList.remove('admin-is-dragging');

      if (!dragInitialized) {
        // Pointer released without meaningful movement — treat as a plain click,
        // let the click event (which we did not preventDefault) handle selection.
        return;
      }

      if (didMove) {
        // Suppress the synthetic click that fires after pointerup
        state.suppressEditClickUntil = Date.now() + 300;
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

  function bindFreeDragHandlers() { /* BFD_FOUND */
    if (state.freeDragHandlersBound) return;
    state.freeDragHandlersBound = true;

    let _lastHoverTarget = null;
    let _lastHoverCursor = null;
    document.addEventListener('pointermove', (event) => {
      if (!state.editMode || state.draggingElement) return;

      const target = findFreeDragTarget(event.target);
      if (!target) {
        if (_lastHoverTarget) { _lastHoverTarget.style.cursor = ''; _lastHoverTarget = null; }
        if (_lastHoverCursor !== '') { document.body.style.cursor = ''; _lastHoverCursor = ''; }
        return;
      }

      const edges = getResizeEdges(target, event);
      // Show resize cursor near edges; show the move cursor over the rest of the
      // element so it is clear the element can be dragged by click-and-hold.
      const cursor = edges ? getCursorForEdges(edges) : 'move';
      // Only write style when value actually changes to avoid spurious MutationObserver firings
      if (target !== _lastHoverTarget || cursor !== _lastHoverCursor) {
        if (_lastHoverTarget && _lastHoverTarget !== target) _lastHoverTarget.style.cursor = '';
        target.style.cursor = cursor;
        document.body.style.cursor = cursor;
        _lastHoverTarget = target;
        _lastHoverCursor = cursor;
      }
    }, true);

    document.addEventListener('pointerdown', (event) => {
      if (!state.editMode) return;
      if (event.button !== 0) return;

      const target = findFreeDragTarget(event.target);
      if (!target) return;

      // Click-and-hold anywhere on an editable element starts a free move/resize.
      // Resizing is initiated when the pointer is near an edge; otherwise it is a move.
      const resizeEdges = getResizeEdges(target, event);
      const isResizeAction = Boolean(resizeEdges);

      // Do NOT call event.preventDefault() here — that would swallow the click event
      // and prevent element selection when the user taps without dragging. A plain
      // click (no movement) is treated as a normal selection by beginFreeDrag's
      // pointerup handler, which returns early without making the element absolute.
      // Text-selection is blocked via body.style.userSelect inside beginFreeDrag instead.
      event.stopPropagation();
      beginFreeDrag(target, event, isResizeAction ? resizeEdges : null);
    }, true);
  }

  async function openSourceCodeEditor() {
    // Remove any existing instance
    const existing = document.getElementById('admin-code-editor-backdrop');
    if (existing) { existing.remove(); return; }

    const pagePath = state.pagePath === '/' ? '/index.html' : state.pagePath;
    const cssPath = '/styles.css';
    const token = getStoredToken();

    async function fetchSource(filePath) {
      const res = await fetch(`/api/admin/file-source?path=${encodeURIComponent(filePath)}`, {
        headers: { Authorization: 'Bearer ' + token },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load file');
      return data.content;
    }

    async function saveSource(filePath, content) {
      const res = await fetch('/api/admin/file-source', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ path: filePath, content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save file');
    }

    const backdrop = document.createElement('div');
    backdrop.id = 'admin-code-editor-backdrop';
    backdrop.className = 'admin-code-editor-backdrop';

    backdrop.innerHTML = `
      <div class="admin-code-editor-modal" role="dialog" aria-modal="true" aria-labelledby="admin-code-editor-title">
        <div class="admin-code-editor-header">
          <h2 id="admin-code-editor-title">Source Code Editor</h2>
          <button type="button" class="button secondary" id="admin-code-editor-close" aria-label="Close editor">&times; Close</button>
        </div>
        <div class="admin-code-editor-tabs">
          <button type="button" class="admin-code-tab is-active" data-file="${pagePath}">HTML — ${pagePath}</button>
          <button type="button" class="admin-code-tab" data-file="${cssPath}">CSS — ${cssPath}</button>
        </div>
        <div class="admin-code-editor-body">
          <textarea class="admin-code-editor-textarea" id="admin-code-editor-textarea" spellcheck="false" autocorrect="off" autocapitalize="off">Loading…</textarea>
        </div>
        <div class="admin-code-editor-footer">
          <span class="admin-code-editor-status" id="admin-code-editor-status">Loading file…</span>
          <button type="button" class="button secondary" id="admin-code-editor-save">Save File</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    const textarea = backdrop.querySelector('#admin-code-editor-textarea');
    const statusEl = backdrop.querySelector('#admin-code-editor-status');
    const tabs = backdrop.querySelectorAll('.admin-code-tab');

    let activeFile = pagePath;
    const cache = {};

    function setStatus(msg, isError) {
      statusEl.textContent = msg;
      statusEl.style.color = isError ? '#ff9b9b' : '#8fa0c8';
    }

    async function loadFile(filePath) {
      setStatus('Loading…', false);
      textarea.value = '';
      textarea.disabled = true;
      try {
        if (!cache[filePath]) {
          cache[filePath] = await fetchSource(filePath);
        }
        textarea.value = cache[filePath];
        textarea.disabled = false;
        textarea.focus();
        setStatus(`Editing: ${filePath}`, false);
      } catch (err) {
        textarea.value = '';
        setStatus(err.message, true);
      }
    }

    tabs.forEach((tab) => {
      tab.addEventListener('click', async () => {
        if (activeFile !== tab.dataset.file && !textarea.disabled) {
          cache[activeFile] = textarea.value;
        }
        activeFile = tab.dataset.file;
        tabs.forEach((t) => t.classList.toggle('is-active', t === tab));
        await loadFile(activeFile);
      });
    });

    textarea.addEventListener('input', () => {
      cache[activeFile] = textarea.value;
    });

    backdrop.querySelector('#admin-code-editor-save').addEventListener('click', async () => {
      cache[activeFile] = textarea.value;
      const btn = backdrop.querySelector('#admin-code-editor-save');
      btn.disabled = true;
      setStatus('Saving…', false);
      try {
        await saveSource(activeFile, cache[activeFile]);
        setStatus('Saved. Reload the page to see changes.', false);
      } catch (err) {
        setStatus(err.message, true);
      } finally {
        btn.disabled = false;
      }
    });

    backdrop.querySelector('#admin-code-editor-close').addEventListener('click', () => {
      backdrop.remove();
    });

    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape' && document.getElementById('admin-code-editor-backdrop')) {
        backdrop.remove();
        document.removeEventListener('keydown', escHandler);
      }
    });

    // Support Tab key for indentation in the textarea
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value = textarea.value.slice(0, start) + '  ' + textarea.value.slice(end);
        textarea.selectionStart = textarea.selectionEnd = start + 2;
        cache[activeFile] = textarea.value;
      }
    });

    await loadFile(activeFile);
  }

  // Edit-mode snapshot & revert: when the admin enters edit mode we capture the
  // currently published page HTML from the server. That snapshot is the
  // "original" the admin can fall back to if edits get messed up.
  async function capturePageBackup() {
    if (state.pageBackup) return state.pageBackup;
    const pagePath = state.pagePath === '/' ? '/index.html' : state.pagePath;
    const token = getStoredToken();
    try {
      const res = await fetch(
        '/api/admin/file-source?path=' + encodeURIComponent(pagePath),
        { headers: { Authorization: 'Bearer ' + token } }
      );
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || typeof data.content !== 'string') return null;
      state.pageBackup = { path: pagePath, html: data.content, savedAt: new Date().toISOString() };
      return state.pageBackup;
    } catch (err) {
      console.error('Failed to capture page backup:', err);
      return null;
    }
  }

  function ensureRevertButton() {
    if (state.revertButton && document.body.contains(state.revertButton)) return state.revertButton;
    const controls = document.getElementById('admin-nav-controls');
    if (!controls) return null;

    const button = document.createElement('button');
    button.id = 'admin-revert-original';
    button.type = 'button';
    button.className = 'admin-revert-button';
    button.setAttribute('aria-label', 'Revert page to original');
    button.setAttribute('title', 'Discard all edits and restore the originally published page');
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z" /></svg>';

    button.addEventListener('click', revertToOriginalPage);

    const editToggle = document.getElementById('admin-edit-toggle');
    if (editToggle && editToggle.nextSibling) {
      controls.insertBefore(button, editToggle.nextSibling);
    } else {
      controls.appendChild(button);
    }
    state.revertButton = button;
    return button;
  }

  function removeRevertButton() {
    if (state.revertButton && state.revertButton.parentNode) {
      state.revertButton.parentNode.removeChild(state.revertButton);
    }
    state.revertButton = null;
  }

  async function revertToOriginalPage() {
    if (!state.pageBackup) {
      const captured = await capturePageBackup();
      if (!captured) {
        alert('Could not load the original page to revert to. Please try again.');
        return;
      }
    }
    const ok = window.confirm(
      'Revert this page to its originally published version? All edits made in this session will be discarded.'
    );
    if (!ok) return;

    const snap = state.pageBackup;
    const token = getStoredToken();
    updateSaveStatus('saving', 'Reverting...');
    try {
      const res = await fetch('/api/admin/file-source', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ path: snap.path, content: snap.html }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Revert failed');
      setEditMode(false);
      window.location.reload();
    } catch (err) {
      console.error('Revert error:', err);
      updateSaveStatus('error', err.message);
      alert('Revert failed: ' + err.message);
    }
  }

  function setEditMode(nextValue) {
    state.editMode = nextValue;
    document.body.classList.toggle('admin-edit-mode', nextValue);
    document.body.classList.toggle('admin-free-drag-mode', nextValue);
    updateNavDraggable(nextValue);
    if (!nextValue) {
      clearFreeDragCursors();
      hideElementToolbar();
      // Defensive cleanup so edit-mode visuals (yellow outlines, selection
      // highlight, free-positioning) can never linger when not in edit mode.
      document.body.classList.remove('admin-edit-mode', 'admin-free-drag-mode');
      document.querySelectorAll('.admin-current-selection, .admin-free-positioned, .admin-is-dragging').forEach((node) => {
        node.classList.remove('admin-current-selection', 'admin-free-positioned', 'admin-is-dragging');
      });
      if (state.editorSyncTimer) {
        window.clearTimeout(state.editorSyncTimer);
        state.editorSyncTimer = null;
      }
      if (state.domObserver) {
        state.domObserver.disconnect();
        state.domObserver = null;
      }
      removeRevertButton();
      state.pageBackup = null;
    }
    ensureInspectorPanel();
    updateInspectorPanel(nextValue ? document.querySelector('main[data-admin-editable="page-root"]') : null);
    if (nextValue) {
      ensureEditorDomObserver();
      scheduleEditorSync();
      capturePageBackup().then(function () { ensureRevertButton(); });
    }
    applyElementOverrides();
    registerSectionEditing();
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
  const NAV_DYNAMIC_IDS = new Set(['nav-auth-link', 'nav-dashboard-link', 'nav-logout-link']);

  function getStaticNavLinks() {
    const nav = document.querySelector('.site-nav');
    if (!nav) return [];
    return Array.from(nav.querySelectorAll('a')).filter(
      a => !NAV_DYNAMIC_IDS.has(a.id) && !a.closest('#admin-nav-controls')
    );
  }

  function updateNavDraggable(enabled) {
    getStaticNavLinks().forEach(link => {
      if (enabled) {
        link.setAttribute('draggable', 'true');
        link.classList.add('admin-nav-draggable');
      } else {
        link.removeAttribute('draggable');
        link.classList.remove('admin-nav-draggable', 'admin-nav-drag-over', 'admin-nav-dragging');
      }
    });
  }

  function bindNavReorderEvents() {
    const nav = document.querySelector('.site-nav');
    if (!nav || nav.dataset.adminNavDragBound) return;
    nav.dataset.adminNavDragBound = 'true';

    let dragSource = null;

    nav.addEventListener('dragstart', (e) => {
      if (!state.editMode) return;
      const link = e.target.closest('a[draggable="true"]');
      if (!link || NAV_DYNAMIC_IDS.has(link.id) || link.closest('#admin-nav-controls')) return;
      dragSource = link;
      link.classList.add('admin-nav-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', '');
    });

    nav.addEventListener('dragover', (e) => {
      if (!state.editMode || !dragSource) return;
      const link = e.target.closest('a');
      if (!link || link === dragSource || NAV_DYNAMIC_IDS.has(link.id) || link.closest('#admin-nav-controls')) return;
      e.preventDefault();
      nav.querySelectorAll('a.admin-nav-drag-over').forEach(el => el.classList.remove('admin-nav-drag-over'));
      link.classList.add('admin-nav-drag-over');
    });

    nav.addEventListener('dragleave', (e) => {
      const link = e.target.closest && e.target.closest('a');
      if (link) link.classList.remove('admin-nav-drag-over');
    });

    nav.addEventListener('drop', async (e) => {
      if (!state.editMode || !dragSource) return;
      e.preventDefault();
      const link = e.target.closest('a');
      nav.querySelectorAll('a.admin-nav-drag-over').forEach(el => el.classList.remove('admin-nav-drag-over'));
      dragSource.classList.remove('admin-nav-dragging');

      if (!link || link === dragSource || NAV_DYNAMIC_IDS.has(link.id) || link.closest('#admin-nav-controls')) {
        dragSource = null;
        return;
      }

      nav.insertBefore(dragSource, link);
      dragSource = null;
      await saveNavOrder();
    });

    nav.addEventListener('dragend', () => {
      if (dragSource) { dragSource.classList.remove('admin-nav-dragging'); dragSource = null; }
      nav.querySelectorAll('a.admin-nav-drag-over').forEach(el => el.classList.remove('admin-nav-drag-over'));
    });
  }

  async function saveNavOrder() {
    const pagePath = state.pagePath === '/' ? '/index.html' : state.pagePath;
    const token = getStoredToken();
    updateSaveStatus('saving', 'Saving\u2026');

    try {
      const res = await fetch(`/api/admin/file-source?path=${encodeURIComponent(pagePath)}`, {
        headers: { Authorization: 'Bearer ' + token },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to read file');

      const links = getStaticNavLinks();
      const indent = '          ';
      const newNavInner = links.map(a => {
        const href = a.getAttribute('href') || '#';
        const text = a.textContent.trim();
        return `${indent}<a href="${href}">${text}</a>`;
      }).join('\n');

      const newHtml = data.content.replace(
        /(<nav[^>]*class="[^"]*site-nav[^"]*"[^>]*>)([\s\S]*?)(<\/nav>)/,
        (_m, open, _inner, close) => `${open}\n${newNavInner}\n        ${close}`
      );

      if (newHtml === data.content) { updateSaveStatus('idle', 'Saved'); return; }

      const saveRes = await fetch('/api/admin/file-source', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ path: pagePath, content: newHtml }),
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok) throw new Error(saveData.error || 'Failed to save');

      updateSaveStatus('saved', 'Saved');
    } catch (err) {
      console.error('Nav save error:', err);
      updateSaveStatus('error', err.message);
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

    const codeButton = document.createElement('button');
    codeButton.id = 'admin-code-editor-toggle';
    codeButton.type = 'button';
    codeButton.className = 'admin-edit-nav-button';
    codeButton.setAttribute('aria-label', 'Edit page source code');
    codeButton.setAttribute('title', 'Edit HTML / CSS source files');
    codeButton.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6z" />
      </svg>
    `;

    controls.replaceChildren(button, codeButton);
    ensureSaveStatusNode();
    updateSaveStatus('idle', 'Saved');

    const logoutLink = document.getElementById('nav-logout-link');
    if (logoutLink) {
      nav.insertBefore(controls, logoutLink);
    } else {
      nav.appendChild(controls);
    }

    button.addEventListener('click', () => {
      setEditMode(!state.editMode);
    });
    codeButton.addEventListener('click', openSourceCodeEditor);

    bindFreeDragHandlers();
    bindNavReorderEvents();
    ensureElementToolbar();
    ensureInspectorPanel();

    window.addEventListener('resize', () => {
      hideElementToolbar();
      if (state.editMode) syncInspectorTop();
    });
    window.addEventListener('scroll', (event) => {
      // Only dismiss the floating toolbar when the MAIN PAGE scrolls. Scrolling
      // inside the editor's own UI (the inspector panel's scrollbar, the code
      // editor, or the element editor modal) must not blank the panel or drop
      // the selected element.
      const t = event.target;
      const isPageScroll = !t || t === document || t === document.documentElement
        || t === document.body || t === document.scrollingElement;
      if (!isPageScroll) return;
      hideElementToolbar();
    }, true);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        hideElementToolbar();
      }
    });

    // Track whether a pointer interaction started inside the inspector panel so
    // any resulting click (e.g. releasing a scrollbar drag outside the panel
    // bounds) is treated as a panel interaction and never deselects the element.
    let pointerDownInPanel = false;
    document.addEventListener('pointerdown', (event) => {
      const p = state.inspectorPanel;
      if (!state.editMode || !p || p.style.display === 'none') { pointerDownInPanel = false; return; }
      const r = p.getBoundingClientRect();
      pointerDownInPanel = event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
    }, true);

    document.addEventListener('click', (event) => {
      if (!state.editMode) return;
      if (Date.now() < state.suppressEditClickUntil) return;
      if (pointerDownInPanel) return;
      // A click that lands inside the inspector panel (including its scrollbar)
      // must never be treated as clicking away. Some browsers report event.target
      // as the document/body for scrollbar clicks, so also test the coordinates.
      const panelEl = state.inspectorPanel;
      if (panelEl && panelEl.style.display !== 'none') {
        const r = panelEl.getBoundingClientRect();
        if (event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom) {
          return;
        }
      }
      if (event.target.closest('.admin-nav-controls, .admin-edit-nav-button, .admin-add-section-button, .admin-revert-button, .admin-save-status, .admin-editor-modal, .admin-code-editor-backdrop, .admin-section-tools, .admin-element-toolbar, .admin-inspector-panel, .admin-selection-handles-overlay')) return;

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

      const siteNavLink = event.target.closest('.site-nav a');
      if (siteNavLink) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      hideElementToolbar();
    }, true);
  }

  async function initEditableContent() {
    // Guarantee a clean start: edit-mode visuals (yellow outlines, etc.) must
    // never appear outside active edit mode, even if a stale class lingered
    // from a previous session or soft navigation.
    document.body.classList.remove('admin-edit-mode', 'admin-free-drag-mode');

    // Bulletproof guard: if anything adds the edit-mode class to <body> while we
    // are NOT actually in edit mode, strip it immediately. This guarantees the
    // yellow edit outlines can never show outside active edit mode on any page.
    if (!state.editModeClassGuardAttached) {
      state.editModeClassGuardAttached = true;
      const guard = new MutationObserver(() => {
        if (!state.editMode && document.body.classList.contains('admin-edit-mode')) {
          document.body.classList.remove('admin-edit-mode', 'admin-free-drag-mode');
        }
      });
      guard.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }

    initContactForm();
    bindAlbumUiEvents();

    // Restore any saved page background color/image from data attributes set by the admin
    if (document.body.dataset.pageBgColor) {
      document.body.style.background = document.body.dataset.pageBgColor;
    }
    if (document.body.dataset.pageBgImage) {
      document.body.style.backgroundImage = `url("${document.body.dataset.pageBgImage}")`;
      document.body.style.backgroundSize = 'cover';
      document.body.style.backgroundPosition = 'center';
      document.body.style.backgroundRepeat = 'no-repeat';
    }

    if (!isPageEditable()) {
      initHeaderState();
      return;
    }

    initHeaderState();
    loadPageSectionsFromDom();
    registerEditableElements();
    initializeCalendarUi();

    // Determine admin role early so the edit toggle is always available, even if
    // calendar/media/profile loads fail (those must not block the editor UI).
    let profile = null;
    try {
      profile = await fetchCurrentProfile();
    } catch (err) {
      console.error('Profile load failed:', err);
    }
    state.isAdmin = Boolean(profile && profile.role === 'admin');

    // Calendar + media are non-critical for the editor shell; guard each so a
    // failure can't abort initEditableContent (which would leave the Edit toggle
    // missing and the user unable to exit edit mode on pages like events/contact).
    try {
      await loadCalendarEvents();
    } catch (err) {
      console.error('Calendar events load failed:', err);
    }
    try {
      await loadMediaAlbums();
    } catch (err) {
      console.error('Media albums load failed:', err);
    }

    if (!state.isAdmin) return;

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
