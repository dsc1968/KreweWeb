const puppeteer = require('puppeteer-core');

async function testPage(path) {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  await page.goto('file://' + path, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 800));

  const info = await page.evaluate(() => {
    const toggle = document.querySelector('.nav-toggle');
    const nav = document.querySelector('.site-nav');
    const cs = toggle ? getComputedStyle(toggle) : null;
    const navCs = nav ? getComputedStyle(nav) : null;
    return {
      toggleExists: !!toggle,
      toggleDisplay: cs ? cs.display : 'N/A',
      navExists: !!nav,
      navDisplay: navCs ? navCs.display : 'N/A',
      navOpenClass: nav ? nav.classList.contains('is-open') : 'N/A',
      headerInnerExists: !!document.querySelector('.header-inner'),
    };
  });

  let afterClick = {};
  if (info.toggleExists) {
    await page.click('.nav-toggle').catch((e) => errors.push('CLICK FAIL: ' + e.message));
    await new Promise((r) => setTimeout(r, 300));
    afterClick = await page.evaluate(() => {
      const nav = document.querySelector('.site-nav');
      const cs = nav ? getComputedStyle(nav) : null;
      const rect = nav ? nav.getBoundingClientRect() : null;
      return {
        navOpenAfterClick: nav ? nav.classList.contains('is-open') : 'N/A',
        navDisplayAfterClick: cs ? cs.display : 'N/A',
        navHeight: rect ? Math.round(rect.height) : 'N/A',
      };
    });
  }

  console.log('=== ' + path.split('/').pop() + ' ===');
  console.log(JSON.stringify({ ...info, ...afterClick }, null, 2));
  if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
  await browser.close();
}

(async () => {
  await testPage('/home/doug/kreweweb/Krewe/frontend/history.html');
  await testPage('/home/doug/kreweweb/Krewe/frontend/index.html');
})();
