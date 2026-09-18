// ── RestaurantSidebar component ──────────────────────────────────────────
//
// The docked sidebar panel containing workspace and terminal operations
// (shift open/close, deduction override, table management, sales history,
// kitchen display, lock terminal, and exit terminal). Slides in from the left
// and docks to the layout, hiding the cart panel when open.
//
// Invariants:
// - Exit animation plays smoothly on close without unmount flashes.
// - Escape key closes the sidebar and returns focus to the trigger button.
// - ArrowUp/Down/Home/End rove across the action buttons.
// - Actions close the sidebar upon execution.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Localized } from '@/components/Localized';
import { useLocalization } from '@fluent/react';
import { animDuration } from '@/utils/animation';
import { useWorkspaceNav } from '@/hooks/useWorkspaceNav';

export interface RestaurantSidebarActions {
  /** Shift lookup in flight: no shift row at all. */
  shiftLoading: boolean;
  hasActiveShift: boolean;
  onOpenShift: () => void;
  onCloseShift: () => void;
  /** Locked deduction location; null = not deducting, so no row. */
  deductionLocationName: string | null;
  deductionOverridden: boolean;
  onOverrideDeduction: () => void;
  /** Table Management is feature-gated: render-and-hide is not an option. */
  showTables: boolean;
  onOpenTables: () => void;
  onOpenHistory: () => void;
  onOpenKitchenDisplay: () => void;
  /** Request exit from workspace; handled by host to check shifts. */
  onRequestExit?: () => void;
}

export interface RestaurantSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sidebarRef: React.RefObject<HTMLDivElement>;
  container?: HTMLElement | null | undefined;
  cartActions?: RestaurantSidebarActions | undefined;
  onRequestExit?: (() => void) | undefined;
  triggerRef?: React.RefObject<HTMLButtonElement> | undefined;
}

