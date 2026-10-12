/**
 * @vitest-environment node
 *
 * This file's import graph is free of browser globals (no render, no
 * `document`/`window`/`localStorage`), so it does not need a jsdom window. Vitest
 * spawns a fresh jsdom per test FILE, which measured ~0.4-0.9s each; under the node
 * environment the same files report `environment: 0ms`.
 *
 * Do not copy this directive onto a file that renders or touches browser state —
 * it will fail with "document is not defined" rather than silently degrade.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (...args: unknown[]) => mockInvoke(...args),
}));

import {
  getReceiptSettingsScoped,
  setReceiptSettingsScoped,
  getStoreSettingsScoped,
  setStoreSettingsScoped,
  getCreditSettingsScoped,
  setCreditSettingsScoped,
} from '@/api/settings';

describe('settings.ts API contract (scoped — ADR #7)', () => {
  const TOKEN = 'tok_settings';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getReceiptSettingsScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue({ showCurrency: true, decimalSeparator: '.', showTax: true, footer: 'Thanks', paperWidth: '80mm', showTableNumber: true, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 });
    await getReceiptSettingsScoped(TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('get_receipt_settings_scoped', { sessionToken: TOKEN });
  });

  it('setReceiptSettingsScoped calls correct command', async () => {
    const args = { showCurrency: true, decimalSeparator: '.', showTax: true, footer: 'Thank you', paperWidth: '80mm', showTableNumber: true, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 };
    mockInvoke.mockResolvedValue(undefined);
    await setReceiptSettingsScoped(TOKEN, args);
    expect(mockInvoke).toHaveBeenCalledWith('set_receipt_settings_scoped', { sessionToken: TOKEN, args });
  });

  it('getStoreSettingsScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue({ name: 'My Store', address: '123 Main St', taxId: '123', currency: 'IDR', branch: 'Main' });
    await getStoreSettingsScoped(TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('get_store_settings_scoped', { sessionToken: TOKEN });
  });

  it('setStoreSettingsScoped calls correct command', async () => {
    const args = { name: 'My Store', address: '456 New', taxId: '456', currency: 'IDR', branch: 'New' };
    mockInvoke.mockResolvedValue(undefined);
    await setStoreSettingsScoped(TOKEN, args);
    expect(mockInvoke).toHaveBeenCalledWith('set_store_settings_scoped', { sessionToken: TOKEN, args });
  });

  it('getCreditSettingsScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue({ enabled: true, reminderIntervalHours: 24, maxLimitMinor: 500000 });
    await getCreditSettingsScoped(TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('get_credit_settings_scoped', { sessionToken: TOKEN });
  });

  it('setCreditSettingsScoped calls correct command', async () => {
    const args = { enabled: false, reminderIntervalHours: 48, maxLimitMinor: 1000000 };
    mockInvoke.mockResolvedValue(undefined);
    await setCreditSettingsScoped(TOKEN, args);
    expect(mockInvoke).toHaveBeenCalledWith('set_credit_settings_scoped', { sessionToken: TOKEN, args });
  });

  it('propagates errors', async () => {
    mockInvoke.mockRejectedValue(new Error('settings error'));
    await expect(getReceiptSettingsScoped(TOKEN)).rejects.toThrow('settings error');
  });
});
