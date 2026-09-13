//! TaxConfigurationScreen — blank Settings screen scaffold (settings rebuild).
//!
//! Migration provenance (orchestrator contract, settings-screens phase):
//! Content moves here from `features/tax/TaxConfigurationScreen.tsx`.
//! The filename intentionally shadows the source screen it replaces — the two
//! live in different directories, and the import here is never wired until the
//! migration lands and swaps this blank in for the moved screen.
//!
//! Copy is Fluent-only: `settings-nav-*` for the title, plus the two shared
//! placeholder notes. Both keys exist in `settings.ftl` and `settings.id.ftl`.

import { Localized } from '@fluent/react';
import './screens-placeholder.css';

/** Placeholder for Settings → Tax Configuration. */
export function TaxConfigurationScreen() {
  return (
    <section className="settings-screen-placeholder">
      <h1 className="settings-screen-placeholder-title">
        <Localized id="settings-nav-tax-configuration">Tax Configuration</Localized>
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
