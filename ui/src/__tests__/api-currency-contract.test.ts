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
  getCurrencyInfo,
  listCurrenciesScoped,
  getDefaultCurrency,
  setDefaultCurrency,
  listExchangeRatesScoped,
  listLatestExchangeRatesScoped,
  createExchangeRateScoped,
  deleteExchangeRateScoped,
} from '@/api/currency';

describe('currency.ts API contract', () => {
  const TOKEN = 'tok_curr';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getCurrencyInfo calls correct command', async () => {
    mockInvoke.mockResolvedValue({ code: 'IDR', symbol: 'Rp', decimals: 0 });
    const result = await getCurrencyInfo('IDR');
    expect(mockInvoke).toHaveBeenCalledWith('currency_info', { code: 'IDR' });
    expect(result.code).toBe('IDR');
  });

  it('listCurrenciesScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue([]);
    await listCurrenciesScoped(TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('list_currencies_scoped', {
      sessionToken: TOKEN,
    });
  });

  // get_default_currency / set_default_currency are pre-session bootstrap
  // commands (CurrencyProvider sits above AuthProvider/WorkspaceProvider and
  // has no token); they stay non-scoped and are registered on the Rust side.
  it('getDefaultCurrency calls correct command (no args)', async () => {
    mockInvoke.mockResolvedValue('IDR');
    const result = await getDefaultCurrency();
    expect(mockInvoke).toHaveBeenCalledWith('get_default_currency');
    expect(result).toBe('IDR');
  });

  it('setDefaultCurrency calls correct command', async () => {
    const args = { code: 'USD' };
    mockInvoke.mockResolvedValue(undefined);
    await setDefaultCurrency(args);
    expect(mockInvoke).toHaveBeenCalledWith('set_default_currency', { args });
  });

  it('listExchangeRatesScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue([]);
    await listExchangeRatesScoped(TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('list_exchange_rates_scoped', {
      sessionToken: TOKEN,
    });
  });

  // CUR-11: bounded latest-per-pair listing (PaymentModal picker).
  it('listLatestExchangeRatesScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue([]);
    await listLatestExchangeRatesScoped(TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('list_latest_exchange_rates_scoped', {
      sessionToken: TOKEN,
    });
  });

  it('createExchangeRateScoped calls correct command', async () => {
    const args = { from_currency: 'USD', to_currency: 'IDR', rate_millionths: 15700000000 };
    mockInvoke.mockResolvedValue({ id: 'er1', ...args });
    const result = await createExchangeRateScoped(TOKEN, args);
    expect(mockInvoke).toHaveBeenCalledWith('create_exchange_rate_scoped', {
      sessionToken: TOKEN,
      args,
    });
    expect(result.id).toBe('er1');
  });

  it('deleteExchangeRateScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await deleteExchangeRateScoped(TOKEN, 'er1');
    expect(mockInvoke).toHaveBeenCalledWith('delete_exchange_rate_scoped', {
      sessionToken: TOKEN,
      id: 'er1',
    });
  });
});
