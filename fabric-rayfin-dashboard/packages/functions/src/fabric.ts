import type { FabricJobView, OsmosTaskView, WorkspaceStatusView } from '@rayfin-app/shared';
import { randomUUID } from 'node:crypto';
import {
  asArray,
  asRecord,
  describeFailure,
  nowIso,
  request,
  str,
  type HttpResult,
} from './http.js';

export const FABRIC_API = 'https://api.fabric.microsoft.com';

/** Item types that expose `/jobs/instances` and are worth showing as jobs. */
const JOB_ITEM_TYPES = new Set([
  'Notebook',
  'DataPipeline',
  'SparkJobDefinition',
  'CopyJob',
  'Dataflow',
  'Lakehouse',
  'UserDataFunction',
  'MaterializedLakeView',
]);
const MAX_JOB_ITEMS = 25;
const JOBS_PER_ITEM = 5;

function bearer(token: string): string {
  return `Bearer ${token}`;
}

async function fabricGet(token: string, path: string): Promise<HttpResult> {
  return request('GET', `${FABRIC_API}${path}`, bearer(token), undefined, {}, 30_000);
}

async function listAll(token: string, path: string, limit = 500): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let url = path;
  while (url && items.length < limit) {
    const result = await fabricGet(token, url);
    if (!result.ok) throw new Error(describeFailure(`GET ${path}`, result));
    const body = asRecord(result.body);
    items.push(...asArray(body.value).map(asRecord));
    const token_ = str(body.continuationToken, 2000);
    url = token_ ? `${path}${path.includes('?') ? '&' : '?'}continuationToken=${encodeURIComponent(token_)}` : '';
  }
  return items;
}

