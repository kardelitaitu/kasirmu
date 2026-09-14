/**
 * ImportSection — the "Import" tab panel of the Data management screen: the .ozpkg file
 * picker, the decryption-password step, the metadata preview, the importing / dry-run card
 * and the completion card.
 *
 * Extracted from DataManagementScreen.tsx by DataManagement lane slice 4; the markup was
 * at :636-851 of the 864-line file and moved verbatim, indentation included, so it diffs
 * clean against its old lines. Eight attribute values changed, and only those eight: every
 * handler the JSX called by name in the screen (handleFileSelect, handleAnalyse,
 * startImport, resetImport x3, the setShowImportPw toggle and the setImportState password
 * edit) is now a callback prop bound at the call site. No class, no conditional guard, no
 * Localized id and no element order moved, and no Fluent key was added — every id here was
 * already resolved from the screen.
 *
 * PRESENTATIONAL, like BackupSection.tsx, and for the same measured reason: state and
 * handlers stay in the screen. This flow is not mount-independent — handleFileSelect feeds
 * importPreview and the 'import-preview' flash, startImport opens the ConfirmDialog that
 * renders OUTSIDE this panel at DataManagementScreen.tsx:397-404, and the flash map is
 * shared with the backup panel. So this file owns no useState, no useEffect and no
 * invoke(); the api layer stays behind the screen.
 *
 * Registered in screenExtraction.test.ts (additionalTsx) because the data-mgmt-* classes it
 * uses — file-picker / file-dropzone / file-icon, meta*, dry-run*, error, progress,
 * done-text, input, label, field — are styled by DataManagementScreen.css.
 */
import { Localized, useLocalization } from '@fluent/react';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Spinner } from '@/components/Spinner';
import type { ImportState } from '../dataManagementModel';
import { checkIcon, eyeIcon, eyeOffIcon, folderIcon } from '../dataManagementIcons';

interface ImportSectionProps {
  /** The screen's import wizard state; read-only here. */
  importState: ImportState;
  /** The screen's flash map; also read by the backup panel, so it stays there. */
  flashRows: Map<string, 'updated'>;
  showImportPw: boolean;
  onFileSelect: () => void;
  onPasswordChange: (value: string) => void;
  onTogglePassword: () => void;
  onAnalyse: () => void;
  onStartImport: () => void;
  onReset: () => void;
}

/** Renders the five import-wizard steps. Owns no state. */
export function ImportSection({ importState, flashRows, showImportPw, onFileSelect, onPasswordChange, onTogglePassword, onAnalyse, onStartImport, onReset }: ImportSectionProps) {
  const { l10n } = useLocalization();

  return (
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
                    <Button variant="secondary" onClick={onFileSelect}>
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
                      onChange={(e) => onPasswordChange(e.target.value)}
                    />
                    <button
                      type="button"
                      className="data-mgmt-password-toggle"
                      onClick={onTogglePassword}
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
                  <Button variant="ghost" onClick={onReset} disabled={importState.analysing}>
                    <Localized id="data-mgmt-import-cancel">Cancel</Localized>
                  </Button>
                  <Button variant="primary" loading={importState.analysing} onClick={onAnalyse} disabled={!importState.password}>
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
                  <Button variant="ghost" onClick={onReset}>
                    <Localized id="data-mgmt-import-cancel">Cancel</Localized>
                  </Button>
                  <Button variant="primary" onClick={onStartImport}>
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
                  <Button variant="primary" onClick={onReset}>
                    <Localized id="data-mgmt-import-new-import">New import</Localized>
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </div>
  );
}
