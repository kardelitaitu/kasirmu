import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import { renderInAct } from '@/test-utils/renderInAct';
import userEvent from '@testing-library/user-event';
import { withFluent, withFluentLocale } from '@/i18n/test-utils';
import { ToastProvider } from '@/components/Toast';
import salesFtl from '@/locales/sales.ftl?raw';
import salesIdFtl from '@/locales/sales.id.ftl?raw';
import PaymentModal from '@/features/sales/PaymentModal';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useWorkspaceScope } from '@/contexts/WorkspaceContext';
import { makeSubscriptionCaps } from '@/__tests__/test-utils/mocks/subscriptionCaps';
import type { Money, CartLine, Sku, LineId } from '@/types/domain';
import type * as CurrencyApi from '@/api/currency';

async function renderWithFluent(ui: React.ReactElement) {
  const wrapped = withFluent(<ToastProvider>{ui}</ToastProvider>, salesFtl);
  await renderInAct(wrapped);
}

async function renderWithFluentId(ui: React.ReactElement) {
  const wrapped = withFluentLocale('id', <ToastProvider>{ui}</ToastProvider>, salesIdFtl);
  await renderInAct(wrapped);
}

/**
 * Render on the Restaurant POS terminal.
 *
 * The Open Bill tender is gated on the workspace type — the modal is shared by
 * both POS terminals, but an open bill is the restaurant terminal's own concept
 * and `hold_cart_scoped` refuses it from anywhere else — so a test that expects
 * to see or choose that tender has to say which terminal it is on. The global
 * harness returns a generic `typeKey` ('default'), which hides it.
 */
async function renderWithFluentAsRestaurantPos(ui: React.ReactElement) {
  vi.mocked(useWorkspaceScope).mockReturnValue({
    storeId: 'store-1',
    instanceId: 'instance-1',
    typeKey: 'restaurant-pos',
  });
  const wrapped = withFluent(<ToastProvider>{ui}</ToastProvider>, salesFtl);
  await renderInAct(wrapped);
}

const usd = (minor: number): Money => ({ minor_units: minor, currency: 'USD' });

const lineItem = (overrides: Partial<CartLine> = {}): CartLine => ({
  id: 'line-1' as LineId,
  sku: 'COFFEE' as Sku,
  name: 'Coffee',
  qty: 2,
  unit_price: usd(350),
  ...overrides,
});

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
      case 'complete_sale':
      case 'complete_sale_scoped':
        return Promise.resolve({ saleId: 'sale-1', total: null, lineCount: 1 });
      case 'get_sale':
      case 'get_sale_scoped':
        return Promise.resolve(null);
      case 'print_sales_receipt':
        return Promise.resolve({ printed: true });
      case 'hold_cart':
        return Promise.resolve();
      case 'get_enabled_features':
        return Promise.resolve({ features: [] });
      case 'finalize_sale':
        return Promise.resolve();
      case 'create_kds_order_from_sale_scoped':
        return Promise.resolve();
      default:
        return Promise.resolve({});
    }
  });
  return { invokeMock: mock };
});

