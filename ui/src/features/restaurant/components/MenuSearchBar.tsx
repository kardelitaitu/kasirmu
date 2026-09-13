// ── MenuSearchBar component (todo-refactor-kds-agents-3.md) ────────────
//
// The header search field — magnifier icon, query input, conditional clear
// button — plus the two global shortcuts that target it: the app-search
// event (Ctrl+F) focuses the input, and typing anywhere focuses it and
// injects the character (Escape clears + blurs). Both shortcuts must stand
// down while an overlay owns keyboard interaction, so the open flags for the
// hamburger popover and the product context menu come in as props; the
// query state stays in the parent because the filtered grid is derived
// from it.
//
// Props: value/onChange — controlled query; menuOpen + contextMenuOpenRef —
// overlay gates for the global handlers; popoverRef — the hamburger dropdown
// element (owned by the parent, shared with MenuPreferencesMenu) so the
// app-search gate can test whether focus is still inside the popover.
//
// Invariants: the autofill-suppression attributes (autocomplete/autocorrect/
// spellcheck/data-*-ignore), the explicit text-selection style, and the
// restaurant-search-input class are pinned by RestaurantMenu.test.tsx; the
// type-to-search injection goes through the native value setter so React's
// onChange still fires.

import { useEffect, useRef } from 'react';
import { useLocalization } from '@fluent/react';

export interface MenuSearchBarProps {
  value: string;
  onChange: (query: string) => void;
  menuOpen: boolean;
  contextMenuOpenRef: React.MutableRefObject<boolean>;
  popoverRef: React.RefObject<HTMLDivElement>;
}

export function MenuSearchBar({ value, onChange, menuOpen, contextMenuOpenRef, popoverRef }: MenuSearchBarProps) {
  const { l10n } = useLocalization();
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Listen for global Ctrl+F → focus search input, except while an overlay
  // owns keyboard interaction.
  useEffect(() => {
    const handler = () => {
      if (menuOpen || contextMenuOpenRef.current || popoverRef.current?.contains(document.activeElement)) return;
      searchInputRef.current?.focus();
    };
    window.addEventListener('app-search', handler);
    return () => window.removeEventListener('app-search', handler);
  }, [menuOpen, contextMenuOpenRef, popoverRef]);

  // Type anywhere → focus search + insert char, Escape → clear + blur
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (menuOpen || contextMenuOpenRef.current) return;
        onChange('');
        searchInputRef.current?.blur();
        return;
      }
      if (menuOpen || contextMenuOpenRef.current) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;

      e.preventDefault();
      const input = searchInputRef.current;
      if (!input) return;
      input.focus();
      const selStart = input.selectionStart ?? input.value.length;
      const selEnd = input.selectionEnd ?? selStart;
      const newVal = input.value.slice(0, selStart) + e.key + input.value.slice(selEnd);
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )?.set;
      nativeSetter?.call(input, newVal);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [menuOpen, contextMenuOpenRef, onChange]);

  return (
    <div className="restaurant-search">
      <svg className="restaurant-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        type="search"
        className="restaurant-search-input"
        id="restaurant-menu-search"
        name="restaurant-menu-search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        data-1p-ignore="true"
        data-lpignore="true"
        data-bwignore="true"
        ref={searchInputRef}
        placeholder={l10n.getString('restaurant-menu-search-placeholder')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={l10n.getString('restaurant-search-aria')}
        style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
      />
      {value && (
        <button
          type="button"
          className="restaurant-search-clear"
          onClick={() => onChange('')}
          aria-label={l10n.getString('restaurant-search-clear-aria')}
        >
          &times;
        </button>
      )}
    </div>
  );
}
