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

// ── Category icon SVGs ─────────────────────────────────────────────
function CategoryIconFood() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
      <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
      <line x1="7" y1="11" x2="7" y2="22" />
      <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3z" />
      <line x1="21" y1="15" x2="21" y2="22" />
    </svg>
  );
}

function CategoryIconSnack() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
      <path d="M4 12h16" />
      <path d="M4 12c0 5.5 3.6 9 8 9s8-3.5 8-9" />
      <circle cx="9" cy="9" r="2" fill="currentColor" stroke="none" />
      <circle cx="13" cy="8" r="2" fill="currentColor" stroke="none" />
      <circle cx="17" cy="9" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CategoryIconHotDrink() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
      <path d="M6 8h12l-1.5 12h-9L6 8z" />
      <path d="M17 11h2a2 2 0 0 1 0 4h-2" />
      <path d="M8 8C8.8 6.5 7.2 5.5 8 4" />
      <path d="M13 8C13.8 6.5 12.2 5.5 13 4" />
    </svg>
  );
}

function CategoryIconColdDrink() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
      <path d="M5 7h14l-2 15H7L5 7z" />
      <line x1="3" y1="7" x2="21" y2="7" />
      <line x1="16" y1="2" x2="12" y2="22" />
    </svg>
  );
}

function CategoryIconDots1() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12" aria-hidden="true">
      <circle cx="8" cy="8" r="3" />
    </svg>
  );
}
function CategoryIconDots2() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12" aria-hidden="true">
      <circle cx="5" cy="8" r="2.5" />
      <circle cx="11" cy="8" r="2.5" />
    </svg>
  );
}
function CategoryIconDots3() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12" aria-hidden="true">
      <circle cx="3" cy="8" r="2" />
      <circle cx="8" cy="8" r="2" />
      <circle cx="13" cy="8" r="2" />
    </svg>
  );
}

function CategoryIcon({ icon }: { icon: string }) {
  if (icon === 'food')       return <CategoryIconFood />;
  if (icon === 'snack')      return <CategoryIconSnack />;
  if (icon === 'hot-drink')  return <CategoryIconHotDrink />;
  if (icon === 'cold-drink') return <CategoryIconColdDrink />;
  if (icon === 'dots-1')     return <CategoryIconDots1 />;
  if (icon === 'dots-2')     return <CategoryIconDots2 />;
  if (icon === 'dots-3')     return <CategoryIconDots3 />;
  return null;
}

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
                  <CategoryIcon icon={meta.icon} />
                </span>
              )}
              {cat}
            </button>
          );
        })}      </div>
  );
}
