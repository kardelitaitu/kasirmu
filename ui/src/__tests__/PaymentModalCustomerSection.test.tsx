/**
 * CHARACTERIZATION TEST - the customer surface of PaymentModal: the badge row
 * and the customer-search overlay.
 *
 * Anchors re-derived against THIS checkout by measurement, not copied from the
 * census (whose numbers were stale the moment it wrote them):
 *
 *   file length            1866 lines (1,858 when first written; census said 1,912)
 *   badge region           .payment-customer-section      :1669-:1708  (40)
 *   search overlay         {showCustomerSearch && (...)}  :1758-:1831  (74)
 *   its three useState     customerSearchQuery    :174
 *                          customerRoster         :179   <- replaced the old
 *                          loadingCustomers       :180      customerSearchResults
 *                                                                ATOM; there is no
 *                          second stored list any more (92e752666)
 *   the filter is a MEMO   customerSearchResults = useMemo over
 *                          [customerRoster, customerSearchQuery]  :379-:391
 *                          (it WAS a useEffect; the effect is gone, see below)
 *   its one list effect    listCustomers fetch (scoped IPC) :350-:369
 *   deps it shares         showCustomerSearch :140   selectedCustomer :139
 *                          notifyCustomerChange :152   (allCustomersRef :177 is DELETED)
 *                          useFocusTrap inner   :1117  outer-trap guard :1113
 *
 * HOW TO READ THESE ANCHORS - one rule for the whole file: every pointer names its
 * SYMBOL first and the line second, because a bare line number into PaymentModal.tsx
 * goes stale within the hour while an extraction lane works in it. 92e752666 alone
 * moved these by eight and deleted two of them. A line without a symbol beside it is
 * not a pointer, it is a timestamp. Re-derive with grep -n before acting, and read a
 * no-match as the anchor aging, not as the code being absent.
 *
 * WHAT ALREADY COVERED THIS REGION BEFORE THIS FILE EXISTED - the blanket
 * blind verdict is only half true. PaymentModalEdgeCases.test.tsx renders it in
 * eight cases (anchors at time of writing):
 *   :538  does not use the legacy global customer list without a session token
 *   :557  uses the session-scoped customer list when a session token is present
 *   :578  closes customer search when Escape is pressed
 *   :604  closes customer search when Cancel is clicked
 *   :630  selects a customer from search and shows badge
 *   :803  removes selected customer when remove button is clicked
 *   :851  shows customer search when Change button is clicked on selected customer
 *   :908  closes customer search when clicking outside modal overlay
 * PaymentModalSaleFlow.test.tsx covers NONE of it: its 33 cases are receipt,
 * attempt-id, QRIS, EDC and tender-rail cases, and customer appears there only
 * inside two comments. Loyalty and SplitBalance pass a customer IN as a prop and
 * never touch the region. So every case below is a gap, not a duplicate: the
 * in-flight transition and its failure path, the client-side filter (which is
 * the whole reason a second keystroke can widen again), the focus handoff, the
 * guard that stops Escape from cancelling the modal underneath the overlay, the
 * item-detail conditional, and - the point of the file - what a selection or a
 * removal changes OUTSIDE the region: the loyalty panel, Total Due, and the
 * customerId on the complete_sale_scoped payload. EdgeCases asserts that a badge
 * appeared; nothing before this file asserted the customer reached checkout.
 *
 * FINDING (why one S2 assertion looks fussy): the loading skeleton reuses the
 * ITEM class - payment-customer-search-item at :1790 for the ghost rows and
 * :1804 for the real buttons - so an unqualified query counts three phantom rows
 * while the fetch is in flight. S2 pins both counts so nobody simplifies the
 * query and silently merges the two states. NO class or data-testid was added to
 * production markup for this file; everything is reached through selectors and
 * strings that already exist. (The hazard the brief names is real: PaymentModal
 * is not registered in screenExtraction.test.ts, so a new class would have
 * passed that dead-class check invisibly.)
 *
 * Money law observed: every fixture is an INTEGER of MINOR units, and every
 * expected figure comes from the SAME production formatter the component calls
 * (formatMoney from types/domain) - no float money, no literal currency string.
 *
 * English asserted here was read out of shared-ui/locales/sales.ftl:
 *   :157 payment-cancel                        = Cancel
 *   :161 payment-customer-change              = Change
 *   :162 payment-customer-select              = Select Customer
 *   :163 payment-customer-remove-aria          = Remove customer
 *   :167 payment-customer-search-heading       = Select Customer
 *   :168 payment-customer-search-empty         = No customers found
 *   :174 payment-toast-customers-failed        = Failed to load customers
 *   :180 payment-search-customers-aria         = Search customers
 *   :181 payment-search-customers-placeholder  = Search by name, phone, or email...
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderInAct } from '@/test-utils/renderInAct';
import { withFluent } from '@/i18n/test-utils';
import { ToastProvider } from '@/components/Toast';
import salesFtl from '@/locales/sales.ftl?raw';
import PaymentModal from '@/features/sales/PaymentModal';
import { formatMoney, type CartLine, type LineId, type Money, type Sku } from '@/types/domain';
import type { CustomerDto } from '@/api/customers';
import type { LoyaltyAccountWithDetails } from '@/api/loyalty';
import type { CompleteSaleScopedArgs } from '@/api/sales';

const { flags, invokeMock, mockList, mockGetLoyaltyAccount, mockGetPointsValue, mockRedeem } = vi.hoisted(() => ({
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
  mockList: vi.fn(),
  mockGetLoyaltyAccount: vi.fn(),
  mockGetPointsValue: vi.fn(),
  mockRedeem: vi.fn(),
}));

// Single-currency harness on purpose: with MULTI_CURRENCY off, useMultiCurrency
// issues no IPC and cartCurrency === total.currency, so convertToChargeCurrency
// is the identity and every money figure below is the fixture's own minors.
// LOYALTY stays ON - it is the outside-region surface this file reads the
// customer state through (L9's method, pointed the other way).
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
  listCustomers: vi.fn(),
  listCustomersScoped: mockList,
}));

vi.mock('@/api/loyalty', () => ({
  getLoyaltyAccount: mockGetLoyaltyAccount,
  getPointsValue: mockGetPointsValue,
  redeemLoyaltyPoints: mockRedeem,
}));

const TOKEN = '***';
/** 1 point = 4 minor units - not 1, so a mixed-up argument reads as a wrong number. */
const MINOR_PER_POINT = 4;

