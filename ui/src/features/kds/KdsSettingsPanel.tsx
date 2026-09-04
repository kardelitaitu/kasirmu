import { useState, useRef, useEffect, useCallback } from 'react';
import { requiredLocalized } from '@/frontend/shared';
import { createPortal } from 'react-dom';
import { Localized, useLocalization } from '@fluent/react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import './KdsSettingsPanel.css';

/** Number of order card columns on the KDS open tab (1–5). */
export type DisplayDensity = number;

export interface KdsSettings {
  /** Whether new-ticket sound is enabled. */
  soundEnabled: boolean;
  /** Escalation threshold in minutes before a ticket turns yellow. */
  yellowThresholdMin: number;
  /** Escalation threshold in minutes before a ticket turns red. */
  redThresholdMin: number;
  /** Whether to auto-advance tickets after a configurable delay. */
  autoAcknowledge: boolean;
  /** Number of order card columns (1–5). */
  density: DisplayDensity;
}

// eslint-disable-next-line react-refresh/only-export-components
export const DEFAULT_SETTINGS: KdsSettings = {
  soundEnabled: true,
  yellowThresholdMin: 5,
  redThresholdMin: 10,
  autoAcknowledge: false,
  density: 3,
};

interface KdsSettingsPanelProps {
  settings: KdsSettings;
  onChangeSound: (enabled: boolean) => void;
  onChangeYellowThreshold: (minutes: number) => void;
  onChangeRedThreshold: (minutes: number) => void;
  onChangeAutoAcknowledge: (enabled: boolean) => void;
  onChangeDensity: (density: DisplayDensity) => void;
}

/**
 * KdsSettingsPanel — gear icon button that opens a popover with KDS
 * settings: sound toggle, escalation thresholds, auto-accept,
 * and display density. Follows the same portal + close-on-escape +
 * click-outside pattern as KdsLayoutSwitcher.
 */
export function KdsSettingsPanel({
  settings,
  onChangeSound,
  onChangeYellowThreshold,
  onChangeRedThreshold,
  onChangeAutoAcknowledge,
  onChangeDensity,
}: KdsSettingsPanelProps) {
  const { l10n } = useLocalization();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // A11Y-02: complete dialog semantics via the shared trap — initial focus,
  // Tab containment, Escape, scroll lock, and focus restoration.
  useFocusTrap(popoverRef, open, close);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        btnRef.current &&
        !btnRef.current.contains(e.target as Node)
      ) {
        close();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open, close]);

  return (
    <>
      <button
        ref={btnRef}
        className="kds-settings-btn"
        onClick={() => setOpen((p) => !p)}
        aria-label={requiredLocalized(l10n, 'kds-settings-aria')}
        aria-expanded={open}
      >
        <svg className="kds-settings-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      </button>
      {open && createPortal(
        <div
          ref={popoverRef}
          className="kds-settings-popover"
          role="dialog"
          aria-modal="true"
          aria-label={requiredLocalized(l10n, 'kds-settings-aria')}
        >
          {/* Sound toggle */}
          <label className="kds-settings-toggle" aria-label={requiredLocalized(l10n, 'kds-settings-sound')}>
            <input
              type="checkbox"
              role="switch"
              checked={settings.soundEnabled}
              onChange={(e) => onChangeSound(e.target.checked)}
            />
            <span className="kds-settings-toggle-label"><Localized id="kds-settings-sound">Sound</Localized></span>
          </label>

          {/* Yellow threshold slider */}
          <div className="kds-settings-slider-group">
            <Localized id="kds-settings-yellow" vars={{ min: settings.yellowThresholdMin }}>
              <span className="kds-settings-slider-label">{`Yellow at ${settings.yellowThresholdMin} min`}</span>
            </Localized>
            <input
              type="range"
              className="kds-settings-slider"
              min={3}
              max={10}
              step={1}
              value={settings.yellowThresholdMin}
              onChange={(e) => onChangeYellowThreshold(Number(e.target.value))}
              aria-label={requiredLocalized(l10n, 'kds-settings-yellow-aria')}
            />
          </div>

          {/* Red threshold slider */}
          <div className="kds-settings-slider-group">
            <Localized id="kds-settings-red" vars={{ min: settings.redThresholdMin }}>
              <span className="kds-settings-slider-label">{`Red at ${settings.redThresholdMin} min`}</span>
            </Localized>
            <input
              type="range"
              className="kds-settings-slider"
              min={Math.max(settings.yellowThresholdMin + 1, 6)}
              max={15}
              step={1}
              value={settings.redThresholdMin}
              onChange={(e) => onChangeRedThreshold(Number(e.target.value))}
              aria-label={requiredLocalized(l10n, 'kds-settings-red-aria')}
            />
          </div>

          {/* Auto-accept toggle */}
          <label className="kds-settings-toggle" aria-label={requiredLocalized(l10n, 'kds-settings-auto-ack')}>
            <input
              type="checkbox"
              role="switch"
              checked={settings.autoAcknowledge}
              onChange={(e) => onChangeAutoAcknowledge(e.target.checked)}
            />
            <span className="kds-settings-toggle-label"><Localized id="kds-settings-auto-ack">Auto-accept</Localized></span>
          </label>

          {/* Column count */}
          <div className="kds-settings-density">
            <span className="kds-settings-slider-label"><Localized id="kds-settings-density">Column</Localized></span>
            <div className="kds-settings-density-options">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  className={`kds-settings-density-btn ${n === settings.density ? 'kds-settings-density-btn--active' : ''}`}
                  onClick={() => onChangeDensity(n)}
                  aria-pressed={n === settings.density}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
