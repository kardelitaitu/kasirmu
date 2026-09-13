// ── MenuItemContextMenu component (todo-refactor-kds-agents-3.md) ───────
//
// Right-click / long-press / Shift+F10 menu over a product card: pin to top,
// mark unavailable (source-in-stock items only), and colourise the add
// badge. The parent owns whether the menu is open and where (the trigger
// bookkeeping and the focus contract live there); this component owns the
// overlay itself — viewport clamping, focus-on-keyboard-open, ArrowUp/Down
// roving focus, and click-outside / Escape dismissal (delegated to onClose).
//
// Props: menu — the open-menu descriptor (exported as RestaurantContextMenu-
// State, the shape the parent stores in state); setPinned/setUnavailable/
// setColors — the parent's per-user override dispatchers; onClose — closes
// the menu and restores focus when it was keyboard-opened.
//
// Invariants: Escape must stopImmediatePropagation so the global type-to-
// search Escape handler cannot clear the query while this menu is open;
// the restaurant-context-* class names and role="menu"/menuitem semantics
// are pinned by RestaurantMenu.test.tsx.

import { useCallback, useEffect, useRef } from 'react';
import { Localized } from '@/components/Localized';
import { useLocalization } from '@fluent/react';
import type { Dispatch, SetStateAction } from 'react';

export interface RestaurantContextMenuState {
  sku: string;
  x: number;
  y: number;
  isPinned: boolean;
  isUnavailable: boolean;
  sourceInStock: boolean;
  currentColor: string | undefined;
  fromKeyboard: boolean;
}

const COLOR_PALETTE = [
  '#10b981',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#d946ef',
  '#ec4899',
];

export interface MenuItemContextMenuProps {
  menu: RestaurantContextMenuState;
  setPinned: Dispatch<SetStateAction<Set<string>>>;
  setUnavailable: Dispatch<SetStateAction<Set<string>>>;
  setColors: Dispatch<SetStateAction<Record<string, string>>>;
  onClose: () => void;
}

export function MenuItemContextMenu({ menu, setPinned, setUnavailable, setColors, onClose }: MenuItemContextMenuProps) {
  const { l10n } = useLocalization();
  const menuRef = useRef<HTMLDivElement>(null);

  // A11Y-06: keyboard-opened menus move focus to the first menuitem so the
  // menu is immediately operable without an extra Tab.
  useEffect(() => {
    if (!menu.fromKeyboard) return;
    menuRef.current?.querySelector<HTMLElement>('button[role="menuitem"]')?.focus();
  }, [menu]);

  // A11Y-06: ArrowUp / ArrowDown roving focus between menuitems (wraps).
  // When no menuitem currently has focus (idx === -1), ArrowDown lands on the
  // first item and ArrowUp wraps to the last — robust for any item count.
  const handleContextMenuKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>('button[role="menuitem"]'),
    );
    if (items.length === 0) return;
    const idx = items.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    if (e.key === 'ArrowDown') {
      items[idx === -1 ? 0 : (idx + 1) % items.length]?.focus();
    } else {
      items[idx === -1 ? items.length - 1 : (idx - 1 + items.length) % items.length]?.focus();
    }
  }, []);

  // Close context menu on click outside or Escape (Escape restores focus).
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [menu, onClose]);

  const togglePin = useCallback(() => {
    const sku = menu.sku;
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
    onClose();
  }, [menu.sku, setPinned, onClose]);

  const toggleUnavailable = useCallback(() => {
    const sku = menu.sku;
    setUnavailable((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
    onClose();
  }, [menu.sku, setUnavailable, onClose]);

  const setColor = useCallback((color: string) => {
    const sku = menu.sku;
    setColors((prev) => {
      if (color === prev[sku]) return prev;
      return { ...prev, [sku]: color };
    });
    onClose();
  }, [menu.sku, setColors, onClose]);

  const clearColor = useCallback(() => {
    const sku = menu.sku;
    setColors((prev) => {
      if (!(sku in prev)) return prev;
      const next = { ...prev };
      delete next[sku];
      return next;
    });
    onClose();
  }, [menu.sku, setColors, onClose]);

  const viewportWidth = typeof window !== 'undefined' && Number.isFinite(window.innerWidth) ? window.innerWidth : 1024;
  const viewportHeight = typeof window !== 'undefined' && Number.isFinite(window.innerHeight) ? window.innerHeight : 768;

  return (
    <div
      ref={menuRef}
      className="restaurant-context-menu"
      style={{
        left: Math.max(4, Math.min(menu.x, viewportWidth - 180)),
        top: Math.max(4, Math.min(menu.y, viewportHeight - 280)),
      }}
      role="menu"
      tabIndex={-1}
      onKeyDown={handleContextMenuKeyDown}
    >
      <button
        type="button"
        className="restaurant-context-item"
        aria-label={l10n.getString(menu.isPinned ? 'restaurant-context-unpin' : 'restaurant-context-pin')}
        onClick={togglePin}
        role="menuitem"
      >
        <Localized id={menu.isPinned ? 'restaurant-context-unpin' : 'restaurant-context-pin'}>
        <span>{menu.isPinned ? 'Unpin from top' : 'Pin to top'}</span>
      </Localized>
      </button>
      {menu.sourceInStock && (
        <button
          type="button"
          className="restaurant-context-item"
          aria-label={l10n.getString(menu.isUnavailable ? 'restaurant-context-available' : 'restaurant-context-unavailable')}
          onClick={toggleUnavailable}
          role="menuitem"
        >
          <Localized id={menu.isUnavailable ? 'restaurant-context-available' : 'restaurant-context-unavailable'}>
          <span>{menu.isUnavailable ? 'Mark available' : 'Mark unavailable'}</span>
        </Localized>
        </button>
      )}
      <div className="restaurant-context-divider" role="separator" />
      <span className="restaurant-context-label"><Localized id="restaurant-context-color-label"><span>Colorize Add</span></Localized></span>
      <div className="restaurant-context-colors" role="group" aria-label={l10n.getString('restaurant-context-color-label')}>
        {COLOR_PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            className={`restaurant-context-swatch${menu.currentColor === c ? ' restaurant-context-swatch--active' : ''}`}
            style={{ background: c }}
            onClick={() => setColor(c)}
            aria-label={l10n.getString('restaurant-color-swatch-aria', { color: c }, c)}
          />
        ))}
        {menu.currentColor && (
          <button
            type="button"
            className="restaurant-context-swatch restaurant-context-swatch--clear"
            onClick={clearColor}
            aria-label={l10n.getString('restaurant-clear-color-aria')}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
