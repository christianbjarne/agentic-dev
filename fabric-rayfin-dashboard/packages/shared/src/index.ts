/**
 * Browser-safe contracts shared by the data package, the functions package
 * and the frontend. Keep each record aligned with its decorated entity in
 * `@rayfin-app/data`; never import decorated classes here.
 */

export type RunStatus = 'queued' | 'working' | 'completed' | 'failed' | 'cancelled' | 'incomplete';
export type AgentStatus = 'idle' | 'working' | 'completed' | 'failed' | 'cancelled' | 'incomplete';
export const TERMINAL_RUN_STATES = ['completed', 'failed', 'cancelled', 'incomplete'] as const;
export function isRunTerminal(status: string): boolean {
  return (TERMINAL_RUN_STATES as readonly string[]).includes(status);
}
export function isTaskTerminal(status?: string | null): boolean {
  return ['completed', 'succeeded', 'failed', 'cancelled', 'canceled', 'deduped', 'incomplete'].includes((status ?? '').toLowerCase());
}
export function pollDelay(attempt: number, minimum = 2000, maximum = 15000): number {
  return Math.min(maximum, minimum * 2 ** Math.min(attempt, 8));
}

export interface ConversationRecord {
  id: string;
  title: string;
  lastPrompt: string;
  previousResponseId?: string | null;
  agentSessionId?: string | null;
  activeRunKey?: string | null;
  createdAt: Date;
  updatedAt: Date;
  owner_id: string;
}

export interface AgentRunRecord {
  id: string;
  runKey: string;
  conversationKey: string;
  prompt: string;
  status: string;
  responseId?: string | null;
  error?: string | null;
  handoff?: string | null;
  osmosTaskId?: string | null;
  osmosStatus?: string | null;
  osmosJobLocation?: string | null;
  osmosStartedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  owner_id: string;
}

export interface RunEventRecord {
  id: string;
  runKey: string;
  eventKey: string;
  agent: string;
  status: string;
  task: string;
  summary?: string | null;
  createdAt: Date;
  updatedAt: Date;
  owner_id: string;
}

export interface RunOutputRecord {
  id: string;
  runKey: string;
  seq: number;
  content: string;
  owner_id: string;
}

export type UniversalAppSchema = {
  Conversation: ConversationRecord;
  AgentRun: AgentRunRecord;
  RunEvent: RunEventRecord;
  RunOutput: RunOutputRecord;
};

/** Available specialists; activity is rendered only from actual delegation evidence. */
export const ORCHESTRATOR_ID = 'fabric_orchestrator';
export const SPECIALISTS = [
  { id: 'guideline_auditor', label: 'Guideline auditor', short: 'GA' },
  { id: 'fabric_architect', label: 'Fabric architect', short: 'FA' },
  { id: 'power_grid', label: 'Power grid', short: 'PG' },
  { id: 'integration', label: 'Integration', short: 'IN' },
  { id: 'power_bi', label: 'Power BI', short: 'BI' },
  { id: 'fabric_automation', label: 'Fabric automation', short: 'AU' },
  { id: 'code_reviewer', label: 'Code reviewer', short: 'CR' },
  { id: 'fabric_iq', label: 'Fabric IQ', short: 'IQ' },
  { id: 'osmos_data_engineer', label: 'Osmos data engineer', short: 'OS' },
  { id: 'data_engineer', label: 'Data engineer', short: 'DE' },
] as const;
export type SpecialistId = (typeof SPECIALISTS)[number]['id'];

export interface RunEventView {
  agent: string;
  status: AgentStatus;
  task: string;
  summary?: string;
  createdAt: string;
  runKey: string;
}

/** What `pollRun`/`startRun` return to the browser. */
export interface RunView {
  runKey: string;
  conversationId: string;
  status: RunStatus;
  responseId?: string;
  prompt: string;
  response?: string;
  error?: string;
  events: RunEventView[];
  osmos?: OsmosHandoff;
  osmosTask?: OsmosTaskView;
  createdAt: string;
  updatedAt: string;
}

export interface OsmosHandoff {
  workspaceId: string;
  lakehouseId: string;
  displayName: string;
  instruction: string;
}

export interface OsmosTaskView {
  ok: boolean;
  message?: string;
  taskId?: string;
  status?: string;
  taskPage?: string;
  running?: boolean;
  jobLocation?: string;
  monitorPaused?: boolean;
}

export interface FabricJobView {
  itemId: string;
  itemName: string;
  itemType: string;
  jobId: string;
  jobType: string;
  invokeType: string;
  status: string;
  startTimeUtc?: string;
  endTimeUtc?: string;
  failureReason?: string;
}

export interface WorkspaceStatusView {
  ok: boolean;
  message?: string;
  workspaceId: string;
  workspaceName?: string;
  capacityRegion?: string;
  itemCounts: { type: string; count: number }[];
  items: { id: string; name: string; type: string }[];
  jobs: FabricJobView[];
  warnings?: string[];
  git?: {
    connected: boolean;
    provider?: string;
    repository?: string;
    branch?: string;
    directory?: string;
    changes?: number;
    workspaceHead?: string;
    remoteCommitHash?: string;
    operationId?: string;
    changeDetails?: { name: string; workspaceChange: string; remoteChange: string }[];
    message?: string;
  };
  checkedAt: string;
}

export interface WorkspaceChoice { id: string; name: string }
export interface WorkspaceBranchChoice extends WorkspaceChoice { branch: string }
export interface WorkspaceBranchPage { choices: WorkspaceBranchChoice[]; warnings: string[]; nextCursor: number | null; retryAfterSeconds?: number }
export interface GitHubRepository { name: string; url: string; defaultBranch: string }
export interface GitHubCommit {
  sha: string; url: string; message: string; author: string; date: string;
}
export interface GitHubFile {
  filename: string; status: string; additions: number; deletions: number; patch?: string; url?: string;
}
export interface GitHubBranchView {
  commits: GitHubCommit[];
  pulls: { number: number; title: string; url: string; state: string }[];
}

export interface IdentityView {
  caller: { subject: string; name?: string; email?: string };
  appIdentity?: { upn?: string; oid?: string; type?: string; audience?: string; appId?: string; scopes?: string };
  callerIsAppIdentity: boolean;
  allowedWorkspaces: string[];
}
