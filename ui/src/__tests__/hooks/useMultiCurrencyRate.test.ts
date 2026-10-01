// ── useMultiCurrency: the rate read's three outcomes ─────────────────────
//
// A rate read has three answers, not two: a RATE, genuinely no rate for the
// pair, and a FAILED read. Before this file existed the third collapsed to the
// first shape (`latestRate = null`), and `effectiveRateInfo` then fell back to
// a `find()` over `list_latest_exchange_rates` — a DIFFERENT question, because
// that list returns the newest row per pair including future-dated rates
// (modules/currency/src/repository.rs:84-114) while the CUR-04 read is as-of the
// store business date (:157-187). So a failed read silently charged a different
// rate than the one the sale was about to record, and rendered identically to a
// success.
//
// These tests pin the three states apart and the money guard that depends on
// them: on an unknown rate `convertToChargeCurrency` must be an IDENTITY, not a
// guess drawn from the list, and `rateUnknown` must be true so the caller can
// refuse the settle action.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type * as CurrencyApi from '@/api/currency';

const { mockListCurrencies, mockListLatest, mockGetDefault, mockGetLatest } = vi.hoisted(() => ({
  mockListCurrencies: vi.fn(),
  mockListLatest: vi.fn(),
  mockGetDefault: vi.fn(),
  mockGetLatest: vi.fn(),
}));
// Only the four IPC reads are mocked. `exchangeRateToDecimal` and
// `convertMinorUnits` are pure functions over fixed-point integers, and the whole
// point of this file is the numbers they produce — re-implementing them here
// would test the mock instead of the hook.
vi.mock('@/api/currency', async (importOriginal) => ({
  ...(await importOriginal<typeof CurrencyApi>()),
  listCurrenciesScoped: (...a: unknown[]) => mockListCurrencies(...a),
  listLatestExchangeRatesScoped: (...a: unknown[]) => mockListLatest(...a),
  getDefaultCurrencyScoped: (...a: unknown[]) => mockGetDefault(...a),
  getLatestExchangeRateScoped: (...a: unknown[]) => mockGetLatest(...a),
}));

import { useMultiCurrency } from '@/features/sales/payment/useMultiCurrency';

const TOKEN = 'tok_mc';
const BASE = 'USD';
const CHARGE = 'IDR';

/** 1 USD = 16,000 IDR. $7.00 -> Rp 112,000. */
const RATE = {
  id: 'rate-1',
  from_currency: BASE,
  to_currency: CHARGE,
  rate_millionths: 16_000_000_000,
  source: 'manual',
  effective_date: '2026-01-01',
  created_at: '2026-01-01T00:00:00Z',
};

/** A FUTURE-dated rate for the same pair, and a different number. Only the
//  `list_latest_exchange_rates` fallback can ever produce this one. */
const FUTURE_RATE = { ...RATE, id: 'rate-future', rate_millionths: 20_000_000_000, effective_date: '2099-01-01' };

const PARAMS = {
  open: true,
  multiCurrency: true,
  sessionToken: TOKEN,
  totalCurrency: BASE,
  addToast: vi.fn(),
  l10nRef: { current: { getString: (id: string) => id } },
};

/** Render the hook and choose CHARGE, then wait for the rate read to settle. */
async function renderChargeCurrency() {
  const view = renderHook(() => useMultiCurrency(PARAMS));
  await waitFor(() => expect(mockListLatest).toHaveBeenCalled());
  act(() => {
    view.result.current.setSelectedCurrency(CHARGE);
  });
  return view;
}

