// Users Report — rendering + export (PDF via print, Excel via a
// self-contained .xlsx writer, no third-party libraries).
// Mirrors float-report.js but groups users by role, one line per user,
// and surfaces payment status, account status, and role prominently.
// Reuses the app's global helpers from auth.js (getToken, escHtml) and the
// shared nav mount from script.js.
(function () {
  'use strict';

  const REPORT_PATH = '/api/admin/users/report';

  // ── Small helpers ───────────────────────────────────────────────────────
  function el(id) { return document.getElementById(id); }

  function setFeedback(msg, isError) {
    const fb = el('users-report-feedback');
    if (!fb) return;
    fb.textContent = msg || '';
    fb.style.color = isError ? '#ff9b9b' : '#88d498';
  }

  // ── Role selection ──────────────────────────────────────────────────────
  // Returns the array of selected role keys (strings). An empty selection
  // means "all roles" so the default export behaviour is unchanged.
  function getSelectedRoleKeys() {
    const keys = [];
    document.querySelectorAll('.ur-role-select').forEach(function (b) {
      if (b.checked) keys.push(b.value);
    });
    return keys;
  }

  function setAllChecked(state) {
    document.querySelectorAll('.ur-role-select').forEach(function (b) { b.checked = state; });
    updateSelectionUI();
  }

  function updateSelectionUI() {
    const total = document.querySelectorAll('.ur-role-select').length;
    const selected = getSelectedRoleKeys().length;
    const countEl = el('ur-selected-count');
    if (countEl) {
      if (selected === 0) countEl.textContent = 'None selected — exports all roles';
      else if (selected === total) countEl.textContent = 'All ' + total + ' role' + (total === 1 ? '' : 's') + ' selected';
      else countEl.textContent = selected + ' of ' + total + ' role' + (total === 1 ? '' : 's') + ' selected';
    }
    const label = selected === 0 ? 'All' : String(selected);
    const excelBtn = el('ur-export-excel');
    const pdfBtn = el('ur-export-pdf');
    if (excelBtn) excelBtn.textContent = 'Export Excel (' + label + ')';
    if (pdfBtn) pdfBtn.textContent = 'Export PDF (' + label + ')';
  }

  // ── Data fetch ───────────────────────────────────────────────────────────
  async function fetchReport() {
    const token = (typeof getToken === 'function') ? getToken() : null;
    if (!token) { window.location.href = '/login.html'; return null; }
    const res = await fetch(REPORT_PATH, { headers: { Authorization: 'Bearer ' + token } });
    if (res.status === 401 || res.status === 403) {
      const denied = el('users-report-denied');
      const page = el('users-report-page');
      if (page) page.style.display = 'none';
      if (denied) denied.style.display = 'block';
      return null;
    }
    if (!res.ok) {
      const data = await res.json().catch(function () { return {}; });
      throw new Error(data.error || 'Unable to generate users report');
    }
    return res.json();
  }

  // ── Rendering (grouped by role) ────────────────────────────────────────
  function payCellHtml(paid) {
    return paid ? 'Yes' : 'No';
  }

  function locationHtml(u) {
    const parts = [u.city, u.state].filter(Boolean).join(', ');
    const tail = [parts, u.zip].filter(Boolean).join('  ');
    return escHtml(tail);
  }

  function userRowHtml(u) {
    const isDisabled = u.status === 'Disabled';
    const name = escHtml(u.full_name || '');
    const email = escHtml(u.email || '');
    const phone = escHtml(u.phone || '');
    const role = escHtml(u.role || '');
    const joined = u.joined_at ? escHtml(String(u.joined_at).slice(0, 10)) : '';
    const sponsor = escHtml(u.sponsor_name || '');
    const memberNo = escHtml(u.member_float_number || '');
    const occupation = escHtml(u.occupation || '');
    const orgs = escHtml(u.organizations || '');
    const status = isDisabled ? 'Disabled' : 'Active';
    return (
      '<tr>' +
        '<td>' + name + '</td>' +
        '<td>' + email + '</td>' +
        '<td>' + phone + '</td>' +
        '<td>' + role + '</td>' +
        '<td>' + status + '</td>' +
        '<td>' + joined + '</td>' +
        '<td>' + payCellHtml(u.dues_paid) + '</td>' +
        '<td>' + payCellHtml(u.guest_fee_paid) + '</td>' +
        '<td>' + payCellHtml(u.beads_paid) + '</td>' +
        '<td>' + payCellHtml(u.costume_paid) + '</td>' +
        '<td>' + (u.float_captain ? 'Yes' : '') + '</td>' +
        '<td>' + sponsor + '</td>' +
        '<td>' + locationHtml(u) + '</td>' +
        '<td>' + memberNo + '</td>' +
        '<td>' + occupation + '</td>' +
        '<td>' + orgs + '</td>' +
      '</tr>'
    );
  }

  function roleBlockHtml(group) {
    const users = Array.isArray(group.users) ? group.users : [];
    const meta = group.label + '  •  ' + users.length + ' user' + (users.length === 1 ? '' : 's');
    const body = users.length
      ? '<tbody>' + users.map(userRowHtml).join('') + '</tbody>'
      : '<tbody><tr><td colspan="16" class="ur-empty">No users in this role.</td></tr></tbody>';
    const key = group.role || '';
    return (
      '<section class="user-report-block" data-role="' + escHtml(key) + '">' +
        '<label class="ur-role-select-wrap"><input type="checkbox" class="ur-role-select" value="' + escHtml(key) + '" checked /> Include in export</label>' +
        '<h3 class="ur-role-title">' + escHtml(group.label || key) + '</h3>' +
        '<p class="ur-role-meta">' + escHtml(meta) + '</p>' +
        '<table class="ur-table">' +
          '<thead><tr>' +
            '<th>Name</th>' +
            '<th>Email</th>' +
            '<th>Phone</th>' +
            '<th>Role</th>' +
            '<th>Status</th>' +
            '<th>Joined</th>' +
            '<th>Dues</th>' +
            '<th>Guest Fee</th>' +
            '<th>Beads</th>' +
            '<th>Costume</th>' +
            '<th>Captain</th>' +
            '<th>Sponsor</th>' +
            '<th>Location</th>' +
            '<th>Member #</th>' +
            '<th>Occupation</th>' +
            '<th>Organizations</th>' +
          '</tr></thead>' +
          body +
        '</table>' +
      '</section>'
    );
  }

  function renderReport(data) {
    const page = el('users-report-page');
    if (page) page.style.display = 'block';

    const roles = Array.isArray(data.roles) ? data.roles : [];
    const list = el('users-report-list');
    const summary = el('ur-summary');
    const generated = el('ur-generated');

    if (summary) {
      const totalUsers = roles.reduce(function (s, g) { return s + (Array.isArray(g.users) ? g.users.length : 0); }, 0);
      summary.textContent = roles.length + ' role' + (roles.length === 1 ? '' : 's') +
        '  •  ' + totalUsers + ' user' + (totalUsers === 1 ? '' : 's');
    }
    if (generated) {
      const when = data.generatedAt ? new Date(data.generatedAt) : new Date();
      generated.textContent = 'Generated ' + when.toLocaleString();
    }
    if (list) {
      list.innerHTML = roles.length
        ? roles.map(roleBlockHtml).join('')
        : '<p class="ur-empty">No users found.</p>';
    }
    setFeedback('');
    return data;
  }

  // ── PDF export (reliable, dependency-free print-to-PDF) ────────────────
  function exportPDF() {
    const blocks = Array.prototype.slice.call(document.querySelectorAll('.user-report-block'));
    const anyChecked = blocks.some(function (blk) {
      const b = blk.querySelector('.ur-role-select');
      return b && b.checked;
    });
    let firstVisible = true;
    blocks.forEach(function (blk) {
      const box = blk.querySelector('.ur-role-select');
      const included = anyChecked ? (box && box.checked) : true;
      blk.classList.toggle('ur-hidden-print', !included);
      blk.classList.toggle('ur-first-print', included && firstVisible);
      if (included) firstVisible = false;
    });
    window.print();
    blocks.forEach(function (blk) {
      blk.classList.remove('ur-hidden-print');
      blk.classList.remove('ur-first-print');
    });
  }

  // ── Excel export (.xlsx) — self-contained OOXML writer ──────────────────
  function xmlEscape(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function colLetter(c) {
    let s = '';
    let n = c;
    while (n >= 0) {
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26) - 1;
    }
    return s;
  }

  function sheetXml(rows) {
    let out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    out += '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
    out += '<sheetData>';
    rows.forEach(function (row, i) {
      const r = i + 1;
      out += '<row r="' + r + '">';
      row.forEach(function (cell, c) {
        const ref = colLetter(c) + r;
        const s = cell.bold ? ' s="1"' : '';
        out += '<c r="' + ref + '"' + s + ' t="inlineStr">' +
               '<is><t xml:space="preserve">' + xmlEscape(cell.v) + '</t></is></c>';
      });
      out += '</row>';
    });
    out += '</sheetData></worksheet>';
    return out;
  }

  function crc32(buf) {
    let crc = ~0;
    for (let i = 0; i < buf.length; i++) {
      crc ^= buf[i];
      for (let k = 0; k < 8; k++) {
        crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
      }
    }
    return (~crc) >>> 0;
  }

  function buildZip(files) {
    const enc = new TextEncoder();
    const encStr = function (s) { return enc.encode(s); };
    const locals = [];
    const centrals = [];
    let offset = 0;

    files.forEach(function (f) {
      const nameBytes = encStr(f.name);
      const data = f.data;
      const crc = crc32(data);

      const local = new Uint8Array(30 + nameBytes.length + data.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0, true);
      lv.setUint16(8, 0, true);
      lv.setUint16(10, 0, true);
      lv.setUint16(12, 0, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);
      local.set(data, 30 + nameBytes.length);
      locals.push(local);

      const cd = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      cd.set(nameBytes, 46);
      centrals.push(cd);

      offset += local.length;
    });

    const centralSize = centrals.reduce(function (s, c) { return s + c.length; }, 0);
    const centralOffset = offset;
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, centralOffset, true);
    ev.setUint16(20, 0, true);

    const out = new Uint8Array(offset + centralSize + 22);
    let pos = 0;
    locals.forEach(function (p) { out.set(p, pos); pos += p.length; });
    centrals.forEach(function (c) { out.set(c, pos); pos += c.length; });
    out.set(end, pos);
    return out;
  }

  function excelRowsFromReport(data) {
    const rows = [];
    const when = data.generatedAt ? new Date(data.generatedAt) : new Date();
    const roles = Array.isArray(data.roles) ? data.roles : [];
    const scope = roles.length === 1 ? '' : ' (' + roles.length + ' roles)';
    rows.push([{ v: 'Users Report — generated ' + when.toLocaleString() + scope, bold: true }]);
    rows.push([]); // spacer

    roles.forEach(function (group) {
      const users = Array.isArray(group.users) ? group.users : [];
      rows.push([{ v: 'Role: ' + (group.label || group.role || ''), bold: true }]);
      rows.push([
        { v: 'Name', bold: true },
        { v: 'Email', bold: true },
        { v: 'Phone', bold: true },
        { v: 'Role', bold: true },
        { v: 'Status', bold: true },
        { v: 'Joined', bold: true },
        { v: 'Dues', bold: true },
        { v: 'Guest Fee', bold: true },
        { v: 'Beads', bold: true },
        { v: 'Costume', bold: true },
        { v: 'Captain', bold: true },
        { v: 'Sponsor', bold: true },
        { v: 'Location', bold: true },
        { v: 'Member #', bold: true },
        { v: 'Occupation', bold: true },
        { v: 'Organizations', bold: true },
      ]);
      if (!users.length) {
        rows.push([{ v: '(No users)' }]);
      } else {
        users.forEach(function (u) {
          const loc = [([u.city, u.state].filter(Boolean).join(', ')), u.zip].filter(Boolean).join('  ');
          rows.push([
            { v: u.full_name || '' },
            { v: u.email || '' },
            { v: u.phone || '' },
            { v: u.role || '' },
            { v: u.status || '' },
            { v: u.joined_at ? String(u.joined_at).slice(0, 10) : '' },
            { v: u.dues_paid ? 'Paid' : 'Unpaid' },
            { v: u.guest_fee_paid ? 'Paid' : 'Unpaid' },
            { v: u.beads_paid ? 'Paid' : 'Unpaid' },
            { v: u.costume_paid ? 'Paid' : 'Unpaid' },
            { v: u.float_captain ? 'Yes' : 'No' },
            { v: u.sponsor_name || '' },
            { v: loc },
            { v: u.member_float_number || '' },
            { v: u.occupation || '' },
            { v: u.organizations || '' },
          ]);
        });
      }
      rows.push([]); // spacer between roles
    });
    return rows;
  }

  function buildXlsxBlob(data) {
    const enc = new TextEncoder();
    const now = new Date().toISOString();

    const contentTypes =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '</Types>';

    const rootRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>';

    const core =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
        'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        '<dc:title>Users Report</dc:title>' +
        '<dc:creator>Krewe Mystique de la Capitale</dc:creator>' +
        '<dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created>' +
        '<dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified>' +
      '</cp:coreProperties>';

    const app =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">' +
        '<Application>Krewe Mystique Web Platform</Application>' +
      '</Properties>';

    const workbook =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="Users" sheetId="1" r:id="rId1"/></sheets>' +
      '</workbook>';

    const workbookRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';

    const styles =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="2">' +
          '<font><sz val="11"/><name val="Calibri"/></font>' +
          '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
        '</fonts>' +
        '<fills count="2">' +
          '<fill><patternFill patternType="none"/></fill>' +
          '<fill><patternFill patternType="gray125"/></fill>' +
        '</fills>' +
        '<borders count="1"><border/></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="2">' +
          '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
          '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
        '</cellXfs>' +
      '</styleSheet>';

    const sheet = sheetXml(excelRowsFromReport(data));

    const files = [
      { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
      { name: '_rels/.rels', data: enc.encode(rootRels) },
      { name: 'docProps/core.xml', data: enc.encode(core) },
      { name: 'docProps/app.xml', data: enc.encode(app) },
      { name: 'xl/workbook.xml', data: enc.encode(workbook) },
      { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(workbookRels) },
      { name: 'xl/styles.xml', data: enc.encode(styles) },
      { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheet) },
    ];

    return new Blob([buildZip(files)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  function exportExcel(data) {
    if (!data) return;
    const roles = Array.isArray(data.roles) ? data.roles : [];
    const sel = getSelectedRoleKeys();
    const filteredRoles = sel.length ? roles.filter(function (g) { return sel.indexOf(g.role) !== -1; }) : roles;
    const payload = { generatedAt: data.generatedAt, roles: filteredRoles };
    const d = new Date();
    const stamp = d.getFullYear() +
      String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0');
    const blob = buildXlsxBlob(payload);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'users-report-' + stamp + '.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  // ── Bootstrap ───────────────────────────────────────────────────────────
  async function init() {
    const page = el('users-report-page');
    if (!page) return; // not the report page

    setFeedback('Loading report…', false);

    let data = null;
    try {
      data = await fetchReport();
    } catch (err) {
      setFeedback(err.message || 'Unable to load the users report.', true);
      return;
    }
    if (!data) return; // fetchReport already redirected / showed denied

    renderReport(data);

    // Pre-select roles requested via ?role=admin,member (deep-link / per-role export).
    const params = new URLSearchParams(window.location.search);
    const pre = params.get('role');
    if (pre) {
      const want = String(pre).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      if (want.length) {
        document.querySelectorAll('.ur-role-select').forEach(function (b) {
          b.checked = want.indexOf(b.value) !== -1;
        });
      }
    }

    // Wire selection controls + live count.
    const allBtn = el('ur-select-all');
    const noneBtn = el('ur-select-none');
    if (allBtn) allBtn.addEventListener('click', function () { setAllChecked(true); });
    if (noneBtn) noneBtn.addEventListener('click', function () { setAllChecked(false); });
    document.querySelectorAll('.ur-role-select').forEach(function (b) {
      b.addEventListener('change', updateSelectionUI);
    });
    updateSelectionUI();

    const pdfBtn = el('ur-export-pdf');
    const excelBtn = el('ur-export-excel');
    if (pdfBtn) pdfBtn.addEventListener('click', exportPDF);
    if (excelBtn) excelBtn.addEventListener('click', function () { exportExcel(data); });

    // Optional auto-export when arriving from the User Management "Export" buttons.
    const auto = params.get('auto');
    if (auto === 'pdf') {
      setTimeout(exportPDF, 250);
    } else if (auto === 'excel') {
      setTimeout(function () { exportExcel(data); }, 250);
    }
  }

  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else if (typeof document !== 'undefined') {
    init();
  }
})();
