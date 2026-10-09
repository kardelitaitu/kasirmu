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
//!
//! VERIFIED ON THE TABLET 2026-10-06 (Redmi 23073RPBFG, debug build embedding
//! this bundle), over CDP against the running app:
//!
//!   input#settings-field-store-name  → present
//!   input#settings-field-tax-id      → present
//!   input#settings-field-address     → present
//!   input#settings-field-branch      → present
//!   select#language-select           → present, 2 options (en, id)
//!   select#settings-field-default-currency → present
//!   .settings-section-content input  → 4   (was 0 before this migration)
//!   .settings-general-save-btn       → present
//!
//! Typing into the store-name field flipped that button from `disabled: true`
//! to `disabled: false`, so the dirty comparison against the context read is
//! live — not merely "renders".
//!
//! NOT verified end-to-end: the WRITE. Pressing save produces no toast on this
//! device, and the page-level "Save settings" button behaves identically — the
//! workspace session token is minted only when an instance is resolvable (see
//! useBackupStatus.ts for the same hole), and this install has none. So the
//! no-op is the documented token gate, not this screen's save path failing; it
//! is asserted directly by useStoreDraft.test.tsx ("save writes the draft
//! through the scoped command") under a mocked token.

import { Localized, useLocalization } from '@fluent/react';
import { Button } from '@/components/Button';
import { useStoreDraft } from '../hooks/useStoreDraft';
import GeneralSection from '../sections/GeneralSection';
import './screens-placeholder.css';
import './GeneralScreen.css';

/** Settings → General: heading + the real store-identity form as its body. */
export function GeneralScreen() {
  const { l10n } = useLocalization();
  const draft = useStoreDraft();

  return (
    <section className="settings-screen-placeholder">
      <h1 className="settings-screen-placeholder-title">
        <Localized id="settings-nav-general">General</Localized>
      </h1>

      <GeneralSection
        store={draft.store}
        setStore={(next) => {
          // GeneralSection declares `setStore: (s: StoreSettingsDto) => void`
          // and every one of its five call sites passes a plain object —
          // `setStore({ ...store, name: e.target.value })` — so there is no
          // updater-function form to support. Diffing the incoming object and
          // routing only the CHANGED fields through the hook keeps
          // error-clearing and dirty tracking in one place without writing
          // identical values back.
          for (const [k, v] of Object.entries(next)) {
            const field = k as keyof typeof draft.store;
            if (draft.store[field] !== v) draft.setField(field, String(v));
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
