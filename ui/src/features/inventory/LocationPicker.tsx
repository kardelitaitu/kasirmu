import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import { useLocalization } from '@fluent/react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { requiredLocalized } from '@/components';
import {
  listInventoryLocations,
  getWorkspaceLocations,
  type InventoryLocation,
} from '@/api/inventory';
import './LocationPicker.css';

// LOC-08: a location the picker can offer, optionally annotated with the
// binding policy of the current workspace (primary / negative-stock allowance).
type PickerLocation = InventoryLocation & {
  is_primary?: boolean;
  allow_negative_stock?: boolean;
};

// LOC-09: sets large enough to need an inline search field.
const SEARCH_THRESHOLD = 8;

// ── Location type label mapping (LOC-05) ───────────────────────────
// Every supported type maps to a value-bearing Fluent key; unknown future
// types fall back to `loc-type-unknown` so the dropdown never shows raw
// machine values (e.g. `warehouse`, `transit`) in any locale.
const LOCATION_TYPE_KEYS: Record<InventoryLocation['type'], string> = {
  store: 'loc-type-store',
  warehouse: 'loc-type-warehouse',
  transit: 'loc-type-transit',
  damaged: 'loc-type-damaged',
  virtual: 'loc-type-virtual',
};

function locationTypeLabel(l10n: ReturnType<typeof useLocalization>['l10n'], type: string): string {
  const key = LOCATION_TYPE_KEYS[type as InventoryLocation['type']] ?? 'loc-type-unknown';
  return requiredLocalized(l10n, key);
}

interface LocationPickerProps {
  /** Currently selected location ID. */
  value: string;
  /** Called when the user selects a location. */
  onChange: (locationId: string, locationName: string) => void;
  /** Label for the dropdown trigger (defaults to the localized 'Location'). */
  label?: string;
  /**
   * Bump to force a reload after location or binding changes elsewhere
   * (LOC-07 invalidation version). Consumers increment this when they
   * create/rename/deactivate a location or rebind a workspace.
   */
  refreshKey?: number;
}

/**
 * LocationPicker — dropdown for selecting an inventory location.
 *
 * Loads active inventory locations from the backend on mount and displays
 * them in a dropdown that follows the same pattern as StoreSwitcher.
 * Used in the inventory workspace header to filter views by location.
 */
