/* eslint-disable jsx-a11y/no-noninteractive-element-interactions */
import { useState, useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useLocalization } from '@fluent/react';
import { animDuration } from '@/utils/animation';
import { Localized } from '@/components/Localized';
import { requiredLocalized } from '@/components';
import type { Toast } from '@/components/Toast';
import { FEATURES } from '@/hooks/useFeatures';
import { bareTableNumber } from '@/features/sales/utils/tableLabel';
import type { CartTaxCacheState } from '@/hooks/useCartTax';
import type { AnimatedUndoStack } from '@/hooks/useAnimatedUndoStack';
import type { UseExitAnimationResult } from '@/hooks/useExitAnimation';
import type { Promotion } from '@/api/promotions';
import type { ShiftDto } from '@/api/shifts';
import type { HeldCartRow } from '@/api/sales';
import type { CartLine, CartId, CourseId, LineId, Money } from '@/types/domain';
import { useSwipe } from '@/hooks/useSwipe';
import { CartLineItem } from './CartLineItem';
import { CourseSelectorBar } from './CourseSelectorBar';
import { CartFooterTotals } from './CartFooterTotals';
import { CartActionBar } from './CartActionBar';
import { SplitBillModal } from './SplitBillModal';
import { useTabLeases } from '@/features/sales/hooks/useTabLeases';

/**
 * The order-type slider's glyph, as an inline MONOCHROME svg.
 *
 * These were emoji (utensils / bag / scooter). Emoji are not monochrome and not
 * themeable: each platform renders its own full-colour artwork, so the glyph read
 * as a different weight from the label beside it, ignored `currentColor` (an
 * inactive row could not dim it), and changed shape between Windows, macOS and
 * Android. Stroked paths inherit the text colour instead, so active/inactive and
 * hover states apply to the icon exactly as they do to the label — which is what
 * every other icon in this codebase does (see VoidOrdersScreen, SalesHistoryScreen).
 *
 * Drawn on the shared 24x24 grid with strokeWidth 2, matching those call sites.
 */
function OrderTypeIcon({ id }: { id: (typeof ORDER_TYPES)[number]['id'] }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      {id === 'dine_in' && (
        // Fork and knife: a seated meal served on a plate.
        <>
          <path d="M4 3v7a2 2 0 0 0 2 2h1v9" />
          <path d="M4 3v5M7 3v5" />
          <path d="M17 3c-1.7 0-3 1.3-3 3v5a2 2 0 0 0 2 2h1v9" />
          <path d="M17 3v10" />
        </>
      )}
      {id === 'takeaway' && (
        // A bag with handles: food carried away.
        <>
          <path d="M5 8h14l-1 12H6L5 8Z" />
          <path d="M9 8V6a3 3 0 0 1 6 0v2" />
        </>
      )}
      {id === 'delivery' && (
        // A scooter: food ridden to the address.
        <>
          <circle cx="6" cy="18" r="2.5" />
          <circle cx="18" cy="18" r="2.5" />
          <path d="M8.5 18h7M15 4h2l2 14" />
          <path d="M13 4H9l4 8h5" />
        </>
      )}
    </svg>
  );
}

// Each option carries its Fluent KEY rather than a label: the restaurant POS
// renders these on the shared cart panel, so hardcoding them left the order-type
// selector in English under every other locale. Resolved at render, below.
//
// `icon` is gone: the glyph is now <OrderTypeIcon> below, keyed by `id`, so the
// option list stays pure data and the artwork cannot be duplicated per entry.
const ORDER_TYPES = [
  { id: 'dine_in', labelKey: 'pos-cart-order-type-dine-in' },
  { id: 'takeaway', labelKey: 'pos-cart-order-type-takeaway' },
  { id: 'delivery', labelKey: 'pos-cart-order-type-delivery' },
] as const;

/**
 * Split an elapsed duration (ms) into whole hours + minutes, floored.
 * Used for the live shift timer in the cart header.
 */
function elapsedHoursMinutes(sinceMs: number, nowMs: number): { h: number; m: number } {
  const totalMinutes = Math.max(0, Math.floor((nowMs - sinceMs) / 60_000));
  return { h: Math.floor(totalMinutes / 60), m: totalMinutes % 60 };
}

/**
 * Shopping bag icon for the empty-cart illustration.
 * Stroked only — colour comes from `currentColor` so it responds to themes.
 */
function ShoppingBagIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 2 4 6v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6l-2-4H6z" />
      <path d="M4 6h16" />
      <path d="M9 10V8a3 3 0 0 1 6 0v2" />
    </svg>
  );
}

/** History / recent-orders icon — same stroke style as the header lock button. */
function HistoryIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="18"
      height="18"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}

/** Kitchen Display (KDS) icon — a kitchen monitor, same stroke style. */
function KitchenDisplayIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="18"
      height="18"
      aria-hidden="true"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

/** Table Management / Floor plan icon — table with seating. */
function TableChairIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="16"
      height="16"
      aria-hidden="true"
    >
      <path d="M4 8h16M4 8l1-3h14l1 3M5 8v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
    </svg>
  );
}

