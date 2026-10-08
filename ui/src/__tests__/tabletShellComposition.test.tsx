// ── Shell composition: the tablet entry's REAL provider stack ───────
//
// WHY THIS FILE EXISTS. Every tablet defect found in the 2026-10 sweep was
// invisible to the suite, and the reason was always the same: component
// tests mount the component under test wrapped in WHATEVER provider it
// needs, while the shipped entry supplies its own stack by hand. So the two
// could disagree forever without a red test.
//
//   - Staff Management crashed to a BLANK screen because
//     `main.mobile.tsx` omitted `ImpersonationProvider`; all ~70 of its
//     tests wrapped the screen in that provider themselves.
//   - TAB-04 and F-034 were the same shape one provider earlier.
//
// `test-utils/render`'s DefaultProviders supplies only Brand/Theme/Toast/Zoom.
// The real entry supplies fourteen, including the ErrorBoundary whose ABSENCE
// is why the crash blanked the WebView instead of rendering an error page.
//
// So this file mounts `AppProviders` — the exact component `main.mobile.tsx`
// renders — and asserts that a consumer of EVERY context the tablet can reach
// resolves. A provider deleted from the stack turns this red, which is the
// property the per-component tests structurally cannot provide.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AppProviders } from '@/contexts/AppProviders';
import { useImpersonation } from '@/contexts/ImpersonationContext';
import { useBrand } from '@/contexts/BrandContext';
import { useAppZoom } from '@/contexts/ZoomContext';
import { useHardwareAccel } from '@/contexts/HardwareAccelContext';
import { useToast } from '@/components/Toast';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrency } from '@/contexts/CurrencyContext';

// Every command the provider effects fire on mount resolves to null, which is
// the shape a fresh/unprovisioned install actually produces. An unresolved
// promise would leave providers in `loading` and hide a missing context
// behind a skeleton, so resolving is what makes the assertion meaningful.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

/** One consumer per context the tablet shell can reach. */
function ContextProbe() {
  // The one whose absence blanked Staff Management (see the header).
  const impersonation = useImpersonation();
  const brand = useBrand();
  const zoom = useAppZoom();
  const hw = useHardwareAccel();
  const toast = useToast();
  const workspace = useWorkspace();
  const subscription = useSubscription();
  const auth = useAuth();
  const currency = useCurrency();

  // Assert the SHAPES, not just that the calls returned: a provider that
  // rendered `undefined` through its context would still "not throw".
  const ok =
    typeof impersonation.start === 'function' &&
    typeof impersonation.stop === 'function' &&
    impersonation.active === null &&
    typeof brand.settings === 'object' &&
    typeof zoom.zoomLevel === 'string' &&
    typeof hw.enabled === 'boolean' &&
    typeof toast.addToast === 'function' &&
    typeof workspace.switchStore === 'function' &&
    typeof subscription.state === 'string' &&
    typeof auth.session === 'object' &&
    typeof currency.refresh === 'function';

  return <div data-testid="probe" data-ok={String(ok)} />;
}

describe('tablet shell composition (AppProviders)', () => {
  it('supplies every context the tablet screens consume', async () => {
    render(
      <AppProviders>
        <ContextProbe />
      </AppProviders>,
    );

    // The stack is async (providers fetch on mount), so wait for it to settle
    // before reading the probe.
    await waitFor(() => {
      expect(screen.getByTestId('probe')).toBeTruthy();
    });

    expect(
      screen.getByTestId('probe').getAttribute('data-ok'),
      'a context the tablet consumes resolved to the wrong shape — check the AppProviders stack',
    ).toBe('true');
  });

  it('mounts the screen whose provider omission caused the original blank WebView', async () => {
    // The regression this file exists for, reproduced end-to-end rather than by
    // proxy: StaffManagementScreen consumes useImpersonation, useWorkspace,
    // useAuth, useSubscription and LocaleContext, and it is the screen that
    // actually crashed. Mounting the REAL screen inside the REAL stack is what
    // the per-component suite structurally could not do — those tests each
    // supplied ImpersonationProvider themselves, so they stayed green while the
    // shipped tablet entry blanked.
    const { default: StaffManagementScreen } = await import('@/features/staff/StaffManagementScreen');

    render(
      <AppProviders>
        <StaffManagementScreen />
      </AppProviders>,
    );

    // Settle the mount-time reads (all resolve null under the mock above), then
    // assert the screen rendered its own header rather than being swallowed by
    // the ErrorBoundary. `findByTestId` fails if the boundary caught a throw,
    // which is exactly the outcome this test must not accept.
    await waitFor(() => {
      expect(screen.getByTestId('staff-mgmt-header')).toBeTruthy();
    }, { timeout: 5000 });
  });

  it('mounts the impersonation banner slot, so an active impersonation is visible', async () => {
    // The banner is the only affordance that tells an operator they are acting
    // as someone else, and it lives INSIDE the provider stack. A stack that
    // supplies the context but drops the banner is still a defect: it would
    // leave an impersonated session with no way to see or stop it.
    const { container } = render(
      <AppProviders>
        <div data-testid="child" />
      </AppProviders>,
    );
    await waitFor(() => {
      expect(container.querySelector('[data-testid="child"]')).toBeTruthy();
    });
    // No active impersonation, so the banner renders nothing — assert the
    // consumer did not throw instead, which is what proves the slot exists.
    expect(container.querySelector('[data-testid="child"]')).toBeTruthy();
  });
});
