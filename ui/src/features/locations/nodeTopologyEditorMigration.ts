//! Legacy-schema migration resolution for the topology editor (Phase 4 - slice G4-a).
//!
//! Owns the derived side of the ADR #34 item 7 migration dialog:
//! - ambiguousLegacyWireIds - the wires the live Apply gate refuses with the
//!   ambiguous-legacy-wire code, i.e. the migration candidates. It mirrors that
//!   exact error, so the dialog can never offer to fix a wire Apply would not
//!   have blocked on.
//! - migrationEntries - each candidate paired with its endpoint nodes and the
//!   legal resolutions derived from the pairing table. Zero options means the
//!   pair has no legal relationship at all: delete-only.
//! - the auto-open effect, which arms the dialog once per load session.
//! - handleResolveMigration / handleLaterMigration - the two footer actions.
//!
//! What deliberately did NOT move, and why:
//! - the state trio (migrationOpen/setMigrationOpen, migrationDismissedRef,
//!   migrationSelections/setMigrationSelections) stays parent-owned and arrives
//!   through deps. migrationOpen is read as a VALUE by the keyboard hook, and
//!   migrationDismissedRef by both the load-lifecycle hook and the keyboard hook
//!   - all of which sit ABOVE this slot, so no hook placed here could own them
//!   without a positional reorder. The setters are passed in rather than
//!   duplicated here, so the editor, the auto-open latch and the dialog JSX keep
//!   one source of truth.
//! - the dialog JSX stays mounted in the editor (slice G4-b territory).
//! - pushHistory is only CALLED here. Its setHistory/setRedo updater bodies stay
//!   in the editor, so no history-entry producer moved.
//!
//! Bodies, comments and dependency arrays are verbatim line-slices of the inline
//! originals in NodeTopologyEditor.tsx (2357-2464), kept in source order:
//! useMemo -> useMemo -> plain fn -> useEffect -> plain fns. The hook call sits
//! at the slot that block occupied, so hook order - and therefore effect order -
//! is unchanged from the inline original. The three handlers stay PLAIN ARROWS
//! (never stabilized into useCallback), exactly as they were inline.

import { useEffect, useMemo } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { useLocalization } from '@fluent/react';
import type { TopologyValidationError } from './topologyContract';
import { legacyWireResolutionOptions, type WireRelationshipOption } from './topologyCard';
import type { TopologyNodeData, TopologyWireData } from './NodeTopologyEditor';

export interface TopologyMigrationDeps {
  /** Bucketed live validation of the current canvas. Only byWire is read here,
   *  and it is read to find exactly the errors the Apply gate refuses. */
  liveValidation: {
    byNode: Map<string, TopologyValidationError[]>;
    byWire: Map<string, TopologyValidationError[]>;
    graphLevel: TopologyValidationError[];
  };
  /** O(1) node lookup by id - the editor keeps one for every hot path. */
  nodeMap: Map<string, TopologyNodeData>;
  /** Canvas wires: each candidate id is resolved back out of this list. */
  wires: TopologyWireData[];
  setWires: Dispatch<SetStateAction<TopologyWireData[]>>;
  /** Undo-stack push. Passed directly (it is declared above this slot), and
   *  only ever CALLED here - the producer bodies stay in the editor. */
  pushHistory: (snapshot?: { nodes: TopologyNodeData[]; wires: TopologyWireData[] }) => void;
  /** Imperative live-region write: the completed migration is announced here. */
  setLiveAnnouncement: (message: string) => void;
  /** Only getString is needed - the mirrored wire labels and the announce copy. */
  l10n: { getString: ReturnType<typeof useLocalization>["l10n"]["getString"] };
  /** Later/Escape latch, parent-owned: the load lifecycle resets it on every
   *  authoritative load so the migration is re-offered. */
  migrationDismissedRef: MutableRefObject<boolean>;
  setMigrationOpen: Dispatch<SetStateAction<boolean>>;
  /** Per-wire choice map, parent-owned: the dialog JSX writes it directly. */
  migrationSelections: Record<string, number | "delete">;
  setMigrationSelections: Dispatch<SetStateAction<Record<string, number | "delete">>>;
}

/**
 * The migration candidates, the dialog auto-open latch, and the two footer
 * actions. Returns the four names the dialog JSX consumes; the candidate-id
 * memo has no reader outside this hook, so it is not returned.
 */
