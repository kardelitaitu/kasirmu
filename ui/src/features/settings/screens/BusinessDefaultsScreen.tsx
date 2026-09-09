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
      <p className="settings-screen-placeholder-note">
        <Localized id="settings-screen-migrating">
          Existing settings content will move here selectively.
        </Localized>
      </p>
    </section>
  );
}