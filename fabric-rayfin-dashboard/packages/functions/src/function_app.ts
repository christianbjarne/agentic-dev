import {
  AudienceType,
  UserDataFunctions,
  type RayfinContext,
} from '@microsoft/fabric-user-data-functions';
import type {
  AgentRunRecord,
  AgentStatus,
  ConversationRecord,
  IdentityView,
  OsmosHandoff,
  OsmosTaskView,
  RunEventRecord,
  RunEventView,
  RunStatus,
  RunView,
  UniversalAppSchema,
  WorkspaceStatusView,
} from '@rayfin-app/shared';
import { randomUUID } from 'node:crypto';
import {
  promptWorkspaceContext,
  readOsmosBridge,
  submitOsmosBridge,
  workspaceStatus,
  type OsmosRequest,
  type PromptWorkspaceContext,
} from './fabric.js';
import { envelope, getResponse, startResponse, type ParsedResponse } from './foundry.js';
import { claimString, HEX_KEY_PATTERN, jwtClaims, str, toIso, UUID_PATTERN } from './http.js';

const udf = new UserDataFunctions();

/**
 * Workspaces whose job and Git status this app may read with the app
 * identity. Limited to the app's own workspace so the dashboard cannot be used
 * to browse other workspaces the app owner can reach.
 */
const ALLOWED_WORKSPACES = ['8b835744-f17d-44ef-b43a-3fe3d51c8e35'];
/** The workspace hosting this app, its lakehouse and the Osmos bridge notebook. */
const APP_WORKSPACE_ID = ALLOWED_WORKSPACES[0];
const MAX_PROMPT = 4000;
const OUTPUT_CHUNK = 3900;
const STALE_RUN_MS = 20 * 60 * 1000;
const ORCHESTRATOR = 'fabric_orchestrator';

/**
 * Helper-only alias. Handler signatures passed to udf.func() must spell out
 * `RayfinContext<...>`: the deployed worker recognizes the injected context
 * parameter by that literal annotation, and an alias would be treated as a
 * caller parameter ("MissingInput").
 */
type Ctx<T extends AudienceType = never> = RayfinContext<UniversalAppSchema, T>;
type Data = ReturnType<Ctx['getDataClient']>;

/**
 * The owner_id that Rayfin row-level security compares against: the caller's
 * Entra object id (the SDK's session.user.id). Rayfin session tokens carry it
 * as the trailing ".../users/<oid>" segment of `sub`.
 */
function callerSubject<T extends AudienceType>(ctx: Ctx<T>): string {
  const claims = jwtClaims(ctx.accessToken);
  const sub = claimString(claims, 'sub');
  const oid = claimString(claims, 'oid') || /\/users\/([0-9a-f-]{36})$/i.exec(sub)?.[1] || sub;
  if (!oid) throw new Error('Sign in to use the command center.');
  return oid;
}

function newKey(): string {
  return randomUUID().replace(/-/g, '');
}

function asStatus(value: string): RunStatus {
  return value === 'completed' || value === 'failed' || value === 'queued' ? value : 'working';
}

function asAgentStatus(value: string): AgentStatus {
  return value === 'completed' || value === 'failed' || value === 'working' ? value : 'idle';
}

function parseHandoff(raw?: string | null): OsmosHandoff | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as OsmosHandoff;
    return UUID_PATTERN.test(value.workspaceId) && UUID_PATTERN.test(value.lakehouseId) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Rayfin data reads return only `id` unless fields are selected, and mutation
 * results are not guaranteed to echo every column, so every read below selects
 * explicitly and writes are followed by a fresh read when the record is reused.
 */
