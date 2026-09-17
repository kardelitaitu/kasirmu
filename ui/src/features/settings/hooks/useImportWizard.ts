//! Import-wizard state machine for Settings -> Data Management.
//!
//! Owns the four-step import flow (select -> analysing -> preview -> importing -> done)
//! that previously lived inline in `DataManagementScreen.tsx`: the `importState`,
//! `showImportPw` and `showImportConfirm` atoms, the render-phase `importStateRef`
//! mirror, and the five callbacks the screen passes to `components/ImportSection.tsx`
//! and to its own ConfirmDialog.
//!
//! Behaviour-preserving extraction, the same method as ./useExportWizard: every guard,
//! clamp, reset and `useCallback` dependency array crossed verbatim. `setImportState`,
//! `setShowImportPw` and `setShowImportConfirm` are returned RAW so the screen inline
//! arrows at both call sites stay byte-identical and the child prop contract is untouched.
//! `flashRows` stays in the screen - it is shared with the backup panel.
//! No mount fetch moved in; the three `api/data` wrappers travelled with the code that
//! already called them, and nothing here calls `invoke()`.
import { useCallback, useRef, useState } from 'react';
import { useLocalization } from '@fluent/react';
import { importData, importPreview, pickImportFile } from '@/api/data';
import { useToast } from '@/components/Toast';
import { l10nErrorMessage } from '@/utils/app-error';
import { INITIAL_IMPORT, type ImportState } from '../dataManagementModel';

export interface UseImportWizardParams {
  /** Selects the scoped command, exactly as in the screen. */
  sessionToken: string;
  /** The screen shared row-flash writer - it stays in the screen. */
  triggerFlash: (key: string) => void;
}

/** The import wizard state and callbacks, exactly as the screen passed them down. */
export function useImportWizard({ sessionToken, triggerFlash }: UseImportWizardParams) {
  const { l10n } = useLocalization();
  const { addToast } = useToast();

  const [importState, setImportState] = useState<ImportState>(INITIAL_IMPORT);
  const [showImportPw, setShowImportPw] = useState(false);
  const [showImportConfirm, setShowImportConfirm] = useState(false);

  // ── Ref to hold latest form state so callbacks do not depend on
  //     keystroke-level state (which would defeat useCallback).
  const importStateRef = useRef(importState);
  importStateRef.current = importState;

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

  return {
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
  };
}
