import { useState, useCallback, useEffect, useRef } from 'react';
import { readScaleWeight, readScaleWeightScoped, type WeightReading } from '@/api/hardware';
import { useFeatures, FEATURES } from '@/hooks/useFeatures';
import { useToast } from '@/frontend/shared/Toast';
import { requiredLocalized } from '@/frontend/shared';
import { useLocalization } from '@fluent/react';
import { plainErrorMessage } from '@/utils/app-error';
import './WeightScaleWidget.css';

/** Props for the WeightScaleWidget — optional callback for when a stable weight is obtained, plus device identifiers. */
export interface WeightScaleWidgetProps {
  /** Session token for scoped API calls. */
  sessionToken?: string;
  onWeightObtained?: (reading: WeightReading) => void;
  vendorId?: string;
  productId?: string;
  devicePath?: string;
}

/**
 * Widget that displays the current weight from a USB HID weight scale.
 *
 * When the `WeightScale` feature is enabled, this widget shows:
 * - Current weight in grams / kilograms
 * - A stability indicator
 * - A "Weigh" button to read the scale
 */
export function WeightScaleWidget({
  sessionToken,
  onWeightObtained,
  vendorId: _vendorId = '0x0000',
  productId: _productId = '0x0000',
  devicePath: _devicePath = '/dev/hidraw0',
}: WeightScaleWidgetProps) {

  const { isEnabled } = useFeatures();
  const { addToast } = useToast();
  const { l10n } = useLocalization();
  const [reading, setReading] = useState<WeightReading | null>(null);
  const [weighing, setWeighing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  const handleWeigh = useCallback(async () => {
    setWeighing(true);
    setError(null);
    try {
      const readWeight = sessionToken ? () => readScaleWeightScoped(sessionToken) : readScaleWeight;
      const result = await readWeight();
      if (!mountedRef.current) return;
      setReading(result);
      if (result) onWeightObtained?.(result);
    } catch (err) {
      if (!mountedRef.current) return;
      const msg = plainErrorMessage(err, 'Scale read failed');
      setError(msg);
      addToast({ message: msg, type: 'error' });
    } finally {
      if (mountedRef.current) setWeighing(false);
    }
    // sessionToken is read at :52 to choose the scoped scale read, and arrives as a prop.
    // Unlike the reprint and bundle-lookup cases this one does surface a toast, so the symptom
    // after a hot-swap was a visible "Scale read failed" on working hardware.
  }, [onWeightObtained, addToast, sessionToken]);


  if (!isEnabled(FEATURES.USB_SCALE)) return null;

  const displayWeight = reading
    ? reading.weightGrams >= 1000
      ? `${(reading.weightGrams / 1000).toFixed(3)} kg`
      : `${reading.weightGrams.toFixed(1)} g`
    : null;

  return (
    <div className="weight-scale-widget" role="region" aria-label={requiredLocalized(l10n, 'weight-scale-aria')}>
      <div className="weight-scale-display">
        {displayWeight ? (
          <>
            <span className="weight-scale-value">{displayWeight}</span>
            {reading?.stable && (
              <span className="weight-scale-stable" title={requiredLocalized(l10n, 'weight-scale-stable')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </span>
            )}
            {reading && !reading.stable && (
              <span className="weight-scale-unstable" title={requiredLocalized(l10n, 'weight-scale-unstable')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
                  <line x1="12" y1="2" x2="12" y2="6" />
                  <line x1="12" y1="18" x2="12" y2="22" />
                  <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
                  <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
                  <line x1="2" y1="12" x2="6" y2="12" />
                  <line x1="18" y1="12" x2="22" y2="12" />
                  <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
                  <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
                </svg>
              </span>
            )}
          </>
        ) : error ? (
          <span className="weight-scale-error" title={error}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            {requiredLocalized(l10n, 'weight-scale-error')}
          </span>
        ) : (
          <span className="weight-scale-idle">
            {requiredLocalized(l10n, 'weight-scale-idle')}
          </span>
        )}
      </div>
      <button
        type="button"
        className="weight-scale-btn"
        onClick={handleWeigh}
        disabled={weighing}
        aria-label={requiredLocalized(l10n, 'weight-scale-weigh-aria')}
      >
        {weighing
          ? (requiredLocalized(l10n, 'weight-scale-weighing'))
          : (requiredLocalized(l10n, 'weight-scale-weigh'))}
      </button>
    </div>
  );
}
