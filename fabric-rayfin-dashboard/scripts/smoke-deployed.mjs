#!/usr/bin/env node
/**
 * Headless smoke test against the DEPLOYED Fabric app, as the signed-in user.
 *
 * It uses the same brokered Entra -> Rayfin exchange the app's Fabric auth
 * provider uses (POST /api/auth/v1/brokered/token), with a delegated Power BI
 * token (Item.Execute.All) minted from the `npx rayfin login` cache. Every
 * request then runs through the deployed AppBackend: Rayfin DB with RLS and the
 * deployed Functions. Tokens are never printed.
 *
 * Usage:  node scripts/smoke-deployed.mjs [--prompt "..."] [--skip-run] [--create-osmos]
 *         --create-osmos submits the run's Project Osmos handoff (creates a real task).
 *         --osmos-run <runKey> retries the Osmos submission for an existing run.
 */
import { readFileSync } from 'node:fs';
import { RayfinClient } from '@microsoft/rayfin-client';
import { signInWithBrokeredToken } from '@microsoft/rayfin-auth-provider-fabric';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const deployments = JSON.parse(readFileSync(new URL('../rayfin/.deployments.json', import.meta.url), 'utf8'));
const target = deployments.deployments[deployments.active];
const baseUrl = target.fabricApiUrl.replace(/\/$/, '');

const auth = await import(new URL('../node_modules/@microsoft/rayfin-cli/dist/auth/index.js', import.meta.url).href);
const minted = await auth.getAuthenticatedToken(['https://analysis.windows.net/powerbi/api/Item.Execute.All']);
const entraToken = typeof minted === 'string' ? minted : (minted.accessToken ?? minted.token);

