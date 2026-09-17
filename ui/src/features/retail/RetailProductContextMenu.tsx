import { useEffect, useRef } from 'react';
import { requiredLocalized } from '@/components';
import { useLocalization } from '@fluent/react';
import type { ProductDto } from '@/api/products';

export interface ContextMenuState {
  /** Product the menu was opened for. */
  product: ProductDto;
  /** Viewport-anchored position of the menu. */
  x: number;
  y: number;
}

interface RetailProductContextMenuProps {
  /** Current menu state, or null when closed. */
  menu: ContextMenuState | null;
  /** Called when the menu should close (outside click, Escape, scroll). */
  onClose: () => void;
  /** Open the product's images in the default browser (ADR #38 D2). */
  onViewImages: (product: ProductDto) => void;
}

/**
 * Positioned right-click context menu for retail grid rows (ADR #38 D1).
 *
 * - `role="menu"` with a single `role="menuitem"` (extensible shell).
 * - Closes on outside click, Escape, scroll, and resize.
 * - Focus returns to the trigger row's first button on close.
 */
export default function RetailProductContextMenu({
  menu,
  onClose,
  onViewImages,
}: RetailProductContextMenuProps) {
  const { l10n } = useLocalization();
  const menuRef = useRef<HTMLDivElement>(null);

  // Outside click + Escape + scroll + resize close handling (D1).
  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [menu, onClose]);

  // Move the menu back inside the viewport when opened near an edge.
  const style: React.CSSProperties = menu
    ? {
        position: 'fixed',
        left: Math.max(0, Math.min(menu.x, window.innerWidth - 220)),
        top: Math.max(0, Math.min(menu.y, window.innerHeight - 120)),
        zIndex: 1000,
      }
    : {};

  // Focus the first item on open so keyboard users can act immediately.
  useEffect(() => {
    if (menu) {
      const item = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
      item?.focus();
    }
  }, [menu]);

  if (!menu) return null;

  return (
    <div
      ref={menuRef}
      className="retail-row-context-menu"
      role="menu"
      aria-label={requiredLocalized(l10n, 'retail-row-menu-aria')}
      style={style}
      tabIndex={-1}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        className="retail-row-menu-item"
        onClick={() => {
          onViewImages(menu.product);
          onClose();
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        {requiredLocalized(l10n, 'retail-row-menu-view-images')}
      </button>
    </div>
  );
}
