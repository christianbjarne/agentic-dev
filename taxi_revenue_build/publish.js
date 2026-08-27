// Publishes the Taxi Revenue PBIR to Fabric via updateDefinition LRO.
const fs = require('fs');
const path = require('path');
const https = require('https');

const WS = '36075c3f-6958-4d8b-9a58-b41b3bad4832';
const REPORT_ID = '6306a0e0-03f5-44f8-9d1e-c53475ba9747';
const REPORT_DIR = path.join(__dirname, 'Taxi Revenue.Report');
const TOKEN = process.env.FABRIC_TOKEN;
if (!TOKEN) { console.error('Missing FABRIC_TOKEN'); process.exit(1); }

function walk(dir, base) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) out = out.concat(walk(full, rel));
    else out.push({ rel, full });
  }
  return out;
}

const parts = walk(REPORT_DIR, '')
  .filter(f => path.basename(f.full) !== '.platform')
  .map(f => ({
    path: f.rel,
    payload: fs.readFileSync(f.full).toString('base64'),
    payloadType: 'InlineBase64'
  }));

console.log('Parts:', parts.length);

function req(method, urlPath, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'api.fabric.microsoft.com',
      path: urlPath, method,
      headers: Object.assign({
        'Authorization': 'Bearer ' + TOKEN,
        'Content-Type': 'application/json'
      }, data ? { 'Content-Length': Buffer.byteLength(data) } : {}, extraHeaders || {})
    };
    const r = https.request(opts, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const res = await req('POST',
    `/v1/workspaces/${WS}/reports/${REPORT_ID}/updateDefinition`,
    { definition: { parts } });
  console.log('POST status', res.status);
  if (res.status === 200) { console.log('Done (sync).'); return; }
  if (res.status !== 202) { console.error('Body:', res.body); process.exit(1); }
  let loc = res.headers['location'];
  const u = new URL(loc);
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const p = await req('GET', u.pathname + u.search, null);
    let st;
    try { st = JSON.parse(p.body).status; } catch { st = p.body; }
    console.log('poll', i, st);
    if (st === 'Succeeded') { console.log('Publish Succeeded'); return; }
    if (st === 'Failed') { console.error('FAILED', p.body); process.exit(1); }
  }
  console.error('Timed out polling');
  process.exit(1);
})();
