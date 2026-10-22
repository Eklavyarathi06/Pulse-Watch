import { useCallback, useState } from 'react';
import api, { isAbort } from '../utils/api';
import { usePolling } from './usePolling';

export function useMonitors() {
  const [monitors, setMonitors] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchMonitors = useCallback(async (signal) => {
    try {
      const res = await api.get('/monitors', { signal });
      setMonitors(res.data.monitors);
      setError(null);
    } catch (err) {
      if (isAbort(err)) return;
      setError(err.message);
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, []);

  const refetch = usePolling(fetchMonitors, 15000);

  const replace = (monitor) => setMonitors((prev) => prev.map((m) => (m._id === monitor._id ? monitor : m)));

  const createMonitor = async (data) => {
    const res = await api.post('/monitors', data);
    setMonitors((prev) => [res.data.monitor, ...prev]);
    // The first check runs instantly server-side; pick up its result shortly.
    setTimeout(refetch, 2500);
    return res.data.monitor;
  };

  const updateMonitor = async (id, data) => {
    const res = await api.patch(`/monitors/${id}`, data);
    replace(res.data.monitor);
    return res.data.monitor;
  };

  const deleteMonitor = async (id) => {
    const snapshot = monitors;
    setMonitors((prev) => prev.filter((m) => m._id !== id)); // optimistic
    try {
      await api.delete(`/monitors/${id}`);
    } catch (err) {
      setMonitors(snapshot);
      throw err;
    }
  };

  const togglePause = async (id) => {
    setMonitors((prev) =>
      prev.map((m) =>
        m._id === id ? { ...m, isActive: !m.isActive, currentStatus: m.isActive ? 'PAUSED' : 'PENDING' } : m
      )
    );
    try {
      const res = await api.post(`/monitors/${id}/toggle-pause`);
      replace(res.data.monitor);
      return res.data.monitor;
    } catch (error) {
      refetch();
      throw error;
    }
  };

  const checkNow = async (id) => {
    setMonitors((prev) => prev.map((m) => (m._id === id ? { ...m, _checking: true } : m)));
    try {
      const res = await api.post(`/monitors/${id}/check`);
      if (res.data.monitor) replace(res.data.monitor);
      return res.data.result;
    } finally {
      setMonitors((prev) => prev.map((m) => (m._id === id ? { ...m, _checking: false } : m)));
    }
  };

  return {
    monitors,
    isLoading,
    error,
    createMonitor,
    updateMonitor,
    deleteMonitor,
    togglePause,
    checkNow,
    refetch,
  };
}
