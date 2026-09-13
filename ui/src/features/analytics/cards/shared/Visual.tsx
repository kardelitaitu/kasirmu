//! The visual wrapper every analytics card runs on. Real backend data
//! only — there is no demo-data path left.

import { type ReactNode } from 'react';

/**
 * Wrapper that hosts the card content. Every card runs on real backend
 * data — there is no demo-data path left.
 */
export function Visual({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`analytics-card-visual${className ? ` ${className}` : ''}`}>
      {children}
    </div>
  );
}
