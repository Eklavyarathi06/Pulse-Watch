import { useCallback, useState } from 'react';
import api, { isAbort } from '../utils/api';
import { usePolling } from './usePolling';

export function useDashboardSummary() {
  const [summary, setSummary] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchSummary = useCallback(async (signal) => {
    try {
      const res = await api.get('/dashboard/summary', { signal });
      setSummary(res.data);
    } catch (error) {
      if (!isAbort(error)) console.error('Failed to fetch summary', error);
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, []);

  const refetch = usePolling(fetchSummary, 30000);

  return { summary, isLoading, refetch };
}

export function useMonitorStats(monitorId) {
  const [stats, setStats] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [loadedFor, setLoadedFor] = useState(null);

  // Reset when switching monitors (state-during-render pattern, no effect needed).
  if (loadedFor !== monitorId) {
    setLoadedFor(monitorId);
    setStats(null);
    setIsLoading(true);
    setError(null);
  }

  const fetchStats = useCallback(async (signal) => {
    if (!monitorId) return;
    try {
      const res = await api.get(`/monitors/${monitorId}/stats`, { signal });
      setStats(res.data);
      setError(null);
    } catch (err) {
      if (isAbort(err)) return;
      setError(err.message);
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, [monitorId]);

  const refetch = usePolling(fetchStats, 20000, { enabled: Boolean(monitorId) });

  return { stats, isLoading, error, refetch };
}
