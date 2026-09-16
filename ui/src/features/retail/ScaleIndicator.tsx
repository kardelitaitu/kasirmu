import { useState, useEffect, useCallback, useRef } from 'react';
import './ScaleIndicator.css';
import { requiredLocalized } from '@/frontend/shared';
import { useLocalization } from '@fluent/react';
import { readScaleWeight, readScaleWeightScoped, type WeightReading } from '@/api/hardware';
import type { Sku } from '@/types/domain';

interface ScaleIndicatorProps {
  /** Session token for scoped API calls. */
  sessionToken?: string;
  weighTarget: { sku: Sku; name: string } | null;
  onWeighAdd: (sku: Sku, weightGrams: number) => void;
  onClearWeighTarget: () => void;
}

/** Live scale weight indicator — polls the connected scale every 2 seconds and supports weigh-and-add for weighed products. */
export default function ScaleIndicator({ sessionToken, weighTarget, onWeighAdd, onClearWeighTarget }: ScaleIndicatorProps) {
  const { l10n } = useLocalization();
  const [reading, setReading] = useState<WeightReading | null>(null);
  const [error, setError] = useState<string | null>(null);

  const l10nRef = useRef(l10n);
  l10nRef.current = l10n;

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      if (cancelled) return;
      try {
        const readWeight = sessionToken ? () => readScaleWeightScoped(sessionToken) : readScaleWeight;
        const r = await readWeight();
        if (!cancelled) {
          setReading(r);
          setError(null);
        }
      } catch {
        if (!cancelled) setError(requiredLocalized(l10nRef.current, 'scale-read-error'));
      }
      if (!cancelled) timeoutId = setTimeout(poll, 2000);
    };
    poll();
    return () => { cancelled = true; if (timeoutId !== null) clearTimeout(timeoutId); };
  }, [sessionToken]);

  const formatWeight = (g: number): string => {
    if (g >= 1000) return `${(g / 1000).toFixed(2)} kg`;
    return `${g.toFixed(0)} g`;
  };

  const handleWeighAdd = useCallback(() => {
    if (weighTarget && reading?.stable && reading.weightGrams > 0) {
      onWeighAdd(weighTarget.sku, reading.weightGrams);
    }
  }, [weighTarget, reading, onWeighAdd]);

  if (error) {
    return (
      <div className="scale-indicator scale-indicator--error" role="status" aria-label={requiredLocalized(l10n, 'scale-indicator-aria')}>
        <span className="scale-indicator-error">{error}</span>
      </div>
    );
  }

  if (!reading) {
    return (
      <div className="scale-indicator scale-indicator--idle" role="status" aria-label={requiredLocalized(l10n, 'scale-indicator-aria')}>
        <span className="scale-indicator-label">{requiredLocalized(l10n, 'scale-idle')}</span>
      </div>
    );
  }

  return (
    <div className={`scale-indicator ${reading.stable ? 'scale-indicator--stable' : 'scale-indicator--unstable'}`} role="status" aria-label={requiredLocalized(l10n, 'scale-indicator-aria')}>
      <div className="scale-indicator-display">
        <span className={`scale-indicator-dot ${reading.stable ? 'scale-indicator-dot--stable' : 'scale-indicator-dot--unstable'}`} aria-hidden="true" />
        <span className="scale-indicator-weight">{formatWeight(reading.weightGrams)}</span>
        <span className="scale-indicator-stable-label">
          {reading.stable ? (requiredLocalized(l10n, 'scale-stable')) : (requiredLocalized(l10n, 'scale-unstable'))}
        </span>
      </div>
      {weighTarget && reading.stable && reading.weightGrams > 0 && (
        <div className="scale-indicator-actions">
          <span className="scale-indicator-target">
            <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12" aria-hidden="true">
              <path d="M10 10a4 4 0 100-8 4 4 0 000 8zm-7 8a7 7 0 1114 0H3z" />
            </svg>
            {weighTarget.name}
          </span>
          <button
            type="button"
            className="scale-indicator-add-btn"
            onClick={handleWeighAdd}
            aria-label={requiredLocalized(l10n, 'scale-weigh-add-aria', { name: weighTarget.name })}
          >
            {requiredLocalized(l10n, 'scale-weigh-add')}
          </button>
          <button
            type="button"
            className="scale-indicator-clear-btn"
            onClick={onClearWeighTarget}
            aria-label={requiredLocalized(l10n, 'scale-clear-aria')}
          >
            &times;
          </button>
        </div>
      )}
    </div>
  );
}
