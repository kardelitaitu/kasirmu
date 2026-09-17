// ── MenuItemGrid component (todo-refactor-kds-agents-3.md) ─────────────
//
// The menu results area: the loading announcement, the empty state, and the
// responsive product grid of MenuItemTile cards. The parent supplies the
// already filtered/sorted item list plus the local override sets, so the
// grid only derives per-card presentation state.
//
// Props: loading — catalog fetch in flight; items — filtered+sorted
// products; pinned/unavailable/colors — per-user override sets/maps;
// catMetaMap — category colour used as the tile accent fallback; addedSku —
// card currently showing the 400ms added flash; onAdd / onContextMenu are
// forwarded to each tile.
//
// Invariants: the local unavailable override must be folded into the tile's
// `product.inStock` while `sourceInStock` keeps the catalog value, so an
// 86'd item cannot be added but can still be pinned/colourised. The
// restaurant-grid / restaurant-empty class names are pinned by tests.

import { requiredLocalized, LoadingStatus } from '@/components';
import { Localized } from '@/components/Localized';
import { useLocalization } from '@fluent/react';
import type { Product } from '@/types/domain';
import { MenuItemTile } from './MenuItemTile';

export interface MenuItemGridProps {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  items: Product[];
  hasActiveFilter: boolean;
  onClearFilter: () => void;
  pinned: Set<string>;
  unavailable: Set<string>;
  colors: Record<string, string>;
  catMetaMap: Map<string, { colour: string; icon: string }>;
  addedSku: string | null;
  onAdd: (product: Product) => void;
  onContextMenu: (sku: string, e: React.MouseEvent, trigger: HTMLElement, fromKeyboard: boolean, sourceInStock: boolean) => void;
}

export function MenuItemGrid({ loading, error, onRetry, items, hasActiveFilter, onClearFilter, pinned, unavailable, colors, catMetaMap, addedSku, onAdd, onContextMenu }: MenuItemGridProps) {
  const { l10n } = useLocalization();
  if (loading) {
    // LOAD-05: localized status announcement for the loading region.
    return (
      <LoadingStatus
        className="restaurant-empty"
        label={requiredLocalized(l10n, 'restaurant-menu-loading')}
      />
    );
  }
  if (error) {
    // A failed fetch that ends with loading=false is a fetch error, not an
    // empty catalog: show the backend message with a retry, announced.
    return (
      <div className="restaurant-empty" role="status">
        <span className="restaurant-empty-text">{error}</span>
        <button
          type="button"
          className="restaurant-empty-retry"
          onClick={onRetry}
        >
          <Localized id="restaurant-menu-retry">
            <span>Retry</span>
          </Localized>
        </button>
      </div>
    );
  }
  if (items.length === 0) {
    // Empty catalog vs no search matches are different states with different
    // recoveries: clearing the filter only helps the latter. Announced, so a
    // filter change that empties the grid is heard, not just seen.
    return (
      <div className="restaurant-empty" role="status">
        <span className="restaurant-empty-text">
          <Localized id={hasActiveFilter ? 'restaurant-menu-no-match' : 'restaurant-menu-empty'}>
            <span>No items available</span>
          </Localized>
        </span>
        {hasActiveFilter && (
          <button
            type="button"
            className="restaurant-empty-retry"
            onClick={onClearFilter}
          >
            <Localized id="restaurant-menu-clear-search">
              <span>Clear search</span>
            </Localized>
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="restaurant-grid" role="list" aria-label={requiredLocalized(l10n, 'restaurant-menu-items-aria')}>
      {items.map((product, i) => (
        <MenuItemTile
          key={product.sku}
          product={{ ...product, inStock: product.inStock && !unavailable.has(product.sku) }}
          sourceInStock={product.inStock}
          pinned={pinned.has(product.sku)}
          color={colors[product.sku] ?? catMetaMap.get(product.category)?.colour}
          onAdd={onAdd}
          onContextMenu={onContextMenu}
          added={product.sku === addedSku}
          index={i}
        />
      ))}
    </div>
  );
}
