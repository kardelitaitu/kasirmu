import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
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
  };
});

/**
 * `list_open_bills_scoped` is Restaurant POS only — the bridge refuses every
 * other vertical (`is_restaurant_pos_workspace`), so a call from anywhere else
 * spends a round-trip to collect a `permissionDenied` that the hook's catch
 * turns into a "Failed to load open bills" toast.
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
});