/** Workspace summary, latest job instances and Fabric Git connection. */
export async function workspaceStatus(token: string, workspaceId: string): Promise<WorkspaceStatusView> {
  const checkedAt = nowIso();
  const workspace = await fabricGet(token, `/v1/workspaces/${workspaceId}`);
  if (!workspace.ok) {
    return {
      ok: false,
      message: describeFailure('Workspace lookup', workspace),
      workspaceId,
      itemCounts: [],
      jobs: [],
      checkedAt,
    };
  }
  const info = asRecord(workspace.body);
  const items = await listAll(token, `/v1/workspaces/${workspaceId}/items`);
  const counts = new Map<string, number>();
  for (const item of items) {
    const type = str(item.type, 64);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  const jobItems = items.filter((item) => JOB_ITEM_TYPES.has(str(item.type, 64))).slice(0, MAX_JOB_ITEMS);
  const jobLists = await Promise.all(
    jobItems.map(async (item): Promise<FabricJobView[]> => {
      const itemId = str(item.id, 64);
      const result = await fabricGet(token, `/v1/workspaces/${workspaceId}/items/${itemId}/jobs/instances`);
      if (!result.ok) return [];
      return asArray(asRecord(result.body).value)
        .map(asRecord)
        .map((job) => ({
          itemId,
          itemName: str(item.displayName, 200),
          itemType: str(item.type, 64),
          jobId: str(job.id, 64),
          jobType: str(job.jobType, 64),
          invokeType: str(job.invokeType, 64),
          status: str(job.status, 32),
          startTimeUtc: str(job.startTimeUtc, 40) || undefined,
          endTimeUtc: str(job.endTimeUtc, 40) || undefined,
          failureReason: str(asRecord(job.failureReason).message, 500) || undefined,
        }))
        .sort((a, b) => (b.startTimeUtc ?? '').localeCompare(a.startTimeUtc ?? ''))
        .slice(0, JOBS_PER_ITEM);
    }),
  );
  const jobs = jobLists
    .flat()
    .sort((a, b) => (b.startTimeUtc ?? '').localeCompare(a.startTimeUtc ?? ''))
    .slice(0, 40);

  const gitResult = await fabricGet(token, `/v1/workspaces/${workspaceId}/git/connection`);
  let git: WorkspaceStatusView['git'];
  if (gitResult.ok) {
    const body = asRecord(gitResult.body);
    const details = asRecord(body.gitProviderDetails);
    const connected = str(body.gitConnectionState, 40) !== 'NotConnected';
    git = {
      connected,
      provider: str(details.gitProviderType, 40) || undefined,
      repository:
        [str(details.ownerName ?? details.organizationName, 120), str(details.projectName, 120), str(details.repositoryName, 120)]
          .filter(Boolean)
          .join('/') || undefined,
      branch: str(details.branchName, 200) || undefined,
      directory: str(details.directoryName, 400) || undefined,
      message: connected ? undefined : 'This workspace is not connected to Git.',
    };
  } else {
    git = { connected: false, message: describeFailure('Git connection', gitResult) };
  }

  return {
    ok: true,
    workspaceId,
    workspaceName: str(info.displayName, 200),
    capacityRegion: str(info.capacityRegion, 80) || undefined,
    itemCounts: [...counts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    jobs,
    git,
    checkedAt,
  };
}

// --- Workspace context for prompts -----------------------------------------

const GUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const MAX_CONTEXT_WORKSPACES = 3;
const MAX_CONTEXT_ITEMS = 150;
const MAX_CONTEXT_CHARS = 12_000;

export interface PromptWorkspaceContext {
  text: string;
  workspaces: string[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Workspaces the prompt names (by Fabric URL, id or display name). */
function matchWorkspaces(prompt: string, all: Record<string, unknown>[]): Record<string, unknown>[] {
  const lower = prompt.toLowerCase();
  const ids = new Set<string>();
  for (const match of lower.matchAll(new RegExp(`(?:groups|workspaces)/(${GUID})`, 'g'))) ids.add(match[1]);
  for (const match of lower.matchAll(new RegExp(GUID, 'g'))) ids.add(match[0]);
  const picked: Record<string, unknown>[] = [];
  for (const workspace of all) {
    if (ids.has(str(workspace.id, 64).toLowerCase())) picked.push(workspace);
  }
  const byName = all
    .filter((workspace) => !picked.includes(workspace))
    .map((workspace) => ({ workspace, name: str(workspace.displayName, 200).toLowerCase() }))
    .filter(({ name }) => name.length >= 3 && name !== 'my workspace')
    .sort((a, b) => b.name.length - a.name.length);
  let remaining = lower;
  for (const { workspace, name } of byName) {
    const pattern = new RegExp(`(^|[^a-z0-9_-])${escapeRegExp(name)}($|[^a-z0-9_-])`);
    if (pattern.test(remaining)) {
      picked.push(workspace);
      remaining = remaining.replace(pattern, '$1$2');
    }
  }
  return picked.slice(0, MAX_CONTEXT_WORKSPACES);
}

/**
 * Resolve the Fabric workspaces a prompt refers to and describe them, using
 * the caller's own Fabric access. The hosted agents run with their own agent
 * identities, which often cannot see the user's workspaces; this inventory
 * lets them answer and compose Project Osmos handoffs anyway.
 */
export async function promptWorkspaceContext(token: string, prompt: string): Promise<PromptWorkspaceContext | undefined> {
  let all: Record<string, unknown>[];
  try {
    all = await listAll(token, '/v1/workspaces', 1000);
  } catch {
    return undefined;
  }
  const matched = matchWorkspaces(prompt, all);
  if (!matched.length) return undefined;
  const lakehouseIds = new Set(
    [...prompt.toLowerCase().matchAll(new RegExp(`lakehouses/(${GUID})`, 'g'))].map((match) => match[1]),
  );
  const blocks: string[] = [];
  for (const workspace of matched) {
    const workspaceId = str(workspace.id, 64);
    const lines = [`Workspace "${str(workspace.displayName, 200)}" (id ${workspaceId})`];
    let items: Record<string, unknown>[] = [];
    try {
      items = await listAll(token, `/v1/workspaces/${workspaceId}/items`, MAX_CONTEXT_ITEMS);
    } catch (error) {
      lines.push(`- Item listing failed: ${str((error as Error).message, 300)}`);
    }
    const counts = new Map<string, number>();
    for (const item of items) counts.set(str(item.type, 64), (counts.get(str(item.type, 64)) ?? 0) + 1);
    if (items.length) {
      lines.push(`- ${items.length} item(s): ${[...counts.entries()].map(([type, count]) => `${count} ${type}`).join(', ')}`);
      for (const item of items.slice(0, MAX_CONTEXT_ITEMS)) {
        lines.push(`  - ${str(item.type, 64)} "${str(item.displayName, 200)}" id ${str(item.id, 64)}`);
      }
    } else if (!lines.some((line) => line.includes('failed'))) {
      lines.push('- The workspace is empty.');
    }
    for (const item of items) {
      const itemId = str(item.id, 64).toLowerCase();
      if (str(item.type, 64) !== 'Lakehouse' || !lakehouseIds.has(itemId)) continue;
      const tables = await fabricGet(token, `/v1/workspaces/${workspaceId}/lakehouses/${itemId}/tables?maxResults=100`);
      if (tables.ok) {
        const names = asArray(asRecord(tables.body).data)
          .map(asRecord)
          .map((table) => `${str(table.name, 200)} (${str(table.format, 20) || str(table.type, 20)})`);
        lines.push(`- Tables in lakehouse "${str(item.displayName, 200)}": ${names.join(', ') || 'none listed'}`);
      } else {
        lines.push(`- Tables in lakehouse "${str(item.displayName, 200)}" could not be listed (schema-enabled lakehouses need the SQL endpoint).`);
      }
    }
    blocks.push(lines.join('\n'));
  }
  let text = blocks.join('\n\n');
  if (text.length > MAX_CONTEXT_CHARS) text = `${text.slice(0, MAX_CONTEXT_CHARS)}\n- (inventory truncated)`;
  return { text, workspaces: matched.map((workspace) => str(workspace.displayName, 200)) };
}

// --- Project Osmos ---------------------------------------------------------

export const MAX_INSTRUCTION = 9500;

export interface OsmosRequest {
  workspaceId: string;
  lakehouseId: string;
  displayName: string;
  instruction: string;
}

/** Project Osmos tasks always run against this lakehouse in the target workspace. */
export const OSMOS_LAKEHOUSE = 'LH_Osmos';

/**
 * Agent-composed handoffs sometimes label another lakehouse (e.g. bronze_layer_lh) as
 * LH_Osmos. Resolve the real LH_Osmos by name in the handoff workspace, and rewrite the
 * wrong id where the instruction names it as LH_Osmos or the default lakehouse.
 * Throws when the workspace has no LH_Osmos; never falls back to another lakehouse.
 */
export async function resolveOsmosLakehouse(token: string, req: OsmosRequest): Promise<OsmosRequest> {
  const result = await request('GET', `${FABRIC_API}/v1/workspaces/${req.workspaceId}/lakehouses`, bearer(token));
  if (!result.ok) throw new Error(describeFailure('Listing the target workspace lakehouses', result));
  const lakehouses = asArray(asRecord(result.body).value).map(asRecord);
  const target = lakehouses.find((item) => str(item.displayName, 256).toLowerCase() === OSMOS_LAKEHOUSE.toLowerCase());
  const lakehouseId = str(target?.id, 64).toLowerCase();
  if (!lakehouseId) {
    throw new Error(`Workspace ${req.workspaceId} has no ${OSMOS_LAKEHOUSE} lakehouse; create it before running Project Osmos.`);
  }
  return { ...req, lakehouseId, instruction: fixOsmosLakehouseIds(req.instruction, req.lakehouseId, lakehouseId) };
}

/** Replace wrongId where the text labels it as LH_Osmos or the default lakehouse. */
export function fixOsmosLakehouseIds(text: string, wrongId: string, rightId: string): string {
  const wrong = wrongId.toLowerCase();
  if (!wrong || wrong === rightId.toLowerCase()) return text;
  const label = new RegExp(
    `(LH_Osmos|default (?:spark[- ]session )?lakehouse)([^\\n]{0,80}?)(${GUID})`,
    'gi',
  );
  return text.replace(label, (match: string, name: string, between: string, id: string) =>
    id.toLowerCase() === wrong ? `${name}${between}${rightId}` : match,
  );
}

export function osmosTaskPage(workspaceId: string, lakehouseId: string, taskId: string): string {
  return (
    `https://app.fabric.microsoft.com/groups/${workspaceId}/lakehouses/${lakehouseId}` +
    `?experience=fabric-developer&selectedPath=ProjectOsmos%2F${taskId}&projectOsmosUX=1`
  );
}

// --- Project Osmos notebook bridge -------------------------------------------
//
// Project Osmos rejects the Rayfin function token (generatemwctoken returns 401
// for the Rayfin client app). So the app runs a Fabric notebook as the signed-in
// owner through the Jobs API. The notebook uses the Fabric-issued token, creates
// and monitors the task, and writes status JSON to the app lakehouse.

export const OSMOS_BRIDGE_NOTEBOOK = 'nb_osmos_task_bridge';
export const APP_LAKEHOUSE = 'lh_command_center';
const ONELAKE_DFS = 'https://onelake.dfs.fabric.microsoft.com';

interface BridgeItems {
  notebookId: string;
  lakehouseId: string;
}

async function bridgeItems(token: string, appWorkspaceId: string): Promise<BridgeItems> {
  const result = await request('GET', `${FABRIC_API}/v1/workspaces/${appWorkspaceId}/items`, bearer(token));
  if (!result.ok) throw new Error(describeFailure('Listing the app workspace items', result));
  const items = asArray(asRecord(result.body).value).map(asRecord);
  const find = (type: string, name: string) =>
    str(items.find((item) => item.type === type && item.displayName === name)?.id, 64);
  const notebookId = find('Notebook', OSMOS_BRIDGE_NOTEBOOK);
  const lakehouseId = find('Lakehouse', APP_LAKEHOUSE);
  if (!notebookId || !lakehouseId) {
    throw new Error(
      `The Osmos bridge is not deployed: run scripts/deploy-fabric-items.py to create ${OSMOS_BRIDGE_NOTEBOOK} and ${APP_LAKEHOUSE}.`,
    );
  }
  return { notebookId, lakehouseId };
}

function bridgeFile(lakehouseId: string, taskId: string): string {
  return `${lakehouseId}/Files/osmos/${taskId}.json`;
}

/** Submit the bridge notebook (as the caller) to create the task. Returns the pre-assigned task ID. */
export async function submitOsmosBridge(
  token: string,
  appWorkspaceId: string,
  req: OsmosRequest,
): Promise<OsmosTaskView> {
  if (!req.instruction.trim()) return { ok: false, message: 'The Osmos handoff has no instruction.' };
  if (req.instruction.length > MAX_INSTRUCTION) {
    return { ok: false, message: 'The composed instruction is too long for Project Osmos.' };
  }
  const { notebookId, lakehouseId } = await bridgeItems(token, appWorkspaceId);
  const taskId = randomUUID();
  const parameters: Record<string, string> = {
    mode: 'create',
    task_id: taskId,
    workspace_id: req.workspaceId,
    lakehouse_id: req.lakehouseId,
    display_name: req.displayName,
    instruction_b64: Buffer.from(req.instruction, 'utf8').toString('base64'),
    result_path: `abfss://${appWorkspaceId}@onelake.dfs.fabric.microsoft.com/${bridgeFile(lakehouseId, taskId)}`,
    monitor_minutes: '20',
  };
  const result = await request(
    'POST',
    `${FABRIC_API}/v1/workspaces/${appWorkspaceId}/items/${notebookId}/jobs/instances?jobType=RunNotebook`,
    bearer(token),
    {
      executionData: {
        parameters: Object.fromEntries(Object.entries(parameters).map(([key, value]) => [key, { value, type: 'string' }])),
      },
    },
  );
  if (result.status !== 202 && !result.ok) {
    return { ok: false, message: describeFailure('Starting the Osmos bridge notebook', result) };
  }
  return {
    ok: true,
    taskId,
    status: 'Submitting',
    running: true,
    taskPage: osmosTaskPage(req.workspaceId, req.lakehouseId, taskId),
    message: `Creating the task as you through the Fabric notebook ${OSMOS_BRIDGE_NOTEBOOK}.`,
  };
}

/** Read the status the bridge notebook last wrote. Undefined until the notebook has started. */
export async function readOsmosBridge(
  fabricToken: string,
  storageToken: string,
  appWorkspaceId: string,
  req: OsmosRequest,
  taskId: string,
): Promise<OsmosTaskView | undefined> {
  const { lakehouseId } = await bridgeItems(fabricToken, appWorkspaceId);
  const result = await request(
    'GET',
    `${ONELAKE_DFS}/${appWorkspaceId}/${bridgeFile(lakehouseId, taskId)}`,
    bearer(storageToken),
    undefined,
    { 'x-ms-version': '2023-11-03' },
  );
  if (result.status === 404) return undefined;
  if (!result.ok) throw new Error(describeFailure('Reading the Osmos bridge status', result));
  const state = asRecord(typeof result.body === 'string' ? safeJson(result.body) : result.body);
  if (str(state.taskId, 64) !== taskId) throw new Error('The Osmos bridge status does not match this task.');
  const status = str(state.status, 32) || 'Submitting';
  return {
    ok: true,
    taskId,
    status,
    running: state.running === true,
    taskPage: osmosTaskPage(req.workspaceId, req.lakehouseId, taskId),
    message: str(state.message, 1000) || undefined,
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}
