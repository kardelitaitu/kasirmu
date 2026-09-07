import { useState, useEffect, useCallback, useRef } from 'react';
import { requiredLocalized } from '@/frontend/shared';
import { useAuth } from '@/contexts/AuthContext';
import StatusBar from '@/components/StatusBar';
import { staffLogin } from '@/api/staff';
import { getVersion } from '@/api/system';
import { Localized, useLocalization } from '@fluent/react';
import './SessionLockScreen.css';

const MAX_PIN_LENGTH = 4;
const MAX_PIN_ATTEMPTS = 5;
/** Fallback lockout when the server doesn't return a retry-after value. */
const FALLBACK_LOCKOUT_MS = 30_000;

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

/**
 * Session lock screen — shown after idle timeout.
 * The current time and date sit in a header above the card, the lock
 * state is a badge on the card corner, and the card itself is a clone of
 * the StaffLoginScreen PIN step so the keypad does not move between the
 * two. On successful PIN match, calls `onUnlock`. On failure, shows error.
 */
export default function SessionLockScreen({
  onUnlock,
}: {
  onUnlock: () => void;
}) {
  const { session } = useAuth();
  const { l10n } = useLocalization();
  const [pin, setPin] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [time, setTime] = useState(new Date());
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [pinAttempts, setPinAttempts] = useState(0);
  const [lockoutRemaining, setLockoutRemaining] = useState(0);
  // The footer used to render a literal `v0.0.34`, which was two releases stale
  // by the time anyone looked. Same approach as LicenseActivationScreen: start
  // empty and fill from the `version` command, which is `env!("CARGO_PKG_VERSION")`
  // at compile time, so `bump-version.ps1` moves this string with the app.
  const [appVersion, setAppVersion] = useState('');
  const pinWrapRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const lastErrorRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;
    getVersion()
      .then((v) => {
        if (mounted) setAppVersion(v.version);
      })
      .catch((err) => {
        // Non-fatal: the footer is informational. Render nothing rather than a
        // number that could be wrong.
        console.warn('SessionLockScreen: getVersion failed, hiding version', err);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // U1: Auto-unlock after lockout period with visible countdown.
  useEffect(() => {
    if (lockedUntil === null) {
      setLockoutRemaining(0);
      return;
    }
    // Tick every second to update the countdown display.
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
      setLockoutRemaining(remaining);
      if (remaining <= 0) {
        setLockedUntil(null);
        setPinAttempts(0);
      }
    };
    tick(); // initial tick
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lockedUntil]);

  const isLocked = lockedUntil !== null;

  // Shake card on error
  useEffect(() => {
    if (!error || error === lastErrorRef.current) return;
    lastErrorRef.current = error;

    const card = cardRef.current;
    if (card) {
      card.classList.add('session-lock-card--shake');
      setTimeout(() => card.classList.remove('session-lock-card--shake'), 350);
    }
  }, [error]);

  // Update clock every 30s
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Focus PIN area on mount
  useEffect(() => {
    pinWrapRef.current?.focus();
  }, []);

  const handleDigit = useCallback((digit: string) => {
    if (isLocked) return;
    setError('');
    setPin((prev) => (prev.length >= MAX_PIN_LENGTH ? prev : [...prev, digit]));
  }, [isLocked]);

  const handleBackspace = useCallback(() => {
    if (isLocked) return;
    setPin((prev) => prev.slice(0, -1));
  }, [isLocked]);

  // Auto-submit on 4 digits — verify PIN via staffLogin
  useEffect(() => {
    if (pin.length !== MAX_PIN_LENGTH) return;
    const entered = pin.join('');
    if (!session) return;

    const attemptLogin = async () => {
      try {
        const username = sessionStorage.getItem('current-username');
        if (!username) {
          setError(l10n.getString('session-lock-expired'));
          setPin([]);
          return;
        }
        await staffLogin({ username, pin: entered });
        // Success — PIN verified
        setPin([]);
        setPinAttempts(0);
        onUnlock();
      } catch (err) {
        const errObj = err as Record<string, unknown> | null;
        const msg = errObj?.['message'] as string
          ?? l10n.getString('session-lock-invalid-pin');
        setError(msg);
        setPin([]);

        // Increment local attempt counter (defense-in-depth).
        const nextAttempts = pinAttempts + 1;
        setPinAttempts(nextAttempts);

        // S2: Respect backend rate-limit instructions first.
        // The server uses exponential backoff (up to 1h) which is more
        // accurate than our local hardcoded fallback.
        const lockoutSeconds = parseRateLimitSeconds(msg, errObj);
        if (lockoutSeconds !== null) {
          setLockedUntil(Date.now() + lockoutSeconds * 1000);
        } else if (nextAttempts >= MAX_PIN_ATTEMPTS) {
          // Fallback: local lockout when server doesn't provide retry-after.
          setLockedUntil(Date.now() + FALLBACK_LOCKOUT_MS);
        }
      }
    };
    attemptLogin();
  }, [pin, session, onUnlock, l10n, pinAttempts]);

  /**
   * Parse the retry-after duration from a rate-limit error, supporting
   * both the legacy string pattern and a future structured field.
   */
  function parseRateLimitSeconds(
    msg: string,
    errObj: Record<string, unknown> | null,
  ): number | null {
    // 1. Structured field on the error object (future-proof).
    const retryAfter = errObj?.['retry_after_seconds'] ?? errObj?.['retry-after'];
    if (typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter > 0) {
      return Math.ceil(retryAfter);
    }
    // 2. Legacy string pattern: "Try again in Ns" or "Try again in N seconds".
    const match = msg.match(/Try again in (\d+)\s*s(?:econds?)?/i);
    if (match && match[1]) {
      return parseInt(match[1], 10);
    }
    return null;
  }

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        handleDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setPin([]);
      }
    },
    [handleDigit, handleBackspace],
  );

  // Clock follows the active Fluent locale (not the browser default).
  const numLocale = [...l10n.bundles][0]?.locales[0] ?? 'en-US';
  const timeStr = time.toLocaleTimeString(numLocale, { hour: '2-digit', minute: '2-digit' });
  const dateStr = time.toLocaleDateString(numLocale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="session-lock-overlay" data-testid="session-lock-screen">
      <div className="session-lock-backdrop" aria-hidden="true" />

      {/* ── Viewport header: clock + date ────────────────────────────
         Absolutely positioned so it never joins the flex flow that
         centres the card. The keypad must land on exactly the same
         box as the login PIN step, so nothing outside the card may
         push it around. */}
      <div className="session-lock-header">
        <div className="session-lock-time">{timeStr}</div>
        <div className="session-lock-date">{dateStr}</div>
      </div>

      {/* Shrink-wraps the card and anchors the notice slot below it. */}
      <div className="session-lock-stage">
        <div className="session-lock-card" ref={cardRef}>
          {/* Lock badge — card-corner counterpart of login's top-right
              close button. Decorative: the lock state is already exposed
              by the PIN pad's accessible label. */}
          <div className="session-lock-lock-badge" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>

          {/* ── Top bar: PIN dots (same band, same role as the login PIN step) ── */}
          <div className="session-lock-top-bar">
            <div className="session-lock-pin-dots" aria-label={requiredLocalized(l10n, 'session-lock-pin-aria', { length: String(pin.length), max: String(MAX_PIN_LENGTH) })}>
              {Array.from({ length: MAX_PIN_LENGTH }, (_, i) => (
                <span
                  key={i}
                  className={`session-lock-pin-dot ${i < pin.length ? 'session-lock-pin-dot--filled' : ''}`}
                />
              ))}
            </div>
          </div>

          {/* ── Main area: keypad only ───────────────────────────────
             Kept as the sole child so the keypad is centred in an
             identically-sized band to login's — that is what makes the
             lock → login transition feel like nothing moved. */}
          <div className="session-lock-main-area">
            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
            <div
              id="session-lock-pin-pad"
              className="session-lock-pad"
              ref={pinWrapRef}
              tabIndex={-1}
              onKeyDown={handleKeyDown}
              role="application"
              aria-label={requiredLocalized(l10n, 'session-lock-pad-aria')}
            >
              {[['7', '8', '9'], ['4', '5', '6'], ['1', '2', '3']].map((row) => (
                <div className="session-lock-pad-row" key={row[0]}>
                  {row.map((digit) => (
                    <button
                      key={digit}
                      type="button"
                      className="session-lock-pad-key"
                      onClick={() => handleDigit(digit)}
                      aria-label={digit}
                      disabled={isLocked}
                    >
                      {digit}
                    </button>
                  ))}
                </div>
              ))}
              <div className="session-lock-pad-row">
                <button
                  type="button"
                  className="session-lock-pad-key session-lock-pad-key--action"
                  onClick={() => setPin([])}
                  disabled={pin.length === 0 || isLocked}
                >
                  {requiredLocalized(l10n, 'staff-login-clear')}
                </button>
                <button
                  type="button"
                  className="session-lock-pad-key"
                  onClick={() => handleDigit('0')}
                  aria-label="0"
                  disabled={isLocked}
                >
                  0
                </button>
                <button
                  type="button"
                  className="session-lock-pad-key session-lock-pad-key--action"
                  onClick={handleBackspace}
                  disabled={pin.length === 0 || isLocked}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                    <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
                    <line x1="18" y1="9" x2="12" y2="15" />
                    <line x1="12" y1="9" x2="18" y2="15" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* ── Bottom bar: spacer band (mirrors the login step-dots band) ── */}
          <div className="session-lock-bottom-bar" aria-hidden="true" />
        </div>

        {/* ── Notices: error + lockout countdown ─────────────────────
           Rendered outside the card so a growing error banner can never
           reflow the keypad out of its login-matching position. */}
        <div className="session-lock-notice">
          {error && (
            <div className="session-lock-error" role="alert" aria-live="polite">
              <AlertIcon />
              {error}
            </div>
          )}
          {isLocked && lockoutRemaining > 0 && (
            <div className="session-lock-countdown" role="status" aria-live="polite">
              {requiredLocalized(l10n, 'session-lock-lockout', { seconds: String(lockoutRemaining) })}
            </div>
          )}
        </div>
      </div>

      {/* ── Footer: version + copyright + connection status pills (login-style) ── */}
      <div className="session-lock-footer">
        <div className="session-lock-footer-left">
          {appVersion && (
            <Localized id="auth-version" vars={{ version: appVersion }}>
              <span className="session-lock-footer-version">Version {appVersion}</span>
            </Localized>
          )}
          {/* Same pair as StaffLoginScreen's footer (version + copyright). The
              login screen hardcodes both as raw JSX; these use the localized
              auth-version / auth-copyright keys already shared with
              LicenseActivationScreen, so the id build reads "Versi …" /
              "Hak Cipta Dilindungi". */}
          <Localized id="auth-copyright" vars={{ year: String(new Date().getFullYear()) }}>
            <span className="session-lock-footer-copyright">OZ-POS © {new Date().getFullYear()} All rights reserved.</span>
          </Localized>
        </div>
        <div className="session-lock-footer-right">
          <StatusBar />
        </div>
      </div>
    </div>
  );
}
