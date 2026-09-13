// ── IPC contract tests for features.ts ──────────────────────────
//
// Verifies every exported function calls loggedInvoke with the
// correct IPC command name and argument shape, and that the value
// resolved by the backend is passed through untouched.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (cmd: string, args?: Record<string, unknown>) => mockInvoke(cmd, args),
}));

import {
  listAllFeatures,
  listAllFeaturesScoped,
  setFeature,
  setFeaturesBulk,
  type FeatureInfo,
} from '@/api/features';

const FEATURES: FeatureInfo[] = [
  {
    key: 'kds',
    name: 'Kitchen Display',
    description: 'Route paid orders to the kitchen screen',
    group: 'operations',
    enabled: true,
    dependencies: [],
  },
];

describe('features.ts IPC contract', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('listAllFeatures → list_all_features (no args) and passes the list through', async () => {
    mockInvoke.mockResolvedValue({ features: FEATURES });
    const result = await listAllFeatures();
    expect(mockInvoke).toHaveBeenCalledWith('list_all_features', undefined);
    expect(result).toEqual({ features: FEATURES });
  });

  it('listAllFeaturesScoped → list_all_features_scoped with sessionToken (ADR #7)', async () => {
    mockInvoke.mockResolvedValue({ features: FEATURES });
    const result = await listAllFeaturesScoped('tok_feat');
    expect(mockInvoke).toHaveBeenCalledWith('list_all_features_scoped', {
      sessionToken: 'tok_feat',
    });
    expect(result.features).toEqual(FEATURES);
  });

  it('setFeature → set_feature with sessionToken + args { key, enabled }', async () => {
    mockInvoke.mockResolvedValue({ success: true, features: FEATURES, auto_enabled: ['reports'] });
    const result = await setFeature('tok_feat', 'kds', true);
    expect(mockInvoke).toHaveBeenCalledWith('set_feature', {
      sessionToken: 'tok_feat',
      args: { key: 'kds', enabled: true },
    });
    expect(result.success).toBe(true);
    expect(result.auto_enabled).toEqual(['reports']);
  });

  it('setFeature disabling a flag sends enabled: false', async () => {
    mockInvoke.mockResolvedValue({ success: true, features: [], auto_enabled: [] });
    await setFeature('tok_feat', 'kds', false);
    expect(mockInvoke).toHaveBeenCalledWith('set_feature', {
      sessionToken: 'tok_feat',
      args: { key: 'kds', enabled: false },
    });
  });

  it('setFeaturesBulk → set_features_bulk with sessionToken + args { keys, enabled }', async () => {
    const keys = ['kds', 'inventory', 'loyalty'];
    mockInvoke.mockResolvedValue({ features: FEATURES });
    const result = await setFeaturesBulk('tok_feat', keys, true);
    expect(mockInvoke).toHaveBeenCalledWith('set_features_bulk', {
      sessionToken: 'tok_feat',
      args: { keys, enabled: true },
    });
    expect(result).toEqual({ features: FEATURES });
  });

  it('setFeaturesBulk with an empty key list still sends the array', async () => {
    mockInvoke.mockResolvedValue({ features: [] });
    await setFeaturesBulk('tok_feat', [], false);
    expect(mockInvoke).toHaveBeenCalledWith('set_features_bulk', {
      sessionToken: 'tok_feat',
      args: { keys: [], enabled: false },
    });
  });

  it('propagates backend errors', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('missing permission: settings.edit'));
    await expect(setFeature('tok_feat', 'kds', true)).rejects.toThrow(
      'missing permission: settings.edit',
    );
  });

  it('propagates errors from the scoped read', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('session expired'));
    await expect(listAllFeaturesScoped('tok_feat')).rejects.toThrow('session expired');
  });
});
