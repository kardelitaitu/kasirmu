//! SystemDiagnosticsScreen — Settings → System Diagnostics.
//!
//! First screen filled in from the parked scaffold set: this one renders the real
//! `sections/DiagnosticsSection.tsx` (feature-availability verdicts + deployment
//! info) as its body, per the migration provenance named here when it was still a
//! placeholder. Composition, not a re-export — the route, the section heading, and
//! the scaffold shell all stay on this screen while the section keeps its own
//! ledger entry and stylesheet.
//!
//! This header used to add that "the remaining scaffolds in this folder still
//! render 'This page is being rebuilt' until their own content is wired in". That
//! was true when written and is not now: every settings section has been migrated
//! (the round-43 removal of the shared `settings-screen-migrating` note could only
//! be done across all 14 because none is a scaffold any more). No screen in this
//! folder renders a rebuild line, so the claim was removed rather than left to
//! mislead the next reader.
//!
//! Copy is Fluent-only: `settings-nav-*` for the title. Both keys exist in
//! `settings.ftl` and `settings.id.ftl`.

import { Localized } from '@fluent/react';
import DiagnosticsSection from '../sections/DiagnosticsSection';
import { DiagnosticExportCard } from './DiagnosticExportCard';
import { UpdateSettingsCard } from './UpdateSettingsCard';
import { isTabletShell } from '@/utils/shellKind';
import './screens-placeholder.css';

/** Settings → System Diagnostics: heading + the real DiagnosticsSection body. */
export function SystemDiagnosticsScreen() {
  return (
    <section className="settings-screen-placeholder">
      <h1 className="settings-screen-placeholder-title">
        <Localized id="settings-nav-system-diagnostics">System Diagnostics</Localized>
      </h1>
      <DiagnosticsSection />
      <DiagnosticExportCard />
      {/* The in-app self-updater is Android-only by design: it downloads an APK
          and hands off to the Android package installer, and only the tablet
          shell registers those commands (C41/C47 shell-guard idiom). Mounting
          it on desktop would call commands that shell never registers. */}
      {isTabletShell() && <UpdateSettingsCard />}
    </section>
  );
}
