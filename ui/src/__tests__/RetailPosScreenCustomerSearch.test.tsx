/**
 * CHARACTERIZATION TEST - RetailPosScreen's customer search (the F7 sheet).
 *
 * WHY THIS FILE EXISTS. RetailPosScreen.tsx:1057-1104 holds the same SHAPE the
 * payment modal held before 92e752666 - a roster in a ref, a second stored list
 * (customerSearchResults) written by an effect - and it was reported as carrying
 * the same defect. It does NOT, and the two facts below are the reason, which is
 * what this file pins so a later edit cannot quietly trade them away:
 *
 *   (A) the fetch's .then filters in the same statement it writes (:1070-1077):
 *       it reads customerSearchQueryRef.current (:1058-1059, kept in sync during
 *       render) and writes `!q ? customers : customers.filter(...)`. The modal's
 *       .then wrote the roster RAW, which is what let a refetch overwrite a live
 *       filter. R3 is the only case that can see this arm at all - the fetch has
 *       to land while a query is already in the input, so it holds the promise
 *       open, types, then resolves it.
 *   (B) the close path clears the query - :1296
 *       `useExitAnimation(showCustomerSearch, () => { setShowCustomerSearch(false);
 *       setCustomerSearchQuery(''); })`, and every route out of the sheet reaches
 *       it (Escape RetailModals.tsx:538, the Close button :582, the overlay click
 *       :537, onSelect :1683, onClear :1684). A filter therefore cannot survive a
 *       close, so the modal's precondition never arises. R2 pins it per route.
 *
 * THE DUPLICATION R2/R3 ARE GUARDING. The predicate exists TWICE, verbatim, at
 * :1072-1077 (the .then arm) and :1097-1102 (the keystroke arm). Nothing else in
 * the repo notices if one copy is deleted: R3 goes red only for the .then arm and
 * R4 only for the keystroke arm, because each is observable on a different
 * transition. That is the point of writing them separately.
 *
 * R1 states the relation both arms are supposed to satisfy - the visible rows are
 * ALWAYS f(whatever the input holds), never a snapshot of one query - walked over
 * name / email / phone / case / zero-match / whitespace, mirroring the modal's S4.
 *
 * Money law: this surface renders no currency, so no figure is asserted here.
 * NO class, id or data-testid was added to production markup for this file, and
 * nothing in RetailPosScreen.tsx or RetailModals.tsx was edited to make a case
 * pass. Selectors are the classes the screen already carries; the roster strings
 * are this file's own fixtures. The one piece of English asserted is 'No
 * customers found', read out of shared-ui/locales/sales.ftl:774 (retail-customer-
 * search-empty). Note RetailPosScreen is NOT registered in
 * screenExtraction.test.ts, so a class added here would have passed that
 * dead-class check invisibly - which is exactly why none was added.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/__tests__/test-utils/render';
import salesFtl from '@/locales/sales.ftl?raw';
import productsFtl from '@/locales/products.ftl?raw';
import tablesFtl from '@/locales/tables.ftl?raw';
import RetailPosScreen from '@/features/retail/RetailPosScreen';
import type { CustomerDto } from '@/api/customers';

// ── Harness: identical mock set to RetailPosScreenInteractions.test.tsx ──
vi.mock('@/features/sales/usePosState', async () => {
  const { createUsePosStateMock } = await import('@/__tests__/test-utils/mocks/usePosState');
  return { usePosState: vi.fn(() => createUsePosStateMock()) };
});
vi.mock('@/features/sales/useBarcodeScanner', async () => {
  const { createBarcodeScannerModuleMock } = await import('@/__tests__/test-utils/mocks/barcodeScanner');
  return createBarcodeScannerModuleMock();
});
vi.mock('@/api/products', async () => {
  const { createRetailProductsApiMock } = await import('@/__tests__/test-utils/mocks/retailPos');
  return createRetailProductsApiMock();
});
vi.mock('@/api/shifts', async () => {
  const { createShiftsApiMock } = await import('@/__tests__/test-utils/mocks/api');
  return createShiftsApiMock({ getActiveShiftScoped: vi.fn(() => Promise.reject(new Error('no shift'))) });
});
vi.mock('@/api/settings', async () => {
  const { createSettingsApiMock } = await import('@/__tests__/test-utils/mocks/api');
  return createSettingsApiMock({ getStoreSettings: vi.fn(() => Promise.resolve({
    name: 'TOKO TEST', address: 'Jl. Contoh No. 123', taxId: '', currency: 'IDR', branch: 'Cabang A', logo: '',
  })) });
});
vi.mock('@/api/hardware', async () => {
  const { createHardwareApiMock } = await import('@/__tests__/test-utils/mocks/api');
  return createHardwareApiMock();
});
vi.mock('@/api/sales', async () => {
  const { createSalesApiMock } = await import('@/__tests__/test-utils/mocks/api');
  return createSalesApiMock();
});
vi.mock('@/api/kds', async (importOriginal) => {
  const { createRetailKdsApiMock } = await import('@/__tests__/test-utils/mocks/retailPos');
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  return createRetailKdsApiMock(await importOriginal<typeof import('@/api/kds')>());
});
vi.mock('@/api/currency', async () => {
  const { createRetailCurrencyApiMock } = await import('@/__tests__/test-utils/mocks/retailPos');
  return createRetailCurrencyApiMock();
});
vi.mock('@/contexts/AuthContext', async () => {
  const { createAuthContextMock } = await import('@/__tests__/test-utils/mocks/contexts');
  return { useAuth: createAuthContextMock() };
});
vi.mock('@/contexts/WorkspaceContext', async () => {
  const { createWorkspaceContextMock } = await import('@/__tests__/test-utils/mocks/contexts');
  return createWorkspaceContextMock();
});

// listCustomersScoped is THIS file's own stub, reset per case: R3 needs to hold
// the promise open, which the shared createRetailCustomersApiMock (resolving [])
// cannot express.
const { mockList } = vi.hoisted(() => ({ mockList: vi.fn() }));
vi.mock('@/api/customers', () => ({
  listCustomersScoped: mockList,
  getCustomerScoped: vi.fn(() => Promise.resolve(null)),
  createCustomerScoped: vi.fn(),
  updateCustomerScoped: vi.fn(),
  deleteCustomerScoped: vi.fn(),
}));

const dto = (id: string, name: string, phone: string | null, email: string | null): CustomerDto =>
  ({ id, name, phone, email, notes: '', created_at: '', updated_at: '' });

// Names/phones/emails chosen so each of the three predicate arms is hit by a
// different keystroke, and so 'ad' -> 'a' separates filtering the FULL roster
// from filtering an already-narrowed list (2 then 4 vs 2 then 2).
const ADA = dto('c-ada', 'Ada', '555-0100', null);
const ADELAIDE = dto('c-ade', 'Adelaide', null, 'ade@example.com');
const AGNES = dto('c-ag', 'Agnes', '', '');
const BOB = dto('c-bob', 'Bob', null, 'bob@example.com');
const ROSTER: CustomerDto[] = [ADA, ADELAIDE, AGNES, BOB];

/**
 * The screen's predicate, copied from RetailPosScreen.tsx:1073-1076 (= :1098-1101)
 * on purpose: name folded, phone a CASE-SENSITIVE substring of the folded query,
 * email folded, and a trimmed-empty query meaning no filter at all. This is the
 * relation the rows must satisfy - not an expectation of one fixed answer.
 */
