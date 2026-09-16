import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { withFluent } from '@/locales/test-utils';
import salesFtl from '@/locales/sales.ftl?raw';
import tablesFtl from '@/locales/tables.ftl?raw';
import kdsFtl from '@/locales/kds.ftl?raw';
import settingsFtl from '@/locales/settings.ftl?raw';
import {
  CartPanel,
  type CartPanelProps,
} from '@/features/sales/components/CartPanel';
import { IDLE_TAX_STATE } from '@/features/pos/components/CartTaxWatcher';
import type { AnimatedUndoStack } from '@/hooks/useAnimatedUndoStack';
import type { UseExitAnimationResult } from '@/hooks/useExitAnimation';
import { type CartLine, type LineId, type Money, type Sku } from '@/types/domain';

// ── CartPanel SMOKE test ───────────────────────────────────────────
//
// Deliberately narrow. The panel is 609 lines and 77 REQUIRED props, and the
// behaviour it assembles is already covered: the row is CartLineItem.test.tsx,
// the footer is CartFooterTotals.test.tsx, the action bar is
// CartActionBar.test.tsx, the course bar is CourseSelectorBar.test.tsx, and
// the wired-up whole is PosScreen's shell suites plus RetailCartPanel's cases.
// What nothing covered is the assembly itself: that the panel renders as a
// named landmark, that the empty/populated swap happens in the documented
// place, that the resize handle and the footer+action-bar composition mount,
// and that the claims its own source comments make are true. That is the
// scope here and nothing more.
//
// The 77-prop surface is typed as CartPanelProps, so tsc --noEmit is what
// proves no field is missing rather than a runtime check: delete a line from
// baseDefaults and the file stops compiling. Every default is the cheapest
// honest value for the field — no-op, empty array, zero Money, null ref — so a
// smoke case never depends on a stub pretending to do something.
//
// Header note (CartPanel.tsx:1) disables
// jsx-a11y/no-noninteractive-element-interactions for the aside's keydown
// handler, which is why case 1 asserts the panel is a labelled region: the
// handler is only correct because the landmark is named.

const noop = (..._args: unknown[]): void => {};

const SUBTOTAL: Money = { minor_units: 30000, currency: 'IDR' };

const NO_EXIT: UseExitAnimationResult = {
  shouldRender: false,
  exiting: false,
  requestClose: noop,
};

const EMPTY_UNDO: AnimatedUndoStack<CartLine> = {
  stack: [],
  isExiting: false,
  shouldRender: false,
  push: noop,
  pop: () => undefined,
  dismiss: noop,
};

let seq = 0;

function makeLine(name: string): CartLine {
  seq += 1;
  return {
    id: ('line-' + seq) as LineId,
    sku: ('SKU-' + seq) as Sku,
    name,
    qty: 1,
    unit_price: SUBTOTAL,
  };
}

/** Every CartPanelProps field, satisfied once, overridable per case. */
function makeCartPanelProps(
  overrides: Partial<CartPanelProps> = {},
): CartPanelProps {
  const baseDefaults: CartPanelProps = {
    startResize: noop, cartPanelRef: { current: null }, cartWidth: 440,
    handleCartPanelKeyDown: noop, cartSwipe: { onTouchStart: noop, onTouchEnd: noop },
    activeWorkspace: null, lines: [], deductionLocationName: null,
    handleDeductionBadgeClick: noop, deductionOverridden: false, shiftLoading: false,
    activeShift: null, shiftNow: 0, handleCloseShiftClick: noop,
    handleOpenShiftClick: noop, isEnabled: () => false, setShowTables: noop,
    setShowSalesHistory: noop, setShowStockInquiry: noop, onNavigate: undefined,
    handleOpenSettings: noop, handleLock: noop, showTableNumberSetting: false,
    tableNumber: '', setTableNumber: noop, shiftErrorExit: NO_EXIT,
    closeShiftError: null, fireCourse: noop, fireAllCourses: noop,
    // null is PosScreen's pre-load value: coursing stays on until an
    // explicit `false` arrives, which is what CartPanel gates on.
    courseFiringEnabled: null,
    handleRemoveLine: noop, handleDecreaseQty: noop, handleIncreaseQty: noop,
    setCartLineRef: noop, isManager: false, setOverrideTarget: noop,
    ensureCart: async () => null, animatedUndoStack: EMPTY_UNDO,
    handleUndoRemove: noop, handleDismissUndo: noop, subtotal: null,
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
    setDeductionLocationName: noop, setDeductionOverridden: noop, resetCart: noop,
    setShowOpenBills: noop, openBills: [],
  };
  return { ...baseDefaults, ...overrides };
}

