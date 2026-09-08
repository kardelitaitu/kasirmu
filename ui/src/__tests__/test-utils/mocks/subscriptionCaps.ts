// ── C2.2 gate-test helper: build a SubscriptionCapabilities fixture ──

import type { SubscriptionCapabilities } from '@/api/subscription';

/** Minimal full-shaped capabilities fixture; pass overrides per test. */
export function makeSubscriptionCaps(
  overrides: Partial<SubscriptionCapabilities> = {},
): SubscriptionCapabilities {
  return {
    tier: 'free',
    state: 'active',
    maxLocations: 1,
    maxPosInstances: 1,
    maxWarehouses: 1,
    // Free: KDS unavailable at all, so the per-location cap is 0 — matches
    // SubscriptionTier::max_kds_screens, which returns Some(0) not None.
    maxKdsScreens: 0,
    maxStaffUsers: 1,
    salesHistoryDays: 90, // Free = 3 months (90 days)
    supportsQris: false,
    supportsAnalytics: false,
    supportsLoyalty: false,
    supportsDailyDashboard: false,
    supportsCloudSync: false,
    offlineGraceDays: 7,
    locationCount: 1,
    staffCount: 0,
    terminalCount: 0,
    addons: [],
    ...overrides,
  };
}
