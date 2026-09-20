import { useState, useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { staffLogin } from "@/api/staff";
import { Localized } from "@/components/Localized";
import { useLocalization } from "@fluent/react";
import "./FastPINOverlay.css";
import { plainErrorMessage } from "@/utils/app-error";
import { animDuration } from "@/utils/animation";

// ── SVG icons ───────────────────────────────────────────────────────

function BackspaceIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
      <line x1="18" y1="9" x2="12" y2="15" />
      <line x1="12" y1="9" x2="18" y2="15" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      width="16"
      height="16"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      width="18"
      height="18"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

// ── Constants ───────────────────────────────────────────────────────

const MAX_PIN_LENGTH = 4;
const MAX_PIN_ATTEMPTS = 3;
const RATE_LIMIT_WARN_AFTER = 2;

// Minimum interval (ms) between consecutive staffLogin calls — prevents
// automated brute-force via high-speed digit entry (e.g. a script
// that enters 4 digits at 100ms intervals).
const MIN_ATTEMPT_INTERVAL_MS = 500;

// Module-level global rate limit: max 15 failed attempts per 5 minutes
// across ALL usernames within a page session. Prevents attackers from
// rotating through usernames to bypass the per-user rate limiter.
const GLOBAL_MAX_ATTEMPTS = 15;
const GLOBAL_WINDOW_MS = 5 * 60 * 1000;
const globalAttemptTimestamps: number[] = [];

/** Remove expired timestamps older than the window. */
function pruneGlobalAttemptTimestamps(): void {
  const now = Date.now();
  const cutoff = now - GLOBAL_WINDOW_MS;
  while (globalAttemptTimestamps.length > 0) {
    const ts = globalAttemptTimestamps[0];
    if (ts !== undefined && ts < cutoff) {
      globalAttemptTimestamps.shift();
    } else {
      break;
    }
  }
}

/** Check whether the session-level global rate limit has been exceeded. */
function isGloballyRateLimited(): boolean {
  return globalAttemptTimestamps.length >= GLOBAL_MAX_ATTEMPTS;
}

function recordGlobalAttempt(): void {
  globalAttemptTimestamps.push(Date.now());
}

// ── Types ───────────────────────────────────────────────────────────

export interface FastPINOverlayProps {
  /** Whether the overlay is visible. */
  open: boolean;
  /** Called when the overlay should close (cancel or Escape). */
  onClose: () => void;
  /** Optional callback invoked after successful PIN verification and session swap. */
  onVerified?: () => void;
}

// ── Component ───────────────────────────────────────────────────────

type Step = "username" | "pin";

/**
 * Quick Staff PIN Pad overlay for shared touchscreen operator switching.
 *
 * ADR #6: Allows staff to hot-swap operators on a shared POS terminal
 * without logging out and back in. Verifies the new operator's PIN,
 * creates a new session token with the same scope (store, instance,
 * terminal) but the new user's identity, and preserves the active
 * workspace.
 *
 * Flow:
 * 1. User enters username
 * 2. User enters PIN on a numeric keypad
 * 3. On verification: swaps AuthContext session + WorkspaceContext token
 * 4. Overlay dismisses
 */
export default function FastPINOverlay({ open, onClose, onVerified }: FastPINOverlayProps) {
  const { l10n } = useLocalization();
  const { session, swapSession } = useAuth();
  const { swapSessionToken } = useWorkspace();

  const [step, setStep] = useState<Step>("username");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exiting, setExiting] = useState(false);
  const [pinAttempts, setPinAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const l10nRef = useRef(l10n);
  l10nRef.current = l10n;
  const usernameInputRef = useRef<HTMLInputElement>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinSubmitted = useRef(false);
  const lastAttemptRef = useRef(0);

  // ── Computed rate-limit values ────────────────────────────────

  const remainingAttempts = Math.max(0, MAX_PIN_ATTEMPTS - pinAttempts);
  const isLocked = lockedUntil !== null;
  const lockoutRemainingSec = lockedUntil !== null
    ? Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000))
    : 0;

  // ── Reset state on open ──────────────────────────────────────

  useEffect(() => {
    if (open) {
      setStep("username");
      setUsername("");
      setPin([]);
      setError(null);
      setLoading(false);
      setPinAttempts(0);
      setLockedUntil(null);
      pinSubmitted.current = false;
    }
  }, [open]);

  // ── Focus username input on step change ──────────────────────

  useEffect(() => {
    if (open && step === "username") {
      // Small delay so the DOM has rendered
      const timer = setTimeout(() => usernameInputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [open, step]);

  // ── Cleanup exit timer on unmount ─────────────────────────-

  useEffect(() => {
    return () => {
      if (exitTimerRef.current !== null) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
    };
  }, []);

  // ── Animated close (sets exiting, delays unmount) ───────────

  const handleClose = useCallback(() => {
    if (loading) return;
    setExiting(true);
    exitTimerRef.current = setTimeout(() => {
      setExiting(false);
      exitTimerRef.current = null;
      onClose();
    }, animDuration(300));
  }, [onClose, loading]);

  // ── Escape key closes ───────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !exiting) {
        setExiting(true);
        exitTimerRef.current = setTimeout(() => {
          setExiting(false);
          exitTimerRef.current = null;
          onClose();
        }, 200);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose, exiting]);

  // ── Auto-unlock after lockout period ─────────────────────────

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

  // ── Verify PIN and swap session ─────────────────────────────

  const attemptVerify = useCallback(async () => {
    // S1: Enforce minimum 4-digit PIN — prevents wasted server round-trips.
    if (pin.length < MAX_PIN_LENGTH || isLocked) return;

    // Enforce minimum interval between staffLogin calls to prevent
    // rapid automated attacks (e.g. a script entering digits at 100ms).
    const elapsed = Date.now() - lastAttemptRef.current;
    if (elapsed < MIN_ATTEMPT_INTERVAL_MS) {
      await new Promise((resolve) =>
        setTimeout(resolve, MIN_ATTEMPT_INTERVAL_MS - elapsed),
      );
    }
    lastAttemptRef.current = Date.now();

    // Session-scoped global rate limit: reject if this page session has
    // exceeded 15 failed attempts across ALL usernames in 5 minutes.
    // This prevents username rotation attacks against the per-user limiter.
    pruneGlobalAttemptTimestamps();
    if (isGloballyRateLimited()) {
      setError(l10nRef.current.getString('staff-login-lockout', { seconds: String(Math.ceil(GLOBAL_WINDOW_MS / 1000)) }));
      setLoading(false);
      return;
    }
    recordGlobalAttempt();

    setLoading(true);
    setError(null);
    try {
      // Step 1: Verify the new operator's credentials.
      const result = await staffLogin({
        username: username.trim(),
        pin: pin.join(""),
      });
      const newSession = result.session;

      // Step 2: Swap the AuthContext session (no workspace reset). Pass the
      // fresh picker ticket so the pre-session picker stays bound to the new
      // user (audit-open-findings).
      swapSession(newSession, result.picker_ticket);

      // Step 3: Create a new session token with the new user's identity
      // but the same scope (store, instance, terminal).
      await swapSessionToken(newSession.user_id, newSession.role_id);

      // Step 4: Fire verified callback (e.g. for deduction location override)
      onVerified?.();
      // Step 5: Dismiss the overlay (after successful verify — snap close intentional).
      onClose();
    } catch (err) {
      const message = plainErrorMessage(err, "PIN verification failed");
      setError(message);
      setPin([]);
      // Increment local attempt counter — even if the backend error is
      // identical to a previous one, the counter advances so the client
      // can eventually lock the pad and force a cooldown.
      setPinAttempts((prev) => prev + 1);
      // Parse backend rate-limit error to sync the client lockout timer.
      const lockoutMatch = message.match(/Try again in (\d+)s/);
      if (lockoutMatch && lockoutMatch[1]) {
        const seconds = parseInt(lockoutMatch[1], 10);
        setLockedUntil(Date.now() + seconds * 1000);
        setPinAttempts(MAX_PIN_ATTEMPTS);
      }
    } finally {
      setLoading(false);
    }
  }, [pin, username, swapSession, swapSessionToken, onClose, onVerified, isLocked]); /* l10n intentionally excluded via l10nRef — prevents infinite re-render loops from unstable l10n references */

  // ── Auto-submit when PIN reaches max length ─────────────────

  useEffect(() => {
    if (pin.length === MAX_PIN_LENGTH && !loading && !pinSubmitted.current) {
      pinSubmitted.current = true;
      attemptVerify();
    }
    if (pin.length < MAX_PIN_LENGTH) {
      pinSubmitted.current = false;
    }
  }, [pin, loading, attemptVerify]);

  // ── PIN pad handlers ────────────────────────────────────────

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

  // ── Back button ─────────────────────────────────────────────

  const goBack = useCallback(() => {
    setStep("username");
    setPin([]);
    pinSubmitted.current = false;
  }, []);

  // ── Hardware keyboard support ───────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (step !== "pin" || loading) return;

      if (e.key >= "0" && e.key <= "9") {
        e.preventDefault();
        handlePinDigit(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        handlePinBackspace();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (pin.length >= MAX_PIN_LENGTH && !pinSubmitted.current) attemptVerify();
      }
    },
    [
      step,
      loading,
      handlePinDigit,
      handlePinBackspace,
      attemptVerify,
      pin.length,
    ],
  );

  // ── Username handlers ───────────────────────────────────────

  const handleUsernameSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (username.trim()) {
        setStep("pin");
      }
    },
    [username],
  );

  // ── Render helpers ────────────────────────────────────────────────

  const renderPinDots = () => (
    <div
      className="fastpin-pin-dots"
      aria-label={l10n.getString("staff-login-pin-aria", {
        length: pin.length,
        max: MAX_PIN_LENGTH,
      })}
    >
      {Array.from({ length: MAX_PIN_LENGTH }, (_, i) => (
        <span
          key={i}
          className={`fastpin-pin-dot ${i < pin.length ? "fastpin-pin-dot--filled" : ""}`}
          aria-hidden="true"
        />
      ))}
    </div>
  );

  const renderPinPad = () => {
    const keys = [
      ["7", "8", "9"],
      ["4", "5", "6"],
      ["1", "2", "3"],
    ];

    return (
      <div
        className="fastpin-pad"
        role="group"
        aria-label={l10n.getString("staff-login-keypad-aria")}
      >
        {keys.map((row) => (
          <div className="fastpin-pad-row" key={row[0]}>
            {row.map((digit) => (
              <Localized
                id="staff-login-digit-aria"
                attrs={{ "aria-label": true }}
                vars={{ digit }}
                key={digit}
              >
                <button
                  type="button"
                  className="fastpin-pad-key"
                  onClick={() => handlePinDigit(digit)}
                  aria-label={digit}
                  disabled={loading || isLocked}
                >
                  {digit}
                </button>
              </Localized>
            ))}
          </div>
        ))}
        <div className="fastpin-pad-row">
          <Localized id="staff-login-clear-aria" attrs={{ "aria-label": true }}>
            <button
              type="button"
              className="fastpin-pad-key fastpin-pad-key--action"
              onClick={handlePinClear}
              aria-label="Clear"
              disabled={loading || isLocked || pin.length === 0}
            >
              <Localized id="staff-login-clear">Clear</Localized>
            </button>
          </Localized>
          <Localized
            id="staff-login-digit-aria"
            attrs={{ "aria-label": true }}
            vars={{ digit: "0" }}
          >
            <button
              type="button"
              className="fastpin-pad-key"
              onClick={() => handlePinDigit("0")}
              aria-label="0"
              disabled={loading || isLocked}
            >
              0
            </button>
          </Localized>
          <Localized
            id="staff-login-backspace-aria"
            attrs={{ "aria-label": true }}
          >
            <button
              type="button"
              className="fastpin-pad-key fastpin-pad-key--action"
              onClick={handlePinBackspace}
              aria-label="Backspace"
              disabled={loading || isLocked || pin.length === 0}
            >
              <BackspaceIcon />
            </button>
          </Localized>
        </div>
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────

  if (!open && !exiting) return null;

  // Escape key is handled via document-level keydown listener
  return (
    <div
      role="presentation"
      tabIndex={-1}
      className={`fastpin-overlay${exiting ? ' fastpin-overlay--exiting' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) handleClose();
      }}
    >
      {/* role="dialog" is keyboard-managed via onKeyDown; the rule flags the handler on a non-interactive role */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        className={`fastpin-card${exiting ? ' fastpin-card--exiting' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={l10n.getString("staff-login-pin-section-aria")}
        onKeyDown={handleKeyDown}
      >
        {/* ── Close button ──────────────────────────────── */}
        <button
          type="button"
          className="fastpin-close-btn"
          onClick={handleClose}
          aria-label={l10n.getString("modal-close-aria")}
          disabled={loading}
        >
          <CloseIcon />
        </button>

        {/* ── Username step ─────────────────────────────── */}
        {step === "username" && (
          <div className="fastpin-step-content" key="username">
            <div className="fastpin-icon-wrap">
              <UserIcon />
            </div>

            <Localized id="staff-login-step-username">
              <p className="fastpin-step-label">Enter your username</p>
            </Localized>

            <form onSubmit={handleUsernameSubmit} className="fastpin-form">
              <Localized
                id="staff-login-username-placeholder"
                attrs={{ placeholder: true }}
              >
                <Localized
                  id="staff-login-username-aria"
                  attrs={{ "aria-label": true }}
                >
                  <input
                    ref={usernameInputRef}
                    type="text"
                    className="fastpin-input"
                    id="fastpin-username"
                    name="fastpin-username"
                    placeholder="Username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="off"
                    aria-label="Username"
                    disabled={loading}
                  />
                </Localized>
              </Localized>
              <Localized id="staff-login-next">
                <button
                  type="submit"
                  className="fastpin-submit-btn"
                  disabled={!username.trim() || loading}
                >
                  {loading ? (
                    <>
                      <span className="fastpin-btn-spinner" />
                      <Localized id="staff-login-submitting">
                        <span>Verifying…</span>
                      </Localized>
                    </>
                  ) : (
                    "Next"
                  )}
                </button>
              </Localized>
            </form>
          </div>
        )}

        {/* ── PIN step ──────────────────────────────────── */}
        {step === "pin" && (
          <div className="fastpin-step-content" key="pin">
            <div className="fastpin-icon-wrap fastpin-icon-wrap--small">
              <UserIcon />
            </div>

            {session?.display_name && (
              <p className="fastpin-active-user">
                <Localized
                  id="fastpin-active-user"
                  vars={{ name: session.display_name }}
                >
                  <span>Active: {session.display_name}</span>
                </Localized>
              </p>
            )}

            <Localized id="fastpin-enter-pin" vars={{ user: username.trim() }}>
              <p className="fastpin-step-label">
                Enter PIN for {username.trim()}
              </p>
            </Localized>

            {renderPinDots()}
            {renderPinPad()}

            {/* Submit button for PINs shorter than max */}
            <button
              type="button"
              className="fastpin-submit-btn fastpin-pin-submit"
              onClick={attemptVerify}
              disabled={pin.length === 0 || loading || isLocked}
            >
              {loading ? (
                <>
                  <span className="fastpin-btn-spinner" />
                  <Localized id="staff-login-submitting">
                    <span>Verifying…</span>
                  </Localized>
                </>
              ) : (
                l10n.getString("staff-login-submit")
              )}
            </button>

            {/* Back button */}
            <Localized id="staff-login-back">
              <button
                type="button"
                className="fastpin-back-btn"
                onClick={goBack}
                disabled={loading}
              >
                &larr; Back
              </button>
            </Localized>
          </div>
        )}

        {/* ── Error ──────────────────────────────────────── */}
        {error && (
          <div className="fastpin-error" role="alert" aria-live="polite">
            <AlertIcon />
            {error}
            {pinAttempts >= RATE_LIMIT_WARN_AFTER && pinAttempts < MAX_PIN_ATTEMPTS && (
              <span className="fastpin-rate-limit">
                {' '}{l10n.getString('staff-login-attempts-remaining', { count: String(remainingAttempts) })}
              </span>
            )}
            {isLocked && (
              <span className="fastpin-rate-limit fastpin-rate-limit--lockout">
                {' '}{l10n.getString('staff-login-lockout', { seconds: String(lockoutRemainingSec) })}
              </span>
            )}
          </div>
        )}

        {/* ── Cancel footer ──────────────────────────────── */}
        <div className="fastpin-footer">
          <button
            type="button"
            className="fastpin-cancel-btn"
            onClick={handleClose}
            disabled={loading}
          >
            <Localized id="cancel">Cancel</Localized>
          </button>
        </div>
      </div>
    </div>
  );
}
