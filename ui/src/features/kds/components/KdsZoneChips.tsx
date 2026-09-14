/**
 * KdsZoneChips — the secondary filter row under the KDS header: an "All"
 *   chip plus one chip per kitchen zone, rendered as an ARIA tablist with a
 *   roving tabindex.
 *
 * Extracted verbatim from KdsScreen.tsx:818-847 by the KDS merged-lane
 * zone-chips slice (the region the plan calls "zone chips", listed as
 * "cheapest remaining win" of slice 3's header work). The moved block is
 * byte-identical except for five reads that became props.
 *
 * PRESENTATIONAL ONLY — it owns no state and calls no api. The two pieces of
 * machinery it touches stay in the screen, deliberately:
 *   - `zoneTabRefs` is the screen's ref ARRAY, read by the screen's own
 *     `handleZoneTablistKeyDown` (:495) to move focus between chips; the array
 *     is passed through and written in place, so ownership does not move.
 *   - `onKeyDown` IS that handler. The roving-tabindex rule stays where the
 *     keyboard logic lives; moving it would put half of one interaction in two
 *     files, which is the outcome the plan's collision notes were written to
 *     prevent.
 * The `zones.length > 0 &&` guard moved INSIDE as a null return, so the call
 * site is one element and the empty-board behaviour is unchanged.
 *
 * REGISTERED in __tests__/screenExtraction.test.ts under the KdsScreen entry's
 * additionalTsx. The classes used here — kds-zone-chips, kds-zone-chip and its
 * --active modifier — are still styled by kds/KdsScreen.css, which that entry
 * already lists; without the registration the reachability guard would read all
 * three as dead CSS and stay green, which is the silent failure mode the rule
 * exists to stop.
 */
import { Localized, useLocalization } from '@fluent/react';
import type { KeyboardEvent } from 'react';
import { requiredLocalized } from '@/frontend/shared';

export interface KdsZoneChipsProps {
  /** Distinct kitchen zones, already de-duplicated and sorted by the screen. */
  zones: string[];
  /** The selected zone; '' means "All". */
  activeZone: string;
  /** Select a zone, or '' for All. */
  onSelectZone: (zone: string) => void;
  /** The screen's roving-tabindex keydown handler for this tablist. */
  onKeyDown: (e: KeyboardEvent) => void;
  /** The screen's chip refs, indexed 0 = All then one per zone, used by the handler above.
   *  Typed structurally rather than as RefObject/MutableRefObject: this component WRITES
   *  into the array, and RefObject<T> types .current as T | null under these React types
   *  (that is exactly the TS18047 this line replaced), while the screen's own
   *  useRef<Array<...>>([]) widens to this shape without a version-pinned alias. */
  zoneTabRefs: { current: Array<HTMLButtonElement | null> };
}

export function KdsZoneChips({
  zones,
  activeZone,
  onSelectZone,
  onKeyDown,
  zoneTabRefs,
}: KdsZoneChipsProps) {
  const { l10n } = useLocalization();

  if (zones.length === 0) return null;

  return (
    <div className="kds-zone-chips" role="tablist" aria-label={requiredLocalized(l10n, 'kds-zone-filter-aria')} onKeyDown={onKeyDown} tabIndex={0}>
      <button
        className={`kds-zone-chip${!activeZone ? ' kds-zone-chip--active' : ''}`}
        onClick={() => onSelectZone('')}
        role="tab"
        aria-selected={!activeZone}
        tabIndex={!activeZone ? 0 : -1}
        ref={(el) => { zoneTabRefs.current[0] = el; }}
        data-testid="kds-zone-chip-all"
      >
        <Localized id="kds-zone-all">All</Localized>
      </button>
      {zones.map((zone, i) => (
        <button
          key={zone}
          className={`kds-zone-chip${activeZone === zone ? ' kds-zone-chip--active' : ''}`}
          onClick={() => onSelectZone(zone)}
          role="tab"
          aria-selected={activeZone === zone}
          tabIndex={activeZone === zone ? 0 : -1}
          ref={(el) => { zoneTabRefs.current[i + 1] = el; }}
          data-testid={`kds-zone-chip-${zone}`}
        >
          {zone}
        </button>
      ))}
    </div>
  );
}