const RUN_FIELDS: (keyof AgentRunRecord)[] = [
  'id', 'runKey', 'conversationKey', 'prompt', 'status', 'responseId', 'error', 'handoff',
  'osmosTaskId', 'osmosStatus', 'createdAt', 'updatedAt', 'owner_id',
];
const EVENT_FIELDS: (keyof RunEventRecord)[] = [
  'id', 'runKey', 'eventKey', 'agent', 'status', 'task', 'summary', 'createdAt', 'updatedAt', 'owner_id',
];
const CONVERSATION_FIELDS: (keyof ConversationRecord)[] = [
  'id', 'title', 'lastPrompt', 'previousResponseId', 'agentSessionId', 'activeRunKey', 'createdAt', 'updatedAt', 'owner_id',
];

async function readRun(data: Data, runKey: string): Promise<AgentRunRecord | undefined> {
  const rows = await data.AgentRun.select(RUN_FIELDS).where({ runKey: { eq: runKey } }).first(1).execute();
  return rows[0] as AgentRunRecord | undefined;
}

async function readConversation(data: Data, id: string): Promise<ConversationRecord | undefined> {
  const rows = await data.Conversation.select(CONVERSATION_FIELDS).where({ id: { eq: id } }).first(1).execute();
  return rows[0] as ConversationRecord | undefined;
}

async function readEvents(data: Data, runKey: string): Promise<RunEventRecord[]> {
  const rows = await data.RunEvent.select(EVENT_FIELDS)
    .where({ runKey: { eq: runKey } })
    .orderBy({ createdAt: 'asc' })
    .first(100)
    .execute();
  return rows as RunEventRecord[];
}

async function findRun(data: Data, runKey: string): Promise<AgentRunRecord> {
  if (!HEX_KEY_PATTERN.test(runKey)) throw new Error('Invalid run id.');
  const run = await readRun(data, runKey);
  if (!run) throw new Error('Run not found.');
  return run;
}

function toEventView(event: RunEventRecord): RunEventView {
  return {
    agent: event.agent,
    status: asAgentStatus(event.status),
    task: event.task,
    summary: event.summary ?? undefined,
    createdAt: toIso(event.createdAt),
    runKey: event.runKey,
  };
}

/**
 * Shared view types resolve to declaration files, which Rayfin typegen emits by
 * name. Wrapping handler outputs in a local mapped type makes typegen expand
 * them structurally, so the generated types.ts stays self-contained.
 */
type Wire<T> = T extends readonly (infer U)[] ? Wire<U>[] : T extends object ? { [K in keyof T]: Wire<T[K]> } : T;

async function buildView(data: Data, run: AgentRunRecord): Promise<RunView> {
  const [events, outputs] = await Promise.all([
    readEvents(data, run.runKey),
    data.RunOutput.select(['seq', 'content']).where({ runKey: { eq: run.runKey } }).orderBy({ seq: 'asc' }).first(100).execute(),
  ]);
  const response = outputs.map((chunk) => chunk.content).join('');
  return {
    runKey: run.runKey,
    conversationId: run.conversationKey,
    status: asStatus(run.status),
    prompt: run.prompt,
    response: response || undefined,
    error: run.error || undefined,
    events: events.map(toEventView),
    osmos: parseHandoff(run.handoff),
    osmosTask: run.osmosTaskId
      ? { ok: true, taskId: run.osmosTaskId, status: run.osmosStatus ?? 'Running' }
      : undefined,
    createdAt: toIso(run.createdAt),
    updatedAt: toIso(run.updatedAt),
  };
}

async function upsertEvent(
  data: Data,
  existing: Map<string, RunEventRecord>,
  owner: string,
  runKey: string,
  eventKey: string,
  values: { agent: string; status: string; task: string; summary?: string },
): Promise<void> {
  const now = new Date();
  const summary = values.summary ? str(values.summary, 2000) : undefined;
  const found = existing.get(eventKey);
  if (!found) {
    const record = {
      runKey,
      eventKey,
      agent: values.agent,
      status: values.status,
      task: str(values.task, 1000),
      summary,
      createdAt: now,
      updatedAt: now,
      owner_id: owner,
    };
    const created = await data.RunEvent.create(record);
    existing.set(eventKey, { ...record, id: created.id });
    return;
  }
  if (found.status !== values.status || (summary && found.summary !== summary)) {
    const patch = { status: values.status, summary: summary ?? found.summary ?? undefined, updatedAt: now };
    await data.RunEvent.update({ id: found.id }, patch);
    existing.set(eventKey, { ...found, ...patch });
  }
}

