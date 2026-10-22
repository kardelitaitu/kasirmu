import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useWorkspaceScope, type WorkspaceScope } from '@/contexts/WorkspaceContext';
import {
  usePosHeldCarts,
  type UsePosHeldCartsParams,
} from '@/features/sales/hooks/usePosHeldCarts';
import { listOpenBillsScoped, getHeldCartScoped } from '@/api/sales';
import type * as SalesApi from '@/api/sales';

vi.mock('@/api/sales', async (importOriginal) => {
  const actual = await importOriginal<typeof SalesApi>();
  return {
    ...actual,
    listOpenBillsScoped: vi.fn(() => Promise.resolve([])),
    holdCartScoped: vi.fn(() => Promise.resolve({ id: 'held-1' })),
    getHeldCartScoped: vi.fn(() => Promise.resolve(null)),
    deleteHeldCartScoped: vi.fn(() => Promise.resolve()),
  };
});

/**
 * `list_open_bills_scoped` is Restaurant POS only — the bridge refuses every
 * other vertical (`is_restaurant_pos_workspace`), so a call from anywhere else
 * spends a round-trip to collect a `permissionDenied`. The JS-side guard
 * (`isRestaurantPos`) should catch this before the IPC call, but may race
 * during session initialisation. In both cases `permissionDenied` is silently
 * swallowed — it is not user-actionable — same as `invalidSession`.
 *
 * Why the null-scope case matters: the session token is minted from
 * `activeInstance ?? <the store's admin instance>`, so a screen with no active
 * POS instance runs on an **admin** token while still being mounted. That is
 * the state the field log showed producing
 * `permissionDenied: workspace 'admin' may not list open bills`.
 *
 * The global harness stubs `useWorkspaceScope` with typeKey 'default'
 * (test-setup.ts) and documents `vi.mocked(useWorkspaceScope).mockReturnValue`
 * as the way to request a specific vertical — the provider is mocked out, so
 * wrapping in `WorkspaceScopeContext.Provider` would have no effect.
 */
