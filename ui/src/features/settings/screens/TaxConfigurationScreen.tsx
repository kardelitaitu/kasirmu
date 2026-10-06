//! TaxConfigurationScreen — blank Settings screen scaffold (settings rebuild).
//!
//! Migration provenance (orchestrator contract, settings-screens phase):
//! Content moves here from `features/tax/TaxConfigurationScreen.tsx`.
//! The filename intentionally shadows the source screen it replaces — the two
//! live in different directories, and the import here is never wired until the
//! migration lands and swaps this blank in for the moved screen.
//!
//! PARKED 2026-10-06: the composition was attempted and REVERTED. Mounting the
//! real tax screen here makes SettingsPage.test.tsx's 14-section sweep fail —
//! measured with per-section heap probes, the process dies inside the
//! `tax-configuration` iteration having reached neither 3000MB nor a render of
//! the composed body, while every other section stays flat at ~80MB. The screen
//! mounts fine in ISOLATION (66MB, its own suite green), so the instability is
//! specific to composing it inside this sweep. Two genuine robustness bugs in
//! the composed screen were found and fixed on the way (see
//! `features/tax/TaxConfigurationScreen.tsx`), but they are not the cause.
//! Do NOT re-wire this until the sweep can mount the screen.

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
