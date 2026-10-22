import React, { forwardRef } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

const variants = {
  primary: 'bg-fg text-bg hover:bg-white active:scale-[0.98]',
  secondary: 'bg-raised-2 text-fg border border-line-strong hover:border-fg-3 hover:bg-raised-3',
  ghost: 'text-fg-2 hover:text-fg hover:bg-raised-2',
  outline: 'border border-line-strong text-fg hover:border-fg hover:bg-raised-2',
  danger: 'bg-down/10 text-down border border-down/30 hover:bg-down/20',
};

const sizes = {
  xs: 'text-xs h-7 px-2.5 gap-1.5 rounded-md',
  sm: 'text-[13px] h-8 px-3 gap-1.5 rounded-lg',
  md: 'text-sm h-10 px-4 gap-2 rounded-[10px]',
  lg: 'text-[15px] h-12 px-6 gap-2 rounded-xl',
  icon: 'h-8 w-8 rounded-lg',
};

export const Button = forwardRef(({ className, variant = 'primary', size = 'md', isLoading, children, disabled, ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      'relative inline-flex items-center justify-center font-medium whitespace-nowrap select-none',
      'transition-[background-color,border-color,color,transform] duration-200 ease-out-expo',
      'disabled:opacity-45 disabled:pointer-events-none',
      variants[variant],
      sizes[size],
      className
    )}
    disabled={isLoading || disabled}
    aria-busy={isLoading || undefined}
    {...props}
  >
    {isLoading && (
      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" aria-hidden="true" />
    )}
    {children}
  </button>
));
Button.displayName = 'Button';
