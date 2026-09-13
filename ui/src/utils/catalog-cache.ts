import { listProductsScoped, listCategoriesScoped, type ProductDto, type CategoryDto } from '@/api/products';

/**
 * PERF-08 — Scoped catalog cache.
 *
 * Deduplicates + caches the product/category catalog per session token so
 * switching workspaces, remounting POS, or retrying after a transient
 * failure does not re-fetch the same large payloads.
 *
 * Contract:
 *   - One cache entry per session token (store scope).
 *   - In-flight requests are deduplicated: concurrent callers with the
 *     same token share a single IPC round trip.
 *   - Callers must `invalidateCatalog()` after product/category
 *     mutations so the next load is fresh.
 */

export interface CatalogSnapshot {
  products: ProductDto[];
  categories: CategoryDto[];
}

const cache = new Map<string, CatalogSnapshot>();
const inflight = new Map<string, Promise<CatalogSnapshot>>();

/** Return the cached snapshot for a token, or undefined. */
export function getCatalog(token: string): CatalogSnapshot | undefined {
  return cache.get(token);
}

/**
 * Load the catalog for a token, deduplicating concurrent in-flight loads
 * and serving cached results on repeat calls.
 */
export function loadCatalog(token: string): Promise<CatalogSnapshot> {
  const cached = cache.get(token);
  if (cached) return Promise.resolve(cached);

  const pending = inflight.get(token);
  if (pending) return pending;

  // Both reads must be scoped. `token` is a required parameter, so unlike the ADR #7 screens there
  // is no no-token branch to fall back to: the ambient listCategories() was simply wrong, and
  // because desktop-client registers no list_categories command the whole cache rejected on
  // desktop. Products already used the scoped twin in this same expression.
  const promise = Promise.all([listProductsScoped(token), listCategoriesScoped(token)]).then(
    ([products, categories]) => {
      const snapshot: CatalogSnapshot = { products, categories };
      cache.set(token, snapshot);
      inflight.delete(token);
      return snapshot;
    },
    (err) => {
      // Failed loads are not cached — a retry must re-fetch.
      inflight.delete(token);
      throw err;
    },
  );

  inflight.set(token, promise);
  return promise;
}

/**
 * Invalidate the cached catalog for one token, or the entire cache when
 * no token is given. Call after product/category mutations.
 */
export function invalidateCatalog(token?: string): void {
  if (token) {
    cache.delete(token);
    inflight.delete(token);
  } else {
    cache.clear();
    inflight.clear();
  }
}
