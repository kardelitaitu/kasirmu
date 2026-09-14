//! Data Management screen — Settings → Data Management
//!
//! Three sections:
//! - **Export wizard**: pick data types to export, date range, password field, progress indicator
//! - **Import wizard**: pick a .ozpkg file, preview metadata, dry-run diff table, confirm
//! - **Backup status**: last backup timestamp, one-click snapshot

import { useState, useCallback, useEffect, useRef } from 'react';

/** Duration (ms) for the row flash animation. */
const FLASH_DURATION = 1_400;
import { Localized, useLocalization } from '@fluent/react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/frontend/shared/Toast';
import {
  getBackupStatus,
  getBackupStatusScoped,
  createBackup,
  createBackupScoped,
  importPreview,
  importData,
  pickImportFile,
} from '@/api/data';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import AdminLockedFeature from '@/components/AdminLockedFeature';
import { useAdminGate } from '@/contexts/SubscriptionContext';
import { l10nErrorMessage } from '@/utils/app-error';
import './DataManagementScreen.css';
import { INITIAL_IMPORT, type BackupInfo, type ImportState } from './dataManagementModel';
import { tabIcon } from './dataManagementIcons';
import { ExportSection } from './components/ExportSection';
import { BackupSection } from './components/BackupSection';
import { ImportSection } from './components/ImportSection';
import { useExportWizard } from './hooks/useExportWizard';

// ── Component ──────────────────────────────────────────────────────

/** Data management screen — encrypted export wizard, import wizard with dry-run preview, and one-click backup status. */
/**
 * §B administrative gate (todo-global-saas-1.md): Data Management is an
 * administrative SaaS feature — it locks while the subscription is not
 * `active` while POS operational runtime continues through grace.
 */
export default function DataManagementScreen() {
  const { locked } = useAdminGate();
  if (locked) return <AdminLockedFeature />;
  return <DataManagementScreenContent />;
}

