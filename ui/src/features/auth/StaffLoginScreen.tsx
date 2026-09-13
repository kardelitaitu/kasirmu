import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useKeyboardAvoidance } from '@/hooks/useKeyboardAvoidance';
import { checkUsername } from '@/api/staff';
import { useAuth } from '@/contexts/AuthContext';
import { useBrand } from '@/contexts/BrandContext';
import StatusBar from '@/components/StatusBar';
import { useToast } from '@/frontend/shared/Toast';
import { Localized } from '@/frontend/shared/Localized';
import { requiredLocalized } from '@/frontend/shared';
import { useLocalization } from '@fluent/react';
import { convertFileSrc } from '@/api/tauri';
import './StaffLoginScreen.css';

// ── SVG icons ───────────────────────────────────────────────────────

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function BackspaceIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
      <line x1="18" y1="9" x2="12" y2="15" />
      <line x1="12" y1="9" x2="18" y2="15" />
    </svg>
  );
}

// ── Constants ───────────────────────────────────────────────────────

const MAX_PIN_LENGTH = 4;
const MAX_PIN_ATTEMPTS = 3;

// ── Resized Logo Helper (1:1 PNG at target size) ───────────────────

function useResizedLogo(src: string | null | undefined, targetSize = 256) {
  const [resizedUrl, setResizedUrl] = useState<string | null>(src || null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!src) {
      setResizedUrl(null);
      setError(false);
      return;
    }
    setResizedUrl(src);
    setError(false);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = targetSize;
        canvas.height = targetSize;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, targetSize, targetSize);
          setResizedUrl(canvas.toDataURL('image/png'));
        }
      } catch {
        setResizedUrl(src);
      }
    };
    img.onerror = () => {
      setError(true);
    };
    img.src = src;
  }, [src, targetSize]);

  return { resizedUrl, error };
}

// ── Component ───────────────────────────────────────────────────────

type Step = 'username' | 'pin';

