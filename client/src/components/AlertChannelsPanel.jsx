import React, { useState } from 'react';
import { Mail, Hash, MessageSquare, Webhook, Plus, Send, Trash2, BadgeCheck, CircleAlert, BellRing } from 'lucide-react';
import { Button, cn } from './Button';
import { Input, Textarea, Toggle } from './Input';
import { Modal } from './Drawer';
import { useToast } from './Toast';
import { fmtRelative } from '../utils/format';

export const CHANNEL_TYPES = {
  slack: {
    label: 'Slack',
    icon: Hash,
    field: 'Incoming webhook URL',
    placeholder: 'https://hooks.slack.com/services/T000/B000/XXXX',
    help: 'Slack → Apps → Incoming Webhooks → Add to channel, then paste the URL.',
  },
  discord: {
    label: 'Discord',
    icon: MessageSquare,
    field: 'Webhook URL',
    placeholder: 'https://discord.com/api/webhooks/123/abc',
    help: 'Channel settings → Integrations → Webhooks → New webhook → Copy URL.',
  },
  email: {
    label: 'Email',
    icon: Mail,
    field: 'Email address',
    placeholder: 'oncall@company.com',
    help: 'Delivered through the SMTP provider configured on the server.',
  },
  webhook: {
    label: 'Webhook',
    icon: Webhook,
    field: 'Endpoint URL',
    placeholder: 'https://example.com/hooks/pulsewatch',
    help: 'We POST JSON: { event, monitor, incident, sentAt }. Must be a public http(s) URL.',
  },
};

