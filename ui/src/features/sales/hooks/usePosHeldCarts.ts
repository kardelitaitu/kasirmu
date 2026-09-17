import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/components/Toast';
import { useExitAnimation } from '@/hooks/useExitAnimation';
import {
  holdCartScoped,
  listOpenBillsScoped,
  getHeldCartScoped,
  type HeldCartRow,
} from '@/api/sales';
import type { Promotion } from '@/api/promotions';
import type { ShiftDto } from '@/api/shifts';
import type { CartLine, LineId, Money, Sku } from '@/types/domain';

/** Exact addToast signature, taken from the Toast provider's own hook. */
type AddToast = ReturnType<typeof useToast>['addToast'];

export interface UsePosHeldCartsParams {
  sessionToken: string;
  addToast: AddToast;
  /** Pass-through from usePosShifts: holding a bill requires an open shift. */
  activeShift: ShiftDto | null;
  lines: CartLine[];
  subtotal: Money | null;
  discountPercent: number;
  discountLabel: string;
  resetCart: () => void;
  setAppliedPromotions: (promotions: Promotion[]) => void;
  setLines: (lines: CartLine[]) => void;
  setDiscount: (percent: number, label: string) => void;
  setTableNumber: (table: string) => void;
}

/**
 * Held-cart ("open bill") lifecycle for the POS screen: the held-bill list and
 * its badge count, the two modal surfaces with their exit animations, the
 * hold-a-cart handler (holdCartScoped), the recall handler
 * (getHeldCartScoped) and the refresh that fires when the list is opened.
 *
 * Moved verbatim out of PosScreen.tsx — same names, same logic, same memo
 * dependencies. Deleting a held cart after checkout stays with the caller
 * (it is part of handlePaymentComplete).
 */
export function usePosHeldCarts({
  sessionToken,
  addToast,
  activeShift,
  lines,
  subtotal,
  discountPercent,
  discountLabel,
  resetCart,
  setAppliedPromotions,
  setLines,
  setDiscount,
  setTableNumber,
}: UsePosHeldCartsParams) {
  // ── Open Bill state ──────────────────────────────────────────────
  const [activeOpenBillId, setActiveOpenBillId] = useState<string | null>(null);
  const [openBills, setOpenBills] = useState<HeldCartRow[]>([]);
  const [showOpenBills, setShowOpenBills] = useState(false);
  // Fade the Open Bills list modal out before the parent setter
  // flips showOpenBills to false. Used by the close button + Resume.
  const openBillsExit = useExitAnimation(
    showOpenBills,
    () => setShowOpenBills(false),
  );
  const loadOpenBills = useCallback(() => {
    listOpenBillsScoped(sessionToken).then(setOpenBills).catch(() => {
      addToast({ message: 'Failed to load open bills', type: 'error' });
    });
  }, [addToast, sessionToken]);

  // ── Open Bill inline state ────────────────────────────────────
  const [showOpenBillInput, setShowOpenBillInput] = useState(false);
  // Fade the Open Bill Input modal out (mirror of pos-modal-slide-up
  // via .pos-hold-modal--exiting) before the parent setter flips
  // showOpenBillInput to false. Used by cancel + Save-success.
  const openBillInputExit = useExitAnimation(
    showOpenBillInput,
    () => setShowOpenBillInput(false),
  );
  const [openBillName, setOpenBillName] = useState('');
  const [openingBill, setOpeningBill] = useState(false);

  useEffect(() => {
    if (showOpenBills) {
      loadOpenBills();
    }
  }, [showOpenBills, loadOpenBills]);

  const handleOpenBill = useCallback(async () => {
    if (!activeShift) {
      addToast({ message: 'Open a shift first', type: 'warning' });
      return;
    }
    if (!subtotal || lines.length === 0) return;
    setOpeningBill(true);
    try {
      const cartData = JSON.stringify({
        lines: lines.map((l) => ({
          sku: l.sku,
          name: l.name,
          qty: l.qty,
          unit_price: l.unit_price,
          // Restaurant coursing: a held bill resumes through the checkout
          // push, so the assignment must survive the hold.
          ...(l.courseId ? { courseId: l.courseId } : {}),
          ...(l.coursingStatus ? { coursingStatus: l.coursingStatus } : {}),
        })),
        discountPercent,
        discountLabel,
      });
      await holdCartScoped(sessionToken, {
        label: openBillName.trim() || `Open Bill #${Date.now()}`,
        cart_data: cartData,
        item_count: lines.length,
        total_minor: subtotal.minor_units,
        currency: subtotal.currency,
        bill_type: 'open_bill',
        customer_name: openBillName.trim(),
      });
    resetCart();
    setAppliedPromotions([]);
    openBillInputExit.requestClose();
    setOpenBillName('');
    loadOpenBills();
    } catch {
      addToast({ message: 'Failed to save open bill', type: 'error' });
    } finally {
      setOpeningBill(false);
    }
  }, [activeShift, lines, subtotal, openBillName, discountPercent, discountLabel, resetCart, loadOpenBills, addToast, openBillInputExit, sessionToken, setAppliedPromotions]);

  const handleResumeOpenBill = useCallback(async (id: string) => {
    try {
      const full = await getHeldCartScoped(sessionToken, id);
      if (!full) return;
      const data = JSON.parse(full.cart_data);
      if (data.lines && Array.isArray(data.lines)) {
        setLines(data.lines.map((l: { sku: string; name?: string; qty: number; unit_price: { minor_units: number; currency: string }; category?: string; courseId?: CartLine['courseId']; coursingStatus?: CartLine['coursingStatus'] }) => ({
          id: `restored-${Date.now()}-${Math.random().toString(36).slice(2)}` as LineId,
          sku: l.sku as Sku,
          name: l.name,
          category: l.category,
          qty: l.qty,
          unit_price: l.unit_price,
          // Restaurant coursing: carried through the hold so a resumed bill
          // keeps its assignments (validated by the CourseId type below).
          ...(l.courseId ? { courseId: l.courseId } : {}),
          ...(l.coursingStatus ? { coursingStatus: l.coursingStatus } : {}),
        })));
      }
      if (typeof data.discountPercent === 'number') {
        setDiscount(data.discountPercent, data.discountLabel || '');
      }
      if (typeof data.tableNumber === 'string') {
        setTableNumber(data.tableNumber);
      }
    setActiveOpenBillId(id);
    openBillsExit.requestClose();
    } catch {
      addToast({ message: 'Failed to resume open bill', type: 'error' });
    }
  }, [setLines, setDiscount, setTableNumber, addToast, openBillsExit, sessionToken]);

  return {
    activeOpenBillId,
    setActiveOpenBillId,
    openBills,
    setShowOpenBills,
    openBillsExit,
    loadOpenBills,
    setShowOpenBillInput,
    openBillInputExit,
    openBillName,
    setOpenBillName,
    openingBill,
    handleOpenBill,
    handleResumeOpenBill,
  };
}
