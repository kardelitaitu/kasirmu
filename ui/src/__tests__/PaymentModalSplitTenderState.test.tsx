/**
 * CHARACTERIZATION TEST - the split-tender STATE TRANSITIONS.
 *
 * PaymentModalSplitBalance.test.tsx already pins the balance GUARD (does the sum
 * permit completion). This file pins the half the 45-to-90-minute extraction has to
 * carry and that nothing covered until now: what the controls DO to the row state -
 * add, remove, edit, toggle, and the exact integer behaviour of autoSplitEvenly
 * including which row receives the residual minor unit.
 *
 * Everything is driven through the modal's public surface (rendered DOM + user
 * events). No private helper is imported: a test that reached into addSplit/
 * removeSplit/updateSplit/autoSplitEvenly could not survive the move that these tests
 * exist to de-risk.
 *
 * Money law: fixtures are INTEGER minor units; every expected row value is produced
 * by the PRODUCTION formatter minorUnitsToInputString (payment/moneyFormat.ts), so
 * the assertions are digit-placement facts, not float arithmetic in the test.
 *
 * Where a case describes behaviour we would not choose, the name says
 * CHARACTERISES ... NOT ENDORSING. Line numbers in comments are from the revision
 * they were read at and are not load-bearing.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { renderInAct } from '@/test-utils/renderInAct';
import { withFluent } from '@/i18n/test-utils';
import { ToastProvider } from '@/components/Toast';
import salesFtl from '@/locales/sales.ftl?raw';
import PaymentModal from '@/features/sales/PaymentModal';
import { minorUnitExponent, type CartLine, type LineId, type Money, type Sku } from '@/types/domain';
import { minorUnitsToInputString } from '@/features/sales/payment/moneyFormat';

// Single-currency on purpose: with MULTI_CURRENCY off no IPC sits between the
// fixture and the maths, and cartCurrency === total.currency, so the exponent under
// test is the one the fixture names.
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
    switch (callArgs[0] as string) {
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

beforeEach(() => invokeMock.mockClear());

const usd = (minor: number): Money => ({ minor_units: minor, currency: 'USD' });
const idr = (minor: number): Money => ({ minor_units: minor, currency: 'IDR' });
const line = (unitPriceMinor: number, currency: string): CartLine => ({
  id: 'line-1' as LineId,
  sku: 'COFFEE' as Sku,
  name: 'Coffee',
  qty: 1,
  unit_price: { minor_units: unitPriceMinor, currency } as Money,
});

/** minor units -> the decimal literal a row input holds, via the production formatter. */
function lit(minor: number, currency: string): string {
  return minorUnitsToInputString(minor, minorUnitExponent(currency));
}

async function openModal(total: Money) {
  await renderInAct(withFluent(
    <ToastProvider>
      <PaymentModal open lineItems={[line(total.minor_units, total.currency)]} total={total}
        userId="test-user-id" onComplete={vi.fn()} onClose={vi.fn()} />
    </ToastProvider>,
    salesFtl,
  ));
  await waitFor(() => expect(toggle()).not.toBeNull());
}

