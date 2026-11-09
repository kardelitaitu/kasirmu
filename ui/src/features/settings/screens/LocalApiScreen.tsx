//! LocalApiScreen — Settings → Local API.
//!
//! Composition, following DataManagementScreen / EmailReportsScreen / AppearanceScreen:
//! the route and the scaffold shell stay here, the feature keeps its own component.
//!
//! ROUND 159 mounted this. The backend has been live and unreachable: the desktop shell
//! AUTO-STARTS the loopback server at boot (apps/desktop-tauri/src/lib.rs:1296-1349, behind
//! the `local_api.enabled` setting) and registers six management commands
//! (lib.rs:1405-1410) -- and no screen could reach any of them. The 15-key settings
//! rebuild dropped the section, as it had dropped `appearance` and `email-reports` before
//! rounds 155 and 158 found those.
//!
//! DESKTOP-ONLY, and the section says so itself: `LocalApiSection` short-circuits its
//! fetches on the tablet and renders a one-line notice instead of controls whose every
//! click would land in a catch.

import { Localized } from '@fluent/react';
import LocalApiSection from '../sections/LocalApiSection';
import './screens-placeholder.css';

/** Settings → Local API: enable the loopback server, set its port, mint tokens. */
export function LocalApiScreen() {
  return (
    <section className="settings-screen-placeholder">
      <h1 className="settings-screen-placeholder-title">
        <Localized id="settings-nav-local-api">Local API</Localized>
      </h1>
      <LocalApiSection />
    </section>
  );
}