/** Staff login screen — two-step authentication flow with username entry followed by PIN pad input and shake animation on error. */
export default function StaffLoginScreen() {
  const { l10n } = useLocalization();
  const { login, loading: authLoading, error, clearError, session } = useAuth();
  const { settings: brandSettings, loading: brandLoading } = useBrand();
  // Convert local filesystem path to a Tauri-compatible asset URL.
  const logoUrl = useMemo(() => {
    if (brandLoading) return null;
    const path = brandSettings?.logo_path;
    if (!path) return null;
    try {
      return convertFileSrc(path);
    } catch {
      return path; // fallback — may show broken image but won't crash
    }
  }, [brandLoading, brandSettings?.logo_path]);

  const { resizedUrl, error: primaryLogoError } = useResizedLogo(logoUrl, 256);
  const [fallbackSvgError, setFallbackSvgError] = useState(false);
  const { addToast } = useToast();
  const [step, setStep] = useState<Step>('username');
  const [username, setUsername] = useState('');
  const [usernameChecking, setUsernameChecking] = useState(false);
  const [usernameAccepted, setUsernameAccepted] = useState(false);
  const [pin, setPin] = useState<string[]>([]);
  // U5: Last login timestamp for shared-terminal security awareness.
  const [lastLogin, setLastLogin] = useState<string | null>(null);
  useEffect(() => {
    try {
      const ts = localStorage.getItem('oz-last-login');
      if (ts) {
        const d = new Date(ts);
        if (!Number.isNaN(d.getTime())) {
          const numLocale = navigator.language || 'en-US';
          setLastLogin(d.toLocaleString(numLocale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
        }
      }
    } catch { /* ignore */ }
  }, []);
  const usernameInputRef = useRef<HTMLInputElement>(null);
  const pinWrapRef = useRef<HTMLDivElement>(null);
  const pinSubmitted = useRef(false);
  const [pinAttempts, setPinAttempts] = useState(0);
  // pinAttempts is used internally for lockout counter but not displayed
  void pinAttempts;
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const toastShownForError = useRef<string | null>(null);
  // P7-4: Keyboard avoidance — scroll inputs into view on mobile
  const { containerRef: keyboardAvoidRef } = useKeyboardAvoidance();

  const cardRef = useRef<HTMLDivElement>(null);

  // U5: Store last login timestamp when session becomes active.
  useEffect(() => {
    if (session) {
      try {
        localStorage.setItem('oz-last-login', new Date().toISOString());
      } catch { /* ignore */ }
    }
  }, [session]);

  // ── Shake card + toast + rate-limit on PIN error ──────────────

  useEffect(() => {
    if (!error || step !== 'pin' || error === toastShownForError.current) return;
    toastShownForError.current = error;

    const card = cardRef.current;
    if (card) {
      card.classList.add('staff-login-card--shake');
      setTimeout(() => card.classList.remove('staff-login-card--shake'), 350);
    }

    addToast({ type: 'error', message: error, duration: 5000 });
    setPin([]);

    // Parse backend rate limit error to sync lockout timer. (Per-attempt
    // counting happens in attemptLogin so it survives identical messages.)
    const lockoutMatch = error.match(/Try again in (\d+)s/);
    if (lockoutMatch && lockoutMatch[1]) {
      const seconds = parseInt(lockoutMatch[1], 10);
      setLockedUntil(Date.now() + seconds * 1000);
      setPinAttempts(MAX_PIN_ATTEMPTS);
    }
  }, [error, step]);

  // ── Auto-unlock after lockout period ──────────────────────────

  useEffect(() => {
    if (lockedUntil === null) return;
    const remaining = lockedUntil - Date.now();
    if (remaining <= 0) {
      setLockedUntil(null);
      setPinAttempts(0);
      return;
    }
    const timer = setTimeout(() => {
      setLockedUntil(null);
      setPinAttempts(0);
    }, remaining);
    return () => clearTimeout(timer);
  }, [lockedUntil]);

  // ── Rate-limit display helpers ─────────────────────────────────

  const isLocked = lockedUntil !== null;

  // ── Focus appropriate element when step changes ──────────────

  useEffect(() => {
    if (step === 'username') {
      usernameInputRef.current?.focus();
    } else if (step === 'pin') {
      pinWrapRef.current?.focus();
    }
  }, [step]);

  // ── Reset errors when step changes ──────────────────────────

  useEffect(() => {
    clearError();
  }, [step, clearError]);

  // ── PIN pad handlers ─────────────────────────────────────────

  const handlePinDigit = useCallback((digit: string) => {
    if (isLocked) return;
    setPin((prev) => {
      if (prev.length >= MAX_PIN_LENGTH) return prev;
      return [...prev, digit];
    });
  }, [isLocked]);

  const handlePinBackspace = useCallback(() => {
    if (isLocked) return;
    setPin((prev) => prev.slice(0, -1));
  }, [isLocked]);

  const handlePinClear = useCallback(() => {
    if (isLocked) return;
    setPin([]);
    pinSubmitted.current = false;
  }, [isLocked]);

  // ── Attempt login ────────────────────────────────────────────

  const attemptLogin = useCallback(() => {
    // S1: Enforce minimum 4-digit PIN — both client-side (prevents
    // wasted server round-trips) and server-side (defense in depth).
    if (pin.length < MAX_PIN_LENGTH) return;
    // Count every submitted PIN as an attempt so the client-side
    // rate-limit/lockout counter advances even when the backend returns
    // an identical error message on consecutive failures (the error effect
    // dedupes duplicate toasts but must not freeze the attempt counter).
    setPinAttempts((prev) => prev + 1);
    login(username.trim(), pin.join(''));
  }, [pin, username, login]);

  // ── Back button ──────────────────────────────────────────────

  const goBack = useCallback(() => {
    setStep('username');
    setPin([]);
    setUsernameAccepted(false);
    pinSubmitted.current = false;
  }, []);

  // ── Hardware keyboard handler for PIN step ──────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (step !== 'pin') return;
      if (authLoading) return;

      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        handlePinDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handlePinBackspace();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handlePinClear();
        goBack();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (pin.length >= MAX_PIN_LENGTH && !pinSubmitted.current) attemptLogin();
      }
    },
    [step, authLoading, handlePinDigit, handlePinBackspace, handlePinClear, goBack, attemptLogin, pin.length],
  );

  // ── Username handlers ────────────────────────────────────────

  const handleUsernameSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = username.trim();
    if (!trimmed) return;

    setUsernameChecking(true);
    clearError();

    try {
      // STAFF-06: the pre-check returns a uniform { proceed: true } and never
      // reveals whether the account exists or is active, so we always advance
      // to the PIN step. Any credential/state problem is reported only by the
      // login endpoint as a single uniform error — this screen must not branch
      // on account existence or activation status.
      await checkUsername({ username: trimmed });
      setUsernameAccepted(true);
      setStep('pin');
    } catch {
      addToast({ type: 'error', message: l10n.getString('staff-login-error-connection') });
    } finally {
      setUsernameChecking(false);
    }
  }, [username, clearError, addToast, l10n]);

  const handleUsernameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setUsername(e.target.value);
    setUsernameAccepted(false);
  }, []);

  const handleUsernameKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setUsername('');
    }
  }, []);

  // ── Auto-submit when PIN reaches max length ──────────────────

  useEffect(() => {
    // Reset error gate when user starts re-entering a PIN after error
    if (pin.length === 1) {
      toastShownForError.current = null;
    }
    if (pin.length === MAX_PIN_LENGTH && !authLoading && !pinSubmitted.current) {
      pinSubmitted.current = true;
      attemptLogin();
    }
    if (pin.length < MAX_PIN_LENGTH) {
      pinSubmitted.current = false;
    }
  }, [pin, authLoading, attemptLogin]);

  // ── Focus on screen tap ──────────────────────────────────────

  const handleScreenClick = useCallback(() => {
    if (step === 'username') {
      usernameInputRef.current?.focus();
    } else if (step === 'pin') {
      pinWrapRef.current?.focus();
    }
  }, [step]);

  // ── Logo renderer ────────────────────────────────────────────

  const renderLogo = (small = false) => {
    const logoClass = `staff-login-logo${small ? ' staff-login-logo--small' : ''}`;
    const storeName = brandSettings?.store_name || '';

    // While brand settings are loading, show a skeleton placeholder
    // so the logo doesn't flash between different images.
    if (brandLoading) {
      return (
        <div className={logoClass}>
          <div className="staff-login-logo skeleton" />
        </div>
      );
    }

    return (
      <div className={logoClass}>
        {!primaryLogoError && resizedUrl ? (
          <img
            src={resizedUrl}
            alt={storeName || 'OZ-POS'}
            className="staff-login-logo-img"
          />
        ) : !fallbackSvgError ? (
          <img
            src="/branding/logo-mark.svg"
            alt={storeName || 'OZ-POS'}
            className="staff-login-logo-img"
            onError={() => setFallbackSvgError(true)}
          />
        ) : (
          <UserIcon />
        )}
      </div>
    );
  };

  // ── PIN dots ─────────────────────────────────────────────────

  const renderPinDots = () => (
    <div
      className="staff-login-pin-dots"
      aria-label={l10n.getString('staff-login-pin-aria', { length: pin.length, max: MAX_PIN_LENGTH })}
    >
      {Array.from({ length: MAX_PIN_LENGTH }, (_, i) => (
        <span
          key={i}
          className={`staff-login-pin-dot ${i < pin.length ? 'staff-login-pin-dot--filled' : ''}`}
          aria-hidden="true"
        />
      ))}
    </div>
  );

  // ── PIN pad ──────────────────────────────────────────────────

  const renderPinPad = () => {
    const keys = [
      ['7', '8', '9'],
      ['4', '5', '6'],
      ['1', '2', '3'],
    ];

    return (
      <div className="staff-login-pad" role="group" aria-label={l10n.getString('staff-login-keypad-aria')} aria-disabled={isLocked || undefined}>
        {keys.map((row) => (
          <div className="staff-login-pad-row" key={row[0]}>
            {row.map((digit) => (
              <Localized id="staff-login-digit-aria" attrs={{ 'aria-label': true }} vars={{ digit }} key={digit}>
                <button
                  type="button"
                  className="staff-login-pad-key"
                  onClick={() => handlePinDigit(digit)}                          aria-label={digit}                      disabled={authLoading || isLocked}
                    >
                      {digit}
                    </button>
                  </Localized>
                ))}
          </div>
        ))}
        <div className="staff-login-pad-row">
          <Localized id="staff-login-clear-aria" attrs={{ 'aria-label': true }}>
            <button
              type="button"
              className="staff-login-pad-key staff-login-pad-key--action"
              onClick={handlePinClear}
              aria-label={l10n.getString('clear-aria')}
              disabled={authLoading || pin.length === 0 || isLocked}
            >
              <Localized id="staff-login-clear">Clear</Localized>
            </button>
          </Localized>
          <Localized id="staff-login-digit-aria" attrs={{ 'aria-label': true }} vars={{ digit: '0' }}>
            <button
              type="button"
              className="staff-login-pad-key"
              onClick={() => handlePinDigit('0')}
              aria-label="0"
              disabled={authLoading || isLocked}
            >
              0
            </button>
          </Localized>
          <Localized id="staff-login-backspace-aria" attrs={{ 'aria-label': true }}>
            <button
              type="button"
              className="staff-login-pad-key staff-login-pad-key--action"
              onClick={handlePinBackspace}
              aria-label={l10n.getString('backspace-aria')}
              disabled={authLoading || pin.length === 0 || isLocked}
            >
              <BackspaceIcon />
            </button>
          </Localized>
        </div>
      </div>
    );
  };

  // ── Render ───────────────────────────────────────────────────

  // Focus management: clicking anywhere refocuses the active input
  const handleScreenKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === ' ') {
        e.preventDefault();
        handleScreenClick();
      }
    },
    [handleScreenClick],
  );

  return (
    /* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- focus convenience, keyboard covered below */
    <div
      className="staff-login-screen"
      data-testid="staff-login-screen"
      onClick={handleScreenClick}
      onKeyDown={handleScreenKeyDown}
      tabIndex={-1}
    >
      <div className={`staff-login-card ${step === 'pin' ? 'staff-login-card--pin' : ''}`} ref={(el) => {
        (cardRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
        (keyboardAvoidRef as React.MutableRefObject<HTMLDivElement | null>).current = (el?.parentElement ?? null) as HTMLDivElement | null;
      }}>
        {step === 'pin' && (
          <button
            type="button"
            className="staff-login-close-btn"
            onClick={goBack}
            aria-label={l10n.getString('staff-login-close-aria')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}

        {/* ── Top bar: logo (username) / store + dots (PIN) ── */}
        <div className="staff-login-top-bar">
          {step === 'username' && renderLogo()}
          {step === 'pin' && (
            <div className="staff-login-pin-top">
              {renderPinDots()}
            </div>
          )}
        </div>

        {/* ── Main area: form ────────────────────────────────── */}
        <div className="staff-login-main-area">
          {step === 'username' && (
            <form onSubmit={handleUsernameSubmit} className="staff-login-form">
              <div className="staff-login-input-wrap">
                <Localized id="staff-login-username-placeholder" attrs={{ placeholder: true }}>
                  <Localized id="staff-login-username-aria" attrs={{ 'aria-label': true }}>
                    <input
                      ref={usernameInputRef}
                      type="text"
                      id="staff-login-username"
                      name="username-off"
                      className="staff-login-input"
                      placeholder="Username"
                      value={username}
                      onChange={handleUsernameChange}
                      onKeyDown={handleUsernameKeyDown}
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      data-1p-ignore="true"
                      aria-label={l10n.getString('username-aria')}
                      disabled={authLoading}
                    />
                  </Localized>
                </Localized>
                <button
                  type="submit"
                  className={`staff-login-submit-btn ${usernameAccepted ? 'staff-login-submit-btn--accepted' : ''}`}
                  disabled={!username.trim() || usernameChecking}
                  aria-label={l10n.getString('staff-login-next-aria')}
                >
                  {usernameChecking ? (
                    <span className="staff-login-btn-spinner" />
                  ) : usernameAccepted ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20" aria-hidden="true">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20" aria-hidden="true">
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="12 5 19 12 12 19" />
                    </svg>
                  )}
                </button>
              </div>
            </form>
          )}

          {step === 'pin' && (
            // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
            <div
              id="staff-login-pin-pad"
              className="staff-login-pin-wrap"
              ref={pinWrapRef}
              tabIndex={-1}
              onKeyDown={handleKeyDown}
              role="application"
              aria-label={l10n.getString('staff-login-pin-section-aria')}
            >
              {renderPinPad()}
            </div>
          )}

          
        </div>

        {/* ── Bottom bar: step indicator (12%) ──────────────── */}
        <div className="staff-login-bottom-bar">
          <div
            className="staff-login-steps"
            role="status"
            aria-label={l10n.getString('staff-login-progress-aria')}
          >
            <span className={`staff-login-step-dot ${step === 'username' ? 'staff-login-step-dot--active' : 'staff-login-step-dot--done'}`} />
            <span className="staff-login-step-line" />
            <span className={`staff-login-step-dot ${step === 'pin' ? 'staff-login-step-dot--active' : ''}`} />
          </div>
        </div>
      </div>

      {/* ── Footer: version + copyright + sync status ────── */}
      <div className="staff-login-footer">
        <div className="staff-login-footer-left">
          <span className="staff-login-footer-version">v0.0.37</span>
          <span className="staff-login-footer-copyright">&copy; OZ-POS. All rights reserved.</span>
          {lastLogin && (
            <span
              className="staff-login-last-login"
              title={requiredLocalized(l10n, 'staff-login-last-login-title')}
            >
              {requiredLocalized(l10n, 'staff-login-last-login', { time: lastLogin })}
            </span>
          )}
        </div>
        <div className="staff-login-footer-right">
          <StatusBar />
        </div>
      </div>
    </div>
  );
}