function DataManagementScreenContent() {
  const { l10n } = useLocalization();
  const { sessionToken: rawSessionToken } = useWorkspace();
  const sessionToken = rawSessionToken ?? '';
  const [importState, setImportState] = useState<ImportState>(INITIAL_IMPORT);
  const [backup, setBackup] = useState<BackupInfo>({
    lastBackup: null,
    lastBackupSize: null,
    backingUp: false,
  });
  const [activeTab, setActiveTab] = useState<'export' | 'import' | 'backup'>('export');
  const [showImportPw, setShowImportPw] = useState(false);
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const { addToast } = useToast();

  // ── Row flash animation ─────────────────────────────────────────
  // Track recently-updated sections for a brief green background pulse.
  const [flashRows, setFlashRows] = useState<Map<string, 'updated'>>(new Map());
  const flashTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const triggerFlash = useCallback((key: string) => {
    setFlashRows((prev) => {
      const next = new Map(prev);
      next.set(key, 'updated');
      return next;
    });
    const existing = flashTimeoutsRef.current.get(key);
    if (existing) clearTimeout(existing);
    const tid = setTimeout(() => {
      setFlashRows((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      flashTimeoutsRef.current.delete(key);
    }, FLASH_DURATION);
    flashTimeoutsRef.current.set(key, tid);
  }, []);

  // Cleanup flash timeouts on unmount.
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    return () => {
      flashTimeoutsRef.current.forEach((tid) => clearTimeout(tid));
      flashTimeoutsRef.current.clear();
    };
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps */

  // ── Refs to hold latest form state so callbacks don't depend on
  //     keystroke-level state (which would defeat useCallback).
  const importStateRef = useRef(importState);
  importStateRef.current = importState;

  // ── Export wizard state machine -> hooks/useExportWizard (state owns behavior,
  //     the child stays presentational; the props below are unchanged).
  const {
    exportState,
    setExportState,
    showExportPw,
    setShowExportPw,
    toggleType,
    toggleAll,
    startExport,
    confirmExport,
    resetExport,
  } = useExportWizard({ sessionToken, triggerFlash });


  // ── Load backup status on mount ─────────────────────────────────

  useEffect(() => {
    // NOT a designed gradation. The three lines this replaced called the shape
    // "ADR #7 conditional scoping", as if falling back were the plan. Measured, it is
    // a hole: the workspace token is NOT guaranteed for an authenticated owner. It is
    // minted only when an instance is resolvable — ui/src/contexts/WorkspaceContext.tsx
    // :469-473 bails without ever minting one, :463 bails without a user id, and :215,
    // :274, :319, :507 null an EXISTING token while the shell and this screen stay
    // mounted. So the else branch is reachable in a normal install, not a corner, and
    // it calls get_backup_status, which checks nothing: permissions::DATA_EXPORT is
    // skipped here and at :262. This page's requiredRole: 'owner' gate
    // (features/settings/register.tsx:31) is a DIFFERENT credential — AppShell.tsx:368
    // reads session?.role_name, never this token — so passing the gate proves nothing
    // about holding one. Ledger: scripts/verify-scoped-coverage.sh:57, allowlisted at
    // :100 alongside create_backup. Left OPEN on purpose: gating it would deny backup
    // to installs that can never hold a token (offline, no admin instance). It is now
    // LOUD — event backup_ungated_no_session in crates/oz-bridge/src/data.rs — and
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
        setBackup((prev) => ({ ...prev, lastBackup: null }));
        addToast({ message: l10n.getString('data-mgmt-toast-backup-status-fail'), type: 'error' });
      });
    // addToast and l10n stay excluded, as the original comment said -- but the reason is now
    // narrower than "they are stable": l10n is NOT reliably stable in this codebase
    // (FastPINOverlay.tsx:334 documents an infinite re-render loop from it), so listing it here
    // would refetch backup status on every locale change. sessionToken is the one that must be
    // present, because it selects which command runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToken]);

  // ── Backup handlers ─────────────────────────────────────────────

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


  // ── Import flow ─────────────────────────────────────────────────

  const handleFileSelect = useCallback(async () => {
    try {
      const filePath = await pickImportFile();
      if (!filePath) return;
      setImportState((prev) => ({
        ...prev,
        selectedFile: filePath,
        metadata: null,
        error: null,
        password: '',
        step: 'analysing',
      }));
    } catch {
      addToast({ message: l10n.getString('data-mgmt-toast-file-picker-fail'), type: 'error' });
    }
  }, [addToast, l10n]);

  const handleAnalyse = useCallback(async () => {
    const is = importStateRef.current;
    if (!is.password) {
      addToast({ message: l10n.getString('data-mgmt-toast-import-enter-password'), type: 'error' });
      return;
    }
    if (!is.selectedFile) {
      addToast({ message: l10n.getString('data-mgmt-toast-import-no-file'), type: 'error' });
      return;
    }

    setImportState((prev) => ({ ...prev, progress: 10, error: null, analysing: true }));

    try {
      const preview = await importPreview(sessionToken, is.selectedFile, is.password);
      setImportState((prev) => ({
        ...prev,
        analysing: false,
        step: 'preview',
        progress: 30,
        metadata: {
          name: preview.storeName,
          version: preview.appVersion,
          types: preview.types,
          created: preview.createdAt,
        },
        dryRun: {
          added:
            preview.categoryCount +
            preview.productCount +
            (preview.saleCount ?? 0) +
            (preview.customerCount ?? 0) +
            (preview.userCount ?? 0) +
            (preview.settingCount ?? 0),
          updated: 0,
          skipped: 0,
        },
      }));
      triggerFlash('import-preview');
    } catch (err) {
      setImportState((prev) => ({
        ...prev,
        analysing: false,
        error: l10nErrorMessage(err, l10n, 'data-mgmt-toast-import-fail'),
      }));
    }
  }, [addToast, l10n, sessionToken, triggerFlash]);

  const startImport = useCallback(async () => {
    const is = importStateRef.current;
    if (!is.selectedFile || !is.password) {
      addToast({ message: l10n.getString('data-mgmt-toast-import-enter-password'), type: 'error' });
      return;
    }

    setShowImportConfirm(true);
  }, [addToast, l10n]);

  const confirmImport = useCallback(async () => {
    setShowImportConfirm(false);
    const is = importStateRef.current;
    if (!is.selectedFile || !is.password) {
      addToast({ message: l10n.getString('data-mgmt-toast-import-enter-password'), type: 'error' });
      return;
    }

    setImportState((prev) => ({ ...prev, step: 'importing', progress: 50, error: null }));

    try {
      // Execute import (preview already done in analyse step)
      const result = await importData(sessionToken, is.selectedFile, is.password);

      setImportState((prev) => ({
        ...prev,
        progress: 100,
        dryRun: {
          added:
            result.productsImported +
            result.categoriesImported +
            result.salesImported +
            result.customersImported +
            result.usersImported +
            result.settingsImported,
          updated: 0,
          skipped: 0,
        },
        step: 'done',
      }));
      triggerFlash('import-done');
      addToast({ message: l10n.getString('data-mgmt-toast-import-success'), type: 'success' });
    } catch (err) {
      setImportState((prev) => ({
        ...prev,
        step: 'preview',
        error: l10nErrorMessage(err, l10n, 'data-mgmt-toast-import-fail'),
      }));
      addToast({ message: l10nErrorMessage(err, l10n, 'data-mgmt-toast-import-fail'), type: 'error' });
    }
  }, [addToast, l10n, sessionToken, triggerFlash]);

  const resetImport = useCallback(() => {
    setImportState(INITIAL_IMPORT);
  }, []);

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="data-mgmt">
      <ConfirmDialog
        open={showImportConfirm}
        title={l10n.getString('data-mgmt-import-confirm-title')}
        message={l10n.getString('data-mgmt-import-confirm-message')}
        variant="danger"
        onConfirm={confirmImport}
        onCancel={() => setShowImportConfirm(false)}
      />
      <div className="data-mgmt-header">
        <Localized id="data-mgmt-title">
          <h1 className="data-mgmt-title">Data Management</h1>
        </Localized>
      </div>

      {/* ── Tab bar ────────────────────────────────── */}
      <div className="data-mgmt-tabs" role="tablist" aria-label={l10n.getString('data-mgmt-tabs-aria')}>
        {(['export', 'import', 'backup'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            className={`data-mgmt-tab ${activeTab === tab ? 'data-mgmt-tab--active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            <span className="data-mgmt-tab-icon" aria-hidden="true">{tabIcon(tab)}</span>
            {' '}
            <Localized id={`data-mgmt-tab-${tab}`}>
              <span>{tab.charAt(0).toUpperCase() + tab.slice(1)}</span>
            </Localized>
          </button>
        ))}
      </div>

      {/* ── Export tab ─────────────────────────────── */}
      {activeTab === 'export' && (
        <ExportSection
          exportState={exportState}
          showExportPw={showExportPw}
          onToggleAll={toggleAll}
          onToggleType={toggleType}
          onStartExport={startExport}
          onConfirmExport={confirmExport}
          onResetExport={resetExport}
          onFieldChange={(key, value) => setExportState((prev) => ({ ...prev, [key]: value }))}
          onBack={() => setExportState((prev) => ({ ...prev, step: 'select' }))}
          onTogglePassword={() => setShowExportPw((p) => !p)}
        />
      )}

      {/* ── Import tab ─────────────────────────────── */}
      {activeTab === 'import' && (
        <ImportSection
          importState={importState}
          flashRows={flashRows}
          showImportPw={showImportPw}
          onFileSelect={handleFileSelect}
          onPasswordChange={(value) => setImportState((prev) => ({ ...prev, password: value }))}
          onTogglePassword={() => setShowImportPw((p) => !p)}
          onAnalyse={handleAnalyse}
          onStartImport={startImport}
          onReset={resetImport}
        />
      )}

      {/* ── Backup tab ──────────────────────────────────────── */}
      {activeTab === 'backup' && (
        <BackupSection
          backup={backup}
          flashRows={flashRows}
          onBackup={handleBackup}
        />
      )}
    </div>
  );
}
