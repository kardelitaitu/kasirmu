import { useState, useMemo, useCallback, useRef, useEffect, Profiler } from 'react';
import { Grid, type CellComponentProps } from 'react-window';
import { useLocalization } from '@fluent/react';
import { useToast } from '@/components/Toast';
import { Localized } from '@/components/Localized';
import { formatMoney, type Product } from '@/types/domain';
import { lookupProductBySkuScoped } from '@/api/products';
import { lookupBundleBySku } from '@/api/bundles';
import { expandBundleItems } from '@/features/sales/bundleExpansion';
import { useProducts } from './useProducts';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import './ProductLookupScreen.css';

// ── Props ──────────────────────────────────────────────────────────

export interface ProductLookupScreenProps {
  /** Called when the user clicks "Add to cart" on a product. */
  onAddProduct?: (product: Product) => void;
}

// ── Helpers ────────────────────────────────────────────────────────

type Category = string;

/** Search icon SVG */
function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

/** Barcode scan icon SVG */
function BarcodeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 4h2v16H2z" />
      <path d="M6 4h1v16H6z" />
      <path d="M9 4h2v16H9z" />
      <path d="M13 4h1v16h-1z" />
      <path d="M16 4h2v16h-2z" />
      <path d="M20 4h2v16h-2z" />
    </svg>
  );
}

/** Add (plus) icon SVG */
function AddIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

/** Package/search icon for empty state */
function PackageIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="product-empty-icon" aria-hidden="true">
      <path d="M16.5 9.4 7.55 4.24" />
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.29 7 12 12 20.71 7" />
      <line x1="12" y1="22" x2="12" y2="12" />
    </svg>
  );
}

// ── Component ──────────────────────────────────────────────────────

/**
 * Product Lookup screen.
 *
 * Provides a search bar, barcode scanner input, category filter chips,
 * and a responsive product grid. Uses sample data for now — the IPC
 * bridge to the backend product catalog will be added in a follow-up.
 *
 * @example
 * ```tsx
 * <ProductLookupScreen onAddProduct={(p) => console.log('add', p.sku)} />
 * ```
 */
