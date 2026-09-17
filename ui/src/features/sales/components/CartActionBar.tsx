import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { useLocalization } from '@fluent/react';
import { Localized } from '@/components/Localized';
import type { Toast } from '@/components/Toast';
import type { CartId } from '@/types/domain';
import type { ShiftDto } from '@/api/shifts';

export interface CartActionBarProps {
  activeShift: ShiftDto | null;
  handlePay: () => void;
  addToast: (toast: Omit<Toast, 'id'> & { id?: string }) => string;
  setShowOpenBillInput: Dispatch<SetStateAction<boolean>>;
  setCartId: Dispatch<SetStateAction<CartId | null>>;
  deductionLocationIdRef: MutableRefObject<string | null>;
  setDeductionLocationName: Dispatch<SetStateAction<string | null>>;
  setDeductionOverridden: Dispatch<SetStateAction<boolean>>;
  resetCart: () => void;
}


export function CartActionBar({
  activeShift,
  handlePay,
  addToast,
  setShowOpenBillInput,
  setCartId,
  deductionLocationIdRef,
  setDeductionLocationName,
  setDeductionOverridden,
  resetCart,
}: CartActionBarProps) {
  const { l10n } = useLocalization();

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

      {/* Pay button */}
      <button
        type="button"
        className={`pos-cart-pay-btn${!activeShift ? ' pos-cart-pay-btn--disabled' : ''}`}
        onClick={handlePay}
        disabled={!activeShift}
        aria-label={l10n.getString('pos-cart-charge-aria')}
      >
        <Localized id="pos-cart-pay">
          <span>Charge</span>
        </Localized>
      </button>

      {/* Open Bill button */}
<button
  type="button"
  className="pos-cart-open-bill-btn"
  onClick={() => {
    if (!activeShift) {
      addToast({ message: 'Open a shift first', type: 'warning' });
      return;
    }
    setShowOpenBillInput(true);
  }}
  aria-label={l10n.getString('pos-cart-open-bill-aria')}
>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
  {l10n.getString('pos-cart-open-bill')}
      </button>
    </div>
  );
}
