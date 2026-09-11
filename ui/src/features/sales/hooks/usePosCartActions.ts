import { useCallback, useRef, useState } from 'react';
import type { useToast } from '@/frontend/shared/Toast';
import type { usePosState } from '../usePosState';
import { requiredLocalized } from '@/frontend/shared';
import { plainErrorMessage } from '@/utils/app-error';
import {
  startSaleScoped,
  getCartDeductionLocation,
  getCartDeductionLocationScoped,
  overrideCartDeductionLocation,
  overrideLinePriceScoped,
} from '@/api/sales';
import type { ShiftDto } from '@/api/shifts';
import type { CartId, CartLine, Product } from '@/types/domain';

/** Exact addToast signature, taken from the Toast provider's own hook. */
type AddToast = ReturnType<typeof useToast>['addToast'];
/** Cart mutators, typed off the real usePosState return so no signature is guessed. */
type PosState = ReturnType<typeof usePosState>;
/** Structural twin of the caller's useRef(l10n) result — non-null current. */
type L10nRef = { current: Parameters<typeof requiredLocalized>[0] };

export interface UsePosCartActionsParams {
  sessionToken: string;
  addToast: AddToast;
  /** Pass-through from usePosShifts: adding to the cart requires an open shift. */
  activeShiftRef: { current: ShiftDto | null };
  /** Bundle ref, threaded so the unbound-cart toast keeps its localised text. */
  l10nRef: L10nRef;
  addProduct: PosState['addProduct'];
  updateQty: PosState['updateQty'];
  updateLinePrice: PosState['updateLinePrice'];
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
  l10nRef,
  addProduct,
  updateQty,
  updateLinePrice,
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
          const info = sessionToken
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
      addToast({ message: 'Failed to create sale cart', type: 'error' });
      return null;
    }
  }, [cartId, addToast, sessionToken]);

  const handleAddProduct = useCallback(
    (product: Product, qty?: number) => {
      if (!activeShiftRef.current) {
        addToast({ message: 'Open a shift first', type: 'warning' });
        return;
      }
      // ADR-19 §5.1: reject add_line when cart exists but has no deduction location
      if (cartId && !deductionLocationIdRef.current) {
        addToast({ message: requiredLocalized(l10nRef.current, 'pos-cart-unbound-error'), type: 'error' });
        return;
      }
      addProduct(product, qty);
    },
    [addProduct, addToast, cartId], // l10n via ref
  );

  // ADR-19 §17: badge click → FastPINOverlay for manager override
  const handleDeductionBadgeClick = useCallback(() => {
    setShowFastPINOverlay(true);
  }, []);

  const [deductionOverridden, setDeductionOverridden] = useState(false);

  const handleDeductionPinVerified = useCallback(async () => {
    if (!cartId) return;
    if (!sessionToken) return;
    try {
      await overrideCartDeductionLocation(sessionToken, cartId);
      setDeductionOverridden(true);
      addToast({ message: 'Deduction location override recorded', type: 'success' });
    } catch {
      addToast({ message: 'Failed to record override', type: 'error' });
    }
  }, [cartId, sessionToken, addToast]);

  const handleDecreaseQty = useCallback((line: CartLine) => {
    updateQty(line.id, line.qty - 1);
  }, [updateQty]);

  const handleIncreaseQty = useCallback((line: CartLine) => {
    updateQty(line.id, line.qty + 1);
  }, [updateQty]);

  const handleOverrideConfirm = useCallback(async (newPriceMinor: number, _authorizingUserId: string) => {
    if (!overrideTarget) return;
    const cId = cartId;
    if (!cId) {
      addToast({ message: 'No active sale cart', type: 'error' });
      setOverrideTarget(null);
      return;
    }
    try {
      await overrideLinePriceScoped(sessionToken, cId, overrideTarget.id, newPriceMinor);
      updateLinePrice(overrideTarget.id, {
        minor_units: newPriceMinor,
        currency: overrideTarget.unit_price.currency,
      });
    } catch (err) {
      const msg = plainErrorMessage(err, 'Override failed');
      addToast({ message: msg, type: 'error' });
    } finally {
      setOverrideTarget(null);
    }
  }, [overrideTarget, cartId, addToast, updateLinePrice, sessionToken]);

  return {
    overrideTarget,
    setOverrideTarget,
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
  };
}
