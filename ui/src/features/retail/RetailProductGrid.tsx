import { useEffect, useRef, useCallback, memo, useState } from 'react';
import { requiredLocalized } from '@/frontend/shared';
import { useLocalization, Localized } from '@fluent/react';
import { DEFAULT_LOW_STOCK_THRESHOLD, DEFAULT_HIGH_STOCK_THRESHOLD, formatMoney, type Money, type Sku } from '@/types/domain';
import type { ProductDto, CategoryDto } from '@/api/products';
import { ProductThumb } from '@/components/ProductThumb';
import { Grid, type CellComponentProps } from 'react-window';
import type { RetailColumn, RetailViewMode } from './hooks/useRetailColumnPrefs';
import ScaleIndicator from './ScaleIndicator';

// ── Sort types ─────────────────────────────────────────────────────

export type SortField = 'popularity' | 'sku' | 'name' | 'stock' | 'price';
export type SortOrder = 'asc' | 'desc';

// ── Grouped prop interfaces ────────────────────────────────────────

export interface ProductGridData {
  productsLoading: boolean;
  categoriesLoading: boolean;
  categories: CategoryDto[];
  activeCategory: string | null;
  searchQuery: string;
  filteredProducts: ProductDto[];
  pagedProducts: ProductDto[];
  totalPages: number;
  productPage: number;
  sortField: SortField;
  sortOrder: SortOrder;
  allLabel: string;
  catLabels: Map<string, string>;
  skuInput: string;
  weighTarget: { sku: Sku; name: string } | null;
  /** Whether the low-stock filter is active (shows a filter-specific empty state). */
  filterLowStock: boolean;
  /** Visible grid columns (ADR #36 D4), in display order. */
  visibleColumns: readonly RetailColumn[];
  /** Whether retired (inactive) products are hidden from the grid. */
  hideInactive: boolean;
  /** Retail POS product-list view mode (spec 0046b §3.5). */
  viewMode: RetailViewMode;
}

export interface ProductGridActions {
  onSetActiveCategory: (catId: string | null) => void;
  onSetSearchQuery: (q: string) => void;
  onSort: (field: SortField) => void;
  onSetProductPage: React.Dispatch<React.SetStateAction<number>>;
  onAddProduct: (p: ProductDto) => void;
  onEditProduct: (p: ProductDto) => void;
  onOpenQtyPicker: (p: ProductDto) => void;
  onSetWeighTarget: (p: ProductDto) => void;
  onClearWeighTarget: () => void;
  onAddCategory: () => void;
  onAddNewProduct: () => void;
  onSkuInputChange: (val: string) => void;
  onSkuSubmit: () => void;
  onWeighAdd: (sku: Sku, weightGrams: number) => void;
  /** Toggle a grid column's visibility (ADR #36 D4). */
  onToggleColumn: (col: RetailColumn) => void;
  /** Toggle the hide-inactive filter. */
  onToggleHideInactive: (hide: boolean) => void;
  /** Open the row context menu at a viewport position (ADR #38 D1). */
  onRowContextMenu: (product: ProductDto, x: number, y: number) => void;
  /** Switch the product-list view mode between text table and image grid. */
  onSetViewMode: (mode: RetailViewMode) => void;
}

export interface RetailProductGridProps {
  /** Session token for scoped API calls. */
  sessionToken?: string;
  data: ProductGridData;
  actions: ProductGridActions;
  isScaleEnabled: boolean;
  catHue: (catId: string | null) => number;
  skuInputRef: React.Ref<HTMLInputElement>;
}

// ── Column render helpers ──────────────────────────────────────────
// `is_active` can be undefined in legacy/dev-mock DTOs — treat as active.

export const isProductActive = (p: ProductDto): boolean => p.is_active !== false;

/** Placeholder shown for an empty table cell (em-dash). */
const EMPTY_CELL = '—';

function cellValue(v: string | null | undefined): string {
  return v && v.trim() ? v : EMPTY_CELL;
}

// ── Column toggle menu ─────────────────────────────────────────────

