import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import {
  getBrandSettingsScoped,
  setBrandPrimaryColour,
  setBrandLogoPath,
  setBrandStoreName,
  pickLogoFile,
} from '@/api/branding';
import { useBrand } from '@/contexts/BrandContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { deriveAccentPalette, applyAccentPalette } from '@/utils/color';
import { Button } from '@/components/Button';
import { useAppZoom } from '@/contexts/ZoomContext';
import type { ZoomLevel } from '@/contexts/ZoomContext';
import { useHardwareAccel } from '@/contexts/HardwareAccelContext';
import { useToast, useContextMenu, ContextMenu, ConfirmDialog, requiredLocalized } from '@/frontend/shared';
import SettingsSelect from './SettingsSelect';
import './AppearanceSettings.css';

// ── Helpers ──────────────────────────────────────────────────────────

const DEFAULT_COLOUR = '#147EFB';

/**
 * Normalise a hex colour string to `#rrggbb` lowercase format.
 * Accepts shorthand `#fff`, with or without `#`, and strips invalid characters.
 * Returns `null` if the input is completely unparseable.
 */
function normaliseHex(raw: string): string | null {
  let hex = raw.replace(/[^0-9a-fA-F]/g, '');
  if (hex.length === 0) return null;
  if (hex.length <= 3) {
    // Expand shorthand: 'fff' → 'ffffff'
    hex = hex.split('').map((c) => c + c).join('');
  }
  if (hex.length > 6) hex = hex.slice(0, 6);
  if (hex.length < 6) hex = hex.padEnd(6, '0');
  return `#${hex.toLowerCase()}`;
}

interface AppearanceSettingsProps {
  embedded?: boolean;
  colour?: string;
  storeName?: string;
  onColourChange?: (c: string) => void;
  onStoreNameChange?: (n: string) => void;
}