export default function ProductLookupScreen({ onAddProduct }: ProductLookupScreenProps) {
  const { l10n } = useLocalization();
  const { addToast } = useToast();
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';
  const { products, categories, loading, error, usingFallback, reload } = useProducts(sessionToken);
  const [searchQuery, setSearchQuery] = useState('');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [activeCategory, setActiveCategory] = useState<Category>('All');
  const [addedSku, setAddedSku] = useState<string | null>(null);
  const addedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [gridWidth, setGridWidth] = useState(0);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // Measure the grid container width for responsive column count.
  // Using a callback ref handles conditional rendering and mounting/unmounting correctly.
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

  // Calculate column count and cell width from measured container width
  const gridColCount = Math.max(1, Math.floor((gridWidth + CARD_GAP) / (CARD_WIDTH + CARD_GAP)));
  const gridCellWidth = gridWidth > 0 ? Math.floor((gridWidth - (gridColCount - 1) * CARD_GAP) / gridColCount) : CARD_WIDTH;

  // Clean up add-to-cart animation timer on unmount
  useEffect(() => {
    return () => {
      if (addedTimerRef.current) clearTimeout(addedTimerRef.current);
    };
  }, []);

  // Wrap onAddProduct to trigger the green flash animation
  const handleAddProduct = useCallback((product: Product) => {
    onAddProduct?.(product);
    setAddedSku(product.sku);
    if (addedTimerRef.current) clearTimeout(addedTimerRef.current);
    addedTimerRef.current = setTimeout(() => setAddedSku(null), 450);
  }, [onAddProduct]);

  // All category options: "All" + each unique category
  const categoryOptions = useMemo<Category[]>(
    () => ['All', ...categories],
    [categories],
  );

  // Filter products based on search, barcode, and category
  const filtered = useMemo(() => {
    let results = products;

    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      results = results.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.barcode !== null && p.barcode.includes(q)),
      );
    }

    // Filter by active category
    if (activeCategory !== 'All') {
      results = results.filter((p) => p.category === activeCategory);
    }

    return results;
  }, [searchQuery, activeCategory, products]);

  // Handle barcode scan submission with bundle expansion fallback
  const handleBarcodeScan = useCallback(async () => {
    if (!barcodeInput.trim()) return;
    const code = barcodeInput.trim();
    const found = products.find((p) => p.barcode === code);
    if (found && found.inStock) {
      handleAddProduct(found);
      setBarcodeInput('');
      return;
    }

    // Fall back to bundle SKU expansion with proportional pricing.
    try {
      const bundle = await lookupBundleBySku(sessionToken, code);
      if (bundle && bundle.bundle.active) {
        const expanded = await expandBundleItems(
          bundle.items,
          bundle.bundle.currency,
          bundle.bundle.bundle_price_minor,
          (sku: string) => lookupProductBySkuScoped(sessionToken, sku),
        );
        for (const item of expanded) {
          // Add once per quantity — onAddProduct uses default qty=1.
          for (let i = 0; i < item.qty; i++) {
            onAddProduct?.(item.product);
          }
        }
        setAddedSku(code);
        addedTimerRef.current = setTimeout(() => setAddedSku(null), 450);
        addToast({
          type: 'success',
          message: l10n.getString('product-lookup-bundle-added', {
            name: bundle.bundle.name,
            count: expanded.length,
          }),
        });
      } else {
        addToast({
          type: 'warning',
          message: l10n.getString('product-lookup-no-match'),
        });
      }
    } catch {
      // If bundle lookup fails, silently ignore.
    }
    setBarcodeInput('');
    // sessionToken is read at :176 (bundle) and :182 (product). Because the bundle path's catch
    // above ignores failures, a stale token after a hot-swap makes bundled products scan as
    // ordinary single products with no indication anything went wrong.
  }, [barcodeInput, handleAddProduct, products, addToast, l10n, onAddProduct, sessionToken]);

  // Handle Enter key in barcode input
  const handleBarcodeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleBarcodeScan();
      }
    },
    [handleBarcodeScan],
  );

  // Handle Enter key in search input (could focus barcode, etc.)
  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && searchQuery.trim()) {
        // Focus the first product card or scroll to grid
        const firstCardBtn = document.querySelector('.product-card-btn');
        if (firstCardBtn instanceof HTMLElement) {
          firstCardBtn.focus();
        }
      }
    },
    [searchQuery],
  );

  return (
    <Profiler id="ProductLookupScreen" onRender={(...args) => {
      if (typeof args[2] === 'number' && args[2] > 1) {
        console.debug('[Profiler] ProductLookupScreen', args[1] === 'mount' ? '⚡mount' : '♻update', `${args[2].toFixed(1)}ms`);
      }
    }}>
    <div className="product-lookup">
      {/* ── Toolbar: Search + Barcode ────────────── */}
      <div className="product-toolbar">
        <div className="product-search-wrapper">
          <span className="product-search-icon">
            <SearchIcon />
          </span>
          <Localized id="product-lookup-search-placeholder" attrs={{ placeholder: true }}>
            <Localized id="product-lookup-search-aria" attrs={{ 'aria-label': true }}>
              <input
                type="search"
                className="product-search-input"
                placeholder="Search products…"
                aria-label={l10n.getString('search-products-aria')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                data-1p-ignore="true"
                data-lpignore="true"
                data-bwignore="true"
              />
            </Localized>
          </Localized>
        </div>

        <div className="product-barcode-wrapper">
          <Localized id="product-lookup-barcode-placeholder" attrs={{ placeholder: true }}>
            <Localized id="product-lookup-barcode-aria" attrs={{ 'aria-label': true }}>
              <input
                id="barcode-input"
                type="text"
                className="product-barcode-input"
                placeholder="Scan barcode…"
                aria-label={l10n.getString('barcode-input-aria')}
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                onKeyDown={handleBarcodeKeyDown}
                autoComplete="off"
              />
            </Localized>
          </Localized>
          <Localized id="product-lookup-scan-btn-aria" attrs={{ 'aria-label': true }}>
            <button
              type="button"
              className="product-scan-btn"
              onClick={handleBarcodeScan}
              aria-label={l10n.getString('submit-barcode-aria')}
            >
              <BarcodeIcon />
              <Localized id="product-lookup-barcode-scan">
                <span />
              </Localized>
            </button>
          </Localized>
        </div>
      </div>

      {/* ── Category filters ───────────────────────── */}
      <div className="product-categories" role="radiogroup" aria-label={l10n.getString('product-lookup-categories-aria')}>
          {categoryOptions.map((cat) => (
            <button
              key={cat}
              type="button"
              role="radio"
              aria-checked={activeCategory === cat}
              className={
                activeCategory === cat
                  ? 'product-category-chip product-category-chip--active'
                  : 'product-category-chip'
              }
              onClick={() => setActiveCategory(cat)}
            >
              {cat === 'All' ? (
                <Localized id="product-lookup-all-categories">
                  <span />
                </Localized>
              ) : (
                cat
              )}
            </button>
          ))}
        </div>

      {/* ── Loading state ────────────────────────────── */}
      {loading ? (
        <div className="product-empty">
          <span className="product-empty-text">
            <Localized id="product-lookup-loading">
              <span />
            </Localized>
          </span>
        </div>
      ) : error && !usingFallback ? (
        /* LOAD-03/LOAD-08: a production load failure must not look like an
           empty catalog — render a localized unavailable state with Retry. */
        <div className="product-empty" role="alert">
          <span className="product-empty-text">
            {error}
          </span>
          <button
            type="button"
            className="product-retry-btn"
            onClick={reload}
            aria-label={l10n.getString('retry')}
          >
            <Localized id="retry">
              <span />
            </Localized>
          </button>
        </div>
      ) : filtered.length === 0 ? (
        /* EMPTY-04/05/06: a search/category filter that returns nothing is
           not the same as an empty catalog — announce the transition and
           offer a clear/reset action when a filter is active. */
        <div className="product-empty" role="status">
          <PackageIcon />
          <span className="product-empty-text">
            <Localized id="product-lookup-no-results">
              <span />
            </Localized>
          </span>
          {(searchQuery.trim() || activeCategory !== 'All') && (
            <button
              type="button"
              className="product-empty-clear-search"
              onClick={() => {
                setSearchQuery('');
                setActiveCategory('All');
              }}
            >
              <Localized id="product-lookup-clear-search">
                <span />
              </Localized>
            </button>
          )}
        </div>
      ) : (
        <div ref={gridContainerRef} className="product-grid"
             aria-label={l10n.getString('product-lookup-grid-aria')}
             style={{ display: 'block', overflow: 'hidden', flex: 1, minHeight: 0 }}>
          {gridWidth > 0 && (
            <Grid
              cellComponent={ProductGridCell}
              cellProps={{
                products: filtered,
                onAdd: handleAddProduct,
                addedSku,
                columnCount: gridColCount,
              }}
              columnCount={gridColCount}
              columnWidth={gridCellWidth}
              rowCount={Math.ceil(filtered.length / gridColCount)}
              rowHeight={CARD_HEIGHT + CARD_GAP}
              overscanCount={4}
              style={{ height: '100%', width: '100%' }}
            />
          )}
        </div>
      )
      }

      {/* Dev notice when using fallback data */}
      {usingFallback && (
        <div
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-fg-tertiary)',
            textAlign: 'center',
            padding: 'var(--space-2)',
          }}
        >
          <Localized id="product-lookup-dev-fallback">
            <span />
          </Localized>
        </div>
      )}
    </div>
    </Profiler>
  );
}

