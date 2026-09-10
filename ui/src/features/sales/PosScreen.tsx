/* eslint-disable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions */
// The two rules above flag the cart-panel `<aside role="region">`
// (which has a window-scoped keyboard handler for ↑/↓/+/-/Del/Enter)
// and the per-line `<div role="group" tabIndex={0}>` (composite
// interactive widget containing qty + remove). Both patterns are
// valid ARIA — the lint rules only catch the non-interactive defaults.
import { useCallback, useState, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useToast } from '@/frontend/shared/Toast';
import { requiredLocalized } from '@/frontend/shared';
import { useAuth } from '@/contexts/AuthContext';
import { Localized } from '@/components/Localized';
import { useLocalization } from '@fluent/react';
import ProductLookupScreen from '@/features/products/ProductLookupScreen';
import { plainErrorMessage } from '@/utils/app-error';
import { l10nErrorMessage } from '@/utils/app-error';
import RestaurantMenu from '@/features/restaurant/RestaurantMenu';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useFeatures, FEATURES } from '@/hooks/useFeatures';
import TableManagementScreen from '@/features/tables/TableManagementScreen';
import SalesHistoryScreen from '@/features/sales/SalesHistoryScreen';

import WorkspaceSettingsModal from '@/features/settings/WorkspaceSettingsModal';
import { formatMoney, COURSES, type CartId, type CartLine, type LineId, type Product, type Sku } from '@/types/domain';
import { animDuration } from '@/utils/animation';
import { triggerInteraction } from '@/utils/interaction';
import { useSwipe } from '@/hooks/useSwipe';
import { useExitAnimation } from '@/hooks/useExitAnimation';
import { useAnimatedUndoStack } from '@/hooks/useAnimatedUndoStack';
import {
  holdCartScoped,
  listOpenBillsScoped,
  getHeldCartScoped,
  deleteHeldCartScoped,
  startSaleScoped,
  getCartDeductionLocation,
  getCartDeductionLocationScoped,
  type HeldCartRow,
} from '@/api/sales';
import { getReceiptSettingsScoped } from '@/api/settings';
import { useCartTax, type CartTaxCacheState } from '@/hooks/useCartTax';
import type { CartLineTaxInput } from '@/api/tax';
import { lookupByBarcodeScoped, lookupProductBySkuScoped } from '@/api/products';
import { lookupBundleBySku } from '@/api/bundles';
import { expandBundleItems } from './bundleExpansion';
import type { BarcodeScannedPayload } from '@/api/hardware';
import { usePosState } from './usePosState';
import { useBarcodeScanner } from './useBarcodeScanner';
import { useCustomerDisplay } from './useCustomerDisplay';
import PaymentModal from './PaymentModal';
import PriceOverrideModal from './PriceOverrideModal';
import PromotionsModal from './PromotionsModal';
import type { Promotion } from '@/api/promotions';
import FastPINOverlay from '@/components/FastPINOverlay';
import { overrideLinePriceScoped, overrideCartDeductionLocation } from '@/api/sales';
import {
  getActiveShiftScoped,
  openShiftScoped,
  closeShiftScoped,
  type ShiftDto,
} from '@/api/shifts';

import './PosScreen.css';
import './CartPanel.css';
import './CartPanelLineItem.css';
import './CartPanelFooterTotals.css';
import './CartPanelActions.css';
import './CartPanel.brand.css';
import './CartPanelCourseBar.css';

// ── Cart panel width, viewport-aware ──────────────────────────────────
/**
 * Bounds for the cart's right panel.
 *
 * The panel may grow to half the viewport but never wider than
 * `1200 px` so the menu stays usable. The `320 px` floor keeps qty
 * controls and line text legible on small terminals. Default is
 * `440 px`, comfortable for the line-item cards. A `resize`
 * listener re-clamps the saved width when the window is resized —
 * important when the cashier drags a window between monitors or a
 * laptop docks into a 4K display.
 */
const CART_WIDTH_MIN = 320;
const CART_WIDTH_DEFAULT = 440;
const CART_WIDTH_MAX_CAP = 1200;

// ── F2-3: cart-tax watcher (R36-19 / D64) ──────────────────────────
// The hook owns the compute and the failure-window cache; the screen
// consumes its state through this keyed child. Bumping the key remounts
// the watcher and forces a fresh compute — the retry affordance for a
// failed estimate, without changing the cart or the hook contract.
const IDLE_TAX_STATE: CartTaxCacheState = {
  severity: 'unknown',
  taxMinor: 0,
  hasExclusive: null,
  estimated: false,
  cacheFresh: false,
};

function CartTaxWatcher({
  sessionToken,
  lines,
  currency,
  onState,
}: {
  sessionToken: string | null;
  lines: CartLineTaxInput[];
  currency: string;
  onState: (state: CartTaxCacheState) => void;
}) {
  const state = useCartTax(sessionToken, lines, currency);
  useEffect(() => {
    onState(state);
  }, [state, onState]);
  return null;
}

function clampCartWidth(px: number, viewportWidth: number): number {
  const max = Math.max(
    CART_WIDTH_MIN,
    Math.min(viewportWidth * 0.5, CART_WIDTH_MAX_CAP),
  );
  return Math.max(CART_WIDTH_MIN, Math.min(Math.round(px), max));
}

/**
 * Deterministic per-SKU thumbnail: stable monogram letter + hashed
 * hue. The hue is exposed to CSS via a custom property so light and
 * dark modes can theme the tile colour from the stylesheet.
 */