/** Brand appearance panel — primary colour picker, logo upload, store name, interface zoom, and a live preview of the resulting palette. */
export function AppearanceSettings({
  embedded = false,
  colour: colourProp,
  storeName: storeNameProp,
  onColourChange,
  onStoreNameChange,
}: AppearanceSettingsProps) {
  const { refreshBrandSettings } = useBrand();
  const [colour, setColour] = useState('#147EFB');
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [storeName, setStoreName] = useState('');
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const { zoomLevel, setZoomLevel } = useAppZoom();
  const { enabled: hwAccelEnabled, setEnabled: setHwAccelEnabled } = useHardwareAccel();
  const { addToast } = useToast();
  // Brand setters are session-scoped (SETTINGS_EDIT) — the unscoped
  // commands are not registered, so every save needs the live token.
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken ?? '';
  const cm = useContextMenu();
  const cmInput = useMemo(() => ({
    autoComplete: 'off' as const,
    autoCorrect: 'off' as const,
    spellCheck: false as const,
    'data-gramm': 'false' as const,
    onContextMenu: (e: React.MouseEvent<HTMLInputElement>) => cm.open(e, e.currentTarget),
  }), [cm]);

  useEffect(() => {
    if (embedded) return;
    getBrandSettingsScoped(sessionToken).then((s) => {
      setColour(s.primary_colour);
      setLogoPath(s.logo_path);
      setStoreName(s.store_name);
    });
  }, [embedded, sessionToken]);

  // In embedded mode, sync the logo path from BrandContext so the
  // preview shows the previously uploaded logo on re-visit.
  const { settings: brandCtx } = useBrand();
  useEffect(() => {
    if (embedded && brandCtx.logo_path !== undefined) {
      setLogoPath(brandCtx.logo_path);
    }
  }, [embedded, brandCtx.logo_path]);

  const activeColour = embedded ? (colourProp ?? colour) : colour;
  const activeStoreName = embedded ? (storeNameProp ?? storeName) : storeName;

  // Contrast text is absolute — light accent needs dark text, dark accent needs
  // light text, regardless of theme. Centralised as CSS variables instead of
  // duplicated inline styles.
  const isLightBg = parseInt(activeColour.slice(1), 16) > 0x7fffff;
  const previewBtnText = isLightBg ? '#0a0a0a' : '#ffffff';

  const updateColour = useCallback((c: string) => {
    if (embedded) {
      onColourChange?.(c);
    } else {
      setColour(c);
    }
    const palette = deriveAccentPalette(c);
    applyAccentPalette(palette);
  }, [embedded, onColourChange]);

  // ── Localized helper for reset button tooltip ─────────────
  const { l10n } = useLocalization();

  const updateStoreName = useCallback((n: string) => {
    if (embedded) {
      onStoreNameChange?.(n);
    } else {
      setStoreName(n);
    }
  }, [embedded, onStoreNameChange]);

  const handlePickLogo = useCallback(async () => {
    try {
      const path = await pickLogoFile();
      if (path) {
        setLogoPath(path);
        await setBrandLogoPath(sessionToken, path);
        refreshBrandSettings();
      }
    } catch {
      // File picker dialog was dismissed or failed — no action needed.
    }
  }, [refreshBrandSettings, sessionToken]);

  const colourRef = useRef(activeColour);
  colourRef.current = activeColour;
  const nameRef = useRef(activeStoreName);
  nameRef.current = activeStoreName;

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await setBrandPrimaryColour(sessionToken, colourRef.current);
      await setBrandStoreName(sessionToken, nameRef.current);
      refreshBrandSettings();
      addToast({ message: l10n.getString('appearance-save-success'), type: 'success' });
    } catch {
      addToast({ message: l10n.getString('appearance-save-failed'), type: 'error' });
    } finally {
      setSaving(false);
    }
  }, [refreshBrandSettings, addToast, l10n, sessionToken]);

  const handleResetAll = useCallback(() => {
    setShowResetConfirm(true);
  }, []);

  const handleConfirmReset = useCallback(async () => {
    setShowResetConfirm(false);
    setResetting(true);
    try {
      // Update parent state in embedded mode so SettingsPage tracks changes.
      if (embedded) {
        onColourChange?.(DEFAULT_COLOUR);
        onStoreNameChange?.('');
      } else {
        setColour(DEFAULT_COLOUR);
        setStoreName('');
      }
      setLogoPath(null);

      // Persist changes via backend.
      await setBrandPrimaryColour(sessionToken, DEFAULT_COLOUR);
      await setBrandStoreName(sessionToken, '');
      await setBrandLogoPath(sessionToken, '');

      // Refresh brand context and apply palette.
      refreshBrandSettings();
      const palette = deriveAccentPalette(DEFAULT_COLOUR);
      applyAccentPalette(palette);

      addToast({ message: l10n.getString('appearance-reset-all-success'), type: 'success' });
    } catch {
      addToast({ message: l10n.getString('appearance-reset-all-failed'), type: 'error' });
    } finally {
      setResetting(false);
    }
  }, [embedded, onColourChange, onStoreNameChange, refreshBrandSettings, addToast, l10n, sessionToken]);

  // ── Card body slices (shared between embedded and non-embedded) ──
  // Defined after all callbacks to avoid TDZ errors.

  const brandingFields = (
    <>
      <div className="settings-field settings-field--horizontal">
        <label htmlFor="brand-colour" className="settings-label">
          <Localized id="appearance-primary-colour">Primary Colour</Localized>
        </label>
        <span className="settings-field-input-wrap">
          <div className="appearance-colour-row">
            <Localized id="appearance-primary-colour-picker-aria" attrs={{ 'aria-label': true }}>
              <input
                id="brand-colour"
                type="color"
                value={activeColour}
                onChange={(e) => updateColour(e.target.value)}
                aria-label={l10n.getString('primary-colour-picker-aria')}
                className="appearance-colour-picker"
              />
            </Localized>
            <Localized id="appearance-colour-hex-aria" attrs={{ 'aria-label': true }}>
              <input
                id="appearance-colour-hex"
                name="appearance-colour-hex"
                type="text"
                value={activeColour}
                onChange={(e) => {
                  const normalised = normaliseHex(e.target.value);
                  if (normalised) updateColour(normalised);
                }}
                className="appearance-colour-hex settings-input"
                aria-label={l10n.getString('colour-hex-aria')}
                {...cmInput}
              />
            </Localized>
            <Localized id="appearance-reset-colour-aria" attrs={{ 'aria-label': true }}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                iconOnly
                className="appearance-colour-reset"
                onClick={() => updateColour(DEFAULT_COLOUR)}
                aria-label={l10n.getString('reset-colour-aria')}
                title={l10n.getString('appearance-reset-colour')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
                </svg>
              </Button>
            </Localized>
          </div>
        </span>
      </div>

      <div className="settings-field settings-field--horizontal">
        <span className="settings-label">
          <Localized id="appearance-logo">Store Logo</Localized>
        </span>
        <span className="settings-field-input-wrap">
          <div className="appearance-logo-row">
            {logoPath && (
              <Localized id="appearance-logo-alt" attrs={{ alt: true }}>
                <img
                  src={`file://${logoPath}`}
                  alt="Store logo"
                  className="appearance-logo-preview"
                />
              </Localized>
            )}
            <Localized id="appearance-choose-logo-aria" attrs={{ 'aria-label': true }}>
              <Button variant="secondary" onClick={handlePickLogo} aria-label={l10n.getString('pick-logo-aria')}>
                <Localized id="appearance-choose-logo">Choose Logo</Localized>
              </Button>
            </Localized>
            {logoPath && <span className="appearance-logo-path">{logoPath}</span>}
          </div>
        </span>
      </div>

      <div className="settings-field settings-field--horizontal">
        <label htmlFor="store-name-display" className="settings-label">
          <Localized id="appearance-store-name">Display Store Name</Localized>
        </label>
        <span className="settings-field-input-wrap">
          <input
            id="store-name-display"
            type="text"
            value={activeStoreName}
            onChange={(e) => updateStoreName(e.target.value)}
            className="settings-input"
            {...cmInput}
          />
        </span>
      </div>
    </>
  );

  const interfaceFields = (
    <>
      <div className="settings-field settings-field--horizontal">
        <label htmlFor="interface-zoom" className="settings-label">
          <Localized id="appearance-interface-zoom">Interface Zoom</Localized>
        </label>
        <span className="settings-field-input-wrap">
          <SettingsSelect
            id="interface-zoom"
            value={zoomLevel}
            onChange={(v) => setZoomLevel(v as ZoomLevel)}
            options={[
              { value: 'auto', label: l10n.getString('appearance-zoom-auto') },
              { value: '100', label: l10n.getString('appearance-zoom-100') },
              { value: '125', label: l10n.getString('appearance-zoom-125') },
              { value: '150', label: l10n.getString('appearance-zoom-150') },
              { value: '200', label: l10n.getString('appearance-zoom-200') },
            ]}
          />
        </span>
      </div>

      <div className="settings-field settings-field--horizontal">
        <label htmlFor="hw-accel-checkbox" className="settings-label">
          <Localized id="appearance-hw-accel">Hardware Acceleration</Localized>
        </label>
        <span className="settings-field-input-wrap">
          <label className="settings-toggle" htmlFor="hw-accel-checkbox">
            <span className="sr-only">{requiredLocalized(l10n, 'toggle')}</span>
            <span className="settings-toggle-switch">
              <Localized id="appearance-hw-accel-aria" attrs={{ 'aria-label': true }}>
                <input
                  id="hw-accel-checkbox"
                  type="checkbox"
                  role="switch"
                  checked={hwAccelEnabled}
                  aria-checked={hwAccelEnabled}
                  onChange={(e) => setHwAccelEnabled(e.target.checked)}
                />
              </Localized>
              <span className="settings-toggle-slider" />
            </span>
          </label>
          <p className="settings-hint">
            <Localized id="appearance-hw-accel-hint">
              <span>Disable if UI animations feel janky on low-end devices</span>
            </Localized>
          </p>
        </span>
      </div>
    </>
  );

  const previewFields = (
    <>
      <div className="appearance-preview">
        <div
          className="appearance-preview-box"
          style={{
            '--preview-colour': activeColour,
            '--preview-btn-text': previewBtnText,
            '--preview-colour-alpha-10': `${activeColour}1a`,
            '--preview-colour-alpha-20': `${activeColour}33`,
          } as React.CSSProperties}
        >
          <div className="appearance-preview-sample">
            <span className="appearance-preview-text">
              {activeStoreName ? activeStoreName : <Localized id="appearance-store-name-fallback"><span>OZ-POS</span></Localized>}
            </span>
          </div>
          <div className="appearance-preview-elements">
            <button
              type="button"
              className="appearance-preview-btn"
              disabled
            >
              <Localized id="appearance-preview-btn-label">Primary Button</Localized>
            </button>
            <button
              type="button"
              className="appearance-preview-btn-outline"
              disabled
            >
              <Localized id="appearance-preview-btn-outline-label">Secondary</Localized>
            </button>
            <span className="appearance-preview-badge">
              <Localized id="appearance-preview-badge-label">Live</Localized>
            </span>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <>
      {cm.menu && (
        <ContextMenu
          menu={cm.menu}
          menuRef={cm.menuRef}
          onCopy={cm.handleCopy}
          onPaste={cm.handlePaste}
          onClose={cm.close}
        />
      )}
      <ConfirmDialog
        open={showResetConfirm}
        title={l10n.getString('appearance-reset-all-confirm-title')}
        message={l10n.getString('appearance-reset-all-confirm')}
        variant="danger"
        onConfirm={handleConfirmReset}
        onCancel={() => setShowResetConfirm(false)}
      />
      <div className="card card--padding-md card--shadow-sm">
        <div className="card-header">
          <h2 className="settings-section-title">
            <Localized id="appearance-interface">Interface</Localized>
          </h2>
        </div>
        <div className="settings-form">
          {interfaceFields}
        </div>
      </div>

      <div className="card card--padding-md card--shadow-sm">
        <div className="card-header">
          <h2 className="settings-section-title">
            <Localized id="appearance-branding">Branding</Localized>
          </h2>
        </div>
        <div className="settings-form">
          {brandingFields}
        </div>
      </div>

      <div className="card card--padding-md card--shadow-sm">
        <div className="card-header">
          <h2 className="settings-section-title">
            <Localized id="appearance-preview-heading">Preview</Localized>
          </h2>
        </div>
        <div className="settings-form">
          {!embedded && (
            <div className="appearance-reset-actions">
              <Localized id="appearance-reset-all-aria" attrs={{ 'aria-label': true }}>
                  <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  className="appearance-reset-all-btn"
                  onClick={handleResetAll}
                  disabled={resetting}
                  aria-label={l10n.getString('reset-appearance-aria')}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
                    <polyline points="1 4 1 10 7 10" />
                    <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
                  </svg>
                  <Localized id="appearance-reset-all">Reset all to defaults</Localized>
                </Button>
              </Localized>
            </div>
          )}
          {previewFields}
          {!embedded && (
            <div className="settings-actions">
              <Localized id="appearance-save-aria" attrs={{ 'aria-label': true }}>
                <Button variant="primary" onClick={save} disabled={saving} aria-label={l10n.getString('save-appearance-aria')}>
                  <Localized id="save">Save</Localized>
                </Button>
              </Localized>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
