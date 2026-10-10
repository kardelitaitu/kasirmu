//! LicenseSubscriptionScreen — Settings → License Subscription.
//!
//! Migration provenance (orchestrator contract, settings-screens phase):
//! content moved here from `features/settings/LicenseSettings.tsx` (tier, seats,
//! quota, server status). The screen keeps the shared scaffold wrapper and title
//! (`./screens-placeholder.css`) and renders the real component as its body —
//! the same shape BusinessDefaultsScreen/SystemDiagnosticsScreen took — so no
//! scaffold note is rendered here. The shared `settings-screen-migrating` note was
//! removed from every settings screen in round 43: it claimed content "will move
//! here" on screens that are finished, and SettingsPage.test.tsx now REQUIRES its
//! absence on a migrated screen instead of requiring it everywhere.

import { Localized } from '@fluent/react';
import LicenseSettings from '../LicenseSettings';
import './screens-placeholder.css';

/** Settings → License Subscription. */
export function LicenseSubscriptionScreen() {
  return (
    <section className="settings-screen-placeholder">
      <h1 className="settings-screen-placeholder-title">
        <Localized id="settings-nav-license-subscription">License Subscription</Localized>
      </h1>
      <LicenseSettings />
    </section>
  );
}
