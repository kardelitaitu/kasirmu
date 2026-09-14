// ── PaymentModal sale flow tests ───────────────────────────────────
//
// Covers: full sale completion flow (start_sale → add_line →
// complete_sale → get_sale → print_sales_receipt). These tests are
// the heaviest in PaymentModal (~2-3s each) due to IPC round-trips.
// Extracted to enable parallel execution with fast rendering tests.
// 7 tests.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderInAct } from '@/test-utils/renderInAct';
import userEvent from '@testing-library/user-event';
import { withFluent } from '@/locales/test-utils';
import { ToastProvider } from '@/frontend/shared/Toast';
import salesFtl from '@/locales/sales.ftl?raw';
import PaymentModal from '@/features/sales/PaymentModal';
import type { Money, CartLine, Sku, LineId } from '@/types/domain';

async function renderWithFluent(ui: React.ReactElement) {
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

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn((cmd: string): Promise<unknown> => {
    switch (cmd) {
      case 'start_sale':
        return Promise.resolve({ cartId: 'test-cart' });
      case 'add_line':
        return Promise.resolve({ lineId: 'test-line', lineTotal: null });
      case 'complete_sale':
        return Promise.resolve({ saleId: 'sale-1', total: null, lineCount: 1 });
      case 'complete_sale_scoped':
        return Promise.resolve({ saleId: 'sale-1', total: null, lineCount: 1 });
      // QRIS Auto (agents-3): a charge with a live payload and a settled
      // status answer. Individual tests override the charge case to reach
      // the refusal paths.
      case 'qris_auto_charge_scoped':
        return Promise.resolve({
          orderId: 'ORDER-A1',
          qrString: 'DEVQRIS|ORDER-A1',
          status: 'qr_issued',
          amountMinor: 700,
          currency: 'USD',
          saleId: 'sale-1',
          expiresInSecs: 300,
        });
      case 'qris_auto_status_scoped':
        return Promise.resolve({ orderId: 'ORDER-A1', status: 'settlement', settled: true });
      // EDC card-present (agents-3 3.2): a ready terminal and an approved
      // capture. Individual tests override to reach the decline and the
      // missing-terminal paths.
      case 'edc_terminal_status_scoped':
        return Promise.resolve({ status: 'ready' });
      case 'edc_sale':
        return Promise.resolve({
          success: true,
          transactionId: 'EDC-TXN-1',
          authCode: 'A1B2',
          cardScheme: 'Visa',
          cardLast4: '4242',
          message: 'approved',
        });
      // The screen reads the sale back through get_sale_scoped when a session token exists, and
      // this file's WorkspaceContext mock always provides one, so the scoped command needs the same
      // case as its ambient twin. The comment sits ABOVE both labels: between them it makes the
      // first case non-empty, which `no-fallthrough` reports as an error -- and it shipped that way,
      // because the pre-commit hook runs ten steps and eslint is not one of them.
      case 'get_sale':
      case 'get_sale_scoped':
        return Promise.resolve(null);
      case 'print_sales_receipt_scoped':
        return Promise.resolve({ printed: true });
      case 'hold_cart':
        return Promise.resolve();
      case 'get_enabled_features':
        return Promise.resolve({ features: [] });
      default:
        return Promise.resolve({});
    }
  }),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    activeWorkspace: null,
    sessionToken: 'mock-token',
    swapSessionToken: vi.fn(),
    workspaces: [],
    loading: false,
  }),
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

// The QRIS display is stubbed so the test can drive PaymentModal's confirm
// callback directly — including the poll race where the display reports the
// payment TWICE for one scan, which is the double-settlement shape the
// attempt id must absorb. The real component's internals (QR canvas,
// polling) are not under test here.
vi.mock('@/components/QrisQrDisplay', () => ({
  default: (props: { isOpen: boolean; onPaymentConfirmed: () => void; qrString?: string }) =>
    props.isOpen && props.qrString ? (
      // Auto instance: a single confirmation trigger. The real component's
      // poll/countdown/re-issue behavior is pinned in QrisQrDisplay.test;
      // here we drive the parent's settle/cancel state machine.
      <button type="button" onClick={() => props.onPaymentConfirmed()}>
        qris-auto-confirm
      </button>
    ) : props.isOpen ? (
      <button
        type="button"
        onClick={() => {
          props.onPaymentConfirmed();
          props.onPaymentConfirmed();
        }}
      >
        qris-poll-double-confirm
      </button>
    ) : null,
}));

beforeEach(() => {
  invokeMock.mockClear();
});

describe('PaymentModal — sale flow', () => {
  it('calls printSalesReceipt on complete', async () => {
    await renderWithFluent(
      <PaymentModal
        open
        lineItems={[lineItem()]}
        total={usd(700)}
        userId="test-user-id"
        sessionToken="mock-token"
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const input = screen.getByLabelText(/amount tendered/i);
    await userEvent.type(input, '10');
    await userEvent.click(screen.getByRole('button', { name: /^complete$/i }));

    const printBtn = await screen.findByRole('button', { name: /Print Receipt/i });
    await userEvent.click(printBtn);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('print_sales_receipt_scoped', { sessionToken: 'mock-token', args: expect.any(Object) });
    });
  });

  it('calls onComplete after sale done', async () => {
    const onComplete = vi.fn();
    await renderWithFluent(
      <PaymentModal
        open
        lineItems={[lineItem()]}
        total={usd(700)}
        userId="test-user-id"
        onComplete={onComplete}
        onClose={vi.fn()}
      />,
    );

    const input = screen.getByLabelText(/amount tendered/i);
    await userEvent.type(input, '10');
    await userEvent.click(screen.getByRole('button', { name: /^complete$/i }));

    const printBtn = await screen.findByRole('button', { name: /Print Receipt/i });
    await userEvent.click(printBtn);

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalled();
    }, { timeout: 5000 });
  });

  it('shows change due in done state for cash', async () => {
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
    await userEvent.click(screen.getByRole('button', { name: /^complete$/i }));

    expect(await screen.findByRole('region', { name: /Receipt Preview/i })).toBeInTheDocument();
    expect(await screen.findByText(/CHANGE:/i)).toBeInTheDocument();
    expect(await screen.findByText('$ 3,00')).toBeInTheDocument();
  });

  it('shows sale complete state for card and prints receipt', async () => {
    await renderWithFluent(
      <PaymentModal
        open
        lineItems={[lineItem()]}
        total={usd(700)}
        userId="test-user-id"
        sessionToken="mock-token"
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByLabelText(/Card/));
    expect(screen.getByRole('button', { name: /^complete$/i })).not.toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /^complete$/i }));

    const printBtn = await screen.findByRole('button', { name: /Print Receipt/i });
    await userEvent.click(printBtn);

    expect(invokeMock).toHaveBeenCalledWith('print_sales_receipt_scoped', { sessionToken: 'mock-token', args: expect.any(Object) });
  });
});

