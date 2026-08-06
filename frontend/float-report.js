// Float Riders Report — rendering + export (PDF via print, Excel via a
// self-contained .xlsx writer, no third-party libraries).
// Reuses the app's global helpers from auth.js (getToken, escHtml) and the
// shared nav mount from script.js.
(function () {
  'use strict';

  const REPORT_PATH = '/api/admin/floats/report';

  // ── Small helpers ───────────────────────────────────────────────────────
  function el(id) { return document.getElementById(id); }

  function formatAddress(m) {
    m = m || {};
    const parts = [];
    if (m.address) parts.push(m.address);
    const cityState = [m.city, m.state].filter(Boolean).join(', ');
    if (cityState) parts.push(cityState);
    if (m.zip) parts.push(m.zip);
    return parts.join('  •  ');
  }

  function setFeedback(msg, isError) {
    const fb = el('float-report-feedback');
    if (!fb) return;
    fb.textContent = msg || '';
    fb.style.color = isError ? '#ff9b9b' : '#88d498';
  }

  // ── Float selection ─────────────────────────────────────────────────────
  // Returns the array of selected float ids (numbers). An empty selection
  // means "all floats" so the default export behaviour is unchanged.
  function getSelectedFloatIds() {
    const ids = [];
    document.querySelectorAll('.fr-float-select').forEach(function (b) {
      if (b.checked) ids.push(Number(b.value));
    });
    return ids;
  }

  function setAllChecked(state) {
    document.querySelectorAll('.fr-float-select').forEach(function (b) { b.checked = state; });
    updateSelectionUI();
  }

  function updateSelectionUI() {
    const total = document.querySelectorAll('.fr-float-select').length;
    const selected = getSelectedFloatIds().length;
    const countEl = el('fr-selected-count');
    if (countEl) {
      if (selected === 0) countEl.textContent = 'None selected — exports all floats';
      else if (selected === total) countEl.textContent = 'All ' + total + ' float' + (total === 1 ? '' : 's') + ' selected';
      else countEl.textContent = selected + ' of ' + total + ' float' + (total === 1 ? '' : 's') + ' selected';
    }
    const label = selected === 0 ? 'All' : String(selected);
    const excelBtn = el('fr-export-excel');
    const pdfBtn = el('fr-export-pdf');
    if (excelBtn) excelBtn.textContent = 'Export Excel (' + label + ')';
    if (pdfBtn) pdfBtn.textContent = 'Export PDF (' + label + ')';
  }

  // ── Data fetch ───────────────────────────────────────────────────────────
  async function fetchReport() {
    const token = (typeof getToken === 'function') ? getToken() : null;
    if (!token) { window.location.href = '/login.html'; return null; }
    const res = await fetch(REPORT_PATH, { headers: { Authorization: 'Bearer ' + token } });
    if (res.status === 401 || res.status === 403) {
      const denied = el('float-report-denied');
      const page = el('float-report-page');
      if (page) page.style.display = 'none';
      if (denied) denied.style.display = 'block';
      return null;
    }
    if (!res.ok) {
      const data = await res.json().catch(function () { return {}; });
      throw new Error(data.error || 'Unable to generate float report');
    }
    return res.json();
  }

  // ── Rendering (grouped by float) ───────────────────────────────────────
  function riderRowHtml(r) {
    const m = r.member || {};
    const name = escHtml(r.name || '');
    const member = escHtml(m.full_name || '');
    const address = escHtml(formatAddress(m));
    const phone = escHtml(m.phone || '');
    const email = escHtml(m.email || '');
    const comment = escHtml(r.comment || '');
    return (
      '<tr>' +
        '<td>' + name + '</td>' +
        '<td>' + member + '</td>' +
        '<td>' + address + '</td>' +
        '<td>' + phone + '</td>' +
        '<td>' + email + '</td>' +
        '<td>' + comment + '</td>' +
      '</tr>'
    );
  }

  function floatBlockHtml(f) {
    const riders = Array.isArray(f.riders) ? f.riders : [];
    const meta = [];
    if (f.float_number) meta.push('Float #' + escHtml(String(f.float_number)));
    if (f.capacity != null) meta.push('Capacity: ' + escHtml(String(f.capacity)));
    meta.push('Riders: ' + riders.length);
    if (f.description) meta.push(escHtml(f.description));

    const title = escHtml(f.name || 'Unnamed Float') +
      (f.float_number ? ' <span style="color:#b8c4e0;font-weight:400;">(#' + escHtml(String(f.float_number)) + ')</span>' : '');

    const cap = f.captain || null;
    const captainHtml = cap
      ? '<p class="fr-float-captain"><strong>Captain:</strong> ' + escHtml(cap.full_name || '(unnamed)') +
        (cap.phone ? '  •  ' + escHtml(cap.phone) : '') +
        (cap.email ? '  •  ' + escHtml(cap.email) : '') +
        '</p>'
      : '<p class="fr-float-captain fr-empty"><strong>Captain:</strong> None designated</p>';

    const body = riders.length
      ? '<tbody>' + riders.map(riderRowHtml).join('') + '</tbody>'
      : '<tbody><tr><td colspan="6" class="fr-empty">No riders on this float.</td></tr></tbody>';

    const fid = (f.id != null) ? f.id : '';
    return (
      '<section class="float-report-block" data-float-id="' + fid + '">' +
        '<label class="fr-float-select-wrap"><input type="checkbox" class="fr-float-select" value="' + fid + '" checked /> Include in export</label>' +
        '<h3 class="fr-float-title">' + title + '</h3>' +
        '<p class="fr-float-meta">' + meta.join('  •  ') + '</p>' +
        captainHtml +
        '<table class="fr-table">' +
          '<thead><tr>' +
            '<th>Rider Name</th>' +
            '<th>Sponsoring Member</th>' +
            '<th>Address</th>' +
            '<th>Phone</th>' +
            '<th>Email</th>' +
            '<th>Comment</th>' +
          '</tr></thead>' +
          body +
        '</table>' +
      '</section>'
    );
  }

  function renderReport(data) {
    const page = el('float-report-page');
    if (page) page.style.display = 'block';

    const floats = Array.isArray(data.floats) ? data.floats : [];
    const list = el('float-report-list');
    const summary = el('fr-summary');
    const generated = el('fr-generated');

    if (summary) {
      const totalRiders = floats.reduce(function (s, f) { return s + (Array.isArray(f.riders) ? f.riders.length : 0); }, 0);
      summary.textContent = floats.length + ' float' + (floats.length === 1 ? '' : 's') +
        '  •  ' + totalRiders + ' rider' + (totalRiders === 1 ? '' : 's');
    }
    if (generated) {
      const when = data.generatedAt ? new Date(data.generatedAt) : new Date();
      generated.textContent = 'Generated ' + when.toLocaleString();
    }
    if (list) {
      list.innerHTML = floats.length
        ? floats.map(floatBlockHtml).join('')
        : '<p class="fr-empty">No floats found.</p>';
    }
    setFeedback('');
    return data;
  }

  // ── PDF export (reliable, dependency-free print-to-PDF) ────────────────
  function exportPDF() {
    const blocks = Array.prototype.slice.call(document.querySelectorAll('.float-report-block'));
    const anyChecked = blocks.some(function (blk) {
      const b = blk.querySelector('.fr-float-select');
      return b && b.checked;
    });
    let firstVisible = true;
    blocks.forEach(function (blk) {
      const box = blk.querySelector('.fr-float-select');
      const included = anyChecked ? (box && box.checked) : true;
      blk.classList.toggle('fr-hidden-print', !included);
      blk.classList.toggle('fr-first-print', included && firstVisible);
      if (included) firstVisible = false;
    });
    window.print();
    blocks.forEach(function (blk) {
      blk.classList.remove('fr-hidden-print');
      blk.classList.remove('fr-first-print');
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
    const floats = Array.isArray(data.floats) ? data.floats : [];
    const scope = floats.length === 1 ? '' : ' (' + floats.length + ' floats)';
    rows.push([{ v: 'Float Riders Report — generated ' + when.toLocaleString() + scope, bold: true }]);
    rows.push([]); // spacer

    floats.forEach(function (f) {
      rows.push([{
        v: 'Float: ' + (f.name || 'Unnamed') + (f.float_number ? ' (#' + f.float_number + ')' : ''),
        bold: true,
      }]);
      const cap = f.captain || null;
      const capText = cap
        ? (cap.full_name || '(unnamed)') +
          (cap.phone ? '  •  ' + cap.phone : '') +
          (cap.email ? '  •  ' + cap.email : '')
        : 'None designated';
      rows.push([{ v: 'Captain: ' + capText, bold: true }]);
      rows.push([
        { v: 'Rider Name', bold: true },
        { v: 'Sponsoring Member', bold: true },
        { v: 'Address', bold: true },
        { v: 'Phone', bold: true },
        { v: 'Email', bold: true },
        { v: 'Comment', bold: true },
      ]);
      const riders = Array.isArray(f.riders) ? f.riders : [];
      if (!riders.length) {
        rows.push([{ v: '(No riders)' }]);
      } else {
        riders.forEach(function (r) {
          const m = r.member || {};
          rows.push([
            { v: r.name || '' },
            { v: m.full_name || '' },
            { v: formatAddress(m) },
            { v: m.phone || '' },
            { v: m.email || '' },
            { v: r.comment || '' },
          ]);
        });
      }
      rows.push([]); // spacer between floats
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
        '<dc:title>Float Riders Report</dc:title>' +
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
        '<sheets><sheet name="Floats" sheetId="1" r:id="rId1"/></sheets>' +
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
    const floats = Array.isArray(data.floats) ? data.floats : [];
    const sel = getSelectedFloatIds();
    const filteredFloats = sel.length ? floats.filter(function (f) { return sel.indexOf(Number(f.id)) !== -1; }) : floats;
    const payload = { generatedAt: data.generatedAt, floats: filteredFloats };
    const d = new Date();
    const stamp = d.getFullYear() +
      String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0');
    const blob = buildXlsxBlob(payload);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'floats-report-' + stamp + '.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  async function init() {
    const page = el('float-report-page');
    if (!page) return; // not the report page

    setFeedback('Loading report…', false);

    let data = null;
    try {
      data = await fetchReport();
    } catch (err) {
      setFeedback(err.message || 'Unable to load the float report.', true);
      return;
    }
    if (!data) return; // fetchReport already redirected / showed denied

    renderReport(data);

    // Pre-select floats requested via ?floatId=1,2 (deep-link / per-float export).
    const params = new URLSearchParams(window.location.search);
    const pre = params.get('floatId');
    if (pre) {
      const want = String(pre).split(',').map(function (s) { return Number(s.trim()); }).filter(function (n) { return !Number.isNaN(n); });
      if (want.length) {
        document.querySelectorAll('.fr-float-select').forEach(function (b) {
          b.checked = want.indexOf(Number(b.value)) !== -1;
        });
      }
    }

    // Wire selection controls + live count.
    const allBtn = el('fr-select-all');
    const noneBtn = el('fr-select-none');
    if (allBtn) allBtn.addEventListener('click', function () { setAllChecked(true); });
    if (noneBtn) noneBtn.addEventListener('click', function () { setAllChecked(false); });
    document.querySelectorAll('.fr-float-select').forEach(function (b) {
      b.addEventListener('change', updateSelectionUI);
    });
    updateSelectionUI();

    const pdfBtn = el('fr-export-pdf');
    const excelBtn = el('fr-export-excel');
    if (pdfBtn) pdfBtn.addEventListener('click', exportPDF);
    if (excelBtn) excelBtn.addEventListener('click', function () { exportExcel(data); });

    // Optional auto-export when arriving from the float admin "Export" buttons.
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
