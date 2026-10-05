/**
 * Function schema types for RayfinClient.
 *
 * AUTO-GENERATED — do not edit manually.
 * Re-generated automatically when function source files change.
 *
 * If this file is not updating automatically, run:
 *   rayfin dev functions apply
 *
 * The schema is a closed object type: only the function names listed
 * below are accepted by RayfinClient.functions.<name>.invoke(...).
 * Adding, renaming, or changing the signature of a udf.func() call
 * regenerates this file and surfaces type errors at every consumer.
 *
 * IMPORTANT: This file must NOT import any Node.js packages — it is
 * resolved by the frontend app's TypeScript compiler.
 */

export type AppFunctionsSchema = {
  getLiveFeed: {
    input: Record<string, never>;
    output: { agent: string; status: 'idle' | 'working' | 'completed' | 'failed' | 'cancelled' | 'incomplete'; task: string; summary?: undefined | string; createdAt: string; runKey: string }[];
  };
  startRun: {
    input: { prompt: string; conversationId: string };
    output: { runKey: string; conversationId: string; status: 'working' | 'completed' | 'failed' | 'cancelled' | 'incomplete' | 'queued'; responseId?: undefined | string; prompt: string; response?: undefined | string; error?: undefined | string; events: { agent: string; status: 'idle' | 'working' | 'completed' | 'failed' | 'cancelled' | 'incomplete'; task: string; summary?: undefined | string; createdAt: string; runKey: string }[]; osmos?: undefined | { workspaceId: string; lakehouseId: string; displayName: string; instruction: string }; osmosTask?: undefined | { ok: boolean; message?: undefined | string; taskId?: undefined | string; status?: undefined | string; taskPage?: undefined | string; running?: undefined | false | true; jobLocation?: undefined | string; monitorPaused?: undefined | false | true }; createdAt: string; updatedAt: string };
  };
  pollRun: {
    input: { runKey: string };
    output: { runKey: string; conversationId: string; status: 'working' | 'completed' | 'failed' | 'cancelled' | 'incomplete' | 'queued'; responseId?: undefined | string; prompt: string; response?: undefined | string; error?: undefined | string; events: { agent: string; status: 'idle' | 'working' | 'completed' | 'failed' | 'cancelled' | 'incomplete'; task: string; summary?: undefined | string; createdAt: string; runKey: string }[]; osmos?: undefined | { workspaceId: string; lakehouseId: string; displayName: string; instruction: string }; osmosTask?: undefined | { ok: boolean; message?: undefined | string; taskId?: undefined | string; status?: undefined | string; taskPage?: undefined | string; running?: undefined | false | true; jobLocation?: undefined | string; monitorPaused?: undefined | false | true }; createdAt: string; updatedAt: string };
  };
  getConversation: {
    input: { conversationId: string };
    output: { runKey: string; conversationId: string; status: 'working' | 'completed' | 'failed' | 'cancelled' | 'incomplete' | 'queued'; responseId?: undefined | string; prompt: string; response?: undefined | string; error?: undefined | string; events: { agent: string; status: 'idle' | 'working' | 'completed' | 'failed' | 'cancelled' | 'incomplete'; task: string; summary?: undefined | string; createdAt: string; runKey: string }[]; osmos?: undefined | { workspaceId: string; lakehouseId: string; displayName: string; instruction: string }; osmosTask?: undefined | { ok: boolean; message?: undefined | string; taskId?: undefined | string; status?: undefined | string; taskPage?: undefined | string; running?: undefined | false | true; jobLocation?: undefined | string; monitorPaused?: undefined | false | true }; createdAt: string; updatedAt: string }[];
  };
  getWorkspaceStatus: {
    input: { workspaceId: string; gitOperationId: string };
    output: { ok: boolean; message?: undefined | string; workspaceId: string; workspaceName?: undefined | string; capacityRegion?: undefined | string; itemCounts: { type: string; count: number }[]; items: { id: string; name: string; type: string }[]; jobs: { itemId: string; itemName: string; itemType: string; jobId: string; jobType: string; invokeType: string; status: string; startTimeUtc?: undefined | string; endTimeUtc?: undefined | string; failureReason?: undefined | string }[]; warnings?: undefined | string[]; git?: undefined | { connected: boolean; provider?: undefined | string; repository?: undefined | string; branch?: undefined | string; directory?: undefined | string; changes?: undefined | number; workspaceHead?: undefined | string; remoteCommitHash?: undefined | string; operationId?: undefined | string; changeDetails?: undefined | { name: string; workspaceChange: string; remoteChange: string }[]; message?: undefined | string }; checkedAt: string };
  };
  getWorkspaceBranches: {
    input: { workspaceId: string; cursor: number; discover: boolean };
    output: { choices: { branch: string; id: string; name: string }[]; warnings: string[]; nextCursor: null | number; retryAfterSeconds?: undefined | number };
  };
  getWorkspaces: {
    input: Record<string, never>;
    output: { id: string; name: string }[];
  };
  getGitHubRepositories: {
    input: Record<string, never>;
    output: { name: string; url: string; defaultBranch: string }[];
  };
  getGitHubBranches: {
    input: { repository: string };
    output: string[];
  };
  getGitHubBranch: {
    input: { repository: string; branch: string };
    output: { commits: { sha: string; url: string; message: string; author: string; date: string }[]; pulls: { number: number; title: string; url: string; state: string }[] };
  };
  getGitHubCommit: {
    input: { repository: string; sha: string };
    output: { filename: string; status: string; additions: number; deletions: number; patch?: undefined | string; url?: undefined | string }[];
  };
  whoAmI: {
    input: Record<string, never>;
    output: { caller: { subject: string; name?: undefined | string; email?: undefined | string }; appIdentity?: undefined | { upn?: undefined | string; oid?: undefined | string; type?: undefined | string; audience?: undefined | string; appId?: undefined | string; scopes?: undefined | string }; callerIsAppIdentity: boolean; allowedWorkspaces: string[] };
  };
  createOsmosTask: {
    input: { runKey: string };
    output: { ok: boolean; message?: undefined | string; taskId?: undefined | string; status?: undefined | string; taskPage?: undefined | string; running?: undefined | false | true; jobLocation?: undefined | string; monitorPaused?: undefined | false | true };
  };
  getOsmosTask: {
    input: { runKey: string };
    output: { ok: boolean; message?: undefined | string; taskId?: undefined | string; status?: undefined | string; taskPage?: undefined | string; running?: undefined | false | true; jobLocation?: undefined | string; monitorPaused?: undefined | false | true };
  };
};
