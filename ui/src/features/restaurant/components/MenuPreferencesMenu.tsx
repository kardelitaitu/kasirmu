// ── MenuPreferencesMenu component (todo-refactor-kds-agents-3.md) ───────
//
// The header's left cluster: the hamburger trigger and its dropdown popover
// (sort options, menu-size stepper, font-size stepper, the cart header's
// terminal actions when the caller hands them in, theme toggle, lock
// terminal, fullscreen). The parent keeps the open/closed flag because the
// global search shortcuts must not steal focus while the popover is up, and
// it owns the persisted preference callbacks; this component owns the
// popover's keyboard-operability contract.
//
// Props: open + onOpenChange — controlled popover state; dropdownRef — the
// popover element, kept by the parent because the global app-search shortcut
// tests whether focus is inside it; sortMode + onSelectSort — current sort
// and the pick handler (parent persists it); cardSize/onCardSizeStep and
// fontSize/onFontSizeStep — stepper value and clamping handler owned by the
// parent; cartActions — the relocated cart-header buttons (shift open/close,
// deduction override, tables, history, KDS), optional so a bare
// <RestaurantMenu /> renders no action group at all.
//
// Invariants: focus moves into the dropdown when opened by keyboard and
// returns to the trigger on Escape; ArrowUp/Down/Home/End rove between the
// dropdown buttons; Escape closes before the global search shortcut can see
// it; every action row closes the popover as it hands off. The
// restaurant-hamburger-* class names are pinned by tests.

import { useCallback, useEffect, useRef } from 'react';
import { Localized } from '@/components/Localized';
import { useLocalization } from '@fluent/react';
import { useTheme } from '@/frontend/shell/ThemeProvider';
import { useFullscreen } from '@/hooks/useFullscreen';
import type { Dispatch, SetStateAction } from 'react';
import { SORT_MODES } from '../RestaurantMenu';

type SortMode = (typeof SORT_MODES)[number];

/**
 * The buttons that used to sit in the restaurant cart header
 * (`CartPanel.tsx` `.pos-cart-header`), handed down by PosScreen so the
 * popover is their only home in that workspace. Every field is a plain
 * callback or a fact — the popover owns no state and knows nothing about
 * modals, routes or the shift API.
 */
export interface RestaurantSidebarActions {
  /** Shift lookup in flight: no shift row at all, same as the old header. */
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
}

export interface MenuPreferencesMenuProps {
  open: boolean;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
  dropdownRef: React.RefObject<HTMLDivElement>;
  sortMode: SortMode;
  onSelectSort: (mode: SortMode) => void;
  cardSize: number;
  onCardSizeStep: (delta: number) => void;
  fontSize: number;
  onFontSizeStep: (delta: number) => void;
  /** Absent = no action group (retail, KDS, and every bare <RestaurantMenu />). */
  cartActions?: RestaurantSidebarActions;
}

