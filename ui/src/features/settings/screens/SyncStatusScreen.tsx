//! SyncStatusScreen — blank Settings screen scaffold (settings rebuild).
//!
//! Migration provenance (orchestrator contract, settings-screens phase):
//! New screen (Plus+ gated) — planned tab of `DataSyncScreen`, fed by the sync-status half of `sections/SyncSection.tsx`.
//! Intentionally renders no controls: this file exists so the route/placeholder is
//! honest about its state, and every scaffold in this folder shares one stylesheet
//! (`./screens-placeholder.css`) so the placeholder looks identical everywhere.
//!
//! Copy is Fluent-only: `settings-nav-*` for the title, plus the two shared
//! placeholder notes. Both keys exist in `settings.ftl` and `settings.id.ftl`.

import { Localized } from '@fluent/react';
import './screens-placeholder.css';

/** Placeholder for Settings → Sync Status. */
export function SyncStatusScreen() {
  return (
    <section className="settings-screen-placeholder">
      <h1 className="settings-screen-placeholder-title">
        <Localized id="settings-nav-sync-status">Sync Status</Localized>
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
