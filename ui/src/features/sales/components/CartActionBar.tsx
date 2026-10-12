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
  hasLines?: boolean | undefined;
  printBillEnabled?: boolean | undefined;
  handlePrintBill?: (() => Promise<void> | void) | undefined;
  splitBillEnabled?: boolean | undefined;
  handleOpenSplitBill?: (() => void) | undefined;
  hasUndispatchedItems?: boolean | undefined;
  sendingToKitchen?: boolean | undefined;
  handleSendToKitchen?: (() => Promise<void> | void) | undefined;
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
  hasLines,
  printBillEnabled,
  handlePrintBill,
  splitBillEnabled,
  handleOpenSplitBill,
  hasUndispatchedItems,
  sendingToKitchen,
  handleSendToKitchen,
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

      {/* Print Bill / Check preview button */}
      {printBillEnabled !== false && hasLines && (Boolean(tableNumber?.trim()) || Boolean(activeOpenBillId)) && handlePrintBill && (
        <button
          type="button"
          className="pos-cart-print-bill-btn"
          onClick={() => { void handlePrintBill(); }}
          aria-label={l10n.getString('pos-cart-print-bill-aria') || 'Print Bill'}
          title={l10n.getString('pos-cart-print-bill-aria') || 'Print Bill'}
          data-testid="pos-cart-print-bill-btn"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
            <polyline points="6 9 6 2 18 2 18 9" />
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
            <rect x="6" y="14" width="12" height="8" />
          </svg>
          {l10n.getString('pos-cart-print-bill') || 'Print Bill'}
        </button>
      )}

      {/* Send to Kitchen button */}
      {hasLines && (Boolean(tableNumber?.trim()) || Boolean(activeOpenBillId)) && hasUndispatchedItems && handleSendToKitchen && (
        <button
          type="button"
          className="pos-cart-send-kitchen-btn"
          disabled={sendingToKitchen}
          onClick={() => { void handleSendToKitchen(); }}
          aria-label={l10n.getString('pos-cart-send-kitchen-aria') || 'Send to Kitchen'}
          title={l10n.getString('pos-cart-send-kitchen-aria') || 'Send to Kitchen'}
          data-testid="pos-cart-send-kitchen-btn"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
            <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
            <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
            <line x1="6" y1="1" x2="6" y2="4" />
            <line x1="10" y1="1" x2="10" y2="4" />
            <line x1="14" y1="1" x2="14" y2="4" />
          </svg>
          {l10n.getString('pos-cart-send-kitchen') || 'Send to Kitchen'}
        </button>
      )}

      {/* Split Bill by Item button */}
      {splitBillEnabled !== false && hasLines && handleOpenSplitBill && (
        <button
          type="button"
          className="pos-cart-split-bill-btn"
          onClick={handleOpenSplitBill}
          aria-label={l10n.getString('pos-cart-split-bill-aria') || 'Split Bill'}
          title={l10n.getString('pos-cart-split-bill-aria') || 'Split Bill'}
          data-testid="pos-cart-split-bill-btn"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
            <circle cx="18" cy="18" r="3" />
            <circle cx="6" cy="6" r="3" />
            <path d="M13 6h3a2 2 0 0 1 2 2v7" />
            <line x1="6" y1="9" x2="6" y2="21" />
          </svg>
          {l10n.getString('pos-cart-split-bill') || 'Split Bill'}
        </button>
      )}
    </div>
  );
}
