//! DevicesConnectivityScreen — Settings → Devices & Connectivity.
//!
//! Second screen filled in from the parked scaffold set (after
//! SystemDiagnosticsScreen): this one renders the real
//! `components/EdcTerminalsCard.tsx` (physical card-terminal management and
//! driver bindings) as its body. Composition, not a re-export — the route, the
//! section heading, and the scaffold shell all stay on this screen while the
//! card keeps its own stylesheet.
//!
//! Copy is Fluent-only: `settings-nav-*` for the title, plus the shared
//! placeholder notes. Both keys exist in `settings.ftl` and `settings.id.ftl`.
//!
//! The wrapper is `settings-screen-placeholder`, NOT the `settings-screen` div
//! this screen used to carry: no sheet ever defined that class, so the div was
//! styling itself inline (padding plus a hardcoded maxWidth: 1000) and the
//! scaffold's own title/note were left unreachable. SettingsPage.test.tsx:420
//! requires every section body to BE `section.settings-screen-placeholder`, so
//! the old markup also failed the shell sweep. Migrated screens keep the shell
//! and swap only the body — see SystemDiagnosticsScreen for the same shape.

import { Localized } from '@fluent/react';
import { EdcTerminalsCard } from '../components/EdcTerminalsCard';
import './screens-placeholder.css';

/** Settings → Devices & Connectivity: heading + the real EDC terminals card. */
export function DevicesConnectivityScreen() {
  return (
    <section className="settings-screen-placeholder">
      <h1 className="settings-screen-placeholder-title">
        <Localized id="settings-nav-devices-connectivity">
          Devices &amp; Connectivity
        </Localized>
      </h1>
      {/* The migration note stays (SettingsPage.test.tsx asserts it on every
          screen, migrated ones included); the placeholder line goes away once
          the body below is real content. */}
      <p className="settings-screen-placeholder-note">
        <Localized id="settings-screen-migrating">
          Existing settings content will move here selectively.
        </Localized>
      </p>
      <EdcTerminalsCard />
    </section>
  );
}