const {
  mockListCurrenciesScoped,
  mockListExchangeRates,
  mockGetLatestExchangeRateScoped,
  mockGetDefaultCurrencyScoped,
} = vi.hoisted(() => ({
  // Held by reference so a test can make the store-default read refuse. Both
  // this and the rate list are gated on permissions::SETTINGS_READ
  // (crates/kasirmu-bridge/src/currency.rs:262 and :107), which the picker
  // read is NOT (:72-86) -- so one of them can be refused while the picker
  // answers, and the modal has to say which.
  mockGetDefaultCurrencyScoped: vi.fn(() => Promise.resolve('USD')),
  mockListCurrenciesScoped: vi.fn(() =>
    Promise.resolve([
      { code: 'USD', name: 'US Dollar', minor_exponent: 2, symbol: '$' },
      { code: 'IDR', name: 'Indonesian Rupiah', minor_exponent: 0, symbol: 'Rp' },
    ]),
  ),
  mockListExchangeRates: vi.fn(() =>
    Promise.resolve([
      {
        id: 'rate-1',
        from_currency: 'USD',
        to_currency: 'IDR',
        rate_millionths: 16_000_000_000, // 1 USD = 16,000 IDR
        source: 'manual',
        effective_date: '2026-07-31',
        created_at: '2026-07-31T00:00:00.000Z',
      },
    ]),
  ),
  // Held by reference so a test can make the CUR-04 rate read fail. The
  // multi-currency block below needs that: with the read failing, the charge
  // currency has no rate, and settling in it must refuse.
  mockGetLatestExchangeRateScoped: vi.fn(() =>
    Promise.resolve({
      id: 'rate-1',
      from_currency: 'USD',
      to_currency: 'IDR',
      rate_millionths: 16_000_000_000,
      source: 'manual',
      effective_date: '2026-01-01',
    }),
  ),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('@/api/currency', async () => {
  // Pure fixed-point helpers (convertMinorUnits, reciprocalMillionths)
  // must be the REAL implementations — MONEY-01 tests pin their exact
  // decimal behavior through this component. IPC functions stay mocked.
  const actual = await vi.importActual<typeof CurrencyApi>('@/api/currency');
  return {
    ...actual,
    listCurrenciesScoped: mockListCurrenciesScoped,
  listExchangeRates: mockListExchangeRates,
  listExchangeRatesScoped: vi.fn(() =>
    Promise.resolve([
      { from_currency: 'USD', to_currency: 'IDR', rate_millionths: 16_000_000_000 },
    ]),
  ),
  listLatestExchangeRatesScoped: vi.fn(() =>
    Promise.resolve([
      { from_currency: 'USD', to_currency: 'IDR', rate_millionths: 16_000_000_000 },
    ]),
  ),
  listCurrencies: vi.fn(() =>
    Promise.resolve([
      { code: 'USD', name: 'US Dollar', minor_exponent: 2, symbol: '$' },
      { code: 'IDR', name: 'Indonesian Rupiah', minor_exponent: 0, symbol: 'Rp' },
    ]),
  ),
  getDefaultCurrency: vi.fn(() => Promise.resolve('USD')),
    getDefaultCurrencyScoped: mockGetDefaultCurrencyScoped,
  getLatestExchangeRateScoped: mockGetLatestExchangeRateScoped,
  };
});

vi.mock('@/hooks/useFeatures', () => ({
  useFeatures: () => ({
    enabled: new Set(['multi-currency']),
    loading: false,
    isEnabled: (key: string) => key === 'multi-currency',
    filterRoutes: (routes: string[]) => routes,
    error: null,
    loaded: true,
  }),
  FEATURES: {
    MULTI_CURRENCY: 'multi-currency',
  },
}));

beforeEach(() => {
  invokeMock.mockClear();
  mockListCurrenciesScoped.mockClear();
  mockListExchangeRates.mockClear();
    // Reset, not clear: the store-default tests make this REJECT rather than
    // reject once, and a clear would hand the rejection to the next test.
    mockGetDefaultCurrencyScoped.mockReset();
    mockGetDefaultCurrencyScoped.mockResolvedValue('USD');
  // Restore the answering default: the unknown-rate tests make this reject, and
  // a vi.fn().mockRejectedValueOnce would otherwise leak into the next test.
  mockGetLatestExchangeRateScoped.mockReset();
  mockGetLatestExchangeRateScoped.mockResolvedValue({
    id: 'rate-1',
    from_currency: 'USD',
    to_currency: 'IDR',
    rate_millionths: 16_000_000_000,
    source: 'manual',
    effective_date: '2026-01-01',
  });
});

describe('PaymentModal — rendering & fast interaction', () => {
  it('renders total due and payment method options when open', async () => {
    await renderWithFluent(
      <PaymentModal
        open
        lineItems={[lineItem()]}
        total={usd(700)}
        userId="test-user-id"
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Total Due/)).toBeInTheDocument();
    expect(screen.getByText('$ 7,00')).toBeInTheDocument();
    expect(screen.getByLabelText(/Cash/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Card/)).toBeInTheDocument();
  });

  it('shows the QRIS upgrade prompt when the tier does not support QRIS (C2.2)', async () => {
    vi.mocked(useSubscription).mockReturnValue({
      caps: makeSubscriptionCaps({ tier: 'free', supportsQris: false }),
      state: 'active',
      loading: false,
      refresh: vi.fn(),
    });
    await renderWithFluent(
      <PaymentModal
        open
        lineItems={[lineItem()]}
        total={usd(700)}
        userId="test-user-id"
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText(/QRIS/));
    expect(screen.getByText(/QRIS payments are a Plus feature/)).toBeInTheDocument();
    expect(screen.getByText('Upgrade to Plus')).toBeInTheDocument();
  });

  it('shows the QRIS generation UI when the tier supports QRIS (C2.2)', async () => {
    vi.mocked(useSubscription).mockReturnValue({
      caps: makeSubscriptionCaps({ tier: 'plus', supportsQris: true }),
      state: 'active',
      loading: false,
      refresh: vi.fn(),
    });
    await renderWithFluent(
      <PaymentModal
        open
        lineItems={[lineItem()]}
        total={usd(700)}
        userId="test-user-id"
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText(/QRIS/));
    expect(screen.queryByText(/QRIS payments are a Plus feature/)).not.toBeInTheDocument();
    expect(screen.getByText('Pay with QR')).toBeInTheDocument();
  });

  it('does not render when closed', async () => {
    await renderWithFluent(
      <PaymentModal
        open={false}
        lineItems={[lineItem()]}
        total={usd(700)}
        userId="test-user-id"
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders every payment input attribute from the id bundle, not getString fallbacks (rounds 99-102 dead-attribute fix)', async () => {
    await renderWithFluentId(
      <PaymentModal
        open
        lineItems={[lineItem()]}
        total={usd(700)}
        userId="test-user-id"
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    // Default state (method = cash). All attributes must come from the real id
    // bundle via <Localized attrs> — getString never reads Fluent attributes.
    expect(document.querySelector('[role="dialog"]')!.getAttribute('aria-label')).toBe('Pembayaran');
    expect(document.querySelector('.payment-close')!.getAttribute('aria-label')).toBe('Batal pembayaran');

    const tendered = document.querySelector('.payment-tendered-input') as HTMLInputElement | null;
    expect(tendered, 'tendered input should render in cash mode').not.toBeNull();
    expect(tendered!.getAttribute('placeholder')).toBe('0,00');
    expect(tendered!.getAttribute('aria-label')).toBe('Jumlah dibayar');

    const other = document.querySelector('.payment-other-input') as HTMLInputElement | null;
    expect(other, 'other method input should render (disabled) in cash mode').not.toBeNull();
    expect(other!.getAttribute('placeholder')).toBe('Lainnya…');
    expect(other!.getAttribute('aria-label')).toBe('Nama metode pembayaran lain');

    // The Other row is a div rather than a label (it holds the radio AND the
    // name field), so nothing in the row names the radio. Unselected, its name
    // field is an empty disabled input, so without its own aria-label the radio
    // announced as a bare "radio button".
    const otherRadio = document.querySelector<HTMLInputElement>(
      '.payment-method-label input[value="other"]',
    );
    expect(otherRadio, 'other-method radio should render').not.toBeNull();
    expect(otherRadio!.getAttribute('aria-label')).toBe('Metode pembayaran lain');

    const quickBtns = document.querySelectorAll('.payment-quick-btn');
    expect(quickBtns.length).toBeGreaterThan(0);
    expect(quickBtns[quickBtns.length - 1]!.getAttribute('aria-label')).toBe('Bayar tepat');

    // Enter split mode: the split rows (with the amount + other inputs) render.
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Bagi pembayaran antar metode'));

    const amountInput = document.querySelector('.payment-split-amount-input') as HTMLInputElement | null;
    expect(amountInput, 'split amount input should render in split mode').not.toBeNull();
    expect(amountInput!.getAttribute('placeholder')).toBe('0,00');
    expect(amountInput!.getAttribute('aria-label')).toBe('Jumlah pembagian');

    const splitOther = document.querySelector('.payment-split-other-input') as HTMLInputElement | null;
    expect(splitOther, 'split other input should render in split mode').not.toBeNull();
    expect(splitOther!.getAttribute('placeholder')).toBe('Lainnya');
    expect(splitOther!.getAttribute('aria-label')).toBe('Nama metode pembayaran lain');
  });

  it('shows change preview for cash payment', async () => {
    await renderWithFluent(
      <PaymentModal
        open
        lineItems={[lineItem()]}
        total={usd(700)}
        userId="test-user-id"
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const input = screen.getByLabelText(/amount tendered/i);
    await userEvent.type(input, '10');

    await waitFor(() => {
      expect(screen.getByText('$ 3,00')).toBeInTheDocument();
    });
  });

  it('shows insufficient amount warning when tendered < total', async () => {
    await renderWithFluent(
      <PaymentModal
        open
        lineItems={[lineItem()]}
        total={usd(700)}
        userId="test-user-id"
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const input = screen.getByLabelText(/amount tendered/i);
    await userEvent.type(input, '5');

    await waitFor(() => {
      expect(screen.getByText(/insufficient/i)).toBeInTheDocument();
    });
  });

  it('disables Complete Sale when tendered < total', async () => {
    await renderWithFluent(
      <PaymentModal
        open
        lineItems={[lineItem()]}
        total={usd(700)}
        userId="test-user-id"
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const input = screen.getByLabelText(/amount tendered/i);
    await userEvent.type(input, '5');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^complete$/i })).toBeDisabled();
    });
  });

  it('enables Complete Sale when tendered >= total', async () => {
    await renderWithFluent(
      <PaymentModal
        open
        lineItems={[lineItem()]}
        total={usd(700)}
        userId="test-user-id"
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const input = screen.getByLabelText(/amount tendered/i);
    await userEvent.type(input, '10');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^complete$/i })).not.toBeDisabled();
    });
  });

  // ── Split payment mode ──

  it('shows split payment UI when toggle is checked', async () => {
    await renderWithFluent(
      <PaymentModal
        open
        lineItems={[lineItem()]}
        total={usd(700)}
        userId="test-user-id"
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('checkbox'));

    expect(screen.getByText(/Split Payments/)).toBeInTheDocument();
    expect(screen.getByText(/Split Evenly/)).toBeInTheDocument();
    expect(screen.getByText(/\+ Add Split/)).toBeInTheDocument();
    expect(screen.getByText(/Remaining/)).toBeInTheDocument();
  });

  it('hides split UI when toggle is unchecked', async () => {
    await renderWithFluent(
      <PaymentModal
        open
        lineItems={[lineItem()]}
        total={usd(700)}
        userId="test-user-id"
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const toggle = screen.getByRole('checkbox');
    await userEvent.click(toggle);
    await userEvent.click(toggle);

    expect(screen.queryByText(/Split Payments/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Cash/)).toBeInTheDocument();
  });

  it('adds a new split row', async () => {
    await renderWithFluent(
      <PaymentModal
        open
        lineItems={[lineItem()]}
        total={usd(700)}
        userId="test-user-id"
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('checkbox'));
    expect(screen.getAllByRole('radio', { name: 'Cash' })).toHaveLength(2);

    await userEvent.click(screen.getByText(/\+ Add Split/));
    expect(screen.getAllByRole('radio', { name: 'Cash' })).toHaveLength(3);
  });

  it('removes a split row when remove is clicked', async () => {
    await renderWithFluent(
      <PaymentModal
        open
        lineItems={[lineItem()]}
        total={usd(700)}
        userId="test-user-id"
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('checkbox'));
    const removeBtns = screen.getAllByRole('button', { name: /remove split/i });
    expect(removeBtns).toHaveLength(2);

    await userEvent.click(removeBtns[0]!);
    expect(screen.getAllByRole('radio', { name: 'Cash' })).toHaveLength(1);
  });

  it('split evenly distributes total across rows', async () => {
    await renderWithFluent(
      <PaymentModal
        open
        lineItems={[lineItem()]}
        total={usd(700)}
        userId="test-user-id"
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByText(/Split Evenly/));

    const splitInputs = screen.getAllByPlaceholderText('0.00') as unknown as HTMLInputElement[];
    expect(splitInputs).toHaveLength(2);
    expect(splitInputs[0]!.value).toBe('3.50');
    expect(splitInputs[1]!.value).toBe('3.50');
  });

  it('shows remaining amount when splits do not cover total', async () => {
    await renderWithFluent(
      <PaymentModal
        open
        lineItems={[lineItem()]}
        total={usd(700)}
        userId="test-user-id"
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('checkbox'));
    const splitInputs = screen.getAllByPlaceholderText('0.00') as unknown as HTMLInputElement[];
    await userEvent.type(splitInputs[0]!, '2');

    await waitFor(() => {
      expect(screen.getByText('$ 5,00')).toBeInTheDocument();
    });
  });

  it('enables complete when split amounts sum to total', async () => {
    await renderWithFluent(
      <PaymentModal
        open
        lineItems={[lineItem()]}
        total={usd(700)}
        userId="test-user-id"
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('checkbox'));
    const splitInputs = screen.getAllByPlaceholderText('0.00') as unknown as HTMLInputElement[];
    await userEvent.type(splitInputs[0]!, '3.50');
    await userEvent.type(splitInputs[1]!, '3.50');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^complete$/i })).not.toBeDisabled();
    });
  });

  // ── Other payment method ──

  it('disables complete when other method has no label', async () => {
    await renderWithFluent(
      <PaymentModal
        open
        lineItems={[lineItem()]}
        total={usd(700)}
        userId="test-user-id"
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const otherRadio = document.querySelector<HTMLInputElement>('input[type="radio"][value="other"]')!;
    await userEvent.click(otherRadio);

    expect(screen.getByRole('button', { name: /^complete$/i })).toBeDisabled();
  });

  it('enables complete when other method has a label', async () => {
    await renderWithFluent(
      <PaymentModal
        open
        lineItems={[lineItem()]}
        total={usd(700)}
        userId="test-user-id"
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const otherRadio = document.querySelector<HTMLInputElement>('input[type="radio"][value="other"]')!;
    await userEvent.click(otherRadio);
    const otherInput = screen.getByPlaceholderText(/^Other/);
    await userEvent.type(otherInput, 'Voucher');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^complete$/i })).not.toBeDisabled();
    });
  });

  // ── Open Bill ──

  it('shows customer name input for open bill', async () => {
    await renderWithFluentAsRestaurantPos(
      <PaymentModal
        open
        lineItems={[lineItem()]}
        total={usd(700)}
        userId="test-user-id"
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const openBillRadio = screen.getByLabelText(/Open Bill/);
    await userEvent.click(openBillRadio);

    expect(screen.getByLabelText(/customer name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open bill/i })).toBeInTheDocument();
  });

  it('disables Open Bill complete when customer name is empty', async () => {
    await renderWithFluentAsRestaurantPos(
      <PaymentModal
        open
        lineItems={[lineItem()]}
        total={usd(700)}
        userId="test-user-id"
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByLabelText(/Open Bill/));

    expect(screen.getByRole('button', { name: /open bill/i })).toBeDisabled();
  });

  // ── Credit ──

  it('shows customer name input and Credit Sale button for credit', async () => {
    await renderWithFluent(
      <PaymentModal
        open
        lineItems={[lineItem()]}
        total={usd(700)}
        userId="test-user-id"
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const creditRadio = screen.getByLabelText(/Credit/);
    await userEvent.click(creditRadio);

    expect(screen.getByLabelText(/customer name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /credit sale/i })).toBeInTheDocument();
  });

  // ── QRIS ──

  it('shows Pay with QR button for QRIS method', async () => {
    await renderWithFluent(
      <PaymentModal
        open
        lineItems={[lineItem()]}
        total={usd(700)}
        userId="test-user-id"
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByLabelText(/QRIS/));

    expect(screen.getByRole('button', { name: /pay with qr/i })).toBeInTheDocument();
  });

  // ── Close button ──

  it('calls onClose after close button click and animation', async () => {
    const onClose = vi.fn();
    await renderWithFluent(
      <PaymentModal
        open
        lineItems={[lineItem()]}
        total={usd(700)}
        userId="test-user-id"
        onComplete={vi.fn()}
        onClose={onClose}
      />,
    );

    const closeBtn = screen.getByRole('button', { name: /cancel payment/i });
    await userEvent.click(closeBtn);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    }, { timeout: 2000 });
  });

  // ── Backdrop click (click the area outside the modal) ──

  it('closes when the backdrop is clicked', async () => {
    const onClose = vi.fn();
    await renderWithFluent(
      <PaymentModal
        open
        lineItems={[lineItem()]}
        total={usd(700)}
        userId="test-user-id"
        onComplete={vi.fn()}
        onClose={onClose}
      />,
    );

    // The backdrop is the role=presentation overlay; the dialog is the panel
    // INSIDE it. Clicking the overlay itself is "outside the modal".
    const backdrop = document.querySelector('.payment-overlay') as HTMLElement;
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    }, { timeout: 2000 });
  });

  it('does NOT close when a click lands inside the modal panel', async () => {
    const onClose = vi.fn();
    await renderWithFluent(
      <PaymentModal
        open
        lineItems={[lineItem()]}
        total={usd(700)}
        userId="test-user-id"
        onComplete={vi.fn()}
        onClose={onClose}
      />,
    );

    // A click on the panel bubbles to the overlay handler, so the handler must
    // compare target to currentTarget rather than assume every bubble is a
    // backdrop click -- otherwise selecting a tender would dismiss the modal.
    fireEvent.click(screen.getByTestId('payment-modal'));

    // Give the 300ms leave animation room to start if it were going to.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(onClose).not.toHaveBeenCalled();
  });

  // ── Quick tender presets ──

  it('clicking a quick tender preset sets the tendered amount', async () => {
    await renderWithFluent(
      <PaymentModal
        open
        lineItems={[lineItem()]}
        total={usd(700)}
        userId="test-user-id"
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    // The button label is display money, so it now comes from `formatMoney` like every
    // other amount in this modal. Asserted by property rather than by a pasted string:
    // a symbol prefix (not the ISO code) and the two decimal digits a cents currency
    // actually has. Both separators are `[.,]` so this survives a locale switch --
    // `id` renders "$ 10.000,00", `en` renders "$ 10,000.00" -- where a literal would
    // fail the day the resolved locale changes, which is how the old assertion went
    // stale: `/USD 10\.000/` pinned the float-era hybrid of an American code, id-ID
    // grouping and no decimals on a 2-decimal currency.
    const presetBtn = screen.getByText(/^\$ 10[.,]000[.,]00$/);
    await userEvent.click(presetBtn);

    const tenderInput = screen.getByLabelText(/amount tendered/i) as unknown as HTMLInputElement;
    expect(tenderInput.value).toBe('10000.00');
  });

  it('clicking exact tender sets the exact total amount', async () => {
    await renderWithFluent(
      <PaymentModal
        open
        lineItems={[lineItem()]}
        total={usd(700)}
        userId="test-user-id"
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const exactBtn = screen.getByRole('button', { name: /tend exact amount/i });
    await userEvent.click(exactBtn);

    const tenderInput = screen.getByLabelText(/amount tendered/i) as unknown as HTMLInputElement;
    expect(tenderInput.value).toBe('7.00');
  });

  // ── Multi-currency settlement (CUR-02) ──

  it('completes sale in selected charge currency with converted amounts (multi-currency)', async () => {
    const onComplete = vi.fn();
    await renderWithFluent(
      <PaymentModal
        open
        lineItems={[lineItem({ unit_price: usd(350), qty: 2 })]} // 2 * $3.50 = $7.00
        total={usd(700)} // $7.00 USD
        userId="test-user-id"
        sessionToken="test-session-token"
        onComplete={onComplete}
        onClose={vi.fn()}
      />,
    );

    // Wait for currencies and exchange rates to load
    await waitFor(() => {
      expect(screen.getByLabelText(/select charge currency/i)).toBeInTheDocument();
    });

    // Select IDR as charge currency (1 USD = 16,000 IDR)
    const currencySelect = screen.getByLabelText(/select charge currency/i) as HTMLSelectElement;
    await userEvent.selectOptions(currencySelect, 'IDR');

    // Verify charge amount shows converted value: $7.00 * 16,000 = Rp 112,000
    // Indonesian locale formats with dots as thousand separators: Rp 112.000
    await waitFor(() => {
      expect(screen.getByText(/Rp 112\.000/)).toBeInTheDocument();
    });

    // Select cash payment method
    await userEvent.click(screen.getByLabelText(/Cash/));

    // Enter exact tender in IDR (Rp 112,000)
    const tenderInput = screen.getByLabelText(/amount tendered/i) as HTMLInputElement;
    await userEvent.type(tenderInput, '112000');

    // Complete the sale
    await userEvent.click(screen.getByRole('button', { name: /Complete/i }));

    // Verify complete_sale_scoped was called with correct multi-currency metadata
    // The API uses baseCurrency (original cart currency) + tenderRateMillionths for conversion
    const completeSaleCall = invokeMock.mock.calls.find((call) => call[0] === 'complete_sale_scoped');
    expect(completeSaleCall).toBeDefined();
    if (completeSaleCall) {
      // Tauri commands wrap params in { sessionToken, args: { ... } }
      const outerArgs = completeSaleCall[1] as { args?: { baseCurrency?: string; tenderRateMillionths?: number; tenderedMinor?: number } } | undefined;
      const args = outerArgs?.args;
      // baseCurrency should be the original cart currency (USD)
      expect(args?.baseCurrency).toBe('USD');
      // tenderRateMillionths should be set (16,000 IDR per USD = 16,000,000,000 millionths)
      expect(args?.tenderRateMillionths).toBe(16_000_000_000);
      // For cash payments, tenderedMinor is used instead of paymentSplits (in charge currency minor units)
      expect(args?.tenderedMinor).toBe(112000);
    }

    // Wait for receipt preview to appear, then click Skip to trigger onComplete
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Skip/i })).toBeInTheDocument();
    });

    // ADR #7: the sale was just created in the session's store by complete_sale_scoped above, so
    // reading it back for the receipt must use get_sale_scoped. It used to call the ambient
    // get_sale, meaning the total shown to a customer about to hand over cash came from whatever
    // store the singleton happened to point at rather than the one the sale was written to.
    // Asserted at the invoke layer, which is what this file already mocks -- the real api/sales
    // runs, so this checks the command name rather than a mock someone configured.
    const commands = invokeMock.mock.calls.map((call) => call[0]);
    expect(commands).toContain('get_sale_scoped');
    expect(commands).not.toContain('get_sale');

    await userEvent.click(screen.getByRole('button', { name: /Skip/i }));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalled();
    });
  });
});

