/**
 * CHARACTERIZATION TEST — the loyalty / points-redeem block of PaymentModal.
 *
 * Written BEFORE the extraction into payment/LoyaltyTenderPanel.tsx, to make
 * that move safe. The region is the JSX block gated on
 * `isEnabled(FEATURES.LOYALTY_PROGRAM) && loyaltyAccount` (currently
 * src/features/sales/PaymentModal.tsx:1701-1775) plus the five useState it
 * reads/writes (loyaltyAccount, redeemPoints, loyaltyDiscount, pointsToRedeem,
 * pointsWorthMinor — :140-149) and the three effects behind them (:410-462).
 * Line numbers drift; the CONTRACT this file pins does not:
 *
 *   getPointsValue(points) -> minor units                 [backend, mocked]
 *   pointsWorthMinor = value(account.points)              [balance row only]
 *   loyaltyDiscount  = min(value(pointsToRedeem), totalMinor)   [CLAMPED]
 *   loyaltyDiscount  = 0n unless redeemPoints && pointsToRedeem > 0
 *   payable (useTenderMath.effectiveTotal) = max(0, total - loyaltyDiscount)
 *
 * The last line is why this file exists: loyaltyDiscount is consumed OUTSIDE
 * the region — by useTenderMath (:398-408), by the total row (:1411-1420) and,
 * through `sufficient`, by canComplete (:871-879). An extractor that moves the
 * JSX but leaves one useState behind re-parents the discount into a panel-local
 * copy: every label in the panel still renders, and Total Due quietly stops
 * moving. L9 / L10 / L13 are the cases that make that failure loud.
 *
 * Money law observed: every fixture is an INTEGER of MINOR units and every
 * expected figure is produced by the SAME production formatter the component
 * calls (`formatMoney` from types/domain) — never a hand-typed decimal, never
 * float arithmetic in the test. Where a mutant could render a raw minor
 * integer, an extra assertion says so out loud (L3, L8).
 *
 * English asserted here was read out of ui/src/locales/sales.ftl:
 *   :157 payment-cancel                 = Cancel
 *   :164 payment-loyalty-use-points     = Use Points
 *   :165 payment-loyalty-points-label   = Points
 *   :166 payment-loyalty-discount-label = Discount: -{ $amount }
 *   :179 payment-loyalty-points-aria    = Points
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderInAct } from '@/test-utils/renderInAct';
import { withFluent } from '@/locales/test-utils';
import { ToastProvider } from '@/frontend/shared/Toast';
import salesFtl from '@/locales/sales.ftl?raw';
import PaymentModal from '@/features/sales/PaymentModal';
import LoyaltyTenderPanel from '@/features/sales/payment/LoyaltyTenderPanel';
import { formatMoney, type CartLine, type LineId, type Money, type Sku } from '@/types/domain';
import type { LoyaltyAccountWithDetails } from '@/api/loyalty';

const { flags, invokeMock, mockGetLoyaltyAccount, mockGetPointsValue, mockRedeemLoyaltyPoints } = vi.hoisted(() => ({
  flags: { loyalty: true },
  invokeMock: vi.fn((cmd: string): Promise<unknown> => {
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
      case 'print_sales_receipt_scoped':
        return Promise.resolve({ printed: true });
      case 'finalize_sale':
      case 'finalize_sale_scoped':
      case 'hold_cart':
      case 'hold_cart_scoped':
        return Promise.resolve();
      case 'get_enabled_features':
        return Promise.resolve({ features: [] });
      default:
        return Promise.resolve({});
    }
  }),
  mockGetLoyaltyAccount: vi.fn(),
  mockGetPointsValue: vi.fn(),
  mockRedeemLoyaltyPoints: vi.fn(),
}));

// Loyalty ON, multi-currency OFF: with the currency feature off,
// useMultiCurrency issues no IPC and cartCurrency === total.currency, so
// convertToChargeCurrency is the identity and every figure below is the
// fixture's own minor units — nothing stands between the fixture and the guard.
vi.mock('@/hooks/useFeatures', () => ({
  useFeatures: () => ({
    enabled: new Set(flags.loyalty ? ['loyalty-program'] : []),
    loading: false,
    isEnabled: (key: string) => key === 'loyalty-program' && flags.loyalty,
    filterRoutes: (routes: string[]) => routes,
    error: null,
    loaded: true,
  }),
  FEATURES: { MULTI_CURRENCY: 'multi-currency', LOYALTY_PROGRAM: 'loyalty-program' },
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

vi.mock('@/api/customers', () => ({
  listCustomers: vi.fn().mockResolvedValue([]),
  listCustomersScoped: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/api/loyalty', () => ({
  getLoyaltyAccount: mockGetLoyaltyAccount,
  getPointsValue: mockGetPointsValue,
  redeemLoyaltyPoints: mockRedeemLoyaltyPoints,
}));

beforeEach(() => {
  invokeMock.mockClear();
  mockGetLoyaltyAccount.mockReset();
  mockGetPointsValue.mockReset();
  mockRedeemLoyaltyPoints.mockReset();
  mockRedeemLoyaltyPoints.mockResolvedValue({ transaction: {}, discount_minor: 0 });
  flags.loyalty = true;
});

// ── fixtures: MINOR units, integers only ───────────────────────────
const usd = (minor: number): Money => ({ minor_units: minor, currency: 'USD' });
/** The same call the component makes — the expectation cannot drift from the formatter. */
const money = (minor: number): string => formatMoney(usd(minor));

