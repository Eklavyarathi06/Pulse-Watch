import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, KeyRound, Download, Copy, Lock, History } from 'lucide-react';
import { Button, cn } from './Button';
import { Input, Toggle } from './Input';
import { Modal } from './Drawer';
import { useToast } from './Toast';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import { fmtDateTime } from '../utils/format';

const ACTION_LABELS = {
  'auth.login': 'Signed in',
  'auth.login_failed': 'Failed sign-in',
  'auth.account_locked': 'Account locked after failed sign-ins',
  'auth.login_recovery_code': 'Signed in with a recovery code',
  'auth.logout_all': 'Signed out everywhere',
  'auth.password_changed': 'Changed password',
  'auth.password_reset': 'Reset password',
  'auth.password_reset_requested': 'Requested password reset',
  'auth.2fa_enabled': 'Turned on two-factor authentication',
  'auth.2fa_disabled': 'Turned off two-factor authentication',
  'auth.recovery_codes_regenerated': 'Generated new recovery codes',
  'auth.email_verified': 'Confirmed email',
  'monitor.created': 'Created monitor',
  'monitor.updated': 'Edited monitor',
  'monitor.secrets_updated': 'Changed monitor URL, headers or body',
  'monitor.deleted': 'Deleted monitor',
  'monitor.paused': 'Paused monitor',
  'monitor.resumed': 'Resumed monitor',
  'channel.created': 'Added alert channel',
  'channel.updated': 'Changed alert channel',
  'channel.deleted': 'Deleted alert channel',
  'member.invited': 'Invited a member',
  'member.invite_revoked': 'Revoked an invitation',
  'member.joined': 'Joined the workspace',
  'member.role_changed': 'Changed a member’s role',
  'member.removed': 'Removed a member',
  'member.left': 'Left the workspace',
  'workspace.created': 'Created the workspace',
  'workspace.updated': 'Changed workspace settings',
  'workspace.ownership_transferred': 'Transferred ownership',
  'billing.paid': 'Paid for a plan',
};

function RecoveryCodes({ codes, onClose }) {
  const toast = useToast();
  const text = `PulseWatch recovery codes\nEach code can be used once.\n\n${codes.join('\n')}\n`;
  return (
    <Modal isOpen={codes.length > 0} onClose={onClose} title="Save your recovery codes" description="If you lose your phone, each of these lets you sign in once. They are shown only now — store them in a password manager.">
      <div className="grid grid-cols-2 gap-2 rounded-xl border border-line-strong bg-bg p-4 font-mono text-sm">
        {codes.map((c) => <span key={c}>{c}</span>)}
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              toast.success('Recovery codes copied');
            } catch {
              toast.error('Clipboard unavailable');
            }
          }}
        >
          <Copy className="h-3.5 w-3.5" /> Copy
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
            a.download = 'pulsewatch-recovery-codes.txt';
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          <Download className="h-3.5 w-3.5" /> Download
        </Button>
        <Button size="sm" onClick={onClose}>I’ve saved them</Button>
      </div>
    </Modal>
  );
}