function lineThumbnail(sku: string): { initial: string; hue: number } {
  let hash = 0;
  for (let i = 0; i < sku.length; i++) {
    hash = (hash * 31 + sku.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  const initialMatch = sku.match(/[A-Za-z0-9]/);
  // `sku.charAt(0)` always returns string (unlike `sku[0]` which is
  // `string | undefined` under noUncheckedIndexedAccess).
  const chosen: string = initialMatch?.[0] ?? sku.charAt(0) ?? '?';
  return { initial: chosen.toUpperCase(), hue };
}

/**
 * Split an elapsed duration (ms) into whole hours + minutes, floored.
 * Used for the live shift timer in the cart header.
 */
function elapsedHoursMinutes(sinceMs: number, nowMs: number): { h: number; m: number } {
  const totalMinutes = Math.max(0, Math.floor((nowMs - sinceMs) / 60_000));
  return { h: Math.floor(totalMinutes / 60), m: totalMinutes % 60 };
}

/** Minus icon SVG */
function MinusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

/** Plus icon SVG */
function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
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

// ── Swipeable cart line item ──────────────────────────────────────────

interface CartLineItemProps {
  line: CartLine;
  onRemove: (line: CartLine) => void;
  onDecreaseQty: (line: CartLine) => void;
  onIncreaseQty: (line: CartLine) => void;
  onOverride?: (line: CartLine) => void;
  /**
   * Registers the line DOM node so the parent can move focus during
   * keyboard navigation (↑ / ↓). When omitted the line is rendered
   * focusless (e.g. in unit-test environments that don't render a DOM).
   */
  registerRef?: (lineId: LineId, el: HTMLDivElement | null) => void;
}

function CartLineItem({
  line,
  onRemove,
  onDecreaseQty,
  onIncreaseQty,
  onOverride,
  registerRef,
}: CartLineItemProps) {
  const { l10n } = useLocalization();
  const [revealed, setRevealed] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [qtyFlash, setQtyFlash] = useState(false);
  const prevQty = useRef(line.qty);
  const swipe = useSwipe({
    onSwipeLeft: () => setRevealed(true),
    onSwipeRight: () => setRevealed(false),
  });
  // Compute once per render.
  const thumbnail = lineThumbnail(String(line.sku));

  const MS_200 = animDuration(200);

  // When exit animation starts, remove the line after it completes.
  useEffect(() => {
    if (!exiting) return;
    const timer = setTimeout(() => onRemove(line), MS_200);
    return () => clearTimeout(timer);
  }, [exiting, onRemove, line, MS_200]);

  // Flash + click on qty change.
  useEffect(() => {
    if (prevQty.current !== line.qty) {
      prevQty.current = line.qty;
      setQtyFlash(true);
      triggerInteraction('qty-change');
      const timer = setTimeout(() => setQtyFlash(false), 350);
      return () => clearTimeout(timer);
    }
  }, [line.qty]);

  const handleRemove = useCallback(() => {
    setExiting(true);
    setRevealed(false);
    triggerInteraction('remove-item');
  }, []);

  return (
    <div
      className={`pos-cart-line-wrap ${revealed ? 'pos-cart-line-wrap--revealed' : ''} ${exiting ? 'pos-cart-line-wrap--exiting' : ''} ${qtyFlash ? 'pos-cart-line-wrap--qty-flash' : ''}`}
      {...swipe}
    >
      <div
        className="pos-cart-line"
        ref={(el) => registerRef?.(line.id, el)}
        tabIndex={0}
        data-line-id={line.id}
        data-testid="cart-panel-line-item"
        role="group"
        aria-label={l10n.getString('pos-cart-line-aria', { sku: String(line.sku), qty: String(line.qty), amount: formatMoney(line.unit_price) })}
      >
        {/* 1 — Thumbnail */}
        <span
          className="pos-cart-line-thumb"
          style={{ '--thumb-hue': thumbnail.hue } as CSSProperties}
          aria-hidden="true"
        >
          {thumbnail.initial}
        </span>

        {/* 2 — Name + price */}
        <div className="pos-cart-line-info">
          <div className="pos-cart-line-name">{line.name ?? line.sku}</div>
          <div className="pos-cart-line-price">
            <span className="pos-cart-line-price-at">@</span> {formatMoney(line.unit_price)}
          </div>
          {onOverride && (
            <button
              type="button"
              className="pos-cart-line-override"
              onClick={() => onOverride(line)}
              aria-label={l10n.getString('pos-cart-line-override-aria', { name: line.name ?? line.sku }, 'Override price')}
            >
              <Localized id="pos-cart-line-override">Override</Localized>
            </button>
          )}
        </div>

        {/* 3 — Qty controls */}
        <div className="pos-cart-line-controls">
          <button
            type="button"
            className="pos-cart-qty-btn"
            onClick={() => onDecreaseQty(line)}
            disabled={line.qty <= 1}
            aria-label={l10n.getString('pos-cart-line-decrease-aria', { sku: String(line.sku) })}
          >
            <MinusIcon />
          </button>
          <span className="pos-cart-qty-value" aria-label={l10n.getString('pos-cart-line-qty-aria', { qty: String(line.qty) })}>
            {line.qty}
          </span>
          <button
            type="button"
            className="pos-cart-qty-btn"
            onClick={() => onIncreaseQty(line)}
            aria-label={l10n.getString('pos-cart-line-increase-aria', { sku: String(line.sku) })}
          >
            <PlusIcon />
          </button>
        </div>

        {/* 4 — Remove button */}
        <button
          type="button"
          className="pos-cart-line-remove"
          onClick={handleRemove}
          aria-label={l10n.getString('pos-cart-line-remove-aria', { sku: String(line.sku) })}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Category ribbon */}
        {line.category && (
          <span
            className="pos-cart-line-ribbon"
            style={{ '--thumb-hue': thumbnail.hue } as CSSProperties}
            aria-hidden="true"
          />
        )}
      </div>

      {/* Revealed swipe action */}
      <div className="pos-cart-line-swipe-action" aria-hidden={!revealed}>
        <button
          type="button"
          className="pos-cart-line-swipe-remove"
          onClick={handleRemove}
          aria-label={l10n.getString('pos-cart-line-swipe-remove-aria', { sku: String(line.sku) })}
        >
          <Localized id="pos-cart-remove">
            <span>Remove</span>
          </Localized>
        </button>
      </div>
    </div>
  );
}

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

  const [activeShift, setActiveShift] = useState<ShiftDto | null>(null);
  const activeShiftRef = useRef(activeShift);
  activeShiftRef.current = activeShift;
  const [shiftLoading, setShiftLoading] = useState(true);
  // Live elapsed-shift clock: while a shift is open, tick every minute so
  // the header can show a running "2h 15m" instead of the bare opening
  // time (which read like a wall clock). The interval stops when the
  // shift closes — activeShift → null runs the effect's cleanup.
  const [shiftNow, setShiftNow] = useState(() => Date.now());
  useEffect(() => {
    if (!activeShift) return;
    // Rebase the elapsed anchor the instant a shift becomes active so the
    // first render is accurate even if the screen was mounted long before.
    setShiftNow(Date.now());
    const id = window.setInterval(() => setShiftNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [activeShift]);
  const [overrideTarget, setOverrideTarget] = useState<CartLine | null>(null);
  const [showFastPINOverlay, setShowFastPINOverlay] = useState(false);
  const [cartId, setCartId] = useState<CartId | null>(null);
  // ADR-19 §5.1: deduction location locked at cart-start time.
  // Use a ref for synchronous reads inside callbacks; state drives renders.
  const deductionLocationIdRef = useRef<string | null>(null);
  const [deductionLocationName, setDeductionLocationName] = useState<string | null>(null);
  const ensureCart = useCallback(async (currency: string): Promise<CartId | null> => {
    if (cartId) return cartId;
    try {
      const { cartId: newCartId, deductionLocationId: locId } = await startSaleScoped(sessionToken, { currency });
      setCartId(newCartId);
      deductionLocationIdRef.current = locId ?? null;
      if (locId) {
        // Fetch the real location name from the backend. Scoped per ADR #7: the ambient
        // get_cart_deduction_location is registered by tablet only, so on desktop this call threw
        // "command not found" -- and the outer catch then reported it as a cart-creation failure
        // even though startSaleScoped had already succeeded and setCartId had already run.
        //
        // So the lookup now has its own guard. It resolves display metadata only; the fallback at
        // `?? locId` below is the degradation this code always intended, and it can only happen if
        // the name was never fetched. A cart that exists must be returned as existing.
        try {
          const info = sessionToken
            ? await getCartDeductionLocationScoped(sessionToken, newCartId)
            : await getCartDeductionLocation(newCartId);
          setDeductionLocationName(info?.locationName ?? locId);
          if (info?.overriddenAt) setDeductionOverridden(true);
        } catch {
          setDeductionLocationName(locId);
        }
      } else {
        setDeductionLocationName(null);
      }
      return newCartId;
    } catch {
      addToast({ message: 'Failed to create sale cart', type: 'error' });
      return null;
    }
  }, [cartId, addToast, sessionToken]);
  const [showCloseShift, setShowCloseShift] = useState(false);
  const [showOpenShift, setShowOpenShift] = useState(false);
  // Fade the open-shift modal out before the parent setter flips
  // showOpenShift to false. Used by Cancel + Escape + Open-success.
  const openShiftExit = useExitAnimation(
    showOpenShift,
    () => setShowOpenShift(false),
  );
  const [closingBalance, setClosingBalance] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [shiftNotes, setShiftNotes] = useState('');
  const [closingShift, setClosingShift] = useState(false);
  const [openingShift, setOpeningShift] = useState(false);
  const [closeShiftError, setCloseShiftError] = useState<string | null>(null);
  const [closedShiftSummary, setClosedShiftSummary] = useState<ShiftDto | null>(null);
  // Fade the inline shift-error banner out. The error is set when
  // the cashier tries to close the shift while the cart is not empty.
  // Dismiss via × fades with a 200ms height-opacity mirror before
  // clearing the error string.
  const shiftErrorExit = useExitAnimation(
    !!closeShiftError && !showCloseShift,
    () => setCloseShiftError(null),
  );

  // Fade the close-shift confirmation modal out before the parent
  // state flips. Used by Cancel + Escape. The confirm-success path
  // that swaps to the summary view intentionally SNAPS (no fade on
  // the confirmation) because the new summary has its own entry
  // animation — adding an exit fade on the old one would visually
  // double up with the new entry.
  const closeShiftExit = useExitAnimation(
    showCloseShift && !closedShiftSummary,
    () => {
      setShowCloseShift(false);
      setCloseShiftError(null);
    },
  );
  // Fade the close-shift success summary out before clearing all
  // three related states. Used by the Done button.
  const shiftSummaryExit = useExitAnimation(
    !!closedShiftSummary,
    () => {
      setClosedShiftSummary(null);
      setShowCloseShift(false);
      setCloseShiftError(null);
    },
  );

  const handleAddProduct = useCallback(
    (product: Product, qty?: number) => {
      if (!activeShiftRef.current) {
        addToast({ message: 'Open a shift first', type: 'warning' });
        return;
      }
      // ADR-19 §5.1: reject add_line when cart exists but has no deduction location
      if (cartId && !deductionLocationIdRef.current) {
        addToast({ message: requiredLocalized(l10nRef.current, 'pos-cart-unbound-error'), type: 'error' });
        return;
      }
      addProduct(product, qty);
    },
    [addProduct, addToast, cartId], // l10n via ref
  );

  // ADR-19 §17: badge click → FastPINOverlay for manager override
  const handleDeductionBadgeClick = useCallback(() => {
    setShowFastPINOverlay(true);
  }, []);

  const [deductionOverridden, setDeductionOverridden] = useState(false);

  const handleDeductionPinVerified = useCallback(async () => {
    if (!cartId) return;
    if (!sessionToken) return;
    try {
      await overrideCartDeductionLocation(sessionToken, cartId);
      setDeductionOverridden(true);
      addToast({ message: 'Deduction location override recorded', type: 'success' });
    } catch {
      addToast({ message: 'Failed to record override', type: 'error' });
    }
  }, [cartId, sessionToken, addToast]);

  // Load active shift on mount and when session changes.
  useEffect(() => {
    if (!userId) {
      setActiveShift(null);
      setShiftLoading(false);
      return;
    }
    setShiftLoading(true);
    getActiveShiftScoped(sessionToken)
      .then((shift) => { setActiveShift(shift); })
      .catch(() => { setActiveShift(null); })
      .finally(() => setShiftLoading(false));
  }, [userId, sessionToken]);

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
    }, [handleAddProduct, addToast, sessionToken]), // l10n via ref
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
  }, [total, addToast]);

  // P7-1: Swipe left on cart panel → open payment modal (tablet flow)
  const cartSwipe = useSwipe({
    onSwipeLeft: () => {
      if (total && activeShiftRef.current) {
        setShowPayment(true);
      }
    },
  });

  // ── Open Bill state ──────────────────────────────────────────────
  const [activeOpenBillId, setActiveOpenBillId] = useState<string | null>(null);
  const [openBills, setOpenBills] = useState<HeldCartRow[]>([]);
  const [showOpenBills, setShowOpenBills] = useState(false);
  // Fade the Open Bills list modal out before the parent setter
  // flips showOpenBills to false. Used by the close button + Resume.
  const openBillsExit = useExitAnimation(
    showOpenBills,
    () => setShowOpenBills(false),
  );
  const loadOpenBills = useCallback(() => {
    listOpenBillsScoped(sessionToken).then(setOpenBills).catch(() => {
      addToast({ message: 'Failed to load open bills', type: 'error' });
    });
  }, [addToast, sessionToken]);

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
  }, [resetCart, customerDisplayPaymentComplete, activeOpenBillId, loadOpenBills, addToast, sessionToken]);

  const handleApplyDiscount = useCallback(() => {
    // Whole percentage only — reject fractional input instead of
    // silently truncating it via parseInt.
    const pct = Number(discountInput);
    if (!Number.isInteger(pct) || pct < 1 || pct > 100) return;
    setDiscount(pct, discountName.trim() || `${pct}% Discount`);
    setShowDiscountInput(false);
    setDiscountInput('');
    setDiscountName('');
  }, [discountInput, discountName, setDiscount]);

  const handleClearDiscount = useCallback(() => {
    setDiscount(0, '');
  }, [setDiscount]);

  // PROMO-3: accumulate the picker selection (multi-select, stacking).
  const handleSelectPromotions = useCallback((selected: Promotion[]) => {
    setAppliedPromotions(selected);
    setShowPromotions(false);
    const names = selected.map((p) => p.name).join(', ');
    if (selected.length > 0) {
      addToast({ message: l10nRef.current.getString('pos-promotions-applied', { name: names }) || names, type: 'success' });
    }
  }, [addToast]);

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

  // ── Multi-step undo stack ───────────────────────────────────
  // Each removed line is pushed onto the stack. Pressing Undo pops
  // the most recent one and re-inserts it. The state machine and
  // race-safe exit fade are owned by `useAnimatedUndoStack` so the
  // contract can be tested directly via renderHook — bypassing the
  // CartLineItem 200ms exit timer that prevents concurrent pushes
  // from landing during the fade on the component layer. MAX size
  // 5 so the cashier can recover from a batch of mistakes.
  const animatedUndoStack = useAnimatedUndoStack<CartLine>({
    maxSize: 5,
    getId: (line) => String(line.id),
  });

  // Push a removed cart line onto the undo stack so the cashier
  // can recover up to the last 5 removes via the floating pill.
  const handleRemoveLine = useCallback((line: CartLine) => {
    removeLine(line.id);
    animatedUndoStack.push(line);
  }, [removeLine, animatedUndoStack]);

  // Pop the top of the undo stack and re-insert the line into the
  // cart. When the pop empties the stack, the hook schedules the
  // fade so the pill unmounts via the exit keyframe instead of
  // snapping away.
  const handleUndoRemove = useCallback(() => {
    const popped = animatedUndoStack.pop();
    if (popped === undefined) return;
    triggerInteraction('undo-cart');
    setLines((prev) => [popped, ...prev]);
  }, [animatedUndoStack, setLines]);

  // Dismiss the pill via the race-safe exit fade. Concurrent
  // pushes during the 200 ms window abort the clear (see the
  // useAnimatedUndoStack contract + the applyExitAnimation skill).
  const handleDismissUndo = useCallback(() => {
    animatedUndoStack.dismiss();
  }, [animatedUndoStack]);

  const handleDecreaseQty = useCallback((line: CartLine) => {
    updateQty(line.id, line.qty - 1);
  }, [updateQty]);

  const handleIncreaseQty = useCallback((line: CartLine) => {
    updateQty(line.id, line.qty + 1);
  }, [updateQty]);

  const handleOverrideConfirm = useCallback(async (newPriceMinor: number, _authorizingUserId: string) => {
    if (!overrideTarget) return;
    const cId = cartId;
    if (!cId) {
      addToast({ message: 'No active sale cart', type: 'error' });
      setOverrideTarget(null);
      return;
    }
    try {
      await overrideLinePriceScoped(sessionToken, cId, overrideTarget.id, newPriceMinor);
      updateLinePrice(overrideTarget.id, {
        minor_units: newPriceMinor,
        currency: overrideTarget.unit_price.currency,
      });
    } catch (err) {
      const msg = plainErrorMessage(err, 'Override failed');
      addToast({ message: msg, type: 'error' });
    } finally {
      setOverrideTarget(null);
    }
  }, [overrideTarget, cartId, addToast, updateLinePrice, sessionToken]);

  // ── Keyboard navigation (↑ / ↓ / + / − / Del / Enter) ────────
  // The cart panel handles keys when its focus, or any descendant
  // cart line's focus, is active. Inputs, textareas, and content-
  // editable elements are excluded so text-entry UX is preserved.
  const focusLineByIndex = useCallback((idx: number) => {
    if (lines.length === 0) return;
    const clamped = Math.max(0, Math.min(lines.length - 1, idx));
    cartLineRefs.current.get(lines[clamped]!.id)?.focus();
  }, [lines]);

  const handleCartPanelKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      const tgt = e.target as HTMLElement;
      if (
        tgt instanceof HTMLInputElement ||
        tgt instanceof HTMLTextAreaElement ||
        tgt.isContentEditable
      ) {
        return;
      }
      // Resolve which cart line emitted the key (allow bubble from a
      // child button inside the line — the line has data-line-id).
      const lineEl = tgt.closest('[data-line-id]') as HTMLElement | null;
      const focusedLineId = lineEl?.dataset['lineId'] as LineId | undefined;
      const focusedIdx = focusedLineId
        ? lines.findIndex((l) => l.id === focusedLineId)
        : -1;

      switch (e.key) {
        case 'ArrowDown':
          if (lines.length === 0) return;
          e.preventDefault();
          focusLineByIndex(focusedIdx < 0 ? 0 : focusedIdx + 1);
          return;
        case 'ArrowUp':
          if (lines.length === 0) return;
          e.preventDefault();
          focusLineByIndex(focusedIdx < 0 ? lines.length - 1 : focusedIdx - 1);
          return;
        case '+':
        case '=':
          if (focusedLineId == null) return;
          {
            const l = lines.find((x) => x.id === focusedLineId);
            if (!l) return;
            e.preventDefault();
            handleIncreaseQty(l);
          }
          return;
        case '-':
        case '_':
          if (focusedLineId == null) return;
          {
            const l = lines.find((x) => x.id === focusedLineId);
            if (!l) return;
            e.preventDefault();
            handleDecreaseQty(l);
          }
          return;
        case 'Delete':
        case 'Backspace':
          if (focusedLineId == null) return;
          {
            const l = lines.find((x) => x.id === focusedLineId);
            if (!l) return;
            e.preventDefault();
            handleRemoveLine(l);
          }
          return;
        case 'Enter':
          if (!total) return;
          e.preventDefault();
          handlePay();
          return;
      }
    },
    [
      lines,
      total,
      handlePay,
      handleIncreaseQty,
      handleDecreaseQty,
      handleRemoveLine,
      focusLineByIndex,
    ],
  );

  // ── Load receipt settings on mount ────────────────────────────
  useEffect(() => {
    getReceiptSettingsScoped(sessionToken)
      .then((s) => setShowTableNumberSetting(s.showTableNumber))
      .catch(() => addToast({ message: requiredLocalized(l10nRef.current, 'pos-toast-receipt-settings-failed'), type: 'error' }));
  }, [addToast, sessionToken]); // l10n via ref — stable dep chain

  const handleCloseShiftClick = useCallback(() => {
    setCloseShiftError(null);
    setClosedShiftSummary(null);
    // Enforce: cart must be empty before closing shift.
    if (lines.length > 0) {
      setCloseShiftError(l10nRef.current.getString('pos-close-shift-cart-error'));
      return;
    }
    setClosingBalance('');
    setShiftNotes('');
    setShowCloseShift(true);
  }, [lines]); // l10n via ref

  const handleConfirmCloseShift = useCallback(async () => {
    if (!activeShift) return;
    // Whole-number minor units — reject fractional input instead of
    // silently truncating it via parseInt.
    const balance = Number(closingBalance);
    if (!Number.isInteger(balance) || balance < 0) return;

    setClosingShift(true);
    setCloseShiftError(null);
    try {
      const closed = await closeShiftScoped(sessionToken, activeShift.id, balance, shiftNotes.trim() || null);
      setClosedShiftSummary(closed);
      setActiveShift(null); // no longer active
    } catch (err) {
      const msg = l10nErrorMessage(err, l10nRef.current, 'pos-close-shift-failed');
      setCloseShiftError(msg);
    } finally {
      setClosingShift(false);
    }
  }, [activeShift, closingBalance, shiftNotes, sessionToken]); // l10n via ref

  const handleOpenShiftClick = useCallback(() => {
    setOpeningBalance('');
    setShowOpenShift(true);
  }, []);

  const handleConfirmOpenShift = useCallback(async () => {
    const balance = Number(openingBalance);
    const safeBalance = !Number.isNaN(balance) && Number.isInteger(balance) && balance >= 0 ? balance : 0;

    setOpeningShift(true);
    try {
      const shift = await openShiftScoped(sessionToken, safeBalance);
      setActiveShift(shift);
      openShiftExit.requestClose();
    } catch {
      // Handled silently — shift open failure is rare.
    } finally {
      setOpeningShift(false);
    }
  }, [openingBalance, openShiftExit, sessionToken]);



  // ── Open Bill inline state ────────────────────────────────────
  const [showOpenBillInput, setShowOpenBillInput] = useState(false);
  // Fade the Open Bill Input modal out (mirror of pos-modal-slide-up
  // via .pos-hold-modal--exiting) before the parent setter flips
  // showOpenBillInput to false. Used by cancel + Save-success.
  const openBillInputExit = useExitAnimation(
    showOpenBillInput,
    () => setShowOpenBillInput(false),
  );
  const [openBillName, setOpenBillName] = useState('');
  const [openingBill, setOpeningBill] = useState(false);

  useEffect(() => {
    if (showOpenBills) {
      loadOpenBills();
    }
  }, [showOpenBills, loadOpenBills]);

  const handleOpenBill = useCallback(async () => {
    if (!activeShift) {
      addToast({ message: 'Open a shift first', type: 'warning' });
      return;
    }
    if (!subtotal || lines.length === 0) return;
    setOpeningBill(true);
    try {
      const cartData = JSON.stringify({
        lines: lines.map((l) => ({
          sku: l.sku,
          name: l.name,
          qty: l.qty,
          unit_price: l.unit_price,
        })),
        discountPercent,
        discountLabel,
      });
      await holdCartScoped(sessionToken, {
        label: openBillName.trim() || `Open Bill #${Date.now()}`,
        cart_data: cartData,
        item_count: lines.length,
        total_minor: subtotal.minor_units,
        currency: subtotal.currency,
        bill_type: 'open_bill',
        customer_name: openBillName.trim(),
      });
    resetCart();
    setAppliedPromotions([]);
    openBillInputExit.requestClose();
    setOpenBillName('');
    loadOpenBills();
    } catch {
      addToast({ message: 'Failed to save open bill', type: 'error' });
    } finally {
      setOpeningBill(false);
    }
  }, [activeShift, lines, subtotal, openBillName, discountPercent, discountLabel, resetCart, loadOpenBills, addToast, openBillInputExit, sessionToken]);

  const handleResumeOpenBill = useCallback(async (id: string) => {
    try {
      const full = await getHeldCartScoped(sessionToken, id);
      if (!full) return;
      const data = JSON.parse(full.cart_data);
      if (data.lines && Array.isArray(data.lines)) {
        setLines(data.lines.map((l: { sku: string; name?: string; qty: number; unit_price: { minor_units: number; currency: string }; category?: string }) => ({
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
      if (typeof data.tableNumber === 'string') {
        setTableNumber(data.tableNumber);
      }
    setActiveOpenBillId(id);
    openBillsExit.requestClose();
    } catch {
      addToast({ message: 'Failed to resume open bill', type: 'error' });
    }
  }, [setLines, setDiscount, setTableNumber, addToast, openBillsExit, sessionToken]);

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
      <div
        className="pos-resize-handle"
        onMouseDown={startResize}
        aria-hidden="true"
      />

      {/* ── Right: Cart panel (resizable, keyboard-nav) */}
      <aside
        className="pos-cart-panel"
        ref={cartPanelRef}
        aria-label={l10n.getString('pos-cart-panel-aria')}
        role="region"
        style={{ width: cartWidth }}
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
          <div className="pos-cart-course-bar">
            {COURSES.map((course) => {
              const holdCount = lines.filter(
                (l) => l.courseId === course.id && l.coursingStatus === 'hold',
              ).length;
              if (holdCount === 0) return null;
              return (
                <button
                  key={course.id}
                  type="button"
                  className="pos-cart-course-btn"
                  onClick={() => fireCourse(course.id)}
                  data-testid={`fire-course-${course.id}`}
                  aria-label={l10n.getString('pos-cart-course-fire-aria', { label: course.label, count: String(holdCount) }, `Fire ${course.label} (${holdCount} items)`)}
                >
                  <span className="pos-cart-course-emoji" aria-hidden="true">{course.emoji}</span>
                  <span className="pos-cart-course-label">{course.label}</span>
                  <span className="pos-cart-course-count">{holdCount}</span>
                </button>
              );
            })}
            {lines.some((l) => l.coursingStatus === 'hold') && (
              <button
                type="button"
                className="pos-cart-course-btn pos-cart-course-btn--all"
                onClick={fireAllCourses}
                data-testid="fire-all-courses"
              >
                <Localized id="pos-cart-course-btn--all"><span className="pos-cart-course-label">Fire All</span></Localized>
              </button>
            )}
          </div>
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
          <div className="pos-cart-footer">
            {/* ── Section 3: Sub total with options (collapsible) ──── */}
            <div className="pos-cart-options-section">
              {/* Toggle header: subtotal + collapse button */}
              <button
                type="button"
                className="pos-cart-options-toggle"
                onClick={() => setShowOptions((v) => !v)}
                aria-expanded={showOptions}
                aria-label={l10n.getString(showOptions ? 'pos-cart-options-collapse-aria' : 'pos-cart-options-expand-aria')}
              >
                <Localized id="pos-cart-subtotal">
                  <span className="pos-cart-subtotal-label">Subtotal</span>
                </Localized>
                <span className="pos-cart-subtotal-amount">
                  {formatMoney(subtotal)}
                </span>
                <span
                  className={`pos-cart-options-chevron${showOptions ? ' pos-cart-options-chevron--open' : ''}`}
                  aria-hidden="true"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20" aria-hidden="true">
                    <polyline points="6 15 12 9 18 15" />
                  </svg>
                </span>
              </button>

              {/* Collapsible body: discount + tip + service charge */}
              <div
                className={`pos-cart-options-collapse${showOptions ? ' pos-cart-options-collapse--open' : ''}`}
              >
                <div className="pos-cart-options-body">
                  {/* Discount */}
                  <div className="pos-cart-discount-area">
                    {discountPercent > 0 ? (
                      <div className="pos-cart-discount-row">
                        <span className="pos-cart-discount-label">
                          <Localized id="pos-cart-discount-label" vars={{ label: discountLabel || `${discountPercent}%` }}>
                            <span>Discount ({discountLabel || `${discountPercent}%`})</span>
                          </Localized>
                        </span>
                        <span className="pos-cart-discount-amount">
                          -{discountAmount ? formatMoney(discountAmount) : ''}
                        </span>
                        <button
                          type="button"
                          className="pos-cart-discount-clear"
                          onClick={handleClearDiscount}
                          aria-label={l10n.getString('pos-cart-discount-remove-aria')}
                        >
                          &times;
                        </button>
                      </div>
                    ) : !showDiscountInput ? (
                      <div className="pos-cart-discount-actions">
                        <Localized id="pos-cart-add-discount">
                          <button
                            type="button"
                            className="pos-cart-discount-btn"
                            onClick={() => setShowDiscountInput(true)}
                          >
                            + Add Discount
                          </button>
                        </Localized>
                        <Localized id="pos-cart-add-promotion">
                          <button
                            type="button"
                            className="pos-cart-discount-btn pos-cart-promotion-btn"
                            onClick={() => setShowPromotions(true)}
                            disabled={!subtotal}
                          >
                            + Promotions
                          </button>
                        </Localized>
                      </div>
                    ) : null}

                    {/* PROMO-3: applied promotion chips (engine-applied at
                        checkout; the amount shows in the payment modal). */}
                    {appliedPromotions.length > 0 && (
                      <div className="pos-cart-promotion-row">
                        {appliedPromotions.map((p) => (
                          <span key={p.id} className="pos-cart-promotion-chip">
                            <span className="pos-cart-promotion-chip-name">{p.name}</span>
                            <button
                              type="button"
                              className="pos-cart-promotion-chip-clear"
                              aria-label={l10n.getString('pos-cart-promotion-remove-aria', { name: p.name })}
                              onClick={() => setAppliedPromotions(appliedPromotions.filter((x) => x.id !== p.id))}
                            >
                              &times;
                            </button>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Discount input form */}
                    {showDiscountInput && (
                      <div className="pos-cart-discount-form">
                        <div className="pos-cart-discount-input-row">
                          <Localized id="pos-cart-pct-placeholder" attrs={{ placeholder: true }}>
                            <input
                              type="number"
                              className="pos-cart-discount-pct"
                              min="1"
                              max="100"
                              placeholder="%"
                              value={discountInput}
                              onChange={(e) => {
                                // Whole number only — ignore fractional in-progress input
                                // instead of silently truncating it via parseInt.
                                const v = Number(e.target.value);
                                if (e.target.value === '' || (Number.isInteger(v) && v >= 0)) {
                                  setDiscountInput(e.target.value);
                                }
                              }}
                              aria-label={l10n.getString('pos-cart-discount-pct-aria')}
                            />
                          </Localized>
                          <Localized id="pos-cart-label-placeholder" attrs={{ placeholder: true }}>
                            <input
                              type="text"
                              className="pos-cart-discount-name"
                              placeholder="Label (optional)"
                              value={discountName}
                              onChange={(e) => setDiscountName(e.target.value)}
                              aria-label={l10n.getString('pos-cart-discount-label-aria')}
                            />
                          </Localized>
                          <Localized id="pos-cart-apply">
                            <button
                              type="button"
                              className="pos-cart-discount-apply"
                              onClick={handleApplyDiscount}
                              disabled={!discountInput || !Number.isInteger(Number(discountInput)) || Number(discountInput) < 1 || Number(discountInput) > 100}
                            >
                              Apply
                            </button>
                          </Localized>
                          <Localized id="pos-cart-cancel">
                            <button
                              type="button"
                              className="pos-cart-discount-cancel"
                              onClick={() => {
                                setShowDiscountInput(false);
                                setDiscountInput('');
                                setDiscountName('');
                              }}
                              aria-label={l10n.getString('pos-cart-discount-cancel-aria')}
                            >
                              Cancel
                            </button>
                          </Localized>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ── Tip segment ──────────────────── */}
                  <div className="pos-cart-tip-area">
                    <Localized id="pos-cart-tip-label">
                      <span className="pos-cart-money-row-label">Add Tip</span>
                    </Localized>
                    <div
                      className="pos-cart-tip-bar"
                      role="group"
                      aria-label={l10n.getString('pos-cart-tip-aria')}
                    >
                      {[0, 15, 18, 20].map((pct) => (
                        <button
                          key={pct}
                          type="button"
                          className="pos-cart-tip-segment"
                          onClick={() => setTipPercent(pct)}
                          aria-pressed={tipPercent === pct}
                          aria-label={
                            pct === 0
                              ? l10n.getString('pos-cart-tip-segment-zero-aria')
                              : l10n.getString('pos-cart-tip-segment-aria', { percent: pct })
                          }
                        >
                          {pct === 0 ? (
                            <Localized id="pos-cart-tip-none"><span>None</span></Localized>
                          ) : (
                            `${pct}%`
                          )}
                        </button>
                      ))}
                    </div>
                    {tipAmount && (
                      <div className="pos-cart-tip-preview-row">
                        <Localized id="pos-cart-tip-line" vars={{ percent: tipPercent }}>
                          <span>Tip ({tipPercent}%)</span>
                        </Localized>
                        <span className="pos-cart-money-row-amount">
                          +{formatMoney(tipAmount)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* ── Service charge toggle ─────────── */}
                  <div className="pos-cart-service-area">
                    <button
                      type="button"
                      className={`pos-cart-service-toggle ${serviceChargeEnabled ? 'pos-cart-service-toggle--on' : ''}`}
                      onClick={() => setServiceCharge(!serviceChargeEnabled)}
                      aria-pressed={serviceChargeEnabled}
                      aria-label={l10n.getString('pos-cart-service-toggle-aria')}
                    >
                      <span className="pos-cart-service-toggle-knob" aria-hidden="true" />
                      <Localized
                        id="pos-cart-service-toggle-label"
                        vars={{ percent: serviceChargePercent }}
                      >
                        <span>Add {serviceChargePercent}% service charge</span>
                      </Localized>
                    </button>
                    {serviceChargeAmount && (
                      <div className="pos-cart-service-preview-row">
                        <Localized
                          id="pos-cart-service-line"
                          vars={{ percent: serviceChargePercent }}
                        >
                          <span>Service ({serviceChargePercent}%)</span>
                        </Localized>
                        <span className="pos-cart-money-row-amount">
                          +{formatMoney(serviceChargeAmount)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Tax line (live preview; F2-3 estimated marker) ── */}
            {cartTax > 0 && (
              <div className="pos-cart-tax-row">
                <span>PPN</span>
                <span className={taxEstimated ? 'pos-cart-money-row-amount pos-cart-tax-estimated' : 'pos-cart-money-row-amount'}>
                  {formatMoney({ minor_units: cartTax, currency: subtotal?.currency ?? 'IDR' })}
                </span>
              </div>
            )}
            {lines.length > 0 && taxState.severity !== 'ok' && (
              <div className="pos-cart-tax-row" role="status">
                {/* Localized text is the accessible name; no aria-label
                    attribute so the i18n attribute audit stays empty. */}
                <Localized id="retry">
                  <button type="button" onClick={retryTaxEstimate}>Retry</button>
                </Localized>
              </div>
            )}

            {/* ── Section 4: Charge button ──────────────────────── */}
            {/* Action buttons row */}
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

          </div>
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

      {/* ── Close Shift Confirmation Modal ───────── */}
      {closeShiftExit.shouldRender && activeShift ? (          <div
            className={`pos-close-shift-overlay${closeShiftExit.exiting ? ' pos-close-shift-overlay--exiting' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={l10n.getString('pos-close-shift-overlay-aria')}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                closeShiftExit.requestClose();
                setCloseShiftError(null);
              }
              if (e.key === 'Enter') handleConfirmCloseShift();
            }}
          >
            <div className={`pos-close-shift-modal${closeShiftExit.exiting ? ' pos-close-shift-modal--exiting' : ''}`}>
              <Localized id="pos-close-shift-title">
              <h3 className="pos-close-shift-title">Close Shift</h3>
            </Localized>

            {closeShiftError && (
              <div className="pos-close-shift-error">
                {closeShiftError}
              </div>
            )}

            <div className="pos-close-shift-info">
              <div className="pos-close-shift-info-row">
                <Localized id="pos-close-shift-opened">
                  <span>Opened</span>
                </Localized>
                <span>{new Date(activeShift.openedAt).toLocaleString()}</span>
              </div>
              <div className="pos-close-shift-info-row">
                <Localized id="pos-close-shift-opening-balance">
                  <span>Opening balance</span>
                </Localized>
                <span>{formatMoney({ minor_units: activeShift.openingBalanceMinor, currency: 'USD' })}</span>
              </div>
            </div>

            <div className="pos-close-shift-field">
              <Localized id="pos-close-shift-counted-label">
                <label htmlFor="closing-balance" className="pos-close-shift-label">
                  Counted cash in drawer
                </label>
              </Localized>
              <Localized id="pos-close-shift-counted-placeholder" attrs={{ placeholder: true }}>
                <input
                  id="closing-balance"
                  type="number"
                  className="pos-close-shift-input"
                  min="0"
                  placeholder="e.g. 15000 for $150.00"
                  value={closingBalance}
                  onChange={(e) => {
                    // Whole number only — ignore fractional in-progress input
                    // instead of silently truncating it via parseInt.
                    const v = Number(e.target.value);
                    if (e.target.value === '' || (Number.isInteger(v) && v >= 0)) {
                      setClosingBalance(e.target.value);
                    }
                  }}
                  aria-label={l10n.getString('pos-close-shift-balance-aria')}
                />
              </Localized>
            </div>

            <div className="pos-close-shift-field">
              <Localized id="pos-close-shift-notes-label">
                <label htmlFor="shift-notes" className="pos-close-shift-label">
                  Notes (optional)
                </label>
              </Localized>
              <Localized id="pos-close-shift-notes-placeholder" attrs={{ placeholder: true }}>
                <textarea
                  id="shift-notes"
                  className="pos-close-shift-textarea"
                  rows={3}
                  placeholder="Any notes about this shift…"
                  value={shiftNotes}
                  onChange={(e) => setShiftNotes(e.target.value)}
                  aria-label={l10n.getString('pos-close-shift-notes-aria')}
                />
              </Localized>
            </div>

            <div className="pos-close-shift-actions">
              <Localized id="cancel">
                <button
                  type="button"
                  className="pos-close-shift-cancel-btn"
                  onClick={() => {
                    setShowCloseShift(false);
                    setCloseShiftError(null);
                  }}
                  disabled={closingShift}
                >
                  Cancel
                </button>
              </Localized>
              { }
              <button
                type="button"
                className="pos-close-shift-confirm-btn"
                onClick={handleConfirmCloseShift}
                disabled={
                  closingShift ||
                  !closingBalance ||
                  !Number.isInteger(Number(closingBalance)) ||
                  Number(closingBalance) < 0
                }
              >
                <Localized id={closingShift ? 'pos-close-shift-closing' : 'pos-close-shift-confirm'}>
                  <span>{closingShift ? 'Closing…' : 'Close Shift'}</span>
                </Localized>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Close Shift Success Summary ────────────── */}
      {shiftSummaryExit.shouldRender && closedShiftSummary ? (          <div
            className={`pos-close-shift-overlay${shiftSummaryExit.exiting ? ' pos-close-shift-overlay--exiting' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={l10n.getString('pos-close-shift-summary-aria')}
          >
            <div className={`pos-close-shift-modal pos-close-shift-summary${shiftSummaryExit.exiting ? ' pos-close-shift-modal--exiting' : ''}`}>
            <Localized id="pos-shift-closed-title">
              <h3 className="pos-close-shift-title">
                Shift Closed
              </h3>
            </Localized>

            <div className="pos-close-shift-summary-grid">
              <div className="pos-close-shift-summary-item">
                <Localized id="pos-shift-total-sales">
                  <span className="pos-close-shift-summary-label">Total Sales</span>
                </Localized>
                <span className="pos-close-shift-summary-value">
                  {formatMoney({ minor_units: closedShiftSummary.totalSalesMinor, currency: 'USD' })}
                </span>
              </div>
              <div className="pos-close-shift-summary-item">
                <Localized id="pos-shift-cash-sales">
                  <span className="pos-close-shift-summary-label">Cash Sales</span>
                </Localized>
                <span className="pos-close-shift-summary-value">
                  {formatMoney({ minor_units: closedShiftSummary.totalCashMinor, currency: 'USD' })}
                </span>
              </div>
              <div className="pos-close-shift-summary-item">
                <Localized id="pos-shift-card-sales">
                  <span className="pos-close-shift-summary-label">Card Sales</span>
                </Localized>
                <span className="pos-close-shift-summary-value">
                  {formatMoney({ minor_units: closedShiftSummary.totalCardMinor, currency: 'USD' })}
                </span>
              </div>
              <div className="pos-close-shift-summary-item">
                <Localized id="pos-shift-expected-cash">
                  <span className="pos-close-shift-summary-label">Expected Cash</span>
                </Localized>
                <span className="pos-close-shift-summary-value">
                  {closedShiftSummary.expectedCashMinor !== null
                    ? formatMoney({ minor_units: closedShiftSummary.expectedCashMinor, currency: 'USD' })
                    : '—'}
                </span>
              </div>
              <div className="pos-close-shift-summary-item">
                <Localized id="pos-shift-counted">
                  <span className="pos-close-shift-summary-label">Counted</span>
                </Localized>
                <span className="pos-close-shift-summary-value">
                  {closedShiftSummary.closingBalanceMinor !== null
                    ? formatMoney({ minor_units: closedShiftSummary.closingBalanceMinor, currency: 'USD' })
                    : '—'}
                </span>
              </div>
              <div className="pos-close-shift-summary-item">
                <Localized id="pos-shift-difference">
                  <span className="pos-close-shift-summary-label">Difference</span>
                </Localized>
                <span
                  className={`pos-close-shift-summary-value ${
                    closedShiftSummary.cashDifferenceMinor !== null && closedShiftSummary.cashDifferenceMinor < 0
                      ? 'pos-close-shift-diff--negative'
                      : closedShiftSummary.cashDifferenceMinor !== null && closedShiftSummary.cashDifferenceMinor > 0
                        ? 'pos-close-shift-diff--positive'
                        : ''
                  }`}
                >
                  {closedShiftSummary.cashDifferenceMinor !== null
                    ? formatMoney({ minor_units: closedShiftSummary.cashDifferenceMinor, currency: 'USD' })
                    : '—'}
                  {closedShiftSummary.cashDifferenceMinor !== null && closedShiftSummary.cashDifferenceMinor !== 0 && (
                    <span className="pos-close-shift-diff-tag">
                      <Localized id={closedShiftSummary.cashDifferenceMinor > 0 ? 'pos-shift-over' : 'pos-shift-short'}>
                        <span>{closedShiftSummary.cashDifferenceMinor > 0 ? 'Over' : 'Short'}</span>
                      </Localized>
                    </span>
                  )}
                </span>
              </div>
            </div>

            {closedShiftSummary.notes && (
              <div className="pos-close-shift-notes-display">
                <Localized id="pos-shift-notes">
                  <span className="pos-close-shift-summary-label">Notes</span>
                </Localized>
                <p>{closedShiftSummary.notes}</p>
              </div>
            )}            <Localized id="pos-shift-summary-done">
              <button
                type="button"
                className="pos-close-shift-dismiss-btn"
                onClick={() => shiftSummaryExit.requestClose()}
              >
                Done
              </button>
            </Localized>
          </div>
        </div>
      ) : null}

      {/* ── Open Shift Modal ───────────────────────── */}
      {openShiftExit.shouldRender && (          <div
            className={`pos-close-shift-overlay${openShiftExit.exiting ? ' pos-close-shift-overlay--exiting' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={l10n.getString('pos-open-shift-overlay-aria')}
            onKeyDown={(e) => {
              if (e.key === 'Escape') openShiftExit.requestClose();
              if (e.key === 'Enter') handleConfirmOpenShift();
            }}
          >
            <div className={`pos-close-shift-modal${openShiftExit.exiting ? ' pos-close-shift-modal--exiting' : ''}`}>
              <Localized id="pos-open-shift-title">
              <h3 className="pos-close-shift-title">Open Shift</h3>
            </Localized>

            <div className="pos-close-shift-field">
              <Localized id="pos-open-shift-balance-label">
                <label htmlFor="opening-balance" className="pos-close-shift-label">
                  Opening balance
                </label>
              </Localized>
              <Localized id="pos-open-shift-balance-placeholder" attrs={{ placeholder: true }}>
                <input
                  id="opening-balance"
                  type="number"
                  className="pos-close-shift-input"
                  min="0"
                  placeholder="e.g. 500 for $5.00"
                  value={openingBalance}
                  onChange={(e) => {
                    // Whole number only — ignore fractional in-progress input
                    // instead of silently truncating it via parseInt.
                    const v = Number(e.target.value);
                    if (e.target.value === '' || (Number.isInteger(v) && v >= 0)) {
                      setOpeningBalance(e.target.value);
                    }
                  }}
                  aria-label={l10n.getString('pos-open-shift-balance-aria')}
                />
              </Localized>
            </div>

            <div className="pos-close-shift-actions">
              <Localized id="cancel">
                <button
                  type="button"
                className="pos-close-shift-cancel-btn"
                onClick={() => openShiftExit.requestClose()}
                  disabled={openingShift}
                >
                  Cancel
                </button>
              </Localized>
              { }
              <button
                type="button"
                className="pos-close-shift-confirm-btn"
                onClick={handleConfirmOpenShift}
                disabled={openingShift}
              >
                <Localized id={openingShift ? 'pos-open-shift-opening' : 'pos-open-shift-title'}>
                  <span>{openingShift ? 'Opening…' : 'Open Shift'}</span>
                </Localized>
              </button>
            </div>
          </div>
        </div>
      )}

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
