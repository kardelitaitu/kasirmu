//! Command palette overlay — the Ctrl/Cmd+K surface. Extracted verbatim
//! from `AnalyticsScreen.tsx` (JSX-shell order agents-4, slice 2). All
//! state and key handling already live in `useCommandPalette`; this file
//! is pure presentation over the hook's values plus the caller's
//! filtered list and run action. Generic in the item shape because the
//! screen owns that union; the palette only needs `label` + `hint`.

import type { RefObject } from 'react';
import { useLocalization } from '@fluent/react';

export interface PaletteItemShape {
  kind: string;
  value: string;
  label: string;
  hint: string;
}

export interface CommandPaletteProps<T extends PaletteItemShape> {
  open: boolean;
  query: string;
  activeIndex: number;
  filteredItems: T[];
  inputRef: RefObject<HTMLInputElement>;
  onQueryChange: (value: string) => void;
  onIndexChange: (index: number) => void;
  /** Close that also clears the query (the backdrop's contract). */
  onClose: () => void;
  onRunItem: (item: T) => void;
}

export function CommandPalette<T extends PaletteItemShape>({
  open,
  query,
  activeIndex,
  filteredItems,
  inputRef,
  onQueryChange,
  onIndexChange,
  onClose,
  onRunItem,
}: CommandPaletteProps<T>) {
  const { l10n } = useLocalization();
  if (!open) return null;
  return (
    <div
      className="analytics-palette-backdrop"
      role="presentation"
      tabIndex={-1}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="analytics-palette"
        role="dialog"
        aria-label={l10n.getString('analytics-palette-aria')}
      >
        <input
          ref={inputRef}
          type="text"
          className="analytics-palette-input"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={l10n.getString('analytics-palette-placeholder')}
          aria-label={l10n.getString('analytics-palette-placeholder')}
        />
        <ul className="analytics-palette-list" role="listbox" aria-label={l10n.getString('analytics-palette-aria')}>
          {filteredItems.length === 0 ? (
            <li className="analytics-palette-empty">{l10n.getString('analytics-palette-empty')}</li>
          ) : (
            filteredItems.map((item, i) => (
              <li key={`${item.kind}-${item.value}`}>
                <button
                  type="button"
                  className={`analytics-palette-item${i === activeIndex ? ' analytics-palette-item--active' : ''}`}
                  onMouseEnter={() => onIndexChange(i)}
                  onClick={() => onRunItem(item)}
                >
                  <span>{item.label}</span>
                  {item.hint && <kbd className="analytics-palette-hint">{item.hint}</kbd>}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
