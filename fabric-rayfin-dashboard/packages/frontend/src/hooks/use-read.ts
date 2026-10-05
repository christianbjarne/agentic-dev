import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from './use-command-center';

/** Keyed reads never render a previous repository/workspace's data after selection changes. */
export function useRead<T>(key: string, read: (signal: AbortSignal) => Promise<T>, interval = 0) {
  const [result, setResult] = useState<{ key: string; data: T | null; error: string | null; loading: boolean }>({
    key: '', data: null, error: null, loading: true,
  });
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      setResult((current) => current.key === key
        ? { ...current, loading: true } : { key, data: null, error: null, loading: true });
      try {
        const data = await read(controller.signal);
        if (!cancelled) setResult({ key, data, error: null, loading: false });
      } catch (error) {
        if (!cancelled) setResult((current) => ({ ...current, key, error: errorMessage(error), loading: false }));
      }
      if (!cancelled && interval) timer = setTimeout(() => void tick(), interval);
    };
    timer = setTimeout(() => void tick(), 0);
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [key, read, interval, revision]);
  const current = result.key === key;
  return { data: current ? result.data : null, error: current ? result.error : null, loading: Boolean(key) && (!current || result.loading), refresh };
}
