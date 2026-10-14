//! A11y regression tests for two more KDS surfaces:
//! KdsNoticeBanners (the stacked error / storage / dead-letter / offline
//! banners, four branches with dismiss and retry actions) and
//! KdsDeviceStatusIndicator (the connection pill and its dropdown).
//!
//! Neither had axe coverage. The banners are the KDS's only rollback affordance
//! when something fails, so their action buttons being named matters.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { renderWithProviders, checkA11y } from './axe-helper';
import { KdsNoticeBanners } from '@/features/kds/components/KdsNoticeBanners';
import kdsFtl from '@/locales/kds.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';

const FTL = [sharedFtl, kdsFtl];

const { mockListDevices } = vi.hoisted(() => ({ mockListDevices: vi.fn() }));

vi.mock('@/api/kds', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/kds')>()),
  listKdsDevicesScoped: () => mockListDevices(),
}));

function makeBannerProps(overrides: Record<string, unknown> = {}) {
  return {
    error: null,
    onRetryError: vi.fn(),
    onDismissError: vi.fn(),
    storageUnavailable: false,
    deadLetterLength: 0,
    onRetryDeadLetter: vi.fn(),
    onClearDeadLetter: vi.fn(),
    online: true,
    offlineDismissed: false,
    pendingQueueLength: 0,
    onRetryPending: vi.fn(),
    onDismissOffline: vi.fn(),
    ...overrides,
  } as React.ComponentProps<typeof KdsNoticeBanners>;
}

describe('KdsNoticeBanners a11y', () => {
  it('has no axe violations with the error banner showing', async () => {
    const { container } = renderWithProviders(
      <KdsNoticeBanners {...makeBannerProps({ error: 'KDS queue unavailable' })} />,
      ...FTL,
    );
    await checkA11y(container);

    // Vacuity guard + NAME PINS. axe does NOT flag these buttons when their
    // aria-label is removed: the dismiss control's visible "×" and the retry
    // control's "Retry" text still count as an accessible name. But "×" is not
    // a name a screen-reader user can act on, and the markup intends the
    // localized label, so the attributes are asserted rather than left to axe.
    expect(container.querySelector('.kds-error-banner')).toBeTruthy();
    expect(container.textContent).toContain('KDS queue unavailable');
    const retry = container.querySelector('[data-testid="kds-error-retry"]') as HTMLElement;
    const dismiss = container.querySelector('[data-testid="kds-error-dismiss"]') as HTMLElement;
    expect(retry.getAttribute('aria-label')).toBeTruthy();
    expect(dismiss.getAttribute('aria-label')).toBeTruthy();
  });

  it('has no axe violations with the offline/queued banner showing', async () => {
    const { container } = renderWithProviders(
      <KdsNoticeBanners
        {...makeBannerProps({ online: false, pendingQueueLength: 4 })}
      />,
      ...FTL,
    );
    await checkA11y(container);

    const banner = container.querySelector('.kds-offline-banner');
    expect(banner).toBeTruthy();
    // Same name-pin reasoning as the error banner's dismiss control.
    for (const testid of ['kds-offline-retry', 'kds-offline-dismiss']) {
      const el = container.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null;
      if (el) expect(el.getAttribute('aria-label'), testid).toBeTruthy();
    }
  });

  it('has no axe violations with the storage and dead-letter warnings showing', async () => {
    const { container } = renderWithProviders(
      <KdsNoticeBanners
        {...makeBannerProps({ storageUnavailable: true, deadLetterLength: 3 })}
      />,
      ...FTL,
    );
    await checkA11y(container);

    expect(container.querySelector('.kds-offline-banner')).toBeTruthy();
    const dlRetry = container.querySelector('[data-testid="kds-deadletter-retry"]') as HTMLElement | null;
    const dlDismiss = container.querySelector('[data-testid="kds-deadletter-dismiss"]') as HTMLElement | null;
    if (dlRetry) expect(dlRetry.getAttribute('aria-label')).toBeTruthy();
    if (dlDismiss) expect(dlDismiss.getAttribute('aria-label')).toBeTruthy();
  });
});

describe('KdsDeviceStatusIndicator a11y', () => {
  beforeEach(() => {
    mockListDevices.mockReset().mockResolvedValue([]);
  });

  it('has no axe violations with no devices and an enroll action', async () => {
    const { KdsDeviceStatusIndicator } = await import(
      '@/features/kds/components/KdsDeviceStatusIndicator'
    );
    const { container } = renderWithProviders(
      <KdsDeviceStatusIndicator sessionToken="tok" onEnrollDevice={vi.fn()} />,
      ...FTL,
    );
    await waitFor(() => {
      expect(container.querySelector('[data-testid="kds-device-status-enroll"]')).toBeTruthy();
    });
    await checkA11y(container);

    // With ZERO devices the component deliberately renders the ENROLL button
    // alone — there is no status pill to toggle yet — so that is the element
    // this branch is about, and it must carry a name.
    const enroll = container.querySelector('[data-testid="kds-device-status-enroll"]') as HTMLElement;
    expect(enroll.getAttribute('aria-label')).toBeTruthy();
    expect(container.querySelector('[data-testid="kds-device-status-toggle"]')).toBeNull();
  });

  it('has no axe violations with a registered device (status toggle shown)', async () => {
    mockListDevices.mockResolvedValue([
      {
        id: 'dev-1',
        name: 'Grill Display',
        connection_status: 'connected',
        last_seen_at: new Date().toISOString(),
      },
    ]);
    const { KdsDeviceStatusIndicator } = await import(
      '@/features/kds/components/KdsDeviceStatusIndicator'
    );
    const { container } = renderWithProviders(
      <KdsDeviceStatusIndicator sessionToken="tok" onEnrollDevice={vi.fn()} />,
      ...FTL,
    );
    await waitFor(() => {
      expect(container.querySelector('[data-testid="kds-device-status-toggle"]')).toBeTruthy();
    });
    await checkA11y(container);

    // Vacuity guard: the pill is a real button with a name.
    const toggle = container.querySelector('[data-testid="kds-device-status-toggle"]') as HTMLElement;
    expect(toggle.getAttribute('aria-label')).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});