export function RestaurantSidebar({
  open,
  onOpenChange,
  sidebarRef,
  container,
  cartActions,
  onRequestExit,
  triggerRef,
}: RestaurantSidebarProps) {
  const { l10n } = useLocalization();
  const { goToWorkspacePicker } = useWorkspaceNav();
  const sidebarWasOpenRef = useRef(false);
  const sidebarOpenedWithKeyboardRef = useRef(false);

  // Animation state for sliding out when open flips to false
  const [prevOpen, setPrevOpen] = useState(open);
  const [exiting, setExiting] = useState(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasEverOpenRef = useRef(open);

  if (open) {
    wasEverOpenRef.current = true;
  }

  // Adjust state synchronously during render when open transitions true -> false
  // to avoid a 1-frame unmount gap where the sidebar disappears before exiting begins.
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (!open && wasEverOpenRef.current) {
      setExiting(true);
    } else if (open) {
      setExiting(false);
    }
  }

  useEffect(() => {
    if (!exiting) {
      if (exitTimerRef.current !== null) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
      return;
    }
    exitTimerRef.current = setTimeout(() => {
      setExiting(false);
      exitTimerRef.current = null;
    }, animDuration(300));
    return () => {
      if (exitTimerRef.current !== null) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
    };
  }, [exiting]);

  // Focus management: move focus into the sidebar on open, restore on close
  useEffect(() => {
    if (open) {
      const buttons = sidebarRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [];
      buttons[0]?.focus();
    } else if (sidebarWasOpenRef.current && sidebarOpenedWithKeyboardRef.current) {
      triggerRef?.current?.focus();
    }
    sidebarWasOpenRef.current = open;
  }, [open, sidebarRef, triggerRef]);

  // Close sidebar on Escape before global shortcuts can handle it
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      sidebarOpenedWithKeyboardRef.current = true;
      onOpenChange(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onOpenChange]);

  // Close sidebar on click outside, EXCEPT on trigger or inside the sidebar
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (triggerRef?.current?.contains(e.target as Node)) return;
      if (sidebarRef.current?.contains(e.target as Node)) return;
      onOpenChange(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onOpenChange, sidebarRef, triggerRef]);

  const handleSidebarKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const items = Array.from(
      sidebarRef.current?.querySelectorAll<HTMLButtonElement>('button.restaurant-sidebar-item') ?? [],
    );
    if (items.length === 0) return;
    const current = items.indexOf(e.currentTarget);
    const next = e.key === 'Home'
      ? 0
      : e.key === 'End'
        ? items.length - 1
        : e.key === 'ArrowDown'
          ? (current + 1 + items.length) % items.length
          : (current - 1 + items.length) % items.length;
    e.preventDefault();
    items[next]?.focus();
  }, [sidebarRef]);

  const asideContent = (
    <aside
      ref={sidebarRef}
      id="restaurant-sidebar-panel"
      className={`restaurant-sidebar${exiting ? ' restaurant-sidebar--exiting' : ''}`}
      role="region"
      tabIndex={-1}
      aria-label={l10n.getString('restaurant-sidebar-toggle-aria')}
    >
      {cartActions && (
        <>
          {cartActions.deductionLocationName && (
            <button
              type="button"
              className="restaurant-sidebar-item"
              onKeyDown={handleSidebarKeyDown}
              aria-label={l10n.getString('pos-cart-deduction-badge-aria', { name: cartActions.deductionLocationName })}
              onClick={() => { cartActions.onOverrideDeduction(); onOpenChange(false); }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="12" height="12" aria-hidden="true" style={{ pointerEvents: 'none' }}>
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <Localized id="pos-cart-deducting-label" vars={{ name: cartActions.deductionLocationName }}>
                <span>Deducting: {cartActions.deductionLocationName}</span>
              </Localized>
              {cartActions.deductionOverridden && (
                <span className="restaurant-sidebar-override" data-testid="deduction-override-indicator">
                  {' '}(Override)
                </span>
              )}
            </button>
          )}
          {!cartActions.shiftLoading && (cartActions.hasActiveShift ? (
            <button
              type="button"
              className="restaurant-sidebar-item"
              onKeyDown={handleSidebarKeyDown}
              aria-label={l10n.getString('pos-shift-close-aria')}
              onClick={() => { cartActions.onCloseShift(); onOpenChange(false); }}
            >
              <Localized id="pos-shift-close-aria"><span>Close current shift</span></Localized>
            </button>
          ) : (
            <button
              type="button"
              className="restaurant-sidebar-item"
              onKeyDown={handleSidebarKeyDown}
              aria-label={l10n.getString('pos-shift-open-aria')}
              onClick={() => { cartActions.onOpenShift(); onOpenChange(false); }}
            >
              <Localized id="pos-shift-open-aria"><span>Open a new shift</span></Localized>
            </button>
          ))}
          {cartActions.showTables && (
            <button
              type="button"
              className="restaurant-sidebar-item"
              onKeyDown={handleSidebarKeyDown}
              aria-label={l10n.getString('tables-title')}
              onClick={() => { cartActions.onOpenTables(); onOpenChange(false); }}
            >
              <Localized id="tables-title"><span>Table Management</span></Localized>
            </button>
          )}
          <button
            type="button"
            className="restaurant-sidebar-item"
            onKeyDown={handleSidebarKeyDown}
            aria-label={l10n.getString('retail-fn-history')}
            onClick={() => { cartActions.onOpenHistory(); onOpenChange(false); }}
          >
            <Localized id="retail-fn-history"><span>History</span></Localized>
          </button>
          <button
            type="button"
            className="restaurant-sidebar-item"
            onKeyDown={handleSidebarKeyDown}
            aria-label={l10n.getString('kds-title')}
            onClick={() => { cartActions.onOpenKitchenDisplay(); onOpenChange(false); }}
          >
            <Localized id="kds-title"><span>Kitchen Display</span></Localized>
          </button>
          <div className="restaurant-sidebar-divider" role="separator" />
        </>
      )}
      <button
        type="button"
        className="restaurant-sidebar-item"
        onKeyDown={handleSidebarKeyDown}
        aria-label={l10n.getString('restaurant-lock-terminal')}
        onClick={() => {
          window.dispatchEvent(new CustomEvent('app:lock'));
          onOpenChange(false);
        }}
      >
        <Localized id="restaurant-lock-terminal"><span>Lock Terminal</span></Localized>
      </button>
      <button
        type="button"
        className="restaurant-sidebar-item"
        onKeyDown={handleSidebarKeyDown}
        aria-label={l10n.getString('restaurant-exit-terminal')}
        onClick={() => {
          if (cartActions?.onRequestExit) {
            cartActions.onRequestExit();
          } else if (onRequestExit) {
            onRequestExit();
          } else {
            goToWorkspacePicker();
          }
          onOpenChange(false);
        }}
      >
        <Localized id="restaurant-exit-terminal"><span>Exit Terminal</span></Localized>
      </button>
    </aside>
  );

  if (!open && !exiting) return null;
  return container ? createPortal(asideContent, container) : asideContent;
}