// ── Shortfall resolution integration ────────────────────────────────

const defaultInvokeImpl = (cmd: string) => {
  switch (cmd) {
    case 'start_sale':
      return Promise.resolve({ cartId: 'test-cart' });
    case 'add_line':
      return Promise.resolve({ lineId: 'test-line', lineTotal: null });
    case 'complete_sale':
      return Promise.resolve({ saleId: 'sale-1', total: null, lineCount: 1 });
    case 'get_sale':
    case 'get_sale_scoped':
      return Promise.resolve(null);
    case 'print_sales_receipt_scoped':
      return Promise.resolve({ printed: true });
    case 'hold_cart':
      return Promise.resolve();
    case 'get_enabled_features':
      return Promise.resolve({ features: [] });
    default:
      return Promise.resolve({});
  }
};

describe('PaymentModal — shortfall resolution', () => {
  afterEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(defaultInvokeImpl as (cmd: string) => Promise<unknown>);
  });

  it('shows StockShortfallDialog when completeSale fails with PartialStockResult', async () => {
    const shortfallPayload = {
      requiresResolution: true,
      shortfalls: [
        {
          sku: 'COFFEE',
          productName: 'Coffee',
          requestedQty: 5,
          primaryQtyAvailable: 2,
          deficit: 3,
          primaryLocationId: 'main',
          alternatives: [
            { locationId: 'alt-1', locationName: 'Warehouse', qtyAvailable: 10 },
          ],
        },
      ],
    };

    invokeMock.mockImplementation((cmd: string): Promise<unknown> => {
      // The component calls the SCOPED command (ADR #7) — rejecting the
      // legacy unscoped name never fired, leaving this test red since
      // the scoped migration.
      if (cmd === 'complete_sale_scoped') {
        return Promise.reject(
          new Error(JSON.stringify(shortfallPayload)),
        );
      }
      return defaultInvokeImpl(cmd) as Promise<unknown>;
    });

    await renderWithFluent(
      <PaymentModal
        open
        lineItems={[lineItem()]}
        total={usd(700)}
        userId="test-user-id"
        tipMinor={150}
        serviceChargeMinor={70}
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByLabelText(/Card/));
    await userEvent.click(screen.getByRole('button', { name: /^complete$/i }));

    await waitFor(() => {
      expect(screen.getByText('Insufficient Stock')).toBeInTheDocument();
    });
    expect(screen.getByText('#COFFEE')).toBeInTheDocument();
    expect(screen.getByText('Coffee')).toBeInTheDocument();
    expect(screen.getByText('Confirm & Continue')).toBeInTheDocument();
    expect(screen.getByText('Cancel Sale')).toBeInTheDocument();

    // FRONTEND-03 follow-up: the reconstructed lines sent to the second
    // command must carry their own currency so the backend can enforce it
    // instead of silently re-stamping the sale currency.
    // FRONTEND-04: tip/service-charge collected at checkout must survive
    // the shortfall retry — the backend defaults them to 0 when absent.
    await userEvent.click(screen.getByText('Confirm & Continue'));
    await waitFor(() => {
      const calls = invokeMock.mock.calls as unknown as Array<[string, unknown]>;
      const secondCmd = calls.find(
        ([cmd]) => cmd === 'complete_sale_with_resolved_shortfalls_scoped',
      );
      expect(secondCmd).toBeDefined();
      expect(secondCmd?.[1]).toMatchObject({
        args: {
          currency: 'USD',
          lines: [{ sku: 'COFFEE', qty: 2, unitPriceMinor: 350, unitPriceCurrency: 'USD' }],
          tipMinor: 150,
          serviceChargeMinor: 70,
        },
      });
    });
  });

  // ── FRONTEND-04: multi-currency shortfall retry keeps the charge currency ──
  it('settles a shortfall retry in the charge currency with the CUR-02 tender snapshot', async () => {
    const shortfallPayload = {
      requiresResolution: true,
      shortfalls: [
        {
          sku: 'COFFEE',
          productName: 'Coffee',
          requestedQty: 5,
          primaryQtyAvailable: 2,
          deficit: 3,
          primaryLocationId: 'main',
          alternatives: [
            { locationId: 'alt-1', locationName: 'Warehouse', qtyAvailable: 10 },
          ],
        },
      ],
    };

    invokeMock.mockImplementation((cmd: string): Promise<unknown> => {
      if (cmd === 'get_enabled_features') {
        return Promise.resolve({ features: ['multi-currency'] });
      }
      if (cmd === 'list_currencies' || cmd === 'list_currencies_scoped') {
        return Promise.resolve([
          { code: 'USD', name: 'US Dollar', minor_exponent: 2, symbol: '$' },
          { code: 'IDR', name: 'Indonesian Rupiah', minor_exponent: 0, symbol: 'Rp' },
        ]);
      }
      if (cmd === 'list_exchange_rates' || cmd === 'list_exchange_rates_scoped' || cmd === 'list_latest_exchange_rates_scoped') {
        return Promise.resolve([]);
      }
      if (cmd === 'get_default_currency' || cmd === 'get_default_currency_scoped') {
        return Promise.resolve('USD');
      }
      if (cmd === 'get_latest_exchange_rate_scoped') {
        // 16500 USD→IDR in fixed-point millionths.
        return Promise.resolve({ rate_millionths: 16_500_000_000 });
      }
      if (cmd === 'complete_sale_scoped') {
        // sessionToken prop is set below → the modal settles via the
        // scoped command; reject it with the PartialStockResult payload.
        return Promise.reject(new Error(JSON.stringify(shortfallPayload)));
      }
      return defaultInvokeImpl(cmd) as Promise<unknown>;
    });

    await renderWithFluent(
      <PaymentModal
        open
        sessionToken="mock-token"
        lineItems={[lineItem()]}
        total={usd(700)}
        userId="test-user-id"
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText('Select charge currency'), 'IDR');
    await userEvent.click(screen.getByLabelText(/Card/));
    await userEvent.click(screen.getByRole('button', { name: /^complete$/i }));

    await waitFor(() => {
      expect(screen.getByText('Insufficient Stock')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText('Confirm & Continue'));

    // The first command settled in IDR (charge currency); the retry must
    // settle in the SAME currency with the SAME converted lines, plus the
    // CUR-02 snapshot (base currency/total/rate) — not silently fall back
    // to USD base amounts. IDR exponent is 0: 350¢ × 16500 = 57750 IDR.
    await waitFor(() => {
      const calls = invokeMock.mock.calls as unknown as Array<[string, unknown]>;
      const secondCmd = calls.find(
        ([cmd]) => cmd === 'complete_sale_with_resolved_shortfalls_scoped',
      );
      expect(secondCmd).toBeDefined();
      expect(secondCmd?.[1]).toMatchObject({
        args: {
          currency: 'IDR',
          totalMinor: 115500,
          lines: [{ sku: 'COFFEE', qty: 2, unitPriceMinor: 57750, unitPriceCurrency: 'IDR' }],
          baseCurrency: 'USD',
          baseTotalMinor: 700,
          tenderRateMillionths: 16_500_000_000,
        },
      });
    });
  });

  // ── FRONTEND-03: line currency crosses the IPC boundary ──────────
  it('sends the line currency on add_line so the backend can enforce it', async () => {    await renderWithFluent(
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
    await userEvent.click(screen.getByRole('button', { name: /^complete$/i }));

    await waitFor(() => {
      // The modal adds lines via add_line (or add_line_scoped when a
      // session token is present); assert on the payload shape, which is
      // identical for both commands.
      const calls = invokeMock.mock.calls as unknown as Array<[string, unknown]>;
      const addLineCall = calls.find(
        ([cmd]) => cmd === 'add_line' || cmd === 'add_line_scoped',
      );
      expect(addLineCall).toBeDefined();
      expect(addLineCall?.[1]).toMatchObject({
        args: { sku: 'COFFEE', qty: 2, unitPriceMinor: 350, unitPriceCurrency: 'USD' },
      });
    });
  });

  // ── Checkout attempt id (COR-7 replay guard) ───────────────────────────
  //
  // The id is minted per checkout ATTEMPT, not per mount: the sales host
  // keeps PaymentModal mounted and toggles `open` between customers, and
  // the early `return null` on !open is a render short-circuit — not an
  // unmount — so a mount-scoped id would leak across sales and the backend
  // would replay the previous basket's receipt for a different basket.
  // Every submission of a single attempt reuses its id (the dialog-level
  // tests cover the retry), while each fresh open mints a new one.

  describe('checkout attempt id', () => {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

    const attemptIds = () =>
      (invokeMock.mock.calls as unknown[][])
        .filter((c) => c[0] === 'complete_sale_scoped')
        .map((c) => (c[1] as { args?: { attemptId?: string } } | undefined)?.args?.attemptId);

    const completeCartIds = () =>
      (invokeMock.mock.calls as unknown[][])
        .filter((c) => c[0] === 'complete_sale_scoped')
        .map((c) => (c[1] as { args?: { cartId?: string } } | undefined)?.args?.cartId);

    const mount = () =>
      renderInAct(
        withFluent(
          <ToastProvider>
            <PaymentModal
              open
              lineItems={[lineItem()]}
              total={usd(700)}
              userId="test-user-id"
              onComplete={vi.fn()}
              onClose={vi.fn()}
            />
          </ToastProvider>,
          salesFtl,
        ),
      );

    const completeOnce = async () => {
      await userEvent.type(screen.getByLabelText(/amount tendered/i), '10');
      await userEvent.click(screen.getByRole('button', { name: /^complete$/i }));
      await waitFor(() => expect(attemptIds().length).toBeGreaterThan(0));
    };

    it('sends a UUID attempt id with the completion request', async () => {
      await mount();
      await completeOnce();

      expect(attemptIds()[0]).toMatch(UUID_RE);
    });

    it('mints a fresh attempt id on a new mount so the next sale is not blocked', async () => {
      const first = await mount();
      await completeOnce();
      const firstId = attemptIds()[0];
      first.unmount();
      invokeMock.mockClear();

      const second = await mount();
      await completeOnce();
      const secondId = attemptIds()[0];
      second.unmount();

      expect(firstId).toMatch(UUID_RE);
      expect(secondId).toMatch(UUID_RE);
      expect(secondId).not.toBe(firstId);
    });

    it('re-mints the attempt id when the same mount reopens onto a different basket', async () => {
      // The money-bug shape: the sales host keeps this component mounted and
      // toggles `open` between customers, so Cancel → re-open lands on the
      // SAME instance. The attempt id must be re-minted by the open reset,
      // or the second basket's completion replays the first basket's key.
      const base = defaultInvokeImpl as (cmd: string) => Promise<unknown>;
      let cartSeq = 0;
      invokeMock.mockImplementation((cmd: string): Promise<unknown> => {
        if (cmd === 'start_sale_scoped' || cmd === 'start_sale') {
          cartSeq += 1;
          return Promise.resolve({ cartId: `cart-${cartSeq}` });
        }
        return base(cmd);
      });
      try {
        const view = await mount();
        await completeOnce();
        const firstId = attemptIds()[0];
        const firstCart = completeCartIds()[0];

        view.rerender(
          withFluent(
            <ToastProvider>
              <PaymentModal
                open={false}
                lineItems={[lineItem()]}
                total={usd(700)}
                userId="test-user-id"
                onComplete={vi.fn()}
                onClose={vi.fn()}
              />
            </ToastProvider>,
            salesFtl,
          ),
        );
        view.rerender(
          withFluent(
            <ToastProvider>
              <PaymentModal
                open
                lineItems={[lineItem({ id: 'line-2' as LineId, qty: 3 })]}
                total={usd(900)}
                userId="test-user-id"
                onComplete={vi.fn()}
                onClose={vi.fn()}
              />
            </ToastProvider>,
            salesFtl,
          ),
        );
        await completeOnce();
        await waitFor(() => expect(attemptIds().length).toBe(2));

        const secondId = attemptIds()[1];
        const secondCart = completeCartIds()[1];

        expect(firstId).toMatch(UUID_RE);
        expect(secondId).toMatch(UUID_RE);
        expect(secondId).not.toBe(firstId);
        // Two distinct baskets genuinely reached the backend, so the fresh
        // attempt id is guarding a different sale, not the old one.
        expect(firstCart).toBe('cart-1');
        expect(secondCart).toBe('cart-2');
      } finally {
        invokeMock.mockImplementation(base);
      }
    });
  });
});


// ── taxEstimated claim (F2-6) ────────────────────────────────────────
//
// The claim must reach complete_sale_scoped ONLY when the caller flags
// the displayed tax as an estimate; absent (fresh tax) means the payload
// carries no claim at all — core stamps nothing.

describe('PaymentModal — taxEstimated claim', () => {
  beforeEach(() => {
    invokeMock.mockImplementation(
      (cmd: string) => defaultInvokeImpl(cmd) as unknown as Promise<unknown>,
    );
  });

  afterEach(() => {
    invokeMock.mockReset();
  });

  const completeArgs = () =>
    (invokeMock.mock.calls as unknown[][])
      .filter((c) => c[0] === 'complete_sale_scoped')      .map((c) => (c[1] as { args?: Record<string, unknown> } | undefined)?.args);

  const mount = (overrides: Partial<React.ComponentProps<typeof PaymentModal>> = {}) =>
    renderInAct(
      withFluent(
        <ToastProvider>
          <PaymentModal
            open
            lineItems={[lineItem()]}
            total={usd(700)}
            userId="test-user-id"
            onComplete={vi.fn()}
            onClose={vi.fn()}
            {...overrides}
          />
        </ToastProvider>,
        salesFtl,
      ),
    );

  const completeOnce = async () => {
    await userEvent.type(screen.getByLabelText(/amount tendered/i), '10');
    await userEvent.click(screen.getByRole('button', { name: /^complete$/i }));
    await waitFor(() => expect(completeArgs().length).toBeGreaterThan(0));
  };

  it('sends taxEstimated: true when the cart estimate was flagged', async () => {
    const view = await mount({ taxEstimated: true });
    await completeOnce();
    view.unmount();

    expect(completeArgs()[0]).toMatchObject({ taxEstimated: true });
  });

  it('omits the claim entirely when the tax was freshly computed (default)', async () => {
    const view = await mount();
    await completeOnce();
    view.unmount();

    expect(completeArgs()[0]).not.toHaveProperty('taxEstimated');
  });
});

// ── QRIS attempt id (COR-7 on the scan-and-wait path) ────────────────
//
// The QRIS confirm callback can legally fire MORE than once for one QR (a
// poll that returns pending and then succeeds twice), so every firing must
// carry the SAME attempt id — the backend then replays the first receipt
// instead of ringing a second sale. A new attempt (close + reopen, which
// re-mints in the open-reset effect) must carry a different one.

describe('PaymentModal — QRIS attempt id', () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  const qrisAttemptIds = () =>
    (invokeMock.mock.calls as unknown[][])
      .filter((c) => c[0] === 'complete_sale_scoped')
      .map((c) => (c[1] as { args?: { attemptId?: string } } | undefined)?.args?.attemptId);

  const mount = () =>
    renderInAct(
      withFluent(
        <ToastProvider>
          <PaymentModal
            open
            lineItems={[lineItem()]}
            total={usd(700)}
            userId="test-user-id"
            onComplete={vi.fn()}
            onClose={vi.fn()}
          />
        </ToastProvider>,
        salesFtl,
      ),
    );

  // One attempt: select the QRIS tender, generate the QR, then the display's
  // poll fires the confirm callback TWICE for the single scan. `previous` is
  // how many complete calls earlier attempts already produced.
  const openQrAndDoubleConfirm = async (previous = 0) => {
    await userEvent.click(await screen.findByRole('radio', { name: /qris/i }));
    await userEvent.click(
      await screen.findByRole('button', { name: /pay with qr|payment-qris-pay/i }),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: /qris-poll-double-confirm/i }),
    );
    await waitFor(() => expect(qrisAttemptIds().length).toBe(previous + 2));
  };

  it('sends the SAME attempt id when the QRIS poll confirms twice for one scan', async () => {
    await mount();
    await openQrAndDoubleConfirm();

    const [first, second] = qrisAttemptIds();
    expect(first).toMatch(UUID_RE);
    expect(second).toBe(first);
  });

  it('mints a different attempt id for the next QRIS attempt', async () => {
    const view = await mount();
    await openQrAndDoubleConfirm();
    const firstAttempt = qrisAttemptIds()[0];

    view.rerender(
      withFluent(
        <ToastProvider>
          <PaymentModal
            open={false}
            lineItems={[lineItem()]}
            total={usd(700)}
            userId="test-user-id"
            onComplete={vi.fn()}
            onClose={vi.fn()}
          />
        </ToastProvider>,
        salesFtl,
      ),
    );
    view.rerender(
      withFluent(
        <ToastProvider>
          <PaymentModal
            open
            lineItems={[lineItem({ id: 'line-2' as LineId, qty: 3 })]}
            total={usd(900)}
            userId="test-user-id"
            onComplete={vi.fn()}
            onClose={vi.fn()}
          />
        </ToastProvider>,
        salesFtl,
      ),
    );
    await openQrAndDoubleConfirm(2);

    const ids = qrisAttemptIds();
    expect(ids.length).toBe(4);
    expect(ids[2]).toBe(ids[3]);
    expect(ids[2]).toMatch(UUID_RE);
    expect(ids[2]).not.toBe(firstAttempt);
  });
});

