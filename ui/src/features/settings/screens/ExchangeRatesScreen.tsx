//! ExchangeRatesScreen — Settings → Exchange Rates.
//!
//! Migrated 2026-10-06 from `features/currency/ExchangeRateScreen.tsx`, per the
//! provenance this scaffold named while it was still blank. Composition, not a
//! re-export: the route and the scaffold shell stay on this
//! screen while the currency feature keeps its own screen and stylesheet.
//!
//! The composed component is a full screen, so it is passed `embedded` — that
//! suppresses its own <h1>, which would otherwise print the page title twice
//! under this scaffold's heading. Its Add button stays: that is the screen's
//! primary action and this shell has no equivalent.
//!
//! Copy is Fluent-only: `settings-nav-exchange-rates` for the heading and the
//! body's own `currency-*` keys. The shared `settings-screen-migrating` note was
//! removed from every settings screen in round 43 — this section is built, so
//! telling users its content "will move here" was stale copy.

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
      <ExchangeRateScreen embedded />
    </section>
  );
}