function renderPanel(overrides: Partial<CartPanelProps> = {}) {
  const props = makeCartPanelProps(overrides);
  const result = render(
    withFluent(<CartPanel {...props} />, salesFtl, tablesFtl, kdsFtl, settingsFtl),
  );
  return { ...result, props, panel: screen.getByRole('region', { name: 'Cart' }) };
}

describe('CartPanel (smoke)', () => {
  it('renders the resizable cart as a named region carrying the header, width, and delegated key handler', () => {
    const handleCartPanelKeyDown = vi.fn();
    const { panel } = renderPanel({
      lines: [makeLine('Espresso')],
      handleCartPanelKeyDown,
    });

    expect(panel.getAttribute('role')).toBe('region');
    expect(panel.tagName).toBe('ASIDE');
    expect(panel.getAttribute('tabindex')).toBe('-1');
    expect(panel.style.width).toBe('440px');
    // Composition, not internals: the width and the key handling are the
    // parent's, handed in as props; the panel only mounts the host for them.
    fireEvent.keyDown(panel, { key: 'ArrowDown' });
    expect(handleCartPanelKeyDown).toHaveBeenCalledTimes(1);

    const header = within(panel).getByRole('heading', { level: 2 });
    expect(header.textContent).toContain('Current Sale');
    expect(header.querySelector('.pos-cart-count')?.textContent).toBe('1');
    // The three header regions all mount: title, shift status, actions.
    expect(panel.querySelector('.pos-cart-header-title-area')).not.toBeNull();
    expect(panel.querySelector('.pos-cart-header-shift')?.textContent).toContain(
      'No active shift',
    );
    // The shift control's NAME is pos-shift-open-aria, not the visible
    // pos-shift-open-btn text — aria-label wins, and pinning that keeps the
    // button findable by the name an AT user actually hears.
    expect(
      within(panel).getByRole('button', { name: 'Open a new shift' }),
    ).toBeTruthy();
    expect(
      within(panel).getByRole('button', { name: 'Kitchen Display' }),
    ).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Lock' })).toBeTruthy();
    // isEnabled false is the honest default: the table button is absent, not
    // rendered-and-hidden, so an AT user never meets a control that 404s.
    expect(within(panel).queryByRole('button', { name: 'Table Management' })).toBeNull();
  });

  it('swaps the empty message for one row per line, and the footer only appears with a cart to total', () => {
    const empty = renderPanel({ lines: [], subtotal: SUBTOTAL });
    const region = empty.panel;
    // Documented empty state: message + subtitle + illustration, and NO row,
    // NO footer (the gate at :543 is lines.length > 0 && subtotal).
    expect(region.querySelector('.pos-cart-empty-msg')).not.toBeNull();
    expect(within(region).getByText('Cart is empty')).toBeTruthy();
    expect(
      within(region).getByText('Tap a menu item to start the order'),
    ).toBeTruthy();
    expect(region.querySelectorAll('.pos-cart-line')).toHaveLength(0);
    expect(region.querySelector('.pos-cart-footer')).toBeNull();
    expect(region.querySelector('.pos-cart-count')).toBeNull();
    empty.unmount();

    const two = renderPanel({
      lines: [makeLine('Espresso'), makeLine('Croissant')],
      subtotal: SUBTOTAL,
    });
    const r2 = two.panel;
    expect(r2.querySelector('.pos-cart-empty-msg')).toBeNull();
    expect(r2.querySelectorAll('.pos-cart-line')).toHaveLength(2);
    expect(r2.querySelector('.pos-cart-count')?.textContent).toBe('2');
    expect(r2.querySelector('.pos-cart-footer')).not.toBeNull();
    // Rows are keyed and registered with their own id, in prop order.
    const ids = Array.from(r2.querySelectorAll<HTMLElement>('[data-line-id]')).map(
      (el) => el.getAttribute('data-line-id'),
    );
    expect(ids).toEqual([two.props.lines[0]?.id, two.props.lines[1]?.id]);
  });

  it('mounts the resize handle and the footer + action bar as one composed tree', () => {
    const startResize = vi.fn();
    const { container, props } = renderPanel({
      lines: [makeLine('Espresso')],
      subtotal: SUBTOTAL,
      startResize,
    });

    // The handle is a sibling of the aside, decorative to AT, and delegates.
    const handle = container.querySelector('.pos-resize-handle');
    expect(handle).not.toBeNull();
    expect(handle?.getAttribute('aria-hidden')).toBe('true');
    expect(container.contains(handle)).toBe(true);
    fireEvent.mouseDown(handle as Element);
    expect(startResize).toHaveBeenCalledTimes(1);
    expect(props.cartWidth).toBe(440);

    // Footer and the action bar passed as its children both mount, and the
    // action bar's three controls are inside the panel, after the totals.
    const footer = container.querySelector('.pos-cart-footer');
    expect(footer).not.toBeNull();
    expect(footer?.querySelector('.pos-cart-subtotal-amount')?.textContent).toBeTruthy();
    const bar = footer?.querySelector('.pos-cart-actions-row');
    expect(bar).not.toBeNull();
    expect(within(footer as HTMLElement).getByRole('button', { name: 'Charge the customer' })).toBeTruthy();
    expect(within(footer as HTMLElement).getByRole('button', { name: 'Save as open bill' })).toBeTruthy();
    expect(footer?.contains(bar as Node)).toBe(true);
  });

  it('keeps the open-bills badge mounted always and switches the title wording per workspace', () => {
    // Claim 1 (CartPanel.tsx:589 "always visible"): present even with no
    // lines, no footer and no action bar.
    const setShowOpenBills = vi.fn();
    const empty = renderPanel({ lines: [], openBills: [], setShowOpenBills });
    const badge = within(empty.panel).getByRole('button', { name: 'View open bills' });
    expect(badge.className).toContain('pos-cart-held-badge');
    expect(badge.querySelector('.pos-cart-held-count')).toBeNull();
    fireEvent.click(badge);
    expect(setShowOpenBills).toHaveBeenCalledWith(true);
    empty.unmount();

    // Claim 2 (:277 "Restaurants take orders, not sales").
    const resto = renderPanel({ activeWorkspace: 'restaurant-pos', lines: [] });
    expect(within(resto.panel).getByRole('heading', { level: 2 }).textContent).toContain(
      'Current Order',
    );
    // Claim 3 (:466 course bar is a restaurant concern, gated on lines too):
    // absent for an empty restaurant cart, present once a line exists.
    expect(resto.panel.querySelector('.pos-cart-course-bar')).toBeNull();
    resto.unmount();

    const restoFull = renderPanel({
      activeWorkspace: 'restaurant-pos',
      lines: [makeLine('Espresso')],
      openBills: [{ id: 'bill-1' } as never],
    });
    expect(restoFull.panel.querySelector('.pos-cart-course-bar')).not.toBeNull();
    restoFull.unmount();
    // Stock inquiry is retail-only: the same render without the restaurant
    // workspace gains it, and the badge now carries the count.
    const retail = renderPanel({ lines: [makeLine('Espresso')], openBills: [{ id: 'b' } as never] });
    expect(retail.panel.querySelector('.pos-cart-course-bar')).toBeNull();
    expect(within(retail.panel).getByRole('button', { name: 'Stok' })).toBeTruthy();
    expect(
      within(retail.panel).getByRole('button', { name: 'View open bills' }).querySelector('.pos-cart-held-count')?.textContent,
    ).toBe('1');
  });
});

