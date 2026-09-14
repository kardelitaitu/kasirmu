import { useCallback, useState, useEffect, useRef } from 'react';
import { useToast } from '@/frontend/shared/Toast';
import { requiredLocalized } from '@/frontend/shared';
import { useAuth } from '@/contexts/AuthContext';
import { Localized } from '@/components/Localized';
import { useLocalization } from '@fluent/react';
import ProductLookupScreen from '@/features/products/ProductLookupScreen';
import RestaurantMenu from '@/features/restaurant/RestaurantMenu';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useFeatures } from '@/hooks/useFeatures';
import TableManagementScreen from '@/features/tables/TableManagementScreen';
import SalesHistoryScreen from '@/features/sales/SalesHistoryScreen';

import WorkspaceSettingsModal from '@/features/settings/WorkspaceSettingsModal';
import { formatMoney, type LineId, type Product, type Sku } from '@/types/domain';
import { useSwipe } from '@/hooks/useSwipe';
import {
  deleteHeldCartScoped,
} from '@/api/sales';
import { getReceiptSettingsScoped } from '@/api/settings';
import type { CartTaxCacheState } from '@/hooks/useCartTax';
import type { CartLineTaxInput } from '@/api/tax';
import { lookupByBarcodeScoped, lookupProductBySkuScoped } from '@/api/products';
import { lookupBundleBySku } from '@/api/bundles';
import { expandBundleItems } from './bundleExpansion';
import { CartTaxWatcher, IDLE_TAX_STATE } from './components/CartTaxWatcher';
import { CartPanel } from './components/CartPanel';
import { CloseShiftConfirm, ShiftSummary, OpenShiftModal } from './components/ShiftModals';
import { clampCartWidth, CART_WIDTH_DEFAULT } from './utils/cartCalculations';
import type { BarcodeScannedPayload } from '@/api/hardware';
import { usePosState } from './usePosState';
import { useBarcodeScanner } from './useBarcodeScanner';
import { useCustomerDisplay } from './useCustomerDisplay';
import { usePosShifts } from './hooks/usePosShifts';
import { usePosHeldCarts } from './hooks/usePosHeldCarts';
import { usePosCartActions } from './hooks/usePosCartActions';
import { useCartKeyboardNav } from './hooks/useCartKeyboardNav';
import PaymentModal from './PaymentModal';
import PriceOverrideModal from './PriceOverrideModal';
import PromotionsModal from './PromotionsModal';
import type { Promotion } from '@/api/promotions';
import FastPINOverlay from '@/components/FastPINOverlay';

import './PosScreen.css';
import './CartPanel.css';
import './CartPanelLineItem.css';
import './CartPanelFooterTotals.css';
import './CartPanelActions.css';
import './CartPanel.brand.css';
import './CartPanelCourseBar.css';


/**
 * Settings sub-screen — 4-tab routing for Appearance / Features /
 * Data / Sync. Mirrors the desktop `RetailOptionsScreen` pattern so
 * the restaurant tablet covers the same Settings surface as the
 * desktop client. Rendered as a full-screen overlay above PosScreen;
 * the `onBack` callback returns to the main sales screen.
 */
// SettingsSubScreen removed in Phase 6 (ADR #22) — replaced by WorkspaceSettingsModal.

/**
 * POS sales screen — product lookup on the left, cart panel on the right.
 *
 * The left panel shows the ProductLookupScreen (search, barcode, category
 * filters, product grid). Clicking a product adds it to the cart.
 *
 * The right panel shows the current cart with line items, quantity
 * controls, remove buttons, subtotal, discount controls, tip + service
 * charge, persistent undo bar, and a Pay button. Its width is set by
 * `cartWidth` state and clamped by `clampCartWidth` so it stays sane on
 * 1366×768 → 4K displays. Keyboard navigation (↑/↓/+/-/Del/Enter) is
 * bound on the cart panel itself.
 */
interface PosScreenProps {
  onNavigate?: (route: string) => void;
}

