import { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { useToast } from '@/components/Toast';
import { requiredLocalized } from '@/components';
import { useAuth } from '@/contexts/AuthContext';
import { Localized } from '@/components/Localized';
import { useLocalization } from '@fluent/react';
import ProductLookupScreen from '@/features/products/ProductLookupScreen';
import { useProducts } from '@/features/products/useProducts';
import RestaurantMenu from '@/features/restaurant/RestaurantMenu';
import type { RestaurantSidebarActions, RestaurantSidebarProfile } from '@/features/restaurant/components/RestaurantSidebar';
import { isTauriWebview } from '@/api/tauri';
import { pickImageFile } from '@/api/image-pick';
import { getOwnAvatarScoped, setAvatarScoped } from '@/api/staff';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { FEATURES, useFeatures } from '@/hooks/useFeatures';
import TableManagementScreen from '@/features/tables/TableManagementScreen';
import SalesHistoryScreen from '@/features/sales/SalesHistoryScreen';
import RestaurantReceiptsScreen from '@/features/restaurant/screens/RestaurantReceiptsScreen';
import RestaurantPaymentsScreen from '@/features/restaurant/screens/RestaurantPaymentsScreen';
import RestaurantSettingsScreen from '@/features/restaurant/screens/RestaurantSettingsScreen';
import { RestaurantFloatingCartBar } from '@/features/restaurant/components/RestaurantFloatingCartBar';
import { RestaurantCartSheet } from '@/features/restaurant/components/RestaurantCartSheet';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useWorkspaceNav } from '@/hooks/useWorkspaceNav';
import { useOrientation } from '@/hooks/useOrientation';