const TERMINAL = ['completed', 'failed', 'cancelled', 'incomplete'];

async function recordProgress(data: Data, owner: string, run: AgentRunRecord, parsed: ParsedResponse): Promise<void> {
  const rows = await readEvents(data, run.runKey);
  const existing = new Map(rows.map((row) => [row.eventKey, row]));
  for (const delegation of parsed.delegations) {
    await upsertEvent(data, existing, owner, run.runKey, `${run.runKey}:${delegation.callId}`, {
      agent: delegation.agent,
      status: delegation.status,
      task: delegation.task,
      summary: delegation.summary,
    });
  }
  const terminal = TERMINAL.includes(parsed.status);
  const count = parsed.delegations.length;
  let summary: string;
  if (!terminal) summary = count ? `Coordinating ${count} specialist delegation(s).` : 'Planning the request.';
  else if (parsed.status === 'completed') summary = `Answered after ${count} specialist delegation(s).`;
  else summary = parsed.error ?? `Run ${parsed.status}.`;
  await upsertEvent(data, existing, owner, run.runKey, `${run.runKey}:orchestrator`, {
    agent: ORCHESTRATOR,
    status: !terminal ? 'working' : parsed.status === 'completed' ? 'completed' : 'failed',
    task: str(run.prompt, 1000),
    summary,
  });
}

async function finishRun(data: Data, owner: string, run: AgentRunRecord, parsed: ParsedResponse): Promise<AgentRunRecord> {
  const now = new Date();
  const completed = parsed.status === 'completed';
  if (completed) {
    const text = parsed.text || '(The orchestrator returned no text.)';
    for (let seq = 0, offset = 0; offset < text.length && seq < 100; seq += 1, offset += OUTPUT_CHUNK) {
      await data.RunOutput.create({
        runKey: run.runKey,
        seq,
        content: text.slice(offset, offset + OUTPUT_CHUNK),
        owner_id: owner,
      });
    }
  }
  const handoff = parsed.handoff ? JSON.stringify(parsed.handoff) : undefined;
  await data.AgentRun.update(
    { id: run.id },
    {
      status: completed ? 'completed' : 'failed',
      error: completed ? undefined : str(parsed.error ?? `Run ${parsed.status}.`, 2000),
      handoff: handoff && handoff.length <= 4000 ? handoff : undefined,
      updatedAt: now,
    },
  );
  const conversation = await readConversation(data, run.conversationKey);
  if (conversation) {
    await data.Conversation.update(
      { id: conversation.id },
      {
        previousResponseId: completed ? parsed.id : conversation.previousResponseId ?? undefined,
        agentSessionId: parsed.agentSessionId ?? conversation.agentSessionId ?? undefined,
        activeRunKey: conversation.activeRunKey === run.runKey ? '' : conversation.activeRunKey ?? undefined,
        updatedAt: now,
      },
    );
  }
  return findRun(data, run.runKey);
}

