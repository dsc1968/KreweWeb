// Shop Reports — inventory & orders reporting with sort/group/filter plus
// Excel and PDF export. Dark-themed, dependency-free. Reuses window.ReportExport
// for the .xlsx writer and print helper, and the global getToken/escHtml helpers.
(function () {
  'use strict';

  const PRODUCTS_PATH = '/api/admin/shop/products';
  const ORDERS_REPORT_PATH = '/api/admin/shop/orders/report';

  function esc(s) {
    if (typeof escHtml === 'function') return escHtml(s);
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function el(id) { return document.getElementById(id); }
  function money(n) { return '$' + Number(n || 0).toFixed(2); }
  function dateStr(v) { return v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''; }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

  // ── Report definitions ────────────────────────────────────────────────────
  // Each report knows how to normalise its records, and declares columns,
  // group-by options, sort options and filters. Rendering/exporting is generic.
  const REPORTS = {
    inventory: {
      label: 'Inventory',
      sheetName: 'Inventory',
      columns: [
        { label: 'Name', text: (r) => r.name },
        { label: 'Category', text: (r) => r.category || '—' },
        { label: 'Type', text: (r) => r.type },
        { label: 'Price', align: 'right', text: (r) => money(r.price) },
        { label: 'Stock', align: 'right', text: (r) => (r.stock == null ? '∞' : String(r.stock)) },
        { label: 'Status', text: (r) => (r.active ? 'Active' : 'Inactive'), badge: (r) => (r.active ? 'active' : 'inactive') },
        { label: 'Inventory Value', align: 'right', text: (r) => (r.stock == null ? '—' : money(r.price * r.stock)) },
      ],
      groups: {
        none: { label: 'No grouping' },
        category: { label: 'Category', of: (r) => r.category || 'Uncategorized' },
        status: { label: 'Status', of: (r) => (r.active ? 'Active' : 'Inactive') },
        type: { label: 'Type', of: (r) => r.type },
      },
      sorts: {
        name: { label: 'Name', val: (r) => r.name.toLowerCase() },
        category: { label: 'Category', val: (r) => (r.category || '').toLowerCase() },
        price: { label: 'Price', val: (r) => Number(r.price) },
        stock: { label: 'Stock', val: (r) => (r.stock == null ? Infinity : r.stock) },
        status: { label: 'Status', val: (r) => (r.active ? 0 : 1) },
      },
      defaultSort: 'name',
      filters: [
        {
          id: 'status', label: 'Status', type: 'select',
          options: [['', 'All'], ['active', 'Active'], ['inactive', 'Inactive']],
          test: (r, v) => !v || (v === 'active' ? r.active : !r.active),
        },
        {
          id: 'type', label: 'Type', type: 'select',
          options: [['', 'All'], ['Product', 'Products'], ['Coupon', 'Coupons'], ['Donation', 'Donations']],
          test: (r, v) => !v || r.type === v,
        },
        {
          id: 'stock', label: 'Stock', type: 'select',
          options: [['', 'All'], ['in', 'In stock'], ['out', 'Out of stock'], ['low', 'Low (≤5)']],
          test: (r, v) => {
            if (!v) return true;
            if (v === 'in') return r.stock == null || r.stock > 0;
            if (v === 'out') return r.stock === 0;
            if (v === 'low') return r.stock != null && r.stock <= 5;
            return true;
          },
        },
        {
          id: 'search', label: 'Search', type: 'text', placeholder: 'Name or category',
          test: (r, v) => {
            if (!v) return true;
            const q = v.toLowerCase();
            return r.name.toLowerCase().indexOf(q) !== -1 || (r.category || '').toLowerCase().indexOf(q) !== -1;
          },
        },
      ],
      groupMeta: (records) => {
        const value = records.reduce((s, r) => s + (r.stock == null ? 0 : r.price * r.stock), 0);
        return records.length + ' item' + (records.length === 1 ? '' : 's') + '  •  ' + money(value) + ' value';
      },
      summary: (records) => {
        const active = records.filter((r) => r.active).length;
        const value = records.reduce((s, r) => s + (r.stock == null ? 0 : r.price * r.stock), 0);
        return records.length + ' product' + (records.length === 1 ? '' : 's') +
          '  •  ' + active + ' active  •  ' + money(value) + ' inventory value';
      },
    },

    orders: {
      label: 'Orders',
      sheetName: 'Orders',
      columns: [
        { label: 'Order #', text: (r) => '#' + r.id },
        { label: 'Date', text: (r) => dateStr(r.created_at) },
        { label: 'Buyer', text: (r) => r.buyer_name },
        { label: 'Email', text: (r) => r.buyer_email },
        { label: 'Items', align: 'right', text: (r) => String(r.item_count) },
        { label: 'Total', align: 'right', text: (r) => money(r.total_amount) },
        { label: 'Status', text: (r) => cap(r.status), badge: (r) => 'order-' + r.status },
        { label: 'Payment', text: (r) => cap(r.payment_status), badge: (r) => 'pay-' + r.payment_status },
      ],
      groups: {
        none: { label: 'No grouping' },
        status: { label: 'Order Status', of: (r) => cap(r.status) },
        payment: { label: 'Payment', of: (r) => cap(r.payment_status) },
        month: { label: 'Month', of: (r) => new Date(r.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) },
        buyer: { label: 'Buyer', of: (r) => r.buyer_name || 'Unknown' },
      },
      sorts: {
        date: { label: 'Date', val: (r) => new Date(r.created_at).getTime() },
        id: { label: 'Order #', val: (r) => r.id },
        buyer: { label: 'Buyer', val: (r) => (r.buyer_name || '').toLowerCase() },
        total: { label: 'Total', val: (r) => Number(r.total_amount) },
        status: { label: 'Status', val: (r) => r.status },
        payment: { label: 'Payment', val: (r) => r.payment_status },
      },
      defaultSort: 'date',
      defaultDir: 'desc',
      filters: [
        {
          id: 'status', label: 'Status', type: 'select',
          options: [['', 'All'], ['pending', 'Pending'], ['processing', 'Processing'], ['shipped', 'Shipped'], ['completed', 'Completed'], ['cancelled', 'Cancelled']],
          test: (r, v) => !v || r.status === v,
        },
        {
          id: 'payment', label: 'Payment', type: 'select',
          options: [['', 'All'], ['succeeded', 'Paid'], ['declined', 'Declined'], ['unpaid', 'Unpaid'], ['pending', 'Pending']],
          test: (r, v) => !v || r.payment_status === v,
        },
        { id: 'from', label: 'From', type: 'date', test: (r, v) => !v || new Date(r.created_at) >= new Date(v + 'T00:00:00') },
        { id: 'to', label: 'To', type: 'date', test: (r, v) => !v || new Date(r.created_at) <= new Date(v + 'T23:59:59') },
        {
          id: 'search', label: 'Search', type: 'text', placeholder: 'Buyer or email',
          test: (r, v) => {
            if (!v) return true;
            const q = v.toLowerCase();
            return (r.buyer_name || '').toLowerCase().indexOf(q) !== -1 || (r.buyer_email || '').toLowerCase().indexOf(q) !== -1;
          },
        },
      ],
      groupMeta: (records) => {
        const total = records.reduce((s, r) => s + Number(r.total_amount || 0), 0);
        return records.length + ' order' + (records.length === 1 ? '' : 's') + '  •  ' + money(total) + ' total';
      },
      summary: (records) => {
        const total = records.reduce((s, r) => s + Number(r.total_amount || 0), 0);
        const paid = records.filter((r) => r.payment_status === 'succeeded').length;
        return records.length + ' order' + (records.length === 1 ? '' : 's') +
          '  •  ' + paid + ' paid  •  ' + money(total) + ' total';
      },
    },
  };

  // ── State ─────────────────────────────────────────────────────────────────
  let inited = false;
  let token = null;
  const cache = { inventory: null, orders: null };
  const state = { report: 'inventory', group: 'none', sort: 'name', dir: 'asc', filters: {} };

  function setFeedback(msg, isError) {
    const fb = el('sr-feedback');
    if (!fb) return;
    fb.textContent = msg || '';
    fb.style.color = isError ? '#f87171' : 'var(--muted)';
  }

  // ── Data loading + normalising ────────────────────────────────────────────
  async function fetchJSON(path) {
    const res = await fetch(path, { headers: { Authorization: 'Bearer ' + token } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  function normaliseProducts(products) {
    return (products || []).map((p) => ({
      name: p.name || '',
      category: p.category || '',
      price: Number(p.price || 0),
      stock: p.stock_qty == null ? null : Number(p.stock_qty),
      active: p.active === true,
      type: p.is_coupon ? 'Coupon' : (p.is_donation ? 'Donation' : 'Product'),
    }));
  }

  function normaliseOrders(orders) {
    return (orders || []).map((o) => ({
      id: o.id,
      buyer_name: o.buyer_name || '',
      buyer_email: o.buyer_email || '',
      total_amount: Number(o.total_amount || 0),
      status: o.status || 'pending',
      payment_status: o.payment_status || 'pending',
      created_at: o.created_at,
      item_count: Number(o.item_count || (o.items || []).reduce((s, i) => s + Number(i.quantity || 0), 0)),
    }));
  }

  async function loadReportData(reportKey, force) {
    if (cache[reportKey] && !force) return cache[reportKey];
    if (reportKey === 'inventory') {
      const data = await fetchJSON(PRODUCTS_PATH);
      cache.inventory = { records: normaliseProducts(data.products), generatedAt: new Date().toISOString() };
    } else {
      const data = await fetchJSON(ORDERS_REPORT_PATH);
      cache.orders = { records: normaliseOrders(data.orders), generatedAt: data.generatedAt || new Date().toISOString() };
    }
    return cache[reportKey];
  }

  // ── Filtering / sorting / grouping ────────────────────────────────────────
  function applyPipeline(def, records) {
    let out = records.slice();
    def.filters.forEach((f) => {
      const v = state.filters[f.id];
      if (v == null || v === '') return;
      out = out.filter((r) => f.test(r, v));
    });
    const sorter = def.sorts[state.sort] || def.sorts[def.defaultSort];
    if (sorter) {
      out.sort((a, b) => {
        const av = sorter.val(a);
        const bv = sorter.val(b);
        if (av < bv) return -1;
        if (av > bv) return 1;
        return 0;
      });
      if (state.dir === 'desc') out.reverse();
    }
    return out;
  }

  function groupRecords(def, records) {
    const g = def.groups[state.group];
    if (!g || state.group === 'none' || !g.of) {
      return [{ key: '__all__', label: def.label, records: records }];
    }
    const order = [];
    const map = new Map();
    records.forEach((r) => {
      const label = g.of(r);
      if (!map.has(label)) { map.set(label, []); order.push(label); }
      map.get(label).push(r);
    });
    // Group headings sorted alphabetically for stable, predictable output.
    order.sort((a, b) => String(a).localeCompare(String(b)));
    return order.map((label) => ({ key: label, label: label, records: map.get(label) }));
  }

  // ── Rendering ─────────────────────────────────────────────────────────────
  function badgeHtml(kind, text) {
    let cls = 'sr-badge';
    if (kind === 'active') cls += ' sr-badge-active';
    else if (kind === 'inactive') cls += ' sr-badge-inactive';
    else if (kind.indexOf('order-') === 0) cls += ' sa-order-status ' + kind.slice(6);
    else if (kind.indexOf('pay-') === 0) cls += ' sa-pay-status ' + kind.slice(4);
    return '<span class="' + cls + '">' + esc(text) + '</span>';
  }

  function tableHtml(def, records) {
    const thead = '<thead><tr>' + def.columns.map((c) =>
      '<th' + (c.align === 'right' ? ' style="text-align:right;"' : '') + '>' + esc(c.label) + '</th>'
    ).join('') + '</tr></thead>';
    const body = records.length
      ? records.map((r) => '<tr>' + def.columns.map((c) => {
          const align = c.align === 'right' ? ' style="text-align:right;"' : '';
          const content = c.badge ? badgeHtml(c.badge(r), c.text(r)) : esc(c.text(r));
          return '<td' + align + '>' + content + '</td>';
        }).join('') + '</tr>').join('')
      : '<tr><td colspan="' + def.columns.length + '" class="sr-empty">No records.</td></tr>';
    return '<table class="sa-table sr-table">' + thead + '<tbody>' + body + '</tbody></table>';
  }

  function render() {
    const def = REPORTS[state.report];
    const output = el('shop-report-output');
    const summaryEl = el('sr-summary');
    const bundle = cache[state.report];
    if (!bundle) { if (output) output.innerHTML = ''; return; }

    const filtered = applyPipeline(def, bundle.records);
    const groups = groupRecords(def, filtered);

    if (summaryEl) {
      const when = bundle.generatedAt ? new Date(bundle.generatedAt) : new Date();
      summaryEl.textContent = def.summary(filtered) + '  •  generated ' + when.toLocaleString();
    }

    if (output) {
      output.innerHTML = groups.map((grp) =>
        '<section class="sr-block">' +
          '<div class="sr-block-head">' +
            '<h3 class="sr-block-title">' + esc(grp.label) + '</h3>' +
            '<span class="sr-block-meta">' + esc(def.groupMeta(grp.records)) + '</span>' +
          '</div>' +
          '<div style="overflow-x:auto;">' + tableHtml(def, grp.records) + '</div>' +
        '</section>'
      ).join('');
    }
  }

  // ── Dynamic control bar ───────────────────────────────────────────────────
  function optionsHtml(pairs, selected) {
    return pairs.map((p) => {
      const val = Array.isArray(p) ? p[0] : p;
      const label = Array.isArray(p) ? p[1] : p;
      return '<option value="' + esc(val) + '"' + (String(val) === String(selected) ? ' selected' : '') + '>' + esc(label) + '</option>';
    }).join('');
  }

  function buildControls() {
    const def = REPORTS[state.report];
    const wrap = el('sr-dynamic-controls');
    if (!wrap) return;

    const groupPairs = Object.keys(def.groups).map((k) => [k, def.groups[k].label]);
    const sortPairs = Object.keys(def.sorts).map((k) => [k, def.sorts[k].label]);

    let html = '';
    html += '<label class="sr-field">Group by' +
      '<select id="sr-group" class="sa-status-select">' + optionsHtml(groupPairs, state.group) + '</select></label>';
    html += '<label class="sr-field">Sort by' +
      '<select id="sr-sort" class="sa-status-select">' + optionsHtml(sortPairs, state.sort) + '</select></label>';
    html += '<label class="sr-field">Order' +
      '<select id="sr-dir" class="sa-status-select">' + optionsHtml([['asc', 'Ascending'], ['desc', 'Descending']], state.dir) + '</select></label>';

    def.filters.forEach((f) => {
      const cur = state.filters[f.id] != null ? state.filters[f.id] : '';
      if (f.type === 'select') {
        html += '<label class="sr-field">' + esc(f.label) +
          '<select id="sr-f-' + f.id + '" class="sa-status-select" data-filter="' + f.id + '">' + optionsHtml(f.options, cur) + '</select></label>';
      } else if (f.type === 'date') {
        html += '<label class="sr-field">' + esc(f.label) +
          '<input id="sr-f-' + f.id + '" type="date" class="sr-input" data-filter="' + f.id + '" value="' + esc(cur) + '" /></label>';
      } else {
        html += '<label class="sr-field">' + esc(f.label) +
          '<input id="sr-f-' + f.id + '" type="text" class="sr-input" data-filter="' + f.id + '" placeholder="' + esc(f.placeholder || '') + '" value="' + esc(cur) + '" /></label>';
      }
    });

    wrap.innerHTML = html;

    el('sr-group').addEventListener('change', (e) => { state.group = e.target.value; render(); });
    el('sr-sort').addEventListener('change', (e) => { state.sort = e.target.value; render(); });
    el('sr-dir').addEventListener('change', (e) => { state.dir = e.target.value; render(); });
    wrap.querySelectorAll('[data-filter]').forEach((ctrl) => {
      const evt = ctrl.tagName === 'INPUT' && ctrl.type === 'text' ? 'input' : 'change';
      ctrl.addEventListener(evt, () => { state.filters[ctrl.dataset.filter] = ctrl.value; render(); });
    });
  }

  // Resets group/sort/filters to the selected report's defaults.
  function resetStateForReport() {
    const def = REPORTS[state.report];
    state.group = 'none';
    state.sort = def.defaultSort;
    state.dir = def.defaultDir || 'asc';
    state.filters = {};
  }

  async function switchReport(reportKey) {
    state.report = reportKey;
    resetStateForReport();
    buildControls();
    setFeedback('Loading…');
    try {
      await loadReportData(reportKey);
      setFeedback('');
      render();
    } catch (err) {
      setFeedback(err.message || 'Unable to load report.', true);
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────
  function currentGroups() {
    const def = REPORTS[state.report];
    const bundle = cache[state.report];
    if (!bundle) return { def: def, groups: [], filtered: [] };
    const filtered = applyPipeline(def, bundle.records);
    return { def: def, groups: groupRecords(def, filtered), filtered: filtered };
  }

  function exportExcel() {
    const { def, groups, filtered } = currentGroups();
    if (!def) return;
    const rows = [];
    rows.push([{ v: def.label + ' Report — generated ' + new Date().toLocaleString(), bold: true }]);
    rows.push([{ v: def.summary(filtered) }]);
    rows.push([]);
    groups.forEach((grp) => {
      if (grp.key !== '__all__') rows.push([{ v: grp.label + '  (' + def.groupMeta(grp.records) + ')', bold: true }]);
      rows.push(def.columns.map((c) => ({ v: c.label, bold: true })));
      grp.records.forEach((r) => rows.push(def.columns.map((c) => ({ v: c.text(r) }))));
      rows.push([]);
    });
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    window.ReportExport.exportXlsx(rows, 'shop-' + state.report + '-report-' + stamp + '.xlsx', {
      sheetName: def.sheetName, title: def.label + ' Report',
    });
  }

  function exportPDF() {
    window.ReportExport.printWithBodyClass('printing-shop-report');
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  function initShopReports() {
    if (inited) return;
    const panel = document.querySelector('[data-shop-panel="reports"]');
    if (!panel) return;
    token = (typeof getToken === 'function') ? getToken() : null;
    if (!token) return;
    inited = true;

    const reportSel = el('sr-report');
    if (reportSel) reportSel.addEventListener('change', (e) => switchReport(e.target.value));
    const refreshBtn = el('sr-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', async () => {
      setFeedback('Refreshing…');
      try { await loadReportData(state.report, true); setFeedback(''); render(); }
      catch (err) { setFeedback(err.message || 'Refresh failed.', true); }
    });
    const excelBtn = el('sr-export-excel');
    if (excelBtn) excelBtn.addEventListener('click', exportExcel);
    const pdfBtn = el('sr-export-pdf');
    if (pdfBtn) pdfBtn.addEventListener('click', exportPDF);

    switchReport('inventory');
  }

  window.initShopReports = initShopReports;
})();
