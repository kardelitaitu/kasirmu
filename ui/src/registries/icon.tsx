import { Children, type ReactNode } from 'react';

/**
 * SVG icon helper for menu registry registration.
 */
export function icon(path: string, ...children: ReactNode[]) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
      {Children.toArray(children)}
    </svg>
  );
}
