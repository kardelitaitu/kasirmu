import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { requiredLocalized } from '@/components';
import { useLocalization } from '@fluent/react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { animDuration } from '@/utils/animation';
import {
  registerKdsDeviceScoped,
  type KdsDevice,
  type RegisterKdsDeviceInput,
} from '@/api/kds';
import './KdsEnrollmentModal.css';

/** Props for the KdsEnrollmentModal. */
export interface KdsEnrollmentModalProps {
  /** Session token for scoped API calls. */
  sessionToken: string;
  /** The Restaurant POS terminal ID this device is bound to. */
  restaurantPosId: string;
  /** Whether the modal is open. */
  isOpen: boolean;
  /** Called when a device is successfully enrolled. */
  onEnrolled: (device: KdsDevice) => void;
  /** Called when the modal is dismissed. */
  onClose: () => void;
}

/** Step in the enrollment flow. */
type EnrollmentStep = 'form' | 'generating' | 'qr' | 'error';

/**
 * Exit-fade length in ms. Mirrors `var(--duration-200)` on the
 * `--exiting` rules in KdsEnrollmentModal.css — the two must stay in
 * step, or the surface unmounts mid-animation (or lingers after it).
 */
const EXIT_MS = 200;

/**
 * KdsEnrollmentModal — handles new KDS device registration via QR-code
 * pairing. The flow is:
 * 1. User enters a display name and selects stations
 * 2. System generates a time-limited pairing token
 * 3. QR code is displayed for the KDS device to scan
 * 4. KDS device connects with the token, completing enrollment
 */
/**
 * Add a station name to the list. Trims whitespace, rejects empty strings and
 * duplicates. Returns the updated list (or the original if unchanged).
 * Exported for testing.
 */
export function addStationToList(
  stations: string[],
  input: string,
): string[] {
  const trimmed = input.trim();
  if (!trimmed || stations.includes(trimmed)) return stations;
  return [...stations, trimmed];
}

/**
 * Compute seconds remaining until token expiry, clamped to 0.
 * Exported for testing.
 */
export function secondsUntilExpiry(tokenExpiry: string, now: number = Date.now()): number {
  return Math.max(0, Math.floor((new Date(tokenExpiry).getTime() - now) / 1000));
}

/**
 * Whether the "Done" button in the QR/error step should fire onEnrolled.
 * Fires only when we're still on the QR step and an enrolled device exists —
 * i.e. the operator reached the QR screen and is leaving by choice, not
 * abandoning after a generation failure (error step) or without a device.
 * Exported for testing.
 */
export function shouldFireOnEnrolledOnDone(
  step: EnrollmentStep,
  enrolledDevice: KdsDevice | null,
): boolean {
  return step === 'qr' && enrolledDevice != null;
}