export function MenuPreferencesMenu({
  open,
  onOpenChange,
  dropdownRef,
  sortMode,
  onSelectSort,
  cardSize,
  onCardSizeStep,
  fontSize,
  onFontSizeStep,
  cartActions,
}: MenuPreferencesMenuProps) {
  const { l10n } = useLocalization();
  const { theme, toggleTheme } = useTheme();
  const { toggleFullscreen } = useFullscreen();
  const hamburgerRef = useRef<HTMLDivElement>(null);
  const hamburgerButtonRef = useRef<HTMLButtonElement>(null);
  const hamburgerWasOpenRef = useRef(false);
  const hamburgerOpenedWithKeyboardRef = useRef(false);

  // Move focus into the hamburger menu when it opens and return focus to the
  // trigger when it closes. Focus lands on the first SORT row, not the Close
  // row: the sort list is the panel's primary content and the existing
  // keyboard tests pin focus there ('Manual' on open, A–Z on ArrowDown).
  // The Close row stays reachable by Tab/Shift+Tab like every other row.
  useEffect(() => {
    if (open) {
      const buttons = dropdownRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [];
      const firstSort = Array.from(buttons).find((b) =>
        b.classList.contains('restaurant-hamburger-item--sort'),
      );
      (firstSort ?? buttons[0])?.focus();
    } else if (hamburgerWasOpenRef.current && hamburgerOpenedWithKeyboardRef.current) {
      hamburgerButtonRef.current?.focus();
    }
    hamburgerWasOpenRef.current = open;
  }, [open, onOpenChange, dropdownRef]);

  // Close the hamburger menu on Escape before the global search shortcut can
  // clear or blur the search field.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      hamburgerOpenedWithKeyboardRef.current = true;
      onOpenChange(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onOpenChange]);

  // Close the hamburger menu on click outside, EXCEPT on the trigger
  // itself: the trigger toggles via its own onClick, and a mousedown-driven
  // close here would consume the toggle's open on the same press (the button
  // is outside `hamburgerRef`'s panel subtree by construction). The panel
  // subtree (including the Close row) still dismisses normally.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (hamburgerButtonRef.current?.contains(e.target as Node)) return;
      if (hamburgerRef.current && !hamburgerRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onOpenChange]);

  const handleHamburgerKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    // Arrow/Home/End rove across every row in panel order, EXCEPT the Close
    // row: the auto-focus lands on the first sort row, and the existing
    // keyboard tests pin Home to that same row ('Manual'), so roving must
    // treat the sort rows as the ring. The size steppers are excluded for the
    // same reason — they are a separate widget with their own Tab stops, and
    // wrapping into them stranded arrow users inside a −/+ pair. Close and
    // the steppers stay reachable by Tab/Shift+Tab like every other row.
    const items = Array.from(
      dropdownRef.current?.querySelectorAll<HTMLButtonElement>(
        'button.restaurant-hamburger-item--sort, button.restaurant-hamburger-item:not(.restaurant-hamburger-item--close):not(.restaurant-size-btn)',
      ) ?? [],
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
  }, [dropdownRef]);

  return (
    <div className="restaurant-header-left" ref={hamburgerRef}>
      <button
        type="button"
        className={`restaurant-hamburger-btn${open ? ' restaurant-hamburger-btn--active' : ''}`}
        ref={hamburgerButtonRef}
        onPointerDown={() => {
          hamburgerOpenedWithKeyboardRef.current = false;
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            hamburgerOpenedWithKeyboardRef.current = true;
          }
        }}
        onClick={() => onOpenChange((prev) => !prev)}
        aria-label={l10n.getString('restaurant-menu-hamburger-aria')}
        aria-expanded={open}
        aria-controls="restaurant-hamburger-menu"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20" style={{ pointerEvents: 'none' }}>
          <rect width="18" height="18" x="3" y="3" rx="4" />
          <line x1="9" y1="3" x2="9" y2="21" />
        </svg>
      </button>

      {open && (
        <aside
          ref={dropdownRef}
          id="restaurant-hamburger-menu"
          className="restaurant-hamburger-dropdown restaurant-sidebar"
          role="region"
          tabIndex={-1}
          aria-label={l10n.getString('restaurant-menu-hamburger-aria')}
        >
          <button
            type="button"
            className="restaurant-hamburger-item restaurant-hamburger-item--close"
            onClick={() => onOpenChange(false)}
            aria-label={l10n.getString('restaurant-menu-close-aria', undefined, 'Close menu')}
          >
            <Localized id="restaurant-menu-close"><span>Close</span></Localized>
          </button>
          <div className="restaurant-hamburger-divider" role="separator" />
          <span className="restaurant-hamburger-label"><Localized id="restaurant-sort-label"><span>Sort</span></Localized></span>
          {SORT_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              className="restaurant-hamburger-item restaurant-hamburger-item--sort"
              onKeyDown={handleHamburgerKeyDown}
              onClick={() => {
                onSelectSort(mode);
              }}
            >
              {sortMode === mode && <span className="restaurant-sort-check">✓</span>}
              <Localized id={`restaurant-sort-${mode}`}>
                <span>{mode === 'manual' ? 'Manual' : mode === 'a-z' ? 'A–Z' : mode === 'date' ? 'By Date' : 'Popularity'}</span>
              </Localized>
            </button>
          ))}
          <div className="restaurant-hamburger-divider" role="separator" />
          <div className="restaurant-hamburger-item restaurant-hamburger-size" role="group" aria-label={l10n.getString('restaurant-size-label')}>
            <span className="restaurant-hamburger-size-label"><Localized id="restaurant-size-label"><span>Menu Size</span></Localized></span>
            <div className="restaurant-hamburger-size-controls">
              <button
                type="button"
                className="restaurant-size-btn"
                onKeyDown={handleHamburgerKeyDown}
                disabled={cardSize <= 0}
                onClick={() => onCardSizeStep(-1)}
                aria-label={l10n.getString('restaurant-size-decrease-aria')}
              >
                &minus;
              </button>
              <span className="restaurant-size-value">{cardSize}</span>
              <button
                type="button"
                className="restaurant-size-btn"
                onKeyDown={handleHamburgerKeyDown}
                disabled={cardSize >= 4}
                onClick={() => onCardSizeStep(1)}
                aria-label={l10n.getString('restaurant-size-increase-aria')}
              >
                +
              </button>
            </div>
          </div>
          <div className="restaurant-hamburger-divider" role="separator" />
          <div className="restaurant-hamburger-item restaurant-hamburger-size" role="group" aria-label={l10n.getString('restaurant-font-size-label')}>
            <Localized id="restaurant-font-size-label">
              <span className="restaurant-hamburger-size-label">Font Size</span>
            </Localized>
            <div className="restaurant-hamburger-size-controls">
              <button
                type="button"
                className="restaurant-size-btn"
                onKeyDown={handleHamburgerKeyDown}
                disabled={fontSize <= 0}
                onClick={() => onFontSizeStep(-1)}
                aria-label={l10n.getString('restaurant-font-size-decrease-aria')}
              >
                &minus;
              </button>
              <span className="restaurant-size-value">{fontSize}</span>
              <button
                type="button"
                className="restaurant-size-btn"
                onKeyDown={handleHamburgerKeyDown}
                disabled={fontSize >= 4}
                onClick={() => onFontSizeStep(1)}
                aria-label={l10n.getString('restaurant-font-size-increase-aria')}
              >
                +
              </button>
            </div>
          </div>
          <div className="restaurant-hamburger-divider" role="separator" />
          {cartActions && (
            <>
              {/* The cart header's buttons, relocated: the restaurant cart is
                  an order list, not a toolbar, and this popover is the only
                  place in the workspace with room for the terminal chrome. Each
                  row reuses the FTL key the header control already used, so the
                  names an AT user hears did not change with the markup. */}
              {cartActions.deductionLocationName && (
                <button
                  type="button"
                  className="restaurant-hamburger-item"
                  onKeyDown={handleHamburgerKeyDown}
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
                    <span className="restaurant-hamburger-override" data-testid="deduction-override-indicator">
                      {' '}(Override)
                    </span>
                  )}
                </button>
              )}
              {!cartActions.shiftLoading && (cartActions.hasActiveShift ? (
                <button
                  type="button"
                  className="restaurant-hamburger-item"
                  onKeyDown={handleHamburgerKeyDown}
                  aria-label={l10n.getString('pos-shift-close-aria')}
                  onClick={() => { cartActions.onCloseShift(); onOpenChange(false); }}
                >
                  <Localized id="pos-shift-close-aria"><span>Close current shift</span></Localized>
                </button>
              ) : (
                <button
                  type="button"
                  className="restaurant-hamburger-item"
                  onKeyDown={handleHamburgerKeyDown}
                  aria-label={l10n.getString('pos-shift-open-aria')}
                  onClick={() => { cartActions.onOpenShift(); onOpenChange(false); }}
                >
                  <Localized id="pos-shift-open-aria"><span>Open a new shift</span></Localized>
                </button>
              ))}
              {cartActions.showTables && (
                <button
                  type="button"
                  className="restaurant-hamburger-item"
                  onKeyDown={handleHamburgerKeyDown}
                  aria-label={l10n.getString('tables-title')}
                  onClick={() => { cartActions.onOpenTables(); onOpenChange(false); }}
                >
                  <Localized id="tables-title"><span>Table Management</span></Localized>
                </button>
              )}
              <button
                type="button"
                className="restaurant-hamburger-item"
                onKeyDown={handleHamburgerKeyDown}
                aria-label={l10n.getString('retail-fn-history')}
                onClick={() => { cartActions.onOpenHistory(); onOpenChange(false); }}
              >
                <Localized id="retail-fn-history"><span>History</span></Localized>
              </button>
              <button
                type="button"
                className="restaurant-hamburger-item"
                onKeyDown={handleHamburgerKeyDown}
                aria-label={l10n.getString('kds-title')}
                onClick={() => { cartActions.onOpenKitchenDisplay(); onOpenChange(false); }}
              >
                <Localized id="kds-title"><span>Kitchen Display</span></Localized>
              </button>
              <div className="restaurant-hamburger-divider" role="separator" />
            </>
          )}
          <button
            type="button"
            className="restaurant-hamburger-item"
            onKeyDown={handleHamburgerKeyDown}
            aria-label={l10n.getString(theme === 'dark' ? 'restaurant-theme-light' : 'restaurant-theme-dark')}
            onClick={() => { toggleTheme(); onOpenChange(false); }}
          >
            <Localized id={theme === 'dark' ? 'restaurant-theme-light' : 'restaurant-theme-dark'}>
              <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
            </Localized>
          </button>
          <button
            type="button"
            className="restaurant-hamburger-item"
            onKeyDown={handleHamburgerKeyDown}
            aria-label={l10n.getString('restaurant-lock-terminal')}
            onClick={() => {
              // Lock, not logout. `app:lock` is the shell's session-lock
              // contract (the same event DevToolbar fires); AppShell and
              // TabletAppShell answer it by swapping in SessionLockScreen while
              // the auth session and the in-flight cart stay in place. logout()
              // here would drop the session and send the next person through a
              // full staff login.
              window.dispatchEvent(new CustomEvent('app:lock'));
              onOpenChange(false);
            }}
          >
            <Localized id="restaurant-lock-terminal"><span>Lock Terminal</span></Localized>
          </button>
          <button
            type="button"
            className="restaurant-hamburger-item"
            onKeyDown={handleHamburgerKeyDown}
            aria-label={l10n.getString('restaurant-toggle-fullscreen')}
            onClick={() => { toggleFullscreen(); onOpenChange(false); }}
          >
            <Localized id="restaurant-toggle-fullscreen"><span>Toggle Fullscreen</span></Localized>
          </button>
        </aside>
      )}
    </div>
  );
}
