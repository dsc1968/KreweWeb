const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto('http://localhost:8000/', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 1500));

  const report = await page.evaluate(() => {
    const out = { editModeActive: false, overlayCount: 0, overlays: [], buttons: [] };
    out.editModeActive = !!document.querySelector('.admin-selection-handles-overlay, .admin-element-toolbar, .admin-nav-controls');
    out.overlayCount = document.querySelectorAll('.admin-selection-handles-overlay').length;

    document.querySelectorAll('body *').forEach(el => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if ((cs.position === 'fixed' || cs.position === 'absolute') && r.width > 50 && r.height > 50 && parseFloat(cs.opacity || '1') > 0.01) {
        out.overlays.push({
          tag: el.tagName,
          cls: el.className && el.className.toString ? el.className.toString() : '',
          pos: cs.position,
          z: cs.zIndex,
          pe: cs.pointerEvents,
          cursor: cs.cursor,
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        });
      }
    });

    const btns = Array.from(document.querySelectorAll('.hero-actions a'));
    btns.forEach(b => {
      const r = b.getBoundingClientRect();
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      const top = document.elementFromPoint(cx, cy);
      out.buttons.push({
        text: b.textContent.trim(),
        href: b.getAttribute('href'),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        topElementAtCenter: top ? (top.tagName + '.' + (top.className && top.className.toString ? top.className.toString() : '')) : 'none',
        isButtonItself: top === b,
      });
    });

    const ha = document.querySelector('.hero-actions');
    if (ha) {
      let el = ha;
      out.heroActionsChain = [];
      while (el && el !== document.body) {
        const cs = getComputedStyle(el);
        out.heroActionsChain.push({ tag: el.tagName, cls: el.className && el.className.toString ? el.className.toString() : '', pe: cs.pointerEvents, z: cs.zIndex, pos: cs.position });
        el = el.parentElement;
      }
    }
    return out;
  });

  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