export const KdsEnrollmentModal = memo(function KdsEnrollmentModal({
  sessionToken,
  restaurantPosId,
  isOpen,
  onEnrolled,
  onClose,
}: KdsEnrollmentModalProps) {
  const { l10n } = useLocalization();
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, isOpen, onClose);

  // ── Exit animation (see .agents/skills/exit-animation-pattern) ──────
  // The parent owns `isOpen`, so every dismiss path (X, Cancel, Done,
  // backdrop, Escape) still calls `onClose()` synchronously — the modal
  // only defers its OWN unmount by one mirror fade. `animDuration()`
  // returns 0 under `prefers-reduced-motion`, where the CSS `--exiting`
  // rules are also gated off, so the surface snaps away instead.
  const [exiting, setExiting] = useState(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevOpenRef = useRef(isOpen);

  // Unmount cleanup: never setState against an unmounted component
  // (React 18 strict mode double-mounts in dev). Empty deps → runs only
  // on unmount, so it can never cancel the fade mid-flight.
  useEffect(() => {
    return () => {
      if (exitTimerRef.current !== null) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
    };
  }, []);

  // true → false: play the exit fade, then retire the surface.
  // false → true (reopened during the fade): cancel the pending timer and
  // drop the `--exiting` class so the modal stays put. Both branches read
  // only refs and setters, so `[isOpen]` is a complete dependency list —
  // the transition is driven purely by the parent's state.
  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = isOpen;
    if (isOpen) {
      if (exitTimerRef.current !== null) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
      setExiting(false);
      return;
    }
    if (!wasOpen) return;
    setExiting(true);
    // Rapid re-dismiss: retire the stale timer before scheduling anew.
    if (exitTimerRef.current !== null) {
      clearTimeout(exitTimerRef.current);
    }
    exitTimerRef.current = setTimeout(() => {
      exitTimerRef.current = null;
      setExiting(false);
    }, animDuration(EXIT_MS));
  }, [isOpen]);

  const [step, setStep] = useState<EnrollmentStep>('form');
  const [name, setName] = useState('');
  const [stationInput, setStationInput] = useState('');
  const [pairingToken, setPairingToken] = useState<string | null>(null);
  const [tokenExpiry, setTokenExpiry] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [stations, setStations] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [enrolledDevice, setEnrolledDevice] = useState<KdsDevice | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Reset state on open.
  useEffect(() => {
    if (!isOpen) return;
    setStep('form');
    setName('');
    setStations([]);
    setStationInput('');
    setError(null);
    setEnrolledDevice(null);
    setPairingToken(null);
    setTokenExpiry(null);
    setTimeLeft(0);
    requestAnimationFrame(() => nameRef.current?.focus());
  }, [isOpen]);

  // Countdown timer for token expiry.
  useEffect(() => {
    if (step !== 'qr' || !tokenExpiry) return;

    const tick = () => {
      const remaining = Math.max(
        0,
        Math.floor((new Date(tokenExpiry).getTime() - Date.now()) / 1000),
      );
      setTimeLeft(remaining);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [step, tokenExpiry]);

  const addStation = useCallback(() => {
    const next = addStationToList(stations, stationInput);
    if (next !== stations) {
      setStations(next);
      setStationInput('');
    }
  }, [stationInput, stations]);

  const removeStation = useCallback((station: string) => {
    setStations((prev) => prev.filter((s) => s !== station));
  }, []);

  const handleStationKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        addStation();
      }
    },
    [addStation],
  );

  const handleEnroll = useCallback(async () => {
    if (!name.trim()) return;
    setStep('generating');
    setError(null);

    try {
      // Generate a random pairing token and hash it.
      const tokenBytes = new Uint8Array(32);
      crypto.getRandomValues(tokenBytes);
      const token = Array.from(tokenBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      // SHA-256 hash the token for storage.
      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest(
        'SHA-256',
        encoder.encode(token),
      );
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const tokenHash = hashArray
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      // Token expires in 5 minutes.
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

      const input: RegisterKdsDeviceInput = {
        name: name.trim(),
        restaurant_pos_id: restaurantPosId,
        station_ids: stations,
        pairing_token_hash: tokenHash,
        pairing_expires_at: expiresAt,
      };

      const device = await registerKdsDeviceScoped(sessionToken, input);
      setEnrolledDevice(device);
      setPairingToken(token);
      setTokenExpiry(expiresAt);
      setStep('qr');
      // NOTE: onEnrolled deliberately does NOT fire here — the QR/token
      // step below is the operator's actual enrollment window, and an
      // immediate callback closed the modal before the QR was ever shown.
      // The callback fires when the operator finishes the QR step (Done).
    } catch (e) {
      console.error('kds device enrollment failed', e);
      setError(requiredLocalized(l10n, 'kds-enrollment-failed'));
      setStep('error');
    }
  }, [name, stations, sessionToken, restaurantPosId, l10n]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  // Stay mounted for exactly one exit fade after `isOpen` drops.
  if (!isOpen && !exiting) return null;

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <div
      className={`kds-enrollment-overlay${exiting ? ' kds-enrollment-overlay--exiting' : ''}`}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={requiredLocalized(l10n, 'kds-enrollment-title')}
    >
      <div
        className={`kds-enrollment-modal${exiting ? ' kds-enrollment-modal--exiting' : ''}`}
        ref={panelRef}
      >
        {/* Header */}
        <div className="kds-enrollment-header">
          <h2 className="kds-enrollment-title">
            {requiredLocalized(l10n, 'kds-enrollment-title')}
          </h2>
          <button
            className="kds-enrollment-close"
            onClick={onClose}
            aria-label={requiredLocalized(l10n, 'kds-enrollment-close-aria')}
            data-testid="kds-enrollment-close"
          >
            &times;
          </button>
        </div>

        {/* Step: Device Form */}
        {step === 'form' && (
          <div className="kds-enrollment-body">
            <div className="kds-enrollment-field">
              <label
                className="kds-enrollment-label"
                htmlFor="kds-enrollment-name"
              >
                {requiredLocalized(l10n, 'kds-enrollment-name-label')}
              </label>
              <input
                ref={nameRef}
                id="kds-enrollment-name"
                className="kds-enrollment-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={requiredLocalized(
                  l10n,
                  'kds-enrollment-name-placeholder',
                )}
                aria-label={requiredLocalized(
                  l10n,
                  'kds-enrollment-name-aria',
                )}
                data-testid="kds-enrollment-name-input"
              />
            </div>

            <div className="kds-enrollment-field">
              <label className="kds-enrollment-label">
                {requiredLocalized(l10n, 'kds-enrollment-stations-label')}
              </label>
              <div className="kds-enrollment-station-input-wrap">
                <input
                  className="kds-enrollment-input"
                  type="text"
                  value={stationInput}
                  onChange={(e) => setStationInput(e.target.value)}
                  onKeyDown={handleStationKeyDown}
                  onBlur={addStation}
                  placeholder={requiredLocalized(
                    l10n,
                    'kds-enrollment-stations-placeholder',
                  )}
                  aria-label={requiredLocalized(
                    l10n,
                    'kds-enrollment-stations-aria',
                  )}
                  data-testid="kds-enrollment-station-input"
                />
              </div>
              {stations.length > 0 && (
                <ul className="kds-enrollment-station-list">
                  {stations.map((s) => (
                    <li key={s} className="kds-enrollment-station-tag">
                      <span>{s}</span>
                      <button
                        type="button"
                        className="kds-enrollment-station-remove"
                        onClick={() => removeStation(s)}
                        aria-label={requiredLocalized(
                          l10n,
                          'kds-enrollment-station-remove-aria',
                          { station: s },
                        )}
                        data-testid="kds-enrollment-station-remove"
                      >
                        &times;
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="kds-enrollment-station-hint">
                {requiredLocalized(l10n, 'kds-enrollment-stations-hint')}
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="kds-enrollment-error" role="alert">
                <span>{error}</span>
                <button
                  type="button"
                  className="kds-enrollment-retry"
                  onClick={() => {
                    setError(null);
                    setStep('form');
                  }}
                  data-testid="kds-enrollment-error-retry"
                >
                  {requiredLocalized(l10n, 'retry')}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Step: Generating */}
        {step === 'generating' && (
          <div className="kds-enrollment-body kds-enrollment-generating">
            <div className="kds-enrollment-spinner" />
            <p>{requiredLocalized(l10n, 'kds-enrollment-generating')}</p>
          </div>
        )}

        {/* Step: QR Display */}
        {step === 'qr' && enrolledDevice && pairingToken && (
          <div className="kds-enrollment-body kds-enrollment-qr-body">
            <p className="kds-enrollment-device-name">
              {enrolledDevice.name}
            </p>
            <div className="kds-enrollment-qr-wrapper">
              <QRCodeSVG
                value={JSON.stringify({
                  device_id: enrolledDevice.id,
                  device_name: enrolledDevice.name,
                  token: pairingToken,
                  restaurant_pos_id: restaurantPosId,
                  expires_at: tokenExpiry,
                  stations: enrolledDevice.station_ids,
                })}
                size={200}
                level="M"
                /* Literal hex on purpose, not var(--token): qrcode.react writes these
                   onto SVG `fill` presentation attributes, where var() never resolves
                   — both paths are then dropped and inherit black, so the code renders
                   as a solid square. A pairing code must also stay dark-on-paper-white
                   in EVERY theme; no semantic token is theme-invariant like that. */
                bgColor="#ffffff"
                fgColor="#111827"
                aria-label={requiredLocalized(
                  l10n,
                  'kds-enrollment-qr-aria',
                  { name: enrolledDevice.name },
                )}
              />
            </div>
            <p className="kds-enrollment-success-text">
              {requiredLocalized(l10n, 'kds-enrollment-scan-instruction')}
            </p>
            <p className="kds-enrollment-expiry-note">
              {timeLeft > 0
                ? requiredLocalized(l10n, 'kds-enrollment-countdown', {
                    seconds: String(timeLeft),
                  })
                : requiredLocalized(l10n, 'kds-enrollment-expired')}
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="kds-enrollment-footer">
          {step === 'form' && (
            <>
              <button
                className="kds-enrollment-cancel"
                onClick={onClose}
                data-testid="kds-enrollment-cancel"
              >
                {requiredLocalized(l10n, 'kds-enrollment-cancel')}
              </button>
              <button
                className="kds-enrollment-confirm"
                onClick={handleEnroll}
                disabled={!name.trim()}
                data-testid="kds-enrollment-create"
              >
                {requiredLocalized(l10n, 'kds-enrollment-create-btn')}
              </button>
            </>
          )}
          {(step === 'qr' || step === 'error') && (
            <button
              className="kds-enrollment-done"
              onClick={() => {
                // H3: enrollment completes when the operator finishes the
                // QR step — this is the first point the device token has
                // actually been shown for pairing.
                if (step === 'qr' && enrolledDevice) {
                  onEnrolled(enrolledDevice);
                }
                onClose();
              }}
              data-testid="kds-enrollment-done"
            >
              {requiredLocalized(l10n, 'kds-enrollment-done')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