function expectRowsToMatchQuery(): void {
  const q = searchInput()!.value.trim().toLowerCase();
  expect(names(), 'rows must equal f(query) for the query in the input').toEqual(
    (!q ? ROSTER : ROSTER.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      (c.phone && c.phone.includes(q)) ||
      (c.email && c.email.toLowerCase().includes(q)))).map((c) => c.name),
  );
}

const qs = <T extends Element>(s: string): T | null => document.querySelector<T>(s);
const qsa = <T extends Element>(s: string): T[] => Array.from(document.querySelectorAll<T>(s));
const overlay = () => qs<HTMLElement>('.retail-customer-overlay');
const searchInput = () => qs<HTMLInputElement>('.retail-customer-search-input');
const rows = () => qsa<HTMLElement>('button.retail-customer-search-item');
const ghosts = () => qsa<HTMLElement>('.retail-customer-search-loading');
const names = () => rows().map((r) => r.querySelector('.retail-customer-search-item-name')!.textContent);
const closeBtn = () => qs<HTMLElement>('.retail-customer-close-btn');

async function mount(): Promise<void> {
  await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl);
  await waitFor(() => expect(screen.getByText('Indomie Goreng')).toBeInTheDocument());
}

async function openSheet(): Promise<void> {
  await userEvent.keyboard('{F7}');
  await waitFor(() => expect(overlay()).not.toBeNull());
}

