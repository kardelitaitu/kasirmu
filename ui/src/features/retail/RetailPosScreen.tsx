import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { usePosState } from '@/features/sales/usePosState';
import { useBarcodeScanner } from '@/features/sales/useBarcodeScanner';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/Toast';
import { requiredLocalized } from '@/components';
import { LocalizedErrorBoundary } from '@/components/LocalizedErrorBoundary';
import { useLocalization } from '@fluent/react';
import { plainErrorMessage } from '@/utils/app-error';
import { isEditableTarget } from '@/utils/isEditableTarget';
import { isAnyAriaModalOpen } from '@/utils/modal-guard';
import { isCommandModifier } from '@/utils/keyboard-modifier';
import { isDemoMode } from '@/utils/demo-mode';
import { useExitAnimation } from '@/hooks/useExitAnimation';
import { useSwipe } from '@/hooks/useSwipe';
import PaymentModal from '@/features/sales/PaymentModal';
import ItemModifierModal from '@/features/sales/components/ItemModifierModal';
import { overrideLinePriceScoped, startSaleScoped, getProductTrackSerialBatchScoped, lookupSaleByReceiptBarcodeScoped } from '@/api/sales';
import { useWorkspaceNav } from '@/hooks/useWorkspaceNav';
import { useInvalidSession } from '@/hooks/useInvalidSession';
import { useFeatures, FEATURES } from '@/hooks/useFeatures';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { lookupProductBySkuScoped, lookupByBarcodeScoped, createProductScoped, createCategoryScoped, updateProductScoped, adjustStockScoped, recordProductSearchScoped, type ProductDto, type CategoryDto } from '@/api/products';
import { hasGrantedPermission } from '@/registries/page-registry';
import { openProductImages, openProductImagesScoped } from '@/api/browser';
import { isTabletShell } from '@/utils/shellKind';
import { loadCatalog, invalidateCatalog } from '@/utils/catalog-cache';
import { usePagedList } from '@/hooks/usePagedList';
import { listCustomersScoped, type CustomerDto } from '@/api/customers';
import { getActiveShiftScoped, openShiftScoped, closeShiftScoped, type ShiftDto } from '@/api/shifts';
import { holdCartScoped, listHeldCartsScoped, getHeldCartScoped, deleteHeldCartScoped, type HeldCartRow, type SaleDetail } from '@/api/sales';
import { getStoreSettingsScoped, listCreditSalesScoped, settleCreditScoped, type StoreSettingsDto, type CreditSaleDto } from '@/api/settings';
import type { CartTaxCacheState } from '@/hooks/useCartTax';
import type { CartLineTaxInput } from '@/api/tax';
import { CartTaxWatcher, createIdleTaxState } from '@/features/pos/components/CartTaxWatcher';
import { recordMark } from '@/utils/perf-metrics';
import { defaultTenderPresets, DEFAULT_LOW_STOCK_THRESHOLD, parseMoneyInput, type CartId, type CartLine, type CourseId, type LineId, type ModifierSelection, type Money, type Product, type Sku } from '@/types/domain';
import { useSound } from '@/components/useSound';
import { useOptionalTheme } from '@/app/ThemeProvider';
import RetailFnBar from './RetailFnBar';
import RetailHeader from './RetailHeader';
import RetailCartPanel from './RetailCartPanel';
import { RETAIL_CART_WIDTH_MIN, RETAIL_CART_WIDTH_DEFAULT, RETAIL_CART_WIDTH_MAX_CAP, clampRetailCartWidth } from './RetailCartPanel.constants';
import RetailProductGrid, { type SortField, type SortOrder } from './RetailProductGrid';
import RetailProductContextMenu, { type ContextMenuState } from './RetailProductContextMenu';
import { useRetailColumnPrefs } from './hooks/useRetailColumnPrefs';
import { SalesHistoryView, TableManagementView, StockInquiryView } from './RetailSubViews';
import RetailModals from './RetailModals';
import RetailReminderPopup from './RetailReminderPopup';
import './RetailPosScreen.css';

function toProduct(p: ProductDto): Product {
  return {
    sku: p.sku as Sku,
    name: p.name,
    category: p.category ?? '',
    price: { minor_units: p.price.minor_units, currency: p.price.currency },
    barcode: p.barcode,
    inStock: p.in_stock,
    stockQty: p.stock_qty,
    createdAt: p.created_at,
    priceUpdatedAt: p.price_updated_at,
    productType: p.product_type as Product['productType'],
  };
}

// ── Retail sample product fallback (dev/demo builds only — LOAD-03) ──
// These catalogs may NEVER surface in a live cart: a cashier could otherwise
// see and select products that are not in the store (DATA-01).
export const RETAIL_SAMPLE_PRODUCTS: ProductDto[] = [
  { sku: 'CPU-R7-7800X3D', name: 'AMD Ryzen 7 7800X3D 8-Core',  category: 'cat-cpu',       price: { minor_units: 6250000, currency: 'IDR' }, barcode: '730143314930', in_stock: true,  stock_qty: 15, product_type: 'retail', tax_rate_ids: [], created_at: '', price_updated_at: '' },
  { sku: 'CPU-I7-14700K',  name: 'Intel Core i7-14700K 20-Core', category: 'cat-cpu',       price: { minor_units: 6450000, currency: 'IDR' }, barcode: '503203727850', in_stock: true,  stock_qty: 10, product_type: 'retail', tax_rate_ids: [], created_at: '', price_updated_at: '' },
  { sku: 'CPU-R5-7600',    name: 'AMD Ryzen 5 7600 6-Core',     category: 'cat-cpu',       price: { minor_units: 3150000, currency: 'IDR' }, barcode: '730143314503', in_stock: true,  stock_qty: 25, product_type: 'retail', tax_rate_ids: [], created_at: '', price_updated_at: '' },
  { sku: 'GPU-RTX4070TS',  name: 'ASUS TUF RTX 4070 Ti Super 16G',category: 'cat-gpu',     price: { minor_units: 14850000, currency: 'IDR' },barcode: '195553554890', in_stock: true,  stock_qty: 8,  product_type: 'retail', tax_rate_ids: [], created_at: '', price_updated_at: '' },
  { sku: 'GPU-RX7800XT',   name: 'Sapphire PULSE RX 7800 XT 16G',category: 'cat-gpu',     price: { minor_units: 8450000, currency: 'IDR' }, barcode: '489517350567', in_stock: true,  stock_qty: 12, product_type: 'retail', tax_rate_ids: [], created_at: '', price_updated_at: '' },
  { sku: 'GPU-RTX4060',    name: 'MSI Ventus 2X RTX 4060 8GB',   category: 'cat-gpu',     price: { minor_units: 4750000, currency: 'IDR' }, barcode: '824142323456', in_stock: true,  stock_qty: 20, product_type: 'retail', tax_rate_ids: [], created_at: '', price_updated_at: '' },
  { sku: 'RAM-D5-32GB-CR', name: 'Corsair Vengeance DDR5 32GB 6K',category: 'cat-ram',     price: { minor_units: 1850000, currency: 'IDR' }, barcode: '840006698765', in_stock: true,  stock_qty: 30, product_type: 'retail', tax_rate_ids: [], created_at: '', price_updated_at: '' },
  { sku: 'RAM-D5-64GB-GS', name: 'G.Skill Trident Z5 RGB 64GB D5',category: 'cat-ram',     price: { minor_units: 3450000, currency: 'IDR' }, barcode: '848354041234', in_stock: true,  stock_qty: 14, product_type: 'retail', tax_rate_ids: [], created_at: '', price_updated_at: '' },
  { sku: 'RAM-D4-16GB-KF', name: 'Kingston Fury Beast 16GB DDR4', category: 'cat-ram',     price: { minor_units: 680000,  currency: 'IDR' }, barcode: '740617319800', in_stock: true,  stock_qty: 45, product_type: 'retail', tax_rate_ids: [], created_at: '', price_updated_at: '' },
  { sku: 'SSD-990PRO-2TB', name: 'Samsung 990 PRO 2TB NVMe SSD',  category: 'cat-storage', price: { minor_units: 2750000, currency: 'IDR' }, barcode: '887276722340', in_stock: true,  stock_qty: 22, product_type: 'retail', tax_rate_ids: [], created_at: '', price_updated_at: '' },
  { sku: 'SSD-P3P-1TB',    name: 'Crucial P3 Plus 1TB M.2 NVMe',  category: 'cat-storage', price: { minor_units: 1150000, currency: 'IDR' }, barcode: '649528918900', in_stock: true,  stock_qty: 35, product_type: 'retail', tax_rate_ids: [], created_at: '', price_updated_at: '' },
  { sku: 'HDD-ST-4TB',     name: 'Seagate BarraCuda 4TB 3.5" HDD',category: 'cat-storage', price: { minor_units: 1350000, currency: 'IDR' }, barcode: '763649112340', in_stock: true,  stock_qty: 18, product_type: 'retail', tax_rate_ids: [], created_at: '', price_updated_at: '' },
  { sku: 'MB-B650-ROG',    name: 'ASUS ROG Strix B650-A Gaming',  category: 'cat-mb',      price: { minor_units: 3650000, currency: 'IDR' }, barcode: '195553948760', in_stock: true,  stock_qty: 9,  product_type: 'retail', tax_rate_ids: [], created_at: '', price_updated_at: '' },
  { sku: 'MB-Z790-MSI',    name: 'MSI MAG Z790 Tomahawk WiFi',    category: 'cat-mb',      price: { minor_units: 4250000, currency: 'IDR' }, barcode: '824142301230', in_stock: true,  stock_qty: 7,  product_type: 'retail', tax_rate_ids: [], created_at: '', price_updated_at: '' },
  { sku: 'PSU-RM850X',     name: 'Corsair RM850x 850W Gold Modular',category:'cat-psu',     price: { minor_units: 2150000, currency: 'IDR' }, barcode: '840006601234', in_stock: true,  stock_qty: 16, product_type: 'retail', tax_rate_ids: [], created_at: '', price_updated_at: '' },
  { sku: 'COOL-PA120',     name: 'Thermalright Peerless Assassin 120',category:'cat-cooling',price:{ minor_units: 580000,  currency: 'IDR' }, barcode: '784562098120', in_stock: true,  stock_qty: 40, product_type: 'retail', tax_rate_ids: [], created_at: '', price_updated_at: '' },
  { sku: 'COOL-KRAKEN360', name: 'NZXT Kraken Elite 360 RGB AIO', category: 'cat-cooling', price: { minor_units: 4450000, currency: 'IDR' }, barcode: '815671018900', in_stock: true,  stock_qty: 5,  product_type: 'retail', tax_rate_ids: [], created_at: '', price_updated_at: '' },
  { sku: 'PASTE-MX6',      name: 'Arctic MX-6 Thermal Paste 4g',  category: 'cat-cooling', price: { minor_units: 125000,  currency: 'IDR' }, barcode: '872767004500', in_stock: true,  stock_qty: 60, product_type: 'retail', tax_rate_ids: [], created_at: '', price_updated_at: '' },
];

const RETAIL_SAMPLE_CATEGORIES: CategoryDto[] = [
  { id: 'cat-cpu', name: 'Processors (CPU)', colour: '#e74c3c', icon: 'cpu-1' },
  { id: 'cat-gpu', name: 'Graphics Cards (GPU)', colour: '#2ecc71', icon: 'gpu-1' },
  { id: 'cat-ram', name: 'Memory (RAM)', colour: '#9b59b6', icon: 'ram-1' },
  { id: 'cat-storage', name: 'Storage (SSD/HDD)', colour: '#3498db', icon: 'hdd-1' },
  { id: 'cat-mb', name: 'Motherboards', colour: '#f39c12', icon: 'mb-1' },
  { id: 'cat-psu', name: 'Power Supply', colour: '#1abc9c', icon: 'psu-1' },
  { id: 'cat-cooling', name: 'Cooling & Cases', colour: '#34495e', icon: 'cool-1' },
];

interface RetailPosScreenProps {
  onNavigate?: (route: string) => void;
}

