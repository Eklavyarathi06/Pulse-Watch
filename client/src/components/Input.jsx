import React, { forwardRef, useId } from 'react';
import { cn } from './Button';

export function Field({ label, hint, error, htmlFor, children, className }) {
  return (
    <div className={cn('w-full', className)}>
      {label && (
        <label htmlFor={htmlFor} className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px] font-medium text-fg-2">
          <span>{label}</span>
          {hint && <span className="font-mono text-[11px] font-normal text-fg-3">{hint}</span>}
        </label>
      )}
      {children}
      {error && (
        <p className="mt-1.5 text-xs text-down" role="alert">{error}</p>
      )}
    </div>
  );
}

export const Input = forwardRef(({ className, error, label, hint, id, ...props }, ref) => {
  const autoId = useId();
  const inputId = id || autoId;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId}>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? 'true' : undefined}
        className={cn('field', className)}
        {...props}
      />
    </Field>
  );
});
Input.displayName = 'Input';

export const Textarea = forwardRef(({ className, error, label, hint, id, ...props }, ref) => {
  const autoId = useId();
  const inputId = id || autoId;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId}>
      <textarea
        ref={ref}
        id={inputId}
        aria-invalid={error ? 'true' : undefined}
        className={cn('field min-h-[96px] resize-y font-mono text-[13px] leading-relaxed', className)}
        {...props}
      />
    </Field>
  );
});
Textarea.displayName = 'Textarea';

/** Segmented control — used for intervals, methods, tabs. */
export function Segmented({ options, value, onChange, className, size = 'md', ariaLabel }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn('inline-flex w-full rounded-[10px] border border-line-strong bg-bg p-1', className)}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={opt.disabled}
            title={opt.title}
            onClick={() => onChange(opt.value)}
            className={cn(
              'flex-1 rounded-[7px] font-mono transition-colors duration-200',
              size === 'sm' ? 'h-7 text-[11px]' : 'h-8 text-xs',
              active ? 'bg-fg text-bg' : 'text-fg-2 hover:text-fg hover:bg-raised-2',
              opt.disabled && 'opacity-35'
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-300',
        checked ? 'border-up/40 bg-up/25' : 'border-line-strong bg-raised-3',
        disabled && 'opacity-40'
      )}
    >
      <span
        className={cn(
          'inline-block h-3.5 w-3.5 rounded-full transition-transform duration-300 ease-out-expo',
          checked ? 'translate-x-[18px] bg-up' : 'translate-x-[2px] bg-fg-2'
        )}
      />
    </button>
  );
}
