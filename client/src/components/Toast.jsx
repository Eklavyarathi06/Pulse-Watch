import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from './Button';

const ToastContext = createContext(null);

const ICONS = { success: Check, error: AlertTriangle, info: Info };
const TONES = { success: 'text-up', error: 'text-down', info: 'text-fg-2' };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const push = useCallback((type, message, opts = {}) => {
    const id = ++idRef.current;
    setToasts((t) => [...t.slice(-3), { id, type, message, description: opts.description }]);
    setTimeout(() => dismiss(id), opts.duration ?? (type === 'error' ? 6000 : 3500));
    return id;
  }, [dismiss]);

  const api = useMemo(() => ({
    success: (m, o) => push('success', m, o),
    error: (m, o) => push('error', m, o),
    info: (m, o) => push('info', m, o),
  }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
          {toasts.map((t) => {
            const Icon = ICONS[t.type];
            return (
              <div key={t.id} className="pointer-events-auto flex items-start gap-3 rounded-xl border border-line-strong bg-raised-2/95 px-4 py-3 shadow-2xl backdrop-blur-md">
                <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', TONES[t.type])} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-fg">{t.message}</p>
                  {t.description && <p className="mt-0.5 text-xs text-fg-3">{t.description}</p>}
                </div>
                <button onClick={() => dismiss(t.id)} className="text-fg-3 hover:text-fg" aria-label="Dismiss">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
};
