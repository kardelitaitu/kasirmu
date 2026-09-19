//! SystemDiagnosticsScreen — Settings → System Diagnostics.
//!
//! First screen filled in from the parked scaffold set: this one renders the real
//! `sections/DiagnosticsSection.tsx` (feature-availability verdicts + deployment
//! info) as its body, per the migration provenance named here when it was still a
//! placeholder. Composition, not a re-export — the route, the section heading, and
//! the scaffold shell all stay on this screen while the section keeps its own
//! ledger entry and stylesheet. The remaining scaffolds in this folder still
//! render "This page is being rebuilt" until their own content is wired in.
//!
//! Copy is Fluent-only: `settings-nav-*` for the title, plus the shared placeholder
//! notes. Both keys exist in `settings.ftl` and `settings.id.ftl`.

import { Localized } from '@fluent/react';
import DiagnosticsSection from '../sections/DiagnosticsSection';
import './screens-placeholder.css';

/** Settings → System Diagnostics: heading + the real DiagnosticsSection body. */
export function SystemDiagnosticsScreen() {
  return (
    <section className="settings-screen-placeholder">
      <h1 className="settings-screen-placeholder-title">
        <Localized id="settings-nav-system-diagnostics">System Diagnostics</Localized>
      </h1>
      {/* The migration note stays (SettingsPage.test.tsx asserts it on every
          screen, migrated ones included); the one-off placeholder line goes away
          once the body below is real content. */}
      <p className="settings-screen-placeholder-note">
        <Localized id="settings-screen-migrating">
          Existing settings content will move here selectively.
        </Localized>
      </p>
      <DiagnosticsSection />
    </section>
  );
}