/** Send a prompt to the Foundry fabric-orchestrator as a background response. */
udf.func(
  'startRun',
  async (
    prompt: string,
    conversationId: string,
    ctx: RayfinContext<UniversalAppSchema, AudienceType.AzureAI | AudienceType.Fabric>,
  ): Promise<Wire<RunView>> => {
    const owner = callerSubject(ctx);
    const text = (prompt ?? '').trim();
    if (!text) throw new Error('Enter a prompt.');
    if (text.length > MAX_PROMPT) throw new Error(`Prompts are limited to ${MAX_PROMPT} characters.`);
    if (conversationId && !UUID_PATTERN.test(conversationId)) throw new Error('Invalid conversation id.');
    const data = ctx.getDataClient();
    const now = new Date();

    let conversation = conversationId ? await readConversation(data, conversationId) : undefined;
    if (conversationId && !conversation) throw new Error('Conversation not found.');
    if (conversation?.activeRunKey) {
      const active = await readRun(data, conversation.activeRunKey);
      if (
        active &&
        !['completed', 'failed'].includes(active.status) &&
        now.getTime() - new Date(active.updatedAt).getTime() < STALE_RUN_MS
      ) {
        throw new Error('The orchestrator is still working on the previous prompt in this conversation.');
      }
    }
    if (!conversation) {
      const record = {
        title: str(text.replace(/\s+/g, ' '), 80),
        lastPrompt: str(text, 500),
        createdAt: now,
        updatedAt: now,
        owner_id: owner,
      };
      const created = await data.Conversation.create(record);
      conversation = { ...record, id: created.id };
    }

    const runKey = newKey();
    const createdRun = await data.AgentRun.create({
      runKey,
      conversationKey: conversation.id,
      prompt: text,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      owner_id: owner,
    });

    // Only the app owner gets workspace context: the Fabric token is the app
    // identity, so other callers must not be able to read the owner's workspaces.
    let workspaceContext: PromptWorkspaceContext | undefined;
    try {
      if (callerIsAppIdentity(ctx)) workspaceContext = await promptWorkspaceContext(ctx.Tokens.Fabric, text);
    } catch {
      workspaceContext = undefined;
    }

    const started = await startResponse(
      ctx.Tokens.AzureAI,
      envelope(runKey, text, workspaceContext?.text),
      conversation.previousResponseId,
      conversation.agentSessionId,
    );
    if (!started.started) {
      await data.AgentRun.update({ id: createdRun.id }, { status: 'failed', error: started.error, updatedAt: new Date() });
    } else {
      await data.AgentRun.update(
        { id: createdRun.id },
        { status: 'working', responseId: started.started.id, updatedAt: new Date() },
      );
      await data.RunEvent.create({
        runKey,
        eventKey: `${runKey}:orchestrator`,
        agent: ORCHESTRATOR,
        status: 'working',
        task: str(text, 1000),
        summary: started.reset
          ? 'Started a new orchestrator session (the previous one expired).'
          : workspaceContext
            ? `Planning the request with Fabric context for: ${workspaceContext.workspaces.join(', ')}.`
            : 'Planning the request.',
        createdAt: now,
        updatedAt: now,
        owner_id: owner,
      });
    }
    await data.Conversation.update(
      { id: conversation.id },
      {
        lastPrompt: str(text, 500),
        activeRunKey: started.started ? runKey : conversation.activeRunKey ?? undefined,
        previousResponseId: started.reset ? '' : conversation.previousResponseId ?? undefined,
        agentSessionId: started.started?.agentSessionId ?? (started.reset ? '' : conversation.agentSessionId ?? undefined),
        updatedAt: new Date(),
      },
    );
    return buildView(data, await findRun(data, runKey));
  },
  [],
);

/** Poll one run: record specialist delegations and, when done, the answer. */
udf.func(
  'pollRun',
  async (runKey: string, ctx: RayfinContext<UniversalAppSchema, AudienceType.AzureAI>): Promise<Wire<RunView>> => {
    const owner = callerSubject(ctx);
    const data = ctx.getDataClient();
    const run = await findRun(data, runKey);
    if (run.status === 'completed' || run.status === 'failed' || !run.responseId) {
      return buildView(data, run);
    }
    const { parsed, error } = await getResponse(ctx.Tokens.AzureAI, run.responseId);
    if (!parsed) {
      if (Date.now() - new Date(run.updatedAt).getTime() > STALE_RUN_MS) {
        await data.AgentRun.update(
          { id: run.id },
          { status: 'failed', error: str(error ?? 'The run could not be read.', 2000), updatedAt: new Date() },
        );
        return buildView(data, await findRun(data, runKey));
      }
      const view = await buildView(data, run);
      return { ...view, error };
    }
    await recordProgress(data, owner, run, parsed);
    const latest = TERMINAL.includes(parsed.status) ? await finishRun(data, owner, run, parsed) : run;
    return buildView(data, latest);
  },
  [],
);