function AddChannelModal({ isOpen, onClose, onCreate, onTest }) {
  const [type, setType] = useState('slack');
  const [label, setLabel] = useState('');
  const [target, setTarget] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const cfg = CHANNEL_TYPES[type];

  const reset = () => {
    setType('slack');
    setLabel('');
    setTarget('');
    setError('');
  };

  const save = async (sendTest) => {
    setError('');
    if (!label.trim()) return setError('Give the channel a label');
    if (!target.trim()) return setError(`${cfg.field} is required`);
    setSaving(true);
    try {
      const ch = await onCreate({ type, label: label.trim(), target: target.trim() });
      if (sendTest) await onTest(ch);
      reset();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add alert channel" description="Where should PulseWatch tell you when something goes down — and comes back?" className="max-w-lg">
      <div className="space-y-5">
        <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Channel type">
          {Object.entries(CHANNEL_TYPES).map(([key, t]) => {
            const Icon = t.icon;
            const on = key === type;
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => { setType(key); setTarget(''); setError(''); }}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-[10px] border px-2 py-3 text-xs transition-colors',
                  on ? 'border-fg bg-raised-2 text-fg' : 'border-line-strong text-fg-2 hover:border-fg-3'
                )}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>

        <Input label="Label" placeholder={type === 'email' ? 'On-call inbox' : '#incidents'} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
        <div>
          <Input
            label={cfg.field}
            type={type === 'email' ? 'email' : 'url'}
            placeholder={cfg.placeholder}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            className="font-mono text-[13px]"
          />
          <p className="mt-1.5 text-xs text-fg-3">{cfg.help}</p>
        </div>

        {error && <p className="rounded-[10px] border border-down/30 bg-down/[0.07] px-3 py-2 text-[13px] text-down" role="alert">{error}</p>}

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="secondary" onClick={() => save(false)} isLoading={saving}>Save</Button>
          <Button onClick={() => save(true)} isLoading={saving}><Send className="h-3.5 w-3.5" /> Save &amp; send test</Button>
        </div>
      </div>
    </Modal>
  );
}

function TestModal({ channel, onClose, onTest }) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const send = async () => {
    setSending(true);
    setResult(null);
    try {
      setResult(await onTest(channel, message.trim()));
    } catch (err) {
      setResult({ ok: false, error: err.message });
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      isOpen={Boolean(channel)}
      onClose={onClose}
      title={`Send a test to ${channel?.label || ''}`}
      description="Checks the channel is reachable and shows you what a PulseWatch notification looks like there."
    >
      <div className="space-y-4">
        <Textarea
          label="Custom message"
          hint="optional"
          placeholder="Testing the on-call route before launch 🚀"
          value={message}
          maxLength={300}
          onChange={(e) => setMessage(e.target.value)}
          className="min-h-[80px] font-sans text-sm"
        />
        {result && (
          <div className={cn('rounded-[10px] border px-3 py-2.5 text-[13px]', result.ok ? 'border-up/25 bg-up/[0.06] text-up' : 'border-down/30 bg-down/[0.07] text-down')}>
            {result.ok ? `Delivered in ${result.latencyMs}ms — check ${CHANNEL_TYPES[channel.type]?.label}.` : `Failed: ${result.error}`}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button onClick={send} isLoading={sending}><Send className="h-3.5 w-3.5" /> Send test</Button>
        </div>
      </div>
    </Modal>
  );
}

export function AlertChannelsPanel({ channelsApi, onRequestConfirm, canManage = true }) {
  const { channels, isLoading, error, createChannel, updateChannel, deleteChannel, testChannel } = channelsApi;
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [testing, setTesting] = useState(null);

  const runTest = async (channel, message) => {
    const res = await testChannel(channel._id, message);
    if (res.ok) toast.success(`Test delivered to ${channel.label}`);
    else toast.error(`Test to ${channel.label} failed`, { description: res.error });
    return res;
  };

  const toggle = async (c) => {
    try {
      await updateChannel(c._id, { isActive: !c.isActive });
      toast.info(`${c.label} ${c.isActive ? 'paused' : 'resumed'}`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const remove = (c) =>
    onRequestConfirm({
      title: `Delete “${c.label}”?`,
      description: c.monitorCount
        ? `It is attached to ${c.monitorCount} monitor${c.monitorCount > 1 ? 's' : ''}; they’ll stop alerting here.`
        : 'This channel will stop receiving alerts.',
      confirmLabel: 'Delete channel',
      onConfirm: async () => {
        await deleteChannel(c._id);
        toast.success('Channel deleted');
      },
    });

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-medium tracking-tight">Alert channels</h2>
          <p className="mt-1 text-sm text-fg-3">
            Attach channels to monitors from each monitor’s settings. Secrets are stored encrypted.
            {!canManage && ' Only admins can add or change channels.'}
          </p>
        </div>
        {canManage && <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add channel</Button>}
      </div>

      {error && <div className="mb-4 rounded-[10px] border border-down/30 bg-down/[0.07] px-4 py-3 text-sm text-down">{error}</div>}

      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">{[0, 1].map((i) => <div key={i} className="skeleton h-[132px] rounded-[14px]" />)}</div>
      ) : channels.length === 0 ? (
        <div className="panel flex flex-col items-center px-6 py-16 text-center">
          <BellRing className="mb-4 h-8 w-8 text-fg-3" />
          <h3 className="text-lg font-medium">No alert channels yet</h3>
          <p className="mt-2 max-w-sm text-sm text-fg-3">Without one, PulseWatch records incidents but can’t tell anyone. Slack takes about 30 seconds.</p>
          {canManage && <Button className="mt-6" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add your first channel</Button>}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {channels.map((c) => {
            const t = CHANNEL_TYPES[c.type] || CHANNEL_TYPES.webhook;
            const Icon = t.icon;
            return (
              <div key={c._id} className={cn('panel panel-hover p-5', !c.isActive && 'opacity-60')}>
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-line-strong bg-bg">
                    <Icon className="h-4 w-4 text-fg-2" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{c.label}</span>
                      {c.isVerified && <BadgeCheck className="h-4 w-4 shrink-0 text-up" aria-label="Verified" />}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-fg-3" title={c.target}>{t.label} · {c.target}</div>
                  </div>
                  {canManage && <Toggle checked={c.isActive} onChange={() => toggle(c)} label={`${c.isActive ? 'Pause' : 'Resume'} ${c.label}`} />}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-wider">
                  <span className={cn('rounded-full border px-2 py-0.5', c.isActive ? 'border-up/25 text-up' : 'border-line-strong text-fg-3')}>{c.isActive ? 'active' : 'paused'}</span>
                  <span className={cn('rounded-full border px-2 py-0.5', c.isVerified ? 'border-line-strong text-fg-2' : 'border-warn/30 text-warn')}>{c.isVerified ? 'verified' : 'untested'}</span>
                  <span className="rounded-full border border-line-strong px-2 py-0.5 text-fg-3">{c.monitorCount || 0} monitor{c.monitorCount === 1 ? '' : 's'}</span>
                </div>

                {c.lastTestedAt && (
                  <div className={cn('mt-3 flex items-center gap-1.5 text-xs', c.lastTestOk ? 'text-fg-3' : 'text-down')}>
                    {!c.lastTestOk && <CircleAlert className="h-3.5 w-3.5" />}
                    Last test {fmtRelative(c.lastTestedAt)} — {c.lastTestOk ? 'delivered' : c.lastError || 'failed'}
                  </div>
                )}

                <div className="mt-4 flex gap-2 border-t border-line pt-4">
                  <Button size="sm" variant="secondary" onClick={() => setTesting(c)} disabled={!c.isActive}><Send className="h-3.5 w-3.5" /> Send test</Button>
                  {canManage && (
                    <Button size="sm" variant="ghost" className="ml-auto text-fg-3 hover:text-down" onClick={() => remove(c)} aria-label={`Delete ${c.label}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AddChannelModal
        isOpen={adding}
        onClose={() => setAdding(false)}
        onCreate={async (data) => {
          const ch = await createChannel(data);
          toast.success(`${CHANNEL_TYPES[data.type].label} channel added`);
          return ch;
        }}
        onTest={(ch) => runTest(ch)}
      />
      <TestModal key={testing?._id || 'none'} channel={testing} onClose={() => setTesting(null)} onTest={runTest} />
    </div>
  );
}
