import React, { useCallback, useEffect, useState } from 'react';
import { UserPlus, Mail, RotateCw, X, Crown, Copy } from 'lucide-react';
import { Button, cn } from './Button';
import { Input, Segmented } from './Input';
import { Modal } from './Drawer';
import { useToast } from './Toast';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import { fmtRelative } from '../utils/format';

const ROLE_HELP = {
  owner: 'Everything, including billing and deleting the workspace',
  admin: 'Manage monitors, alert channels and members',
  member: 'View everything; create, edit, pause and check monitors',
};

const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';

function InviteModal({ isOpen, onClose, onInvited, canInviteAdmin }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const toast = useToast();

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/workspaces/current/invites', { email: email.trim(), role });
      setResult(res.data);
      onInvited();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setEmail('');
    setRole('member');
    setError('');
    setResult(null);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={close} title="Invite a teammate" description="They’ll get an email with a link to join this workspace. Links expire in 7 days.">
      {result ? (
        <div className="space-y-4">
          <div className={cn('rounded-[10px] border px-3 py-2.5 text-[13px]', result.emailSent ? 'border-up/25 bg-up/[0.06] text-up' : 'border-warn/30 bg-warn/[0.06] text-warn')}>
            {result.emailSent ? `Invitation emailed to ${result.invitation.email}.` : 'The email could not be sent (check SMTP settings). Share this link instead:'}
          </div>
          <div className="flex items-center gap-2 rounded-[10px] border border-line-strong bg-bg p-1.5 pl-3">
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-2">{result.inviteUrl}</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(result.inviteUrl);
                  toast.success('Invite link copied');
                } catch {
                  toast.error('Clipboard unavailable');
                }
              }}
            >
              <Copy className="h-3.5 w-3.5" /> Copy
            </Button>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setResult(null)}>Invite another</Button>
            <Button onClick={close}>Done</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <Input label="Email" type="email" placeholder="teammate@company.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
          <div>
            <div className="mb-2 text-[13px] font-medium text-fg-2">Role</div>
            <Segmented
              ariaLabel="Role"
              value={role}
              onChange={setRole}
              options={[
                { value: 'member', label: 'Member' },
                { value: 'admin', label: 'Admin', disabled: !canInviteAdmin, title: canInviteAdmin ? undefined : 'Only the owner can invite admins' },
              ]}
            />
            <p className="mt-2 text-xs text-fg-3">{ROLE_HELP[role]}</p>
          </div>
          {error && <p className="rounded-[10px] border border-down/30 bg-down/[0.07] px-3 py-2 text-[13px] text-down">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
            <Button type="submit" isLoading={busy}><Mail className="h-4 w-4" /> Send invitation</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function TeamPanel({ onRequestConfirm }) {
  const { user, workspace, isAdmin, isOwner, apply, needsVerification } = useAuth();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/workspaces/current/members');
      setData(res.data);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const changeRole = async (m, role) => {
    try {
      await api.patch(`/workspaces/current/members/${m.userId}`, { role });
      toast.success(`${m.name} is now ${role === 'admin' ? 'an admin' : 'a member'}`);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const remove = (m) =>
    onRequestConfirm({
      title: `Remove ${m.name}?`,
      description: `${m.email} will lose access to ${workspace.name} immediately. Their monitors stay with the workspace.`,
      confirmLabel: 'Remove member',
      onConfirm: async () => {
        await api.delete(`/workspaces/current/members/${m.userId}`);
        toast.success(`${m.name} removed`);
        load();
      },
    });

  const transfer = (m) =>
    onRequestConfirm({
      title: `Make ${m.name} the owner?`,
      description: 'They will control billing and can delete the workspace. You’ll become an admin. This can only be undone by them.',
      confirmLabel: 'Transfer ownership',
      onConfirm: async () => {
        const res = await api.post('/workspaces/current/transfer', { userId: m.userId });
        apply(res.data);
        toast.success(`${m.name} now owns ${workspace.name}`);
        load();
      },
    });

  const resend = async (inv) => {
    try {
      const res = await api.post(`/workspaces/current/invites/${inv._id}/resend`);
      toast.success(res.data.emailSent ? `Invitation re-sent to ${inv.email}` : 'New link created — email not sent, copy it from a fresh invite');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const revoke = async (inv) => {
    try {
      await api.delete(`/workspaces/current/invites/${inv._id}`);
      toast.info(`Invitation for ${inv.email} revoked`);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const used = (data?.members.length || 0) + (data?.invitations.filter((i) => !i.expired).length || 0);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-medium tracking-tight">Team</h2>
          <p className="mt-1 text-sm text-fg-3">
            Everyone here shares {workspace?.name}’s monitors, incidents and status page.
            {data && <span className="ml-1 font-mono text-xs">{used}/{data.limit} seats</span>}
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => setInviting(true)} disabled={needsVerification} title={needsVerification ? 'Confirm your email first' : undefined}>
            <UserPlus className="h-4 w-4" /> Invite
          </Button>
        )}
      </div>

      {error && <div className="mb-4 rounded-[10px] border border-down/30 bg-down/[0.07] px-4 py-3 text-sm text-down">{error}</div>}

      {!data ? (
        <div className="skeleton h-40 rounded-[14px]" />
      ) : (
        <div className="space-y-8">
          <ul className="panel divide-y divide-line">
            {data.members.map((m) => {
              const me = m.userId === user._id;
              return (
                <li key={m.userId} className="flex flex-wrap items-center gap-4 px-5 py-4">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line-strong bg-raised-2 font-mono text-xs">{initials(m.name)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{m.name}</span>
                      {me && <span className="font-mono text-[10px] uppercase tracking-wider text-fg-3">you</span>}
                    </div>
                    <div className="truncate text-[13px] text-fg-3">{m.email} · active {fmtRelative(m.lastLoginAt)}</div>
                  </div>
                  {m.role === 'owner' ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-fg-2">
                      <Crown className="h-3 w-3" /> Owner
                    </span>
                  ) : isOwner && !me ? (
                    <select
                      value={m.role}
                      onChange={(e) => changeRole(m, e.target.value)}
                      className="h-8 rounded-lg border border-line-strong bg-bg px-2 text-[13px] text-fg focus:border-fg focus:outline-none"
                      aria-label={`Role for ${m.name}`}
                    >
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                    </select>
                  ) : (
                    <span className="rounded-full border border-line-strong px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-fg-2">{m.role}</span>
                  )}
                  {!me && m.role !== 'owner' && (
                    <div className="flex gap-1">
                      {isOwner && <Button size="sm" variant="ghost" onClick={() => transfer(m)} title="Make owner"><Crown className="h-3.5 w-3.5" /></Button>}
                      {(isOwner || (isAdmin && m.role === 'member')) && (
                        <Button size="sm" variant="ghost" className="text-fg-3 hover:text-down" onClick={() => remove(m)} aria-label={`Remove ${m.name}`}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {isAdmin && data.invitations.length > 0 && (
            <div>
              <h3 className="eyebrow mb-3">Pending invitations</h3>
              <ul className="panel divide-y divide-line">
                {data.invitations.map((inv) => (
                  <li key={inv._id} className="flex flex-wrap items-center gap-4 px-5 py-3.5">
                    <Mail className="h-4 w-4 text-fg-3" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{inv.email}</div>
                      <div className={cn('text-xs', inv.expired ? 'text-warn' : 'text-fg-3')}>
                        {inv.role} · {inv.expired ? 'expired' : `expires ${fmtRelative(inv.expiresAt)}`}
                      </div>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => resend(inv)}><RotateCw className="h-3.5 w-3.5" /> Resend</Button>
                    <Button size="sm" variant="ghost" className="text-fg-3 hover:text-down" onClick={() => revoke(inv)} aria-label={`Revoke invitation for ${inv.email}`}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            {Object.entries(ROLE_HELP).map(([role, help]) => (
              <div key={role} className="rounded-xl border border-line px-4 py-3">
                <div className="font-mono text-[10px] uppercase tracking-wider text-fg-2">{role}</div>
                <div className="mt-1 text-xs leading-relaxed text-fg-3">{help}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <InviteModal isOpen={inviting} onClose={() => setInviting(false)} onInvited={load} canInviteAdmin={isOwner} />
    </div>
  );
}
