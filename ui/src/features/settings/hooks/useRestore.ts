//! Restore-from-backup state for Settings -> Data Management (C8 slice S5b).
//!
//! # What this drives
//!
//! The restore tab: lists the backup generations beside the live database with
//! their verdicts, and lets an operator request a restore of one. **It does not
//! perform a restore.** The request is written to `<db>.restore-request.json`
//! and consumed by the BOOT path on the next start, before anything opens the
//! database — that separation is the whole point of the D5 safe-mode design,
//! so nothing here may present the restore as immediate. The copy says so; do
//! not "improve" it into "Restore now".
//!
//! # The one rule this file exists to enforce
//!
//! `restore_prepare` requires the operator to TYPE the store name that the
//! CANDIDATE carries, and the bridge deliberately does not echo the expected
//! name back — "the confirmation is only a real barrier if the answer is not in
//! the error" (`crates/kasirmu-bridge/src/data/restore.rs:209-210`).
//!
//! So this hook must never pre-fill, suggest, or display that name. It is not
//! in `RestoreCandidate`, it is not derived from the live store, and the input
//! starts empty and is cleared on every open and every close. A future
//! contributor "helpfully" seeding it from the live session would turn a
//! deliberate barrier into a copy-paste, which is exactly the failure this
//! comment is here to prevent. The mismatch error copy is likewise generic on
//! purpose: echoing the real name would leak the answer just as surely.

import { useCallback, useEffect, useState } from 'react';
import { useLocalization } from '@fluent/react';
import { useToast } from '@/components/Toast';
import {
  listRestoreCandidates,
  getRestoreStatus,
  prepareRestore,
  type RestoreCandidate,
  type RestoreStatus,
} from '@/api/data';
import { isTabletShell } from '@/utils/shellKind';

/** Everything the restore tab renders. */
export interface RestoreState {
  candidates: RestoreCandidate[];
  loading: boolean;
  /**
   * Three states, and the third is the one that matters — the same shape
   * `BackupInfo.lastBackup` uses, for the same reason:
   *   RestoreStatus -> the read ANSWERED
   *   undefined     -> the read never answered; it FAILED
   * 'Nothing is pending' and 'we could not find out' are different claims, and
   * only the first may be rendered as a clean state.
   */
  status: RestoreStatus | undefined;
  submitting: boolean;
  /** The candidate the operator opened the confirmation for, if any. */
  confirming: RestoreCandidate | null;
  /** The typed store-name confirmation. Never seeded — see the module doc. */
  confirmName: string;
}

const INITIAL: RestoreState = {
  candidates: [],
  loading: true,
  status: undefined,
  submitting: false,
  confirming: null,
  confirmName: '',
};

/** Map a bridge verdict wire name to its Fluent id. */
export function verdictId(verdict: string): string {
  switch (verdict) {
    case 'Acceptable':
      return 'data-mgmt-restore-verdict-acceptable';
    case 'OlderButAcceptable':
      return 'data-mgmt-restore-verdict-older';
    case 'NewerThanThisBuild':
      return 'data-mgmt-restore-verdict-newer';
    default:
      // 'Corrupt' and any unrecognised value. An unknown verdict is not
      // restorable, so treating it as the corrupt copy is the honest default:
      // it understates usability rather than overstating it.
      return 'data-mgmt-restore-verdict-corrupt';
  }
}

/** Format a byte count for display. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Owns the restore tab's list, pending-status read and request submission.
 *
 * The whole surface is desktop-only: all three commands are registered by the
 * desktop shell alone, and each resolves a session on the Rust side. On the
 * tablet the calls would be rejected as unknown commands, so the hook skips
 * the fetch and the section renders a not-available state rather than firing a
 * doomed invoke and showing a misleading error — the same reasoning
 * `useBackupStatus` records for its tablet branch.
 */
