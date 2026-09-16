import { useCallback, useRef, useState } from 'react';
import { useLocalization } from '@fluent/react';
import { exportData, pickExportPath } from '@/api/data';
import { useToast } from '@/frontend/shared/Toast';
import { l10nErrorMessage } from '@/utils/app-error';
import { DATA_TYPES, INITIAL_EXPORT, type DataType, type ExportState } from '../dataManagementModel';

//! Export-wizard state machine for Settings -> Data Management.
//!
//! Owns the four-step export flow (`select -> encrypt -> exporting -> done`) that
//! previously lived inline in `DataManagementScreen.tsx`: the `exportState` and
//! `showExportPw` atoms, the render-phase `exportStateRef` mirror, the
//! `exportingRef` double-click guard, and the five callbacks the screen passes to
//! `components/ExportSection.tsx`.
//!
//! Behaviour-preserving extraction: every guard, clamp, reset and `useCallback`
//! dependency array is carried across verbatim. The hook owns behavior; the child
//! stays presentational and its prop contract is unchanged — the screen still hands
//! down the same nine props, so `setExportState` / `setShowExportPw` are returned
//! raw rather than wrapped, which keeps the call site byte-identical.
//! Nothing here calls `invoke()`; the two `api/data` wrappers moved with the code
//! that already called them.
export interface UseExportWizardParams {
  /** Selects the scoped vs unscoped `export_data` command, as in the screen. */
  sessionToken: string;
  /** The screen's shared row-flash writer — it stays in the screen. */
  triggerFlash: (key: string) => void;
}


/** The export wizard's state and callbacks, exactly as the screen passed them down. */
export function useExportWizard({ sessionToken, triggerFlash }: UseExportWizardParams) {
  const { l10n } = useLocalization();
  const { addToast } = useToast();

  const [exportState, setExportState] = useState<ExportState>(INITIAL_EXPORT);
  const [showExportPw, setShowExportPw] = useState(false);

  // ── Ref to hold latest form state so callbacks don't depend on
  //     keystroke-level state (which would defeat useCallback).
  const exportStateRef = useRef(exportState);
  exportStateRef.current = exportState;

  // Guard ref to prevent double-clicks during export.
  const exportingRef = useRef(false);

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

  return {
    exportState,
    setExportState,
    showExportPw,
    setShowExportPw,
    toggleType,
    toggleAll,
    startExport,
    confirmExport,
    resetExport,
  };
}
