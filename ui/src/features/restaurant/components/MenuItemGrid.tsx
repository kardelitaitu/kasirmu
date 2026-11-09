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

import { memo } from 'react';
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

// MEMOISED, and the parent had to be changed for it to mean anything.
//
// This component was a plain function, so a `RestaurantMenu` render re-rendered ALL of it —
// and `RestaurantMenu` re-renders on every keystroke in the search box. Its two handler
// props were inline arrows (`onRetry`, `onClearFilter`), which are a new function every
// render, so adding `memo` alone would have changed nothing: the props would have compared
// unequal every time. Both halves were needed, and either alone is inert — which is why the
// tile-level memo below them (MenuItemTile) could not help on its own either.
//
// The props still passed as fresh values ARE load-bearing: `pinned`/`unavailable`/`colors`
// are state objects the parent recreates on a toggle, and `addedSku` changes on every add
// and again 400ms later when it clears. Those are real changes to what this grid draws, so
// they SHOULD re-render it. The point of the memo is that a search keystroke, an unrelated
// preference change, or a context-menu open no longer does.
export const MenuItemGrid = memo(function MenuItemGrid({ loading, error, onRetry, items, hasActiveFilter, onClearFilter, pinned, unavailable, colors, catMetaMap, addedSku, onAdd, onContextMenu }: MenuItemGridProps) {
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
          data-testid="restaurant-menu-retry-btn"
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
            <span>{hasActiveFilter ? 'No items available' : 'Menu is empty'}</span>
          </Localized>
        </span>
        {hasActiveFilter && (
          <button
            type="button"
            className="restaurant-empty-retry"
            data-testid="restaurant-menu-clear-filter-btn"
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
        // The grid is a role="list", so each tile must be wrapped in a list
        // item. It cannot go ON the tile: that root is a <button>, and axe
        // rejects role="listitem" there (aria-allowed-role). Without the
        // display: contents on the wrapper preserves the CSS grid layout so
        // cards stretch to their full column cell as intended.
        <div key={product.sku} role="listitem" className="restaurant-grid-item">
        <MenuItemTile
          product={{ ...product, inStock: product.inStock && !unavailable.has(product.sku) }}
          sourceInStock={product.inStock}
          pinned={pinned.has(product.sku)}
          color={colors[product.sku] ?? catMetaMap.get(product.category)?.colour}
          onAdd={onAdd}
          onContextMenu={onContextMenu}
          added={product.sku === addedSku}
          index={i}
        />
        </div>
      ))}
    </div>
  );
});
