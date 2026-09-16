import { describe, expect, it, vi } from 'vitest';
import type { MutableRefObject } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { withFluent } from '@/locales/test-utils';
import salesFtl from '@/locales/sales.ftl?raw';
import {
  CartActionBar,
  type CartActionBarProps,
} from '@/features/sales/components/CartActionBar';
import type { ShiftDto } from '@/api/shifts';

// ── CartActionBar behavioural tests ─────────────────────────────────
//
// Item 3 of todo-refactor-pos-screen-agents-2.md. Written against the
// source (CartActionBar.tsx, 87 lines), not against the plan doc: the
// doc (":76") lists "Pay, Hold Bill, Recall, Discount, Clear Cart".
// The file renders THREE buttons — Clear, Charge (Pay), Open Bill — and
// its only precondition is `activeShift`. There is no empty-cart
// guard here at all (no lines prop), which is why the Clear case below
// asserts the reset contract rather than a disabled state.
//
// Harness mirrors CourseSelectorBar.test.tsx: withFluent builds a real
// bundle from production sales.ftl, so every accessible name asserted
// is the bundle value of the key the component names.

const STAMP = '2026-09-14T01:00:00.000Z';

/** Minimal open ShiftDto — every field is required by the DTO. */
const OPEN_SHIFT: ShiftDto = {
  id: 'shift-1',
  userId: 'user-1',
  terminalId: null,
  openedAt: STAMP,
  closedAt: null,
  openingBalanceMinor: 100000,
  closingBalanceMinor: null,
  expectedCashMinor: null,
  cashDifferenceMinor: null,
  totalSalesMinor: 0,
  totalCashMinor: 0,
  totalCardMinor: 0,
  totalOtherMinor: 0,
  totalVoidsMinor: 0,
  totalRefundsMinor: 0,
  totalPayoutsMinor: 0,
  notes: '',
  status: 'open',
  createdAt: STAMP,
  updatedAt: STAMP,
};

function renderBar(activeShift: ShiftDto | null) {
  const deductionLocationIdRef: MutableRefObject<string | null> = {
    current: 'loc-7',
  };
  const handlePay: CartActionBarProps['handlePay'] = vi.fn();
  const addToast: CartActionBarProps['addToast'] = vi.fn(() => 'toast-1');
  const setShowOpenBillInput: CartActionBarProps['setShowOpenBillInput'] = vi.fn();
  const setCartId: CartActionBarProps['setCartId'] = vi.fn();
  const setDeductionLocationName: CartActionBarProps['setDeductionLocationName'] = vi.fn();
  const setDeductionOverridden: CartActionBarProps['setDeductionOverridden'] = vi.fn();
  const resetCart: CartActionBarProps['resetCart'] = vi.fn();

  const props: CartActionBarProps = {
    activeShift,
    handlePay,
    addToast,
    setShowOpenBillInput,
    setCartId,
    deductionLocationIdRef,
    setDeductionLocationName,
    setDeductionOverridden,
    resetCart,
  };
  const result = render(withFluent(<CartActionBar {...props} />, salesFtl));
  return { ...result, props, deductionLocationIdRef };
}

const payBtn = () => screen.getByRole('button', { name: 'Charge the customer' });
const clearBtn = () => screen.getByRole('button', { name: 'Clear all items from cart' });
const openBillBtn = () => screen.getByRole('button', { name: 'Save as open bill' });

describe('CartActionBar', () => {
  it('renders exactly three buttons, each named from the sales bundle', () => {
    const { container } = renderBar(OPEN_SHIFT);

    // Three, not the five the plan claims: no Hold Bill, no Recall, no
    // Discount control in this component (discount UI is in
    // CartFooterTotals).
    expect(container.querySelectorAll('button')).toHaveLength(3);
    expect(screen.queryByText('Hold')).toBeNull();
    expect(screen.queryByText('Recall')).toBeNull();

    // Accessible name = the *_aria message, visible text = the Localized id.
    expect(clearBtn().textContent).toBe('Clear');
    expect(payBtn().textContent).toBe('Charge');
    expect(openBillBtn().textContent).toBe('Open Bill');
    // Clear mirrors its aria-label into title (CartActionBar.tsx:43).
    expect(clearBtn().getAttribute('title')).toBe('Clear all items from cart');
  });

  it('disables Pay on the no-shift precondition and blocks handlePay', () => {
    const { props } = renderBar(null);

    expect(payBtn()).toBeDisabled();
    expect(payBtn().className).toContain('pos-cart-pay-btn--disabled');
    fireEvent.click(payBtn());
    expect(props.handlePay).not.toHaveBeenCalled();

    // The other two are shift-agnostic: Clear has no precondition and
    // Open Bill guards at click time, so neither is disabled here.
    expect(clearBtn()).not.toBeDisabled();
    expect(openBillBtn()).not.toBeDisabled();
  });

  it('enables Pay and calls handlePay once when a shift is open', () => {
    const { props } = renderBar(OPEN_SHIFT);

    expect(payBtn()).not.toBeDisabled();
    expect(payBtn().className).not.toContain('pos-cart-pay-btn--disabled');
    fireEvent.click(payBtn());
    expect(props.handlePay).toHaveBeenCalledTimes(1);
  });

  it('Open Bill warns instead of opening when no shift is open', () => {
    const { props } = renderBar(null);

    fireEvent.click(openBillBtn());

    // Defect noted, not asserted as correct: the toast message is a
    // hardcoded English literal (CartActionBar.tsx:72), the only string
    // in this component with no Fluent key.
    expect(props.addToast).toHaveBeenCalledWith({
      message: 'Open a shift first',
      type: 'warning',
    });
    expect(props.setShowOpenBillInput).not.toHaveBeenCalled();
  });

  it('Open Bill opens the bill-number prompt when a shift is open', () => {
    const { props } = renderBar(OPEN_SHIFT);

    fireEvent.click(openBillBtn());

    expect(props.setShowOpenBillInput).toHaveBeenCalledWith(true);
    expect(props.addToast).not.toHaveBeenCalled();
  });

  it('Clear resets cart id, deduction location and lines in one click', () => {
    const { props, deductionLocationIdRef } = renderBar(OPEN_SHIFT);
    expect(deductionLocationIdRef.current).toBe('loc-7');

    fireEvent.click(clearBtn());

    expect(props.setCartId).toHaveBeenCalledWith(null);
    expect(deductionLocationIdRef.current).toBeNull();
    expect(props.setDeductionLocationName).toHaveBeenCalledWith(null);
    expect(props.setDeductionOverridden).toHaveBeenCalledWith(false);
    expect(props.resetCart).toHaveBeenCalledTimes(1);
  });
});