// ── QRIS Auto tender (agents-3) ──────────────────────────────────────
//
// The whole point of the auto flow is ORDERING: the sale completes as
// 'pending' FIRST (so the cloud charge can bind to the real sale id and
// the settlement webhook's queued finalize_sale addresses a sale the
// device actually has), the charge rides the attempt id as its
// idempotency key, and finalization only happens on the settled signal.
describe('PaymentModal — QRIS Auto tender', () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  const mount = () =>
    renderInAct(
      withFluent(
        <ToastProvider>
          <PaymentModal
            open
            sessionToken="mock-token"
            lineItems={[lineItem()]}
            total={usd(700)}
            userId="test-user-id"
            onComplete={vi.fn()}
            onClose={vi.fn()}
          />
        </ToastProvider>,
        salesFtl,
      ),
    );

  const callsOf = (cmd: string) =>
    (invokeMock.mock.calls as unknown[][]).filter((c) => c[0] === cmd);

  // Payload of the n-th recorded call for a command (optional-chained for
  // strict index access; callers cast at the use site).
  const payloadOf = (cmd: string, n = 0): unknown =>
    (callsOf(cmd)[n] as unknown[] | undefined)?.[1];

  const openDynamic = async () => {
    await userEvent.click(await screen.findByRole('radio', { name: /qris/i }));
    const dynBtn = await screen.findByRole('button', { name: /pay with dynamic qr/i });
    await userEvent.click(dynBtn);
    await waitFor(() => expect(callsOf('qris_auto_charge_scoped')).toHaveLength(1));
  };

  it('completes the sale pending, then charges against the real sale id', async () => {
    const view = await mount();
    await openDynamic();

    const complete = payloadOf('complete_sale_scoped') as {
      args: { paymentSplits: Array<{ gatewayStatus: string }>; attemptId?: string };
    };
    expect(complete.args.paymentSplits[0]?.gatewayStatus).toBe('pending');
    // The cloud ledger binds order -> sale_id -> queued finalize_sale;
    // the sale id it was created for is the one from THIS completion.
    const charge = payloadOf('qris_auto_charge_scoped') as {
      args: { saleId: string; amountMinor: number; idempotencyKey: string };
    };
    expect(charge.args.saleId).toBe('sale-1');
    expect(charge.args.amountMinor).toBe(700);
    // PAY-2: the first issue re-uses the checkout attempt id as the
    // idempotency key, so a retry after a lost response cannot mint a
    // second live charge.
    expect(charge.args.idempotencyKey).toMatch(UUID_RE);
    expect(charge.args.idempotencyKey).toBe(complete.args.attemptId);

    // Settlement observed -> finalize the pending sale exactly once.
    await userEvent.click(await screen.findByRole('button', { name: /qris-auto-confirm/i }));
    await waitFor(() => expect(callsOf('finalize_sale')).toHaveLength(1));
    expect((payloadOf('finalize_sale') as { saleId: string }).saleId).toBe('sale-1');
    // No second completion for the settlement — same one checkout.
    expect(callsOf('complete_sale_scoped')).toHaveLength(1);
    view.unmount();
  });

  it('voids the pending sale when the gateway refuses the charge', async () => {
    const original = (invokeMock.getMockImplementation() ??
      (() => Promise.resolve({}))) as (cmd: string) => Promise<unknown>;
    invokeMock.mockImplementation((cmd: string) =>
      cmd === 'qris_auto_charge_scoped'
        ? Promise.reject({ kind: 'internal', message: 'MIDTRANS_SERVER_KEY not configured' })
        : original(cmd),
    );
    try {
      const view = await mount();
      await userEvent.click(await screen.findByRole('radio', { name: /qris/i }));
      await userEvent.click(
        await screen.findByRole('button', { name: /pay with dynamic qr/i }),
      );
      // The completion happened; the charge did not — the pending sale
      // must not linger (nothing was ever captured at the gateway).
      await waitFor(() => expect(callsOf('void_pending_sale')).toHaveLength(1));
      expect((payloadOf('void_pending_sale') as { saleId: string }).saleId).toBe('sale-1');
      expect(callsOf('finalize_sale')).toHaveLength(0);
      view.unmount();
    } finally {
      invokeMock.mockImplementation(original);
    }
  });
});

