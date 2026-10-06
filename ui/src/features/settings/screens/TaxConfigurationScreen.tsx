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
      <TaxConfigurationBody />
    </section>
  );
}
