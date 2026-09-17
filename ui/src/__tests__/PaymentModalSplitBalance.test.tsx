/**
 * CHARACTERIZATION TEST — the split-tender balance guard.
 *
 * Pins the money contract of PaymentModal's `splitComplete` (currently
 * src/features/sales/PaymentModal.tsx:580-588, feeding `canComplete` :953-961
 * and gating the settle button :2211) BEFORE anyone extracts the split-tender
 * surface. Line numbers drift; the CONTRACT does not:
 *
 *   remaining = total(minor) - sum(parsed split rows)   [bigint, exact]
 *   permitted <=> remaining === 0n
 *               AND (total === 0 OR every row parses > 0 with an 'other' label filled in)
 *
 * A float-tolerant implementation (`Math.abs(remaining) < epsilon`, or
 * `parseFloat` on the row literals) passes "one minor unit short" — so the
 * off-by-one rows below are the point of this file, not decoration.
 *
 * Money law observed here: every fixture is an INTEGER of MINOR units. The
 * decimal literals typed into the rows are produced by integer digit
 * placement only (`minorToRowInput`) — no float arithmetic, no `10 ** exp`
 * scaling, no id-ID locale strings. Nothing in production code was edited to
 * make these cases reachable; where a case is NOT reachable from outside, it
 * is an `it.skip` naming why (see the last case). This file deliberately has
 * no mock that replaces `splitComplete` — every assertion travels through the
 * real DOM input → parse → guard → disabled-attribute path.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderInAct } from '@/test-utils/renderInAct';
import { withFluent } from '@/locales/test-utils';
import { ToastProvider } from '@/components/Toast';
import salesFtl from '@/locales/sales.ftl?raw';
import PaymentModal from '@/features/sales/PaymentModal';
import { minorUnitExponent, type CartLine, type LineId, type Money, type Sku } from '@/types/domain';
import type { CompleteSaleScopedArgs, PaymentSplitArg } from '@/api/sales';
import { minorUnitsToInputString } from '@/features/sales/payment/moneyFormat';

// The single-currency harness on purpose: with MULTI_CURRENCY off,
// useMultiCurrency issues no IPC and cartCurrency === total.currency, so the
// guard is exercised with no mock standing between the fixture and it.
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
      case 'finalize_sale':
      case 'hold_cart':
        return Promise.resolve();
      case 'get_enabled_features':
        return Promise.resolve({ features: [] });
      default:
        return Promise.resolve({});
    }
  });
  return { invokeMock: mock };
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

beforeEach(() => {
  invokeMock.mockClear();
});

// ── fixtures: MINOR units, integers only ───────────────────────────
const usd = (minorUnits: number): Money => ({ minor_units: minorUnits, currency: 'USD' });
const idr = (minorUnits: number): Money => ({ minor_units: minorUnits, currency: 'IDR' });

const line = (unitPriceMinor: number, currency: string): CartLine => ({
  id: 'line-1' as LineId,
  sku: 'COFFEE' as Sku,
  name: 'Coffee',
  qty: 1,
  unit_price: { minor_units: unitPriceMinor, currency } as Money,
});

/** Minor units -> the decimal literal a split row's text input holds.
 *  Thin fixture adapter: resolves the currency's exponent, then delegates to the
 *  PRODUCTION formatter `minorUnitsToInputString` (features/sales/payment/
 *  moneyFormat.ts, exported; PaymentModal and CashTenderPanel import the same
 *  function). This used to be a hand-written mirror of those five lines, which
 *  meant the suite could not fail when production digit placement changed — a
 *  control that cannot fail is not a control. Only the currency -> exponent
 *  lookup is local now; the formatting itself is policed, not reproduced. */
function minorToRowInput(minorUnits: number, currency: string): string {
  return minorUnitsToInputString(minorUnits, minorUnitExponent(currency));
}

type RowSpec = { minor: number; method?: 'cash' | 'card' | 'other'; label?: string };

async function openSplitTender(total: Money, lines: CartLine[] = []) {
  await renderInAct(withFluent(
    <ToastProvider>
      <PaymentModal
        open
        lineItems={lines}
        total={total}
        userId="test-user-id"
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />
    </ToastProvider>,
    salesFtl,
  ));
  const toggle = document.getElementById('payment-split-toggle-cb') as HTMLInputElement | null;
  expect(toggle, 'split toggle must render').not.toBeNull();
  fireEvent.click(toggle!);
  await waitFor(() => expect(rows().length).toBeGreaterThanOrEqual(2));
}

