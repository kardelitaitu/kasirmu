// ── MenuPreferencesMenu component ──────────────────────────────────────────
//
// The header's preferences cluster: the 3-line hamburger trigger and its
// floating dropdown popover (sort options, menu-size stepper, font-size
// stepper, theme toggle, toggle fullscreen).
//
// Invariants:
// - Focus moves into the dropdown when opened by keyboard and returns to the
//   trigger on Escape.
// - ArrowUp/Down/Home/End rove between the dropdown buttons (excluding steppers).
// - Escape closes the popover before global search shortcuts can handle it.
// - Every selection closes the popover.
// - Class names restaurant-hamburger-* are pinned by tests and stylesheets.

import { useCallback, useEffect, useRef } from 'react';
import { Localized } from '@/components/Localized';
import { useLocalization } from '@fluent/react';
import { useTheme } from '@/app/ThemeProvider';
import { useFullscreen } from '@/hooks/useFullscreen';
import type { Dispatch, SetStateAction } from 'react';
import { SORT_MODES } from '../RestaurantMenu';
export type { RestaurantSidebarActions } from './RestaurantSidebar';

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
  const { theme, toggleTheme } = useTheme();
  const { toggleFullscreen } = useFullscreen();
  const hamburgerWrapperRef = useRef<HTMLDivElement>(null);
  const hamburgerButtonRef = useRef<HTMLButtonElement>(null);
  const hamburgerWasOpenRef = useRef(false);
  const hamburgerOpenedWithKeyboardRef = useRef(false);

  // Move focus into the hamburger menu when it opens and return focus to the
  // trigger when it closes.
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
  }, [open, dropdownRef]);

  // Close the hamburger menu on Escape before the global search shortcut can
  // clear or blur the search field.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      hamburgerOpenedWithKeyboardRef.current = true;
      onOpenChange(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onOpenChange]);

  // Close the hamburger menu on click outside, EXCEPT on the trigger
  // itself or inside the dropdown panel.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (hamburgerButtonRef.current?.contains(e.target as Node)) return;
      if (dropdownRef.current?.contains(e.target as Node)) return;
      onOpenChange(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onOpenChange, dropdownRef]);

  const handleHamburgerKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const items = Array.from(
      dropdownRef.current?.querySelectorAll<HTMLButtonElement>(
        'button.restaurant-hamburger-item--sort, button.restaurant-hamburger-item:not(.restaurant-size-btn)',
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
    <div className="restaurant-hamburger-wrapper" ref={hamburgerWrapperRef}>
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
          <line x1="4" y1="6" x2="20" y2="6" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="18" x2="20" y2="18" />
        </svg>
      </button>

      {open && (
        <aside
          ref={dropdownRef}
          id="restaurant-hamburger-menu"
          className="restaurant-hamburger-dropdown"
          role="region"
          tabIndex={-1}
          aria-label={l10n.getString('restaurant-menu-hamburger-aria')}
        >
          <div className="restaurant-hamburger-section">
            <span className="restaurant-hamburger-label">
              <Localized id="restaurant-sort-label"><span>Sort</span></Localized>
            </span>
            <div className="restaurant-hamburger-sort-group" aria-label={l10n.getString('restaurant-sort-label')}>
              {SORT_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={sortMode === mode}
                  className={`restaurant-hamburger-item restaurant-hamburger-item--sort${sortMode === mode ? ' restaurant-hamburger-item--active' : ''}`}
                  onKeyDown={handleHamburgerKeyDown}
                  onClick={() => {
                    onSelectSort(mode);
                  }}
                >
                  <span className="restaurant-sort-check" aria-hidden="true">
                    {sortMode === mode ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : null}
                  </span>
                  <Localized id={`restaurant-sort-${mode}`}>
                    <span className="restaurant-sort-text">{mode === 'manual' ? 'Manual' : mode === 'a-z' ? 'A–Z' : mode === 'date' ? 'By Date' : 'Popularity'}</span>
                  </Localized>
                </button>
              ))}
            </div>
          </div>

          <div className="restaurant-hamburger-divider" role="separator" />

          <div className="restaurant-hamburger-section">
            <div className="restaurant-hamburger-item restaurant-hamburger-size" role="group" aria-label={l10n.getString('restaurant-size-label')}>
              <div className="restaurant-size-label-group">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" className="restaurant-pref-icon" aria-hidden="true">
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                </svg>
                <span className="restaurant-hamburger-size-label"><Localized id="restaurant-size-label"><span>Menu Size</span></Localized></span>
              </div>
              <div className="restaurant-hamburger-size-controls">
                <button
                  type="button"
                  className="restaurant-size-btn"
                  onKeyDown={handleHamburgerKeyDown}
                  disabled={cardSize <= 0}
                  onClick={() => onCardSizeStep(-1)}
                  aria-label={l10n.getString('restaurant-size-decrease-aria')}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width="12" height="12" aria-hidden="true">
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
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
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width="12" height="12" aria-hidden="true">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="restaurant-hamburger-item restaurant-hamburger-size" role="group" aria-label={l10n.getString('restaurant-font-size-label')}>
              <div className="restaurant-size-label-group">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" className="restaurant-pref-icon" aria-hidden="true">
                  <polyline points="4 7 4 4 20 4 20 7" />
                  <line x1="9" y1="20" x2="15" y2="20" />
                  <line x1="12" y1="4" x2="12" y2="20" />
                </svg>
                <Localized id="restaurant-font-size-label">
                  <span className="restaurant-hamburger-size-label">Font Size</span>
                </Localized>
              </div>
              <div className="restaurant-hamburger-size-controls">
                <button
                  type="button"
                  className="restaurant-size-btn"
                  onKeyDown={handleHamburgerKeyDown}
                  disabled={fontSize <= 0}
                  onClick={() => onFontSizeStep(-1)}
                  aria-label={l10n.getString('restaurant-font-size-decrease-aria')}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width="12" height="12" aria-hidden="true">
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
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
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width="12" height="12" aria-hidden="true">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <div className="restaurant-hamburger-divider" role="separator" />

          <div className="restaurant-hamburger-section">
            <button
              type="button"
              className="restaurant-hamburger-item"
              onKeyDown={handleHamburgerKeyDown}
              aria-label={l10n.getString(theme === 'dark' ? 'restaurant-theme-light' : 'restaurant-theme-dark')}
              onClick={() => { toggleTheme(); onOpenChange(false); }}
            >
              {theme === 'dark' ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" className="restaurant-pref-icon" aria-hidden="true">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" className="restaurant-pref-icon" aria-hidden="true">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
              <Localized id={theme === 'dark' ? 'restaurant-theme-light' : 'restaurant-theme-dark'}>
                <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
              </Localized>
            </button>
            <button
              type="button"
              className="restaurant-hamburger-item"
              onKeyDown={handleHamburgerKeyDown}
              aria-label={l10n.getString('restaurant-toggle-fullscreen')}
              onClick={() => { toggleFullscreen(); onOpenChange(false); }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" className="restaurant-pref-icon" aria-hidden="true">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
              </svg>
              <Localized id="restaurant-toggle-fullscreen"><span>Toggle Fullscreen</span></Localized>
            </button>
          </div>
        </aside>
      )}
    </div>
  );
}
