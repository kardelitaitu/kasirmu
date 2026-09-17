import { useState, useCallback, useEffect, useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { requiredLocalized } from '@/components';
import { animDuration } from '@/utils/animation';
import { staffLogin } from '@/api/staff';
import { formatMoney, type Money } from '@/types/domain';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { l10nErrorMessage } from '@/utils/app-error';
import './PriceOverrideModal.css';

/** Props for the PriceOverrideModal — requires staff PIN verification before applying a manual price change. */
export interface PriceOverrideModalProps {
  open: boolean;
  lineDescription: string;
  currentPrice: Money;
  onConfirm: (newPriceMinor: number, userId: string) => Promise<void>;
  onClose: () => void;
}

/** Price override modal — two-step flow: enter new price, then authenticate with staff username + PIN before applying. */
export default function PriceOverrideModal({
  open,
  lineDescription,
  currentPrice,
  onConfirm,
  onClose,
}: PriceOverrideModalProps) {
  const { l10n } = useLocalization();
  const ANIM_MS = animDuration(200);
  const [exiting, setExiting] = useState(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      if (exitTimerRef.current !== null) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
    };
  }, []);

  const handleClose = useCallback(() => {
    setExiting(true);
    exitTimerRef.current = setTimeout(() => {
      setExiting(false);
      exitTimerRef.current = null;
      onClose();
    }, ANIM_MS);
  }, [onClose, ANIM_MS]);

  const [step, setStep] = useState<'price' | 'username' | 'pin'>('price');
  const [newPriceMinor, setNewPriceMinor] = useState<number>(currentPrice.minor_units);
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [priceError, setPriceError] = useState<string | null>(
    currentPrice.minor_units <= 0 ? requiredLocalized(l10n, 'price-override-error-zero') : null,
  );
  const usernameInputRef = useRef<HTMLInputElement>(null);
  const pinWrapRef = useRef<HTMLDivElement>(null);
  const pinSubmitted = useRef(false);

  const MAX_PIN_LENGTH = 4;

  useEffect(() => {
    if (step === 'username') {
      usernameInputRef.current?.focus();
    } else if (step === 'pin') {
      pinWrapRef.current?.focus();
    }
  }, [step]);

  const attemptVerify = useCallback(async () => {
    if (pin.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const result = await staffLogin({ username: username.trim(), pin: pin.join('') });
      await onConfirm(newPriceMinor, result.session.user_id);
    } catch (err) {
      const message = l10nErrorMessage(err, l10n, 'price-override-pin-failed');
      setError(message);
      setPin([]);
      pinSubmitted.current = false;
    } finally {
      setLoading(false);
    }
  }, [pin, username, newPriceMinor, onConfirm, l10n]);

  useEffect(() => {
    if (pin.length === MAX_PIN_LENGTH && !loading && !pinSubmitted.current) {

      pinSubmitted.current = true;
      attemptVerify();
    }
    if (pin.length < MAX_PIN_LENGTH) {
      pinSubmitted.current = false;
    }
  }, [pin, loading, attemptVerify]);


  const handlePriceConfirm = useCallback(() => {
    if (newPriceMinor <= 0) {
      setPriceError(requiredLocalized(l10n, 'price-override-error-zero'));
      return;
    }
    const maxPrice = currentPrice.minor_units * 10;
    if (newPriceMinor > maxPrice) {
      setPriceError(requiredLocalized(l10n, 'price-override-error-max', { max: String(maxPrice) }));
      return;
    }
    setStep('username');
    setError(null);
    setPriceError(null);
  }, [newPriceMinor, currentPrice.minor_units, l10n]);

  const handleUsernameSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim()) {
      setStep('pin');
      setError(null);
    }
  }, [username]);

  const handlePinDigit = useCallback((digit: string) => {
    setPin((prev) => {
      if (prev.length >= MAX_PIN_LENGTH) return prev;
      return [...prev, digit];
    });
  }, []);

  const handlePinBackspace = useCallback(() => {
    setPin((prev) => prev.slice(0, -1));
  }, []);

  const handlePinClear = useCallback(() => {
    setPin([]);
    pinSubmitted.current = false;
  }, []);


  // ── Hardware keyboard handler for PIN step ──────────────────

  const handlePinKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (loading) return;

      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        handlePinDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handlePinBackspace();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (pin.length >= 1 && !pinSubmitted.current) attemptVerify();
      }
    },
    [loading, handlePinDigit, handlePinBackspace, attemptVerify, pin.length],
  );

  const handleGoBack = useCallback(() => {
    setError(null);
    if (step === 'username') {
      setStep('price');
    } else if (step === 'pin') {
      setStep('username');
      setPin([]);
      pinSubmitted.current = false;
    }
  }, [step]);

  // ── Focus trap (Escape + Tab cycling) ─────────────────────
  useFocusTrap(panelRef, open && !exiting && !loading, handleClose);

  if (!open && !exiting) return null;

  const renderPinDots = (length: number) => (
    <div
      className="price-override-pin-dots"
      aria-label={requiredLocalized(l10n, 'price-override-pin-dots-aria', {
        count: String(length),
        max: String(MAX_PIN_LENGTH),
      })}
    >
      {Array.from({ length: MAX_PIN_LENGTH }, (_, i) => (
        <span
          key={i}
          className={`price-override-pin-dot ${i < length ? 'price-override-pin-dot--filled' : ''}`}
          aria-hidden="true"
        />
      ))}
    </div>
  );

  const renderPinPad = () => (
    <div className="price-override-pin-pad" role="group" aria-label={requiredLocalized(l10n, 'price-override-keypad-aria')}>
      {[7, 8, 9].map((d) => (
        <button key={d} type="button" className="price-override-pin-key" onClick={() => handlePinDigit(String(d))} disabled={loading}>{d}</button>
      ))}
      {[4, 5, 6].map((d) => (
        <button key={d} type="button" className="price-override-pin-key" onClick={() => handlePinDigit(String(d))} disabled={loading}>{d}</button>
      ))}
      {[1, 2, 3].map((d) => (
        <button key={d} type="button" className="price-override-pin-key" onClick={() => handlePinDigit(String(d))} disabled={loading}>{d}</button>
      ))}
      <button type="button" className="price-override-pin-key price-override-pin-key--clear" onClick={handlePinClear} disabled={loading || pin.length === 0}>
        {requiredLocalized(l10n, 'price-override-clear')}
      </button>
      <button type="button" className="price-override-pin-key" onClick={() => handlePinDigit('0')} disabled={loading}>0</button>
      <button type="button" className="price-override-pin-key price-override-pin-key--backspace" onClick={handlePinBackspace} disabled={loading || pin.length === 0} aria-label={requiredLocalized(l10n, 'price-override-backspace-aria')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
          <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" />
          <line x1="18" y1="9" x2="12" y2="15" />
          <line x1="12" y1="9" x2="18" y2="15" />
        </svg>
      </button>
    </div>
  );

  return (
    <div className={`price-override-overlay${exiting ? ' price-override-overlay--exiting' : ''}`} role="dialog" aria-modal="true" aria-label={requiredLocalized(l10n, 'price-override-dialog-aria')}>
      <div className={`price-override-modal${exiting ? ' price-override-modal--exiting' : ''}`} ref={panelRef}>
        <button
          type="button"
          className="price-override-close"
          onClick={handleClose}
          aria-label={requiredLocalized(l10n, 'price-override-close-aria')}
        >
          &times;
        </button>

        <Localized id="price-override-title">
          <h2 className="price-override-title">Price Override</h2>
        </Localized>
        <p className="price-override-item">{lineDescription}</p>

        {step === 'price' && (
          <div className="price-override-price-step">
            <div className="price-override-current">
              <span className="price-override-current-label">{requiredLocalized(l10n, 'price-override-current-label')}</span>
              <span className="price-override-current-value">{formatMoney(currentPrice)}</span>
            </div>
            <label className="price-override-new-label" htmlFor="price-override-input">
              {requiredLocalized(l10n, 'price-override-new-label')}
            </label>
            <input
              id="price-override-input"
              className="price-override-input"
              type="number"
              min="1"
              value={newPriceMinor}
              onChange={(e) => {
                // Whole number only — ignore fractional in-progress input
                // instead of silently truncating it via parseInt.
                const v = Number(e.target.value);
                if (e.target.value === '' || (Number.isInteger(v) && v >= 0)) {
                  setNewPriceMinor(e.target.value === '' ? 0 : v);
                  setPriceError(null);
                }
              }}
              aria-label={requiredLocalized(l10n, 'price-override-new-aria')}
            />
            {priceError && <div className="price-override-error" role="alert">{priceError}</div>}
            <div className="price-override-actions">
              <button type="button" className="price-override-cancel-btn" onClick={handleClose}>
                {requiredLocalized(l10n, 'price-override-cancel')}
              </button>
              <button
                type="button"
                className="price-override-next-btn"
                onClick={handlePriceConfirm}
                disabled={newPriceMinor <= 0}
              >
                {requiredLocalized(l10n, 'price-override-next')}
              </button>
            </div>
          </div>
        )}

        {step === 'username' && (
          <form onSubmit={handleUsernameSubmit} className="price-override-username-step">
            <p className="price-override-step-label">{requiredLocalized(l10n, 'price-override-username-label')}</p>
            <input
              ref={usernameInputRef}
              className="price-override-username-input"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={requiredLocalized(l10n, 'price-override-username-placeholder')}
              autoComplete="off"
              aria-label={requiredLocalized(l10n, 'price-override-username-aria')}
              disabled={loading}
            />
            {error && <div className="price-override-error" role="alert">{error}</div>}
            <div className="price-override-actions">
              <button type="button" className="price-override-cancel-btn" onClick={handleGoBack} disabled={loading}>
                {requiredLocalized(l10n, 'price-override-back')}
              </button>
              <button
                type="submit"
                className="price-override-next-btn"
                disabled={!username.trim() || loading}
              >
                {requiredLocalized(l10n, 'price-override-next')}
              </button>
            </div>
          </form>
        )}

        {step === 'pin' && (
          // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
          <div
            className="price-override-pin-step"
            ref={pinWrapRef}
            tabIndex={-1}
            onKeyDown={handlePinKeyDown}
            role="application"
            aria-label={requiredLocalized(l10n, 'price-override-pin-aria')}
          >
            <p className="price-override-step-label">{requiredLocalized(l10n, 'price-override-pin-label')}</p>
            {renderPinDots(pin.length)}
            {renderPinPad()}
            {error && <div className="price-override-error" role="alert">{error}</div>}
            {loading && <div className="price-override-loading" role="status">{requiredLocalized(l10n, 'price-override-verifying')}</div>}
            <div className="price-override-actions">
              <button type="button" className="price-override-cancel-btn" onClick={handleGoBack} disabled={loading}>
                {requiredLocalized(l10n, 'price-override-back')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
