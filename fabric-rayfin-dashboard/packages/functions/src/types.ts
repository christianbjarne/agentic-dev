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
  startRun: {
    input: { prompt: string; conversationId: string };
    output: { runKey: string; conversationId: string; status: 'queued' | 'working' | 'completed' | 'failed'; prompt: string; response?: undefined | string; error?: undefined | string; events: { agent: string; status: 'working' | 'completed' | 'failed' | 'idle'; task: string; summary?: undefined | string; createdAt: string; runKey: string }[]; osmos?: undefined | { workspaceId: string; lakehouseId: string; displayName: string; instruction: string }; osmosTask?: undefined | { ok: boolean; message?: undefined | string; taskId?: undefined | string; status?: undefined | string; taskPage?: undefined | string; running?: undefined | false | true }; createdAt: string; updatedAt: string };
  };
  pollRun: {
    input: { runKey: string };
    output: { runKey: string; conversationId: string; status: 'queued' | 'working' | 'completed' | 'failed'; prompt: string; response?: undefined | string; error?: undefined | string; events: { agent: string; status: 'working' | 'completed' | 'failed' | 'idle'; task: string; summary?: undefined | string; createdAt: string; runKey: string }[]; osmos?: undefined | { workspaceId: string; lakehouseId: string; displayName: string; instruction: string }; osmosTask?: undefined | { ok: boolean; message?: undefined | string; taskId?: undefined | string; status?: undefined | string; taskPage?: undefined | string; running?: undefined | false | true }; createdAt: string; updatedAt: string };
  };
  getConversation: {
    input: { conversationId: string };
    output: { runKey: string; conversationId: string; status: 'queued' | 'working' | 'completed' | 'failed'; prompt: string; response?: undefined | string; error?: undefined | string; events: { agent: string; status: 'working' | 'completed' | 'failed' | 'idle'; task: string; summary?: undefined | string; createdAt: string; runKey: string }[]; osmos?: undefined | { workspaceId: string; lakehouseId: string; displayName: string; instruction: string }; osmosTask?: undefined | { ok: boolean; message?: undefined | string; taskId?: undefined | string; status?: undefined | string; taskPage?: undefined | string; running?: undefined | false | true }; createdAt: string; updatedAt: string }[];
  };
  getWorkspaceStatus: {
    input: { workspaceId: string };
    output: { ok: boolean; message?: undefined | string; workspaceId: string; workspaceName?: undefined | string; capacityRegion?: undefined | string; itemCounts: { type: string; count: number }[]; jobs: { itemId: string; itemName: string; itemType: string; jobId: string; jobType: string; invokeType: string; status: string; startTimeUtc?: undefined | string; endTimeUtc?: undefined | string; failureReason?: undefined | string }[]; git?: undefined | { connected: boolean; provider?: undefined | string; repository?: undefined | string; branch?: undefined | string; directory?: undefined | string; changes?: undefined | number; message?: undefined | string }; checkedAt: string };
  };
  whoAmI: {
    input: Record<string, never>;
    output: { caller: { subject: string; name?: undefined | string; email?: undefined | string }; appIdentity?: undefined | { upn?: undefined | string; type?: undefined | string }; callerIsAppIdentity: boolean; allowedWorkspaces: string[] };
  };
  createOsmosTask: {
    input: { runKey: string };
    output: { ok: boolean; message?: undefined | string; taskId?: undefined | string; status?: undefined | string; taskPage?: undefined | string; running?: undefined | false | true };
  };
  getOsmosTask: {
    input: { runKey: string };
    output: { ok: boolean; message?: undefined | string; taskId?: undefined | string; status?: undefined | string; taskPage?: undefined | string; running?: undefined | false | true };
  };
};
