import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppProviders } from '@/contexts/AppProviders';
import TabletAppShell from '@/app/tablet/TabletAppShell';
import { registerAllFeatures } from '@/features';
import { installPerfProbe } from './utils/perf-metrics';
import { setShellKind } from './utils/shellKind';
import './theme/reset.css';
import './theme/fonts.css';
import './theme/tokens.css';
import './theme/components.css';
import './theme/responsive.css';

// ── Register all UI features ─────────────────────────────────────────
registerAllFeatures();

// PERF-06: expose aggregate-only runtime metrics to automated checks.
installPerfProbe();

// ADR #54 §2.7: the Google control is excluded from the tablet build.
setShellKind('tablet');

// Root marker for tablet-only CSS. This is the only reliable one for
// FULLSCREEN routes (settings, staff, kds, …): they render outside
// TabletAppLayout, so they never carry its `.tablet-shell` class, and
// `.workspace-fullscreen` is shared with the desktop shell. Without this,
// a tablet-only layout rule has no ancestor to key off and has to be
// scoped by viewport width — which is wrong at 686px portrait, where the
// tablet must NOT be treated as a phone (that mis-scoping is what hid the
// settings sidebar; see SettingsNavTree.css).
document.documentElement.dataset['shell'] = 'tablet';

// ── Render ───────────────────────────────────────────────────────
//
// The tablet entry renders through the SAME shared provider stack as the
// desktop entry (AppProviders), rather than hand-rolling its own. That
// duplication was the root cause of a recurring defect class:
//
//   - TAB-04: ThemeProvider consumes useBrand() and throws without
//     BrandProvider — the hand-rolled stack omitted it and the tablet
//     entry mis-rendered at boot.
//   - F-034: the stack omitted SubscriptionProvider, ZoomProvider and
//     HardwareAccelProvider, so AppearanceSettings' useZoom /
//     useHardwareAccel consumers threw at render.
//   - 2026-10-05: the stack omitted ImpersonationProvider, so
//     StaffManagementScreen (which calls useImpersonation()
//     unconditionally) threw on open and — because the hand-rolled
//     stack also carried no ErrorBoundary — took the whole WebView to
//     a blank screen instead of a recoverable error page.
//
// Each was previously "fixed" by adding the one missing provider, which
// left the next omission free to happen. Consuming AppProviders ends the
// class: any provider added there now reaches the tablet automatically,
// and AppProviders.test.tsx covers the ordering for both shells.
//
// LocaleProvider and setShellKind('tablet') are handled above/below:
// AppProviders owns LocaleProvider, so this entry no longer nests one —
// nesting two Fluent LocalizationProviders would shadow the shared
// locale negotiation (F-035, which moved the tablet OFF a frozen
// en-US localization and ONTO that shared path).
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppProviders>
      <TabletAppShell />
    </AppProviders>
  </React.StrictMode>,
);
