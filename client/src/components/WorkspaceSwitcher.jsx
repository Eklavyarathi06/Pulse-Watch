import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { cn, Button } from './Button';
import { Input } from './Input';
import { Modal } from './Drawer';
import { useToast } from './Toast';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';

const PLAN_LABEL = { free: 'Hobby', pro: 'Pro', team: 'Team' };

export function WorkspaceSwitcher() {
  const { workspace, workspaces, switchWorkspace, createWorkspace, needsVerification } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  if (!workspace) return null;

  const pick = async (id) => {
    setOpen(false);
    if (id === workspace._id) return;
    try {
      const data = await switchWorkspace(id);
      toast.info(`Switched to ${data.workspace.name}`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await createWorkspace(name.trim());
      toast.success(`${data.workspace.name} created`);
      setCreating(false);
      setName('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-[220px] items-center gap-2 rounded-lg border border-line-strong px-2.5 py-1.5 text-left transition-colors hover:border-fg-3"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-fg font-mono text-[10px] font-semibold text-bg">
          {workspace.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] leading-tight">{workspace.name}</span>
          <span className="block font-mono text-[9px] uppercase tracking-wider text-fg-3">{PLAN_LABEL[workspace.plan]} · {workspace.role}</span>
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-fg-3" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-2 w-72 overflow-hidden rounded-xl border border-line-strong bg-raised-2 shadow-2xl" role="listbox">
          <div className="max-h-72 overflow-y-auto p-1.5">
            {workspaces.map((w) => (
              <button
                key={w._id}
                role="option"
                aria-selected={w._id === workspace._id}
                onClick={() => pick(w._id)}
                className={cn('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-raised-3', w._id === workspace._id && 'bg-raised-3')}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-raised font-mono text-[11px]">{w.name.slice(0, 1).toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">{w.name}</span>
                  <span className="block font-mono text-[10px] text-fg-3">{PLAN_LABEL[w.plan]} · {w.role}</span>
                </span>
                {w._id === workspace._id && <Check className="h-4 w-4 text-fg-2" />}
              </button>
            ))}
          </div>
          <button
            onClick={() => { setOpen(false); setCreating(true); }}
            disabled={needsVerification}
            className="flex w-full items-center gap-2 border-t border-line px-4 py-2.5 text-[13px] text-fg-2 transition-colors hover:bg-raised-3 hover:text-fg disabled:opacity-40"
          >
            <Plus className="h-4 w-4" /> New workspace
          </button>
        </div>
      )}

      <Modal isOpen={creating} onClose={() => setCreating(false)} title="New workspace" description="A separate company or team, with its own monitors, members, billing and status page.">
        <form onSubmit={create} className="space-y-4">
          <Input label="Name" placeholder="Acme Inc." value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80} />
          {error && <p className="text-sm text-down">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            <Button type="submit" isLoading={busy} disabled={name.trim().length < 2}>Create workspace</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export function VerifyBanner() {
  const { user, needsVerification } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!needsVerification) return null;

  const resend = async () => {
    setBusy(true);
    try {
      await api.post('/auth/resend-verification');
      toast.success('Verification email sent', { description: `Check ${user.email}` });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-b border-warn/25 bg-warn/[0.07]">
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-[13px] md:px-8">
        <span className="text-warn">
          Confirm <span className="font-medium">{user.email}</span> to create monitors, alert channels and invites — we sent you a link.
        </span>
        <button onClick={resend} disabled={busy} className="font-medium text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg disabled:opacity-50">
          {busy ? 'Sending…' : 'Resend email'}
        </button>
      </div>
    </div>
  );
}
