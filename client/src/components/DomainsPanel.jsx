import React, { useState } from 'react';
import { Globe, BadgeCheck, Clock, AlertTriangle, Copy, Trash2, RefreshCw, Plus, Radar } from 'lucide-react';
import api from '../utils/api';
import { Button, cn } from './Button';
import { Input, Segmented } from './Input';
import { useToast } from './Toast';
import { useAuth } from '../contexts/AuthContext';
import { fmtRelative } from '../utils/format';

const STATUS = {
  verified: { label: 'Verified', icon: BadgeCheck, cls: 'border-up/25 text-up' },
  pending: { label: 'Not verified yet', icon: Clock, cls: 'border-warn/30 text-warn' },
  lost: { label: 'Verification lost', icon: AlertTriangle, cls: 'border-down/30 text-down' },
};

function CopyRow({ label, value }) {
  const toast = useToast();
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line-strong bg-bg py-1.5 pl-3 pr-1.5">
      <span className="w-16 shrink-0 font-mono text-[10px] uppercase tracking-wider text-fg-3">{label}</span>
      <code className="min-w-0 flex-1 select-all break-all font-mono text-[12px] text-fg">{value}</code>
      <button
        type="button"
        className="rounded-md p-1.5 text-fg-3 hover:bg-raised-2 hover:text-fg"
        aria-label={`Copy ${label}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            toast.success(`${label} copied`);
          } catch {
            toast.error('Clipboard unavailable');
          }
        }}
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ReachabilityTest({ d }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const run = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/domains/${d._id}/test`);
      setResult(res.data);
    } catch (err) {
      setResult({ reachable: false, error: err.message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="secondary" onClick={run} isLoading={busy}>{!busy && <Radar className="h-3.5 w-3.5" />} Test connection</Button>
        <span className="text-[12px] text-fg-3">Checks that your website’s firewall lets PulseWatch in.</span>
      </div>
      {result && (
        result.reachable ? (
          <p className="mt-3 text-[13px] text-up">PulseWatch can reach https://{d.domain}/ — HTTP {result.statusCode} in {result.responseTimeMs} ms. Monitors on this domain will work.</p>
        ) : (
          <div className="mt-3 space-y-2 rounded-[10px] border border-warn/30 bg-warn/[0.06] px-3 py-2.5 text-[13px] leading-relaxed text-fg-2">
            <div><strong className="text-warn">PulseWatch couldn’t get an answer.</strong> {result.blockedLikely ? 'Your site seems to be blocking automated visitors (a bot firewall such as Cloudflare or Akamai).' : result.error}</div>
            {result.userAgent && (
              <div>Ask whoever runs your website to allow requests whose User-Agent starts with <code className="font-mono text-xs text-fg">PulseWatch/</code> (full value: <code className="select-all font-mono text-xs text-fg">{result.userAgent}</code>), then test again.</div>
            )}
          </div>
        )
      )}
    </div>
  );
}

function DomainCard({ d, canManage, onVerify, onRemove }) {
  const [method, setMethod] = useState('dns');
  const [busy, setBusy] = useState(false);
  const s = STATUS[d.status];
  const Icon = s.icon;
  const open = d.status !== 'verified';

  return (
    <div className="panel p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Globe className="h-4 w-4 text-fg-3" />
        <span className="font-medium">{d.domain}</span>
        <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider', s.cls)}>
          <Icon className="h-3 w-3" /> {s.label}
        </span>
        <span className="font-mono text-[11px] text-fg-3">
          {d.monitorCount} monitor{d.monitorCount === 1 ? '' : 's'}
          {d.status === 'verified' && d.method ? ` · via ${d.method === 'dns' ? 'DNS' : 'file'} · checked ${fmtRelative(d.lastCheckedAt)}` : ''}
        </span>
        {canManage && (
          <div className="ml-auto flex gap-1">
            <Button
              size="sm"
              variant={open ? 'primary' : 'secondary'}
              isLoading={busy}
              onClick={async () => {
                setBusy(true);
                await onVerify(d);
                setBusy(false);
              }}
            >
              {!busy && <RefreshCw className="h-3.5 w-3.5" />} {open ? 'Verify now' : 'Re-check'}
            </Button>
            <Button size="sm" variant="ghost" className="text-fg-3 hover:text-down" onClick={() => onRemove(d)} aria-label={`Remove ${d.domain}`}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {d.status === 'verified' && <ReachabilityTest d={d} />}

      {open && (
        <div className="mt-5 space-y-4 border-t border-line pt-5">
          <p className="text-sm text-fg-2">
            Prove you own <strong className="text-fg">{d.domain}</strong> with <em>one</em> of these, then press <strong className="text-fg">Verify now</strong>.
            It also covers every subdomain, like <code className="font-mono text-xs">api.{d.domain}</code>.
          </p>
          <div className="w-72">
            <Segmented size="sm" ariaLabel="Verification method" value={method} onChange={setMethod} options={[{ value: 'dns', label: 'DNS record' }, { value: 'file', label: 'Upload a file' }]} />
          </div>
          {method === 'dns' ? (
            <div className="space-y-2">
              <p className="text-[13px] text-fg-3">In your domain provider (GoDaddy, Cloudflare, Namecheap…), add a TXT record:</p>
              <CopyRow label="Type" value={d.instructions.dns.type} />
              <CopyRow label="Name" value={d.instructions.dns.name} />
              <CopyRow label="Value" value={d.instructions.dns.value} />
              <p className="text-[12px] text-fg-3">DNS changes can take a few minutes (rarely up to an hour) to appear.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[13px] text-fg-3">Create a plain text file reachable at this address, containing only the code:</p>
              <CopyRow label="URL" value={d.instructions.file.url} />
              <CopyRow label="Content" value={d.instructions.file.content} />
            </div>
          )}
          {d.lastError && d.lastCheckedAt && (
            <p className="rounded-lg border border-warn/25 bg-warn/[0.06] px-3 py-2 text-[13px] text-warn">
              Last attempt {fmtRelative(d.lastCheckedAt)}: {d.lastError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function DomainsPanel({ domainsApi, onRequestConfirm }) {
  const { domains, isLoading, error, addDomain, verify, remove } = domainsApi;
  const { isAdmin, needsVerification } = useAuth();
  const toast = useToast();
  const [value, setValue] = useState('');
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState('');

  const add = async (e) => {
    e.preventDefault();
    setAdding(true);
    setFormError('');
    try {
      const d = await addDomain(value);
      setValue('');
      toast.success(`${d.domain} added — now prove you own it`);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setAdding(false);
    }
  };

  const onVerify = async (d) => {
    try {
      const res = await verify(d._id);
      if (res.status === 'verified') toast.success(`${res.domain} is verified`, { description: 'You can now monitor any website or API on it. Paused monitors on it have resumed.' });
      else toast.error(`Couldn’t verify ${res.domain} yet`, { description: res.lastError });
    } catch (err) {
      toast.error(err.message);
    }
  };

  const onRemove = (d) =>
    onRequestConfirm({
      title: `Remove ${d.domain}?`,
      description: 'Every monitor on this domain (and its subdomains) will pause, because PulseWatch only watches verified domains. They resume if you add and verify it again.',
      confirmLabel: 'Remove domain',
      onConfirm: async () => {
        await remove(d._id);
        toast.success('Domain removed');
      },
    });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium tracking-tight">Domains</h2>
        <p className="mt-1 max-w-2xl text-sm text-fg-3">
          PulseWatch only monitors websites your company has proven it owns. Add your domain, prove it’s yours once, and every website on it
          (including subdomains like api.yourcompany.com) can be monitored. Each domain can belong to only one company.
        </p>
      </div>

      {isAdmin && (
        <form onSubmit={add} className="panel flex flex-wrap items-end gap-3 p-5">
          <div className="min-w-[240px] flex-1">
            <Input label="Your domain" placeholder="example.com" value={value} onChange={(e) => setValue(e.target.value)} error={formError} spellCheck={false} />
          </div>
          <Button type="submit" isLoading={adding} disabled={!value.trim() || needsVerification}><Plus className="h-4 w-4" /> Add domain</Button>
        </form>
      )}

      {error && <div className="rounded-[10px] border border-down/30 bg-down/[0.07] px-4 py-3 text-sm text-down">{error}</div>}

      {isLoading ? (
        <div className="skeleton h-32 rounded-[14px]" />
      ) : domains.length === 0 ? (
        <div className="panel px-6 py-12 text-center text-sm text-fg-3">No domains yet. {isAdmin ? 'Add the domain your website or API lives on.' : 'Ask an admin to add one.'}</div>
      ) : (
        <div className="space-y-3">
          {domains.map((d) => (
            <DomainCard key={d._id} d={d} canManage={isAdmin} onVerify={onVerify} onRemove={onRemove} />
          ))}
        </div>
      )}

      <div className="rounded-xl border border-line px-4 py-3 text-[13px] leading-relaxed text-fg-2">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-fg-3">Why this matters</div>
        Nobody can use PulseWatch to watch, test or load another company’s website. If a domain stops being verified,
        its monitors pause automatically — and resume as soon as it’s verified again.
      </div>
    </div>
  );
}
