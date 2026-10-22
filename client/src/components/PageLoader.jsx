import React from 'react';

export function PageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-line-strong border-t-fg" aria-label="Loading" />
    </div>
  );
}
