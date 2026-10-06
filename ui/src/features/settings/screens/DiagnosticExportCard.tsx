import { useState, useCallback } from 'react';
import { Localized } from '@fluent/react';
import { Button } from '@/components/Button';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import {
  exportDiagnostics,
  pickDiagnosticExportPath,
  type DiagnosticExportResult,
} from '@/api/system';
import { copyCacheToUri, isContentUri } from '@/api/file-bridge';
import './DiagnosticExportCard.css';

/**
 * Diagnostic Export Card in Settings -> System Diagnostics.
 *
 * Generates an encrypted/deflated `.zip` containing sanitized system telemetry,
 * sync engine health, and recent application logs for technical support.
 */
export function DiagnosticExportCard() {
  const { sessionToken } = useWorkspace();

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DiagnosticExportResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleExport = useCallback(async () => {
    if (!sessionToken) return;

    setErrorMessage(null);
    setResult(null);

    try {
      const chosenPath = await pickDiagnosticExportPath();
      if (!chosenPath) return; // User cancelled

      setLoading(true);

      const res = await exportDiagnostics(sessionToken, chosenPath);

      // On Android / mobile, if target is content URI, move bytes from cache
      if (isContentUri(chosenPath)) {
        await copyCacheToUri(res.path, chosenPath);
        res.path = chosenPath;
      }

      setResult(res);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sessionToken]);

  const sizeMb = result ? (result.sizeBytes / (1024 * 1024)).toFixed(2) : '0';

  return (
    <div className="diagnostic-export-card" data-testid="diagnostic-export-card">
      <div className="diagnostic-export-header">
        <div>
          <h2 className="diagnostic-export-title">
            <Localized id="settings-diagnostics-export-title">
              Diagnostic Package Export
            </Localized>
          </h2>
          <p className="diagnostic-export-subtitle">
            <Localized id="settings-diagnostics-export-subtitle">
              Generate a sanitized .zip archive of system logs, sync health, and hardware state for technical support.
            </Localized>
          </p>
        </div>
      </div>

      <div className="diagnostic-export-body">
        <div className="diagnostic-export-action">
          <Button
            variant="primary"
            loading={loading}
            onClick={handleExport}
            data-testid="diagnostic-export-btn"
          >
            <Localized id="settings-diagnostics-export-btn">
              Export Diagnostic Logs
            </Localized>
          </Button>
        </div>

        {loading && (
          <p className="diagnostic-export-hint" role="status">
            <Localized id="settings-diagnostics-export-progress">
              Generating diagnostic archive…
            </Localized>
          </p>
        )}

        {result && (
          <div className="diagnostic-export-feedback diagnostic-export-feedback--success" role="status">
            <p>
              <Localized id="settings-diagnostics-export-success" vars={{ size: sizeMb }}>
                Diagnostic archive exported successfully ({sizeMb} MB).
              </Localized>
            </p>
            <p className="diagnostic-export-path-info">
              {result.path} ({result.filesIncluded.length} files included)
            </p>
          </div>
        )}

        {errorMessage && (
          <div className="diagnostic-export-feedback diagnostic-export-feedback--error" role="alert">
            <p>
              <Localized id="settings-diagnostics-export-error">
                Diagnostic export failed.
              </Localized>
            </p>
            <p className="diagnostic-export-error-detail">{errorMessage}</p>
          </div>
        )}
      </div>
    </div>
  );
}
