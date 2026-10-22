import React from 'react';
import { cn } from './Button';

const CONFIG = {
  UP: { label: 'Operational', text: 'text-up', dot: 'bg-up', ring: 'border-up/25 bg-up/[0.07]', pulse: true },
  DOWN: { label: 'Down', text: 'text-down', dot: 'bg-down', ring: 'border-down/30 bg-down/[0.08]', pulse: true },
  PAUSED: { label: 'Paused', text: 'text-paused', dot: 'bg-paused', ring: 'border-line-strong bg-raised-2', pulse: false },
  PENDING: { label: 'Checking', text: 'text-warn', dot: 'bg-warn', ring: 'border-warn/25 bg-warn/[0.07]', pulse: true },
};

export function StatusDot({ status, className, size = 8 }) {
  const c = CONFIG[status] || CONFIG.PENDING;
  return (
    <span className={cn('relative inline-flex shrink-0', className)} style={{ width: size, height: size }} aria-hidden="true">
      {c.pulse && <span className={cn('absolute inset-0 rounded-full animate-ping-slow', c.dot)} />}
      <span className={cn('relative inline-flex rounded-full', c.dot)} style={{ width: size, height: size }} />
    </span>
  );
}

export function StatusPill({ status, className, label }) {
  const c = CONFIG[status] || CONFIG.PENDING;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-2.5 py-[3px] font-mono text-[11px] font-medium tracking-wide',
        c.ring,
        c.text,
        className
      )}
      role="status"
      aria-label={`Status: ${label || c.label}`}
    >
      <StatusDot status={status} size={6} />
      {label || c.label}
    </span>
  );
}

/** Small UP/DOWN tag for check logs. */
export function CheckTag({ status }) {
  const up = status === 'UP';
  return (
    <span className={cn('inline-flex w-12 justify-center rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider', up ? 'bg-up/10 text-up' : 'bg-down/10 text-down')}>
      {status}
    </span>
  );
}
