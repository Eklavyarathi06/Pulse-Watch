import { useCallback, useEffect, useState } from 'react';
import api, { isAbort } from '../utils/api';

/** Verified-domain matching, mirrored from the server (exact domain, www., or any subdomain). */
export const isHostCovered = (host, domains) => {
  if (!host) return false;
  const h = host.toLowerCase();
  // Local development: private targets are treated as owned by the server too.
  if (h === 'localhost' || /^127\.|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(h)) return import.meta.env.DEV;
  return domains.some((d) => d.status === 'verified' && (h === d.domain || h === `www.${d.domain}` || h.endsWith(`.${d.domain}`)));
};

export const hostOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};

export function useDomains() {
  const [domains, setDomains] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchDomains = useCallback(async (signal) => {
    try {
      const res = await api.get('/domains', { signal });
      setDomains(res.data.domains);
      setError(null);
    } catch (err) {
      if (!isAbort(err)) setError(err.message);
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchDomains(ctrl.signal);
    return () => ctrl.abort();
  }, [fetchDomains]);

  const addDomain = async (domain) => {
    const res = await api.post('/domains', { domain });
    setDomains((prev) => [res.data.domain, ...prev]);
    return res.data.domain;
  };

  const verify = async (id) => {
    const res = await api.post(`/domains/${id}/verify`);
    setDomains((prev) => prev.map((d) => (d._id === id ? res.data.domain : d)));
    return res.data.domain;
  };

  const remove = async (id) => {
    await api.delete(`/domains/${id}`);
    setDomains((prev) => prev.filter((d) => d._id !== id));
  };

  return { domains, isLoading, error, addDomain, verify, remove, refetch: fetchDomains };
}
