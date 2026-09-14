/**
 * SettingsLoadChrome - the two pre-shell renders of the Settings page: the
 * initial-load skeleton and the fatal-load error card with its Retry button.
 *
 * Extracted from SettingsPage.tsx by the settings lane's load-chrome slice.
 * Both blocks moved verbatim - the skeleton guard at :376-419 and the error
 * guard at :421-432 of the 498-line page, with only base indentation changed
 * (the page held them inside an "if (...) return (...)" guard, so the JSX root
 * loses two spaces here) - so each diffs clean against its old lines. Nothing
 * here is a rewrite: the topbar mock, the three Skeleton cards and the
 * role="alert" error box are what the page rendered before.
 *
 * PRESENTATIONAL, on purpose - and deliberately near-prop-less:
 *   - the skeleton reads NOTHING. No props, no context, no hooks: it is a
 *     static mock of the topbar grid (five columns, COL 2 carrying the gear
 *     glyph and the settings-title span) plus three placeholder cards, and
 *     every value the real shell renders is absent by design. That is why this
 *     is the cheapest seam on the page - what the page keeps is the "loading"
 *     derivation, not any data.
 *   - the error card takes TWO props, no more. errorId is the Fluent key
 *     SettingsContext stores on failure, resolved through this file's own
 *     useLocalization, so the card owns its string lookup the way the topbar
 *     and footer slices came to own theirs. onRetry is a page-side CALLBACK
 *     rather than a moved handler, and that is the one judgement call here:
 *     the original onClick was a two-statement arrow - setInitialized(false)
 *     then settingsCtx.refetch() - and setInitialized is the page's
 *     draft-initialization flag, the same state the init effect (:221-263)
 *     uses to seed the local editable copy exactly once. The alternatives were
 *     a setter prop or a resetDraft callback, both of which drag page state
 *     across the seam to save one prop, and a refetch that does not also
 *     un-initialize the page retries into a card that can never leave. So the
 *     setter stays put and the card is handed a closure; this component never
 *     learns the flag exists.
 *
 * Registered in screenExtraction.test.ts (SettingsPage entry -> additionalTsx)
 * because settings-loading, settings-loading-card, settings-error and the
 * settings-topbar* / settings-body classes it renders are all styled by
 * settings/SettingsPage.css. Skip that registration and the guard goes red on
 * the dead-class check for exactly those names: this slice MOVES markup out of
 * the scanned file, so the registration is what keeps them reachable. It is
 * also where the four classes SettingsTopbar.tsx's header note (:47-49) says
 * survive only because the page's skeleton renders them come to rest - they
 * are rendered here, which is registered, so they stay alive for the right
 * reason instead of because the page happens to hold a second copy.
 */
import { Localized, useLocalization } from '@fluent/react';
import { Button } from '@/components/Button';
import { Skeleton } from '@/components/Skeleton';

/** The initial-fetch skeleton: the page shell, an empty topbar grid and three
 *  placeholder cards, shown until SettingsContext's first load resolves. */
export function SettingsLoadingChrome() {
  return (
    <div className="settings-page">
      <header className="settings-topbar">
        {/* COL 1: mobile menu — empty in skeleton */}
        <div className="settings-topbar__col" />
        {/* COL 2: branding */}
        <div className="settings-topbar__col settings-topbar__col--brand">
          <div className="settings-topbar-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </div>
          <span className="settings-topbar-name"><Localized id="settings-title">Settings</Localized></span>
        </div>
        {/* COL 3–5: empty in skeleton */}
        <div className="settings-topbar__col settings-topbar__col--search" />
        <div className="settings-topbar__col" />
        <div className="settings-topbar__col settings-topbar__col--actions" />
      </header>
      <div className="settings-body">
        <div className="settings-loading">
          <div className="settings-loading-card">
            <Skeleton variant="block" width="40%" height="1.5rem" />
            <Skeleton variant="text" width="100%" />
            <Skeleton variant="text" width="100%" />
            <Skeleton variant="text" width="60%" />
          </div>
          <div className="settings-loading-card">
            <Skeleton variant="block" width="35%" height="1.5rem" />
            <Skeleton variant="text" width="100%" />
            <Skeleton variant="text" width="80%" />
          </div>
          <div className="settings-loading-card">
            <Skeleton variant="block" width="30%" height="1.5rem" />
            <Skeleton variant="text" width="100%" />
            <Skeleton variant="text" width="50%" />
          </div>
        </div>
      </div>
    </div>
  );
}

interface SettingsLoadErrorProps {
  /** Fluent key of the load failure, exactly as SettingsContext stores it. */
  errorId: string;
  /** Retry: re-arm the page's draft-initialization flag, then refetch. Owned
   *  by the page, because the flag it clears is page state. */
  onRetry: () => void;
}

/** Fatal-load card: the localized reason plus a Retry that re-runs the fetch. */
export function SettingsLoadError({ errorId, onRetry }: SettingsLoadErrorProps) {
  const { l10n } = useLocalization();
  return (
    <div className="settings-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="settings-error" role="alert">
        <p>{l10n.getString(errorId)}</p>
        <Button variant="secondary" onClick={onRetry}>
          <Localized id="settings-retry"><span>Retry</span></Localized>
        </Button>
      </div>
    </div>
  );
}
