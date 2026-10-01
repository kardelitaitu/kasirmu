import { useState, useEffect, useRef, useCallback, memo } from 'react';
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
type EnrollmentStep = 'form' | 'generating' | 'error';

/**
 * Exit-fade length in ms. Mirrors `var(--duration-200)` on the
 * `--exiting` rules in KdsEnrollmentModal.css — the two must stay in
 * step, or the surface unmounts mid-animation (or lingers after it).
 */
const EXIT_MS = 200;

/**
 * KdsEnrollmentModal — registers a new KDS display device.
 *
 * This is **device registration**, not routing. It answers "which physical
 * screen is this, and which stations does it display" and nothing more; the
 * shop's route and hierarchy live in the topology editor. The flow is:
 * 1. Operator enters a display name and selects stations
 * 2. The device is registered under this POS
 *
 * That is the whole flow. It used to mint a pairing token and display a QR
 * for the screen itself to scan and redeem; that design was superseded,
 * because a POS-registered screen has nothing to redeem and no secret to
 * hold. The token was never verified by any code path, so showing it as a
 * credential was actively misleading. Removed in
 * `20261014_kds_drop_pairing_tokens.sql`; reinstating a credential here
 * means writing the consumer that checks it first.
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
  const [stations, setStations] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Reset state on open.
  useEffect(() => {
    if (!isOpen) return;
    setStep('form');
    setName('');
    setStations([]);
    setStationInput('');
    setError(null);
    requestAnimationFrame(() => nameRef.current?.focus());
  }, [isOpen]);

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
      const input: RegisterKdsDeviceInput = {
        name: name.trim(),
        restaurant_pos_id: restaurantPosId,
        station_ids: stations,
      };

      const device = await registerKdsDeviceScoped(sessionToken, input);
      // Registration IS enrollment — the POS owns the device, so there is
      // nothing left for a second party to do and no secret to hand over.
      // (This used to mint a pairing token and park on a QR step; see the
      // component doc for why that was removed.)
      onEnrolled(device);
      onClose();
    } catch (e) {
      console.error('kds device enrollment failed', e);
      setError(requiredLocalized(l10n, 'kds-enrollment-failed'));
      setStep('error');
    }
  }, [name, stations, sessionToken, restaurantPosId, l10n, onEnrolled, onClose]);

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
          {step === 'error' && (
            <button
              className="kds-enrollment-done"
              onClick={onClose}
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
