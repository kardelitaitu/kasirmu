/**
 * KdsNoticeBanners — the four stacked notice banners above the KDS board: the
 * dismissible error banner, the local-persistence warning (OFF-08), the
 * dead-letter warning (OFF-05) and the offline/queued banner (3b).
 *
 * Extracted verbatim from KdsScreen.tsx:967-1081 by KDS merged-lane slice 1.
 * The moved block is byte-identical to that range except for five onClick
 * handlers, which became the props carrying the same closures.
 *
 * PRESENTATIONAL ONLY — it owns no state and calls no api. Every gate stayed a
 * read (error &&, storageUnavailable &&, deadLetterLength > 0, and the
 * !online && !offlineDismissed pair), and the two retry closures remained in
 * the screen because they close over sessionToken, retryPending and
 * updateKdsStatusScoped: a presentational component making its own IPC call
 * would break the repo's own api-layer rule, so state ownership did not move.
 *
 * REGISTERED in __tests__/screenExtraction.test.ts under the KdsScreen entry's
 * additionalTsx. The classes used here — kds-error-banner with its text, retry
 * and dismiss buttons, plus kds-offline-banner with its storage and deadletter
 * variants, its text and its retry/dismiss buttons — are styled by
 * kds/KdsScreen.css, which the entry already lists; without that entry the
 * guard would read all ten as dead.
 */
import { Localized, useLocalization } from '@fluent/react';
import { requiredLocalized } from '@/components';

export interface KdsNoticeBannersProps {
  /** Already-localised message; the screen owns it via setError/clearError. */
  error: string | null;
  onRetryError: () => void;
  onDismissError: () => void;
  storageUnavailable: boolean;
  deadLetterLength: number;
  onRetryDeadLetter: () => void;
  onClearDeadLetter: () => void;
  online: boolean;
  offlineDismissed: boolean;
  pendingQueueLength: number;
  onRetryPending: () => void;
  onDismissOffline: () => void;
}

export function KdsNoticeBanners({
  error,
  onRetryError,
  onDismissError,
  storageUnavailable,
  deadLetterLength,
  onRetryDeadLetter,
  onClearDeadLetter,
  online,
  offlineDismissed,
  pendingQueueLength,
  onRetryPending,
  onDismissOffline,
}: KdsNoticeBannersProps) {
  const { l10n } = useLocalization();

  return (
    <>
      {/* ── Error banner (dismissible + retry) ──────────────────── */}
      {error && (
        <div className="kds-error-banner" role="alert">
          <span className="kds-error-banner-text">{error}</span>
          <button
            className="kds-error-retry-btn"
            onClick={onRetryError}
            aria-label={requiredLocalized(l10n, 'kds-error-retry-aria')}
            data-testid="kds-error-retry"
          >
            <Localized id="kds-offline-retry">Retry</Localized>
          </button>
          <button
            className="kds-error-dismiss-btn"
            onClick={onDismissError}
            aria-label={requiredLocalized(l10n, 'kds-error-dismiss-aria')}
            data-testid="kds-error-dismiss"
          >
            &times;
          </button>
        </div>
      )}

      {/* OFF-08: local persistence is unavailable — queued actions are not durable */}
      {storageUnavailable && (
        <div className="kds-offline-banner kds-offline-banner--storage" role="alert">
          <span className="kds-offline-banner-text">
            {requiredLocalized(l10n, 'kds-offline-storage-unavailable')}
          </span>
        </div>
      )}

      {/* OFF-05: actions that exhausted retries and need operator attention */}
      {deadLetterLength > 0 && (
        <div className="kds-offline-banner kds-offline-banner--deadletter" role="alert">
          <span className="kds-offline-banner-text">
            {requiredLocalized(l10n, 'kds-offline-dead-letter', { count: deadLetterLength })}
          </span>
          <button
            className="kds-offline-retry-btn"
            onClick={onRetryDeadLetter}
            aria-label={requiredLocalized(l10n, 'kds-offline-retry-aria')}
            data-testid="kds-deadletter-retry"
          >
            <Localized id="kds-offline-retry">Retry</Localized>
          </button>
          <button
            className="kds-offline-dismiss-btn"
            onClick={onClearDeadLetter}
            aria-label={requiredLocalized(l10n, 'kds-offline-dead-letter-clear-aria')}
            data-testid="kds-deadletter-dismiss"
          >
            &times;
          </button>
        </div>
      )}

      {/* 3b: Offline banner — shown when backend is unreachable or actions are queued */}
      {!online && !offlineDismissed && (
        <div className="kds-offline-banner" role="alert">
          <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true">
            <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-.47.81c-.54.5-1.1 1.36-1.1 2.52V8l4.89-4.89c-.04-.26-.14-.52-.34-.73zM5.99 5.58l-2.84 2.84a1.532 1.532 0 000 2.16l7.29 7.29c.39.39 1.02.39 1.41 0l2.84-2.84-5.99-5.99-2.71-2.76v.3zm10.02 2.46l2.13 2.13a1.532 1.532 0 010 2.16l-2.13 2.13a.5.5 0 01-.71-.71l2.13-2.13a.532.532 0 000-.75l-2.13-2.13a.5.5 0 01.71-.71zm-5.02 5.32a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5z" clipRule="evenodd" />
          </svg>
          <span className="kds-offline-banner-text">
            {pendingQueueLength > 0
              ? requiredLocalized(l10n, 'kds-offline-queued', { count: pendingQueueLength })
              : requiredLocalized(l10n, 'kds-offline-label')}
          </span>
          {pendingQueueLength > 0 && (
            <button
              className="kds-offline-retry-btn"
              onClick={onRetryPending}
              aria-label={requiredLocalized(l10n, 'kds-offline-retry-aria')}
              data-testid="kds-offline-retry"
            >
              <Localized id="kds-offline-retry">Retry</Localized>
            </button>
          )}
          <button
            className="kds-offline-dismiss-btn"
            onClick={onDismissOffline}
            aria-label={requiredLocalized(l10n, 'kds-offline-dismiss-aria')}
            data-testid="kds-offline-dismiss"
          >
            &times;
          </button>
        </div>
      )}
    </>
  );
}
