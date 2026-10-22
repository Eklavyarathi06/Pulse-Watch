import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from './Button';

// Shared lock so nested overlays (drawer + confirm dialog) restore scrolling correctly.
let openOverlays = 0;
const lockScroll = () => {
  openOverlays += 1;
  document.documentElement.style.overflow = 'hidden';
};
const unlockScroll = () => {
  openOverlays = Math.max(0, openOverlays - 1);
  if (openOverlays === 0) document.documentElement.style.overflow = '';
};

/** Keeps the overlay mounted long enough to play its exit transition. */
function usePresence(isOpen, ms = 420) {
  const [mounted, setMounted] = useState(isOpen);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
      return () => cancelAnimationFrame(id);
    }
    setVisible(false);
    const t = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(t);
  }, [isOpen, ms]);
  return { mounted, visible };
}

function useOverlayBehaviour(isOpen, onClose, panelRef) {
  // Ref so a new inline onClose each render doesn't re-run the effect (which would steal focus).
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!isOpen) return undefined;
    lockScroll();
    const previouslyFocused = document.activeElement;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current?.();
      }
      // Simple focus trap
      if (e.key === 'Tab' && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => panelRef.current?.focus(), 50);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      unlockScroll();
      if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
    };
  }, [isOpen, panelRef]);
}

export function Drawer({ isOpen, onClose, title, subtitle, children, width = 'md', footer, headerExtra }) {
  const panelRef = useRef(null);
  const { mounted, visible } = usePresence(isOpen);
  useOverlayBehaviour(isOpen, onClose, panelRef);

  if (!mounted) return null;

  const widths = { md: 'max-w-[520px]', lg: 'max-w-[760px]', xl: 'max-w-[980px]' };

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end" data-lenis-prevent>
      <div
        className={cn('absolute inset-0 bg-black/60 backdrop-blur-[2px] transition-opacity duration-500', visible ? 'opacity-100' : 'opacity-0')}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className={cn(
          'relative flex h-full w-full flex-col border-l border-line-strong bg-raised outline-none',
          'shadow-[-40px_0_80px_-20px_rgba(0,0,0,0.6)] transition-transform duration-[420ms] ease-out-expo',
          widths[width],
          visible ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-medium tracking-tight">{title}</h2>
            {subtitle && <div className="mt-0.5 truncate text-[13px] text-fg-3">{subtitle}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {headerExtra}
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-fg-3 transition-colors hover:bg-raised-2 hover:text-fg"
              aria-label="Close panel"
            >
              <X className="h-[18px] w-[18px]" />
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-6">{children}</div>
        {footer && <footer className="border-t border-line px-6 py-4">{footer}</footer>}
      </div>
    </div>,
    document.body
  );
}

export function Modal({ isOpen, onClose, title, description, children, className }) {
  const panelRef = useRef(null);
  const { mounted, visible } = usePresence(isOpen, 300);
  useOverlayBehaviour(isOpen, onClose, panelRef);

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-4 sm:items-center" data-lenis-prevent>
      <div
        className={cn('absolute inset-0 bg-black/70 backdrop-blur-[2px] transition-opacity duration-300', visible ? 'opacity-100' : 'opacity-0')}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'panel relative max-h-[90vh] w-full max-w-md overflow-y-auto p-6 outline-none',
          'shadow-[0_40px_120px_-20px_rgba(0,0,0,0.8)] transition-[opacity,transform] duration-300 ease-out-expo',
          visible ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-3 scale-[0.98] opacity-0',
          className
        )}
      >
        {title && <h2 className="text-lg font-medium tracking-tight">{title}</h2>}
        {description && <p className="mt-1.5 text-sm leading-relaxed text-fg-2">{description}</p>}
        <div className={title || description ? 'mt-5' : ''}>{children}</div>
      </div>
    </div>,
    document.body
  );
}
