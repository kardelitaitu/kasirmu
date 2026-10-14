//! A11y regression tests for PaymentModal.
//!
//! The payment modal is the last screen of every restaurant sale — tender
//! selection, the cash/QRIS/card/split panels, the customer picker and the
//! exchange-rate block — and it had no axe coverage while the settings screens
//! did. It is the highest-stakes surface in the POS: a cashier drives it under
//! time pressure, so an unlabelled field is a real operator cost.
//!
//! The harness mirrors PaymentModal.test.tsx (the same Tauri invoke stub and
//! currency mocks) so the modal mounts its real tender panels rather than
//! falling back to a stub.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { renderInAct } from '@/test-utils/renderInAct';
import { withFluent } from '@/i18n/test-utils';
import { ToastProvider } from '@/components/Toast';
import salesFtl from '@/locales/sales.ftl?raw';
import PaymentModal from '@/features/sales/PaymentModal';
import type { Money, CartLine, Sku, LineId } from '@/types/domain';
import type * as CurrencyApi from '@/api/currency';
import { checkA11y } from './axe-helper';

const { invokeMock } = vi.hoisted(() => {
  const mock = vi.fn((...callArgs: unknown[]) => {
    const cmd = callArgs[0] as string;
    switch (cmd) {
      case 'start_sale':
      case 'start_sale_scoped':
        return Promise.resolve({ cartId: 'test-cart' });
      case 'add_line':
      case 'add_line_scoped':
        return Promise.resolve({ lineId: 'test-line', lineTotal: null });
      case 'get_sale':
      case 'get_sale_scoped':
        return Promise.resolve(null);
      case 'get_enabled_features':
        return Promise.resolve({ features: [] });
      case 'get_credit_settings_scoped':
        return Promise.resolve({ enabled: true, reminderIntervalHours: 24, maxLimitMinor: 10000000 });
      default:
        return Promise.resolve({});
    }
  });
  return { invokeMock: mock };
});

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

vi.mock('@/api/currency', async () => {
  const actual = await vi.importActual<typeof CurrencyApi>('@/api/currency');
  const currencies = [
    { code: 'USD', name: 'US Dollar', minor_exponent: 2, symbol: '$' },
    { code: 'IDR', name: 'Indonesian Rupiah', minor_exponent: 0, symbol: 'Rp' },
  ];
  return {
    ...actual,
    listCurrenciesScoped: vi.fn(() => Promise.resolve(currencies)),
    listCurrencies: vi.fn(() => Promise.resolve(currencies)),
    listExchangeRates: vi.fn(() => Promise.resolve([])),
    listExchangeRatesScoped: vi.fn(() => Promise.resolve([])),
    listLatestExchangeRatesScoped: vi.fn(() => Promise.resolve([])),
    getDefaultCurrency: vi.fn(() => Promise.resolve('USD')),
    getDefaultCurrencyScoped: vi.fn(() => Promise.resolve('USD')),
    getLatestExchangeRateScoped: vi.fn(() => Promise.resolve(null)),
  };
});

vi.mock('@/hooks/useFeatures', () => ({
  useFeatures: () => ({
    enabled: new Set<string>(),
    loading: false,
    isEnabled: () => false,
    filterRoutes: (routes: string[]) => routes,
    error: null,
    loaded: true,
  }),
  FEATURES: { MULTI_CURRENCY: 'multi-currency' },
}));

beforeEach(() => {
  invokeMock.mockClear();
});

const usd = (minor: number): Money => ({ minor_units: minor, currency: 'USD' });

const lineItem = (overrides: Partial<CartLine> = {}): CartLine => ({
  id: 'line-1' as LineId,
  sku: 'COFFEE' as Sku,
  name: 'Coffee',
  qty: 2,
  unit_price: usd(350),
  ...overrides,
});

// NOTE: this file mounts the REAL sales bundle through `withFluent` below
// rather than the axe-helper's minimal one, because the modal names most of its
// controls with `<Localized ... attrs={{ 'aria-label': true }}>`. With only the
// minimal bundle those attributes are never set, and axe would report labels
// production actually has — a violation found that way is not evidence about
// the shipped app.
async function renderModal(ui: React.ReactElement) {
  await renderInAct(withFluent(<ToastProvider>{ui}</ToastProvider>, salesFtl));
}

describe('PaymentModal a11y', () => {
  it('has no axe violations on the default (cash) tender', async () => {
    await renderModal(
      <PaymentModal
        open
        lineItems={[lineItem()]}
        total={usd(700)}
        userId="test-user-id"
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    // Vacuity guard: the modal must be the REAL tender dialog, not a closed or
    // error shell that axe would also clear.
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog!.textContent).toContain('Total Due');

    await checkA11y(document.body);

    // The tender radios and the cash amount field are the controls a cashier
    // uses; pin that they mounted so the axe pass covered them.
    expect(document.querySelectorAll('input[name="payment-method"]').length).toBeGreaterThan(1);
  });

  it('has no axe violations on the split-tender panel', async () => {
    // The split panel is the surface my static scan flagged: the "other"
    // radio, its label input and the per-row amount input have no id/label
    // association in the markup. Whether that is a REAL defect is a question
    // only axe can answer — the Localized wrappers may supply the names — so
    // this case asks rather than assumes.
    await renderModal(
      <PaymentModal
        open
        lineItems={[lineItem()]}
        total={usd(700)}
        userId="test-user-id"
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const toggle = document.getElementById('payment-split-toggle-cb') as HTMLInputElement;
    expect(toggle, 'the split toggle did not mount').toBeTruthy();
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(document.querySelectorAll('.payment-split-row').length).toBeGreaterThan(0);
    });

    await checkA11y(document.body);

    // Vacuity guard: the per-row controls are what a split sale is driven with.
    expect(document.querySelectorAll('.payment-split-amount-input').length).toBeGreaterThan(0);
    expect(document.querySelector('.payment-split-other-input')).toBeTruthy();
  });
});

