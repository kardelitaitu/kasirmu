import type { ReactNode } from 'react';
import './LoadingStatus.css';

/** Props for the accessible loading wrapper. */
export interface LoadingStatusProps {
  /** Localized status text announced to screen readers (and shown). */
  label: string;
  /** Decorative visual content (skeletons, spinners) — hidden from AT. */
  children?: ReactNode;
  /** Marks the region busy — use `true` for refreshes over existing data. */
  busy?: boolean;
  /** Optional extra className (e.g. the screen's own loading container). */
  className?: string;
}

/**
 * Shared accessible loading wrapper (LOAD-05).
 *
 * Wraps decorative skeletons/spinners in a `role="status"` region with a
 * localized, value-bearing status label and optional `aria-busy`. The
 * visual children are kept `aria-hidden` so screen readers hear exactly
 * one announcement instead of raw skeleton markup.
 *
 * Use it for:
 *   - initial loads (full skeleton, `busy={false}`)
 *   - refreshes over existing data (`busy={true}`, existing content stays)
 *   - modal/list loaders that previously rendered plain text
 */
export function LoadingStatus({
  label,
  children,
  busy = false,
  className,
}: LoadingStatusProps) {
  return (
    <div
      className={className ? `loading-status ${className}` : 'loading-status'}
      role="status"
      aria-live="polite"
      aria-busy={busy}
    >
      <span className="loading-status__label">{label}</span>
      {children && (
        <div className="loading-status__visual" aria-hidden="true">
          {children}
        </div>
      )}
    </div>
  );
}
