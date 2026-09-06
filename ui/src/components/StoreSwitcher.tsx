import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocalization } from '@fluent/react';
import { listLocationsScoped, setPrimaryLocationScoped, type LocationProfile } from '@/api/locations';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import './StoreSwitcher.css';

/**
 * Dropdown to switch between available stores.
 * Loads the store list from the backend on mount and updates the
 * primary store selection. Hidden when only one store exists.
 */
export default function StoreSwitcher() {
  const { l10n } = useLocalization();
  const { switchStore, sessionToken } = useWorkspace();
  const [stores, setStores] = useState<LocationProfile[]>([]);
  const [primary, setPrimary] = useState<LocationProfile | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await listLocationsScoped(sessionToken!);
      setStores(data);
      const p = data.find((s) => s.is_primary) ?? data[0] ?? null;
      setPrimary(p);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
    // sessionToken is a free variable here (from useWorkspace() at :14), so it must be a
    // dependency. With [] this callback never changed identity, which also meant the
    // `useEffect(() => { load(); }, [load])` below ran exactly once at mount: after
    // switchStore() replaced the token, the list still belonged to the previous store.
  }, [sessionToken]);

  useEffect(() => { load(); }, [load]);

  const handleSelect = useCallback(async (store: LocationProfile) => {
    if (store.id === primary?.id) {
      setOpen(false);
      return;
    }
    try {
      await setPrimaryLocationScoped(sessionToken!, store.id);
      setPrimary(store);
      setStores((prev) =>
        prev.map((s) => ({ ...s, is_primary: s.id === store.id })),
      );
      // ADR #4 Phase 2b: trigger workspace re-resolution for the new store.
      // switchStore is stable (memoized with roleId/userId deps upstream),
      // so adding it to this useCallback's deps does not invalidate the callback
      // on every render.
      switchStore(store.id);
    } catch {
      // silently fail
    }
    setOpen(false);
    // sessionToken is read at :44. It was previously masked by `primary` happening to be a
    // dep -- setPrimary() changes primary on every selection, so the callback was rebuilt
    // anyway. That is coincidence, not correctness: a token change that does not move
    // `primary` (an expiry refresh, a re-login into the same store) would leave this calling
    // setPrimaryLocationScoped with the dead token.
  }, [primary, switchStore, sessionToken]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ── A11Y-05: full listbox keyboard navigation ─────────────────
  // Mirrors the LOC-04 pattern established in LocationPicker: ArrowUp/Down
  // move the active descendant (wrapping), Home/End jump to the first/last
  // option, Enter/Space select the active option, Escape closes and restores
  // focus to the trigger. Focus moves to the listbox while open so
  // `aria-activedescendant` is announced by screen readers.

  useEffect(() => {
    if (!open) return;
    listboxRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open || activeIndex < 0 || !listboxRef.current) return;
    const optionEl = listboxRef.current.querySelector(`[data-index="${activeIndex}"]`);
    // jsdom lacks scrollIntoView — guard the call so tests don't crash.
    optionEl?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeIndex]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape must always work, even with an empty option list.
      if (e.key === 'Escape') {
        setOpen(false);
        setActiveIndex(-1);
        ref.current?.querySelector<HTMLButtonElement>('.store-switcher-trigger')?.focus();
        return;
      }
      if (stores.length === 0) return;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setActiveIndex((i) => (i + 1) % stores.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIndex((i) => (i <= 0 ? stores.length - 1 : i - 1));
          break;
        case 'Home':
          e.preventDefault();
          setActiveIndex(0);
          break;
        case 'End':
          e.preventDefault();
          setActiveIndex(stores.length - 1);
          break;
        case 'Enter':
        case ' ': {
          e.preventDefault();
          if (activeIndex >= 0 && stores[activeIndex]) {
            handleSelect(stores[activeIndex]);
          }
          break;
        }
        default:
          break;
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, stores, activeIndex, handleSelect]);

  if (loading || stores.length <= 1) return null;

  const currentName = primary?.name ?? l10n.getString('store-switcher-select');

  return (
    <div className="store-switcher" ref={ref}>
      <button
        type="button"
        className="store-switcher-trigger"
        onClick={() => {
          const next = !open;
          if (next) {
            const currentIdx = stores.findIndex((s) => s.id === primary?.id);
            setActiveIndex(currentIdx >= 0 ? currentIdx : 0);
          } else {
            setActiveIndex(-1);
          }
          setOpen(next);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="store-switcher-listbox"
        aria-label={l10n.getString('store-switcher-current-aria', { name: currentName })}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
        <span className="store-switcher-name">{currentName}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`store-switcher-chevron ${open ? 'store-switcher-chevron--open' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <ul
          id="store-switcher-listbox"
          ref={listboxRef}
          className="store-switcher-dropdown"
          role="listbox"
          tabIndex={-1}
          aria-label={l10n.getString('store-switcher-list-aria')}
          aria-activedescendant={
            activeIndex >= 0 && stores[activeIndex]
              ? `store-switcher-option-${stores[activeIndex].id}`
              : undefined
          }
        >
          {stores.map((store, idx) => (
            <li key={store.id} role="none">
              <button
                type="button"
                role="option"
                id={`store-switcher-option-${store.id}`}
                data-index={idx}
                aria-selected={store.id === primary?.id}
                className={`store-switcher-option ${store.id === primary?.id ? 'store-switcher-option--active' : ''} ${activeIndex === idx ? 'store-switcher-option--highlighted' : ''}`}
                onClick={() => handleSelect(store)}
              >
                <span className="store-switcher-option-name">{store.name}</span>
                <span className="store-switcher-option-meta">
                  {store.currency}
                  {store.is_primary ? l10n.getString('store-switcher-primary') : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
