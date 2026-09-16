// ── Products: CRUD, variants, categories, barcode, stock adjustment ──

import { loggedInvoke } from '@/utils/logged-invoke';

// ── Products ──────────────────────────────────────────────────────

/** A product as returned by the backend. */
export interface ProductDto {
  /** Internal product ID (UUID) — used by image commands (spec 0046b).
   *  Absent only in fixtures/unsaved products. */
  id?: string;
  sku: string;
  name: string;
  category: string | null;
  price: { minor_units: number; currency: string };
  barcode: string | null;
  in_stock: boolean;
  stock_qty: number | null;
  tax_rate_ids: string[];
  created_at: string;
  price_updated_at: string;
  product_type: string;
  low_stock_threshold?: number | null;
  high_stock_threshold?: number | null;
  /** Cost price in minor units (local-only, ADR #36). Optional: legacy
   *  fixtures / pre-migration backends may omit it; treat missing as 0. */
  cost_minor?: number;
  /** Brand (free text). */
  brand?: string | null;
  /** Rack position code. */
  rack_location?: string | null;
  /** Free-text notes. */
  notes?: string | null;
  /** Unit of measure. */
  unit?: string | null;
  /** Active/sellable status (missing = active). */
  is_active?: boolean;
  /** Default supplier FK (local-only). */
  default_supplier_id?: string | null;
  /** Materialized popularity score (ADR #37) — retail grid sort key. */
  popularity_score?: number;
  /** Slot-1 primary image content hash (spec 0046b); absent = no image. */
  image_hash?: string;
  /** Content-addressed image assignments (slots 1..5) from the snapshot. */
  images?: ProductImageDto[];
}

/** List all products. */
export const listProducts = (): Promise<ProductDto[]> =>
  loggedInvoke<ProductDto[]>('list_products');

/**
 * Fetch products scoped to the store resolved from a session token.
 *
 * ADR #4 / ADR #7 canonical pattern: The backend resolves the opaque
 * `sessionToken` to a `SessionContext` (containing `store_id`), opens
 * the store-scoped database, and returns only that store's products.
 *
 * Prefer this over the unscoped `listProducts()` in multi-store
 * deployments.
 */
export const listProductsScoped = (sessionToken: string): Promise<ProductDto[]> =>
  loggedInvoke<ProductDto[]>('list_products_scoped', { sessionToken });

/**
 * List inventory-tracked products with stock at a specific warehouse location.
 * Used by the warehouse workspace to show per-location stock levels.
 */
export const listWarehouseProductsAtLocation = (
  sessionToken: string,
  locationId: string,
): Promise<ProductDto[]> =>
  loggedInvoke<ProductDto[]>('list_warehouse_products_at_location', {
    sessionToken,
    locationId,
  });

/** ADR #7: Scoped product creation — `userId` is read from session, not args. */
export interface CreateProductScopedArgs {
  sku: string;
  name: string;
  priceMinor: number;
  currency: string;
  categoryId?: string | null | undefined;
  barcode?: string | null | undefined;
  initialStock: number;
  productType?: string;
  taxRateIds: string[];
  /** Cost price in minor units (ADR #36). */
  costMinor?: number;
  /** Brand (free text). */
  brand?: string | null;
  /** Rack position code. */
  rackLocation?: string | null;
  /** Free-text notes. */
  notes?: string | null;
  /** Unit of measure. */
  unit?: string | null;
  /** Active/sellable status (default true). */
  isActive?: boolean;
  /** Default supplier FK (local-only). */
  defaultSupplierId?: string | null;
}

export const createProductScoped = (sessionToken: string, args: CreateProductScopedArgs): Promise<{ sku: string }> =>
  loggedInvoke<{ sku: string }>('create_product_scoped', { sessionToken, args });

/** ADR #7: Scoped product update — `userId` is read from session, not args. */
export interface UpdateProductScopedArgs {
  sku: string;
  name: string;
  priceMinor: number;
  currency: string;
  categoryId?: string | null | undefined;
  barcode?: string | null | undefined;
  productType?: string;
  taxRateIds: string[];
  /** Cost price in minor units (ADR #36, PATCH: absent/null keeps). */
  costMinor?: number | null | undefined;
  /** Brand — `null` clears, string sets, absent keeps (PATCH). */
  brand?: string | null;
  /** Rack position code — `null` clears, string sets, absent keeps (PATCH). */
  rackLocation?: string | null;
  /** Free-text notes — `null` clears, string sets, absent keeps (PATCH). */
  notes?: string | null;
  /** Unit of measure — `null` clears, string sets, absent keeps (PATCH). */
  unit?: string | null;
  /** Active status — absent keeps. */
  isActive?: boolean | null;
  /** Default supplier — `null` clears, string sets, absent keeps (PATCH). */
  defaultSupplierId?: string | null;
}

