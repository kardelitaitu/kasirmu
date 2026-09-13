//! Session-expired recovery banner — replaces the wall of per-card
//! "session has expired" errors with one actionable notice. Extracted
//! verbatim from `AnalyticsScreen.tsx` (JSX-shell split, slice 1): a
//! single-action state, zero screen coupling beyond the navigation prop.

import { Localized, useLocalization } from '@fluent/react';

export function SessionRecoveryBanner({ onSignInAgain }: { onSignInAgain: () => void }) {
  const { l10n } = useLocalization();
  return (
    <div
      className="analytics-session-banner"
      role="alert"
      data-testid="analytics-session-banner"
    >
      <svg
        className="analytics-session-banner-icon"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <div className="analytics-session-banner-body">
        <div className="analytics-session-banner-title">
          <Localized id="analytics-session-expired-title"><span>Session expired</span></Localized>
        </div>
        <div className="analytics-session-banner-message">
          <Localized id="analytics-session-expired-message"><span>Your session has expired. Sign in again.</span></Localized>
        </div>
      </div>
      <button
        type="button"
        className="analytics-session-banner-action"
        onClick={onSignInAgain}
        aria-label={l10n.getString('analytics-sign-in-again')}
      >
        <Localized id="analytics-sign-in-again"><span>Sign in again</span></Localized>
      </button>
    </div>
  );
}
