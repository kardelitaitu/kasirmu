//! ExchangeRatesScreen — Settings → Exchange Rates.
//!
//! Migrated 2026-10-06 from `features/currency/ExchangeRateScreen.tsx`, per the
//! provenance this scaffold named while it was still blank. Composition, not a
//! re-export: the route, the scaffold shell and its migrating note stay on this
//! screen while the currency feature keeps its own screen and stylesheet.
//!
//! The composed component is a full screen, so it is passed `embedded` — that
//! suppresses its own <h1>, which would otherwise print the page title twice
//! under this scaffold's heading. Its Add button stays: that is the screen's
//! primary action and this shell has no equivalent.
//!
//! Copy is Fluent-only: `settings-nav-exchange-rates` for the heading, the
//! body's own `currency-*` keys, and the shared `settings-screen-migrating`
//! note (the one-off "being rebuilt" line goes away once the body is real).

import { Localized } from '@fluent/react';
import ExchangeRateScreen from '@/features/currency/ExchangeRateScreen';
import './screens-placeholder.css';

/** Settings → Exchange Rates: the real currency screen as the body. */
export function ExchangeRatesScreen() {
  return (
    <section className="settings-screen-placeholder">
      <h1 className="settings-screen-placeholder-title">
        <Localized id="settings-nav-exchange-rates">Exchange Rates</Localized>
      </h1>
      {/* SettingsPage.test.tsx asserts this note on EVERY settings screen,
          migrated ones included. */}
      <p className="settings-screen-placeholder-note">
        <Localized id="settings-screen-migrating">
          Existing settings content will move here selectively.
        </Localized>
      </p>
      <ExchangeRateScreen embedded />
    </section>
  );
}
