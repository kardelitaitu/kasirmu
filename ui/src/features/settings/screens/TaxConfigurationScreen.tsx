//! TaxConfigurationScreen — Settings → Tax Configuration.
//!
//! Migrated 2026-10-06 from `features/tax/TaxConfigurationScreen.tsx` (matching
//! the ExchangeRatesScreen / DataManagementScreen shape). Composition, not a
//! re-export: the route, the scaffold shell and its migrating note stay on this
//! screen while the tax feature keeps its own screen and stylesheet.
//!
//! `embedded` is REQUIRED, not cosmetic. The composed screen renders its own
//! <h1> reading "Tax Configuration", which is the same accessible name as the
//! heading above it — so the section carried TWO headings under one name. Any
//! `getByRole('heading', { name: 'Tax Configuration' })` then throws on the
//! ambiguous match, and the settings section sweep retries that query inside a
//! `waitFor` loop until the worker dies with "Reached heap limit".
//!
//! That is the whole story of the four rounds this migration was previously
//! parked under: it presented as a ~6 GB OOM in `SettingsPage.test.tsx`, but a
//! per-section heap probe read a FLAT ~81 MB right up to the failing iteration
//! and the tax component recorded zero renders. The "allocation" was the retry
//! loop, not the screen. Resolved by passing the prop, not by changing the
//! tax screen's data handling.

import { Localized } from '@fluent/react';
// Aliased: this file's own exported component is also named
// `TaxConfigurationScreen` (the route keeps the scaffold's name), so a bare
// import of the same identifier collides — TS2440 "Import declaration conflicts
// with local declaration". Same fix as the sibling DataManagementScreen.tsx.
import TaxConfigurationBody from '@/features/tax/TaxConfigurationScreen';
import './screens-placeholder.css';

/** Settings → Tax Configuration: the real tax screen as the body. */
export function TaxConfigurationScreen() {
  return (
    <section className="settings-screen-placeholder">
      <h1 className="settings-screen-placeholder-title">
        <Localized id="settings-nav-tax-configuration">Tax Configuration</Localized>
      </h1>
      <p className="settings-screen-placeholder-note">
        <Localized id="settings-screen-migrating">
          Existing settings content will move here selectively.
        </Localized>
      </p>
      {/* `embedded` suppresses the body's duplicate <h1>. See the file header. */}
      <TaxConfigurationBody embedded />
    </section>
  );
}
