// ── useCartTax: the F2 failure-window cache (D64) ─────────────────────
//
// Covers the three failure severities (caution / warn / unknown), the
// ok path that seeds the module cache, invalidation, and the null-token
// short-circuit. The module-level Map is shared across renderHook
// instances on purpose — that is the failure-window the hook exists for.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const { mockComputeCartTax } = vi.hoisted(() => ({
  mockComputeCartTax: vi.fn(),
}));
vi.mock('@/api/tax', () => ({
  computeCartTax: (...args: unknown[]) => mockComputeCartTax(...args),
}));

import {
  useCartTax,
  invalidateCartTaxCache,
  cartTaxSignature,
  type CartTaxCacheState,
} from '@/hooks/useCartTax';

const LINES = [
  { sku: 'SKU-001', qty: 2, unit_price_minor: 1000 },
  { sku: 'SKU-002', qty: 1, unit_price_minor: 500 },
];
const TOKEN = 'tok_tax_cache';

/** Arm the mock to fail with an error the test settles manually. */
function armFailure(): (e: Error) => void {
  let reject!: (e: Error) => void;
  mockComputeCartTax.mockImplementationOnce(
    () => new Promise<never>((_, rej) => { reject = rej; }),
  );
  return (e) => reject(e);
}

describe('cartTaxSignature', () => {
  it('is order-independent and carries the currency', () => {
    const a = cartTaxSignature(LINES, 'IDR');
    const b = cartTaxSignature([LINES[1]!, LINES[0]!], 'IDR');
    expect(a).toBe(b);
    expect(a.endsWith('|IDR')).toBe(true);
  });
});

