import { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { useToast } from '@/components/Toast';
import { useInvalidSession } from '@/hooks/useInvalidSession';
import { useWorkspaceNav } from '@/hooks/useWorkspaceNav';
import { useSound } from '@/components/useSound';
import { requiredLocalized } from '@/components';
import { useAuth } from '@/contexts/AuthContext';
import { Localized } from '@/components/Localized';
import { useLocalization } from '@fluent/react';
import { l10nErrorMessage } from '@/utils/app-error';
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
import { LocalizedErrorBoundary } from '@/components/LocalizedErrorBoundary';
import RestaurantMenuEditorScreen from '@/features/restaurant/screens/RestaurantMenuEditorScreen';
import RestaurantReceiptsScreen from '@/features/restaurant/screens/RestaurantReceiptsScreen';
import RestaurantPaymentsScreen from '@/features/restaurant/screens/RestaurantPaymentsScreen';
import RestaurantSettingsScreen from '@/features/restaurant/screens/RestaurantSettingsScreen';
import { RestaurantFloatingCartBar } from '@/features/restaurant/components/RestaurantFloatingCartBar';
import { RestaurantCartSheet } from '@/features/restaurant/components/RestaurantCartSheet';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useOrientation } from '@/hooks/useOrientation';

import { defaultTenderPresets, formatMoney, getProductModifierGroups, inferCourseForProduct, type CartLine, type CourseId, type LineId, type ModifierSelection, type Product, type Sku } from '@/types/domain';
import { useSwipe } from '@/hooks/useSwipe';
import {
  deleteHeldCartScoped,
  getCartDeductionLocation,
  getCartDeductionLocationScoped,
  holdCartScoped,
  listOpenBillsScoped,
  printSalesReceipt,
} from '@/api/sales';
import { getReceiptSettingsScoped, getSettingScoped, getStoreSettingsScoped } from '@/api/settings';
import { useOptionalCurrency } from '@/contexts/CurrencyContext';
import type { CartTaxCacheState } from '@/hooks/useCartTax';
import type { CartLineTaxInput } from '@/api/tax';
import { lookupByBarcodeScoped, lookupProductBySkuScoped } from '@/api/products';
import { lookupBundleBySku } from '@/api/bundles';
import { listTablesScoped, updateTableStatusScoped, releaseTableScoped } from '@/api/tables';
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
import { scopedKey } from '@/utils/scopedStorage';
import { reviveDraftLines } from './utils/draftCart';
import { isEditableTarget } from '@/utils/isEditableTarget';
import { isAnyAriaModalOpen } from '@/utils/modal-guard';
import { useRestaurantShortcuts, type RestaurantShortcutHandlers } from '@/features/restaurant/hooks/useRestaurantShortcuts';
import { useCartResize } from './hooks/useCartResize';
import { cashTenderPresets, useLocalPaymentRails } from './useLocalPaymentRails';
import PaymentModal from './PaymentModal';
import PriceOverrideModal from './PriceOverrideModal';
import PromotionsModal from './PromotionsModal';
import ItemModifierModal from './components/ItemModifierModal';
import { matchesTableBill, bareTableNumber, heldCartLabel } from './utils/tableLabel';
import { buildPreCheckoutBillReceipt, buildKitchenChitReceipt, isBeverageItem } from './payment/completedSale';
import type { Promotion } from '@/api/promotions';
import FastPINOverlay from '@/components/FastPINOverlay';
import { notifyMemoryPressure } from '@/api/system';
import { isTabletShell } from '@/utils/shellKind';
import { getPage, isPageAccessible } from '@/registries/page-registry';

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
    changeQty,
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
  // A session that expires MID-SHIFT. AppShell's banner covers a REJECTED
  const { addToast } = useToast();
  const { l10n } = useLocalization();
  const l10nRef = useRef(l10n);
  l10nRef.current = l10n;
  const { session, logout, isManager, hasPermission } = useAuth();
  const { activeWorkspace, setActiveWorkspace, sessionToken: rawToken, resolvedStoreId } =
    useWorkspace();
  const sessionToken = rawToken || '';
  const { products, reload: reloadPosProducts } = useProducts(sessionToken || undefined);
  const [menuRevision, setMenuRevision] = useState(0);
  const { isEnabled } = useFeatures();
  // F21: the shared chime hook. Not KDS-specific — a plain Web Audio tone, and the
  // retail POS already uses it for the same order-complete confirmation.
  const { playSuccess } = useSound();
  // F21: `null` = never written -> the setting's own default (chime). Declared here,
  // not with the other restaurant flags below, because `handlePaymentComplete` reads
  // it and is defined before them.
  const [soundChime, setSoundChime] = useState<boolean | null>(null);
  const userId = session?.user_id ?? '';

  const handleOpenSettings = useCallback(() => {
    if (onNavigate) {
      onNavigate('settings');
    } else {
      setActiveWorkspace('admin');
    }
  }, [onNavigate, setActiveWorkspace]);

  // ── Restore locked cart or active draft on mount ────────────────
  // Declared HERE, above the persistence effects that read it. The active-draft
  // save, the memory-trim save, the lock save and the restore all carry `orderType`,
  // and every one of them is hoisted above the later state block — so the
  // declaration has to come first or the reads land in its temporal dead zone.
  const [orderType, setOrderType] = useState<'dine_in' | 'takeaway' | 'delivery'>('dine_in');
  // ⚠️ STORE-SCOPED. These were plain constants (`pos-locked-cart`, `pos-active-draft`),
  // and the payload they carry is entirely store-specific: the lines, `tableNumber`,
  // `customerName`, `guestCount` and `orderType`. A store switch remounts the POS —
  // `WorkspaceContext.tsx` `switchStore` sets `setActiveWorkspace(null)` (WorkspaceContext.tsx:363) — and the mount
  // effect below restores whatever this key holds, so the operator who rang up a cart at
  // one store and moved to another was shown the FIRST store's cart and table number.
  //
  // The store id goes in the KEY rather than in the payload because the restore has to
  // reject a foreign draft before parsing it; a field would still have to be validated, and
  // a key cannot be forgotten. `resolvedStoreId` is '' before the store resolves, which
  // yields a distinct key rather than a collision with a real store.
  // Both keys go through `scopedKey` (round 168's helper) rather than repeating the
  // `:${resolvedStoreId || 'unresolved'}` literal. The sentinel's justification lives in
  // that module now, next to the builder that has to get it right for every caller — a
  // second copy here would be a second thing to keep true, which is the drift the helper
  // exists to prevent.
  const LOCKED_CART_KEY = useMemo(
    () => scopedKey('pos-locked-cart', resolvedStoreId),
    [resolvedStoreId],
  );
  const ACTIVE_DRAFT_KEY = useMemo(
    () => scopedKey('pos-active-draft', resolvedStoreId),
    [resolvedStoreId],
  );
  // ── Retire the cart keys of the scope we just LEFT ──────────────────
  //
  // Scoping the keys by store (rounds 104/167/170) closed the cross-store leak and left
  // this one open. `resolvedStoreId` is SEEDED to DEFAULT_STORE_ID and only later replaced
  // by the real device binding (WorkspaceContext.tsx:132/229 -> :536), so the scope CHANGES
  // during a normal boot, not only on a deliberate switch. The autosave effects below write
  // under whichever scope is current, and both the restore and those saves read the value
  // in these two `useMemo`s:
  //
  //   * Before resolution a cart lands under `pos-active-draft:default`.
  //   * After resolution the same cart is re-saved under `pos-active-draft:<real id>`.
  //
  // Two keys then hold one ticket. The stale one is not read on this boot — that is the
  // point of the scoping — but nothing ever removes it either. It stays until the operator
  // happens to boot again inside the unresolved window, which is the very case the scoping
  // exists to prevent, and the PREVIOUS store's cart is then restored ahead of the current
  // one, because the restore prefers the resolved scope's keys over the seeded scope's.
  //
  // The fix treats a scope change as a MIGRATION rather than an abandonment: carry the draft
  // across, then delete the key being left. Carrying it is deliberate. The cart is the
  // cashier's unsaved work and the store it belongs to has not changed — only the knowledge
  // of which store that is has. Deleting without carrying would empty the till mid-order,
  // which is worse than a leak that is closed one boot later.
  const previousScopeRef = useRef<string | null>(null);
  useEffect(() => {
    const previousScope = previousScopeRef.current;
    previousScopeRef.current = resolvedStoreId;
    // First run: nothing to migrate, and the ref now records the scope in use.
    if (previousScope === null || previousScope === resolvedStoreId) return;
    for (const base of ['pos-active-draft', 'pos-locked-cart']) {
      const staleKey = scopedKey(base, previousScope);
      try {
        const carried = localStorage.getItem(staleKey);
        if (carried === null) continue;
        const destination = scopedKey(base, resolvedStoreId);
        if (localStorage.getItem(destination) === null) {
          // Destination is empty: adopt outright. This is the boot-time case, where the
          // scope moved after the cart was written and the migrated value is the same
          // cart under its now-correct name.
          localStorage.setItem(destination, carried);
        } else {
          // Destination ALREADY holds a draft: this is a deliberate switch onto a store
          // the operator used before, not a resolution of the current one. The
          // destination draft is not newer — it is from a different, earlier session —
          // so neither value may simply overwrite the other.
          //
          // Overwriting would destroy the abandoned cart; deleting the outgoing one
          // would destroy the cart the operator is LOOKING AT, which is worse. The POS
          // UNMOUNTS on a switch (`switchStore` clears `activeWorkspace`, and AppShell
          // renders the POS only under its own workspace at AppShell.tsx:745/:778, re-measured
  // 2026-10-19; the old `:722/:755` pair was this file's own line numbers and matched nothing), so the in-memory
          // cart is already gone and this key holds its only copy.
          //
          // So the outgoing draft is PARKED under a dedicated key instead of dropped.
          // It is not auto-restored — resurrecting a stale cart into a live till would
          // be its own hazard — but it survives for recovery, and the destination keeps
          // the draft it had.
          try {
            localStorage.setItem(scopedKey(base + '-parked', resolvedStoreId), carried);
          } catch { /* quota: the outgoing draft is lost, which is the pre-existing state */ }
        }
        localStorage.removeItem(staleKey);
      } catch {
        // Storage unavailable or at quota. The in-memory cart is unaffected, so the
        // operator loses nothing visible; only the stale key survives.
      }
    }
  }, [resolvedStoreId]);
  // PROMO-5/PROMO-3: promotions selected in the picker. They no longer
  // map onto the cart-discount pipeline — the selected ids ride to
  // checkout (PaymentModal → complete_sale promotionIds) and the backend
  // engine applies them against the post-tax sale, so fixed/BXGY work
  // and percentage promotions stack instead of overwriting the manual
  // discount slot. Declared before the restore effect so a lock/unlock
  // cycle can rehydrate the selection.
  // ── The store's currency, resolved BEFORE the draft restore ──────────────
  //
  // This used to be declared far below, next to its first consumer. It moved up
  // because the restore now has to VALIDATE a draft against it: the draft records
  // the currency its minor units were written under, and a minor unit is
  // exponent-relative (IDR/JPY are 0, USD/EUR are 2), so the two are only
  // comparable once the store has answered.
  //
  // `currencyReady` is what makes that ordering explicit, and it is load-bearing:
  // `CurrencyProvider` starts on its `fallback` ('USD') with `loading: true`, so
  // validating against `currencyCtx.currency` too early would compare the draft to
  // the FALLBACK and wave a stale USD draft straight through — the very defect this
  // guards. With no provider mounted (tests, or a shell that omits it) the local
  // state is the authority and is ready immediately.
  const [storeCurrency, setStoreCurrency] = useState<string>('IDR');
  const currencyCtx = useOptionalCurrency();
  const currencyReady = currencyCtx ? !currencyCtx.loading : true;

  useEffect(() => {
    // ⚠️ Adopt the context's currency ONLY once it has finished loading. While
    // `loading` is true the provider is still publishing its `fallback`, which is
    // 'USD' by DEFAULT (CurrencyContext.tsx) and NOT the store's currency. Publishing
    // that here — even for one render — made the restore below validate an IDR draft
    // against USD, and that direction of error is the destructive one: the draft is
    // judged foreign and DELETED, so a correct cart was lost on a store that had
    // simply not answered yet. Measured: the provider's own mount effect sets
    // `loading` false only after the async read settles, so this guard is what keeps
    // the fallback out of `storeCurrency` entirely.
    if (currencyCtx && !currencyCtx.loading) {
      setStoreCurrency(currencyCtx.currency);
      return;
    }
    // Still loading (or no provider): fall back to the store's own settings read.
    // The restore waits for `currencyReady` regardless, so this path only decides
    // what `storeCurrency` holds in the meantime; it must not be the fallback.
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
    // `currencyCtx` itself is the dependency, not the two fields read from it: the
    // effect's guard is on the CONTEXT (`currencyCtx && !currencyCtx.loading`), so a
    // new provider value with the same currency and loading flag is still a new
    // authority. Naming the fields let that go stale.
  }, [sessionToken, currencyCtx]);

  // Set once the restore effect has actually reached its verdict. The persist
  // effect below must not touch storage before then: on the first render `lines` is
  // empty, so its else-branch would delete the draft the restore has not yet read.
  const draftRestoreSettledRef = useRef(false);

  const [appliedPromotions, setAppliedPromotions] = useState<Promotion[]>([]);
  useEffect(() => {
    // Wait for the store currency, then settle exactly once. Must return BEFORE the
    // ref is set, so a still-loading currency leaves the draft intact for the retry
    // this effect performs when `currencyReady` flips.
    if (!currencyReady) return;
    draftRestoreSettledRef.current = true;
    try {
      const raw = localStorage.getItem(LOCKED_CART_KEY) ?? localStorage.getItem(ACTIVE_DRAFT_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.lines && Array.isArray(data.lines)) {
        const revived = reviveDraftLines(data.lines, storeCurrency);
        if (revived === null) {
          // Written under a currency the store no longer uses. Its amounts cannot be
          // re-read in the store's — stamping the new code onto the old minor units
          // would misprice them by the exponent ratio (100x between IDR and USD) —
          // so the draft is DROPPED rather than shown wrong. An empty cart is
          // recoverable; a wrong price at the till is not. Both keys go, or the
          // refusal would be undone on the next mount by whichever key survived.
          localStorage.removeItem(LOCKED_CART_KEY);
          localStorage.removeItem(ACTIVE_DRAFT_KEY);
          return;
        }
        setLines(revived);
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
      // ⚠️ The order type was NOT restored before this, so every restored cart came
      // back as the dine_in default. A cashier who rang up a takeaway, then had the
      // tablet reload / the OS trim memory / the till locked for a break, got a
      // DINE-IN cart back: it carries a table it never had, gates the claim and
      // release (rounds 40-45), and the kitchen prints the wrong ticket. Validated
      // against the union of what the three save sites can write, so an older
      // payload without the field still falls back to the default.
      if (data.orderType === 'dine_in' || data.orderType === 'takeaway' || data.orderType === 'delivery') {
        setOrderType(data.orderType);
      }
      localStorage.removeItem(LOCKED_CART_KEY);
    } catch { /* ignore */ }
  }, [currencyReady, storeCurrency, setLines, setDiscount, setAppliedPromotions, setTipPercent, setServiceCharge, LOCKED_CART_KEY, ACTIVE_DRAFT_KEY]);

  const [showOptions, setShowOptions] = useState(false);
  const [showTables, setShowTables] = useState(false);
  const [showSalesHistory, setShowSalesHistory] = useState(false);
  const [showStockInquiry, setShowStockInquiry] = useState(false);
  const [showMenuEditor, setShowMenuEditor] = useState(false);
  const [showReceiptsSettings, setShowReceiptsSettings] = useState(false);
  const [showPaymentsSettings, setShowPaymentsSettings] = useState(false);
  const [showRestaurantSettings, setShowRestaurantSettings] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showSplitBillModal, setShowSplitBillModal] = useState(false);
  const [showDiscountInput, setShowDiscountInput] = useState(false);
  const [showPromotions, setShowPromotions] = useState(false);
  const [discountInput, setDiscountInput] = useState('');
  const [discountName, setDiscountName] = useState('');
  const [tableNumber, setTableNumber] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [guestCount, setGuestCount] = useState('');
  const [editingCartLine, setEditingCartLine] = useState<CartLine | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const editingModifierGroups = useMemo(
    () => (editingProduct ? getProductModifierGroups(editingProduct) : []),
    [editingProduct],
  );
  const [showTableNumberSetting, setShowTableNumberSetting] = useState(false);

  // ── Auto-persist active draft cart (crash & low-memory recovery) ─
  useEffect(() => {
    // Hold off until the restore has reached its verdict. On the first render `lines`
    // is empty (and, inside a `CurrencyProvider`, the currency is still loading, so
    // the restore has deliberately not run yet), and the else-branch below would
    // delete a draft that has not been read — the one thing this mechanism exists to
    // prevent. The settle flag is set by the restore effect just before it commits.
    if (!draftRestoreSettledRef.current) return;
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
          // orderType rides with the cart: a takeaway restored as dine_in comes back
          // with a table it never had, gates a claim/release it should not, and
          // prints the wrong ticket to the kitchen.
          orderType,
        };
        localStorage.setItem(ACTIVE_DRAFT_KEY, JSON.stringify(draft));
      } catch {
        // Storage quota or transient browser fault
      }
    } else {
      localStorage.removeItem(ACTIVE_DRAFT_KEY);
    }
  }, [lines, discountPercent, discountLabel, appliedPromotions, tipPercent, serviceChargeEnabled, serviceChargePercent, tableNumber, customerName, guestCount, orderType, ACTIVE_DRAFT_KEY]);

  // ── Listen for Android OS memory trim callbacks (Phase 2 audit) ─
  useEffect(() => {
    const handleMemoryTrim = (e: Event) => {
      const level = (e as CustomEvent<{ level?: number }>).detail?.level ?? 80;
      // IF/ELSE rather than a bare guard: the restore block below reads and writes the
      // saved POS draft, whose handlers include tablet-only commands, and
      // `verify-scoped-reads.py` only reads a shell guard as in force INSIDE the block
      // it opened. Same behaviour, and the desktop restore path is now provably the
      // desktop's.
      if (isTabletShell()) {
        void notifyMemoryPressure(level).catch(() => {});
      } else {
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
            orderType,
          };
          localStorage.setItem(ACTIVE_DRAFT_KEY, JSON.stringify(draft));
        } catch { /* ignore */ }
      }
      }
    };
    window.addEventListener('kasirmu:trimMemory', handleMemoryTrim);
    window.addEventListener('kasirmu:lowMemory', handleMemoryTrim);
    return () => {
      window.removeEventListener('kasirmu:trimMemory', handleMemoryTrim);
      window.removeEventListener('kasirmu:lowMemory', handleMemoryTrim);
    };
  }, [lines, discountPercent, discountLabel, appliedPromotions, tipPercent, serviceChargeEnabled, serviceChargePercent, tableNumber, customerName, guestCount, orderType, ACTIVE_DRAFT_KEY]);
  // Restaurant coursing: `restaurant.course_firing` gates the firing bar +
  // per-line course chip. Defaults to the workspace check alone until the
  // setting loads, so a slow settings read never hides coursing that the
  // workspace implies; an explicit "false" hides it.
  const [courseFiringEnabled, setCourseFiringEnabled] = useState<boolean | null>(false);
  const [settingsRevision, setSettingsRevision] = useState(0);
  // Defaults ON for restaurant POS and OFF elsewhere. The key is restaurant-only,
  // so a retail workspace must not gain an order-type prompt from an unset value.
  // This default is what lets `CartPanel` drop its `|| restaurant-pos` override
  // (P1/D2): the control stays visible on restaurant while an explicit stored
  // "false" can finally turn it off.
  const [orderTypePromptEnabled, setOrderTypePromptEnabled] = useState(activeWorkspace === 'restaurant-pos');
  // NOTE: `orderType` is declared ABOVE the restore section (~line 167), not here.
  // The draft/lock persistence effects and the restore all read it, and they are
  // hoisted above this point — a `const` declared here would be in its temporal dead
  // zone for them (TS2448), which is how this surfaced.
  const [restaurantSidebarOpen, setRestaurantSidebarOpen] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const { goToWorkspacePicker } = useWorkspaceNav();
  // A session that expires MID-SHIFT. AppShell's banner covers a REJECTED
  // `createSession` at boot; this covers `invalidSession` answering a later command,
  // which used to be swallowed silently so the cashier could not take payment.
  const showSessionBanner = useInvalidSession();
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
    if (!sessionToken) {
      // Reported, not dropped. The browser-preview refusal three lines below already
      // carries a message for exactly this reason; a missing session is the same kind
      // of fact and was the one left mute.
      addToast({ message: requiredLocalized(l10n, 'pos-toast-auth-required'), type: 'warning' });
      return;
    }
    if (!session?.user_id || avatarBusy) return;
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

  const activeCurrency = currencyCtx?.currency ?? storeCurrency ?? subtotal?.currency ?? 'IDR';

  /**
   * Whether a customer has an open tab on this terminal, read by the shift-close
   * guard. Declared HERE, before `usePosShifts`, and assigned once
   * `usePosHeldCarts` has produced `activeOpenBillId` below — the held-cart hook is
   * instantiated after this one, so a plain argument would be undefined at
   * configuration time. A ref is also correct on its own terms: the guard must read
   * the CURRENT tab state when Close is pressed.
   */
  const hasOpenTabRef = useRef(false);

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
  } = usePosShifts({
    sessionToken,
    userId,
    lines,
    l10nRef,
    currency: activeCurrency,
    // Bound after usePosHeldCarts below — see the param's doc for why a ref.
    hasOpenTabRef: hasOpenTabRef,
  });
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
    syncLineCourse,
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
    changeQty,
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
    isManager,
  });
  // ── Barcode scanner integration ─────────────────────────────
  // Disabled on restaurant POS workspace (scanners are for retail checkout).
  useBarcodeScanner({
    enabled: activeWorkspace !== 'restaurant-pos',
    sessionToken,
    onProductFound: useCallback(async (payload: BarcodeScannedPayload) => {
      if (!activeShiftRef.current && !shiftUnavailableRef.current) {
        addToast({
          message: requiredLocalized(l10nRef.current, 'retail-toast-open-shift-first'),
          type: 'warning',
        });
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
      } catch (err) {
        // A FAILED lookup is not a clean miss, and the two need different words: this
        // handler already toasts `pos-no-barcode-match` for a legitimate "not our
        // barcode", and onError below toasts `pos-scanner-error`. A throwing lookup
        // used to be swallowed with "Silently ignore — the scanner will beep, user
        // retries", which is true of a scanner mis-read and untrue of a failed IPC:
        // every retry fails too, so the item never arrives and nothing says why. At a
        // busy till that reads as a dead scanner.
        console.error('barcode lookup failed', err);
        addToast({
          message: requiredLocalized(l10nRef.current, 'pos-barcode-lookup-failed'),
          type: 'warning',
        });
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
      addToast({
        message: requiredLocalized(l10nRef.current, 'retail-toast-open-shift-first'),
        type: 'warning',
      });
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
  const [dispatchOnTabSave, setDispatchOnTabSave] = useState<boolean | null>(null);
  const [autoPrintKitchen, setAutoPrintKitchen] = useState<boolean | null>(null);
  const dispatchKitchenDeltaRef = useRef<((deltaLines: CartLine[]) => Promise<void>) | null>(null);

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
    releaseLease,
  } = usePosHeldCarts({
    sessionToken,
    addToast,
    l10nRef,
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
    guestCount,
    setGuestCount,
    tipPercent,
    setTipPercent,
    serviceChargeEnabled,
    serviceChargePercent,
    setServiceCharge,
    orderType,
    setOrderType,
    dispatchOnTabSave,
    onDispatchKitchen: useCallback(
      async (deltaLines: CartLine[]) => {
        if (dispatchKitchenDeltaRef.current) {
          await dispatchKitchenDeltaRef.current(deltaLines);
        }
      },
      [],
    ),
    deductionLocationIdRef,
    onRestoreDeductionLocation: useCallback(
      async (locId: string | null) => {
        if (!locId) {
          setDeductionLocationName(null);
          return;
        }
        try {
          // ADR #7: the ambient `get_cart_deduction_location` is registered by the
          // TABLET shell only; desktop registers only the `_scoped` twin. `sessionToken`
          // is `rawToken || ''` (:157), so a missing token is the EMPTY STRING, not
          // null — a bare truthiness test therefore sent the desktop down the ambient
          // branch whenever no workspace session existed, the invoke was rejected as an
          // unknown command, and the `catch` below silently rendered the raw location id.
          // Gate the fallback on the shell as well as the token. Found by
          // scripts/verify-ipc-parity.py; see
          // docs/records/audits/2026-10-19-ipc-door-missing-and-root-debris.md.
          const info =
            sessionToken || !isTabletShell()
              ? await getCartDeductionLocationScoped(sessionToken, locId)
              : await getCartDeductionLocation(locId);
          setDeductionLocationName(info?.locationName ?? locId);
          if (info?.overriddenAt) setDeductionOverridden(true);
        } catch {
          setDeductionLocationName(locId);
        }
      },
      [sessionToken, setDeductionLocationName, setDeductionOverridden],
    ),
  });

  // The shift-close guard reads this. Assigned during render rather than in an effect
  // so it is already correct the first time Close is clicked — no one-close-behind
  // window where a tab exists but the ref still says false.
  hasOpenTabRef.current = Boolean(activeOpenBillId);

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
    //
    // ⚠️ THE FAILURE BRANCH MUST RE-READ, and the delete must be AWAITED before the
    // refresh — the same rule the split handler above states in handleConfirmSplitBill, and the
    // same reason its comment gives: `loadOpenBills()` on the success path alone left
    // the list showing stale data over a half-committed write.
    //
    // This site had both halves wrong. The delete was fire-and-forget and the refresh
    // fired in the SAME TICK, so the read raced the write; and when the delete
    // REJECTED the tab was still in the database with nothing re-reading it. The
    // operator saw a toast and a list built from whatever the server held an instant
    // earlier — while `setActiveOpenBillId(null)` had already destroyed the only
    // handle that could retry the delete.
    //
    // A paid tab left in the database is not cosmetic: the open-bills list is the only
    // surface that can resume one, so the next waiter can recall a tab this cashier
    // already settled and sell its lines a second time.
    //
    // Still fire-and-forget for the SALE's sake — the money is already taken and a
    // locked DB must not fail a completed checkout — but the list is refreshed once
    // the write settles, on BOTH paths.
    if (activeOpenBillId) {
      const paidBillId = activeOpenBillId;
      void releaseLease(paidBillId);
      setActiveOpenBillId(null);
      deleteHeldCartScoped(sessionToken, paidBillId)
        .catch(() => {
          addToast({ message: requiredLocalized(l10n, 'pos-toast-held-cart-delete-failed'), type: 'error' });
        })
        .finally(() => {
          // `finally`, not `.then`: the refusal has to re-read too, or the paid tab
          // stays invisible until a manual reload.
          void loadOpenBills();
        });
    }
    resetCart();
    try {
      localStorage.removeItem(ACTIVE_DRAFT_KEY);
    } catch { /* ignore */ }
    // Release table if the completed order/bill had one — DINE-IN ONLY.
    //
    // ⚠️ This is the RELEASE half of the defect fixed on the claim side in
    // 206462b4d. The cart panel shows the Table number field for the restaurant
    // POS on EVERY order type (CartPanel.tsx:855-856, re-measured 2026-10-19; the note
  // said `:735-743`), so a cashier ringing up a
    // TAKEAWAY with a number left in that field reached here and freed a real
    // table: `releaseTableScoped` on whatever `match` the number resolved to.
    // Blocking the claim alone was therefore only half the fix — a takeaway could
    // still free an occupied table it had never claimed. A takeaway has no table
    // to release.
    if (tableNumber && sessionToken && orderType === 'dine_in') {
      void listTablesScoped(sessionToken)
        .then(async (tables) => {
          const remainingBills = await listOpenBillsScoped(sessionToken).catch(() => []);
          const stillHasOpenBill = remainingBills.some((b) => matchesTableBill(b, tableNumber));
          if (stillHasOpenBill) {
            return;
          }
          const bareInput = bareTableNumber(tableNumber);
          const match = tables.find(
            (t) =>
              t.name === tableNumber ||
              t.id === tableNumber ||
              (bareTableNumber(t.name) === bareInput && bareInput !== ''),
          );
          if (match && (match.status === 'occupied' || match.status === 'reserved')) {
            return releaseTableScoped(sessionToken, match.id);
          }
        })
        // ⚠️ NOT an empty catch. The release is deliberately fire-and-forget — a
        // floor-plan hiccup must never fail the sale that just completed — but a
        // SILENT one left the table reading "Occupied" on the floor plan with no
        // sale behind it, and nothing on screen said so. The cashier's next move is
        // to seat someone at a table the system believes is taken. Warn, do not
        // block: the sale is already recorded and must stay that way.
        .catch(() => {
          addToast({ type: 'warning', message: requiredLocalized(l10n, 'tables-action-error') });
        });
    }
    setTableNumber('');
    setCustomerName('');
    setGuestCount('');
    // Also clear the customer-facing pole display.
    customerDisplayPaymentComplete();
    // F21: the order-sent chime. Placed here, at the end of a COMPLETED checkout —
    // the same seat the retail POS uses (the `playSuccess()` inside `RetailPosScreen`'s
  // PaymentModal `onComplete` — anchored by that call, not a line number: the numbers
  // this note has carried were all stale within a week of being written) — so it cannot
    // fire for a sale that failed. `null` means never written, which the setting's own
    // default (true) says should chime.
    if (soundChime !== false) playSuccess();
    // orderType is read above (the dine-in-only release) and so must be listed:
    // without it this callback closes over the render-time value and a cashier who
    // switches Dine-In -> Takeaway after mount would still free the table.
    // l10n is read above by the table-release warning toast, so it must be listed:
    // the closure would otherwise keep the mount-time localizer and the toast would
    // render in the language the cashier was NOT using after a locale switch.
  }, [resetCart, tableNumber, orderType, setTableNumber, setCustomerName, setGuestCount, customerDisplayPaymentComplete, activeOpenBillId, loadOpenBills, addToast, l10n, sessionToken, deductionLocationIdRef, setActiveOpenBillId, setCartId, setDeductionLocationName, setDeductionOverridden, soundChime, playSuccess, releaseLease, ACTIVE_DRAFT_KEY]);

  const handlePrintBill = useCallback(async () => {
    if (lines.length === 0 || !total) return;
    if (!sessionToken) {
      addToast({ message: requiredLocalized(l10n, 'pos-toast-auth-required'), type: 'error' });
      return;
    }
    // ⚠️ DINE-IN ONLY — the NINTH site of this rule. Same derivation as the saved-tab
    // builders, but the consequence is on PAPER: completedSale.ts puts this value in
    // the printed args (`tableNumber` on the returned object) and derives the receipt
    // NUMBER from it (`CHECK-${tableNumber}`), so a
    // takeaway with a stray number in the Table field printed a check naming a table
    // it does not have. The button gate in CartActionBar now agrees with this.
    const billTable = orderType === 'dine_in' ? (tableNumber ?? '').trim() : '';
    try {
      const receipt = buildPreCheckoutBillReceipt({
        billNumber: `BILL-${bareTableNumber(billTable) || 'CHECK'}-${Date.now().toString().slice(-4)}`,
        cartLines: lines,
        cartCurrency: subtotal?.currency || activeCurrency,
        subtotal: subtotal ?? { minor_units: 0, currency: activeCurrency },
        total: total && cartTaxExclusive && cartTax > 0 && cartTaxFresh
          ? { minor_units: total.minor_units + cartTax, currency: total.currency }
          : total,
        taxAmount: cartTax > 0 ? { minor_units: cartTax, currency: activeCurrency } : undefined,
        tableNumber: billTable || undefined,
        customerName: customerName || undefined,
      });
      await printSalesReceipt(sessionToken, receipt);
      addToast({
        message: requiredLocalized(l10n, 'pos-toast-bill-printed', { table: billTable }),
        type: 'success',
      });
    } catch (err) {
      addToast({
        message: l10nErrorMessage(err, l10n, 'pos-toast-bill-print-failed'),
        type: 'error',
      });
    }
      // orderType gates the table this prints, so it must be listed.
  }, [lines, total, sessionToken, tableNumber, orderType, customerName, subtotal, activeCurrency, cartTaxExclusive, cartTax, cartTaxFresh, addToast, l10n]);

  const handleConfirmSplitBill = useCallback(
    async (selectedLines: CartLine[], remainingLines: CartLine[]) => {
      if (selectedLines.length === 0) return;
      if (remainingLines.length > 0 && sessionToken) {
        try {
          // ⚠️ DINE-IN ONLY — the same rule the PaymentModal open-bill path
          // applies (795fc18d4), on the split-bill path added later in 276d6ce04.
          // `tableNumber` is written into the remaining tab's cart_data, its label
          // AND its customer_name, while `orderType` is written into the same
          // record — so a takeaway with a stray number in the Table field persisted
          // a tab contradicting itself: {"tableNumber":"T99","orderType":"takeaway"}.
          // An open bill is a table's running tab; a takeaway has none.
          const trimmedTable = orderType === 'dine_in' ? (tableNumber ?? '').trim() : '';
          const trimmedName = (customerName ?? '').trim();
          // ⚠️ PAX IS DINE-IN ONLY, the same rule the table line above applies. The
          // setting's own description is "party size and number of SEATED GUESTS PER
          // TABLE" (products.ftl:105), and CartPanel.tsx:908 already hides the field
          // on a takeaway — but the FIELD was hidden while the VALUE persisted, so a
          // cashier who typed a pax and then switched to Takeaway saved a party size
          // for an order with no table.
          const trimmedGuest = orderType === 'dine_in' ? (guestCount ?? '').trim() : '';
          const cartData = JSON.stringify({
            lines: remainingLines.map((l) => ({
              sku: l.sku,
              name: l.name,
              qty: l.qty,
              unit_price: l.unit_price,
              ...(l.courseId ? { courseId: l.courseId } : {}),
              ...(l.coursingStatus ? { coursingStatus: l.coursingStatus } : {}),
              ...(l.modifiers && l.modifiers.length > 0 ? { modifiers: l.modifiers } : {}),
              ...(l.note ? { note: l.note } : {}),
              ...(typeof l.dispatchedQty === 'number' ? { dispatchedQty: l.dispatchedQty } : {}),
            })),
            discountPercent,
            discountLabel,
            ...(trimmedTable ? { tableNumber: trimmedTable } : {}),
            ...(trimmedName ? { customerName: trimmedName } : {}),
            ...(trimmedGuest ? { guestCount: trimmedGuest } : {}),
            ...(typeof tipPercent === 'number' && tipPercent > 0 ? { tipPercent } : {}),
            ...(typeof serviceChargeEnabled === 'boolean' ? { serviceChargeEnabled } : {}),
            ...(typeof serviceChargePercent === 'number' && serviceChargePercent > 0 ? { serviceChargePercent } : {}),
            ...(orderType ? { orderType } : {}),
          });
          const label = heldCartLabel(trimmedTable, trimmedName) ?? `Open Bill #${Date.now()}`;
          const remSubtotalMinor = remainingLines.reduce(
            (sum, l) => sum + l.unit_price.minor_units * l.qty,
            0,
          );
          // CREATE FIRST, DELETE SECOND. This ran the DELETE first, and the delete is
          // what loses the tab: a rejected hold (locked DB, dropped IPC, lapsed session)
          // left the table with no open bill at all while the catch below toasted
          // "failed to update tab" — and execution then CONTINUES to
          // `setShowPayment(true)`, so the sale goes to payment with the remaining
          // lines destroyed. Same ordering fix as TableManagementScreen.handleMoveTable;
          // the duplicate-row cost of the safe order is recoverable, a lost tab is not.
          await holdCartScoped(sessionToken, {
            label,
            cart_data: cartData,
            item_count: remainingLines.length,
            total_minor: remSubtotalMinor,
            currency: remainingLines[0]?.unit_price.currency || activeCurrency,
            bill_type: 'open_bill',
            customer_name: trimmedName || (trimmedTable ? `Table ${bareTableNumber(trimmedTable)}` : ''),
            ...(deductionLocationIdRef.current ? { deduction_location_id: deductionLocationIdRef.current } : {}),
          });
          // The remaining tab exists under this id now, so removing the previous
          // record cannot lose data — a failure here leaves two tabs, not none.
          if (activeOpenBillId) {
            await deleteHeldCartScoped(sessionToken, activeOpenBillId);
          }
          setActiveOpenBillId(null);
          loadOpenBills();
        } catch {
          // REPORT AND STOP. This catch used to toast and fall through to the
          // `setShowPayment(true)` below, which is the exact shape the create-first comment
          // above (the "create-first order trades for not losing the tab" block) says the
          // reordering was meant to end: the operator is taken to payment for the SPLIT
          // portion while the ORIGINAL tab — still holding every line, because the
          // `setActiveOpenBillId(null)` in handlePaymentComplete runs on the success path
          // only — remains
          // to be settled later. That is one set of lines charged twice.
          //
          // Returning keeps the cart intact and the split modal open, so the cashier can
          // retry the balance or cancel; a lost tab is recoverable, a double charge is not.
          // HALF-COMMITTED: re-read the open bills BEFORE reporting.
          //
          // The writes are ordered hold-then-delete, so this catch can fire after the
          // hold SUCCEEDED — the original tab still holds every line and a new tab now
          // holds the same remaining ones, which is the documented, hand-resolvable
          // duplicate the create-first order trades for not losing the tab. But
          // loadOpenBills() sits on the success path (the bare `loadOpenBills();` call just
          // above this comment), so until the branch below re-read it the list
          // was never re-read and the screen kept showing ONE bill over data that held
          // TWO. The operator could not see, select, or settle the duplicate — the
          // "recoverable" mess was recoverable only by someone with database access.
          //
          // Refreshing makes it visible and settleable. Best-effort: a second failure
          // here must not mask the one being reported.
          //
          // The refresh IS covered now — see "the failure branch did not re-read the
          // open bills" in PosScreenCoreFlow.test.tsx, which sets `wsState.scopeTypeKey`
          // and DIFFERENCES the `listOpenBillsScoped` call count. A bare count was tried
          // first and was worthless: the mount effect already satisfies `> 0`, so it
          // passed against a build with this refresh deliberately removed. Only the delta
          // distinguishes it — measured, not assumed.
          //
          // The duplicate being VISIBLE has a resume to stand on now: the case named
          // 're-reads the open bills when a paid tab fails to delete' resumes a real
          // tab, which is what sets `activeOpenBillId` (the `setActiveOpenBillId(id)` call in
  // `usePosHeldCarts`'s `handleResumeOpenBill`) and
          // therefore what makes this branch reachable at all. The previous wording —
          // 'no case in the file resumes one' — measured true when written and is
          // false now.
          //
          // This handler's ORDERING is still pinned at the source layer, not by a case
          // here: heldCartReplacementOrder.test.ts grades hold-before-delete across four
          // sites including this one, on purpose, because reaching the handler needs the
          // whole POS. What nothing shows is the DUPLICATE appearing in the rendered
          // list — that needs this branch to run, and no case drives a split here.
          try {
            await loadOpenBills();
          } catch {
            /* the toast below already reports the failure */
          }
          addToast({ message: requiredLocalized(l10n, 'pos-toast-tab-balance-failed'), type: 'error' });
          // `false`, not a bare `return`: the modal closes on ANY resolution that
          // is not an explicit false, so returning nothing closed it and stranded
          // the cashier with a half-applied split and no way to retry the balance.
          return false;
        }
      }
      setLines(selectedLines);
      setShowSplitBillModal(false);
      setShowPayment(true);
    },
    [
      sessionToken,
      tableNumber,
      customerName,
      guestCount,
      discountPercent,
      discountLabel,
      tipPercent,
      serviceChargeEnabled,
      serviceChargePercent,
      orderType,
      activeOpenBillId,
      activeCurrency,
      setActiveOpenBillId,
      loadOpenBills,
      addToast,
      setLines,
      deductionLocationIdRef,
      // l10n is read by the failure toasts this handler raises (round 15's
      // localization pass), so it must be listed or the toast renders in the
      // locale the cashier was NOT using after a switch.
      l10n,
    ],
  );

  const [sendingToKitchen, setSendingToKitchen] = useState(false);

  const hasUndispatchedItems = useMemo(
    () => lines.some((l) => (l.qty - (l.dispatchedQty ?? 0)) > 0),
    [lines],
  );

  const handleDispatchKitchenDelta = useCallback(
    async (deltaLines: CartLine[]) => {
      if (!sessionToken) {
        // Reported, not dropped: this function is what puts food on the pass. With no
        // session the chit is never sent, and silence leaves the operator unable to
        // tell "not sent" from "sent and ignored".
        addToast({ message: requiredLocalized(l10n, 'pos-toast-auth-required'), type: 'warning' });
        return;
      }
      if (deltaLines.length === 0) return;
      if (autoPrintKitchen !== false) {
        // ⚠️ DINE-IN ONLY — the TWELFTH site of this rule, and the one with a
        // physical consequence: every other site mislabelled a RECORD, this one
        // misdirects FOOD. `tableNumber` was passed straight through, so a takeaway
        // with a stray number in the Table field (the field renders on restaurant POS
        // unconditionally — CartPanel.tsx:864) sent the pass a chit numbered
        // `KOT-99-…` carrying `tableNumber: 99`, and the kitchen plated for a table
        // that did not order.
        //
        // The builder's `|| 'ORDER'` fallback is NOT the guard: it handles a MISSING
        // table, which is the right default, but says nothing about a table that
        // should never have been sent.
        const chitTable = orderType === 'dine_in' ? (tableNumber ?? '').trim() : '';
        const foodLines = deltaLines.filter((l) => !isBeverageItem(l));
        const drinkLines = deltaLines.filter((l) => isBeverageItem(l));

        if (foodLines.length > 0) {
          const foodChit = buildKitchenChitReceipt({
            cartLines: foodLines,
            cartCurrency: subtotal?.currency || activeCurrency,
            tableNumber: chitTable || undefined,
            customerName: customerName || undefined,
            printerTarget: 'kitchen',
            documentKind: 'kitchen',
          });
          try {
            await printSalesReceipt(sessionToken, foodChit);
          } catch (printErr) {
            // Non-fatal, but NOT silent — and `addToast` was already in this callback's
            // dep array (below), so the intent was there. A kitchen chit that never
            // printed means the line reaches nobody: the cashier must hear about it,
            // because only they can re-send or tell the kitchen. Round 36 fixed the same
            // shape in PaymentModal's chit catch; this is the dispatch path, where the
            // order is actually sent.
            console.warn('Kitchen chit printing failed/unavailable (non-fatal):', printErr);
            addToast({ message: requiredLocalized(l10nRef.current, 'pos-toast-kitchen-print-failed'), type: 'warning' });
          }
        }

        if (drinkLines.length > 0) {
          const barChit = buildKitchenChitReceipt({
            cartLines: drinkLines,
            cartCurrency: subtotal?.currency || activeCurrency,
            tableNumber: chitTable || undefined,
            customerName: customerName || undefined,
            printerTarget: 'bar',
            documentKind: 'bar',
          });
          try {
            await printSalesReceipt(sessionToken, barChit);
          } catch (printErr) {
            // Same as the kitchen chit above, with the bar's own string so the operator
            // knows WHICH station is missing its ticket.
            console.warn('Bar chit printing failed/unavailable (non-fatal):', printErr);
            addToast({ message: requiredLocalized(l10nRef.current, 'pos-toast-bar-print-failed'), type: 'warning' });
          }
        }
      }
    },
    // orderType gates the table the chit carries, so it must be listed: without it
    // the chit closes over the mount-time order type and a mid-sale switch to
    // Takeaway still prints a table.
    [sessionToken, autoPrintKitchen, subtotal, activeCurrency, tableNumber, orderType, customerName, addToast, l10n],
  );
  dispatchKitchenDeltaRef.current = handleDispatchKitchenDelta;

  const handleSendToKitchen = useCallback(async () => {
    if (!sessionToken) {
      // Reported, not dropped. See handleDispatchKitchenDelta above.
      addToast({ message: requiredLocalized(l10n, 'pos-toast-auth-required'), type: 'warning' });
      return;
    }
    if (lines.length === 0) return;
    const deltaLines = lines
      .filter((l) => (l.qty - (l.dispatchedQty ?? 0)) > 0)
      .map((l) => ({ ...l, qty: l.qty - (l.dispatchedQty ?? 0) }));
    if (deltaLines.length === 0) return;

    // ⚠️ THE SEND IS NOT A NO-OP WHEN THE CHITS ARE OFF (2026-10-19).
    //
    // `handleDispatchKitchenDelta` does ONE thing: print the food/bar chits, and the
    // whole body of that sits inside `if (autoPrintKitchen !== false)`. "Send to
    // Kitchen" is the only route by which the kitchen learns about an order — the
    // dispatch path creates no KDS order (grep: the only `createKdsOrderFromSaleScoped`
    // callers are in PaymentModal, at checkout) — so with Auto-Print KOT switched off
    // the button advanced every line's `dispatchedQty`, the Send control disappeared,
    // and NOTHING had been sent. The kitchen was never told, and the screen said the
    // opposite.
    //
    // Say so instead of pretending. The lines are still advanced: an operator who has
    // turned printing off is expected to notify the kitchen by other means, and
    // leaving progress behind would let the same items be "sent" again forever.
    if (autoPrintKitchen === false) {
      addToast({ message: requiredLocalized(l10n, 'pos-toast-kitchen-print-failed'), type: 'warning' });
    }

    setSendingToKitchen(true);
    try {
      await handleDispatchKitchenDelta(deltaLines);
      // ⚠️ THE DELTA, NOT THE CLOSURE. Functional form, and only the lines the delta
      // actually carried are advanced.
      //
      // The previous body was `setLines(lines.map((l) => ({ ...l, dispatchedQty: l.qty })))`
      // — `lines` is this render's closure, captured BEFORE the await. The cart stays
      // editable while the send is in flight (`sendingToKitchen` drives only a button's
      // processing state and is never read as a guard), so anything added during the
      // await was absent from the replacement array and `setLines` DROPPED it. Measured
      // live (round 201): two lines before Send, one more added during, and the cart
      // came back with two — the operator's item silently gone, with no message.
      //
      // The other half is a raised quantity: marking the closure's `l.qty` when the
      // operator has since increased it would show 'Sent' for portions the kitchen never
      // received. Advancing by the sent amount keeps the badge honest in both cases.
      // ⚠️ RESOLVED INSIDE THE UPDATER, not built from `lines`.
      //
      // The delta map above is correct; the WRITE was not. It read
      // `const updatedLines = lines.map(...)` — the render closure captured BEFORE the
      // await — and then `setLines(updatedLines)` REPLACED the array with it. That is
      // the round-201 defect this comment describes as fixed, still live in the write:
      // a line added while the send was in flight is absent from `updatedLines` and
      // `setLines` dropped it, silently.
      //
      // posDispatchRecord.test.ts pins the arithmetic at the logic layer (its own header
      // says the component body "is not reachable from a unit test"), which is why the
      // copy could be correct while this write stayed wrong. Resolving inside the
      // updater against the COMMITTED state makes the component satisfy the same
      // contract the pure functions encode.
      // ⚠️ KEYED BY `id`, NOT `sku`.
      //
      // One SKU can occupy TWO lines: `addProduct` merges only lines agreeing on
      // course, coursing status, note AND modifiers (the `prev.find` comparator inside
  // `usePosState`'s `addProduct`), so the
      // same dish as a main and as a dessert is two lines sharing one SKU. A SKU-keyed
      // map collapses them and applies one line's sent quantity to the OTHER —
      // measured: A (qty 2, dispatched 0) in the delta, B (qty 1, dispatched 1) not,
      // and B came out at dispatchedQty 3 of 1.
      //
      // A dispatchedQty ABOVE qty is the 'Sent' badge lying in its worst form, and the
      // tab below persists the value, so the corruption outlives the session.
      const sentById = new Map(deltaLines.map((d) => [d.id, d.qty]));
      setLines((prev) =>
        prev.map((l) => {
          const sentQty = sentById.get(l.id);
          if (sentQty === undefined) return l;
          return { ...l, dispatchedQty: (l.dispatchedQty ?? 0) + sentQty };
        }),
      );

      // Persist to open bill if active or table assigned
      //
      // ⚠️ DINE-IN ONLY — the SEVENTH site of this rule (see
      // RestaurantOrderTypeFieldConsumers.test.ts and
      // docs/records/audits/restaurant-pos-order-type-fields.md). It was written
      // unconditionally while the split-bill handler 110 lines above already applied
      // the rule, which is how the series went: the rule is right, and it gets
      // applied one site at a time.
      //
      // `trimmedTable` is used twice below, so an unguarded value does two things on
      // a takeaway with a stray number in the Table field:
      //   * `if (activeOpenBillId || trimmedTable)` is TRUE, so the whole open-bill
      //     block runs and the kitchen dispatch is persisted into a tab;
      //   * that tab's cart_data carries tableNumber AND orderType, contradicting
      //     itself, and its customer_name is overwritten with "Table N".
      // A takeaway has no table to open a tab against.
      const trimmedTable = orderType === 'dine_in' ? (tableNumber ?? '').trim() : '';
      const trimmedName = (customerName ?? '').trim();
      // PAX is dine-in-only — see the split-bill site above for the rule and the
      // reachable sequence.
      const trimmedGuest = orderType === 'dine_in' ? (guestCount ?? '').trim() : '';
      if (activeOpenBillId || trimmedTable) {
        // ⚠️ READ FROM `lines` AND PERSIST THE SENT AMOUNT.
        //
        // Two defects lived in this block, and the typecheck surfaced both when the
        // write above stopped building `updatedLines`:
        //
        //   1. it mapped `updatedLines` — the SAME pre-await closure the dispatch
        //      write had, so a tab held after a send recorded whatever the cart held
        //      when the send STARTED, not what it holds now;
        //   2. `dispatchedQty: l.qty` wrote the WHOLE quantity as dispatched. The
        //      send explicitly advances by the SENT amount (the delta), because a
        //      raised quantity was never sent — so this persisted the exact
        //      over-record the dispatch write was fixed to avoid, into the
        //      payload the resume reads back.
        //
        // A resumed tab would therefore show 'Sent' for portions the kitchen never
        // received, and the kitchen ticket would disagree with the saved bill.
        //
        // ⚠️ THIRD DEFECT, FOUND BY VERIFYING THIS FIX IN SHIPPED FORM: the payload
        // maps `lines` — the closure captured BEFORE the dispatch await, inside
  // handleDispatchKitchenDelta — so
        // it carried the PRE-send `dispatchedQty`. Live state was corrected above and
        // the saved record was not:
        //
        //   cart: A qty 2, dispatchedQty 0
        //   Send  -> setLines advances A to 2   (live state correct)
        //   Hold  -> cartData recorded A as 0
        //   Resume-> A reads as NOT sent, though the kitchen has it
        //
        // The opposite error from the over-record above, same root cause.
        //
        // FIXED BY APPLYING THE SAME ADVANCE THE DISPATCH APPLIED, to the same array it
        // applied it to. `sentById` is already in scope and the dispatch's own write
        // resolved against committed state, so this reproduces it exactly without a
        // second await — and stays a pure function of the values the send used.
        const persistedLines = lines.map((l) => {
          const sentQty = sentById.get(l.id);
          if (sentQty === undefined) return l;
          return { ...l, dispatchedQty: (l.dispatchedQty ?? 0) + sentQty };
        });
        const cartData = JSON.stringify({
          lines: persistedLines.map((l) => ({
            sku: l.sku,
            name: l.name,
            qty: l.qty,
            unit_price: l.unit_price,
            ...(l.courseId ? { courseId: l.courseId } : {}),
            ...(l.coursingStatus ? { coursingStatus: l.coursingStatus } : {}),
            ...(l.modifiers && l.modifiers.length > 0 ? { modifiers: l.modifiers } : {}),
            ...(l.note ? { note: l.note } : {}),
            ...(typeof l.dispatchedQty === 'number' ? { dispatchedQty: l.dispatchedQty } : {}),
          })),
          discountPercent,
          discountLabel,
          ...(trimmedTable ? { tableNumber: trimmedTable } : {}),
          ...(trimmedName ? { customerName: trimmedName } : {}),
          ...(trimmedGuest ? { guestCount: trimmedGuest } : {}),
          ...(typeof tipPercent === 'number' && tipPercent > 0 ? { tipPercent } : {}),
          ...(typeof serviceChargeEnabled === 'boolean' ? { serviceChargeEnabled } : {}),
          ...(typeof serviceChargePercent === 'number' && serviceChargePercent > 0 ? { serviceChargePercent } : {}),
          ...(orderType ? { orderType } : {}),
        });

        const label = heldCartLabel(trimmedTable, trimmedName) ?? (trimmedTable ? `Table ${trimmedTable}` : `Open Bill #${Date.now()}`);

        // CREATE FIRST, DELETE SECOND — same fix as the split-bill path above, and it
        // matters more here: this branch runs AFTER the kitchen has been told to cook,
        // so a failed hold that had already deleted the tab would leave food being
        // prepared for a table whose order record no longer exists.
        const held = await holdCartScoped(sessionToken, {
          label,
          cart_data: cartData,
          item_count: lines.length,
          total_minor: subtotal?.minor_units ?? 0,
          currency: subtotal?.currency ?? activeCurrency,
          bill_type: 'open_bill',
          customer_name: trimmedName || (trimmedTable ? `Table ${bareTableNumber(trimmedTable)}` : ''),
          ...(deductionLocationIdRef.current ? { deduction_location_id: deductionLocationIdRef.current } : {}),
        });
        setActiveOpenBillId(held.id);

        // Safe to drop the previous record now: the tab exists under the new id.
        if (activeOpenBillId) {
          await deleteHeldCartScoped(sessionToken, activeOpenBillId);
        }
        loadOpenBills();
      }

      addToast({
        message: requiredLocalized(l10n, 'pos-toast-kitchen-dispatched', { table: tableNumber || 'Order' }),
        type: 'success',
      });
    } catch (err) {
      // HALF-COMMITTED — and this is the branch where it matters most, because the
      // kitchen has ALREADY been told to cook (the chit/KDS calls in
      // handleDispatchKitchenDelta). If the hold succeeded and
      // only the delete of the previous tab failed, food is being prepared while
      // loadOpenBills() on the success path (this note
      // used to cite line 1259) left the bill list showing the
      // OLD tab. The operator would then reconcile a running order against a list that
      // cannot show both records.
      try {
        await loadOpenBills();
      } catch {
        /* the toast below already reports the failure */
      }
      addToast({
        message: l10nErrorMessage(err, l10n, 'pos-toast-kitchen-dispatch-failed'),
        type: 'error',
      });
    } finally {
      setSendingToKitchen(false);
    }
  }, [lines, sessionToken, handleDispatchKitchenDelta, setLines, tableNumber, customerName, guestCount, activeOpenBillId, discountPercent, discountLabel, tipPercent, serviceChargeEnabled, serviceChargePercent, orderType, subtotal, activeCurrency, setActiveOpenBillId, loadOpenBills, addToast, l10n, deductionLocationIdRef, autoPrintKitchen]);

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
          orderType,
        };
        localStorage.setItem(LOCKED_CART_KEY, JSON.stringify(data));
      } else {
        localStorage.removeItem(LOCKED_CART_KEY);
      }
    } catch { /* storage quota or unavailable — ignore */ }
    logout();
  }, [lines, discountPercent, discountLabel, appliedPromotions, tipPercent, serviceChargeEnabled, serviceChargePercent, tableNumber, customerName, guestCount, orderType, logout, LOCKED_CART_KEY]);

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
  // before it (the whole class is written up in SettingsContext’s guard-register header). This one
  // is not cosmetic: CartPanel gates the course controls on
  // `courseFiringEnabled !== false`, so a stale read carrying the
  // PREVIOUS store's setting forward would hide course firing on a store that has
  // it enabled -- a POS capability disappearing across a store switch.
  //
  // PINNED (round 83, 2026-10-13) by switching the token and letting the stale read land,
  // the same way as its sibling above. Removing `if (stale()) return;` below now fails
  // PosScreenCoreFlow.test.tsx -> 'ignores a slower course-firing read from the previous
  // store' with `expected <div class="pos-cart-course-bar"></div> to be null`.
  //
  // The first attempt at this pin was worth documenting because it LOOKED pinned and was
  // not: it asserted on the bar's "Fire All" text, which CourseSelectorBar renders only
  // while some course still has a fireable line. A barcode-scanned line has no
  // course, so the text was absent whether or not the bar mounted -- an assertion that
  // could not fail. The observable is the CONTAINER `div.pos-cart-course-bar`, which
  // mounts on exactly this guard's condition (CartPanel.tsx:961); asserting on it is the
  // established idiom (CartPanel.test.tsx:316/:324).
  //
  // Also note the argument order in that test: `getSettingScoped(token, key)`, so the key
  // is SECOND. Reading it from the first parameter answers `null` for every read and makes
  // the mutation appear to survive.
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
  }, [sessionToken, settingsRevision]);

  // ── Restaurant cart-field gates (P1) ────────────────────────────
  // `restaurant.customer_name` / `restaurant.guest_count` gate the cart's two
  // optional fields. Both use `null` = "never written" as SHOW, matching the
  // `!== false` props on CartPanel, so an unset key cannot hide a field that has
  // always been visible. A failed read is also SHOW, for the same reason the
  // course-firing flag falls back to its workspace default: a settings outage
  // must not remove a POS capability.
  const [customerNameEnabled, setCustomerNameEnabled] = useState<boolean | null>(null);
  const [guestCountEnabled, setGuestCountEnabled] = useState<boolean | null>(null);
  const [saveTabEnabled, setSaveTabEnabled] = useState<boolean | null>(null);
  const [printBillEnabled, setPrintBillEnabled] = useState<boolean | null>(null);
  const [splitBillEnabled, setSplitBillEnabled] = useState<boolean | null>(null);

  // ── Order Sound Notifications (F21) ─────────────────────────────
  //
  // `restaurant.sound_chime` promises "Play an audible confirmation chime when orders
  // are sent or updated" (products.ftl:115) and defaults to TRUE, but lived ONLY in
  // the settings screen until this round — written, loaded into its own switch, and
  // read by nothing, so the app never played the chime it advertised.
  //
  // The pieces were present, as they were for F20: `useSound()` is a shared component
  // hook (not KDS-only — it is a plain Web Audio beep), and the RETAIL POS already
  // plays `playSuccess()` on sale completion (`RetailPosScreen.tsx:1576`). The
  // restaurant path simply never called it.
  //
  // `null` = never written -> the model's default (true), so an unset key keeps the
  // behaviour the default describes rather than silently disabling sound.
  //
  // The STATE is declared beside `playSuccess` above, because `handlePaymentComplete`
  // reads it and is defined earlier in the component than this comment block.

  // ── Auto-Print KOT (F20) ────────────────────────────────────────
  //
  // `restaurant.auto_print_kitchen` lived ONLY in the settings screen until this
  // round: written, loaded back into its own switch, and read by nothing — so the
  // toggle promised a behaviour the app never performed. Both halves were already
  // present and simply never joined: `createKdsOrderFromSaleScoped` creates the KDS
  // order and `printKdsChitScoped` prints the chit, with the latter having zero
  // callers anywhere under ui/src.
  //
  // ⚠️ THE DEFAULT DIVERGES FROM THE MODEL, ON PURPOSE (corrected 2026-10-19).
  //
  // This comment used to claim "the default is TRUE — matching the model's
  // `DEFAULT_RESTAURANT_SETTINGS.autoPrintKitchen`". It does not: the model says
  // `false`, and its `fallback` (restaurantSettingsModel.ts:61, :99) reproduces that
  // `false`. So the two surfaces DISAGREE for an unset key today.
  //
  // Which direction is right, and why it is not simply a bug to fix:
  //   · the POS fails OPEN (`!== false`) because the asymmetry is not symmetric — a
  //     chit printed for an order that did not want one is noise the kitchen sees and
  //     corrects; a chit that never prints is food nobody cooks, discovered only when
  //     the table complains. Pinned by restaurantToggleFailDirection.test.ts:51-58.
  //   · the settings SCREEN, given the same unset key, renders the toggle OFF, because
  //     `loadRestaurantSettings` maps `raw === null` to `spec.fallback` = the model's
  //     `false` (restaurantSettingsModel.ts:159).
  //
  // That is the guest-count defect (F1) in the opposite sign: a control whose OFF
  // position describes a state the POS is not in. It was called "agreement" here for
  // twenty rounds because the claim was never checked against the model.
  //
  // NOT FIXED IN THIS EDIT, deliberately: closing it means moving either the model
  // default or the failure direction, and both are load-bearing elsewhere (the screen's
  // toggle is a real operator control; the POS's `!== false` is pinned by a guard whose
  // whole file documents why fail-open is the safe side). Recorded here so the next
  // reader cannot mistake the divergence for oversight.

  // PINNED (round 84, 2026-10-13). Removing the success-path `if (stale()) return;`
  // below fails PosScreenCoreFlow.test.tsx -> 'ignores a slower order-type-prompt read
  // from the previous store', on `div.pos-cart-order-type-row` (CartPanel.tsx:838).
  //
  // It went unnoticed because the round-82 sweep removed ALL THREE guards of this
  // shape at once and failed on the receipt case alone -- so this one and the
  // course-firing one both looked pinned. A blanket kill-test cannot say WHICH guard
  // is load-bearing; each needs its own run.
  const orderTypePromptSeq = useRef(0);
  useEffect(() => {
    const seq = ++orderTypePromptSeq.current;
    const stale = () => orderTypePromptSeq.current !== seq;
    getSettingScoped(sessionToken || null, 'restaurant.order_type_prompt')
      .then((raw) => {
        if (stale()) return;
        // `null` means never written, which is not the same as "false".
        setOrderTypePromptEnabled(raw === null ? activeWorkspace === 'restaurant-pos' : raw === 'true');
      })
      .catch(() => {
        if (stale()) return;
        // A failed read must not hide a restaurant's order-type selector; the
        // workspace default is the safe fallback, matching the pre-load value.
        setOrderTypePromptEnabled(activeWorkspace === 'restaurant-pos');
      });
    return () => { orderTypePromptSeq.current += 1; };
    // `activeWorkspace` IS a dependency, unlike the course-firing effect above:
    // that one's fallback is the workspace-independent `null`, while this one's
    // fallback is computed FROM the workspace. Omitting it would leave the
    // pre-switch workspace's answer in state after a store switch.
  }, [sessionToken, activeWorkspace]);

  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;
    void getSettingScoped(sessionToken, 'restaurant.customer_name')
      .then((raw) => { if (!cancelled) setCustomerNameEnabled(raw === null ? null : raw === 'true'); })
      .catch(() => { if (!cancelled) setCustomerNameEnabled(null); });
    void getSettingScoped(sessionToken, 'restaurant.guest_count')
      .then((raw) => { if (!cancelled) setGuestCountEnabled(raw === null ? null : raw === 'true'); })
      .catch(() => { if (!cancelled) setGuestCountEnabled(null); });
    void getSettingScoped(sessionToken, 'restaurant.save_tab')
      .then((raw) => { if (!cancelled) setSaveTabEnabled(raw === null ? null : raw === 'true'); })
      .catch(() => { if (!cancelled) setSaveTabEnabled(null); });
    void getSettingScoped(sessionToken, 'restaurant.print_bill_action')
      .then((raw) => { if (!cancelled) setPrintBillEnabled(raw === null ? null : raw === 'true'); })
      .catch(() => { if (!cancelled) setPrintBillEnabled(null); });
    void getSettingScoped(sessionToken, 'restaurant.split_bill_by_item')
      .then((raw) => { if (!cancelled) setSplitBillEnabled(raw === null ? null : raw === 'true'); })
      .catch(() => { if (!cancelled) setSplitBillEnabled(null); });
    void getSettingScoped(sessionToken, 'restaurant.dispatch_on_tab_save')
      .then((raw) => { if (!cancelled) setDispatchOnTabSave(raw === null ? null : raw === 'true'); })
      .catch(() => { if (!cancelled) setDispatchOnTabSave(null); });
    // F20: the Auto-Print KOT switch. A failed read keeps `null`, which the modal
    // treats as its default (print) — so a settings outage cannot silently stop a
    // kitchen printing tickets, the direction of failure that goes unnoticed.
    void getSettingScoped(sessionToken, 'restaurant.auto_print_kitchen')
      .then((raw) => { if (!cancelled) setAutoPrintKitchen(raw === null ? null : raw === 'true'); })
      .catch(() => { if (!cancelled) setAutoPrintKitchen(null); });
    // F21: the Order Sound Notifications switch, same contract as its siblings.
    void getSettingScoped(sessionToken, 'restaurant.sound_chime')
      .then((raw) => { if (!cancelled) setSoundChime(raw === null ? null : raw === 'true'); })
      .catch(() => { if (!cancelled) setSoundChime(null); });
    return () => { cancelled = true; };
  }, [sessionToken, settingsRevision]);

  // The same rails the payment modal consults for `autoKick` (PaymentModal:131).
  // Needed here so the till can honour the cash presets the operator configures.
  const { rails: paymentRails } = useLocalPaymentRails(sessionToken);

  // Precedence, highest first:
  //   1. the Cash rail's `presets` parameter — what the operator picked in
  //      Settings -> Payments (round 122 read side; the chips at
  //      RestaurantPaymentsScreen.tsx:1102 write it). THIS used to be skipped:
  //      the screen saved the choice and the till never saw it.
  //   2. `localStorage['restaurant-tender-presets']` — retained, but nothing in the repo
  //      writes it (round 105), so an external provisioner can still override.
  //   3. `defaultTenderPresets(activeCurrency)` — the currency ladder (round 106).
  const tenderPresets = useMemo(() => {
    const fromRail = cashTenderPresets(paymentRails);
    if (fromRail) return fromRail;
    try {
      const saved = localStorage.getItem('restaurant-tender-presets');
      if (saved) {
        const parsed = JSON.parse(saved) as number[];
        const filtered = parsed.filter((n) => Number.isFinite(n) && n > 0);
        if (filtered.length > 0) return filtered;
      }
    } catch { /* ignore */ }
    return defaultTenderPresets(activeCurrency);
  }, [activeCurrency, paymentRails]);

  /**
   * Exit Terminal — NAVIGATION, and it must always be reachable.
   *
   * This used to divert into `handleCloseShiftClick()` whenever a shift was open, on
   * the reasoning that leaving with an open shift should reconcile the cash first. The
   * intent is sound and the mechanism was not: close-shift REFUSES when the cart is not
   * empty and (since round 294) when a tab is outstanding, so the diversion turned a
   * navigation action into a dead end. Measured in a browser with an open tab:
   *
   * ```
   * PROBE RESULT homescreen=false closeshift=false opentab=true
   * ```
   *
   * The operator pressed "Exit Workspace", got an error about a tab, and stayed exactly
   * where they were. `setShowExitConfirm` is only reached when `activeShift === null`, so
   * there was no second route out — the till could not be left at all until the tab was
   * dealt with, by someone who already had their hand on the exit control.
   *
   * The two actions are genuinely different and are now separate:
   *   · Exit Workspace        — navigation, always available, its own copy confirms it
   *                             ("Exit Workspace / exit to the homescreen?")
   *   · Close Shift           — cash reconciliation, stays guarded, because THAT is the
   *                             surface where an unreconciled tab or cart is a real loss
   *
   * The dialog carries the warning instead of the guard, so the operator is told what
   * they are walking away from and then allowed to decide. Blocking someone from leaving
   * a screen is not a cash control; it is a lock-out.
   */
  const handleRequestExit = useCallback(() => {
    setShowExitConfirm(true);
  }, []);

  const handleOpenCashDrawer = useCallback(async () => {
    if (!sessionToken) {
      addToast({ message: requiredLocalized(l10n, 'pos-toast-auth-required'), type: 'error' });
      return;
    }
    try {
      const res = await openCashDrawerScoped(sessionToken);
      if (res && res.opened !== false) {
        addToast({ message: requiredLocalized(l10n, 'pos-toast-drawer-opened'), type: 'success' });
      } else {
        addToast({ message: requiredLocalized(l10n, 'pos-toast-drawer-unconfirmed'), type: 'warning' });
      }
    } catch (err) {
      addToast({
        // ERR-05: the interpolated raw error was reaching the cashier. The prefix
        // carried the context; the localized copy now carries it entirely.
        message: l10nErrorMessage(err, l10n, 'pos-cash-drawer-failed'),
        type: 'error',
      });
    }
  }, [sessionToken, addToast, l10n]);

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
        addToast({ message: requiredLocalized(l10n, 'pos-toast-product-not-found'), type: 'error' });
        return;
      }
      const groups = getProductModifierGroups(prod);
      if (groups.length === 0) {
        addToast({ message: requiredLocalized(l10n, 'pos-toast-no-modifiers'), type: 'info' });
        return;
      }
      setEditingCartLine(line);
      setEditingProduct(prod);
    },
    [products, sessionToken, addToast, l10n],
  );

  const handleConfirmEditModifiers = useCallback(
    (selections: ModifierSelection[], totalPriceMinor: number) => {
      if (!editingCartLine || !editingProduct) return;
      // READ THE RESULT. `updateLineModifiers` returns `false` and writes nothing when
      // the price's currency differs from the cart's anchor, and this handler
      // discarded it and closed the modal regardless — so a refused edit dismissed the
      // dialog, which reads to the cashier as "saved". The change was silently lost.
      //
      // The state is reachable: the restore paths fill `setLines` from a persisted
      // payload with no currency check (the `setLines(data.lines.map(…))` restore in
  // `usePosHeldCarts`, and the `setLines(revived)` draft restore in this file), so a
      // cart can hold a line whose currency differs from `lines[0]`.
      const applied = updateLineModifiers(
        editingCartLine.id,
        selections,
        { minor_units: totalPriceMinor, currency: editingCartLine.unit_price.currency },
      );
      if (!applied) {
        // Leave the modal OPEN so the operator can correct it, and say why. Closing
        // it is what made the failure invisible.
        addToast({
          message: requiredLocalized(l10n, 'pos-toast-line-price-currency-mismatch'),
          type: 'error',
        });
        return;
      }
      setEditingCartLine(null);
      setEditingProduct(null);
    },
    [editingCartLine, editingProduct, updateLineModifiers, addToast, l10n],
  );

  const handleSelectTableFromManagement = useCallback(
    (tableName: string) => {
      setShowTables(false);
      // ⚠️ THE TABLE IS CLAIMED ONLY IF THE RESUME SUCCEEDS.
      //
      // `setTableNumber(tableName)` used to run FIRST and unconditionally, with the
      // resume fired and forgotten (`void handleResumeOpenBill(...)`). That was
      // survivable while the resume always replaced the cart — but it does not any
      // more: it REFUSES when a different tab is already open (usePosHeldCarts,
      // round 96). So the operator tapped table 5, the table number was set, and the
      // resume was declined — leaving the PREVIOUS tab's lines sitting under table 5.
      // The refusal protected the cart and mislabelled it in the same breath, which
      // is worse than doing nothing.
      //
      // Ordering is now: try the resume, and set the table only when it reports that
      // the cart was actually replaced. A table with no matching bill is still
      // claimed immediately — there is nothing to refuse in that case.
      const matchingBill = openBills.find((b) => matchesTableBill(b, tableName));
      if (matchingBill) {
        void handleResumeOpenBill(matchingBill.id).then((resumed) => {
          if (resumed) setTableNumber(tableName);
        });
      } else {
        setTableNumber(tableName);
      }
      if (sessionToken) {
        void listTablesScoped(sessionToken)
          .then((tables) => {
            const bareInput = bareTableNumber(tableName);
            const match = tables.find(
              (t) =>
                t.name === tableName ||
                t.id === tableName ||
                (bareTableNumber(t.name) === bareInput && bareInput !== ''),
            );
            if (match && match.status === 'available') {
              return updateTableStatusScoped(sessionToken, match.id, 'reserved');
            }
          })
          // Same shape as the release above: the reservation is best-effort so it
          // cannot block the cashier seating a party, but a silent failure leaves
          // two terminals disagreeing about whether the table is taken — the exact
          // state the floor-plan sync exists to prevent.
          .catch(() => {
            addToast({ type: 'warning', message: requiredLocalized(l10n, 'tables-action-error') });
          });
      }
    },
    // addToast and l10n are read by the reservation warning toast above.
    [openBills, handleResumeOpenBill, sessionToken, addToast, l10n],
  );

  // ── Restaurant keyboard shortcuts (round 159) ───────────────────────────
  //
  // Restaurant-ONLY, gated on `activeWorkspace` like every other restaurant branch here
  // (each `activeWorkspace === 'restaurant-pos'` early return). The retail till shares
  // this component, so its handler object is empty and none of these keys exist
  // there.
  //
  // Each action routes through an EXISTING self-guarding handler:
  //   * `handlePrintBill` returns early on no lines, no total or no session;
  //   * `handleSendToKitchen` returns early on no session, no lines or no undelivered
  //     delta;
  //   * `setShowSplitBillModal(true)` opens the split MODAL, not its confirm, so the
  //     dine-in-only rule in `handleConfirmSplitBill` still applies;
  //   * `setShowTables(true)` is the sidebar row's own action, already feature-gated.
  //
  // ⚠️ The three ranges above are the only thing making the 'self-guarding' claim
  // checkable, and they had ALL drifted — by 68, 146 and 80 lines respectively. A
  // stale range is worse than none: it points a reader at unrelated code and makes an
  // assertion look verified when nothing was checked, which is the shape that hid a
  // false claim in round 126. Re-point them when the handlers move rather than
  // deleting them.
  //
  // Save Tab is the one exception and it is deliberate. Its precondition chain (shift
  // guard + the open-bill-input branch) is INLINE component logic in CartActionBar, so
  // the shortcut CLAIMS the button through its testid and clicks it. That runs the same
  // code the button runs — including the guard that stops a tab being saved with no
  // table — rather than a copy that would drift from it.
  // A sub-screen REPLACES the sale view (`showTables`/`showSalesHistory`/
  // `showStockInquiry` each early-return below), but this hook registers a
  // DOCUMENT-level keydown listener and was still live behind them — so on the
  // Table Management screen `Shift+B` opened the split-bill modal OVER the
  // table list, acting on a cart the cashier could not see, and `Shift+T`
  // reached into the DOM for a save-tab button that is not even mounted there.
  // The keys belong to the sale view, so they are unbound while it is absent.
  const saleViewVisible = !showTables && !showSalesHistory && !showStockInquiry;
  const restaurantShortcutHandlers = useMemo<RestaurantShortcutHandlers>(() => {
    if (activeWorkspace !== 'restaurant-pos' || !saleViewVisible) return {};
    return {
      'send-kitchen': () => { void handleSendToKitchen(); },
      'print-bill': () => { void handlePrintBill(); },
      'split-bill': () => { setShowSplitBillModal(true); },
      'save-tab': () => {
        const btn = document.querySelector<HTMLButtonElement>(
          '[data-testid="pos-cart-save-tab-btn"]',
        );
        if (btn && !btn.disabled) btn.click();
      },
      'open-tables': () => { setShowTables(true); },
    };
  }, [activeWorkspace, saleViewVisible, handleSendToKitchen, handlePrintBill]);

  useRestaurantShortcuts(restaurantShortcutHandlers);

  // ── Escape: unwind this screen, never navigate away ──────────────────
  //
  // AppShell's workspace shortcuts RESERVE Escape in restaurant-pos: the
  // `active !== 'restaurant-pos'` clause at AppShell.tsx:79 deliberately withholds
  // the return-to-picker behaviour here, so an accidental keypress mid-service
  // cannot throw away a sale in progress. The reservation exists for THIS
  // workspace to claim the key — and until now nothing did, so Escape was simply
  // dead in restaurant-pos: no way out of a sub-screen, and no dismissal of any
  // overlay, without reaching for the mouse.
  //
  // Scope, outermost first: a sub-screen (each of the seven is an early return
  // below), then the sidebar popover, then the dialogs. Nothing here navigates.
  // `isAnyAriaModalOpen()` is NOT consulted — it is the guard the topmost modal
  // uses to claim Escape for itself (useFocusTrap), and deferring to it is what
  // keeps the payment dialog's own handling authoritative. That is why the
  // sub-screen branch matters most: a sub-screen is not a modal, so nothing
  // else owns Escape while it is open.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // ⚠️ A MODAL INSIDE A SUB-SCREEN OWNS THE KEY, and this cascade must stand down.
      //
      // The comment above says `isAnyAriaModalOpen()` is deliberately not consulted, on
      // the grounds that "a sub-screen is not a modal, so nothing else owns Escape while
      // it is open". That is true of the sub-screen ITSELF and false of an ARIA modal
      // opened INSIDE it — the table detail panel is one, as are an item form and a
      // confirm. Measured 2026-10-18: with the detail panel open, Escape closed the panel
      // AND the whole table view behind it, 12 tiles to 0, because this cascade acted on a
      // key the panel had already handled.
      //
      // Order is what makes this necessary rather than merely tidy: both listeners sit on
      // `document` in the bubble phase and this one is registered FIRST, so it runs before
      // the panel trap. Neither `defaultPrevented` (not yet set) nor `stopPropagation()`
      // (which does not reach a sibling listener on the SAME node) can help from there.
      // Asking whether a modal is open is the only question that answers correctly here.
      //
      // The guard stays narrow: a modal is only ever a sub-screen child, never the
      // sub-screen itself, so the sub-screen branches below still own Escape when no
      // modal is up.
      if (isAnyAriaModalOpen()) return;
      if (isEditableTarget(e.target)) return;
      if (showTables) { setShowTables(false); return; }
      if (showSalesHistory) { setShowSalesHistory(false); return; }
      if (showStockInquiry) { setShowStockInquiry(false); return; }
      if (showMenuEditor) { setShowMenuEditor(false); return; }
      if (showReceiptsSettings) { setShowReceiptsSettings(false); return; }
      if (showPaymentsSettings) { setShowPaymentsSettings(false); return; }
      if (showRestaurantSettings) { setShowRestaurantSettings(false); return; }
      if (restaurantSidebarOpen) { setRestaurantSidebarOpen(false); return; }
      if (showSplitBillModal) { setShowSplitBillModal(false); return; }
      if (showExitConfirm) { setShowExitConfirm(false); return; }
      if (showTableNumberSetting) { setShowTableNumberSetting(false); return; }
      if (showPromotions) { setShowPromotions(false); return; }
      if (showDiscountInput) { setShowDiscountInput(false); return; }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [showTables, showSalesHistory, showStockInquiry, showMenuEditor, showReceiptsSettings,
      showPaymentsSettings, showRestaurantSettings, restaurantSidebarOpen, showSplitBillModal,
      showExitConfirm, showTableNumberSetting, showPromotions, showDiscountInput]);

  // ⚠️ DECLARED ABOVE THE SUB-SCREEN EARLY RETURNS, NOT BELOW THEM.
  //
  // This callback sat at 2161 in commit 4b7d5cf4c, i.e. after every sub-screen
  // early return in this component (`showTables`, `showSalesHistory`,
  // `showStockInquiry`, `showReceipts`, ... eight of them). React's rules-of-hooks
  // require every hook to run in the same order on EVERY render, so on any sub-view
  // this hook was simply never registered — and `RestaurantMenu`'s `onAddProduct`
  // resolved to `undefined` there. `npm run lint` caught it as
  // `react-hooks/rules-of-hooks` once another lane’s file landed; the runtime
  // consequence is the Menu Editor’s add path being inert whenever a sub-screen
  // had been visited.
  // Its only dependency is `handleAddProduct`, destructured from `usePosCartActions`
  // well before any early return, so moving it up is safe and changes no behaviour
  // on the sale view.
  const handleRestaurantAddProduct = useCallback(
    (product: Product, meta?: { courseId?: CourseId; modifiers?: ModifierSelection[] }) => {
      const defaultCourse = courseFiringEnabled
        ? (meta?.courseId ?? inferCourseForProduct(product) ?? undefined)
        : undefined;
      const combinedMeta = defaultCourse || meta?.modifiers
        ? {
            ...(defaultCourse ? { courseId: defaultCourse } : {}),
            ...(meta?.modifiers ? { modifiers: meta.modifiers } : {}),
          }
        : undefined;
      handleAddProduct(product, combinedMeta);
    },
    [handleAddProduct, courseFiringEnabled],
  );

  // ── Sub-screen: Table Management ─────────────────────────────
  if (showTables) {
    return (
      <div className="pos-screen">
        <div style={{ flex: 1, overflow: 'auto' }}>
          {/* Crash isolation (F9): this screen and Sales History below were the two
              sub-screens of SIX that had no boundary, so a throw in either took the
              whole POS down mid-service — with a cart in progress. `onReset` returns
              to the sale, which is where the cashier needs to be. */}
          <LocalizedErrorBoundary onReset={() => setShowTables(false)}>
            <TableManagementScreen
              onSelectTable={handleSelectTableFromManagement}
              onBack={() => setShowTables(false)}
            />
          </LocalizedErrorBoundary>
        </div>
      </div>
    );
  }

  // ── Sub-screen: Sales History (F6) ───────────────────────────
  if (showSalesHistory) {
    return (
      <div className="pos-screen" style={{ flexDirection: 'column' }}>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {/* Crash isolation (F9) — see the Table Management note above. */}
          <LocalizedErrorBoundary onReset={() => setShowSalesHistory(false)}>
            <SalesHistoryScreen onBack={() => setShowSalesHistory(false)} />
          </LocalizedErrorBoundary>
        </div>
      </div>
    );
  }

  // ── Sub-screen: Stock Inquiry (F8) ───────────────────────────
  if (showStockInquiry) {
    return (
      <div className="pos-screen">
        <div style={{ flex: 1, overflow: 'auto' }}>
          {/* Crash isolation (F9) — the third of the three that had no boundary. */}
          <LocalizedErrorBoundary onReset={() => setShowStockInquiry(false)}>
            <ProductLookupScreen
              onAddProduct={handleAddProduct}
              onBack={() => setShowStockInquiry(false)}
            />
          </LocalizedErrorBoundary>
        </div>
      </div>
    );
  }

  // ── Sub-screen: Restaurant Menu Editor ───────────────────────
  if (showMenuEditor) {
    return (
      <div className="pos-screen">
        <div style={{ flex: 1, overflow: 'auto' }}>
          {/* Crash isolation (F9): a throw in a settings sub-screen must not take
              the POS screen with it. `onReset` returns to the sale. */}
          <LocalizedErrorBoundary onReset={() => { setShowMenuEditor(false); setMenuRevision((r) => r + 1); reloadPosProducts(); }}>
            <RestaurantMenuEditorScreen
              onBack={() => {
                setShowMenuEditor(false);
                setMenuRevision((r) => r + 1);
                reloadPosProducts();
              }}
              sessionToken={sessionToken}
            />
          </LocalizedErrorBoundary>
        </div>
      </div>
    );
  }

  // ── Sub-screen: Restaurant Receipts Settings ─────────────────
  if (showReceiptsSettings) {
    return (
      <div className="pos-screen">
        <div style={{ flex: 1, overflow: 'auto' }}>
          <LocalizedErrorBoundary onReset={() => setShowReceiptsSettings(false)}>
            <RestaurantReceiptsScreen
              onBack={() => setShowReceiptsSettings(false)}
              tablesEnabled={isEnabled(FEATURES.TABLE_MANAGEMENT)}
            />
          </LocalizedErrorBoundary>
        </div>
      </div>
    );
  }

  // ── Sub-screen: Restaurant Payments Settings ─────────────────
  if (showPaymentsSettings) {
    return (
      <div className="pos-screen">
        <div style={{ flex: 1, overflow: 'auto' }}>
          <LocalizedErrorBoundary onReset={() => setShowPaymentsSettings(false)}>
            <RestaurantPaymentsScreen onBack={() => setShowPaymentsSettings(false)} />
          </LocalizedErrorBoundary>
        </div>
      </div>
    );
  }

  // ── Sub-screen: Restaurant General Settings ──────────────────
  if (showRestaurantSettings) {
    return (
      <div className="pos-screen">
        <div style={{ flex: 1, overflow: 'auto' }}>
          <LocalizedErrorBoundary onReset={() => { setShowRestaurantSettings(false); setSettingsRevision((r) => r + 1); }}>
            <RestaurantSettingsScreen onBack={() => { setShowRestaurantSettings(false); setSettingsRevision((r) => r + 1); }} />
          </LocalizedErrorBoundary>
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
          {/* This branch IS the whole screen when there is no session, so its
              heading is the page title. It was an <h2> on a screen with no <h1>. */}
          <Localized id="pos-login-required">
            <h1>Login Required</h1>
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
    customerNameEnabled: customerNameEnabled ?? true,
    guestCountEnabled: guestCountEnabled ?? true,
    saveTabEnabled: saveTabEnabled ?? true,
    orderType,
    setOrderType,
    orderTypePromptEnabled,
  };
  // Assign the course locally AND persist it, in that order: the device-local
  // assignment is what the UI renders and must not wait on a round trip, and the
  // server copy is what survives a restart. `syncLineCourse` is best-effort (it
  // swallows its own failure and logs), so a sync problem can never block the
  // cashier from putting a course on a line mid-service.
  // A PLAIN function, not useCallback: this sits below the screen's early returns,
  // and a hook cannot be called conditionally. Nothing here needs memoization -- the
  // object below is rebuilt every render anyway, so a stable identity would buy
  // nothing and would be the only hook in this region.
  const assignCourseAndSync = (lineId: LineId, courseId: CourseId) => {
    assignCourse(lineId, courseId);
    void syncLineCourse(lineId, courseId);
  };
  const cartLineRows = {
    lines, fireCourse, fireAllCourses, assignCourse: assignCourseAndSync, setCartLineRef,
    handleRemoveLine, handleDecreaseQty, handleIncreaseQty,
    updateLineNote,
    onEditModifiers: handleEditModifiers,
    isManager,
    // Priced overrides require `sales:override_price` on the backend, which a
    // custom role may hold independently of being a "manager". `isManager`
    // remains the fallback for a session carrying no grant list.
    canOverridePrice: hasPermission('sales:override_price', isManager),
    setOverrideTarget, ensureCart,
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
    printBillEnabled: printBillEnabled ?? true,
    handlePrintBill,
    splitBillEnabled: splitBillEnabled ?? true,
    showSplitBillModal,
    setShowSplitBillModal,
    handleConfirmSplitBill,
    hasUndispatchedItems,
    sendingToKitchen,
    handleSendToKitchen,
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
    // F7/D4: hide the row when KDS is unreachable rather than let it no-op or
    // bounce to Products. Computed with the SAME predicate the shell's
    // `handleNavigate` uses (`isPageAccessible`), so the row is visible exactly
    // when the navigation would succeed — a second predicate would be free to
    // disagree with the thing it is predicting.
    //
    // THAT PREDICATE ALONE IS INERT FOR THIS ROUTE (round 128). `getPage('kds')`
    // is `{ route: 'kds', feature: 'kitchen-display' }` — no `requiredRole`, no
    // `requiredPermission` — and `isPageAccessible` -> `passesGate` reads only
    // those two, returning true when neither is set (`page-registry/index.ts:181`).
    // So it answered `true` for Owner, Cashier, an empty role and a garbage role
    // alike, and the row never hid. The feature flag is the gate that actually
    // varies, which is how its sibling `showTables` has always been written.
    // Kept AND-ed with `isPageAccessible` rather than replacing it: the role and
    // permission axes still apply the moment this route gains one.
    showKitchenDisplay:
      isEnabled(FEATURES.KITCHEN_DISPLAY) &&
      isPageAccessible(getPage('kds'), session?.role_name ?? '', session?.permissions),
    onOpenKitchenDisplay: () => onNavigate?.('kds'),
    onOpenMenuEditor: () => setShowMenuEditor(true),
    onOpenReceipts: () => setShowReceiptsSettings(true),
    onOpenPayments: () => setShowPaymentsSettings(true),
    onOpenSettings: () => setShowRestaurantSettings(true),
    onOpenCashDrawer: handleOpenCashDrawer,
    onRequestExit: handleRequestExit,
  };


  return (
    <>
    {/* ── Session died MID-SHIFT ──────────────────────────────────────────
        The AppShell banner keys on `sessionError`, which is set only when a REJECTED
        `createSession` fails at boot. A session that expires during a shift never sets
        it — an IPC command answers `invalidSession` instead, and this screen used to
        swallow that kind silently (`if (kind === 'invalidSession') return;`), which is
        right for a per-card settings read and wrong as the ONLY handling. The cashier
        could not take payment and nothing said why.

        Styled by PosScreen.css rather than importing the analytics component: its class
        names are `analytics-session-banner*`, and AnalyticsScreen.css reaches the tablet
        shell via tablet.css but NOT the desktop shell, so reusing it would render an
        unstyled alert there. */}
    {showSessionBanner && (
      <div className="pos-session-banner" role="alert" data-testid="pos-session-banner">
        <span>{requiredLocalized(l10nRef.current, 'analytics-session-expired-message')}</span>
        <button
          type="button"
          className="pos-session-banner-action"
          onClick={goToWorkspacePicker}
        >
          {requiredLocalized(l10nRef.current, 'analytics-sign-in-again')}
        </button>
      </div>
    )}
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
      {/* ── Section: Product lookup / menu ─────────────────── */}
      <section className="pos-products">
        {/* Crash isolation (F9) at the SHELL level, not only inside it. Round 20
            wrapped two children of RestaurantMenu, but the component itself is
            rendered here and was still bare: a throw in its own body — the header,
            the preferences state, the hooks — propagated out of this ternary and
            took the POS screen down. The children's boundaries only cover what
            renders INSIDE them. */}
        {activeWorkspace === 'restaurant-pos' ? (
          <LocalizedErrorBoundary resetKeys={[activeWorkspace, menuRevision]}>
          <RestaurantMenu
            key={menuRevision}
            onAddProduct={handleRestaurantAddProduct}
            sidebarOpen={restaurantSidebarOpen}
            onSidebarOpenChange={setRestaurantSidebarOpen}
            cartActions={restaurantCartActions}
            profile={restaurantProfile}
            onChangePhoto={() => { void handleChangePhoto(); }}
            onRequestExit={handleRequestExit}
            isManager={isManager}
            hasFloatingCartBar={isPortraitRestaurant}
          />
          </LocalizedErrorBoundary>
        ) : (
          <LocalizedErrorBoundary resetKeys={[activeWorkspace]}>
          <ProductLookupScreen onAddProduct={handleAddProduct} />
          </LocalizedErrorBoundary>
        )}
      </section>

      {/* ── Resize handle & Cart panel (landscape / desktop) ── */}
      {!isPortraitRestaurant && (
        <CartPanel
          {...cartPanelProps}
          hidden={activeWorkspace === 'restaurant-pos' && restaurantSidebarOpen}
        />
      )}

      {/* ── Restaurant Portrait: Floating Cart Bar & Bottom Sheet Drawer ── */}
      {/* Crash isolation (F9). Portrait — the TABLET form factor — is where the
          restaurant actually runs, and these two are the cashier's ONLY route to the
          cart there: the bar opens the sheet, and the sheet is where the sale is
          edited. Unwrapped, a throw in either unmounted the whole POS screen and took
          the cart with it mid-sale, which is the F9 failure. They were missed by
          restaurantPosCrashIsolation.test.ts because neither name ends in `Screen` or
          `Modal` — the shape every other guarded entry happens to have. Both are now
          listed there, so removing a boundary fails that guard. */}
      {isPortraitRestaurant && (
        <LocalizedErrorBoundary resetKeys={[String(lines.length), activeWorkspace]}>
          <RestaurantFloatingCartBar
            lines={lines}
            total={total}
            tableNumber={tableNumber}
            orderType={orderType}
            onOpenCart={() => setCartSheetOpen(true)}
          />
          <RestaurantCartSheet
            open={cartSheetOpen}
            onClose={() => setCartSheetOpen(false)}
            tableNumber={tableNumber}
            orderType={orderType}
          >
            <LocalizedErrorBoundary resetKeys={[String(lines.length)]}>
              <CartPanel
                {...cartPanelProps}
                hidden={false}
              />
            </LocalizedErrorBoundary>
          </RestaurantCartSheet>
        </LocalizedErrorBoundary>
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
      {/* Crash isolation (F9), and the highest-stakes surface for it: this is the
          money dialog, opened after the tender is chosen. Without a scoped boundary
          a throw here was caught only by AppProviders' FULL-PAGE boundary, whose
          recovery is a 30s auto-reload — which replaces the POS and logs the cashier
          out mid-transaction. `onReset` closes the dialog and returns to the cart,
          which is where they need to be. `autoRefreshMs` is deliberately omitted:
          that prop belongs to full-page boundaries (AppProviders:28-31). */}
      {total && (
        <LocalizedErrorBoundary onReset={() => setShowPayment(false)}>
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
          tenderPresets={tenderPresets}
          // F20: undefined means "not loaded / never written", which the modal
          // resolves to its default (print). Passing `null` through would make an
          // unread setting indistinguishable from an explicit false.
          {...(autoPrintKitchen === null ? {} : { autoPrintKitchen })}
          deductionLocationId={deductionLocationIdRef.current}
          onComplete={handlePaymentComplete}
          onClose={() => setShowPayment(false)}
        />
        </LocalizedErrorBoundary>
      )}

      {/* ── Price Override modal ─────────────────────── */}
      {/* Crash isolation (F9): this modal writes the line price. `resetKeys` keys on
          the target so picking a different line clears a caught error. */}
      {overrideTarget && (
        <LocalizedErrorBoundary onReset={() => setOverrideTarget(null)} resetKeys={[overrideTarget.id]}>
        <PriceOverrideModal
          open
          lineDescription={`${overrideTarget.name ?? overrideTarget.sku} — ${formatMoney(overrideTarget.unit_price)}`}
          currentPrice={overrideTarget.unit_price}
          onConfirm={handleOverrideConfirm}
          onClose={() => setOverrideTarget(null)}
        />
        </LocalizedErrorBoundary>
      )}

      {/* ── Promotions picker modal ───────────────────── */}
      {/* Crash isolation (F9): applying a promotion changes the discount on the
          sale. `resetKeys` on the open flag so reopening clears a caught error. */}
      <LocalizedErrorBoundary onReset={() => setShowPromotions(false)} resetKeys={[showPromotions]}>
      <PromotionsModal
        open={showPromotions}
        sessionToken={sessionToken}
        subtotalMinor={subtotal?.minor_units ?? 0}
        initiallySelectedIds={appliedPromotions.map((p) => p.id)}
        onApply={handleSelectPromotions}
        onClose={() => setShowPromotions(false)}
      />
      </LocalizedErrorBoundary>

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
      {/* Crash isolation (F9) on the shift family. These carry the CASH DRAWER
          reconciliation figures, so a throw here lands on the operator mid-count;
          `onReset` closes the modal back to the sale rather than reloading the app. */}
      <LocalizedErrorBoundary onReset={() => closeShiftExit.requestClose()}>
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
      </LocalizedErrorBoundary>

      <LocalizedErrorBoundary onReset={() => shiftSummaryExit.requestClose()}>
      <ShiftSummary
        shiftSummaryExit={shiftSummaryExit}
        closedShiftSummary={closedShiftSummary}
        currency={activeCurrency}
      />
      </LocalizedErrorBoundary>

      <LocalizedErrorBoundary onReset={() => openShiftExit.requestClose()}>
      <OpenShiftModal
        openShiftExit={openShiftExit}
        openingBalance={openingBalance}
        setOpeningBalance={setOpeningBalance}
        openingShift={openingShift}
        handleConfirmOpenShift={handleConfirmOpenShift}
        currency={activeCurrency}
      />
      </LocalizedErrorBoundary>

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
        // The warning the old guard was trying to deliver, delivered as INFORMATION.
        //
        // A shift that is still open (or a tab still outstanding) is worth saying out
        // loud before someone walks away from the till — that is the real safety
        // property. Refusing to navigate is not: it produced a dead end, and the
        // operator could not act on the refusal from the exit control they were using.
        // So the message names what is being left behind and the operator decides.
        message={
          activeShift !== null
            ? l10n.getString('restaurant-exit-confirm-open-shift-desc')
            : l10n.getString('restaurant-exit-confirm-desc')
        }
        variant="warning"
        confirmLabel={l10n.getString('restaurant-exit-confirm-btn')}
      />

      {/* ── Item Modifier Modal (in-cart customization editing) ────── */}
      {/* Crash isolation (F9), the same surface wrapped in RestaurantMenu
          (the `LocalizedErrorBoundary` with `resetKeys={[customizingProduct.sku]}` in
      RestaurantMenu.tsx) and for the same reason: this is where an existing
          cart line's options and PRICE are edited, so a throw must cost the dialog,
          not the sale. `resetKeys` keys on the line so editing a different line
          clears a caught error. */}
      {editingCartLine && editingProduct && (
        <LocalizedErrorBoundary
          onReset={() => { setEditingCartLine(null); setEditingProduct(null); }}
          resetKeys={[editingCartLine.id]}
        >
        <ItemModifierModal
          open={true}
          productName={editingProduct.name}
          basePriceMinor={editingProduct.price.minor_units}
          currency={editingCartLine.unit_price.currency}
          groups={editingModifierGroups}
          initialSelections={editingCartLine.modifiers}
          onConfirm={handleConfirmEditModifiers}
          onClose={() => {
            setEditingCartLine(null);
            setEditingProduct(null);
          }}
        />
        </LocalizedErrorBoundary>
      )}
    </div>
  </>
  );
}
