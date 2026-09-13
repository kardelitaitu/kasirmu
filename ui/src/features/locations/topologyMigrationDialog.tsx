//! Legacy-wire migration dialog for the topology editor (composition C1).
//!
//! Owns the dialog JSX the editor rendered inline (the one the migration hook
//! arms): title/description copy, the per-wire resolution selects fed by
//! migrationSelectionFor, and the Later/Resolve footer. Classes, testids and
//! aria attributes are byte-verbatim from the inline original; the editor
//! suite reaches them directly, so nothing here may rename a selector.
//!
//! All behavior arrives as props - the dialog owns no state and registers no
//! hooks, so mounting it cannot move the parent's hook order. It renders
//! nothing when closed (the parent keeps the existing guard), and the
//! a11y attributes travel with the JSX out of the editor's suppression
//! region: the dialog is labelled via aria-labelledby, every select carries
//! an aria-label, and the footer buttons are typed buttons with text.

import { Localized, type useLocalization } from '@fluent/react';
import type { Dispatch, SetStateAction } from 'react';
import type { WireRelationshipOption } from './topologyCard';
import type { TopologyNodeData, TopologyWireData } from './nodeTopologyEditorTypes';

/** One legacy-wire candidate: the wire plus its resolved endpoint nodes and
 *  the legal relationship options the pairing table admits (the migration
 *  hook's memo shape, mirrored so the dialog stays hook-free). */
interface TopologyMigrationEntry {
  wire: TopologyWireData;
  from: TopologyNodeData;
  to: TopologyNodeData;
  options: WireRelationshipOption[];
}

export interface TopologyMigrationDialogProps {
  /** The unresolved legacy wires and their legal options. */
  entries: TopologyMigrationEntry[];
  /** The hook's current-choice read: user selection, else first legal, else
   *  delete-only. Passed by reference so the select values stay live. */
  selectionFor: (wireId: string, optionsLen: number) => number | 'delete';
  /** Parent-owned per-wire choice map the selects write directly. */
  setMigrationSelections: Dispatch<SetStateAction<Record<string, number | 'delete'>>>;
  /** Footer actions - the migration hook's two handlers. */
  onLater: () => void;
  onResolve: () => void;
  /** Only getString is needed - the per-select aria label and option labels. */
  l10n: { getString: ReturnType<typeof useLocalization>['l10n']['getString'] };
}

/** The migration dialog the editor previously rendered inline. */
export function TopologyMigrationDialog({
  entries,
  selectionFor,
  setMigrationSelections,
  onLater,
  onResolve,
  l10n,
}: TopologyMigrationDialogProps) {
  return (
    // The dialog sits over the canvas; its mousedown must not fall through
    // and start a canvas marquee/pan. Interaction lives in the selects and
    // footer buttons, so the dialog itself has no activation handler.
    // (Same pattern as topologyRelationshipPicker's container.)
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className="topology-migration-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="topology-migration-title"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <h2 id="topology-migration-title">
        <Localized id="topology-migration-title">Migrate legacy connections</Localized>
      </h2>
      <p className="topology-migration-description">
        <Localized id="topology-migration-description">
          These older connections cannot be identified safely. Choose what each one means
          so the diagram can be applied. Connections with no compatible meaning must be
          deleted and recreated with the labeled ports.
        </Localized>
      </p>
      <ul className="topology-migration-list">
        {entries.map((entry) => (
          <li key={entry.wire.id} className="topology-migration-entry">
            <span className="topology-migration-names">
              {entry.from.name} → {entry.to.name}
            </span>
            <select
              aria-label={l10n.getString('topology-migration-select-aria', {
                from: entry.from.name,
                to: entry.to.name,
              })}
              value={String(selectionFor(entry.wire.id, entry.options.length))}
              onChange={(e) => {
                const value = e.target.value;
                setMigrationSelections((prev) => ({
                  ...prev,
                  [entry.wire.id]: value === 'delete' ? 'delete' : Number(value),
                }));
              }}
            >
              {entry.options.map((opt, i) => (
                <option key={`${opt.fromPortId}|${opt.toPortId}`} value={String(i)}>
                  {l10n.getString(opt.labelId)}
                </option>
              ))}
              <option value="delete">{l10n.getString('topology-migration-delete')}</option>
            </select>
          </li>
        ))}
      </ul>
      <footer className="topology-migration-actions">
        <button
          type="button"
          className="topology-migration-later"
          onClick={onLater}
        >
          <Localized id="topology-migration-later">Later</Localized>
        </button>
        <button
          type="button"
          className="topology-migration-resolve"
          onClick={onResolve}
        >
          <Localized id="topology-migration-resolve">Resolve</Localized>
        </button>
      </footer>
    </div>
  );
}
