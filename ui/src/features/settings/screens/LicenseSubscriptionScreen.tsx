//! LicenseSubscriptionScreen — blank Settings screen scaffold (settings rebuild).
//!
//! Migration provenance (orchestrator contract, settings-screens phase):
//! Content moves here from `features/settings/LicenseSettings.tsx` (tier, seats, quota, server status).
//! Intentionally renders no controls: this file exists so the route/placeholder is
//! honest about its state, and every scaffold in this folder shares one stylesheet
//! (`./screens-placeholder.css`) so the placeholder looks identical everywhere.
//!
//! Copy is Fluent-only: `settings-nav-*` for the title, plus the two shared
//! placeholder notes. Both keys exist in `settings.ftl` and `settings.id.ftl`.

import { Localized } from '@fluent/react';
import './screens-placeholder.css';

/** Placeholder for Settings → License Subscription. */
export function LicenseSubscriptionScreen() {
  return (
    <section className="settings-screen-placeholder">
      <h1 className="settings-screen-placeholder-title">
        <Localized id="settings-nav-license-subscription">License Subscription</Localized>
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
