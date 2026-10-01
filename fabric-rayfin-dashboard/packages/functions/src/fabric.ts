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

// --- Project Osmos ---------------------------------------------------------

const SKILL_HEADER = { 'x-ms-fabric-skill': 'project-osmos' };
const TRUSTED_SUFFIXES = ['.fabric.microsoft.com', '.analysis.windows.net', '.pbidedicated.windows.net'];
const STATUS_BY_CODE: Record<number, string> = {
  0: 'Created',
  1: 'Running',
  2: 'Cancelling',
  3: 'Cancelled',
  4: 'Completed',
  5: 'Failed',
};
const RUNNING = new Set(['Created', 'Running', 'Cancelling']);
export const MAX_INSTRUCTION = 9500;

export interface OsmosRequest {
  workspaceId: string;
  lakehouseId: string;
  displayName: string;
  instruction: string;
}

function httpsBase(value: string): string {
  const url = new URL(value.includes('://') ? value : `https://${value}`);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || !TRUSTED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new Error('Fabric returned an untrusted routed host.');
  }
  return `https://${url.host}`;
}

export function osmosTaskPage(workspaceId: string, lakehouseId: string, taskId: string): string {
  return (
    `https://app.fabric.microsoft.com/groups/${workspaceId}/lakehouses/${lakehouseId}` +
    `?experience=fabric-developer&selectedPath=ProjectOsmos%2F${taskId}&projectOsmosUX=1`
  );
}

function normalizeStatus(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Created';
  if (typeof value === 'number') return STATUS_BY_CODE[value] ?? `Status ${value}`;
  if (typeof value === 'string' && /^\d+$/.test(value)) return STATUS_BY_CODE[Number(value)] ?? `Status ${value}`;
  return str(value, 32);
}

interface OsmosRoute {
  tasksBase: string;
  mwcToken: string;
}

async function osmosRoute(token: string, req: OsmosRequest): Promise<OsmosRoute> {
  const workspace = await request(
    'GET',
    `${FABRIC_API}/v1/workspaces/${req.workspaceId}`,
    bearer(token),
    undefined,
    SKILL_HEADER,
  );
  if (!workspace.ok) throw new Error(describeFailure('Osmos workspace lookup', workspace));
  const capacityId = str(asRecord(workspace.body).capacityId, 64);
  if (!capacityId) throw new Error('The Osmos workspace has no Fabric capacity.');
  const lakehouse = await request(
    'GET',
    `${FABRIC_API}/v1/workspaces/${req.workspaceId}/lakehouses/${req.lakehouseId}`,
    bearer(token),
    undefined,
    SKILL_HEADER,
  );
  if (!lakehouse.ok) throw new Error(describeFailure('Osmos lakehouse lookup', lakehouse));
  const bases = [FABRIC_API];
  const home = workspace.headers.get('home-cluster-uri');
  if (home && httpsBase(home) !== FABRIC_API) bases.push(httpsBase(home));
  const payload = {
    capacityObjectId: capacityId,
    workloadType: 'SparkCore',
    workspaceObjectId: req.workspaceId,
    artifactObjectIds: [req.lakehouseId],
  };
  let tokenData: Record<string, unknown> | undefined;
  for (const [index, base] of bases.entries()) {
    const result = await request('POST', `${base}/metadata/v201606/generatemwctoken`, bearer(token), payload, SKILL_HEADER);
    if (result.ok) {
      tokenData = asRecord(result.body);
      break;
    }
    if (!str(result.body, 2000).includes('Tenant not authorized for cluster') || index + 1 >= bases.length) {
      throw new Error(describeFailure('Project Osmos routing token', result));
    }
  }
  const mwcToken = str(tokenData?.Token ?? tokenData?.token, 20_000);
  const host = str(tokenData?.TargetUriHost ?? tokenData?.mwcTokenTargetUriHost, 400);
  if (!mwcToken || !host) throw new Error('Fabric did not return a Project Osmos routing token.');
  return {
    tasksBase:
      `${httpsBase(host)}/webapi/capacities/${capacityId}/workloads/SparkCore/SparkCoreService/direct/v1/` +
      `workspaces/${req.workspaceId}/artifacts/${req.lakehouseId}/aichat`,
    mwcToken,
  };
}

function osmosCall(route: OsmosRoute, method: string, path: string, body?: unknown): Promise<HttpResult> {
  return request(method, `${route.tasksBase}${path}`, `mwctoken ${route.mwcToken}`, body, SKILL_HEADER);
}

export async function createOsmosTask(token: string, req: OsmosRequest): Promise<OsmosTaskView> {
  if (!req.instruction.trim()) return { ok: false, message: 'The Osmos handoff has no instruction.' };
  if (req.instruction.length > MAX_INSTRUCTION) {
    return { ok: false, message: 'The composed instruction is too long for Project Osmos.' };
  }
  const route = await osmosRoute(token, req);
  const taskId = randomUUID();
  const steps: [string, string, unknown][] = [
    ['PUT', `/${taskId}`, { displayName: req.displayName, instruction: req.instruction }],
    [
      'POST',
      `/${taskId}/messages`,
      {
        messages: [
          {
            id: randomUUID(),
            role: 'User',
            content: req.instruction,
            timestamp: nowIso(),
            metadata: { author_name: 'rayfin-command-center', author_source: 'fabric-rayfin-dashboard' },
          },
        ],
      },
    ],
    ['POST', `/${taskId}/run`, undefined],
  ];
  for (const [method, path, body] of steps) {
    const result = await osmosCall(route, method, path, body);
    if (!result.ok) {
      return { ok: false, message: describeFailure(`Project Osmos ${method} ${path.split('/').pop() ?? ''}`, result) };
    }
  }
  return {
    ok: true,
    taskId,
    status: 'Running',
    running: true,
    taskPage: osmosTaskPage(req.workspaceId, req.lakehouseId, taskId),
  };
}

export async function readOsmosTask(token: string, req: OsmosRequest, taskId: string): Promise<OsmosTaskView> {
  const route = await osmosRoute(token, req);
  const result = await osmosCall(route, 'GET', `/${taskId}`);
  if (!result.ok) return { ok: false, taskId, message: describeFailure('Project Osmos task read', result) };
  const task = asRecord(result.body);
  const status = normalizeStatus(task.status);
  const error = str(asRecord(task.runDetails).errorMessage, 500);
  return {
    ok: true,
    taskId,
    status,
    running: RUNNING.has(status),
    taskPage: osmosTaskPage(req.workspaceId, req.lakehouseId, taskId),
    message: error || undefined,
  };
}
