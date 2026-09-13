//! Card frame: the shell, header, drag wiring, and the portaled options
//! menu for one analytics card. Extracted from `AnalyticsScreen.tsx`
//! (agents-4 slice 3) as a CHILDREN-slot component: everything here is
//! chrome plus intent callbacks — the card's DATA rendering stays with
//! the screen (heatmap's eleven query variables and the content
//! dispatcher need no props through this seam), and the layout state
//! itself is deliberately not moved: the screen's keydown/palette
//! effects drive it directly, so a context/reducer migration would be a
//! behaviour redesign smuggled into a refactor. The menu's keyboard-
//! navigation loop is genuinely owned here (self-contained DOM logic);
//! the portal still renders into document.body, anchored by the
//! viewport coordinates the screen computes from the trigger.

import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Localized, useLocalization } from '@fluent/react';

export interface AnalyticsCardFrameProps {
  /** Stable per-workspace card id (class suffix + aria wiring). */
  cid: string;
  size?: string | undefined;
  titleKey: string;
  title: string;
  /** Per-card description key — the info button's aria/title (NOT the title). */
  descKey: string;
  expanded: boolean;
  collapsed: boolean;
  dragging: boolean;
  dropTarget: boolean;
  menuOpen: boolean;
  first: boolean;
  last: boolean;
  /** Viewport anchor for the portaled menu (screen-computed from the trigger). */
  menuAnchor: { bottom: number; right: number } | null;
  menuRef: RefObject<HTMLDivElement>;
  /** Body scale + ref for the expanded-card smart scaling (screen-owned effect). */
  expandScale: number;
  expandedBodyRef: RefObject<HTMLDivElement>;
  /** Rendered first in the actions cluster (heatmap's CSV export). */
  exportSlot?: ReactNode;
  onDragStart: () => void;
  onDragEnd: () => void;
  /** Drag-leave clears only the drop-target marker (dragId survives). */
  onDragLeave: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onOpenMenu: (trigger: HTMLButtonElement) => void;
  onCloseMenu: () => void;
  /** Header expand: also clears compact mode (mutually exclusive). */
  onToggleExpand: () => void;
  /** Menu expand item: verbatim asymmetry preserved from the source. */
  onMenuToggleExpand: () => void;
  onMenuMove: (dir: 'up' | 'down' | 'top' | 'bottom') => void;
  onMenuCollapse: () => void;
  children: ReactNode;
}

