//! DataSyncScreen — blank Settings screen scaffold (settings rebuild).
//!
//! Migration provenance (orchestrator contract, settings-screens phase):
//! Content moves here from `features/settings/sections/SyncSection.tsx`. A tabbed container is planned: the data-management, sync-status and offline-queue screens in this folder are its intended tabs.
//! Intentionally renders no controls: this file exists so the route/placeholder is
//! honest about its state, and every scaffold in this folder shares one stylesheet
//! (`./screens-placeholder.css`) so the placeholder looks identical everywhere.
//!
//! Copy is Fluent-only: `settings-nav-*` for the title, plus the two shared
//! placeholder notes. Both keys exist in `settings.ftl` and `settings.id.ftl`.

import { Localized } from '@fluent/react';
import './screens-placeholder.css';

/** Placeholder for Settings → Data Sync. */
export function DataSyncScreen() {
  return (
    <section className="settings-screen-placeholder">
      <h1 className="settings-screen-placeholder-title">
        <Localized id="settings-nav-data-sync">Data Sync</Localized>
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