const exchange = await fetch(`${baseUrl}/api/auth/v1/brokered/token`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${entraToken}`, 'Content-Type': 'application/json' },
  body: '{}',
});
if (!exchange.ok) throw new Error(`Brokered exchange failed: HTTP ${exchange.status}`);

const client = new RayfinClient({ baseUrl, publishableKey: target.publishableKey });
await signInWithBrokeredToken(client.auth, await exchange.json());

const log = (label, value) => console.log(`\n== ${label}\n${JSON.stringify(value, null, 2)}`);
const time = async (label, fn) => {
  const started = Date.now();
  try {
    const value = await fn();
    console.log(`[ok] ${label} (${Date.now() - started} ms)`);
    return value;
  } catch (error) {
    console.log(`[fail] ${label}: ${error?.message ?? error}`);
    throw error;
  }
};

const identity = await time('whoAmI', () => client.functions.whoAmI.invoke());
log('identity', identity);

const status = await time('getWorkspaceStatus', () =>
  client.functions.getWorkspaceStatus.invoke({ workspaceId: option('--workspace-id') ?? target.fabricWorkspaceId, gitOperationId: '' }),
);
log('workspace', {
  ok: status.ok,
  message: status.message,
  workspaceName: status.workspaceName,
  itemCounts: status.itemCounts,
  jobs: status.jobs?.slice(0, 8),
  git: status.git,
});

if (flag('--branches')) {
  const workspaceId = option('--workspace-id') ?? target.fabricWorkspaceId;
  const choices = [];
  const deadline = Date.now() + 5 * 60_000;
  let cursor = 0;
  do {
    if (Date.now() > deadline) throw new Error('Branch discovery exceeded its monitoring deadline.');
    const page = await time(`getWorkspaceBranches cursor=${cursor}`, () =>
      client.functions.getWorkspaceBranches.invoke({ workspaceId, cursor, discover: true }),
    );
    choices.push(...page.choices);
    if (page.warnings.length) log('branch discovery warnings', page.warnings);
    cursor = page.nextCursor;
    if (page.retryAfterSeconds) await new Promise((resolve) => setTimeout(resolve, page.retryAfterSeconds * 1000));
  } while (cursor !== null);
  log('existing branch workspaces', choices);
  const alternate = choices.find((choice) => choice.id !== workspaceId);
  if (alternate) {
    const live = await time('alternate branch workspace', () =>
      client.functions.getWorkspaceStatus.invoke({ workspaceId: alternate.id, gitOperationId: '' }),
    );
    log('branch switch evidence', { workspaceId: live.workspaceId, branch: live.git?.branch, items: live.items.length });
    if (live.workspaceId !== alternate.id || live.git?.branch !== alternate.branch) throw new Error('Branch workspace did not match the selected branch.');
  }
}

if (flag('--catalog')) {
  const workspaces = await time('getWorkspaces', () => client.functions.getWorkspaces.invoke());
  log('workspace choices', workspaces);
  const alternate = workspaces.find((item) => item.id !== target.fabricWorkspaceId);
  if (alternate) {
    const live = await time('alternate workspace selection', () => client.functions.getWorkspaceStatus.invoke({ workspaceId: alternate.id, gitOperationId: '' }));
    log('alternate workspace', { id: live.workspaceId, name: live.workspaceName, items: live.items?.length, git: live.git, warnings: live.warnings });
  }
  const repos = await time('getGitHubRepositories', () => client.functions.getGitHubRepositories.invoke());
  console.log(`Accessible GitHub repositories: ${repos.length}`);
  for (const repo of repos.filter((item) => ['christianbjarne/agentic-dev', 'christianbjarne/fabric-foundry-agents'].includes(item.name))) {
    const branches = await time(`branches ${repo.name}`, () => client.functions.getGitHubBranches.invoke({ repository: repo.name }));
    console.log(`${repo.name}: ${branches.length} branches`);
    for (const branch of [repo.defaultBranch, branches.find((name) => name !== repo.defaultBranch)].filter(Boolean)) {
      const view = await time(`branch ${repo.name}:${branch}`, () => client.functions.getGitHubBranch.invoke({ repository: repo.name, branch }));
      log('branch commits', { repo: repo.name, branch, count: view.commits.length, first: view.commits[0], pulls: view.pulls });
      if (view.commits[0]) {
        const files = await time('commit files', () => client.functions.getGitHubCommit.invoke({ repository: repo.name, sha: view.commits[0].sha }));
        log('commit file evidence', { files: files.length, patches: files.filter((file) => file.patch).length, names: files.slice(0, 6).map((file) => file.filename) });
      }
    }
  }
  log('live feed', (await time('getLiveFeed', () => client.functions.getLiveFeed.invoke())).map((event) => ({ agent: event.agent, status: event.status, runKey: event.runKey })));
}

const osmosRun = option('--osmos-run');
if (osmosRun) {
  const created = await time('createOsmosTask', () => client.functions.createOsmosTask.invoke({ runKey: osmosRun }));
  log('osmos task', created);
  if (created.ok) {
    await new Promise((resolve) => setTimeout(resolve, 15000));
    log('osmos status', await time('getOsmosTask', () => client.functions.getOsmosTask.invoke({ runKey: osmosRun })));
  }
  process.exit(0);
}

if (!flag('--skip-run')) {
  const prompt =
    option('--prompt') ??
    'Ask the guideline_auditor specialist for the three most important Fabric data engineering guidelines in this project. Keep the answer short.';
  let run = await time('startRun', () =>
    client.functions.startRun.invoke({ prompt, conversationId: option('--conversation') ?? '' }),
  );
  const conversation = { id: run.conversationId };
  console.log(`runKey=${run.runKey} conversationId=${conversation.id}`);
  const deadline = Date.now() + 12 * 60_000;
  while (!['completed', 'failed', 'cancelled', 'incomplete'].includes(run.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 8000));
    run = await client.functions.pollRun.invoke({ runKey: run.runKey });
    console.log(`  status=${run.status} events=${run.events.length}`);
  }
  log('run', {
    status: run.status,
    error: run.error,
    events: run.events.map((event) => ({ agent: event.agent, status: event.status, task: event.task.slice(0, 120) })),
    response: run.response?.slice(0, 1500),
    osmos: run.osmos,
  });
  if (flag('--create-osmos') && run.osmos) {
    const created = await time('createOsmosTask', () => client.functions.createOsmosTask.invoke({ runKey: run.runKey }));
    log('osmos task', created);
    if (created.ok) {
      await new Promise((resolve) => setTimeout(resolve, 15000));
      log('osmos status', await time('getOsmosTask', () => client.functions.getOsmosTask.invoke({ runKey: run.runKey })));
    }
  }
  const history = await time('getConversation (persisted)', () =>
    client.functions.getConversation.invoke({ conversationId: conversation.id }),
  );
  log('history', history.map((item) => ({ runKey: item.runKey, status: item.status, events: item.events.length })));
  if (!['completed', 'failed', 'cancelled', 'incomplete'].includes(run.status)) throw new Error('Run did not reach a terminal state within the smoke deadline.');
  if (run.events.some((event) => event.status === 'working' && event.agent !== 'osmos_task')) throw new Error('A terminal run still has a working Foundry agent event.');
  const feed = await time('RunEvent feed', () =>
    client.data.RunEvent.select(['agent', 'status', 'runKey', 'createdAt']).orderBy({ createdAt: 'desc' }).first(10).execute(),
  );
  log('feed', feed);
}
process.exit(0);
