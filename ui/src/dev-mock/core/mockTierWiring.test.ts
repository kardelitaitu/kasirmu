/**
 * The tier switch, proved END TO END through the real handlers.
 *
 * `mockTierParity.test.ts` proves the TABLE matches Rust. This file proves the
 * table is actually WIRED — that selecting a tier changes what the preview
 * serves. The distinction is the whole point: before this work the preview
 * hardcoded seven tier literals across three files, so a table could have been
 * perfect and read by nobody. These assertions call the same handlers the
 * dispatcher calls, so a handler that stops reading the tier fails here.
 */

import { describe, it, expect, afterEach } from 'vitest';

import { MOCK_TIER_CAPS, MOCK_TIER_KEYS, getMockTier, resetMockTier, setMockTier, type MockTierKey } from './mockTier';
import { licenseHandlers } from '../handlers/settings';
import { systemHandlers } from '../handlers/system';

const licenseOf = () =>
  licenseHandlers['get_license_status']!({}) as { tier: string | null };

const capsOf = () =>
  systemHandlers['get_subscription_capabilities']!({}) as {
    tier: string;
    maxLocations: number | null;
    maxPosInstances: number | null;
    maxWarehouses: number | null;
    maxKdsScreens: number | null;
    maxStaffUsers: number | null;
    salesHistoryDays: number | null;
    supportsQris: boolean;
    supportsAnalytics: boolean;
    supportsLoyalty: boolean;
    supportsDailyDashboard: boolean;
    supportsCloudSync: boolean;
    offlineGraceDays: number;
  };

const verdictOf = (feature: string) =>
  systemHandlers['explain_feature_availability_scoped']!({ feature }) as {
    available: boolean;
    reason: string | null;
    detail: { tier: string; limit: number | null };
  };

afterEach(() => {
  resetMockTier();
});

describe('the selected tier reaches the handlers', () => {
  it('drives the licence row and the caps payload from one value', () => {
    for (const tier of MOCK_TIER_KEYS) {
      setMockTier(tier);
      // Both surfaces must agree. They disagreed before this work: the licence
      // row said 'pro' while every caps field said 'premium'.
      expect(licenseOf().tier).toBe(tier);
      expect(capsOf().tier).toBe(tier);
    }
  });

  it('projects every quota field from the table, not from a literal', () => {
    for (const tier of MOCK_TIER_KEYS) {
      setMockTier(tier);
      const caps = capsOf();
      const expected = MOCK_TIER_CAPS[tier];
      expect(caps.maxLocations, `${tier}.maxLocations`).toBe(expected.maxLocations);
      expect(caps.maxPosInstances, `${tier}.maxPosInstances`).toBe(expected.maxPosInstances);
      expect(caps.maxWarehouses, `${tier}.maxWarehouses`).toBe(expected.maxWarehouses);
      expect(caps.maxKdsScreens, `${tier}.maxKdsScreens`).toBe(expected.maxKdsScreens);
      expect(caps.maxStaffUsers, `${tier}.maxStaffUsers`).toBe(expected.maxStaffUsers);
      expect(caps.salesHistoryDays, `${tier}.salesHistoryDays`).toBe(expected.salesHistoryDays);
      expect(caps.supportsQris, `${tier}.supportsQris`).toBe(expected.supportsQris);
      expect(caps.supportsAnalytics, `${tier}.supportsAnalytics`).toBe(expected.supportsAnalytics);
      expect(caps.supportsLoyalty, `${tier}.supportsLoyalty`).toBe(expected.supportsLoyalty);
      expect(caps.supportsDailyDashboard, `${tier}.supportsDailyDashboard`).toBe(expected.supportsDailyDashboard);
      expect(caps.supportsCloudSync, `${tier}.supportsCloudSync`).toBe(expected.supportsCloudSync);
      expect(caps.offlineGraceDays, `${tier}.offlineGraceDays`).toBe(expected.offlineGraceDays);
    }
  });

  it('turns KDS from a zero cap into unlimited, never through a literal', () => {
    // Free/Plus are 0 — a tier that cannot run KDS at all. Premium/Enterprise
    // are null — unlimited. The original fixture answered null for EVERY tier,
    // which is the difference this asserts.
    for (const tier of ['free', 'plus'] as const) {
      setMockTier(tier);
      expect(capsOf().maxKdsScreens, `${tier} must cap KDS at 0`).toBe(0);
    }
    for (const tier of ['premium', 'enterprise'] as const) {
      setMockTier(tier);
      expect(capsOf().maxKdsScreens, `${tier} must be unlimited`).toBeNull();
    }
  });

  it('gates the availability verdict per tier and names the tier refusal', () => {
    // Analytics is Pro and above (SubscriptionTier::supports_analytics), so the
    // boundary between Plus and Pro is the sharpest single assertion available.
    for (const { tier, expected } of [
      { tier: 'free', expected: false },
      { tier: 'plus', expected: false },
      { tier: 'pro', expected: true },
      { tier: 'premium', expected: true },
      { tier: 'enterprise', expected: true },
    ] as Array<{ tier: MockTierKey; expected: boolean }>) {
      setMockTier(tier);
      const verdict = verdictOf('supports_analytics');
      expect(verdict.available, `${tier} analytics`).toBe(expected);
      expect(verdict.detail.tier).toBe(tier);
      // A refusal is a TIER refusal, not a silent false.
      expect(verdict.reason).toBe(expected ? null : 'tier');
    }
  });

  it('reports a quota limit from the selected tier', () => {
    setMockTier('free');
    expect(verdictOf('locations').detail.limit).toBe(1);
    setMockTier('premium');
    expect(verdictOf('locations').detail.limit).toBe(5);
    setMockTier('enterprise');
    expect(verdictOf('locations').detail.limit).toBeNull();
  });

  it('still rejects an unknown feature key rather than answering available', () => {
    setMockTier('enterprise');
    expect(() => verdictOf('supports_teleportation')).toThrow(/unknown feature key/);
  });

  it('defaults to premium so the switch changes nothing until used', () => {
    resetMockTier();
    expect(getMockTier()).toBe('premium');
  });
});
