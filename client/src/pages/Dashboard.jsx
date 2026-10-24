import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus, Pause, Play, Pencil, RefreshCw, Search, LogOut, Copy, ExternalLink, AlertTriangle, ChevronRight, HelpCircle,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useMonitors } from '../hooks/useMonitors';
import { useDashboardSummary } from '../hooks/useStats';
import { useAlertChannels } from '../hooks/useAlertChannels';
import { useDomains } from '../hooks/useDomains';
import { DomainsPanel } from '../components/DomainsPanel';
import { Button, cn } from '../components/Button';
import { StatusPill, StatusDot } from '../components/StatusPill';
import { Drawer, Modal } from '../components/Drawer';
import { MonitorForm } from '../components/MonitorForm';
import { MonitorDetail } from '../components/MonitorDetail';
import { AlertChannelsPanel } from '../components/AlertChannelsPanel';
import { TeamPanel } from '../components/TeamPanel';
import { BillingPanel } from '../components/BillingPanel';
import { SettingsPanel } from '../components/SettingsPanel';
import { WorkspaceSwitcher, VerifyBanner } from '../components/WorkspaceSwitcher';
import { SecurityPanel, TwoFactorCard } from '../components/SecurityPanel';
import { Toggle } from '../components/Input';
import { Sparkline } from '../components/Sparkline';
import { Logo } from '../components/Logo';
import { useToast } from '../components/Toast';
import api from '../utils/api';
import { fmtMs, fmtUptime, fmtRelative, fmtInterval, fmtDuration, fmtDateTime, hostOf } from '../utils/format';

const TABS = [
  { id: 'monitors', label: 'Monitors' },
  { id: 'incidents', label: 'Incidents' },
  { id: 'channels', label: 'Alerts' },
  { id: 'domains', label: 'Domains' },
  { id: 'status', label: 'Status page' },
  { id: 'team', label: 'Team' },
  { id: 'billing', label: 'Billing' },
  { id: 'security', label: 'Security' },
  { id: 'settings', label: 'Settings' },
];

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

/* ───────── small pieces ───────── */

function StatCard({ label, value, sub, tone, loading }) {
  return (
    <div className="panel p-5">
      <div className="text-[12px] text-fg-3">{label}</div>
      {loading ? (
        <div className="skeleton mt-3 h-9 w-24" />
      ) : (
        <div className={cn('mt-2 font-serif text-[2.6rem] leading-none tabular', tone)}>{value}</div>
      )}
      <div className="mt-2 h-4 font-mono text-[11px] text-fg-3">{!loading && sub}</div>
    </div>
  );
}

function ConfirmDialog({ state, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!state) return <Modal isOpen={false} onClose={onClose} />;
  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      await state.onConfirm();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal isOpen onClose={busy ? () => {} : onClose} title={state.title} description={state.description}>
      {error && <p className="mb-4 text-sm text-down">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="danger" onClick={confirm} isLoading={busy}>{state.confirmLabel || 'Confirm'}</Button>
      </div>
    </Modal>
  );
}

/* ───────── page ───────── */

// Remount the whole dashboard when the active workspace changes so every hook refetches.
export default function DashboardPage() {
  const { workspace, twoFactorRequired } = useAuth();
  if (twoFactorRequired) return <TwoFactorGate />;
  return <Dashboard key={workspace?._id || 'none'} />;
}

/** The workspace requires 2FA and this member hasn't set it up: nothing else is reachable. */
function TwoFactorGate() {
  const { workspace, logout } = useAuth();
  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <div className="flex items-center gap-4"><Logo /><WorkspaceSwitcher /></div>
          <Button variant="ghost" size="icon" onClick={logout} aria-label="Sign out"><LogOut className="h-4 w-4" /></Button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-14">
        <div className="eyebrow mb-3">Security policy</div>
        <h1 className="text-3xl font-medium tracking-tight">{workspace?.name} requires two-factor authentication.</h1>
        <p className="mb-8 mt-3 text-fg-2">Turn it on below to continue. It takes about a minute with any authenticator app.</p>
        <TwoFactorCard />
      </main>
    </div>
  );
}