export function useTopologyEditorMigration(deps: TopologyMigrationDeps) {
  const {
    liveValidation,
    nodeMap,
    wires,
    setWires,
    pushHistory,
    setLiveAnnouncement,
    l10n,
    migrationDismissedRef,
    setMigrationOpen,
    migrationSelections,
    setMigrationSelections,
  } = deps;

  // ── Legacy-schema migration dialog (ADR #34 item 7) ────────────
  // A fully-unknown legacy wire (normalized to the legacy-out/legacy-in
  // placeholders) cannot be applied — the pairing table has nothing to say
  // about it. The dialog lists every ambiguous wire and lets the user
  // resolve each one in place from the node types' LEGAL relationships
  // (never a silent reinterpretation), or delete it. Apply stays blocked
  // until none remain (the ambiguous-legacy-wire gate is unchanged).

  /** Wires currently flagged ambiguous by the live gate — the migration
   *  candidates. Mirrors the exact error the Apply gate refuses. */
  const ambiguousLegacyWireIds = useMemo(() => {
    const ids: string[] = [];
    for (const [wireId, errs] of liveValidation.byWire) {
      if (errs.some((e) => e.code === 'ambiguous-legacy-wire')) ids.push(wireId);
    }
    return ids;
  }, [liveValidation]);

  /** Migration entries: each ambiguous wire with its endpoint nodes and the
   *  legal resolution options derived from the pairing table. Zero options
   *  means the pair has no legal relationship — delete-only. */
  const migrationEntries = useMemo(() => {
    const entries = ambiguousLegacyWireIds
      .map((id) => {
        const wire = wires.find((w) => w.id === id);
        if (!wire) return null;
        const from = nodeMap.get(wire.fromNodeId);
        const to = nodeMap.get(wire.toNodeId);
        if (!from || !to) return null;
        return { wire, from, to, options: legacyWireResolutionOptions(from, to) };
      })
      .filter((e): e is { wire: TopologyWireData; from: TopologyNodeData; to: TopologyNodeData; options: WireRelationshipOption[] } => e !== null);
    return entries;
  }, [ambiguousLegacyWireIds, wires, nodeMap]);

  /** The current choice for a wire: the user's explicit selection, else the
   *  first legal option, else delete-only. */
  const migrationSelectionFor = (wireId: string, optionsLen: number): number | 'delete' =>
    migrationSelections[wireId] ?? (optionsLen > 0 ? 0 : 'delete');

  /** Auto-open on load: an unresolved legacy wire gets the migration dialog
   *  (once per session until dismissed). The dialog re-offers when the
   *  ambiguity returns — an undo of a migration, or a later edit recreating
   *  the same legacy wire. */
  useEffect(() => {
    const dismissed = migrationDismissedRef;
    if (ambiguousLegacyWireIds.length > 0 && !dismissed.current) {
      setMigrationOpen(true);
    }
  }, [ambiguousLegacyWireIds.length, migrationDismissedRef, setMigrationOpen]);

  /** Apply the migration: each wire keeps its chosen relationship (semantic
   *  fields + a label mirroring commitWire's first-wire choices, legacy
   *  coordinates preserved) or is deleted. ONE undo entry for the whole
   *  migration; the live gate clears the moment the fields land. */
  const handleResolveMigration = () => {
    const entries = migrationEntries;
    if (entries.length === 0) return;
    pushHistory();
    const resolveMap = new Map<string, WireRelationshipOption>();
    const deleteIds = new Set<string>();
    for (const entry of entries) {
      const choice = migrationSelectionFor(entry.wire.id, entry.options.length);
      if (choice === 'delete') {
        deleteIds.add(entry.wire.id);
      } else {
        const opt = entry.options[choice];
        if (opt) resolveMap.set(entry.wire.id, opt);
      }
    }
    setWires((prev) =>
      prev
        .map((w) => {
          if (deleteIds.has(w.id)) return null;
          const opt = resolveMap.get(w.id);
          if (!opt) return w;
          const from = nodeMap.get(w.fromNodeId);
          const to = nodeMap.get(w.toNodeId);
          return {
            ...w,
            fromPortId: opt.fromPortId,
            toPortId: opt.toPortId,
            relationshipType: opt.relationshipType,
            // Mirror commitWire's first-wire label choices so a migrated
            // wire reads exactly like an authored one.
            label:
              opt.relationshipType === 'ticket-routing'
                ? l10n.getString('topology-wire-label-ticket')
                : opt.relationshipType === 'inventory-transfer'
                  ? l10n.getString('topology-wire-label-transfer')
                  : from?.type === 'workspace' && to?.type === 'warehouse' && opt.relationshipType === 'stock-routing'
                    ? l10n.getString('topology-wire-label-stock-deduct', { priority: 1 })
                    : l10n.getString('topology-wire-label-connected'),
          };
        })
        .filter((w): w is TopologyWireData => w !== null),
    );
    setMigrationOpen(false);
    setMigrationSelections({});
    setLiveAnnouncement(l10n.getString('topology-migration-announce'));
  };

  /** "Later"/Escape: dismiss the dialog for this load session. The wire
   *  stays unresolved — the validation panel keeps the error and Apply
   *  stays blocked until the user resolves it manually or reloads. */
  const handleLaterMigration = () => {
    migrationDismissedRef.current = true;
    setMigrationOpen(false);
  };

  return {
    migrationEntries,
    migrationSelectionFor,
    handleResolveMigration,
    handleLaterMigration,
  };
}
