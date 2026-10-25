import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from './Button';
import { Input } from './Input';
import { Modal } from './Drawer';
import { useToast } from './Toast';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import { PasswordInput, StrengthMeter } from '../pages/Auth';

function Section({ title, description, children, danger }) {
  return (
    <section className={`grid gap-6 border-t pt-8 md:grid-cols-[260px_1fr] ${danger ? 'border-down/25' : 'border-line'}`}>
      <div>
        <h3 className={`text-[15px] font-medium ${danger ? 'text-down' : ''}`}>{title}</h3>
        {description && <p className="mt-1.5 text-[13px] leading-relaxed text-fg-3">{description}</p>}
      </div>
      <div className="max-w-xl">{children}</div>
    </section>
  );
}

function ConfirmTyping({ isOpen, onClose, title, description, expected, confirmLabel, onConfirm, password }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ready = password ? value.length > 0 : value === expected;

  const go = async () => {
    setBusy(true);
    setError('');
    try {
      await onConfirm(value);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={busy ? () => {} : () => { setValue(''); setError(''); onClose(); }} title={title} description={description}>
      <div className="space-y-4">
        <Input
          label={password ? 'Your password' : <>Type <span className="font-mono text-fg">{expected}</span> to confirm</>}
          type={password ? 'password' : 'text'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete={password ? 'current-password' : 'off'}
        />
        {error && <p className="text-sm text-down">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={go} disabled={!ready} isLoading={busy}>{confirmLabel}</Button>
        </div>
      </div>
    </Modal>
  );
}

export function SettingsPanel() {
  const { user, workspace, isAdmin, isOwner, updateProfile, changePassword, setWorkspace, apply, deleteAccount, logoutAll } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [name, setName] = useState(user.name);
  const [savingProfile, setSavingProfile] = useState(false);

  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [pwError, setPwError] = useState('');
  const [savingPw, setSavingPw] = useState(false);

  const [ws, setWs] = useState({ name: workspace.name, slug: workspace.slug });
  const [wsError, setWsError] = useState('');
  const [savingWs, setSavingWs] = useState(false);

  const [danger, setDanger] = useState(null); // 'workspace' | 'account' | 'leave'

  const saveProfile = async (e) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await updateProfile({ name: name.trim() });
      toast.success('Profile saved');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async (e) => {
    e.preventDefault();
    setPwError('');
    if (pw.newPassword.length < 10) return setPwError('New password must be at least 10 characters');
    setSavingPw(true);
    try {
      await changePassword(pw);
      setPw({ currentPassword: '', newPassword: '' });
      toast.success('Password changed', { description: 'Other devices have been signed out.' });
    } catch (err) {
      setPwError(err.message);
    } finally {
      setSavingPw(false);
    }
  };

  const saveWorkspace = async (e) => {
    e.preventDefault();
    setWsError('');
    setSavingWs(true);
    try {
      const res = await api.patch('/workspaces/current', { name: ws.name.trim(), slug: ws.slug.trim().toLowerCase() });
      setWorkspace(res.data.workspace);
      toast.success('Workspace updated');
    } catch (err) {
      setWsError(err.message);
    } finally {
      setSavingWs(false);
    }
  };

  const origin = window.location.origin;

  return (
    <div className="space-y-10">
      <div>
        <h2 className="text-xl font-medium tracking-tight">Settings</h2>
        <p className="mt-1 text-sm text-fg-3">Your account, and the {workspace.name} workspace.</p>
      </div>

      <Section title="Profile" description={`Signed in as ${user.email}`}>
        <form onSubmit={saveProfile} className="flex items-end gap-2">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          <Button type="submit" variant="secondary" isLoading={savingProfile} disabled={!name.trim() || name.trim() === user.name}>Save</Button>
        </form>
      </Section>

      <Section title="Password" description="Changing it signs out every other device.">
        <form onSubmit={savePassword} className="space-y-4">
          <PasswordInput
            label="Current password"
            autoComplete="current-password"
            field={{ value: pw.currentPassword, onChange: (e) => setPw((p) => ({ ...p, currentPassword: e.target.value })), name: 'currentPassword' }}
          />
          <PasswordInput
            label="New password"
            hint="min. 10 characters"
            autoComplete="new-password"
            field={{ value: pw.newPassword, onChange: (e) => setPw((p) => ({ ...p, newPassword: e.target.value })), name: 'newPassword' }}
          />
          <StrengthMeter password={pw.newPassword} />
          {pwError && <p className="text-sm text-down">{pwError}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="secondary" isLoading={savingPw} disabled={!pw.currentPassword || !pw.newPassword}>Change password</Button>
            <Button
              type="button"
              variant="ghost"
              onClick={async () => {
                await logoutAll();
                navigate('/auth', { replace: true });
              }}
            >
              Sign out everywhere
            </Button>
          </div>
        </form>
      </Section>

      <Section title="Workspace" description={isAdmin ? 'The name appears on your status page; the address is its public URL.' : 'Only admins and the owner can change these.'}>
        <form onSubmit={saveWorkspace} className="space-y-4">
          <Input label="Workspace name" value={ws.name} onChange={(e) => setWs((w) => ({ ...w, name: e.target.value }))} disabled={!isAdmin} maxLength={80} />
          <div>
            <Input
              label="Status page address"
              value={ws.slug}
              onChange={(e) => setWs((w) => ({ ...w, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
              disabled={!isAdmin}
              maxLength={40}
              className="font-mono text-[13px]"
            />
            <p className="mt-1.5 break-all font-mono text-xs text-fg-3">{origin}/status/<span className="text-fg-2">{ws.slug || '…'}</span></p>
          </div>
          {wsError && <p className="text-sm text-down">{wsError}</p>}
          {isAdmin && (
            <Button type="submit" variant="secondary" isLoading={savingWs} disabled={ws.name === workspace.name && ws.slug === workspace.slug}>
              Save workspace
            </Button>
          )}
        </form>
      </Section>

      <Section title="Danger zone" description="These actions are permanent." danger>
        <div className="space-y-3">
          {isOwner ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-4">
              <div className="text-sm">
                <div>Delete {workspace.name}</div>
                <div className="text-xs text-fg-3">Removes every monitor, incident, channel and member. Payment records are kept.</div>
              </div>
              <Button variant="danger" size="sm" onClick={() => setDanger('workspace')}>Delete workspace</Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-4">
              <div className="text-sm">
                <div>Leave {workspace.name}</div>
                <div className="text-xs text-fg-3">You’ll lose access until someone invites you again.</div>
              </div>
              <Button variant="danger" size="sm" onClick={() => setDanger('leave')}>Leave workspace</Button>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-4">
            <div className="text-sm">
              <div>Delete my account</div>
              <div className="text-xs text-fg-3">Also deletes workspaces you own (only possible when you’re their only member).</div>
            </div>
            <Button variant="danger" size="sm" onClick={() => setDanger('account')}>Delete account</Button>
          </div>
        </div>
      </Section>

      <ConfirmTyping
        isOpen={danger === 'workspace'}
        onClose={() => setDanger(null)}
        title={`Delete ${workspace.name}?`}
        description="This permanently deletes the workspace and all of its data for everyone in it."
        expected={workspace.name}
        confirmLabel="Delete workspace"
        onConfirm={async (confirm) => {
          const res = await api.delete('/workspaces/current', { data: { confirm } });
          apply(res.data);
          setDanger(null);
          toast.success('Workspace deleted');
        }}
      />
      <ConfirmTyping
        isOpen={danger === 'leave'}
        onClose={() => setDanger(null)}
        title={`Leave ${workspace.name}?`}
        description="You can rejoin only with a new invitation."
        expected={workspace.name}
        confirmLabel="Leave workspace"
        onConfirm={async () => {
          const res = await api.delete('/workspaces/current/members/me');
          apply(res.data);
          setDanger(null);
          toast.info(`You left ${workspace.name}`);
        }}
      />
      <ConfirmTyping
        isOpen={danger === 'account'}
        onClose={() => setDanger(null)}
        title="Delete your account?"
        description="Your login and every workspace you solely own will be permanently deleted."
        password
        confirmLabel="Delete my account"
        onConfirm={async (password) => {
          await deleteAccount(password);
          navigate('/', { replace: true });
        }}
      />
    </div>
  );
}
