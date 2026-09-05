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
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Spinner } from '@/components/Spinner';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/frontend/shared/Toast';
import {
  getBackupStatus,
  getBackupStatusScoped,
  createBackup,
  createBackupScoped,
  exportData,
  importPreview,
  importData,
  pickExportPath,
  pickImportFile,
} from '@/api/data';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { l10nErrorMessage } from '@/utils/app-error';
import './DataManagementScreen.css';

// ── Types ──────────────────────────────────────────────────────────

type DataType =
  | 'products'
  | 'categories'
  | 'sales'
  | 'customers'
  | 'users'
  | 'settings';

// ── SVG icon helpers ──────────────────────────────────────────────

const eyeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const eyeOffIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
    <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

const DATA_TYPES: { key: DataType; label: string; description: string }[] = [
  { key: 'products', label: 'Products', description: 'SKU, name, price, barcode, stock' },
  { key: 'categories', label: 'Categories', description: 'Category id, name, colour' },
  { key: 'sales', label: 'Sales', description: 'Sale header, line items, payments' },
  { key: 'customers', label: 'Customers', description: 'Name, email, phone, loyalty points' },
  { key: 'users', label: 'Users', description: 'Usernames, display names, roles (no passwords)' },
  { key: 'settings', label: 'Settings', description: 'Store config, receipts, feature flags' },
];

interface ExportState {
  selectedTypes: Set<DataType>;
  dateFrom: string;
  dateTo: string;
  password: string;
  passwordConfirm: string;
  step: 'select' | 'encrypt' | 'exporting' | 'done';
  progress: number;
  outputFile: string | null;
  error: string | null;
}

interface ImportState {
  selectedFile: string | null;
  metadata: { name: string; version: string; types: string[]; created: string } | null;
  password: string;
  step: 'select' | 'analysing' | 'preview' | 'importing' | 'done';
  analysing: boolean;
  progress: number;
  error: string | null;
  dryRun: { added: number; updated: number; skipped: number } | null;
}

interface BackupInfo {
  lastBackup: string | null;
  lastBackupSize: string | null | undefined;
  backingUp: boolean;
}

// ── Initial state ──────────────────────────────────────────────────

const INITIAL_EXPORT: ExportState = {
  selectedTypes: new Set(DATA_TYPES.map((t) => t.key)),
  dateFrom: '',
  dateTo: '',
  password: '',
  passwordConfirm: '',
  step: 'select',
  progress: 0,
  outputFile: null,
  error: null,
};

const INITIAL_IMPORT: ImportState = {
  selectedFile: null,
  metadata: null,
  password: '',
  step: 'select',
  analysing: false,
  progress: 0,
  error: null,
  dryRun: null,
};

// ── Tab / icon helpers ───────────────────────────────────────────

const ICON_PROPS = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function tabIcon(tab: 'export' | 'import' | 'backup'): React.ReactNode {
  switch (tab) {
    case 'export':
      return <svg {...ICON_PROPS}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>;
    case 'import':
      return <svg {...ICON_PROPS}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
    case 'backup':
      return <svg {...ICON_PROPS}><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>;
  }
}

function folderIcon(): React.ReactNode {
  return <svg {...ICON_PROPS} width={32} height={32}><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>;
}

function checkIcon(): React.ReactNode {
  return <svg {...ICON_PROPS}><polyline points="20 6 9 17 4 12"/></svg>;
}

// ── Component ──────────────────────────────────────────────────────