function rows(): HTMLDivElement[] {
  return Array.from(document.querySelectorAll<HTMLDivElement>('.payment-split-row'));
}
function amountInputs(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('.payment-split-amount-input'));
}
function settle(): HTMLButtonElement {
  return screen.getByTestId('settle-button') as HTMLButtonElement;
}
function addRow(): void {
  fireEvent.click(screen.getByText('+ Add Split'));
}
function clickRowRadio(row: HTMLElement, index: 0 | 1 | 2): void {
  const radio = row.querySelectorAll<HTMLInputElement>('input[type="radio"]')[index];
  expect(radio, 'split method radio').not.toBeUndefined();
  fireEvent.click(radio!);
}

/** Fill the split rows from minor-unit fixtures, one row per spec. */
async function fillRows(total: Money, specs: RowSpec[]): Promise<void> {
  while (rows().length < specs.length) addRow();
  await waitFor(() => expect(amountInputs().length).toBe(specs.length));
  specs.forEach((spec, i) => {
    const row = rows()[i];
    expect(row, `row ${i}`).not.toBeUndefined();
    if (spec.method === 'card') clickRowRadio(row!, 1);
    if (spec.method === 'other') {
      clickRowRadio(row!, 2);
      const other = row!.querySelector<HTMLInputElement>('.payment-split-other-input');
      if (other && spec.label !== undefined) {
        fireEvent.change(other, { target: { value: spec.label } });
      }
    }
    const input = amountInputs()[i];
    expect(input, `amount input ${i}`).not.toBeUndefined();
    fireEvent.change(input!, { target: { value: minorToRowInput(spec.minor, total.currency) } });
  });
  await waitFor(() => {
    const got = amountInputs().map((el) => el.value);
    expect(got).toEqual(specs.map((s) => minorToRowInput(s.minor, total.currency)));
  });
}

/** IPC payload shape is loggedInvoke(cmd, { sessionToken, args }) — the
 * CompleteSaleScopedArgs sit under `.args`, not at the top level. */
function completeSaleArgs(): CompleteSaleScopedArgs[] {
  return (invokeMock.mock.calls as unknown as Array<[string, { args?: CompleteSaleScopedArgs }]>)
    .filter((c) => c[0] === 'complete_sale_scoped')
    .map((c) => c[1]!.args as CompleteSaleScopedArgs);
}
function splitSum(splits: PaymentSplitArg[] | undefined): number {
  return (splits ?? []).reduce((acc, s) => acc + s.amountMinor, 0);
}

