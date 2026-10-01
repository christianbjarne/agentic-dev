import {
  asArray,
  asRecord,
  describeFailure,
  request,
  str,
  type HttpResult,
} from './http.js';

/**
 * Foundry hosted-agent endpoint for the existing fabric-orchestrator. These
 * are resource identifiers, not secrets; access is governed by Entra RBAC on
 * the Foundry project.
 */
export const FOUNDRY_PROJECT_ENDPOINT =
  'https://cog-5uza2luofj7sk.services.ai.azure.com/api/projects/fabric-dev-agents';
export const ORCHESTRATOR_AGENT = 'fabric-orchestrator';
const RESPONSES_URL = `${FOUNDRY_PROJECT_ENDPOINT}/agents/${ORCHESTRATOR_AGENT}/endpoint/protocols/openai/responses`;
const API_VERSION = 'api-version=v1';
const DELEGATE_TOOL = 'delegate_to_specialist';
const HANDOFF_ACTION = 'osmos_create_task';
const KNOWN_AGENTS = new Set([
  'guideline_auditor',
  'fabric_architect',
  'power_grid',
  'integration',
  'power_bi',
  'fabric_automation',
  'code_reviewer',
  'release_intelligence',
  'fabric_iq',
  'osmos_data_engineer',
  'data_engineer',
]);

export interface StartedResponse {
  id: string;
  status: string;
  agentSessionId?: string;
}

export interface Delegation {
  callId: string;
  agent: string;
  task: string;
  status: 'working' | 'completed' | 'failed';
  summary?: string;
}

export interface ParsedResponse {
  id: string;
  status: string;
  agentSessionId?: string;
  text: string;
  error?: string;
  delegations: Delegation[];
  handoff?: {
    workspaceId: string;
    lakehouseId: string;
    displayName: string;
    instruction: string;
  };
}

/** The prompt envelope the original bridge used, so agent behavior is unchanged. */
export function envelope(runKey: string, prompt: string): string {
  return (
    `Dashboard run ID: ${runKey}.\n` +
    'This is an interactive command-center request. Record every actual specialist ' +
    'delegation with report_agent_activity as instructed.\n\n' +
    `User request:\n${prompt}`
  );
}

function bearer(token: string): string {
  return `Bearer ${token}`;
}

/**
 * Start a background response. If the stored conversation pointer is no
 * longer valid, the conversation restarts instead of failing the run.
 */
export async function startResponse(
  token: string,
  input: string,
  previousResponseId?: string | null,
  agentSessionId?: string | null,
): Promise<{ started?: StartedResponse; error?: string; reset: boolean }> {
  const body: Record<string, unknown> = { input, background: true, store: true };
  if (previousResponseId) body.previous_response_id = previousResponseId;
  if (agentSessionId) body.agent_session_id = agentSessionId;
  let result = await request('POST', `${RESPONSES_URL}?${API_VERSION}`, bearer(token), body);
  let reset = false;
  if (
    !result.ok &&
    (previousResponseId || agentSessionId) &&
    [400, 404, 409].includes(result.status)
  ) {
    reset = true;
    result = await request('POST', `${RESPONSES_URL}?${API_VERSION}`, bearer(token), {
      input,
      background: true,
      store: true,
    });
  }
  if (!result.ok) {
    return { error: describeFailure('Foundry orchestrator request', result), reset };
  }
  const data = asRecord(result.body);
  return {
    started: {
      id: str(data.id, 200),
      status: str(data.status, 32) || 'in_progress',
      agentSessionId: str(data.agent_session_id, 200) || undefined,
    },
    reset,
  };
}

export async function getResponse(
  token: string,
  responseId: string,
): Promise<{ parsed?: ParsedResponse; error?: string; result: HttpResult }> {
  const result = await request(
    'GET',
    `${RESPONSES_URL}/${encodeURIComponent(responseId)}?${API_VERSION}`,
    bearer(token),
  );
  if (!result.ok) {
    return { error: describeFailure('Foundry run status', result), result };
  }
  return { parsed: parseResponse(asRecord(result.body)), result };
}

