import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useLocalization } from '@fluent/react';
import { listProducts, listCategories, listProductsScoped, listCategoriesScoped, type ProductDto, type CategoryDto } from '@/api/products';
import { l10nErrorMessage } from '@/utils/app-error';
import { isDemoMode } from '@/utils/demo-mode';
import { type Product, type Sku } from '@/types/domain';

// ── Sample product fallback ─────────────────────────────────────────

const SAMPLE_PRODUCTS: Product[] = [
  { sku: 'LATTE' as Sku, name: 'Caffè Latte', category: 'Hot Drinks', price: { minor_units: 450, currency: 'USD' }, barcode: '4901234567890', inStock: true, stockQty: 50, productType: 'restaurant' },
  { sku: 'CAPPU' as Sku, name: 'Cappuccino', category: 'Hot Drinks', price: { minor_units: 420, currency: 'USD' }, barcode: '4901234567891', inStock: true, stockQty: 40, productType: 'restaurant' },
  { sku: 'ESPR' as Sku, name: 'Espresso Shot', category: 'Hot Drinks', price: { minor_units: 280, currency: 'USD' }, barcode: '4901234567892', inStock: true, stockQty: 60, productType: 'restaurant' },
  { sku: 'MATCHA' as Sku, name: 'Matcha Latte', category: 'Hot Drinks', price: { minor_units: 520, currency: 'USD' }, barcode: null, inStock: true, stockQty: 30, productType: 'restaurant' },
  { sku: 'BAGEL' as Sku, name: 'Plain Bagel', category: 'Food', price: { minor_units: 250, currency: 'USD' }, barcode: '4901234567894', inStock: true, stockQty: 100, productType: 'restaurant' },
  { sku: 'BAGEL-S' as Sku, name: 'Sesame Bagel', category: 'Food', price: { minor_units: 275, currency: 'USD' }, barcode: '4901234567895', inStock: true, stockQty: 75, productType: 'restaurant' },
  { sku: 'CROISS' as Sku, name: 'Butter Croissant', category: 'Food', price: { minor_units: 350, currency: 'USD' }, barcode: '4901234567896', inStock: true, stockQty: 45, productType: 'restaurant' },
  { sku: 'MUFFIN-B' as Sku, name: 'Blueberry Muffin', category: 'Snacks', price: { minor_units: 320, currency: 'USD' }, barcode: '4901234567897', inStock: true, stockQty: 20, productType: 'restaurant' },
  { sku: 'MUFFIN-C' as Sku, name: 'Chocolate Muffin', category: 'Snacks', price: { minor_units: 340, currency: 'USD' }, barcode: null, inStock: false, stockQty: 0, productType: 'restaurant' },
  { sku: 'SANDW-C' as Sku, name: 'Chicken Sandwich', category: 'Food', price: { minor_units: 750, currency: 'USD' }, barcode: '4901234567899', inStock: true, stockQty: 15, productType: 'restaurant' },
  { sku: 'SANDW-V' as Sku, name: 'Veggie Sandwich', category: 'Food', price: { minor_units: 680, currency: 'USD' }, barcode: '4901234567900', inStock: true, stockQty: 10, productType: 'restaurant' },
  { sku: 'COOKIE' as Sku, name: 'Chocolate Chip Cookie', category: 'Snacks', price: { minor_units: 195, currency: 'USD' }, barcode: '4901234567901', inStock: true, stockQty: 200, productType: 'restaurant' },
  { sku: 'TEA-G' as Sku, name: 'Green Tea', category: 'Hot Drinks', price: { minor_units: 250, currency: 'USD' }, barcode: '4901234567902', inStock: true, stockQty: 80, productType: 'restaurant' },
  { sku: 'TEA-C' as Sku, name: 'Chai Tea', category: 'Hot Drinks', price: { minor_units: 320, currency: 'USD' }, barcode: null, inStock: true, stockQty: 35, productType: 'restaurant' },
  { sku: 'JUICE-O' as Sku, name: 'Orange Juice', category: 'Cold Drinks', price: { minor_units: 380, currency: 'USD' }, barcode: '4901234567904', inStock: true, stockQty: 25, productType: 'restaurant' },
  { sku: 'WATER-S' as Sku, name: 'Sparkling Water', category: 'Cold Drinks', price: { minor_units: 180, currency: 'USD' }, barcode: '4901234567905', inStock: true, stockQty: 150, productType: 'restaurant' },
  { sku: 'BROWNIE' as Sku, name: 'Fudge Brownie', category: 'Snacks', price: { minor_units: 295, currency: 'USD' }, barcode: '4901234567906', inStock: false, stockQty: 0, productType: 'restaurant' },
  { sku: 'MUFFIN-BA' as Sku, name: 'Banana Muffin', category: 'Snacks', price: { minor_units: 310, currency: 'USD' }, barcode: null, inStock: true, stockQty: 12, productType: 'restaurant' },
];
// ── Sample category metadata fallback ─────────────────────────────
//
// Mirrors what the backend would return for the four categories used
// by SAMPLE_PRODUCTS. Each entry has a colour and a placeholder icon
// so the restaurant-menu pills render with full styling in dev / demo
// mode without needing a live Tauri backend.