function ColumnToggleMenu({
  visibleColumns,
  hideInactive,
  onToggleColumn,
  onToggleHideInactive,
  onClose,
}: {
  visibleColumns: readonly RetailColumn[];
  hideInactive: boolean;
  onToggleColumn: (col: RetailColumn) => void;
  onToggleHideInactive: (hide: boolean) => void;
  onClose: () => void;
}) {
  const { l10n } = useLocalization();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [onClose]);

  return (
    <div ref={menuRef} className="retail-col-toggle-menu" role="menu" aria-label={requiredLocalized(l10n, 'retail-col-toggle-aria')}>
      {RETAIL_COLUMN_ORDER.map((col) => {
        const checked = visibleColumns.includes(col);
        return (
          <button
            key={col}
            type="button"
            role="menuitemcheckbox"
            aria-checked={checked}
            className="retail-col-toggle-item"
            onClick={() => onToggleColumn(col)}
          >
            <span className={`retail-col-toggle-check${checked ? ' retail-col-toggle-check--on' : ''}`} aria-hidden="true">
              {checked ? '✓' : ''}
            </span>
            {requiredLocalized(l10n, `retail-col-${col}`)}
          </button>
        );
      })}
      <div className="retail-col-toggle-divider" />
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={hideInactive}
        className="retail-col-toggle-item"
        onClick={() => onToggleHideInactive(!hideInactive)}
      >
        <span className={`retail-col-toggle-check${hideInactive ? ' retail-col-toggle-check--on' : ''}`} aria-hidden="true">
          {hideInactive ? '✓' : ''}
        </span>
        {requiredLocalized(l10n, 'retail-col-hide-inactive')}
      </button>
    </div>
  );
}

/** Display order of toggleable columns (Cost is never a column — ADR #36 D4). */
export const RETAIL_COLUMN_ORDER: readonly RetailColumn[] = [
  'sku', 'barcode', 'category', 'brand', 'name', 'rack', 'stock', 'price', 'notes',
];

// ── ProductCard sub-component ──────────────────────────────────────
// Memoized: props are referentially stable (handlers are useCallbacks,
// catHue is a useCallback, formatMoney is module-level, and product
// objects come from the memoized pagedProducts slice) so cards skip
// re-renders when cart/totals change (P4).