export interface CartPanelProps {
  hidden?: boolean;
  startResize: (e: React.MouseEvent | React.TouchEvent | React.PointerEvent) => void;
  cartPanelRef: React.RefObject<HTMLElement>;
  cartWidth: number;
  handleCartPanelKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
  cartSwipe: { onTouchStart: (e: React.TouchEvent) => void; onTouchEnd: (e: React.TouchEvent) => void };
  activeWorkspace: string | null;
  lines: CartLine[];
  deductionLocationName: string | null;
  handleDeductionBadgeClick: () => void;
  deductionOverridden: boolean;
  shiftLoading: boolean;
  activeShift: ShiftDto | null;
  /** Shifts are informational; true when this shell cannot reach them at all. */
  shiftUnavailable: boolean;
  shiftNow: number;
  handleCloseShiftClick: () => void;
  handleOpenShiftClick: () => void;
  isEnabled: (key: string) => boolean;
  setShowTables: Dispatch<SetStateAction<boolean>>;
  setShowSalesHistory: Dispatch<SetStateAction<boolean>>;
  setShowStockInquiry: Dispatch<SetStateAction<boolean>>;
  onNavigate: ((route: string) => void) | undefined;
  handleOpenSettings: () => void;
  handleLock: () => void;
  onOpenCashDrawer?: () => void;
  showTableNumberSetting: boolean;
  tableNumber: string;
  setTableNumber: Dispatch<SetStateAction<string>>;
  guestCount?: string;
  setGuestCount?: Dispatch<SetStateAction<string>>;
  /**
   * Whether the customer-name field shows. `restaurant.customer_name`, owned by
   * RestaurantSettingsScreen. Absent = show, so retail and every test render are
   * unaffected; only an explicit `false` hides it. Same `!== false` idiom as
   * `courseFiringEnabled`.
   */
  customerNameEnabled?: boolean;
  /** Whether the pax field shows. `restaurant.guest_count`; absent = show. */
  guestCountEnabled?: boolean;
  /** Whether the Save Tab action shows. `restaurant.save_tab`; absent = show. */
  saveTabEnabled?: boolean;
  orderType?: 'dine_in' | 'takeaway' | 'delivery';
  setOrderType?: Dispatch<SetStateAction<'dine_in' | 'takeaway' | 'delivery'>>;
  orderTypePromptEnabled?: boolean;
  shiftErrorExit: UseExitAnimationResult;
  closeShiftError: string | null;
  fireCourse: (courseId: CourseId) => void;
  fireAllCourses: () => void;
  /**
   * Restaurant `course_firing` setting (null = not yet loaded). The firing
   * bar and per-line chip require the restaurant workspace AND (null or
   * true) here — an explicit `false` hides coursing while a slow or failed
   * settings read never does.
   */
  courseFiringEnabled: boolean | null;
  /**
   * Assign a course to a single line (restaurant coursing). Optional: when it
   * is omitted the per-line course chip is not rendered, so the retail path
   * and every caller without coursing are unaffected.
   */
  assignCourse?: (lineId: LineId, courseId: CourseId) => void;
  /** Update or remove the kitchen / special instruction note for a line. */
  updateLineNote?: (lineId: LineId, note: string) => void;
  /** Edit modifiers on an in-cart line item. */
  onEditModifiers?: ((line: CartLine) => void) | undefined;
  handleRemoveLine: (line: CartLine) => void;
  handleDecreaseQty: (line: CartLine) => void;
  handleIncreaseQty: (line: CartLine) => void;
  setCartLineRef: (lineId: LineId, el: HTMLDivElement | null) => void;
  isManager: boolean;
  /**
   * Whether the price-override affordance is available, when it differs from
   * `isManager`.
   *
   * The backend refuses `override_cart_line_price` without
   * `sales:override_price` (`kasirmu-bridge/src/pos/cart.rs:345`), NOT without a
   * manager ROLE — and custom roles ship (`create_role_scoped`), so the two can
   * disagree in either direction. `PosScreen` therefore supplies this from the
   * permission. Optional so the retail panel and every existing caller keep the
   * role behaviour they were written against; absent means "same as isManager".
   */
  canOverridePrice?: boolean | undefined;
  setOverrideTarget: Dispatch<SetStateAction<CartLine | null>>;
  ensureCart: (currency: string) => Promise<CartId | null>;
  /**
   * The undo stack as the cart hook builds it. Only the RENDER flags
   * (`shouldRender`, `isExiting`) are read here — the entries are opened through
   * the Undo button, so the component never inspects a `RemovedLine`.
   */
  animatedUndoStack: AnimatedUndoStack<{ line: CartLine; index: number }>;
  handleUndoRemove: () => void;
  handleDismissUndo: () => void;
  subtotal: Money | null;
  discountPercent: number;
  discountLabel: string;
  discountAmount: Money | null;
  showOptions: boolean;
  setShowOptions: Dispatch<SetStateAction<boolean>>;
  showDiscountInput: boolean;
  setShowDiscountInput: Dispatch<SetStateAction<boolean>>;
  setShowPromotions: Dispatch<SetStateAction<boolean>>;
  appliedPromotions: Promotion[];
  setAppliedPromotions: Dispatch<SetStateAction<Promotion[]>>;
  discountInput: string;
  setDiscountInput: Dispatch<SetStateAction<string>>;
  discountName: string;
  setDiscountName: Dispatch<SetStateAction<string>>;
  handleApplyDiscount: () => void;
  handleClearDiscount: () => void;
  tipPercent: number;
  setTipPercent: (percent: number) => void;
  tipAmount: Money | null;
  serviceChargeEnabled: boolean;
  serviceChargePercent: number;
  serviceChargeAmount: Money | null;
  setServiceCharge: (enabled: boolean, percent?: number) => void;
  cartTax: number;
  taxEstimated: boolean;
  taxState: CartTaxCacheState;
  retryTaxEstimate: () => void;
  handlePay: () => void;
  addToast: (toast: Omit<Toast, 'id'> & { id?: string }) => string;
  setShowOpenBillInput: Dispatch<SetStateAction<boolean>>;
  setCartId: Dispatch<SetStateAction<CartId | null>>;
  deductionLocationIdRef: React.MutableRefObject<string | null>;
  setDeductionLocationName: Dispatch<SetStateAction<string | null>>;
  setDeductionOverridden: Dispatch<SetStateAction<boolean>>;
  resetCart: () => void;
  setShowOpenBills: Dispatch<SetStateAction<boolean>>;
  openBills: HeldCartRow[];
  customerName?: string | undefined;
  setCustomerName?: ((name: string) => void) | undefined;
  activeOpenBillId?: string | null | undefined;
  setActiveOpenBillId?: ((id: string | null) => void) | undefined;
  handleOpenBill?: (() => Promise<void>) | undefined;
  printBillEnabled?: boolean | undefined;
  handlePrintBill?: (() => Promise<void> | void) | undefined;
  splitBillEnabled?: boolean | undefined;
  showSplitBillModal?: boolean | undefined;
  setShowSplitBillModal?: Dispatch<SetStateAction<boolean>> | undefined;
  // `Promise<boolean | void>` rather than `Promise<void>`: `false` is how the
  // screen tells SplitBillModal that the split did NOT commit and the dialog
  // must stay open for a retry (see `onConfirmSplit` in SplitBillModal.tsx).
  handleConfirmSplitBill?: ((selectedLines: CartLine[], remainingLines: CartLine[]) => Promise<boolean | void> | boolean | void) | undefined;
  hasUndispatchedItems?: boolean | undefined;
  sendingToKitchen?: boolean | undefined;
  handleSendToKitchen?: (() => Promise<void> | void) | undefined;
}

