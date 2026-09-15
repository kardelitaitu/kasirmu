/* eslint-disable jsx-a11y/no-noninteractive-element-interactions */
import { useState, useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useLocalization } from '@fluent/react';
import { animDuration } from '@/utils/animation';
import { Localized } from '@/components/Localized';
import { requiredLocalized } from '@/frontend/shared';
import type { Toast } from '@/frontend/shared/Toast';
import { FEATURES } from '@/hooks/useFeatures';
import type { CartTaxCacheState } from '@/hooks/useCartTax';
import type { AnimatedUndoStack } from '@/hooks/useAnimatedUndoStack';
import type { UseExitAnimationResult } from '@/hooks/useExitAnimation';
import type { Promotion } from '@/api/promotions';
import type { ShiftDto } from '@/api/shifts';
import type { HeldCartRow } from '@/api/sales';
import type { CartLine, CartId, CourseId, LineId, Money } from '@/types/domain';
import { CartLineItem } from './CartLineItem';
import { CourseSelectorBar } from './CourseSelectorBar';
import { CartFooterTotals } from './CartFooterTotals';
import { CartActionBar } from './CartActionBar';

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

export interface CartPanelProps {
  hidden?: boolean;
  startResize: (e: React.MouseEvent) => void;
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
  showTableNumberSetting: boolean;
  tableNumber: string;
  setTableNumber: Dispatch<SetStateAction<string>>;
  shiftErrorExit: UseExitAnimationResult;
  closeShiftError: string | null;
  fireCourse: (courseId: CourseId) => void;
  fireAllCourses: () => void;
  /**
   * Assign a course to a single line (restaurant coursing). Optional: when it
   * is omitted the per-line course chip is not rendered, so the retail path
   * and every caller without coursing are unaffected.
   */
  assignCourse?: (lineId: LineId, courseId: CourseId) => void;
  handleRemoveLine: (line: CartLine) => void;
  handleDecreaseQty: (line: CartLine) => void;
  handleIncreaseQty: (line: CartLine) => void;
  setCartLineRef: (lineId: LineId, el: HTMLDivElement | null) => void;
  isManager: boolean;
  setOverrideTarget: Dispatch<SetStateAction<CartLine | null>>;
  ensureCart: (currency: string) => Promise<CartId | null>;
  animatedUndoStack: AnimatedUndoStack<CartLine>;
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
  showTableNumberSetting,
  tableNumber,
  setTableNumber,
  shiftErrorExit,
  closeShiftError,
  fireCourse,
  fireAllCourses,
  assignCourse,
  handleRemoveLine,
  handleDecreaseQty,
  handleIncreaseQty,
  setCartLineRef,
  isManager,
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
}: CartPanelProps) {
  const { l10n } = useLocalization();
  // Which line's course dropdown is open. Held here rather than per row so
  // opening one line's menu closes the other's.
  const [courseMenuLine, setCourseMenuLine] = useState<LineId | null>(null);

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
      }, animDuration(250));
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
        }, animDuration(380));
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
        className={`pos-resize-handle${cartExiting ? ' pos-resize-handle--exiting' : ''}`}
        onMouseDown={startResize}
        aria-hidden="true"
        style={isFullyHidden ? { display: 'none' } : undefined}
      />

      {/* ── Right: Cart panel (resizable, keyboard-nav) */}
      <aside
        className={`pos-cart-panel${cartExiting ? ' pos-cart-panel--exiting' : ''}${cartEntering ? ' pos-cart-panel--entering' : ''}`}
        ref={cartPanelRef}
        aria-label={l10n.getString('pos-cart-panel-aria')}
        role="region"
        style={{ width: cartWidth, ...(isFullyHidden ? { display: 'none' } : {}) }}
        tabIndex={-1}
        onKeyDown={handleCartPanelKeyDown}
        {...cartSwipe}
      >
        <div className="pos-cart-header">
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

            {/* ADR-19 §17: locked deduction location badge (clickable → FastPINOverlay override) */}
            {deductionLocationName && (
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
            ) : activeShift ? (
              <>
                <span className="pos-shift-bar-indicator pos-shift-bar-indicator--open" />
                <span className="pos-shift-bar-label">
                  {l10n.getString(
                    'pos-shift-elapsed',
                    elapsedHoursMinutes(new Date(activeShift.openedAt).getTime(), shiftNow),
                  )}
                </span>
                <button
                  type="button"
                  className="pos-shift-close-btn"
                  onClick={handleCloseShiftClick}
                  aria-label={l10n.getString('pos-shift-close-aria')}
                >
                  {l10n.getString('pos-shift-close-btn')}
                </button>
              </>
            ) : (
              <>
                <span className="pos-shift-bar-indicator pos-shift-bar-indicator--closed" />
                <span className="pos-shift-bar-label">{l10n.getString('pos-shift-no-active')}</span>
                <button
                  type="button"
                  className="pos-shift-open-btn"
                  onClick={handleOpenShiftClick}
                  aria-label={l10n.getString('pos-shift-open-aria')}
                >
                  {l10n.getString('pos-shift-open-btn')}
                </button>
              </>
            )}
          </div>

          {/* ── Right: terminal action buttons ── */}
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
            {activeWorkspace !== 'restaurant-pos' && (
              <button
                type="button"
                className="pos-cart-lock-btn"
                onClick={() => setShowStockInquiry(true)}
                aria-label={requiredLocalized(l10n, 'retail-fn-stok')}
                title={requiredLocalized(l10n, 'retail-fn-stok')}
              >
                📦
              </button>
            )}

            <button
              type="button"
              className="pos-cart-lock-btn"
              onClick={() => onNavigate?.('kds')}
              aria-label={requiredLocalized(l10n, 'kds-title')}
              title={requiredLocalized(l10n, 'kds-title')}
            >
              <KitchenDisplayIcon />
            </button>

            {/* Settings is a manager/owner surface — not needed at the
                restaurant cashier terminal (reachable from the workspace
                picker); retail keeps it. */}
            {activeWorkspace !== 'restaurant-pos' && (
              <button
                type="button"
                className="pos-cart-lock-btn"
                onClick={handleOpenSettings}
                aria-label={requiredLocalized(l10n, 'settings-page-title')}
                title={requiredLocalized(l10n, 'settings-page-title')}
              >
                ⚙️
              </button>
            )}

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
        </div>

        {/* ── Table number input (only when setting enabled) ── */}
        {showTableNumberSetting && (
          <div className="pos-cart-table-row">
            <label htmlFor="pos-table-number" className="pos-cart-table-label">
              {l10n.getString('pos-cart-table-label')}
            </label>
            <input
              id="pos-table-number"
              type="number"
              className="pos-cart-table-input"
              min="1"
              value={tableNumber}
              onChange={(e) => setTableNumber(e.target.value)}
              aria-label={l10n.getString('pos-cart-table-aria')}
              placeholder={l10n.getString('pos-cart-table-placeholder')}
            />
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

        {/* ── Course firing bar ──────────────────────── */}
        {lines.length > 0 && activeWorkspace === 'restaurant-pos' && (
          <CourseSelectorBar
            lines={lines}
            fireCourse={fireCourse}
            fireAllCourses={fireAllCourses}
          />
        )}

        {/* ── Cart lines ────────────────────────────── */}
        <div className="pos-cart-lines">
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
                {...(isManager ? {
                  onOverride: (l: CartLine) => {
                    setOverrideTarget(l);
                    ensureCart(l.unit_price.currency);
                  },
                } : {})}
                {...(assignCourse && activeWorkspace === 'restaurant-pos' ? {
                  onAssignCourse: assignCourse,
                  courseMenuLine,
                  onCourseMenuLineChange: setCourseMenuLine,
                } : {})}
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
                title={l10n.getString('pos-cart-undo-dismiss')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* ── Footer: subtotal + discount + tip + service + pay ──── */}
        {lines.length > 0 && subtotal && (
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
              handlePay={handlePay}
              addToast={addToast}
              setShowOpenBillInput={setShowOpenBillInput}
              setCartId={setCartId}
              deductionLocationIdRef={deductionLocationIdRef}
              setDeductionLocationName={setDeductionLocationName}
              setDeductionOverridden={setDeductionOverridden}
              resetCart={resetCart}
            />
          </CartFooterTotals>
        )}

        {/* ── Open Bills badge (always visible) ── */}
        <button
          type="button"
          className="pos-cart-held-badge"
          onClick={() => { setShowOpenBills(true); }}
          aria-label={l10n.getString('pos-cart-open-bills-aria')}
          title={l10n.getString('pos-cart-open-bills-aria')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
            <rect x="3" y="6" width="18" height="12" rx="2" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span>{l10n.getString('pos-cart-open-bills')}</span>
          {openBills.length > 0 && (
            <span className="pos-cart-held-count">{openBills.length}</span>
          )}
        </button>
      </aside>
    </>
  );
}
