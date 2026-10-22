import { useCallback, useEffect, useRef } from 'react';
import { isAbort } from '../utils/api';

/**
 * Runs `fn(signal)` immediately and then every `intervalMs` while the tab is visible.
 * Each run gets its own AbortController; in-flight requests are aborted on unmount,
 * when the tab hides, or when a manual refresh supersedes them.
 */
export function usePolling(fn, intervalMs, { enabled = true } = {}) {
  const fnRef = useRef(fn);
  const ctrlRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    fnRef.current = fn;
  });

  const run = useCallback(async () => {
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    try {
      await fnRef.current(ctrl.signal);
    } catch (err) {
      if (!isAbort(err)) console.error(err);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    let stopped = false;

    const schedule = () => {
      clearTimeout(timerRef.current);
      if (stopped) return;
      timerRef.current = setTimeout(async () => {
        if (!document.hidden) await run();
        schedule();
      }, intervalMs);
    };

    run().then(schedule);

    const onVisibility = () => {
      if (document.hidden) {
        ctrlRef.current?.abort();
      } else {
        run().then(schedule);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopped = true;
      clearTimeout(timerRef.current);
      ctrlRef.current?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, intervalMs, run]);

  return run;
}