export function CartPanel({
  hidden,
  startResize,
  cartPanelRef,
  cartWidth,
  handleCartPanelKeyDown,
  cartSwipe,
  activeWorkspace,
  lines,
  deductionLocationName,
  handleDeductionBadgeClick,
  deductionOverridden,
  shiftLoading,
  activeShift,
  shiftUnavailable,
  shiftNow,
  handleCloseShiftClick,
  handleOpenShiftClick,
  isEnabled,
  setShowTables,
  setShowSalesHistory,
  setShowStockInquiry,
  onNavigate,
  handleOpenSettings,
  handleLock,
  onOpenCashDrawer,
  showTableNumberSetting,
  tableNumber,
  setTableNumber,
  guestCount,
  customerNameEnabled,
  guestCountEnabled,
  saveTabEnabled,
  setGuestCount,
  orderType = 'dine_in',
  setOrderType,
  orderTypePromptEnabled = false,
  shiftErrorExit,
  closeShiftError,
  fireCourse,
  fireAllCourses,
  courseFiringEnabled,
  assignCourse,
  updateLineNote,
  onEditModifiers,
  handleRemoveLine,
  handleDecreaseQty,
  handleIncreaseQty,
  setCartLineRef,
  isManager,
  canOverridePrice,
  setOverrideTarget,
  ensureCart,
  animatedUndoStack,
  handleUndoRemove,
  handleDismissUndo,
  subtotal,
  discountPercent,
  discountLabel,
  discountAmount,
  showOptions,
  setShowOptions,
  showDiscountInput,
  setShowDiscountInput,
  setShowPromotions,
  appliedPromotions,
  setAppliedPromotions,
  discountInput,
  setDiscountInput,
  discountName,
  setDiscountName,
  handleApplyDiscount,
  handleClearDiscount,
  tipPercent,
  setTipPercent,
  tipAmount,
  serviceChargeEnabled,
  serviceChargePercent,
  serviceChargeAmount,
  setServiceCharge,
  cartTax,
  taxEstimated,
  taxState,
  retryTaxEstimate,
  handlePay,
  addToast,
  setShowOpenBillInput,
  setCartId,
  deductionLocationIdRef,
  setDeductionLocationName,
  setDeductionOverridden,
  resetCart,
  setShowOpenBills,
  openBills,
  customerName,
  setCustomerName,
  activeOpenBillId,
  setActiveOpenBillId,
  handleOpenBill,
  printBillEnabled,
  handlePrintBill,
  splitBillEnabled,
  showSplitBillModal,
  setShowSplitBillModal,
  handleConfirmSplitBill,
  hasUndispatchedItems,
  sendingToKitchen,
  handleSendToKitchen,
}: CartPanelProps) {
  const { l10n } = useLocalization();
  const { getConflict, forceTakeover, releaseLease } = useTabLeases();
  const tabConflict = getConflict(activeOpenBillId);
  // In the restaurant workspace the cart header's buttons do not live here at
  // all: PosScreen hands them to the sidebar popover (MenuPreferencesMenu's
  // `cartActions`) and this panel keeps only what identifies the order — title,
  // count and shift status. Retail has no sidebar, so it keeps everything.
  const sidebarOwnsTerminalActions = activeWorkspace === 'restaurant-pos';
  // Which line's course dropdown is open. Held here rather than per row so
  // opening one line's menu closes the other's.
  const [courseMenuLine, setCourseMenuLine] = useState<LineId | null>(null);

  /**
   * Whether this order can name a table at all. Only a dine-in order has one, so
   * the table badge is withheld for takeaway and delivery even when the field
   * holds a value — the field is deliberately offered on every order type, which
   * is exactly why each READER has to apply this rule.
   */
  const showTableForOrder = orderType === 'dine_in' && !!tableNumber;

  const handleOrderTypePrev = () => {
    if (!setOrderType) return;
    const currentIdx = ORDER_TYPES.findIndex((opt) => opt.id === orderType);
    const prev = ORDER_TYPES[currentIdx - 1];
    if (prev) {
      setOrderType(prev.id);
    }
  };

  const handleOrderTypeNext = () => {
    if (!setOrderType) return;
    const currentIdx = ORDER_TYPES.findIndex((opt) => opt.id === orderType);
    const next = ORDER_TYPES[currentIdx + 1];
    if (next) {
      setOrderType(next.id);
    }
  };

  const orderTypeSwipe = useSwipe({
    onSwipeLeft: handleOrderTypeNext,
    onSwipeRight: handleOrderTypePrev,
  });

  const [orderTypeMenuOpen, setOrderTypeMenuOpen] = useState(false);
  const orderTypeDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!orderTypeMenuOpen) return;
    const handleMousedown = (e: MouseEvent) => {
      if (orderTypeDropdownRef.current && !orderTypeDropdownRef.current.contains(e.target as Node)) {
        setOrderTypeMenuOpen(false);
      }
    };
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOrderTypeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMousedown);
    document.addEventListener('keydown', handleKeydown);
    return () => {
      document.removeEventListener('mousedown', handleMousedown);
      document.removeEventListener('keydown', handleKeydown);
    };
  }, [orderTypeMenuOpen]);

  // Animation state for sliding out/in when hidden prop toggles
  const [cartExiting, setCartExiting] = useState(false);
  const [cartEntering, setCartEntering] = useState(false);
  const [isFullyHidden, setIsFullyHidden] = useState(Boolean(hidden));
  const hasEverBeenHiddenRef = useRef(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (hidden) {
      hasEverBeenHiddenRef.current = true;
      if (enterTimerRef.current !== null) {
        clearTimeout(enterTimerRef.current);
        enterTimerRef.current = null;
      }
      setCartEntering(false);
      setCartExiting(true);
      if (exitTimerRef.current !== null) {
        clearTimeout(exitTimerRef.current);
      }
      exitTimerRef.current = setTimeout(() => {
        setCartExiting(false);
        setIsFullyHidden(true);
        exitTimerRef.current = null;
      }, animDuration(300));
    } else {
      if (exitTimerRef.current !== null) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
      setCartExiting(false);
      setIsFullyHidden(false);
      if (hasEverBeenHiddenRef.current) {
        setCartEntering(true);
        if (enterTimerRef.current !== null) {
          clearTimeout(enterTimerRef.current);
        }
        enterTimerRef.current = setTimeout(() => {
          setCartEntering(false);
          enterTimerRef.current = null;
        }, animDuration(300));
      }
    }
  }, [hidden]);

  useEffect(() => {
    return () => {
      if (exitTimerRef.current !== null) clearTimeout(exitTimerRef.current);
      if (enterTimerRef.current !== null) clearTimeout(enterTimerRef.current);
    };
  }, []);

  return (
    <>
      <div
        className={`pos-resize-handle${cartExiting ? ' pos-resize-handle--exiting' : ''}${cartEntering ? ' pos-resize-handle--entering' : ''}`}
        onMouseDown={startResize}
        onTouchStart={startResize}
        onPointerDown={startResize}
        aria-hidden="true"
        style={isFullyHidden ? { display: 'none' } : undefined}
      />

      {/* ── Right: Cart panel (resizable, keyboard-nav) */}
      <aside
        className={`pos-cart-panel${cartExiting ? ' pos-cart-panel--exiting' : ''}${cartEntering ? ' pos-cart-panel--entering' : ''}`}
        ref={cartPanelRef}
        aria-label={l10n.getString('pos-cart-panel-aria')}
        role="region"
        style={{ width: cartWidth, '--cart-width': `${cartWidth}px`, ...(isFullyHidden ? { display: 'none' } : {}) } as React.CSSProperties}
        tabIndex={-1}
        onKeyDown={handleCartPanelKeyDown}
        {...cartSwipe}
      >
        <header className="pos-cart-header">
          {/* ── Left: order/sale title + count + deduction badge ── */}
          <div className="pos-cart-header-title-area">
            <h2 className="pos-cart-title">
              {/* Restaurants take orders, not sales — use the order wording in
                  the resto workspace; retail keeps "Current Sale". */}
              <Localized id={activeWorkspace === 'restaurant-pos' ? 'pos-cart-panel-title-order' : 'pos-cart-panel-title'}>
                <span>{activeWorkspace === 'restaurant-pos' ? 'Current Order' : 'Current Sale'}</span>
              </Localized>
              {lines.length > 0 && (
                <span className="pos-cart-count">{lines.length}</span>
              )}
            </h2>

            {/* ADR-19 §17: locked deduction location badge (clickable → FastPINOverlay override).
                Restaurant: the same control is a row in the sidebar popover. */}
            {deductionLocationName && !sidebarOwnsTerminalActions && (
              <button
                type="button"
                className="pos-cart-deduction-badge"
                data-testid="deduction-location-badge"
                onClick={handleDeductionBadgeClick}
                aria-label={l10n.getString('pos-cart-deduction-badge-aria', { name: deductionLocationName })}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="12" height="12" aria-hidden="true">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <Localized id="pos-cart-deducting-label" vars={{ name: deductionLocationName }}>
                  <span>Deducting: {deductionLocationName}</span>
                </Localized>
                {deductionOverridden && (
                  <span className="pos-cart-deduction-override" data-testid="deduction-override-indicator">
                    {' '}(Override)
                  </span>
                )}
              </button>
            )}
          </div>

          {/* ── Center: shift status ── */}
          <div className="pos-cart-header-shift">
            {shiftLoading ? (
              <span className="pos-shift-bar-label">{l10n.getString('pos-shift-loading')}</span>
            ) : shiftUnavailable ? (
              <span className="pos-shift-bar-label">{l10n.getString('pos-shift-unavailable')}</span>
            ) : activeShift ? (
              <>
                <span className="pos-shift-bar-indicator pos-shift-bar-indicator--open" />
                <span className="pos-shift-bar-label">
                  {l10n.getString(
                    'pos-shift-elapsed',
                    elapsedHoursMinutes(new Date(activeShift.openedAt).getTime(), shiftNow),
                  )}
                </span>
                {!sidebarOwnsTerminalActions && (
                  <button
                    type="button"
                    className="pos-shift-close-btn"
                    onClick={handleCloseShiftClick}
                    aria-label={l10n.getString('pos-shift-close-aria')}
                  >
                    {l10n.getString('pos-shift-close-btn')}
                  </button>
                )}
              </>
            ) : (
              <>
                <span className="pos-shift-bar-indicator pos-shift-bar-indicator--closed" />
                <span className="pos-shift-bar-label">{l10n.getString('pos-shift-no-active')}</span>
                {!sidebarOwnsTerminalActions && (
                  <button
                    type="button"
                    className="pos-shift-open-btn"
                    onClick={handleOpenShiftClick}
                    aria-label={l10n.getString('pos-shift-open-aria')}
                  >
                    {l10n.getString('pos-shift-open-btn')}
                  </button>
                )}
              </>
            )}
          </div>

          {/* ── Right: terminal action buttons — the restaurant cart has none ──
              The whole cluster is retail-only now. In the restaurant workspace
              PosScreen hands these controls to the sidebar popover, so the two
              buttons that were already restaurant-suppressed (stock inquiry,
              settings) no longer need their own guard — being restaurant is what
              excludes the cluster. The header's lock button is not relocated
              either: the sidebar's "Lock Terminal" row replaced it, and the cart
              it used to persist stays mounted behind the lock screen. */}
          {!sidebarOwnsTerminalActions && (
            <div className="pos-cart-header-actions">
              {isEnabled(FEATURES.TABLE_MANAGEMENT) && (
                <button
                  type="button"
                  className="pos-cart-lock-btn"
                  onClick={() => setShowTables(true)}
                  aria-label={requiredLocalized(l10n, 'tables-title')}
                  title={requiredLocalized(l10n, 'tables-title')}
                >
                  🪑
                </button>
              )}

              <button
                type="button"
                className="pos-cart-lock-btn"
                onClick={() => setShowSalesHistory(true)}
                aria-label={requiredLocalized(l10n, 'retail-fn-history')}
                title={requiredLocalized(l10n, 'retail-fn-history')}
              >
                <HistoryIcon />
              </button>

              {/* Stock inquiry is a retail-POS concern — the restaurant POS
                  doesn't need it (kitchen flow goes through the KDS). */}
              <button
                type="button"
                className="pos-cart-lock-btn"
                onClick={() => setShowStockInquiry(true)}
                aria-label={requiredLocalized(l10n, 'retail-fn-stok')}
                title={requiredLocalized(l10n, 'retail-fn-stok')}
              >
                📦
              </button>

              <button
                type="button"
                className="pos-cart-lock-btn"
                onClick={() => onNavigate?.('kds')}
                aria-label={requiredLocalized(l10n, 'kds-title')}
                title={requiredLocalized(l10n, 'kds-title')}
                data-testid="pos-cart-kds-btn"
              >
                <KitchenDisplayIcon />
              </button>

              {onOpenCashDrawer && (
                <button
                  type="button"
                  className="pos-cart-lock-btn"
                  onClick={onOpenCashDrawer}
                  aria-label={l10n.getString('pos-cart-open-drawer')}
                >
                  💵
                </button>
              )}

              {/* Settings is a manager/owner surface — not needed at the
                  restaurant cashier terminal (reachable from the workspace
                  picker); retail keeps it. */}
              <button
                type="button"
                className="pos-cart-lock-btn"
                onClick={handleOpenSettings}
                aria-label={requiredLocalized(l10n, 'settings-page-title')}
                title={requiredLocalized(l10n, 'settings-page-title')}
              >
                ⚙️
              </button>

              <button
                type="button"
                className="pos-cart-lock-btn"
                onClick={handleLock}
                aria-label={l10n.getString('pos-cart-lock')}
                title={l10n.getString('pos-cart-lock')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </button>
            </div>
          )}
        </header>

        {/* ── Area: Order context (active tab, order type, table/pax) ── */}
        <section className="pos-cart-order-context" aria-label={requiredLocalized(l10n, 'restaurant-setting-order-type')}>
          {/* ── Active Tab Indicator Banner ── */}
          {activeOpenBillId && (
          <div className="pos-cart-active-tab-banner" data-testid="pos-active-tab-banner">
            <span className="pos-cart-active-tab-info">
              <span className="pos-cart-active-tab-dot" aria-hidden="true">●</span>
              <span className="pos-cart-active-tab-text">
                {/* `bareTableNumber`: the stored names already read "Table 12"
                    (see features/sales/utils/tableLabel.ts), so the raw value
                    composed "Table Table 12" in this banner. */}
                {/* ⚠️ DINE-IN ONLY — the DISPLAY half of the stray-table defect.
                    Rounds 40-42 stopped a non-dine-in order CLAIMING (206462b4d),
                    RELEASING (035d1d01b) and PERSISTING (795fc18d4) a table, but
                    this banner still NAMED one: the field is offered on every
                    order type (CartPanel.tsx:735-743), so switching Dine-In ->
                    Takeaway left "Table 12" reading as this order's table. A
                    takeaway has no table to name. */}
                {showTableForOrder
                  ? `Table ${bareTableNumber(tableNumber!)}${customerName ? ` (${customerName})` : ''}`
                  : (customerName || 'Active Tab')}
              </span>
            </span>
            <button
              type="button"
              className="pos-cart-new-tab-btn"
              onClick={() => {
                if (activeOpenBillId) {
                  void releaseLease(activeOpenBillId);
                }
                resetCart();
                setTableNumber('');
                setCustomerName?.('');
                setActiveOpenBillId?.(null);
                // ⚠️ THE PARTY SIZE BELONGS TO THE TAB TOO. Round 99 added the
                // promotions line by comparing this handler against the HOLD path,
                // and that comparison also leaves guestCount behind: the hold path
                // clears it (usePosHeldCarts.ts:305) and so does the after-sale reset
                // (PosScreen.tsx:871), while this handler did not.
                //
                // It is reachable and it is PERSISTED — the field renders for dine-in
                // (:931-943) and the hold path's deps (:324) show `guestCount` is read
                // when saving. So a leaked party size is saved onto the next order,
                // against a table the operator has already left.
                setGuestCount?.('');
                // ⚠️ PROMOTIONS BELONG TO THE TAB, SO THEY GO WITH IT.
                //
                // This handler cleared the lines, the table, the customer and the tab id
                // — but not the promotions, which are NOT cosmetic: they ride to
                // checkout as `promotionIds` (PosScreen.tsx:2574, re-measured 2026-10-27;
                // it was 2501 on 2026-10-19 and 2210 when the note was first written) and
                // pre-select in the promotions modal (`initiallySelectedIds`,
                // PosScreen.tsx:2614). Starting a new tab after a discounted one
                // therefore applied that tab's discounts to the NEXT sale, with the cart
                // empty and the banner gone so nothing on screen invited a second look.
                //
                // The sibling reset is the reference and always cleared them: the hold
                // path in usePosHeldCarts.ts (:330, re-measured 2026-10-19; the note said
                // `:302-307`, which never matched) calls `setAppliedPromotions([])`
                // next to exactly these fields. New Tab is the same reset with one line
                // missing, and it had no test at all, which is how the omission survived.
                setAppliedPromotions([]);
              }}
              data-testid="pos-cart-new-tab-btn"
            >
              + {requiredLocalized(l10n, 'pos-cart-new-tab')}
            </button>
          </div>
        )}

        {activeOpenBillId && tabConflict && (
          <div className="pos-cart-conflict-alert" role="alert" data-testid="pos-cart-conflict-alert">
            <span>
              <Localized id="pos-cart-tab-conflict-warning" vars={{ terminal: tabConflict.terminalName }}>
                <span>{tabConflict.terminalName} is currently adding items to this tab</span>
              </Localized>
            </span>
            <button
              type="button"
              className="pos-cart-conflict-takeover-btn"
              data-testid="pos-cart-conflict-takeover-btn"
              onClick={() => void forceTakeover(activeOpenBillId, tableNumber)}
            >
              <Localized id="pos-cart-tab-takeover-btn">
                <span>Take Over</span>
              </Localized>
            </button>
          </div>
        )}

        {/* ── Unified Single-Row Context Bar (Order Type Dropdown + Table Pill + Pax + Customer) ── */}
        {((orderTypePromptEnabled && setOrderType) || (showTableNumberSetting || activeWorkspace === 'restaurant-pos') || (setCustomerName && customerNameEnabled !== false)) && (
          <div
            className={`pos-cart-context-row${orderTypePromptEnabled && setOrderType ? ' pos-cart-order-type-row' : ''}`}
            {...(orderTypePromptEnabled && setOrderType ? orderTypeSwipe : {})}
          >
            {/* 1. Order Type Dropdown */}
            {orderTypePromptEnabled && setOrderType && (
              <div className="pos-cart-order-type-dropdown-wrap" ref={orderTypeDropdownRef}>
                <button
                  type="button"
                  className={`pos-cart-order-type-dropdown-trigger${orderTypeMenuOpen ? ' pos-cart-order-type-dropdown-trigger--open' : ''}`}
                  onClick={() => setOrderTypeMenuOpen((prev) => !prev)}
                  aria-expanded={orderTypeMenuOpen}
                  aria-haspopup="true"
                  aria-label={l10n.getString('restaurant-setting-order-type')}
                  data-testid="pos-cart-order-type-dropdown-trigger"
                >
                  <span className="pos-cart-order-type-icon">
                    <OrderTypeIcon id={orderType} />
                  </span>
                  <span className="pos-cart-order-type-label">
                    {l10n.getString(ORDER_TYPES.find((opt) => opt.id === orderType)?.labelKey ?? 'pos-order-type-dine-in')}
                  </span>
                  <svg
                    className={`pos-cart-order-type-chevron${orderTypeMenuOpen ? ' pos-cart-order-type-chevron--open' : ''}`}
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>

                <div
                  className={`pos-cart-order-type-menu${orderTypeMenuOpen ? ' pos-cart-order-type-menu--open' : ''}`}
                  role="radiogroup"
                  aria-label={l10n.getString('restaurant-setting-order-type')}
                  tabIndex={-1}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                      e.preventDefault();
                      handleOrderTypeNext();
                    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                      e.preventDefault();
                      handleOrderTypePrev();
                    } else if (e.key === 'Home') {
                      e.preventDefault();
                      const first = ORDER_TYPES[0];
                      if (first) setOrderType(first.id);
                    } else if (e.key === 'End') {
                      e.preventDefault();
                      const last = ORDER_TYPES[ORDER_TYPES.length - 1];
                      if (last) setOrderType(last.id);
                    } else if (e.key === 'Escape') {
                      setOrderTypeMenuOpen(false);
                    }
                  }}
                >
                  <span className="pos-cart-order-type-indicator" aria-hidden="true" />
                  {ORDER_TYPES.map((opt) => {
                    const active = orderType === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        role="radio"
                        className={`pos-cart-order-type-btn${active ? ' pos-cart-order-type-btn--active' : ''}`}
                        onClick={() => {
                          setOrderType(opt.id);
                          setOrderTypeMenuOpen(false);
                        }}
                        aria-checked={active}
                        data-testid={`pos-order-type-${opt.id}`}
                      >
                        <span className="pos-cart-order-type-icon">
                          <OrderTypeIcon id={opt.id} />
                        </span>
                        <span className="pos-cart-order-type-label">{l10n.getString(opt.labelKey)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 2. Table Pill: Icon button (opens table map) + Table input (DINE-IN only) */}
            {(showTableNumberSetting || activeWorkspace === 'restaurant-pos') && orderType === 'dine_in' && (
              <div
                className={`pos-cart-table-pill${tableNumber?.trim() ? ' pos-cart-table-pill--has-table' : ''}`}
                data-testid="pos-cart-table-pill"
              >
                {isEnabled(FEATURES.TABLE_MANAGEMENT) && (
                  <button
                    type="button"
                    className={`pos-cart-table-select-btn${tableNumber?.trim() ? ' pos-cart-table-select-btn--selected' : ''}`}
                    onClick={() => setShowTables(true)}
                    title={requiredLocalized(l10n, 'tables-title')}
                    aria-label={requiredLocalized(l10n, 'tables-title')}
                    data-testid="pos-cart-open-tables-btn"
                  >
                    <TableChairIcon />
                  </button>
                )}
                <input
                  id="pos-table-number"
                  type="text"
                  className="pos-cart-table-input"
                  value={tableNumber}
                  onChange={(e) => setTableNumber(e.target.value)}
                  aria-label={l10n.getString('pos-cart-table-aria')}
                  placeholder={requiredLocalized(l10n, 'pos-cart-table-placeholder')}
                />
              </div>
            )}

            {/* 3. Guest Count / Pax (DINE-IN only).
                No `title` on the pill: it wraps an input that already carries
                `aria-label=pos-cart-guest-count-label`, so the native tooltip was the
                same string twice — and it is the OS-square kind the tooltip rule bans
                (nativeTooltipCompliance). The glyph is aria-hidden; the input's own
                label is what a screen reader announces. */}
            {setGuestCount && guestCountEnabled !== false && orderType === 'dine_in' && (
              <div className="pos-cart-guest-pill">
                <span className="pos-cart-guest-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </span>
                <input
                  id="pos-guest-count"
                  type="number"
                  min={1}
                  max={99}
                  className="pos-cart-guest-input"
                  value={guestCount ?? ''}
                  onChange={(e) => setGuestCount(e.target.value)}
                  aria-label={l10n.getString('pos-cart-guest-count-label')}
                  placeholder={requiredLocalized(l10n, 'pos-cart-guest-placeholder')}
                  data-testid="pos-cart-guest-input"
                />
              </div>
            )}

            {/* 4. Customer Name (box only with placeholder name) */}
            {setCustomerName && customerNameEnabled !== false && (
              <div className="pos-cart-customer-field">
                <input
                  id="pos-customer-name"
                  type="text"
                  className="pos-cart-customer-input"
                  value={customerName ?? ''}
                  onChange={(e) => setCustomerName(e.target.value)}
                  aria-label={requiredLocalized(l10n, 'pos-cart-customer-aria')}
                  placeholder={requiredLocalized(l10n, 'pos-cart-customer-placeholder')}
                  data-testid="pos-cart-customer-input"
                />
              </div>
            )}
          </div>
        )}

        {/* ── Inline shift error (cart not empty) ──── */}
        {shiftErrorExit.shouldRender && (
          <div
            className={`pos-shift-error${shiftErrorExit.exiting ? ' pos-shift-error--exiting' : ''}`}
            role="alert"
          >
            {closeShiftError}
            <button
              type="button"
              className="pos-shift-error-dismiss"
              onClick={() => shiftErrorExit.requestClose()}
              aria-label={l10n.getString('pos-dismiss-error-aria')}
            >
              &times;
            </button>
          </div>
        )}
        </section>

        {/* ── Area: Course firing ─────────────────────── */}
        {/* ⚠️ The section is gated HERE **and** the conditions are repeated inside
            <CourseSelectorBar>, which returns null on the same three. That is not
            duplication for its own sake: the bar is also rendered standalone
            (CourseSelectorBar.test.tsx), so it has to hold its own contract, while the
            SECTION has to be gated or it wraps nothing and paints an empty area.
            `hideWhenEmpty` additionally suppresses the bar when no line is on hold —
            opt-in, because an all-fired cart legitimately shows an empty bar and that
            behaviour is pinned by the bar's own suite. */}
        {lines.length > 0 && activeWorkspace === 'restaurant-pos' && courseFiringEnabled !== false
          && !lines.every((l) => l.coursingStatus !== 'hold') && (
          <section className="pos-cart-course-bar-area" aria-label={l10n.getString('pos-cart-course-firing')}>
            <CourseSelectorBar
              lines={lines}
              fireCourse={fireCourse}
              fireAllCourses={fireAllCourses}
              activeWorkspace={activeWorkspace}
              courseFiringEnabled={courseFiringEnabled}
              hideWhenEmpty
            />
          </section>
        )}

        {/* ── Cart lines ────────────────────────────── */}
        <section
          className="pos-cart-lines"
          aria-label={l10n.getString(activeWorkspace === 'restaurant-pos' ? 'pos-cart-panel-title-order' : 'pos-cart-panel-title')}
        >
          {lines.length === 0 ? (
            <div className="pos-cart-empty-msg">
              <ShoppingBagIcon />
              <Localized id="pos-cart-empty">
                <span className="pos-cart-empty-title">Cart is empty</span>
              </Localized>
              <Localized id="pos-cart-empty-subtitle">
                <span className="pos-cart-empty-subtitle">
                  Tap a menu item to start the order
                </span>
              </Localized>
            </div>
          ) : (
            lines.map((line) => (
              <CartLineItem
                key={line.id}
                line={line}
                onRemove={handleRemoveLine}
                onDecreaseQty={handleDecreaseQty}
                onIncreaseQty={handleIncreaseQty}
                registerRef={setCartLineRef}
                {...(updateLineNote ? { onUpdateNote: updateLineNote } : {})}
                // A permission gate, not a role gate, when the host can answer:
                // the backend checks `sales:override_price` (cart.rs:345) and a
                // custom role may hold it without being "manager" — or lack it
                // while being one. Absent means fall back to `isManager`.
                {...((canOverridePrice ?? isManager) ? {
                  onOverride: (l: CartLine) => {
                    setOverrideTarget(l);
                    ensureCart(l.unit_price.currency);
                  },
                } : {})}
                {...(assignCourse && activeWorkspace === 'restaurant-pos' && courseFiringEnabled !== false ? {
                  onAssignCourse: assignCourse,
                  courseMenuLine,
                  onCourseMenuLineChange: setCourseMenuLine,
                } : {})}
                {...(onEditModifiers ? { onEditModifiers } : {})}
              />
            ))
          )}

          {/* ── Undo floating pill (bottom-right of cart lines) ── */}
          {animatedUndoStack.shouldRender && (
            <div
              className={`pos-cart-undo-bar${animatedUndoStack.isExiting ? ' pos-cart-undo-bar--exiting' : ''}`}
              role="status"
              aria-live="polite"
            >
              <button
                type="button"
                className="pos-cart-undo-btn"
                onClick={handleUndoRemove}
                aria-label={l10n.getString('pos-cart-undo-btn')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                </svg>
                {l10n.getString('pos-cart-undo-btn')}
              </button>
              <button
                type="button"
                className="pos-cart-undo-dismiss"
                onClick={handleDismissUndo}
                aria-label={l10n.getString('pos-cart-undo-dismiss-aria')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          )}
        </section>

        {/* ── Area: Footer totals + checkout actions ──── */}
        {lines.length > 0 && subtotal && (
          <footer className="pos-cart-footer-area">
            <CartFooterTotals
              lines={lines}
              subtotal={subtotal}
              discountPercent={discountPercent}
              discountLabel={discountLabel}
              discountAmount={discountAmount}
              showOptions={showOptions}
              setShowOptions={setShowOptions}
              showDiscountInput={showDiscountInput}
              setShowDiscountInput={setShowDiscountInput}
              setShowPromotions={setShowPromotions}
              appliedPromotions={appliedPromotions}
              setAppliedPromotions={setAppliedPromotions}
              discountInput={discountInput}
              setDiscountInput={setDiscountInput}
              discountName={discountName}
              setDiscountName={setDiscountName}
              handleApplyDiscount={handleApplyDiscount}
              handleClearDiscount={handleClearDiscount}
              tipPercent={tipPercent}
              setTipPercent={setTipPercent}
              tipAmount={tipAmount}
              serviceChargeEnabled={serviceChargeEnabled}
              serviceChargePercent={serviceChargePercent}
              serviceChargeAmount={serviceChargeAmount}
              setServiceCharge={setServiceCharge}
              cartTax={cartTax}
              taxEstimated={taxEstimated}
              taxState={taxState}
              retryTaxEstimate={retryTaxEstimate}
            >
              <CartActionBar
                activeShift={activeShift}
                shiftUnavailable={shiftUnavailable}
                handlePay={handlePay}
                addToast={addToast}
                setShowOpenBillInput={setShowOpenBillInput}
                setCartId={setCartId}
                deductionLocationIdRef={deductionLocationIdRef}
                setDeductionLocationName={setDeductionLocationName}
                setDeductionOverridden={setDeductionOverridden}
                resetCart={resetCart}
                tableNumber={tableNumber}
                orderType={orderType}
                customerName={customerName}
                activeOpenBillId={activeOpenBillId}
                handleOpenBill={handleOpenBill}
                saveTabEnabled={saveTabEnabled}
                hasLines={lines.length > 0}
                printBillEnabled={printBillEnabled}
                handlePrintBill={handlePrintBill}
                splitBillEnabled={splitBillEnabled}
                handleOpenSplitBill={setShowSplitBillModal ? () => setShowSplitBillModal(true) : undefined}
                hasUndispatchedItems={hasUndispatchedItems}
                sendingToKitchen={sendingToKitchen}
                handleSendToKitchen={handleSendToKitchen}
              />
            </CartFooterTotals>
          </footer>
        )}

        {/* ── Open Bills badge (only visible when open bills exist) ── */}
        {openBills.length > 0 && (
          <button
            type="button"
            className="pos-cart-held-badge"
            onClick={() => { setShowOpenBills(true); }}
            aria-label={l10n.getString('pos-cart-open-bills-aria')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
              <rect x="3" y="6" width="18" height="12" rx="2" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span>{l10n.getString('pos-cart-open-bills')}</span>
            <span className="pos-cart-held-count">{openBills.length}</span>
          </button>
        )}

        {/* ── Split Bill by Item Modal ── */}
        {showSplitBillModal && setShowSplitBillModal && handleConfirmSplitBill && (
          <SplitBillModal
            isOpen={showSplitBillModal}
            onClose={() => setShowSplitBillModal(false)}
            lines={lines}
            currency={lines[0]?.unit_price.currency || 'IDR'}
            tableNumber={tableNumber}
            orderType={orderType}
            onConfirmSplit={handleConfirmSplitBill}
          />
        )}
      </aside>
    </>
  );
}