import { useState, useRef, useEffect, useCallback } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { useOptionalTheme } from '@/frontend/shell/ThemeProvider';
import { useOptionalHardwareAccel } from '@/contexts/HardwareAccelContext';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useSwipe } from '@/hooks/useSwipe';
import type { DisplayDensity, KdsSettings } from '@/features/kds/kdsSettingsModel';
import { RED_MAX_MIN, YELLOW_MAX_MIN } from '@/features/kds/kdsThresholdMinutes';
import { useKdsCardColors } from '@/features/kds/KdsCardColorsContext';
import { KdsRoutingRulesSection } from '@/features/kds/components/KdsRoutingRulesEditor';
import { requiredLocalized } from '@/components';

/** Custom flex-based slider: track div + fill div + knob div. */
function KdsSlider({ value, min, max, onChange, onDragValue, color, ariaLabel, ariaValueText, dataTestId }: {
  value: number; min: number; max: number;
  onChange: (v: number) => void; onDragValue?: (v: number | null) => void;
  color: string; ariaLabel: string; ariaValueText?: string; dataTestId?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const dragPctRef = useRef<number | null>(null);
  const minRef = useRef(min);
  const maxRef = useRef(max);
  const onChangeRef = useRef(onChange);
  const onDragValueRef = useRef(onDragValue);
  // Keep refs current so event listeners always read latest values
  // without needing to re-attach them.
  minRef.current = min;
  maxRef.current = max;
  onChangeRef.current = onChange;
  onDragValueRef.current = onDragValue;
  const [, setDragTrigger] = useState(0);
  const range = max - min || 1; // NaN guard: treat min===max as range=1
  const pct = range > 0 ? ((value - min) / range) * 100 : 0;
  const displayPct = dragPctRef.current ?? pct;

  const pctToVal = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return minRef.current;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return minRef.current + ratio * (maxRef.current - minRef.current);
  }, []);

  // Single listener attachment — never needs to re-run because
  // all mutable values are read from refs.
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current) return;
      const lo = minRef.current, hi = maxRef.current;
      const r = pctToVal(e.clientX);
      dragPctRef.current = ((r - lo) / (hi - lo || 1)) * 100;
      setDragTrigger((t) => t + 1);
      onDragValueRef.current?.(Math.round(Math.max(lo, Math.min(hi, r))));
    };
    const touchMove = (e: TouchEvent) => {
      if (!dragging.current) return;
      const lo = minRef.current, hi = maxRef.current;
      const r = pctToVal(e.touches[0]!.clientX);
      dragPctRef.current = ((r - lo) / (hi - lo || 1)) * 100;
      setDragTrigger((t) => t + 1);
      onDragValueRef.current?.(Math.round(Math.max(lo, Math.min(hi, r))));
    };
    const up = (e: MouseEvent | TouchEvent) => {
      if (!dragging.current) return;
      dragging.current = false;
      dragPctRef.current = null;
      const clientX = 'changedTouches' in e ? e.changedTouches[0]!.clientX : e.clientX;
      const lo = minRef.current, hi = maxRef.current;
      const snapped = Math.round(Math.max(lo, Math.min(hi, pctToVal(clientX))));
      onChangeRef.current(snapped);
      onDragValueRef.current?.(null);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('touchmove', touchMove, { passive: true });
    window.addEventListener('touchend', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('touchmove', touchMove);
      window.removeEventListener('touchend', up);
    };
  }, [pctToVal]); // stable — deps are all refs

  return (
    <div
      ref={trackRef}
      className="kds-slider-track"
      onMouseDown={(e) => { dragging.current = true; const lo = minRef.current, hi = maxRef.current; const r = pctToVal(e.clientX); dragPctRef.current = ((r - lo) / (hi - lo || 1)) * 100; setDragTrigger((t) => t + 1); }}
      onTouchStart={(e) => { dragging.current = true; const lo = minRef.current, hi = maxRef.current; const r = pctToVal(e.touches[0]!.clientX); dragPctRef.current = ((r - lo) / (hi - lo || 1)) * 100; setDragTrigger((t) => t + 1); }}
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={ariaValueText}
      tabIndex={0}
      data-testid={dataTestId}
      onKeyDown={(e) => {
        const lo = minRef.current, hi = maxRef.current;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onChangeRef.current(Math.min(hi, value + 1)); }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onChangeRef.current(Math.max(lo, value - 1)); }
      }}
    >
      <div className="kds-slider-rail">
        <div className="kds-slider-fill" style={{ width: `${displayPct}%`, background: color }} />
        <div className="kds-slider-knob" style={{ left: `${displayPct}%`, borderColor: color }} />
      </div>
    </div>
  );
}

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
  // Live preview values while dragging sliders (null = not dragging)
  const [dragYellow, setDragYellow] = useState<number | null>(null);
  const [dragRed, setDragRed] = useState<number | null>(null);
  // Card colours from shared context.
  const { colors: cardColors, updateColor, resetColors } = useKdsCardColors();

  // Close uses refs so the callback identity is stable — no
  // unnecessary listener teardown/re-attach on every open/close.
  const openRef = useRef(open);
  const closingRef = useRef(closing);
  openRef.current = open;
  closingRef.current = closing;

  const close = useCallback(() => {
    if (!openRef.current || closingRef.current) return;
    setClosing(true);
    closeTimerRef.current = setTimeout(() => {
      setOpen(false);
      setClosing(false);
      closeTimerRef.current = null;
    }, 180); // match kds-drop-in duration
  }, []); // stable — reads from refs

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
        >
          <div className="kds-panel-body">
            {/* ── Display ──────────────────────────────────── */}
            <div className="kds-panel-section">
              <Localized id="kds-panel-section-settings"><h3>Settings</h3></Localized>
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
                      {/* 37px = 34px option cell + 3px track padding — see .kds-theme-toggle. */}
                      <span className="kds-theme-indicator" style={{ left: themeCtx.theme === 'dark' ? '3px' : '37px' }} />
                      <span className={`kds-theme-option${themeCtx.theme === 'dark' ? ' on' : ''}`} aria-label={requiredLocalized(l10n, 'kds-theme-dark-aria')}>
                        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.39 5.39 0 0 1-4.4 2.26 5.4 5.4 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z" /></svg>
                      </span>
                      <span className={`kds-theme-option${themeCtx.theme === 'light' ? ' on' : ''}`} aria-label={requiredLocalized(l10n, 'kds-theme-light-aria')}>
                        {/* 18px square on a 24 viewBox, centred in the 34px cell. Glyphs are
                            deliberately matched: both span 18/24 units (75%) of their box, so the
                            moon and sun render the same optical size. (The previous sun used
                            viewBox="0 0 50 50" with artwork in 32 of 50 units and came out 15%
                            smaller than the moon at the shared width.) */}
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <circle cx="12" cy="12" r="5.09677" fill="currentColor" />
                          <path fillRule="evenodd" clipRule="evenodd" d="M12.9556 3.08065C12.9556 2.55286 12.5277 2.125 12 2.125C11.4722 2.125 11.0443 2.55286 11.0443 3.08065L11.0443 5.64078C11.3561 5.59432 11.6753 5.57024 12 5.57024C12.3247 5.57024 12.6438 5.59431 12.9556 5.64076L12.9556 3.08065ZM12.9556 18.3594C12.6438 18.4059 12.3247 18.4299 12 18.4299C11.6753 18.4299 11.3561 18.4058 11.0443 18.3594L11.0443 20.9194C11.0443 21.4471 11.4722 21.875 12 21.875C12.5277 21.875 12.9556 21.4471 12.9556 20.9194L12.9556 18.3594Z" fill="currentColor" />
                          <path fillRule="evenodd" clipRule="evenodd" d="M20.9194 12.9556C21.4471 12.9556 21.875 12.5277 21.875 12C21.875 11.4722 21.4471 11.0443 20.9194 11.0443L18.3592 11.0443C18.4057 11.3561 18.4298 11.6753 18.4298 12C18.4298 12.3247 18.4057 12.6438 18.3592 12.9556L20.9194 12.9556ZM5.6406 12.9556C5.59415 12.6438 5.57008 12.3247 5.57008 12C5.57008 11.6753 5.59416 11.3561 5.64062 11.0443L3.08064 11.0443C2.55286 11.0443 2.125 11.4722 2.125 12C2.125 12.5277 2.55286 12.9556 3.08064 12.9556L5.6406 12.9556Z" fill="currentColor" />
                          <path fillRule="evenodd" clipRule="evenodd" d="M18.9828 6.36876C19.356 5.99555 19.356 5.39047 18.9828 5.01727C18.6096 4.64407 18.0045 4.64407 17.6313 5.01727L15.8209 6.82764C16.0743 7.01528 16.3169 7.22391 16.5466 7.45354C16.7762 7.68315 16.9848 7.92581 17.1724 8.17912L18.9828 6.36876ZM8.17898 17.1725C7.92567 16.9849 7.68302 16.7763 7.45341 16.5467C7.22378 16.3171 7.01514 16.0744 6.82751 15.8211L5.01742 17.6311C4.64422 18.0043 4.64422 18.6094 5.01742 18.9826C5.39062 19.3558 5.9957 19.3558 6.36891 18.9826L8.17898 17.1725Z" fill="currentColor" />
                          <path fillRule="evenodd" clipRule="evenodd" d="M6.36888 5.01722C5.99568 4.64402 5.3906 4.64402 5.01739 5.01722C4.64419 5.39043 4.64419 5.99551 5.01739 6.36871L6.82776 8.17908C7.0154 7.92574 7.22403 7.68306 7.45366 7.45342C7.68327 7.22381 7.92593 7.0152 8.17924 6.82758L6.36888 5.01722ZM17.1727 15.821C16.9851 16.0743 16.7764 16.317 16.5468 16.5466C16.3172 16.7762 16.0745 16.9849 15.8212 17.1725L17.6313 18.9826C18.0045 19.3558 18.6095 19.3558 18.9828 18.9826C19.356 18.6094 19.356 18.0043 18.9828 17.6311L17.1727 15.821Z" fill="currentColor" />
                        </svg>
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
                  <span className="kds-setting-label"><Localized id="kds-settings-density">Column</Localized></span>
                  <div className="kds-zoom-row">
                    <button className="kds-btn kds-btn--muted kds-zoom-btn" onClick={() => onChangeDensity(Math.max(1, settings.density - 1))} disabled={settings.density <= 1} aria-label="Decrease columns" data-testid="kds-settings-density-out">−</button>
                    <span className="kds-zoom-value" data-testid="kds-settings-density-value">{settings.density}</span>
                    <button className="kds-btn kds-btn--muted kds-zoom-btn" onClick={() => onChangeDensity(Math.min(5, settings.density + 1))} disabled={settings.density >= 5} aria-label="Increase columns" data-testid="kds-settings-density-in">+</button>
                  </div>
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
                    data-testid="kds-settings-auto-ack-toggle"
                  />
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
                    data-testid="kds-settings-show-order-id-toggle"
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
                    data-testid="kds-settings-show-table-number-toggle"
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
                        className={`kds-hex-input${hexDraft?.key === key && hexDraft.value && !/^#[0-9a-f]{6}$/i.test(hexDraft.value) ? ' kds-hex-input--invalid' : ''}`}
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
                        aria-invalid={hexDraft?.key === key && hexDraft.value && !/^#[0-9a-f]{6}$/i.test(hexDraft.value) ? 'true' : undefined}
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
                    data-testid="kds-settings-sound-toggle"
                  />
                </div>

                {/* SLA thresholds — fixed ranges */}
                <div className="kds-setting-row kds-setting-row--slider">
                  <div className="kds-slider-header">
                    <span className="kds-setting-label"><Localized id="kds-settings-yellow">Yellow</Localized></span>
                    <span className="kds-slider-value kds-slider-value--warning">{l10n.getString('kds-slider-value-min', { min: dragYellow ?? settings.yellowThresholdMin })}</span>
                  </div>
                  <KdsSlider
                    min={3}
                    max={YELLOW_MAX_MIN}
                    value={settings.yellowThresholdMin}
                    onChange={onChangeYellowThreshold}
                    onDragValue={(v) => setDragYellow(v || null)}
                    color="var(--kds-warning, #fd9426)"
                    ariaLabel={requiredLocalized(l10n, 'kds-settings-yellow-aria')}
                    ariaValueText={l10n.getString('kds-slider-value-min', { min: settings.yellowThresholdMin })}
                    dataTestId="kds-settings-yellow-slider"
                  />
                </div>

                <div className="kds-setting-row kds-setting-row--slider">
                  <div className="kds-slider-header">
                    <span className="kds-setting-label"><Localized id="kds-settings-red">Red</Localized></span>
                    <span className="kds-slider-value kds-slider-value--danger">{l10n.getString('kds-slider-value-min', { min: dragRed ?? settings.redThresholdMin })}</span>
                  </div>
                  <KdsSlider
                    min={4}
                    max={RED_MAX_MIN}
                    value={settings.redThresholdMin}
                    onChange={onChangeRedThreshold}
                    onDragValue={(v) => setDragRed(v || null)}
                    color="var(--kds-danger, #fc3d39)"
                    ariaLabel={requiredLocalized(l10n, 'kds-settings-red-aria')}
                    ariaValueText={l10n.getString('kds-slider-value-min', { min: settings.redThresholdMin })}
                    dataTestId="kds-settings-red-slider"
                  />
                </div>
              </div>
            </div>

            {/* ── Routing rules — whole-set rule editor over the scoped
                get/save_kds_routing_rules_scoped IPC (todo-kds-agents-1 UI
                follow-up). The section owns its collapse + session wiring;
                the panel only mounts it. ─── */}
            <KdsRoutingRulesSection />
          </div>
        </div>
      )}
    </>
  );
}