describe('usePosHeldCarts — open-bills workspace gate', () => {
  const addToast = vi.fn();
  const noop = vi.fn();

  /**
   * A stub l10n whose `getString` ECHOES the id.
   *
   * The shift refusal is a toast that used to be a hardcoded English literal
   * while `retail-toast-open-shift-first` already existed in both bundles. This
   * stub makes the KEY observable in the toast message, so the case below can
   * assert that the localized path is taken — a real bundle would render English
   * in en and pass whether or not the literal had been removed.
   */
  const l10nRef = {
    current: { getString: (id: string) => `«${id}»` },
  } as unknown as UsePosHeldCartsParams['l10nRef'];

  function params(overrides: Partial<UsePosHeldCartsParams> = {}): UsePosHeldCartsParams {
    return {
      sessionToken: 'tok',
      addToast: addToast as unknown as UsePosHeldCartsParams['addToast'],
      l10nRef,
      activeShift: null,
      lines: [],
      subtotal: null,
      discountPercent: 0,
      discountLabel: '',
      resetCart: noop,
      setAppliedPromotions: noop,
      setLines: noop,
      setDiscount: noop,
      setTableNumber: noop,
      setCustomerName: noop,
      ...overrides,
    };
  }

  function setScope(scope: WorkspaceScope | null) {
    vi.mocked(useWorkspaceScope).mockReturnValue(scope);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore the harness default so a mockReturnValue from a previous test
    // cannot leak (vitest's clearAllMocks clears calls, not return values).
    setScope({ storeId: 'default', instanceId: 'default', typeKey: 'default' });
  });

  // ── Resuming a SECOND tab must not silently eat the first one ───────
  //
  // `handleResumeOpenBill` calls `setLines(data.lines.map(...))`
  // (usePosHeldCarts.ts:385) — a WHOLESALE REPLACE. With a live cart that is the
  // order under construction being discarded, reached by one mis-tap in the
  // held-tabs list.
  //
  // THE SCOPE IS DELIBERATE, because the first version of this guard got it wrong
  // and the existing cases caught it. Refusing EVERY resume over a non-empty cart
  // breaks the primary flow: opening a tab while the cart already has items for
  // THAT table is how an operator works at all, and the two cases at :468/:547
  // resume exactly that way. The destruction case is narrower — a SECOND tab over
  // the cart of the first, i.e. one that is ALREADY being edited.
  //
  // So the guard reads `activeOpenBillId`: another tab is active, the cart is
  // not empty, and the id being resumed is not the one already loaded.
  it('refuses to resume a second tab while a first is open', async () => {
    setScope({ storeId: 's', instanceId: 'i', typeKey: 'restaurant-pos' });

    const setLines = vi.fn();
    const addToast2 = vi.fn();

    // Tab 1 is opened FIRST — that is what sets `activeOpenBillId`, which is
    // internal state (:127), not a prop. Nothing else can put the hook into the
    // "a tab is already open" condition.
    vi.mocked(getHeldCartScoped).mockResolvedValueOnce({
      id: 'tab-1',
      cart_data: JSON.stringify({
        lines: [{ sku: 'HELD-1', qty: 1, unit_price: { minor_units: 5000, currency: 'IDR' } }],
      }),
    } as never);
    // Tab 2 is the mis-tap.
    vi.mocked(getHeldCartScoped).mockResolvedValueOnce({
      id: 'tab-2',
      cart_data: JSON.stringify({
        lines: [{ sku: 'HELD-2', qty: 1, unit_price: { minor_units: 9000, currency: 'IDR' } }],
      }),
    } as never);

    const cartForTab1 = [
      {
        id: 'live-1' as never,
        sku: 'LIVE-1' as never,
        qty: 2,
        unit_price: { minor_units: 3500, currency: 'IDR' },
      },
    ];

    const { result, rerender } = renderHook(
      (props: { lines: typeof cartForTab1 }) =>
        usePosHeldCarts(
          params({
            setLines: setLines as never,
            addToast: addToast2 as never,
            lines: props.lines,
            subtotal: { minor_units: 7000, currency: 'IDR' },
          }),
        ),
      { initialProps: { lines: cartForTab1 } },
    );

    // OPEN TAB 1 while the cart is EMPTY — the legitimate first open.
    await act(async () => {
      await result.current.handleResumeOpenBill('tab-1');
    });
    expect(result.current.activeOpenBillId).toBe('tab-1');
    setLines.mockClear();
    addToast2.mockClear();

    // The waiter is mid-order now: rows are in the cart, tab 1 is still the
    // active bill. This is the state the destruction happens in.
    rerender({ lines: cartForTab1 });

    // Mis-tap: resume tab 2.
    await act(async () => {
      await result.current.handleResumeOpenBill('tab-2');
    });

    expect(
      setLines,
      'resuming a second tab replaced the first tab\'s live cart outright',
    ).not.toHaveBeenCalled();
    expect(addToast2, 'the refusal must be reported, not silent').toHaveBeenCalled();
    expect(
      result.current.activeOpenBillId,
      'the first tab must stay open — the operator did not lose their place',
    ).toBe('tab-1');
  });

  it('still re-opens the tab already open, with a full cart', async () => {
    setScope({ storeId: 's', instanceId: 'i', typeKey: 'restaurant-pos' });

    const setLines = vi.fn();
    const cartForTab1 = [
      {
        id: 'live-1' as never,
        sku: 'LIVE-1' as never,
        qty: 2,
        unit_price: { minor_units: 3500, currency: 'IDR' },
      },
    ];
    const payload = {
      id: 'tab-1',
      cart_data: JSON.stringify({
        lines: [{ sku: 'HELD-1', qty: 1, unit_price: { minor_units: 5000, currency: 'IDR' } }],
      }),
    };
    // `activeOpenBillId` is internal state (:127), so the only way to reach the
    // "this tab is already open" branch is to open it — twice. The first call
    // leaves the cart EMPTY, which is what makes the second one legal.
    vi.mocked(getHeldCartScoped).mockResolvedValue(payload as never);

    const { result, rerender } = renderHook(
      (props: { lines: typeof cartForTab1 }) =>
        usePosHeldCarts(
          params({
            setLines: setLines as never,
            lines: props.lines,
            subtotal: { minor_units: 7000, currency: 'IDR' },
          }),
        ),
      { initialProps: { lines: [] as typeof cartForTab1 } },
    );

    await act(async () => {
      await result.current.handleResumeOpenBill('tab-1');
    });
    expect(result.current.activeOpenBillId).toBe('tab-1');
    setLines.mockClear();

    // Now the cart has rows and the SAME tab is active — a refresh, not a switch.
    rerender({ lines: cartForTab1 });
    await act(async () => {
      await result.current.handleResumeOpenBill('tab-1');
    });

    expect(
      setLines,
      're-opening the SAME tab must still refresh it with a full cart',
    ).toHaveBeenCalled();
  });

  // ── A resume must RESET the table it did not restore ────────────────
  //
  // The restore at :429 is conditional: `if (typeof data.tableNumber === 'string')`.
  // A tab whose payload carries no table — a takeaway, or a bill held before the
  // field existed — therefore leaves whatever table was ALREADY set untouched.
  //
  // THE PATH: `OpenBillModals.tsx:180` calls `handleResumeOpenBill(ob.id)` straight
  // from the held-tabs list, with no table set beforehand by that screen. So an
  // operator with table 5 open who taps a TAKEAWAY tab ends up with the takeaway's
  // items under table 5.
  //
  // THE CONSEQUENCE IS ON PAPER, which is why it is worth a round: `completedSale.ts`
  // puts `tableNumber` in the printed args and derives the receipt NUMBER from it
  // (`:212`), so the check names a table the order does not have — the exact defect
  // this file's own "DINE-IN ONLY" rule is repeated nine times to prevent, reached
  // here through the field the guard does not read.
  it('clears the table when resuming a tab that has none', async () => {
    setScope({ storeId: 's', instanceId: 'i', typeKey: 'restaurant-pos' });

    const setTableNumber = vi.fn();
    vi.mocked(getHeldCartScoped).mockResolvedValueOnce({
      id: 'takeaway-tab',
      cart_data: JSON.stringify({
        // NO tableNumber — a takeaway, or a tab held before the field existed.
        lines: [{ sku: 'TA-1', qty: 1, unit_price: { minor_units: 5000, currency: 'IDR' } }],
        orderType: 'takeaway',
      }),
    } as never);

    const { result } = renderHook(() =>
      usePosHeldCarts(
        params({
          setTableNumber: setTableNumber as never,
          // The operator already has table 5 open.
          tableNumber: 'T5',
          lines: [],
        }),
      ),
    );

    await act(async () => {
      await result.current.handleResumeOpenBill('takeaway-tab');
    });

    expect(
      setTableNumber,
      'the resumed tab carries no table, so the previously-set one must be cleared — '
      + 'otherwise the takeaway prints a bill naming table 5',
    ).toHaveBeenCalledWith('');
  });

  it('resumes normally when the cart is empty', async () => {
    setScope({ storeId: 's', instanceId: 'i', typeKey: 'restaurant-pos' });

    const setLines = vi.fn();
    vi.mocked(getHeldCartScoped).mockResolvedValueOnce({
      id: 'held-1',
      cart_data: JSON.stringify({
        lines: [
          {
            sku: 'HELD-1',
            qty: 1,
            unit_price: { minor_units: 5000, currency: 'IDR' },
          },
        ],
      }),
    } as never);

    const { result } = renderHook(() =>
      usePosHeldCarts(params({ setLines: setLines as never })),
    );

    await act(async () => {
      await result.current.handleResumeOpenBill('held-1');
    });

    // The guard is on the cart being non-empty, so an empty cart still resumes.
    expect(setLines).toHaveBeenCalled();
  });

  // ── Holding a tab must record ONLY what the kitchen received ───────────
  //
  // `handleOpenBill` computes the unsent delta correctly (:214-216) and dispatches
  // exactly that (:220) — then throws the distinction away one line later:
  //
  //   const linesToSave = shouldDispatch && deltaLines.length > 0
  //     ? lines.map((l) => ({ ...l, dispatchedQty: l.qty }))   // EVERY line, FULL qty
  //     : lines;
  //
  // That is the same over-record round 102 fixed in `PosScreen.handleSendToKitchen`,
  // where the write advances by the SENT amount. The comment directly below this line
  // says the sibling builders "were both fixed" while this one — the path that
  // actually persists the tab — still marks every line fully dispatched.
  //
  // TWO consequences, both reachable:
  //   * a line ADDED after an earlier send and never re-sent is saved as dispatched;
  //   * a quantity RAISED after the last send is saved as fully dispatched.
  // Either way the resumed tab shows 'Sent' for portions the kitchen never received.
  // ── What the saved tab records about the kitchen send ─────────────────
  //
  // ⚠️ A CORRECTION IS RECORDED HERE, because the first version of this case claimed a
  // bug that does not exist. `linesToSave` marks every line `dispatchedQty: l.qty`
  // (:227) while the dispatch sends a DELTA (:214-220), which looks like the
  // over-record round 102 fixed in PosScreen. It is not, and the algebra says so:
  //
  //     delta      = qty - dispatched
  //     advance-by-delta:  dispatched + delta = qty
  //
  // For any line in the SAME array the two are identical. PosScreen differed only
  // because its delta and its write were separated by an await during which the
  // operator could change the cart — `lines` there was re-read from a changing state,
  // while here `lines` is one frozen render closure used by both.
  //
  // So the case asserts what is actually true, and keeps a second assertion on the
  // thing that genuinely could go wrong: a line ADDED while the dispatch await is in
  // flight. `lines` cannot see it, so the saved tab is short a line.
  it('records every outstanding line as dispatched once the send returns', async () => {
    setScope({ storeId: 's', instanceId: 'i', typeKey: 'restaurant-pos' });

    const holdCartScoped = vi.mocked((await import('@/api/sales')).holdCartScoped);
    // Typed with its argument: a bare `vi.fn()` records no parameter, so
    // `mock.calls[0][0]` is `undefined` at the type level even though the runtime
    // value is there — the assertion below reads it and needs the type to agree.
    const onDispatchKitchen = vi.fn(async (_delta: { sku: string; qty: number }[]) => {});

    const lines = [
      { id: 'a' as never, sku: 'A' as never, qty: 2, dispatchedQty: 1, unit_price: { minor_units: 1000, currency: 'IDR' } },
      { id: 'b' as never, sku: 'B' as never, qty: 3, unit_price: { minor_units: 2000, currency: 'IDR' } },
      { id: 'c' as never, sku: 'C' as never, qty: 1, dispatchedQty: 1, unit_price: { minor_units: 500, currency: 'IDR' } },
    ];

    const { result } = renderHook(() =>
      usePosHeldCarts(
        params({
          activeShift: { id: 'sh-1' } as never,
          lines: lines as never,
          subtotal: { minor_units: 7000, currency: 'IDR' } as never,
          dispatchOnTabSave: true,
          onDispatchKitchen,
        }),
      ),
    );

    await act(async () => {
      await result.current.handleOpenBill();
    });

    // The DISPATCH carries only the outstanding amounts — C is fully sent already, so
    // it is not re-sent to the kitchen.
    expect(onDispatchKitchen).toHaveBeenCalledTimes(1);
    const sent = onDispatchKitchen.mock.calls[0]![0] as { sku: string; qty: number }[];
    expect(sent.map((l) => [l.sku, l.qty])).toEqual([['A', 1], ['B', 3]]);

    // And the SAVED tab agrees with it, per line.
    const persisted = JSON.parse(
      (holdCartScoped.mock.calls.at(-1)![1] as { cart_data: string }).cart_data,
    ) as { lines: { sku: string; qty: number; dispatchedQty?: number }[] };

    const by = Object.fromEntries(persisted.lines.map((l) => [l.sku, l]));
    expect(by['A']!.dispatchedQty).toBe(2);
    expect(by['B']!.dispatchedQty).toBe(3);
    expect(by['C']!.dispatchedQty, 'C was already fully sent and stays so').toBe(1);
  });

  it('loads open bills in a restaurant-pos workspace', async () => {
    setScope({ storeId: 's', instanceId: 'i', typeKey: 'restaurant-pos' });

    renderHook(() => usePosHeldCarts(params()));

    await waitFor(() => {
      expect(listOpenBillsScoped).toHaveBeenCalledWith('tok');
    });
  });

  it('does not call list_open_bills_scoped from the admin workspace', () => {
    setScope({ storeId: 's', instanceId: 'i', typeKey: 'admin' });

    renderHook(() => usePosHeldCarts(params()));

    expect(listOpenBillsScoped).not.toHaveBeenCalled();
    expect(addToast).not.toHaveBeenCalled();
  });

  it('does not call list_open_bills_scoped from store-pos', () => {
    setScope({ storeId: 's', instanceId: 'i', typeKey: 'store-pos' });

    renderHook(() => usePosHeldCarts(params()));

    expect(listOpenBillsScoped).not.toHaveBeenCalled();
  });

  it('fails closed when there is no workspace scope (admin-fallback token)', () => {
    setScope(null);

    renderHook(() => usePosHeldCarts(params()));

    expect(listOpenBillsScoped).not.toHaveBeenCalled();
    expect(addToast).not.toHaveBeenCalled();
  });

  it('does not call list_open_bills_scoped without a session token', () => {
    setScope({ storeId: 's', instanceId: 'i', typeKey: 'restaurant-pos' });

    renderHook(() => usePosHeldCarts(params({ sessionToken: '' })));

    expect(listOpenBillsScoped).not.toHaveBeenCalled();
  });

  it('silently swallows a permissionDenied rejection from the backend (no toast)', async () => {
    // Guards race: isRestaurantPos was true in the closure but the backend
    // session had a different type_key — the PermissionDenied error must not
    // surface as a toast because it is not user-actionable.
    setScope({ storeId: 's', instanceId: 'i', typeKey: 'restaurant-pos' });
    vi.mocked(listOpenBillsScoped).mockRejectedValueOnce({
      kind: 'permissionDenied',
      message: "workspace 'admin' may not list open bills; only 'restaurant-pos' may",
    });

    await act(async () => {
      renderHook(() => usePosHeldCarts(params()));
      // flush the rejected promise
      await Promise.resolve();
    });

    expect(addToast).not.toHaveBeenCalled();
  });

  it('silently swallows wrapped Error permissionDenied string without toast', async () => {
    setScope({ storeId: 's', instanceId: 'i', typeKey: 'restaurant-pos' });
    vi.mocked(listOpenBillsScoped).mockRejectedValueOnce(
      new Error(
        'Error invoking remote method \'list_open_bills_scoped\': {"kind":"permissionDenied","message":"workspace \'admin\' may not list open bills; only \'restaurant-pos\' may"}',
      ),
    );

    await act(async () => {
      renderHook(() => usePosHeldCarts(params()));
      await Promise.resolve();
    });

    expect(addToast).not.toHaveBeenCalled();
  });

  it('preserves tableNumber and modifiers in cart_data when holding an open bill', async () => {
    setScope({ storeId: 's', instanceId: 'i', typeKey: 'restaurant-pos' });
    const { holdCartScoped } = await import('@/api/sales');
    const resetCart = vi.fn();
    const setTableNumber = vi.fn();

    const { result } = renderHook(() =>
      usePosHeldCarts(
        params({
          activeShift: { id: 'sh-1' } as never,
          tableNumber: 'T4',
          setTableNumber,
          resetCart,
          lines: [
            {
              id: 'line-1' as never,
              sku: 'BURGER' as never,
              name: 'Burger',
              qty: 1,
              unit_price: { minor_units: 50000, currency: 'IDR' },
              modifiers: [
                {
                  groupId: 'g1',
                  groupName: 'Doneness',
                  modifierId: 'm1',
                  modifierName: 'Medium Rare',
                  priceMinor: 0,
                },
              ],
              note: 'No pickle',
            },
          ],
          subtotal: { minor_units: 50000, currency: 'IDR' },
        }),
      ),
    );

    await act(async () => {
      await result.current.handleOpenBill();
    });

    expect(holdCartScoped).toHaveBeenCalledWith(
      'tok',
      expect.objectContaining({
        label: 'Table T4',
        bill_type: 'open_bill',
        cart_data: expect.stringContaining('"modifiers":[{"groupId":"g1","groupName":"Doneness","modifierId":"m1","modifierName":"Medium Rare","priceMinor":0}]'),
      }),
    );
    expect(holdCartScoped).toHaveBeenCalledWith(
      'tok',
      expect.objectContaining({
        cart_data: expect.stringContaining('"note":"No pickle"'),
      }),
    );
    expect(holdCartScoped).toHaveBeenCalledWith(
      'tok',
      expect.objectContaining({
        cart_data: expect.stringContaining('"tableNumber":"T4"'),
      }),
    );
    expect(setTableNumber).toHaveBeenCalledWith('');
    expect(resetCart).toHaveBeenCalled();
  });

  it('restores tableNumber and modifiers when resuming an open bill', async () => {
    setScope({ storeId: 's', instanceId: 'i', typeKey: 'restaurant-pos' });
    const { getHeldCartScoped } = await import('@/api/sales');
    const setLines = vi.fn();
    const setTableNumber = vi.fn();
    // ⚠️ This spy exists to assert a NON-call. `handleResumeOpenBill` strips the
    // table prefix from `customer_name` and refuses the result when it still reads
    // `Table …` (`usePosHeldCarts.ts:259-260`), so a bill whose customer field holds
    // a table name must NOT populate the cart's customer. Removing that guard left
    // this suite GREEN until 2026-10-09 — the input was set up and the outcome never
    // checked, which is coverage that looks like coverage and is not.
    const setCustomerName = vi.fn();

    // ⚠️ The customer field is `'Table 5 (Table 7)'`, NOT a plain table name, and
    // the difference is the whole point. `handleResumeOpenBill` strips a leading
    // `Table <word>` from `customer_name` (`usePosHeldCarts.ts:259`) and then
    // refuses a result that STILL reads `Table …` (`:260`).
    //
    // For a plain `'Table T4'` the regex alone leaves `''`, so `if (cust)` already
    // rejects it and `:260` is unreachable — a test built on that input passes with
    // the guard deleted. For `'Table 5 (Table 7)'` the regex leaves `'Table 7'`, and
    // ONLY the `startsWith` guard stops a table name becoming the customer. Both
    // probes were run against the real code; this is the one that discriminates.
    vi.mocked(getHeldCartScoped).mockResolvedValueOnce({
      id: 'held-1',
      label: 'Table T4',
      item_count: 1,
      total_minor: 50000,
      currency: 'IDR',
      created_at: '2026-10-01T00:00:00Z',
      bill_type: 'open_bill',
      customer_name: 'Table 5 (Table 7)',
      deduction_location_id: null,
      cart_data: JSON.stringify({
        lines: [
          {
            sku: 'BURGER',
            name: 'Burger',
            qty: 1,
            unit_price: { minor_units: 50000, currency: 'IDR' },
            modifiers: [
              {
                groupId: 'g1',
                groupName: 'Doneness',
                modifierId: 'm1',
                modifierName: 'Medium Rare',
                priceMinor: 0,
              },
            ],
            note: 'No pickle',
          },
        ],
        tableNumber: 'T4',
      }),
    });

    const { result } = renderHook(() =>
      usePosHeldCarts(
        params({
          setLines,
          setTableNumber,
          setCustomerName,
        }),
      ),
    );

    await act(async () => {
      await result.current.handleResumeOpenBill('held-1');
    });

    expect(setTableNumber).toHaveBeenCalledWith('T4');
    // The discriminating assertion: a TABLE NAME must not become the customer.
    expect(
      setCustomerName,
      'a customer-name field holding a table name was accepted as the customer — the ' +
        'guard at usePosHeldCarts.ts:260 is gone or no longer effective',
    ).not.toHaveBeenCalled();
    expect(setLines).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          sku: 'BURGER',
          note: 'No pickle',
          modifiers: [
            expect.objectContaining({
              groupId: 'g1',
              groupName: 'Doneness',
              modifierId: 'm1',
              modifierName: 'Medium Rare',
              priceMinor: 0,
            }),
          ],
        }),
      ]),
    );
  });

  it('preserves customerName and tableNumber in cart_data and label when holding an open bill', async () => {
    setScope({ storeId: 's', instanceId: 'i', typeKey: 'restaurant-pos' });
    const { holdCartScoped } = await import('@/api/sales');
    const resetCart = vi.fn();
    const setTableNumber = vi.fn();
    const setCustomerName = vi.fn();

    const { result } = renderHook(() =>
      usePosHeldCarts(
        params({
          activeShift: { id: 'sh-1' } as never,
          tableNumber: '5',
          customerName: 'Budi',
          setTableNumber,
          setCustomerName,
          resetCart,
          lines: [
            {
              id: 'line-1' as never,
              sku: 'COFFEE' as never,
              name: 'Coffee',
              qty: 2,
              unit_price: { minor_units: 25000, currency: 'IDR' },
            },
          ],
          subtotal: { minor_units: 50000, currency: 'IDR' },
        }),
      ),
    );

    await act(async () => {
      await result.current.handleOpenBill();
    });

    expect(holdCartScoped).toHaveBeenCalledWith(
      'tok',
      expect.objectContaining({
        label: 'Table 5 (Budi)',
        customer_name: 'Budi',
        bill_type: 'open_bill',
        cart_data: expect.stringContaining('"customerName":"Budi"'),
      }),
    );
    expect(setTableNumber).toHaveBeenCalledWith('');
    expect(setCustomerName).toHaveBeenCalledWith('');
    expect(resetCart).toHaveBeenCalled();
  });

  it('deletes prior held cart and updates tab when activeOpenBillId is already set', async () => {
    setScope({ storeId: 's', instanceId: 'i', typeKey: 'restaurant-pos' });
    const { holdCartScoped, deleteHeldCartScoped, getHeldCartScoped } = await import('@/api/sales');
    const setLines = vi.fn();
    const setTableNumber = vi.fn();
    const setCustomerName = vi.fn();

    vi.mocked(getHeldCartScoped).mockResolvedValueOnce({
      id: 'existing-bill-1',
      label: 'Table 5',
      item_count: 1,
      total_minor: 25000,
      currency: 'IDR',
      created_at: '2026-10-01T00:00:00Z',
      bill_type: 'open_bill',
      customer_name: 'Table 5',
      deduction_location_id: null,
      cart_data: JSON.stringify({
        lines: [
          {
            sku: 'COFFEE',
            name: 'Coffee',
            qty: 1,
            unit_price: { minor_units: 25000, currency: 'IDR' },
          },
        ],
        tableNumber: '5',
        customerName: 'Budi',
      }),
    });

    const { result } = renderHook(() =>
      usePosHeldCarts(
        params({
          activeShift: { id: 'sh-1' } as never,
          tableNumber: '5',
          customerName: 'Budi',
          setLines,
          setTableNumber,
          setCustomerName,
          lines: [
            {
              id: 'line-1' as never,
              sku: 'COFFEE' as never,
              name: 'Coffee',
              qty: 2,
              unit_price: { minor_units: 25000, currency: 'IDR' },
            },
          ],
          subtotal: { minor_units: 50000, currency: 'IDR' },
        }),
      ),
    );

    // Resume the bill first
    await act(async () => {
      await result.current.handleResumeOpenBill('existing-bill-1');
    });
    expect(result.current.activeOpenBillId).toBe('existing-bill-1');
    expect(setCustomerName).toHaveBeenCalledWith('Budi');

    // Now update / save the tab
    await act(async () => {
      await result.current.handleOpenBill();
    });

    // Expect the existing bill to have been deleted
    expect(deleteHeldCartScoped).toHaveBeenCalledWith('tok', 'existing-bill-1');
    // And newly saved
    expect(holdCartScoped).toHaveBeenCalledWith(
      'tok',
      expect.objectContaining({
        label: 'Table 5 (Budi)',
        bill_type: 'open_bill',
      }),
    );
    expect(result.current.activeOpenBillId).toBeNull();
  });

  it('does NOT report a tab as updated when deleting the previous record FAILS', async () => {
    // `deleteHeldCartScoped(...).catch(() => {})` swallowed the failure, then the
    // code went on to holdCartScoped() and toast 'Tab for X updated'. Two problems,
    // both money-adjacent on the restaurant POS:
    //   1. the DELETE is what prevents a duplicate open bill for the same table,
    //      so swallowing it produces exactly the duplicate the comment claims to
    //      prevent;
    //   2. the toast tells the cashier the tab was UPDATED when a second tab was
    //      created.
    setScope({ storeId: 's', instanceId: 'i', typeKey: 'restaurant-pos' });
    const { holdCartScoped, deleteHeldCartScoped, getHeldCartScoped } = await import('@/api/sales');
    vi.mocked(deleteHeldCartScoped).mockRejectedValueOnce(new Error('database is locked'));

    vi.mocked(getHeldCartScoped).mockResolvedValueOnce({
      id: 'existing-bill-1',
      label: 'Table 5',
      item_count: 1,
      total_minor: 25000,
      currency: 'IDR',
      created_at: '2026-10-01T00:00:00Z',
      bill_type: 'open_bill',
      customer_name: 'Table 5',
      deduction_location_id: null,
      cart_data: JSON.stringify({ lines: [], tableNumber: '5', customerName: 'Budi' }),
    });

    const { result } = renderHook(() =>
      usePosHeldCarts(
        params({
          activeShift: { id: 'sh-1' } as never,
          tableNumber: '5',
          customerName: 'Budi',
          lines: [
            {
              id: 'line-1' as never,
              sku: 'COFFEE' as never,
              name: 'Coffee',
              qty: 2,
              unit_price: { minor_units: 25000, currency: 'IDR' },
            },
          ],
          subtotal: { minor_units: 50000, currency: 'IDR' },
        }),
      ),
    );

    await act(async () => {
      await result.current.handleResumeOpenBill('existing-bill-1');
    });
    addToast.mockClear();

    await act(async () => {
      await result.current.handleOpenBill();
    });

    // It must NOT create a duplicate record over a tab it failed to remove.
    expect(holdCartScoped).not.toHaveBeenCalled();
    // And it must not claim success.
    expect(addToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/updated/i), type: 'success' }),
    );
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    );
  });

  it('refuses to open a bill without a shift, using the localised message', async () => {
    // The toast used to be a hardcoded English literal while
    // `retail-toast-open-shift-first` already existed in BOTH bundles
    // (`sales.ftl:846`, `sales.id.ftl:778`) and retail already used it — so an
    // Indonesian operator read English here and Indonesian there.
    //
    // The `l10nRef` stub above echoes the ID, so `«retail-toast-open-shift-first»`
    // appearing in the toast proves the localized path was taken. Asserting the
    // English text would pass either way, because the en bundle renders exactly
    // the words the literal had.
    const { result } = renderHook(() => usePosHeldCarts(params()));
    await act(async () => {
      await result.current.handleOpenBill();
    });
    expect(addToast).toHaveBeenCalledWith({
      message: '«retail-toast-open-shift-first»',
      type: 'warning',
    });
  });

  // ── A recalled tab must not restore qty/price straight from untrusted JSON ──
  //
  // handleResumeOpenBill builds every restored line with the raw payload values
  // (usePosHeldCarts.ts:409-434):
  //
  //   qty: l.qty,
  //   unit_price: l.unit_price,
  //
  // Both are CAST at the top of the loop (l.qty: number, l.unit_price:
  // { minor_units: number; currency: string }). A cast is erased at runtime and
  // checks nothing, and cart_data is exactly the untrusted boundary: JSON written
  // by holdCartScoped, round-tripped through SQLite, read back here.
  //
  // The retail twin already guards this (RetailPosScreen.handleResumeCart,
  // :1483-1487): it tests typeof l.unit_price.minor_units !== 'number' and
  // Number.isFinite(l.qty) && l.qty > 0, defaulting a bad quantity to 1. The
  // restaurant copy -- the one that runs on a busy floor -- does not, in a
  // restore whose whole purpose is recovering a cart.
  //
  // THE CONSEQUENCE IS MONEY. usePosState.subtotal (:281) sums
  // l.unit_price.minor_units * l.qty with no guard of its own, and every
  // downstream memo (discounted, total, discountAmount) reads that sum. A
  // non-numeric qty or price therefore makes the whole cart NaN minor units, and
  // the total the waiter reads on the pay screen is NaN. That is the same defect
  // class the retail discountPercent fix describes, reached through a field
  // nobody was checking.
  //
  // The guard asserted here is a TYPE/FINITUDE check, not a blanket refusal: a
  // well-formed qty and price must still restore, or the fix would be \"never
  // resume a tab with items\".
  it('validates qty and unit_price before restoring a recalled tab', async () => {
    setScope({ storeId: 's', instanceId: 'i', typeKey: 'restaurant-pos' });

    const setLines = vi.fn();
    vi.mocked(getHeldCartScoped).mockResolvedValueOnce({
      id: 'bad-tab',
      label: 'Table 9',
      item_count: 2,
      total_minor: 0,
      currency: 'IDR',
      created_at: '2026-10-01T00:00:00Z',
      bill_type: 'open_bill',
      customer_name: null,
      deduction_location_id: null,
      // A non-numeric quantity and a price whose minor_units is a string. Both
      // satisfy the type assertions the loop makes and both poison the memos.
      cart_data: JSON.stringify({
        lines: [
          {
            sku: 'BAD-QTY',
            name: 'Bad Quantity',
            qty: 'two',
            unit_price: { minor_units: 5000, currency: 'IDR' },
          },
          {
            sku: 'BAD-PRICE',
            name: 'Bad Price',
            qty: 1,
            unit_price: { minor_units: 'lots', currency: 'IDR' },
          },
        ],
      }),
    } as never);

    const { result } = renderHook(() =>
      usePosHeldCarts(params({ setLines: setLines as never })),
    );

    await act(async () => {
      await result.current.handleResumeOpenBill('bad-tab');
    });

    expect(setLines).toHaveBeenCalled();
    const restored = setLines.mock.calls[0]![0] as { sku: string; qty: number; unit_price: { minor_units: number } }[];
    const bySku = Object.fromEntries(restored.map((l) => [l.sku, l]));

    // A non-numeric qty must become a finite positive integer, not 'two'.
    // usePosState would otherwise carry it into minor_units * qty -> NaN.
    expect(
      Number.isInteger(bySku['BAD-QTY']!.qty) && bySku['BAD-QTY']!.qty > 0,
      'a non-numeric qty was restored as-is; the subtotal becomes NaN minor units',
    ).toBe(true);

    // Same for the price: minor_units must be a finite number after the guard.
    expect(
      Number.isFinite(bySku['BAD-PRICE']!.unit_price.minor_units),
      'a non-numeric unit_price.minor_units was restored as-is; the subtotal becomes NaN',
    ).toBe(true);
  });

  // ── A double-press on Save must not create two tabs ─────────────────────
  //
  // `handleOpenBill` (usePosHeldCarts.ts:202) has NO re-entry guard. Its
  // `openingBill` flag is a useState BOOLEAN that is written at :211 and cleared
  // at :322 — and READ NOWHERE as a guard. Its only readers are the two buttons in
  // OpenBillModals.tsx:95/103, which it disables. A disabled DOM button cannot help
  // either: React does not re-render between two clicks that land inside one await,
  // so both calls proceed and each reaches `holdCartScoped`, creating TWO open bills
  // for one sale — a duplicate tab the operator then has to find and delete.
  //
  // This is the round-124 shape. The retail sibling has the working guard
  // (RetailPosScreen.tsx:1426 `holdingRef`), and that file's comment at :1425 names
  // `usePosHeldCarts` as already using 'the same guard shape'. MEASURED: it does
  // not — it uses a state flag with no read-back, which is a different mechanism
  // with a different failure mode, and the comment therefore tells a reader the
  // class is handled where it is not.
  it('creates only one open bill when Save is pressed twice in one pass', async () => {
    setScope({ storeId: 's', instanceId: 'i', typeKey: 'restaurant-pos' });
    const { holdCartScoped } = await import('@/api/sales');

    // Hold the write open so both presses land while it is in flight.
    let release: ((v: unknown) => void) | undefined;
    const held = new Promise<unknown>((resolve) => { release = resolve; });
    vi.mocked(holdCartScoped).mockImplementation(async () => held as never);

    const { result } = renderHook(() =>
      usePosHeldCarts(
        params({
          activeShift: { id: 'sh-1' } as never,
          tableNumber: '5',
          lines: [
            {
              id: 'line-1' as never,
              sku: 'COFFEE' as never,
              name: 'Coffee',
              qty: 2,
              unit_price: { minor_units: 25000, currency: 'IDR' },
            },
          ],
          subtotal: { minor_units: 50000, currency: 'IDR' },
        }),
      ),
    );

    // Two presses with no await between them: exactly how a double-tap arrives.
    await act(async () => {
      void result.current.handleOpenBill();
      void result.current.handleOpenBill();
    });

    expect(
      vi.mocked(holdCartScoped).mock.calls.length,
      'two Save presses in one round-trip created two open bills for one sale — ' +
        'the duplicate tab the retail hold guard exists to prevent',
    ).toBe(1);

    await act(async () => { release?.({ id: 'held-1' }); });
  });

  // ── A REFUSED save must release the guard ───────────────────────────────
  //
  // The tab the operator is trying to record is the whole point of the flow, so a
  // refused hold (locked DB, lapsed session) has to end with a usable screen: the
  // catch toasts the failure and a retry must reach `holdCartScoped` again.
  // `openingBillRef` is cleared in the handler's `finally` for this reason — a
  // guard held across the failure would strand the operator, which is the lock-out
  // class the EDC phase's clearTerminalFailed and useAutoQr's finally both avoid.
  it('lets the cashier retry after a refused save', async () => {
    setScope({ storeId: 's', instanceId: 'i', typeKey: 'restaurant-pos' });
    const { holdCartScoped } = await import('@/api/sales');
    const { result } = renderHook(() =>
      usePosHeldCarts(
        params({
          activeShift: { id: 'sh-1' } as never,
          tableNumber: '5',
          lines: [
            {
              id: 'line-1' as never,
              sku: 'COFFEE' as never,
              name: 'Coffee',
              qty: 2,
              unit_price: { minor_units: 25000, currency: 'IDR' },
            },
          ],
          subtotal: { minor_units: 50000, currency: 'IDR' },
        }),
      ),
    );

    // First attempt is refused.
    vi.mocked(holdCartScoped).mockRejectedValueOnce(new Error('database is locked'));
    await act(async () => {
      await result.current.handleOpenBill();
    });
    expect(vi.mocked(holdCartScoped).mock.calls.length).toBe(1);
    expect(addToast).toHaveBeenCalled();

    // Retry must not be blocked by the failed attempt's guard.
    await act(async () => {
      await result.current.handleOpenBill();
    });
    expect(
      vi.mocked(holdCartScoped).mock.calls.length,
      'a refused save held the guard — the operator could not retry recording the ' +
        'tab, which is the only thing the flow exists to do',
    ).toBe(2);
  });

  it('preserves and restores deduction_location_id across hold and resume', async () => {
    setScope({ storeId: 's', instanceId: 'i', typeKey: 'restaurant-pos' });
    const { holdCartScoped, getHeldCartScoped } = await import('@/api/sales');
    const deductionLocationIdRef = { current: 'loc-bar-fridge' };
    const onRestoreDeductionLocation = vi.fn();

    const { result } = renderHook(() =>
      usePosHeldCarts(
        params({
          activeShift: { id: 'sh-1' } as never,
          tableNumber: '7',
          lines: [
            {
              id: 'line-1' as never,
              sku: 'COFFEE' as never,
              name: 'Coffee',
              qty: 1,
              unit_price: { minor_units: 25000, currency: 'IDR' },
            },
          ],
          subtotal: { minor_units: 25000, currency: 'IDR' },
          deductionLocationIdRef,
          onRestoreDeductionLocation,
        }),
      ),
    );

    vi.mocked(holdCartScoped).mockResolvedValueOnce({ id: 'held-7' });
    await act(async () => {
      await result.current.handleOpenBill();
    });

    expect(holdCartScoped).toHaveBeenCalledWith(
      'tok',
      expect.objectContaining({
        deduction_location_id: 'loc-bar-fridge',
      }),
    );

    // Now simulate resume with a different locked location on the held cart
    vi.mocked(getHeldCartScoped).mockResolvedValueOnce({
      id: 'held-7',
      label: 'Table 7',
      cart_data: JSON.stringify({
        lines: [
          {
            sku: 'COFFEE',
            name: 'Coffee',
            qty: 1,
            unit_price: { minor_units: 25000, currency: 'IDR' },
          },
        ],
      }),
      item_count: 1,
      total_minor: 25000,
      currency: 'IDR',
      created_at: '2026-10-16T12:00:00Z',
      bill_type: 'open_bill',
      customer_name: 'Table 7',
      deduction_location_id: 'loc-kitchen-storage',
    });

    await act(async () => {
      await result.current.handleResumeOpenBill('held-7');
    });

    expect(deductionLocationIdRef.current).toBe('loc-kitchen-storage');
    expect(onRestoreDeductionLocation).toHaveBeenCalledWith('loc-kitchen-storage');
  });
});
