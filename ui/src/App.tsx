import { lazy } from 'react';
import AppShell from '@/app/AppShell';
import { registerAllFeatures } from '@/features';
import { AppProviders } from '@/contexts/AppProviders';
import { useDisableAutofill } from '@/hooks/useDisableAutofill';

// ── Register all feature pages & nav items ──────────────────────────
registerAllFeatures();

// The DevToolbar renders in dev mode unless explicitly disabled via
// VITE_DEV_TOOLBAR=0. E2E tests set that flag (Playwright webServer env /
// run-e2e.mjs) because the fixed bottom-right overlay would otherwise sit
// on top of POS action buttons and intercept pointer events.
const DEV_TOOLBAR_ENABLED =
  import.meta.env.DEV && import.meta.env['VITE_DEV_TOOLBAR'] !== '0';

const DevToolbar = DEV_TOOLBAR_ENABLED
  ? lazy(() => import('@/features/design/DevToolbar').then((m) => ({ default: m.DevToolbar })))
  : null;

/**
 * Root app component. Wraps the app shell with consolidated AppProviders.
 * DevToolbar renders only in development mode (see DEV_TOOLBAR_ENABLED).
 */
function AutofillBlocker() {
  useDisableAutofill();
  return null;
}

export default function App() {
  return (
    <AppProviders>
      <AutofillBlocker />
      <AppShell />
      {DEV_TOOLBAR_ENABLED && DevToolbar && <DevToolbar />}
    </AppProviders>
  );
}
