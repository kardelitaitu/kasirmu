// ui/src/features/kds/components/StationSelectorModal.tsx
//
// Station picker for the Expo screen (todo-kds-agents-3, Phase 3
// "dedicated Station view").
//
// The station universe here is the set of `kitchen_zone` values present on
// the ACTIVE board — that is all the existing scoped commands expose to this
// screen (KdsDevice.station_ids holds topology ids, not zone names, and there
// is no zone↔device mapping command in ui/src/api/kds.ts; stamping that as a
// backend dependency for a device-authoritative station list).
//
// Presentational by the house rule: the parent owns the zone list, the
// current selection, and persistence; this component renders a radiogroup
// inside a modal and fires callbacks. The "all" entry is owned here because
// it is a constant of THIS dialog (zone sentinel '' — same convention as
// useKdsPreferences.kdsZone), not a station.

import { useCallback, useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { requiredLocalized } from '@/components';

/** One selectable station row. `zone` is never empty (empty = the All row). */
export interface StationOption {
  zone: string;
  /** Active tickets currently at that station — shown as the row count. */
  tickets: number;
}

/** Props for the StationSelectorModal component. */
export interface StationSelectorModalProps {
  isOpen: boolean;
  /** Stations currently known to the board, in display order. */
  options: StationOption[];
  /** Current selection; '' means "all stations". */
  selected: string;
  /** Pick a station ('' = all). Called on activation, before close. */
  onSelect: (zone: string) => void;
  onClose: () => void;
}

/**
 * A single station row inside the radiogroup.
 * The selected class is a full literal in the template (never a computed
 * variable) so the screenExtraction static scan can resolve it.
 */
function StationRow({
  zone,
  tickets,
  isSelected,
  optionRefs,
  index,
  onSelect,
  onGroupKeyDown,
}: {
  zone: string;
  tickets: number;
  isSelected: boolean;
  optionRefs: React.MutableRefObject<Array<HTMLButtonElement | null>>;
  index: number;
  onSelect: (zone: string) => void;
  onGroupKeyDown: (e: React.KeyboardEvent) => void;
}) {
  const { l10n } = useLocalization();
  const isAll = zone === '';
  const ariaKey = isAll ? 'kds-station-all-aria' : 'kds-station-option-aria';
  return (
    <button
      ref={(el) => { optionRefs.current[index] = el; }}
      type="button"
      role="radio"
      aria-checked={isSelected}
      tabIndex={isSelected ? 0 : -1}
      className={`kds-station-option${isSelected ? ' kds-station-option--selected' : ''}`}
      onClick={() => onSelect(zone)}
      onKeyDown={onGroupKeyDown}
      aria-label={
        isAll
          ? requiredLocalized(l10n, ariaKey)
          : requiredLocalized(l10n, ariaKey, { zone })
      }
      data-testid={isAll ? 'kds-station-option-all' : `kds-station-option-${zone}`}
    >
      <span className="kds-station-option-name">
        {isAll
          ? <Localized id="kds-station-all-label"><span>All stations</span></Localized>
          : zone}
      </span>
      {!isAll && (
        <span className="kds-station-option-count">
          <Localized id="kds-order-count" vars={{ count: tickets }}>
            <span>{tickets}</span>
          </Localized>
        </span>
      )}
    </button>
  );
}

/**
 * Modal radiogroup for choosing which station the Expo board follows.
 */
export function StationSelectorModal({
  isOpen,
  options,
  selected,
  onSelect,
  onClose,
}: StationSelectorModalProps) {
  const { l10n } = useLocalization();
  const panelRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useFocusTrap(panelRef, isOpen, onClose);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Roving focus over the radios (same contract as the kitchen zone chips).
    const chips = optionRefs.current;
    if (!chips || chips.length === 0) return;
    const current = chips.findIndex((c) => c === document.activeElement);
    let next = -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      next = current < 0 ? 0 : (current + 1) % chips.length;
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      next = current < 0 ? chips.length - 1 : (current - 1 + chips.length) % chips.length;
    } else if (e.key === 'Home') {
      next = 0;
    } else if (e.key === 'End') {
      next = chips.length - 1;
    }
    if (next < 0) return;
    e.preventDefault();
    chips[next]?.focus();
  }, []);

  const pick = useCallback((zone: string) => {
    onSelect(zone);
    onClose();
  }, [onSelect, onClose]);

  if (!isOpen) return null;

  // Rows = the constant All entry + one row per station option. The All row
  // participates in the roving tabindex at index 0.
  const rows: StationOption[] = [{ zone: '', tickets: 0 }, ...options];

  return (
    <div
      className="kds-expo-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="kds-expo-modal kds-station-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kds-station-title"
        data-testid="kds-station-dialog"
      >
        <h2 className="kds-expo-modal-title" id="kds-station-title">
          <Localized id="kds-station-title"><span>Choose station</span></Localized>
        </h2>
        <div className="kds-station-group" role="radiogroup" aria-label={requiredLocalized(l10n, 'kds-station-aria')}>
          {rows.map((row, i) => (
            <StationRow
              key={row.zone === '' ? '__all__' : row.zone}
              zone={row.zone}
              tickets={row.tickets}
              isSelected={selected === row.zone}
              optionRefs={optionRefs}
              index={i}
              onSelect={pick}
              onGroupKeyDown={handleKeyDown}
            />
          ))}
        </div>
        {options.length === 0 && (
          <p className="kds-station-empty" role="status">
            <Localized id="kds-station-empty"><span>No stations on the board yet</span></Localized>
          </p>
        )}
        <div className="kds-expo-modal-actions">
          <button
            type="button"
            className="kds-expo-btn kds-expo-btn--muted"
            onClick={onClose}
            aria-label={requiredLocalized(l10n, 'kds-station-close-aria')}
            data-testid="kds-station-close"
          >
            <Localized id="kds-confirm-cancel"><span>Cancel</span></Localized>
          </button>
        </div>
      </div>
    </div>
  );
}

export default StationSelectorModal;
