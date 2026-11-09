import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  usePosHeldCarts,
  type UsePosHeldCartsParams,
} from '@/features/sales/hooks/usePosHeldCarts';
import {
  resetMemoryLeasesForTest,
  useTabLeases,
} from '@/features/sales/hooks/useTabLeases';

// ── Resuming a tab must not silently steal another terminal's lease ─────────
//
// The lease machinery exists to warn before two terminals write the same table's
// order. `CartPanel.tsx:776` renders the warning and its Take Over button when
// `getConflict(activeOpenBillId)` is non-null, and the covering spec is
// `e2e/restaurant-tab-conflict.spec.ts`, which drives the takeover.
//
// ⚠️ THE RESUME PATH BYPASSED ALL OF IT. `handleResumeOpenBill` does:
//
//     setActiveOpenBillId(id);
//     await claimLease(id, data.tableNumber);      // <-- unconditional
//
// `claimLease` writes the lease with THIS terminal's id, so by the time the panel
// renders `getConflict` returns null — `useTabLeases.ts:197` discards a lease
// whose terminal is the current one. The warning therefore cannot appear on the
// one path where it matters most: resuming a tab someone else is working on.
//
// This case pins that the lease survives the resume, so the banner CAN appear.

import type * as SalesApi from '@/api/sales';

vi.mock('@/api/sales', async (importOriginal) => {
  const actual = await importOriginal<typeof SalesApi>();
  return {
    ...actual,
    listOpenBillsScoped: vi.fn(() => Promise.resolve([])),
    holdCartScoped: vi.fn(() => Promise.resolve({ id: 'held-1' })),
    getHeldCartScoped: vi.fn(() => Promise.resolve(heldCart)),
    deleteHeldCartScoped: vi.fn(() => Promise.resolve()),
  };
});

import { getHeldCartScoped } from '@/api/sales';

/** A held cart with one line, so the resume has something to restore. */
const heldCart = {
  id: 'bill-conflict',
  label: 'Table 8',
  cart_data: JSON.stringify({
    lines: [
      { sku: 'SKU-1', name: 'Mie Goreng', qty: 1, unit_price: { minor_units: 25000, currency: 'IDR' } },
    ],
    tableNumber: 'Table 8',
  }),
  item_count: 1,
  total_minor: 25000,
  currency: 'IDR',
  created_at: '2026-10-01T00:00:00Z',
  bill_type: 'open_bill',
  customer_name: null,
  deduction_location_id: null,
};

const addToast = vi.fn();
const noop = vi.fn();

const l10nRef = {
  current: { getString: (id: string) => '«' + id + '»' },
} as unknown as UsePosHeldCartsParams['l10nRef'];

function params(overrides: Partial<UsePosHeldCartsParams> = {}): UsePosHeldCartsParams {
  return {
    sessionToken: 'tok',
    addToast: addToast as unknown as UsePosHeldCartsParams['addToast'],
    l10nRef,
    activeShift: { id: 'sh-1' } as never,
    lines: [],
    subtotal: null,
    discountPercent: 0,
    discountLabel: '',
    setLines: noop as never,
    setDiscount: noop as never,
    setTableNumber: noop as never,
    setCustomerName: noop as never,
    setGuestCount: noop as never,
    setTipPercent: noop as never,
    setServiceCharge: noop as never,
    setOrderType: noop as never,
    resetCart: noop as never,
    setAppliedPromotions: noop as never,
    onDispatchKitchen: noop as never,
    ...overrides,
  };
}

describe('usePosHeldCarts — resuming a tab another terminal holds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMemoryLeasesForTest();
  });

  it('does NOT steal the lease on resume', async () => {
    const holder = renderHook(() => useTabLeases());

    // A GENUINELY FOREIGN lease, the way `useTabLeases.test.ts` creates one: a
    // broadcast event carrying another terminal's id. Calling `claimLease` from a
    // second hook would NOT be foreign — both instances read the same
    // `currentTerminalId`, so that is self-ownership and `getConflict` must (and
    // does) return null for it. That distinction is why this test is written with
    // the event rather than a second claimer.
    act(() => {
      window.dispatchEvent(
        new CustomEvent('kasirmu:tabs:lease-acquired', {
          detail: {
            tabId: 'bill-conflict',
            tableNumber: 'Table 8',
            terminalId: 'terminal-ipad-waiter',
            terminalName: 'Waiter iPad 1',
            timestamp: Date.now(),
            expiresAt: Date.now() + 60_000,
          },
        }),
      );
    });

    holder.rerender();
    const before = holder.result.current.getConflict('bill-conflict');
    expect(before, 'the seeding itself must register a conflict').not.toBeNull();
    expect(before?.terminalId).toBe('terminal-ipad-waiter');

    // Now resume the tab as THIS terminal — the ordinary operator action. Use a
    // second hook instance so the lease registry still sees the foreign owner.
    const { result } = renderHook(() => usePosHeldCarts(params()));
    await act(async () => {
      await result.current.handleResumeOpenBill('bill-conflict');
    });

    holder.rerender();
    expect(
      holder.result.current.getConflict('bill-conflict'),
      'resume stole the lease — the conflict banner can never appear',
    ).not.toBeNull();

    // ⚠️ AND THE RESUME STILL HAPPENED. The first fix REFUSED it, which measured as a
    // dead end in a browser (`resumed=false cartBanner=false toast=true tablesRow=0`):
    // the banner needs `activeOpenBillId` set, and the Tables screen holding the other
    // Take Over is feature-gated off for this profile. So refusing produced no route at
    // all, and the message pointed at a control nobody could reach.
    //
    // Resuming while leaving the foreign lease intact is what makes the banner BOTH
    // renderable and true. This assertion is what stops the refusal creeping back.
    expect(vi.mocked(getHeldCartScoped)).toHaveBeenCalledWith('tok', 'bill-conflict');

    // And the operator is told WHO holds it — the information they need to decide
    // between asking them to finish and taking over. The echo-stub l10n makes the key
    // observable, so this fails if the message is dropped or becomes a literal.
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('«pos-toast-tab-held-by-other»'),
        type: 'warning',
      }),
    );
  });

  it('still resumes instantly when nobody else holds the tab', async () => {
    // The over-correction case. A guard that blocked every resume would be the same
    // class of defect as the one above: a waiter unable to open a tab at all.
    const { result } = renderHook(() => usePosHeldCarts(params()));
    await act(async () => {
      await result.current.handleResumeOpenBill('bill-conflict');
    });

    // No refusal, and the cart was restored — the ordinary path is untouched.
    expect(addToast).not.toHaveBeenCalled();
    expect(vi.mocked(getHeldCartScoped)).toHaveBeenCalledWith('tok', 'bill-conflict');
  });
});
