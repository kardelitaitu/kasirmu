import { useRef, useState } from 'react';
import { t, type Labels } from '../../i18n/labels';
import { type Region } from '../../lib/region';

/** Region options for the billing-region selector. */
export const REGION_OPTIONS: { value: Region; labelKey: string }[] = [
  { value: 'global', labelKey: 'signup.regionGlobal' },
  { value: 'id', labelKey: 'signup.regionIndonesia' },
];

interface Props {
  /** Strings this section reads; AccountView passes its own map. */
  labels: Labels;
  region: Region;
  onRegionChange: (region: Region) => void;
}

/**
 * Billing-region selector — a custom listbox with full keyboard support
 * (Arrow keys move focus, Escape closes, Enter/Space select) and a blur
 * guard that keeps the listbox open while the user navigates its options.
 * Owns only its open/confirm-feedback state; the chosen region is lifted to
 * the parent (it drives payment routing).
 */
export default function AccountRegion({ labels, region, onRegionChange }: Props) {
  const [regionOpen, setRegionOpen] = useState(false);
  const [regionMsg, setRegionMsg] = useState(false);
  const timerRef = useRef<number | null>(null);
  // P3: scope all listbox queries to this component instead of the global
  // document, so a second region selector (or any other aria-haspopup
  // element elsewhere on the page) never hijacks focus restoration or the
  // first-option lookup.
  const rootRef = useRef<HTMLElement>(null);

  const scopedQuery = <T extends Element>(selector: string): T | null =>
    rootRef.current ? rootRef.current.querySelector<T>(selector) : null;

  const scopedQueryAll = <T extends Element>(selector: string): T[] =>
    rootRef.current ? Array.from(rootRef.current.querySelectorAll<T>(selector)) : [];

  const closeSoon = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setRegionOpen(false), 150);
  };

  return (
    <section ref={rootRef} className="rounded-xl border border-ink/10 bg-surface/40 p-6 shadow-sm" aria-label={t(labels, 'account.region')}>
      <h2 className="text-lg font-semibold">{t(labels, 'account.region')}</h2>
      <p className="mt-1 text-sm text-muted">{t(labels, 'account.regionHint')}</p>
      <div className="relative mt-3">
        <button
          type="button"
          onClick={() => setRegionOpen(!regionOpen)}
          onBlur={(e) => {
            // Only close when focus leaves the whole listbox. When the
            // user keyboard-navigates to an option, focus moves to a
            // button inside the listbox — that blur must NOT close it,
            // otherwise a keyboard user loses the dropdown mid-arrow.
            if (e.relatedTarget instanceof HTMLElement && e.relatedTarget.closest('[role="listbox"]')) {
              return;
            }
            closeSoon();
          }}
          onKeyDown={(e) => {
            // ArrowDown/ArrowUp open the listbox and move focus to the first option;
            // Escape closes it.
            if (!regionOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
              e.preventDefault();
              setRegionOpen(true);
              window.setTimeout(() => {
                scopedQuery<HTMLButtonElement>('[data-region-option]')?.focus();
              }, 0);
            } else if (regionOpen && e.key === 'Escape') {
              setRegionOpen(false);
              e.currentTarget.focus();
            }
          }}
          aria-haspopup="listbox"
          aria-expanded={regionOpen}
          className="w-full rounded-md border border-ink/10 bg-surface px-3 py-2 text-sm text-left transition flex items-center justify-between"
        >
          <span>{t(labels, region === 'id' ? 'signup.regionIndonesia' : 'signup.regionGlobal')}</span>
          <svg
            className={`w-4 h-4 text-muted transition-transform duration-200 ${regionOpen ? 'rotate-180' : ''}`}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="4 6 8 10 12 6" />
          </svg>
        </button>
        {regionOpen && (
          <div
            className="absolute z-50 mt-1 w-full rounded-md border border-ink/10 bg-surface shadow-lg overflow-hidden"
            role="listbox"
            aria-label={t(labels, 'account.region')}
          >
            {REGION_OPTIONS.map((opt) => {
              const selected = region === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-region-option
                  onClick={() => {
                    onRegionChange(opt.value);
                    setRegionOpen(false);
                    // Selecting closes the listbox, which unmounts this option —
                    // the element that had focus — so focus fell to <body> and a
                    // keyboard user lost their place in the section (measured in
                    // a browser 2026-09-23 at 390px and 1440px, en and id).
                    // Focus goes to the trigger, the surviving control here, which
                    // is where Escape already sends it.
                    scopedQuery<HTMLButtonElement>('[aria-haspopup="listbox"]')?.focus();
                    setRegionMsg(true);
                    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
                    timerRef.current = window.setTimeout(() => setRegionMsg(false), 3000);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                      e.preventDefault();
                      const options = scopedQueryAll<HTMLButtonElement>('[data-region-option]');
                      const idx = options.indexOf(e.currentTarget);
                      const next = e.key === 'ArrowDown' ? options[idx + 1] : options[idx - 1];
                      next?.focus();
                    } else if (e.key === 'Escape') {
                      setRegionOpen(false);
                      scopedQuery<HTMLButtonElement>('[aria-haspopup="listbox"]')?.focus();
                    } else if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.currentTarget.click();
                    }
                  }}
                  className={`w-full px-3 py-2 text-sm text-left flex items-center gap-2 transition-colors duration-150 ${
                    selected ? 'text-link font-medium' : 'text-ink hover:bg-ink/5'
                  }`}
                >
                  <span>{t(labels, opt.labelKey)}</span>
                  {selected && (
                    <svg className="w-4 h-4 ml-auto text-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {regionMsg && (
        <p className="mt-2 text-sm text-success" role="status">{t(labels, 'account.regionSaved')}</p>
      )}
    </section>
  );
}
