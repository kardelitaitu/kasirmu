//! OfflineQueueScreen — Settings → Offline Queue.
//!
//! Migrated 2026-10-06 from `features/offline/OfflineQueueScreen.tsx`, per the
//! provenance this scaffold named while it was still blank. Composition, not a
//! re-export: the route, the scaffold shell and its migrating note stay on this
//! screen while the offline feature keeps its own component and stylesheet.
//!
//! `embedded` is REQUIRED here: the composed screen's <h1> reads "Offline
//! Queue", the same accessible name as the heading above it, so without the
//! prop the section would carry two headings under one name and any
//! `getByRole('heading', { name: 'Offline Queue' })` would throw on the
//! ambiguous match. See the tax scaffold for what that costs.
//!
//! The pending badge, plan row, summary grid and item list are real content and
//! stay.

import { Localized } from '@fluent/react';
// Aliased: this file's own exported component is also named
// `OfflineQueueScreen` (the route keeps the scaffold's name), so a bare import
// of the same identifier collides — TS2440. Same fix as its
// DataManagementScreen / TaxConfigurationScreen siblings.
import OfflineQueueBody from '@/features/offline/OfflineQueueScreen';
import './screens-placeholder.css';

/** Settings → Offline Queue: the real offline-queue screen as the body. */
export function OfflineQueueScreen() {
  return (
    <section className="settings-screen-placeholder">
      <h1 className="settings-screen-placeholder-title">
        <Localized id="settings-nav-offline-queue">Offline Queue</Localized>
      </h1>
      <p className="settings-screen-placeholder-note">
        <Localized id="settings-screen-migrating">
          Existing settings content will move here selectively.
        </Localized>
      </p>
      <OfflineQueueBody embedded />
    </section>
  );
}