// -- fixtures: MINOR units, integers only ---------------------------
const usd = (minor: number): Money => ({ minor_units: minor, currency: 'USD' });
/** The same call the component makes - the expectation cannot drift from it. */
const money = (minor: number): string => formatMoney(usd(minor));

const line: CartLine = {
  id: 'line-1' as LineId,
  sku: 'COFFEE' as Sku,
  name: 'Coffee',
  qty: 1,
  unit_price: usd(10000),
};

const dto = (id: string, name: string, phone: string | null, email: string | null): CustomerDto =>
  ({ id, name, phone, email, notes: '', created_at: '', updated_at: '' });

// Chosen so the walk 'ad' -> 'a' -> 'zz' separates filtering over the FULL set
// (2 then 4) from filtering over the already-narrowed results (2 then 2 then 0).
const ADA = dto('cust-ada', 'Ada', '555-0100', null);
const ADELAIDE = dto('cust-ade', 'Adelaide', null, 'ade@example.com');
const AGNES = dto('cust-ag', 'Agnes', '', '');
const BOB = dto('cust-bob', 'Bob', null, 'bob@example.com');
const PEOPLE: CustomerDto[] = [ADA, ADELAIDE, AGNES, BOB];

function account(points: number): LoyaltyAccountWithDetails {
  return {
    account: {
      id: 'la-1', customer_id: ADA.id, points, lifetime_points: points,
      tier_id: null, updated_at: '', created_at: '',
    },
    tier: null, recent_transactions: [], next_tier: null, points_to_next_tier: 0,
  };
}

beforeEach(() => {
  invokeMock.mockClear();
  mockList.mockReset();
  mockGetLoyaltyAccount.mockReset();
  mockGetPointsValue.mockReset();
  mockRedeem.mockReset();
  flags.loyalty = true;
  // Baseline: a full roster, and nobody holding a loyalty account. An undefined
  // mock return would make the component's .then chain throw inside an effect,
  // so null is the default rather than a skipped stub.
  mockList.mockResolvedValue(PEOPLE);
  mockGetLoyaltyAccount.mockResolvedValue(null);
});
/**
 * selectedCustomer is OMITTED entirely unless supplied (exactOptionalPropertyTypes
 * is on): that is precisely the uncontrolled state the :328-:333 branch reacts to.
 */
