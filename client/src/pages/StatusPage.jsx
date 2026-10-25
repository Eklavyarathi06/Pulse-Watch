import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Link2, Check, RefreshCw } from 'lucide-react';
import api, { isAbort } from '../utils/api';
import { usePolling } from '../hooks/usePolling';
import { UptimeBar } from '../components/UptimeBar';
import { StatusDot } from '../components/StatusPill';
import { LogoMark } from '../components/Logo';
import { cn } from '../components/Button';
import { fmtUptime, fmtDuration, fmtDateTime, fmtRelative, ERROR_LABELS } from '../utils/format';

const STATE_TEXT = { UP: 'Operational', DOWN: 'Major outage', PENDING: 'Checking', PAUSED: 'Paused' };
const STATE_TONE = { UP: 'text-up', DOWN: 'text-down', PENDING: 'text-warn', PAUSED: 'text-fg-3' };

function overallState(monitors, activeIncidents) {
  if (!monitors.length) return { tone: 'neutral', title: 'No services published yet', dot: 'PAUSED' };
  const down = monitors.filter((m) => m.currentStatus === 'DOWN').length;
  if (activeIncidents.length || down) {
    if (down === monitors.length) return { tone: 'down', title: 'Major outage', dot: 'DOWN' };
    return { tone: 'down', title: `Partial outage — ${down || activeIncidents.length} of ${monitors.length} services affected`, dot: 'DOWN' };
  }
  if (monitors.some((m) => m.currentStatus === 'PENDING')) return { tone: 'warn', title: 'Checking services…', dot: 'PENDING' };
  return { tone: 'up', title: 'All systems operational', dot: 'UP' };
}

