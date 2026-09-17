//! Backup status + one-click snapshot for Settings -> Data Management.
//!
//! Owns the two things that outlived the section extractions: the mount-time
//! status fetch and the handleBackup handler, plus the BackupInfo atom they both
//! write. Moved out verbatim - same commands, same deps, same security comments -
//! so DataManagementScreen.tsx can be called a coordinator honestly. The backup
//! TAB's presentation already lives in components/BackupSection.tsx; this is its
//! behaviour half, which is where the file put useExportWizard and useImportWizard.

import { useCallback, useEffect, useState } from 'react';
import { useLocalization } from '@fluent/react';
import { useToast } from '@/frontend/shared/Toast';
import {
  getBackupStatus,
  getBackupStatusScoped,
  createBackup,
  createBackupScoped,
} from '@/api/data';
import { type BackupInfo } from '../dataManagementModel';

/**
 * Reads the last snapshot and takes a new one.
 *
 * triggerFlash is injected rather than owned here: the flash map is shared with the
 * import wizard's rows, so the screen wires both callers to one useFlashRows.
 */
export function useBackupStatus({ sessionToken, triggerFlash }: {
  sessionToken: string;
  triggerFlash: (key: string) => void;
}): { backup: BackupInfo; handleBackup: () => Promise<void> } {
  const { l10n } = useLocalization();
  const { addToast } = useToast();
  // Initial value stays null (renders 'Never'), deliberately: the in-flight window is NOT the
  // failed read, and the only existing en+id pair that fits the failure is a past-tense load
  // error. Calling a pending read 'failed' would be a second false claim; and this tab mounts
  // only on demand, by which time the effect below has normally settled.
  const [backup, setBackup] = useState<BackupInfo>({
    lastBackup: null,
    lastBackupSize: null,
    backingUp: false,
  });

  // ── Load backup status on mount ─────────────────────────────────

  useEffect(() => {
    // NOT a designed gradation. The three lines this replaced called the shape
    // 'ADR #7 conditional scoping', as if falling back were the plan. Measured, it is
    // a hole: the workspace token is NOT guaranteed for an authenticated owner. It is
    // minted only when an instance is resolvable - ui/src/contexts/WorkspaceContext.tsx
    // :469-473 bails without ever minting one, :463 bails without a user id, and :215,
    // :274, :319, :507 null an EXISTING token while the shell and this screen stay
    // mounted. So the else branch is reachable in a normal install, not a corner, and
    // it calls get_backup_status, which checks nothing: permissions::DATA_EXPORT is
    // skipped here and at the createBackup call below. This page's requiredRole: 'owner'
    // gate (features/settings/register.tsx:31) is a DIFFERENT credential - AppShell.tsx:368
    // reads session?.role_name, never this token - so passing the gate proves nothing
    // about holding one. Ledger: scripts/verify-scoped-coverage.sh:57, allowlisted at
    // :100 alongside create_backup. Left OPEN on purpose: gating it would deny backup
    // to installs that can never hold a token (offline, no admin instance). It is now
    // LOUD - event backup_ungated_no_session in crates/kasirmu-bridge/src/data.rs - and
    // pinned by a known-hazard test in ui/src/__tests__/DataManagementBackup.test.tsx.
    const fetchStatus = sessionToken
      ? () => getBackupStatusScoped(sessionToken)
      : () => getBackupStatus();
    fetchStatus()
      .then((status) => {
        setBackup((prev) => ({
          ...prev,
          lastBackup: status.lastBackup,
          lastBackupSize: status.lastBackupSize ?? undefined,
        }));
      })
      .catch(() => {
        // A failed read is not an answered-empty read. Writing null here made the panel say
        // 'Last backup: Never', a compliance claim this read cannot support, and the toast that
        // did say so expires while the null does not. undefined = never answered.
        setBackup((prev) => ({ ...prev, lastBackup: undefined }));
        addToast({ message: l10n.getString('data-mgmt-toast-backup-status-fail'), type: 'error' });
      });
    // addToast and l10n stay excluded, as the original comment said -- but the reason is now
    // narrower than 'they are stable': l10n is NOT reliably stable in this codebase
    // (FastPINOverlay.tsx:334 documents an infinite re-render loop from it), so listing it here
    // would refetch backup status on every locale change. sessionToken is the one that must be
    // present, because it selects which command runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToken]);

  // ── Backup handler ──────────────────────────────────────────────

  const handleBackup = useCallback(async () => {
    setBackup((prev) => ({ ...prev, backingUp: true }));
    try {
      // create_backup writes a full copy of the database to disk and, unscoped, checks no
      // permission whatsoever. create_backup_scoped (added in 62e30fd7 for F-017) enforces
      // permissions::DATA_EXPORT; until this line called it, that check existed only in code
      // nothing reached.
      const result = sessionToken
        ? await createBackupScoped(sessionToken)
        : await createBackup();
      setBackup({
        lastBackup: new Date().toLocaleString(),
        lastBackupSize: `${(result.sizeBytes / 1024 / 1024).toFixed(1)} MB`,
        backingUp: false,
      });
      triggerFlash('backup');
      addToast({ message: l10n.getString('data-mgmt-toast-backup-success'), type: 'success' });
    } catch {
      setBackup((prev) => ({ ...prev, backingUp: false }));
      addToast({ message: l10n.getString('data-mgmt-toast-backup-fail'), type: 'error' });
    }
  }, [addToast, l10n, triggerFlash, sessionToken]);

  return { backup, handleBackup };
}