const ProductCard = memo(function ProductCard({ product, catHue, formatMoney, handleAdd, handleEdit, handleOpenQtyPicker, scaleEnabled, onSetWeighTarget, onRowContextMenu, visibleColumns, outOfStockLabel, addToCartTitle, addToCartAria, editProductTitle, editProductAria, weighProductAria }: {
  product: ProductDto;
  catHue: (catId: string | null) => number;
  formatMoney: (m: Money) => string;
  handleAdd: (p: ProductDto) => void;
  handleEdit: (p: ProductDto) => void;
  handleOpenQtyPicker: (p: ProductDto) => void;
  scaleEnabled: boolean;
  onSetWeighTarget: (p: ProductDto) => void;
  onRowContextMenu: (p: ProductDto, x: number, y: number) => void;
  visibleColumns: readonly RetailColumn[];
  outOfStockLabel: string;
  addToCartTitle: string;
  addToCartAria: string;
  editProductTitle: string;
  editProductAria: string;
  weighProductAria: string;
}) {
  const isOutOfStock = !product.in_stock || (product.stock_qty != null && product.stock_qty <= 0);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPress = useRef(false);
  // Refs to avoid stale closures in the long-press timeout (P2-7).
  const productRef = useRef(product);
  productRef.current = product;
  const handleOpenQtyPickerRef = useRef(handleOpenQtyPicker);
  handleOpenQtyPickerRef.current = handleOpenQtyPicker;
  const handleAddRef = useRef(handleAdd);
  handleAddRef.current = handleAdd;

  const lowThreshold = product.low_stock_threshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
  const highThreshold = product.high_stock_threshold ?? DEFAULT_HIGH_STOCK_THRESHOLD;
  const stockLevel =
    product.stock_qty != null && product.stock_qty <= lowThreshold
      ? 'low'
      : product.stock_qty != null && product.stock_qty <= highThreshold
      ? 'medium'
      : 'high';

  const handlePointerDown = useCallback(() => {
    // The button is `disabled` when out of stock, so pointer events only
    // reach here for in-stock products.
    isLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      isLongPress.current = true;
      handleOpenQtyPickerRef.current(productRef.current);
    }, 400);
  }, []);

  const handlePointerUp = useCallback(() => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    if (!isLongPress.current) handleAddRef.current(productRef.current);
  }, []);

  const handlePointerLeave = useCallback(() => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }, []);

  // Clear the long-press timer on unmount (stale timeout after product list change)
  useEffect(() => {
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    };
  }, []);

  // ADR #38 D1: right-click opens the row context menu; the Menu key
  // (bubbled from any focused control inside the row) opens it too.
  const openContextMenu = useCallback((e: React.MouseEvent | React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    onRowContextMenu(
      productRef.current,
      'clientX' in e ? e.clientX : rect.left + rect.width / 2,
      'clientY' in e ? e.clientY : rect.bottom,
    );
  }, [onRowContextMenu]);

  const handleRowKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Menu' || e.key === 'ContextMenu') {
      openContextMenu(e);
    }
  }, [openContextMenu]);

  return (
    <tr
      className={`retail-product-row${isOutOfStock ? ' retail-product-row--out-of-stock' : ''}`}
      onContextMenu={openContextMenu}
      onKeyDown={handleRowKeyDown}
    >
      {visibleColumns.includes('sku') && (
        <td className="retail-col-sku">{product.sku}</td>
      )}
      {visibleColumns.includes('barcode') && (
        <td className="retail-col-barcode">{cellValue(product.barcode)}</td>
      )}
      {visibleColumns.includes('category') && (
        <td className="retail-col-category">{cellValue(product.category)}</td>
      )}
      {visibleColumns.includes('brand') && (
        <td className="retail-col-brand">{cellValue(product.brand)}</td>
      )}
      {visibleColumns.includes('name') && (
        <td className="retail-col-name">
          <button
            type="button"
            className={`retail-product-btn${isOutOfStock ? ' retail-product-btn--out-of-stock' : ''}`}
            style={{ '--cat-hue': catHue(product.category) } as React.CSSProperties}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerLeave}
            onKeyDown={(e) => {
              // The pointer handlers are touch/mouse-only; Enter/Space would
              // otherwise leave the name button inert for keyboard users.
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleAddRef.current(productRef.current);
              }
            }}
            aria-label={`${product.name} ${formatMoney(product.price)}${isOutOfStock ? ` (${outOfStockLabel})` : ''}`}
            disabled={isOutOfStock}
          >
            <span>{product.name}</span>
          </button>
        </td>
      )}
      {visibleColumns.includes('rack') && (
        <td className="retail-col-rack">{cellValue(product.rack_location)}</td>
      )}
      {visibleColumns.includes('stock') && (
        <td className="retail-col-stock">
          {product.stock_qty != null && product.stock_qty > 0 ? (
            <span className={`retail-product-stock-badge retail-stock-${stockLevel}`}>
              {product.stock_qty}
            </span>
          ) : (
            <span className="retail-product-out-label">{outOfStockLabel}</span>
          )}
        </td>
      )}
      {visibleColumns.includes('price') && (
        <td className="retail-col-price">{formatMoney(product.price)}</td>
      )}
      {visibleColumns.includes('notes') && (
        <td className="retail-col-notes" title={product.notes ?? undefined}>{cellValue(product.notes)}</td>
      )}
      <td className="retail-col-action">
        <div className="retail-col-action-group">
          <button
            type="button"
            className="retail-table-add-btn"
            disabled={isOutOfStock}
            onClick={() => {
              if (!isOutOfStock) handleAdd(product);
            }}
            title={addToCartTitle}
            aria-label={addToCartAria}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
              <circle cx="9" cy="21" r="1" />
              <circle cx="20" cy="21" r="1" />
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
            </svg>
          </button>
          <button
            type="button"
            className="retail-table-edit-btn"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              handleEdit(product);
            }}
            title={editProductTitle}
            aria-label={editProductAria}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
          {scaleEnabled && (
            <button
              type="button"
              className="retail-product-weigh-btn"
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); onSetWeighTarget(product); }}
              aria-label={weighProductAria}
            >
              ⚖
            </button>
          )}
        </div>
      </td>
    </tr>
  );
});

// ── Image-grid tile constants & cell component ────────────────────────

const TILE_WIDTH = 140;
const TILE_HEIGHT = 150;
const TILE_GAP = 12;