export function TwoFactorCard() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [setup, setSetup] = useState(null); // { qr, secret }
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [codes, setCodes] = useState([]);
  const [confirm, setConfirm] = useState(null); // 'disable' | 'regenerate'
  const [password, setPassword] = useState('');

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/auth/2fa/setup');
      setSetup(res.data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const enable = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/auth/2fa/enable', { code });
      setCodes(res.data.recoveryCodes);
      setSetup(null);
      setCode('');
      await refresh();
      toast.success('Two-factor authentication is on');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const runConfirm = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (confirm === 'disable') {
        await api.post('/auth/2fa/disable', { password, code });
        await refresh();
        toast.info('Two-factor authentication turned off');
      } else {
        const res = await api.post('/auth/2fa/recovery-codes', { password, code });
        setCodes(res.data.recoveryCodes);
      }
      setConfirm(null);
      setPassword('');
      setCode('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {user.totpEnabled ? <ShieldCheck className="mt-0.5 h-5 w-5 text-up" /> : <ShieldAlert className="mt-0.5 h-5 w-5 text-warn" />}
          <div>
            <h3 className="font-medium">Two-factor authentication</h3>
            <p className="mt-1 max-w-md text-sm text-fg-3">
              {user.totpEnabled
                ? 'On. Signing in needs your password and a code from your authenticator app.'
                : 'Add a second step to sign-in with an authenticator app (Google Authenticator, 1Password, Authy…). Strongly recommended.'}
            </p>
          </div>
        </div>
        {user.totpEnabled ? (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => { setConfirm('regenerate'); setError(''); }}><KeyRound className="h-3.5 w-3.5" /> New recovery codes</Button>
            <Button size="sm" variant="danger" onClick={() => { setConfirm('disable'); setError(''); }}>Turn off</Button>
          </div>
        ) : (
          !setup && <Button size="sm" onClick={start} isLoading={busy}>Set up</Button>
        )}
      </div>

      {setup && (
        <form onSubmit={enable} className="mt-6 grid gap-6 border-t border-line pt-6 md:grid-cols-[220px_1fr]">
          <img src={setup.qr} alt="QR code for your authenticator app" className="h-[220px] w-[220px] rounded-xl" />
          <div className="space-y-4">
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-fg-2">
              <li>Scan the QR code with your authenticator app.</li>
              <li>Or enter this key manually: <code className="select-all break-all font-mono text-xs text-fg">{setup.secret}</code></li>
              <li>Type the 6-digit code it shows.</li>
            </ol>
            <Input
              label="Code from the app"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              className="max-w-[200px] text-center font-mono text-lg tracking-[0.4em]"
              error={error}
            />
            <div className="flex gap-2">
              <Button type="submit" isLoading={busy} disabled={code.length !== 6}>Turn on</Button>
              <Button type="button" variant="ghost" onClick={() => { setSetup(null); setCode(''); setError(''); }}>Cancel</Button>
            </div>
          </div>
        </form>
      )}

      <Modal
        isOpen={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title={confirm === 'disable' ? 'Turn off two-factor authentication?' : 'Generate new recovery codes?'}
        description={confirm === 'disable' ? 'Your account will be protected by your password only.' : 'Your old recovery codes stop working immediately.'}
      >
        <form onSubmit={runConfirm} className="space-y-4">
          <Input label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Input
            label="Authenticator code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            className="font-mono tracking-[0.3em]"
          />
          {error && <p className="text-sm text-down">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button type="submit" variant={confirm === 'disable' ? 'danger' : 'primary'} isLoading={busy} disabled={!password || code.length !== 6}>
              {confirm === 'disable' ? 'Turn off 2FA' : 'Generate codes'}
            </Button>
          </div>
        </form>
      </Modal>

      <RecoveryCodes codes={codes} onClose={() => setCodes([])} />
    </div>
  );
}

function AuditLog() {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.get('/workspaces/current/audit', { params: { limit: 100 } });
      setEntries(res.data.entries);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-fg-3" />
          <h3 className="font-medium">Audit log</h3>
        </div>
        <span className="font-mono text-[11px] text-fg-3">last 100 events · kept 1 year</span>
      </div>
      {error ? (
        <p className="px-5 py-4 text-sm text-down">{error}</p>
      ) : !entries ? (
        <div className="skeleton m-5 h-24" />
      ) : entries.length === 0 ? (
        <p className="px-5 py-6 text-sm text-fg-3">No events yet.</p>
      ) : (
        <ul className="max-h-[420px] divide-y divide-line overflow-y-auto overscroll-contain">
          {entries.map((e) => (
            <li key={e._id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-3 text-[13px]">
              <span className="w-36 shrink-0 font-mono text-[11px] text-fg-3">{fmtDateTime(e.createdAt)}</span>
              <span className={cn('flex-1', /failed|locked/.test(e.action) && 'text-warn')}>
                <span className="text-fg">{e.actorEmail || 'system'}</span>{' '}
                <span className="text-fg-2">{(ACTION_LABELS[e.action] || e.action).toLowerCase()}</span>
                {e.targetName && <span className="text-fg"> “{e.targetName}”</span>}
              </span>
              <span className="font-mono text-[11px] text-fg-3" title={e.userAgent || ''}>{e.ip || ''}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SecurityPanel() {
  const { workspace, isOwner, isAdmin, user, setWorkspace } = useAuth();
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  const setRequire2FA = async (value) => {
    setSaving(true);
    try {
      const res = await api.patch('/workspaces/current', { require2FA: value });
      setWorkspace(res.data.workspace);
      toast.success(value ? 'Two-factor authentication is now required for everyone' : '2FA requirement removed');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-medium tracking-tight">Security</h2>
        <p className="mt-1 text-sm text-fg-3">Protect your account and control how {workspace.name} is accessed.</p>
      </div>

      <TwoFactorCard />

      <div className="panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="font-medium">Require two-factor authentication</h3>
            <p className="mt-1 max-w-md text-sm text-fg-3">
              Members without 2FA can’t open any of {workspace.name}’s data until they turn it on.
              {!user.totpEnabled && isOwner && ' Turn on 2FA for your own account first.'}
            </p>
          </div>
          <Toggle
            checked={Boolean(workspace.require2FA)}
            onChange={setRequire2FA}
            label="Require two-factor authentication"
            disabled={!isOwner || saving || (!user.totpEnabled && !workspace.require2FA)}
          />
        </div>
      </div>

      <div className="panel p-6">
        <div className="flex items-start gap-3">
          <Lock className="mt-0.5 h-5 w-5 text-fg-2" />
          <div className="space-y-2 text-sm text-fg-2">
            <h3 className="font-medium text-fg">How your secrets are protected</h3>
            <p>Monitor URLs, request headers, request bodies and alert-channel webhooks are encrypted with AES-256-GCM before they reach the database, each with its own key derived for this workspace and record.</p>
            <p>They are write-only: after saving, nobody can read them back through PulseWatch — not teammates, not the workspace owner, and there is no staff console that shows them. They are decrypted only in memory, for the moment a check runs.</p>
            <p>Alerts and status pages only ever show a masked URL.</p>
          </div>
        </div>
      </div>

      {isAdmin && <AuditLog />}
    </div>
  );
}