// ── Stale closure on the checkout payload — FIXED, kept as the reason these exist ──
//
// THE BUG THIS SUITE WAS WRITTEN FOR NO LONGER EXISTS. Re-read 2026-10-07: both
// checkout callbacks DO list promotionIds in their dependency arrays —
// PaymentModal.tsx:607 (the QR callback) and :759 (the cash callback) — so the
// stale capture cannot occur and these cases now guard the CORRECT behaviour
// rather than exposing a defect.
//
// What it was, because the guard is only meaningful with the history:
// PosScreen.tsx:1198 passes `promotionIds={appliedPromotions.map((p) => p.id)}` --
// a fresh array on every parent render. Both callbacks read it and, at the time,
// neither listed it in its deps; eslint reported that at two now-different lines,
// but only as a *warning*, and `eslint .` exits 0 with warnings, so nothing gated
// it. A stale capture would have committed the sale with whatever promotions
// existed when the callback was last rebuilt rather than the ones on screen when
// the cashier pressed Complete — a money bug with no automated check. The lesson
// the guard preserves is that the deps array is the only thing standing between
// here and there, which is why the cases below assert the payload the modal
// actually hands to invoke().
describe('PaymentModal — promotionIds reach the checkout payload', () => {
  beforeEach(() => {
    invokeMock.mockClear();
  });

  async function renderModal(el: React.ReactElement) {
    return renderInAct(withFluent(<ToastProvider>{el}</ToastProvider>, salesFtl));
  }

  const modal = (promotionIds: string[]) => (
    <PaymentModal
      open
      lineItems={[lineItem()]}
      total={usd(700)}
      userId="test-user-id"
      promotionIds={promotionIds}
      onComplete={vi.fn()}
      onClose={vi.fn()}
    />
  );

  it('sends the promotions current at press time, not the ones first rendered', async () => {
    const { rerender } = await renderModal(modal(['promo-a']));
    // Swap the promotion set while the modal stays open, which is what PosScreen does whenever
    // appliedPromotions changes -- a new array identity every render.
    await act(async () => {
      rerender(withFluent(<ToastProvider>{modal(['promo-b'])}</ToastProvider>, salesFtl));
    });

    await userEvent.type(screen.getByLabelText(/amount tendered/i), '10');
    await userEvent.click(screen.getByRole('button', { name: /^complete$/i }));

    await waitFor(() => {
      expect(invokeMock.mock.calls.some((c) => String(c[0]).startsWith('complete_sale'))).toBe(true);
    });
    const call = invokeMock.mock.calls.find((c) => String(c[0]).startsWith('complete_sale'));
    const args = (call?.[1] as { args?: { promotionIds?: string[] } })?.args;
    expect(args?.promotionIds).toEqual(['promo-b']);
  });
});

