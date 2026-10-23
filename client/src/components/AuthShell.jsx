import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Logo } from './Logo';
import { LiveTrace } from './landing/LiveTrace';

/** Two-column layout shared by sign-in, sign-up, reset, verification and invitation pages. */
export function AuthShell({ eyebrow, title, subtitle, children, aside }) {
  return (
    <div className="grain grid min-h-[100svh] bg-bg text-fg lg:grid-cols-[1fr_1.05fr]">
      <div className="flex flex-col px-6 py-8 md:px-12">
        <div className="flex items-center justify-between">
          <Link to="/" aria-label="PulseWatch home"><Logo /></Link>
          <Link to="/" className="inline-flex items-center gap-1.5 text-[13px] text-fg-3 transition-colors hover:text-fg">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to site
          </Link>
        </div>

        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-16">
          {eyebrow && <div className="eyebrow mb-5">{eyebrow}</div>}
          <h1 className="text-[2.6rem] font-medium leading-[1] tracking-[-0.045em]">{title}</h1>
          {subtitle && <p className="mb-10 mt-4 text-[15px] leading-relaxed text-fg-2">{subtitle}</p>}
          {!subtitle && <div className="mb-10" />}
          {children}
        </div>
      </div>

      <div className="relative hidden overflow-hidden border-l border-line bg-raised/40 lg:block">
        <div className="absolute inset-x-0 top-[38%] h-[200px]">
          <LiveTrace className="h-full w-full" />
        </div>
        <div className="absolute inset-x-0 bottom-0 p-12">
          {aside || (
            <>
              <blockquote className="max-w-[460px] text-[1.9rem] leading-[1.12] tracking-[-0.03em]">
                “The best alert is the one you <span className="serif-i">never get</span> — because it wasn’t real.”
              </blockquote>
              <div className="mt-6 grid max-w-[460px] grid-cols-3 gap-6 border-t border-line pt-6 font-mono text-[11px] text-fg-3">
                <div><div className="font-serif text-3xl text-fg">3×</div>confirmation</div>
                <div><div className="font-serif text-3xl text-fg">30s</div>checks</div>
                <div><div className="font-serif text-3xl text-fg">4</div>channels</div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function Notice({ tone = 'info', children }) {
  const tones = {
    info: 'border-line-strong bg-raised-2 text-fg-2',
    success: 'border-up/25 bg-up/[0.07] text-up',
    error: 'border-down/30 bg-down/[0.08] text-down',
  };
  return (
    <div className={`rounded-[10px] border px-4 py-3 text-sm leading-relaxed ${tones[tone]}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
