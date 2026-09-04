import { useState, useRef, useEffect, useCallback } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { useOptionalTheme } from '@/frontend/shell/ThemeProvider';
import { useOptionalHardwareAccel } from '@/contexts/HardwareAccelContext';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useSwipe } from '@/hooks/useSwipe';
import type { DisplayDensity, KdsSettings } from '@/features/kds/KdsSettingsPanel';
import { useKdsCardColors } from '@/features/kds/KdsCardColorsContext';
import { requiredLocalized } from '@/frontend/shared';

interface KdsHamburgerPanelProps {
  settings: KdsSettings;
  onChangeSound: (enabled: boolean) => void;
  onChangeYellowThreshold: (minutes: number) => void;
  onChangeRedThreshold: (minutes: number) => void;
  onChangeAutoAcknowledge: (enabled: boolean) => void;
  onChangeDensity: (density: DisplayDensity) => void;
  showOrderId: boolean;
  showTableNumber: boolean;
  onToggleOrderId: (show: boolean) => void;
  onToggleTableNumber: (show: boolean) => void;
  /** Current page zoom percentage (100 = default). */
  pageZoom?: number;
  /** Called when zoom changes (percentage). */
  onChangePageZoom?: (zoom: number) => void;
  /** Current column count override (0 = auto). */
  columns?: number;
  /** Called when column count changes (0 = auto). */
  onChangeColumns?: (cols: number) => void;
  /** Whether card animations are enabled. */
  cardAnimations?: boolean;
  /** Called when card animations toggle changes. */
  onChangeCardAnimations?: (enabled: boolean) => void;
}

/**
 * KdsHamburgerPanel — hamburger icon button that opens the prototype
 * settings panel (``.kds-hamburger-panel``) with two sections:
 *
 * **Display** — theme (light/dark), density, order ID, table number
 * **Behaviour** — sound, auto-accept, yellow/red thresholds
 *
 * Uses the prototype CSS classes added in Phase 1: ``.kds-hamburger-panel``,
 * ``.kds-panel-body``, ``.kds-panel-section``, ``.kds-setting-card``,
 * ``.kds-setting-row``, ``.kds-switch``, ``.kds-theme-toggle``, etc.
 */
