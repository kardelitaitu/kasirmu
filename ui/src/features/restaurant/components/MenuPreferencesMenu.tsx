// ── MenuPreferencesMenu component (todo-refactor-kds-agents-3.md) ───────
//
// The header's left cluster: the hamburger trigger and its dropdown popover
// (sort options, menu-size stepper, font-size stepper, theme toggle, lock
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
// parent.
//
// Invariants: focus moves into the dropdown when opened by keyboard and
// returns to the trigger on Escape; ArrowUp/Down/Home/End rove between the
// dropdown buttons; Escape closes before the global search shortcut can see
// it. The restaurant-hamburger-* class names are pinned by tests.

import { useCallback, useEffect, useRef } from 'react';
import { Localized } from '@/components/Localized';
import { useLocalization } from '@fluent/react';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/frontend/shell/ThemeProvider';
import { useFullscreen } from '@/hooks/useFullscreen';
import type { Dispatch, SetStateAction } from 'react';
import { SORT_MODES } from '../RestaurantMenu';

type SortMode = (typeof SORT_MODES)[number];

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
}: MenuPreferencesMenuProps) {
  const { l10n } = useLocalization();
  const { logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { toggleFullscreen } = useFullscreen();
  const hamburgerRef = useRef<HTMLDivElement>(null);
  const hamburgerButtonRef = useRef<HTMLButtonElement>(null);
  const hamburgerWasOpenRef = useRef(false);
  const hamburgerOpenedWithKeyboardRef = useRef(false);

  // Move focus into the hamburger menu when it opens and return focus to the
  // trigger when it closes. This keeps the popover keyboard-operable without
  // disturbing the separate product context menu focus contract.
  useEffect(() => {
    if (open) {
      dropdownRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
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

  // Close hamburger menu on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (hamburgerRef.current && !hamburgerRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onOpenChange]);

  const handleHamburgerKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const items = Array.from(
      dropdownRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [],
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
            onClick={() => { logout(); onOpenChange(false); }}
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