export const updateProductScoped = (sessionToken: string, args: UpdateProductScopedArgs): Promise<{ sku: string }> =>
  loggedInvoke<{ sku: string }>('update_product_scoped', { sessionToken, args });

/**
 * Record an acted-upon product search for the popularity index (ADR #37 D2).
 *
 * Fire-and-forget: failures are logged server-side and never surfaced.
 * The UI calls this when a search result is actually added to the cart.
 */
export const recordProductSearchScoped = (sessionToken: string, sku: string): Promise<void> =>
  loggedInvoke<void>('record_product_search_scoped', { sessionToken, sku }).catch((err) => {
    // ADR #37 D3: non-blocking — a tracking failure must never fail an add-to-cart.
    console.warn('record_product_search_scoped failed (ignored)', err);
  });

/** ADR #7: Scoped product deletion — `userId` is read from session, not args. */
export const deleteProductScoped = (sessionToken: string, sku: string): Promise<void> =>
  loggedInvoke('delete_product_scoped', { sessionToken, args: { sku } });

// ── Barcode / SKU Lookup ───────────────────────────────────────────

/** ADR #7: Scoped barcode lookup using session token. */
export const lookupByBarcodeScoped = (sessionToken: string, barcode: string): Promise<ProductDto | null> =>
  loggedInvoke<ProductDto | null>('lookup_by_barcode_scoped', { sessionToken, barcode });

/** Check whether a product tracks serial numbers, store-scoped. ADR #7. */
export const getProductTrackSerialScoped = (sessionToken: string, sku: string): Promise<boolean> =>
  loggedInvoke<boolean>('get_product_track_serial_scoped', { sessionToken, sku });

/** ADR #7: Scoped SKU lookup using session token. */
export const lookupProductBySkuScoped = (sessionToken: string, sku: string): Promise<ProductDto | null> =>
  loggedInvoke<ProductDto | null>('lookup_product_by_sku_scoped', { sessionToken, sku });

// ── Inventory Adjustment ──────────────────────────────────────────

/** Arguments for adjusting a product's stock quantity. */
export interface AdjustStockArgs {
  sku: string;
  delta: number;
  reason: string;
}

/** Adjust a product's stock level by a delta value. Returns the new stock quantity. */
export const adjustStock = (args: AdjustStockArgs): Promise<number> =>
  loggedInvoke<number>('adjust_stock', { args });

/**
 * Adjust stock scoped to the store resolved from a session token.
 *
 * ADR #7: Prefer this over `adjustStock()` in multi-store deployments.
 */
export const adjustStockScoped = (sessionToken: string, args: AdjustStockArgs): Promise<number> =>
  loggedInvoke<number>('adjust_stock_scoped', { sessionToken, args });

// ── Product Variants ──────────────────────────────────────────────

