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
import { useToast } from '@/components/Toast';
import {
  getBackupStatus,
  getBackupStatusScoped,
  createBackup,
  createBackupScoped,
  pickBackupPath,
  createBackupTo,
} from '@/api/data';
import { isTabletShell } from '@/utils/shellKind';
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
    // The tablet has no status command to read (see the effect below), so it starts in
    // the never-answered state. `null` would render 'Never' for the one frame before
    // the effect runs -- a compliance claim the tablet cannot support.
    lastBackup: isTabletShell() ? undefined : null,
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
    // ── The tablet has NO backup-status command, and that is not a no-op ──
    //
    // `get_backup_status` and `get_backup_status_scoped` are DESKTOP-registered
    // names only: defined at apps/desktop-tauri/src/commands/data.rs:33 and :133 and
    // registered at apps/desktop-tauri/src/lib.rs:964-965. apps/mobile-tauri defines
    // neither and registers neither (its only backup door is `create_backup_to`,
    // apps/mobile-tauri/src/commands/data.rs:139), so on the tablet this invoke is
    // rejected by the IPC layer for an unknown command -- the catch below then fires
    // a spurious error toast and the panel shows the failure string on EVERY mount of
    // this screen.
    //
    // Do NOT 'fix' that by adding a tablet scoped read. The bridge's status body
    // reads `default_backup_path` -- `<db>.backup.db` beside the database -- and on
    // Android that path is inside private storage the tablet never writes: the
    // tablet backs up to an operator-chosen destination instead. Such a read would
    // answer 'Never' for a store that HAS backed up, which is exactly the compliance
    // claim BackupSection's three-way render exists to refuse.
    //
    // So the tablet simply does not read a status: the state above starts at
    // `undefined` (never answered, which is not the same as 'Never'), and the only
    // status the tablet honestly has is the one handleBackup writes locally after a
    // successful create_backup_to.
    const fetchStatus = isTabletShell()
      ? null
      : sessionToken
        ? () => getBackupStatusScoped(sessionToken)
        : () => getBackupStatus();
    if (!fetchStatus) return;
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
      let result;
      if (isTabletShell()) {
        // Tablet: the operator must choose a destination. The desktop's
        // create_backup writes to default_backup_path, which on Android lands in
        // private storage the operator cannot open. Bridge the chosen content://
        // URI to a cache path, write there, then walk the bytes out — the same
        // two-leg cross as export. create_backup_to is the tablet-only twin and
        // enforces permissions::DATA_EXPORT, so a session token is required.
        const cachePath = await pickBackupPath();
        if (!cachePath) {
          // User dismissed the save dialog — no backup taken, no error.
          setBackup((prev) => ({ ...prev, backingUp: false }));
          return;
        }
        result = await createBackupTo(sessionToken, cachePath);
      } else {
        // create_backup writes a full copy of the database to disk and, unscoped, checks no
        // permission whatsoever. create_backup_scoped (added in 62e30fd7 for F-017) enforces
        // permissions::DATA_EXPORT; until this line called it, that check existed only in code
        // nothing reached.
        result = sessionToken
          ? await createBackupScoped(sessionToken)
          : await createBackup();
      }
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