function toggle(): HTMLInputElement | null {
  return document.getElementById('payment-split-toggle-cb') as HTMLInputElement | null;
}
function section(): HTMLElement | null {
  return document.querySelector('.payment-split-section');
}
function rows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.payment-split-row'));
}
function amountInputs(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('.payment-split-amount-input'));
}
function values(): string[] {
  return amountInputs().map((el) => el.value);
}
function removeButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.payment-split-remove'));
}
function addRow(): void {
  fireEvent.click(Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Add Split'))!);
}
function splitEvenly(): void {
  const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Split Evenly'));
  expect(btn, 'Split Evenly button must render').toBeTruthy();
  fireEvent.click(btn!);
}
function setAmount(i: number, value: string): void {
  const input = amountInputs()[i];
  expect(input, `amount input ${i}`).not.toBeUndefined();
  fireEvent.change(input!, { target: { value } });
}
async function expectRowCount(n: number): Promise<void> {
  await waitFor(() => expect(rows().length).toBe(n));
}
async function toggleOn(): Promise<void> {
  fireEvent.click(toggle()!);
  await waitFor(() => expect(section()).not.toBeNull());
  await expectRowCount(2);
}
async function toRowCount(n: number): Promise<void> {
  while (rows().length < n) addRow();
  await expectRowCount(n);
}
function remainingClasses(): string {
  const el = document.querySelector('.payment-split-remaining-amount');
  return el ? String(el.className) : '<no remaining line>';
}

describe('PaymentModal split-tender state transitions (characterization)', () => {
  it('T1 the toggle is a split ON/OFF switch: OFF renders no section, ON seeds exactly two rows, cash then card, both empty', async () => {
    await openModal(usd(10000));
    expect(section()).toBeNull();
    await toggleOn();
    expect(rows().length).toBe(2);
    expect(values()).toEqual(['', '']);
    const checked = (i: number) => Array.from(rows()[i]!.querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter((r) => r.checked).map((r) => r.value);
    expect(checked(0)).toEqual(['cash']);
    expect(checked(1)).toEqual(['card']);
  });
  it('T2 add split appends a cash row with an empty amount and does not disturb the existing rows', async () => {
    await openModal(usd(10000));
    await toggleOn();
    setAmount(0, '40.00');
    addRow();
    await expectRowCount(3);
    expect(values()).toEqual(['40.00', '', '']);
    expect(Array.from(rows()[2]!.querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter((r) => r.checked).map((r) => r.value)).toEqual(['cash']);
  });
  it('T3 three adds reach five rows, so the five-way even split below is driven by user events and not by a seeded fixture', async () => {
    await openModal(usd(10000));
    await toggleOn();
    await toRowCount(5);
    expect(amountInputs().length).toBe(5);
  });
  it('T4 remove deletes the row it was clicked in, by identity: removing the first row leaves the card row as the first row', async () => {
    await openModal(usd(10000));
    await toggleOn();
    setAmount(0, '30.00');
    setAmount(1, '70.00');
    fireEvent.click(removeButtons()[0]!);
    await expectRowCount(1);
    expect(values()).toEqual(['70.00']);
    expect(Array.from(rows()[0]!.querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter((r) => r.checked).map((r) => r.value)).toEqual(['card']);
  });
  it('T5 the remove control disables at one row and a click there cannot empty the section', async () => {
    await openModal(usd(10000));
    await toggleOn();
    expect(removeButtons().every((b) => !b.disabled)).toBe(true);
    fireEvent.click(removeButtons()[0]!);
    await expectRowCount(1);
    await waitFor(() => expect(removeButtons()[0]!.disabled).toBe(true));
    fireEvent.click(removeButtons()[0]!);
    await expectRowCount(1);
  });
  it('T6 editing an amount writes through verbatim (CHARACTERISES, NOT ENDORSING: the field is a text input, so a non-numeric entry is kept and the row is left to the balance guard)', async () => {
    await openModal(usd(10000));
    await toggleOn();
    setAmount(0, '12.34');
    await waitFor(() => expect(values()[0]).toBe('12.34'));
    setAmount(0, '12,34');
    await waitFor(() => expect(values()[0]).toBe('12,34'));
  });
  it('T7 the remaining line flags imbalance while the rows do not sum to the total and clears when they do', async () => {
    await openModal(usd(10000));
    await toggleOn();
    setAmount(0, '60.00');
    setAmount(1, '39.99');
    await waitFor(() => expect(remainingClasses()).toContain('payment-split-remaining-positive'));
    setAmount(1, '40.00');
    await waitFor(() => expect(remainingClasses()).not.toContain('payment-split-remaining-positive'));
  });
  it('T8 autoSplitEvenly, 2 rows over 10000 minor: 5000 + 5000, remainder zero, no residual row', async () => {
    await openModal(usd(10000));
    await toggleOn();
    splitEvenly();
    await waitFor(() => expect(values()).toEqual([lit(5000, 'USD'), lit(5000, 'USD')]));
  });
  it('T9 autoSplitEvenly, 3 rows over 10001 minor: 3333 + 3333 + 3335 - the whole residual lands on the LAST row, not spread and not on the first', async () => {
    await openModal(usd(10001));
    await toggleOn();
    await toRowCount(3);
    splitEvenly();
    await waitFor(() => expect(values()).toEqual([lit(3333, 'USD'), lit(3333, 'USD'), lit(3335, 'USD')]));
  });
  it('T10 autoSplitEvenly, 3 rows over 10000 minor: 3333 + 3333 + 3334 - one residual unit, still the last row', async () => {
    await openModal(usd(10000));
    await toggleOn();
    await toRowCount(3);
    splitEvenly();
    await waitFor(() => expect(values()).toEqual([lit(3333, 'USD'), lit(3333, 'USD'), lit(3334, 'USD')]));
  });
  it('T11 autoSplitEvenly, 5 rows over 10000 minor: four 2000s and no residual; over 10001 the fifth row takes the single odd unit', async () => {
    await openModal(usd(10000));
    await toggleOn();
    await toRowCount(5);
    splitEvenly();
    await waitFor(() => expect(values()).toEqual([lit(2000, 'USD'), lit(2000, 'USD'), lit(2000, 'USD'), lit(2000, 'USD'), lit(2000, 'USD')]));
  });
  it('T12 autoSplitEvenly, 5 rows over 10001 minor: 2000 x4 + 2001 on the last row', async () => {
    await openModal(usd(10001));
    await toggleOn();
    await toRowCount(5);
    splitEvenly();
    await waitFor(() => expect(values()).toEqual([lit(2000, 'USD'), lit(2000, 'USD'), lit(2000, 'USD'), lit(2000, 'USD'), lit(2001, 'USD')]));
  });
  it('T13 the residual follows the currency exponent: IDR (0 minor units) over 100000 across 3 rows is 33333 + 33333 + 33334 with no decimal separator anywhere', async () => {
    await openModal(idr(100000));
    await toggleOn();
    await toRowCount(3);
    splitEvenly();
    await waitFor(() => expect(values()).toEqual(['33333', '33333', '33334']));
    expect(values().some((v) => v.includes('.'))).toBe(false);
  });
  it('T14 the even split is exactly total-preserving for a non-divisible total: the row literals re-sum to the fixture with nothing lost or invented', async () => {
    await openModal(usd(10001));
    await toggleOn();
    await toRowCount(3);
    splitEvenly();
    await waitFor(() => expect(values()[2]).toBe(lit(3335, 'USD')));
    const exp = minorUnitExponent('USD');
    const sumMinor = values().reduce((acc, v) => {
      const [whole, frac = ''] = v.split('.');
      return acc + (Number(whole) * 10 ** exp + Number(frac.padEnd(exp, '0')));
    }, 0);
    expect(sumMinor).toBe(10001);
  });
  it('T15 autoSplitEvenly rewrites only the amount: each row keeps its own method and its own other-label', async () => {
    await openModal(usd(10000));
    await toggleOn();
    const otherRadio = rows()[1]!.querySelectorAll<HTMLInputElement>('input[type="radio"]')[2];
    fireEvent.click(otherRadio!);
    const otherInput = rows()[1]!.querySelector<HTMLInputElement>('.payment-split-other-input');
    fireEvent.change(otherInput!, { target: { value: 'voucher' } });
    splitEvenly();
    await waitFor(() => expect(values()).toEqual([lit(5000, 'USD'), lit(5000, 'USD')]));
    expect(Array.from(rows()[1]!.querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter((r) => r.checked).map((r) => r.value)).toEqual(['other']);
    expect(rows()[1]!.querySelector<HTMLInputElement>('.payment-split-other-input')!.value).toBe('voucher');
  });
  it('T16 deleting the residual row does not re-distribute: the odd units stay missing and the remaining line shows the shortfall', async () => {
    await openModal(usd(10001));
    await toggleOn();
    await toRowCount(3);
    splitEvenly();
    await waitFor(() => expect(values()[2]).toBe(lit(3335, 'USD')));
    fireEvent.click(removeButtons()[2]!);
    await expectRowCount(2);
    expect(values()).toEqual([lit(3333, 'USD'), lit(3333, 'USD')]);
    await waitFor(() => expect(remainingClasses()).toContain('payment-split-remaining-positive'));
  });
  it('T17 the rows live in the shell, not the section: toggling OFF and back ON restores typed amounts and the added row', async () => {
    await openModal(usd(10000));
    await toggleOn();
    await toRowCount(3);
    setAmount(2, '25.00');
    fireEvent.click(toggle()!);
    await waitFor(() => expect(section()).toBeNull());
    fireEvent.click(toggle()!);
    await waitFor(() => expect(section()).not.toBeNull());
    await expectRowCount(3);
    expect(values()).toEqual(['', '', '25.00']);
  });
  it('T18 there is no amount/percent axis on a split row: percent exists only as the discount prop, so a move of this state must not invent one', async () => {
    await openModal(usd(10000));
    await toggleOn();
    await toRowCount(3);
    const kinds = new Set(Array.from(document.querySelectorAll('.payment-split-section input')).map((el) => (el as HTMLInputElement).type));
    expect(kinds.has('range')).toBe(false);
    expect(document.querySelectorAll('.payment-split-section input[type="number"]').length).toBe(0);
    expect(Array.from(document.querySelectorAll('.payment-split-amount-input')).every((el) => el.getAttribute('inputmode') === 'decimal')).toBe(true);
  });
});
