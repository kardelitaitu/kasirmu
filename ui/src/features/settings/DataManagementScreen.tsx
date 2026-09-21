//! Data Management screen — Settings → Data Management
//!
//! Three sections:
//! - **Export wizard**: pick data types to export, date range, password field, progress indicator
//! - **Import wizard**: pick a .kasirpkg file, preview metadata, dry-run diff table, confirm
//! - **Backup status**: last backup timestamp, one-click snapshot

import { useState } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SegmentedTabs } from '@/components';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import AdminLockedFeature from '@/components/AdminLockedFeature';
import { useAdminGate } from '@/contexts/SubscriptionContext';
import './DataManagementScreen.css';
import { useFlashRows } from './hooks/useFlashRows';
import { useBackupStatus } from './hooks/useBackupStatus';
import { tabIcon } from './dataManagementIcons';
import { ExportSection } from './components/ExportSection';
import { BackupSection } from './components/BackupSection';
import { ImportSection } from './components/ImportSection';
import { useExportWizard } from './hooks/useExportWizard';
import { useImportWizard } from './hooks/useImportWizard';

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
  const [activeTab, setActiveTab] = useState<'export' | 'import' | 'backup'>('export');

  // ── Row flash animation -> hooks/useFlashRows. The map is shared with the
  //     import wizard rows, so the backup hook below is wired to the same trigger.
  const { flashRows, triggerFlash } = useFlashRows();

  // ── Refs to hold latest form state so callbacks don't depend on
  //     keystroke-level state (which would defeat useCallback).
  // [hook] Import wizard state machine -> hooks/useImportWizard. The state owns behavior,
  // the child stays presentational, and the props passed below are unchanged.
  const {
    importState,
    setImportState,
    showImportPw,
    setShowImportPw,
    showImportConfirm,
    setShowImportConfirm,
    handleFileSelect,
    handleAnalyse,
    startImport,
    confirmImport,
    resetImport,
  } = useImportWizard({ sessionToken, triggerFlash });

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

  // ── Backup status + one-click snapshot -> hooks/useBackupStatus. Same commands,
  //     same deps, and the security notes travel with the code they describe.
  const { backup, handleBackup } = useBackupStatus({ sessionToken, triggerFlash });

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
      {/* The underline strip this used to draw (`.data-mgmt-tab::after`, an
          accent rule that widened under the active tab) is replaced by the
          shared segmented control, so all three segments are one sliding thumb.
          The icons ride inside the segment, spaced by the control's own gap. */}
      <SegmentedTabs
        className="data-mgmt-tabs"
        ariaLabel={l10n.getString('data-mgmt-tabs-aria')}
        items={(['export', 'import', 'backup'] as const).map((tab) => ({
          value: tab,
          label: (
            <>
              <span className="data-mgmt-tab-icon" aria-hidden="true">{tabIcon(tab)}</span>
              <Localized id={`data-mgmt-tab-${tab}`}>
                <span>{tab.charAt(0).toUpperCase() + tab.slice(1)}</span>
              </Localized>
            </>
          ),
        }))}
        activeValue={activeTab}
        onSelect={setActiveTab}
      />

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