/** All runs of one conversation, oldest first, for restoring chat history. */
udf.func(
  'getConversation',
  async (conversationId: string, ctx: RayfinContext<UniversalAppSchema>): Promise<Wire<RunView[]>> => {
    callerSubject(ctx);
    if (!UUID_PATTERN.test(conversationId)) throw new Error('Invalid conversation id.');
    const data = ctx.getDataClient();
    const runs = await data.AgentRun.select(RUN_FIELDS)
      .where({ conversationKey: { eq: conversationId } })
      .orderBy({ createdAt: 'asc' })
      .first(50)
      .execute();
    return Promise.all(runs.map((run) => buildView(data, run as AgentRunRecord)));
  },
  [],
);

/** Native Fabric status for the app workspace: items, job instances, Git. */
udf.func(
  'getWorkspaceStatus',
  async (workspaceId: string, ctx: RayfinContext<UniversalAppSchema, AudienceType.Fabric>): Promise<Wire<WorkspaceStatusView>> => {
    callerSubject(ctx);
    const id = (workspaceId || ALLOWED_WORKSPACES[0]).toLowerCase();
    if (!ALLOWED_WORKSPACES.includes(id)) {
      return {
        ok: false,
        message: 'This dashboard only reads its own workspace.',
        workspaceId: id,
        itemCounts: [],
        jobs: [],
        checkedAt: new Date().toISOString(),
      };
    }
    return workspaceStatus(ctx.Tokens.Fabric, id);
  },
  [],
);

function appIdentity(ctx: Ctx<AudienceType.Fabric>): { upn?: string; oid?: string; type?: string } {
  const claims = jwtClaims(ctx.Tokens.Fabric);
  return {
    upn: claimString(claims, 'upn', 'unique_name', 'preferred_username') || undefined,
    oid: claimString(claims, 'oid') || undefined,
    type: claimString(claims, 'idtyp') || (claimString(claims, 'scp') ? 'user' : 'app'),
  };
}

function callerIsAppIdentity(ctx: Ctx<AudienceType.Fabric>): boolean {
  const caller = jwtClaims(ctx.accessToken);
  const app = appIdentity(ctx);
  const email = claimString(caller, 'email', 'upn', 'preferred_username').toLowerCase();
  const oid = (claimString(caller, 'oid') || callerSubject(ctx)).toLowerCase();
  return Boolean((app.upn && email === app.upn.toLowerCase()) || (app.oid && oid === app.oid.toLowerCase()));
}

/** Who is signed in, and which identity the app uses for Fabric and Foundry. */
udf.func(
  'whoAmI',
  async (ctx: RayfinContext<UniversalAppSchema, AudienceType.Fabric>): Promise<Wire<IdentityView>> => {
    const claims = jwtClaims(ctx.accessToken);
    const subject = callerSubject(ctx);
    let app: IdentityView['appIdentity'];
    let same = false;
    try {
      const identity = appIdentity(ctx);
      const tokenClaims = jwtClaims(ctx.Tokens.Fabric);
      app = {
        upn: identity.upn,
        type: identity.type,
        audience: claimString(tokenClaims, 'aud') || undefined,
        appId: claimString(tokenClaims, 'appid', 'azp') || undefined,
        scopes: claimString(tokenClaims, 'scp').slice(0, 1000) || undefined,
      };
      same = callerIsAppIdentity(ctx);
    } catch {
      app = undefined;
    }
    return {
      caller: {
        subject,
        name: claimString(claims, 'name') || undefined,
        email: claimString(claims, 'email', 'upn', 'preferred_username') || undefined,
      },
      appIdentity: app,
      callerIsAppIdentity: same,
      allowedWorkspaces: ALLOWED_WORKSPACES,
    };
  },
  [],
);

