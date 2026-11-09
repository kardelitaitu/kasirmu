//! AppearanceScreen — Settings → Appearance.
//!
//! Composition, not a re-export, following the rule every other migrated settings
//! screen follows (DataManagementScreen.tsx:5-7, EmailReportsScreen.tsx): the route
//! and the scaffold shell stay on THIS screen, and the feature keeps its own
//! component and stylesheet.
//!
//! ROUND 158 mounted this. `AppearanceSettings` was the ONLY consumer of
//! `useAppZoom` and `useHardwareAccel` -- contexts that `AppProviders.tsx:121-128`
//! mounts app-wide on both shells. So the zoom and hardware-acceleration STATE ran
//! everywhere while nothing let a user change either: the 15-key settings rebuild
//! (registry.ts) simply dropped the `appearance` entry, as it had dropped
//! `email-reports` before round 155 found that one.
//!
//! The earlier `sections/AppearanceSection.tsx` was a SECOND unmounted body for the
//! same interface -- it imported this component and was labelled DEAD on 2026-09-15
//! by 13348f9aec. Round 157 deleted it; this screen mounts the surviving one.

import { Localized } from '@fluent/react';
import { AppearanceSettings } from '../AppearanceSettings';
import './screens-placeholder.css';

/** Settings → Appearance: brand colour, logo, store name, zoom and acceleration. */
export function AppearanceScreen() {
  return (
    <section className="settings-screen-placeholder">
      <h1 className="settings-screen-placeholder-title">
        <Localized id="settings-nav-appearance">Appearance</Localized>
      </h1>
      <AppearanceSettings />
    </section>
  );
}