describe('useMultiCurrency — the rate read has three outcomes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListCurrencies.mockResolvedValue([
      { code: BASE, name: 'US Dollar', minor_exponent: 2, symbol: '$' },
      { code: CHARGE, name: 'Indonesian Rupiah', minor_exponent: 0, symbol: 'Rp' },
    ]);
    mockListLatest.mockResolvedValue([RATE]);
    mockGetDefault.mockResolvedValue(BASE);
    mockGetLatest.mockResolvedValue(RATE);
  });

  it('a read that answers a rate converts and is not unknown', async () => {
    const { result } = await renderChargeCurrency();
    await waitFor(() => expect(result.current.effectiveRateInfo).not.toBeNull());
    expect(result.current.rateUnknown).toBe(false);
    // $7.00 at 16,000 = Rp 112,000.
    expect(result.current.convertToChargeCurrency(700)).toBe(112_000);
  });

  it('a read that answers NO RATE is an answer: converts via the list, and is not unknown', async () => {
    mockGetLatest.mockResolvedValue(null);
    const { result } = await renderChargeCurrency();
    await waitFor(() => expect(mockGetLatest).toHaveBeenCalled());
    // null from the CUR-04 read still leaves `exchangeRateInfo` (the list) as the
    // source, which is the pre-existing no-session/legacy path. rateUnknown MUST
    // stay false: no rate for the pair is a fact, not an unanswered question.
    await waitFor(() => expect(result.current.effectiveRateInfo).not.toBeNull());
    expect(result.current.rateUnknown).toBe(false);
  });

  it('a FAILED read is unknown, converts NOTHING, and never borrows the list rate', async () => {
    mockGetLatest.mockRejectedValue(new Error('ipc down'));
    mockListLatest.mockResolvedValue([FUTURE_RATE]);
    const { result } = await renderChargeCurrency();
    await waitFor(() => expect(result.current.rateUnknown).toBe(true));

    // The defect this pins: with the future-dated row in the list, the old
    // fallback would have converted $7.00 at 20,000 -> Rp 140,000 and recorded
    // THAT as the tender rate. An unknown rate must convert nothing.
    expect(result.current.effectiveRateInfo).toBeNull();
    expect(result.current.convertToChargeCurrency(700)).toBe(700);
  });

  it('a retry after a failed read restores the conversion and clears unknown', async () => {
    mockGetLatest.mockRejectedValueOnce(new Error('ipc down'));
    const { result } = await renderChargeCurrency();
    await waitFor(() => expect(result.current.rateUnknown).toBe(true));

    mockGetLatest.mockResolvedValue(RATE);
    act(() => {
      result.current.retryRateRead();
    });
    await waitFor(() => expect(result.current.rateUnknown).toBe(false));
    expect(result.current.convertToChargeCurrency(700)).toBe(112_000);
  });

  it('leaving the charge currency alone issues no rate read at all', async () => {
    const { result } = renderHook(() => useMultiCurrency(PARAMS));
    await waitFor(() => expect(mockListLatest).toHaveBeenCalled());
    expect(mockGetLatest).not.toHaveBeenCalled();
    expect(result.current.rateUnknown).toBe(false);
    expect(result.current.convertToChargeCurrency(700)).toBe(700);
  });
});

// ── The three first-load reads: three answers, not one ──────────────
//
// `Promise.all([listCurrenciesScoped, listLatestExchangeRatesScoped,
// getDefaultCurrencyScoped]).catch(() => addToast(...))` gave the modal ONE
// answer for three different questions, and a single refusal discarded all
// three: the picker list went empty, the default fell back to the sale's own
// currency, and the only record was a toast. The refusals are ordinary here --
// list_currencies_scoped gates nothing (crates/kasirmu-bridge/src/currency.rs:72-86)
// while the other two require permissions::SETTINGS_READ (:262 and :107) -- so
// a cashier who may take a payment in this store is routinely refused both.
//
// The two answers a caller can act on: `currenciesUnknown` (the picker is not
// empty, it was never asked) and `baseCurrencyUnknown` (the Default currency row
// is not this store's default, we did not get one).

