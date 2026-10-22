import React from 'react';
import { cn } from './Button';

export function LogoMark({ className, live = true }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('h-7 w-7', className)} aria-hidden="true">
      <rect x="1" y="1" width="62" height="62" rx="15" fill="none" stroke="currentColor" strokeOpacity=".22" strokeWidth="2" />
      <path d="M10 34h12l4-10 7 22 6-30 5 18h10" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      {live && <circle cx="54" cy="34" r="4" fill="var(--color-up)" />}
    </svg>
  );
}

export function Logo({ className }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5 text-fg', className)}>
      <LogoMark />
      <span className="text-[17px] font-semibold tracking-[-0.03em]">PulseWatch</span>
    </span>
  );
}
