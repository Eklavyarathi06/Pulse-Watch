import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid,
} from 'recharts';
import { RefreshCw, Pencil, Pause, Play, Trash2, AlertTriangle, CheckCircle2, Lock } from 'lucide-react';
import { Button, cn } from './Button';
import { StatusPill, CheckTag } from './StatusPill';
import { UptimeBar } from './UptimeBar';
import { useMonitorStats } from '../hooks/useStats';
import {
  fmtMs, fmtUptime, fmtDuration, fmtRelative, fmtTime, fmtDateTime, fmtInterval, ERROR_LABELS,
} from '../utils/format';

function Stat({ label, value, sub, tone }) {
  return (
    <div className="min-w-0 border-t border-line pt-3">
      <div className="text-[11px] text-fg-3">{label}</div>
      <div className={cn('mt-1 truncate font-mono text-lg tabular', tone)}>{value}</div>
      {sub && <div className="mt-0.5 font-mono text-[10px] text-fg-3">{sub}</div>}
    </div>
  );
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-line-strong bg-raised-2 px-3 py-2 text-xs shadow-2xl">
      <div className="text-fg">{fmtDateTime(p.timestamp)}</div>
      <div className="mt-1 space-y-0.5 font-mono text-[11px] text-fg-2">
        <div>avg {fmtMs(p.responseTime)}</div>
        {p.maxResponseTime > p.responseTime && <div>max {fmtMs(p.maxResponseTime)}</div>}
        <div>{p.checks} check{p.checks === 1 ? '' : 's'}</div>
        {p.status === 'DOWN' && <div className="text-down">failure in window</div>}
      </div>
    </div>
  );
}

function SectionTitle({ children, right }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-3">
      <h3 className="eyebrow">{children}</h3>
      {right}
    </div>
  );
}