describe('useMultiCurrency — the first load settles each read on its own', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLatest.mockResolvedValue(RATE);
  });

  it('a refused rate list does not empty the picker or the default', async () => {
    mockListLatest.mockRejectedValue(new Error('permission denied'));
    mockListCurrencies.mockResolvedValue([
      { code: BASE, name: 'US Dollar', minor_exponent: 2, symbol: '$' },
      { code: CHARGE, name: 'Indonesian Rupiah', minor_exponent: 0, symbol: 'Rp' },
    ]);
    mockGetDefault.mockResolvedValue(CHARGE);
    const { result } = renderHook(() => useMultiCurrency(PARAMS));
    await waitFor(() => expect(mockListLatest).toHaveBeenCalled());
    await waitFor(() => expect(result.current.baseCurrency).toBe(CHARGE));

    // The defect this pins: the old Promise.all rejected, so NONE of the three
    // setters ran. The picker would have been empty and the default would have
    // printed the sale's own currency as though the store had chosen it.
    expect(result.current.currencies.map((c) => c.code)).toEqual([BASE, CHARGE]);
    expect(result.current.currenciesUnknown).toBe(false);
    expect(result.current.baseCurrencyUnknown).toBe(false);
  });

  it('a refused picker list is an unknown picker, not an empty one', async () => {
    mockListCurrencies.mockRejectedValue(new Error('ipc down'));
    mockListLatest.mockResolvedValue([RATE]);
    mockGetDefault.mockResolvedValue(BASE);
    const { result } = renderHook(() => useMultiCurrency(PARAMS));
    await waitFor(() => expect(result.current.currenciesUnknown).toBe(true));
    expect(result.current.currencies).toEqual([]);
    // The other two answers still arrived: a refusal must not silence them.
    expect(result.current.baseCurrency).toBe(BASE);
    expect(result.current.baseCurrencyUnknown).toBe(false);
  });

  it('a refused default leaves the flag unknown while the value stays put', async () => {
    mockGetDefault.mockRejectedValue(new Error('permission denied'));
    mockListCurrencies.mockResolvedValue([{ code: BASE, name: 'US Dollar', minor_exponent: 2, symbol: '$' }]);
    mockListLatest.mockResolvedValue([RATE]);
    const { result } = renderHook(() => useMultiCurrency(PARAMS));
    await waitFor(() => expect(result.current.baseCurrencyUnknown).toBe(true));

    // `baseCurrency` still holds its initial value, which is the SALE's own
    // currency -- plausible, and not an answer this store gave. The flag is what
    // keeps the caller from printing it as 'Default currency'.
    expect(result.current.baseCurrency).toBe(BASE);
    expect(result.current.currenciesUnknown).toBe(false);
  });

  it('a store with NO configured default is an answer, not an unknown', async () => {
    mockGetDefault.mockResolvedValue(null);
    mockListCurrencies.mockResolvedValue([{ code: BASE, name: 'US Dollar', minor_exponent: 2, symbol: '$' }]);
    mockListLatest.mockResolvedValue([RATE]);
    const { result } = renderHook(() => useMultiCurrency(PARAMS));
    await waitFor(() => expect(mockGetDefault).toHaveBeenCalled());
    expect(result.current.baseCurrencyUnknown).toBe(false);
    expect(result.current.baseCurrency).toBe(BASE);
  });

  it('a retry re-runs the three reads and clears both unknowns', async () => {
    mockListCurrencies.mockRejectedValueOnce(new Error('ipc down'));
    mockGetDefault.mockRejectedValueOnce(new Error('permission denied'));
    mockListCurrencies.mockResolvedValue([{ code: BASE, name: 'US Dollar', minor_exponent: 2, symbol: '$' }]);
    mockGetDefault.mockResolvedValue(CHARGE);
    mockListLatest.mockResolvedValue([RATE]);
    const { result } = renderHook(() => useMultiCurrency(PARAMS));
    await waitFor(() => expect(result.current.currenciesUnknown).toBe(true));
    expect(result.current.baseCurrencyUnknown).toBe(true);

    act(() => {
      result.current.retryCurrencyLoad();
    });
    await waitFor(() => expect(result.current.currenciesUnknown).toBe(false));
    expect(result.current.baseCurrencyUnknown).toBe(false);
    expect(result.current.baseCurrency).toBe(CHARGE);
  });

  it('the rate list being unknown does not touch the two flags it shares no permission with', async () => {
    mockListLatest.mockRejectedValue(new Error('permission denied'));
    mockListCurrencies.mockResolvedValue([{ code: BASE, name: 'US Dollar', minor_exponent: 2, symbol: '$' }]);
    mockGetDefault.mockResolvedValue(CHARGE);
    const { result } = renderHook(() => useMultiCurrency(PARAMS));
    await waitFor(() => expect(result.current.baseCurrency).toBe(CHARGE));
    expect(result.current.currenciesUnknown).toBe(false);
    expect(result.current.baseCurrencyUnknown).toBe(false);
  });
});
