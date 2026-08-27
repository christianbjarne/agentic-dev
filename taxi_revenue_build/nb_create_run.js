// Creates (or updates) the ML notebook in Fabric, then runs it and polls to completion.
const fs = require('fs');
const path = require('path');
const https = require('https');

const WS = '36075c3f-6958-4d8b-9a58-b41b3bad4832';
const TOKEN = process.env.FABRIC_TOKEN;
const DISPLAY = process.env.NB_DISPLAY || 'nb_ml_zone_segmentation';
const NB_FILE = process.env.NB_FILE || 'notebook-content.ipynb';
if (!TOKEN) { console.error('Missing FABRIC_TOKEN'); process.exit(1); }

const ipynb = fs.readFileSync(path.join(__dirname, NB_FILE));

function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'api.fabric.microsoft.com', path: urlPath, method,
      headers: Object.assign({ 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
        data ? { 'Content-Length': Buffer.byteLength(data) } : {})
    };
    const r = https.request(opts, res => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b })); });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function pollLro(loc) {
  const u = new URL(loc);
  for (let i = 0; i < 80; i++) {
    await sleep(3000);
    const p = await req('GET', u.pathname + u.search, null);
    let st; try { st = JSON.parse(p.body).status; } catch { st = p.body; }
    if (st === 'Succeeded' || st === 'Failed') return { st, body: p.body, headers: p.headers };
  }
  return { st: 'Timeout' };
}

(async () => {
  // find existing
  const list = await req('GET', `/v1/workspaces/${WS}/notebooks`, null);
  const items = JSON.parse(list.body).value || [];
  let nb = items.find(i => i.displayName === DISPLAY);
  const parts = [{ path: 'notebook-content.ipynb', payload: ipynb.toString('base64'), payloadType: 'InlineBase64' }];

  if (!nb) {
    const res = await req('POST', `/v1/workspaces/${WS}/notebooks`,
      { displayName: DISPLAY, definition: { format: 'ipynb', parts } });
    console.log('create status', res.status);
    if (res.status === 201) { nb = JSON.parse(res.body); }
    else if (res.status === 202) { const r = await pollLro(res.headers['location']); console.log('create LRO', r.st);
      const l2 = await req('GET', `/v1/workspaces/${WS}/notebooks`, null); nb = (JSON.parse(l2.body).value||[]).find(i=>i.displayName===DISPLAY); }
    else { console.error(res.body); process.exit(1); }
  } else {
    const res = await req('POST', `/v1/workspaces/${WS}/notebooks/${nb.id}/updateDefinition`,
      { definition: { format: 'ipynb', parts } });
    console.log('update status', res.status);
    if (res.status === 202) { const r = await pollLro(res.headers['location']); console.log('update LRO', r.st); }
  }
  console.log('notebook id', nb.id);
  fs.writeFileSync(path.join(__dirname, '_nb_id.txt'), nb.id);

  // run on demand
  const run = await req('POST', `/v1/workspaces/${WS}/items/${nb.id}/jobs/instances?jobType=RunNotebook`, {});
  console.log('run status', run.status);
  if (run.status !== 202) { console.error(run.body); process.exit(1); }
  const jobUrl = run.headers['location'];
  const ju = new URL(jobUrl);
  for (let i = 0; i < 120; i++) {
    await sleep(5000);
    const p = await req('GET', ju.pathname + ju.search, null);
    let j; try { j = JSON.parse(p.body); } catch { j = {}; }
    process.stdout.write(`\rjob ${i} status=${j.status}            `);
    if (j.status === 'Completed') { console.log('\nNotebook run Completed'); return; }
    if (j.status === 'Failed' || j.status === 'Cancelled' || j.status === 'Deduped') { console.log('\nRUN', j.status); console.error(p.body); process.exit(1); }
  }
  console.error('\nTimed out waiting for notebook run');
  process.exit(1);
})();
