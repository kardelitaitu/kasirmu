//! DataManagementScreen — Settings → Data Management.
//!
//! Migrated 2026-10-06 from `features/settings/DataManagementScreen.tsx`, per
//! the provenance this scaffold named while it was still blank. Composition, not
//! a re-export: the route, the scaffold shell and its migrating note stay on
//! this screen while the data-management feature keeps its own screen and
//! stylesheet.
//!
//! The composed component is a full screen with its own <h1>, so it is passed
//! `embedded` — that suppresses the duplicate title. Its tab bar
//! (Export / Import / Backup / Restore) is real navigation and stays.
//!
//! Copy is Fluent-only: `settings-nav-data-management` for the heading, the
//! body's own `data-mgmt-*` keys, and the shared `settings-screen-migrating`
//! note (the one-off "being rebuilt" line goes away once the body is real).

import { Localized } from '@fluent/react';
// Aliased: this file's own exported component is ALSO named
// `DataManagementScreen` (the route keeps the scaffold's name), so a bare
// import of the same identifier collides — TS2440 "Import declaration
// conflicts with local declaration". The alias keeps both names readable and
// makes it explicit that line 22's function is the composition shell while
// DataManagementBody is the real screen it renders.
import DataManagementBody from '../DataManagementScreen';
import './screens-placeholder.css';

/** Settings → Data Management: the real data-management screen as the body. */
export function DataManagementScreen() {
  return (
    <section className="settings-screen-placeholder">
      <h1 className="settings-screen-placeholder-title">
        <Localized id="settings-nav-data-management">Data Management</Localized>
      </h1>
      <DataManagementBody embedded />
    </section>
  );
}
