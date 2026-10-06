//! TaxConfigurationScreen — blank Settings screen scaffold (settings rebuild).
//!
//! Migration provenance (orchestrator contract, settings-screens phase):
//! Content moves here from `features/tax/TaxConfigurationScreen.tsx`.
//! The filename intentionally shadows the source screen it replaces — the two
//! live in different directories, and the import here is never wired until the
//! migration lands and swaps this blank in for the moved screen.
//!
//! PARKED 2026-10-06: composition attempted twice and REVERTED both times.
//! Evidence gathered: the screen mounts fine in ISOLATION (66 MB, its own suite
//! green), imports cost ~49 MB, IPC stays bounded (21 calls) and the heap probe
//! reads flat ~83 MB right up to the failing iteration — yet the worker dies
//! with V8 "Reached heap limit", and the tax component records ZERO renders.
//! So the blow-up is neither rendering, nor data, nor module loading. The
//! composed body is also observed to stay on Suspense's `.section-loading`
//! (`heading "Tax Configuration"` never appears). Do NOT re-wire this until
//! the sweep can mount the screen.

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