export function KdsHamburgerPanel({
  settings,
  onChangeSound,
  onChangeYellowThreshold,
  onChangeRedThreshold,
  onChangeAutoAcknowledge,
  onChangeDensity,
  showOrderId,
  showTableNumber,
  onToggleOrderId,
  onToggleTableNumber,
  pageZoom = 100,
  onChangePageZoom,
  columns = 0,
  onChangeColumns,
  cardAnimations = true,
  onChangeCardAnimations,
}: KdsHamburgerPanelProps) {
  const { l10n } = useLocalization();
  const themeCtx = useOptionalTheme();
  const hwAccel = useOptionalHardwareAccel();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Hex-input draft (HEX-FIX): the text input is the sole place a user can
  // type a PARTIAL colour value, so it must not be controlled straight from
  // the context value — that snaps the field back to the last valid hex and
  // makes deleting a character impossible. Keep the in-progress string in
  // local draft state; commit to the context only on a full `#rrggbb` match.
  const [hexDraft, setHexDraft] = useState<{ key: string; value: string } | null>(null);
  // Card colours from shared context.
  const { colors: cardColors, updateColor, resetColors } = useKdsCardColors();

  const close = useCallback(() => {
    if (!open || closing) return;
    setClosing(true);
    closeTimerRef.current = setTimeout(() => {
      setOpen(false);
      setClosing(false);
      closeTimerRef.current = null;
    }, 180); // match kds-drop-in duration
  }, [open, closing]);

  // Swipe right to dismiss — natural gesture for a right-anchored panel.
  const swipe = useSwipe({ onSwipeRight: close });

  // Clean up close-animation timer on unmount.
  useEffect(() => () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); }, []);

  useFocusTrap(panelRef, open && !closing, close);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        btnRef.current &&
        !btnRef.current.contains(e.target as Node)
      ) {
        close();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, close]);

  return (
    <>
      <button
        ref={btnRef}
        className="kds-btn kds-btn--icon"
        onClick={() => setOpen((p) => !p)}
        aria-label={requiredLocalized(l10n, 'kds-settings-aria')}
        aria-haspopup="true"
        aria-expanded={open || closing}
        data-testid="kds-topbar-settings"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {(open || closing) && (
        <div
          ref={panelRef}
          className={`kds-hamburger-panel${closing ? ' kds-drop-out' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={requiredLocalized(l10n, 'kds-settings-aria')}
          {...swipe}
          onAnimationEnd={() => {
            if (closing) {
              setOpen(false);
              setClosing(false);
              closeTimerRef.current = null;
            }
          }}
        >
          <div className="kds-panel-body">
            {/* ── Display ──────────────────────────────────── */}
            <div className="kds-panel-section">
              <Localized id="kds-panel-section-display"><h3>Display</h3></Localized>
              <div className="kds-setting-card">
                {themeCtx && (
                  <div className="kds-setting-row">
                    <span className="kds-setting-label"><Localized id="kds-settings-theme">Theme</Localized></span>
                    <button
                      className="kds-theme-toggle"
                      onClick={() => themeCtx.setTheme(themeCtx.theme === 'dark' ? 'light' : 'dark')}
                      title={requiredLocalized(l10n, 'kds-settings-theme-toggle-aria')}
                      aria-label={requiredLocalized(l10n, 'kds-settings-theme-toggle-aria')}
                      data-testid="kds-settings-theme-toggle"
                    >
                      <span className="kds-theme-indicator" style={{ width: themeCtx.theme === 'dark' ? '33px' : '33px', left: themeCtx.theme === 'dark' ? '3px' : '36px' }} />
                      <span className={`kds-theme-option${themeCtx.theme === 'dark' ? ' on' : ''}`} aria-label={requiredLocalized(l10n, 'kds-theme-dark-aria')}>
                        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.39 5.39 0 0 1-4.4 2.26 5.4 5.4 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z" /></svg>
                      </span>
                      <span className={`kds-theme-option${themeCtx.theme === 'light' ? ' on' : ''}`} aria-label={requiredLocalized(l10n, 'kds-theme-light-aria')}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>
                      </span>
                    </button>
                  </div>
                )}

                {onChangePageZoom && (
                  <div className="kds-setting-row">
                    <span className="kds-setting-label"><Localized id="kds-settings-display-scale">Display scale</Localized></span>
                    <div className="kds-zoom-row">
                      <button className="kds-btn kds-btn--muted kds-zoom-btn" onClick={() => onChangePageZoom(Math.max(50, pageZoom - 10))} aria-label={requiredLocalized(l10n, 'kds-zoom-out-aria')} data-testid="kds-settings-zoom-out">−</button>
                      <button className="kds-btn kds-btn--muted kds-zoom-value" onClick={() => onChangePageZoom(100)} title={requiredLocalized(l10n, 'kds-zoom-reset-title')} aria-label={requiredLocalized(l10n, 'kds-zoom-reset-aria')} data-testid="kds-settings-zoom-value">{pageZoom}%</button>
                      <button className="kds-btn kds-btn--muted kds-zoom-btn" onClick={() => onChangePageZoom(Math.min(200, pageZoom + 10))} aria-label={requiredLocalized(l10n, 'kds-zoom-in-aria')} data-testid="kds-settings-zoom-in">+</button>
                    </div>
                  </div>
                )}
                {onChangeColumns && (
                  <div className="kds-setting-row">
                    <span className="kds-setting-label"><Localized id="kds-settings-columns">Columns</Localized></span>
                    <div className="kds-zoom-row">
                      <button className="kds-btn kds-btn--muted kds-zoom-btn" onClick={() => onChangeColumns(Math.max(1, columns - 1))} aria-label={requiredLocalized(l10n, 'kds-cols-decrease-aria')} data-testid="kds-settings-cols-out">−</button>
                      <button className="kds-btn kds-btn--muted kds-zoom-value" onClick={() => onChangeColumns(0)} title={requiredLocalized(l10n, 'kds-cols-reset-title')} aria-label={requiredLocalized(l10n, 'kds-cols-reset-aria')} data-testid="kds-settings-cols-value">{columns === 0 ? requiredLocalized(l10n, 'kds-cols-auto') : columns}</button>
                      <button className="kds-btn kds-btn--muted kds-zoom-btn" onClick={() => onChangeColumns(columns + 1)} aria-label={requiredLocalized(l10n, 'kds-cols-increase-aria')} data-testid="kds-settings-cols-in">+</button>
                    </div>
                  </div>
                )}
                <div className="kds-setting-row">
                  <span className="kds-setting-label"><Localized id="kds-settings-density">Density</Localized></span>
                  <div className="kds-zoom-row">
                    {(['comfortable', 'compact'] as const).map((d) => (
                      <button
                        key={d}
                        className={`kds-btn kds-btn--muted kds-zoom-btn${d === settings.density ? ' is-active' : ''}`}
                        onClick={() => onChangeDensity(d)}
                        aria-pressed={d === settings.density}
                      >
                        <Localized id={d === 'comfortable' ? 'kds-settings-density-comfortable' : 'kds-settings-density-compact'}>{d}</Localized>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="kds-setting-row">
                  <div className="kds-setting-text">
                    <span className="kds-setting-label"><Localized id="kds-layout-order-id">Order ID</Localized></span>
                    <span className="kds-setting-caption"><Localized id="kds-layout-order-id-caption">Show order number on cards</Localized></span>
                  </div>
                  <button
                    className={`kds-switch${showOrderId ? ' on' : ''}`}
                    role="switch"
                    aria-checked={showOrderId}
                    onClick={() => onToggleOrderId(!showOrderId)}
                    aria-label={requiredLocalized(l10n, 'kds-layout-order-id')}
                  />
                </div>

                <div className="kds-setting-row">
                  <div className="kds-setting-text">
                    <span className="kds-setting-label"><Localized id="kds-layout-table-number">Table Number</Localized></span>
                    <span className="kds-setting-caption"><Localized id="kds-layout-table-number-caption">Show table number on cards</Localized></span>
                  </div>
                  <button
                    className={`kds-switch${showTableNumber ? ' on' : ''}`}
                    role="switch"
                    aria-checked={showTableNumber}
                    onClick={() => onToggleTableNumber(!showTableNumber)}
                    aria-label={requiredLocalized(l10n, 'kds-layout-table-number')}
                  />
                </div>

                {hwAccel && (
                  <div className="kds-setting-row">
                    <div className="kds-setting-text">
                      <span className="kds-setting-label"><Localized id="kds-settings-hw-accel">Hardware acceleration</Localized></span>
                      <span className="kds-setting-caption"><Localized id="kds-settings-hw-accel-caption">Blur and GPU effects</Localized></span>
                    </div>
                    <button
                      className={`kds-switch${hwAccel.enabled ? ' on' : ''}`}
                      role="switch"
                      aria-checked={hwAccel.enabled}
                      onClick={() => hwAccel.setEnabled(!hwAccel.enabled)}
                      aria-label={requiredLocalized(l10n, 'kds-settings-hw-accel')}
                      data-testid="kds-settings-hw-accel-toggle"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* ── Colours — per-theme pickers ── */}
            <div className="kds-panel-section">
              <div className="kds-section-head">
                <h3><Localized id="kds-settings-card-colours">Colours</Localized></h3>
                <span className="kds-theme-tag" data-testid="kds-settings-colors-theme-tag">{themeCtx?.theme ?? 'dark'}</span>
              </div>
              <div className="kds-setting-card">
                {([
                  { key: 'dinein' as const, labelId: 'kds-settings-color-dinein' },
                  { key: 'takeaway' as const, labelId: 'kds-settings-color-takeaway' },
                  { key: 'rush' as const, labelId: 'kds-settings-color-rush' },
                  { key: 'processing' as const, labelId: 'kds-settings-color-preparing' },
                  { key: 'prepared' as const, labelId: 'kds-settings-color-ready' },
                  { key: 'complete' as const, labelId: 'kds-settings-color-complete' },
                ]).map(({ key, labelId }) => (
                  <div className="kds-color-group" key={key}>
                    <div className="kds-color-head">
                      <label><Localized id={labelId}>{key}</Localized></label>
                      <input
                        type="color"
                        className="kds-native"
                        value={cardColors[key]}
                        onChange={(e) => {
                          setHexDraft(null); // picker wins over any draft
                          updateColor(key, e.target.value);
                        }}
                        aria-label={requiredLocalized(l10n, 'kds-color-picker-aria', { name: requiredLocalized(l10n, labelId) })}
                        data-testid={`kds-settings-colors-native-${key}`}
                      />
                      <input
                        type="text"
                        className="kds-hex-input"
                        value={hexDraft?.key === key ? hexDraft.value : cardColors[key]}
                        onChange={(e) => {
                          const v = e.target.value;
                          setHexDraft({ key, value: v });
                          if (/^#[0-9a-f]{6}$/i.test(v)) {
                            updateColor(key, v);
                            setHexDraft(null);
                          }
                        }}
                        onBlur={() => {
                          if (hexDraft?.key === key) setHexDraft(null);
                        }}
                        maxLength={7}
                        data-testid={`kds-settings-colors-hex-${key}`}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="kds-setting-card kds-reset-card">
                <button className="kds-reset-btn" onClick={() => { setHexDraft(null); resetColors(); }} data-testid="kds-settings-colors-reset">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
                  <Localized id="kds-settings-reset-colours">Reset colours</Localized>
                </button>
              </div>
            </div>

            {/* ── Behaviour (spans full width in 2-column layout) ─── */}
            <div className="kds-panel-section kds-panel-section--behaviour">
              <Localized id="kds-panel-section-behaviour"><h3>Behaviour</h3></Localized>
              <div className="kds-setting-card">
                <div className="kds-setting-row">
                  <div className="kds-setting-text">
                    <span className="kds-setting-label"><Localized id="kds-settings-sound">Sound</Localized></span>
                    <span className="kds-setting-caption"><Localized id="kds-settings-sound-caption">Chime when an order arrives</Localized></span>
                  </div>
                  <button
                    className={`kds-switch${settings.soundEnabled ? ' on' : ''}`}
                    role="switch"
                    aria-checked={settings.soundEnabled}
                    onClick={() => onChangeSound(!settings.soundEnabled)}
                    aria-label={requiredLocalized(l10n, 'kds-settings-sound')}
                  />
                </div>

                <div className="kds-setting-row">
                  <div className="kds-setting-text">
                    <span className="kds-setting-label"><Localized id="kds-settings-auto-ack">Auto-accept</Localized></span>
                    <span className="kds-setting-caption"><Localized id="kds-settings-auto-ack-caption">New orders appear without tapping Accept</Localized></span>
                  </div>
                  <button
                    className={`kds-switch${settings.autoAcknowledge ? ' on' : ''}`}
                    role="switch"
                    aria-checked={settings.autoAcknowledge}
                    onClick={() => onChangeAutoAcknowledge(!settings.autoAcknowledge)}
                    aria-label={requiredLocalized(l10n, 'kds-settings-auto-ack')}
                  />
                </div>

                {onChangeCardAnimations && (
                  <div className="kds-setting-row">
                    <div className="kds-setting-text">
                      <span className="kds-setting-label"><Localized id="kds-settings-card-animations">Card animations</Localized></span>
                      <span className="kds-setting-caption"><Localized id="kds-settings-card-animations-caption">Spawn and reorder effects</Localized></span>
                    </div>
                    <button
                      className={`kds-switch${cardAnimations ? ' on' : ''}`}
                      role="switch"
                      aria-checked={cardAnimations}
                      onClick={() => onChangeCardAnimations(!cardAnimations)}
                      aria-label={requiredLocalized(l10n, 'kds-settings-card-animations')}
                      data-testid="kds-settings-anim-toggle"
                    />
                  </div>
                )}

                {/* SLA thresholds */}
                <div className="kds-setting-row">
                  <span className="kds-setting-label"><Localized id="kds-settings-yellow" vars={{ min: settings.yellowThresholdMin }}>{`Yellow at ${settings.yellowThresholdMin} min`}</Localized></span>
                  <input
                    type="range"
                    className="kds-settings-slider"
                    min={3}
                    max={10}
                    step={1}
                    value={settings.yellowThresholdMin}
                    onChange={(e) => onChangeYellowThreshold(Number(e.target.value))}
                    aria-label={requiredLocalized(l10n, 'kds-settings-yellow-aria')}
                    aria-valuetext={l10n.getString('kds-slider-value-min', { min: settings.yellowThresholdMin })}
                  />
                </div>

                <div className="kds-setting-row">
                  <span className="kds-setting-label"><Localized id="kds-settings-red" vars={{ min: settings.redThresholdMin }}>{`Red at ${settings.redThresholdMin} min`}</Localized></span>
                  <input
                    type="range"
                    className="kds-settings-slider"
                    min={Math.max(settings.yellowThresholdMin + 1, 6)}
                    max={15}
                    step={1}
                    value={settings.redThresholdMin}
                    onChange={(e) => onChangeRedThreshold(Number(e.target.value))}
                    aria-label={requiredLocalized(l10n, 'kds-settings-red-aria')}
                    aria-valuetext={l10n.getString('kds-slider-value-min', { min: settings.redThresholdMin })}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}