function Dashboard() {
  const { user, workspace, logout, isAdmin, needsVerification, setWorkspace } = useAuth();
  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();

  // One-off message handed over by another page (e.g. after a password reset).
  useEffect(() => {
    if (location.state?.toast) {
      toast.success(location.state.toast);
      navigate(location.pathname + location.search, { replace: true, state: null });
    }
  }, [location, navigate, toast]);
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'monitors';
  const setTab = (id) => setParams(id === 'monitors' ? {} : { tab: id }, { replace: true });

  const {
    monitors, isLoading: monitorsLoading, error, createMonitor, updateMonitor, deleteMonitor, togglePause, checkNow, refetch: refetchMonitors,
  } = useMonitors();
  const { summary, isLoading: summaryLoading, refetch: refetchSummary } = useDashboardSummary();
  const channelsApi = useAlertChannels();
  const domainsApi = useDomains();

  const [form, setForm] = useState(null); // { monitor?: object }
  const [detailId, setDetailId] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');

  const detailMonitor = monitors.find((m) => m._id === detailId) || null;
  const limit = workspace?.limits?.monitors || 5;
  const atLimit = monitors.length >= limit;

  const refreshAll = useCallback(() => {
    refetchMonitors();
    refetchSummary();
  }, [refetchMonitors, refetchSummary]);

  const hasVerifiedDomain = domainsApi.domains.some((d) => d.status === 'verified') || import.meta.env.DEV;
  const openCreate = useCallback(() => {
    if (!hasVerifiedDomain && !domainsApi.isLoading) {
      toast.info('First, verify a domain your company owns', { description: 'PulseWatch only monitors your own websites.' });
      setTab('domains');
      return;
    }
    if (needsVerification) {
      toast.error('Confirm your email first', { description: 'Use the link we emailed you, or resend it from the banner.' });
      return;
    }
    if (atLimit) {
      toast.error(`Your plan allows ${limit} monitors`, { description: 'Delete one or upgrade under Billing.' });
      return;
    }
    setSubmitError('');
    setForm({});
  }, [atLimit, limit, toast, needsVerification, hasVerifiedDomain, domainsApi.isLoading]);

  // "n" opens the new-monitor drawer (ignored while typing).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (form || detailId || confirmState) return;
      e.preventDefault();
      openCreate();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [form, detailId, confirmState, openCreate]);

  const handleSubmit = async (data) => {
    setSubmitting(true);
    setSubmitError('');
    try {
      if (form?.monitor) {
        await updateMonitor(form.monitor._id, data);
        toast.success('Monitor updated');
      } else {
        const m = await createMonitor(data);
        toast.success(`Now watching ${m.name}`, { description: 'First check is running.' });
      }
      setForm(null);
      channelsApi.refetch(); // monitor counts per channel changed
      setTimeout(refetchSummary, 3000);
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (m) => {
    try {
      const next = await togglePause(m._id);
      toast.info(next.isActive ? `${m.name} resumed — checking now` : `${m.name} paused`);
      refetchSummary();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleCheckNow = async (id) => {
    try {
      const result = await checkNow(id);
      if (result) {
        if (result.status === 'UP') toast.success(`Up · ${result.statusCode} · ${fmtMs(result.responseTimeMs)}`);
        else toast.error(`Down · ${result.errorMessage || result.statusCode}`);
      }
      refetchSummary();
      return result;
    } catch (err) {
      toast.error(err.message);
      throw err;
    }
  };

  const askDelete = (m) =>
    setConfirmState({
      title: `Delete “${m.name}”?`,
      description: 'This removes the monitor along with all of its checks, incidents and uptime history. It cannot be undone.',
      confirmLabel: 'Delete monitor',
      onConfirm: async () => {
        await deleteMonitor(m._id);
        if (detailId === m._id) setDetailId(null);
        toast.success('Monitor deleted');
        refetchSummary();
        channelsApi.refetch();
      },
    });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return monitors.filter((m) => {
      if (filter === 'up' && m.currentStatus !== 'UP') return false;
      if (filter === 'down' && m.currentStatus !== 'DOWN') return false;
      if (filter === 'paused' && m.isActive) return false;
      if (!q) return true;
      return m.name.toLowerCase().includes(q) || m.url.toLowerCase().includes(q);
    });
  }, [monitors, query, filter]);

  const counts = useMemo(() => ({
    all: monitors.length,
    up: monitors.filter((m) => m.currentStatus === 'UP').length,
    down: monitors.filter((m) => m.currentStatus === 'DOWN').length,
    paused: monitors.filter((m) => !m.isActive).length,
  }), [monitors]);

  const pending = monitors.filter((m) => m.currentStatus === 'PENDING').length;
  const active = counts.all - counts.paused;
  const headline = monitors.length === 0
    ? 'Nothing is being watched yet.'
    : counts.down > 0
      ? `${counts.down} of ${counts.all} ${counts.all === 1 ? 'monitor' : 'monitors'} ${counts.down === 1 ? 'is' : 'are'} down.`
      : active === 0
        ? 'Every monitor is paused.'
        : pending > 0
          ? `Running first checks on ${pending} ${pending === 1 ? 'monitor' : 'monitors'}…`
          : `All ${active} active ${active === 1 ? 'monitor is' : 'monitors are'} operational.`;

  const statusUrl = `${window.location.origin}/status/${workspace?.slug}`;
  const copyStatusUrl = async () => {
    try {
      await navigator.clipboard.writeText(statusUrl);
      toast.success('Status page link copied');
    } catch {
      toast.error('Could not access the clipboard', { description: statusUrl });
    }
  };

  return (
    <div className="min-h-screen bg-bg text-fg">
      {/* ─── TOP BAR ─── */}
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-6 px-4 md:px-8">
          <Link to="/dashboard" aria-label="Dashboard home" className="hidden sm:block"><Logo /></Link>
          <WorkspaceSwitcher />
          <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Dashboard sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? 'page' : undefined}
                className={cn(
                  'relative rounded-lg px-3 py-1.5 text-[13px] transition-colors',
                  tab === t.id ? 'bg-raised-2 text-fg' : 'text-fg-3 hover:text-fg'
                )}
              >
                {t.label}
                {t.id === 'incidents' && summary?.activeIncidents > 0 && (
                  <span className="ml-1.5 rounded-full bg-down px-1.5 font-mono text-[10px] text-bg">{summary.activeIncidents}</span>
                )}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="max-w-[200px] truncate text-[13px] leading-tight">{user?.name}</div>
              <div className="max-w-[200px] truncate font-mono text-[10px] text-fg-3">{user?.email}</div>
            </div>
            <Link to="/guide" target="_blank" rel="noopener" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-fg-2 transition-colors hover:bg-raised-2 hover:text-fg" aria-label="Help — simple guide" title="Help — simple guide">
              <HelpCircle className="h-4 w-4" />
            </Link>
            <Button variant="ghost" size="icon" onClick={logout} aria-label="Sign out" title="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {/* Mobile tabs */}
        <nav className="flex gap-1 overflow-x-auto border-t border-line px-3 py-2 lg:hidden" aria-label="Dashboard sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn('shrink-0 rounded-lg px-3 py-1.5 text-[13px]', tab === t.id ? 'bg-raised-2 text-fg' : 'text-fg-3')}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <VerifyBanner />

      <main className="mx-auto max-w-[1280px] px-4 pb-24 pt-10 md:px-8">
        {tab === 'monitors' && (
          <>
            {/* Header */}
            <div className="mb-10 flex flex-col justify-between gap-6 md:flex-row md:items-end">
              <div>
                <div className="eyebrow mb-3">{greeting()}, {user?.name?.split(' ')[0]}</div>
                <h1 className={cn('text-[clamp(1.8rem,3.6vw,2.8rem)] font-medium leading-[1.05] tracking-[-0.04em]', counts.down > 0 && 'text-down')}>
                  {headline}
                </h1>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={refreshAll} aria-label="Refresh"><RefreshCw className="h-4 w-4" /></Button>
                <Button onClick={openCreate} disabled={atLimit || needsVerification} title={needsVerification ? 'Confirm your email first' : atLimit ? 'Plan limit reached' : 'New monitor (N)'}>
                  <Plus className="h-4 w-4" /> New monitor
                  <kbd className="ml-1 hidden rounded border border-bg/20 px-1 font-mono text-[10px] lg:inline">N</kbd>
                </Button>
              </div>
            </div>

            {error && (
              <div className="mb-6 flex items-center gap-3 rounded-[10px] border border-down/30 bg-down/[0.07] px-4 py-3 text-sm text-down">
                <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
              </div>
            )}

            {/* Stats */}
            <div className="mb-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                label="Uptime · 30 days"
                loading={summaryLoading}
                value={fmtUptime(summary?.overallUptime)}
                sub={summary?.uptime24h != null ? `${fmtUptime(summary.uptime24h)} last 24h` : 'waiting for checks'}
                tone={summary?.overallUptime != null && summary.overallUptime < 99 ? 'text-warn' : ''}
              />
              <StatCard
                label="Response time · 24h"
                loading={summaryLoading}
                value={fmtMs(summary?.avgLatency)}
                sub={summary?.p95Latency != null ? `p95 ${fmtMs(summary.p95Latency)} · ${summary.checks24h} checks` : '—'}
              />
              <StatCard
                label="Open incidents"
                loading={summaryLoading}
                value={summary?.activeIncidents ?? 0}
                sub={`${summary?.incidents24h ?? 0} in the last 24h`}
                tone={summary?.activeIncidents > 0 ? 'text-down' : ''}
              />
              <StatCard
                label="Monitors"
                loading={monitorsLoading}
                value={<>{monitors.length}<span className="text-2xl text-fg-3">/{limit}</span></>}
                sub={`${counts.paused} paused · ${channelsApi.channels.length} channel${channelsApi.channels.length === 1 ? '' : 's'}`}
              />
            </div>

            {/* Toolbar */}
            {monitors.length > 0 && (
              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative flex-1 sm:max-w-xs">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-3" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search name or URL"
                    className="field h-9 py-0 pl-9 text-[13px]"
                    aria-label="Search monitors"
                  />
                </div>
                <div className="flex gap-1 overflow-x-auto">
                  {[['all', 'All'], ['up', 'Up'], ['down', 'Down'], ['paused', 'Paused']].map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => setFilter(id)}
                      aria-pressed={filter === id}
                      className={cn(
                        'h-9 shrink-0 rounded-[10px] border px-3 text-[13px] transition-colors',
                        filter === id ? 'border-fg bg-fg text-bg' : 'border-line-strong text-fg-2 hover:border-fg-3'
                      )}
                    >
                      {label} <span className="ml-1 font-mono text-[11px] opacity-60">{counts[id]}</span>
                    </button>
                  ))}
                </div>
                <span className="font-mono text-[11px] text-fg-3 sm:ml-auto">auto-refresh 15s</span>
              </div>
            )}

            {/* Monitors list */}
            {monitorsLoading && monitors.length === 0 ? (
              <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-[74px] rounded-[14px]" />)}</div>
            ) : monitors.length === 0 ? (
              <div className="panel flex flex-col items-center px-6 py-20 text-center">
                <div className="mb-6 font-mono text-xs text-fg-3">0 monitors · 0 checks · 0 incidents</div>
                <h3 className="text-2xl font-medium tracking-tight">Add the first thing worth <span className="serif-i">watching.</span></h3>
                <p className="mt-3 max-w-md text-sm text-fg-3">
                  {hasVerifiedDomain
                    ? 'Paste a URL on your verified domain — your homepage, an API health route, a login page. The first check runs immediately.'
                    : 'Step 1: prove your company owns its domain (Domains tab). Step 2: add the websites and APIs on it you want watched.'}
                </p>
                <Link to="/guide#start" target="_blank" rel="noopener" className="mt-3 text-sm text-fg-2 underline decoration-line-strong underline-offset-4 hover:text-fg">
                  First time? Follow the step-by-step guide
                </Link>
                <Button className="mt-8" size="lg" onClick={openCreate}><Plus className="h-4 w-4" /> New monitor</Button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="panel px-6 py-12 text-center text-sm text-fg-3">No monitors match.</div>
            ) : (
              <div className="panel overflow-hidden">
                <div className="hidden grid-cols-[minmax(0,2.4fr)_150px_90px_90px_110px_132px] gap-4 border-b border-line px-5 py-2.5 font-mono text-[10px] uppercase tracking-wider text-fg-3 lg:grid">
                  <div>Monitor</div>
                  <div>Latency · 24h</div>
                  <div className="text-right">Uptime</div>
                  <div className="text-right">Last</div>
                  <div className="text-right">Checked</div>
                  <div />
                </div>
                <ul className="divide-y divide-line">
                  {filtered.map((m) => {
                    const spark = summary?.sparklines?.[m._id];
                    return (
                      <li key={m._id}>
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => setDetailId(m._id)}
                          onKeyDown={(e) => { if (e.key === 'Enter') setDetailId(m._id); }}
                          className="group grid cursor-pointer grid-cols-[1fr_auto] items-center gap-4 px-5 py-4 transition-colors hover:bg-raised-2/60 focus-visible:bg-raised-2/60 lg:grid-cols-[minmax(0,2.4fr)_150px_90px_90px_110px_132px]"
                        >
                          <div className="flex min-w-0 items-center gap-3.5">
                            <StatusDot status={m.currentStatus} size={9} />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="truncate font-medium">{m.name}</span>
                                {m.currentStatus !== 'UP' && <StatusPill status={m.currentStatus} className="hidden sm:inline-flex" />}
                              </div>
                              <div className="truncate font-mono text-[11px] text-fg-3">
                                {m.method !== 'GET' && <span className="mr-1.5 text-fg-2">{m.method}</span>}
                                {hostOf(m.url)} · {fmtInterval(m.intervalSeconds)}
                                {m.keyword && <span className="ml-1.5">· “{m.keyword.length > 16 ? `${m.keyword.slice(0, 16)}…` : m.keyword}”</span>}
                              </div>
                            </div>
                          </div>

                          <div className="hidden lg:block">
                            <Sparkline points={spark?.points} status={m.currentStatus} width={150} height={30} />
                          </div>
                          <div className="hidden text-right font-mono text-[13px] tabular lg:block">{fmtUptime(spark?.uptime24h)}</div>
                          <div className="hidden text-right font-mono text-[13px] tabular text-fg-2 lg:block">{fmtMs(spark?.lastResponseMs)}</div>
                          <div className="hidden text-right font-mono text-[11px] text-fg-3 lg:block">{m._checking ? 'checking…' : fmtRelative(m.lastCheckedAt)}</div>

                          <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="icon" onClick={() => handleCheckNow(m._id).catch(() => {})} disabled={!m.isActive || m._checking} aria-label={`Check ${m.name} now`} title="Check now">
                              <RefreshCw className={cn('h-3.5 w-3.5', m._checking && 'animate-spin')} />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => handleToggle(m)} aria-label={m.isActive ? `Pause ${m.name}` : `Resume ${m.name}`} title={m.isActive ? 'Pause' : 'Resume'}>
                              {m.isActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => { setSubmitError(''); setForm({ monitor: m }); }} aria-label={`Edit ${m.name}`} title="Edit">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <ChevronRight className="ml-1 hidden h-4 w-4 text-fg-3 transition-transform group-hover:translate-x-0.5 sm:block" />
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </>
        )}

        {tab === 'incidents' && (
          <div>
            <div className="mb-6">
              <h2 className="text-xl font-medium tracking-tight">Incidents</h2>
              <p className="mt-1 text-sm text-fg-3">Opened after three consecutive failed attempts; closed on the first successful check.</p>
            </div>
            {summaryLoading ? (
              <div className="skeleton h-40 rounded-[14px]" />
            ) : !summary?.recentIncidents?.length ? (
              <div className="panel px-6 py-16 text-center">
                <h3 className="text-lg font-medium">No incidents on record</h3>
                <p className="mt-2 text-sm text-fg-3">When something breaks, its timeline shows up here.</p>
              </div>
            ) : (
              <ul className="panel divide-y divide-line overflow-hidden">
                {summary.recentIncidents.map((inc) => {
                  const open = !inc.resolvedAt;
                  return (
                    <li key={inc._id}>
                      <button
                        onClick={() => monitors.some((m) => m._id === inc.monitorId) && setDetailId(inc.monitorId)}
                        className="flex w-full flex-col gap-2 px-5 py-4 text-left transition-colors hover:bg-raised-2/60 sm:flex-row sm:items-center sm:gap-6"
                      >
                        <StatusDot status={open ? 'DOWN' : 'PAUSED'} size={8} />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">{inc.monitorName}</div>
                          <div className="truncate text-[13px] text-fg-3">{inc.cause}</div>
                        </div>
                        <div className="shrink-0 text-left font-mono text-[11px] sm:text-right">
                          <div className={open ? 'text-down' : 'text-fg-2'}>
                            {open ? `ongoing · ${fmtDuration((Date.now() - new Date(inc.startedAt)) / 1000)}` : `${inc.resolution === 'PAUSED' ? 'closed by pause' : 'resolved'} · ${fmtDuration(inc.durationSeconds)}`}
                          </div>
                          <div className="text-fg-3">{fmtDateTime(inc.startedAt)}</div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {tab === 'channels' && <AlertChannelsPanel channelsApi={channelsApi} onRequestConfirm={setConfirmState} canManage={isAdmin} />}
        {tab === 'domains' && <DomainsPanel domainsApi={domainsApi} onRequestConfirm={setConfirmState} />}
        {tab === 'team' && <TeamPanel onRequestConfirm={setConfirmState} />}
        {tab === 'billing' && <BillingPanel />}
        {tab === 'security' && <SecurityPanel />}
        {tab === 'settings' && <SettingsPanel />}

        {tab === 'status' && (
          <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
            <div className="panel p-6 md:p-8">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div className="eyebrow">Public status page</div>
                <Toggle
                  checked={Boolean(workspace?.statusPageEnabled)}
                  disabled={!isAdmin}
                  label="Publish status page"
                  onChange={async (value) => {
                    try {
                      const res = await api.patch('/workspaces/current', { statusPageEnabled: value });
                      setWorkspace(res.data.workspace);
                      toast.success(value ? 'Status page published' : 'Status page is now private');
                    } catch (err) {
                      toast.error(err.message);
                    }
                  }}
                />
              </div>
              <h2 className="text-2xl font-medium tracking-tight">
                {workspace?.statusPageEnabled ? <>Your status page is <span className="serif-i text-up">live.</span></> : <>Your status page is <span className="serif-i">private.</span></>}
              </h2>
              <p className="mt-3 max-w-lg text-sm leading-relaxed text-fg-2">
                {workspace?.statusPageEnabled
                  ? 'Anyone with the link sees each listed monitor by name with its state, 90-day uptime and incidents. URLs, headers and keywords are never shown. Hide individual monitors from their settings.'
                  : 'Nothing is public. Publish it to give customers a page that answers “is it down?” — only monitor names and status are shown, never URLs.'}
              </p>
              <div className="mt-6 flex items-center gap-2 rounded-[10px] border border-line-strong bg-bg p-1.5 pl-3">
                <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-fg-2">{statusUrl}</span>
                <Button size="sm" variant="secondary" onClick={copyStatusUrl}><Copy className="h-3.5 w-3.5" /> Copy</Button>
                <a href={statusUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-fg px-3 text-[13px] font-medium text-bg hover:bg-white">
                  Open <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
            <div className="panel p-6 md:p-8">
              <div className="eyebrow mb-4">Visible right now</div>
              {monitors.filter((m) => m.isActive).length === 0 ? (
                <p className="text-sm text-fg-3">No active monitors — the page will say there’s nothing to show yet.</p>
              ) : (
                <ul className="space-y-3">
                  {monitors.filter((m) => m.isActive && m.showOnStatusPage !== false).map((m) => (
                    <li key={m._id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate">{m.name}</span>
                      <StatusPill status={m.currentStatus} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </main>

      {/* ─── DETAIL DRAWER ─── */}
      <Drawer
        isOpen={Boolean(detailMonitor)}
        onClose={() => setDetailId(null)}
        title={detailMonitor?.name}
        subtitle={detailMonitor ? hostOf(detailMonitor.url) : ''}
        width="lg"
      >
        {detailMonitor && (
          <MonitorDetail
            key={detailMonitor._id}
            monitor={detailMonitor}
            onEdit={() => { setSubmitError(''); setForm({ monitor: detailMonitor }); }}
            onTogglePause={() => handleToggle(detailMonitor)}
            onDelete={isAdmin ? () => askDelete(detailMonitor) : null}
            onCheckNow={handleCheckNow}
          />
        )}
      </Drawer>

      {/* ─── CREATE / EDIT DRAWER ─── */}
      <Drawer
        isOpen={Boolean(form)}
        onClose={() => setForm(null)}
        title={form?.monitor ? `Edit ${form.monitor.name}` : 'New monitor'}
        subtitle={form?.monitor ? 'Changes apply from the next check' : 'The first check runs immediately'}
      >
        {submitError && (
          <div className="mb-6 flex items-start gap-2 rounded-[10px] border border-down/30 bg-down/[0.07] px-3 py-2.5 text-[13px] text-down" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {submitError}
          </div>
        )}
        {form && (
          <MonitorForm
            key={form.monitor?._id || 'new'}
            initialData={form.monitor}
            channels={channelsApi.channels}
            domains={domainsApi.domains}
            onManageDomains={() => { setForm(null); setDetailId(null); setTab('domains'); }}
            onSubmit={handleSubmit}
            onCancel={() => setForm(null)}
            isLoading={submitting}
            onManageChannels={isAdmin ? () => { setForm(null); setDetailId(null); setTab('channels'); } : null}
          />
        )}
      </Drawer>

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}