const PRICE_VOLATILITY_MS = 24 * 60 * 60 * 1000;

function isPriceRecent(p: Product): boolean {
  if (!p.priceUpdatedAt) return false;
  const elapsed = Date.now() - new Date(p.priceUpdatedAt).getTime();
  return elapsed >= 0 && elapsed < PRICE_VOLATILITY_MS;
}

// ── ProductCard sub-component ──────────────────────────────────────

interface ProductCardProps {
  product: Product;
  onAdd?: (product: Product) => void;
  added?: boolean;
}

/* ── Virtualized grid sizing ──────────────────────────────────── */

const CARD_WIDTH = 220; // 13.75rem
const CARD_HEIGHT = 180; // estimated card height, px
const CARD_GAP = 16;     // var(--space-4), px

/** react-window grid cell for the product grid. Must be defined outside the main component. */
interface ProductGridCellExtraProps {
  products: readonly Product[];
  onAdd: (product: Product) => void;
  addedSku: string | null;
  columnCount: number;
}

/* Inline cell component for the virtualized grid. Not wrapped in React.memo
   because react-window v2 already avoids re-rendering cells whose cellProps
   haven't changed, and memo's return type (ReactNode) conflicts with
   Grid's expected (ReactElement | null). */
const ProductGridCell = function ProductGridCell({
  columnIndex,
  rowIndex,
  style,
  products,
  onAdd,
  addedSku,
  columnCount,
}: CellComponentProps<ProductGridCellExtraProps>) {
  const idx = rowIndex * columnCount + columnIndex;
  if (idx >= products.length) return null;
  const product = products[idx]!;
  return (
    <div style={{ ...style, padding: CARD_GAP / 2, display: 'flex' }}>
      <ProductCard
        product={product}
        onAdd={onAdd}
        added={product.sku === addedSku}
      />
    </div>
  );
};

