import type {
  IdentityView,
  RunEventView,
  RunView,
  WorkspaceStatusView,
} from '@rayfin-app/shared';
import { isRunTerminal, mergeRunUpdate, pollDelay } from '@rayfin-app/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getRayfinClient } from '@/lib/rayfin-client';

export const APP_WORKSPACE_ID = '8b835744-f17d-44ef-b43a-3fe3d51c8e35';
const ACTIVE_CONVERSATION_KEY = 'command-center.activeConversation';
const FEED_POLL_MS = 5000;
const WORKSPACE_POLL_MS = 60000;
const FEED_WINDOW_MS = 2 * 60 * 60 * 1000;

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Try again.';
}

function isTerminal(run: RunView): boolean {
  return isRunTerminal(run.status);
}

export interface ConversationSummary {
  id: string;
  title: string;
  lastPrompt: string;
  updatedAt: string;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : '';
}

/** Conversation list for the History panel (owner-scoped by the data API). */
export function useConversations() {
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const client = await getRayfinClient();
      const rows = await client.data.Conversation.select(['id', 'title', 'lastPrompt', 'updatedAt'])
        .orderBy({ updatedAt: 'desc' })
        .first(40)
        .execute();
      setItems(
        rows.map((row) => ({
          id: row.id,
          title: row.title,
          lastPrompt: row.lastPrompt,
          updatedAt: iso(row.updatedAt),
        })),
      );
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  return { items, loading, error, refresh };
}

/** One conversation's runs, with polling for the run in progress. */
export function useConversation(onChange: () => void) {
  const [conversationId, setConversationId] = useState<string | null>(() =>
    localStorage.getItem(ACTIVE_CONVERSATION_KEY),
  );
  const [runs, setRuns] = useState<RunView[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollingPaused, setPollingPaused] = useState(false);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const select = useCallback((id: string | null) => {
    if (id) localStorage.setItem(ACTIVE_CONVERSATION_KEY, id);
    else localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
    setConversationId(id);
    setError(null);
    setPollingPaused(false);
    setRuns([]);
    if (!id) setRuns([]);
  }, []);

  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);
      try {
        const client = await getRayfinClient();
        const result = await client.functions.getConversation.invoke({ conversationId });
        if (!cancelled) setRuns(result);
      } catch (err) {
        if (!cancelled) {
          setError(errorMessage(err));
          setRuns([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const active = runs.find((run) => !isTerminal(run));
  const activeKey = active?.runKey;

  useEffect(() => {
    if (!activeKey) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let failures = 0;
    const tick = async () => {
      try {
        const client = await getRayfinClient();
        const next = await client.functions.pollRun.invoke({ runKey: activeKey });
        if (cancelled) return;
        setRuns((current) => mergeRunUpdate(current, next));
        setError(next.error ?? null);
        failures = next.error && !isTerminal(next) ? failures + 1 : 0;
        if (isTerminal(next)) {
          setPollingPaused(false);
          onChangeRef.current();
          return;
        }
      } catch (err) {
        if (cancelled) return;
        setError(errorMessage(err));
        failures++;
      }
      if (failures >= 5) {
        setPollingPaused(true);
        return;
      }
      if (!cancelled) timer = setTimeout(() => void tick(), pollDelay(attempt++));
    };
    timer = setTimeout(() => void tick(), 1500);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeKey, retryGeneration]);

  const send = useCallback(
    async (prompt: string) => {
      setSending(true);
      setError(null);
      try {
        const client = await getRayfinClient();
        const run = await client.functions.startRun.invoke({
          prompt,
          conversationId: conversationId ?? '',
        });
        if (run.conversationId !== conversationId) {
          localStorage.setItem(ACTIVE_CONVERSATION_KEY, run.conversationId);
          setRuns([run]);
          setConversationId(run.conversationId);
        } else {
          setRuns((current) => [...current, run]);
        }
        onChangeRef.current();
        return true;
      } catch (err) {
        setError(errorMessage(err));
        return false;
      } finally {
        setSending(false);
      }
    },
    [conversationId],
  );

  const resumePolling = useCallback(() => {
    setPollingPaused(false);
    setError(null);
    setRetryGeneration((value) => value + 1);
  }, []);
  return { conversationId, runs, loading, sending, error, select, send, pollingPaused, resumePolling, busy: Boolean(active) && !pollingPaused };
}

/** Recent specialist activity across all of the caller's runs. */
export function useLiveFeed() {
  const [events, setEvents] = useState<RunEventView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const client = await getRayfinClient();
        const rows = await client.functions.getLiveFeed.invoke();
        if (cancelled) return;
        const since = Date.now() - FEED_WINDOW_MS;
        setEvents(
          rows.filter((row) => new Date(row.createdAt).getTime() >= since),
        );
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(errorMessage(err));
          setEvents((current) => current.filter((event) => event.status !== 'working'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
      if (!cancelled) timer = setTimeout(() => void tick(), FEED_POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return { events, loading, error };
}

export function useWorkspaceStatus(workspaceId = APP_WORKSPACE_ID) {
  const [status, setStatus] = useState<WorkspaceStatusView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const operation = useRef('');
  const activeJobs = useRef(false);

  const refresh = useCallback(async () => {
    const requestGeneration = generation.current;
    setLoading(true);
    try {
      const client = await getRayfinClient();
      const result = await client.functions.getWorkspaceStatus.invoke({ workspaceId, gitOperationId: operation.current });
      if (generation.current !== requestGeneration) return;
      operation.current = result.git?.operationId ?? '';
      activeJobs.current = result.jobs.some((job) => ['inprogress', 'notstarted'].includes(job.status.toLowerCase()));
      setStatus(result);
      setError(result.ok ? null : (result.message ?? 'Workspace status is unavailable.'));
    } catch (err) {
      if (generation.current === requestGeneration) setError(errorMessage(err));
    } finally {
      if (generation.current === requestGeneration) setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    const version = ++generation.current;
    operation.current = '';
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await refresh();
      if (!cancelled) timer = setTimeout(() => void tick(), operation.current ? 5000 : activeJobs.current ? 10000 : WORKSPACE_POLL_MS);
    };
    const first = setTimeout(() => { setStatus(null); void tick(); }, 0);
    return () => {
      clearTimeout(first);
      cancelled = true;
      generation.current = version + 1;
      clearTimeout(timer);
    };
  }, [refresh]);

  return { status, loading, error, refresh };
}

export function useIdentity() {
  const [identity, setIdentity] = useState<IdentityView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // whoAmI can fail on a cold start; retry so the Osmos button doesn't stay disabled.
      for (let attempt = 0; attempt < 4 && !cancelled; attempt += 1) {
        try {
          const client = await getRayfinClient();
          const result = await client.functions.whoAmI.invoke();
          if (!cancelled) {
            setIdentity(result);
            setError(null);
          }
          return;
        } catch (err) {
          if (!cancelled) setError(errorMessage(err));
          await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return { identity, error };
}