function modal(opts: { customer?: CustomerDto; onCustomerChange?: (c: CustomerDto | null) => void; onClose?: () => void } = {}) {
  return (
    <ToastProvider>
      <PaymentModal
        open
        sessionToken={TOKEN}
        {...(opts.customer ? { selectedCustomer: opts.customer } : {})}
        {...(opts.onCustomerChange ? { onCustomerChange: opts.onCustomerChange } : {})}
        lineItems={[line]}
        total={usd(10000)}
        userId="test-user-id"
        onComplete={vi.fn()}
        onClose={opts.onClose ?? vi.fn()}
      />
    </ToastProvider>
  );
}

async function render(opts: Parameters<typeof modal>[0] = {}) {
  await renderInAct(withFluent(modal(opts), salesFtl));
}

const qs = <T extends Element>(selector: string): T | null => document.querySelector<T>(selector);
const qsa = <T extends Element>(selector: string): T[] => Array.from(document.querySelectorAll<T>(selector));

const section = () => qs<HTMLElement>('.payment-customer-section');
const badge = () => qs<HTMLElement>('.payment-customer-badge');
const selectBtn = () => qs<HTMLElement>('.payment-customer-select-btn')!;
const changeBtn = () => qs<HTMLElement>('.payment-customer-change')!;
const removeBtn = () => qs<HTMLElement>('.payment-customer-remove')!;
const overlay = () => qs<HTMLElement>('.payment-customer-search-overlay');
const panel = () => qs<HTMLElement>('.payment-customer-search-modal');
const searchInput = () => qs<HTMLInputElement>('.payment-customer-search-input');
const rows = () => qsa<HTMLElement>('button.payment-customer-search-item');
const ghosts = () => qsa<HTMLElement>('.payment-customer-search-list-skeleton .payment-customer-search-item');
const rowNames = () => rows().map((r) => r.querySelector('.payment-customer-search-item-name')!.textContent);
const totalAmount = () => qs<HTMLElement>('.payment-total-amount');
const loyaltySection = () => qs<HTMLElement>('.payment-loyalty-section');
function settle(): HTMLButtonElement {
  return screen.getByTestId('settle-button') as HTMLButtonElement;
}

async function openSearchViaButton() {
  fireEvent.click(selectBtn());
  await waitFor(() => expect(overlay()).not.toBeNull());
}

async function openCustomerSearch() {
  await render();
  await openSearchViaButton();
  await waitFor(() => expect(rows().length).toBeGreaterThan(0));
}

function typeQuery(value: string): void {
  expect(searchInput(), 'customer search input').not.toBeNull();
  fireEvent.change(searchInput()!, { target: { value } });
}

async function pick(who: CustomerDto): Promise<void> {
  const row = rows().find((r) => r.textContent?.includes(who.name));
  expect(row, 'search row for ' + who.name).not.toBeUndefined();
  fireEvent.click(row!);
  await waitFor(() => expect(overlay()).toBeNull());
}

/** Tender that exactly covers the payable, typed into the real cash input. */
async function tenderFull(): Promise<void> {
  const tender = qs<HTMLInputElement>('.payment-tendered-input');
  expect(tender, 'cash tender input').not.toBeNull();
  fireEvent.change(tender!, { target: { value: '100' } });   // 100.00 -> 10000 minors
  await waitFor(() => expect(settle()).toBeEnabled());
}

/** loggedInvoke(cmd, { sessionToken, args }) - the args sit under .args. */
function completeSaleArgs(): CompleteSaleScopedArgs[] {
  return (invokeMock.mock.calls as unknown as Array<[string, { args?: CompleteSaleScopedArgs }]>)
    .filter((c) => c[0] === 'complete_sale_scoped')
    .map((c) => c[1]!.args as CompleteSaleScopedArgs);
}

