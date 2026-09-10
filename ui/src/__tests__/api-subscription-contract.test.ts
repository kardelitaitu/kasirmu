// ── IPC contract tests for subscription.ts ───────────────────────
//
// Verifies every IPC-exported function calls loggedInvoke with the
// correct IPC command name and argument shape, and that the value
// resolved by the backend is passed through untouched. Pure helper
// exports (isPerLocationMarker / perLocationMarkers / isOverQuota /
// excessOf) take no IPC path and are covered in a separate block.
//
// NOTE (retire-aggregate-dedup): these subscription assertions were
// extracted from api-small-modules-contract.test.ts when the per-module
// contract scheme was adopted; subscription had no per-module file of its
// own, so the coverage moves here rather than being deleted.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (cmd: string, args?: Record<string, unknown>) => mockInvoke(cmd, args),
}));

import {
  getSubscriptionCapabilities,
  explainFeatureAvailability,
  getOverQuotaReport,
  isPerLocationMarker,
  perLocationMarkers,
  isOverQuota,
  excessOf,
  type SubscriptionCapabilities,
  type OverQuotaReport,
  type OverQuotaMarkerRow,
  type QuotaUsageRow,
} from '@/api/subscription';

const CAPS = {
  tier: 'plus',
  state: 'active',
  isTrial: false,
  trialEndsAt: null,
  features: {},
  maxLocations: 5,
  maxPosInstances: 3,
  maxWarehouses: 2,
  maxKdsScreens: 4,
  maxStaffUsers: 10,
  salesHistoryDays: 365,
  supportsQris: true,
  supportsAnalytics: true,
  supportsLoyalty: true,
  supportsDailyDashboard: true,
  supportsCloudSync: true,
  offlineGraceDays: 7,
  locationCount: 1,
  staffCount: 2,
  terminalCount: 1,
  addons: [],
} satisfies SubscriptionCapabilities;

describe('subscription.ts IPC contract', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('getSubscriptionCapabilities → get_subscription_capabilities (no args) and passes the caps through', async () => {
    mockInvoke.mockResolvedValue(CAPS);
    const result = await getSubscriptionCapabilities();
    expect(mockInvoke).toHaveBeenCalledWith('get_subscription_capabilities', undefined);
    expect(result.tier).toBe('plus');
    expect(result.maxLocations).toBe(5);
    // C+D-RES-1: the trial-state + feature-grant projection is pinned -
    // the fields must EXIST and carry null-when-absent semantics, never
    // invented defaults.
    expect(result.isTrial).toBe(false);
    expect(result.trialEndsAt).toBeNull();
    expect(result.features).toEqual({});
    const trialCaps = {
      ...CAPS,
      isTrial: true,
      trialEndsAt: '2026-12-01T00:00:00Z',
      features: { supports_analytics: true },
    } satisfies SubscriptionCapabilities;
    mockInvoke.mockResolvedValue(trialCaps);
    const trial = await getSubscriptionCapabilities();
    expect(trial.isTrial).toBe(true);
    expect(trial.trialEndsAt).toBe('2026-12-01T00:00:00Z');
    expect(trial.features).toEqual({ supports_analytics: true });
  });

  it('explainFeatureAvailability → explain_feature_availability_scoped with sessionToken + feature', async () => {
    mockInvoke.mockResolvedValue({
      feature: 'supports_qris',
      available: true,
      reason: null,
      detail: {},
    });
    await explainFeatureAvailability('tok_sub', 'supports_qris');
    expect(mockInvoke).toHaveBeenCalledWith('explain_feature_availability_scoped', {
      sessionToken: 'tok_sub',
      feature: 'supports_qris',
    });
  });

  it('getOverQuotaReport → get_over_quota_report_scoped with sessionToken (W6-C re-wire)', async () => {
    mockInvoke.mockResolvedValue({ tierKey: 'plus', tierName: 'Plus', usages: [] });
    await getOverQuotaReport('tok_sub');
    expect(mockInvoke).toHaveBeenCalledWith('get_over_quota_report_scoped', {
      sessionToken: 'tok_sub',
    });
  });

  it('propagates backend errors', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('license invalid'));
    await expect(getSubscriptionCapabilities()).rejects.toThrow('license invalid');
  });
});

describe('subscription.ts pure helpers (no IPC)', () => {
  const kdsMarker: OverQuotaMarkerRow = {
    resourceId: 'store-1',
    resourceType: 'kds_screen',
    dimension: 'kds_screens',
    severity: 'over',
    limit: 5,
    current: 6,
    markedAt: '2026-01-01T00:00:00Z',
  };
  const tenantMarker: OverQuotaMarkerRow = {
    resourceId: 'tenant',
    resourceType: 'locations',
    dimension: 'locations',
    severity: 'at',
    limit: 10,
    current: 10,
    markedAt: '2026-01-01T00:00:00Z',
  };
  const usageOver: QuotaUsageRow = { dimension: 'locations', limit: 10, current: 11 };
  const usageUnder: QuotaUsageRow = { dimension: 'locations', limit: 10, current: 5 };
  const usageUnlimited: QuotaUsageRow = { dimension: 'x', limit: null, current: 99 };

  it('isPerLocationMarker distinguishes per-location from tenant-global rows', () => {
    expect(isPerLocationMarker(kdsMarker)).toBe(true);
    expect(isPerLocationMarker(tenantMarker)).toBe(false);
  });

  it('perLocationMarkers returns the per-location subset (empty when none)', () => {
    expect(perLocationMarkers(null)).toEqual([]);
    const noMarkers: OverQuotaReport = { tierKey: 'plus', tierName: 'Plus', usages: [] };
    expect(perLocationMarkers(noMarkers)).toEqual([]);
    const report: OverQuotaReport = {
      tierKey: 'plus',
      tierName: 'Plus',
      usages: [],
      markers: [tenantMarker, kdsMarker],
    };
    const pl = perLocationMarkers(report);
    expect(pl).toHaveLength(1);
    expect(pl[0]).toBe(kdsMarker);
  });

  it('isOverQuota compares strictly and treats a null limit as unlimited', () => {
    expect(isOverQuota(usageOver)).toBe(true);
    expect(isOverQuota(usageUnder)).toBe(false);
    expect(isOverQuota(usageUnlimited)).toBe(false);
  });

  it('excessOf returns the surplus only when strictly over quota', () => {
    expect(excessOf(usageOver)).toBe(1);
    expect(excessOf(usageUnder)).toBe(0);
    expect(excessOf(usageUnlimited)).toBe(0);
  });
});