/** A product variant linked to a parent product. */
export interface ProductVariantDto {
  id: string;
  parent_sku: string;
  name: string;
  sku: string;
  price: { minor_units: number; currency: string } | null;
  barcode: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Arguments for creating a new product variant. */
export interface CreateProductVariantArgs {
  parentSku: string;
  name: string;
  sku: string;
  priceMinor?: number | null;
  currency?: string | null;
  barcode?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

/** Arguments for updating an existing product variant. */
export interface UpdateProductVariantArgs {
  sku: string;
  name?: string;
  priceMinor?: number | null;
  currency?: string | null;
  barcode?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

/** List all variants for a given parent product SKU (session-scoped — ADR #7). */
export const listProductVariants = (sessionToken: string, parentSku: string): Promise<ProductVariantDto[]> =>
  loggedInvoke<ProductVariantDto[]>('list_product_variants_scoped', { sessionToken, parentSku });

/** Get a single product variant by its SKU (session-scoped — ADR #7). */
export const getProductVariant = (sessionToken: string, sku: string): Promise<ProductVariantDto | null> =>
  loggedInvoke<ProductVariantDto | null>('get_product_variant_scoped', { sessionToken, sku });

/** Create a new product variant (session-scoped — ADR #7). */
export const createProductVariant = (sessionToken: string, args: CreateProductVariantArgs): Promise<{ sku: string }> =>
  loggedInvoke<{ sku: string }>('create_product_variant_scoped', { sessionToken, args });

/** Update an existing product variant (session-scoped — ADR #7). */
export const updateProductVariant = (sessionToken: string, args: UpdateProductVariantArgs): Promise<{ sku: string }> =>
  loggedInvoke<{ sku: string }>('update_product_variant_scoped', { sessionToken, args });

/** Delete a product variant by SKU (session-scoped — ADR #7). */
export const deleteProductVariant = (sessionToken: string, sku: string): Promise<void> =>
  loggedInvoke('delete_product_variant_scoped', { sessionToken, sku });

/** Delete a product variant by SKU (scoped). */
export const deleteProductVariantScoped = (sessionToken: string, sku: string): Promise<void> =>
  loggedInvoke('delete_product_variant_scoped', { sessionToken, sku });

// ── Categories ────────────────────────────────────────────────────

export interface CategoryDto {
  id: string;
  name: string;
  colour: string;
  /** Icon identifier, e.g. "dots-1". Empty string = no icon. */
  icon: string;
}

/** Arguments for creating a new product category. */
export interface CreateCategoryArgs {
  id: string;
  name: string;
  colour: string;
  /** Icon identifier, e.g. "dots-1". */
  icon: string;
}

/** Arguments for updating an existing product category. */
export interface UpdateCategoryArgs {
  id: string;
  name: string;
  colour: string;
  /** Icon identifier, e.g. "dots-2". */
  icon: string;
}

/** List all product categories. */
export const listCategories = (): Promise<CategoryDto[]> =>
  loggedInvoke<CategoryDto[]>('list_categories');

/** List all product categories for the store resolved from a session token. ADR #7. */
export const listCategoriesScoped = (sessionToken: string): Promise<CategoryDto[]> =>
  loggedInvoke<CategoryDto[]>('list_categories_scoped', { sessionToken });

/** Create a new product category in the store resolved from a session token. ADR #7 (CAT-01). */
export const createCategoryScoped = (sessionToken: string, args: CreateCategoryArgs): Promise<{ id: string }> =>
  loggedInvoke('create_category_scoped', { sessionToken, args });

/** Update an existing product category in the store resolved from a session token. ADR #7 (CAT-01). */
export const updateCategoryScoped = (sessionToken: string, args: UpdateCategoryArgs): Promise<{ id: string }> =>
  loggedInvoke('update_category_scoped', { sessionToken, args });

/** Delete a product category in the store resolved from a session token (CAT-01). */
export const deleteCategoryScoped = (sessionToken: string, id: string): Promise<{ affected_products: number }> =>
  loggedInvoke('delete_category_scoped', { sessionToken, args: { id } });

// ── Product images (spec 0046b) ───────────────────────────────────────

/** A product image assignment returned by the backend (spec 0046b §3.2). */
export interface ProductImageDto {
  /** Slot 1 = primary; slots 2..5 = alternatives. */
  slot: number;
  /** Content-addressed hash (first 16 hex chars of sha-256). */
  hash: string;
  /** Display order of alternatives (0-based). */
  position: number;
}

/**
 * Assign the image at `sourcePath` to `productId` at `slot` (1..=5).
 *
 * The ingest pipeline runs entirely in Rust (sniff → transcode → hash →
 * atomic write → DB assignment); only the file path crosses IPC. Returns
 * the 16-hex-char content hash of the transcoded image.
 */
export const productsSetImageScoped = (
  sessionToken: string,
  productId: string,
  slot: number,
  sourcePath: string,
): Promise<string> =>
  loggedInvoke<string>('products_set_image_scoped', { sessionToken, productId, slot, sourcePath });

/** Remove the image assignment at `slot` (the file is left for GC). */
export const productsClearImageScoped = (
  sessionToken: string,
  productId: string,
  slot: number,
): Promise<void> =>
  loggedInvoke<void>('products_clear_image_scoped', { sessionToken, productId, slot });

/** List the image assignments for a product, ordered by slot. */
export const productsListImagesScoped = (
  sessionToken: string,
  productId: string,
): Promise<ProductImageDto[]> =>
  loggedInvoke<ProductImageDto[]>('products_list_images_scoped', { sessionToken, productId });
