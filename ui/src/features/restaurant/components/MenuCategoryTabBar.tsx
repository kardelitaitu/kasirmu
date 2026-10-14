// ── MenuCategoryTabBar component (todo-refactor-kds-agents-3.md) ────────
//
// Horizontal scrollable strip of category pills (the "tablist") above the
// product grid. Purely presentational: the parent owns the option list and
// the selection state, and derives categories from restaurant products so
// retail-only categories can never leak in here.
//
// Props: options — category names ("All" first); active — the effective
// selection; onSelect — fired with the pill name on tap; metaMap — optional
// per-category colour/icon supplied by useProducts' categoryMeta.
//
// Invariants: role="tablist" with role="tab" buttons + aria-selected, and
// the restaurant-category-pill* class names, are pinned by the bundle-parity
// gate and RestaurantMenu.test.tsx queries.

import { useCallback, useRef } from 'react';
import { useLocalization } from '@fluent/react';
import { CategoryIconSvg } from '@/features/categories/CategoryIconSvg';

// ── Component ──────────────────────────────────────────────────────

export interface MenuCategoryTabBarProps {
  options: string[];
  active: string;
  onSelect: (category: string) => void;
  metaMap: Map<string, { colour: string; icon: string }>;
}

export function MenuCategoryTabBar({ options, active, onSelect, metaMap }: MenuCategoryTabBarProps) {
  const { l10n } = useLocalization();
  const listRef = useRef<HTMLDivElement>(null);
  // ARIA tab pattern: arrows move between tabs (wrapping), Home/End jump to
  // the ends. Roving tabindex keeps one Tab stop for the whole strip; the
  // active tab holds it, falling back to the first tab. Activation stays on
  // click/Enter/Space (manual activation) — arrows only move focus, so a
  // keyboard user can survey categories without refiltering on every key.
  const handleTabKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    const tabs = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('button[role="tab"]') ?? [],
    );
    if (tabs.length === 0) return;
    const current = tabs.indexOf(e.currentTarget);
    const next = e.key === 'Home'
      ? 0
      : e.key === 'End'
        ? tabs.length - 1
        : e.key === 'ArrowRight'
          ? (current + 1 + tabs.length) % tabs.length
          : (current - 1 + tabs.length) % tabs.length;
    e.preventDefault();
    tabs[next]?.focus();
  }, []);
  return (
    <div ref={listRef} className="restaurant-categories" role="tablist" aria-label={l10n.getString('restaurant-categories-aria')}>
        {options.map((cat) => {
          const meta = metaMap.get(cat);
          const isActive = active === cat;
          return (
            <button
              key={cat}
              type="button"
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              className={
                isActive
                  ? 'restaurant-category-pill restaurant-category-pill--active'
                  : 'restaurant-category-pill'
              }
              style={meta && isActive
                ? { '--pill-color': meta.colour } as React.CSSProperties
                : undefined}
              onClick={() => onSelect(cat)}
              onKeyDown={handleTabKeyDown}
            >
              {meta?.icon && (
                <span className="restaurant-pill-icon">
                  <CategoryIconSvg icon={meta.icon} size={14} />
                </span>
              )}
              {cat}
            </button>
          );
        })}      </div>
  );
}
