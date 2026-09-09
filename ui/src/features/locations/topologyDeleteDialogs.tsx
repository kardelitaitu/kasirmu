//! Delete confirmation dialogs for the topology editor (composition C4):
//! the delete-one (node vs wire) and delete-many ConfirmDialog call sites,
//! fed by the delete-confirm hook's state.
//!
//! All behavior arrives as props - the dialogs own no state and register no
//! hooks, so mounting them cannot move the parent's hook order. Fluent ids
//! and the danger variant are byte-verbatim from the inline originals; the
//! editor suite reaches them directly, so nothing here may rename a selector.

import type { Dispatch, SetStateAction } from 'react';
import type { useLocalization } from '@fluent/react';
import { ConfirmDialog } from '@/components/ConfirmDialog';

export interface TopologyDeleteDialogsProps {
  /** Single-target confirm payload; null while no confirm is pending. */
  confirmDelete: string | null;
  setConfirmDelete: Dispatch<SetStateAction<string | null>>;
  /** Batch confirm payload (node id list); null while closed. */
  confirmDeleteMany: string[] | null;
  setConfirmDeleteMany: Dispatch<SetStateAction<string[] | null>>;
  /** The delete-confirm hook's executor, wired as both dialogs' onConfirm. */
  executeDelete: () => void;
  /** Only getString is needed - titles, messages, confirm label. */
  l10n: { getString: ReturnType<typeof useLocalization>['l10n']['getString'] };
}

/** The delete confirmations the editor previously rendered inline. */
export function TopologyDeleteDialogs({
  confirmDelete,
  setConfirmDelete,
  confirmDeleteMany,
  setConfirmDeleteMany,
  executeDelete,
  l10n,
}: TopologyDeleteDialogsProps) {
  return (
    <>
      {/* ── Confirm delete dialog ── */}
      {confirmDelete !== null && (
        <ConfirmDialog
          open
          onCancel={() => setConfirmDelete(null)}
          onConfirm={executeDelete}
          title={confirmDelete
            ? l10n.getString('topology-confirm-delete-node-title')
            : l10n.getString('topology-confirm-delete-wire-title')}
          message={
            confirmDelete
              ? l10n.getString('topology-confirm-delete-node-msg')
              : l10n.getString('topology-confirm-delete-wire-msg')
          }
          variant="danger"
          confirmLabel={l10n.getString('topology-confirm-delete-label')}
        />
      )}

      {/* ── Confirm batch delete dialog (2+ nodes) ── */}
      {confirmDeleteMany !== null && (
        <ConfirmDialog
          open
          onCancel={() => setConfirmDeleteMany(null)}
          onConfirm={executeDelete}
          title={l10n.getString('topology-confirm-delete-many-title', { count: confirmDeleteMany.length })}
          message={l10n.getString('topology-confirm-delete-many-msg', { count: confirmDeleteMany.length })}
          variant="danger"
          confirmLabel={l10n.getString('topology-confirm-delete-label')}
        />
      )}
    </>
  );
}
