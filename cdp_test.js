const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}

(async () => {
  const chrome = spawn('/usr/bin/google-chrome', [
    '--headless=new', '--no-sandbox', '--disable-gpu',
    '--remote-debugging-port=9222', '--window-size=420,844',
    'about:blank',
  ], { stdio: 'ignore' });

  await new Promise((r) => setTimeout(r, 1500));
  const list = await getJson('http://localhost:9222/json');
  const target = list.find((t) => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  function send(method, params) {
    return new Promise((resolve) => {
      const msgId = ++id;
      pending.set(msgId, resolve);
      ws.send(JSON.stringify({ id: msgId, method, params: params || {} }));
    });
  }
  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
  });
  await new Promise((r) => ws.on('open', r));
  await send('Runtime.enable');

  async function evalExpr(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return r.result && r.result.value;
  }

  const fileUrl = 'file:///home/doug/kreweweb/Krewe/frontend/history.html';
  await send('Page.enable');
  await send('Page.navigate', { url: fileUrl });
  await new Promise((r) => setTimeout(r, 1500));

  const before = await evalExpr(`(function(){
    var t = document.querySelector('.nav-toggle');
    var nav = document.querySelector('.site-nav');
    var cs = t ? getComputedStyle(t) : null;
    var r = t ? t.getBoundingClientRect() : null;
    var hit = (r) ? document.elementFromPoint(r.left + r.width/2, r.top + r.height/2) : null;
    return {
      toggleExists: !!t,
      toggleDisplay: cs ? cs.display : 'N/A',
      navDisplay: nav ? getComputedStyle(nav).display : 'N/A',
      navOpen: nav ? nav.classList.contains('is-open') : 'N/A',
      toggleRect: r ? {x:Math.round(r.left), y:Math.round(r.top), w:Math.round(r.width), h:Math.round(r.height)} : null,
      hitTag: hit ? hit.tagName + '.' + hit.className : 'NONE',
      hitIsToggle: hit ? (hit === t || t.contains(hit)) : false
    };
  })()`);

  const clickResult = await evalExpr(`(function(){
    var t = document.querySelector('.nav-toggle');
    if (!t) return 'no-toggle';
    t.click();
    var nav = document.querySelector('.site-nav');
    return { navOpen: nav.classList.contains('is-open'), navDisplay: getComputedStyle(nav).display };
  })()`);

  const after = await evalExpr(`(function(){
    var nav = document.querySelector('.site-nav');
    var cs = getComputedStyle(nav);
    var r = nav.getBoundingClientRect();
    var cx = r.left + r.width/2;
    var cy = r.top + r.height/2;
    var hit = document.elementFromPoint(cx, cy);
    return {
      navOpen: nav.classList.contains('is-open'),
      navDisplay: cs.display,
      navHeight: Math.round(r.height),
      navRect: {x:Math.round(r.left), y:Math.round(r.top), w:Math.round(r.width), h:Math.round(r.height)},
      hitTag: hit ? hit.tagName + (hit.className ? '.'+hit.className : '') : 'NONE',
      hitInsideNav: nav.contains(hit)
    };
  })()`);

  console.log('BEFORE CLICK:', JSON.stringify(before, null, 2));
  console.log('CLICK RESULT:', JSON.stringify(clickResult));
  console.log('AFTER CLICK:', JSON.stringify(after, null, 2));

  ws.close();
  chrome.kill();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