interface ProductTileCellExtraProps {
  products: readonly ProductDto[];
  catHue: (catId: string | null) => number;
  columnCount: number;
  onAddProduct: (p: ProductDto) => void;
}

const ProductTileCell = function ProductTileCell({
  columnIndex, rowIndex, style, products, catHue, columnCount, onAddProduct,
}: CellComponentProps<ProductTileCellExtraProps>) {
  const idx = rowIndex * columnCount + columnIndex;
  if (idx >= products.length) return null;
  const product = products[idx]!;
  const isOutOfStock = !product.in_stock || (product.stock_qty != null && product.stock_qty <= 0);
  return (
    <div style={{ ...style, padding: TILE_GAP / 2 }}>
      <button
        type="button"
        className={`retail-tile${isOutOfStock ? ' retail-tile--disabled' : ''}`}
        onClick={() => { if (!isOutOfStock) onAddProduct(product); }}
        disabled={isOutOfStock}
        aria-label={`${product.name} ${formatMoney(product.price)}${isOutOfStock ? ' (out of stock)' : ''}`}
        style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', gap: 4, padding: 8, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm, 4px)', background: 'var(--color-bg)', cursor: isOutOfStock ? 'not-allowed' : 'pointer' }}
      >
        <ProductThumb hash={product.image_hash ?? null} name={product.name} hue={catHue(product.category)} size={TILE_WIDTH - 16} className="retail-tile-thumb" />
        <span className="retail-tile-name">{product.name}</span>
        <span className="retail-tile-price">{formatMoney(product.price)}</span>
      </button>
    </div>
  );
};

// ── Main component ─────────────────────────────────────────────────

