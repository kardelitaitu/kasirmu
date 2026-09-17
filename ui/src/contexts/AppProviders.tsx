import type { ReactNode } from 'react';
import ErrorBoundary from '@/components/ErrorBoundary';
import { LocalizedErrorBoundary } from '@/components/LocalizedErrorBoundary';
import { GlobalErrorReporter } from '@/components/GlobalErrorReporter';
import { LocaleProvider } from '@/i18n/LocaleContext';
import { OrgLocaleSync } from '@/i18n/OrgLocaleSync';
import { BrandProvider } from '@/contexts/BrandContext';
import { ThemeProvider } from '@/frontend/shell/ThemeProvider';
import { CurrencyProvider } from '@/contexts/CurrencyContext';
import CurrencyWorkspaceSync from '@/contexts/CurrencyWorkspaceSync';
import { AuthProvider } from '@/contexts/AuthContext';
import { ToastProvider } from '@/components/Toast';
import { WorkspaceProvider } from '@/contexts/WorkspaceContext';
import { SubscriptionProvider } from '@/contexts/SubscriptionContext';
import { ZoomProvider } from '@/contexts/ZoomContext';
import { HardwareAccelProvider } from '@/contexts/HardwareAccelContext';
import { ImpersonationProvider } from '@/contexts/ImpersonationContext';
import { ImpersonationBanner } from '@/components/ImpersonationBanner';

interface AppProvidersProps {
  children: ReactNode;
}

/**
 * Full-page "Something went wrong" boundaries self-heal: auto-reload
 * after 30s if the user doesn't act. Embedded card-level boundaries
 * (workspace settings, topology editor, …) intentionally do NOT set
 * this, so a scoped failure never reloads the whole POS.
 */
const ERROR_AUTO_REFRESH_MS = 30_000;

/**
 * Composite provider wrapper that establishes application contexts in optimal dependency order.
 * 
 * Order of nesting:
 * 1. ErrorBoundary (Catches root render errors — emergency fallback)
 * 2. LocaleProvider (i18n string resolution)
 * 3. LocalizedErrorBoundary (Catches app render errors with localized copy)
 * 3. BrandProvider (Branding & Whitelabel settings)
 * 4. ThemeProvider (CSS custom properties, consumes useBrand)
 * 5. CurrencyProvider (Global currency state)
 * 6. AuthProvider (User session state)
 * 7. ToastProvider (Notification alerts)
 * 8. WorkspaceProvider (Store workspace context)
 * 9. SubscriptionProvider (Tier capabilities for C2.2 upgrade gates)
 * 10. ZoomProvider (Root font scaling)
 * 11. HardwareAccelProvider (CSS GPU acceleration flags)
 */
export function AppProviders({ children }: AppProvidersProps) {
  return (
    <ErrorBoundary autoRefreshMs={ERROR_AUTO_REFRESH_MS}>
      <LocaleProvider>
        {/* ERR-02: inner boundary resolves fallback copy through the active
            locale; the outer ErrorBoundary stays as the locale-independent
            emergency fallback in case LocaleProvider itself fails. */}
        <LocalizedErrorBoundary autoRefreshMs={ERROR_AUTO_REFRESH_MS}>
        <BrandProvider>
          <ThemeProvider>
            <CurrencyProvider>
              <AuthProvider>
            <ToastProvider>
              {/* ERR-01: global async-failure surface (window.error +
                  unhandledrejection) — must live inside ToastProvider so it
                  can surface a recoverable notification. */}
              <GlobalErrorReporter />
              <WorkspaceProvider>
                {/* CurrencyContext reload bridge: pushes each new session
                    token into refresh() so per-store defaults (CUR-03)
                    reach useCurrency consumers without a page reload. */}
                <CurrencyWorkspaceSync />
                {/* Regional slice 4: feeds the org/entity default locale
                    (one read of the slice-1 chain) into the locale
                    negotiation BELOW the stored per-user choice. */}
                <OrgLocaleSync />
                <SubscriptionProvider>
                  <ZoomProvider>
                    <HardwareAccelProvider>
                      <ImpersonationProvider>
                        <ImpersonationBanner />
                        {children}
                      </ImpersonationProvider>
                    </HardwareAccelProvider>
                  </ZoomProvider>
                </SubscriptionProvider>
              </WorkspaceProvider>
            </ToastProvider>
              </AuthProvider>
            </CurrencyProvider>
          </ThemeProvider>
        </BrandProvider>
        </LocalizedErrorBoundary>
      </LocaleProvider>
    </ErrorBoundary>
  );
}
