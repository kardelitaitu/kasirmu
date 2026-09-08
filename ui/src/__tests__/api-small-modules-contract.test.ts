import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (...args: unknown[]) => mockInvoke(...args),
}));

// Opt out of the global @/api/branding stub installed by test-setup.ts. That
// stub silences IPC noise for the whole suite by replacing @/api/branding with
// no-op resolvers, but this contract suite must verify branding.ts's REAL IPC
// command names. Re-exporting the original module here overrides the global
// mock (per-file mocks win) while still routing through the per-file
// loggedInvoke mock above, so the functional branding contract assertions below
// keep checking the actual command strings (e.g. 'get_brand_settings').
vi.mock('@/api/branding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/branding')>()),
}));

import { getSubscriptionCapabilities } from '@/api/subscription';
import { ping, getVersion, getVersionScoped, getLocalIp, getDeviceId } from '@/api/system';
import { listAllFeatures, setFeature, setFeaturesBulk } from '@/api/features';
import {
  getBrandSettings,
  getBrandSettingsScoped,
  setBrandPrimaryColour,
  setBrandLogoPath,
  setBrandStoreName,
  pickLogoFile,
} from '@/api/branding';
import { getKeyRotationInfo, rotateEncryptionKey } from '@/api/security';
import { sendTestReport, getReportSchedule, saveReportSchedule } from '@/api/email';
import { openProductImagesScoped } from '@/api/browser';
import { getGatewayStatus } from '@/api/gateway';

describe('subscription.ts API contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getSubscriptionCapabilities calls correct command (no args)', async () => {
    mockInvoke.mockResolvedValue({ tier: 'plus', maxProducts: 500 });
    const result = await getSubscriptionCapabilities();
    expect(mockInvoke).toHaveBeenCalledWith('get_subscription_capabilities');
    expect(result.tier).toBe('plus');
  });

  it('propagates errors', async () => {
    mockInvoke.mockRejectedValue(new Error('license invalid'));
    await expect(getSubscriptionCapabilities()).rejects.toThrow('license invalid');
  });
});

describe('system.ts API contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ping calls correct command (no args)', async () => {
    mockInvoke.mockResolvedValue('pong');
    const result = await ping();
    expect(mockInvoke).toHaveBeenCalledWith('ping');
    expect(result).toBe('pong');
  });

  it('getVersion calls correct command (no args)', async () => {
    mockInvoke.mockResolvedValue({ version: '0.0.28' });
    const result = await getVersion();
    expect(mockInvoke).toHaveBeenCalledWith('version');
    expect(result.version).toBe('0.0.28');
  });

  it('getVersionScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue({ version: '0.0.28' });
    await getVersionScoped('tok_sys');
    expect(mockInvoke).toHaveBeenCalledWith('version_scoped', { sessionToken: 'tok_sys' });
  });

  it('getLocalIp calls correct command (no args)', async () => {
    mockInvoke.mockResolvedValue('192.168.1.100');
    const result = await getLocalIp();
    expect(mockInvoke).toHaveBeenCalledWith('get_local_ip');
    expect(result).toBe('192.168.1.100');
  });

  it('getDeviceId calls correct command (no args)', async () => {
    mockInvoke.mockResolvedValue('device-abc');
    const result = await getDeviceId();
    expect(mockInvoke).toHaveBeenCalledWith('get_device_id');
    expect(result).toBe('device-abc');
  });
});

describe('features.ts API contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listAllFeatures calls correct command (no args)', async () => {
    mockInvoke.mockResolvedValue({ features: [] });
    await listAllFeatures();
    expect(mockInvoke).toHaveBeenCalledWith('list_all_features');
  });

  it('setFeature calls correct command', async () => {
    mockInvoke.mockResolvedValue({ success: true, features: [], auto_enabled: [] });
    const result = await setFeature('tok', 'kds', true);
    expect(mockInvoke).toHaveBeenCalledWith('set_feature', {
      sessionToken: 'tok',
      args: { key: 'kds', enabled: true },
    });
    expect(result.success).toBe(true);
  });

  it('setFeaturesBulk calls correct command', async () => {
    const keys = ['kds', 'inventory'];
    mockInvoke.mockResolvedValue({ features: [], auto_enabled: [] });
    await setFeaturesBulk('tok', keys, false);
    expect(mockInvoke).toHaveBeenCalledWith('set_features_bulk', {
      sessionToken: 'tok',
      args: { keys, enabled: false },
    });
  });
});