/** Product grid — categories, search, product table with sorting, pagination, SKU input, and scale indicator. */
export default function RetailProductGrid({
  sessionToken,
  data,
  actions,
  isScaleEnabled,
  catHue,
  skuInputRef,
}: RetailProductGridProps) {
  const { l10n } = useLocalization();
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);

  // ── Image-grid container measurement (react-window v2 responsive cols) ──
  const [gridWidth, setGridWidth] = useState(0);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const gridContainerRef = useCallback((el: HTMLDivElement | null) => {
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
      resizeObserverRef.current = null;
    }
    if (el) {
      const ro = new ResizeObserver(([entry]) => {
        if (entry) setGridWidth(entry.contentRect.width);
      });
      ro.observe(el);
      resizeObserverRef.current = ro;
    }
  }, []);
  const gridColCount = Math.max(1, Math.floor((gridWidth + TILE_GAP) / (TILE_WIDTH + TILE_GAP)));
  const gridCellWidth = gridWidth > 0 ? Math.floor((gridWidth - (gridColCount - 1) * TILE_GAP) / gridColCount) : TILE_WIDTH;

  const {
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
    visibleColumns,
    hideInactive,
    viewMode,
  } = data;

  const renderHeader = (field: SortField, colClass: string, labelId: string, center = false, end = false) => (
    <th
      className={`${colClass} retail-col-sortable`}
      role="columnheader"
      scope="col"
      aria-sort={sortField === field ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className={`retail-th-content${center ? ' retail-th-content--center' : ''}${end ? ' retail-th-content--end' : ''}`}
        onClick={() => actions.onSort(field)}
      >
        <span>{requiredLocalized(l10n, labelId)}</span>
        <span className="retail-sort-icon" aria-hidden="true">
          {sortField === field ? (sortOrder === 'asc' ? ' ▲' : ' ▼') : ' ↕'}
        </span>
      </button>
    </th>
  );

  return (
    <div className="retail-products">
      <div
        className="retail-categories"
        onWheel={(e) => {
          // Map both trackpad horizontal (deltaX) and wheel vertical (deltaY)
          // scroll to horizontal scrolling, and stop the page from scrolling
          // vertically underneath the category bar.
          const delta = e.deltaX || e.deltaY;
          if (delta) {
            e.currentTarget.scrollLeft += delta;
            if (e.cancelable) e.preventDefault();
          }
        }}
      >
        <button
          className={`retail-cat-btn${!activeCategory ? ' retail-cat-btn--active' : ''}`}
          onClick={() => actions.onSetActiveCategory(null)}
        >
          {allLabel}
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            className={`retail-cat-btn${activeCategory === cat.id ? ' retail-cat-btn--active' : ''}`}
            onClick={() => actions.onSetActiveCategory(cat.id)}
            aria-label={catLabels.get(cat.id) ?? cat.name}
            aria-pressed={activeCategory === cat.id}
          >
            {catLabels.get(cat.id) ?? cat.name}
          </button>
        ))}
        <Localized id="retail-add-category-btn">
          <button
            type="button"
            className="retail-cat-btn retail-cat-btn--add"
            onClick={actions.onAddCategory}
            title={requiredLocalized(l10n, 'retail-add-category-btn-title')}
            aria-label={requiredLocalized(l10n, 'retail-add-category-btn-aria')}
          >
            + Category
          </button>
        </Localized>
      </div>

      {/* ── Search bar ────────────────────── */}
      <div className="retail-search-bar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          className="retail-search-input"
          type="text"
          value={searchQuery}
          onChange={(e) => actions.onSetSearchQuery(e.target.value)}
          placeholder={l10n.getString('retail-search-placeholder')}
        />
        {searchQuery && (
          <button type="button" className="retail-search-clear" onClick={() => actions.onSetSearchQuery('')} aria-label={l10n.getString('retail-search-clear-aria')}>
            &times;
          </button>
        )}
        {/* ADR #37 D5: popularity is a sortable option — click sorts desc (most
            popular first), repeat click flips to ascending. */}
        <button
          type="button"
          className={`retail-sort-popularity-btn${sortField === 'popularity' ? ' retail-sort-popularity-btn--active' : ''}`}
          onClick={() => actions.onSort('popularity')}
          aria-pressed={sortField === 'popularity'}
          title={requiredLocalized(l10n, 'retail-col-popularity-title')}
        >
          🔥 {requiredLocalized(l10n, 'retail-col-popularity')}
          <span className="retail-sort-icon">
            {sortField === 'popularity' ? (sortOrder === 'asc' ? ' ▲' : ' ▼') : ''}
          </span>
        </button>
        <div className="retail-view-toggle-wrap">
          <button
            type="button"
            className={`retail-view-toggle-btn${viewMode === 'grid' ? ' retail-view-toggle-btn--active' : ''}`}
            onClick={() => actions.onSetViewMode(viewMode === 'grid' ? 'text' : 'grid')}
            aria-pressed={viewMode === 'grid'}
            title={requiredLocalized(l10n, viewMode === 'grid' ? 'retail-view-grid-title' : 'retail-view-text-title')}
          >
            {viewMode === 'grid'
              ? requiredLocalized(l10n, 'retail-view-text-label')
              : requiredLocalized(l10n, 'retail-view-grid-label')}
          </button>
        </div>
        <div className="retail-col-toggle-wrap">
          <button
            type="button"
            className="retail-col-toggle-btn"
            onClick={() => setColumnMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={columnMenuOpen}
            title={requiredLocalized(l10n, 'retail-col-toggle-title')}
          >
            {requiredLocalized(l10n, 'retail-col-toggle-btn')}
          </button>
          {columnMenuOpen && (
            <ColumnToggleMenu
              visibleColumns={visibleColumns}
              hideInactive={hideInactive}
              onToggleColumn={actions.onToggleColumn}
              onToggleHideInactive={actions.onToggleHideInactive}
              onClose={() => setColumnMenuOpen(false)}
            />
          )}
        </div>
        <Localized id="retail-add-product-btn">
          <button
            type="button"
            className="retail-add-product-btn"
            onClick={actions.onAddNewProduct}
            title={requiredLocalized(l10n, 'retail-add-product-btn-title')}
            aria-label={requiredLocalized(l10n, 'retail-add-product-btn-aria')}
          >
            + Product
          </button>
        </Localized>
      </div>

      {isScaleEnabled && (
        <ScaleIndicator
          {...(sessionToken ? { sessionToken } : {})}
          weighTarget={weighTarget}
          onWeighAdd={actions.onWeighAdd}
          onClearWeighTarget={actions.onClearWeighTarget}
        />
      )}

      {productsLoading || categoriesLoading ? (
        <div className="retail-skeleton-grid">
          <table className="retail-skeleton-table">
            <thead>
              <tr>
                {visibleColumns.includes('sku') && <th className="retail-col-sku"><span className="retail-skeleton-shimmer">&nbsp;</span></th>}
                {visibleColumns.includes('barcode') && <th className="retail-col-barcode"><span className="retail-skeleton-shimmer">&nbsp;</span></th>}
                {visibleColumns.includes('category') && <th className="retail-col-category"><span className="retail-skeleton-shimmer">&nbsp;</span></th>}
                {visibleColumns.includes('brand') && <th className="retail-col-brand"><span className="retail-skeleton-shimmer">&nbsp;</span></th>}
                {visibleColumns.includes('name') && <th className="retail-col-name"><span className="retail-skeleton-shimmer retail-skeleton-shimmer--wide">&nbsp;</span></th>}
                {visibleColumns.includes('rack') && <th className="retail-col-rack"><span className="retail-skeleton-shimmer">&nbsp;</span></th>}
                {visibleColumns.includes('stock') && <th className="retail-col-stock"><span className="retail-skeleton-shimmer retail-skeleton-shimmer--stock">&nbsp;</span></th>}
                {visibleColumns.includes('price') && <th className="retail-col-price"><span className="retail-skeleton-shimmer retail-skeleton-shimmer--price">&nbsp;</span></th>}
                {visibleColumns.includes('notes') && <th className="retail-col-notes"><span className="retail-skeleton-shimmer">&nbsp;</span></th>}
                <th className="retail-col-action"><span className="retail-skeleton-shimmer retail-skeleton-shimmer--action">&nbsp;</span></th>
              </tr>
            </thead>
            <tbody role="status" aria-label={requiredLocalized(l10n, 'retail-products-loading')}>
              {Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="retail-skeleton-row">
                  {visibleColumns.includes('sku') && <td className="retail-col-sku"><span className="retail-skeleton-shimmer">&nbsp;</span></td>}
                  {visibleColumns.includes('barcode') && <td className="retail-col-barcode"><span className="retail-skeleton-shimmer">&nbsp;</span></td>}
                  {visibleColumns.includes('category') && <td className="retail-col-category"><span className="retail-skeleton-shimmer">&nbsp;</span></td>}
                  {visibleColumns.includes('brand') && <td className="retail-col-brand"><span className="retail-skeleton-shimmer">&nbsp;</span></td>}
                  {visibleColumns.includes('name') && <td className="retail-col-name"><span className="retail-skeleton-shimmer retail-skeleton-shimmer--wide">&nbsp;</span></td>}
                  {visibleColumns.includes('rack') && <td className="retail-col-rack"><span className="retail-skeleton-shimmer">&nbsp;</span></td>}
                  {visibleColumns.includes('stock') && <td className="retail-col-stock"><span className="retail-skeleton-shimmer retail-skeleton-shimmer--stock">&nbsp;</span></td>}
                  {visibleColumns.includes('price') && <td className="retail-col-price"><span className="retail-skeleton-shimmer retail-skeleton-shimmer--price">&nbsp;</span></td>}
                  {visibleColumns.includes('notes') && <td className="retail-col-notes"><span className="retail-skeleton-shimmer">&nbsp;</span></td>}
                  <td className="retail-col-action"><span className="retail-skeleton-shimmer retail-skeleton-shimmer--action">&nbsp;</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : filteredProducts.length === 0 ? (
        <div className="retail-grid-empty" role="status">
          {filterLowStock
            ? (requiredLocalized(l10n, 'retail-no-low-stock-products'))
            : searchQuery.trim()
              ? (requiredLocalized(l10n, 'retail-no-products-match'))
              : activeCategory
                ? (requiredLocalized(l10n, 'retail-no-products-in-category'))
                : (requiredLocalized(l10n, 'retail-no-products'))}
        </div>
      ) : viewMode === 'grid' ? (
        <div ref={gridContainerRef} className="retail-grid" data-testid="product-grid-scroll">
          {gridWidth > 0 && (
            <Grid
              cellComponent={ProductTileCell}
              cellProps={{
                products: filteredProducts,
                catHue,
                columnCount: gridColCount,
                onAddProduct: actions.onAddProduct,
              }}
              columnCount={gridColCount}
              columnWidth={gridCellWidth}
              rowCount={Math.ceil(filteredProducts.length / gridColCount)}
              rowHeight={TILE_HEIGHT + TILE_GAP}
              overscanCount={4}
              style={{ height: '100%', width: '100%' }}
            />
          )}
        </div>
      ) : (
        <div className="retail-grid" data-testid="product-grid-scroll">
          <table className="retail-product-table">
            <thead>
              <tr>
                {visibleColumns.includes('sku') && renderHeader('sku', 'retail-col-sku', 'retail-col-sku')}
                {visibleColumns.includes('barcode') && <th scope="col" className="retail-col-barcode">{requiredLocalized(l10n, 'retail-col-barcode')}</th>}
                {visibleColumns.includes('category') && <th scope="col" className="retail-col-category">{requiredLocalized(l10n, 'retail-col-category')}</th>}
                {visibleColumns.includes('brand') && <th scope="col" className="retail-col-brand">{requiredLocalized(l10n, 'retail-col-brand')}</th>}
                {visibleColumns.includes('name') && renderHeader('name', 'retail-col-name', 'retail-col-name')}
                {visibleColumns.includes('rack') && <th scope="col" className="retail-col-rack">{requiredLocalized(l10n, 'retail-col-rack')}</th>}
                {visibleColumns.includes('stock') && renderHeader('stock', 'retail-col-stock', 'retail-col-stock', true)}
                {visibleColumns.includes('price') && renderHeader('price', 'retail-col-price', 'retail-col-price', false, true)}
                {visibleColumns.includes('notes') && <th scope="col" className="retail-col-notes">{requiredLocalized(l10n, 'retail-col-notes')}</th>}
                <th scope="col" className="retail-col-action">{requiredLocalized(l10n, 'retail-col-action')}</th>
              </tr>
            </thead>
            <tbody>
              {pagedProducts.map((p) => (
                <ProductCard
                  key={p.sku}
                  product={p}
                  catHue={catHue}
                  formatMoney={formatMoney}
                  handleAdd={actions.onAddProduct}
                  handleEdit={actions.onEditProduct}
                  handleOpenQtyPicker={actions.onOpenQtyPicker}
                  scaleEnabled={isScaleEnabled}
                  onSetWeighTarget={actions.onSetWeighTarget}
                  onRowContextMenu={actions.onRowContextMenu}
                  visibleColumns={visibleColumns}
                  outOfStockLabel={requiredLocalized(l10n, 'retail-product-out-of-stock')}
                  addToCartTitle={requiredLocalized(l10n, 'retail-product-add-title')}
                  addToCartAria={requiredLocalized(l10n, 'retail-product-add-aria', { name: p.name })}
                  editProductTitle={requiredLocalized(l10n, 'retail-product-edit-title')}
                  editProductAria={requiredLocalized(l10n, 'retail-product-edit-aria', { name: p.name })}
                  weighProductAria={requiredLocalized(l10n, 'retail-product-weigh-aria', { name: p.name })}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {viewMode === 'text' && totalPages > 1 && (
        <div className="retail-page-nav" role="navigation" aria-label={requiredLocalized(l10n, 'retail-page-nav-aria')}>
          <button type="button" className="retail-page-btn" disabled={productPage === 0} onClick={() => actions.onSetProductPage((p) => p - 1)} aria-label={requiredLocalized(l10n, 'retail-page-prev-aria')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <span className="retail-page-info" aria-current="true">{productPage + 1} / {totalPages}</span>
          <button type="button" className="retail-page-btn" disabled={productPage >= totalPages - 1} onClick={() => actions.onSetProductPage((p) => p + 1)} aria-label={requiredLocalized(l10n, 'retail-page-next-aria')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
          </button>
        </div>
      )}
      <div className="retail-sku-bar">
        <span className="retail-sku-label">{l10n.getString('retail-sku-label')}</span>
        <input
          ref={skuInputRef}
          className="retail-sku-input"
          type="text"
          value={skuInput}
          onChange={(e) => actions.onSkuInputChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') actions.onSkuSubmit(); }}
          placeholder={l10n.getString('retail-sku-placeholder')}
        />
        <button
          className="retail-sku-go-btn"
          onClick={actions.onSkuSubmit}
          aria-label={requiredLocalized(l10n, 'retail-sku-lookup-aria')}
        >
          {l10n.getString('retail-sku-go')}
        </button>
      </div>
    </div>
  );
}
