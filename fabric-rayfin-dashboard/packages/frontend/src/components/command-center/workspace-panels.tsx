import type { WorkspaceStatusView, WorkspaceBranchChoice } from '@rayfin-app/shared';
import { Briefcase, ExternalLink, GitBranch, RefreshCw } from 'lucide-react';
import { useCallback, useState } from 'react';
import { APP_WORKSPACE_ID, useWorkspaceStatus } from '@/hooks/use-command-center';
import { useRead } from '@/hooks/use-read';
import { getRayfinClient } from '@/lib/rayfin-client';
import { SELECT_CLASS } from './repository-panel';

import { EmptyState, ErrorNote, IconButton, Panel, SkeletonRows } from './panel';

import { cn } from '@/lib/utils';

function jobTone(status: string): string {
  const value = status.toLowerCase();
  if (value === 'completed') return 'bg-success-soft text-success';
  if (value === 'failed' || value === 'cancelled' || value === 'deduped') return 'bg-danger-soft text-destructive';
  if (value === 'inprogress' || value === 'notstarted') return 'bg-working-soft text-working';
  return 'bg-muted text-muted-foreground';
}

function when(value?: string): string {
  if (!value) return '-';
  const date = new Date(value.endsWith('Z') ? value : `${value}Z`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function duration(start?: string, end?: string): string {
  if (!start || !end) return '';
  const ms = new Date(`${end}${end.endsWith('Z') ? '' : 'Z'}`).getTime() - new Date(`${start}${start.endsWith('Z') ? '' : 'Z'}`).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const seconds = Math.round(ms / 1000);
  return seconds < 90 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
}

export function WorkspaceJobsPanel({
  status,
  loading,
  error,
  onRefresh,
}: {
  status: WorkspaceStatusView | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const portal = status ? `https://app.fabric.microsoft.com/groups/${status.workspaceId}/list?experience=fabric-developer` : undefined;
  return (
    <Panel
      id="jobs"
      title="Fabric jobs"
      icon={<Briefcase aria-hidden className="icon-size-300" />}
      className="lg:col-span-2"
      actions={
        <IconButton label="Refresh workspace status" onClick={onRefresh} disabled={loading}>
          <RefreshCw aria-hidden className={cn('icon-size-200', loading && 'animate-spin motion-reduce:animate-none')} />
        </IconButton>
      }
    >
      {loading && !status ? (
        <SkeletonRows rows={4} />
      ) : (
        <div className="flex flex-col gap-400">
          {error && <ErrorNote message={error} />}
          {status?.ok && (
            <div className="flex flex-wrap items-center gap-200 text-[length:var(--text-300)]">
              <a href={portal} target="_blank" rel="noreferrer" className="inline-flex items-center gap-100 font-semibold text-brand-foreground underline">
                {status.workspaceName} <ExternalLink aria-hidden className="icon-size-100" />
              </a>
              {status.capacityRegion && <span className="text-muted-foreground">· {status.capacityRegion}</span>}
              <span className="text-muted-foreground">· checked {when(status.checkedAt)}</span>
            </div>
          )}
          {status?.ok && status.itemCounts.length > 0 && (
            <ul className="flex flex-wrap gap-200" aria-label="Items in the workspace">
              {status.itemCounts.map((item) => (
                <li key={item.type} className="rounded-full border border-border px-300 py-100 text-[length:var(--text-200)]">
                  <span className="font-semibold">{item.count}</span> {item.type}
                </li>
              ))}
            </ul>
          )}
          {status?.ok && !status.jobs.length ? (
            <EmptyState icon={<Briefcase aria-hidden className="icon-size-500" />} title="No job runs yet">
              Notebook, pipeline, Spark job and dataflow runs in this workspace appear here.
            </EmptyState>
          ) : (
            status?.ok && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-left text-[length:var(--text-300)]">
                  <caption className="sr-only">Latest job instances in the workspace</caption>
                  <thead>
                    <tr className="border-b border-border text-[length:var(--text-200)] text-muted-foreground">
                      <th scope="col" className="py-200 pr-300 font-semibold">Item</th>
                      <th scope="col" className="py-200 pr-300 font-semibold">Job</th>
                      <th scope="col" className="py-200 pr-300 font-semibold">Status</th>
                      <th scope="col" className="py-200 pr-300 font-semibold">Started</th>
                      <th scope="col" className="py-200 font-semibold">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.jobs.map((job) => (
                      <tr key={job.jobId} className="border-b border-border last:border-b-0 hover:bg-hover">
                        <td className="py-200 pr-300">
                          <span className="font-semibold">{job.itemName}</span>
                          <span className="block text-[length:var(--text-200)] text-muted-foreground">{job.itemType}</span>
                        </td>
                        <td className="py-200 pr-300">
                          {job.jobType}
                          <span className="block text-[length:var(--text-200)] text-muted-foreground">{job.invokeType}</span>
                        </td>
                        <td className="py-200 pr-300">
                          <span
                            title={job.failureReason}
                            className={cn('rounded-full px-200 py-100-nudge font-semibold text-[length:var(--text-200)]', jobTone(job.status))}
                          >
                            {job.status}
                          </span>
                        </td>
                        <td className="py-200 pr-300 font-[family-name:var(--font-numeric)]">{when(job.startTimeUtc)}</td>
                        <td className="py-200 font-[family-name:var(--font-numeric)]">{duration(job.startTimeUtc, job.endTimeUtc)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      )}
    </Panel>
  );
}

export function GitPanel({ status, loading }: { status: WorkspaceStatusView | null; loading: boolean }) {
  const git = status?.git;
  return (
    <Panel id="git" title="Fabric Git" icon={<GitBranch aria-hidden className="icon-size-300" />}>
      {loading && !status ? (
        <SkeletonRows rows={2} />
      ) : !git?.connected ? (
        <EmptyState icon={<GitBranch aria-hidden className="icon-size-500" />} title="Workspace not connected to Git">
          {git?.message ?? 'Connect the workspace to Azure DevOps or GitHub in Workspace settings to track branches here.'}
        </EmptyState>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-400 gap-y-200 text-[length:var(--text-300)]">
          <dt className="text-muted-foreground">Provider</dt>
          <dd>{git.provider}</dd>
          <dt className="text-muted-foreground">Repository</dt>
          <dd className="break-all">{git.repository}</dd>
          <dt className="text-muted-foreground">Branch</dt>
          <dd className="break-all font-[family-name:var(--font-monospace)]">{git.branch}</dd>
          <dt className="text-muted-foreground">Folder</dt>
          <dd className="break-all">{git.directory || '/'}</dd>
          <dt className="text-muted-foreground">Uncommitted items</dt>
          <dd>{git.changes ?? 'Status unavailable'}</dd>
          <dt className="text-muted-foreground">Workspace head</dt>
          <dd className="break-all">{git.workspaceHead ?? '-'}</dd>
          <dt className="text-muted-foreground">Remote head</dt>
          <dd className="break-all">{git.remoteCommitHash ?? '-'}</dd>
          {git.message && <><dt className="text-muted-foreground">Status</dt><dd>{git.message}</dd></>}
          {git.changeDetails?.map((change, index) => <div key={`${change.name}:${index}`} className="col-span-2 border-t border-border pt-200">
            {change.name}: workspace {change.workspaceChange || 'None'}, remote {change.remoteChange || 'None'}
          </div>)}
        </dl>
      )}
    </Panel>
  );
}

export function WorkspaceLivePanel() {
  const [workspaceId, setWorkspaceId] = useState(() => localStorage.getItem('command-center.workspace') ?? APP_WORKSPACE_ID);
  const readWorkspaces = useCallback(async () => (await getRayfinClient()).functions.getWorkspaces.invoke(), []);
  const choices = useRead('fabric-workspaces', readWorkspaces);
  const workspace = useWorkspaceStatus(workspaceId);
  const connected = workspace.status?.git?.connected === true;
  const [fullDiscovery, setFullDiscovery] = useState(false);
  const [discovered, setDiscovered] = useState<{ workspaceId: string; choices: WorkspaceBranchChoice[]; warnings: string[] }>({
    workspaceId: '', choices: [], warnings: [],
  });
  const readBranches = useCallback(async (signal: AbortSignal) => {
    const client = await getRayfinClient();
    const result = new Map<string, WorkspaceBranchChoice>();
    const warnings = new Set<string>();
    const deadline = Date.now() + 5 * 60_000;
    let cursor: number | null = 0;
    while (cursor !== null) {
      if (signal.aborted) throw new Error('Branch-workspace discovery was cancelled.');
      if (Date.now() > deadline) throw new Error('Branch discovery paused after five minutes. Fabric may be throttling requests; refresh to retry.');
      const page = await client.functions.getWorkspaceBranches.invoke({ workspaceId, cursor, discover: fullDiscovery });
      if (signal.aborted) throw new Error('Branch-workspace discovery was cancelled.');
      for (const choice of page.choices) result.set(choice.id, choice);
      for (const warning of page.warnings) warnings.add(warning);
      setDiscovered({ workspaceId, choices: [...result.values()], warnings: [...warnings] });
      cursor = page.nextCursor;
      const retryAfter = page.retryAfterSeconds;
      if (retryAfter) await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
    }
    return { choices: [...result.values()], warnings: [...warnings] };
  }, [workspaceId, fullDiscovery]);
  const branches = useRead(connected ? workspaceId : '', readBranches);
  const branchChoices = branches.data?.choices ?? (discovered.workspaceId === workspaceId ? discovered.choices : []);
  const branchWarnings = branches.data?.warnings ?? (discovered.workspaceId === workspaceId ? discovered.warnings : []);
  const selectWorkspace = (id: string) => { setFullDiscovery(false); setWorkspaceId(id); localStorage.setItem('command-center.workspace', id); };
  return (
    <Panel id="workspace" title="Fabric workspace live" icon={<Briefcase aria-hidden className="icon-size-300" />}
      actions={<IconButton label="Refresh Fabric workspace" onClick={() => { void workspace.refresh(); choices.refresh(); branches.refresh(); }} disabled={workspace.loading}>
        <RefreshCw aria-hidden className="icon-size-200" />
      </IconButton>}>
      <div className="flex min-h-0 flex-1 flex-col gap-300">
        <div className="grid shrink-0 grid-cols-2 gap-200">
          <label className="min-w-0 text-[length:var(--text-200)]">Workspace
            <select aria-label="Fabric workspace" className={SELECT_CLASS} value={workspaceId} onChange={(event) => selectWorkspace(event.target.value)}
              disabled={choices.loading || !choices.data?.length}>
              {!choices.data?.some((item) => item.id === workspaceId) && <option value={workspaceId}>Current workspace</option>}
              {choices.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className="min-w-0 text-[length:var(--text-200)]">Git branch workspace
            <select aria-label="Fabric Git branch" className={SELECT_CLASS} value={workspaceId} disabled={!connected || (branches.loading && !branchChoices.length)}
              onChange={(event) => selectWorkspace(event.target.value)}>
              {!branchChoices.some((item) => item.id === workspaceId) && <option value={workspaceId}>{branches.loading ? `${workspace.status?.git?.branch ?? ''} · Discovering branch workspaces...` : workspace.status?.git?.branch ?? (connected ? 'No branch workspaces' : 'Not connected')}</option>}
              {branchChoices.map((item) => <option key={item.id} value={item.id}>{item.branch} · {item.name}</option>)}
            </select>
          </label>
        </div>
        {choices.error && <ErrorNote message={choices.error} />}
        {branches.error && <ErrorNote message={branches.error} />}
        {connected && <button type="button" disabled={branches.loading}
          className="shrink-0 text-left text-[length:var(--text-200)] text-brand-foreground underline disabled:opacity-50"
          onClick={() => { if (fullDiscovery) branches.refresh(); else setFullDiscovery(true); }}>
          Discover additional branch workspaces
        </button>}
        {branches.loading && !!branchChoices.length && <p role="status" className="text-[length:var(--text-200)] text-muted-foreground">Discovering additional branch workspaces. Known branches are already selectable.</p>}
        {!!branchWarnings.length && <p role="status" className="text-[length:var(--text-200)] text-muted-foreground" title={branchWarnings.join('\n')}>
          Branch list is partial: Git metadata was unavailable for {branchWarnings.length} workspace(s). {branchWarnings[0]}
        </p>}
        <div className="min-h-0 flex-1 space-y-300 overflow-y-auto overscroll-contain">
          <p className="text-[length:var(--text-200)] text-muted-foreground">Live Fabric items, not Git snapshots. Branch selection opens an existing workspace connected to that branch; it never reconnects or overwrites items.</p>
          {workspace.status?.warnings?.map((warning) => <p key={warning} role="status" className="text-[length:var(--text-200)] text-muted-foreground">{warning}</p>)}
          {workspace.status?.ok && <section aria-label="Workspace item inventory" className="rounded-xl border border-border p-300">
            <h3 className="font-semibold text-[length:var(--text-300)]">Item inventory</h3>
            {workspace.status.itemCounts.map((group) => <details key={group.type} className="border-b border-border py-200">
              <summary className="cursor-pointer text-[length:var(--text-200)]">{group.type} ({group.count})</summary>
              <ul className="pl-300 text-[length:var(--text-200)]">
                {workspace.status?.items.filter((item) => item.type === group.type).map((item) => <li key={item.id} className="py-100">
                  <a className="break-all text-brand-foreground underline" target="_blank" rel="noreferrer"
                    href={`https://app.fabric.microsoft.com/groups/${workspaceId}/list?experience=fabric-developer&itemId=${item.id}`}>{item.name}</a>
                  <span className="block text-muted-foreground">{item.id}</span>
                </li>)}
              </ul>
            </details>)}
          </section>}
          <GitPanel status={workspace.status} loading={workspace.loading} />
          <WorkspaceJobsPanel status={workspace.status} loading={workspace.loading} error={workspace.error} onRefresh={() => void workspace.refresh()} />
        </div>
      </div>
    </Panel>
  );
}