import { formatMoney, getProductModifierGroups, type CartLine, type LineId, type ModifierSelection, type Product, type Sku } from '@/types/domain';
import { useSwipe } from '@/hooks/useSwipe';
import {
  deleteHeldCartScoped,
} from '@/api/sales';
import { getReceiptSettingsScoped, getSettingScoped, getStoreSettingsScoped } from '@/api/settings';
import { useOptionalCurrency } from '@/contexts/CurrencyContext';
import type { CartTaxCacheState } from '@/hooks/useCartTax';
import type { CartLineTaxInput } from '@/api/tax';
import { lookupByBarcodeScoped, lookupProductBySkuScoped } from '@/api/products';
import { lookupBundleBySku } from '@/api/bundles';
import { listTablesScoped, updateTableStatusScoped } from '@/api/tables';
import { expandBundleItems } from './bundleExpansion';
import { CartTaxWatcher, createIdleTaxState } from '@/features/pos/components/CartTaxWatcher';
import { CartPanel } from './components/CartPanel';
import type { CartPanelProps } from './components/CartPanel';
import { CloseShiftConfirm, ShiftSummary, OpenShiftModal } from './components/ShiftModals';
import { OpenBillInput, OpenBillsPanel } from './components/OpenBillModals';
import { openCashDrawerScoped, type BarcodeScannedPayload } from '@/api/hardware';
import { usePosState } from './usePosState';
import { useBarcodeScanner } from './useBarcodeScanner';
import { useCustomerDisplay } from './useCustomerDisplay';
import { usePosShifts } from './hooks/usePosShifts';
import { usePosHeldCarts } from './hooks/usePosHeldCarts';
import { usePosCartActions } from './hooks/usePosCartActions';
import { useCartKeyboardNav } from './hooks/useCartKeyboardNav';
import { useCartResize } from './hooks/useCartResize';
import PaymentModal from './PaymentModal';
import PriceOverrideModal from './PriceOverrideModal';
import PromotionsModal from './PromotionsModal';
import ItemModifierModal from './components/ItemModifierModal';
import type { Promotion } from '@/api/promotions';
import FastPINOverlay from '@/components/FastPINOverlay';
import { notifyMemoryPressure } from '@/api/system';

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
// SettingsSubScreen removed in Phase 6 (ADR #22) — superseded by the
// WorkspaceSettingsModal that AppShell opens globally on F10 (AppShell.tsx),
// which derives its card from the active workspace. This screen deliberately
// does not host its own copy: a local instance would have to hardcode the
// workspace type and would shadow the global shortcut.

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
    updateLineModifiers,
    updateLineNote,
    fireCourse,
    fireAllCourses,
    assignCourse,
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
  const { products } = useProducts(sessionToken || undefined);
  const { isEnabled } = useFeatures();
  const userId = session?.user_id ?? '';

  const handleOpenSettings = useCallback(() => {
    if (onNavigate) {
      onNavigate('settings');
    } else {
      setActiveWorkspace('admin');
    }
  }, [onNavigate, setActiveWorkspace]);

  // ── Restore locked cart or active draft on mount ────────────────
  const LOCKED_CART_KEY = 'pos-locked-cart';
  const ACTIVE_DRAFT_KEY = 'pos-active-draft';
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
      const raw = localStorage.getItem(LOCKED_CART_KEY) ?? localStorage.getItem(ACTIVE_DRAFT_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.lines && Array.isArray(data.lines)) {
        setLines(data.lines.map((l: {
          sku: string;
          name?: string;
          category?: string;
          qty: number;
          unit_price: { minor_units: number; currency: string };
          courseId?: CartLine['courseId'];
          coursingStatus?: CartLine['coursingStatus'];
          modifiers?: CartLine['modifiers'];
          note?: string;
        }) => ({
          id: `restored-${Date.now()}-${Math.random().toString(36).slice(2)}` as LineId,
          sku: l.sku as Sku,
          name: l.name,
          category: l.category,
          qty: l.qty,
          unit_price: l.unit_price,
          ...(l.courseId ? { courseId: l.courseId } : {}),
          ...(l.coursingStatus ? { coursingStatus: l.coursingStatus } : {}),
          ...(l.modifiers && l.modifiers.length > 0 ? { modifiers: l.modifiers } : {}),
          ...(l.note ? { note: l.note } : {}),
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
      if (typeof data.tableNumber === 'string') {
        setTableNumber(data.tableNumber);
      }
      if (typeof data.customerName === 'string') {
        setCustomerName(data.customerName);
      }
      if (typeof data.guestCount === 'string') {
        setGuestCount(data.guestCount);
      }
      localStorage.removeItem(LOCKED_CART_KEY);
    } catch { /* ignore */ }
  }, [setLines, setDiscount, setAppliedPromotions, setTipPercent, setServiceCharge]);

  const [showOptions, setShowOptions] = useState(false);
  const [showTables, setShowTables] = useState(false);
  const [showSalesHistory, setShowSalesHistory] = useState(false);
  const [showStockInquiry, setShowStockInquiry] = useState(false);
  const [showReceiptsSettings, setShowReceiptsSettings] = useState(false);
  const [showPaymentsSettings, setShowPaymentsSettings] = useState(false);
  const [showRestaurantSettings, setShowRestaurantSettings] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showDiscountInput, setShowDiscountInput] = useState(false);
  const [showPromotions, setShowPromotions] = useState(false);
  const [discountInput, setDiscountInput] = useState('');
  const [discountName, setDiscountName] = useState('');
  const [tableNumber, setTableNumber] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [guestCount, setGuestCount] = useState('');
  const [editingCartLine, setEditingCartLine] = useState<CartLine | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showTableNumberSetting, setShowTableNumberSetting] = useState(false);

  // ── Auto-persist active draft cart (crash & low-memory recovery) ─
  useEffect(() => {
    if (lines.length > 0) {
      try {
        const draft = {
          lines: lines.map((l) => ({
            sku: l.sku,
            name: l.name,
            category: l.category,
            qty: l.qty,
            unit_price: l.unit_price,
            ...(l.courseId ? { courseId: l.courseId } : {}),
            ...(l.coursingStatus ? { coursingStatus: l.coursingStatus } : {}),
            ...(l.modifiers && l.modifiers.length > 0 ? { modifiers: l.modifiers } : {}),
            ...(l.note ? { note: l.note } : {}),
          })),
          discountPercent,
          discountLabel,
          appliedPromotions,
          tipPercent,
          serviceChargeEnabled,
          serviceChargePercent,
          tableNumber,
          customerName,
          guestCount,
        };
        localStorage.setItem(ACTIVE_DRAFT_KEY, JSON.stringify(draft));
      } catch {
        // Storage quota or transient browser fault
      }
    } else {
      localStorage.removeItem(ACTIVE_DRAFT_KEY);
    }
  }, [lines, discountPercent, discountLabel, appliedPromotions, tipPercent, serviceChargeEnabled, serviceChargePercent, tableNumber, customerName, guestCount]);

  // ── Listen for Android OS memory trim callbacks (Phase 2 audit) ─
  useEffect(() => {
    const handleMemoryTrim = (e: Event) => {
      const level = (e as CustomEvent<{ level?: number }>).detail?.level ?? 80;
      void notifyMemoryPressure(level).catch(() => {});
      if (lines.length > 0) {
        try {
          const draft = {
            lines: lines.map((l) => ({
              sku: l.sku,
              name: l.name,
              category: l.category,
              qty: l.qty,
              unit_price: l.unit_price,
              ...(l.courseId ? { courseId: l.courseId } : {}),
              ...(l.coursingStatus ? { coursingStatus: l.coursingStatus } : {}),
              ...(l.modifiers && l.modifiers.length > 0 ? { modifiers: l.modifiers } : {}),
              ...(l.note ? { note: l.note } : {}),
            })),
            discountPercent,
            discountLabel,
            appliedPromotions,
            tipPercent,
            serviceChargeEnabled,
            serviceChargePercent,
            tableNumber,
            customerName,
            guestCount,
          };
          localStorage.setItem(ACTIVE_DRAFT_KEY, JSON.stringify(draft));
        } catch { /* ignore */ }
      }
    };
    window.addEventListener('kasirmu:trimMemory', handleMemoryTrim);
    window.addEventListener('kasirmu:lowMemory', handleMemoryTrim);
    return () => {
      window.removeEventListener('kasirmu:trimMemory', handleMemoryTrim);
      window.removeEventListener('kasirmu:lowMemory', handleMemoryTrim);
    };
  }, [lines, discountPercent, discountLabel, appliedPromotions, tipPercent, serviceChargeEnabled, serviceChargePercent, tableNumber, customerName, guestCount]);
  // Restaurant coursing: `restaurant.course_firing` gates the firing bar +
  // per-line course chip. Defaults to the workspace check alone until the
  // setting loads, so a slow settings read never hides coursing that the
  // workspace implies; an explicit "false" hides it.
  const [courseFiringEnabled, setCourseFiringEnabled] = useState<boolean | null>(null);
  const [orderTypePromptEnabled, setOrderTypePromptEnabled] = useState(false);
  const [orderType, setOrderType] = useState<'dine_in' | 'takeaway' | 'delivery'>('dine_in');
  const [restaurantSidebarOpen, setRestaurantSidebarOpen] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const { goToWorkspacePicker } = useWorkspaceNav();
  const { orientation } = useOrientation();
  const [cartSheetOpen, setCartSheetOpen] = useState(false);
  const isPortraitRestaurant = activeWorkspace === 'restaurant-pos' && !orientation.isLandscape;

  // ── Sidebar header identity ────────────────────────────
  // The avatar hash is read through `get_own_avatar_scoped`, not the staff
  // profile: the profile read requires `staff:read`, which a cashier does not
  // hold, and it fails closed on an undecryptable sensitive column that has
  // nothing to do with a photo. Refetched after an upload so the header
  // updates without a re-login.
  const [avatarHash, setAvatarHash] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  useEffect(() => {
    if (!sessionToken) {
      setAvatarHash(null);
      return;
    }
    let cancelled = false;
    void getOwnAvatarScoped(sessionToken)
      .then((hash) => { if (!cancelled) setAvatarHash(hash); })
      .catch(() => { /* offline or unsupported — keep the initials fallback */ });
    return () => { cancelled = true; };
  }, [sessionToken]);

  const handleChangePhoto = useCallback(async () => {
    if (!sessionToken || !session?.user_id || avatarBusy) return;
    if (!isTauriWebview()) {
      // The browser dev preview has no dialog plugin, so `pickImageFile`
      // returns null there — indistinguishable from a cancel. Say so rather
      // than failing mute. A key-presence test would answer "Tauri" here:
      // `index.html` installs a partial `__TAURI_INTERNALS__` stub without
      // `invoke`, and the dialog plugin would then reject on a path with no
      // toast. Note this is NOT a desktop-only restriction any more: both
      // shells can change a photo, this guard is about the browser.
      addToast({ message: requiredLocalized(l10n, 'image-pick-app-only'), type: 'info' });
      return;
    }
    try {
      const picked = await pickImageFile();
      if (!picked) return; // the user cancelled — not an error
      setAvatarBusy(true);
      try {
        const hash = await setAvatarScoped(sessionToken, session.user_id, picked.path);
        setAvatarHash(hash);
      } finally {
        // Drops the bridged temp copy; a no-op on desktop, where `path` is the
        // user's own file.
        picked.release();
      }
    } catch {
      addToast({ message: requiredLocalized(l10n, 'retail-edit-image-error'), type: 'error' });
    } finally {
      setAvatarBusy(false);
    }
  }, [sessionToken, session?.user_id, avatarBusy, addToast, l10n]);

  const restaurantProfile = useMemo<RestaurantSidebarProfile | undefined>(() => {
    if (!session) return undefined;
    return {
      displayName: session.display_name,
      roleName: session.role_name,
      avatarHash,
    };
  }, [session, avatarHash]);

  // ── Cart panel resize ──────────────────────────────────
  // Width state, the isResizing latch, both window listeners and the drag
  // handle live in hooks/useCartResize. posScreenRef comes back from it because
  // the drag maths is that ref's only reader - the shell still binds it to the
  // root div below, and cartPanelRef stays here as a pure CartPanel prop.
  const { cartWidth, startResize, posScreenRef } = useCartResize();
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

  const [storeCurrency, setStoreCurrency] = useState<string>('IDR');
  const currencyCtx = useOptionalCurrency();

  useEffect(() => {
    if (currencyCtx?.currency) {
      setStoreCurrency(currencyCtx.currency);
      return;
    }
    if (!sessionToken) return;
    let cancelled = false;
    getStoreSettingsScoped(sessionToken)
      .then((settings) => {
        if (!cancelled && settings.currency) {
          setStoreCurrency(settings.currency);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [sessionToken, currencyCtx?.currency]);

  const activeCurrency = currencyCtx?.currency ?? storeCurrency ?? subtotal?.currency ?? 'IDR';

  const {
    activeShift,
    activeShiftRef,
    shiftUnavailable,
    shiftUnavailableRef,
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
  } = usePosShifts({ sessionToken, userId, lines, l10nRef, currency: activeCurrency });
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
    shiftUnavailableRef,
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
  // Disabled on restaurant POS workspace (scanners are for retail checkout).
  useBarcodeScanner({
    enabled: activeWorkspace !== 'restaurant-pos',
    sessionToken,
    onProductFound: useCallback(async (payload: BarcodeScannedPayload) => {
      if (!activeShiftRef.current && !shiftUnavailableRef.current) {
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
    }, [handleAddProduct, addToast, sessionToken, activeShiftRef, shiftUnavailableRef, l10nRef]), // l10n via ref
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
    // Same rule as the cart guard: an unreachable shift service must not
    // block payment, because shifts are informational.
    if (!activeShiftRef.current && !shiftUnavailableRef.current) {
      addToast({ message: 'Open a shift first', type: 'warning' });
      return;
    }
    if (!total) return;
    setCartSheetOpen(false);
    setShowPayment(true);
  }, [total, addToast, activeShiftRef, shiftUnavailableRef]);

  // P7-1: Swipe left on cart panel → open payment modal (tablet flow)
  const cartSwipe = useSwipe({
    onSwipeLeft: () => {
      if (total && (activeShiftRef.current || shiftUnavailableRef.current)) {
        setCartSheetOpen(false);
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
    tableNumber,
    setTableNumber,
    customerName,
    setCustomerName,
    orderType,
    setOrderType,
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
  // Seeded through the factory, passed as React's lazy initializer so this
  // mount builds its OWN idle object (one per mount, none per re-render).
  // The module-level IDLE_TAX_STATE would be the same reference here as in
  // RetailPosScreen, so one non-copying updater would corrupt both screens.
  const [taxState, setTaxState] = useState<CartTaxCacheState>(createIdleTaxState);
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
    try {
      localStorage.removeItem(ACTIVE_DRAFT_KEY);
    } catch { /* ignore */ }
    setTableNumber('');
    setCustomerName('');
    setGuestCount('');
    // Also clear the customer-facing pole display.
    customerDisplayPaymentComplete();
  }, [resetCart, setTableNumber, setCustomerName, setGuestCount, customerDisplayPaymentComplete, activeOpenBillId, loadOpenBills, addToast, sessionToken, deductionLocationIdRef, setActiveOpenBillId, setCartId, setDeductionLocationName, setDeductionOverridden]);

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
            ...(l.courseId ? { courseId: l.courseId } : {}),
            ...(l.coursingStatus ? { coursingStatus: l.coursingStatus } : {}),
            ...(l.modifiers && l.modifiers.length > 0 ? { modifiers: l.modifiers } : {}),
            ...(l.note ? { note: l.note } : {}),
          })),
          discountPercent,
          discountLabel,
          appliedPromotions,
          tipPercent,
          serviceChargeEnabled,
          serviceChargePercent,
          tableNumber,
          customerName,
          guestCount,
        };
        localStorage.setItem(LOCKED_CART_KEY, JSON.stringify(data));
      } else {
        localStorage.removeItem(LOCKED_CART_KEY);
      }
    } catch { /* storage quota or unavailable — ignore */ }
    logout();
  }, [lines, discountPercent, discountLabel, appliedPromotions, tipPercent, serviceChargeEnabled, serviceChargePercent, tableNumber, customerName, guestCount, logout]);

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
  const receiptSettingsSeq = useRef(0);
  useEffect(() => {
    if (!sessionToken) return;
    const seq = ++receiptSettingsSeq.current;
    const stale = () => receiptSettingsSeq.current !== seq;
    getReceiptSettingsScoped(sessionToken)
      .then((s) => {
        if (stale()) return;
        setShowTableNumberSetting(s.showTableNumber);
      })
      .catch((err: unknown) => {
        if (stale()) return;
        const kind = (err as { kind?: string } | null)?.kind;
        if (kind === 'invalidSession') return;
        addToast({ message: requiredLocalized(l10nRef.current, 'pos-toast-receipt-settings-failed'), type: 'error' });
      });
    return () => { receiptSettingsSeq.current += 1; };
  }, [addToast, sessionToken]); // l10n via ref — stable dep chain

  // ── Load restaurant course-firing flag on mount ─────────────────
  // Best-effort display gate only: a failed read leaves the workspace
  // check as the gate (null), so coursing never disappears on a
  // settings-fetch failure.
  //
  // Guarded, like CurrencyContext, SettingsContext, BrandContext and ShiftBar
  // before it (the whole class is written up in SettingsContext:207). This one
  // is not cosmetic: CartPanel gates the course controls on
  // `courseFiringEnabled !== false` (:631, :669), so a stale read carrying the
  // PREVIOUS store's setting forward would hide course firing on a store that has
  // it enabled -- a POS capability disappearing across a store switch.
  const courseFiringSeq = useRef(0);
  useEffect(() => {
    const seq = ++courseFiringSeq.current;
    const stale = () => courseFiringSeq.current !== seq;
    getSettingScoped(sessionToken || null, 'restaurant.course_firing')
      .then((raw) => {
        if (stale()) return;
        setCourseFiringEnabled(raw === 'true');
      })
      .catch(() => {
        if (stale()) return;
        setCourseFiringEnabled(null);
      });
    return () => { courseFiringSeq.current += 1; };
  }, [sessionToken]);

  const orderTypePromptSeq = useRef(0);
  useEffect(() => {
    const seq = ++orderTypePromptSeq.current;
    const stale = () => orderTypePromptSeq.current !== seq;
    getSettingScoped(sessionToken || null, 'restaurant.order_type_prompt')
      .then((raw) => {
        if (stale()) return;
        setOrderTypePromptEnabled(raw === 'true');
      })
      .catch(() => {
        if (stale()) return;
        setOrderTypePromptEnabled(false);
      });
    return () => { orderTypePromptSeq.current += 1; };
  }, [sessionToken]);

  const handleRequestExit = useCallback(() => {
    if (activeShift !== null) {
      handleCloseShiftClick();
    } else {
      setShowExitConfirm(true);
    }
  }, [activeShift, handleCloseShiftClick]);

  const handleOpenCashDrawer = useCallback(async () => {
    if (!sessionToken) {
      addToast({ message: 'Authentication required to open cash drawer', type: 'error' });
      return;
    }
    try {
      const res = await openCashDrawerScoped(sessionToken);
      if (res && res.opened !== false) {
        addToast({ message: 'Cash drawer opened', type: 'success' });
      } else {
        addToast({ message: 'Cash drawer did not open: device returned unconfirmed', type: 'warning' });
      }
    } catch (err) {
      addToast({
        message: `Cash drawer kick failed: ${err instanceof Error ? err.message : String(err)}`,
        type: 'error',
      });
    }
  }, [sessionToken, addToast]);

  const handleEditModifiers = useCallback(
    async (line: CartLine) => {
      let prod = products.find((p) => p.sku === line.sku);
      if (!prod && sessionToken) {
        try {
          const dto = await lookupProductBySkuScoped(sessionToken, line.sku);
          if (dto) {
            prod = {
              sku: dto.sku as Sku,
              name: dto.name,
              category: dto.category ?? 'Uncategorized',
              price: { minor_units: dto.price.minor_units, currency: dto.price.currency },
              barcode: dto.barcode,
              inStock: dto.in_stock,
              stockQty: dto.stock_qty,
              productType: dto.product_type as Product['productType'],
              notes: dto.notes ?? null,
            };
          }
        } catch { /* ignore */ }
      }
      if (!prod) {
        addToast({ message: 'Product details not found', type: 'error' });
        return;
      }
      const groups = getProductModifierGroups(prod);
      if (groups.length === 0) {
        addToast({ message: 'No modifiers configured for this item', type: 'info' });
        return;
      }
      setEditingCartLine(line);
      setEditingProduct(prod);
    },
    [products, sessionToken, addToast],
  );

  const handleConfirmEditModifiers = useCallback(
    (selections: ModifierSelection[], totalPriceMinor: number) => {
      if (!editingCartLine || !editingProduct) return;
      updateLineModifiers(
        editingCartLine.id,
        selections,
        { minor_units: totalPriceMinor, currency: editingCartLine.unit_price.currency },
      );
      setEditingCartLine(null);
      setEditingProduct(null);
    },
    [editingCartLine, editingProduct, updateLineModifiers],
  );

  const handleSelectTableFromManagement = useCallback(
    (tableName: string) => {
      setTableNumber(tableName);
      setShowTables(false);
      // Find active tab matching this table to resume order if exists
      const matchingBill = openBills.find(
        (b) =>
          b.label.toLowerCase().includes(`table ${tableName.toLowerCase()}`) ||
          (b.customer_name && b.customer_name.toLowerCase().includes(`table ${tableName.toLowerCase()}`)),
      );
      if (matchingBill) {
        void handleResumeOpenBill(matchingBill.id);
      }
      if (sessionToken) {
        void listTablesScoped(sessionToken)
          .then((tables) => {
            const match = tables.find(
              (t) => t.name === tableName || t.id === tableName,
            );
            if (match && match.status !== 'occupied') {
              return updateTableStatusScoped(sessionToken, match.id, 'occupied');
            }
          })
          .catch(() => {});
      }
    },
    [openBills, handleResumeOpenBill, sessionToken],
  );

  // ── Sub-screen: Table Management ─────────────────────────────
  if (showTables) {
    return (
      <div className="pos-screen">
        <div style={{ flex: 1, overflow: 'auto' }}>
          <TableManagementScreen
            onSelectTable={handleSelectTableFromManagement}
            onBack={() => setShowTables(false)}
          />
        </div>
      </div>
    );
  }

  // ── Sub-screen: Sales History (F6) ───────────────────────────
  if (showSalesHistory) {
    return (
      <div className="pos-screen" style={{ flexDirection: 'column' }}>
        <header className="restaurant-subscreen-top-bar">
          <button
            type="button"
            className="restaurant-subscreen-back-btn"
            onClick={() => setShowSalesHistory(false)}
            aria-label={l10n.getString('back') || 'Back'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            <span>{l10n.getString('back') || 'Back'}</span>
          </button>
          <span className="restaurant-subscreen-top-title">{l10n.getString('sales-history-title') || 'Sales History'}</span>
        </header>
        <div style={{ flex: 1, overflow: 'auto' }}>
          <SalesHistoryScreen />
        </div>
      </div>
    );
  }

  // ── Sub-screen: Stock Inquiry (F8) ───────────────────────────
  if (showStockInquiry) {
    return (
      <div className="pos-screen" style={{ flexDirection: 'column' }}>
        <header className="restaurant-subscreen-top-bar">
          <button
            type="button"
            className="restaurant-subscreen-back-btn"
            onClick={() => setShowStockInquiry(false)}
            aria-label={l10n.getString('back') || 'Back'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            <span>{l10n.getString('back') || 'Back'}</span>
          </button>
          <h2 className="restaurant-subscreen-top-title">{l10n.getString('nav-inventory') || 'Stock Inquiry'}</h2>
        </header>
        <div style={{ flex: 1, overflow: 'auto' }}>
          <ProductLookupScreen onAddProduct={handleAddProduct} />
        </div>
      </div>
    );
  }

  // ── Sub-screen: Restaurant Receipts Settings ─────────────────
  if (showReceiptsSettings) {
    return (
      <div className="pos-screen">
        <div style={{ flex: 1, overflow: 'auto' }}>
          <RestaurantReceiptsScreen
            onBack={() => setShowReceiptsSettings(false)}
            tablesEnabled={isEnabled(FEATURES.TABLE_MANAGEMENT)}
          />
        </div>
      </div>
    );
  }

  // ── Sub-screen: Restaurant Payments Settings ─────────────────
  if (showPaymentsSettings) {
    return (
      <div className="pos-screen">
        <div style={{ flex: 1, overflow: 'auto' }}>
          <RestaurantPaymentsScreen onBack={() => setShowPaymentsSettings(false)} />
        </div>
      </div>
    );
  }

  // ── Sub-screen: Restaurant General Settings ──────────────────
  if (showRestaurantSettings) {
    return (
      <div className="pos-screen">
        <div style={{ flex: 1, overflow: 'auto' }}>
          <RestaurantSettingsScreen onBack={() => setShowRestaurantSettings(false)} />
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

  // ── CartPanel call-site groups ───────────────────────────────
  // CartPanelProps is a SHARED 77-field contract - features/retail imports it and
  // RetailCartPanel.test.tsx asserts it - so the TYPE DOES NOT CHANGE and CartPanel
  // still receives the same 77 individual props. Only this call site is regrouped: the
  // objects below are local to PosScreen, live for one render, and are never handed to
  // a component as a prop. cartPanelProps carries the CartPanelProps annotation, so a
  // dropped, renamed or misspelled field is a typecheck error here instead of a silent
  // undefined at render, and a future 78th required prop breaks this screen rather than
  // going unnoticed. Pure construction: no value, handler or prop name changed.
  const panelChrome = {
    startResize, cartPanelRef, cartWidth, handleCartPanelKeyDown, cartSwipe, activeWorkspace,
  };
  const shiftRow = {
    shiftLoading, activeShift, shiftUnavailable, shiftNow, handleCloseShiftClick, handleOpenShiftClick,
    shiftErrorExit, closeShiftError,
  };
  const deductionBinding = {
    deductionLocationName, handleDeductionBadgeClick, deductionOverridden,
    deductionLocationIdRef, setDeductionLocationName, setDeductionOverridden,
  };
  const hubNav = {
    isEnabled, setShowTables, setShowSalesHistory, setShowStockInquiry,
    onNavigate, handleOpenSettings, handleLock, onOpenCashDrawer: handleOpenCashDrawer,
  };
  const tableNumberRow = {
    showTableNumberSetting,
    tableNumber,
    setTableNumber,
    customerName,
    setCustomerName,
    guestCount,
    setGuestCount,
    orderType,
    setOrderType,
    orderTypePromptEnabled,
  };
  const cartLineRows = {
    lines, fireCourse, fireAllCourses, assignCourse, setCartLineRef,
    handleRemoveLine, handleDecreaseQty, handleIncreaseQty,
    updateLineNote,
    onEditModifiers: handleEditModifiers,
    isManager, setOverrideTarget, ensureCart,
    animatedUndoStack, handleUndoRemove, handleDismissUndo,
    courseFiringEnabled,
  };
  const discountEditor = {
    discountPercent, discountLabel, discountAmount, showOptions, setShowOptions,
    showDiscountInput, setShowDiscountInput, setShowPromotions,
    appliedPromotions, setAppliedPromotions, discountInput, setDiscountInput,
    discountName, setDiscountName, handleApplyDiscount, handleClearDiscount,
  };
  const totalsRow = {
    subtotal, tipPercent, setTipPercent, tipAmount,
    serviceChargeEnabled, serviceChargePercent, serviceChargeAmount, setServiceCharge,
    cartTax, taxEstimated, taxState, retryTaxEstimate,
  };
  const checkoutRow = {
    handlePay, addToast, setShowOpenBillInput, setCartId, resetCart,
    setShowOpenBills, openBills,
    activeOpenBillId, setActiveOpenBillId, handleOpenBill,
  };
  const cartPanelProps: CartPanelProps = {
    ...panelChrome, ...shiftRow, ...deductionBinding, ...hubNav, ...tableNumberRow,
    ...cartLineRows, ...discountEditor, ...totalsRow, ...checkoutRow,
  };
  // The cart header's buttons, handed to the restaurant sidebar popover instead
  // (CartPanel renders no action cluster, no shift buttons and no deduction
  // badge in that workspace). Same handlers, one extra home for them — the
  // header's old lock button is NOT here, because the popover's "Lock Terminal"
  // row replaced it: that one locks the session instead of logging the cashier
  // out. Field names are `on*` because the popover owns no state.
  const restaurantCartActions: RestaurantSidebarActions = {
    shiftLoading,
    hasActiveShift: activeShift !== null,
    onOpenShift: handleOpenShiftClick,
    onCloseShift: handleCloseShiftClick,
    deductionLocationName,
    deductionOverridden,
    onOverrideDeduction: handleDeductionBadgeClick,
    showTables: isEnabled(FEATURES.TABLE_MANAGEMENT),
    onOpenTables: () => setShowTables(true),
    onOpenHistory: () => setShowSalesHistory(true),
    onOpenKitchenDisplay: () => onNavigate?.('kds'),
    onOpenReceipts: () => setShowReceiptsSettings(true),
    onOpenPayments: () => setShowPaymentsSettings(true),
    onOpenSettings: () => setShowRestaurantSettings(true),
    onOpenCashDrawer: handleOpenCashDrawer,
    onRequestExit: handleRequestExit,
  };

  return (
    <>
    <div
      className="pos-screen"
      ref={posScreenRef}
      onContextMenu={(e) => {
        const target = e.target as HTMLElement | null;
        if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) {
          return;
        }
        e.preventDefault();
      }}
    >
      {/* ── Left: Product lookup ─────────────────── */}
      <div className="pos-products">
        {activeWorkspace === 'restaurant-pos' ? (
          <RestaurantMenu
            onAddProduct={handleAddProduct}
            sidebarOpen={restaurantSidebarOpen}
            onSidebarOpenChange={setRestaurantSidebarOpen}
            cartActions={restaurantCartActions}
            profile={restaurantProfile}
            onChangePhoto={() => { void handleChangePhoto(); }}
            onRequestExit={handleRequestExit}
            isManager={isManager}
            hasFloatingCartBar={isPortraitRestaurant}
          />
        ) : (
          <ProductLookupScreen onAddProduct={handleAddProduct} />
        )}
      </div>

      {/* ── Resize handle & Cart panel (landscape / desktop) ── */}
      {!isPortraitRestaurant && (
        <CartPanel
          {...cartPanelProps}
          hidden={activeWorkspace === 'restaurant-pos' && restaurantSidebarOpen}
        />
      )}

      {/* ── Restaurant Portrait: Floating Cart Bar & Bottom Sheet Drawer ── */}
      {isPortraitRestaurant && (
        <>
          <RestaurantFloatingCartBar
            lines={lines}
            total={total}
            tableNumber={tableNumber}
            onOpenCart={() => setCartSheetOpen(true)}
          />
          <RestaurantCartSheet
            open={cartSheetOpen}
            onClose={() => setCartSheetOpen(false)}
            tableNumber={tableNumber}
          >
            <CartPanel
              {...cartPanelProps}
              hidden={false}
            />
          </RestaurantCartSheet>
        </>
      )}

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
          orderType={orderType}
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

      {/* -- Open Bill Input modal / Open Bills panel (components/OpenBillModals) -- */}
      <OpenBillInput
        openBillInputExit={openBillInputExit}
        openBillName={openBillName}
        setOpenBillName={setOpenBillName}
        openingBill={openingBill}
        handleOpenBill={handleOpenBill}
      />

      <OpenBillsPanel
        openBillsExit={openBillsExit}
        openBills={openBills}
        handleResumeOpenBill={handleResumeOpenBill}
      />

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
        currency={activeCurrency}
      />

      <ShiftSummary
        shiftSummaryExit={shiftSummaryExit}
        closedShiftSummary={closedShiftSummary}
        currency={activeCurrency}
      />

      <OpenShiftModal
        openShiftExit={openShiftExit}
        openingBalance={openingBalance}
        setOpeningBalance={setOpeningBalance}
        openingShift={openingShift}
        handleConfirmOpenShift={handleConfirmOpenShift}
        currency={activeCurrency}
      />

      {/* ── FastPIN Overlay (ADR-19 §17: badge click → manager override) ── */}
      <FastPINOverlay
        open={showFastPINOverlay}
        onClose={() => setShowFastPINOverlay(false)}
        onVerified={handleDeductionPinVerified}
      />

      {/* ── Restaurant POS Exit Confirmation ────────────────────────── */}
      <ConfirmDialog
        open={showExitConfirm}
        onCancel={() => setShowExitConfirm(false)}
        onConfirm={() => {
          setShowExitConfirm(false);
          goToWorkspacePicker();
        }}
        title={l10n.getString('restaurant-exit-confirm-title')}
        message={l10n.getString('restaurant-exit-confirm-desc')}
        variant="warning"
        confirmLabel={l10n.getString('restaurant-exit-confirm-btn')}
      />

      {/* ── Item Modifier Modal (in-cart customization editing) ────── */}
      {editingCartLine && editingProduct && (
        <ItemModifierModal
          open={true}
          productName={editingProduct.name}
          basePriceMinor={editingProduct.price.minor_units}
          currency={editingCartLine.unit_price.currency}
          groups={getProductModifierGroups(editingProduct)}
          initialSelections={editingCartLine.modifiers}
          onConfirm={handleConfirmEditModifiers}
          onClose={() => {
            setEditingCartLine(null);
            setEditingProduct(null);
          }}
        />
      )}
    </div>
  </>
  );
}