const line: CartLine = {
  id: 'line-1' as LineId,
  sku: 'COFFEE' as Sku,
  name: 'Coffee',
  qty: 1,
  unit_price: usd(10000),
};

const CUSTOMER = {
  id: 'cust-1', name: 'Ada', phone: '', email: '', notes: '', created_at: '', updated_at: '',
};

/** 1 point = 4 minor units — deliberately not 1, so a call that confuses
 *  account.points with pointsToRedeem produces a visibly different number. */
const POINTS_PER_MINOR = 4;
const valueFor = (points: number): number => points * POINTS_PER_MINOR;

function account(points: number): LoyaltyAccountWithDetails {
  return {
    account: {
      id: 'la-1', customer_id: 'cust-1', points, lifetime_points: points,
      tier_id: null, updated_at: '', created_at: '',
    },
    tier: null, recent_transactions: [], next_tier: null, points_to_next_tier: 0,
  };
}

/**
 * The modal under test. withCustomer: false OMITS the prop entirely —
 * PaymentModalProps declares it optional (and exactOptionalPropertyTypes is
 * on), which is precisely the state the no-customer guard must react to.
 */
function modal(totalMinor: number, withCustomer: boolean) {
  return (
    <ToastProvider>
      <PaymentModal
        open
        sessionToken="tok-1"
        {...(withCustomer ? { selectedCustomer: CUSTOMER } : {})}
        lineItems={[line]}
        total={usd(totalMinor)}
        userId="test-user-id"
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />
    </ToastProvider>
  );
}

async function open(totalMinor = 10000, points = 500) {
  mockGetLoyaltyAccount.mockResolvedValue(account(points));
  mockGetPointsValue.mockImplementation(async (_t: string, p: number) => valueFor(p));
  await renderInAct(withFluent(modal(totalMinor, true), salesFtl));
}

const qs = <T extends Element>(selector: string): T | null => document.querySelector<T>(selector);
const section = () => qs<HTMLElement>('.payment-loyalty-section');
const totalAmount = () => qs<HTMLElement>('.payment-total-amount');

function loyaltyInput(): HTMLInputElement {
  const el = qs<HTMLInputElement>('.payment-loyalty-input');
  expect(el, 'loyalty points input').not.toBeNull();
  return el!;
}
function settle(): HTMLButtonElement {
  return screen.getByTestId('settle-button') as HTMLButtonElement;
}
async function redeem(pointsToType?: string) {
  const btn = await screen.findByRole('button', { name: /^use points$/i });
  fireEvent.click(btn);
  await waitFor(() => expect(qs('.payment-loyalty-active')).not.toBeNull());
  if (pointsToType !== undefined) {
    fireEvent.change(loyaltyInput(), { target: { value: pointsToType } });
  }
}

