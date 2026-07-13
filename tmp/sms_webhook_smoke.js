const http = require('http');
const path = require('path');

const receiver = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    console.log('RECEIVED:', req.method, req.url, 'BODY=' + body);
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });
});

receiver.listen(9123, async () => {
  const emailUtil = path.resolve(process.cwd(), 'backend/utils/email.js');

  // 1) Webhook configured (primary var) -> should POST and report delivered.
  process.env.SMS_WEBHOOK_URL = 'http://localhost:9123/hook';
  const { dispatchMfaCode } = require(emailUtil);
  const r1 = await dispatchMfaCode('sms', '5551234567', '123456');
  console.log('CASE1 (webhook set):', JSON.stringify(r1));

  // 2) Alias TEXTEDLY_WEBHOOK_URL also works.
  delete process.env.SMS_WEBHOOK_URL;
  process.env.TEXTEDLY_WEBHOOK_URL = 'http://localhost:9123/zapier';
  const r2 = await dispatchMfaCode('sms', '+15551234567', '654321');
  console.log('CASE2 (textedly alias):', JSON.stringify(r2));

  // 3) Misconfigured webhook (bad host) in dev -> devCode fallback.
  process.env.SMS_WEBHOOK_URL = 'http://127.0.0.1:1/dead';
  delete process.env.TEXTEDLY_WEBHOOK_URL;
  const r3 = await dispatchMfaCode('sms', '5550001111', '000000');
  console.log('CASE3 (webhook down, dev):', JSON.stringify(r3));

  receiver.close();
  process.exit(0);
});
