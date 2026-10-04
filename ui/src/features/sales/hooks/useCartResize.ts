// ─── useCartResize ───
// The cart panel resize block, moved out of PosScreen.tsx verbatim: the
// persisted width state, the isResizing latch, the drag handle that sets the
// body cursor / user-select, the mousemove+mouseup plumbing and the
// window-resize re-clamp. Same clamping, same default width, same listeners,
// same cleanup, same localStorage key. The viewport-aware rule is unchanged:
// the panel can grow on wide screens (up to half the viewport, capped at
// 1200 px) but stays at or above 320 px for legibility.
//
// Dependency injection: this hook receives nothing, because nothing outside
// it feeds the drag. posScreenRef is allocated here and RETURNED - the resize
// effect is that ref's only reader; PosScreen keeps binding it to its own
// root div, exactly as before. cartPanelRef (a CartPanel prop, never read by
// the maths) and the keyboard slice's cartLineRefs / setCartLineRef are not
// here: they stay in the shell. Hook order inside this function is the order
// the block had inline, so no memo or state slot moved within the group.
//
// Clamping lives in utils/cartCalculations (another campaign's file, imported
// untouched). Storage: the key literal pos-cart-width moved here from
// PosScreen.tsx, so storageKeyPins.test.ts names this module as its owner.

import { useCallback, useEffect, useRef, useState } from 'react';
// React's MouseEvent is aliased: the DOM MouseEvent is used unaliased by the
// window listener below, and the shell annotated this one React.MouseEvent via
// the UMD namespace, which is not in scope in a .ts module.
import type {
  MouseEvent as ReactMouseEvent,
  TouchEvent as ReactTouchEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { clampCartWidth, CART_WIDTH_DEFAULT } from '../utils/cartCalculations';

export type CartResizeEvent = ReactMouseEvent | ReactTouchEvent | ReactPointerEvent;

/**
 * Persisted, viewport-clamped cart-panel width plus the drag handle that
 * changes it. Call it once from the screen that renders the split.
 *
 * returns cartWidth    - current panel width in px (already clamped)
 *         startResize  - onMouseDown / onTouchStart / onPointerDown handler
 *         posScreenRef - ref for the screen root div; the drag maths reads its
 *                        getBoundingClientRect(), so it must be attached
 */
export function useCartResize() {
  const [cartWidth, setCartWidth] = useState(() => {
    const saved = localStorage.getItem('pos-cart-width');
    const parsed = saved ? parseInt(saved, 10) : NaN;
    const initial =
      Number.isFinite(parsed) && parsed > 0 ? parsed : CART_WIDTH_DEFAULT;
    const viewportWidth =
      typeof window !== 'undefined' ? window.innerWidth : CART_WIDTH_DEFAULT * 2;
    return clampCartWidth(initial, viewportWidth);
  });
  const isResizing = useRef(false);
  const posScreenRef = useRef<HTMLDivElement>(null);
  const lastClientXRef = useRef<number | null>(null);

  const startResize = useCallback((e: CartResizeEvent) => {
    if ('cancelable' in e && e.cancelable) {
      e.preventDefault();
    }
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.body.classList.add('is-resizing');
  }, []);

  useEffect(() => {
    let rafId: number | null = null;

    const applyWidthFromPointer = () => {
      if (lastClientXRef.current === null || !posScreenRef.current) return;
      const rect = posScreenRef.current.getBoundingClientRect();
      const clamped = clampCartWidth(rect.right - lastClientXRef.current, window.innerWidth);
      setCartWidth(clamped);
      localStorage.setItem('pos-cart-width', String(clamped));
    };

    const stopResize = () => {
      if (!isResizing.current) return;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
        applyWidthFromPointer();
      }
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.body.classList.remove('is-resizing');
    };

    const getClientX = (e: MouseEvent | TouchEvent | PointerEvent): number | null => {
      if ('touches' in e && e.touches[0]) {
        return e.touches[0].clientX;
      }
      if ('clientX' in e && typeof e.clientX === 'number') {
        return e.clientX;
      }
      return null;
    };

    const onPointerMove = (e: MouseEvent | TouchEvent | PointerEvent) => {
      if (!isResizing.current || !posScreenRef.current) return;
      const clientX = getClientX(e);
      if (clientX === null) return;
      lastClientXRef.current = clientX;
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        applyWidthFromPointer();
      });
    };

    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', stopResize);
    window.addEventListener('touchmove', onPointerMove, { passive: true });
    window.addEventListener('touchend', stopResize);
    window.addEventListener('touchcancel', stopResize);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);

    return () => {
      window.removeEventListener('mousemove', onPointerMove);
      window.removeEventListener('mouseup', stopResize);
      window.removeEventListener('touchmove', onPointerMove);
      window.removeEventListener('touchend', stopResize);
      window.removeEventListener('touchcancel', stopResize);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
      stopResize();
    };
  }, []);

  // Re-clamp the cart width whenever the window is resized —
  // important when the cashier drags the window to a different
  // monitor, or a docked laptop reconnects to its 4K display.
  useEffect(() => {
    const onResize = () => {
      setCartWidth((w) => {
        const clamped = clampCartWidth(w, window.innerWidth);
        localStorage.setItem('pos-cart-width', String(clamped));
        return clamped;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return { cartWidth, startResize, posScreenRef };
}
