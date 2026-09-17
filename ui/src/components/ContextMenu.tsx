import { useLayoutEffect, useRef } from 'react';
import { useLocalization } from '@fluent/react';
import type { ContextMenuState } from './useContextMenu';
import { requiredLocalized } from './requiredLocalized';

interface ContextMenuProps {
  menu: ContextMenuState;
  menuRef: React.RefObject<HTMLDivElement | null>;
  onCopy: () => void;
  onPaste: () => void;
  onClose: () => void;
}

export function ContextMenu({ menu, menuRef, onCopy, onPaste }: ContextMenuProps) {
  const { l10n } = useLocalization();
  const positionedRef = useRef(false);

  useLayoutEffect(() => {
    if (positionedRef.current) return;
    const el = menuRef.current;
    if (!el) return;
    positionedRef.current = true;

    const rect = el.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 8;
    const maxY = window.innerHeight - rect.height - 8;
    if (rect.left > maxX) el.style.left = `${maxX}px`;
    if (rect.top > maxY) el.style.top = `${maxY}px`;
  }, [menu.x, menu.y, menuRef]);

  return (
    <div
      ref={menuRef as React.RefObject<HTMLDivElement>}
      className="ctx-menu"
      style={{ left: menu.x, top: menu.y }}
      role="menu"
      aria-label={requiredLocalized(l10n, 'ctx-menu-aria')}
    >
      <button type="button" className="ctx-menu-item" role="menuitem" onClick={onCopy}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
        {requiredLocalized(l10n, 'ctx-menu-copy')}
      </button>
      <button type="button" className="ctx-menu-item" role="menuitem" onClick={onPaste}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
        </svg>
        {requiredLocalized(l10n, 'ctx-menu-paste')}
      </button>
    </div>
  );
}