// ── An unknown exchange rate cannot be settled in ──────────────────────
//
// The CUR-04 rate read is how checkout learns `tender_rate_millionths` for the
// sale. When it FAILED, `latestRate` used to be null, `effectiveRateInfo` fell
// back to a find() over `list_latest_exchange_rates`, and the modal settled a
// converted total against a rate the cashier was never shown -- or, with the
// list empty of that pair, converted nothing while still labelling the total in
// the charge currency. The backend does not catch it: the three CUR-02 fields
// are assigned straight from the args (crates/kasirmu-bridge/src/pos/checkout.rs:424-428).
//
// These tests pin the two halves of the repair: the state is VISIBLE, and the
// action that would record an unknown rate is UNAVAILABLE.
describe('PaymentModal — a failed rate read cannot be settled in', () => {
  beforeEach(() => {
    invokeMock.mockClear();
  });

  async function openInIdr() {
    await renderWithFluent(
      <PaymentModal
        open
        lineItems={[lineItem({ unit_price: usd(350), qty: 2 })]}
        total={usd(700)}
        userId="test-user-id"
        sessionToken="test-session-token"
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByLabelText(/select charge currency/i)).toBeInTheDocument();
    });
    await userEvent.selectOptions(
      screen.getByLabelText(/select charge currency/i),
      'IDR',
    );
    // Cash is the default tender and `sufficient` is computed against the
    // payable (useTenderMath.ts:157-159), so without a tender Complete is
    // disabled for a second, unrelated reason and the rate assertion below
    // would pass vacuously. The exact tender is sufficient under BOTH states:
    // Rp 112,000 once the rate answers, and far more than the unconverted
    // Rp 7.00 while the rate is unknown.
    await userEvent.type(screen.getByLabelText(/amount tendered/i), '112000');
  }

  it('says the rate is unknown and refuses to enable Complete', async () => {
    mockGetLatestExchangeRateScoped.mockRejectedValue(new Error('ipc down'));
    await openInIdr();

    // Anchor on the ARRIVING alert, never on the absence of the rate notice --
    // while the read is still pending neither is rendered, so polling for an
    // absence passes vacuously.
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /Could not load the exchange rate/i,
      );
    });
    expect(screen.getByRole('button', { name: /Complete/i })).toBeDisabled();
    // No converted total is shown either: nothing was converted.
    expect(screen.queryByText(/Rp 112\.000/)).not.toBeInTheDocument();
  });

  it('a retry that answers restores the rate and re-enables Complete', async () => {
    mockGetLatestExchangeRateScoped.mockRejectedValueOnce(new Error('ipc down'));
    await openInIdr();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /Could not load the exchange rate/i,
      );
    });
    expect(screen.getByRole('button', { name: /Complete/i })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: /Retry/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Complete/i })).toBeEnabled();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(/Rp 112\.000/)).toBeInTheDocument();
  });
});