describe('PaymentModal customer section + search overlay (characterization)', () => {
  it('S1 the badge shows the customer it was handed, and reads its labels from the bundle', async () => {
    await render({ customer: ADA });
    expect(section(), 'the badge region always renders').not.toBeNull();
    expect(badge(), '.payment-customer-badge').not.toBeNull();
    // :1667 - the name is the badge's only content claim; no earlier test read it.
    expect(qs<HTMLElement>('.payment-customer-name')!.textContent).toBe('Ada');
    expect(selectBtn()).toBeNull();
    expect(changeBtn().textContent).toBe('Change');                           // .ftl :161
    expect(removeBtn().getAttribute('aria-label')).toBe('Remove customer');     // .ftl :163
    // The overlay is gated on showCustomerSearch (:1750): absent until opened.
    expect(overlay()).toBeNull();
    // ...and the list IPC is gated the same way (:348) - opening the modal is free.
    expect(mockList).not.toHaveBeenCalled();
    // And the badge's state is the shared one: :417 already asked for Ada.
    await waitFor(() => expect(mockGetLoyaltyAccount).toHaveBeenCalledWith(TOKEN, 'cust-ada'));

  });

  it('S1b with no customer at all, the section offers only the Select Customer button', async () => {
    await render();
    expect(section()).not.toBeNull();
    expect(badge()).toBeNull();
    expect(selectBtn().textContent).toBe('Select Customer');    // .ftl :162
    expect(qs('.payment-customer-change')).toBeNull();
    expect(qs('.payment-customer-remove')).toBeNull();
    expect(qsa('.payment-customer-search-item')).toHaveLength(0);
    expect(mockList).not.toHaveBeenCalled();
    expect(mockGetLoyaltyAccount).not.toHaveBeenCalled();
  });

  it('S2 opening fires the scoped list IPC once and shows a skeleton while in flight', async () => {
    let release: (found: CustomerDto[]) => void = () => {};
    mockList.mockImplementation(() => new Promise<CustomerDto[]>((res) => { release = res; }));

    await render();
    await openSearchViaButton();

    // The round trip itself: exactly one scoped call, with THIS session's token.
    expect(mockList).toHaveBeenCalledTimes(1);
    expect(mockList).toHaveBeenCalledWith(TOKEN);

    // In flight: three ghost rows, no real row, and NOT the empty state.
    expect(qs('.payment-customer-search-list-skeleton'), 'loading skeleton').not.toBeNull();
    expect(ghosts()).toHaveLength(3);                                        // :1781 Array length 3
    expect(rows(), 'no selectable row may exist while the list loads').toHaveLength(0);
    // FINDING: the ghost rows carry the real item class, so an unqualified query
    // counts 3 here. An extraction that drops the skeleton keeps THAT true, which
    // is why the button-scoped count and the empty state are pinned separately.
    expect(qsa('.payment-customer-search-item')).toHaveLength(3);
    expect(qs('.payment-customer-search-empty'), 'No customers found during load').toBeNull();
    expect(overlay()!.getAttribute('role')).toBe('dialog');
    expect(searchInput()!.value).toBe('');

    await act(async () => { release(PEOPLE); });

    // Settled: skeleton gone, four real rows in roster order.
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(qs('.payment-customer-search-list-skeleton')).toBeNull();
    expect(qsa('.payment-customer-search-item')).toHaveLength(4);
    expect(rowNames()).toEqual(['Ada', 'Adelaide', 'Agnes', 'Bob']);
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it('S3 a failed list read says so, clears the in-flight state, falls back to empty', async () => {
    mockList.mockRejectedValue(new Error('boom'));
    await render();
    await openSearchViaButton();

    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(1));
    // :363 - one toast on the error channel, with the .ftl copy.
    await waitFor(() => expect(qs('.toast--error')).not.toBeNull());
    expect(qs<HTMLElement>('.toast__message')!.textContent).toBe('Failed to load customers');  // .ftl :174
    // The finally at :364 cleared loadingCustomers: no skeleton, no ghost rows.
    await waitFor(() => expect(qs('.payment-customer-search-list-skeleton')).toBeNull());
    expect(ghosts()).toHaveLength(0);
    expect(rows()).toHaveLength(0);
    // ...and the empty row renders, so the panel is never silently blank.
    expect(qs<HTMLElement>('.payment-customer-search-empty')!.textContent).toBe('No customers found');  // .ftl :168
    // The failure stayed inside the overlay: modal and total are intact.
    expect(overlay()).not.toBeNull();
    expect(totalAmount()!.textContent).toBe(money(10000));
  });

  it('S4 the filter is client-side over the FULL list, so a second keystroke widens again', async () => {
    await openCustomerSearch();
    expect(mockList).toHaveBeenCalledTimes(1);

    typeQuery('ad');
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rowNames()).toEqual(['Ada', 'Adelaide']);

    // Widen back out. A filter rewritten against the narrowed RESULTS state
    // instead of allCustomersRef (:369) sticks at 2 forever - this walk is why.
    typeQuery('a');
    await waitFor(() => expect(rows()).toHaveLength(4));

    // Phone and email are searched too (:377-:379), and the query is folded.
    typeQuery('bob@example.com');
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rowNames()).toEqual(['Bob']);
    typeQuery('BOB@EXAMPLE.COM');
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rowNames()).toEqual(['Bob']);
    typeQuery('555-0100');
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rowNames()).toEqual(['Ada']);

    // Zero matches -> the .ftl empty row, not a blank panel.
    typeQuery('zzz');
    await waitFor(() => expect(rows()).toHaveLength(0));
    expect(qs<HTMLElement>('.payment-customer-search-empty')!.textContent).toBe('No customers found');
    expect(qsa('.payment-customer-search-list-skeleton')).toHaveLength(0);

    // Whitespace counts as no query at all (the memo q-trim :381-:383) and the roster returns.
    typeQuery('   ');
    await waitFor(() => expect(rows()).toHaveLength(4));

    // The whole walk cost no extra IPC: narrowing never re-fetches.
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it('S5 the overlay takes the focus handoff, and Escape closes it WITHOUT closing the modal', async () => {
    const onClose = vi.fn();
    await render({ onClose });
    await openSearchViaButton();

    // :1117 useFocusTrap(customerSearchPanelRef, showCustomerSearch) focuses the first reachable element, the input.
    await waitFor(() => expect(document.activeElement).toBe(searchInput()));
    expect(searchInput()!.getAttribute('aria-label')).toBe('Search customers');                      // .ftl :180
    expect(searchInput()!.getAttribute('placeholder')).toBe('Search by name, phone, or email...');    // .ftl :181
    expect(panel()!.getAttribute('aria-modal')).toBe('true');
    expect(panel()!.getAttribute('aria-label')).toBe('Select Customer');                              // .ftl :167
    expect(qs<HTMLElement>('.payment-customer-search-heading')!.textContent).toBe('Select Customer');

    typeQuery('ad');
    await waitFor(() => expect(rows()).toHaveLength(2));

    // :1113 - the OUTER trap (useFocusTrap on panelRef) is still mounted, and its !showCustomerSearch term is
    // the only thing keeping this keypress from cancelling the whole payment.
    fireEvent.keyDown(panel()!, { key: 'Escape' });
    await waitFor(() => expect(overlay()).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    expect(qs('.payment-overlay'), 'the payment modal must survive').not.toBeNull();
    expect(settle()).toBeInTheDocument();
    expect(badge(), 'no customer was selected, so no badge').toBeNull();
    expect(totalAmount()!.textContent).toBe(money(10000));

    // Reopening re-fetches the roster (the fetch effect dep :369 keys on showCustomerSearch).
    await openSearchViaButton();
    expect(mockList).toHaveBeenCalledTimes(2);
    // FINDING 1: the typed query SURVIVES an Escape close - nothing on the close
    // path clears it (:1765 the overlay keydown, :1823 the Cancel button and
    // :1117 the inner trap all only flip the flag). Only a SELECTION (:1808) or a
    // fresh modal open (:325) resets it.
    expect(searchInput()!.value).toBe('ad');
    // FINDING 2 WAS A DEFECT, and this commit fixes it, so the pin below is
    // INVERTED rather than preserved. The rows used to be a second stored list:
    // the fetch's .then wrote the FULL roster into customerSearchResults while the
    // filter effect did not re-run, because neither of its two deps had changed -
    // input 'ad', list four rows, until the next keystroke. The rendered rows are
    // now derived from (roster, query), so that pair is unrepresentable: the list
    // has to match the filter the input still carries.
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rowNames()).toEqual(['Ada', 'Adelaide']);
    expect(searchInput()!.value, 'input and list must agree after the re-open').toBe('ad');
    // Finding 1 stands: nothing on any close path clears the query, and a
    // surviving filter is the behaviour - this is the case that says so.
  });

  it('S6 COUPLING: selecting a found customer moves the badge, the loyalty read and the sale payload', async () => {
    const onChange = vi.fn();
    await render({ onCustomerChange: onChange });
    await openSearchViaButton();
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(mockGetLoyaltyAccount).not.toHaveBeenCalled();

    await pick(ADELAIDE);

    // Inside the region: the badge replaced the button, with the chosen name.
    expect(qs<HTMLElement>('.payment-customer-name')!.textContent).toBe('Adelaide');
    // The parent was told, and told the WHOLE record - not just the name.
    // FINDING: for an UNCONTROLLED host (no selectedCustomer prop) the open-reset
    // at :331-:333 reports null first, so the callback sequence is null -> picked.
    // A panel move that drops that one line changes this count, which is the point.
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenNthCalledWith(1, null);
    expect(onChange).toHaveBeenNthCalledWith(2, ADELAIDE);
    // OUTSIDE the region: :417 asks for THIS customer's loyalty account.
    await waitFor(() => expect(mockGetLoyaltyAccount).toHaveBeenCalledWith(TOKEN, 'cust-ade'));

    // And checkout carries it: :971 puts customerId on the complete call.
    await tenderFull();
    expect(totalAmount()!.textContent).toBe(money(10000));   // a customer is not a discount
    fireEvent.click(settle());
    await waitFor(() => expect(completeSaleArgs()).toHaveLength(1));
    expect(completeSaleArgs()[0]!.customerId).toBe('cust-ade');
  });

  it('S7 selecting clears the query, so the next opening offers the full roster', async () => {
    await openCustomerSearch();
    expect(rows()).toHaveLength(4);

    typeQuery('ad');
    await waitFor(() => expect(rows()).toHaveLength(2));
    await pick(ADA);
    expect(qs<HTMLElement>('.payment-customer-name')!.textContent).toBe('Ada');

    // :1800 setCustomerSearchQuery('') - drop it and this reopening offers two
    // rows under a stale 'ad', the classic stale value a panel move leaves behind.
    fireEvent.click(changeBtn());
    await waitFor(() => expect(overlay()).not.toBeNull());
    expect(searchInput()!.value).toBe('');
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it('S8 COUPLING: removing a customer takes the loyalty panel, discount and payload id', async () => {
    const onChange = vi.fn();
    mockGetLoyaltyAccount.mockImplementation(async (_t: string, id: string) => (id === ADA.id ? account(500) : null));
    mockGetPointsValue.mockImplementation(async (_t: string, p: number) => Math.floor(p / MINOR_PER_POINT));
    await render({ customer: ADA, onCustomerChange: onChange });

    // The panel is the proof the badge state is shared with the whole modal.
    await waitFor(() => expect(loyaltySection()).not.toBeNull());
    fireEvent.click(await screen.findByRole('button', { name: /^use points$/i }));
    const pts = qs<HTMLInputElement>('.payment-loyalty-input');
    expect(pts, 'loyalty input').not.toBeNull();
    expect(pts!.value).toBe('500');
    fireEvent.change(pts!, { target: { value: '250' } });
    const discount = Math.floor(250 / MINOR_PER_POINT);
    await waitFor(() => expect(totalAmount()!.textContent).toBe(money(10000 - discount)));
    expect(qs<HTMLElement>('.payment-loyalty-discount-label')!.textContent).toBe('Discount: -' + money(discount));

    fireEvent.click(removeBtn());
    await waitFor(() => expect(badge()).toBeNull());
    expect(selectBtn().textContent).toBe('Select Customer');
    expect(onChange).toHaveBeenCalledWith(null);

    // OUTSIDE the region: :426-:430 tear the account AND the discount down.
    // A selectedCustomer copy left inside the badge keeps both of them alive.
    await waitFor(() => expect(loyaltySection()).toBeNull());
    await waitFor(() => expect(totalAmount()!.textContent).toBe(money(10000)));

    await tenderFull();
    fireEvent.click(settle());
    await waitFor(() => expect(completeSaleArgs()).toHaveLength(1));
    expect(completeSaleArgs()[0]!.customerId, 'a removed customer must not reach the sale').toBeUndefined();
  });

  it('S9 COUPLING: replace-not-remove keeps the LAST customer, and its account read, on the sale', async () => {
    mockGetLoyaltyAccount.mockImplementation(async (_t: string, id: string) => (id === ADA.id ? account(500) : null));
    mockGetPointsValue.mockImplementation(async (_t: string, p: number) => Math.floor(p / MINOR_PER_POINT));
    await openCustomerSearch();

    await pick(ADA);
    await waitFor(() => expect(loyaltySection()).not.toBeNull());   // Ada holds the account
    await tenderFull();

    fireEvent.click(changeBtn());
    await waitFor(() => expect(overlay()).not.toBeNull());
    await waitFor(() => expect(rows()).toHaveLength(4));
    await pick(AGNES);

    // Visible inside the region...
    expect(qs<HTMLElement>('.payment-customer-name')!.textContent).toBe('Agnes');
    // ...and outside it: Agnes has no account, so the panel must be gone, not Ada's.
    await waitFor(() => expect(loyaltySection()).toBeNull());
    await waitFor(() => expect(mockGetLoyaltyAccount).toHaveBeenLastCalledWith(TOKEN, 'cust-ag'));
    expect(totalAmount()!.textContent).toBe(money(10000));

    fireEvent.click(settle());
    await waitFor(() => expect(completeSaleArgs()).toHaveLength(1));
    expect(completeSaleArgs()[0]!.customerId).toBe('cust-ag');
  });

  it('S10 the item detail row is conditional, and phone wins over email', async () => {
    const BOTH = dto('cust-both', 'Ada Both', '555-9999', 'both@example.com');
    mockList.mockResolvedValue([ADA, ADELAIDE, BOTH, AGNES]);
    await openCustomerSearch();
    expect(rows()).toHaveLength(4);

    function detailOf(name: string): HTMLElement | null {
      const row = rows().find((r) => r.querySelector('.payment-customer-search-item-name')?.textContent === name);
      expect(row, 'row for ' + name).not.toBeUndefined();
      return row!.querySelector<HTMLElement>('.payment-customer-search-item-detail');
    }

    expect(detailOf('Ada')!.textContent).toBe('555-0100');
    expect(detailOf('Adelaide')!.textContent).toBe('ade@example.com');
    // :1804 (c.phone || c.email) - phone first when both are set...
    expect(detailOf('Ada Both')!.textContent).toBe('555-9999');
    // ...and no detail node at all for a customer with neither.
    expect(detailOf('Agnes')).toBeNull();
    expect(rowNames()).toEqual(['Ada', 'Adelaide', 'Ada Both', 'Agnes']);
  });

  it('S11 Cancel closes the search, and a click on the panel is not a click through it', async () => {
    const onClose = vi.fn();
    await render({ customer: ADA, onClose });
    await waitFor(() => expect(badge()).not.toBeNull());
    fireEvent.click(changeBtn());
    await waitFor(() => expect(overlay()).not.toBeNull());

    // :1756 - the dismiss guard is e.target === e.currentTarget. Widen it to a
    // bare onClick and this click dismisses the overlay out from under the typist.
    typeQuery('ad');
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(panel()!);
    expect(overlay(), 'a click inside the panel must not dismiss it').not.toBeNull();
    expect(rows()).toHaveLength(2);

    const close = panel()!.querySelector<HTMLElement>('.payment-customer-search-close')!;
    expect(close.textContent).toBe('Cancel');                 // .ftl :157
    fireEvent.click(close);
    await waitFor(() => expect(overlay()).toBeNull());

    expect(onClose).not.toHaveBeenCalled();
    expect(qs('.payment-overlay')).not.toBeNull();
    // The customer the search was opened for is untouched by the cancel.
    expect(qs<HTMLElement>('.payment-customer-name')!.textContent).toBe('Ada');
    expect(totalAmount()!.textContent).toBe(money(10000));
  });
});
