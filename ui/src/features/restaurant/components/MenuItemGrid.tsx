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

import { requiredLocalized, LoadingStatus } from '@/frontend/shared';
import { Localized } from '@/components/Localized';
import { useLocalization } from '@fluent/react';
import type { Product } from '@/types/domain';
import { MenuItemTile } from './MenuItemTile';

export interface MenuItemGridProps {
  loading: boolean;
  items: Product[];
  pinned: Set<string>;
  unavailable: Set<string>;
  colors: Record<string, string>;
  catMetaMap: Map<string, { colour: string; icon: string }>;
  addedSku: string | null;
  onAdd: (product: Product) => void;
  onContextMenu: (sku: string, e: React.MouseEvent, trigger: HTMLElement, fromKeyboard: boolean, sourceInStock: boolean) => void;
}

export function MenuItemGrid({ loading, items, pinned, unavailable, colors, catMetaMap, addedSku, onAdd, onContextMenu }: MenuItemGridProps) {
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
  if (items.length === 0) {
    return (
      <div className="restaurant-empty">
        <span className="restaurant-empty-text">
          <Localized id="restaurant-menu-empty">
            <span>No items available</span>
          </Localized>
        </span>
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
