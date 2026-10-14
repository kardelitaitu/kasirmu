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
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (command: string, args?: Record<string, unknown>) => mockInvoke(command, args),
}));

import {
  createExchangeRateScoped,
  formatExchangeRate,
  listExchangeRatesScoped,
} from '@/api/currency';

const TOKEN = 'tok';

describe('currency.ts fixed-point IPC contract', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
  });

  it('sends the Rust exchange-rate field names and fixed-point value', async () => {
    await createExchangeRateScoped(TOKEN, {
      from_currency: 'USD',
      to_currency: 'IDR',
      rate_millionths: 16_000_000_000,
      source: 'manual',
      effective_date: '2026-07-31',
    });

    expect(mockInvoke).toHaveBeenCalledWith('create_exchange_rate_scoped', {
      sessionToken: TOKEN,
      args: {
        from_currency: 'USD',
        to_currency: 'IDR',
        rate_millionths: 16_000_000_000,
        source: 'manual',
        effective_date: '2026-07-31',
      },
    });
  });

  it('preserves the fixed-point list response contract', async () => {
    mockInvoke.mockResolvedValueOnce([
      {
        id: 'rate-1',
        from_currency: 'USD',
        to_currency: 'IDR',
        rate_millionths: 16_000_000_000,
        source: 'manual',
        effective_date: '2026-07-31',
        created_at: '2026-07-31T00:00:00.000Z',
      },
    ]);

    const rates = await listExchangeRatesScoped(TOKEN);

    expect(mockInvoke).toHaveBeenCalledWith('list_exchange_rates_scoped', { sessionToken: TOKEN });
    expect(rates[0]?.rate_millionths).toBe(16_000_000_000);
  });

  it('formats millionths without trailing zero noise', () => {
    expect(formatExchangeRate({ rate_millionths: 920_000 })).toBe('0.92');
    expect(formatExchangeRate({ rate_millionths: 149_500_000 })).toBe('149.5');
    expect(formatExchangeRate({ rate_millionths: 250 })).toBe('0.00025');
  });
});
