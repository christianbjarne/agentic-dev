import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResponse, startResponse, ORCHESTRATOR_AGENT } from '../packages/functions/dist/foundry.js';
import { fixOsmosLakehouseIds, resolveOsmosLakehouse, workspaceStatus, workspaceBranches, listWorkspaces } from '../packages/functions/dist/fabric.js';
import { isRunTerminal, isTaskTerminal, pollDelay, SPECIALISTS } from '../packages/shared/dist/index.js';
import { githubBranchView, githubCommitFiles } from '../packages/functions/dist/github.js';

test('terminal states and polling backoff are explicit and bounded', () => {
  for (const state of ['completed', 'failed', 'cancelled', 'incomplete']) assert.ok(isRunTerminal(state));
  for (const state of ['queued', 'working', 'in_progress']) assert.equal(isRunTerminal(state), false);
  assert.ok(isTaskTerminal('Cancelled'));
  assert.ok(isTaskTerminal('Completed'));
  assert.equal(pollDelay(0), 2000);
  assert.equal(pollDelay(2), 8000);
  assert.equal(pollDelay(999), 15000);
  assert.equal(SPECIALISTS.length, 10);
  assert.ok(!SPECIALISTS.some((agent) => agent.id === 'release_intelligence'));
});
test('response delegations come only from actual calls and matched outputs', () => {
  const result = parseResponse({ id: 'response-test', status: 'completed', output: [
    { type: 'function_call', name: 'delegate_to_specialist', call_id: 'call1', arguments: JSON.stringify({ specialist: 'data_engineer', task: 'Validate Silver' }) },
    { type: 'function_call_output', call_id: 'call1', output: 'Verified' },
    { type: 'function_call', name: 'delegate_to_specialist', call_id: 'call2', arguments: JSON.stringify({ specialist: 'fabric_iq', task: 'Inspect model' }) },
    { type: 'function_call_output', call_id: 'call2', output: '{"ok":false,"error":"Permission denied"}' },
    { type: 'function_call', name: 'delegate_to_specialist', call_id: 'call3', arguments: JSON.stringify({ specialist: 'integration', task: 'Check access' }) },
    { type: 'message', content: [{ type: 'output_text', text: 'The Power BI specialist could help next.' }] },
  ] });
  assert.deepEqual(result.delegations.map((item) => [item.agent, item.status]), [
    ['data_engineer', 'completed'], ['fabric_iq', 'failed'], ['integration', 'working'],
  ]);
  assert.equal(result.delegations.some((item) => item.agent === 'power_bi'), false);
});
test('all submissions use fabric-orchestrator with background storage and conversation continuity', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.ok(String(url).includes('/agents/fabric-orchestrator/endpoint/protocols/openai/responses?api-version=v1'));
      const body = JSON.parse(options.body);
      assert.equal(body.input, 'User request');
      assert.equal(body.background, true);
      assert.equal(body.store, true);
      assert.equal(body.previous_response_id, 'previous');
      assert.equal(body.agent_session_id, 'session');
      return Response.json({ id: 'new', status: 'queued', output: [] });
    };
    assert.equal(ORCHESTRATOR_AGENT, 'fabric-orchestrator');
    assert.equal((await startResponse('test', 'User request', 'previous', 'session')).started.id, 'new');
  } finally { globalThis.fetch = original; }
});
test('Osmos resolves LH_Osmos, rewrites labelled bronze ids, and refuses a missing target', async () => {
  const original = globalThis.fetch;
  const bronze = '3a8bc01a-fb6c-4914-a0bf-cce0bad7a34c';
  const osmos = '4934fb51-76de-47c2-a8c5-7f147200a867';
  const request = { workspaceId: 'abdee776-930b-41ce-8c32-38f56e3db16e', lakehouseId: bronze, displayName: 'Task',
    instruction: `Default lakehouse for the Spark session: LH_Osmos (${bronze}).\nSource bronze lakehouse: ${bronze}` };
  try {
    globalThis.fetch = async () => Response.json({ value: [{ id: bronze, displayName: 'bronze_layer_lh' }, { id: osmos, displayName: 'LH_Osmos' }] });
    const result = await resolveOsmosLakehouse('test', request);
    assert.equal(result.lakehouseId, osmos);
    assert.ok(result.instruction.startsWith(`Default lakehouse for the Spark session: LH_Osmos (${osmos})`));
    assert.ok(result.instruction.endsWith(`Source bronze lakehouse: ${bronze}`));
    globalThis.fetch = async () => Response.json({ value: [{ id: bronze, displayName: 'bronze_layer_lh' }] });
    await assert.rejects(resolveOsmosLakehouse('test', request), /no LH_Osmos/);
    assert.equal(fixOsmosLakehouseIds('Unrelated source', bronze, osmos), 'Unrelated source');
  } finally { globalThis.fetch = original; }
});
test('GitHub branch and commit selectors are sent to the provider, with real file patches', async () => {
  const original = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      if (String(url).includes('/pulls?')) return Response.json([{ number: 25, title: 'Changes', html_url: 'https://github.com/owner/repo/pull/25', state: 'open' }]);
      if (String(url).includes('/commits?')) return Response.json([{ sha: 'a'.repeat(40), html_url: 'https://github.com/owner/repo/commit/a', commit: { message: 'Real message', author: { name: 'Author', date: '2026-10-05T09:00:00Z' } } }]);
      return Response.json({ files: [{ filename: 'file.ts', status: 'modified', additions: 1, deletions: 1, patch: '-before\n+after' }] });
    };
    const view = await githubBranchView('test', 'owner/repo', 'feature/agents');
    assert.ok(calls.some((url) => url.includes('sha=feature%2Fagents')));
    assert.equal(view.commits[0].author, 'Author');
    assert.equal(view.pulls[0].number, 25);
    const files = await githubCommitFiles('test', 'owner/repo', 'a'.repeat(40));
    assert.equal(files[0].patch, '-before\n+after');
    await assert.rejects(githubCommitFiles('test', 'bad/repo/extra', 'a'.repeat(40)), /valid GitHub repository/);
  } finally { globalThis.fetch = original; }
});
test('Fabric Git status LRO resumes by operation id rather than starting another operation', async () => {
  const original = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      if (String(url).endsWith('/items')) return Response.json({ value: [] });
      if (String(url).endsWith('/git/connection')) return Response.json({ gitConnectionState: 'Connected', gitProviderDetails: { gitProviderType: 'GitHub', ownerName: 'owner', repositoryName: 'repo', branchName: 'main' } });
      if (String(url).endsWith('/operations/op/result')) return Response.json({ workspaceHead: 'a', remoteCommitHash: 'b', changes: [{ itemMetadata: { displayName: 'Notebook' }, workspaceChange: 'Modified', remoteChange: 'None' }] });
      if (String(url).endsWith('/operations/op')) return Response.json({ status: 'Succeeded' });
      return Response.json({ displayName: 'Workspace' });
    };
    const result = await workspaceStatus('test', 'workspace', 'op');
    assert.equal(result.git.changes, 1);
    assert.equal(result.git.branch, 'main');
    assert.ok(!calls.some((url) => url.endsWith('/git/status')));
  } finally { globalThis.fetch = original; }
});
test('branch-workspace discovery pages large catalogs and surfaces provider failures', async () => {
  const original = globalThis.fetch;
  const workspaces = Array.from({ length: 121 }, (_, index) => ({ id: `ws-${index}`, displayName: `Workspace ${index}` }));
  const details = { gitProviderType: 'GitHub', ownerName: 'owner', repositoryName: 'repo', branchName: 'main', directoryName: '/fabric' };
  try {
    globalThis.fetch = async () => Response.json({ value: Array.from({ length: 579 }, (_, index) => ({ id: `large-${index}`, displayName: `Workspace ${index}` })) });
    assert.equal((await listWorkspaces('test')).length, 579);
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/workspaces')) return Response.json({ value: workspaces });
      return Response.json({ gitProviderDetails: { ...details, branchName: String(url).includes('ws-120/') ? 'feature' : 'main' } });
    };
    let cursor = 0;
    const choices = [];
    do {
      const page = await workspaceBranches('test', 'ws-0', cursor);
      for (const choice of page.choices) if (!choices.some((item) => item.id === choice.id)) choices.push(choice);
      cursor = page.nextCursor;
    } while (cursor !== null);
    assert.equal(choices.length, 121);
    assert.equal(choices.find((choice) => choice.id === 'ws-120').branch, 'feature');
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/workspaces')) return Response.json({ value: workspaces });
      if (String(url).includes('/ws-0/')) return Response.json({ gitProviderDetails: details });
      return Response.json({ errorCode: 'TooManyRequests', message: 'Retry later' }, { status: 429 });
    };
    const throttled = await workspaceBranches('failure-case', 'ws-0', 40);
    assert.equal(throttled.nextCursor, 40);
    assert.ok(throttled.retryAfterSeconds >= 1);
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/workspaces')) return Response.json({ value: workspaces });
      if (String(url).includes('/ws-0/')) return Response.json({ gitProviderDetails: details });
      return Response.json({ message: 'Provider unavailable' }, { status: 503 });
    };
    const partial = await workspaceBranches('unavailable-case', 'ws-0', 120);
    assert.deepEqual(partial.choices.map((choice) => choice.id), ['ws-0']);
    assert.match(partial.warnings[0], /503|Provider unavailable/);
  } finally { globalThis.fetch = original; }
});
test('pending Git operations retain their id and failed operations never imply zero changes', async () => {
  const original = globalThis.fetch;
  let phase = 'Running';
  try {
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/items')) return Response.json({ value: [] });
      if (String(url).endsWith('/git/connection')) return Response.json({ gitConnectionState: 'Connected', gitProviderDetails: { branchName: 'main' } });
      if (String(url).endsWith('/operations/op')) return Response.json({ status: phase, error: { message: 'Git provider unavailable' } });
      return Response.json({ displayName: 'Workspace' });
    };
    const pending = await workspaceStatus('test', 'workspace', 'op');
    assert.equal(pending.git.operationId, 'op');
    assert.equal(pending.git.changes, undefined);
    phase = 'Failed';
    const failed = await workspaceStatus('test', 'workspace', 'op');
    assert.equal(failed.git.operationId, undefined);
    assert.equal(failed.git.changes, undefined);
    assert.match(failed.git.message, /Git provider unavailable|502/);
  } finally { globalThis.fetch = original; }
});
test('known branch selection uses native relations and verified views without tenant-wide fan-out', async () => {
  const original = globalThis.fetch;
  const calls = [];
  const workspaces = [{ id: 'ws-main', displayName: 'Main' }, { id: 'ws-feature', displayName: 'Feature' },
    ...Array.from({ length: 577 }, (_, index) => ({ id: `unvisited-${index}`, displayName: `Unvisited ${index}` }))];
  try {
    globalThis.fetch = async (url) => {
      const path = String(url);
      calls.push(path);
      if (path.endsWith('/workspaces')) return Response.json({ value: workspaces });
      if (path.endsWith('/items') || path.endsWith('/git/workspaceRelations')) return Response.json({ value: [] });
      if (path.endsWith('/git/connection')) return Response.json({ gitConnectionState: 'Connected',
        gitProviderDetails: { gitProviderType: 'GitHub', ownerName: 'owner', repositoryName: 'repo',
          branchName: path.includes('/ws-feature/') ? 'feature' : 'main', directoryName: '/' } });
      if (path.endsWith('/git/status')) return Response.json({ changes: [] });
      return Response.json({ displayName: 'Workspace' });
    };
    await workspaceStatus('known-peers', 'ws-main');
    await workspaceStatus('known-peers', 'ws-feature');
    const page = await workspaceBranches('known-peers', 'ws-main', 0, false);
    assert.deepEqual(page.choices.map((choice) => choice.branch).sort(), ['feature', 'main']);
    assert.equal(page.nextCursor, null);
    assert.ok(calls.some((url) => url.endsWith('/git/workspaceRelations')));
    assert.equal(calls.filter((url) => url.endsWith('/git/connection')).length, 3);
    assert.equal(calls.some((url) => url.includes('/unvisited-')), false);
  } finally { globalThis.fetch = original; }
});
