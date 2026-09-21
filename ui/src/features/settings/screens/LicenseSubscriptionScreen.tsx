//! LicenseSubscriptionScreen — Settings → License Subscription.
//!
//! Migration provenance (orchestrator contract, settings-screens phase):
//! content moved here from `features/settings/LicenseSettings.tsx` (tier, seats,
//! quota, server status). The screen keeps the shared scaffold wrapper and title
//! (`./screens-placeholder.css`) and renders the real component as its body —
//! the same shape BusinessDefaultsScreen/SystemDiagnosticsScreen took — so the
//! "being rebuilt" note is gone from this section. The shared migrating note
//! stays: SettingsPage.test.tsx asserts it under EVERY section body (:426).

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
      <p className="settings-screen-placeholder-note">
        <Localized id="settings-screen-migrating">
          Existing settings content will move here selectively.
        </Localized>
      </p>
    </section>
  );
}