export function AnalyticsCardFrame({
  cid,
  size,
  titleKey,
  title,
  descKey,
  expanded,
  collapsed,
  dragging,
  dropTarget,
  menuOpen,
  first,
  last,
  menuAnchor,
  menuRef,
  expandScale,
  expandedBodyRef,
  exportSlot,
  onDragStart,
  onDragEnd,
  onDragLeave,
  onDragOver,
  onDrop,
  onOpenMenu,
  onCloseMenu,
  onToggleExpand,
  onMenuToggleExpand,
  onMenuMove,
  onMenuCollapse,
  children,
}: AnalyticsCardFrameProps) {
  const { l10n } = useLocalization();
  const expandLabel = l10n.getString(expanded ? 'analytics-card-restore-aria' : 'analytics-card-expand-aria');
  return (
    <div
      role="group"
      aria-labelledby={`analytics-card-title-${cid}`}
      onDragOver={(e) => { e.preventDefault(); onDragOver(); }}
      onDragLeave={onDragLeave}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
      className={`analytics-card${size ? ` analytics-card--${size}` : ''}${expanded ? ' analytics-card--expanded' : ''}${collapsed ? ' analytics-card--collapsed' : ''}${dragging ? ' analytics-card--dragging' : ''}${dropTarget ? ' analytics-card--drop-target' : ''}`}
    >
      {/* Drag starts from the header only (the grip marks it), so the
          card body no longer reads as draggable/clickable; the drop
          target stays the whole card. Keyboard reorder lives in the
          card menu (Move up/down/top/bottom), so the aria-hidden grip
          keeps a keyboard-equivalent path (notes.md drag affordances). */}
      <div
        className="analytics-card-header"
        draggable={!expanded}
        onDragStart={(e) => {
          onDragStart();
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            // Firefox refuses to begin a drag without setData.
            e.dataTransfer.setData('text/plain', cid);
          }
        }}
        onDragEnd={onDragEnd}
      >
        <span className="analytics-card-grip" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
            <circle cx="9" cy="5" r="1.4" /><circle cx="15" cy="5" r="1.4" />
            <circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" />
            <circle cx="9" cy="19" r="1.4" /><circle cx="15" cy="19" r="1.4" />
          </svg>
        </span>
        <Localized id={titleKey}>
          <h2 className="analytics-card-title" id={`analytics-card-title-${cid}`}>{title}</h2>
        </Localized>
        <div className="analytics-card-actions">
          {exportSlot}
          <button
            type="button"
            className="analytics-card-action analytics-card-info"
            onClick={(e) => e.stopPropagation()}
            aria-label={l10n.getString(descKey)}
            title={l10n.getString(descKey)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </button>
          <button
            type="button"
            className="analytics-card-action"
            onClick={onToggleExpand}
            aria-label={expandLabel}
            title={expandLabel}
          >
            {expanded ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="14" y1="10" x2="21" y2="3" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className={`analytics-card-action${menuOpen ? ' analytics-card-action--active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              if (menuOpen) {
                onCloseMenu();
              } else {
                // Anchor the (portaled) menu to the trigger so it
                // escapes the card's overflow clipping, and remember
                // the trigger so focus can be restored on close.
                onOpenMenu(e.currentTarget);
              }
            }}
            aria-label={l10n.getString('analytics-card-menu-aria')}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title={l10n.getString('analytics-card-menu-aria')}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" aria-hidden="true">
              <circle cx="5" cy="12" r="1.6" />
              <circle cx="12" cy="12" r="1.6" />
              <circle cx="19" cy="12" r="1.6" />
            </svg>
          </button>
          {menuOpen && createPortal(
            <div
              ref={menuRef}
              className="analytics-card-menu"
              role="menu"
              tabIndex={-1}
              aria-label={l10n.getString('analytics-card-menu-aria')}
              style={{
                position: 'fixed',
                top: (menuAnchor?.bottom ?? 0) + 4,
                right: menuAnchor?.right ?? 0,
              }}
              onKeyDown={(e) => {
                const items = Array.from(
                  e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])'),
                );
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  onCloseMenu();
                  return;
                }
                if (items.length === 0) return;
                const idx = items.indexOf(document.activeElement as HTMLButtonElement);
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  items[(idx + 1) % items.length]?.focus();
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  items[(idx - 1 + items.length) % items.length]?.focus();
                } else if (e.key === 'Home') {
                  e.preventDefault();
                  items[0]?.focus();
                } else if (e.key === 'End') {
                  e.preventDefault();
                  items[items.length - 1]?.focus();
                }
              }}
            >
              <button type="button" role="menuitem" disabled={first}
                onClick={() => onMenuMove('up')}>
                {l10n.getString('analytics-menu-move-up')}
              </button>
              <button type="button" role="menuitem" disabled={last}
                onClick={() => onMenuMove('down')}>
                {l10n.getString('analytics-menu-move-down')}
              </button>
              <button type="button" role="menuitem" disabled={first}
                onClick={() => onMenuMove('top')}>
                {l10n.getString('analytics-menu-move-top')}
              </button>
              <button type="button" role="menuitem" disabled={last}
                onClick={() => onMenuMove('bottom')}>
                {l10n.getString('analytics-menu-move-bottom')}
              </button>
              <div className="analytics-card-menu-sep" role="separator" />
              <button type="button" role="menuitem"
                onClick={onMenuToggleExpand}>
                {expandLabel}
              </button>
              <button type="button" role="menuitem"
                onClick={onMenuCollapse}>
                {l10n.getString(collapsed ? 'analytics-menu-show-card' : 'analytics-menu-collapse-card')}
              </button>
            </div>,
            document.body,
          )}
        </div>
      </div>
      <div className="analytics-card-body" ref={expanded ? expandedBodyRef : undefined}>
        <div
          className="analytics-card-content"
          style={expanded ? { transform: `scale(${expandScale})` } : undefined}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