export function MonitorDetail({ monitor, onEdit, onTogglePause, onDelete, onCheckNow }) {
  const { stats, isLoading, error, refetch } = useMonitorStats(monitor?._id);
  const [checking, setChecking] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const chart = useMemo(() => (stats?.chartData || []).map((d) => ({ ...d, t: new Date(d.timestamp).getTime() })), [stats]);
  const s24 = stats?.summary24h;
  const openIncident = stats?.incidents?.find((i) => !i.resolvedAt && i.resolution !== 'PAUSED');

  if (!monitor) return null;

  const runCheck = async () => {
    setChecking(true);
    setLastResult(null);
    try {
      const result = await onCheckNow(monitor._id);
      // Remember which check this was, so the banner disappears once a newer check lands.
      setLastResult(result ? { ...result, at: Date.now() } : null);
      refetch();
    } catch {
      // toast handled by caller
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-10">
      {/* Identity + actions */}
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill status={monitor.currentStatus} />
          <span className="font-mono text-xs text-fg-3">
            {monitor.method} · every {fmtInterval(monitor.intervalSeconds)} · checked {fmtRelative(monitor.lastCheckedAt)}
          </span>
        </div>
        <div className="mt-3 flex max-w-full flex-wrap items-center gap-x-3 gap-y-1">
          <span className="break-all font-mono text-[13px] text-fg-2">{monitor.url}</span>
          <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-fg-3" title="URL secrets, headers and body are encrypted and write-only">
            <Lock className="h-3 w-3" /> encrypted{monitor.headerNames?.length ? ` · ${monitor.headerNames.length} header${monitor.headerNames.length > 1 ? 's' : ''}` : ''}{monitor.hasBody ? ' · body' : ''}
          </span>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button size="sm" onClick={runCheck} isLoading={checking} disabled={!monitor.isActive}>
            {!checking && <RefreshCw className="h-3.5 w-3.5" />} {checking ? 'Checking…' : 'Check now'}
          </Button>
          <Button size="sm" variant="secondary" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
          <Button size="sm" variant="secondary" onClick={onTogglePause}>
            {monitor.isActive ? <><Pause className="h-3.5 w-3.5" /> Pause</> : <><Play className="h-3.5 w-3.5" /> Resume</>}
          </Button>
          {onDelete && <Button size="sm" variant="danger" onClick={onDelete} className="ml-auto"><Trash2 className="h-3.5 w-3.5" /> Delete</Button>}
        </div>

        {checking && (
          <p className="mt-3 font-mono text-[11px] text-fg-3">Running up to 3 attempts — a failing target can take ~{Math.round((monitor.timeoutMs * 3) / 1000 + 10)}s.</p>
        )}
        {lastResult && (!monitor.lastCheckedAt || new Date(monitor.lastCheckedAt).getTime() <= lastResult.at + 1000) && (
          <div className={cn('mt-3 flex items-start gap-2 rounded-[10px] border px-3 py-2.5 text-[13px]', lastResult.status === 'UP' ? 'border-up/25 bg-up/[0.06]' : 'border-down/30 bg-down/[0.07]')}>
            {lastResult.status === 'UP' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-up" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-down" />}
            <div className="min-w-0">
              <span className={lastResult.status === 'UP' ? 'text-up' : 'text-down'}>{lastResult.status}</span>
              <span className="text-fg-2"> · {lastResult.statusCode ?? 'no response'} · {fmtMs(lastResult.responseTimeMs)} · attempt {lastResult.attempt}/3</span>
              {lastResult.errorMessage && <div className="mt-0.5 break-words font-mono text-[11px] text-fg-3">{lastResult.errorMessage}</div>}
            </div>
          </div>
        )}
        {openIncident && (
          <div className="mt-3 rounded-[10px] border border-down/30 bg-down/[0.07] px-3 py-2.5 text-[13px]">
            <span className="text-down">Ongoing incident</span>
            <span className="text-fg-2"> · started {fmtRelative(openIncident.startedAt)} · {fmtDuration((Date.now() - new Date(openIncident.startedAt)) / 1000)} so far</span>
          </div>
        )}
      </div>

      {(() => {
        const recent = stats?.recentChecks?.slice(0, 3) || [];
        const blocked = recent.length === 3 && recent.every((c) => c.status === 'DOWN' && !c.statusCode && ['TIMEOUT', 'CONNECTION_RESET'].includes(c.errorType));
        return blocked ? (
          <div className="rounded-[10px] border border-warn/30 bg-warn/[0.06] px-4 py-3 text-[13px] leading-relaxed text-fg-2">
            <strong className="text-warn">Site open in your browser but DOWN here?</strong> The server isn’t answering PulseWatch at all — no error page, just silence or a dropped
            connection. Big sites often use bot firewalls (Akamai, Cloudflare…) that block automated checks. If this is <em>your</em> site, ask whoever runs it to
            allow requests whose User-Agent starts with <code className="font-mono text-xs text-fg">PulseWatch/</code>. If it isn’t yours, that site doesn’t allow monitoring.
          </div>
        ) : null;
      })()}

      {error && !stats && (
        <div className="rounded-[10px] border border-down/30 bg-down/[0.07] p-4 text-sm text-down">Could not load telemetry: {error}</div>
      )}

      {/* Uptime numbers */}
      <section>
        <SectionTitle>Uptime</SectionTitle>
        {isLoading && !stats ? (
          <div className="grid grid-cols-4 gap-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-14" />)}</div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="24 hours" value={fmtUptime(stats?.uptime?.d1, 3)} />
            <Stat label="7 days" value={fmtUptime(stats?.uptime?.d7, 3)} />
            <Stat label="30 days" value={fmtUptime(stats?.uptime?.d30, 3)} />
            <Stat label="90 days" value={fmtUptime(stats?.uptime?.d90, 3)} />
          </div>
        )}
      </section>

      {/* Response time chart */}
      <section>
        <SectionTitle right={<span className="font-mono text-[11px] text-fg-3">5-min buckets · last 24h</span>}>Response time</SectionTitle>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Average" value={fmtMs(s24?.avgResponseMs)} />
          <Stat label="p95" value={fmtMs(s24?.p95ResponseMs)} />
          <Stat label="Fastest" value={fmtMs(s24?.minResponseMs)} />
          <Stat label="Slowest" value={fmtMs(s24?.maxResponseMs)} />
        </div>
        <div className="mt-6 h-[220px] w-full">
          {isLoading && !stats ? (
            <div className="skeleton h-full" />
          ) : chart.length === 0 ? (
            <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-line-strong text-sm text-fg-3">
              No checks in the last 24 hours yet.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <defs>
                  <linearGradient id="rtFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#ede8df" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="#ede8df" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(237,232,223,0.06)" vertical={false} />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  tick={{ fill: '#6f6b62', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={40}
                />
                <YAxis
                  tickFormatter={(v) => `${v}`}
                  tick={{ fill: '#6f6b62', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'rgba(237,232,223,0.25)', strokeDasharray: '3 3' }} />
                {s24?.avgResponseMs != null && (
                  <ReferenceLine y={s24.avgResponseMs} stroke="rgba(237,232,223,0.35)" strokeDasharray="4 4" label={{ value: 'avg', position: 'insideTopRight', fill: '#a8a397', fontSize: 10, fontFamily: 'JetBrains Mono' }} />
                )}
                {s24?.p95ResponseMs != null && s24.p95ResponseMs !== s24.avgResponseMs && (
                  <ReferenceLine y={s24.p95ResponseMs} stroke="rgba(242,181,68,0.45)" strokeDasharray="4 4" label={{ value: 'p95', position: 'insideTopRight', fill: '#f2b544', fontSize: 10, fontFamily: 'JetBrains Mono' }} />
                )}
                {chart.filter((d) => d.status === 'DOWN').map((d) => (
                  <ReferenceLine key={d.t} x={d.t} stroke="rgba(255,74,85,0.55)" strokeWidth={2} />
                ))}
                <Area type="monotone" dataKey="responseTime" stroke="#ede8df" strokeWidth={1.5} fill="url(#rtFill)" connectNulls isAnimationActive={false} dot={false} activeDot={{ r: 3, fill: '#ede8df', stroke: 'none' }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      {/* 90 day bar */}
      <section>
        <SectionTitle right={<span className="font-mono text-[11px] text-fg-3">{fmtUptime(stats?.uptime?.d90, 3)} overall</span>}>90-day history</SectionTitle>
        <UptimeBar dailyStats={stats?.dailyStats} days={90} />
        <div className="mt-2 flex justify-between font-mono text-[10px] text-fg-3">
          <span>90 days ago</span>
          <span>Today</span>
        </div>
      </section>

      {/* Incidents */}
      <section>
        <SectionTitle right={<span className="font-mono text-[11px] text-fg-3">{stats?.incidents?.length || 0} recorded</span>}>Incidents</SectionTitle>
        {!stats?.incidents?.length ? (
          <p className="text-sm text-fg-3">No incidents. Long may it last.</p>
        ) : (
          <ol className="relative space-y-0 border-l border-line pl-5">
            {stats.incidents.map((inc) => {
              const open = !inc.resolvedAt;
              const delivered = inc.alertsSent.filter((a) => a.ok).length;
              const failed = inc.alertsSent.filter((a) => !a.ok).length;
              return (
                <li key={inc._id} className="relative pb-6 last:pb-0">
                  <span className={cn('absolute -left-[25px] top-1.5 h-2 w-2 rounded-full ring-4 ring-raised', open ? 'bg-down' : 'bg-fg-3')} />
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-sm text-fg">{ERROR_LABELS[inc.errorType] || 'Outage'}{inc.statusCode ? ` · ${inc.statusCode}` : ''}</span>
                    <span className={cn('font-mono text-[11px]', open ? 'text-down' : 'text-fg-3')}>
                      {open ? 'ongoing' : inc.resolution === 'PAUSED' ? `closed by pause · ${fmtDuration(inc.durationSeconds)}` : `resolved · ${fmtDuration(inc.durationSeconds)}`}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-fg-3">
                    {fmtDateTime(inc.startedAt)}{inc.resolvedAt && ` → ${fmtDateTime(inc.resolvedAt)}`}
                  </div>
                  {inc.cause && <p className="mt-1.5 break-words text-[13px] text-fg-2">{inc.cause}</p>}
                  {(delivered > 0 || failed > 0) && (
                    <div className="mt-1.5 font-mono text-[10px] text-fg-3">
                      {delivered} alert{delivered === 1 ? '' : 's'} delivered{failed > 0 && <span className="text-down"> · {failed} failed</span>}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* Recent checks */}
      <section>
        <SectionTitle right={<span className="font-mono text-[11px] text-fg-3">raw log kept 25h</span>}>Recent checks</SectionTitle>
        {!stats?.recentChecks?.length ? (
          <p className="text-sm text-fg-3">{isLoading ? 'Loading…' : 'No checks yet — the first one runs right after creation.'}</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line">
            <div className="max-h-[360px] overflow-y-auto overscroll-contain">
              <table className="w-full text-left text-[13px]">
                <thead className="sticky top-0 bg-raised-2 font-mono text-[10px] uppercase tracking-wider text-fg-3">
                  <tr>
                    <th className="px-3 py-2 font-normal">Time</th>
                    <th className="px-3 py-2 font-normal">Result</th>
                    <th className="px-3 py-2 font-normal">Code</th>
                    <th className="px-3 py-2 text-right font-normal">Latency</th>
                    <th className="hidden px-3 py-2 font-normal sm:table-cell">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {stats.recentChecks.map((c) => (
                    <tr key={c._id} className="hover:bg-raised-2/60">
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-fg-2">{fmtTime(c.timestamp)}</td>
                      <td className="px-3 py-2"><CheckTag status={c.status} /></td>
                      <td className="px-3 py-2 font-mono text-xs text-fg-2">{c.statusCode ?? '—'}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular text-fg-2">{fmtMs(c.responseTimeMs)}</td>
                      <td className="hidden max-w-[260px] truncate px-3 py-2 text-xs text-fg-3 sm:table-cell" title={c.errorMessage || ''}>
                        {c.errorType ? `${ERROR_LABELS[c.errorType] || c.errorType}${c.attempt > 1 ? ` · ${c.attempt} attempts` : ''}` : c.attempt > 1 ? `ok on attempt ${c.attempt}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