// ── EDC card-present tender (agents-3 3.2) ───────────────────────────
//
// The ordering is the mirror of QRIS Auto: CAPTURE FIRST. The terminal
// needs no sale_id, so a declined or failed capture completes nothing;
// only an approved capture builds the sale, and it finalizes with the
// never-void rule (money exists at the terminal — a local fault parks
// the sale pending for reconciliation, it must not void a paid sale).
describe('PaymentModal — EDC card-present tender', () => {
  const mount = () =>
    renderInAct(
      withFluent(
        <ToastProvider>
          <PaymentModal
            open
            sessionToken="mock-token"
            lineItems={[lineItem()]}
            total={usd(700)}
            userId="test-user-id"
            onComplete={vi.fn()}
            onClose={vi.fn()}
          />
        </ToastProvider>,
        salesFtl,
      ),
    );

  const callsOf = (cmd: string) =>
    (invokeMock.mock.calls as unknown[][]).filter((c) => c[0] === cmd);

  const payloadOf = (cmd: string, n = 0): unknown =>
    (callsOf(cmd)[n] as unknown[] | undefined)?.[1];

  const clickTerminalPay = async () => {
    await userEvent.click(await screen.findByRole('radio', { name: /card/i }));
    await userEvent.click(
      await screen.findByRole('button', { name: /pay on card terminal/i }),
    );
  };

  // Runs one test with a single command's implementation replaced.
  const overrideInvoke = (
    cmd: string,
    impl: () => Promise<unknown>,
    body: () => Promise<void>,
  ) => {
    const original = (invokeMock.getMockImplementation() ??
      (() => Promise.resolve({}))) as (c: string) => Promise<unknown>;
    invokeMock.mockImplementation((c: string) => (c === cmd ? impl() : original(c)));
    return body().finally(() => invokeMock.mockImplementation(original));
  };

  it('captures on the terminal, then completes a CARD sale with the transaction fields', async () => {
    const view = await mount();
    await clickTerminalPay();

    // Pre-flight ran BEFORE any hardware ask, and the capture carried the
    // amount in the currency's minor units.
    await waitFor(() => expect(callsOf('edc_terminal_status_scoped')).toHaveLength(1));
    expect(
      (payloadOf('edc_terminal_status_scoped') as { sessionToken: string }).sessionToken,
    ).toBe('mock-token');
    await waitFor(() => expect(callsOf('edc_sale')).toHaveLength(1));
    const sale = payloadOf('edc_sale') as {
      sessionToken: string;
      amountMinor: number;
      currency: string;
    };
    expect(sale.amountMinor).toBe(700);
    expect(sale.currency).toBe('USD');

    // The completion is a CARD tender carrying the terminal's answer.
    const complete = payloadOf('complete_sale_scoped') as {
      args: {
        paymentMethod: string;
        paymentSplits: Array<{
          method: string;
          gatewayReference: string;
          gatewayStatus: string;
          gatewayResponse: string;
        }>;
      };
    };
    expect(complete.args.paymentMethod).toBe('CARD');
    expect(complete.args.paymentSplits[0]?.method).toBe('CARD');
    expect(complete.args.paymentSplits[0]?.gatewayReference).toBe('EDC-TXN-1');
    expect(complete.args.paymentSplits[0]?.gatewayStatus).toBe('captured');
    const parsed = JSON.parse(complete.args.paymentSplits[0]?.gatewayResponse ?? '{}') as {
      card_last4?: string;
      auth_code?: string;
    };
    expect(parsed.card_last4).toBe('4242');
    expect(parsed.auth_code).toBe('A1B2');

    await waitFor(() => expect(callsOf('finalize_sale')).toHaveLength(1));
    // Captured money is never voided by this flow.
    expect(callsOf('void_pending_sale')).toHaveLength(0);
    view.unmount();
  });

  it('a declined capture returns to tender selection with the terminal reason and completes nothing', async () => {
    const view = await mount();
    await overrideInvoke(
      'edc_sale',
      () =>
        Promise.resolve({
          success: false,
          transactionId: null,
          authCode: null,
          cardScheme: null,
          cardLast4: null,
          message: 'insufficient funds',
        }),
      async () => {
        await clickTerminalPay();
        await waitFor(() =>
          expect(screen.getByRole('alert')).toHaveTextContent(/insufficient funds/i),
        );
        expect(callsOf('complete_sale_scoped')).toHaveLength(0);
        expect(callsOf('void_pending_sale')).toHaveLength(0);
        // Dismiss returns to the tender UI.
        await userEvent.click(
          await screen.findByRole('button', { name: /back to payment/i }),
        );
        expect(screen.queryByRole('alert')).toBeNull();
      },
    );
    view.unmount();
  });

  it('a failed pre-flight (no terminal registered, or the tablet without edc commands) never touches hardware or the ledger', async () => {
    const view = await mount();
    await overrideInvoke(
      'edc_terminal_status_scoped',
      () => Promise.reject({ kind: 'unknown', message: 'command not found' }),
      async () => {
        await clickTerminalPay();
        await waitFor(() =>
          expect(screen.getByText(/Card payment failed/i)).toBeInTheDocument(),
        );
        expect(callsOf('edc_sale')).toHaveLength(0);
        expect(callsOf('complete_sale_scoped')).toHaveLength(0);
        expect(screen.queryByRole('status')).toBeNull();
      },
    );
    view.unmount();
  });

  it('a not-ready terminal answer preflights into a reason toast, no capture', async () => {
    const view = await mount();
    await overrideInvoke(
      'edc_terminal_status_scoped',
      () => Promise.resolve({ status: 'paperError' }),
      async () => {
        await clickTerminalPay();
        await waitFor(() =>
          expect(screen.getByText(/not ready/i)).toBeInTheDocument(),
        );
        expect(callsOf('edc_sale')).toHaveLength(0);
        expect(callsOf('complete_sale_scoped')).toHaveLength(0);
      },
    );
    view.unmount();
  });

  // W4-d (CardTenderPanel): the panel's own `terminalPending` operand. The
  // three guards on the pay button are NOT one condition -- `processing` is
  // false the moment the capture answer lands, so what keeps the button dark
  // over a DECLINED exchange is `edc !== null` alone. Drop that operand and
  // the second assertion below fails: a cashier could tap a fresh capture onto
  // the terminal while still reading the decline. The dismiss end is asserted
  // too, so the guard cannot be satisfied by leaving it dark forever.
  it('a declined terminal answer keeps the pay button disabled until it is dismissed', async () => {
    const view = await mount();
    await overrideInvoke(
      'edc_sale',
      () =>
        Promise.resolve({
          success: false,
          transactionId: null,
          authCode: null,
          cardScheme: null,
          cardLast4: null,
          message: 'insufficient funds',
        }),
      async () => {
        await clickTerminalPay();
        const dismiss = await screen.findByRole('button', { name: /back to payment/i });
        await waitFor(() =>
          expect(
            screen.getByRole('button', { name: /pay on card terminal/i }),
          ).toBeDisabled(),
        );
        await userEvent.click(dismiss);
        await waitFor(() =>
          expect(
            screen.getByRole('button', { name: /pay on card terminal/i }),
          ).not.toBeDisabled(),
        );
      },
    );
    view.unmount();
  });
});

