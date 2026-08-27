// Re-fetches current model definition, appends fare TMDL tables, updateDefinition, then refresh.
const fs = require('fs');
const path = require('path');
const https = require('https');

const WS = '36075c3f-6958-4d8b-9a58-b41b3bad4832';
const MODEL = 'beaf9715-09be-4653-b6cd-31e47560633d';
const TOKEN = process.env.FABRIC_TOKEN;          // fabric api token
const PBI = process.env.PBI_TOKEN;               // powerbi api token (refresh)
if (!TOKEN || !PBI) { console.error('Need FABRIC_TOKEN and PBI_TOKEN'); process.exit(1); }

const NEW_TABLES = ['ml_fare_metrics', 'ml_fare_coef', 'ml_fare_eval'];

function req(host, method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = { hostname: host, path: urlPath, method,
      headers: Object.assign({ 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        data ? { 'Content-Length': Buffer.byteLength(data) } : {}) };
    const r = https.request(opts, res => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b })); });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const F = (m, p, b) => req('api.fabric.microsoft.com', m, p, b, TOKEN);

async function pollFabric(loc) {
  const u = new URL(loc);
  for (let i = 0; i < 80; i++) { await sleep(3000);
    const p = await F('GET', u.pathname + u.search, null);
    let st; try { st = JSON.parse(p.body).status; } catch { st = p.body; }
    if (st === 'Succeeded' || st === 'Failed') return { st, body: p.body, loc: u };
  }
  return { st: 'Timeout' };
}

(async () => {
  // 1. fetch current definition
  const g = await F('POST', `/v1/workspaces/${WS}/semanticModels/${MODEL}/getDefinition`, {});
  let parts;
  if (g.status === 200) parts = JSON.parse(g.body).definition.parts;
  else {
    const r = await pollFabric(g.headers['location']);
    if (r.st !== 'Succeeded') { console.error('getDefinition', r.st, r.body); process.exit(1); }
    const res = await F('GET', r.loc.pathname + '/result', null);
    parts = JSON.parse(res.body).definition.parts;
  }
  console.log('current parts:', parts.length, '| has zone table:',
    parts.some(p => p.path === 'definition/tables/ml_zone_clusters.tmdl'));

  // 2. append/replace fare tmdl parts
  parts = parts.filter(p => p.path !== '.platform' &&
    !NEW_TABLES.some(t => p.path === `definition/tables/${t}.tmdl`));
  for (const t of NEW_TABLES) {
    const tmdl = fs.readFileSync(path.join(__dirname, `${t}.tmdl`));
    parts.push({ path: `definition/tables/${t}.tmdl`, payload: tmdl.toString('base64'), payloadType: 'InlineBase64' });
  }
  console.log('publishing parts:', parts.length);

  // 3. updateDefinition
  const u = await F('POST', `/v1/workspaces/${WS}/semanticModels/${MODEL}/updateDefinition`, { definition: { parts } });
  console.log('update status', u.status);
  if (u.status === 202) { const r = await pollFabric(u.headers['location']); console.log('update LRO', r.st); if (r.st !== 'Succeeded') { console.error(r.body); process.exit(1); } }
  else if (u.status !== 200) { console.error(u.body); process.exit(1); }

  // 4. refresh dataset (reframe Direct Lake)
  await sleep(3000);
  const rf = await req('api.powerbi.com', 'POST', `/v1.0/myorg/groups/${WS}/datasets/${MODEL}/refreshes`, { type: 'full' }, PBI);
  console.log('refresh trigger', rf.status);
  for (let i = 0; i < 40; i++) {
    await sleep(5000);
    const s = await req('api.powerbi.com', 'GET', `/v1.0/myorg/groups/${WS}/datasets/${MODEL}/refreshes?$top=1`, null, PBI);
    const last = JSON.parse(s.body).value[0];
    process.stdout.write(`\rrefresh ${i} status=${last.status}      `);
    if (last.status === 'Completed') { console.log('\nRefresh Completed'); return; }
    if (last.status === 'Failed') { console.log('\nRefresh FAILED'); console.error(s.body); process.exit(1); }
  }
  console.error('\nrefresh timeout'); process.exit(1);
})();