describe('PaymentModal loyalty / points-redeem block (characterization)', () => {
  // COMPOSITE pin - and it is NOT sufficient on its own. It asserts the SHELL's
  // render condition, which says nothing about what the panel would do if
  // something else mounted it. L14 is the caller-independent half of the same
  // rule; keep both.
  it('L1 renders no loyalty section at all when LOYALTY_PROGRAM is off', async () => {
    flags.loyalty = false;
    await open();
    // Used to read: `await waitFor(() => expect(mockGetLoyaltyAccount).
    // toHaveBeenCalled())` - i.e. this case had the unlicensed round-trip written
    // down as EXPECTED BEHAVIOUR, which is why the suite could not see the defect
    // L16 pins. Wait on the modal being up and settled instead, so the absence
    // below means 'rendered without a loyalty UI' and not 'not rendered yet'.
    await waitFor(() => expect(settle()).toBeInTheDocument());
    expect(section()).toBeNull();
    expect(qs('.payment-loyalty-redeem-btn')).toBeNull();
    // The account read is gone now (L16), so the label staying null is about the
    // render gate holding even after everything the modal does has landed.
    await waitFor(() => expect(qs('.payment-loyalty-label')).toBeNull());
  });

  it('L2 renders no loyalty section, and asks no loyalty IPC, with no customer attached', async () => {
    mockGetLoyaltyAccount.mockResolvedValue(account(500));
    mockGetPointsValue.mockImplementation(async (_t: string, p: number) => valueFor(p));
    await renderInAct(withFluent(modal(10000, false), salesFtl));
    await waitFor(() => expect(settle()).toBeInTheDocument());
    expect(section()).toBeNull();
    expect(mockGetLoyaltyAccount).not.toHaveBeenCalled();
    expect(mockGetPointsValue).not.toHaveBeenCalled();
  });

  it('L3 pairs the points balance with its money value, formatted — never a raw minor integer', async () => {
    await open();
    await waitFor(() => expect(section()).not.toBeNull());

    // .ftl :165 "Points" + ": " + account.points
    const label = qs<HTMLElement>('.payment-loyalty-label');
    expect(label, 'loyalty label span').not.toBeNull();
    expect(label!.textContent).toBe('Points: 500');

    // the figure must come from getPointsValue(account.points) and be formatted
    await waitFor(() => expect(qs<HTMLElement>('.payment-loyalty-value')!.textContent).toBe(`(${money(2000)})`));
    const value = qs<HTMLElement>('.payment-loyalty-value')!;
    expect(value.textContent).not.toContain('2000');            // raw minor units leaked
    expect(mockGetPointsValue).toHaveBeenCalledWith('tok-1', 500);
  });

  it('L4 shows the pending placeholder, not a figure, while the points value is unresolved', async () => {
    mockGetLoyaltyAccount.mockResolvedValue(account(500));
    mockGetPointsValue.mockImplementation(() => new Promise<number>(() => { /* never settles */ }));
    await renderInAct(withFluent(modal(10000, true), salesFtl));
    await waitFor(() => expect(section()).not.toBeNull());
    expect(qs<HTMLElement>('.payment-loyalty-value')!.textContent).toBe('\u2026');
    expect(totalAmount()!.textContent).toBe(money(10000));
  });

  it('L5 a zero-points account shows the balance but no redeem affordance at all', async () => {
    await open(10000, 0);
    await waitFor(() => expect(section()).not.toBeNull());
    expect(qs('.payment-loyalty-redeem-btn')).toBeNull();
    expect(qs('.payment-loyalty-active')).toBeNull();
    expect(qs<HTMLElement>('.payment-loyalty-label')!.textContent).toBe('Points: 0');
  });

  it('L6 Use Points is labelled from the .ftl, seeds the input with the full balance, then hides itself', async () => {
    await open();
    const btn = await screen.findByRole('button', { name: /^use points$/i });
    expect(btn.className).toBe('payment-loyalty-redeem-btn');
    fireEvent.click(btn);
    await waitFor(() => expect(qs('.payment-loyalty-active')).not.toBeNull());
    expect(qs('.payment-loyalty-redeem-btn')).toBeNull();
    expect(loyaltyInput().value).toBe('500');   // pointsToRedeem seeded from account.points
  });

  it('L7 the input is a constrained number field with the balance as its max and the .ftl aria-label', async () => {
    await open();
    await redeem();
    const input = loyaltyInput();
    expect(input.type).toBe('number');
    expect(input.min).toBe('0');
    expect(input.max).toBe('500');                                 // == account.points
    expect(input.getAttribute('aria-label')).toBe('Points');       // .ftl :179
    expect(qs<HTMLElement>('.payment-loyalty-input-hint')!.textContent).toBe('/ 500');
    expect(qs<HTMLElement>('.payment-loyalty-input-label')!.textContent).toBe('Points');

    // whole non-negative numbers only — the onChange guard ignores the rest
    fireEvent.change(input, { target: { value: '12.5' } });
    expect(loyaltyInput().value).toBe('500');
    fireEvent.change(input, { target: { value: '-3' } });
    expect(loyaltyInput().value).toBe('500');
    fireEvent.change(input, { target: { value: '250' } });
    expect(loyaltyInput().value).toBe('250');
  });

  it('L8 the discount label carries the formatted money figure the points convert to', async () => {
    await open();
    await redeem('250');
    await waitFor(() => expect(mockGetPointsValue).toHaveBeenCalledWith('tok-1', 250));
    const el = qs<HTMLElement>('.payment-loyalty-discount-label');
    expect(el, 'discount label').not.toBeNull();
    expect(el!.textContent).toBe(`Discount: -${money(1000)}`);      // .ftl :166
  });

  it('L9 COUPLING: redeeming moves Total Due OUTSIDE the region, and re-typing moves it again', async () => {
    await open();
    expect(totalAmount()!.textContent).toBe(money(10000));
    await redeem('250');
    // loyaltyDiscount -> useTenderMath.effectiveTotal -> the total row
    await waitFor(() => expect(totalAmount()!.textContent).toBe(money(9000)));
    fireEvent.change(loyaltyInput(), { target: { value: '100' } });
    await waitFor(() => expect(totalAmount()!.textContent).toBe(money(9600)));
    expect(qs<HTMLElement>('.payment-loyalty-discount-label')!.textContent).toBe(`Discount: -${money(400)}`);
  });

  it('L10 the discount is clamped to the payable, so a rich conversion cannot out-discount the bill', async () => {
    await open();
    await redeem();
    // make the backend answer exceed the total: 500 points -> 999999 minors against a 10000 bill
    mockGetPointsValue.mockImplementation(async (_t: string, p: number) => (p === 500 ? 999999 : valueFor(p)));
    fireEvent.change(loyaltyInput(), { target: { value: '400' } });
    fireEvent.change(loyaltyInput(), { target: { value: '500' } });
    await waitFor(() => expect(qs<HTMLElement>('.payment-loyalty-discount-label')!.textContent).toBe(`Discount: -${money(10000)}`));
    expect(totalAmount()!.textContent).toBe(money(0));
  });

  it('L11 clearing the input drops the discount to zero — and the total back to full', async () => {
    await open();
    await redeem('250');
    await waitFor(() => expect(totalAmount()!.textContent).toBe(money(9000)));
    fireEvent.change(loyaltyInput(), { target: { value: '' } });
    // pointsToRedeem <= 0 guard: loyaltyDiscount resets to 0n, no IPC for it
    await waitFor(() => expect(totalAmount()!.textContent).toBe(money(10000)));
    expect(qs<HTMLElement>('.payment-loyalty-discount-label')!.textContent).toBe(`Discount: -${money(0)}`);
    expect(qs('.payment-loyalty-active')).not.toBeNull();
  });

  it('L12 Cancel resets redeemPoints, pointsToRedeem AND loyaltyDiscount together', async () => {
    await open();
    await redeem('250');
    await waitFor(() => expect(totalAmount()!.textContent).toBe(money(9000)));
    fireEvent.click(qs<HTMLElement>('.payment-loyalty-cancel-btn')!);
    await waitFor(() => expect(totalAmount()!.textContent).toBe(money(10000)));
    expect(qs('.payment-loyalty-active')).toBeNull();
    expect(await screen.findByRole('button', { name: /^use points$/i })).toBeInTheDocument();
    await redeem();
    expect(loyaltyInput().value).toBe('500');   // re-seeded, not left at 250
  });

  it('L13 COUPLING through sufficient: an under-tender settles only once the discount is applied', async () => {
    await open();
    const tender = qs<HTMLInputElement>('.payment-tendered-input');
    expect(tender, 'cash tender input').not.toBeNull();
    fireEvent.change(tender!, { target: { value: '90' } });   // 9000 minors of a 10000 bill
    expect(settle()).toBeDisabled();

    await redeem('250');                                     // payable -> 9000
    await waitFor(() => expect(totalAmount()!.textContent).toBe(money(9000)));
    expect(settle()).toBeEnabled();

    fireEvent.click(qs<HTMLElement>('.payment-loyalty-cancel-btn')!);
    await waitFor(() => expect(totalAmount()!.textContent).toBe(money(10000)));
    expect(settle()).toBeDisabled();
  });

  // ── The gate, measured at the CHILD rather than at the modal ───────────
  //
  // L1 cannot catch a second caller: it pins PaymentModal's render condition,
  // and a new call site has no PaymentModal in it. These two mount
  // payment/LoyaltyTenderPanel directly - no modal, no useFeatures mock anywhere
  // in the path - so what they measure is the panel's own refusal. Identical
  // props both ways except loyaltyOffered, which is the reviewer's concrete
  // input (points 0, pointsWorthMinor null, currency IDR, redeemPoints false,
  // pointsToRedeem 0, loyaltyDiscount 0n): a Points section, or nothing.
  function child(loyaltyOffered: boolean) {
    return (
      <LoyaltyTenderPanel
        loyaltyOffered={loyaltyOffered}
        points={0}
        pointsWorthMinor={null}
        currency="IDR"
        redeemPoints={false}
        pointsToRedeem={0}
        loyaltyDiscount={0n}
        onRedeemStart={vi.fn()}
        onPointsChange={vi.fn()}
        onRedeemCancel={vi.fn()}
      />
    );
  }

  it('L14 mounted directly with loyaltyOffered false, the panel renders no loyalty UI at all', async () => {
    await renderInAct(withFluent(child(false), salesFtl));

    expect(section(), 'an unlicensed tenant must get no Points section').toBeNull();
    // Not just the wrapper: every class in the subtree, because a partial render
    // is still a loyalty UI. The two always-rendered class-only hooks
    // (.payment-loyalty-label / -value, plus -balance and the affordance) are
    // named here rather than counted, so a re-parented div cannot slip past.
    for (const cls of ['.payment-loyalty-balance', '.payment-loyalty-label',
      '.payment-loyalty-value', '.payment-loyalty-redeem-btn']) {
      expect(qs(cls), cls + ' must not exist unlicensed').toBeNull();
    }
    expect(document.body.textContent, 'no points text of any kind').not.toContain('Points');
  });

  it('L15 the same props with loyaltyOffered DO render, so L14 measures the gate', async () => {
    await renderInAct(withFluent(child(true), salesFtl));

    expect(section()).not.toBeNull();
    // .ftl :165 payment-loyalty-points-label = Points, and points 0 reads
    // 'Points: 0'. The panel is mounted and rendering, so L14's null cannot be
    // satisfied by a child that simply always returns null.
    expect(qs<HTMLElement>('.payment-loyalty-label')!.textContent).toBe('Points: 0');
    // pointsWorthMinor null is the pending read-out, never a raw minor integer.
    expect(qs<HTMLElement>('.payment-loyalty-value')!.textContent).not.toMatch(/\d/);
    // points 0 hides Use Points on its OWN rule (the balance row's points > 0),
    // not via the gate - do not read this line as the gate working.
    expect(qs('.payment-loyalty-redeem-btn')).toBeNull();
  });

  // ── The gate measured on the BRIDGE, not on the DOM ───────────────────
  //
  // L1-L13 ask what an unlicensed tenant SEES; nobody asked what it SPENDS.
  // The account read sits behind `if (selectedCustomer)` only
  // (PaymentModal.tsx:421-426), so attaching a customer while LOYALTY_PROGRAM is
  // off still costs a getLoyaltyAccount round-trip - and, through the account it
  // hands back, the getPointsValue valuation at :442-448 as well. This is the
  // assertion L1 used to make backwards: L1 waited for mockGetLoyaltyAccount TO
  // be called with the feature off, i.e. the suite had the unlicensed fetch
  // written down as expected behaviour rather than as a defect.

  it('L16 an unlicensed tenant spends no loyalty IPC, with a customer attached', async () => {
    flags.loyalty = false;
    await open();                       // customer attached, 500 points on offer
    await waitFor(() => expect(settle()).toBeInTheDocument());

    // The licence is the only thing withholding loyalty in this input, so a
    // call here is the entitlement paying for a read the UI is never allowed to
    // use. Mocked at the api layer, which is where the modal's own IPC starts.
    expect(mockGetLoyaltyAccount, 'getLoyaltyAccount on an unlicensed tenant').not.toHaveBeenCalled();
    expect(mockGetPointsValue, 'its valuation follows the account, so neither').not.toHaveBeenCalled();
    expect(section()).toBeNull();
  });
});

