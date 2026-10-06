//! TaxConfigurationScreen — blank Settings screen scaffold (settings rebuild).
//!
//! Migration provenance (orchestrator contract, settings-screens phase):
//! Content moves here from `features/tax/TaxConfigurationScreen.tsx`.
//! The filename intentionally shadows the source screen it replaces — the two
//! live in different directories, and the import here is never wired until the
//! migration lands and swaps this blank in for the moved screen.
//!
//! PARKED 2026-10-06: the composition was attempted and REVERTED. Mounting the
//! real tax screen here makes SettingsPage.test.tsx's 14-section sweep exceed
//! the V8 heap (`Reached heap limit`, ~6 GB) — measured with a per-section heap
//! probe: flat at ~82 MB through eleven sections, then a runaway on this key.
//! Two genuine robustness bugs in the composed screen were found and fixed on
//! the way (see `features/tax/TaxConfigurationScreen.tsx` — the unguarded array
//! reads and the empty-map identity churn), and the runaway survives those
//! fixes, so the remaining cause is still unproven. Do NOT re-wire this until
//! the sweep can mount the screen; a placeholder here is honest, an OOM in the
//! suite is not.

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
