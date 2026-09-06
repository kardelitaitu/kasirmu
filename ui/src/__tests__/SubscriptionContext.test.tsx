/**
 * Tests for `SubscriptionProvider` / `useSubscription` — the C2.2
 * subscription capabilities context.
 *
 * Fetches capabilities once at mount, degrades to null on failure, and
 * exposes a refresh callback. The provider is the gate for every
 * tier-limited feature (analytics, loyalty, QRIS, store limits).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { SubscriptionProvider, useSubscription } from '@/contexts/SubscriptionContext';
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

vi.mock('@/api/subscription', () => ({
  getSubscriptionCapabilities: (...args: unknown[]) =>
    mocks.getSubscriptionCapabilities(...args),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <SubscriptionProvider>{children}</SubscriptionProvider>
);

const caps: SubscriptionCapabilities = {
  tier: 'pro',
  maxStores: 10,
  maxPosInstances: 5,
  maxWarehouses: 3,
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
  });

  it('resolves caps and sets loading=false on success', async () => {
    mocks.getSubscriptionCapabilities.mockResolvedValue(caps);
    const { result } = renderHook(() => useSubscription(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.caps).toEqual(caps);
  });

  it('degradates to caps=null on API failure', async () => {
    mocks.getSubscriptionCapabilities.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useSubscription(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.caps).toBeNull();
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

  it('refresh degrades to null on failure', async () => {
    mocks.getSubscriptionCapabilities.mockResolvedValue(caps);
    const { result } = renderHook(() => useSubscription(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Refresh fails.
    mocks.getSubscriptionCapabilities.mockRejectedValue(new Error('gone'));
    act(() => {
      result.current.refresh();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.caps).toBeNull());
  });
});
