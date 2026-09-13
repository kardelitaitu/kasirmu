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
});