import { ORCHESTRATOR_ID, SPECIALISTS, type AgentStatus, type RunEventView } from '@rayfin-app/shared';
import { Bot, CheckCircle2, CircleDashed, Loader2, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export const AGENT_LABELS: Record<string, string> = {
  [ORCHESTRATOR_ID]: 'Fabric orchestrator',
  osmos_task: 'Project Osmos task',
  ...Object.fromEntries(SPECIALISTS.map((agent) => [agent.id, agent.label])),
};

export function agentLabel(id: string): string {
  return AGENT_LABELS[id] ?? id.replace(/_/g, ' ');
}

/** Resolve each run first, so an old working event cannot mask its terminal outcome. */
export function agentStatuses(events: RunEventView[]): Record<string, { status: AgentStatus; task?: string }> {
  const latest = new Map<string, RunEventView>();
  for (const event of events) {
    if (event.agent === 'release_intelligence' || event.agent === 'osmos_task') continue;
    const key = `${event.runKey}:${event.agent}`;
    const previous = latest.get(key);
    if (!previous || new Date(event.createdAt).getTime() >= new Date(previous.createdAt).getTime()) latest.set(key, event);
  }
  const result: Record<string, { status: AgentStatus; task?: string; at: number }> = {};
  for (const event of latest.values()) {
    const at = new Date(event.createdAt).getTime();
    const current = result[event.agent];
    const replaces =
      !current ||
      (event.status === 'working' && current.status !== 'working') ||
      (current.status !== 'working' && at > current.at);
    if (replaces) result[event.agent] = { status: event.status, task: event.task, at };
  }
  return result;
}

export const STATUS_STYLES: Record<AgentStatus, { label: string; chip: string; ring: string; icon: ReactNode }> = {
  idle: {
    label: 'Idle',
    chip: 'bg-muted text-muted-foreground',
    ring: 'border-border',
    icon: <CircleDashed aria-hidden className="icon-size-100" />,
  },
  working: {
    label: 'Working',
    chip: 'bg-working-soft text-working',
    ring: 'border-working',
    icon: <Loader2 aria-hidden className="icon-size-100 animate-spin motion-reduce:animate-none" />,
  },
  completed: {
    label: 'Completed',
    chip: 'bg-success-soft text-success',
    ring: 'border-success',
    icon: <CheckCircle2 aria-hidden className="icon-size-100" />,
  },
  failed: {
    label: 'Failed',
    chip: 'bg-danger-soft text-destructive',
    ring: 'border-destructive',
    icon: <XCircle aria-hidden className="icon-size-100" />,
  },
  cancelled: {
    label: 'Cancelled', chip: 'bg-muted text-muted-foreground', ring: 'border-border',
    icon: <XCircle aria-hidden className="icon-size-100" />,
  },
  incomplete: {
    label: 'Incomplete', chip: 'bg-muted text-muted-foreground', ring: 'border-border',
    icon: <CircleDashed aria-hidden className="icon-size-100" />,
  },
};

export function StatusChip({ status }: { status: AgentStatus }) {
  const style = STATUS_STYLES[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-100 rounded-full px-200 py-100-nudge font-semibold',
        'text-[length:var(--text-200)] leading-200',
        style.chip,
      )}
    >
      {style.icon}
      {style.label}
    </span>
  );
}

/**
 * Orchestrator in the center, specialists on a ring. Positions are computed,
 * so the graph scales with its container on every breakpoint.
 */
