//! The three non-content card states: loading skeleton, localized error,
//! and muted empty placeholder.

import { useLocalization } from '@fluent/react';
import { l10nErrorMessage } from '@/utils/app-error';

/** Shown while a real-data card's IPC query is still in flight. */
export function CardLoading() {
  return (
    <div className="analytics-card-skeleton">
      <div className="skeleton-bar skeleton-bar--sm" />
      <div className="skeleton-bar skeleton-bar--lg" />
      <div className="skeleton-bar skeleton-bar--md" />
    </div>
  );
}

/**
 * Shown when a card's IPC query failed.
 *
 * The query layer records the failure and does NOT re-invoke the fetcher
 * on re-render, so this is a stable state — the screen's refresh action
 * clears the recorded failure and retries. Only the localized user-safe
 * copy is rendered (ERR-05), never the raw backend message.
 */
export function CardError({ error }: { error: unknown }) {
  const { l10n } = useLocalization();
  const message = l10nErrorMessage(error, l10n, 'analytics-card-error-load');
  return (
    <div className="analytics-card-error" role="alert">
      <span className="analytics-card-error-icon" aria-hidden="true">⚠</span>
      <span className="analytics-card-error-text">{message}</span>
    </div>
  );
}

/** Muted "no data" placeholder for a card whose query returned zero rows. */
export function CardEmpty({ message }: { message: string }) {
  return (
    <div className="analytics-card-empty" role="status">
      {message}
    </div>
  );
}
