import { useCallback, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { useToast } from '@/components/Toast';
import type { usePosState } from '../usePosState';
import { requiredLocalized } from '@/components';
import { plainErrorMessage } from '@/utils/app-error';
import { triggerInteraction } from '@/utils/interaction';
import { devLog } from '@/utils/devLog';
import { isTabletShell } from '@/utils/shellKind';
import { useAnimatedUndoStack } from '@/hooks/useAnimatedUndoStack';
import type { Promotion } from '@/api/promotions';
import {
  startSaleScoped,
  getCartDeductionLocation,
  getCartDeductionLocationScoped,
  overrideCartDeductionLocation,
  overrideLinePriceScoped,
  setLineCourseScoped,
} from '@/api/sales';
import type { ShiftDto } from '@/api/shifts';
import type { CartId, CartLine, CourseId, ModifierSelection, Product } from '@/types/domain';

/** Exact addToast signature, taken from the Toast provider's own hook. */
type AddToast = ReturnType<typeof useToast>['addToast'];
/** Cart mutators, typed off the real usePosState return so no signature is guessed. */
type PosState = ReturnType<typeof usePosState>;
/** Structural twin of the caller's useRef(l10n) result — non-null current. */
type L10nRef = { current: Parameters<typeof requiredLocalized>[0] };

/**
 * A cart line removed from the sale, held on the undo stack together with the
 * index it occupied so Undo can put it BACK rather than on top.
 *
 * This exists because `CartLine` is position-free: the list order IS the
 * position, so a bare line cannot be restored to its original spot. See
 * `handleRemoveLine` for the measurement that made the difference visible.
 */
interface RemovedLine {
  /** The line that was removed. */
  line: CartLine;
  /** Index the line held in `lines` at removal time. */
  index: number;
}

export interface UsePosCartActionsParams {
  sessionToken: string;
  addToast: AddToast;
  /**
   * Pass-through from usePosShifts: adding to the cart requires an open shift
   * WHEN the shift service is reachable. Shifts are informational (cash
   * reconciliation + reporting), so a shell that does not register the shift
   * commands must not have the till gated on them — see shiftUnavailableRef.
   */
  activeShiftRef: { current: ShiftDto | null };
  /** True when the shift commands could not be reached at all on this shell. */
  shiftUnavailableRef: { current: boolean };
  /** Bundle ref, threaded so the unbound-cart toast keeps its localised text. */
  l10nRef: L10nRef;
  addProduct: PosState['addProduct'];
  changeQty: PosState['changeQty'];
  updateLinePrice: PosState['updateLinePrice'];
  removeLine: PosState['removeLine'];
  setLines: PosState['setLines'];
  setDiscount: PosState['setDiscount'];
  /** Discount form fields — the inputs stay owned by PosScreen's JSX. */
  discountInput: string;
  discountName: string;
  setShowDiscountInput: Dispatch<SetStateAction<boolean>>;
  setDiscountInput: Dispatch<SetStateAction<string>>;
  setDiscountName: Dispatch<SetStateAction<string>>;
  setShowPromotions: Dispatch<SetStateAction<boolean>>;
  setAppliedPromotions: Dispatch<SetStateAction<Promotion[]>>;
  /** Supervisor / manager role override for ringing up 86/out-of-stock items. */
  isManager?: boolean;
}

/**
 * Cart line manipulation for the POS screen: the sale-cart handle and the
 * ADR-19 deduction-location binding that is locked at cart-start time
 * (ensureCart / the badge → FastPIN override path), the guarded add-product
 * entry, the +/- quantity wrappers, and the per-line price-override commit.
 *
 * Moved verbatim out of PosScreen.tsx — same names, same logic, same memo
 * dependencies. Removal, undo, discount and promotion paths are NOT here.
 */
export function usePosCartActions({
  sessionToken,
  addToast,
  activeShiftRef,
  shiftUnavailableRef,
  l10nRef,
  addProduct,
  changeQty,
  updateLinePrice,
  setLines,
  setDiscount,
  discountInput,
  discountName,
  setShowDiscountInput,
  setDiscountInput,
  setDiscountName,
  setShowPromotions,
  setAppliedPromotions,
  isManager,
}: UsePosCartActionsParams) {
  const [overrideTarget, setOverrideTarget] = useState<CartLine | null>(null);
  const [showFastPINOverlay, setShowFastPINOverlay] = useState(false);
  const [cartId, setCartId] = useState<CartId | null>(null);
  // ADR-19 §5.1: deduction location locked at cart-start time.
  // Use a ref for synchronous reads inside callbacks; state drives renders.
  const deductionLocationIdRef = useRef<string | null>(null);
  const [deductionLocationName, setDeductionLocationName] = useState<string | null>(null);
  const ensureCart = useCallback(async (currency: string): Promise<CartId | null> => {
    if (cartId) return cartId;
    try {
      const { cartId: newCartId, deductionLocationId: locId } = await startSaleScoped(sessionToken, { currency });
      setCartId(newCartId);
      deductionLocationIdRef.current = locId ?? null;
      if (locId) {
        // Fetch the real location name from the backend. Scoped per ADR #7: the ambient
        // get_cart_deduction_location is registered by tablet only, so on desktop this call threw
        // "command not found" -- and the outer catch then reported it as a cart-creation failure
        // even though startSaleScoped had already succeeded and setCartId had already run.
        //
        // So the lookup now has its own guard. It resolves display metadata only; the fallback at
        // `?? locId` below is the degradation this code always intended, and it can only happen if
        // the name was never fetched. A cart that exists must be returned as existing.
        try {
          // The ambient name is TABLET-only; desktop registers only the scoped twin.
          // `sessionToken` is an empty string when there is no session, so a bare
          // truthiness test sent the desktop down the ambient branch and the invoke was
          // rejected as an unknown command. Gate on the shell as well. Same defect and
          // same fix as PosScreen.tsx:891 -- found by scripts/verify-ipc-parity.py.
          const info =
            sessionToken || !isTabletShell()
              ? await getCartDeductionLocationScoped(sessionToken, newCartId)
              : await getCartDeductionLocation(newCartId);
          setDeductionLocationName(info?.locationName ?? locId);
          if (info?.overriddenAt) setDeductionOverridden(true);
        } catch {
          setDeductionLocationName(locId);
        }
      } else {
        setDeductionLocationName(null);
      }
      return newCartId;
    } catch {
      addToast({ message: requiredLocalized(l10nRef.current, 'pos-toast-cart-create-failed'), type: 'error' });
      return null;
    }
  }, [cartId, addToast, sessionToken, l10nRef]);

  const handleAddProduct = useCallback(
    (
      product: Product,
      qtyOrMeta?: number | { courseId?: CourseId; modifiers?: ModifierSelection[]; note?: string },
      maybeMeta?: { courseId?: CourseId; modifiers?: ModifierSelection[]; note?: string },
    ) => {
      // Refuse only when the shift service is REACHABLE and no shift is
      // open. When it is unreachable the requirement does not apply: shifts
      // are informational, and blocking here would gate the till on a
      // reporting feature the shell does not ship.
      if (!activeShiftRef.current && !shiftUnavailableRef.current) {
        addToast({
          message: requiredLocalized(l10nRef.current, 'retail-toast-open-shift-first'),
          type: 'warning',
        });
        return;
      }
      // Check stock availability (Automated 86 / Out-of-Stock)
      if (product.inStock === false && !isManager) {
        addToast({
          message: requiredLocalized(l10nRef.current, 'pos-product-out-of-stock', { name: product.name }),
          type: 'warning',
        });
        return;
      }
      // ADR-19 §5.1: reject add_line when cart exists but has no deduction location
      if (cartId && !deductionLocationIdRef.current) {
        addToast({ message: requiredLocalized(l10nRef.current, 'pos-cart-unbound-error'), type: 'error' });
        return;
      }
      const qty = typeof qtyOrMeta === 'number' ? qtyOrMeta : 1;
      const meta = typeof qtyOrMeta === 'object' && qtyOrMeta !== null ? qtyOrMeta : maybeMeta;
      addProduct(product, qty, meta);
    },
    [addProduct, addToast, cartId, activeShiftRef, shiftUnavailableRef, l10nRef, isManager], // refs stable; identity of the wrapped value must not enter deps
  );

  // ADR-19 §17: badge click → FastPINOverlay for manager override
  const handleDeductionBadgeClick = useCallback(() => {
    setShowFastPINOverlay(true);
  }, []);

  const [deductionOverridden, setDeductionOverridden] = useState(false);

  const handleDeductionPinVerified = useCallback(async () => {
    if (!cartId) return;
    if (!sessionToken) {
      // Reported, not dropped. This handler toasts on both of its other paths
      // (`pos-toast-override-recorded` / `-failed`), so the token branch was the one
      // silent outcome: the manager enters the PIN, nothing is recorded, nothing says so.
      addToast({ message: requiredLocalized(l10nRef.current, 'pos-toast-auth-required'), type: 'warning' });
      return;
    }
    try {
      await overrideCartDeductionLocation(sessionToken, cartId);
      setDeductionOverridden(true);
      addToast({ message: requiredLocalized(l10nRef.current, 'pos-toast-override-recorded'), type: 'success' });
    } catch {
      addToast({ message: requiredLocalized(l10nRef.current, 'pos-toast-override-failed'), type: 'error' });
    }
  }, [cartId, sessionToken, addToast, l10nRef]);

  // DELTA, not an absolute quantity — the same fix as RetailPosScreen.handleIncreaseQty.
  //
  // `updateQty(id, line.qty - 1)` was wrong TWICE over:
  //   1. two taps in one React batch both close over the same rendered `line.qty`, so both
  //      write the same value and the second press is lost;
  //   2. on a qty-1 line it computes `updateQty(id, 0)`, which usePosState REJECTS
  //      (`if (qty <= 0) return`, usePosState.ts:139) — so the decrease button did nothing
  //      at all rather than removing the line.
  //
  // `changeQty` resolves the delta inside the `setLines` updater against the committed
  // state, and drops the line when it reaches zero.
  const handleDecreaseQty = useCallback((line: CartLine) => {
    changeQty(line.id, -1);
  }, [changeQty]);

  const handleIncreaseQty = useCallback((line: CartLine) => {
    changeQty(line.id, 1);
  }, [changeQty]);

  const handleOverrideConfirm = useCallback(async (newPriceMinor: number, _authorizingUserId: string) => {
    if (!overrideTarget) return;
    const cId = cartId;
    if (!cId) {
      addToast({ message: requiredLocalized(l10nRef.current, 'pos-toast-no-active-cart'), type: 'error' });
      setOverrideTarget(null);
      return;
    }
    try {
      await overrideLinePriceScoped(sessionToken, cId, overrideTarget.id, newPriceMinor);
      // READ THE RESULT. `updateLinePrice` returns `false` and writes nothing when the
      // price's currency differs from the cart's anchor. The server has ALREADY
      // accepted the override by this point, so ignoring it means the total the
      // cashier watches does not match what the backend holds — the worst of the
      // three call sites, because the sale was recorded and the preview was not.
      const applied = updateLinePrice(overrideTarget.id, {
        minor_units: newPriceMinor,
        currency: overrideTarget.unit_price.currency,
      });
      if (!applied) {
        // The localized string IS the message here. `plainErrorMessage` is for a
        // backend error shape; passing a synthetic Error to it just returns the
        // fallback, so it would be ceremony.
        addToast({
          message: requiredLocalized(l10nRef.current, 'pos-toast-line-price-currency-mismatch'),
          type: 'error',
        });
      }
    } catch (err) {
      // The FALLBACK is what the cashier sees when the backend sent no message, so
      // it is localized too — plainErrorMessage's second argument is user-visible.
      const msg = plainErrorMessage(err, requiredLocalized(l10nRef.current, 'pos-toast-override-failed'));
      addToast({ message: msg, type: 'error' });
    } finally {
      setOverrideTarget(null);
    }
  }, [overrideTarget, cartId, addToast, updateLinePrice, sessionToken, l10nRef]);


    const handleApplyDiscount = useCallback(() => {
    // Whole percentage only — reject fractional input instead of
    // silently truncating it via parseInt.
    const pct = Number(discountInput);
    if (!Number.isInteger(pct) || pct < 1 || pct > 100) return;
    setDiscount(pct, discountName.trim() || `${pct}% Discount`);
    setShowDiscountInput(false);
    setDiscountInput('');
    setDiscountName('');
  }, [discountInput, discountName, setDiscount, setDiscountInput, setDiscountName, setShowDiscountInput]);

  const handleClearDiscount = useCallback(() => {
    setDiscount(0, '');
  }, [setDiscount]);

  // PROMO-3: accumulate the picker selection (multi-select, stacking).
  const handleSelectPromotions = useCallback((selected: Promotion[]) => {
    setAppliedPromotions(selected);
    setShowPromotions(false);
    const names = selected.map((p) => p.name).join(', ');
    if (selected.length > 0) {
      addToast({ message: requiredLocalized(l10nRef.current, 'pos-promotions-applied', { name: names }), type: 'success' });
    }
  }, [addToast, l10nRef, setAppliedPromotions, setShowPromotions]);

    // ── Multi-step undo stack ───────────────────────────────────
  // Each removed line is pushed onto the stack. Pressing Undo pops
  // the most recent one and re-inserts it. The state machine and
  // race-safe exit fade are owned by `useAnimatedUndoStack` so the
  // contract can be tested directly via renderHook — bypassing the
  // CartLineItem 200ms exit timer that prevents concurrent pushes
  // from landing during the fade on the component layer. MAX size
  // 5 so the cashier can recover from a batch of mistakes.
  const animatedUndoStack = useAnimatedUndoStack<RemovedLine>({
    maxSize: 5,
    // Keyed on the line id so the race-safety id-set check in the hook is
    // unchanged by the extra `index` the wrapper carries.
    getId: (removed) => String(removed.line.id),
  });

  // Push a removed cart line onto the undo stack so the cashier
  // can recover up to the last 5 removes via the floating pill.
  //
  // ⚠️ THE INDEX IS CAPTURED HERE, and it is the whole point of `RemovedLine`.
  // `handleUndoRemove` used to re-insert with `[popped, ...prev]` — always the
  // TOP — because `CartLine` is position-free (types/domain.ts:109-128) and the
  // undo stack stored the bare line. Measured: removing the 3rd of 3 lines and
  // pressing Undo produced [removed, 1st, 3rd] instead of [1st, removed, 3rd],
  // so the ticket order changed underneath the waiter.
  //
  // The index is read INSIDE the updater, so it is the index against the
  // committed list rather than against whatever the row rendered with — the same
  // committed-state discipline `changeQty` uses.
  const handleRemoveLine = useCallback((line: CartLine) => {
    let removedIndex = -1;
    setLines((prev) => {
      removedIndex = prev.findIndex((l) => l.id === line.id);
      return prev.filter((l) => l.id !== line.id);
    });
    // -1 means the line was not in the committed list (a double-remove off a
    // stale row). Clamped to 0 on restore, which is the old behaviour and the
    // only sensible reading when no position was recorded.
    animatedUndoStack.push({ line, index: Math.max(0, removedIndex) });
  }, [setLines, animatedUndoStack]);

  // Pop the top of the undo stack and re-insert the line at the index it was
  // removed from. When the pop empties the stack, the hook schedules the
  // fade so the pill unmounts via the exit keyframe instead of
  // snapping away.
  const handleUndoRemove = useCallback(() => {
    const popped = animatedUndoStack.pop();
    if (popped === undefined) return;
    triggerInteraction('undo-cart');
    setLines((prev) => {
      const restored = [...prev];
      // Clamp: lines may have been removed or reordered while this sat on the
      // stack (it holds up to 5), so the recorded index can exceed the list.
      const at = Math.min(Math.max(0, popped.index), restored.length);
      restored.splice(at, 0, popped.line);
      return restored;
    });
  }, [animatedUndoStack, setLines]);

  // Dismiss the pill via the race-safe exit fade. Concurrent
  // pushes during the 200 ms window abort the clear (see the
  // useAnimatedUndoStack contract + the applyExitAnimation skill).
  const handleDismissUndo = useCallback(() => {
    animatedUndoStack.dismiss();
  }, [animatedUndoStack]);
  /**
   * Persist a line's course to the backend cart, so coursing survives an app
   * restart. The device-local `assignCourse` in `usePosState` runs first and is
   * what the UI renders; this mirrors it onto the server cart.
   *
   * BEST-EFFORT BY DESIGN. `set_line_course_scoped` needs a cart that exists and
   * `SALES_PROCESS`, and a cashier mid-service must never be blocked from putting
   * a course on a line because a sync failed -- the local assignment has already
   * happened and is correct for this shift. A failure is swallowed for the same
   * reason the deduction-name lookup is: the screen keeps working, and the next
   * successful assign re-syncs. It is NOT silent to a developer -- `devLog` records
   * it, the same convention the rest of this file uses.
   */
  const syncLineCourse = useCallback(
    async (lineId: string, courseId: string) => {
      if (!cartId) return;
      try {
        await setLineCourseScoped(sessionToken, {
          cartId,
          lineId,
          // The device-side convention is that '' means "clear" (the course
          // chip's None option); the backend's is `None`. Translate here rather
          // than at the call site so the two vocabularies meet in one place.
          course: courseId === '' ? null : courseId,
        });
      } catch (err) {
        devLog.warn('pos-course', `course sync failed for line ${lineId}: ${String(err)}`);
      }
    },
    [cartId, sessionToken],
  );

  return {
    overrideTarget,
    syncLineCourse,    setOverrideTarget,
    showFastPINOverlay,
    setShowFastPINOverlay,
    setCartId,
    deductionLocationIdRef,
    deductionLocationName,
    setDeductionLocationName,
    ensureCart,
    handleAddProduct,
    handleDeductionBadgeClick,
    deductionOverridden,
    setDeductionOverridden,
    handleDeductionPinVerified,
    handleDecreaseQty,
    handleIncreaseQty,
    handleOverrideConfirm,
    handleApplyDiscount,
    handleClearDiscount,
    handleSelectPromotions,
    animatedUndoStack,
    handleRemoveLine,
    handleUndoRemove,
    handleDismissUndo,
  };
}