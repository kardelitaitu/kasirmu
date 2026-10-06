//! GeneralScreen — blank Settings screen scaffold (settings rebuild).
//!
//! Migration provenance (orchestrator contract, settings-screens phase):
//! Content moves here from `features/settings/sections/GeneralSection.tsx`
//! (store identity fields).
//!
//! Intentionally renders no controls: this file exists so the route/placeholder
//! is honest about its state, and every scaffold in this folder shares one
//! stylesheet (`./screens-placeholder.css`) so the placeholder looks identical
//! everywhere.
//!
//! Copy is Fluent-only: `settings-nav-*` for the title, plus the two shared
//! placeholder notes. Both keys exist in `settings.ftl` and `settings.id.ftl`.
//!
//! ── WHY THIS IS STILL EMPTY, AND WHY THAT IS NOT FREE ──────────────
//!
//! `GeneralSection` is presentational: it takes ELEVEN props (store, setStore,
//! markDirty, cmInput, fieldErrors, validateField, clearFieldError, currencies,
//! defaultCurrency, setDefaultCurrencyState, l10n) and owns no state. All of it
//! lives in `SettingsPage.tsx`, whose `renderSection` now dispatches ONLY to
//! `SETTINGS_SCREENS` — and SettingsPage imports NONE of the six
//! `sections/*.tsx` files any more. So the section cannot simply be dropped in
//! the way DiagnosticsSection (zero props) was: composing it needs the state
//! LIFTED first, exactly as the offline/tax/data-management screens needed only
//! `embedded`.
//!
//! The consequence is user-visible, verified on the tablet 2026-10-06 by
//! navigating Settings → General over CDP:
//!
//!   document.querySelector('#settings-field-store-name') → null
//!   .settings-section-content input / select count → 0
//!
//! In other words the shipped app has NO way to edit store name, address, tax
//! ID, branch, default currency, or the UI language: those fields exist only in
//! GeneralSection.tsx, which nothing renders. `SettingsPage` still carries the
//! `store` state and still hands it to `useSettingsSave`, so the SAVE pipeline
//! is intact but detached from any UI that could change it.
//!
//! So this screen is the sharpest argument for the lift: it is not a cosmetic
//! gap, it is lost configuration. Do that refactor before treating any of the
//! four remaining placeholders (this, data-sync, sync-status, security-account)
//! as a simple composition — three of them need moved state, and
//! security-account has no source content at all.

import { Localized } from '@fluent/react';
import './screens-placeholder.css';

/** Placeholder for Settings → General. */
export function GeneralScreen() {
  return (
    <section className="settings-screen-placeholder">
      <h1 className="settings-screen-placeholder-title">
        <Localized id="settings-nav-general">General</Localized>
      </h1>
      <p className="settings-screen-placeholder-note">
        <Localized id="settings-screen-placeholder">This page is being rebuilt.</Localized>
      </p>
      <p className="settings-screen-placeholder-note">
        <Localized id="settings-screen-migrating">
          Existing settings content will move here selectively.
        </Localized>
      </p>
    </section>
  );
}
