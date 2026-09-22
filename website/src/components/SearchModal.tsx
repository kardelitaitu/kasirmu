import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { t, type Labels } from '../i18n/labels';
import { buildSearchIndex, filterSearch, type SearchDoc, type SearchItem } from '../lib/search-index';

/**
 * Strings this modal reads — the docs header's island root hands it the map.
 * `Header.astro` builds it with `labelMap`, so the browser gets six strings in
 * the document rather than both locale dictionaries in the JS bundle.
 */
export const SEARCH_LABELS = [
  'search.docsTitle',
  'search.noResults',
  'search.pagesTitle',
  'search.placeholder',
  'search.quickSearch',
  'search.shortcutHint',
] as const;

interface Props {
  isOpen: boolean;
  onClose: () => void;
  locale: string;
  /** Strings this modal reads; see `SEARCH_LABELS`. */
  labels: Labels;
  /**
   * Every doc in this locale, from the content collection via `Header.astro`.
   * The searchable docs are never hardcoded here — see `src/lib/search-index.ts`.
   */
  docs: SearchDoc[];
}

export default function SearchModal({ isOpen, onClose, locale, labels, docs }: Props) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  // Whatever had focus before the dialog opened, so closing it can hand focus
  // back instead of dropping it on <body> (which restarts Tab at the top of the
  // page).
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const searchItems: SearchItem[] = useMemo(() => buildSearchIndex(locale, docs), [locale, docs]);

  const filteredItems = useMemo(() => filterSearch(searchItems, query), [query, searchItems]);

  useEffect(() => {
    if (isOpen) {
      previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    } else if (previouslyFocusedRef.current) {
      previouslyFocusedRef.current.focus?.();
      previouslyFocusedRef.current = null;
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) {
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
          e.preventDefault();
          // Can be toggled if global handler is bound
        }
        return;
      }

      if (e.key === 'Tab') {
        // Keep focus inside the dialog. `aria-modal="true"` tells assistive
        // tech the rest of the page is inert, so it must not be tabbable
        // either — without this, Tab walks out of the dialog into the page
        // behind the backdrop (measured: 10 tabs forward, 1 shift-tab back).
        const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables && focusables.length > 0) {
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          const active = document.activeElement;
          const inside = active ? dialogRef.current?.contains(active) === true : false;
          if (e.shiftKey && (active === first || !inside)) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && (active === last || !inside)) {
            e.preventDefault();
            first.focus();
          }
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < filteredItems.length - 1 ? prev + 1 : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filteredItems.length - 1));
      } else if (e.key === 'Enter' && filteredItems[selectedIndex]) {
        e.preventDefault();
        window.location.href = filteredItems[selectedIndex].url;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, filteredItems, selectedIndex]);

  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isOpen, onClose]);

  if (!isOpen || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 sm:pt-24"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div
        data-backdrop="true"
        onClick={onClose}
        className="fixed inset-0 bg-ink/40 backdrop-blur-sm transition-opacity"
        aria-hidden="true"
      />

      {/* Modal Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t(labels, 'search.placeholder')}
        className="relative z-10 w-full max-w-lg rounded-2xl border border-ink/15 bg-surface p-4 shadow-2xl transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Bar Input */}
        <div className="relative flex items-center border-b border-ink/10 pb-3 gap-3">
          <svg className="w-5 h-5 text-muted ml-1 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder={t(labels, 'search.placeholder')}
            className="flex-1 min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-muted pr-2"
            autoComplete="off"
            spellCheck="false"
          />
          <kbd className="hidden sm:inline-block shrink-0 rounded border border-ink/15 bg-ink/5 px-2 py-0.5 text-xs text-muted font-mono ml-2">
            ESC
          </kbd>
        </div>

        {/* Search Results List */}
        <div className="mt-3 max-h-80 overflow-y-auto space-y-1" role="listbox" aria-label={t(labels, 'search.quickSearch')}>
          {filteredItems.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted">
              {t(labels, 'search.noResults')} <span className="font-semibold text-ink">"{query}"</span>
            </div>
          ) : (
            <>
              <p className="sr-only">{t(labels, 'search.quickSearch')}</p>
              {filteredItems.map((item, idx) => (
                <React.Fragment key={item.id}>
                  {idx === 0 && (
                    <p className="px-2 pt-1 text-xs font-semibold uppercase tracking-wider text-muted">{t(labels, item.category === 'docs' ? 'search.docsTitle' : 'search.pagesTitle')}</p>
                  )}
                  {idx > 0 && filteredItems[idx - 1].category !== item.category && (
                    <p className="px-2 pt-1 text-xs font-semibold uppercase tracking-wider text-muted">
                      {t(labels, item.category === 'docs' ? 'search.docsTitle' : 'search.pagesTitle')}
                    </p>
                  )}
                  <a
                    role="option"
                    aria-selected={selectedIndex === idx}
                    href={item.url}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm transition ${
                      selectedIndex === idx
                        ? 'bg-accent/15 text-link'
                        : 'text-ink hover:bg-ink/5'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-muted">
                        {item.category === 'docs' ? (
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="12 2 2 7 12 12 22 7 12 2" />
                            <polyline points="2 17 12 22 22 17" />
                            <polyline points="2 12 12 17 22 12" />
                          </svg>
                        )}
                      </span>
                      <span className="font-medium">{item.title}</span>
                    </div>
                    <span className="text-xs uppercase tracking-wider text-muted font-mono">
                      {item.category}
                    </span>
                  </a>
                </React.Fragment>
              ))}
            </>
          )}
        </div>

        {/* Footer Shortcut Helper */}
        <div className="mt-3 border-t border-ink/10 pt-2 text-center text-xs text-muted">
          {t(labels, 'search.shortcutHint')}
        </div>
      </div>
    </div>,
    document.body
  );
}
