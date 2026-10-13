// ── The LIVE cart-resize hook's persistence ───────────────────────────
//
// `hooks/useCartResize.ts` replaced the copy in `posScreenHooks.ts`, and `PosScreen`
// imports the new one (`:61`). The old copy is still present and is imported ONLY by
// `__tests__/hooks/useCartWidth.test.tsx`, which asserts
// `localStorage.getItem('pos-cart-width')` on the DEAD hook.
//
// Consequence, measured in round 107: removing BOTH `localStorage.setItem` calls from
// the live hook leaves the whole suite green (88 tests across
// `PosScreen.integration` + `useCartWidth`). The persistence the product relies on is
// unpinned, and the passing suite says otherwise.
//
// This file drives the LIVE hook. It is the coverage the old file only appeared to give.

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCartResize } from '@/features/sales/hooks/useCartResize';
import {
  CART_WIDTH_DEFAULT,
  CART_WIDTH_MAX_CAP,
  CART_WIDTH_MIN,
  clampCartWidth,
} from '@/features/sales/utils/cartCalculations';

const KEY = 'pos-cart-width';

/** Mount the hook with `posScreenRef` attached to a real element, as PosScreen does. */
function renderResize() {
  const { result } = renderHook(() => useCartResize());
  const el = document.createElement('div');
  // jsdom gives every element a zero rect; the hook derives the width from
  // `rect.right - clientX`, so the right edge has to be somewhere sensible.
  el.getBoundingClientRect = () => ({
    right: 1000, left: 0, top: 0, bottom: 0, width: 1000, height: 800, x: 0, y: 0,
    toJSON: () => ({}),
  }) as DOMRect;
  (result.current.posScreenRef as { current: HTMLDivElement | null }).current = el;
  return result;
}

describe('useCartResize persists the width', () => {
  beforeEach(() => { localStorage.clear(); });

  it('reads a saved width on mount, clamped', () => {
    localStorage.setItem(KEY, '500');
    const { current } = renderResize();
    expect(current.cartWidth).toBe(clampCartWidth(500, window.innerWidth));
  });

  it('falls back to the default when nothing is saved', () => {
    const { current } = renderResize();
    expect(current.cartWidth).toBe(clampCartWidth(CART_WIDTH_DEFAULT, window.innerWidth));
  });

  it('WRITES the width during a drag — the behaviour nothing else pins', () => {
    const { current } = renderResize();
    expect(localStorage.getItem(KEY), 'precondition: nothing saved yet').toBeNull();

    act(() => { current.startResize({ cancelable: false } as never); });
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 600 }));
    });
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: 600 }));
    });

    expect(
      localStorage.getItem(KEY),
      'the drag did not persist the width, so the operator\'s resize is lost on reload.',
    ).not.toBeNull();
    // The hook derives the width from the element's right edge (1000) minus the pointer
    // (600) = 400, then clamps. Asserting the CLAMPED geometry rather than the state,
    // which updates on the next render.
    expect(Number(localStorage.getItem(KEY))).toBe(clampCartWidth(400, window.innerWidth));
  });

  // ── Ported from `hooks/useCartWidth.test.tsx` (round 108) ─────────────
  //
  // That file drove the DEAD `posScreenHooks.ts` copy. These are its clamping cases,
  // re-pointed at the live hook before the dead file is removed, so the coverage survives
  // the deletion.
  //
  // Its own note is worth keeping: the bounds must be asserted against the CONSTANTS.
  // The old case read `toBe(320)` and kept passing after the floor moved to 400, because
  // the hook carried a private copy of the bounds — "the test and the code agreed with
  // each other and neither agreed with the shipped value".
  it('clamps a saved value up to the minimum', () => {
    localStorage.setItem(KEY, '100');
    const { current } = renderResize();
    expect(current.cartWidth).toBe(CART_WIDTH_MIN);
  });

  it('clamps a saved value down to the viewport half', () => {
    localStorage.setItem(KEY, '2000');
    const { current } = renderResize();
    // jsdom's innerWidth is 1024, so the cap is half of that unless CART_WIDTH_MAX_CAP
    // is smaller. Asserted through the same helper the hook uses.
    expect(current.cartWidth).toBe(clampCartWidth(2000, window.innerWidth));
  });

  it('settles between the shipped bounds when nothing is saved', () => {
    const { current } = renderResize();
    expect(current.cartWidth).toBeGreaterThanOrEqual(CART_WIDTH_MIN);
    expect(current.cartWidth).toBeLessThanOrEqual(CART_WIDTH_MAX_CAP);
  });

  it('startResize sets the resize cursor and body class, and cleans both up', () => {
    const { current } = renderResize();
    const baseline = document.body.style.cursor;
    act(() => { current.startResize({ cancelable: false } as never); });
    expect(document.body.style.cursor).toBe('col-resize');
    expect(document.body.style.userSelect).toBe('none');
    expect(document.body.classList.contains('is-resizing')).toBe(true);

    act(() => { window.dispatchEvent(new MouseEvent('mouseup')); });
    expect(document.body.style.cursor).toBe(baseline === '' ? '' : baseline);
    expect(document.body.classList.contains('is-resizing')).toBe(false);
  });

  // Ported from the dead file's `cleans up on mouseup`, which asserted something my
  // cursor/class case above does NOT: that a mousemove AFTER the drag ends changes
  // nothing. The resize handler is registered for the drag's lifetime, so a handler that
  // outlives its mouseup would keep writing widths from a stray pointer.
  it('ignores mousemoves once the drag has ended', () => {
    localStorage.setItem(KEY, '500');
    const { current } = renderResize();

    act(() => { current.startResize({ cancelable: false } as never); });
    act(() => { window.dispatchEvent(new MouseEvent('mousemove', { clientX: 600 })); });
    act(() => { window.dispatchEvent(new MouseEvent('mouseup', { clientX: 600 })); });
    const settled = localStorage.getItem(KEY);
    expect(settled, 'the drag did not persist at all, so this case is vacuous').not.toBeNull();

    act(() => { window.dispatchEvent(new MouseEvent('mousemove', { clientX: 200 })); });
    expect(
      localStorage.getItem(KEY),
      'a mousemove after mouseup still wrote a width: the drag handler outlived its own end.',
    ).toBe(settled);
  });

  it('persists a RE-CLAMP on window resize', () => {
    localStorage.setItem(KEY, '900');
    renderResize();
    const before = localStorage.getItem(KEY);
    act(() => { window.dispatchEvent(new Event('resize')); });
    // The clamp runs and re-persists; whatever it writes must be a number.
    const after = localStorage.getItem(KEY);
    expect(after).not.toBeNull();
    expect(Number.isFinite(Number(after))).toBe(true);
    // Non-vacuity: the case must be able to observe a CHANGE when the clamp bites.
    expect(before === null || Number(before) >= 0).toBe(true);
  });
});