async function openWithRoster(): Promise<void> {
  await mount();
  await openSheet();
  await waitFor(() => expect(rows()).toHaveLength(4));
}

function typeQuery(value: string): void {
  fireEvent.change(searchInput()!, { target: { value } });
}

beforeEach(() => {
  mockList.mockReset();
  mockList.mockResolvedValue(ROSTER);
});

describe('RetailPosScreen customer search - rows always match the query', () => {
  it('R1 the visible rows are f(query) at every step of a walk, over the FULL roster, with no refetch', async () => {
    await openWithRoster();
    expect(mockList).toHaveBeenCalledTimes(1);
    expect(rows()).toHaveLength(4);

    for (const step of ['ad', 'a', 'bob@example.com', 'BOB@EXAMPLE.COM', '555-0100', 'zzz', '   ', '']) {
      typeQuery(step);
      await waitFor(() => expect(searchInput()!.value).toBe(step));
      // The relation, not a number: whatever lands in the input, the list obeys it.
      expectRowsToMatchQuery();
      if (step === 'zzz') {
        // The zero-match state is the .ftl row, not a blank panel
        // (sales.ftl:774 retail-customer-search-empty).
        expect(qs<HTMLElement>('.retail-customer-search-empty')!.textContent).toBe('No customers found');
      }
      expect(ghosts(), 'a keystroke is not a fetch').toHaveLength(0);
      expect(mockList).toHaveBeenCalledTimes(1);
    }
  });

  it.each(['escape', 'close-button', 'overlay-click'] as const)(
    'R2 closing by %s clears the query, so a re-open starts unfiltered', async (how) => {
    await openWithRoster();
    typeQuery('ad');
    await waitFor(() => expect(rows()).toHaveLength(2));

    if (how === 'escape') fireEvent.keyDown(overlay()!, { key: 'Escape' });
    else if (how === 'close-button') fireEvent.click(closeBtn()!);
    else fireEvent.click(overlay()!);   // :537 dismisses only on target === currentTarget
    await waitFor(() => expect(overlay()).toBeNull());

    await openSheet();
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(searchInput()!.value, 'customerSearchQuery after close + reopen').toBe('');
    expectRowsToMatchQuery();
    expect(mockList).toHaveBeenCalledTimes(2);   // a re-open refetches (:1062 deps)
  });

  it('R3 a fetch that LANDS on a live query filters in the .then arm (:1070-1077)', async () => {
    let release: (found: CustomerDto[]) => void = () => {};
    mockList.mockImplementationOnce(() => new Promise<CustomerDto[]>((res) => { release = res; }));

    await mount();
    await openSheet();
    expect(ghosts(), 'loading read-out').toHaveLength(1);
    expect(rows(), 'no selectable row while the sheet loads').toHaveLength(0);

    // The keystroke arm cannot serve this: allCustomersRef is still empty, so
    // :1094 returns before writing anything. The ONLY thing that can filter this
    // roster is the predicate inside the fetch .then. While the sheet is in
    // flight there are no rows at all (:554 renders the loading read-out), which
    // is not the desync - the list is absent, not contradicting the input.
    typeQuery('ad');
    expect(rows(), 'in flight: no rows, so nothing to agree with the query').toHaveLength(0);

    await act(async () => { release(ROSTER); });

    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(names()).toEqual(['Ada', 'Adelaide']);
    expect(searchInput()!.value, 'the query the fetch landed on').toBe('ad');
    expectRowsToMatchQuery();
    expect(ghosts()).toHaveLength(0);
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it('R4 a keystroke with no fetch in flight filters in the effect arm (:1091-1104)', async () => {
    await openWithRoster();
    expect(mockList).toHaveBeenCalledTimes(1);

    typeQuery('ad');
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(names()).toEqual(['Ada', 'Adelaide']);
    expectRowsToMatchQuery();

    // Widen again off the same roster: proves the effect arm reads the FULL
    // customers list, not the narrowed results it just wrote.
    typeQuery('a');
    await waitFor(() => expect(rows()).toHaveLength(4));
    expectRowsToMatchQuery();
    expect(mockList).toHaveBeenCalledTimes(1);
  });
});