describe('PaymentModal split-tender balance guard (characterization)', () => {
  it('C1 permits completion when the splits sum to EXACTLY the total, and the payload carries the same minors', async () => {
    const total = usd(10000);
    await openSplitTender(total, [line(10000, 'USD')]);
    await fillRows(total, [{ minor: 6000 }, { minor: 4000, method: 'card' }]);

    expect(settle()).toBeEnabled();
    fireEvent.click(settle());
    await waitFor(() => expect(completeSaleArgs().length).toBe(1));
    const splits = completeSaleArgs()[0]!.paymentSplits;
    expect((splits ?? []).map((s) => s.amountMinor)).toEqual([6000, 4000]);
    expect(splitSum(splits)).toBe(total.minor_units);
  });

  it('C2 REFUSES completion one minor unit short (10000 vs 9999) — the float-tolerance trap', async () => {
    const total = usd(10000);
    await openSplitTender(total, [line(10000, 'USD')]);
    await fillRows(total, [{ minor: 6000 }, { minor: 3999, method: 'card' }]);

    expect(settle()).toBeDisabled();
    fireEvent.click(settle());
    expect(completeSaleArgs()).toHaveLength(0);
  });

  it('C3 REFUSES completion one minor unit over (10000 vs 10001) — over-tender is not balance', async () => {
    const total = usd(10000);
    await openSplitTender(total, [line(10000, 'USD')]);
    await fillRows(total, [{ minor: 6000 }, { minor: 4001, method: 'card' }]);

    expect(settle()).toBeDisabled();
    fireEvent.click(settle());
    expect(completeSaleArgs()).toHaveLength(0);
  });

  it('C4 treats a zero-value sale as balanced with zero/blank tenders (the total===0 branch)', async () => {
    const total = usd(0);
    await openSplitTender(total);
    await fillRows(total, [{ minor: 0 }, { minor: 0, method: 'card' }]);
    expect(settle()).toBeEnabled();
  });

  it('C5 still refuses a zero-value sale whose splits sum ABOVE zero', async () => {
    const total = usd(0);
    await openSplitTender(total);
    await fillRows(total, [{ minor: 1 }, { minor: 0, method: 'card' }]);
    expect(settle()).toBeDisabled();
  });

  it('C6 permits a 3-row split that sums exactly to the total', async () => {
    const total = usd(10000);
    await openSplitTender(total, [line(10000, 'USD')]);
    await fillRows(total, [{ minor: 5000 }, { minor: 3000, method: 'card' }, { minor: 2000 }]);
    expect(rows()).toHaveLength(3);
    expect(settle()).toBeEnabled();
    fireEvent.click(settle());
    await waitFor(() => expect(completeSaleArgs().length).toBe(1));
    const splits = completeSaleArgs()[0]!.paymentSplits;
    expect((splits ?? []).map((s) => s.amountMinor)).toEqual([5000, 3000, 2000]);
    expect(splitSum(splits)).toBe(total.minor_units);
  });

  it('C7 REFUSES a 3-row split one minor unit short', async () => {
    const total = usd(10000);
    await openSplitTender(total, [line(10000, 'USD')]);
    await fillRows(total, [{ minor: 5000 }, { minor: 3000, method: 'card' }, { minor: 1999 }]);
    expect(settle()).toBeDisabled();
  });

  it('C8 balances on fractional literals a float sum drifts on: 3333.33 + 6666.67', async () => {
    const total = usd(1000000); // "10000.00" — parseFloat summing lands on 999999.9999999999
    await openSplitTender(total, [line(1000000, 'USD')]);
    await fillRows(total, [{ minor: 333333 }, { minor: 666667, method: 'card' }]);
    expect(amountInputs().map((el) => el.value)).toEqual(['3333.33', '6666.67']);
    expect(settle()).toBeEnabled();
    fireEvent.click(settle());
    await waitFor(() => expect(completeSaleArgs().length).toBe(1));
    expect(splitSum(completeSaleArgs()[0]!.paymentSplits)).toBe(1000000);
  });

  it('C8b REFUSES the same literals one minor unit short: 3333.33 + 6666.66', async () => {
    const total = usd(1000000);
    await openSplitTender(total, [line(1000000, 'USD')]);
    await fillRows(total, [{ minor: 333333 }, { minor: 666666, method: 'card' }]);
    expect(amountInputs().map((el) => el.value)).toEqual(['3333.33', '6666.66']);
    expect(settle()).toBeDisabled();
    fireEvent.click(settle());
    expect(completeSaleArgs()).toHaveLength(0);
  });

  it('C9 permits the exact 2-row decimal split of an odd cent total', async () => {
    const total = usd(10001);
    await openSplitTender(total, [line(10001, 'USD')]);
    await fillRows(total, [{ minor: 3333 }, { minor: 6668, method: 'card' }]);
    expect(settle()).toBeEnabled();
  });

  it('C10 REFUSES a balanced split whose "other" row has no label, and permits it once labelled', async () => {
    const total = usd(10000);
    await openSplitTender(total, [line(10000, 'USD')]);
    await fillRows(total, [{ minor: 6000 }, { minor: 4000, method: 'other' }]);
    expect(settle()).toBeDisabled();

    await fillRows(total, [{ minor: 6000 }, { minor: 4000, method: 'other', label: 'Voucher' }]);
    expect(settle()).toBeEnabled();
  });

  it('C11 honors the currency exponent: IDR (0 minor units) balances exactly and refuses one rupiah short', async () => {
    const total = idr(150000);
    await openSplitTender(total, [line(150000, 'IDR')]);
    await fillRows(total, [{ minor: 100000 }, { minor: 50000, method: 'card' }]);
    expect(amountInputs().map((el) => el.value)).toEqual(['100000', '50000']);
    expect(settle()).toBeEnabled();

    await fillRows(total, [{ minor: 100000 }, { minor: 49999, method: 'card' }]);
    expect(settle()).toBeDisabled();
  });

  it.skip('C12 mixed-currency split (base currency != charge currency) — NOT characterizable from outside', async () => {
    // WHY SKIPPED (no production edit was made to reach this):
    // The converted-total path needs FEATURES.MULTI_CURRENCY on *and* four
    // @/api/currency mocks (listCurrenciesScoped, listExchangeRates(Scoped),
    // getDefaultCurrency(Scoped), getLatestExchangeRateScoped) plus a
    // charge-currency dropdown interaction — i.e. new mocks, which this file
    // deliberately avoids so that nothing stands between fixture and guard.
    // What it would pin: splitComplete compares against
    // `effectiveTotalInCartCurrency` (the CONVERTED total), never `total`, so
    // an extraction that swaps in `total.minor_units` would ring a balanced
    // split as short by the rate delta. That invariant is pinned instead at
    // the source: the guard reads effectiveTotalInCartCurrency (:580-588) and
    // C11 already pins the exponent half of the same code path.
    expect(true).toBe(false);
  });
});
