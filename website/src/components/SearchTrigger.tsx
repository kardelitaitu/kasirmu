import React, { useState, useEffect } from 'react';
import SearchModal from './SearchModal';
import type { Labels } from '../i18n/labels';
import type { SearchDoc } from '../lib/search-index';

interface Props {
  locale: string;
  /** Strings for the modal this trigger opens; see `SEARCH_LABELS`. */
  labels: Labels;
  /** This locale's docs, from the content collection; forwarded to the modal. */
  docs: SearchDoc[];
}

export default function SearchTrigger({ locale, labels, docs }: Props) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label="Search"
        title={`${locale === 'id' ? 'Cari' : 'Search'} (⌘K)`}
        className="flex h-9 w-9 items-center justify-center rounded-md text-muted transition hover:text-ink"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </button>
      <SearchModal isOpen={isOpen} onClose={() => setIsOpen(false)} locale={locale} labels={labels} docs={docs} />
    </>
  );
}
