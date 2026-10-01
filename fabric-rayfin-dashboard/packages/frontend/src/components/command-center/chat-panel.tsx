import type { OsmosTaskView, RunView } from '@rayfin-app/shared';
import { ExternalLink, Loader2, MessageSquare, Send, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

import { agentLabel, StatusChip } from './agent-graph';
import { Button, EmptyState, ErrorNote, SkeletonRows } from './panel';

import { errorMessage } from '@/hooks/use-command-center';
import { getRayfinClient } from '@/lib/rayfin-client';
import { cn } from '@/lib/utils';

const SUGGESTIONS = [
  'Ask the guideline auditor which guideline rules apply to a new Silver notebook.',
  'Have the Fabric architect outline a Bronze/Silver/Gold workspace for smart-meter data.',
  'Ask the Power BI specialist which visuals fit an outage KPI page.',
];

export function ChatPanel({
  runs,
  loading,
  sending,
  busy,
  error,
  canCreateOsmos,
  onSend,
}: {
  runs: RunView[];
  loading: boolean;
  sending: boolean;
  busy: boolean;
  error: string | null;
  canCreateOsmos: boolean;
  onSend: (prompt: string) => Promise<boolean>;
}) {
  const [prompt, setPrompt] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const lastUpdate = runs.at(-1)?.updatedAt;

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [runs.length, lastUpdate]);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = prompt.trim();
    if (!text || sending || busy) return;
    if (await onSend(text)) setPrompt('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-300">
      <div className="flex min-h-[320px] flex-1 flex-col gap-400 overflow-y-auto pr-100" aria-live="polite">
        {loading && !runs.length ? (
          <SkeletonRows rows={3} />
        ) : !runs.length ? (
          <EmptyState icon={<MessageSquare aria-hidden className="icon-size-500" />} title="Start a conversation">
            The orchestrator plans the work and delegates to Fabric specialists. Try one of these:
          </EmptyState>
        ) : (
          runs.map((run) => <RunMessages key={run.runKey} run={run} canCreateOsmos={canCreateOsmos} />)
        )}
        {!runs.length && !loading && (
          <ul className="flex flex-col gap-200">
            {SUGGESTIONS.map((suggestion) => (
              <li key={suggestion}>
                <button
                  type="button"
                  onClick={() => setPrompt(suggestion)}
                  className="w-full rounded-xl border border-border bg-secondary px-300 py-200 text-left text-[length:var(--text-300)] hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {suggestion}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div ref={endRef} />
      </div>

      {error && <ErrorNote message={error} />}

      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-200">
        <label htmlFor="prompt" className="sr-only">
          Message the Fabric orchestrator
        </label>
        <textarea
          id="prompt"
          value={prompt}
          maxLength={4000}
          rows={3}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask the Fabric orchestrator... (Enter to send, Shift+Enter for a new line)"
          className="w-full resize-y rounded-xl border border-input bg-background px-300 py-200 text-[length:var(--text-300)] leading-300 focus-visible:outline-2 focus-visible:outline-ring"
        />
        <div className="flex items-center justify-between gap-300">
          <span className="text-[length:var(--text-200)] text-muted-foreground">
            {busy ? 'The orchestrator is working on your last prompt.' : `${prompt.length}/4000`}
          </span>
          <Button type="submit" disabled={!prompt.trim() || sending || busy}>
            {sending ? (
              <Loader2 aria-hidden className="icon-size-200 animate-spin motion-reduce:animate-none" />
            ) : (
              <Send aria-hidden className="icon-size-200" />
            )}
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}

function RunMessages({ run, canCreateOsmos }: { run: RunView; canCreateOsmos: boolean }) {
  const specialists = run.events.filter((event) => event.agent !== 'fabric_orchestrator');
  const done = run.status === 'completed' || run.status === 'failed';
  return (
    <article className="flex flex-col gap-200" aria-label="Conversation turn">
      <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary px-400 py-300 text-[length:var(--text-300)] text-primary-foreground">
        <p className="whitespace-pre-wrap break-words">{run.prompt}</p>
      </div>
      <div className="mr-auto flex w-full max-w-[92%] flex-col gap-200 rounded-2xl rounded-bl-md border border-border bg-secondary px-400 py-300">
        <div className="flex flex-wrap items-center gap-200">
          <span className="font-semibold text-[length:var(--text-300)]">Fabric orchestrator</span>
          <StatusChip status={run.status === 'queued' ? 'working' : run.status} />
        </div>
        {specialists.length > 0 && (
          <ul className="flex flex-wrap gap-200" aria-label="Specialists in this run">
            {specialists.map((event, index) => (
              <li
                key={`${event.agent}-${index}`}
                title={event.task}
                className={cn(
                  'rounded-full border px-200 py-100-nudge text-[length:var(--text-200)]',
                  event.status === 'working' && 'border-working text-working',
                  event.status === 'completed' && 'border-success text-success',
                  event.status === 'failed' && 'border-destructive text-destructive',
                )}
              >
                {agentLabel(event.agent)}
              </li>
            ))}
          </ul>
        )}
        {run.response ? (
          <div className="whitespace-pre-wrap break-words text-[length:var(--text-300)] leading-300">{run.response}</div>
        ) : !done ? (
          <p className="flex items-center gap-200 text-[length:var(--text-300)] text-muted-foreground">
            <Loader2 aria-hidden className="icon-size-200 animate-spin motion-reduce:animate-none" />
            {specialists.length ? 'Specialists are working...' : 'Planning the request...'}
          </p>
        ) : null}
        {run.error && <ErrorNote message={run.error} />}
        {run.osmos && <OsmosCard run={run} canCreate={canCreateOsmos} />}
      </div>
    </article>
  );
}

function OsmosCard({ run, canCreate }: { run: RunView; canCreate: boolean }) {
  const [task, setTask] = useState<OsmosTaskView | undefined>(run.osmosTask);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const osmos = run.osmos;
  const running = Boolean(task?.taskId && task.running !== false && !['Completed', 'Failed', 'Cancelled'].includes(task.status ?? ''));

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const client = await getRayfinClient();
          const result = await client.functions.getOsmosTask.invoke({ runKey: run.runKey });
          if (result.ok) setTask(result);
        } catch {
          // The manual Refresh button reports errors; background polling stays quiet.
        }
      })();
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [running, run.runKey]);

  if (!osmos) return null;

  const act = async (kind: 'create' | 'refresh') => {
    setWorking(true);
    setError(null);
    try {
      const client = await getRayfinClient();
      const result =
        kind === 'create'
          ? await client.functions.createOsmosTask.invoke({ runKey: run.runKey })
          : await client.functions.getOsmosTask.invoke({ runKey: run.runKey });
      if (result.ok) setTask(result);
      else setError(result.message ?? 'Project Osmos did not accept the request.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setWorking(false);
    }
  };

  return (
    <section
      aria-label="Project Osmos task"
      className="flex flex-col gap-200 rounded-xl border border-brand bg-card px-400 py-300"
    >
      <h3 className="flex items-center gap-200 font-semibold text-[length:var(--text-300)]">
        <Sparkles aria-hidden className="icon-size-200 text-brand-foreground" />
        Project Osmos task: {osmos.displayName}
      </h3>
      <p className="line-clamp-4 whitespace-pre-wrap text-[length:var(--text-200)] text-muted-foreground">
        {osmos.instruction}
      </p>
      {task?.taskId ? (
        <div className="flex flex-wrap items-center gap-300 text-[length:var(--text-300)]">
          <span>
            Status: <strong>{task.status ?? 'Running'}</strong>
          </span>
          {task.taskPage && (
            <a
              href={task.taskPage}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-100 text-brand-foreground underline"
            >
              Open in Fabric <ExternalLink aria-hidden className="icon-size-100" />
            </a>
          )}
          <Button variant="secondary" disabled={working} onClick={() => void act('refresh')}>
            Refresh status
          </Button>
          {task.message && (
            <span role="status" className="w-full text-[length:var(--text-200)] text-muted-foreground">
              {task.message}
            </span>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-300">
          <Button disabled={!canCreate || working} onClick={() => void act('create')}>
            {working && <Loader2 aria-hidden className="icon-size-200 animate-spin motion-reduce:animate-none" />}
            Create Osmos task
          </Button>
          {!canCreate && (
            <span className="text-[length:var(--text-200)] text-muted-foreground">
              Only the app owner can create Osmos tasks from this app. The task is created as the owner through a Fabric notebook.
            </span>
          )}
        </div>
      )}
      {error && <ErrorNote message={error} />}
    </section>
  );
}
