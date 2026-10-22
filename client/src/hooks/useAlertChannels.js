import { useCallback, useEffect, useState } from 'react';
import api, { isAbort } from '../utils/api';

export function useAlertChannels() {
  const [channels, setChannels] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchChannels = useCallback(async (signal) => {
    try {
      const res = await api.get('/alert-channels', { signal });
      setChannels(res.data.channels);
      setError(null);
    } catch (err) {
      if (isAbort(err)) return;
      setError(err.message);
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchChannels(ctrl.signal);
    return () => ctrl.abort();
  }, [fetchChannels]);

  const replace = (channel) =>
    setChannels((prev) => prev.map((c) => (c._id === channel._id ? { ...c, ...channel } : c)));

  const createChannel = async (data) => {
    const res = await api.post('/alert-channels', data);
    const channel = { ...res.data.channel, monitorCount: 0 };
    setChannels((prev) => [channel, ...prev]);
    return channel;
  };

  const updateChannel = async (id, data) => {
    setChannels((prev) => prev.map((c) => (c._id === id ? { ...c, ...data } : c))); // optimistic
    try {
      const res = await api.patch(`/alert-channels/${id}`, data);
      replace(res.data.channel);
      return res.data.channel;
    } catch (err) {
      fetchChannels();
      throw err;
    }
  };

  const deleteChannel = async (id) => {
    await api.delete(`/alert-channels/${id}`);
    setChannels((prev) => prev.filter((c) => c._id !== id));
  };

  const testChannel = async (id, message) => {
    const res = await api.post(`/alert-channels/${id}/test`, message ? { message } : {});
    if (res.data.channel) replace(res.data.channel);
    return res.data; // { ok, error, latencyMs }
  };

  return { channels, isLoading, error, createChannel, updateChannel, deleteChannel, testChannel, refetch: fetchChannels };
}
