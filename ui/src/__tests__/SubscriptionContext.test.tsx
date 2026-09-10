/**
 * Tests for `SubscriptionProvider` / `useSubscription` — the C2.2
 * subscription capabilities context.
 *
 * Fetches capabilities once at mount, exposes the lifecycle state (§B:
 * active/grace/expired/canceled/paused/unavailable, plus the provider's
 * own `loading` phase), reports `unavailable` on failure (fail-closed),
 * and exposes a refresh callback. The provider is the gate for every
 * tier-limited feature (analytics, loyalty, QRIS, location limits).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { SubscriptionProvider, useSubscription, useAdminGate } from '@/contexts/SubscriptionContext';
import type { SubscriptionCapabilities } from '@/api/subscription';

// ── Opt out of the global SubscriptionContext stub ─────────────────────
// The setupFile installs a safe-default mock for `useSubscription`
// (`caps: null, loading: false`) so tier-gated screens render without a
// provider. This file exercises the REAL provider, so the stub must be
// removed — `vi.unmock` is hoisted to the top of the file.
vi.unmock('@/contexts/SubscriptionContext');

// ── Hoisted mock state ────────────────────────────────────────────────
// `vi.spyOn` on the module namespace cannot intercept the provider's
// static named import (`import { getSubscriptionCapabilities } from
// '@/api/subscription'` resolves the binding before the spy mutates the
// namespace). The codebase pattern is a hoisted module mock whose
// factory forwards to `vi.hoisted` fns that each test configures.
const mocks = vi.hoisted(() => ({
  getSubscriptionCapabilities: vi.fn(),
}));

vi.mock('@/api/subscription', async (importOriginal) => ({
  // Spread the real module so named imports elsewhere in the graph (e.g.
  // OverQuotaCard's perLocationMarkers, added with the per-location quota
  // caps) resolve even though this suite only spies on one function.
  ...(await importOriginal<typeof import('@/api/subscription')>()),
  getSubscriptionCapabilities: (...args: unknown[]) =>
    mocks.getSubscriptionCapabilities(...args),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <SubscriptionProvider>{children}</SubscriptionProvider>
);

const caps: SubscriptionCapabilities = {
  tier: 'pro',
  state: 'active',
  // Hard-required C+D-RES-1 keys (W7-C residual): paid Pro, no trial,
  // no payload feature overrides.
  isTrial: false,
  trialEndsAt: null,
  features: {},
  maxLocations: 10,
  maxPosInstances: 5,
  maxWarehouses: 3,
  // Pro tier's per-location KDS cap (SubscriptionTier::max_kds_screens).
  maxKdsScreens: 2,
  maxStaffUsers: 20,
  salesHistoryDays: 365,
  supportsQris: true,
  supportsAnalytics: true,
  addons: [],
  supportsLoyalty: true,
  supportsDailyDashboard: true,
  supportsCloudSync: true,
  offlineGraceDays: 30,
  locationCount: 2,
  staffCount: 5,
  terminalCount: 3,
};

// A never-resolving promise keeps the initial read in flight so the
// `loading=true` state can be asserted synchronously after mount.
const neverResolve = new Promise<never>(() => {});
neverResolve.catch(() => {}); // Suppress unhandled rejection warning

describe('SubscriptionProvider', () => {
  beforeEach(() => {
    mocks.getSubscriptionCapabilities.mockReset();
  });

  it('starts with loading=true', () => {
    mocks.getSubscriptionCapabilities.mockReturnValue(neverResolve);
    const { result } = renderHook(() => useSubscription(), { wrapper });
    expect(result.current.loading).toBe(true);
    expect(result.current.caps).toBeNull();
    expect(result.current.state).toBe('loading');
  });

  it('resolves caps and sets loading=false on success', async () => {
    mocks.getSubscriptionCapabilities.mockResolvedValue(caps);
    const { result } = renderHook(() => useSubscription(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.caps).toEqual(caps);
    expect(result.current.state).toBe('active');
  });

  it('reports the backend lifecycle state verbatim', async () => {
    // §B: the backend is the state authority — grace/expired/canceled/
    // paused flow through verbatim with the fail-closed Free entitlements
    // the command already applied.
    mocks.getSubscriptionCapabilities.mockResolvedValue({
      ...caps,
      tier: 'free',
      state: 'grace',
      supportsQris: false,
    });
    const { result } = renderHook(() => useSubscription(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.state).toBe('grace');
    expect(result.current.caps?.tier).toBe('free');
  });

  it('degradates to caps=null + unavailable state on API failure', async () => {
    mocks.getSubscriptionCapabilities.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useSubscription(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.caps).toBeNull();
    // §B fail-closed: a missing response must not look like a healthy one.
    expect(result.current.state).toBe('unavailable');
  });

  it('refresh re-fetches capabilities and loads them', async () => {
    mocks.getSubscriptionCapabilities.mockResolvedValue(caps);
    const { result } = renderHook(() => useSubscription(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Change the server response and refresh.
    const updated: SubscriptionCapabilities = { ...caps, tier: 'premium' };
    mocks.getSubscriptionCapabilities.mockResolvedValue(updated);
    act(() => {
      result.current.refresh();
    });

    await waitFor(() => expect(result.current.caps?.tier).toBe('premium'));
    expect(result.current.loading).toBe(false);
  });

  it('refresh degrades to null + unavailable on failure', async () => {
    mocks.getSubscriptionCapabilities.mockResolvedValue(caps);
    const { result } = renderHook(() => useSubscription(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.state).toBe('active');

    // Refresh fails.
    mocks.getSubscriptionCapabilities.mockRejectedValue(new Error('gone'));
    act(() => {
      result.current.refresh();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.caps).toBeNull());
    expect(result.current.state).toBe('unavailable');
  });

  describe('useAdminGate (§B operational vs admin split)', () => {
    it('reports unlocked when subscription state is active', async () => {
      mocks.getSubscriptionCapabilities.mockResolvedValue({
        ...caps,
        state: 'active',
      });
      const { result } = renderHook(() => useAdminGate(), { wrapper });
      await waitFor(() => expect(result.current.locked).toBe(false));
      expect(result.current.state).toBe('active');
    });

    it('reports locked when subscription state is grace (operational continues, admin locks)', async () => {
      mocks.getSubscriptionCapabilities.mockResolvedValue({
        ...caps,
        state: 'grace',
      });
      const { result } = renderHook(() => useAdminGate(), { wrapper });
      await waitFor(() => expect(result.current.locked).toBe(true));
      expect(result.current.state).toBe('grace');
    });

    it('reports locked when subscription state is expired, canceled, paused, or unavailable', async () => {
      for (const st of ['expired', 'canceled', 'paused', 'unavailable'] as const) {
        mocks.getSubscriptionCapabilities.mockResolvedValue({
          ...caps,
          state: st,
        });
        const { result } = renderHook(() => useAdminGate(), { wrapper });
        await waitFor(() => expect(result.current.locked).toBe(true));
        expect(result.current.state).toBe(st);
      }
    });
  });
});