function outputText(item: Record<string, unknown>): string {
  if (typeof item.output === 'string') return item.output;
  const parts = asArray(item.content).map((part) => {
    const record = asRecord(part);
    return typeof record.text === 'string' ? record.text : '';
  });
  if (parts.some(Boolean)) return parts.join('\n');
  return str(item.output, 20_000);
}

export function parseResponse(data: Record<string, unknown>): ParsedResponse {
  const output = asArray(data.output).map(asRecord);
  const results = new Map<string, string>();
  for (const item of output) {
    if (item.type === 'function_call_output' && typeof item.call_id === 'string') {
      results.set(item.call_id, outputText(item));
    }
  }
  const delegations: Delegation[] = [];
  const texts: string[] = [];
  const handoffSources: string[] = [];
  for (const item of output) {
    if (item.type === 'function_call' && item.name === DELEGATE_TOOL) {
      const callId = str(item.call_id, 180);
      let args: Record<string, unknown> = {};
      try {
        args = asRecord(JSON.parse(str(item.arguments, 50_000)) as unknown);
      } catch {
        args = {};
      }
      const rawAgent = str(args.specialist, 64).toLowerCase().replace(/[-\s]/g, '_');
      const agent = KNOWN_AGENTS.has(rawAgent) ? rawAgent : rawAgent || 'specialist';
      const result = results.get(callId);
      const failed = result !== undefined && /^\s*(\[[^\]]*\]\s*)?(error|failed)\b/i.test(result);
      if (result) handoffSources.push(result);
      delegations.push({
        callId,
        agent,
        task: str(args.task, 1000) || 'Delegated task',
        status: result === undefined ? 'working' : failed ? 'failed' : 'completed',
        summary: result === undefined ? undefined : str(result.replace(/^\s*\[[^\]]*\]\s*/, ''), 2000),
      });
    }
    if (item.type === 'message') {
      for (const part of asArray(item.content).map(asRecord)) {
        if (part.type === 'output_text' && typeof part.text === 'string') texts.push(part.text);
      }
    }
  }
  const text = texts.join('\n\n').trim();
  if (text) handoffSources.push(text);
  const status = str(data.status, 32) || 'in_progress';
  const error = asRecord(data.error);
  const incomplete = asRecord(data.incomplete_details);
  return {
    id: str(data.id, 200),
    status,
    agentSessionId: str(data.agent_session_id, 200) || undefined,
    text,
    error:
      str(error.message, 1500) ||
      (status === 'incomplete' ? `Response incomplete: ${str(incomplete.reason, 200)}` : undefined),
    delegations,
    handoff: findHandoff(handoffSources),
  };
}

const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Find a structured Project Osmos handoff in specialist or orchestrator text. */
export function findHandoff(sources: string[]): ParsedResponse['handoff'] {
  for (const text of sources) {
    let index = text.indexOf(`"${HANDOFF_ACTION}"`);
    while (index !== -1) {
      let start = text.lastIndexOf('{', index);
      while (start !== -1) {
        const candidate = balancedObject(text, start);
        if (candidate) {
          try {
            const value = asRecord(JSON.parse(candidate) as unknown);
            if (value.action === HANDOFF_ACTION) {
              const workspaceId = str(value.workspaceId ?? value.workspace_id, 64);
              const lakehouseId = str(
                value.lakehouseId ?? value.default_lakehouse_id ?? value.lakehouse_id,
                64,
              );
              if (UUID_TEXT.test(workspaceId) && UUID_TEXT.test(lakehouseId)) {
                return {
                  workspaceId: workspaceId.toLowerCase(),
                  lakehouseId: lakehouseId.toLowerCase(),
                  displayName: str(value.displayName ?? value.display_name, 200) || 'Project Osmos task',
                  instruction: typeof value.instruction === 'string' ? value.instruction : '',
                };
              }
            }
          } catch {
            // Not JSON at this brace; try the enclosing one.
          }
        }
        start = start === 0 ? -1 : text.lastIndexOf('{', start - 1);
      }
      index = text.indexOf(`"${HANDOFF_ACTION}"`, index + 1);
    }
  }
  return undefined;
}

function balancedObject(text: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}
