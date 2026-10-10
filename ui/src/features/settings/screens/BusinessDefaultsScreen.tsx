//! BusinessDefaultsScreen — Settings → Business Defaults.
//!
//! Hosts the regional-configuration card (regional slice 3, saas-2 design):
//! the effective locale/timezone/currency/country for the session's primary
//! location, editable at the location layer with per-axis provenance. The
//! screen scaffold's placeholder copy stays in place for the axes that have
//! not migrated yet; copy is Fluent-only (`settings-regional-*` plus the
//! shared placeholder keys, all in settings.ftl + settings.id.ftl).

import { Localized } from '@fluent/react';
import { RegionalSettingsCard } from './RegionalSettingsCard';
import { LocalPaymentSettingsCard } from './LocalPaymentSettingsCard';
import { ReceiptFormatSettingsCard } from './ReceiptFormatSettingsCard';
import { StatutoryNumberingCard } from './StatutoryNumberingCard';
import { CreditFacilityCard } from './CreditFacilityCard';
import './screens-placeholder.css';

/** Settings → Business Defaults. */
export function BusinessDefaultsScreen() {
  return (
    <section className="settings-screen-placeholder">
      <h1 className="settings-screen-placeholder-title">
        <Localized id="settings-nav-business-defaults">Business Defaults</Localized>
      </h1>
      <RegionalSettingsCard />
      <LocalPaymentSettingsCard />
      <ReceiptFormatSettingsCard />
      <StatutoryNumberingCard />
      {/* F24: the `credit.*` family had a key, typed accessors, a bridge command,
          a setter, both shells registered and a UI API wrapper — and no screen.
          This is the screen. It makes the values settable; it does NOT make the
          ceiling enforced, which is stated on the card itself. */}
      <CreditFacilityCard />
    </section>
  );
}