// Adds ml_zone_clusters.tmdl to the semantic model and publishes via updateDefinition LRO.
const fs = require('fs');
const path = require('path');
const https = require('https');

const WS = '36075c3f-6958-4d8b-9a58-b41b3bad4832';
const MODEL = 'beaf9715-09be-4653-b6cd-31e47560633d';
const TOKEN = process.env.FABRIC_TOKEN;
if (!TOKEN) { console.error('Missing FABRIC_TOKEN'); process.exit(1); }

const def = JSON.parse(fs.readFileSync(path.join(__dirname, '_model_def.json'), 'utf8'));
let parts = def.definition.parts.slice();

// drop .platform (re-added by service) and any prior copy of the new table
parts = parts.filter(p => p.path !== '.platform' && p.path !== 'definition/tables/ml_zone_clusters.tmdl');

const tmdl = fs.readFileSync(path.join(__dirname, 'ml_zone_clusters.tmdl'));
parts.push({ path: 'definition/tables/ml_zone_clusters.tmdl', payload: tmdl.toString('base64'), payloadType: 'InlineBase64' });

function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = { hostname: 'api.fabric.microsoft.com', path: urlPath, method,
      headers: Object.assign({ 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
        data ? { 'Content-Length': Buffer.byteLength(data) } : {}) };
    const r = https.request(opts, res => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b })); });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const res = await req('POST', `/v1/workspaces/${WS}/semanticModels/${MODEL}/updateDefinition`,
    { definition: { parts } });
  console.log('POST status', res.status);
  if (res.status === 200) { console.log('Done (sync)'); return; }
  if (res.status !== 202) { console.error(res.body); process.exit(1); }
  const u = new URL(res.headers['location']);
  for (let i = 0; i < 80; i++) {
    await sleep(3000);
    const p = await req('GET', u.pathname + u.search, null);
    let st; try { st = JSON.parse(p.body).status; } catch { st = p.body; }
    console.log('poll', i, st);
    if (st === 'Succeeded') { console.log('Model updated'); return; }
    if (st === 'Failed') { console.error('FAILED', p.body); process.exit(1); }
  }
  process.exit(1);
})();
