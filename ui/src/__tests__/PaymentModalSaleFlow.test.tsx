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
});