export default function PosScreen({ onNavigate }: PosScreenProps) {
  const {
    lines,
    subtotal,
    total,
    discountPercent,
    discountLabel,
    discountAmount,
    tipPercent,
    tipAmount,
    serviceChargeEnabled,
    serviceChargePercent,
    serviceChargeAmount,
    addProduct,
    removeLine,
    updateQty,
    updateLinePrice,
    fireCourse,
    fireAllCourses,
    setDiscount,
    setTipPercent,
    setServiceCharge,
    resetCart,
    setLines,
  } = usePosState();
  const { addToast } = useToast();
  const { l10n } = useLocalization();
  const l10nRef = useRef(l10n);
  l10nRef.current = l10n;
  const { session, logout, isManager } = useAuth();
  const { activeWorkspace, setActiveWorkspace, sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';
  const { isEnabled } = useFeatures();
  const userId = session?.user_id ?? '';

  const handleOpenSettings = useCallback(() => {
    if (onNavigate) {
      onNavigate('settings');
    } else {
      setActiveWorkspace('admin');
    }
  }, [onNavigate, setActiveWorkspace]);

  // ── Restore locked cart on mount ────────────────────────────────
  const LOCKED_CART_KEY = 'pos-locked-cart';
  // PROMO-5/PROMO-3: promotions selected in the picker. They no longer
  // map onto the cart-discount pipeline — the selected ids ride to
  // checkout (PaymentModal → complete_sale promotionIds) and the backend
  // engine applies them against the post-tax sale, so fixed/BXGY work
  // and percentage promotions stack instead of overwriting the manual
  // discount slot. Declared before the restore effect so a lock/unlock
  // cycle can rehydrate the selection.
  const [appliedPromotions, setAppliedPromotions] = useState<Promotion[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOCKED_CART_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.lines && Array.isArray(data.lines)) {
        setLines(data.lines.map((l: { sku: string; name?: string; category?: string; qty: number; unit_price: { minor_units: number; currency: string } }) => ({
          id: `restored-${Date.now()}-${Math.random().toString(36).slice(2)}` as LineId,
          sku: l.sku as Sku,
          name: l.name,
          category: l.category,
          qty: l.qty,
          unit_price: l.unit_price,
        })));
      }
      if (typeof data.discountPercent === 'number') {
        setDiscount(data.discountPercent, data.discountLabel || '');
      }
      if (Array.isArray(data.appliedPromotions)) {
        setAppliedPromotions(data.appliedPromotions);
      }
      if (typeof data.tipPercent === 'number') {
        setTipPercent(data.tipPercent);
      }
      if (typeof data.serviceChargeEnabled === 'boolean') {
        setServiceCharge(data.serviceChargeEnabled, data.serviceChargePercent);
      }
      localStorage.removeItem(LOCKED_CART_KEY);
    } catch { /* ignore */ }
  }, [setLines, setDiscount, setAppliedPromotions, setTipPercent, setServiceCharge]);
  const [showOptions, setShowOptions] = useState(false);
  const [showTables, setShowTables] = useState(false);
  const [showSalesHistory, setShowSalesHistory] = useState(false);
  const [showStockInquiry, setShowStockInquiry] = useState(false);
  const [showWorkspaceSettings, setShowWorkspaceSettings] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showDiscountInput, setShowDiscountInput] = useState(false);
  const [showPromotions, setShowPromotions] = useState(false);
  const [discountInput, setDiscountInput] = useState('');
  const [discountName, setDiscountName] = useState('');
  const [tableNumber, setTableNumber] = useState('');
  const [showTableNumberSetting, setShowTableNumberSetting] = useState(false);

  // ── Cart panel resize state ─────────────────────────────────────────────
  // Viewport-aware so the panel can grow on wide screens (up to half
  // the viewport, capped at 1200 px) but stays ≥ 320 px for legibility.
  const [cartWidth, setCartWidth] = useState(() => {
    const saved = localStorage.getItem('pos-cart-width');
    const parsed = saved ? parseInt(saved, 10) : NaN;
    const initial =
      Number.isFinite(parsed) && parsed > 0 ? parsed : CART_WIDTH_DEFAULT;
    const viewportWidth =
      typeof window !== 'undefined' ? window.innerWidth : CART_WIDTH_DEFAULT * 2;
    return clampCartWidth(initial, viewportWidth);
  });
  const isResizing = useRef(false);
  const posScreenRef = useRef<HTMLDivElement>(null);
  // ── Cart-line DOM refs for keyboard navigation ─────────────────────────
  // Each registered DOM node is the `<div class="pos-cart-line">` element.
  // The handler reads/writes focus so ↑/↓/+/-/Del/Enter work without
  // forcing the user to click into a line first.
  const cartLineRefs = useRef<Map<LineId, HTMLDivElement>>(new Map());
  const cartPanelRef = useRef<HTMLElement>(null);

  const setCartLineRef = useCallback(
    (lineId: LineId, el: HTMLDivElement | null) => {
      if (el) cartLineRefs.current.set(lineId, el);
      else cartLineRefs.current.delete(lineId);
    },
    [],
  );

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const stopResize = () => {
      if (!isResizing.current) return;
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!isResizing.current || !posScreenRef.current) return;
      const rect = posScreenRef.current.getBoundingClientRect();
      const clamped = clampCartWidth(rect.right - e.clientX, window.innerWidth);
      setCartWidth(clamped);
      // Persist the clamped value so the next launch on this
      // display picks up the most recent *applied* width.
      localStorage.setItem('pos-cart-width', String(clamped));
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', stopResize);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', stopResize);
      stopResize();
    };
  }, []);

  // Re-clamp the cart width whenever the window is resized —
  // important when the cashier drags the window to a different
  // monitor, or a docked laptop reconnects to its 4K display.
  useEffect(() => {
    const onResize = () => {
      setCartWidth((w) => {
        const clamped = clampCartWidth(w, window.innerWidth);
        localStorage.setItem('pos-cart-width', String(clamped));
        return clamped;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const {
    activeShift,
    activeShiftRef,
    shiftLoading,
    shiftNow,
    setShowCloseShift,
    openShiftExit,
    closingBalance,
    setClosingBalance,
    openingBalance,
    setOpeningBalance,
    shiftNotes,
    setShiftNotes,
    closingShift,
    openingShift,
    closeShiftError,
    setCloseShiftError,
    closedShiftSummary,
    shiftErrorExit,
    closeShiftExit,
    shiftSummaryExit,
    handleCloseShiftClick,
    handleConfirmCloseShift,
    handleOpenShiftClick,
    handleConfirmOpenShift,
  } = usePosShifts({ sessionToken, userId, lines, l10nRef });
  // ── Cart actions: cart handle, deduction binding, add/qty/override ──
  const {
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
    handleApplyDiscount,
    handleClearDiscount,
    handleSelectPromotions,
    animatedUndoStack,
    handleRemoveLine,
    handleUndoRemove,
    handleDismissUndo,
  } = usePosCartActions({
    sessionToken,
    addToast,
    activeShiftRef,
    l10nRef,
    addProduct,
    updateQty,
    updateLinePrice,
    removeLine,
    setLines,
    setDiscount,
    discountInput,
    discountName,
    setShowDiscountInput,
    setDiscountInput,
    setDiscountName,
    setShowPromotions,
    setAppliedPromotions,
  });
  // ── Barcode scanner integration ─────────────────────────────
  useBarcodeScanner({
    sessionToken,
    onProductFound: useCallback(async (payload: BarcodeScannedPayload) => {
      if (!activeShiftRef.current) {
        addToast({ message: 'Open a shift first', type: 'warning' });
        return;
      }
      try {
        const code = payload.code;
        // 1. Try product barcode lookup first.
        const dto = await lookupByBarcodeScoped(sessionToken, code);
        if (dto) {
          const product: Product = {
            sku: dto.sku as Sku,
            name: dto.name,
            category: dto.category ?? 'Uncategorised',
            price: { minor_units: dto.price.minor_units, currency: dto.price.currency },
            barcode: dto.barcode,
            inStock: dto.in_stock,
            stockQty: dto.stock_qty,
            productType: dto.product_type as Product['productType'],
          };
          handleAddProduct(product);
          return;
        }

        // 2. Fall back to bundle SKU expansion with proportional pricing.
        const bundle = await lookupBundleBySku(sessionToken, code);
        if (bundle && bundle.bundle.active) {
          const expanded = await expandBundleItems(
            bundle.items,
            bundle.bundle.currency,
            bundle.bundle.bundle_price_minor,
            (sku: string) => lookupProductBySkuScoped(sessionToken, sku),
          );
          for (const item of expanded) {
            handleAddProduct(item.product, item.qty);
          }
          addToast({
            type: 'success',
            message: l10nRef.current.getString('pos-bundle-expanded', { name: bundle.bundle.name, count: expanded.length }),
          });
        } else {
          addToast({ type: 'warning', message: l10nRef.current.getString('pos-no-barcode-match') });
        }
      } catch {
        // Silently ignore — the scanner will beep, user retries.
      }
    }, [handleAddProduct, addToast, sessionToken, activeShiftRef, l10nRef]), // l10n via ref
    onError: useCallback(
      (error: string) => {
        addToast({
          type: 'error',
          message: l10nRef.current.getString(
            'pos-scanner-error',
            { detail: error },
            `Scanner error: ${error}`,
          ),
        });
      },
      [addToast], // l10n via ref
    ),
  });

  const handlePay = useCallback(() => {
    if (!activeShiftRef.current) {
      addToast({ message: 'Open a shift first', type: 'warning' });
      return;
    }
    if (!total) return;
    setShowPayment(true);
  }, [total, addToast, activeShiftRef]);

  // P7-1: Swipe left on cart panel → open payment modal (tablet flow)
  const cartSwipe = useSwipe({
    onSwipeLeft: () => {
      if (total && activeShiftRef.current) {
        setShowPayment(true);
      }
    },
  });

  // ── Open Bill / held-cart state ──────────────────────────────────
  const {
    activeOpenBillId,
    setActiveOpenBillId,
    openBills,
    setShowOpenBills,
    openBillsExit,
    loadOpenBills,
    setShowOpenBillInput,
    openBillInputExit,
    openBillName,
    setOpenBillName,
    openingBill,
    handleOpenBill,
    handleResumeOpenBill,
  } = usePosHeldCarts({
    sessionToken,
    addToast,
    activeShift,
    lines,
    subtotal,
    discountPercent,
    discountLabel,
    resetCart,
    setAppliedPromotions,
    setLines,
    setDiscount,
    setTableNumber,
  });

  const { handlePaymentComplete: customerDisplayPaymentComplete } = useCustomerDisplay({
    sessionToken,
    lines,
    total,
  });

  // ── Live tax preview ─────────────────────────────────────────
  // F2-3: R36-19 fix — the failed-compute path no longer renders a
  // silent zero. The hook classifies the last known answer (caution /
  // warn / unknown) and cacheFresh is the BINDING tender-eligibility
  // gate (D64 b): a stale estimate is displayed but never added to the
  // amount due. Zero on an empty cart is a genuinely computed zero.
  const [taxRetryNonce, setTaxRetryNonce] = useState(0);
  const [taxState, setTaxState] = useState<CartTaxCacheState>(IDLE_TAX_STATE);
  const taxLines: CartLineTaxInput[] = lines.map((l) => ({
    sku: String(l.sku),
    qty: l.qty,
    unit_price_minor: l.unit_price.minor_units,
  }));
  const retryTaxEstimate = useCallback(() => setTaxRetryNonce((n) => n + 1), []);
  const cartTax = taxState.taxMinor;
  const cartTaxExclusive = taxState.hasExclusive ?? false;
  const cartTaxFresh = taxState.cacheFresh;
  // Sale must be flagged for recompute whenever the shown tax was not
  // freshly computed (warn estimate, or unknown after a failed compute).
  // F2-6 threads this flag into sales.tax_estimate_note.
  const taxEstimated = lines.length > 0 && !cartTaxFresh;

  const handlePaymentComplete = useCallback(() => {
    setShowPayment(false);
    setCartId(null);
    deductionLocationIdRef.current = null;
    setDeductionLocationName(null);
    setDeductionOverridden(false);
    // PROMO-3: the checkout consumed the promotion selection.
    setAppliedPromotions([]);
    // If this was an open bill being paid, delete it from DB.
    if (activeOpenBillId) {
      deleteHeldCartScoped(sessionToken, activeOpenBillId).catch(() => {
        addToast({ message: 'Failed to delete held cart', type: 'error' });
      });
      setActiveOpenBillId(null);
      loadOpenBills();
    }
    resetCart();
    // Also clear the customer-facing pole display.
    customerDisplayPaymentComplete();
  }, [resetCart, customerDisplayPaymentComplete, activeOpenBillId, loadOpenBills, addToast, sessionToken, deductionLocationIdRef, setActiveOpenBillId, setCartId, setDeductionLocationName, setDeductionOverridden]);

  // ── Lock: save cart state to localStorage, then logout ───────────

  const handleLock = useCallback(() => {
    try {
      if (lines.length > 0) {
        const data = {
          lines: lines.map((l) => ({
            sku: l.sku,
            name: l.name,
            category: l.category,
            qty: l.qty,
            unit_price: l.unit_price,
          })),
          discountPercent,
          discountLabel,
          appliedPromotions,
          tipPercent,
          serviceChargeEnabled,
          serviceChargePercent,
        };
        localStorage.setItem(LOCKED_CART_KEY, JSON.stringify(data));
      } else {
        localStorage.removeItem(LOCKED_CART_KEY);
      }
    } catch { /* storage quota or unavailable — ignore */ }
    logout();
  }, [lines, discountPercent, discountLabel, appliedPromotions, tipPercent, serviceChargeEnabled, serviceChargePercent, logout]);

  // ── Keyboard navigation (↑ / ↓ / + / − / Del / Enter) ─────────
  // Behaviour lives in useCartKeyboardNav; the cart-line ref Map and its
  // setter stay here because CartPanel is registered from this screen.
  const { handleCartPanelKeyDown } = useCartKeyboardNav({
    cartLineRefs,
    lines,
    total,
    handlePay,
    handleIncreaseQty,
    handleDecreaseQty,
    handleRemoveLine,
  });

  // ── Load receipt settings on mount ────────────────────────────
  useEffect(() => {
    getReceiptSettingsScoped(sessionToken)
      .then((s) => setShowTableNumberSetting(s.showTableNumber))
      .catch(() => addToast({ message: requiredLocalized(l10nRef.current, 'pos-toast-receipt-settings-failed'), type: 'error' }));
  }, [addToast, sessionToken]); // l10n via ref — stable dep chain

  // ── Sub-screen: Table Management ─────────────────────────────
  if (showTables) {
    return (
      <div className="pos-screen">
        <div style={{ flex: 1, overflow: 'auto' }}>
          <TableManagementScreen />
        </div>
        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--color-border, #ddd)' }}>
          <button
            type="button"
            className="pos-cart-pay-btn"
            onClick={() => setShowTables(false)}
            style={{ width: '100%' }}
          >
            &larr; {l10n.getString('back')}
          </button>
        </div>
      </div>
    );
  }

  // ── Sub-screen: Sales History (F6) ───────────────────────────
  if (showSalesHistory) {
    return (
      <div className="pos-screen">
        <div style={{ flex: 1, overflow: 'auto' }}>
          <SalesHistoryScreen />
        </div>
        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--color-border, #ddd)' }}>
          <button
            type="button"
            className="pos-cart-pay-btn"
            onClick={() => setShowSalesHistory(false)}
            style={{ width: '100%' }}
          >
            &larr; {l10n.getString('back')}
          </button>
        </div>
      </div>
    );
  }

  // ── Sub-screen: Stock Inquiry (F8) ───────────────────────────
  if (showStockInquiry) {
    return (
      <div className="pos-screen">
        <div style={{ flex: 1, overflow: 'auto' }}>
          <ProductLookupScreen onAddProduct={handleAddProduct} />
        </div>
        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--color-border, #ddd)' }}>
          <button
            type="button"
            className="pos-cart-pay-btn"
            onClick={() => setShowStockInquiry(false)}
            style={{ width: '100%' }}
          >
            &larr; {l10n.getString('back')}
          </button>
        </div>
      </div>
    );
  }

  // ── Sub-screen: Settings (4-tab-routing) ──────────────────────
  // Same pattern as the desktop `RetailOptionsScreen`: four tabs
  // (Appearance / Features / Data / Sync) that route to the
  // dedicated settings sub-screens. Lets the restaurant tablet
  // cover the same Settings surface as the desktop client.


  if (!session) {
    return (
      <div className="pos-screen">
        <div className="pos-login-required">
          <Localized id="pos-login-required">
            <h2>Login Required</h2>
          </Localized>
          <Localized id="pos-login-desc">
            <p>Please log in to use the POS.</p>
          </Localized>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="pos-screen" ref={posScreenRef}>
      {/* ── Left: Product lookup ─────────────────── */}
      <div className="pos-products">
        {activeWorkspace === 'restaurant-pos' ? (
          <RestaurantMenu onAddProduct={handleAddProduct} />
        ) : (
          <ProductLookupScreen onAddProduct={handleAddProduct} />
        )}
      </div>

      {/* ── Resize handle ───────────────────────── */}
      <CartPanel
        startResize={startResize}
        cartPanelRef={cartPanelRef}
        cartWidth={cartWidth}
        handleCartPanelKeyDown={handleCartPanelKeyDown}
        cartSwipe={cartSwipe}
        activeWorkspace={activeWorkspace}
        lines={lines}
        deductionLocationName={deductionLocationName}
        handleDeductionBadgeClick={handleDeductionBadgeClick}
        deductionOverridden={deductionOverridden}
        shiftLoading={shiftLoading}
        activeShift={activeShift}
        shiftNow={shiftNow}
        handleCloseShiftClick={handleCloseShiftClick}
        handleOpenShiftClick={handleOpenShiftClick}
        isEnabled={isEnabled}
        setShowTables={setShowTables}
        setShowSalesHistory={setShowSalesHistory}
        setShowStockInquiry={setShowStockInquiry}
        onNavigate={onNavigate}
        handleOpenSettings={handleOpenSettings}
        handleLock={handleLock}
        showTableNumberSetting={showTableNumberSetting}
        tableNumber={tableNumber}
        setTableNumber={setTableNumber}
        shiftErrorExit={shiftErrorExit}
        closeShiftError={closeShiftError}
        fireCourse={fireCourse}
        fireAllCourses={fireAllCourses}
        handleRemoveLine={handleRemoveLine}
        handleDecreaseQty={handleDecreaseQty}
        handleIncreaseQty={handleIncreaseQty}
        setCartLineRef={setCartLineRef}
        isManager={isManager}
        setOverrideTarget={setOverrideTarget}
        ensureCart={ensureCart}
        animatedUndoStack={animatedUndoStack}
        handleUndoRemove={handleUndoRemove}
        handleDismissUndo={handleDismissUndo}
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
        handlePay={handlePay}
        addToast={addToast}
        setShowOpenBillInput={setShowOpenBillInput}
        setCartId={setCartId}
        deductionLocationIdRef={deductionLocationIdRef}
        setDeductionLocationName={setDeductionLocationName}
        setDeductionOverridden={setDeductionOverridden}
        resetCart={resetCart}
        setShowOpenBills={setShowOpenBills}
        openBills={openBills}
      />

      {/* ── F2-3: cart-tax watcher (retry bumps the key) ─ */}
      <CartTaxWatcher
        key={taxRetryNonce}
        sessionToken={rawToken}
        lines={taxLines}
        currency={subtotal?.currency ?? 'IDR'}
        onState={setTaxState}
      />

      {/* ── Payment modal ──────────────────────────── */}
      {total && (
        <PaymentModal
          open={showPayment}
          lineItems={lines}
          total={total && cartTaxExclusive && cartTax > 0 && cartTaxFresh
            ? { minor_units: total.minor_units + cartTax, currency: total.currency }
            : total}
          discountPercent={discountPercent}
          discountLabel={discountLabel}
          userId={userId}
          tipMinor={tipAmount?.minor_units ?? 0}
          serviceChargeMinor={serviceChargeAmount?.minor_units ?? 0}
          promotionIds={appliedPromotions.map((p) => p.id)}
          taxEstimated={taxEstimated}
          {...(sessionToken ? { sessionToken } : {})}
          tableNumber={tableNumber}
          onComplete={handlePaymentComplete}
          onClose={() => setShowPayment(false)}
        />
      )}

      {/* ── Price Override modal ─────────────────────── */}
      {overrideTarget && (
        <PriceOverrideModal
          open
          lineDescription={`${overrideTarget.name ?? overrideTarget.sku} — ${formatMoney(overrideTarget.unit_price)}`}
          currentPrice={overrideTarget.unit_price}
          onConfirm={handleOverrideConfirm}
          onClose={() => setOverrideTarget(null)}
        />
      )}

      {/* ── Promotions picker modal ───────────────────── */}
      <PromotionsModal
        open={showPromotions}
        sessionToken={sessionToken}
        subtotalMinor={subtotal?.minor_units ?? 0}
        initiallySelectedIds={appliedPromotions.map((p) => p.id)}
        onApply={handleSelectPromotions}
        onClose={() => setShowPromotions(false)}
      />

      {/* ── Open Bill Input modal ────────────────────── */}
      {openBillInputExit.shouldRender && (          <div
            className={`pos-hold-overlay${openBillInputExit.exiting ? ' pos-hold-overlay--exiting' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={l10n.getString('pos-open-bill-overlay-aria')}
          >
            <div className={`pos-hold-modal${openBillInputExit.exiting ? ' pos-hold-modal--exiting' : ''}`}>
            <h3 className="pos-hold-title">{l10n.getString('pos-open-bill-title')}</h3>
            <p className="pos-hold-desc">
              {l10n.getString('pos-open-bill-desc')}
            </p>
            <input
              type="text"
              className="pos-hold-input"
              placeholder={l10n.getString('pos-open-bill-placeholder')}
              value={openBillName}
              onChange={(e) => setOpenBillName(e.target.value)}
              aria-label={l10n.getString('pos-open-bill-name-aria')}
            />
            <div className="pos-hold-actions">
              <button
                type="button"
                className="pos-hold-cancel-btn"
                onClick={() => {
                  openBillInputExit.requestClose();
                  setOpenBillName('');
                }}
                disabled={openingBill}
              >
                {requiredLocalized(l10n, 'pos-hold-cancel')}
              </button>
              <button
                type="button"
                className="pos-hold-confirm-btn"
                onClick={handleOpenBill}
                disabled={openingBill}
              >
                <span>{l10n.getString(openingBill ? 'pos-open-bill-saving' : 'pos-open-bill-save')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Open Bills panel ────────────────────────── */}
      {openBillsExit.shouldRender && (          <div className={`pos-hold-overlay${openBillsExit.exiting ? ' pos-hold-overlay--exiting' : ''}`} role="dialog" aria-modal="true" aria-label={l10n.getString('pos-open-bills-overlay-aria')}>
          <div className={`pos-held-list-modal${openBillsExit.exiting ? ' pos-held-list-modal--exiting' : ''}`}>
            <div className="pos-held-list-header">
              <h3>{l10n.getString('pos-open-bills-title')}</h3>
              <button
                type="button"
                className="pos-held-list-close"
                onClick={() => openBillsExit.requestClose()}
                aria-label={l10n.getString('pos-open-bills-close-aria')}
              >
                &times;
              </button>
            </div>
            <div className="pos-held-list-body">
              {openBills.length === 0 ? (
                <p className="pos-held-list-empty">{l10n.getString('pos-open-bills-empty')}</p>
              ) : (
                openBills.map((ob) => (
                  <div key={ob.id} className="pos-held-item">
                    <div className="pos-held-item-info">
                      <span className="pos-held-item-label">
                        {ob.customer_name || ob.label}
                      </span>
                      <span className="pos-held-item-meta">
                        {ob.item_count} item{ob.item_count !== 1 ? 's' : ''} &middot; {formatMoney({ minor_units: ob.total_minor, currency: ob.currency })} &middot; {new Date(ob.created_at).toLocaleString()}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="pos-held-item-resume"
                      onClick={() => handleResumeOpenBill(ob.id)}
                      aria-label={`${l10n.getString('pos-open-bills-resume')} ${ob.customer_name || ob.label}`}
                    >
                      {l10n.getString('pos-open-bills-resume')}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* -- Shift modals (Close Shift confirm / summary / Open Shift) -- */}
      <CloseShiftConfirm
        closeShiftExit={closeShiftExit}
        activeShift={activeShift}
        closeShiftError={closeShiftError}
        setCloseShiftError={setCloseShiftError}
        closingBalance={closingBalance}
        setClosingBalance={setClosingBalance}
        shiftNotes={shiftNotes}
        setShiftNotes={setShiftNotes}
        closingShift={closingShift}
        setShowCloseShift={setShowCloseShift}
        handleConfirmCloseShift={handleConfirmCloseShift}
      />

      <ShiftSummary
        shiftSummaryExit={shiftSummaryExit}
        closedShiftSummary={closedShiftSummary}
      />

      <OpenShiftModal
        openShiftExit={openShiftExit}
        openingBalance={openingBalance}
        setOpeningBalance={setOpeningBalance}
        openingShift={openingShift}
        handleConfirmOpenShift={handleConfirmOpenShift}
      />

      {/* ── FastPIN Overlay (ADR-19 §17: badge click → manager override) ── */}
      <FastPINOverlay
        open={showFastPINOverlay}
        onClose={() => setShowFastPINOverlay(false)}
        onVerified={handleDeductionPinVerified}
      />
    </div>

    {/* ── Workspace Settings Modal (ADR #22 Phase 5) ── */}
    {showWorkspaceSettings && (
      <WorkspaceSettingsModal
        open={showWorkspaceSettings}
        onClose={() => setShowWorkspaceSettings(false)}
        workspaceType="restaurant-pos"
        presentation="slideover"
      />
    )}
  </>
  );
}

