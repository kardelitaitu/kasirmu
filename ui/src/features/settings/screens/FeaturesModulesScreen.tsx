//! FeaturesModulesScreen — Settings → Features & Modules.
//!
//! Migrated 2026-10-06 from `features/settings/FeatureToggleScreen.tsx`, per the
//! provenance this scaffold named while it was still blank. Composition, not a
//! re-export: the route, the scaffold shell and its migrating note stay on this
//! screen while the feature-flag screen keeps its own component and stylesheet.
//!
//! `embedded` suppresses the composed screen's own <h1> ("Feature Toggles"),
//! which would otherwise sit under this scaffold's heading. Its search box, bulk
//! actions and 32 flag rows are all real content and stay.
//!
//! NOTE the two titles differ on purpose: the SIDEBAR entry and this scaffold say
//! "Features & Modules" while the screen's own heading says "Feature Toggles".
//! That difference is why the ambiguity that killed the tax migration does not
//! arise here — but `embedded` is still passed, because the composing page owns
//! the page title.

import { Localized } from '@fluent/react';
import FeatureToggleBody from '@/features/settings/FeatureToggleScreen';
import './screens-placeholder.css';

/** Settings → Features & Modules: the real feature-flag screen as the body. */
export function FeaturesModulesScreen() {
  return (
    <section className="settings-screen-placeholder">
      <h1 className="settings-screen-placeholder-title">
        <Localized id="settings-nav-features-modules">Features &amp; Modules</Localized>
      </h1>
      <FeatureToggleBody embedded />
    </section>
  );
}
