//! EmailReportsScreen — Settings → Email Reports.
//!
//! Composition, not a re-export, following the rule every other migrated settings
//! screen follows (see DataManagementScreen.tsx:5-7): the route and the scaffold
//! shell stay on THIS screen, and the feature keeps its own component and stylesheet.
//!
//! ROUND 155 mounted this. `EmailReportSettings` had been orphaned since `75eb83d7c5`
//! rebuilt the settings nav as a flat page list: that commit deleted the section that
//! rendered it and enumerated the FTL keys whose "last production reference this
//! commit removes", but the component itself was left behind with 39 passing tests.
//! Round 153 corrected the note in SecurityAccountScreen that implied the blocker was
//! missing MOBILE commands -- it was not: the desktop registers all four email
//! commands (lib.rs:1421-1424) and nothing rendered the screen on either shell.
//!
//! This surface is DESKTOP-ONLY and says so. The four commands
//! (`get_report_schedule`, `get_report_schedule_scoped`, `save_report_schedule`,
//! `send_test_report`) are registered by apps/desktop-tauri alone, and
//! apps/mobile-tauri has no `email.rs` at all. The screen therefore mounts on both
//! shells -- the route is shared -- but its two WRITES are guarded with
//! `isTabletShell()` and explain themselves, and its READ already degrades: it falls
//! back to defaults on any failure, so a tablet sees an editable form that tells the
//! truth when asked to save rather than a screen that silently errors.

import { Localized } from '@fluent/react';
import EmailReportSettings from '../EmailReportSettings';
import './screens-placeholder.css';

/** Settings → Email Reports: the report-scheduling form as the body. */
export function EmailReportsScreen() {
  return (
    <section className="settings-screen-placeholder">
      <h1 className="settings-screen-placeholder-title">
        <Localized id="settings-nav-email-reports">Email Reports</Localized>
      </h1>
      <EmailReportSettings />
    </section>
  );
}
