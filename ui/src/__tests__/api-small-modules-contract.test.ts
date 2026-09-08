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
//
// NOTE (retire-aggregate-dedup): this block is the only surviving content of
// the former api-small-modules-contract file. Every other module it covered
// (system/features/security/email/browser/gateway/subscription) is now owned
// by its own per-module contract file; subscription moved to
// api-subscription-contract.test.ts. Branding has no per-module contract file,
// so its REAL-IPC assertions stay here to preserve that unique coverage.
vi.mock('@/api/branding', async (importOriginal) => ({
  ...(await importOriginal<typeof BrandingModule>()),
}));

import type * as BrandingModule from '@/api/branding';
import {
  getBrandSettings,
  getBrandSettingsScoped,
  setBrandPrimaryColour,
  setBrandLogoPath,
  setBrandStoreName,
  pickLogoFile,
} from '@/api/branding';

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
