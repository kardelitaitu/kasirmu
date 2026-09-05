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
  // The id is minted once per mount, and one mount is one checkout attempt:
  // RetailPosScreen renders PaymentModal conditionally (`if (showPayment &&
  // total)`), so it unmounts between sales. Every submission of a single
  // attempt reuses its id (the dialog-level tests cover the retry), while the
  // next customer's sale must get a fresh one. That second property is what
  // keeps a till trading — an id that outlived its attempt would make a
  // legitimate new sale collide with the previous one and be rejected.

  describe('checkout attempt id', () => {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

    const attemptIds = () =>
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
  });
});
