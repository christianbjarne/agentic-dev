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
 * Usage:  node scripts/smoke-deployed.mjs [--prompt "..."] [--skip-run]
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
  client.functions.getWorkspaceStatus.invoke({ workspaceId: target.fabricWorkspaceId }),
);
log('workspace', {
  ok: status.ok,
  message: status.message,
  workspaceName: status.workspaceName,
  itemCounts: status.itemCounts,
  jobs: status.jobs?.slice(0, 8),
  git: status.git,
});

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
  while (run.status !== 'completed' && run.status !== 'failed' && Date.now() < deadline) {
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
  const history = await time('getConversation (persisted)', () =>
    client.functions.getConversation.invoke({ conversationId: conversation.id }),
  );
  log('history', history.map((item) => ({ runKey: item.runKey, status: item.status, events: item.events.length })));
  const feed = await time('RunEvent feed', () =>
    client.data.RunEvent.select(['agent', 'status', 'runKey', 'createdAt']).orderBy({ createdAt: 'desc' }).first(10).execute(),
  );
  log('feed', feed);
}
process.exit(0);
