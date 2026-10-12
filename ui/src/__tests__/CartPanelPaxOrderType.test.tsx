// ── The PAX field is a dine-in question ──────────────────────────────────
//
// THE RULE COMES FROM THE PRODUCT'S OWN WORDING. products.ftl:105,
// `restaurant-setting-guest-count-desc`:
//
//   "Prompt for party size and number of SEATED GUESTS PER TABLE"
//
// So pax means seated guests at a table — a dine-in concept, exactly like the
// table number. CartPanel nevertheless renders the field on EVERY order type
// (CartPanel.tsx:808), so a takeaway or delivery order is prompted for a party
// size it has no table to seat and no answer for.
//
// This is the sibling of the table-display case fixed in 547bf031d, and the same
// underlying mistake: a field whose MEANING is order-type-dependent, read as
// though it were unconditional. (The cart offering the field is deliberate — it
// is each READER that owes the rule.)
//
// NOT to be confused with `guestCount` in the held-cart PAYLOAD, which is left
// alone on purpose: grep guestCount crates/ returns nothing, so a stray value
// there is opaque data that cannot corrupt anything. This file is about the
// VISIBLE prompt.
//
// Own file rather than a case in CartPanel.test.tsx: that file is being edited
// concurrently by another lane (a Print Bill case), and the shared index makes
// co-editing one test file the worst place to collide.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { withFluent } from '@/i18n/test-utils';
import salesFtl from '@/locales/sales.ftl?raw';
import tablesFtl from '@/locales/tables.ftl?raw';
import kdsFtl from '@/locales/kds.ftl?raw';
import settingsFtl from '@/locales/settings.ftl?raw';
import { CartPanel, type CartPanelProps } from '@/features/sales/components/CartPanel';
import { IDLE_TAX_STATE } from '@/features/pos/components/CartTaxWatcher';
import type { AnimatedUndoStack } from '@/hooks/useAnimatedUndoStack';
import type { UseExitAnimationResult } from '@/hooks/useExitAnimation';
import type { CartLine, LineId, Money } from '@/types/domain';

const noop = (): void => {};

const SUBTOTAL: Money = { minor_units: 30000, currency: 'IDR' };

const NO_EXIT: UseExitAnimationResult = { shouldRender: false, exiting: false, requestClose: noop };

const EMPTY_UNDO: AnimatedUndoStack<CartLine> = {
  stack: [], isExiting: false, shouldRender: false, push: noop, pop: () => undefined, dismiss: noop,
};

function makeLine(): CartLine {
  return {
    id: 'line-1' as LineId,
    sku: 'SKU-1' as CartLine['sku'],
    name: 'Espresso',
    qty: 1,
    unit_price: { minor_units: 30000, currency: 'IDR' },
  } as CartLine;
}

/**
 * The cheapest honest props, typed as CartPanelProps so tsc proves nothing is
 * missing (same discipline as CartPanel.test.tsx's baseDefaults).
 */
function props(overrides: Partial<CartPanelProps> = {}): CartPanelProps {
  return {
    activeWorkspace: 'restaurant-pos',
    lines: [makeLine()],
    deductionLocationName: null,
    handleDeductionBadgeClick: noop, deductionOverridden: false, shiftLoading: false,
    activeShift: null, shiftUnavailable: false, shiftNow: 0, handleCloseShiftClick: noop,
    handleOpenShiftClick: noop, isEnabled: () => false, setShowTables: noop,
    setShowSalesHistory: noop, setShowStockInquiry: noop, onNavigate: undefined,
    handleOpenSettings: noop, handleLock: noop, showTableNumberSetting: false,
    tableNumber: '', setTableNumber: noop, shiftErrorExit: NO_EXIT,
    closeShiftError: null, fireCourse: noop, fireAllCourses: noop,
    courseFiringEnabled: null,
    handleRemoveLine: noop, handleDecreaseQty: noop, handleIncreaseQty: noop,
    setCartLineRef: noop, isManager: false, setOverrideTarget: noop,
    ensureCart: async () => null, animatedUndoStack: EMPTY_UNDO,
    handleUndoRemove: noop, handleDismissUndo: noop, subtotal: SUBTOTAL,
    discountPercent: 0, discountLabel: '', discountAmount: null,
    showOptions: false, setShowOptions: noop, showDiscountInput: false,
    setShowDiscountInput: noop, setShowPromotions: noop, appliedPromotions: [],
    setAppliedPromotions: noop, discountInput: '', setDiscountInput: noop,
    discountName: '', setDiscountName: noop, handleApplyDiscount: noop,
    handleClearDiscount: noop, tipPercent: 0, setTipPercent: noop,
    tipAmount: null, serviceChargeEnabled: false, serviceChargePercent: 10,
    serviceChargeAmount: null, setServiceCharge: noop, cartTax: 0,
    taxEstimated: false, taxState: IDLE_TAX_STATE, retryTaxEstimate: noop,
    handlePay: noop, addToast: () => 'toast-1', setShowOpenBillInput: noop,
    setCartId: noop, deductionLocationIdRef: { current: null },
    setDeductionLocationName: noop, setDeductionOverridden: false, resetCart: noop,
    setShowOpenBills: noop, openBills: [],
    // The pax field needs a setter to render at all, and the restaurant gate ON.
    setGuestCount: noop, guestCountEnabled: true,
    ...overrides,
  } as CartPanelProps;
}

function renderPanel(overrides: Partial<CartPanelProps> = {}) {
  return render(withFluent(<CartPanel {...props(overrides)} />, salesFtl, tablesFtl, kdsFtl, settingsFtl));
}

describe('CartPanel — the pax field is dine-in only', () => {
  it('prompts for a party size on a dine-in order', () => {
    renderPanel({ orderType: 'dine_in' });
    expect(
      screen.queryByTestId('pos-cart-guest-input'),
      'a seated party has a size worth recording — the setting description says ' +
        'pax means "seated guests per table"',
    ).not.toBeNull();
  });

  it('does not prompt for a party size on a takeaway or delivery order', () => {
    for (const orderType of ['takeaway', 'delivery'] as const) {
      const { unmount } = renderPanel({ orderType });
      expect(
        screen.queryByTestId('pos-cart-guest-input'),
        'a ' +
          orderType +
          ' order has no table and no seated guests, so a party-size prompt asks ' +
          'a question the order cannot answer',
      ).toBeNull();
      unmount();
    }
  });

  it('leaves the customer name field alone — a name is order-type independent', () => {
    // The pax fix must not take the customer field with it: a takeaway still has
    // a customer to name on the ticket.
    renderPanel({ orderType: 'takeaway', setCustomerName: noop });
    expect(screen.queryByTestId('pos-cart-customer-input')).not.toBeNull();
  });
});