export function useRestore({ sessionToken, open }: {
  sessionToken: string;
  /** Whether the restore tab is currently mounted. Fetches run on open. */
  open: boolean;
}): {
  restore: RestoreState;
  isAvailable: boolean;
  refresh: () => void;
  startConfirm: (candidate: RestoreCandidate) => void;
  cancelConfirm: () => void;
  setConfirmName: (name: string) => void;
  submit: () => Promise<void>;
} {
  const { l10n } = useLocalization();
  const { addToast } = useToast();
  const [restore, setRestore] = useState<RestoreState>(INITIAL);
  const [reloadKey, setReloadKey] = useState(0);

  const isAvailable = !isTabletShell() && sessionToken !== '';

  // ── Load the generations and the pending status ────────────────

  useEffect(() => {
    if (!open || !isAvailable) return;
    let cancelled = false;
    setRestore((prev) => ({ ...prev, loading: true }));

    // Both reads are independent; a failure of one must not blank the other.
    // `allSettled` rather than `all`, so a pending-status read that fails still
    // leaves the generation list on screen.
    void Promise.allSettled([
      listRestoreCandidates(sessionToken),
      getRestoreStatus(sessionToken),
    ]).then(([listResult, statusResult]) => {
      if (cancelled) return;
      setRestore((prev) => ({
        ...prev,
        loading: false,
        candidates:
          listResult.status === 'fulfilled' ? listResult.value.candidates : [],
        // A rejected read leaves `status` undefined = never answered, which the
        // section renders as 'unknown' rather than 'nothing pending'.
        status: statusResult.status === 'fulfilled' ? statusResult.value : undefined,
      }));
      if (listResult.status === 'rejected') {
        addToast({ message: l10n.getString('data-mgmt-toast-restore-fail'), type: 'error' });
      }
    });

    return () => {
      cancelled = true;
    };
    // `l10n` and `addToast` stay out, matching useBackupStatus: `l10n` is not
    // reliably stable in this codebase, and listing it would refetch on every
    // locale change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isAvailable, sessionToken, reloadKey]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  // ── Confirmation ───────────────────────────────────────────────

  const startConfirm = useCallback((candidate: RestoreCandidate) => {
    // confirmName is reset here, never carried over from a previous open.
    setRestore((prev) => ({ ...prev, confirming: candidate, confirmName: '' }));
  }, []);

  const cancelConfirm = useCallback(() => {
    setRestore((prev) => ({ ...prev, confirming: null, confirmName: '' }));
  }, []);

  const setConfirmName = useCallback((name: string) => {
    setRestore((prev) => ({ ...prev, confirmName: name }));
  }, []);

  // ── Submit ─────────────────────────────────────────────────────

  const submit = useCallback(async () => {
    const candidate = restore.confirming;
    if (!candidate) return;
    // Block an empty confirmation before spending an IPC roundtrip: the bridge
    // would refuse it anyway, but its refusal is the generic mismatch error and
    // an empty field is a clearer thing to catch here.
    if (restore.confirmName.trim() === '') return;

    setRestore((prev) => ({ ...prev, submitting: true }));
    try {
      await prepareRestore(sessionToken, {
        candidate_path: candidate.path,
        confirm_store_name: restore.confirmName.trim(),
      });
      setRestore((prev) => ({
        ...prev,
        submitting: false,
        confirming: null,
        confirmName: '',
      }));
      addToast({ message: l10n.getString('data-mgmt-toast-restore-success'), type: 'success' });
      refresh();
    } catch {
      // One generic failure message. The bridge refuses a mismatch, an
      // unusable candidate and a candidate with no store name with DIFFERENT
      // errors, but its mismatch text deliberately names no expected value;
      // surface the field-level copy for the mismatch and the generic toast
      // otherwise. Keeping the typed input on screen lets the operator correct
      // it without reopening the dialog.
      setRestore((prev) => ({ ...prev, submitting: false }));
      addToast({ message: l10n.getString('data-mgmt-toast-restore-store-mismatch'), type: 'error' });
    }
  }, [addToast, l10n, refresh, restore.confirmName, restore.confirming, sessionToken]);

  return {
    restore,
    isAvailable,
    refresh,
    startConfirm,
    cancelConfirm,
    setConfirmName,
    submit,
  };
}