describe('CartPanel — course assignment wiring', () => {
  // The firing bar above this panel counts lines whose courseId is set and
  // whose coursingStatus is 'hold'. Assigning is the missing half, so these
  // cases pin the two gates that decide whether the chip exists at all:
  // the caller must supply assignCourse AND the workspace must be restaurant.

  it('renders no course chip when assignCourse is not supplied', () => {
    renderPanel({ activeWorkspace: 'restaurant-pos', lines: [makeLine('Espresso')] });

    expect(screen.queryByTestId('cart-line-course-chip')).toBeNull();
  });

  it('renders no course chip outside the restaurant workspace, even with assignCourse', () => {
    renderPanel({
      activeWorkspace: 'store-pos',
      lines: [makeLine('Espresso')],
      assignCourse: noop,
    });

    expect(screen.queryByTestId('cart-line-course-chip')).toBeNull();
  });

  it('gives every line a course chip in the restaurant workspace', () => {
    renderPanel({
      activeWorkspace: 'restaurant-pos',
      lines: [makeLine('Espresso'), makeLine('Latte')],
      assignCourse: noop,
    });

    expect(screen.getAllByTestId('cart-line-course-chip')).toHaveLength(2);
  });

  it('routes the chosen course to assignCourse with the owning line id', async () => {
    const assignCourse = vi.fn();
    const line = makeLine('Espresso');
    renderPanel({ activeWorkspace: 'restaurant-pos', lines: [line], assignCourse });

    fireEvent.click(screen.getByTestId('cart-line-course-chip'));
    fireEvent.click(await screen.findByTestId('cart-line-course-option-dessert'));

    expect(assignCourse).toHaveBeenCalledTimes(1);
    expect(assignCourse).toHaveBeenCalledWith(line.id, 'dessert');
  });
});
