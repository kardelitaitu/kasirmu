/**
 * ExportSection - the "Export" tab panel of the Data management screen: the data-type
 * checklist, the date range, the AES-256-GCM password step and the exporting / done card.
 *
 * Extracted from DataManagementScreen.tsx by DataManagement lane slice 5; the markup was
 * at :434-632 of the 660-line file and moved verbatim, indentation included, so it diffs
 * clean against its old lines. ELEVEN attribute values changed, and only those eleven:
 * the five setExportState((prev) => ({ ...prev, FIELD })) writes (dateFrom, dateTo,
 * password, passwordConfirm and the Back button step write) collapsed onto ONE narrow
 * dispatch prop, onFieldChange, so the merge rule stays a single expression at the call
 * site instead of five near-identical callbacks; the setShowExportPw toggle became
 * onTogglePassword; and the five screen-named handlers (toggleAll, toggleType,
 * startExport, confirmExport, resetExport) became props. No class, no element id,
 * no conditional guard, no Localized id - neither the 21 static ones this panel resolves
 * (all present in BOTH settings.ftl and settings.id.ftl) nor the dynamic
 * data-mgmt-type-${dt.key} / -desc family - and no element order moved. No Fluent key
 * was added.
 *
 * PRESENTATIONAL, like BackupSection.tsx and ImportSection.tsx: state and handlers stay
 * in the screen. The four-step machine (exportState.step: select -> encrypt -> exporting
 * -> done) is still advanced by the screen, not here - startExport, confirmExport and
 * resetExport are the screen's, and so are exportingRef, the toasts and triggerFlash
 * ("export-done"). The child only renders whichever guard it is given. No useState, no
 * useEffect, no invoke() and no "@/api" import lives in this file.
 *
 * Registered in screenExtraction.test.ts (additionalTsx) because the data-mgmt-* classes
 * it uses - types, type-checkbox, type-checkbox--all, type-info, type-label, type-desc,
 * date-range, form, password-wrapper, password-toggle, input, input--no-toggle, progress,
 * progress-done, done-text, error, actions, section, section-title, tabpanel, label -
 * are styled by DataManagementScreen.css.
 */
import { Localized, useLocalization } from '@fluent/react';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Spinner } from '@/components/Spinner';
import { requiredLocalized } from '@/frontend/shared';
import { DATA_TYPES, type DataType, type ExportState } from '../dataManagementModel';
import { checkIcon, eyeIcon, eyeOffIcon } from '../dataManagementIcons';

interface ExportSectionProps {
  /** The screen's export wizard state; read-only here. */
  exportState: ExportState;
  showExportPw: boolean;
  /** Narrow dispatch: the screen merges the patch into exportState. */
  onFieldChange: (patch: Partial<ExportState>) => void;
  onToggleAll: () => void;
  onToggleType: (type: DataType) => void;
  onTogglePassword: () => void;
  onStartExport: () => void;
  onConfirmExport: () => void;
  onResetExport: () => void;
}

/** Renders the four export-wizard steps. Owns no state. */
export function ExportSection({ exportState, showExportPw, onFieldChange, onToggleAll, onToggleType, onTogglePassword, onStartExport, onConfirmExport, onResetExport }: ExportSectionProps) {
  const { l10n } = useLocalization();

  return (
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
                      onChange={onToggleAll}
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
                        onChange={() => onToggleType(dt.key)}
                      />
                      <div className="data-mgmt-type-info">
                        <Localized id={`data-mgmt-type-${dt.key}`}>
                          <span className="data-mgmt-type-label">{requiredLocalized(l10n, dt.labelId)}</span>
                        </Localized>
                        <Localized id={`data-mgmt-type-${dt.key}-desc`}>
                          <span className="data-mgmt-type-desc">{requiredLocalized(l10n, dt.descriptionId)}</span>
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
                      onChange={(e) => onFieldChange({ dateFrom: e.target.value })}
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
                      onChange={(e) => onFieldChange({ dateTo: e.target.value })}
                    />
                  </div>
                </div>

                <div className="data-mgmt-actions">
                  <Button variant="primary" onClick={onStartExport}>
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
                        onChange={(e) => onFieldChange({ password: e.target.value })}
                      />
                      <button
                        type="button"
                        className="data-mgmt-password-toggle"
                        onClick={onTogglePassword}
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
                        onChange={(e) => onFieldChange({ passwordConfirm: e.target.value })}
                      />
                    </div>
                  </div>
                </div>

                <div className="data-mgmt-actions">
                  <Button variant="ghost" onClick={() => onFieldChange({ step: 'select' })}>
                    <Localized id="data-mgmt-encrypt-back">Back</Localized>
                  </Button>
                  <Button variant="primary" onClick={onConfirmExport}>
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
                      <Button variant="primary" onClick={onResetExport}>
                        <Localized id="data-mgmt-export-new-export">New export</Localized>
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </Card>
          )}
        </div>
  );
}
