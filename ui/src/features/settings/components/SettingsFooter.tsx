/**
 * SettingsFooter — the page-bottom chrome strip of the Settings screen: the
 * theme switch, the app-version string, the Ctrl+S hint and the date/clock
 * read-out.
 *
 * Extracted from SettingsPage.tsx by the settings lane's footer slice. The
 * markup moved verbatim from :696-763 of the 780-line page — only the base
 * indentation changed — so it diffs clean against its old lines.
 *
 * PRESENTATIONAL, on purpose. It owns none of the settings draft state: theme,
 * its toggle and the version string are read by the page and handed down. The
 * one thing that moved IN here is the clock, because `useClock`/`getToday` had
 * exactly one consumer — the `settings-footer-date` span (the page derived
 * `today`/`clock` at :249-250 and nothing else read them). Leaving a hook in
 * the page whose only reader lives here would buy a two-prop contract for one
 * span; `numLocale` came along with the same reasoning, from the same
 * `[...l10n.bundles][0]?.locales[0] ?? 'en-US'` expression, unchanged.
 *
 * Registered in screenExtraction.test.ts (SettingsPage entry → additionalTsx)
 * because the `settings-footer-*` classes it renders are styled by
 * settings/SettingsPage.css. Skip that registration and the guard fails
 * SILENTLY in the other direction: the suite still goes green while those six
 * classes read as dead CSS.
 */
import { useEffect, useState } from 'react';

import { Localized, useLocalization } from '@fluent/react';
import type { Theme } from '@/frontend/shell/ThemeProvider';

// ── Clock helper (moved here with its only consumer) ──────────────

function useClock(locale: string): string {
  const [clock, setClock] = useState(() =>
    new Date().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
  );
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined;
    // Align the first tick to the next minute boundary so the clock
    // is accurate from the start rather than drifting by mount time.
    const now = new Date();
    const msUntilNextMinute =
      (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
    const timeout = setTimeout(() => {
      const tick = () =>
        setClock(
          new Date().toLocaleTimeString(locale, {
            hour: '2-digit',
            minute: '2-digit',
          }),
        );
      tick();
      intervalId = setInterval(tick, 60_000);
    }, msUntilNextMinute);
    return () => {
      clearTimeout(timeout);
      if (intervalId) clearInterval(intervalId);
    };
  }, [locale]);
  return clock;
}

/** Return today's formatted date. The date only changes at midnight and
 *  the settings page is not expected to stay open across day boundaries,
 *  so we compute once at mount rather than polling every 60 seconds. */
function getToday(locale: string): string {
  return new Date().toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

interface SettingsFooterProps {
  /** Decides which icon the switch shows and which aria string labels it. */
  theme: Theme;
  onToggleTheme: () => void;
  /** False when no ThemeProvider is mounted above the page. The switch is then
   *  absent from the DOM — the same condition `{themeCtx && …}` gated before
   *  the move, so the page hands down its presence, not a substitute. */
  themeSwitcherAvailable: boolean;
  /** Read from the app by the page's boot effect; never fetched here. */
  appVersion: string;
}

/** Renders the settings page's bottom bar. Owns no settings state. */
export function SettingsFooter({ theme, onToggleTheme, themeSwitcherAvailable, appVersion }: SettingsFooterProps) {
  const { l10n } = useLocalization();
  const numLocale = [...l10n.bundles][0]?.locales[0] ?? 'en-US';
  const clock = useClock(numLocale);
  const today = getToday(numLocale);

  return (
    <footer className="settings-footer">
      <span className="settings-footer-left">
        {themeSwitcherAvailable && (
          <button
            type="button"
            className="settings-footer-theme-toggle"
            onClick={onToggleTheme}
            aria-label={
              theme === 'light'
                ? l10n.getString('settings-theme-toggle-dark-aria')
                : l10n.getString('settings-theme-toggle-light-aria')
            }
          >
            {theme === 'light' ? (
              /* Moon icon (click to go dark) */
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            ) : (
              /* Sun icon (click to go light) */
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            )}
          </button>
        )}
        <Localized id="settings-app-version" vars={{ version: appVersion }}>
          <span>OZ-POS Enterprise v{appVersion}</span>
        </Localized>
      </span>
      <span className="settings-footer-right">
        <span className="settings-footer-shortcut">
          <kbd>Ctrl</kbd>+<kbd>S</kbd>
          <Localized id="settings-btn-save"><span>Save</span></Localized>
        </span>
        <span className="settings-footer-date">
          {today} {clock}
        </span>
      </span>
    </footer>
  );
}
