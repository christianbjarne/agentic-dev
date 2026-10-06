import type { RunEventView } from '@rayfin-app/shared';
import { Activity } from 'lucide-react';

import { agentLabel, StatusChip } from './agent-graph';
import { EmptyState, ErrorNote, SkeletonRows } from './panel';

function timeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function LiveFeed({
  events,
  loading,
  error,
}: {
  events: RunEventView[];
  loading: boolean;
  error: string | null;
}) {
  if (loading && !events.length) return <SkeletonRows rows={4} />;
  return (
    <div className="flex flex-col gap-200">
      {error && <ErrorNote message={error} />}
      {!events.length ? (
        <EmptyState icon={<Activity aria-hidden className="icon-size-500" />} title="No activity in the last two hours">
          Ask the orchestrator something that needs a specialist, and each delegation appears here.
        </EmptyState>
      ) : (
        <ol className="flex flex-col" aria-label="Specialist activity, newest first">
          {events.map((event, index) => (
            <li
              key={`${event.runKey}-${event.agent}-${index}`}
              className="grid grid-cols-[auto_1fr] gap-x-300 border-b border-border py-300 last:border-b-0"
            >
              <time
                className="pt-100-nudge font-[family-name:var(--font-numeric)] text-[length:var(--text-200)] text-muted-foreground"
                dateTime={event.createdAt}
              >
                {timeLabel(event.createdAt)}
              </time>
              <div className="flex min-w-0 flex-col gap-100">
                <div className="flex flex-wrap items-center gap-200">
                  <span className="font-semibold text-[length:var(--text-300)]">{agentLabel(event.agent)}</span>
                  <StatusChip status={event.status} />
                </div>
                <p className="line-clamp-2 text-[length:var(--text-300)] text-foreground">{event.task}</p>
                {event.summary && (
                  <p className="line-clamp-3 text-[length:var(--text-200)] text-muted-foreground">{event.summary}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