const LocationPicker = memo(function LocationPicker({
  value,
  onChange,
  label,
  refreshKey,
}: LocationPickerProps) {
  const { sessionToken, activeInstance } = useWorkspace();
  // LOC-07: reload whenever the active workspace instance changes so a picker
  // left mounted across a workspace/store switch never serves stale locations.
  const instanceId = activeInstance?.instance_id;
  const typeKey = activeInstance?.type_key;
  const { l10n } = useLocalization();
  const l10nRef = useRef(l10n);
  l10nRef.current = l10n;
  const token = sessionToken ?? '';

  const [locations, setLocations] = useState<PickerLocation[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // LOC-07: request-generation guard — a slower earlier request (session
  // switch, refreshKey bump, or instance change) must never overwrite a
  // newer result, and no load may re-trigger an outdated effect teardown.
  const loadSeqRef = useRef(0);

  // ── Load locations ────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await listInventoryLocations(token);
      if (seq !== loadSeqRef.current) return;
      let scoped = data.filter((loc) => loc.is_active);

      // LOC-08: when a workspace instance is active, restrict the picker to
      // locations BOUND to that workspace (with their binding policy) so the
      // selection always matches the stock-operation scope. Falls back to the
      // full active list when the workspace declares no bindings — a fresh
      // workspace without bindings must still be able to pick a location.
      if (instanceId && typeKey) {
        try {
          const bindings = await getWorkspaceLocations(token, instanceId, typeKey);
          if (seq !== loadSeqRef.current) return;
          if (bindings.length > 0) {
            const bindingById = new Map(bindings.map((b) => [b.location_id, b]));
            scoped = scoped
              .filter((loc) => bindingById.has(loc.id))
              .map((loc) => {
                const b = bindingById.get(loc.id)!;
                return {
                  ...loc,
                  is_primary: b.is_primary,
                  allow_negative_stock: b.allow_negative_stock,
                };
              });
          }
        } catch {
          // Binding fetch failure is non-fatal: fall back to the full active
          // list rather than hiding the picker (same resilience as the main
          // load — the picker must never silently disappear).
        }
      }

      setLocations(scoped);
    } catch {
      if (seq !== loadSeqRef.current) return;
      // Durable error state (INV-08): surface a retry affordance instead
      // of silently rendering nothing when the locations fetch fails.
      setLoadError(requiredLocalized(l10nRef.current, 'loc-picker-error-load'));
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [token, instanceId, typeKey]); // l10n via ref — stable dep chain

  useEffect(() => {
    load();
    // LOC-07: reload when the workspace instance or an explicit invalidation
    // version changes, so a renamed/deactivated location or rebinding in
    // another screen is picked up without unmounting the picker. The load
    // sequence guard inside `load` (loadSeqRef) ensures a slower earlier
    // request can never overwrite the fresher result.
  }, [load, instanceId, refreshKey]);

  // ── Click outside to close ──────────────────────────────────────

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ── Selection ──────────────────────────────────────────────────

  const handleSelect = useCallback(
    (location: InventoryLocation) => {
      if (location.id !== value) {
        onChange(location.id, location.name);
      }
      setOpen(false);
    },
    [onChange, value],
  );

  // ── LOC-09: deterministic selected-first ordering ──────────────
  // The currently-selected location is always the first option so the
  // operator's active scope sits on top; the rest sort by name so the list is
  // stable across loads and workspace switches.
  const orderedLocations = useMemo(() => {
    const sorted = [...locations].sort((a, b) => a.name.localeCompare(b.name));
    const selectedIdx = sorted.findIndex((loc) => loc.id === value);
    if (selectedIdx <= 0) return sorted;
    // selectedIdx > 0 guarantees the element exists (noUncheckedIndexedAccess).
    const [selected] = sorted.splice(selectedIdx, 1);
    return [selected!, ...sorted];
  }, [locations, value]);

  // ── LOC-09: inline search over the ordered list ─────────────────
  // A search query narrows the options by name or localized type label; the
  // active descendant and keyboard navigation always operate on the filtered
  // (visible) list so the highlighted option matches what is rendered.
  const query = search.trim().toLowerCase();
  const visibleLocations = useMemo(() => {
    if (!query) return orderedLocations;
    return orderedLocations.filter(
      (loc) =>
        loc.name.toLowerCase().includes(query) ||
        locationTypeLabel(l10nRef.current, loc.type).toLowerCase().includes(query),
    );
  }, [orderedLocations, query]); // l10n via ref — stable dep chain

  // ── Keyboard: full listbox navigation (LOC-04) ──────────────
  // ArrowUp/Down move the active descendant (wrapping), Home/End jump to the
  // first/last option, Enter/Space select the active option, Escape closes and
  // restores focus to the trigger. Focus moves to the listbox while open so
  // `aria-activedescendant` is announced by screen readers.

  useEffect(() => {
    if (!open) return;
    // Large sets start in the search field (LOC-09); otherwise the listbox
    // itself takes focus so arrow navigation is announced immediately.
    if (locations.length >= SEARCH_THRESHOLD) {
      searchRef.current?.focus();
    } else {
      listboxRef.current?.focus();
    }
  }, [open, locations.length]);

  useEffect(() => {
    if (!open || activeIndex < 0 || !listboxRef.current) return;
    const optionEl = listboxRef.current.querySelector(`[data-index="${activeIndex}"]`);
    // jsdom lacks scrollIntoView — guard the call so tests (and old browsers)
    // don't crash on the navigation effect.
    optionEl?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeIndex]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const isSearchFocused = e.target === searchRef.current;
      // Space types in the search field (LOC-09) — never hijack it. Enter from
      // the search box still selects the highlighted option (combobox-style).
      if (e.key === ' ' && isSearchFocused) return;
      // Escape must work even in the no-results state (visibleLocations is
      // empty after a query matches nothing) so keyboard users can always
      // dismiss the dropdown.
      if (e.key === 'Escape') {
        setOpen(false);
        setActiveIndex(-1);
        ref.current?.querySelector<HTMLButtonElement>('.location-picker-trigger')?.focus();
        return;
      }
      if (visibleLocations.length === 0) return;
      // NOTE: Escape is handled above (before this guard) so it also works in
      // the no-results state — no duplicate case here.
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setActiveIndex((i) => (i + 1) % visibleLocations.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIndex((i) => (i <= 0 ? visibleLocations.length - 1 : i - 1));
          break;
        case 'Home':
          e.preventDefault();
          setActiveIndex(0);
          break;
        case 'End':
          e.preventDefault();
          setActiveIndex(visibleLocations.length - 1);
          break;
        case 'Enter':
        case ' ': {
          e.preventDefault();
          if (activeIndex >= 0 && visibleLocations[activeIndex]) {
            handleSelect(visibleLocations[activeIndex]);
          }
          break;
        }
        default:
          break;
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, visibleLocations, activeIndex, handleSelect]);

  // ── Find current location name ─────────────────────────────────

  const currentLocation = locations.find((loc) => loc.id === value);
  const fallbackLabel = label ?? requiredLocalized(l10n, 'loc-picker-label');
  const currentName = currentLocation?.name ?? fallbackLabel;

  // ── Render ─────────────────────────────────────────────────────

  if (loading) return null;

  if (loadError) {
    return (
      <div className="location-picker location-picker-error" role="alert">
        <span className="location-picker-error-text">{loadError}</span>
        <button
          type="button"
          className="location-picker-retry"
          onClick={load}
          aria-label={requiredLocalized(l10n, 'retry')}
        >
          {requiredLocalized(l10n, 'retry')}
        </button>
      </div>
    );
  }

  if (locations.length === 0) return null;

  return (
    <div className="location-picker" ref={ref}>
      <button
        type="button"
        className="location-picker-trigger"
        onClick={() => {
          const next = !open;
          if (next) {
            setSearch('');
            const currentIdx = orderedLocations.findIndex((loc) => loc.id === value);
            setActiveIndex(currentIdx >= 0 ? currentIdx : 0);
          } else {
            setActiveIndex(-1);
          }
          setOpen(next);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="location-picker-listbox"
        aria-label={requiredLocalized(l10n, 'loc-picker-trigger-aria', { name: currentName })}
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
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
        <span className="location-picker-name">{currentName}</span>
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
          className={`location-picker-chevron ${open ? 'location-picker-chevron--open' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="location-picker-dropdown">
          {locations.length >= SEARCH_THRESHOLD && (
            <div className="location-picker-search-wrap">
              <input
                ref={searchRef}
                type="search"
                className="location-picker-search"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                data-1p-ignore="true"
                data-lpignore="true"
                data-bwignore="true"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  // LOC-09: keep the highlight valid when the query narrows
                  // the list — an out-of-range activeIndex would leave
                  // aria-activedescendant undefined and Enter a no-op.
                  setActiveIndex(0);
                }}
                placeholder={requiredLocalized(l10n, 'loc-picker-search-placeholder')}
                aria-label={requiredLocalized(l10n, 'loc-picker-search-aria')}
              />
            </div>
          )}
          <ul
            id="location-picker-listbox"
            ref={listboxRef}
            className="location-picker-listbox"
            role="listbox"
            tabIndex={-1}
            aria-label={requiredLocalized(l10n, 'loc-picker-listbox-aria')}
            aria-activedescendant={
              activeIndex >= 0 && visibleLocations[activeIndex]
                ? `location-picker-option-${visibleLocations[activeIndex].id}`
                : undefined
            }
          >
            {visibleLocations.length === 0 ? (
              <li role="none">
                <span className="location-picker-no-results">
                  {requiredLocalized(l10n, 'loc-picker-no-results')}
                </span>
              </li>
            ) : (
              visibleLocations.map((loc, idx) => (
                <li key={loc.id} role="none">
                  <button
                    type="button"
                    role="option"
                    id={`location-picker-option-${loc.id}`}
                    data-index={idx}
                    aria-selected={loc.id === value}
                    className={`location-picker-option ${loc.id === value ? 'location-picker-option--active' : ''} ${activeIndex === idx ? 'location-picker-option--highlighted' : ''}`}
                    onClick={() => handleSelect(loc)}
                  >
                    <span className="location-picker-option-name">{loc.name}</span>
                    <span className="location-picker-option-meta">
                      {locationTypeLabel(l10n, loc.type)}
                      {loc.is_primary && (
                        <span className="location-picker-badge location-picker-badge--primary">
                          {requiredLocalized(l10n, 'loc-picker-badge-primary')}
                        </span>
                      )}
                      {loc.allow_negative_stock && (
                        <span className="location-picker-badge location-picker-badge--neg">
                          {requiredLocalized(l10n, 'loc-picker-badge-neg-stock')}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
});

export default LocationPicker;
