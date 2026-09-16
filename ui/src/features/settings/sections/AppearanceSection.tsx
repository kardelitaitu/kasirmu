// DEAD (2026-09-15 · HEAD f0ad9b170e): the route is closed — no `appearance` key exists among the 14 in
// SETTINGS_SCREENS (screens/registry.ts:27-42), so renderSection (SettingsPage.tsx:63-66) can never
// mount it. Nothing in production imports it; its tests grade UI no user can reach. A SECOND unmounted
// copy of the same UI lives at ../AppearanceSettings.tsx, which IS registered as a screen at
// __tests__/screenExtraction.test.ts:651-653 — two orphan bodies of one interface, neither reachable.
// Comment only — the code below is deliberately untouched.
import { Localized } from '@fluent/react';
import type { ReactLocalization } from '@fluent/react';
import { Card } from '@/components/Card';
import SettingsSelect from '../SettingsSelect';
import { AppearanceSettings } from '../AppearanceSettings';
import { deriveAccentPalette, applyAccentPalette, clearAccentPalette, applyThemeContrasts } from '@/utils/color';

export interface AppearanceSectionProps {
  displayCardSize: number;
  setDisplayCardSize: (s: number | ((prev: number) => number)) => void;
  displayFontSize: number;
  setDisplayFontSize: (s: number | ((prev: number) => number)) => void;
  displayFontSmoothing: string;
  setDisplayFontSmoothing: (v: string) => void;
  brandColour: string;
  setBrandColour: (c: string) => void;
  brandStoreName: string;
  setBrandStoreName: (n: string) => void;
  markDirty: () => void;
  l10n: ReactLocalization;
}

export default function AppearanceSection({
  displayCardSize,
  setDisplayCardSize,
  displayFontSize,
  setDisplayFontSize,
  displayFontSmoothing,
  setDisplayFontSmoothing,
  brandColour,
  setBrandColour,
  brandStoreName,
  setBrandStoreName,
  markDirty,
  l10n,
}: AppearanceSectionProps) {
  return (
    <>
      {/* ── Display section ────────────────────── */}
      <Card
        shadow="sm"
        header={<Localized id="settings-section-display"><h2 className="settings-section-title">Display</h2></Localized>}
      >
        <div className="settings-form">
          <div className="settings-field settings-field--horizontal">
            <Localized id="settings-field-card-size">
              <span className="settings-label">Menu Card Size</span>
            </Localized>
            <span className="settings-field-input-wrap">
              <div className="settings-size-controls">
                <Localized id="settings-card-size-decrease-aria" attrs={{ 'aria-label': true }}>
                  <button
                    type="button"
                    className="settings-size-btn"
                    disabled={displayCardSize <= 0}
                    onClick={() => { setDisplayCardSize((s) => Math.max(0, s - 1)); markDirty(); }}
                    aria-label={l10n.getString('decrease-card-size-aria')}
                  >
                    &minus;
                  </button>
                </Localized>
                <span className="settings-size-value">{displayCardSize}</span>
                <Localized id="settings-card-size-increase-aria" attrs={{ 'aria-label': true }}>
                  <button
                    type="button"
                    className="settings-size-btn"
                    disabled={displayCardSize >= 4}
                    onClick={() => { setDisplayCardSize((s) => Math.min(4, s + 1)); markDirty(); }}
                    aria-label={l10n.getString('increase-card-size-aria')}
                  >
                    +
                  </button>
                </Localized>
              </div>
            </span>
          </div>

          <div className="settings-field settings-field--horizontal">
            <Localized id="settings-field-font-size">
              <span className="settings-label">Font Size</span>
            </Localized>
            <span className="settings-field-input-wrap">
              <div className="settings-size-controls">
                <Localized id="settings-font-size-decrease-aria" attrs={{ 'aria-label': true }}>
                  <button
                    type="button"
                    className="settings-size-btn"
                    disabled={displayFontSize <= 0}
                    onClick={() => { setDisplayFontSize((s) => Math.max(0, s - 1)); markDirty(); }}
                    aria-label={l10n.getString('decrease-font-size-aria')}
                  >
                    &minus;
                  </button>
                </Localized>
                <span className="settings-size-value">{displayFontSize}</span>
                <Localized id="settings-font-size-increase-aria" attrs={{ 'aria-label': true }}>
                  <button
                    type="button"
                    className="settings-size-btn"
                    disabled={displayFontSize >= 4}
                    onClick={() => { setDisplayFontSize((s) => Math.min(4, s + 1)); markDirty(); }}
                    aria-label={l10n.getString('increase-font-size-aria')}
                  >
                    +
                  </button>
                </Localized>
              </div>
            </span>
          </div>

          <div className="settings-field settings-field--horizontal">
            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- SettingsSelect component has hidden native select */}
            <label htmlFor="settings-field-font-smoothing" className="settings-label">
              <Localized id="settings-field-font-smoothing">
                <span>Font Smoothing</span>
              </Localized>
            </label>
            <span className="settings-field-input-wrap">
              <SettingsSelect
                id="settings-field-font-smoothing"
                value={displayFontSmoothing}
                onChange={(v) => { setDisplayFontSmoothing(v); markDirty(); }}
                options={[
                  { value: 'antialiased', label: l10n.getString('settings-font-smoothing-antialiased') },
                  { value: 'subpixel', label: l10n.getString('settings-font-smoothing-subpixel') },
                ]}
                ariaLabel={l10n.getString('settings-field-font-smoothing')}
              />
            </span>
          </div>
        </div>
      </Card>

      {/* ── Appearance section ────────────────── */}
      <AppearanceSettings
        embedded
        colour={brandColour}
        storeName={brandStoreName}
        onColourChange={(c) => {
          setBrandColour(c);
          // Empty string = follow the active theme: drop the inline
          // override instead of deriving a palette from "" (black).
          if (c) {
            const palette = deriveAccentPalette(c);
            applyAccentPalette(palette);
          } else {
            clearAccentPalette();
          }
          applyThemeContrasts();
          markDirty();
        }}
        onStoreNameChange={(name) => { setBrandStoreName(name); markDirty(); }}
      />
    </>
  );
}
