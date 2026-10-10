import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { useLocalization } from '@fluent/react';
import { Localized } from '@/components/Localized';
import { requiredLocalized } from '@/components';
import type { Toast } from '@/components/Toast';
import type { CartId } from '@/types/domain';
import type { ShiftDto } from '@/api/shifts';

export interface CartActionBarProps {
  activeShift: ShiftDto | null;
  /**
   * The shift service could not be reached, so `activeShift` is null for a
   * reason the cashier cannot act on.
   *
   * This exists because gating the button on `activeShift` alone re-blocked the
   * till that PosScreen's own guard had just unblocked: `handlePay` permits a
   * sale when a shift is open OR the service is unreachable
   * (usePosShifts.ts:44-55 -- "an informational feature silently blocked every
   * sale"), so a disabled button here made that branch dead code. Required
   * rather than optional so a new call site has to state which it means instead
   * of defaulting to "block the sale".
   */
  shiftUnavailable: boolean;
  handlePay: () => void;
  addToast: (toast: Omit<Toast, 'id'> & { id?: string }) => string;
  setShowOpenBillInput: Dispatch<SetStateAction<boolean>>;
  setCartId: Dispatch<SetStateAction<CartId | null>>;
  deductionLocationIdRef: MutableRefObject<string | null>;
  setDeductionLocationName: Dispatch<SetStateAction<string | null>>;
  setDeductionOverridden: Dispatch<SetStateAction<boolean>>;
  resetCart: () => void;
  tableNumber?: string | undefined;
  customerName?: string | undefined;
  activeOpenBillId?: string | null | undefined;
  handleOpenBill?: (() => Promise<void>) | undefined;
  /**
   * Whether the Save Tab / Open Bill action is offered. `restaurant.save_tab`,
   * owned by RestaurantSettingsScreen. Absent = show, so retail and every test
   * render are unaffected; only an explicit `false` hides it. The same `!== false`
   * idiom CartPanel uses for the customer/pax gates.
   */
  saveTabEnabled?: boolean | undefined;
}


export function CartActionBar({
  activeShift,
  shiftUnavailable,
  handlePay,
  addToast,
  setShowOpenBillInput,
  setCartId,
  deductionLocationIdRef,
  setDeductionLocationName,
  setDeductionOverridden,
  resetCart,
  tableNumber,
  customerName,
  activeOpenBillId,
  handleOpenBill,
  saveTabEnabled,
}: CartActionBarProps) {
  const { l10n } = useLocalization();

  // PosScreen refuses a sale only when there is no shift AND the shift service
  // answered; see the prop doc above.
  const payBlocked = !activeShift && !shiftUnavailable;

  return (
    <div className="pos-cart-actions-row">
      {/* Clear cart button */}
      <Localized id="pos-cart-clear">
        <button
          type="button"
          className="pos-cart-clear-btn"
          onClick={() => { setCartId(null); deductionLocationIdRef.current = null; setDeductionLocationName(null); setDeductionOverridden(false); resetCart(); }}
          aria-label={l10n.getString('pos-cart-clear-aria')}
          title={l10n.getString('pos-cart-clear-aria')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          Clear
        </button>
      </Localized>

      {/* Pay button.
          `payBlocked` mirrors PosScreen's handlePay guard EXACTLY: a sale needs a
          shift OR an unreachable shift service. Gating on `!activeShift` alone
          greyed the button out in the unreachable case, so the guard's stand-down
          branch could never run and an informational feature still blocked the
          till -- the defect usePosShifts.ts:44-55 records having fixed one layer
          down. When they disagree the button is the one that is wrong. */}
      <button
        type="button"
        className={`pos-cart-pay-btn${payBlocked ? ' pos-cart-pay-btn--disabled' : ''}`}
        onClick={handlePay}
        disabled={payBlocked}
        aria-label={l10n.getString('pos-cart-charge-aria')}
      >
        <Localized id="pos-cart-pay">
          <span>Charge</span>
        </Localized>
      </button>

      {/* Save Tab / Update Tab button.
          `saveTabEnabled !== false` — an ABSENT prop shows the button, because
          retail passes nothing and `restaurant.save_tab` unset must not remove an
          action the cashier has always had. Only a stored `"false"` hides it. */}
      {saveTabEnabled !== false && (
      <button
        type="button"
        className="pos-cart-open-bill-btn"
        onClick={() => {
          if (!activeShift) {
            addToast({
              message: requiredLocalized(l10n, 'retail-toast-open-shift-first'),
              type: 'warning',
            });
            return;
          }
          if (tableNumber?.trim() || customerName?.trim() || activeOpenBillId) {
            void handleOpenBill?.();
          } else {
            setShowOpenBillInput(true);
          }
        }}
        aria-label={activeOpenBillId ? (l10n.getString('pos-cart-update-tab-aria') || 'Update Tab') : l10n.getString('pos-cart-open-bill-aria')}
        data-testid="pos-cart-save-tab-btn"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        {activeOpenBillId
          ? (l10n.getString('pos-cart-update-tab') || 'Update Tab')
          : (l10n.getString('pos-cart-save-tab') || 'Save Tab')}
      </button>
      )}
    </div>
  );
}