/** Retail POS sales screen — product lookup on the left, cart panel on the right with resizable width and barcode scanning support. */
export default function RetailPosScreen({ onNavigate }: RetailPosScreenProps) {
  const { l10n } = useLocalization();
  const l10nRef = useRef(l10n);
  l10nRef.current = l10n;
  const { goToWorkspacePicker } = useWorkspaceNav();
  // A session that expires MID-SHIFT. AppShell's banner covers a REJECTED
  // `createSession` at boot; this covers `invalidSession` answering a later command,
  // which would otherwise leave the operator unable to take payment with nothing said.
  const showSessionBanner = useInvalidSession();
  const { addToast } = useToast();
  const { session, isManager } = useAuth();
  // ADR #36 D7: cost editing is manager+ only (products:edit_cost). The
  // backend enforces the write; this only gates the UI field and payload.
  const canEditCost = hasGrantedPermission(session?.permissions, 'products:edit_cost');
  const { sessionToken: rawToken, setActiveWorkspace } = useWorkspace();
  const sessionToken = rawToken || '';
  const userId = session?.user_id ?? '';

  // ── Screen-reader announcements (declared early — used by add handlers) ──
  const announceRef = useRef<HTMLDivElement>(null);
  const announceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announce = useCallback((msg: string) => {
    if (announceTimerRef.current) clearTimeout(announceTimerRef.current);
    if (announceRef.current) {
      announceRef.current.textContent = msg;
      announceTimerRef.current = setTimeout(() => {
        if (announceRef.current) announceRef.current.textContent = '';
      }, 3000);
    }
  }, []);

  const {
    lines, total, subtotal, discountPercent, discountLabel, discountAmount,
    tipAmount, serviceChargeAmount,
    addProduct, removeLine, updateQty, changeQty, updateLinePrice, assignCourse, setDiscount, resetCart,
  } = usePosState();

  const lineCount = lines.reduce((a, l) => a + l.qty, 0);
  // Ref for stock-check callbacks to avoid stale closure on rapid sequential adds
  const linesRef = useRef(lines);
  linesRef.current = lines;

  const { playBeep, playError, playSuccess, setSoundEnabled } = useSound();

  // ── Sound toggle from options ─────────────────────────────────
  useEffect(() => {
    const check = () => {
      const enabled = localStorage.getItem('retail-sound-enabled') !== 'false';
      setSoundEnabled(enabled);
    };
    check();
    window.addEventListener('storage', check);
    return () => window.removeEventListener('storage', check);
  }, [setSoundEnabled]);

  // ── Tender presets from options ───────────────────────────────

  const { isEnabled } = useFeatures();

  const [weighTarget, setWeighTarget] = useState<{ sku: Sku; name: string } | null>(null);

  // ── Serial Number Capture ──────────────────────────────────────────
  const [serialNumbers, setSerialNumbers] = useState<Record<string, string>>({});
  const [trackSerialMap, setTrackSerialMap] = useState<Record<string, boolean>>({});
  const pendingTrackFetchRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const uniqueSkus = [...new Set(lines.map((l) => l.sku))];
    // Clean up pending set: remove SKUs no longer in the cart
    for (const sku of pendingTrackFetchRef.current) {
      if (!uniqueSkus.includes(sku as Sku)) pendingTrackFetchRef.current.delete(sku);
    }
    const missing = uniqueSkus.filter(
      (sku) => trackSerialMap[sku] === undefined && !pendingTrackFetchRef.current.has(sku),
    );
    if (missing.length === 0) return;
    for (const sku of missing) pendingTrackFetchRef.current.add(sku);
    // PERF-03: fetch every missing flag in ONE IPC round trip instead of
    // one get_product_track_serial call per SKU (N+1 elimination).
    getProductTrackSerialBatchScoped(sessionToken, missing as string[])
      .then((rows) => {
        setTrackSerialMap((prev) => {
          const next = { ...prev };
          for (const row of rows) next[row.sku] = row.track_serial;
          return next;
        });
      })
      .catch(() => {
        // best-effort: release the pending guard so a later cart change
        // re-fetches the batch (a transient IPC failure must not pin these
        // SKUs to non-tracking for the whole session). Leaving the map
        // undefined keeps the serial-capture UI hidden, same as false — and
        // since the map is unchanged, the effect won't re-run here, so the
        // re-fetch only happens on the next explicit cart mutation.
        for (const sku of missing) pendingTrackFetchRef.current.delete(sku);
      });
    // sessionToken is read at :184. Without it, a cart mutation after a cashier hot-swap re-ran
    // this effect against the destroyed token, hit the catch above, and left trackSerialMap
    // undefined for those SKUs -- which per the comment just above keeps the serial-capture UI
    // hidden. Serial-tracked products would silently stop capturing serial numbers mid-shift,
    // and the effect would not retry until another explicit cart mutation.
  }, [lines, trackSerialMap, sessionToken]);

  const handleSerialChange = useCallback((lineId: string, serial: string) => {
    setSerialNumbers((prev) => ({ ...prev, [lineId]: serial }));
  }, []);

  // ── Quick Return ───────────────────────────────────────────────────
  const [showQuickReturn, setShowQuickReturn] = useState(false);
  const [quickReturnBarcode, setQuickReturnBarcode] = useState('');
  const [quickReturnLoading, setQuickReturnLoading] = useState(false);
  const [quickReturnSale, setQuickReturnSale] = useState<SaleDetail | null>(null);
  const [showQuickReturnRefund, setShowQuickReturnRefund] = useState(false);

  const handleQuickReturnSubmit = useCallback(async () => {
    const barcode = quickReturnBarcode.trim();
    if (!barcode) return;
    setQuickReturnLoading(true);
    try {
      const sale = await lookupSaleByReceiptBarcodeScoped(sessionToken, barcode);
      if (sale) {
        setQuickReturnSale(sale);
        setShowQuickReturn(false);
        setShowQuickReturnRefund(true);
        setQuickReturnBarcode('');
      } else {
        addToast({ message: requiredLocalized(l10n, 'retail-quick-return-not-found'), type: 'error' });
        playError();
      }
    } catch {
      addToast({ message: requiredLocalized(l10n, 'retail-quick-return-error'), type: 'error' });
      playError();
    } finally {
      setQuickReturnLoading(false);
    }
  }, [quickReturnBarcode, addToast, l10n, playError, sessionToken]);


  // P0-1 (retail theming audit, archived by d0fe74814 — the doc is gone): replace the
  // shadow useState that read a per-component localStorage key and matched
  // the OS dark-mode preference on mount but never updated afterwards.
  // useOptionalTheme()?.theme returns Theme | undefined — Theme when
  // AppProviders' ThemeProvider wraps, undefined for unwrapped renders
  // (React strips undefined from JSX attributes; CSS falls back to :root
  // via cascade).
  // Implicitly also closes the P0-3 storage-key shadow, the P2-6 dead
  // setter, and the P2-7 missing-useTheme import by deleting the
  // shadow state entirely.
  const theme = useOptionalTheme()?.theme;


  // ── Cart panel resize state ───────────────────────────────────────
  const [retailCartWidth, setRetailCartWidth] = useState(() => {
    const saved = localStorage.getItem('retail-cart-width');
    const parsed = saved ? parseInt(saved, 10) : NaN;
    const initial = Number.isFinite(parsed) && parsed > 0 ? parsed : RETAIL_CART_WIDTH_DEFAULT;
    const vw = typeof window !== 'undefined' ? window.innerWidth : RETAIL_CART_WIDTH_DEFAULT * 2;
    return clampRetailCartWidth(initial, vw);
  });
  const isResizing = useRef(false);
  const retailPosRef = useRef<HTMLDivElement>(null);
  // PERF-04: hold the latest clamped width + pointer X so mouseup can flush
  // the final value instead of writing localStorage on every mousemove.
  const latestClampedRef = useRef(retailCartWidth);
  const lastClientXRef = useRef(0);

  /** Compute + apply the cart width from the latest pointer position. */
  const applyWidthFromPointer = useCallback(() => {
    if (!isResizing.current || !retailPosRef.current) return;
    const rect = retailPosRef.current.getBoundingClientRect();
    const clamped = clampRetailCartWidth(
      rect.right - lastClientXRef.current,
      window.innerWidth,
    );
    latestClampedRef.current = clamped;
    setRetailCartWidth(clamped);
  }, []);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    let rafId: number | null = null;
    const stopResize = () => {
      if (!isResizing.current) return;
      // Flush any pending frame synchronously while still resizing so a fast
      // drag-then-release never loses the final pointer position (PERF-04).
      // Order matters: applyWidthFromPointer() early-returns once isResizing
      // is cleared, so flush BEFORE resetting the flag.
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
        applyWidthFromPointer();
      }
      isResizing.current = false;
      // Persist the final width once, at the end of the drag.
      localStorage.setItem('retail-cart-width', String(latestClampedRef.current));
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!isResizing.current || !retailPosRef.current) return;
      lastClientXRef.current = e.clientX;
      // Coalesce mousemove events into ONE state update per animation
      // frame (PERF-04) instead of setState on every pointer move.
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        applyWidthFromPointer();
      });
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', stopResize);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', stopResize);
      if (rafId !== null) cancelAnimationFrame(rafId);
      stopResize();
    };
  }, [applyWidthFromPointer]);

  useEffect(() => {
    const onResize = () => {
      setRetailCartWidth((w) => {
        const clamped = clampRetailCartWidth(w, window.innerWidth);
        localStorage.setItem('retail-cart-width', String(clamped));
        return clamped;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ── Undo stack ───────────────────────────────────────────────────
  const MAX_UNDO = 5;
  const [undoStack, setUndoStack] = useState<{ sku: Sku; name: string; category: string; unit_price: Money; qty: number; courseId?: CourseId; modifiers?: ModifierSelection[] }[]>([]);

  const handleRemoveLine = useCallback((id: string, line: { sku: Sku; name: string; category: string; unit_price: Money; qty: number; courseId?: CourseId; modifiers?: ModifierSelection[] }) => {
    removeLine(id as LineId);
    setUndoStack((prev) => [line, ...prev].slice(0, MAX_UNDO));
  }, [removeLine]);

  const handleUndoRemove = useCallback(() => {
    if (undoStack.length === 0) return;
    const item = undoStack[0]!;
    // Restore the exact line — including its course assignment and
    // modifiers — not a bare re-add (the modifiers would be lost).
    addProduct({ sku: item.sku, name: item.name, category: item.category, productType: 'retail', price: item.unit_price, barcode: null, inStock: true, stockQty: null }, item.qty, {
      ...(item.courseId !== undefined ? { courseId: item.courseId } : {}),
      ...(item.modifiers !== undefined ? { modifiers: item.modifiers } : {}),
    });
    announce(requiredLocalized(l10nRef.current, 'retail-added-to-cart', { name: item.name }));
    setUndoStack((prev) => prev.slice(1));
  }, [undoStack, addProduct, announce]);

  const undoBarExit = useExitAnimation(
    undoStack.length > 0,
    () => setUndoStack([]),
  );

  const handleDismissUndo = useCallback(() => {
    undoBarExit.requestClose();
  }, [undoBarExit]);

  // ── Quantity picker ──────────────────────────────────────────────
  const [showQtyPicker, setShowQtyPicker] = useState(false);
  const [pendingProduct, setPendingProduct] = useState<ProductDto | null>(null);
  const [qtyInput, setQtyInput] = useState('1');

  // The one ceiling for this picker, shared by the display and the commit.
  //
  // WHY IT IS A BUSINESS BOUND AND NOT A SCHEMA ONE: the DB CHECK on cart/sale
  // line quantity is `qty > 0` (the `sale_lines` CHECK constraint in 20260813_init.sql)
  // with no upper limit, so
  // nothing downstream would have caught an absurd value. The only other gate,
  // the stock check in `handleConfirmQty`, is skipped entirely for a product
  // whose `stock_qty` is null — every service item and anything inventory does
  // not cover. Measured before the fix: typing 999999 into the box committed
  // exactly 999999 units.
  //
  // WHY IT LIVES HERE AND NOT ONLY AT THE COMMIT: the modal renders its total
  // from the raw input (RetailModals.tsx:655), so a bound applied only at
  // commit leaves a wrong MONEY figure on screen the cashier reads as a price.
  // Clamping on the write bounds both paths at one place, which is the point —
  // two ceilings would drift.
  const MAX_QTY_PER_LINE = 9999;
  const clampQtyInput = useCallback((raw: string) => {
    // Keep the box editable while the user is mid-typing: an empty or partial
    // string parses to 0, which the lower bound turns into '1'. Only clamp the
    // upper end, so backspacing still behaves.
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) return '1';
    return String(Math.min(MAX_QTY_PER_LINE, Math.max(1, n)));
  }, []);

  const handleQtyInputChange = useCallback((raw: string) => {
    setQtyInput(clampQtyInput(raw));
  }, [clampQtyInput]);

  const handleOpenQtyPicker = useCallback((p: ProductDto) => {
    setPendingProduct(p);
    setQtyInput('1');
    setShowQtyPicker(true);
  }, []);

  const handleConfirmQty = useCallback(() => {
    if (!pendingProduct) return;
    // CLAMPED AT THE COMMIT SITE. The lower bound alone was the old rule, so a
    // quantity typed into the picker box — which reaches `setQtyInput` raw as
    // `onInputChange` with no validation (RetailModals.tsx:618 -> :2046) — went
    // straight through for any product whose `stock_qty` is null, which is every
    // service item and anything inventory does not cover. Measured: typing
    // 999999 committed exactly 999999 units.
    //
    // The ceiling is a BUSINESS bound, not a schema one: the DB CHECK is
    // `qty > 0` (the `sale_lines` CHECK constraint in 20260813_init.sql) with no upper
  // limit, so nothing
    // downstream would have caught it. A till quantity has no legitimate reading
    // at 10,000 units — an operator who fat-fingers a 9 into a box meaning 1
    // cannot tell 9 from 999999 on a touch screen, and the modal's own total
    // line (RetailModals.tsx:655) multiplies the unit price by the raw value, so
    // the wrong figure is on screen as MONEY before the confirm is even pressed.
    // Backstop: the writer above already clamps, so this only fires for a
    // value that arrived by another path.
    const qty = Math.min(MAX_QTY_PER_LINE, Math.max(1, parseInt(qtyInput, 10) || 1));
    if (pendingProduct.stock_qty != null) {
      const inCart = linesRef.current.filter((l) => l.sku === pendingProduct.sku).reduce((s, l) => s + l.qty, 0);
      if (inCart + qty > pendingProduct.stock_qty) {
        addToast({ message: requiredLocalized(l10n, 'retail-toast-insufficient-stock', { name: pendingProduct.name }), type: 'warning' });
        return;
      }
    }
    addProduct(toProduct(pendingProduct), qty);
    announce(requiredLocalized(l10nRef.current, 'retail-added-to-cart', { name: pendingProduct.name }));
    setShowQtyPicker(false);
    setPendingProduct(null);
  }, [pendingProduct, qtyInput, addProduct, addToast, l10n, announce]);


  // ── Keyboard shortcut overlay ────────────────────────────────────
  const [showShortcuts, setShowShortcuts] = useState(false);

  // ── Barcode scan flash ───────────────────────────────────────────
  const [scanFlash, setScanFlash] = useState(false);
  const scanFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up the scan-flash and announce timers on unmount
  useEffect(() => {
    return () => {
      if (scanFlashTimerRef.current) clearTimeout(scanFlashTimerRef.current);
      if (announceTimerRef.current) clearTimeout(announceTimerRef.current);
    };
  }, []);

  // ── Confirm clear cart ────────────────────────────────────────────
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const handleRequestClear = useCallback(() => {
    if (lines.length === 0) return;
    setShowClearConfirm(true);
  }, [lines.length]);

  // ── Scroll preservation ──────────────────────────────────────
  const [savedScrollTop, setSavedScrollTop] = useState(0);

  // Save scroll position before swapping to a sub-view; restore after remount.
  // The real scroll container is .retail-grid (overflow-y: auto); .retail-main
  // itself is overflow-y: hidden, so read from the grid element. The data-testid
  // doubles as the scroll-container contract used by the scroll-preservation test
  // — keep it in sync with RetailProductGrid's grid wrapper (intentional coupling).
  const getScrollContainer = useCallback(() => {
    return retailPosRef.current?.querySelector<HTMLElement>('[data-testid="product-grid-scroll"]') ?? null;
  }, []);
  const saveScroll = useCallback(() => {
    const el = getScrollContainer();
    if (el) setSavedScrollTop(el.scrollTop);
  }, [getScrollContainer]);
  const goToSubView = useCallback((setter: (v: boolean) => void) => {
    saveScroll();
    setter(true);
  }, [saveScroll]);

  // ── Products & Categories ────────────────────────────────────

  const [products, setProducts] = useState<ProductDto[]>([]);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [filterLowStock, setFilterLowStock] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ADR #36 D4: per-user column visibility + hide-inactive (KDS pattern).
  const { prefs: colPrefs, toggleColumn: onToggleColumn, setHideInactive: onToggleHideInactive, setViewMode: onSetViewMode } = useRetailColumnPrefs();

  // ADR #38 D1: positioned row context menu state.
  const [rowMenu, setRowMenu] = useState<ContextMenuState | null>(null);

  const loadProductsAndCategories = useCallback((token: string) => {
    if (!token) return;
    // Abort any previous in-flight request to prevent race condition
    if (loadProductsAbortRef.current) {
      loadProductsAbortRef.current.abort();
    }
    const controller = new AbortController();
    loadProductsAbortRef.current = controller;
    setProductsLoading(true);
    setCategoriesLoading(true);
    setLoadError(null);
    // PERF-08: one deduplicated, cached IPC load for the whole catalog
    // instead of two independent requests on every workspace/session load.
    loadCatalog(token)
      .then(({ products: prods, categories: cats }) => {
        if (controller.signal.aborted) return;
        setProducts(prods);
        // LOAD-03: empty category list is a legitimate empty catalog in
        // production — never substitute demo categories outside dev.
        setCategories(cats && cats.length > 0 ? cats : (isDemoMode() ? RETAIL_SAMPLE_CATEGORIES : []));
        // PERF-06: time-to-interactive-POS marker — catalog rendered.
        recordMark('oz:pos-interactive');
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // DATA-01: SQLite is single source of truth. Failed catalog load keeps products empty
        // in all builds so phantom items never reach the cart. Demo category metadata is preserved.
        setProducts([]);
        setCategories(isDemoMode() ? RETAIL_SAMPLE_CATEGORIES : []);
        setLoadError(requiredLocalized(l10nRef.current, isDemoMode() ? 'retail-load-error' : 'retail-load-error-unavailable'));
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setProductsLoading(false);
          setCategoriesLoading(false);
        }
      });
    return () => { controller.abort(); };
  }, []);

  useEffect(() => loadProductsAndCategories(sessionToken), [sessionToken, loadProductsAndCategories]);

  const handleRetryLoad = useCallback(() => {
    loadProductsAndCategories(sessionToken);
  }, [sessionToken, loadProductsAndCategories]);

  // Tracks the latest AbortController so handleRetryLoad and rapid
  // sessionToken changes abort the previous in-flight fetch,
  // preventing stale data from overwriting fresh results.
  const loadProductsAbortRef = useRef<AbortController | null>(null);

  const [searchQuery, setSearchQuery] = useState('');

  const allLabel = requiredLocalized(l10n, 'product-lookup-all-categories');
  const catLabels = useMemo(() => {
    const m = new Map<string, string>();
    categories.forEach((c) => {
      const catId = `category-${c.id}`;
      const label = l10nRef.current.getString(catId);
      m.set(c.id, label !== catId ? label : c.name);
    });
    return m;
  }, [categories]); // l10n via ref

  const lowStockCount = useMemo(
    () => products.filter((p) => {
      if (p.stock_qty == null || p.stock_qty <= 0) return false;
      const threshold = p.low_stock_threshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
      return p.stock_qty <= threshold;
    }).length,
    [products],
  );

  const [editingProduct, setEditingProduct] = useState<ProductDto | null>(null);
  const [isAddCategoryOpen, setIsAddCategoryOpen] = useState(false);
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);

  const handleEditProduct = useCallback((p: ProductDto) => {
    setEditingProduct(p);
  }, []);

  // ADR #36 D5: the retail edit modal now persists through
  // `update_product_scoped` — cost/brand/rack/notes/unit/status ride the
  // PATCH attribute path, and a stock change issues an inventory adjustment.
  const handleSaveProductEdit = useCallback(async (updatedProduct: ProductDto) => {
    const prev = products.find((p) => p.sku === updatedProduct.sku);
    setProducts((prevList) =>
      prevList.map((p) => (p.sku === updatedProduct.sku ? updatedProduct : p)),
    );
    // PERF-08: catalog mutated — next load must refetch.
    invalidateCatalog(sessionToken);
    setEditingProduct(null);

    try {
      // Resolve the category id from the display name so the base update
      // does not NULL an existing category the modal never edits.
      const categoryId = categories.find((c) => c.name === updatedProduct.category)?.id ?? null;
      await updateProductScoped(sessionToken, {
        sku: updatedProduct.sku,
        name: updatedProduct.name,
        priceMinor: updatedProduct.price.minor_units,
        currency: updatedProduct.price.currency,
        categoryId,
        barcode: updatedProduct.barcode ?? null,
        productType: updatedProduct.product_type,
        taxRateIds: updatedProduct.tax_rate_ids,
        // PATCH attributes (ADR #36): absent/null keeps for cost, null clears
        // the text fields. Cost is omitted entirely without products:edit_cost
        // (the backend rejects cost writes for staff regardless).
        costMinor: canEditCost ? (updatedProduct.cost_minor ?? null) : undefined,
        brand: updatedProduct.brand ?? null,
        rackLocation: updatedProduct.rack_location ?? null,
        notes: updatedProduct.notes ?? null,
        unit: updatedProduct.unit ?? null,
        isActive: updatedProduct.is_active ?? prev?.is_active ?? true,
        defaultSupplierId: updatedProduct.default_supplier_id ?? null,
      });

      // Stock change → inventory adjustment (positive delta restocks,
      // matching the cost-override flow in the edit modal).
      if (prev && updatedProduct.stock_qty != null && prev.stock_qty != null && updatedProduct.stock_qty !== prev.stock_qty) {
        await adjustStockScoped(sessionToken, {
          sku: updatedProduct.sku,
          delta: updatedProduct.stock_qty - prev.stock_qty,
          reason: 'retail-edit',
        });
      }
    } catch (err) {
      // ROLL THE OPTIMISTIC EDIT BACK. The product was replaced by the
      // `setProducts(prevList.map(… updatedProduct …))` call above, and the editor closed by
      // the `setEditingProduct(null)` beside it, before the write was attempted — so a
      // refusal left the grid showing the operator's new values while the server kept the
      // old ones, until the next reload, long after the toast had gone. `prev` was captured
      // for exactly this and was never used; same defect as the add path one function down.
      // (Anchored by those two expressions: the numbers this note carried were all stale.)
      if (prev) {
        setProducts((prevList) =>
          prevList.map((p) => (p.sku === prev.sku ? prev : p)),
        );
      }
      addToast({ message: plainErrorMessage(err, requiredLocalized(l10nRef.current, 'retail-toast-save-product-failed')), type: 'error' });
    }
  }, [products, categories, addToast, sessionToken, canEditCost]);

  // ADR #36 for CATEGORIES. This handler used to append to React state and call
  // `invalidateCatalog` without ever awaiting a write — `createCategoryScoped` exists
  // (api/products.ts:285) and the whole retail feature called it ZERO times, so a category
  // the operator added lived only in local state and vanished on the next reload. That is
  // the same defect class the ADR #36 note below records for products, still open here.
  const handleSaveNewCategory = useCallback(async (newCat: CategoryDto) => {
    setActiveCategory(newCat.id);
    try {
      const created = await createCategoryScoped(sessionToken, {
        id: newCat.id,
        name: newCat.name,
        colour: newCat.colour ?? '',
        icon: newCat.icon ?? '',
      });
      // Adopt the SERVER's id when it returns one: the modal mints a client-side
      // `cat-<timestamp>` (AddCategoryModal.tsx:45), and the products that reference this
      // category carry whatever id is in state, so keeping the local one when the server
      // disagrees would file those products under a category that does not exist.
      const persisted = created?.id && created.id !== newCat.id
        ? { ...newCat, id: created.id }
        : newCat;
      setCategories((prev) => [...prev, persisted]);
      // PERF-08: catalog mutated — next load must refetch.
      invalidateCatalog(sessionToken);
      setActiveCategory(persisted.id);
    } catch (err) {
      // Nothing was persisted, so nothing is added to the grid. The operator keeps the
      // category list they had and is told why.
      setActiveCategory(null);
      addToast({
        message: plainErrorMessage(err, requiredLocalized(l10nRef.current, 'retail-toast-save-product-failed')),
        type: 'error',
      });
    }
  }, [setCategories, sessionToken, addToast]);

  // ADR #36 D5: the retail add modal now persists through
  // `create_product_scoped` (previously the product only lived in local
  // React state and vanished on reload).
  const handleSaveNewProduct = useCallback(async (newProd: ProductDto) => {
    setProducts((prev) => [newProd, ...prev]);
    // PERF-08: catalog mutated — next load must refetch.
    invalidateCatalog(sessionToken);

    try {
      const categoryId = categories.find((c) => c.name === newProd.category)?.id ?? null;
      await createProductScoped(sessionToken, {
        sku: newProd.sku,
        name: newProd.name,
        priceMinor: newProd.price.minor_units,
        currency: newProd.price.currency,
        categoryId,
        barcode: newProd.barcode ?? null,
        initialStock: newProd.stock_qty ?? 0,
        productType: newProd.product_type,
        taxRateIds: newProd.tax_rate_ids,
        // Cost is only sent when the session may write it (ADR #36 D7).
        costMinor: canEditCost ? (newProd.cost_minor ?? 0) : 0,
        brand: newProd.brand ?? null,
        rackLocation: newProd.rack_location ?? null,
        notes: newProd.notes ?? null,
        unit: newProd.unit ?? null,
        isActive: newProd.is_active !== false,
        defaultSupplierId: newProd.default_supplier_id ?? null,
      });
    } catch (err) {
      // ROLL THE OPTIMISTIC ROW BACK. The row was inserted at the top of this callback
      // (`setProducts((prev) => [newProd, ...prev])`) before the create was attempted, so a
      // refusal would otherwise leave the
      // operator looking at a product they believe is saved — and it vanishes on the next
      // reload. That is the same class the ADR #36 comment above describes fixing
      // ("previously the product only lived in local React state and vanished on reload"),
      // reintroduced on the FAILURE path. The toast says what failed; this makes the grid
      // agree with the server.
      setProducts((prev) => prev.filter((p) => p.sku !== newProd.sku));
      addToast({ message: plainErrorMessage(err, requiredLocalized(l10nRef.current, 'retail-toast-save-product-failed')), type: 'error' });
    }
  }, [categories, addToast, sessionToken, canEditCost]);

  const filteredProducts = useMemo(() => {
    // `'service'` items belong on this grid too. They are a real, backend-supported
    // product type — `products_stock_query.rs:403` reads `is_service` and SKIPS stock
    // deduction for them — and `ProductManagementScreen.tsx:684` lets a merchant create
    // one. But nothing consumed them: this grid filtered on `'retail'` alone, the
    // restaurant grid on `'restaurant'` alone, so a service item (an installation fee, an
    // hourly rate) could be created and then never added to a sale in EITHER workspace.
    // A type the UI can write but no screen can sell is the write-only shape.
    let list = products.filter((p) => p.product_type === 'retail' || p.product_type === 'service');
    if (activeCategory) {
      const activeCatObj = categories.find((c) => c.id === activeCategory);
      list = list.filter(
        (p) =>
          p.category === activeCategory ||
          (activeCatObj && p.category === activeCatObj.name) ||
          p.category?.toLowerCase() === activeCategory.toLowerCase(),
      );
    }
    if (filterLowStock) {
      list = list.filter((p) => {
        if (p.stock_qty == null || p.stock_qty <= 0) return false;
        const threshold = p.low_stock_threshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
        return p.stock_qty <= threshold;
      });
    }
    // ADR #36: hide retired products without deleting them.
    if (colPrefs.hideInactive) {
      list = list.filter((p) => p.is_active !== false);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
    }
    return list;
  }, [products, activeCategory, searchQuery, categories, filterLowStock, colPrefs.hideInactive]);

  // ADR #37 D5: default sort on load is popularity descending (most
  // popular first) with SKU tiebreak; clicking a column header switches.
  const [sortField, setSortField] = useState<SortField>('popularity');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else if (field === 'popularity') {
      // First click on popularity sorts most-popular-first (natural).
      setSortField(field);
      setSortOrder('desc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  }, [sortField]);

  const sortedProducts = useMemo(() => {
    const list = [...filteredProducts];
    list.sort((a, b) => {
      // ADR #37 D5: popularity handles direction internally so the SKU
      // tiebreak stays deterministic (ascending) regardless of order.
      if (sortField === 'popularity') {
        const diff = (a.popularity_score ?? 0) - (b.popularity_score ?? 0);
        if (diff !== 0) return sortOrder === 'asc' ? diff : -diff;
        return a.sku.localeCompare(b.sku);
      }
      let comp = 0;
      if (sortField === 'sku') {
        comp = a.sku.localeCompare(b.sku);
      } else if (sortField === 'name') {
        comp = a.name.localeCompare(b.name);
      } else if (sortField === 'stock') {
        const stockA = a.stock_qty ?? 0;
        const stockB = b.stock_qty ?? 0;
        comp = stockA - stockB;
      } else if (sortField === 'price') {
        comp = a.price.minor_units - b.price.minor_units;
      }
      return sortOrder === 'asc' ? comp : -comp;
    });
    return list;
  }, [filteredProducts, sortField, sortOrder]);

  // PERF-07: bounded pagination via the shared list policy — the grid
  // renders only the active page, never the full catalog.
  const { page: productPage, total: totalPages, pageItems: pagedProducts, setPage: setProductPage, resetPage } = usePagedList(sortedProducts);

  // Reset page when filter changes (PERF-07: keep the page in range).
  // Deps use the stable `resetPage` callback — NOT the `usePagedList`
  // result object, which is a fresh reference every render and would
  // re-run this effect (and reset the page) on every render.
  useEffect(() => { resetPage(); }, [activeCategory, searchQuery, filterLowStock, resetPage]);

  const catHue = useCallback((catId: string | null) => {
    if (!catId) return 210;
    let h = 0;
    for (let i = 0; i < catId.length; i++) h = (h * 31 + catId.charCodeAt(i)) | 0;
    return Math.abs(h) % 360;
  }, []);

  // ADR #37 D2: a product added while a search filter is active is an
  // acted-upon search — count it for the popularity index (fire-and-forget).
  const recordSearchIfActive = useCallback((sku: string, fromExplicitLookup = false) => {
    if (searchQuery.trim() || fromExplicitLookup) {
      recordProductSearchScoped(sessionToken, sku);
    }
  }, [searchQuery, sessionToken]);

  const handleAdd = useCallback((p: ProductDto) => {
    if (p.stock_qty != null) {
      const inCart = linesRef.current.filter((l) => l.sku === p.sku).reduce((s, l) => s + l.qty, 0);
      if (inCart + 1 > p.stock_qty) {
        addToast({ message: requiredLocalized(l10n, 'retail-toast-insufficient-stock', { name: p.name }), type: 'warning' });
        return;
      }
    }
    addProduct(toProduct(p));
    announce(requiredLocalized(l10nRef.current, 'retail-added-to-cart', { name: p.name }));
    recordSearchIfActive(p.sku);
  }, [addProduct, addToast, l10n, announce, recordSearchIfActive]);

  const handleWeighAdd = useCallback((sku: Sku, weightGrams: number) => {
    const product = products.find((p) => p.sku === sku);
    if (!product) return;
    const qty = Math.max(1, Math.round(weightGrams));
    if (product.stock_qty != null) {
      const inCart = linesRef.current.filter((l) => l.sku === sku).reduce((s, l) => s + l.qty, 0);
      if (inCart + qty > product.stock_qty) {
        addToast({ message: requiredLocalized(l10n, 'retail-toast-insufficient-stock', { name: product.name }), type: 'warning' });
        return;
      }
    }
    addProduct(toProduct(product), qty);
    announce(requiredLocalized(l10nRef.current, 'retail-added-to-cart', { name: product.name }));
    setWeighTarget(null);
    addToast({ message: requiredLocalized(l10n, 'scale-weigh-added', { name: product.name, weight: qty }), type: 'success' });
  }, [products, addProduct, addToast, l10n, announce]);

  const handleSetWeighTarget = useCallback((p: ProductDto) => {
    if (weighTarget?.sku === p.sku) return;
    setWeighTarget({ sku: p.sku as Sku, name: p.name });
    addToast({ message: requiredLocalized(l10n, 'scale-target-set', { name: p.name }), type: 'info' });
  }, [weighTarget, addToast, l10n]);

  // ── Row context menu (ADR #38) ────────────────────────────────

  const handleRowContextMenu = useCallback((p: ProductDto, x: number, y: number) => {
    setRowMenu({ product: p, x, y });
  }, []);

  const handleViewProductImages = useCallback((p: ProductDto) => {
    // ADR #38 D3: opens the OS default browser in a new tab at a Google
    // Images search for the product name (+ brand). Best-effort.
    //
    // TWO DOORS, because each shell registers only one (measured 2026-10-25):
    // the desktop registers the store-scoped twin, and the tablet registers
    // `open_product_images`, a global-db read whose own module doc names the
    // desktop command as the other half. Calling the scoped twin on tablet
    // threw, and the wrapper's catch turned that into a search on the raw SKU
    // -- a worse query than the name+brand the backend builds, and silent.
    // Guarded at the call site with the C47 idiom (if/else on the shell), the
    // same shape UpdateSettingsCard uses for the Android-only updater legs.
    if (isTabletShell()) {
      openProductImages(p.sku).catch(() => {});
    } else {
      openProductImagesScoped(sessionToken, p.sku).catch(() => {});
    }
  }, [sessionToken]);

  /**
   * Stock-aware cart qty increase — checks stock_qty before incrementing.
   *
   * READS THE LIVE ROW, not the rendered prop. Both this guard and the write used to
   * derive from `line`, the object captured when the row last rendered — and both call
   * sites pass the SAME stale object when two taps land in one React batch (a fast
   * double-tap on a touch till is one gesture, so this is the normal case).
   *
   * MEASURED: two batched taps asked for qty 2 twice (`updateQty(id, 2)` then
   * `updateQty(id, 2)`), so `updateQty` — which OVERWRITES the row rather than
   * incrementing (`usePosState.ts:138`) — ended at 2 after two presses. The cashier
   * pressed `+` twice and the cart went up by one.
   *
   * The stock guard was stale for the same reason and is the more serious half: it tested
   * `line.qty + 1` against remaining stock, so rapid taps could walk past the ceiling the
   * guard exists to enforce on a SKU that is nearly out.
   */
  const handleIncreaseQty = useCallback((line: { sku: string; id: LineId; qty: number }) => {
    // The row as the cart ACTUALLY holds it. `linesRef` is assigned on every render,
    // so it always carries the committed state rather than a render snapshot.
    const current = linesRef.current.find((l) => l.id === line.id) ?? line;
    const product = products.find((p) => p.sku === line.sku);
    if (product?.stock_qty != null) {
      const otherLinesQty = linesRef.current
        .filter((l) => l.sku === line.sku && l.id !== line.id)
        .reduce((s, l) => s + l.qty, 0);
      if (otherLinesQty + current.qty + 1 > product.stock_qty) {
        addToast({ message: requiredLocalized(l10n, 'retail-toast-insufficient-stock', { name: product.name }), type: 'warning' });
        return;
      }
    }
    // The DELTA form, so the increment resolves against whatever the cart holds when
    // React flushes it — not the `qty` this row rendered with. Reading `current.qty`
    // fixes the stock GUARD; passing a delta fixes the WRITE, and only the write
    // being a delta makes two batched taps accumulate to two increments.
    changeQty(line.id, 1);
  }, [products, changeQty, addToast, l10n]);

  /** Open the modifier editor for a cart line. */
  const handleEditModifiers = useCallback((line: CartLine) => {
    setModifierLine(line);
  }, []);

  // ── SKU / Barcode input ──────────────────────────────────────

  const productsRef = useRef(products);
  productsRef.current = products;

  const [skuInput, setSkuInput] = useState('');
  const skuInputRef = useRef<HTMLInputElement>(null);
  const handleSkuSubmit = useCallback(async () => {
    const val = skuInput.trim();
    if (!val) return;
    setSkuInput('');
    const list = productsRef.current;
    const p = list.find((x) => x.sku === val || x.barcode === val);
    if (p) { recordSearchIfActive(p.sku, true); handleAdd(p); return; }
    try {
      const found = await lookupProductBySkuScoped(sessionToken, val);
      if (found) { recordSearchIfActive(found.sku, true); handleAdd(found); return; }
    } catch { /* unreachable */ }
    addToast({ message: requiredLocalized(l10n, 'retail-sku-not-found', { sku: val }), type: 'warning' });
  }, [skuInput, handleAdd, addToast, l10n, sessionToken, recordSearchIfActive]);

  const handleBarcode = useCallback(async (payload: { code: string }) => {

    const list = productsRef.current;
    const found = list.find((x) => x.barcode === payload.code);
    if (found) { recordSearchIfActive(found.sku, true); handleAdd(found); setScanFlash(true); playBeep(); if (scanFlashTimerRef.current) clearTimeout(scanFlashTimerRef.current); scanFlashTimerRef.current = setTimeout(() => { setScanFlash(false); scanFlashTimerRef.current = null; }, 300); return; }
    try {
      const p = await lookupByBarcodeScoped(sessionToken, payload.code);
      if (p) { recordSearchIfActive(p.sku, true); handleAdd(p); setScanFlash(true); playBeep(); if (scanFlashTimerRef.current) clearTimeout(scanFlashTimerRef.current); scanFlashTimerRef.current = setTimeout(() => { setScanFlash(false); scanFlashTimerRef.current = null; }, 300); return; }
    } catch { /* unreachable */ }
    playError();
    addToast({ message: requiredLocalized(l10n, 'pos-no-barcode-match'), type: 'warning' });
  }, [handleAdd, addToast, l10n, playBeep, playError, sessionToken, recordSearchIfActive]);

  useBarcodeScanner({ sessionToken, onProductFound: handleBarcode });

  // ── Store settings ──────────────────────────────────────────

  const [storeSettings, setStoreSettings] = useState<StoreSettingsDto>({ name: '', address: '', taxId: '', currency: 'IDR', branch: '', logo: '' });

  const tenderPresets = useMemo(() => {
    try {
      const saved = localStorage.getItem('retail-tender-presets');
      if (saved) {
        const parsed = JSON.parse(saved) as number[];
        // Filter out zero/NaN values to avoid division-by-zero in PaymentModal
        const filtered = parsed.filter((n) => Number.isFinite(n) && n > 0);
        if (filtered.length > 0) return filtered;
      }
    } catch { /* ignore */ }
    return defaultTenderPresets(storeSettings.currency);
  }, [storeSettings.currency]);
  // A `mounted` flag is the WRONG GUARD here and this used to have one. It only
  // tracks unmount, so it stays true across a store switch -- exactly like
  // SettingsContext.mountedRef, which needed this same correction in 09ac4df43.
  // The reads overlap because the deps name sessionToken, so a slower earlier one
  // lands last and applies the PREVIOUS store's settings.
  //
  // THE CONSEQUENCE IS MONEY, at three sites. `storeSettings.currency` is passed to
  // `parseMoneyInput` when parsing the OPENING drawer balance (`openingBalance` in
  // handleOpenShift), the CLOSING balance (`closingBalance` in handleConfirmCloseShift)
  // and the manual discount (`discountRpInput`) — all three found by IDENTIFIER, not by
  // line number. ⚠️ They were cited first as lines 930 / 948 / 1032, then as 1140 /
  // 1158 / 1242, and every rewrite moved the very lines it was citing: this comment
  // sits ABOVE all three sites, so each added line shifted them. A number that the act
  // of writing invalidates is not an anchor. The three symbols are unique in this file.
  // (Those figures are spelled "line N" and NOT ":N" on purpose — a bare colon-number
  // in a comment IS a live citation to the guard that polices this file, which is how
  // this note acquired three of its own.)
  // The cause of the original drift: the SKU/barcode block was inserted above the money
  // handlers and pushed them down ~210 lines. `minorUnitExponent` is no longer called
  // here at all — `parseMoneyInput` replaced it, so the name survives only in this
  // comment, which is why nobody re-derived the numbers.
  // The exponent is 0 for IDR and 2 for USD, so a stale currency misreads those amounts
  // by a factor of 100. That is the failure mode the MONEY-02 / MONEY-05 notes protect
  // against (search "MONEY-02"; the old cite pointed at the stock guard) -- they
  // fixed the hardcoded x100 and left the currency itself able to go stale.
  //
  // PINNED, and the two attempts to pin it are worth reading before touching this.
  //
  // The trap was TEST ORDER, not the guard. `9bba6975e` did the bisect and found the
  // cause: the store-switch cases MUTATE `wsState.sessionToken` and nothing restored it
  // between tests, so an earlier case left the token already at the value this case
  // switches TO. The switch was then a no-op, the effect never re-ran, and the assertion
  // passed while racing nothing. Resetting the token in beforeEach was the fix.
  // `4ccb51020` then pinned the guard: deleting `if (!stale()) setStoreSettings(s)` fails
  // `RetailPosScreen.test.tsx` -> 'ignores a slower earlier store-settings read after a
  // token change', measured again on 2026-10-13 (kill-test, 1 failed / 35 passed).
  //
  // Rounds 113 and 114 were reverted because each tried the assertion FIRST. The bisect
  // was the missing step, and it is the reason this is now covered.
  const storeSettingsSeq = useRef(0);
  useEffect(() => {
    if (!sessionToken) return;
    const seq = ++storeSettingsSeq.current;
    const stale = () => storeSettingsSeq.current !== seq;
    getStoreSettingsScoped(sessionToken)
      .then((s) => { if (!stale()) setStoreSettings(s); })
      .catch(() => {
        if (stale()) return;
        addToast({ message: requiredLocalized(l10nRef.current, 'retail-toast-failed-settings'), type: 'error' });
      });
    return () => { storeSettingsSeq.current += 1; };
  }, [addToast, sessionToken]);

  // ── Shift management ─────────────────────────────────────────

  const [activeShift, setActiveShift] = useState<ShiftDto | null>(null);
  const [shiftLoading, setShiftLoading] = useState(true);
  // True when the active-shift read THREW. Distinct from "read successfully and
  // found no shift", which is what `activeShift === null` used to mean on its own.
  const [shiftLoadFailed, setShiftLoadFailed] = useState(false);
  const [showOpenShift, setShowOpenShift] = useState(false);
  const [showCloseShift, setShowCloseShift] = useState(false);
  const [openingBalance, setOpeningBalance] = useState('');
  const [closingBalance, setClosingBalance] = useState('');
  const [shiftNotes, setShiftNotes] = useState('');
  const [openingShift, setOpeningShift] = useState(false);
  const [closingShift, setClosingShift] = useState(false);
  const [closeShiftError, setCloseShiftError] = useState<string | null>(null);
  const [closedShiftSummary, setClosedShiftSummary] = useState<ShiftDto | null>(null);

  // Fade the retail modals out with mirror keyframes before the
  // parent setter flips the boolean gate. Used by Cancel buttons
  // and × icons. Confirm-success paths that either reload the
  // app or swap to a sibling summary (close-shift↔summary) snap
  // intentionally per the navigate-to-next-state rule.
  const retailOpenShiftExit = useExitAnimation(showOpenShift, () => setShowOpenShift(false));
  const retailCloseShiftExit = useExitAnimation(
    showCloseShift && !closedShiftSummary,
    () => { setShowCloseShift(false); setCloseShiftError(null); },
  );
  const retailShiftSummaryExit = useExitAnimation(
    !!closedShiftSummary,
    () => setClosedShiftSummary(null),
  );

  // Guarded, and this is the most consequential site in the class. Same shape as
  // usePosShifts (1aead7518) -- deps name sessionToken, so a store switch starts a
  // second read while the first is in flight -- but the consequence here is worse.
  //
  // `handleCloseShift` passes `activeShift.id` to closeShiftScoped along with the
  // counted closing balance. A stale shift from the PREVIOUS store would therefore
  // let the cashier CLOSE that store's shift against this store's count -- a wrong
  // closing balance written to another tenant's ledger. On the sales-POS twin the
  // stale value merely refuses or mislabels; here it writes money.
  //
  // Note the setActiveShift(null) above: clearing on entry is itself a write, so the
  //   clear is sequenced too rather than running unconditionally before the guard.
  // UNPINNED, AND THE REASON IS MECHANICAL RATHER THAN MYSTERIOUS.
  //
  // Three attempts to pin this by mutation have been made and none landed. The harness is
  // NOT the problem: the workspace mock reads its token live (611457e1c), wsState is
  // declared with vi.hoisted above the factory, order is enforced by call count, and the
  // two arms answer with distinctly different states. All of that is verified.
  //
  // WHAT ACTUALLY HAPPENS: after the token is switched and the screen re-rendered through
  // rerenderWithProviders, `getActiveShiftScoped` has been called ONCE, not twice. The
  // effect does not re-run. Reproduced three times, so it is a property of the component
  // rather than of the test.
  //
  // Note this screen is NOT the usePosShifts hook -- it has its own useState and its own
  // effect right here, which is why there is no shared hook to pin in isolation the way
  // the hook could be (5bbef0162). The screen-level test is the only route, and the
  // screen is large.
  //
  // WHERE TO START, and it is one specific thing I did not test: whether the re-render
  // reaches this component AT ALL. Log inside the render body and confirm a second render
  // happens BEFORE touching the assertion. If the render happens and the effect still does
  // not run, the deps chain is the suspect; if the render does not happen, the test is
  // re-rendering a stale element and the effect is irrelevant.
  const shiftSeq = useRef(0);

  /**
   * Read the active shift, with the staleness guard this screen has always had.
   *
   * EXTRACTED FROM THE MOUNT EFFECT so a MUTATING path can refresh it. It was a
   * single effect keyed on `sessionToken`, which is correct for the read at mount
   * and wrong for every other read: nothing re-ran it afterwards, so anything that
   * changed the shift's money left the till — and the close-shift flow it feeds —
   * showing pre-mutation totals.
   *
   * The first defect this exposed (round 118): a QUICK-RETURN REFUND. `ShiftDto`
   * carries `totalRefundsMinor`, `totalSalesMinor` and `totalCashMinor`
   * (api/shifts.ts:18-23), and `handleQuickReturnRefundDone` cleared the modal
   * without re-reading. The drawer was then reconciled against figures that
   * excluded the refund the cashier had just processed.
   */
  const loadActiveShift = useCallback(() => {
    if (!sessionToken) return;
    const seq = ++shiftSeq.current;
    const stale = () => shiftSeq.current !== seq;
    setActiveShift(null);
    setShiftLoadFailed(false);
    setShiftLoading(true);
    getActiveShiftScoped(sessionToken)
      .then((s) => {
        if (stale()) return;
        setActiveShift(s);
      })
      .catch(() => {
        if (stale()) return;
        // A FAILED shift read is not the same as "no shift open". Setting null
        // made the header print "No shift" and made handlePay tell the cashier to
        // open a shift first — for a read that never answered. Flag it so the
        // header can say "unknown" instead of asserting an absence.
        setActiveShift(null);
        setShiftLoadFailed(true);
      })
      .finally(() => {
        if (!stale()) setShiftLoading(false);
      });
    return () => {
      shiftSeq.current += 1;
    };
  }, [sessionToken]);

  useEffect(() => loadActiveShift(), [loadActiveShift]);

  const handleQuickReturnRefundDone = useCallback(() => {
    setShowQuickReturnRefund(false);
    setQuickReturnSale(null);
    // ⚠️ THE REFUND MOVED MONEY ON THE SHIFT, SO THE SHIFT IS RE-READ.
    //
    // This callback is wired to BOTH `onClose` and `onRefunded` (RetailModals.tsx:826-827)
    // and used to only hide the modal. `ShiftDto` carries `totalRefundsMinor`,
    // `totalSalesMinor` and `totalCashMinor` (api/shifts.ts:18-23), and this screen read
    // the shift ONCE at mount — so the close-shift flow the till feeds showed totals that
    // excluded the refund the cashier had just processed, and the drawer was reconciled
    // against the wrong figure.
    //
    // Round 110's rule applies to which halves of the behaviour change: the DISPLAY half
    // (what the cashier sees) needed the re-read; the modal state was already right.
    loadActiveShift();
  }, [loadActiveShift]);

  const handleOpenShift = useCallback(async () => {
    // MONEY-02: exact decimal parse; MONEY-05: scale by the STORE
    // currency's exponent — the drawer holds store currency, and the
    // old hardcoded ×100 inflated IDR (exponent 0) 100x.
    const val = parseMoneyInput(openingBalance, storeSettings.currency);
    if (val === null || val < 0) return;
    setOpeningShift(true);
    try {
      const s = await openShiftScoped(sessionToken, val);
      setActiveShift(s);
      setShowOpenShift(false);
      setOpeningBalance('');
    } catch {
      addToast({ message: requiredLocalized(l10n, 'retail-toast-failed-open-shift'), type: 'error' });
    } finally {
      setOpeningShift(false);
    }
  }, [openingBalance, addToast, l10n, sessionToken, storeSettings.currency]);

  const handleCloseShift = useCallback(async () => {
    if (!activeShift) return;
    // MONEY-02 + MONEY-05: exact parse at the store currency exponent.
    const val = parseMoneyInput(closingBalance, storeSettings.currency);
    if (val === null || val < 0) return;
    setClosingShift(true);
    setCloseShiftError(null);
    try {
      const s = await closeShiftScoped(sessionToken, activeShift.id, val, shiftNotes || null);
      setClosedShiftSummary(s);
      setActiveShift(null);
    } catch (e) {
      setCloseShiftError((e instanceof Error ? e.message : String(e)) ?? (requiredLocalized(l10n, 'pos-close-shift-failed')));
    } finally {
      setClosingShift(false);
    }
  }, [activeShift, closingBalance, shiftNotes, l10n, sessionToken, storeSettings.currency]);

  // ── Live tax preview ────────────────────────────────────────

  // F2-3: R36-19 fix — the failed-compute path no longer renders a
  // silent zero. The hook classifies the last known answer (caution /
  // warn / unknown) and cacheFresh is the BINDING tender-eligibility
  // gate (D64 b): a stale estimate is displayed but never added to the
  // amount due. Cancellation is the hook's own cancelled flag (the
  // screen-level AbortController is subsumed by the adoption).
  // Seeded through the factory, passed as React's lazy initializer so this
  // mount builds its OWN idle object (one per mount, none per re-render).
  // The module-level IDLE_TAX_STATE would be the same reference here as in
  // PosScreen, so one non-copying updater would corrupt both screens.
  const [taxState, setTaxState] = useState<CartTaxCacheState>(createIdleTaxState);
  const taxLines: CartLineTaxInput[] = lines.map((l) => ({
    sku: String(l.sku),
    qty: l.qty,
    unit_price_minor: l.unit_price.minor_units,
  }));
  const cartTax = taxState.taxMinor;
  const cartTaxExclusive = taxState.hasExclusive ?? false;
  const cartTaxFresh = taxState.cacheFresh;
  // Sale must be flagged for recompute whenever the shown tax was not
  // freshly computed (warn estimate, or unknown after a failed compute).
  // F2-6 threads this flag into sales.tax_estimate_note.
  const taxEstimated = lines.length > 0 && !cartTaxFresh;
  // F2-3 follow-up: retry affordance for the retail cart banner —
  // bumping the key remounts the watcher and forces a fresh compute,
  // the same key-bump pattern PosScreen uses; hook contract untouched.
  const [taxRetryNonce, setTaxRetryNonce] = useState(0);

  // ── Discount modal ───────────────────────────────────────────

  const [showDiscount, setShowDiscount] = useState(false);
  const [discountTab, setDiscountTab] = useState<'pct' | 'rp'>('pct');
  const retailDiscountExit = useExitAnimation(showDiscount, () => setShowDiscount(false));
  const [discountInput, setDiscountInput] = useState('');
  const [discountRpInput, setDiscountRpInput] = useState('');

  const handleApplyDiscount = useCallback(() => {
    // Whole percentage only -- reject fractional input instead of silently
    // truncating it. This is the same guard the main POS screen applies at
    // features/sales/hooks/usePosCartActions.ts:206-207; the retail screen was
    // the copy that drifted, and `parseFloat` + `Math.min(100, ...)` accepted
    // what the canonical handler refuses.
    //
    // It matters because usePosState computes
    // `Math.floor(subtotal.minor_units * (100 - discountPercent) / 100)`
    // (usePosState.ts:228-236): a fractional percent silently truncates the
    // DISCOUNTED TOTAL, so 33.7% charges a different amount than the cashier
    // typed and the receipt shows a percent the total does not match. The
    // `Math.min(100, ...)` also silently clamped an over-100 entry to a free
    // sale instead of refusing it.
    //
    // The modal input is type="number" with min/max (RetailModals.tsx:494-502)
    // but those are advisory -- they do not stop a fractional value being
    // typed or pasted -- so the check has to live here.
    const pct = Number(discountInput);
    if (!Number.isInteger(pct) || pct < 1 || pct > 100) return;
    setDiscount(pct, '');
    setShowDiscount(false);
    setDiscountInput('');
    setDiscountRpInput('');
  }, [discountInput, setDiscount]);

  const handleApplyDiscountRp = useCallback(() => {
    // MONEY-04: scale by the CART currency's minor-unit exponent — the
    // old hardcoded ×100 inflated IDR (exponent 0) ratios 100x, so any
    // Rp discount ≥ 1% of the subtotal clamped to 100% off. Exact
    // decimal parse via parseMoneyInput replaces parseFloat.
    const rpMinor = parseMoneyInput(discountRpInput, subtotal?.currency ?? 'IDR');
    if (rpMinor === null || rpMinor <= 0 || !subtotal || subtotal.minor_units === 0) return;
    const capped = Math.min(subtotal.minor_units, rpMinor);
    // MONEY-05: project the typed AMOUNT to a percent WITHOUT rounding the
    // ratio. `Math.round((capped / subtotal) * 100 * 100) / 100` rounded the
    // ratio to two decimals, and usePosState recomputes the money from the
    // percent -- so that rounding was a money error, in the UPWARD direction:
    // 35 off a 20000-unit subtotal is a true 0.175%, rounded up to 0.18, and the
    // cart charged 19963 instead of 19965, two units more than typed. Measured
    // over subtotal 100..20000 and discounts 1..120 that costs up to 3 units,
    // with the excess on 1194056 combinations.
    //
    // DOMAIN LIMIT, verified end to end so it is not re-derived: the discount is
    // a WHOLE percent everywhere -- `Percentage(u8)` at
    // foundation/src/percentage.rs:38, `discount_percent: i64` narrowed by
    // checkout_discount_percent at crates/kasirmu-bridge/src/pos/preview.rs:176,
    // and Math.round in setDiscount at usePosState.ts:287. Only 5058 of
    // 14955150 (subtotal, amount) pairs up to 50000/300 map to a whole percent,
    // so nearly every typed Rp amount is rounded on the way in, and 8829054 of
    // those pairs charge the customer LESS than the cashier typed.
    //
    // That is the domain design, not a defect here, and the cart already shows
    // the resulting percent (`Discount (0.2%)` via CartFooterTotals.tsx:115) so
    // the rounding is visible after the fact. What IS fixed here is the extra
    // error the ratio round added on top of it. If this tab is ever moved to
    // store an amount, this projection is the line that stops rounding at all.
    const pct = (capped * 100) / subtotal.minor_units;
    setDiscount(pct, '');
    setShowDiscount(false);
    setDiscountRpInput('');
  }, [discountRpInput, subtotal, setDiscount]);

  // ── Customer selection ─────────────────────────────────────

  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDto | null>(null);
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [customerSearchResults, setCustomerSearchResults] = useState<CustomerDto[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [overrideTarget, setOverrideTarget] = useState<{ id: LineId; name: string; unit_price: Money } | null>(null);
  const [cartId, setCartId] = useState<CartId | null>(null);

  // ── Modifier modal state ──────────────────────────────────────
  const [modifierLine, setModifierLine] = useState<CartLine | null>(null);

  // Moved below [selectedCustomer, setSelectedCustomer] so it can reset
  // discount and customer on cart clear (was previously defined before
  // those states existed, causing a TDZ bug when they were added to deps).
  const handleConfirmClear = useCallback(() => {
    setCartId(null);
    resetCart();
    setDiscount(0, '');
    setUndoStack([]);
    setSerialNumbers({});
    setSelectedCustomer(null);
    setModifierLine(null);
    setShowClearConfirm(false);
  }, [resetCart, setDiscount, setSelectedCustomer, setModifierLine]);

  const ensureCart = useCallback(async (currency: string): Promise<CartId | null> => {
    if (cartId) return cartId;
    try {
      const { cartId: newCartId } = await startSaleScoped(sessionToken, { currency });
      setCartId(newCartId);
      return newCartId;
    } catch {
      addToast({ message: requiredLocalized(l10n, 'retail-toast-failed-cart'), type: 'error' });
      return null;
    }
  }, [cartId, addToast, l10n, sessionToken]);

  const handleOverrideConfirm = useCallback(async (newPriceMinor: number) => {
    if (!overrideTarget) return;
    const cId = cartId;
    if (!cId) {
      addToast({ message: requiredLocalized(l10n, 'retail-toast-no-cart'), type: 'error' });
      setOverrideTarget(null);
      return;
    }
    try {
      await overrideLinePriceScoped(sessionToken, cId, overrideTarget.id, newPriceMinor);
      // READ THE RESULT, and note the ordering: the server has ALREADY accepted the
      // override, so a refused local write means the recorded sale and the watched
      // total now disagree. Silently ignoring it is the worst of the three call
      // sites for that reason. (`usePosCartActions.handleOverrideConfirm` carries the
      // same fix.)
      //
      // The catch below also stops passing a hardcoded English fallback: this file
      // already carries `retail-toast-override-failed`, and an Indonesian operator
      // read English on the failure path.
      const applied = updateLinePrice(overrideTarget.id, {
        minor_units: newPriceMinor,
        currency: overrideTarget.unit_price.currency,
      });
      if (!applied) {
        addToast({ message: requiredLocalized(l10n, 'pos-toast-line-price-currency-mismatch'), type: 'error' });
      }
    } catch (err) {
      const msg = plainErrorMessage(err, requiredLocalized(l10n, 'retail-toast-override-failed'));
      addToast({ message: msg, type: 'error' });
    } finally {
      setOverrideTarget(null);
    }
  }, [overrideTarget, cartId, addToast, l10n, updateLinePrice, sessionToken]);

  const allCustomersRef = useRef<CustomerDto[]>([]);
  const customerSearchQueryRef = useRef(customerSearchQuery);
  customerSearchQueryRef.current = customerSearchQuery;

  // Fetch customer list when the modal opens; filter locally on keystrokes
  useEffect(() => {
    if (!showCustomerSearch) { setCustomerSearchResults([]); return; }
    let cancelled = false;
    setLoadingCustomers(true);
    listCustomersScoped(sessionToken)
      .then((customers) => {
        if (cancelled) return;
        allCustomersRef.current = customers;
        const q = customerSearchQueryRef.current.trim().toLowerCase();
        setCustomerSearchResults(
          !q ? customers : customers.filter(
            (c) =>
              c.name.toLowerCase().includes(q) ||
              (c.phone && c.phone.includes(q)) ||
              (c.email && c.email.toLowerCase().includes(q)),
          ),
        );
      })
      .catch(() => { if (cancelled) return; addToast({ message: requiredLocalized(l10nRef.current, 'retail-toast-customers-failed'), type: 'error' }); setCustomerSearchResults([]); })
      .finally(() => { if (cancelled) return; setLoadingCustomers(false); });
    return () => { cancelled = true; };
    // sessionToken is read by the `listCustomersScoped(sessionToken)` call above. The trailing
  // comment deliberately routes l10n through a ref
    // so keystrokes do not refetch, which is correct -- but the token was left out entirely, so
    // opening the customer modal after a hot-swap listed customers with a destroyed session and
    // surfaced the "customers failed" toast. Adding it re-fetches only when the modal is open,
    // since the effect's OWN opening guard (`if (!showCustomerSearch) … return;`) still
  // short-circuits the closed case.
  }, [showCustomerSearch, addToast, sessionToken]); // l10n via ref — fetch only when modal opens

  // Filter cached customers locally on keystroke — avoids redundant API calls
  useEffect(() => {
    if (!showCustomerSearch) return;
    const customers = allCustomersRef.current;
    if (customers.length === 0) return;
    const q = customerSearchQuery.trim().toLowerCase();
    setCustomerSearchResults(
      !q ? customers : customers.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.phone && c.phone.includes(q)) ||
          (c.email && c.email.toLowerCase().includes(q)),
      ),
    );
  }, [customerSearchQuery, showCustomerSearch]);

  // ── Payment modal ────────────────────────────────────────────

  const [showPayment, setShowPayment] = useState(false);

  // P7-1: Swipe left on cart panel → open payment modal (tablet flow)
  const cartSwipe = useSwipe({
    onSwipeLeft: () => {
      if (!activeShift) { return; }
      if (!total) return;
      setShowPayment(true);
    },
  });

  const handlePay = useCallback(() => {
    if (!activeShift) { addToast({ message: requiredLocalized(l10nRef.current, 'retail-toast-open-shift-first'), type: 'warning' }); return; }
    setShowPayment(true);
  }, [activeShift, addToast]); // l10n via ref

  // ── Hold cart ────────────────────────────────────────────────

  const [heldCartId, setHeldCartId] = useState<string | null>(null);
  const [showHeldCartsList, setShowHeldCartsList] = useState(false);
  const [heldCartsList, setHeldCartsList] = useState<HeldCartRow[]>([]);

  //
  // Re-entry guard for handleHold. The Hold/Resume button (RetailFnBar, its `disabled`
  // expression `!heldCartId && linesLength === 0`) is only
  // `disabled` on an EMPTY cart, and React does not re-render between two clicks that land
  // inside one await — so a double-click, or F4 twice before the first settles, issued TWO
  // holdCartScoped writes for one sale and left the cashier with a duplicate tab to find
  // and delete. `useAutoQr` guards the same way (`reissuingRef`); so does
  // `usePosHeldCarts.handleOpenBill` now, via `openingBillRef` — the claim this comment
  // used to make about both, before round 126 measured that neither had one.
  const holdingRef = useRef(false);

  const handleHold = useCallback(async () => {
    if (lines.length === 0) return;
    if (holdingRef.current) return;
    holdingRef.current = true;
    try {
      const cartData = JSON.stringify({
        lines: lines.map((l) => ({ sku: l.sku, name: l.name, category: l.category, qty: l.qty, unit_price: l.unit_price })),
        discountPercent,
        discountLabel,
      });
      if (!subtotal) return;
      const { id } = await holdCartScoped(sessionToken, {
        label: `Hold #${Date.now()}`,
        cart_data: cartData,
        item_count: lines.length,
        total_minor: subtotal.minor_units,
        currency: subtotal.currency,
        bill_type: 'hold',
      });
      setHeldCartId(id);
      resetCart();
      addToast({ message: requiredLocalized(l10n, 'retail-toast-order-held'), type: 'success' });
    } catch {
      addToast({ message: requiredLocalized(l10n, 'retail-toast-failed-hold'), type: 'error' });
    } finally {
      // Released only once the write settles, so a second press that lands mid-await is
      // dropped rather than queued.
      holdingRef.current = false;
    }
  }, [lines, discountPercent, discountLabel, subtotal, resetCart, addToast, l10n, sessionToken]);

  const handleResumeCart = useCallback(async (cartId: string) => {
    try {
      const full = await getHeldCartScoped(sessionToken, cartId);
      if (!full) return;
      const cleanupCorrupt = async () => {
        await deleteHeldCartScoped(sessionToken, cartId).catch(() => {});
        setHeldCartId(null);
        addToast({ message: requiredLocalized(l10nRef.current, 'retail-toast-corrupt-cart'), type: 'error' });
      };
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(full.cart_data);
      } catch {
        await cleanupCorrupt();
        return;
      }
      if (!Array.isArray(data['lines'])) {
        await cleanupCorrupt();
        return;
      }
      const rawLines = data['lines'] as { sku: string; name: string; category: string; qty: number; unit_price: Money }[];
      // Validate each line has required fields; skip corrupt ones
      let hasCorruptLines = false;
      for (const l of rawLines) {
        if (!l.sku || !l.unit_price || typeof l.unit_price.minor_units !== 'number') {
          hasCorruptLines = true;
          continue;
        }
        const qty = Number.isFinite(l.qty) && l.qty > 0 ? Math.round(l.qty) : 1;
        addProduct({ sku: l.sku as Sku, name: l.name, category: l.category ?? '', price: l.unit_price, barcode: null, inStock: true, stockQty: null, productType: 'retail' }, qty);
      }
      if (hasCorruptLines) {
        addToast({ message: requiredLocalized(l10nRef.current, 'retail-toast-corrupt-cart'), type: 'error' });
      }
      // typeof, not truthiness. This is the only field below that reached
      // setDiscount unchecked, and it is the one the main POS already guards:
      // `if (typeof data.discountPercent === 'number')` in
      // features/sales/hooks/usePosHeldCarts.ts (anchored by that expression). A truthiness test also
      // passes a STRING, and setDiscount does `Math.round(percent)` --
      // Math.round('abc') is NaN, and Math.max(0, Math.min(100, NaN)) is
      // still NaN because every comparison against NaN is false.
      //
      // NaN then fails `discountPercent <= 0` in usePosState (the guard that
      // otherwise returns the subtotal unmodified) WITHOUT falling back to it:
      // the memos carry on to `100 - NaN` and the cart total becomes NaN
      // minor units. Every field above is validated and this one was not, in a
      // loop whose whole purpose is recovering a cart from untrusted JSON.
      if (typeof data['discountPercent'] === 'number') {
        setDiscount(data['discountPercent'], (data['discountLabel'] as string) ?? '');
      }
      await deleteHeldCartScoped(sessionToken, cartId);
      setHeldCartId(null);
      // DROP THE ROW, the same write `handleDeleteHeldCart` makes.
      //
      // The delete above is the commit, and it is the ONLY thing that made this
      // path correct — the round-118 case pins that a rejected delete reports a
      // failure rather than a success. What it never did was remove the row from
      // `heldCartsList`, so the local list kept offering a record the server no
      // longer holds, with two reachable consequences:
      //
      //  1. The reminder popup counts `heldCartsList.length` (the `heldCartCount` prop —
      //     on <RetailCart> below) — the one
      //     affordance that tells a cashier 'there are carts on hold'. After
      //     resuming the last one it still claimed one, and every resume left the
      //     count inflated by one for the rest of the shift.
      //  2. That popup's row opens the modal with a bare `setShowHeldCartsList(true)`
      //     (`onClickHeldCarts` below) —
      //     no refetch — so the held carts list showed a cart that no
      //     longer existed. Tapping it ran getHeldCartScoped, got null, and hit
      //     `if (!full) return;` in the held-cart resume read: no modal change, no toast,
      //     nothing. A dead control with no way for the cashier to learn why.
      //     (Anchored by the guard expression, not a line — every number this sentence
      //     has ever carried is now something else, and reprinting one would just create
      //     the next stale cite.)
      //
      // Filtering by id, not by index or by clearing the list: the resumed cart is
      // one row among possibly several, and the others must survive.
      setHeldCartsList((prev) => prev.filter((c) => c.id !== cartId));
      setShowHeldCartsList(false);
    } catch {
      addToast({ message: requiredLocalized(l10n, 'retail-toast-failed-resume'), type: 'error' });
    }
  }, [addProduct, setDiscount, addToast, l10n, sessionToken]);

  /** Open the held-carts list without resuming anything. */
  const showHeldCartList = useCallback(async () => {
    try {
      const carts = await listHeldCartsScoped(sessionToken);
      const held = carts.filter((c) => c.bill_type === 'hold');
      setHeldCartsList(held);
      setShowHeldCartsList(true);
    } catch {
      addToast({ message: requiredLocalized(l10nRef.current, 'retail-toast-failed-load-held'), type: 'error' });
    }
  }, [addToast, sessionToken]);

  const handleResume = useCallback(async () => {
    try {
      const carts = await listHeldCartsScoped(sessionToken);
      const held = carts.filter((c) => c.bill_type === 'hold');
      if (held.length === 0) return;
      if (held.length === 1) {
        // Only auto-resume from a NON-empty browse intent — see the F4 binding.
        await handleResumeCart(held[0]!.id);
        return;
      }
      setHeldCartsList(held);
      setShowHeldCartsList(true);
    } catch {
      addToast({ message: requiredLocalized(l10nRef.current, 'retail-toast-failed-load-held'), type: 'error' });
    }
  }, [handleResumeCart, addToast, sessionToken]);

  // ── Held cart delete confirm (P1-3) ────────────────────────────
  const [deleteHeldTarget, setDeleteHeldTarget] = useState<HeldCartRow | null>(null);
  const retailDeleteHeldExit = useExitAnimation(!!deleteHeldTarget, () => setDeleteHeldTarget(null));

  const handleDeleteHeldCart = useCallback(async (cartId: string) => {
    try {
      await deleteHeldCartScoped(sessionToken, cartId);
      setHeldCartsList((prev) => prev.filter((c) => c.id !== cartId));
      if (heldCartId === cartId) setHeldCartId(null);
      addToast({ type: 'success', message: requiredLocalized(l10nRef.current, 'retail-toast-held-cart-deleted') });
    } catch {
      addToast({ type: 'error', message: requiredLocalized(l10nRef.current, 'retail-toast-failed-delete-held') });
    } finally {
      setDeleteHeldTarget(null);
    }
  }, [sessionToken, heldCartId, addToast]); // l10n via ref

  // ── Load persisted held carts on mount ───────────────────────

  useEffect(() => {
    if (!sessionToken) return;
    let mounted = true;
    listHeldCartsScoped(sessionToken)
      .then((carts) => {
        if (!mounted) return;
        const held = carts.filter((c) => c.bill_type === 'hold');
        const first = held[0];
        if (first) setHeldCartId(first.id);
        // Also seed the list, not just the id. `heldCartsList` drives the reminder
        // popup's held-cart row (`onClickHeldCarts`) — the only affordance that tells a cashier
        // "there are carts on hold". Setting `heldCartId` alone left the popup
        // claiming there were none until a resume happened to fill the list, so a
        // reloaded till hid the holds it had just fetched.
        setHeldCartsList(held);
      })
      .catch(() => { if (mounted) addToast({ message: requiredLocalized(l10nRef.current, 'retail-toast-failed-load-held'), type: 'error' }); });
    return () => { mounted = false; };
  }, [sessionToken, addToast]); // l10n via ref — stable dep chain

  // ── Options / Sub-views ────────────────────────────────

  const [showSalesHistory, setShowSalesHistory] = useState(false);
  const [showStockInquiry, setShowStockInquiry] = useState(false);
  const [showTables, setShowTables] = useState(false);

  const inSubView = showSalesHistory || showTables || showStockInquiry;
  // Restore scroll only when returning from a sub-view (element remounts),
  // not while inside one — the effect keyed on inSubView flips to false on return.
  useEffect(() => {
    if (inSubView) return;
    if (savedScrollTop > 0) {
      const el = getScrollContainer();
      if (el) {
        el.scrollTop = savedScrollTop;
        setSavedScrollTop(0);
      }
    }
  }, [inSubView, savedScrollTop, getScrollContainer]);

  // ── Credit reminders ──────────────────────────────────────────

  const [creditSales, setCreditSales] = useState<CreditSaleDto[]>([]);
  const [showCreditList, setShowCreditList] = useState(false);
  const [settlingId, setSettlingId] = useState<string | null>(null);

  const loadCreditSales = useCallback(async () => {
    try {
      const list = await listCreditSalesScoped(sessionToken);
      setCreditSales(list.filter((c) => !c.settledAt));
    } catch { /* ignore */ }
  }, [sessionToken]);

  useEffect(() => {
    loadCreditSales();
  }, [loadCreditSales]);

  // Re-entry guard for the credit settle. The row button already disables on
  // `settlingId === c.saleId` (RetailModals.tsx:387), but that is STATE -- React commits it on
  // its next render, after the second dispatch of a real double tap. MEASURED: two clicks in
  // one act() batch both reach the handler (RetailPosScreen.test.tsx 'settles a credit sale
  // once for a double tap'), and both are SENT.
  //
  // The backend does not refuse the replay: `settle_credit_scoped` runs
  //   UPDATE payments SET settled_at = ?1 WHERE sale_id = ?2 AND method = 'credit'
  // (crates/kasirmu-bridge/src/settings.rs:657) with no status predicate and no idempotency
  // key, and it does not check the matched row count -- so it also reports success for a sale
  // that was already settled or was never a credit sale. A double tap therefore moves
  // `settled_at` to a LATER timestamp and the first one is lost: the payment record claims the
  // credit was cleared twice. The round-143 last-write-wins shape, on a payment.
  //
  // Per-row, not global, and deliberately so: two DIFFERENT credit rows can be settled
  // concurrently and must not block each other. The set is mutated in place so the guard is
  // authoritative at the moment of the second dispatch and needs no re-render.
  const settlingIdsInFlight = useRef(new Set<string>());
  const handleSettleCredit = useCallback(async (saleId: string) => {
    if (settlingIdsInFlight.current.has(saleId)) return;
    settlingIdsInFlight.current.add(saleId);
    setSettlingId(saleId);
    try {
      await settleCreditScoped(sessionToken, saleId);
      setCreditSales((prev) => prev.filter((c) => c.saleId !== saleId));
      addToast({ message: requiredLocalized(l10n, 'retail-toast-credit-settled'), type: 'success' });
    } catch {
      addToast({ message: requiredLocalized(l10n, 'retail-toast-failed-settle'), type: 'error' });
    } finally {
      settlingIdsInFlight.current.delete(saleId);
      setSettlingId(null);
    }
  }, [addToast, l10n, sessionToken]);

  // ── Retail modal exit animations ───────────────────────────────
  const retailCustomerExit = useExitAnimation(showCustomerSearch, () => { setShowCustomerSearch(false); setCustomerSearchQuery(''); });
  const retailQtyExit = useExitAnimation(showQtyPicker && !!pendingProduct, () => { setShowQtyPicker(false); setPendingProduct(null); });
  const retailHeldCartsExit = useExitAnimation(showHeldCartsList, () => setShowHeldCartsList(false));
  const retailShortcutsExit = useExitAnimation(showShortcuts, () => setShowShortcuts(false));
  const retailQuickReturnExit = useExitAnimation(showQuickReturn, () => { setShowQuickReturn(false); setQuickReturnBarcode(''); });
  const retailClearConfirmExit = useExitAnimation(showClearConfirm, () => setShowClearConfirm(false));
  const retailCreditListExit = useExitAnimation(showCreditList, () => setShowCreditList(false));

  // ── Clock ────────────────────────────────────────────────────

  const [clock, setClock] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const timeStr = clock.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const dateStr = clock.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  const shiftDuration = useMemo(() => {
    if (!activeShift) return null;
    const opened = new Date(activeShift.openedAt);
    const diffMs = clock.getTime() - opened.getTime();
    const h = Math.floor(diffMs / 3600000);
    const m = Math.floor((diffMs % 3600000) / 60000);
    return `${h}h ${m}m`;
  }, [activeShift, clock]);

  const handleOpenSettings = useCallback(() => {
    if (onNavigate) {
      onNavigate('settings');
    } else {
      setActiveWorkspace('admin');
    }
  }, [onNavigate, setActiveWorkspace]);

  // ── Keyboard shortcuts ────────────────────────────────────────

  // KEY-04: shared modal-ownership check (modal-guard.ts) so AppShell and the
  // retail POS agree on when a modal owns the keyboard.
  const isAnyModalOpen = useCallback(
    () => isAnyAriaModalOpen(),
    []);

  const isAnyOverlayOpen = useCallback(() =>
    showCustomerSearch || showHeldCartsList || showQuickReturn ||
    showDiscount || showQtyPicker || showShortcuts || showCreditList || showClearConfirm ||
    showOpenShift || (showCloseShift && !closedShiftSummary) || !!closedShiftSummary ||
    !!editingProduct || isAddCategoryOpen || isAddProductOpen || !!deleteHeldTarget,
  [showCustomerSearch, showHeldCartsList, showQuickReturn, showDiscount, showQtyPicker,
    showShortcuts, showCreditList, showClearConfirm, showOpenShift, showCloseShift,
    closedShiftSummary, editingProduct, isAddCategoryOpen, isAddProductOpen, deleteHeldTarget]);

  // A SUB-VIEW is an early return that REPLACES this screen: `if (showSalesHistory)`,
  // `if (showTables)` and `if (showStockInquiry)` below, each a `return (<LocalizedError
  // Boundary>…)`; the payment modal is the fourth, `<PaymentModal>`. `isAnyOverlayOpen`
  // covers the local DIALOGS but none of these, and although their flags sat in the
  // dependency array below, the handler never READ them — so the retail function keys
  // stayed live while a replacement screen owned the view. F1 (Pay) opened the payment
  // dialog for a cart the cashier could not see, and F2/F3/F4 could clear, discount or
  // re-hold that same invisible cart.
  //
  // `showPayment` is included for the same reason it is in the deps: without it the
  // hotkeys keep acting on the cart BEHIND the payment dialog.
  const saleViewVisible = !(showPayment && total) && !showSalesHistory &&
    !showTables && !showStockInquiry;

  useEffect(() => {

    const handler = (e: KeyboardEvent) => {
      // Guard: block all hotkeys while any aria-modal is open (e.g. WorkspaceSettingsModal)
      if (isAnyModalOpen()) return;

      // ── Esc: the manifest's `close` action ──────────────────────────────
      //
      // `retailShortcuts.ts:54` declares `Esc → close` and the help overlay renders
      // it with the label `retail-shortcut-close = Close modal / Options`, but
      // NOTHING in this file consumed it — the only `case 'close':` in the tree is
      // WarehouseConsole's. So the overlay advertised a key that did nothing. The
      // parity suite could not see it: it asserts the overlay LISTS every manifest
      // key and that the function bar derives the F-key labels, and its action list
      // omits `close` — the label rendered, the behaviour was never exercised.
      //
      // Placed BEFORE both guards below, deliberately. The whole point of Esc is to
      // get out: it must reach the sub-view exit (where `saleViewVisible` is false
      // and every other key is inert) and it must not be swallowed by
      // `isAnyOverlayOpen`, which is a guard named for the overlays Esc is meant to
      // close. A modal that owns the keyboard keeps it — `isAnyModalOpen` above has
      // already returned, and useFocusTrap handles the per-modal case.
      if (e.key === 'Escape') {
        e.preventDefault();
        // A sub-view is the outermost thing on screen, so it closes first.
        if (showSalesHistory) { setShowSalesHistory(false); return; }
        if (showTables) { setShowTables(false); return; }
        if (showStockInquiry) { setShowStockInquiry(false); return; }
        // Then the local overlays, in the order they stack.
        if (showCreditList) { setShowCreditList(false); return; }
        if (showQuickReturn) { setShowQuickReturn(false); return; }
        if (showCustomerSearch) { setShowCustomerSearch(false); return; }
        if (showHeldCartsList) { setShowHeldCartsList(false); return; }
        if (showShortcuts) { setShowShortcuts(false); return; }
        return;
      }

      // Guard: block hotkeys while local overlays/dialogs are visible
      if (isAnyOverlayOpen()) return;

      // Guard: block hotkeys while a sub-view has replaced the sale screen. See
      // `saleViewVisible` above — this is the guard whose ABSENCE let F1 pay for an
      // invisible cart.
      if (!saleViewVisible) return;

      // Guard: block hotkeys while a sub-view has replaced the sale screen. See
      // `saleViewVisible` above — this is the guard whose ABSENCE let F1 pay for an
      // invisible cart.

      // KEY-03: suppress high-impact hotkeys while the user is typing in an
      // input/textarea/select/contenteditable (covers shift notes, customer
      // notes, and the SKU input during manual entry) so a keystroke cannot
      // accidentally pay, void, discount, hold, or navigate. F5 is exempted as
      // the hardware-terminal escape hatch: it only focuses the SKU input.
      const editing = isEditableTarget(e.target);
      const typing = editing && e.key !== 'F5';
      switch (e.key) {
        case 'F1': if (typing) break; if (e.cancelable) e.preventDefault(); handlePay(); break;
        case 'F2': if (typing) break; if (e.cancelable) e.preventDefault(); if (lines.length > 0) handleRequestClear(); break;
        case 'F3': if (typing) break; if (e.cancelable) e.preventDefault(); if (lines.length > 0) setShowDiscount(true); break;
        // F4: with a cart in progress the intent is unambiguous — hold it, or
        // update/clear the tab it was resumed from. With an EMPTY cart there is
        // nothing to hold and nothing to update, so F4 can only mean "show me the
        // held carts". Sending that to `handleResume` auto-resumed a lone hold
        // with no modal, no confirmation and no toast — browsing silently became
        // a committing action. `handleResume` is therefore gated on there being
        // something to resume INTO.
        case 'F4': if (typing) break; if (e.cancelable) e.preventDefault(); if (lines.length === 0) showHeldCartList(); else if (heldCartId) handleResume(); else handleHold(); break;
        case 'F5': if (e.cancelable) e.preventDefault(); skuInputRef.current?.focus(); break;
        case 'F6': if (typing) break; if (e.cancelable) e.preventDefault(); goToSubView(setShowSalesHistory); break;
        case 'F7': if (typing) break; if (e.cancelable) e.preventDefault(); setShowCustomerSearch(true); break;
        case 'F8': if (typing) break; if (e.cancelable) e.preventDefault(); goToSubView(setShowStockInquiry); break;
        case 'F9': if (typing) break; if (e.cancelable) e.preventDefault(); if (activeShift) setShowCloseShift(true); else setShowOpenShift(true); break;
        // F10 is handled globally by AppShell.tsx — opens the WorkspaceSettingsModal.
        // The button-based settings navigation (onOpenSettings) still works via RetailFnBar.
        case 'F11': if (typing) break; if (e.cancelable) e.preventDefault(); setShowQuickReturn(true); break;
        case '?': if (typing) break; setShowShortcuts((v) => !v); break;
        case 'F12': if (typing) break; if (e.cancelable) e.preventDefault(); onNavigate?.('kds'); break;
        // Ctrl+L / Ctrl+K: full editable-target guard (not just INPUT) —
        // textarea/select/contenteditable are covered too (KEY-03); Meta
        // accepted on macOS-like keyboards (KEY-08).
        case 'l': if (isCommandModifier(e) && !isEditableTarget(document.activeElement)) { e.preventDefault(); setFilterLowStock((prev) => !prev); } break;
        case 'k': if (isCommandModifier(e) && !isEditableTarget(document.activeElement)) { e.preventDefault(); setShowCreditList(true); } break;
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  // handleOpenSettings deliberately excluded — F10 removed (handled by AppShell).
  }, [isAnyModalOpen, isAnyOverlayOpen, saleViewVisible, showPayment, total, showOpenShift, showCloseShift, showDiscount, showQtyPicker, showShortcuts, showCustomerSearch, showClearConfirm, showCreditList, showSalesHistory, showStockInquiry, showTables, showHeldCartsList, showQuickReturn, closedShiftSummary, editingProduct, isAddCategoryOpen, isAddProductOpen, handlePay, lines.length, handleRequestClear, handleHold, handleResume, showHeldCartList, heldCartId, activeShift, session, addToast, onNavigate, goToSubView,
    // Esc is the manifest's `close` action (see its block above). Each of these
    // state SETTERS is read by that branch, so they belong here — the flags are
    // already listed, and a setter omitted from a deps array is the stale-closure
    // shape this file's other handlers already avoid.
    setShowSalesHistory, setShowTables, setShowStockInquiry, setShowCreditList,
    setShowQuickReturn, setShowCustomerSearch, setShowHeldCartsList, setShowShortcuts]);

  // ── Render ───────────────────────────────────────────────────

  if (showPayment && total) {
    return (
      // Crash isolation (F9) on the money dialog — see the twin in
      // PosScreen.tsx:1279 for the reasoning. `onReset` closes the dialog and
      // returns to the cart instead of letting AppProviders' full-page boundary
      // reload the app, which would log the cashier out mid-transaction.
      <LocalizedErrorBoundary onReset={() => setShowPayment(false)}>
      <PaymentModal
        open
        lineItems={lines.map((l) => ({
          ...l, sku: l.sku, name: l.name ?? '', qty: l.qty, unit_price: l.unit_price,
        }))}
        total={total && cartTaxExclusive && cartTax > 0 && cartTaxFresh
          ? { minor_units: total.minor_units + cartTax, currency: total.currency }
          : total}
        discountPercent={discountPercent}
        discountLabel={discountLabel}
        userId={userId}
        tipMinor={tipAmount?.minor_units ?? 0}
        serviceChargeMinor={serviceChargeAmount?.minor_units ?? 0}
        taxEstimated={taxEstimated}
        {...(sessionToken ? { sessionToken } : {})}
        selectedCustomer={selectedCustomer}
        {...(isEnabled(FEATURES.SERIAL_TRACKING) ? { serialNumbers } : {})}
        onCustomerChange={(c) => setSelectedCustomer(c)}
        tenderPresets={tenderPresets}
        onComplete={() => { setShowPayment(false); resetCart(); setSelectedCustomer(null); playSuccess(); addToast({ message: requiredLocalized(l10n, 'retail-toast-sale-complete'), type: 'success' }); }}
        onClose={() => setShowPayment(false)}
      />
      </LocalizedErrorBoundary>
    );
  }

  // ── Sales History screen ────────────────────────────────────
  // Crash isolation (F9) on all three sub-views below, matching the restaurant
  // shell's seven (PosScreen.tsx:957-1080) and for the same reason: each is an
  // early return that REPLACES the POS screen, so an unwrapped throw there is not
  // contained by anything closer than AppProviders' full-page boundary — which
  // auto-reloads after 30s and logs the cashier out mid-shift. `onReset` returns to
  // the cart.
  if (showSalesHistory) {
    return (
      <LocalizedErrorBoundary onReset={() => setShowSalesHistory(false)}>
        <SalesHistoryView theme={theme} onBack={() => setShowSalesHistory(false)} />
      </LocalizedErrorBoundary>
    );
  }

  // ── Table Management screen ────────────────────────────────
  if (showTables) {
    return (
      <LocalizedErrorBoundary onReset={() => setShowTables(false)}>
        <TableManagementView theme={theme} onBack={() => setShowTables(false)} />
      </LocalizedErrorBoundary>
    );
  }

  // ── Stock Inquiry screen ────────────────────────────────────
  if (showStockInquiry) {
    return (
      <LocalizedErrorBoundary onReset={() => setShowStockInquiry(false)}>
        <StockInquiryView theme={theme} onBack={() => setShowStockInquiry(false)} onAddProduct={handleAdd} />
      </LocalizedErrorBoundary>
    );
  }

  return (
    <>
    {/* Session died MID-SHIFT — see the hook above for why AppShell's banner does not
        cover this. Styled by RetailPosScreen.css so the desktop shell, which does not
        load AnalyticsScreen.css, gets a styled alert rather than a bare one. */}
    {showSessionBanner && (
      <div className="retail-session-banner" role="alert" data-testid="retail-session-banner">
        <span>{requiredLocalized(l10nRef.current, 'analytics-session-expired-message')}</span>
        <button
          type="button"
          className="retail-session-banner-action"
          onClick={goToWorkspacePicker}
        >
          {requiredLocalized(l10nRef.current, 'analytics-sign-in-again')}
        </button>
      </div>
    )}
    <div className="retail-pos" data-theme={theme}>
      {/* ── F2-3: cart-tax watcher — the key-bump remount below is the
           banner retry; the banner itself renders in RetailCartPanel ── */}
      <CartTaxWatcher
        key={taxRetryNonce}
        sessionToken={rawToken}
        lines={taxLines}
        currency={subtotal?.currency ?? 'IDR'}
        onState={setTaxState}
      />
      {/* ── Skip-to-content link ─────────────── */}
      <a href="#retail-main" className="retail-skip-link">
        {requiredLocalized(l10n, 'retail-skip-to-main')}
      </a>

      {/* ── Header ──────────────────────────── */}
      <RetailHeader
        storeSettings={storeSettings}
        shiftLoading={shiftLoading}
        shiftLoadFailed={shiftLoadFailed}
        activeShift={activeShift}
        displayName={session?.display_name ?? ''}
        dateStr={dateStr}
        timeStr={timeStr}
        shiftDuration={shiftDuration}
        onWorkspacePicker={goToWorkspacePicker}
      />


      {/* ── Main area ───────────────────────── */}
      <div id="retail-main" className="retail-main" ref={retailPosRef}>
        {/* Screen-reader announcement (visually hidden) */}
        <div ref={announceRef} className="retail-sr-only" data-testid="retail-sr-announce" role="status" aria-live="polite" aria-atomic="true" />
        {/* Left: product grid */}
        {filterLowStock && (
          <div className="retail-filter-indicator" role="status" aria-label={requiredLocalized(l10n, 'retail-filter-indicator-aria')}>
            <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12" aria-hidden="true">
              <path fillRule="evenodd" d="M3 3a1 1 0 011 0v12a1 1 0 11-2 0V4a1 1 0 011-1zm7.707 3.293a1 1 0 010 1.414L9.414 9H17a1 1 0 110 2H9.414l1.293 1.293a1 1 0 01-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            <span>{requiredLocalized(l10n, 'retail-filtered-low-stock', { count: lowStockCount })}</span>
          </div>
        )}
        {/* ── Error banner ──────────────── */}
        {loadError && (
          <div className="retail-load-error" role="alert">
            <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" aria-hidden="true">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span className="retail-load-error-text">{loadError}</span>
            <button
              type="button"
              className="retail-load-error-retry"
              onClick={handleRetryLoad}
              aria-label={requiredLocalized(l10n, 'retail-load-error-retry-aria')}
            >
              {requiredLocalized(l10n, 'retry')}
            </button>
            <button
              type="button"
              className="retail-load-error-dismiss"
              onClick={() => setLoadError(null)}
              aria-label={requiredLocalized(l10n, 'dismiss')}
            >
              <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12" aria-hidden="true">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        )}
        <RetailProductGrid
          sessionToken={sessionToken}
          data={{
            productsLoading,
            categoriesLoading,
            categories,
            activeCategory,
            searchQuery,
            filteredProducts,
            pagedProducts,
            totalPages,
            productPage,
            sortField,
            sortOrder,
            allLabel,
            catLabels,
            skuInput,
            weighTarget,
            filterLowStock,
            visibleColumns: colPrefs.visibleColumns,
            hideInactive: colPrefs.hideInactive,
            viewMode: colPrefs.viewMode,
          }}
          actions={{
            onSetActiveCategory: setActiveCategory,
            onSetSearchQuery: setSearchQuery,
            onSort: handleSort,
            onSetProductPage: setProductPage,
            onAddProduct: handleAdd,
            onEditProduct: handleEditProduct,
            onOpenQtyPicker: handleOpenQtyPicker,
            onSetWeighTarget: handleSetWeighTarget,
            onClearWeighTarget: () => setWeighTarget(null),
            onAddCategory: () => setIsAddCategoryOpen(true),
            onAddNewProduct: () => setIsAddProductOpen(true),
            onSkuInputChange: setSkuInput,
            onSkuSubmit: handleSkuSubmit,
            onWeighAdd: handleWeighAdd,
            onToggleColumn,
            onToggleHideInactive,
            onSetViewMode,
            onRowContextMenu: handleRowContextMenu,
          }}
          isScaleEnabled={isEnabled(FEATURES.USB_SCALE)}
          catHue={catHue}
          skuInputRef={skuInputRef}
        />

        {/* ── Resize handle ────────────────── */}
        <RetailCartPanel
          lines={lines}
          lineCount={lineCount}
          taxSeverity={taxState.severity}
          onRetryTaxEstimate={() => setTaxRetryNonce((n) => n + 1)}
          selectedCustomer={selectedCustomer}
          totals={{
            subtotal,
            total,
            discountPercent,
            discountAmount,
            cartTax,
            cartTaxExclusive,
          }}
          retailCartWidth={retailCartWidth}
          serialNumbers={serialNumbers}
          trackSerialMap={trackSerialMap}
          overrideTarget={overrideTarget}
          undoStack={undoStack}
          undoBarExit={{
            shouldRender: undoBarExit.shouldRender,
            exiting: undoBarExit.exiting,
            requestClose: undoBarExit.requestClose,
          }}
          isSerialTracking={isEnabled(FEATURES.SERIAL_TRACKING)}
          isManager={isManager}
          activeShift={!!activeShift}
          heldCartId={heldCartId}
          cartWidthMin={RETAIL_CART_WIDTH_MIN}
          cartWidthMaxCap={RETAIL_CART_WIDTH_MAX_CAP}
          onResizeWidth={setRetailCartWidth}
          onStartResize={startResize}
          cartSwipe={cartSwipe as Record<string, unknown>}
          showCourseSelector={true}
          lineActions={{
            onRemoveLine: handleRemoveLine,
            onIncreaseQty: handleIncreaseQty,
            onUpdateQty: updateQty,
            onSerialChange: handleSerialChange,
            onSetOverrideTarget: setOverrideTarget,
            onAssignCourse: (lineId, courseId) => { assignCourse(lineId, courseId); },
            onEditModifiers: handleEditModifiers,
          }}
          panelActions={{
            onPay: handlePay,
            onShowDiscount: () => setShowDiscount(true),
            onHoldResume: heldCartId ? handleResume : handleHold,
            onRequestClear: handleRequestClear,
            onShowCreditList: () => setShowCreditList(true),
            onLoadCreditSales: loadCreditSales,
          }}
          onUndoRemove={handleUndoRemove}
          onDismissUndo={handleDismissUndo}
          onEnsureCart={ensureCart}
        />
      </div>

      {/* ── Function bar (bottom) ──────────── */}
      <RetailFnBar
        linesLength={lines.length}
        heldCartId={heldCartId}
        activeShift={!!activeShift}
        onPay={handlePay}
        onRequestClear={() => { if (!isAnyOverlayOpen()) handleRequestClear(); }}
        onShowDiscount={() => { if (!isAnyOverlayOpen()) setShowDiscount(true); }}
        onHoldResume={heldCartId ? handleResume : handleHold}
        onShowSalesHistory={() => goToSubView(setShowSalesHistory)}
        onShowCustomerSearch={() => { if (!isAnyOverlayOpen()) setShowCustomerSearch(true); }}
        onShowStockInquiry={() => goToSubView(setShowStockInquiry)}
        onToggleShift={() => { if (!isAnyOverlayOpen()) { if (activeShift) setShowCloseShift(true); else setShowOpenShift(true); } }}
        onOpenSettings={handleOpenSettings}
        onShowQuickReturn={() => { if (!isAnyOverlayOpen()) setShowQuickReturn(true); }}
        onShowTables={() => goToSubView(setShowTables)}
        onNavigateKds={() => onNavigate?.('kds')}
        skuInputRef={skuInputRef}
      />
      <RetailReminderPopup
        lowStockCount={lowStockCount}
        creditCount={creditSales.length}
        heldCartCount={heldCartsList.length}
        lowStockActive={filterLowStock}
        onClickLowStock={() => setFilterLowStock((prev) => !prev)}
        onClickCredit={() => { if (!isAnyOverlayOpen()) setShowCreditList(true); }}
        onClickHeldCarts={() => { if (!isAnyOverlayOpen()) setShowHeldCartsList(true); }}
      />
      <RetailModals
        canEditCost={canEditCost}
        shift={{
          activeShift,
          openShiftExit: { shouldRender: retailOpenShiftExit.shouldRender, exiting: retailOpenShiftExit.exiting, requestClose: retailOpenShiftExit.requestClose },
          closeShiftExit: { shouldRender: retailCloseShiftExit.shouldRender, exiting: retailCloseShiftExit.exiting, requestClose: retailCloseShiftExit.requestClose },
          shiftSummaryExit: { shouldRender: retailShiftSummaryExit.shouldRender, exiting: retailShiftSummaryExit.exiting, requestClose: retailShiftSummaryExit.requestClose },
          closedShiftSummary,
          openingBalance,
          closingBalance,
          shiftNotes,
          openingShift,
          closingShift,
          closeShiftError,
          storeSettings: { currency: storeSettings.currency },
          onOpeningBalanceChange: setOpeningBalance,
          onClosingBalanceChange: setClosingBalance,
          onShiftNotesChange: setShiftNotes,
          onOpenShift: handleOpenShift,
          onCloseShift: handleCloseShift,
        }}
        discount={{
          exit: { shouldRender: retailDiscountExit.shouldRender, exiting: retailDiscountExit.exiting, requestClose: retailDiscountExit.requestClose },
          tab: discountTab,
          input: discountInput,
          rpInput: discountRpInput,
          onTabChange: setDiscountTab,
          onInputChange: setDiscountInput,
          onRpInputChange: setDiscountRpInput,
          onApplyPct: handleApplyDiscount,
          onApplyRp: handleApplyDiscountRp,
          onCancel: () => { retailDiscountExit.requestClose(); setDiscountInput(''); setDiscountRpInput(''); },
        }}
        customer={{
          exit: { shouldRender: retailCustomerExit.shouldRender, exiting: retailCustomerExit.exiting, requestClose: retailCustomerExit.requestClose },
          query: customerSearchQuery,
          results: customerSearchResults,
          loading: loadingCustomers,
          selected: selectedCustomer,
          onQueryChange: setCustomerSearchQuery,
          onSelect: (c) => { setSelectedCustomer(c); setShowCustomerSearch(false); setCustomerSearchQuery(''); },
          onClear: () => { setSelectedCustomer(null); setShowCustomerSearch(false); setCustomerSearchQuery(''); },
          onClose: () => retailCustomerExit.requestClose(),
        }}
        qtyPicker={{
          exit: { shouldRender: retailQtyExit.shouldRender, exiting: retailQtyExit.exiting, requestClose: retailQtyExit.requestClose },
          product: pendingProduct ? { name: pendingProduct.name, price: pendingProduct.price } : null,
          input: qtyInput,
          onInputChange: handleQtyInputChange,
          onConfirm: handleConfirmQty,
          onCancel: () => retailQtyExit.requestClose(),
        }}
        heldCarts={{
          exit: { shouldRender: retailHeldCartsExit.shouldRender, exiting: retailHeldCartsExit.exiting, requestClose: retailHeldCartsExit.requestClose },
          list: heldCartsList,
          onResume: handleResumeCart,
          onDelete: (id) => { const row = heldCartsList.find((c) => c.id === id) ?? null; setDeleteHeldTarget(row); },
          onClose: () => retailHeldCartsExit.requestClose(),
        }}
        deleteHeldCartConfirm={{
          exit: { shouldRender: retailDeleteHeldExit.shouldRender, exiting: retailDeleteHeldExit.exiting, requestClose: retailDeleteHeldExit.requestClose },
          label: deleteHeldTarget?.label ?? '',
          onConfirm: () => { if (deleteHeldTarget) handleDeleteHeldCart(deleteHeldTarget.id); },
          onClose: () => retailDeleteHeldExit.requestClose(),
        }}
        credit={{
          exit: { shouldRender: retailCreditListExit.shouldRender, exiting: retailCreditListExit.exiting, requestClose: retailCreditListExit.requestClose },
          sales: creditSales,
          settlingId,
          onSettle: handleSettleCredit,
          onClose: () => retailCreditListExit.requestClose(),
        }}
        quickReturn={{
          exit: { shouldRender: retailQuickReturnExit.shouldRender, exiting: retailQuickReturnExit.exiting, requestClose: retailQuickReturnExit.requestClose },
          barcode: quickReturnBarcode,
          loading: quickReturnLoading,
          onBarcodeChange: setQuickReturnBarcode,
          onSubmit: handleQuickReturnSubmit,
          onClose: () => retailQuickReturnExit.requestClose(),
        }}
        clearConfirm={{
          exit: { shouldRender: retailClearConfirmExit.shouldRender, exiting: retailClearConfirmExit.exiting, requestClose: retailClearConfirmExit.requestClose },
          lineCount,
          onConfirm: handleConfirmClear,
          onClose: () => retailClearConfirmExit.requestClose(),
        }}
        shortcuts={{
          exit: { shouldRender: retailShortcutsExit.shouldRender, exiting: retailShortcutsExit.exiting, requestClose: retailShortcutsExit.requestClose },
          onClose: () => retailShortcutsExit.requestClose(),
        }}
        override={{
          target: overrideTarget,
          onConfirm: handleOverrideConfirm,
          onClose: () => setOverrideTarget(null),
        }}
        editProduct={{
          product: editingProduct,
          isOpen: Boolean(editingProduct),
          onClose: () => setEditingProduct(null),
          onSave: handleSaveProductEdit,
        }}
        addCategory={{
          isOpen: isAddCategoryOpen,
          onClose: () => setIsAddCategoryOpen(false),
          onSave: handleSaveNewCategory,
        }}
        addProduct={{
          categories,
          isOpen: isAddProductOpen,
          onClose: () => setIsAddProductOpen(false),
          onSave: handleSaveNewProduct,
        }}
        showQuickReturnRefund={showQuickReturnRefund}
        quickReturnSale={quickReturnSale}
        quickReturnRefundDone={handleQuickReturnRefundDone}
        scanFlash={scanFlash}
        sessionToken={sessionToken}
      />

      {/* ── Row context menu (ADR #38) ───── */}
      <RetailProductContextMenu
        menu={rowMenu}
        onClose={() => setRowMenu(null)}
        onViewImages={handleViewProductImages}
      />

      {/* ── Item modifier modal ──────────── */}
      {/*
       * NOT WIRED, and deliberately left inert rather than half-wired.
       *
       * `groups={[]}` means the modal has nothing to select, so Confirm has
       * nothing to return -- and onConfirm discards both arguments anyway.
       * The retail Modifiers button in RetailCartPanel.tsx:305-315 therefore
       * opens a dialog that cannot change the cart.
       *
       * The data is missing end to end, which is why this cannot be fixed
       * here: `ProductDto` has no modifier field, `toProduct` (:49-61) cannot
       * carry one, and crates/kasirmu-bridge/src/products.rs returns none.
       * RetailMenu is the working reference -- RestaurantMenu.tsx:642 feeds
       * real groups from `getProductModifierGroups` and :263 applies the
       * returned price AND selections to the cart line.
       *
       * Wiring the button to an always-empty dialog is worse than the stub:
       * it looks finished. Leave it inert until the backend read exists.
       */}
      <ItemModifierModal
        open={!!modifierLine}
        productName={modifierLine?.name ?? modifierLine?.sku ?? ''}
        basePriceMinor={modifierLine?.unit_price.minor_units ?? 0}
        currency={modifierLine?.unit_price.currency ?? 'IDR'}
        groups={[]}
        onConfirm={() => setModifierLine(null)}
        onClose={() => setModifierLine(null)}
      />
    </div>
  </>
  );
}
