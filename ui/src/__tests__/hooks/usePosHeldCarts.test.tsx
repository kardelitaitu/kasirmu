import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useWorkspaceScope, type WorkspaceScope } from '@/contexts/WorkspaceContext';
import {
  usePosHeldCarts,
  type UsePosHeldCartsParams,
} from '@/features/sales/hooks/usePosHeldCarts';
import { listOpenBillsScoped } from '@/api/sales';

vi.mock('@/api/sales', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/sales')>();
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

  function params(overrides: Partial<UsePosHeldCartsParams> = {}): UsePosHeldCartsParams {
    return {
      sessionToken: 'tok',
      addToast: addToast as unknown as UsePosHeldCartsParams['addToast'],
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

    vi.mocked(getHeldCartScoped).mockResolvedValueOnce({
      id: 'held-1',
      label: 'Table T4',
      item_count: 1,
      total_minor: 50000,
      currency: 'IDR',
      created_at: '2026-10-01T00:00:00Z',
      bill_type: 'open_bill',
      customer_name: 'Table T4',
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
        }),
      ),
    );

    await act(async () => {
      await result.current.handleResumeOpenBill('held-1');
    });

    expect(setTableNumber).toHaveBeenCalledWith('T4');
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
});

