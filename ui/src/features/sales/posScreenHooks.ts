// ui/src/features/sales/posScreenHooks.ts
//
// Extracted hooks from PosScreen.tsx for testability and reusability.

import { useState, useEffect, useRef, useCallback } from 'react';
import type { LineId, CartLine, Sku, Money } from '@/types/domain';

// ── useShiftTimer ────────────────────────────────────────────────────────
/**
 * Live elapsed-shift clock: while a shift is open, tick every minute so
 * the header can show a running "2h 15m" instead of the bare opening
 * time (which read like a wall clock). The interval stops when the
 * shift closes — activeShift → null runs the effect's cleanup.
 */
export function useShiftTimer(activeShift: { openedAt: string } | null) {
  const [shiftNow, setShiftNow] = useState(() => Date.now());

  useEffect(() => {
    if (!activeShift) return;
    // Rebase the elapsed anchor the instant a shift becomes active so the
    // first render is accurate even if the screen was mounted long before.
    setShiftNow(Date.now());
    const id = window.setInterval(() => setShiftNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [activeShift]);

  return shiftNow;
}

// ── useCartWidth ─────────────────────────────────────────────────────────
const CART_WIDTH_MIN = 320;
const CART_WIDTH_DEFAULT = 440;
const CART_WIDTH_MAX_CAP = 1200;

function clampCartWidth(px: number, viewportWidth: number): number {
  const max = Math.max(
    CART_WIDTH_MIN,
    Math.min(viewportWidth * 0.5, CART_WIDTH_MAX_CAP),
  );
  return Math.max(CART_WIDTH_MIN, Math.min(Math.round(px), max));
}

/**
 * Manages the resizable cart panel width with localStorage persistence
 * and viewport-aware clamping.
 */
export function useCartWidth(posScreenRef: React.RefObject<HTMLDivElement | null>) {
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

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const stopResize = () => {
      if (!isResizing.current) return;
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!isResizing.current || !posScreenRef.current) return;
      const rect = posScreenRef.current.getBoundingClientRect();
      const clamped = clampCartWidth(rect.right - e.clientX, window.innerWidth);
      setCartWidth(clamped);
      // Persist the clamped value so the next launch on this
      // display picks up the most recent *applied* width.
      localStorage.setItem('pos-cart-width', String(clamped));
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', stopResize);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', stopResize);
      stopResize();
    };
  }, [posScreenRef]);

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

  return { cartWidth, setCartWidth, startResize };
}

// ── useLockedCartPersistence ─────────────────────────────────────────────
const LOCKED_CART_KEY = 'pos-locked-cart';

interface LockedCartData {
  lines: Array<{
    sku: Sku;
    name: string | undefined;
    category: string | undefined;
    qty: number;
    unit_price: Money;
  }>;
  discountPercent: number;
  discountLabel: string;
  tipPercent: number;
  serviceChargeEnabled: boolean;
  serviceChargePercent: number;
}

/**
 * Persists cart state to localStorage on lock, restores on mount.
 */
export function useLockedCartPersistence(
  lines: CartLine[],
  discountPercent: number,
  discountLabel: string,
  tipPercent: number,
  serviceChargeEnabled: boolean,
  serviceChargePercent: number,
  setLines: React.Dispatch<React.SetStateAction<CartLine[]>>,
  setDiscount: (pct: number, label: string) => void,
  setTipPercent: (pct: number) => void,
  setServiceCharge: (enabled: boolean, pct?: number) => void,
  logout: () => void,
) {
  const handleLock = useCallback(() => {
    try {
      if (lines.length > 0) {
        const data: LockedCartData = {
          lines: lines.map((l) => ({
            sku: l.sku,
            name: l.name ?? undefined,
            category: l.category ?? undefined,
            qty: l.qty,
            unit_price: l.unit_price,
          })),
          discountPercent,
          discountLabel,
          tipPercent,
          serviceChargeEnabled,
          serviceChargePercent,
        };
        localStorage.setItem(LOCKED_CART_KEY, JSON.stringify(data));
      } else {
        localStorage.removeItem(LOCKED_CART_KEY);
      }
    } catch { /* storage quota or unavailable — ignore */ }
    logout();
  }, [lines, discountPercent, discountLabel, tipPercent, serviceChargeEnabled, serviceChargePercent, logout]);

  const restoreLockedCart = useCallback(() => {
    try {
      const raw = localStorage.getItem(LOCKED_CART_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as LockedCartData;
      if (data.lines && Array.isArray(data.lines)) {
        setLines(data.lines.map((l) => ({
          id: `restored-${Date.now()}-${Math.random().toString(36).slice(2)}` as LineId,
          sku: l.sku as CartLine['sku'],
          name: l.name ?? '',
          category: l.category ?? '',
          qty: l.qty,
          unit_price: l.unit_price,
        })));
      }
      if (typeof data.discountPercent === 'number') {
        setDiscount(data.discountPercent, data.discountLabel || '');
      }
      if (typeof data.tipPercent === 'number') {
        setTipPercent(data.tipPercent);
      }
      if (typeof data.serviceChargeEnabled === 'boolean') {
        setServiceCharge(data.serviceChargeEnabled, data.serviceChargePercent);
      }
      localStorage.removeItem(LOCKED_CART_KEY);
    } catch { /* ignore */ }
  }, [setLines, setDiscount, setTipPercent, setServiceCharge]);

  return { handleLock, restoreLockedCart };
}