describe('useCartTax', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateCartTaxCache();
  });

  it('ok: a fresh compute seeds the cache and is tender-eligible', async () => {
    mockComputeCartTax.mockResolvedValueOnce({ taxMinor: 1700, hasExclusive: true });
    const { result } = renderHook(() => useCartTax(TOKEN, LINES, 'IDR'));
    await waitFor(() => expect(result.current.severity).toBe('ok'));
    expect(result.current.taxMinor).toBe(1700);
    expect(result.current.hasExclusive).toBe(true);
    expect(result.current.cacheFresh).toBe(true);
    expect(result.current.estimated).toBe(false);
    expect(mockComputeCartTax).toHaveBeenCalledWith(TOKEN, LINES, 'IDR');
  });

  it('unknown: failure with no cache shows zero but does NOT claim it', async () => {
    const fail = armFailure();
    const { result } = renderHook(() => useCartTax(TOKEN, LINES, 'IDR'));
    await waitFor(() => expect(mockComputeCartTax).toHaveBeenCalledTimes(1));
    await act(async () => {
      fail(new Error('ipc down'));
    });
    expect(result.current.severity).toBe('unknown');
    expect(result.current.taxMinor).toBe(0);
    expect(result.current.hasExclusive).toBeNull();
    expect(result.current.cacheFresh).toBe(false);
    expect(result.current.estimated).toBe(false);
  });

  it('caution: failure with a matching-signature cache — cached tax, fresh, no sale flag', async () => {
    mockComputeCartTax.mockResolvedValueOnce({ taxMinor: 1700, hasExclusive: true });
    const first = renderHook(() => useCartTax(TOKEN, LINES, 'IDR'));
    await waitFor(() => expect(first.result.current.severity).toBe('ok'));
    first.unmount();

    // Same cart, IPC now failing: the cached answer still matches the cart.
    const fail = armFailure();
    const second = renderHook(() => useCartTax(TOKEN, LINES, 'IDR'));
    await waitFor(() => expect(mockComputeCartTax).toHaveBeenCalledTimes(2));
    await act(async () => {
      fail(new Error('ipc down'));
    });
    await waitFor(() => expect(second.result.current.severity).toBe('caution'));
    expect(second.result.current.taxMinor).toBe(1700);
    expect(second.result.current.hasExclusive).toBe(true);
    expect(second.result.current.cacheFresh).toBe(true);
    expect(second.result.current.estimated).toBe(false);
    second.unmount();
  });

  it('warn: failure with a DIFFERING-signature cache — estimated, NOT tender-eligible', async () => {
    mockComputeCartTax.mockResolvedValueOnce({ taxMinor: 1700, hasExclusive: true });
    const first = renderHook(() => useCartTax(TOKEN, LINES, 'IDR'));
    await waitFor(() => expect(first.result.current.severity).toBe('ok'));
    first.unmount();

    // The cart changed since the cached answer was computed.
    const otherCart = [{ sku: 'SKU-009', qty: 3, unit_price_minor: 700 }];
    const fail = armFailure();
    const second = renderHook(() => useCartTax(TOKEN, otherCart, 'IDR'));
    await waitFor(() => expect(mockComputeCartTax).toHaveBeenCalledTimes(2));
    await act(async () => {
      fail(new Error('ipc down'));
    });
    await waitFor(() => expect(second.result.current.severity).toBe('warn'));
    // BINDING (D64 b): the stale display tax must not reach the tender.
    expect(second.result.current.cacheFresh).toBe(false);
    expect(second.result.current.estimated).toBe(true);
    expect(second.result.current.taxMinor).toBe(1700);
    second.unmount();
  });

  it('invalidateCartTaxCache drops the entry: the next failure is unknown', async () => {
    mockComputeCartTax.mockResolvedValueOnce({ taxMinor: 1700, hasExclusive: false });
    const first = renderHook(() => useCartTax(TOKEN, LINES, 'IDR'));
    await waitFor(() => expect(first.result.current.severity).toBe('ok'));
    first.unmount();

    invalidateCartTaxCache();

    const fail = armFailure();
    const second = renderHook(() => useCartTax(TOKEN, LINES, 'IDR'));
    await waitFor(() => expect(mockComputeCartTax).toHaveBeenCalledTimes(2));
    await act(async () => {
      fail(new Error('ipc down'));
    });
    // Without the invalidation this would have been caution — the cache
    // entry is gone, so zero is shown but not claimed.
    expect(second.result.current.severity).toBe('unknown');
    expect(second.result.current.cacheFresh).toBe(false);
    second.unmount();
  });

  it('a null session token classifies as unknown without an IPC attempt', async () => {
    const { result } = renderHook(() => useCartTax(null, LINES, 'IDR'));
    await act(async () => {
      // Flush the effect pass: nothing must have been invoked.
    });
    expect(result.current.severity).toBe('unknown');
    expect(mockComputeCartTax).not.toHaveBeenCalled();
  });

  // ── Shared-reference hazard: unknown state must be fresh per consumer ──
  //
  // WHY THIS EXISTS, measured. Before this change the hook had ONE
  // module-scope zero value, UNKNOWN_STATE, and used it in three places:
  // the useState seed (:108), the null-token short-circuit (:116) and the
  // failure-with-no-cache branch (:137). The last two do not merely seed —
  // they ASSIGN IT AS LIVE STATE, so every consumer that classifies as
  // unknown ends up holding the same reference. CartTaxCacheState is not
  // readonly (:71), so a consumer's non-copying updater —
  // `setState(s => { s.taxMinor = x; return s; })` — would write through
  // into the other POS screen's live state and into the module value itself.
  // The comment claiming it is "never mutated" is the assumption the sibling
  // idle-state slice (createIdleTaxState) just demonstrated is not safe to
  // rely on, because nothing type-checks it.
  //
  // This is the check no static reading could make: two real hook instances,
  // their actual returned objects, compared by IDENTITY and then separated by
  // a write. Both tests are red pre-fix — with UNKNOWN_STATE unexported the
  // assertion cannot name the shared object, so it observes it instead: that
  // is why they work unchanged across the fix.
  describe('unknown state is per consumer, not one shared module object', () => {
    it('seeds and assigns distinct objects on the null-token path', async () => {
      const sales = renderHook(() => useCartTax(null, LINES, 'IDR'));
      const retail = renderHook(() => useCartTax(null, LINES, 'IDR'));
      await act(async () => {
        // Flush both effect passes: each took the short-circuit at :116.
      });

      // Both really did classify as unknown, so the identity check below is
      // about two live unknown states, not two unused seeds.
      expect(sales.result.current.severity).toBe('unknown');
      expect(retail.result.current.severity).toBe('unknown');
      // Same VALUE is required — every consumer must start from the same
      // reading (0 displayed, 0 claimed, not tender-eligible)...
      expect(sales.result.current).toEqual(retail.result.current);
      // ...and the same REFERENCE is the defect.
      expect(sales.result.current).not.toBe(retail.result.current);
      sales.unmount();
      retail.unmount();
    });

    it('keeps a non-copying write on the failure-with-no-cache path inside one consumer', async () => {
      // Empty cache (beforeEach invalidated it) + a rejected IPC: BOTH
      // consumers land in the catch branch at :137, the worse of the two
      // sites because there the shared object is assigned as live state.
      mockComputeCartTax.mockRejectedValue(new Error('ipc down'));
      const sales = renderHook(() => useCartTax(TOKEN, LINES, 'IDR'));
      const retail = renderHook(() =>
        useCartTax(TOKEN, [{ sku: 'SKU-009', qty: 3, unit_price_minor: 700 }], 'IDR'),
      );
      await waitFor(() => expect(sales.result.current.severity).toBe('unknown'));
      await waitFor(() => expect(retail.result.current.severity).toBe('unknown'));
      expect(mockComputeCartTax).toHaveBeenCalledTimes(2);

      expect(sales.result.current).not.toBe(retail.result.current);

      const retailBefore = { ...retail.result.current };
      // The exposing input, verbatim: mutate instead of copy. Legal TS —
      // nothing in CartTaxCacheState stops it.
      const corrupt = (s: CartTaxCacheState) => {
        s.taxMinor = 9_990_000;
        s.severity = 'ok';
        s.cacheFresh = true;
        return s;
      };
      corrupt(sales.result.current);

      expect(sales.result.current.taxMinor).toBe(9_990_000);
      // The other consumer must not have moved...
      expect(retail.result.current).toEqual(retailBefore);
      // ...and neither may have written into what the hook hands out next:
      // an equal-valued, independent zero state on a fresh mount.
      const third = renderHook(() => useCartTax(null, LINES, 'IDR'));
      await act(async () => {});
      expect(third.result.current).toEqual({
        severity: 'unknown',
        taxMinor: 0,
        hasExclusive: null,
        estimated: false,
        cacheFresh: false,
      });
      sales.unmount();
      retail.unmount();
      third.unmount();
    });
  });
});