// ── C2.2 gate-test helper: build a SubscriptionCapabilities fixture ──

import type { SubscriptionCapabilities } from '@/api/subscription';

/** Minimal full-shaped capabilities fixture; pass overrides per test. */
export function makeSubscriptionCaps(
  overrides: Partial<SubscriptionCapabilities> = {},
): SubscriptionCapabilities {
  return {
    tier: 'free',
    state: 'active',
    maxStores: 1,
    maxPosInstances: 1,
    maxWarehouses: 1,
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
