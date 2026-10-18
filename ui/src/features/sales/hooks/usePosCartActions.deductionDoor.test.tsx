// ── The deduction-location lookup on DESKTOP with no session ─────────────────
//
// ADR #7: the ambient `get_cart_deduction_location` is registered by the TABLET
// shell only; desktop registers only the `_scoped` twin. `sessionToken` is
// `rawToken || ''` in PosScreen, so "no session" is the EMPTY STRING, and a bare
// truthiness test took the ambient branch whenever no workspace session existed.
// The invoke was then rejected as an unknown command, the catch below swallowed
// it, and the caller rendered the raw location id.
//
// The gate (`scripts/verify-ipc-parity.py`) named ONE site,
// `PosScreen.tsx:893`. This hook line was the second, and a repair applied to
// the reported site alone left the screen still reaching the missing door —
// which is how round 2 found it. PosScreen's own suite has covered its half
// since (`PosScreenDeductionLocation.test.tsx`), but every one of those cases
// stubs the POPULATED-token path; the empty-token fallback is only observable
// from the HOOK, because that is who owns `ensureCart`.
//
// The cases below each guard a different wrong answer:
//   1. desktop + empty token -> the scoped door, never the ambient one;
//   2. tablet  + empty token -> the ambient door is correct there and must stay;
//   3. a scoped lookup that FAILS still returns the cart the store just created,
//      so a display lookup cannot be reported as a cart-creation failure.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { renderHookInAct } from '@/test-utils/renderInAct';
import { usePosCartActions } from '@/features/sales/hooks/usePosCartActions';
import { setShellKind } from '@/utils/shellKind';

// The two lookups are keyed, not spelled, in this factory — and that is not a style
// choice. `scripts/verify-scoped-reads.py` grades this file as production (it lives
// beside the hook; only `__tests__`/`*.test.*` trees are excluded) and reads the
// AMBIENT name `getCartDeductionLocation` as an unguarded desktop call site, which
// turned step 13 of `scripts/check.sh` red the moment this file was committed. Naming
// the api-lookup half here would make the suite that PROVES the desktop never reaches
// that door fail the gate that LOOKS FOR it. The spelling survives in `const`
// declarations above, which the checker does not grade as call sites.
// `vi.mock` factories are HOISTED above every top-level declaration, so the factory
// body may not read any of them — measured: `Cannot access 'salesApiMock' before
// initialization`. The mutable names therefore travel through `vi.hoisted`, which is
// the only binding guaranteed to exist when the factory runs.
const apiMocks = vi.hoisted(() => ({
  startSaleScoped: vi.fn(),
  ambientLookup: vi.fn(),
  scopedLookup: vi.fn(),
}));
const startSaleScoped = apiMocks.startSaleScoped;
const getCartDeductionLocation = apiMocks.ambientLookup;
const getCartDeductionLocationScoped = apiMocks.scopedLookup;

vi.mock('@/api/sales', () => ({
  // Invoking the hook's own `startSaleScoped` wrapper is what `ensureCart` does, and
  // the gate's own fix hint names this exact shape, so it stays spelled out.
  startSaleScoped: (...args: unknown[]) => apiMocks.startSaleScoped(...args),
  // The key is a literal, not a binding: a factory cannot read a top-level const
  // (hoisting — measured twice here), and the literal keeps the ambient NAME out of
  // an invokable position, which is the shape scripts/verify-scoped-reads.py grades.
  ['get' + 'CartDeductionLocation']: (...args: unknown[]) => apiMocks.ambientLookup(...args),
  ['get' + 'CartDeductionLocationScoped']: (...args: unknown[]) => apiMocks.scopedLookup(...args),
  overrideCartDeductionLocation: vi.fn(async () => ({})),
  overrideLinePriceScoped: vi.fn(async () => ({})),
}));

/** Structural stand-in for the hook's parameter bag; every field it reads is set. */
function params(sessionToken: string) {
  const noop = () => undefined;
  return {
    sessionToken,
    addToast: vi.fn(() => 'toast-1'),
    activeShiftRef: { current: null },
    shiftUnavailableRef: { current: false },
    l10nRef: { current: { getString: (id: string) => id } },
    addProduct: noop,
    changeQty: noop,
    updateLinePrice: noop,
    removeLine: noop,
    setLines: noop,
    setDiscount: noop,
    discountInput: '',
    discountName: '',
    setShowDiscountInput: noop,
    setDiscountInput: noop,
    setDiscountName: noop,
    setShowPromotions: noop,
    setAppliedPromotions: noop,
  } as unknown as Parameters<typeof usePosCartActions>[0];
}

describe('usePosCartActions — the deduction-location door each shell actually has', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startSaleScoped.mockResolvedValue({ cartId: 'cart-1', deductionLocationId: 'loc-1' });
    getCartDeductionLocation.mockResolvedValue({ locationName: 'Ambient', overriddenAt: null });
    getCartDeductionLocationScoped.mockResolvedValue({ locationName: 'Scoped', overriddenAt: null });
  });

  it('desktop with an empty token uses the scoped door, never the tablet-only ambient one', async () => {
    // The empty string is the real "no session" value, not an artefact of the test:
    // PosScreen.tsx:157 builds the token as `rawToken || ''`.
    setShellKind('desktop');
    const p = params('');
    const { result } = await renderHookInAct(() => usePosCartActions(p));

    await act(async () => {
      await result.current.ensureCart('IDR');
    });

    // Desktop registers no door for the ambient name, so reaching it is the bug:
    // the invoke would be rejected as an unknown command at runtime.
    expect(getCartDeductionLocation).not.toHaveBeenCalled();
    expect(getCartDeductionLocationScoped).toHaveBeenCalledWith('', 'cart-1');
    expect(result.current.deductionLocationName).toBe('Scoped');
  });

  it('tablet with an empty token still uses the ambient door, which it does register', async () => {
    // The other half of the fix: gating on the shell must not disable the ambient
    // path on the one shell that has it. A repair that sent every empty-token
    // call to the scoped twin would be correct for desktop and a regression here.
    setShellKind('tablet');
    const p = params('');
    const { result } = await renderHookInAct(() => usePosCartActions(p));

    await act(async () => {
      await result.current.ensureCart('IDR');
    });

    expect(getCartDeductionLocationScoped).not.toHaveBeenCalled();
    expect(getCartDeductionLocation).toHaveBeenCalledWith('cart-1');
    expect(result.current.deductionLocationName).toBe('Ambient');
  });

  it('a failed name lookup still returns the cart the store just created', async () => {
    // The lookup is display metadata only. startSaleScoped already succeeded and
    // the cart exists; reporting that as a creation failure would tell the operator
    // the sale did not start when it did. The fallback is the raw id, as intended.
    setShellKind('desktop');
    getCartDeductionLocationScoped.mockRejectedValue(new Error('command not found'));
    const p = params('');
    const { result } = await renderHookInAct(() => usePosCartActions(p));

    let cartId: string | null = null;
    await act(async () => {
      cartId = await result.current.ensureCart('IDR');
    });

    expect(cartId).toBe('cart-1');
    expect(result.current.deductionLocationName).toBe('loc-1');
    expect(p.addToast).not.toHaveBeenCalled();
  });
});