export default function StatusPage() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [lastFetched, setLastFetched] = useState(null);

  const fetchStatus = useCallback(async (signal) => {
    try {
      const res = await api.get(`/public/status/${slug}`, { signal });
      setData(res.data);
      setError(null);
      setLastFetched(new Date());
    } catch (err) {
      if (isAbort(err)) return;
      setError(err.status === 404 ? 'This status page does not exist.' : err.message);
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, [slug]);

  const refetch = usePolling(fetchStatus, 30000);

  useEffect(() => {
    if (data?.page?.name) document.title = `${data.page.name} status`;
    return () => { document.title = 'PulseWatch — Uptime monitoring that never cries wolf'; };
  }, [data?.page?.name]);

  // Re-render every 30s so "updated x ago" labels stay honest between fetches.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copy this link', window.location.href);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-bg px-5 py-16">
        <div className="mx-auto max-w-3xl space-y-4">
          <div className="skeleton h-8 w-48" />
          <div className="skeleton h-24 rounded-[14px]" />
          <div className="skeleton h-64 rounded-[14px]" />
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg p-6 text-center">
        <div>
          <LogoMark className="mx-auto mb-6 h-10 w-10 text-fg-3" live={false} />
          <h1 className="text-3xl font-medium tracking-tight">Status page not found</h1>
          <p className="mt-3 text-fg-3">{error}</p>
          <Link to="/" className="mt-8 inline-block text-sm text-fg-2 underline decoration-line-strong underline-offset-4 hover:text-fg">Go to PulseWatch</Link>
        </div>
      </div>
    );
  }

  const { page, monitors, activeIncidents, pastIncidents, overallUptime } = data;
  const state = overallState(monitors, activeIncidents);

  return (
    <div className="min-h-screen bg-bg text-fg">
      <div className="mx-auto max-w-3xl px-5 pb-24 pt-10 md:pt-16">
        {/* Header */}
        <header className="mb-10 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <LogoMark className="h-8 w-8" />
            <div>
              <h1 className="text-lg font-medium leading-tight tracking-tight">{page.name}</h1>
              <div className="font-mono text-[11px] text-fg-3">system status</div>
            </div>
          </div>
          <button
            onClick={share}
            className="inline-flex h-9 items-center gap-2 rounded-full border border-line-strong px-4 text-[13px] text-fg-2 transition-colors hover:border-fg hover:text-fg"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-up" /> : <Link2 className="h-3.5 w-3.5" />}
            {copied ? 'Link copied' : 'Share status page'}
          </button>
        </header>

        {/* Banner */}
        <section
          className={cn(
            'rounded-2xl border px-6 py-6 md:px-8',
            state.tone === 'up' && 'border-up/25 bg-up/[0.06]',
            state.tone === 'down' && 'border-down/30 bg-down/[0.07]',
            state.tone === 'warn' && 'border-warn/25 bg-warn/[0.06]',
            state.tone === 'neutral' && 'border-line bg-raised'
          )}
          aria-live="polite"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <StatusDot status={state.dot} size={12} />
              <h2 className="text-xl font-medium tracking-tight md:text-2xl">{state.title}</h2>
            </div>
            {overallUptime != null && (
              <div className="sm:text-right">
                <div className="font-serif text-3xl leading-none tabular">{fmtUptime(overallUptime)}</div>
                <div className="mt-1 font-mono text-[11px] text-fg-3">uptime · last 30 days</div>
              </div>
            )}
          </div>
        </section>

        {/* Active incidents */}
        {activeIncidents.length > 0 && (
          <section className="mt-8">
            <h3 className="eyebrow mb-4 text-down">Ongoing incidents</h3>
            <div className="space-y-3">
              {activeIncidents.map((inc) => (
                <div key={inc._id} className="rounded-[14px] border border-down/30 bg-raised p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="font-medium">{inc.monitorName} is unavailable</div>
                    <div className="font-mono text-[11px] text-down">{fmtDuration((Date.now() - new Date(inc.startedAt)) / 1000)} and counting</div>
                  </div>
                  <p className="mt-2 text-sm text-fg-2">
                    Detected {fmtDateTime(inc.startedAt)} — {ERROR_LABELS[inc.errorType] || 'service unreachable'}
                    {inc.statusCode ? ` (HTTP ${inc.statusCode})` : ''}. We’re checking continuously and will mark it resolved the moment it responds.
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Services */}
        <section className="mt-10">
          <div className="mb-4 flex items-baseline justify-between">
            <h3 className="eyebrow">Services</h3>
            <span className="font-mono text-[11px] text-fg-3">90-day uptime</span>
          </div>
          {monitors.length === 0 ? (
            <div className="panel px-6 py-12 text-center text-sm text-fg-3">There are no public services on this page yet.</div>
          ) : (
            <div className="panel divide-y divide-line">
              {monitors.map((m) => (
                <div key={m._id} className="px-5 py-5 md:px-6">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <StatusDot status={m.currentStatus} size={7} />
                      <span className="truncate font-medium">{m.name}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 font-mono text-xs">
                      <span className="hidden text-fg-3 sm:inline">{fmtUptime(m.uptime90d)}</span>
                      <span className={STATE_TONE[m.currentStatus]}>{STATE_TEXT[m.currentStatus]}</span>
                    </div>
                  </div>
                  <UptimeBar dailyStats={m.dailyStats} days={90} height={30} compact />
                  <div className="mt-2 flex justify-between font-mono text-[10px] text-fg-3">
                    <span>90 days ago</span>
                    <span>checked {fmtRelative(m.lastCheckedAt)}</span>
                    <span>Today</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-4 font-mono text-[10px] text-fg-3">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px] bg-up" /> ≥ 99.9%</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px] bg-warn" /> ≥ 98%</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px] bg-down" /> &lt; 98%</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px] bg-raised-3" /> no data</span>
          </div>
        </section>

        {/* History */}
        <section className="mt-12">
          <h3 className="eyebrow mb-4">Past incidents · 14 days</h3>
          {pastIncidents.length === 0 ? (
            <p className="text-sm text-fg-3">No incidents in the last two weeks.</p>
          ) : (
            <ol className="relative border-l border-line pl-5">
              {pastIncidents.map((inc) => (
                <li key={inc._id} className="relative pb-6 last:pb-0">
                  <span className="absolute -left-[24px] top-1.5 h-2 w-2 rounded-full bg-up ring-4 ring-bg" />
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{inc.monitorName} — resolved</span>
                    <span className="font-mono text-[11px] text-fg-3">{fmtDuration(inc.durationSeconds)} of downtime</span>
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-fg-3">
                    {fmtDateTime(inc.startedAt)} → {fmtDateTime(inc.resolvedAt)} · {ERROR_LABELS[inc.errorType] || 'outage'}{inc.statusCode ? ` · HTTP ${inc.statusCode}` : ''}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <footer className="mt-16 flex flex-col items-center justify-between gap-3 border-t border-line pt-6 font-mono text-[11px] text-fg-3 sm:flex-row">
          <button onClick={() => refetch()} className="inline-flex items-center gap-1.5 hover:text-fg">
            <RefreshCw className="h-3 w-3" /> updated {lastFetched ? fmtRelative(lastFetched) : '—'} · refreshes every 30s
          </button>
          <Link to="/" className="inline-flex items-center gap-1.5 hover:text-fg">
            <LogoMark className="h-3.5 w-3.5" live={false} /> Powered by PulseWatch
          </Link>
        </footer>
      </div>
    </div>
  );
}
