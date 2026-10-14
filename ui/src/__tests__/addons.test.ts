/**
 * @vitest-environment node
 *
 * This file's entire import graph is free of browser globals (no render, no
 * `document`/`window`/`localStorage`), so it does not need a jsdom window. Vitest
 * spawns a fresh jsdom per test FILE, which measured ~0.4-0.9s each; under the node
 * environment the same files report `environment: 0ms`.
 *
 * Do not copy this directive onto a file that renders or touches browser state —
 * it will fail with "document is not defined" rather than silently degrade.
 */
// ── Tests for addons.ts catalog and helpers ────────────────────
// addons.ts is a pure data module with no IPC calls — test the
// catalog constants and helper functions directly.

import { describe, it, expect } from 'vitest';
import {
  ADDON_CATALOG,
  getAddonById,
  getAddonsForTier,
  tenantHasAddon,
} from '@/api/addons';

describe('addons.ts catalog', () => {
  it('has 4 addons in catalog', () => {
    expect(ADDON_CATALOG).toHaveLength(4);
  });

  it('each addon has required fields', () => {
    for (const addon of ADDON_CATALOG) {
      expect(addon.id).toBeTruthy();
      expect(addon.nameKey).toBeTruthy();
      expect(addon.descriptionKey).toBeTruthy();
      expect(addon.priceUsd).toBeGreaterThan(0);
      expect(addon.paddlePriceId).toBeTruthy();
      expect(addon.icon).toBeTruthy();
      expect(Array.isArray(addon.targetTiers)).toBe(true);
    }
  });

  it('all addon ids are unique', () => {
    const ids = ADDON_CATALOG.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('getAddonById', () => {
  it('returns addon for valid id', () => {
    const addon = getAddonById('advanced_analytics');
    expect(addon).toBeDefined();
    expect(addon?.id).toBe('advanced_analytics');
    expect(addon?.priceUsd).toBe(2.99);
  });

  it('returns undefined for unknown id', () => {
    expect(getAddonById('nonexistent')).toBeUndefined();
  });
});

describe('getAddonsForTier', () => {
  it('returns addons targeting the tier', () => {
    const addons = getAddonsForTier('plus');
    expect(addons.length).toBeGreaterThanOrEqual(1);
    expect(addons.some((a) => a.id === 'advanced_analytics')).toBe(true);
  });

  it('returns addons with empty targetTiers (all tiers)', () => {
    const addons = getAddonsForTier('free');
    expect(addons.some((a) => a.id === 'priority_support')).toBe(true);
  });

  it('returns empty for enterprise-only tier not targeted', () => {
    const addons = getAddonsForTier('premium');
    // premium gets custom_hal (targetTiers: ['premium', 'enterprise'])
    expect(addons.some((a) => a.id === 'custom_hal')).toBe(true);
    // but not advanced_analytics (targetTiers: ['plus'])
    expect(addons.some((a) => a.id === 'advanced_analytics')).toBe(false);
  });
});

describe('tenantHasAddon', () => {
  it('returns true when addon is present', () => {
    expect(tenantHasAddon(['advanced_analytics', 'extra_storage'], 'advanced_analytics')).toBe(true);
  });

  it('returns false when addon is absent', () => {
    expect(tenantHasAddon(['advanced_analytics'], 'priority_support')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(tenantHasAddon(['Advanced_Analytics'], 'advanced_analytics')).toBe(true);
  });

  it('returns false for empty list', () => {
    expect(tenantHasAddon([], 'advanced_analytics')).toBe(false);
  });
});
