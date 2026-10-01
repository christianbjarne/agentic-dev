import type { WorkspaceStatusView } from '@rayfin-app/shared';
import { Briefcase, ExternalLink, GitBranch, RefreshCw } from 'lucide-react';

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
    <Panel id="git" title="Repository" icon={<GitBranch aria-hidden className="icon-size-300" />}>
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
        </dl>
      )}
    </Panel>
  );
}