export function AgentGraph({ events }: { events: RunEventView[] }) {
  const statuses = agentStatuses(events);
  const center = { x: 50, y: 50 };
  const observed = [...new Set(events.map((event) => event.agent))].filter((id) =>
    id !== ORCHESTRATOR_ID && id !== 'release_intelligence' && id !== 'osmos_task' && !SPECIALISTS.some((agent) => agent.id === id));
  const roster = [...SPECIALISTS, ...observed.map((id) => ({ id, label: agentLabel(id), short: id.slice(0, 2).toUpperCase() }))];
  const nodes = roster.map((agent, index) => {
    const angle = (index / roster.length) * Math.PI * 2 - Math.PI / 2;
    return { ...agent, x: center.x + Math.cos(angle) * 39, y: center.y + Math.sin(angle) * 39 };
  });
  const orchestrator = statuses[ORCHESTRATOR_ID]?.status ?? 'idle';
  const activeCount = Object.values(statuses).filter((s) => s.status === 'working').length;

  return (
    <div className="flex flex-col gap-300">
      <p className="sr-only" aria-live="polite">
        {activeCount ? `${activeCount} agent(s) working.` : 'No agents are working.'}
      </p>
      <div className="relative mx-auto aspect-square w-full max-w-[340px]">
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" aria-hidden>
          <circle cx="50" cy="50" r="39" className="fill-none stroke-border" strokeWidth="0.3" strokeDasharray="1 1.5" />
          {nodes.map((node) => {
            const status = statuses[node.id]?.status ?? 'idle';
            return (
              <line
                key={node.id}
                x1={center.x}
                y1={center.y}
                x2={node.x}
                y2={node.y}
                strokeWidth={status === 'idle' ? 0.25 : 0.6}
                className={cn(
                  status === 'working' && 'stroke-working',
                  status === 'completed' && 'stroke-success',
                  status === 'failed' && 'stroke-destructive',
                  status === 'idle' && 'stroke-border',
                )}
                strokeDasharray={status === 'working' ? '1.2 0.8' : undefined}
              />
            );
          })}
        </svg>

        <AgentNode
          x={center.x}
          y={center.y}
          short="FO"
          label="Fabric orchestrator"
          status={orchestrator}
          task={statuses[ORCHESTRATOR_ID]?.task}
          large
          icon={<Bot aria-hidden className="icon-size-400" />}
        />
        {nodes.map((node) => (
          <AgentNode
            key={node.id}
            x={node.x}
            y={node.y}
            short={node.short}
            label={node.label}
            status={statuses[node.id]?.status ?? 'idle'}
            task={statuses[node.id]?.task}
          />
        ))}
      </div>
      <ul className="flex flex-wrap justify-center gap-300" aria-label="Status legend">
        {(['idle', 'working', 'completed', 'failed'] as const).map((status) => (
          <li key={status}>
            <StatusChip status={status} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function AgentNode({
  x,
  y,
  short,
  label,
  status,
  task,
  large,
  icon,
}: {
  x: number;
  y: number;
  short: string;
  label: string;
  status: AgentStatus;
  task?: string;
  large?: boolean;
  icon?: ReactNode;
}) {
  const style = STATUS_STYLES[status];
  const description = `${label}: ${style.label}${task ? ` - ${task}` : ''}`;
  return (
    <div
      className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-100"
      style={{ left: `${x}%`, top: `${y}%` }}
      title={description}
    >
      <div className="relative">
        {status === 'working' && (
          <span aria-hidden className="agent-pulse absolute inset-0 rounded-full border-2 border-working" />
        )}
        <div
          role="img"
          aria-label={description}
          className={cn(
            'relative flex items-center justify-center rounded-full border-2 bg-card font-semibold shadow-sm',
            large ? 'size-[76px] text-[length:var(--text-400)]' : 'size-[46px] text-[length:var(--text-300)]',
            style.ring,
            status === 'working' && 'text-working',
            status === 'completed' && 'text-success',
            status === 'failed' && 'text-destructive',
            status === 'idle' && 'text-muted-foreground',
          )}
        >
          {icon ?? short}
        </div>
      </div>
      <span
        className={cn(
          'max-w-[96px] text-center leading-200 text-[length:var(--text-200)]',
          large ? 'font-semibold text-foreground' : 'text-muted-foreground',
        )}
      >
        {label}
      </span>
    </div>
  );
}