const SAMPLE_CATEGORY_META: CategoryDto[] = [
  { id: 'cat-food',        name: 'Food',        colour: '#f97316', icon: 'food' },
  { id: 'cat-snacks',      name: 'Snacks',      colour: '#eab308', icon: 'snack' },
  { id: 'cat-hot-drinks',  name: 'Hot Drinks',  colour: '#ef4444', icon: 'hot-drink' },
  { id: 'cat-cold-drinks', name: 'Cold Drinks', colour: '#06b6d4', icon: 'cold-drink' },
];


/** Map a `ProductDto` from IPC to the front-end `Product` type. */
function dtoToProduct(dto: ProductDto, uncategorisedLabel: string): Product {
  return {
    sku: dto.sku as Sku,
    name: dto.name,
    category: dto.category ?? uncategorisedLabel,
    price: {
      minor_units: dto.price.minor_units,
      currency: dto.price.currency,
    },
    barcode: dto.barcode,
    inStock: dto.in_stock,
    stockQty: dto.stock_qty,
    createdAt: dto.created_at,
    priceUpdatedAt: dto.price_updated_at,
    productType: dto.product_type as Product['productType'],
    costMinor: dto.cost_minor ?? 0,
    brand: dto.brand ?? null,
    rackLocation: dto.rack_location ?? null,
    notes: dto.notes ?? null,
    unit: dto.unit ?? null,
    isActive: dto.is_active !== false,
    defaultSupplierId: dto.default_supplier_id ?? null,
    popularityScore: dto.popularity_score ?? 0,
  };
}

// ── Hook ─────────────────────────────────────────────────────────────

export interface UseProductsResult {
  /** The list of products (from IPC or dev-only sample fallback). */
  products: Product[];
  /** Unique category names derived from the product list. */
  categories: string[];
  /** Full category metadata (id, name, colour, icon) from the backend. */
  categoryMeta: CategoryDto[];
  /** Whether products are still loading (IPC call in flight). */
  loading: boolean;
  /** Error message if the IPC call failed. */
  error: string | null;
  /** Whether we're using the sample data fallback (dev/demo mode only). */
  usingFallback: boolean;
  /** Re-run the load (used by the production Retry action). */
  reload: () => void;
}

/**
 * Fetch products from the Rust backend via IPC on mount.
 *
 * Falls back to hardcoded sample data ONLY when running a dev/demo build
 * (`isDemoMode()`) — e.g. the browser preview outside Tauri. In a
 * production build a failed IPC request must never masquerade as live
 * inventory: the hook surfaces a localized `error` and an empty list, and
 * the caller renders an unavailable state with a `reload()` Retry action
 * (LOAD-03).
 *
 * @example
 * ```tsx
 * const { products, categories, loading, error, reload } = useProducts();
 * ```
 */
export function useProducts(sessionToken?: string): UseProductsResult {
  const { l10n } = useLocalization();
  // Capture l10n in a ref so the effect below only runs on mount.
  // Using l10n directly as a dep would re-fetch all products on every
  // locale change, which is wasteful since the IPC data hasn't changed.
  const l10nRef = useRef(l10n);
  l10nRef.current = l10n;

  const [products, setProducts] = useState<Product[] | null>(null);
  const [categoryMeta, setCategoryMeta] = useState<CategoryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usingFallback, setUsingFallback] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const fetchProducts = sessionToken ? () => listProductsScoped(sessionToken) : listProducts;
        const fetchCategories = sessionToken ? () => listCategoriesScoped(sessionToken) : listCategories;
        const [dtos, cats] = await Promise.all([fetchProducts(), fetchCategories()]);
        if (cancelled) return;
        setCategoryMeta(cats);
        if (dtos.length > 0) {
          const uncategorisedLabel = l10nRef.current.getString('product-lookup-uncategorised');
          setProducts(dtos.map(dto => dtoToProduct(dto, uncategorisedLabel)));
          setUsingFallback(false);
        } else if (isDemoMode()) {
          // Empty DB in dev/demo — sample catalog for preview purposes.
          setProducts(SAMPLE_PRODUCTS);
          setCategoryMeta(SAMPLE_CATEGORY_META);
          setUsingFallback(true);
        } else {
          // Empty DB in production is a legitimate empty catalog.
          setProducts([]);
          setUsingFallback(false);
        }
      } catch (err) {
        // IPC unavailable — fall back to sample data only in dev/demo.
        if (cancelled) return;
        setError(l10nErrorMessage(err, l10nRef.current, 'product-lookup-error-load'));
        if (isDemoMode()) {
          setProducts(SAMPLE_PRODUCTS);
          setCategoryMeta(SAMPLE_CATEGORY_META);
          setUsingFallback(true);
        } else {
          setProducts([]);
          setUsingFallback(false);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // sessionToken is read at :132 and :133 to choose the scoped list calls. This is an effect,
    // not a callback, so the consequence differs from the stale-closure cases: the closure is
    // fresh whenever the effect RUNS, but nothing here re-runs it when the token changes. After
    // a store switch the catalogue kept showing the previous store's products until someone
    // called reload() explicitly -- and six production screens consume this hook
    // (ProductLookupScreen, ProductManagementScreen, RestaurantMenu, WarehouseConsole,
    // WarehouseCountFlow, and api/products.ts).
  }, [reloadKey, sessionToken]);

  // Derive categories from products (memoized).
  const categories = useMemo(() => {
    if (!products) return [];
    const cats = new Set(products.map((p) => p.category));
    return Array.from(cats).sort();
  }, [products]);

  return {
    products: products ?? [],
    categories,
    categoryMeta,
    loading,
    error,
    usingFallback,
    reload,
  };
}
