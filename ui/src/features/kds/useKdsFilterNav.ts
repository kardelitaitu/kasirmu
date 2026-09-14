/**
 * useKdsFilterNav — the roving-tabindex keyboard trio for the KDS zone chips
 * and the filter popover, plus the popover's Escape / outside-click dismiss.
 *
 * Extracted verbatim from KdsScreen.tsx:493-515 (handleZoneTablistKeyDown),
 * :551-571 (the dismiss effect) and :573-616 (handleFilterPanelKeyDown,
 * handleFilterBtnKeyDown). The three handlers and the effect bodies are the
 * sed output — no key, no branch, no preventDefault and no focus() call was
 * retyped, and the focus-then-activate ordering in the zone handler is intact.
 *
 * WHAT MOVES AND WHAT DOES NOT: the three REFS move here, because every one of
 * them is read only by this logic (chip refs for `document.activeElement`
 * comparison, popover refs for the option query and the click-outside test) —
 * and they are handed back out, because the markup that binds them
 * (`ref=` in KdsZoneChips / KdsHeaderLeft) stayed in the screen. The filter
 * STATE (`filterMode` / `filterCats` / `showFilter`) stays page-level by
 * deliberate ruling: `filteredOrders` and `boardFiltered` both read it, so
 * moving it would widen this seam rather than narrow it; the hook receives
 * `showFilter` / `setShowFilter` for the dismiss logic only.
 *
 * `setShowFilter` is in the dependency arrays its originals did not need: while
 * it was a local `useState` result react-hooks could prove it stable, and as a
 * prop it cannot. The call site still passes the raw setter, so this changes
 * identity nothing — it is a lint requirement, not a behavioural change.
 *
 * NO MARKUP, NO STRINGS, NO CLASS NAMES: it is a .ts logic file, so the
 * extraction and tooltip guards have nothing to re-register.
 */
import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, KeyboardEvent, MutableRefObject, RefObject, SetStateAction } from 'react';

export interface UseKdsFilterNavOptions {
  /** Distinct kitchen zones, in the order the chips render them. */
  zones: string[];
  /** Select a zone, or '' for "All". */
  setKdsZone: (zone: string) => void;
  /** Whether the filter popover is open (the state itself stays in the screen). */
  showFilter: boolean;
  setShowFilter: Dispatch<SetStateAction<boolean>>;
}

export interface UseKdsFilterNavResult {
  /** Chip refs, index 0 = "All" then one per zone; written by KdsZoneChips. */
  zoneTabRefs: MutableRefObject<Array<HTMLButtonElement | null>>;
  filterBtnRef: RefObject<HTMLButtonElement>;
  filterPanelRef: RefObject<HTMLDivElement>;
  handleZoneTablistKeyDown: (e: KeyboardEvent) => void;
  handleFilterPanelKeyDown: (e: KeyboardEvent) => void;
  handleFilterBtnKeyDown: (e: KeyboardEvent) => void;
}

export function useKdsFilterNav({
  zones,
  setKdsZone,
  showFilter,
  setShowFilter,
}: UseKdsFilterNavOptions): UseKdsFilterNavResult {
  // KEY-07: ARIA tabs pattern — zone chips get roving tabindex + arrow keys.
  const zoneTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const filterBtnRef = useRef<HTMLButtonElement>(null);
  const filterPanelRef = useRef<HTMLDivElement>(null);

  // KEY-07: ARIA tabs pattern — ArrowLeft/ArrowRight/Home/End move between the
  // zone chips (roving tabindex: the selected chip keeps tabIndex 0, others -1),
  // and the chip reached by arrow keys becomes the active zone filter.
  const handleZoneTablistKeyDown = useCallback((e: KeyboardEvent) => {
    const chips = zoneTabRefs.current;
    if (!chips || chips.length === 0) return;
    const current = chips.findIndex((c) => c === document.activeElement);
    let next = -1;
    if (e.key === 'ArrowRight') {
      next = current < 0 ? 0 : (current + 1) % chips.length;
    } else if (e.key === 'ArrowLeft') {
      next = current < 0 ? chips.length - 1 : (current - 1 + chips.length) % chips.length;
    } else if (e.key === 'Home') {
      next = 0;
    } else if (e.key === 'End') {
      next = chips.length - 1;
    }
    if (next < 0) return;
    e.preventDefault();
    chips[next]?.focus();
    // chip 0 = "All" (zone ''), chips 1..n = zones[0..n-1]
    setKdsZone(next === 0 ? '' : (zones[next - 1] ?? ''));
  }, [zones, setKdsZone]);

  // Filter dropdown: close on outside click and Escape.
  useEffect(() => {
    if (!showFilter) return;
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setShowFilter(false);
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (
        filterPanelRef.current && !filterPanelRef.current.contains(e.target as Node) &&
        filterBtnRef.current && !filterBtnRef.current.contains(e.target as Node)
      ) {
        setShowFilter(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showFilter, setShowFilter]);

  // Keyboard navigation for the filter dropdown listbox.
  const handleFilterPanelKeyDown = useCallback((e: KeyboardEvent) => {
    const panel = filterPanelRef.current;
    if (!panel) return;
    const options = Array.from(panel.querySelectorAll<HTMLButtonElement>('.kds-filter-option'));
    if (options.length === 0) return;
    const currentIndex = options.findIndex((opt) => opt === document.activeElement);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % options.length;
      options[nextIndex]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const nextIndex = currentIndex < 0 ? options.length - 1 : (currentIndex - 1 + options.length) % options.length;
      options[nextIndex]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      options[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      options[options.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setShowFilter(false);
      filterBtnRef.current?.focus();
    }
  }, [setShowFilter]);

  const handleFilterBtnKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setShowFilter(true);
      setTimeout(() => {
        const panel = filterPanelRef.current;
        if (!panel) return;
        const options = Array.from(panel.querySelectorAll<HTMLButtonElement>('.kds-filter-option'));
        if (options.length > 0) {
          const target = e.key === 'ArrowDown' ? options[0] : options[options.length - 1];
          target?.focus();
        }
      }, 0);
    }
  }, [setShowFilter]);

  return {
    zoneTabRefs,
    filterBtnRef,
    filterPanelRef,
    handleZoneTablistKeyDown,
    handleFilterPanelKeyDown,
    handleFilterBtnKeyDown,
  };
}