describe('branding.ts API contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getBrandSettings calls correct command (no args)', async () => {
    mockInvoke.mockResolvedValue({ primaryColour: '#000000' });
    await getBrandSettings();
    expect(mockInvoke).toHaveBeenCalledWith('get_brand_settings');
  });

  it('getBrandSettingsScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue({});
    await getBrandSettingsScoped('tok_brand');
    expect(mockInvoke).toHaveBeenCalledWith('get_brand_settings_scoped', {
      sessionToken: 'tok_brand',
    });
  });

  it('setBrandPrimaryColour calls the registered scoped command with token', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await setBrandPrimaryColour('tok_brand', '#FF5733');
    expect(mockInvoke).toHaveBeenCalledWith('set_brand_primary_colour_scoped', {
      sessionToken: 'tok_brand',
      colour: '#FF5733',
    });
  });

  it('setBrandLogoPath calls the registered scoped command with token', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await setBrandLogoPath('tok_brand', '/path/to/logo.png');
    expect(mockInvoke).toHaveBeenCalledWith('set_brand_logo_path_scoped', {
      sessionToken: 'tok_brand',
      path: '/path/to/logo.png',
    });
  });

  it('setBrandStoreName calls the registered scoped command with token', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await setBrandStoreName('tok_brand', 'My Store');
    expect(mockInvoke).toHaveBeenCalledWith('set_brand_store_name_scoped', {
      sessionToken: 'tok_brand',
      name: 'My Store',
    });
  });

  it('pickLogoFile calls correct command (no args)', async () => {
    mockInvoke.mockResolvedValue('/selected/logo.png');
    const result = await pickLogoFile();
    expect(mockInvoke).toHaveBeenCalledWith('pick_logo_file');
    expect(result).toBe('/selected/logo.png');
  });
});

describe('security.ts API contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getKeyRotationInfo calls correct command (no args)', async () => {
    mockInvoke.mockResolvedValue({ hasKey: true, createdAt: '2026-01-01', ageDays: 20 });
    const result = await getKeyRotationInfo();
    expect(mockInvoke).toHaveBeenCalledWith('get_key_rotation_info');
    expect(result.ageDays).toBe(20);
  });

  it('rotateEncryptionKey calls correct command (no args)', async () => {
    mockInvoke.mockResolvedValue({ keyName: 'oz-pos/encryption-key', createdAt: '2026-08-20', keyBytes: 32 });
    const result = await rotateEncryptionKey();
    expect(mockInvoke).toHaveBeenCalledWith('rotate_encryption_key');
    expect(result.keyBytes).toBe(32);
  });
});

describe('email.ts API contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sendTestReport calls correct command (no args)', async () => {
    mockInvoke.mockResolvedValue('sent');
    const result = await sendTestReport('tok');
    expect(mockInvoke).toHaveBeenCalledWith('send_test_report', { sessionToken: 'tok' });
    expect(result).toBe('sent');
  });

  it('getReportSchedule calls correct command (no args)', async () => {
    mockInvoke.mockResolvedValue({ enabled: true, cadence: 'weekly', report_types: ['revenue'], recipients: [], send_at_time: '08:00', timezone: 'UTC', lookback_days: 7 });
    const result = await getReportSchedule();
    expect(mockInvoke).toHaveBeenCalledWith('get_report_schedule');
    expect(result.enabled).toBe(true);
  });

  it('saveReportSchedule calls correct command', async () => {
    const config = { enabled: false, cadence: 'daily', report_types: [], recipients: [], send_at_time: '09:00', timezone: 'UTC', lookback_days: 1 };
    mockInvoke.mockResolvedValue(undefined);
    await saveReportSchedule('tok', config);
    expect(mockInvoke).toHaveBeenCalledWith('save_report_schedule', { sessionToken: 'tok', config });
  });
});

describe('browser.ts API contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('openProductImagesScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await openProductImagesScoped('tok_br', 'SKU-001');
    expect(mockInvoke).toHaveBeenCalledWith('open_product_images_scoped', {
      sessionToken: 'tok_br',
      sku: 'SKU-001',
    });
  });
});

describe('gateway.ts API contract', () => {
  beforeEach(() => vi.clearAllMocks());

  // UI-1 fix: the command is now the single `gateway_status` IPC (the
  // backend computes configured/online server-side so raw credential
  // values never reach the renderer) — the old per-key `get_setting`
  // assertions were updated to match.
  it('getGatewayStatus calls the gateway_status command (no args)', async () => {
    mockInvoke.mockResolvedValue([
      { name: 'stripe', configured: true, online: false },
    ]);
    const result = await getGatewayStatus();
    // This file forwards loggedInvoke args verbatim, so a no-arg call
    // arrives as a single argument (same convention as the other
    // no-arg contract tests above).
    expect(mockInvoke).toHaveBeenCalledWith('gateway_status');
    expect(result).toHaveLength(1);
  });

  it('getGatewayStatus propagates the backend result array as-is', async () => {
    const payload = [
      { name: 'stripe', configured: true, online: true },
      { name: 'square', configured: false, online: false },
      { name: 'midtrans', configured: true, online: false },
    ];
    mockInvoke.mockResolvedValue(payload);
    const result = await getGatewayStatus();
    expect(result).toEqual(payload);
    expect(result.every((gw: { name: string }) => typeof gw.name === 'string')).toBe(true);
  });
});