async function osmosContext(
  ctx: Ctx<AudienceType.Fabric>,
  runKey: string,
): Promise<{ data: Data; run: AgentRunRecord; request: OsmosRequest }> {
  callerSubject(ctx);
  if (!callerIsAppIdentity(ctx)) {
    throw new Error('Project Osmos tasks run with the app identity, so only the app owner can create them here.');
  }
  const data = ctx.getDataClient();
  const run = await findRun(data, runKey);
  const handoff = parseHandoff(run.handoff);
  if (!handoff) throw new Error('This run has no Project Osmos task waiting.');
  return { data, run, request: handoff };
}

/** Create the Project Osmos task the agents composed for this run. */
udf.func(
  'createOsmosTask',
  async (runKey: string, ctx: RayfinContext<UniversalAppSchema, AudienceType.Fabric>): Promise<Wire<OsmosTaskView>> => {
    const owner = callerSubject(ctx);
    const { data, run, request } = await osmosContext(ctx, runKey);
    if (run.osmosTaskId) return { ok: true, taskId: run.osmosTaskId, status: run.osmosStatus ?? 'Running' };
    let result: OsmosTaskView;
    try {
      result = await submitOsmosBridge(ctx.Tokens.Fabric, APP_WORKSPACE_ID, request);
    } catch (error) {
      return { ok: false, message: str((error as Error).message, 1000) || 'Project Osmos did not accept the request.' };
    }
    if (result.ok && result.taskId) {
      const now = new Date();
      await data.AgentRun.update({ id: run.id }, { osmosTaskId: result.taskId, osmosStatus: result.status ?? 'Submitting', updatedAt: now });
      await data.RunEvent.create({
        runKey: run.runKey,
        eventKey: `${run.runKey}:osmos:${result.taskId}`,
        agent: 'osmos_data_engineer',
        status: 'working',
        task: str(`Project Osmos task: ${request.displayName}`, 1000),
        summary: `Task ${result.taskId} submitted as you via the Fabric notebook bridge. ${result.taskPage ?? ''}`,
        createdAt: now,
        updatedAt: now,
        owner_id: owner,
      });
    }
    return result;
  },
  [],
);

/** Refresh the status of this run's Project Osmos task. */
udf.func(
  'getOsmosTask',
  async (
    runKey: string,
    ctx: RayfinContext<UniversalAppSchema, AudienceType.Fabric | AudienceType.Storage>,
  ): Promise<Wire<OsmosTaskView>> => {
    const { data, run, request } = await osmosContext(ctx, runKey);
    if (!run.osmosTaskId) return { ok: false, message: 'No Project Osmos task has been created for this run.' };
    let result: OsmosTaskView;
    try {
      result = (await readOsmosBridge(ctx.Tokens.Fabric, ctx.Tokens.Storage, APP_WORKSPACE_ID, request, run.osmosTaskId)) ?? {
        ok: true,
        taskId: run.osmosTaskId,
        status: run.osmosStatus ?? 'Submitting',
        running: true,
        message: 'Waiting for the Fabric notebook bridge to start (usually under a minute).',
      };
    } catch (error) {
      return { ok: false, taskId: run.osmosTaskId, message: str((error as Error).message, 1000) };
    }
    if (result.ok && result.status && result.status !== run.osmosStatus) {
      await data.AgentRun.update({ id: run.id }, { osmosStatus: result.status, updatedAt: new Date() });
      const event = await data.RunEvent.findFirst({ eventKey: { eq: `${run.runKey}:osmos:${run.osmosTaskId}` } });
      if (event) {
        let status = 'failed';
        if (result.running) status = 'working';
        else if (result.status === 'Completed') status = 'completed';
        await data.RunEvent.update({ id: event.id }, { status, updatedAt: new Date() });
      }
    }
    return result;
  },
  [],
);
