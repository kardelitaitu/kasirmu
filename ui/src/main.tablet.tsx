import React from 'react';
import ReactDOM from 'react-dom/client';
import { LocaleProvider } from '@/i18n/LocaleContext';
import { OrgLocaleSync } from '@/i18n/OrgLocaleSync';
import { BrandProvider } from '@/contexts/BrandContext';
import { ThemeProvider } from '@/frontend/shell/ThemeProvider';
import { CurrencyProvider } from '@/contexts/CurrencyContext';
import CurrencyWorkspaceSync from '@/contexts/CurrencyWorkspaceSync';
import { AuthProvider } from '@/contexts/AuthContext';
import { WorkspaceProvider } from '@/contexts/WorkspaceContext';
import { SubscriptionProvider } from '@/contexts/SubscriptionContext';
import { ZoomProvider } from '@/contexts/ZoomContext';
import { HardwareAccelProvider } from '@/contexts/HardwareAccelContext';
import { ToastProvider } from '@/frontend/shared/Toast';
import TabletAppShell from '@/frontend/shell/tablet/TabletAppShell';
import { registerAllFeatures } from '@/features';
import { installPerfProbe } from './utils/perf-metrics';
import './frontend/themes/reset.css';
import './frontend/themes/fonts.css';
import './frontend/themes/tokens.css';
import './frontend/themes/components.css';
import './frontend/themes/responsive.css';

// ── Register all UI features ─────────────────────────────────────────
registerAllFeatures();

// PERF-06: expose aggregate-only runtime metrics to automated checks.
installPerfProbe();

// ── Render ───────────────────────────────────────────────────────

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {/* F-035: the tablet entry froze Fluent to en-US via
        createEnUsLocalization(). LocaleProvider is the shared
        provisioning path (localStorage restore → browser negotiation →
        'id' default) and renders the Fluent LocalizationProvider
        itself, so tablet locales now track the desktop behaviour. */}
    <LocaleProvider>
      {/* ThemeProvider consumes useBrand() and throws without it; the
          desktop entry gets this from AppProviders, so the tablet entry
          must provide it explicitly (TAB-04 boot blocker). */}
      <BrandProvider>
      <ThemeProvider>
        <CurrencyProvider>
          <AuthProvider>
            <ToastProvider>
              <WorkspaceProvider>
                {/* CurrencyContext reload bridge (parity with
                    AppProviders): per-store scoped default (CUR-03)
                    reaches useCurrency on every workspace switch. */}
                <CurrencyWorkspaceSync />
                {/* Regional slice 4 (parity with AppProviders): feeds the
                    org/entity default locale into the locale negotiation
                    BELOW the stored per-user choice. */}
                <OrgLocaleSync />
                {/* F-034: the desktop entry nests Subscription (C2.2
                    upgrade gates), Zoom (root font scaling) and
                    HardwareAccel inside WorkspaceProvider — the tablet
                    entry omitted all three, so AppearanceSettings'
                    useZoom/useHardwareAccel consumers threw at render. */}
                <SubscriptionProvider>
                  <ZoomProvider>
                    <HardwareAccelProvider>
                      <TabletAppShell />
                    </HardwareAccelProvider>
                  </ZoomProvider>
                </SubscriptionProvider>
              </WorkspaceProvider>
            </ToastProvider>
          </AuthProvider>
        </CurrencyProvider>
      </ThemeProvider>
      </BrandProvider>
    </LocaleProvider>
  </React.StrictMode>,
);
