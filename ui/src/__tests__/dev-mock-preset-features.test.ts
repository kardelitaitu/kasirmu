// ── Dev-mock preset features ─────────────────────────────────────
//
// `get_preset_features` gained a handler so `scripts/verify-ipc-parity.py` stops failing the
// whole gate: the UI invoked it (`ui/src/api/settings.ts:266`, from `ProvisioningFlow`'s
// submit path) and nothing under `ui/src/dev-mock/` answered, so the browser preview rendered
// the first-run flow's failure path while every test that mocked the wrapper stayed green.
//
// These pin the mock against the REAL surface rather than against itself:
//   - crates/kasirmu-core/src/features.rs:304-414 — the six preset constructors, whose members
//     ARE the feature set (`from_set` asserts dependencies, it does not add them);
//   - the same file's `feature_key` (:466) for the kebab-case spelling and `preset_feature_keys`
//     (:449) for the SORTED order this payload promises;
//   - crates/kasirmu-bridge/src/setup.rs:225-232 — the wrapper the shell exposes, including its
//     refusal for a slug the build does not know.
//
// The lists are restated here on purpose, not derived: a browser cannot call Rust, and the
// command exists so the PRODUCTION UI carries no copy. If a preset changes in core, this test
// is the second place that must move — which is the point of writing the keys out rather than
// asserting `features.length > 0`.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { invoke } from '@/dev-mock/tauri-api';
import type { EnabledFeaturesResult } from '@/api/settings';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const presetFeatures = (preset: string): Promise<EnabledFeaturesResult> =>
  invoke<EnabledFeaturesResult>('get_preset_features', { preset });

const EXPECTED: Record<string, string[]> = {
  'simple-retail': [
    'barcode-scanning',
    'cash-payment',
    'categories-enabled',
    'inventory-tracking',
    'receipt-printing',
    'simple-retail',
    'tax-engine',
  ],
  restaurant: [
    'cash-payment',
    'categories-enabled',
    'discount-engine',
    'inventory-tracking',
    'kitchen-display',
    'receipt-printing',
    'restaurant',
    'staff-login',
    'table-management',
    'tax-engine',
  ],
};

describe('dev-mock get_preset_features surface', () => {
  it('answers the shape the TypeScript contract declares', async () => {
    // A cast alone would not catch a renamed or dropped field: the mock returns untyped
    // literals, so `{}` would typecheck and then render undefined in the preview.
    const result = await presetFeatures('simple-retail');
    expect(Object.keys(result)).toEqual(['features']);
    expect(Array.isArray(result.features)).toBe(true);
  });

  it('resolves each slug to the feature set its constructor names', async () => {
    for (const [preset, expected] of Object.entries(EXPECTED)) {
      await expect(presetFeatures(preset)).resolves.toEqual({ features: expected });
    }
    // The two large presets are asserted by content the core tests also name, so a mock
    // that lost a key fails here rather than provisioning a preview terminal differently.
    const full = await presetFeatures('full-store');
    expect(full.features).toContain('analytics');
    expect(full.features).toContain('usb-scale');
    expect(full.features).not.toContain('cloud-sync');
    expect(full.features).not.toContain('multi-store');
    const franchise = await presetFeatures('franchise');
    expect(franchise.features).toContain('cloud-sync');
    expect(franchise.features).toContain('multi-store');
  });

  it('sorts every list, because the payload promises a stable order', async () => {
    // `preset_feature_keys` sorts BECAUSE `enabled_features` iterates a hash set: an unsorted
    // mock would hand the flow an array that differs between calls for the same preset.
    for (const preset of ['simple-retail', 'restaurant', 'full-store', 'cafe', 'franchise']) {
      const { features } = await presetFeatures(preset);
      expect(features, preset).toEqual([...features].sort());
    }
  });

  it('answers `custom` with an honest empty list, not a refusal', async () => {
    // Custom is a REAL preset that enables nothing — the Setup Wizard turns features on one
    // by one — so an empty answer here is a value, not a missing table entry.
    await expect(presetFeatures('custom')).resolves.toEqual({ features: [] });
  });

  it('refuses a slug the build does not know, as the bridge does', async () => {
    // `kasirmu-bridge/src/setup.rs:231` answers Invalid for an unknown slug. The first-run
    // FLOW catches that and degrades to [] (`ProvisioningFlow.tsx:282-284`), so a mock
    // returning [] would erase the difference between a degradation and a lost preset.
    await expect(presetFeatures('not-a-store-type')).rejects.toThrow(/unknown store preset/);
  });

  it('spells every key the way feature_key does', async () => {
    // The placeholder drift this catches is real and already present beside it: the
    // `get_enabled_features` handler above answers with ['sales', 'inventory', ...], which are
    // NOT feature keys. These must be, because the flow sends them to `provision_device`.
    for (const preset of ['simple-retail', 'restaurant', 'full-store', 'cafe', 'franchise']) {
      const { features } = await presetFeatures(preset);
      expect(features.length, preset).toBeGreaterThan(0);
      for (const key of features) {
        expect(key, `${preset}: ${key}`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      }
    }
  });
});
