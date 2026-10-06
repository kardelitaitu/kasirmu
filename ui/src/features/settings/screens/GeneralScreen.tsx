//! GeneralScreen — Settings → General.
//!
//! Migrated 2026-10-06 from `features/settings/sections/GeneralSection.tsx` (store
//! identity + default currency + UI language), per the provenance this scaffold
//! named while it was still blank.
//!
//! Unlike its ExchangeRates / DataManagement / TaxConfiguration siblings, the
//! section could NOT simply be composed: `GeneralSection` is presentational and
//! takes ELEVEN props, and the flat-IA rebuild removed the page state that used
//! to supply them. `validateField`, `clearFieldError` and `fieldErrors` were
//! never reimplemented — `git grep validateField` finds the prop type, its two
//! call sites, and test mocks, and no definition — so the form could not render
//! even if imported.
//!
//! The missing half now lives in `hooks/useStoreDraft.ts`: it owns the draft,
//! validation, and the `set_store_settings_scoped` write, and it marks
//! `store.*` changed so the settings context refetches — the same post-write
//! contract `useSettingsSave`'s store task uses, so the two cannot diverge.
//!
//! This screen keeps its own Save button (the page's topbar Save is driven by
//! page-level dirty state this screen does not own), mirroring
//! AppearanceSettings' self-contained pattern. Copy is Fluent-only and uses
//! existing keys; the one new key (`settings-store-name-required`) was added to
//! BOTH the en and id bundles.

import { Localized, useLocalization } from '@fluent/react';
import { Button } from '@/components/Button';
import { useStoreDraft } from '../hooks/useStoreDraft';
import GeneralSection from '../sections/GeneralSection';
import './screens-placeholder.css';

/** Settings → General: heading + the real store-identity form as its body. */
export function GeneralScreen() {
  const { l10n } = useLocalization();
  const draft = useStoreDraft();

  return (
    <section className="settings-screen-placeholder">
      <h1 className="settings-screen-placeholder-title">
        <Localized id="settings-nav-general">General</Localized>
      </h1>
      {/* The migration note stays (SettingsPage.test.tsx asserts it on every
          screen, migrated ones included); the one-off placeholder line goes away
          now that the body is real content. */}
      <p className="settings-screen-placeholder-note">
        <Localized id="settings-screen-migrating">
          Existing settings content will move here selectively.
        </Localized>
      </p>

      <GeneralSection
        store={draft.store}
        setStore={(next) => {
          // The section writes whole objects (`setStore({ ...store, name })`),
          // so route each field through the hook to keep error-clearing and
          // dirty tracking in one place.
          const value = typeof next === 'function' ? null : next;
          if (value) {
            for (const [k, v] of Object.entries(value)) {
              if (draft.store[k as keyof typeof draft.store] !== v) {
                draft.setField(k as keyof typeof draft.store, String(v));
              }
            }
          }
        }}
        // The section calls this on every keystroke; the hook derives dirtiness
        // by comparing the draft against the context read, so there is nothing
        // to flip here.
        markDirty={() => {}}
        cmInput={draft.cmInput}
        fieldErrors={draft.fieldErrors}
        validateField={draft.validateField}
        clearFieldError={draft.clearFieldError}
        currencies={draft.currencies}
        defaultCurrency={draft.store.currency}
        setDefaultCurrencyState={(v) => draft.setField('currency', v)}
        l10n={l10n}
      />

      <div className="settings-form">
        <Button
          type="button"
          variant="primary"
          size="sm"
          className="settings-general-save-btn"
          onClick={() => { void draft.save(); }}
          disabled={draft.saving || !draft.isDirty}
        >
          <Localized id="settings-btn-save">Save</Localized>
        </Button>
      </div>
    </section>
  );
}
