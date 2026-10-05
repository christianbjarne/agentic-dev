import type { FabricJobView, OsmosTaskView, WorkspaceStatusView, WorkspaceChoice, WorkspaceBranchChoice, WorkspaceBranchPage } from '@rayfin-app/shared';
import { isTaskTerminal } from '@rayfin-app/shared';
import { createHash, randomUUID } from 'node:crypto';
import {
  asArray,
  asRecord,
  describeFailure,
  nowIso,
  request,
  str,
  HttpResult,
  jwtClaims,
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
const gitConnectionCache = new Map<string, { expires: number; result: HttpResult }>();

function gitCacheKey(token: string, workspaceId: string): string {
  const claims = jwtClaims(token);
  const identity = claims.oid && claims.tid
    ? `${claims.tid}:${claims.oid}:${claims.appid ?? claims.azp ?? ''}` : token;
  return `${createHash('sha256').update(identity).digest('hex')}:${workspaceId}`;
}

function bearer(token: string): string {
  return `Bearer ${token}`;
}

async function fabricGet(token: string, path: string): Promise<HttpResult> {
  return request('GET', `${FABRIC_API}${path}`, bearer(token), undefined, { 'x-ms-fabric-skill': 'git-integration-operations-cli' }, 15000);
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
  if (url || items.length > limit) throw new Error(`The Fabric inventory exceeds ${limit} items. Refine the workspace scope.`);
  return items;
}

export async function listWorkspaces(token: string): Promise<WorkspaceChoice[]> {
  return (await listAll(token, '/v1/workspaces', 5000)).map((row) => ({ id: str(row.id, 64), name: str(row.displayName, 200) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
/** Workspace summary, latest job instances and Fabric Git connection. */
export async function workspaceStatus(token: string, workspaceId: string, gitOperationId = ''): Promise<WorkspaceStatusView> {
  const checkedAt = nowIso();
  const workspace = await fabricGet(token, `/v1/workspaces/${workspaceId}`);
  if (!workspace.ok) {
    return {
      ok: false,
      message: describeFailure('Workspace lookup', workspace),
      workspaceId,
      itemCounts: [],
      items: [],
      jobs: [],
      checkedAt,
    };
  }
  const info = asRecord(workspace.body);
  const warnings: string[] = [];
  const items = await listAll(token, `/v1/workspaces/${workspaceId}/items`);
  const counts = new Map<string, number>();
  for (const item of items) {
    const type = str(item.type, 64);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  const eligible = items.filter((item) => JOB_ITEM_TYPES.has(str(item.type, 64)));
  const jobItems = eligible.slice(0, MAX_JOB_ITEMS);
  if (eligible.length > jobItems.length) warnings.push(`Jobs cover the first ${MAX_JOB_ITEMS} runnable items. Inventory includes all items.`);
  const jobLists = await Promise.all(
    jobItems.map(async (item): Promise<FabricJobView[]> => {
      const itemId = str(item.id, 64);
      const result = await fabricGet(token, `/v1/workspaces/${workspaceId}/items/${itemId}/jobs/instances`);
      if (!result.ok) {
        warnings.push(`${str(item.displayName, 200)}: job history unavailable (HTTP ${result.status}).`);
        return [];
      }
      const listed = asArray(asRecord(result.body).value)
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
        .sort((a, b) => Number(!isTaskTerminal(b.status)) - Number(!isTaskTerminal(a.status)) || (b.startTimeUtc ?? '').localeCompare(a.startTimeUtc ?? ''))
        .slice(0, JOBS_PER_ITEM);
      return Promise.all(listed.map(async (job) => {
        if (isTaskTerminal(job.status)) return job;
        const snapshot = await fabricGet(token, `/v1/workspaces/${workspaceId}/items/${itemId}/jobs/instances/${job.jobId}`);
        if (!snapshot.ok) {
          warnings.push(`${job.itemName}: live job status unavailable (HTTP ${snapshot.status}). Showing last listed state.`);
          return job;
        }
        const state = asRecord(snapshot.body);
        return {
          ...job, status: str(state.status, 32) || job.status,
          endTimeUtc: str(state.endTimeUtc, 40) || job.endTimeUtc,
          failureReason: str(asRecord(state.failureReason).message, 500) || job.failureReason,
        };
      }));
    }),
  );
  const jobs = jobLists
    .flat()
    .sort((a, b) => Number(!isTaskTerminal(b.status)) - Number(!isTaskTerminal(a.status)) || (b.startTimeUtc ?? '').localeCompare(a.startTimeUtc ?? ''))
    .slice(0, 40);

  const gitResult = await fabricGet(token, `/v1/workspaces/${workspaceId}/git/connection`);
  if (gitResult.ok) gitConnectionCache.set(gitCacheKey(token, workspaceId), { result: gitResult, expires: Date.now() + 5 * 60_000 });
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
    if (connected) {
      let state = await fabricGet(token, gitOperationId
        ? `/v1/operations/${gitOperationId}` : `/v1/workspaces/${workspaceId}/git/status`);
      const operationId = gitOperationId || (state.status === 202 ? state.headers.get('x-ms-operation-id') : null);
      if (operationId) {
        const operation = gitOperationId ? state : await fabricGet(token, `/v1/operations/${encodeURIComponent(operationId)}`);
        const opStatus = str(asRecord(operation.body).status, 32);
        if (operation.ok && opStatus === 'Succeeded') {
          state = await fabricGet(token, `/v1/operations/${encodeURIComponent(operationId)}/result`);
        } else if (operation.ok && ['NotStarted', 'Running'].includes(opStatus)) {
          git.operationId = operationId;
          git.message = `Git status operation ${opStatus}; monitoring will resume on refresh.`;
          state = new HttpResult(202, null, operation.headers);
        } else {
          state = new HttpResult(operation.ok ? 502 : operation.status, operation.body, operation.headers);
        }
      } else if (state.status === 202) {
        git.message = 'Git status is being computed; refresh to retry.';
      }
      if (state.ok && state.status !== 202) {
        const snapshot = asRecord(state.body);
        if (Array.isArray(snapshot.changes)) {
          git.workspaceHead = str(snapshot.workspaceHead, 64) || undefined;
          git.remoteCommitHash = str(snapshot.remoteCommitHash, 64) || undefined;
          git.changeDetails = snapshot.changes.map(asRecord).map((change) => ({
            name: str(asRecord(change.itemMetadata).displayName, 200) || str(asRecord(change.itemMetadata).itemIdentifier, 100),
            workspaceChange: str(change.workspaceChange, 40), remoteChange: str(change.remoteChange, 40),
          }));
          git.changes = git.changeDetails.filter((change) => change.workspaceChange && change.workspaceChange !== 'None').length;
        } else git.message = 'Git status returned no change snapshot; uncommitted item count is unavailable.';
      } else if (!state.ok) git.message = describeFailure('Git status', state);
    }
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
    items: items.map((item) => ({ id: str(item.id, 64), name: str(item.displayName, 200), type: str(item.type, 64) })),
    warnings,
    git,
    checkedAt,
  };
}

export async function workspaceBranches(token: string, workspaceId: string, cursor: number, discover = true): Promise<WorkspaceBranchPage> {
  const current = await fabricGet(token, `/v1/workspaces/${workspaceId}/git/connection`);
  if (!current.ok) throw new Error(describeFailure('Git connection', current));
  gitConnectionCache.set(gitCacheKey(token, workspaceId), { result: current, expires: Date.now() + 5 * 60_000 });
  const details = asRecord(asRecord(current.body).gitProviderDetails);
  if (!str(details.branchName, 200)) return { choices: [], warnings: [], nextCursor: null };
  const repositoryKey = (value: Record<string, unknown>) => ['gitProviderType', 'ownerName', 'organizationName', 'projectName', 'repositoryName', 'directoryName']
    .map((key) => key === 'directoryName' ? str(value[key], 300) : str(value[key], 300).toLowerCase()).join('|');
  const key = repositoryKey(details);
  const workspaces = await listWorkspaces(token);
  let page = workspaces.slice(cursor, cursor + 40);
  const result: WorkspaceBranchChoice[] = [];
  const warnings: string[] = [];
  if (!discover) {
    const relations = await fabricGet(token, `/v1/workspaces/${workspaceId}/git/workspaceRelations`);
    if (relations.ok) {
      const ids = new Set(asArray(asRecord(relations.body).value).map(asRecord).map((relation) => str(relation.relatedWorkspaceId, 64)));
      page = workspaces.filter((workspace) => ids.has(workspace.id)).slice(0, 40);
      if (ids.size > 40) warnings.push('Branch relations exceed 40 workspaces. Use full discovery to inspect additional branches.');
    } else {
      warnings.push(describeFailure('Fabric branch relations', relations));
      page = [];
    }
  }
  for (const [cacheKey, value] of gitConnectionCache) if (value.expires <= Date.now()) gitConnectionCache.delete(cacheKey);
  for (const workspace of workspaces) {
    const cached = gitConnectionCache.get(gitCacheKey(token, workspace.id));
    const candidate = asRecord(asRecord(cached?.result.body).gitProviderDetails);
    const branch = str(candidate.branchName, 250);
    if (branch && repositoryKey(candidate) === key) result.push({ ...workspace, branch });
  }
  for (let offset = 0; offset < page.length; offset += 8) {
    let fetched = false;
    let throttled = 0;
    const choices = await Promise.all(page.slice(offset, offset + 8).map(async (workspace) => {
      const cacheKey = gitCacheKey(token, workspace.id);
      let connection = workspace.id === workspaceId ? current : gitConnectionCache.get(cacheKey)?.result;
      if (!connection) {
        fetched = true;
        try {
          connection = await fabricGet(token, `/v1/workspaces/${workspace.id}/git/connection`);
        } catch (error) {
          warnings.push(`Git metadata unavailable for ${workspace.name}: ${error instanceof Error ? error.message.slice(0, 300) : 'Request failed'}`);
          return undefined;
        }
      }
      if (connection.ok || [403, 404].includes(connection.status)) {
        gitConnectionCache.set(cacheKey, { result: connection, expires: Date.now() + 5 * 60_000 });
      }
      if (!connection.ok) {
        if ([403, 404].includes(connection.status)) return undefined;
        if (connection.status === 429) {
          throttled = Math.max(throttled, Math.min(60, Math.max(1, Number(connection.headers.get('retry-after')) || 10)));
        } else warnings.push(describeFailure(`Git metadata unavailable for ${workspace.name}`, connection));
        return undefined;
      }
      const candidate = asRecord(asRecord(connection.body).gitProviderDetails);
      const branch = str(candidate.branchName, 250);
      return branch && repositoryKey(candidate) === key ? { ...workspace, branch } : undefined;
    }));
    for (const choice of choices) if (choice && !result.some((item) => item.id === choice.id)) result.push(choice);
    if (throttled) return { choices: result, warnings, nextCursor: cursor + offset, retryAfterSeconds: throttled };
    if (fetched) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return { choices: result, warnings, nextCursor: discover && cursor + 40 < workspaces.length ? cursor + 40 : null };
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
  existingTaskId?: string,
): Promise<OsmosTaskView> {
  if (!req.instruction.trim()) return { ok: false, message: 'The Osmos handoff has no instruction.' };
  if (req.instruction.length > MAX_INSTRUCTION) {
    return { ok: false, message: 'The composed instruction is too long for Project Osmos.' };
  }
  const { notebookId, lakehouseId } = await bridgeItems(token, appWorkspaceId);
  const taskId = existingTaskId ?? randomUUID();
  const parameters: Record<string, string> = {
    mode: existingTaskId ? 'status' : 'create',
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
    { 'x-ms-fabric-skill': 'git-integration-operations-cli' },
  );
  if (result.status !== 202 && !result.ok) {
    return { ok: false, message: describeFailure('Starting the Osmos bridge notebook', result) };
  }
  const location = result.headers.get('location');
  if (!location || !validJobLocation(location, appWorkspaceId)) {
    throw new Error('Fabric accepted the notebook but did not return a valid job-instance Location. Check workspace jobs before retrying.');
  }
  return {
    ok: true,
    taskId,
    status: 'Submitting',
    running: true,
    jobLocation: location,
    taskPage: osmosTaskPage(req.workspaceId, req.lakehouseId, taskId),
    message: `Creating the task as you through the Fabric notebook ${OSMOS_BRIDGE_NOTEBOOK}.`,
  };
}

function validJobLocation(location: string, workspaceId: string): boolean {
  const url = new URL(location);
  return url.origin === FABRIC_API && new RegExp(`^/v1/workspaces/${workspaceId}/items/[0-9a-f-]{36}/jobs/instances/[0-9a-f-]{36}$`, 'i').test(url.pathname);
}

/** Read the status the bridge notebook last wrote. Undefined until the notebook has started. */
export async function readOsmosBridge(
  fabricToken: string,
  storageToken: string,
  appWorkspaceId: string,
  req: OsmosRequest,
  taskId: string,
  jobLocation?: string,
): Promise<OsmosTaskView | undefined> {
  let job: Record<string, unknown> | undefined;
  if (jobLocation) {
    if (!validJobLocation(jobLocation, appWorkspaceId)) throw new Error('The persisted Fabric job Location is invalid.');
    const snapshot = await request('GET', jobLocation, bearer(fabricToken), undefined, { 'x-ms-fabric-skill': 'git-integration-operations-cli' }, 15000);
    if (!snapshot.ok) throw new Error(describeFailure('Osmos notebook job status', snapshot));
    job = asRecord(snapshot.body);
  }
  const { lakehouseId } = await bridgeItems(fabricToken, appWorkspaceId);
  const result = await request(
    'GET',
    `${ONELAKE_DFS}/${appWorkspaceId}/${bridgeFile(lakehouseId, taskId)}`,
    bearer(storageToken),
    undefined,
    { 'x-ms-version': '2023-11-03' },
  );
  if (result.status === 404) {
    if (job && isTaskTerminal(str(job.status, 32))) {
      return { ok: true, taskId, status: str(job.status, 32) === 'Completed' ? 'Incomplete' : str(job.status, 32), running: false, message: str(asRecord(job.failureReason).message, 500) || 'The notebook ended without reporting an Osmos task state.' };
    }
    return undefined;
  }
  if (!result.ok) throw new Error(describeFailure('Reading the Osmos bridge status', result));
  const state = asRecord(typeof result.body === 'string' ? safeJson(result.body) : result.body);
  if (str(state.taskId, 64) !== taskId) throw new Error('The Osmos bridge status does not match this task.');
  const status = str(state.status, 32) || 'Submitting';
  const bridgeFailed = job && ['failed', 'cancelled', 'deduped'].includes(str(job.status, 32).toLowerCase());
  const paused = !isTaskTerminal(status) && job && isTaskTerminal(str(job.status, 32));
  return {
    ok: true,
    taskId,
    status: bridgeFailed && !isTaskTerminal(status) ? str(job?.status, 32) : status,
    running: !isTaskTerminal(status) && !bridgeFailed && !paused,
    monitorPaused: Boolean(paused && !bridgeFailed),
    jobLocation,
    taskPage: osmosTaskPage(req.workspaceId, req.lakehouseId, taskId),
    message: bridgeFailed ? str(asRecord(job?.failureReason).message, 500) || 'The Fabric monitoring notebook failed.' : str(state.message, 1000) || undefined,
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}