// ── Local payment rails gating (agents-5 R1) ─────────────────────────
//
// The regional slice-6 rail store is the real per-site surface for QRIS
// visibility (the master doc's payment:* keys never shipped). The
// contract under test: a POPULATED rail list is authoritative (the
// qris rail's is_enabled governs the tab); no list, an empty list, or
// any fetch failure fails open — legacy tills and every existing test
// keep QRIS exactly as before.
describe('PaymentModal — local payment rails gating', () => {
  const mount = () =>
    renderInAct(
      withFluent(
        <ToastProvider>
          <PaymentModal
            open
            sessionToken="mock-token"
            lineItems={[lineItem()]}
            total={usd(700)}
            userId="test-user-id"
            onComplete={vi.fn()}
            onClose={vi.fn()}
          />
        </ToastProvider>,
        salesFtl,
      ),
    );

  const rail = (enabled: boolean) => ({
    rail_code: 'qris',
    label: 'QRIS',
    is_enabled: enabled,
    scope: 'location' as const,
    parameters: '{}',
  });

  // The rails fetch fires on MOUNT, so the override must be installed
  // before `mount()` — returning a restore that unwinds it.
  const mountWithRails = async (rails: unknown[] | 'reject') => {
    const original = (invokeMock.getMockImplementation() ??
      (() => Promise.resolve({}))) as (c: string) => Promise<unknown>;
    invokeMock.mockImplementation((c: string) => {
      if (c === 'get_primary_location_scoped') return Promise.resolve({ id: 'loc-1' });
      if (c === 'get_local_payment_methods_scoped') {
        return rails === 'reject'
          ? Promise.reject(new Error('ipc down'))
          : Promise.resolve(rails);
      }
      return original(c);
    });
    const view = await mount();
    return { view, restore: () => invokeMock.mockImplementation(original) };
  };

  it('a disabled qris rail removes the QRIS tab', async () => {
    const { view, restore } = await mountWithRails([rail(false)]);
    try {
      await waitFor(() =>
        expect(screen.queryByRole('radio', { name: /qris/i })).toBeNull(),
      );
      // Cash stays: universal tender, never a market rail.
      expect(screen.getByRole('radio', { name: /cash/i })).toBeInTheDocument();
    } finally {
      restore();
      view.unmount();
    }
  });

  it('an enabled qris rail keeps the tab', async () => {
    const { view, restore } = await mountWithRails([rail(true)]);
    try {
      await waitFor(() =>
        expect(screen.getByRole('radio', { name: /qris/i })).toBeInTheDocument(),
      );
    } finally {
      restore();
      view.unmount();
    }
  });

  it('a populated list WITHOUT the qris rail hides it (authoritative list)', async () => {
    const { view, restore } = await mountWithRails([
      { rail_code: 'va-bca', label: 'BCA VA', is_enabled: true, scope: 'location', parameters: '{}' },
    ]);
    try {
      await waitFor(() =>
        expect(screen.queryByRole('radio', { name: /qris/i })).toBeNull(),
      );
    } finally {
      restore();
      view.unmount();
    }
  });

  it('empty rails and failed fetches both fail open', async () => {
    const empty = await mountWithRails([]);
    try {
      await waitFor(() =>
        expect(screen.getByRole('radio', { name: /qris/i })).toBeInTheDocument(),
      );
    } finally {
      empty.restore();
      empty.view.unmount();
    }
    const failed = await mountWithRails('reject');
    try {
      await waitFor(() =>
        expect(screen.getByRole('radio', { name: /qris/i })).toBeInTheDocument(),
      );
    } finally {
      failed.restore();
      failed.view.unmount();
    }
  });

  it('a list without the edc rail hides the terminal button but keeps manual card', async () => {
    const { view, restore } = await mountWithRails([rail(true)]);
    try {
      await waitFor(() =>
        expect(screen.getByRole('radio', { name: /qris/i })).toBeInTheDocument(),
      );
      await userEvent.click(await screen.findByRole('radio', { name: /card/i }));
      expect(
        screen.queryByRole('button', { name: /pay on card terminal/i }),
      ).toBeNull();
      // The card tender itself is universal — only the hardware path gates.
      expect(screen.getByRole('radio', { name: /card/i })).toBeChecked();
    } finally {
      restore();
      view.unmount();
    }
  });

  it('a configured static payload reaches the QR display (R2 handoff)', async () => {
    // This file MOCKS QrisQrDisplay — its stub branches on `qrString`,
    // which makes the handoff observable without the real component
    // (real-QR rendering is pinned in QrisQrDisplay.test). A configured
    // payload must arrive on the manual dialog's props; none must not.
    const payload = '00020101021226580012ID.CO.QRIS.WWW5204581253033605802ID6304ABCD';
    const { view, restore } = await mountWithRails([
      {
        rail_code: 'qris',
        label: 'QRIS',
        is_enabled: true,
        scope: 'location',
        parameters: JSON.stringify({ static_qr_payload: payload }),
      },
    ]);
    try {
      await userEvent.click(await screen.findByRole('radio', { name: /qris/i }));
      await userEvent.click(await screen.findByRole('button', { name: /pay with qr/i }));
      // The stub's qrString branch renders this trigger:
      await screen.findByRole('button', { name: /qris-auto-confirm/i });
    } finally {
      restore();
      view.unmount();
    }
    // Without a payload the same flow gets no qrString prop.
    const plain = await mountWithRails([rail(true)]);
    try {
      await userEvent.click(await screen.findByRole('radio', { name: /qris/i }));
      await userEvent.click(await screen.findByRole('button', { name: /pay with qr/i }));
      await screen.findByRole('button', { name: /qris-poll-double-confirm/i });
    } finally {
      plain.restore();
      plain.view.unmount();
    }
  });

  it('payload helpers: read tolerates junk, write preserves siblings and stays honest on malformed bags', async () => {
    const { readStaticQrPayload, writeStaticQrPayload } = await import('@/api/local-payment');
    expect(readStaticQrPayload('{}')).toBeNull();
    expect(readStaticQrPayload('not json')).toBeNull();
    expect(readStaticQrPayload('[1,2]')).toBeNull();
    expect(readStaticQrPayload(JSON.stringify({ static_qr_payload: 'X' }))).toBe('X');
    // Write preserves other metadata keys...
    const bag = writeStaticQrPayload(JSON.stringify({ banner: 'hello' }), 'PAY');
    expect(JSON.parse(bag)).toEqual({ banner: 'hello', static_qr_payload: 'PAY' });
    // ...removes on empty...
    expect(JSON.parse(writeStaticQrPayload(bag, ''))).toEqual({ banner: 'hello' });
    // ...and refuses to launder a malformed bag into fresh JSON.
    expect(writeStaticQrPayload('{oops', 'PAY')).toBe('{oops');
  });

  // ── PINNED tender list ───────────────────────────────────────────
  //
  // These four cases pin TODAY'S rendered tender list, not new behaviour:
  // each asserts the exact ordered set of `payment-method` radios the
  // operator sees for one named rail configuration, read from the DOM in
  // document order. They exist as the equivalence harness for the
  // `visibleMethods` derivation (todo-payment.md :315) that replaces the
  // hardcoded literal at PaymentModal.tsx:1501. If any of them changes
  // when the literal is replaced, the derivation and what rendered before
  // disagree — that is a product ruling, not a refactor.
  //
  // `other` and `open_bill` are asserted too even though they are fixed
  // markup outside the literal: they are part of what the operator sees,
  // and a derivation that grew to cover the whole group has to keep them
  // in this position.
  const renderedTenders = async (rails: unknown[] | 'reject'): Promise<string[]> => {
    const { view, restore } = await mountWithRails(rails);
    try {
      // The rails fetch resolves on mount; wait for a rail-gated outcome
      // before reading the list so the read is post-settle, not mid-fetch.
      await waitFor(() =>
        expect(view.container.querySelector('input[name="payment-method"]')).not.toBeNull(),
      );
      return Array.from(
        view.container.querySelectorAll<HTMLInputElement>('input[name="payment-method"]'),
      ).map((input) => input.value);
    } finally {
      restore();
      view.unmount();
    }
  };

  const ALL_TENDERS = ['cash', 'card', 'qris', 'credit', 'other', 'open_bill'];

  it('PINNED: every rail offered renders cash, card, qris, credit, other, open bill', async () => {
    expect(
      await renderedTenders([
        rail(true),
        { rail_code: 'edc', label: 'EDC', is_enabled: true, scope: 'location', parameters: '{}' },
      ]),
    ).toEqual(ALL_TENDERS);
  });

  it('PINNED: an edc-withheld site renders the SAME tender list (the rail gates the terminal button, not the card tab)', async () => {
    const edcWithheld = [
      rail(true),
      { rail_code: 'edc', label: 'EDC', is_enabled: false, scope: 'location', parameters: '{}' },
    ];
    // Same ordered set as the all-rails-on configuration above.
    expect(await renderedTenders(edcWithheld)).toEqual(ALL_TENDERS);
    // ...and the difference the rail DOES make lives inside the card panel:
    // no pay-on-terminal button, manual card still selectable.
    const { view, restore } = await mountWithRails(edcWithheld);
    try {
      await userEvent.click(await screen.findByRole('radio', { name: /card/i }));
      expect(screen.queryByRole('button', { name: /pay on card terminal/i })).toBeNull();
      expect(screen.getByRole('radio', { name: /card/i })).toBeChecked();
    } finally {
      restore();
      view.unmount();
    }
  });

  it('PINNED: a disabled qris rail drops qris from the middle of the list, in place', async () => {
    expect(await renderedTenders([rail(false)])).toEqual([
      'cash',
      'card',
      'credit',
      'other',
      'open_bill',
    ]);
  });

  it('PINNED: an empty rail list fails open to the full tender list', async () => {
    expect(await renderedTenders([])).toEqual(ALL_TENDERS);
  });

  // ── PINNED label TEXT ─────────────────────────────────────────────────
  //
  // The four cases above read `input.value`, so none of them can see what a
  // tab is CALLED. That gap was the one fragile place in the derivation: the
  // strip rendered its name through a nested ternary whose ELSE-BRANCH was
  // `payment-method-credit`, so a 5th TENDER_RAILS row (`ewallet`) would have
  // compiled clean, kept every value list above matching, and handed the
  // cashier a tab labelled Credit that tendered an e-wallet (Correctness
  // review of 994c0e364, PaymentModal.tsx:1516). This case is the runtime net
  // under the compile-time one (`PAYMENT_METHOD_MESSAGE_IDS` is total over the
  // union): each row is paired with the text the cashier actually reads, so a
  // new tab -- or a new tab borrowing an existing name -- goes red here too.
  it('PINNED: every tender tab renders its own label text, in order', async () => {
    const { view, restore } = await mountWithRails([
      rail(true),
      { rail_code: 'edc', label: 'EDC', is_enabled: true, scope: 'location', parameters: '{}' },
    ]);
    const labelOf: string[] = [];
    try {
      // Post-settle read, same discipline as renderedTenders(): wait for a
      // rail-gated tab to exist before naming the list.
      await waitFor(() =>
        expect(screen.getByRole('radio', { name: /qris/i })).toBeInTheDocument(),
      );
      const inputs = Array.from(
        view.container.querySelectorAll<HTMLInputElement>('input[name="payment-method"]'),
      );
      for (const input of inputs) {
        const row = input.closest('label, div.payment-method-label');
        // What the cashier reads for this row: its label span, or -- for the
        // free-text `other` row, which has no span -- the placeholder the
        // Localized wrapper resolves onto its text input.
        const name = row?.querySelector('.payment-method-name')?.textContent?.trim() ||
          (row?.querySelector<HTMLInputElement>('.payment-other-input'))?.placeholder ||
          '';
        labelOf.push(input.value + ': ' + name);
      }
    } finally {
      restore();
      view.unmount();
    }

    expect(labelOf).toEqual([
      'cash: Cash',
      'card: Card',
      'qris: QRIS',
      'credit: Credit',
      'other: Other...',
      'open_bill: Open Bill',
    ]);
  });

  // ── The checked-tender signal, row by row ─────────────────────────────
  //
  // PaymentModal.css:184 styles the selected tender through an ADJACENT-
  // SIBLING rule - `input[type="radio"]:checked + .payment-method-name` - so a
  // row is only treated when the element right after its radio carries that
  // class. The case above reads each row's NAME; nobody read whether the name
  // is in the position the rule can reach, and the free-text Other row was not
  // (:1575-1595 - radio, then the .payment-other-input, no treated name), so
  // selecting Other left the one checked row on screen with neither the accent
  // nor the semibold every other tender gets. Reviewer's repro: type Voucher
  // in Other and look.
  it('PINNED: every tender row, Other included, has a .payment-method-name in the position the :checked rule reaches', async () => {
    const { view, restore } = await mountWithRails([rail(true)]);
    try {
      await waitFor(() =>
        expect(screen.getByRole('radio', { name: /qris/i })).toBeInTheDocument(),
      );
      const radios = Array.from(
        view.container.querySelectorAll<HTMLInputElement>('input[name="payment-method"]'),
      );
      expect(radios.map((r) => r.value)).toEqual(['cash', 'card', 'qris', 'credit', 'other', 'open_bill']);

      // The structural precondition of the CSS rule, per row. `+` needs the
      // classed element to be the radio's own next sibling, so this fails for a
      // row that names itself anywhere else in the row - and for Other, which
      // named itself only through an input placeholder.
      for (const radio of radios) {
        const next = radio.nextElementSibling;
        expect(
          next?.classList.contains('payment-method-name'),
          `tender ${radio.value}: its radio's next sibling must carry .payment-method-name or :checked cannot reach it`,
        ).toBe(true);
      }

      // Now the repro itself: select Other, type a tender name, and require the
      // element the rule treats to be the live one showing what was typed.
      const other = radios.find((r) => r.value === 'other')!;
      await userEvent.click(other);
      const name = other.nextElementSibling!;
      expect(name.classList.contains('payment-method-name'), 'the treated element').toBe(true);
      await userEvent.type(name as HTMLInputElement, 'Voucher');
      expect((name as HTMLInputElement).value, 'what the cashier typed is the treated element\'s own content').toBe('Voucher');
      expect(other.checked).toBe(true);
      // Every OTHER radio is now unchecked, and the row still named by a span is
      // untouched - the change must not have moved a name out of any other row.
      for (const radio of radios.filter((r) => r !== other)) {
        expect(radio.checked, `tender ${radio.value} should be unchecked`).toBe(false);
        expect(radio.nextElementSibling!.classList.contains('payment-method-name'),
          `tender ${radio.value} lost its name element`).toBe(true);
      }
    } finally {
      restore();
      view.unmount();
    }
  });
});