/** Data management screen — encrypted export wizard, import wizard with dry-run preview, and one-click backup status. */
export default function DataManagementScreen() {
  const { l10n } = useLocalization();
  const { sessionToken: rawSessionToken } = useWorkspace();
  const sessionToken = rawSessionToken ?? '';
  const [exportState, setExportState] = useState<ExportState>(INITIAL_EXPORT);
  const [importState, setImportState] = useState<ImportState>(INITIAL_IMPORT);
  const [backup, setBackup] = useState<BackupInfo>({
    lastBackup: null,
    lastBackupSize: null,
    backingUp: false,
  });
  const [activeTab, setActiveTab] = useState<'export' | 'import' | 'backup'>('export');
  const [showExportPw, setShowExportPw] = useState(false);
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
  const exportStateRef = useRef(exportState);
  exportStateRef.current = exportState;
  const importStateRef = useRef(importState);
  importStateRef.current = importState;

  // Guard ref to prevent double-clicks during export.
  const exportingRef = useRef(false);

  // ── Load backup status on mount ─────────────────────────────────

  useEffect(() => {
    // ADR #7 conditional scoping, matching exportData/importPreview/importData in this same
    // file (:305, :370, :426). get_backup_status_scoped enforces permissions::DATA_EXPORT;
    // the unscoped command takes no token at all.
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

  // ── Toggle data type selection ──────────────────────────────────

  const toggleType = useCallback((type: DataType) => {
    setExportState((prev) => {
      const next = new Set(prev.selectedTypes);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return { ...prev, selectedTypes: next };
    });
  }, []);

  const toggleAll = useCallback(() => {
    setExportState((prev) => {
      const allSelected = prev.selectedTypes.size === DATA_TYPES.length;
      if (allSelected) {
        return { ...prev, selectedTypes: new Set() };
      }
      return { ...prev, selectedTypes: new Set(DATA_TYPES.map((t) => t.key)) };
    });
  }, []);

  // ── Export flow ─────────────────────────────────────────────────

  const startExport = useCallback(() => {
    const es = exportStateRef.current;
    if (es.selectedTypes.size === 0) {
      addToast({ message: l10n.getString('data-mgmt-toast-export-select-type'), type: 'error' });
      return;
    }
    setExportState((prev) => ({ ...prev, step: 'encrypt', error: null }));
  }, [addToast, l10n]);

  const confirmExport = useCallback(async () => {
    const es = exportStateRef.current;
    if (es.password.length < 8) {
      addToast({ message: l10n.getString('data-mgmt-toast-export-password-length'), type: 'error' });
      return;
    }
    if (es.password !== es.passwordConfirm) {
      addToast({ message: l10n.getString('data-mgmt-toast-export-password-match'), type: 'error' });
      return;
    }

    if (exportingRef.current) return;
    exportingRef.current = true;

    setExportState((prev) => ({ ...prev, step: 'exporting', progress: 10, error: null }));

    try {
      const filePath = await pickExportPath();
      if (!filePath) {
        setExportState((prev) => ({ ...prev, step: 'encrypt', progress: 0 }));
        return;
      }

      setExportState((prev) => ({ ...prev, progress: 30 }));

      const result = await exportData(sessionToken, {
        types: Array.from(es.selectedTypes),
        password: es.password,
        outputPath: filePath,
        ...(es.dateFrom ? { dateFrom: es.dateFrom } : {}),
        ...(es.dateTo ? { dateTo: es.dateTo } : {}),
      });

      setExportState((prev) => ({
        ...prev,
        step: 'done',
        progress: 100,
        outputFile: result.path,
      }));
      triggerFlash('export-done');
      addToast({ message: l10n.getString('data-mgmt-toast-export-success'), type: 'success' });
    } catch (err) {
      setExportState((prev) => ({
        ...prev,
        step: 'encrypt',
        error: l10nErrorMessage(err, l10n, 'data-mgmt-toast-export-fail'),
      }));
      addToast({ message: l10n.getString('data-mgmt-toast-export-fail'), type: 'error' });
    } finally {
      exportingRef.current = false;
    }
  }, [addToast, l10n, sessionToken, triggerFlash]);

  const resetExport = useCallback(() => {
    setExportState(INITIAL_EXPORT);
  }, []);

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
        <div key="export" className="data-mgmt-tabpanel" role="tabpanel" aria-label={l10n.getString('data-mgmt-export-wizard-aria')}>
          {exportState.step === 'select' && (
            <Card shadow="sm">
              <div className="data-mgmt-section">
                <Localized id="data-mgmt-export-title">
                  <h2 className="data-mgmt-section-title">Select data to export</h2>
                </Localized>

                <div className="data-mgmt-types" role="group" aria-label={l10n.getString('data-mgmt-export-types-aria')}>
                  <label
                    className="data-mgmt-type-checkbox data-mgmt-type-checkbox--all"
                    htmlFor="type-select-all"
                  >
                    <input
                      id="type-select-all"
                      type="checkbox"
                      aria-label={l10n.getString('data-mgmt-export-select-all')}
                      checked={exportState.selectedTypes.size === DATA_TYPES.length}
                      onChange={toggleAll}
                    />
                    <Localized id="data-mgmt-export-select-all">
                      <span className="data-mgmt-type-label">Select all / none</span>
                    </Localized>
                  </label>

                  {DATA_TYPES.map((dt) => (
                    <label
                      key={dt.key}
                      className="data-mgmt-type-checkbox"
                      htmlFor={`type-${dt.key}`}
                    >
                      <input
                        id={`type-${dt.key}`}
                        type="checkbox"
                        aria-label={l10n.getString(`data-mgmt-type-${dt.key}`)}
                        checked={exportState.selectedTypes.has(dt.key)}
                        onChange={() => toggleType(dt.key)}
                      />
                      <div className="data-mgmt-type-info">
                        <Localized id={`data-mgmt-type-${dt.key}`}>
                          <span className="data-mgmt-type-label">{dt.label}</span>
                        </Localized>
                        <Localized id={`data-mgmt-type-${dt.key}-desc`}>
                          <span className="data-mgmt-type-desc">{dt.description}</span>
                        </Localized>
                      </div>
                    </label>
                  ))}
                </div>

                <div className="data-mgmt-date-range">
                  <div className="data-mgmt-field">
                    <Localized id="data-mgmt-export-date-from">
                      <label className="data-mgmt-label" htmlFor="export-date-from">From</label>
                    </Localized>
                    <input
                      id="export-date-from"
                      className="data-mgmt-input"
                      type="date"
                      value={exportState.dateFrom}
                      onChange={(e) => setExportState((prev) => ({ ...prev, dateFrom: e.target.value }))}
                    />
                  </div>
                  <div className="data-mgmt-field">
                    <Localized id="data-mgmt-export-date-to">
                      <label className="data-mgmt-label" htmlFor="export-date-to">To</label>
                    </Localized>
                    <input
                      id="export-date-to"
                      className="data-mgmt-input"
                      type="date"
                      value={exportState.dateTo}
                      onChange={(e) => setExportState((prev) => ({ ...prev, dateTo: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="data-mgmt-actions">
                  <Button variant="primary" onClick={startExport}>
                    <Localized id="data-mgmt-export-next">Next: Encryption</Localized>
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {exportState.step === 'encrypt' && (
            <Card shadow="sm">
              <div className="data-mgmt-section">
                <Localized id="data-mgmt-encrypt-title">
                  <h2 className="data-mgmt-section-title">Set encryption password</h2>
                </Localized>
                <Localized id="data-mgmt-encrypt-desc">
                  <p className="data-mgmt-section-desc">
                    The export file will be encrypted with AES-256-GCM. Choose a strong
                    password — you will need it to import the data later.
                  </p>
                </Localized>

                <div className="data-mgmt-form">
                  <div className="data-mgmt-field data-mgmt-field--horizontal">
                    <Localized id="data-mgmt-encrypt-password">
                      <label className="data-mgmt-label" htmlFor="export-password">Password</label>
                    </Localized>
                    <div className="data-mgmt-password-wrapper">
                      <input
                        id="export-password"
                        className="data-mgmt-input"
                        type={showExportPw ? 'text' : 'password'}
                        autoComplete="off"
                        placeholder={l10n.getString('data-mgmt-encrypt-password-placeholder')}
                        value={exportState.password}
                        onChange={(e) => setExportState((prev) => ({ ...prev, password: e.target.value }))}
                      />
                      <button
                        type="button"
                        className="data-mgmt-password-toggle"
                        onClick={() => setShowExportPw((p) => !p)}
                        aria-label={l10n.getString(showExportPw ? 'data-mgmt-password-hide-aria' : 'data-mgmt-password-show-aria')}
                      >
                        {showExportPw ? eyeOffIcon() : eyeIcon()}
                      </button>
                    </div>
                  </div>
                  <div className="data-mgmt-field data-mgmt-field--horizontal">
                    <Localized id="data-mgmt-encrypt-confirm">
                      <label className="data-mgmt-label" htmlFor="export-password-confirm">Confirm password</label>
                    </Localized>
                    <div className="data-mgmt-password-wrapper">
                      <input
                        id="export-password-confirm"
                        className="data-mgmt-input data-mgmt-input--no-toggle"
                        type={showExportPw ? 'text' : 'password'}
                        autoComplete="off"
                        placeholder={l10n.getString('data-mgmt-encrypt-confirm-placeholder')}
                        value={exportState.passwordConfirm}
                        onChange={(e) => setExportState((prev) => ({ ...prev, passwordConfirm: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>

                <div className="data-mgmt-actions">
                  <Button variant="ghost" onClick={() => setExportState((prev) => ({ ...prev, step: 'select' }))}>
                    <Localized id="data-mgmt-encrypt-back">Back</Localized>
                  </Button>
                  <Button variant="primary" onClick={confirmExport}>
                    <Localized id="data-mgmt-encrypt-export">Export</Localized>
                  </Button>
                </div>

                {exportState.error && (
                  <div className="data-mgmt-error" role="alert">{exportState.error}</div>
                )}
              </div>
            </Card>
          )}

          {(exportState.step === 'exporting' || exportState.step === 'done') && (
            <Card shadow="sm">
              <div className="data-mgmt-section">
                {exportState.step === 'exporting' ? (
                  <Localized id="data-mgmt-export-exporting">
                    <h2 className="data-mgmt-section-title">Exporting…</h2>
                  </Localized>
                ) : (
                  <Localized id="data-mgmt-export-complete">
                    <h2 className="data-mgmt-section-title">Export complete</h2>
                  </Localized>
                )}

                <div className="data-mgmt-progress">
                  {exportState.step === 'exporting' ? (
                    <Spinner size="md" />
                  ) : (
                    <span className="data-mgmt-progress-done" aria-label={l10n.getString('data-mgmt-export-complete-aria')}>{checkIcon()}</span>
                  )}
                </div>

                {exportState.step === 'done' && (
                  <>
                    <p className="data-mgmt-done-text">
                      <Localized id="data-mgmt-export-done-text">Data exported to:</Localized> <code>{exportState.outputFile}</code>
                    </p>
                    <p className="data-mgmt-done-text">
                      <Localized id="data-mgmt-export-selected-types">Selected types:</Localized>{' '}
                      {Array.from(exportState.selectedTypes).join(', ')}
                    </p>
                    <div className="data-mgmt-actions">
                      <Button variant="primary" onClick={resetExport}>
                        <Localized id="data-mgmt-export-new-export">New export</Localized>
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── Import tab ─────────────────────────────── */}
      {activeTab === 'import' && (
        <div key="import" className="data-mgmt-tabpanel" role="tabpanel" aria-label={l10n.getString('data-mgmt-import-wizard-aria')}>
          {importState.step === 'select' && (
            <Card shadow="sm">
              <div className="data-mgmt-section">
                <Localized id="data-mgmt-import-title">
                  <h2 className="data-mgmt-section-title">Select a backup file</h2>
                </Localized>
                <Localized id="data-mgmt-import-desc">
                  <p className="data-mgmt-section-desc">
                    Choose an encrypted .ozpkg file to import. The file must have been
                    created by OZ-POS export.
                  </p>
                </Localized>

                <div className="data-mgmt-file-picker">
                  <div className="data-mgmt-file-dropzone">
                    <span className="data-mgmt-file-icon">{folderIcon()}</span>
                    <Button variant="secondary" onClick={handleFileSelect}>
                      <Localized id="data-mgmt-import-browse">Browse files…</Localized>
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {importState.step === 'analysing' && (
            <Card shadow="sm">
              <div className="data-mgmt-section">
                <Localized id="data-mgmt-import-preview-title">
                  <h2 className="data-mgmt-section-title">Analyse backup file</h2>
                </Localized>

                <div className="data-mgmt-meta">
                  <div className="data-mgmt-meta-row">
                    <Localized id="data-mgmt-import-meta-file">
                      <span className="data-mgmt-meta-label">File</span>
                    </Localized>
                    <span className="data-mgmt-meta-value">{importState.selectedFile}</span>
                  </div>
                </div>

                <div className="data-mgmt-field data-mgmt-field--horizontal">
                  <Localized id="data-mgmt-import-password">
                    <label className="data-mgmt-label" htmlFor="import-password">Decryption password</label>
                  </Localized>
                  <div className="data-mgmt-password-wrapper">
                    <input
                      id="import-password"
                      className="data-mgmt-input"
                      type={showImportPw ? 'text' : 'password'}
                      autoComplete="off"
                      placeholder={l10n.getString('data-mgmt-import-password-placeholder')}
                      value={importState.password}
                      onChange={(e) => setImportState((prev) => ({ ...prev, password: e.target.value }))}
                    />
                    <button
                      type="button"
                      className="data-mgmt-password-toggle"
                      onClick={() => setShowImportPw((p) => !p)}
                      aria-label={l10n.getString(showImportPw ? 'data-mgmt-password-hide-aria' : 'data-mgmt-password-show-aria')}
                    >
                      {showImportPw ? eyeOffIcon() : eyeIcon()}
                    </button>
                  </div>
                </div>

                {importState.error && (
                  <div className="data-mgmt-error" role="alert">{importState.error}</div>
                )}

                <div className="data-mgmt-actions">
                  <Button variant="ghost" onClick={resetImport} disabled={importState.analysing}>
                    <Localized id="data-mgmt-import-cancel">Cancel</Localized>
                  </Button>
                  <Button variant="primary" loading={importState.analysing} onClick={handleAnalyse} disabled={!importState.password}>
                    <Localized id="data-mgmt-analyse-file">Analyse file</Localized>
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {importState.step === 'preview' && importState.metadata && (
            <Card shadow="sm">
              <div className="data-mgmt-section">
                <Localized id="data-mgmt-import-preview-title">
                  <h2 className="data-mgmt-section-title">Preview import</h2>
                </Localized>

                <div className={`data-mgmt-meta${flashRows.has('import-preview') ? ' data-mgmt-meta--flash' : ''}`}>
                  <div className="data-mgmt-meta-row">
                    <Localized id="data-mgmt-import-meta-file">
                      <span className="data-mgmt-meta-label">File</span>
                    </Localized>
                    <span className="data-mgmt-meta-value">{importState.selectedFile}</span>
                  </div>
                  <div className="data-mgmt-meta-row">
                    <Localized id="data-mgmt-import-meta-store">
                      <span className="data-mgmt-meta-label">Store</span>
                    </Localized>
                    <span>{importState.metadata.name}</span>
                  </div>
                  <div className="data-mgmt-meta-row">
                    <Localized id="data-mgmt-import-meta-version">
                      <span className="data-mgmt-meta-label">Version</span>
                    </Localized>
                    <span>{importState.metadata.version}</span>
                  </div>
                  <div className="data-mgmt-meta-row">
                    <Localized id="data-mgmt-import-meta-created">
                      <span className="data-mgmt-meta-label">Created</span>
                    </Localized>
                    <span>{new Date(importState.metadata.created).toLocaleString()}</span>
                  </div>
                  <div className="data-mgmt-meta-row">
                    <Localized id="data-mgmt-import-meta-contains">
                      <span className="data-mgmt-meta-label">Contains</span>
                    </Localized>
                    <span>{importState.metadata.types.join(', ')}</span>
                  </div>
                </div>

                <div className="data-mgmt-actions">
                  <Button variant="ghost" onClick={resetImport}>
                    <Localized id="data-mgmt-import-cancel">Cancel</Localized>
                  </Button>
                  <Button variant="primary" onClick={startImport}>
                    <Localized id="data-mgmt-import-start">Start import</Localized>
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {importState.step === 'importing' && (
            <Card shadow="sm">
              <div className="data-mgmt-section">
                {importState.dryRun ? (
                  <Localized id="data-mgmt-import-dry-run-complete">
                    <h2 className="data-mgmt-section-title">Dry-run complete — importing…</h2>
                  </Localized>
                ) : (
                  <Localized id="data-mgmt-import-analysing">
                    <h2 className="data-mgmt-section-title">Analysing file…</h2>
                  </Localized>
                )}

                <div className="data-mgmt-progress">
                  {importState.step === 'importing' ? (
                    <Spinner size="md" />
                  ) : (
                    <span className="data-mgmt-progress-done" aria-label={l10n.getString('data-mgmt-import-complete-aria')}>{checkIcon()}</span>
                  )}
                </div>

                {importState.dryRun && (
                  <div className={`data-mgmt-dry-run${flashRows.has('import-preview') ? ' data-mgmt-dry-run--flash' : ''}`}>
                    <Localized id="data-mgmt-import-dry-run-title">
                      <h3 className="data-mgmt-dry-run-title">Changes to be applied</h3>
                    </Localized>
                    <div className="data-mgmt-dry-run-grid">
                      <div className="data-mgmt-dry-run-item">
                        <span className="data-mgmt-dry-run-count">{importState.dryRun.added}</span>
                        <Localized id="data-mgmt-import-dry-run-added">
                          <span className="data-mgmt-dry-run-label">New items</span>
                        </Localized>
                      </div>
                      <div className="data-mgmt-dry-run-item">
                        <span className="data-mgmt-dry-run-count">{importState.dryRun.updated}</span>
                        <Localized id="data-mgmt-import-dry-run-updated">
                          <span className="data-mgmt-dry-run-label">Updated</span>
                        </Localized>
                      </div>
                      <div className="data-mgmt-dry-run-item">
                        <span className="data-mgmt-dry-run-count">{importState.dryRun.skipped}</span>
                        <Localized id="data-mgmt-import-dry-run-skipped">
                          <span className="data-mgmt-dry-run-label">Skipped</span>
                        </Localized>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}

          {importState.step === 'done' && (
            <Card shadow="sm">
              <div className="data-mgmt-section">
                <Localized id="data-mgmt-import-complete">
                  <h2 className="data-mgmt-section-title">Import complete</h2>
                </Localized>
                <Localized id="data-mgmt-import-done-text">
                  <p className="data-mgmt-done-text">
                    All data has been imported successfully.
                  </p>
                </Localized>
                {importState.dryRun && (
                  <p className="data-mgmt-done-text">
                    {l10n.getString('data-mgmt-import-done-summary', {
                      added: importState.dryRun.added,
                      updated: importState.dryRun.updated,
                      skipped: importState.dryRun.skipped,
                    })}
                  </p>
                )}
                <div className="data-mgmt-actions">
                  <Button variant="primary" onClick={resetImport}>
                    <Localized id="data-mgmt-import-new-import">New import</Localized>
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── Backup tab ─────────────────────────────── */}
      {activeTab === 'backup' && (
        <div key="backup" className="data-mgmt-tabpanel" role="tabpanel" aria-label={l10n.getString('data-mgmt-backup-status-aria')}>
          <Card shadow="sm">
            <div className="data-mgmt-section">
              <Localized id="data-mgmt-backup-title">
                <h2 className="data-mgmt-section-title">Database backup</h2>
              </Localized>
              <Localized id="data-mgmt-backup-desc">
                <p className="data-mgmt-section-desc">
                  Create an online snapshot of the current database. The backup runs
                  in the background and does not interrupt POS operations.
                </p>
              </Localized>

              <div className={`data-mgmt-backup-status${flashRows.has('backup') ? ' data-mgmt-backup-status--flash' : ''}`}>
                <div className="data-mgmt-backup-row">
                  <Localized id="data-mgmt-backup-label-last">
                    <span className="data-mgmt-label">Last backup</span>
                  </Localized>
                  <span className="data-mgmt-value">
                    {backup.lastBackup ?? l10n.getString('data-mgmt-backup-never')}
                  </span>
                </div>
                {backup.lastBackupSize && (
                  <div className="data-mgmt-backup-row">
                    <Localized id="data-mgmt-backup-label-size">
                      <span className="data-mgmt-label">Size</span>
                    </Localized>
                    <span className="data-mgmt-value">{backup.lastBackupSize}</span>
                  </div>
                )}
              </div>

              <div className="data-mgmt-actions">
                <Button
                  variant="primary"
                  loading={backup.backingUp}
                  onClick={handleBackup}
                >
                  {backup.backingUp ? (
                    <Localized id="data-mgmt-backup-backing-up">Backing up…</Localized>
                  ) : (
                    <Localized id="data-mgmt-backup-create">Create backup now</Localized>
                  )}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