function ProductCard({ product, onAdd, added }: ProductCardProps) {
  const { l10n } = useLocalization();
  const handleAdd = useCallback(() => {
    onAdd?.(product);
  }, [product, onAdd]);

  const stockLabel = product.inStock
    ? l10n.getString('product-lookup-in-stock')
    : l10n.getString('product-lookup-out-of-stock');

  let cardClass = 'product-card';
  if (!product.inStock) cardClass += ' product-card--disabled';
  if (added) cardClass += ' product-card--added';

  return (
    <div
      className={cardClass}
    >
      {/* Clickable area wraps the entire card content */}
      <Localized
        id="product-lookup-card-aria"
        attrs={{ 'aria-label': true }}
        vars={{
          name: product.name,
          price: formatMoney(product.price),
          sku: product.sku,
          stock: stockLabel,
        }}
      >
        <button
          type="button"
          className="product-card-btn"
          data-testid="product-card"
          onClick={handleAdd}
          disabled={!product.inStock}

        >
          {/* Row: name + category badge */}
          {isPriceRecent(product) && <span className="product-card-price-volatility" title="Price changed recently" />}
          <div className="product-card-header">
            <h3 className="product-card-name" title={product.name}>
              {product.name}
            </h3>
            <span className="product-card-category">{product.category}</span>
          </div>

          {/* Price */}
          <span className="product-card-price">{formatMoney(product.price)}</span>

          {/* SKU */}
          <span className="product-card-sku">{product.sku}</span>

          {/* Rack position (ADR #36 D6): staff find the item without asking a manager */}
          {product.rackLocation && (
            <span className="product-card-rack" title={l10n.getString('product-lookup-rack-title')}>
              📦 {product.rackLocation}
            </span>
          )}

          {/* Footer: stock indicator + add icon */}
          <div className="product-card-footer">
            <span
              className={
                product.inStock
                  ? 'product-card-stock product-card-stock--in'
                  : 'product-card-stock product-card-stock--out'
              }
            >
              <span
                className={
                  product.inStock
                    ? 'product-card-stock-dot product-card-stock-dot--in'
                    : 'product-card-stock-dot product-card-stock-dot--out'
                }
              />
              {product.inStock ? (
                <Localized id="product-lookup-in-stock">
                  <span />
                </Localized>
              ) : (
                <Localized id="product-lookup-out-of-stock">
                  <span />
                </Localized>
              )}
            </span>

            <span className="product-card-add-icon">
              <AddIcon />
            </span>
          </div>
        </button>
      </Localized>
    </div>
  );
}
