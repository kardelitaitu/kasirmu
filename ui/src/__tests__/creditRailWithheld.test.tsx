// ── A switched-off credit rail withdraws the tender (round 115) ──
//
// Round 114 measured that removing `PaymentModal.tsx:1160` (`if (!creditOffered) return false`)
// leaves the suite green, and concluded the guard was "the only thing covering" a one-render
// window. **This file tests that conclusion and corrects it.**
//
// The guard is UNREACHABLE, not unpinned-inside-a-window:
//
//   * `method` starts as 'cash' (`:162`) and `setMethod('credit')` appears NOWHERE — the
//     only path to credit is the radio's `onChange={() => setMethod(m)}` (`:2270`);
//   * that radio is rendered by `.filter((m) => m !== 'credit' || creditOffered)` (`:2258`),
//     so it does not exist while the rail is off;
//   * `creditOffered` comes from `useLocalPaymentRails`, which re-reads only on
//     `sessionToken` or an internal `nonce` (`:267`) — neither drivable from outside, so
//     the value cannot change during the modal's life.
//
// So `method === 'credit' && !creditOffered` cannot be produced from the public surface.
// The guard is STRUCTURAL REDUNDANCY behind the filter, and the round-114 record is corrected
// by this one.
//
// What IS live, and what these cases pin, is the WITHDRAWAL: with the rail row switched off
// the credit tender is not offered at all. That behaviour had no test either, for the same
// setup reason — the existing suite does not mock the rails source, so `rails` is null and
// `coreRailWithheld` fails open. This file mocks the two IPC calls the hook reads.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithFluentSync } from './test-utils/render';
import { ToastProvider } from '@/components/Toast';
import salesFtl from '@/locales/sales.ftl?raw';
import PaymentModal from '@/features/sales/PaymentModal';

const getPrimaryLocationScoped = vi.hoisted(() => vi.fn());
const getLocalPaymentMethodsScoped = vi.hoisted(() => vi.fn());
const mockCreditSettings = vi.hoisted(() => ({
  current: { enabled: true, reminderIntervalHours: 24, maxLimitMinor: 0 },
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/api/locations', () => ({ getPrimaryLocationScoped }));
vi.mock('@/api/local-payment', () => ({
  getLocalPaymentMethodsScoped,
  readStaticQrPayload: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/api/currency', async () => {
  const actual = await vi.importActual<typeof import('@/api/currency')>('@/api/currency');
  return {
    ...actual,
    listCurrenciesScoped: vi.fn(() => Promise.resolve([
      { code: 'USD', name: 'US Dollar', minor_exponent: 2, symbol: 'USD' },
    ])),
    listCurrencies: vi.fn(() => Promise.resolve([])),
    listExchangeRatesScoped: vi.fn(() => Promise.resolve([])),
    listLatestExchangeRatesScoped: vi.fn(() => Promise.resolve([])),
    getDefaultCurrency: vi.fn(() => Promise.resolve('USD')),
    getDefaultCurrencyScoped: vi.fn(() => Promise.resolve('USD')),
    getLatestExchangeRateScoped: vi.fn(() => Promise.resolve(null)),
  };
});
vi.mock('@/api/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/settings')>();
  return {
    ...actual,
    getCreditSettingsScoped: vi.fn(() => Promise.resolve(mockCreditSettings.current)),
  };
});

function renderModal() {
  return renderWithFluentSync(
    <ToastProvider>
      <PaymentModal
        open
        sessionToken="tok"
        lineItems={[
          {
            id: 'l1',
            sku: 'SKU-1',
            name: 'Nasi Goreng',
            qty: 1,
            unit_price: { minor_units: 700, currency: 'USD' },
          },
        ] as never}
        total={{ minor_units: 700, currency: 'USD' }}
        userId="u1"
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />
    </ToastProvider>,
    salesFtl,
  );
}

/** A rail row the hook will read: `is_enabled: false` withholds the rail. */
function rail(code: string, enabled: boolean) {
  return { rail_code: code, is_enabled: enabled, parameters: null };
}

describe('a switched-off credit rail withdraws the credit tender', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPrimaryLocationScoped.mockResolvedValue({ id: 'loc-1' });
    mockCreditSettings.current = { enabled: true, reminderIntervalHours: 24, maxLimitMinor: 0 };
  });

  it('offers credit when the rail list has no credit row (fail open)', async () => {
    // PRECONDITION for the case below: without it, a missing tender could be blamed on an
    // empty list rather than on the row. `coreRailWithheld` is permissive about a missing
    // row, because the feature may predate it.
    getLocalPaymentMethodsScoped.mockResolvedValue([rail('cash', true)]);
    renderModal();
    await waitFor(() => {
      expect(screen.getByLabelText(/Credit/)).toBeInTheDocument();
    });
  });

  it('does NOT offer credit when the rail row says is_enabled false', async () => {
    // The facility is ENABLED, so `creditSettings?.enabled === false` cannot be what
    // refuses. The only input withdrawing credit is the rail row.
    getLocalPaymentMethodsScoped.mockResolvedValue([
      rail('cash', true),
      rail('credit', false),
    ]);
    renderModal();
    await waitFor(() => {
      expect(
        screen.queryByLabelText(/Credit/),
        'credit is still offered with the facility ENABLED and the rail row switched off: ' +
          '`coreRailWithheld` reports a disabled row and nothing consumed it.',
      ).toBeNull();
    });
  });
});