describe('PaymentModal — a refused currency read cannot be settled in', () => {
  // The three first-load reads were ONE `Promise.all` behind a single `.catch`
  // that toasted. `list_currencies_scoped` gates nothing
  // (crates/kasirmu-bridge/src/currency.rs:72-86) while the rate list and the
  // store default both require permissions::SETTINGS_READ (:262 and :107), so a
  // cashier who may take a payment here is routinely refused both of those, and
  // the old shape emptied the picker and printed the sale's own currency as the
  // store default with nothing on screen to say so.
  beforeEach(() => {
    invokeMock.mockClear();
    mockListCurrenciesScoped.mockReset();
    mockListCurrenciesScoped.mockResolvedValue([
      { code: 'USD', name: 'US Dollar', minor_exponent: 2, symbol: '$' },
      { code: 'IDR', name: 'Indonesian Rupiah', minor_exponent: 0, symbol: 'Rp' },
    ]);
  });

  it('names a refused picker list instead of showing an empty picker', async () => {
    mockListCurrenciesScoped.mockRejectedValue(new Error('ipc down'));

    await renderWithFluent(<PaymentModal open lineItems={[lineItem()]} total={usd(700)} userId="user-1" onComplete={vi.fn()} onClose={vi.fn()} />);

    // Anchored on the ARRIVING alert. An absence poll would also pass while the
    // modal is still loading, which is the state this test starts in.
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'The list of supported currencies could not be loaded.',
      ),
    );
    // The picker keeps the sale's own currency as its only option: correct as a
    // default, and NOT an answer this read gave. Every option carries the
    // rendered code, so the IDR one must be absent.
    expect(screen.queryAllByRole('option').map((o) => o.textContent)).toEqual(['USD']);
  });

  it('restores the picker once a retry answers', async () => {
    mockListCurrenciesScoped.mockRejectedValueOnce(new Error('ipc down'));

    await renderWithFluent(<PaymentModal open lineItems={[lineItem()]} total={usd(700)} userId="user-1" onComplete={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'The list of supported currencies could not be loaded.',
      ),
    );

    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.queryAllByRole('option').map((o) => o.textContent)).toContain(
      'IDR — Indonesian Rupiah',
    );
  });

  it('does not claim a store default the read never returned', async () => {
    mockGetDefaultCurrencyScoped.mockRejectedValue(new Error('permission denied'));

    await renderWithFluent(<PaymentModal open lineItems={[lineItem()]} total={usd(700)} userId="user-1" onComplete={vi.fn()} onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'The default currency for this store could not be loaded.',
      ),
    );

    // The receipt block is where a wrong default is read as fact, and it only
    // appears once a charge currency is chosen, so the test has to choose one.
    // The select carries its own aria-label and the <label> has one too, so a
    // label query matches both. The combobox role is the control itself.
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /charge currency/i }),
      'IDR',
    );
    const rows = screen.getByTestId('payment-modal');
    const defaultRow = rows.querySelectorAll('.payment-receipt-currency-row')[1];
    expect(defaultRow).toHaveTextContent('Default currency');
    // The em dash is the one claim available: we do not know the default. The
    // old shape printed 'USD', the sale's own currency, as the store default.
    expect(defaultRow?.lastElementChild?.textContent).toBe('—');
  });
});
