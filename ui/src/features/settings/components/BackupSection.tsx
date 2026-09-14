/**
 * BackupSection — the "Database backup" tab panel of the Data management screen:
 * last-backup timestamp, last size, and the one-click snapshot button.
 *
 * Extracted from DataManagementScreen.tsx by DataManagement lane slice 3; the
 * markup was at :852-901 of the 905-line file and moved verbatim, indentation
 * included, so it diffs clean against its old lines.
 *
 * PRESENTATIONAL, AND FOR A MEASURED REASON. This slice first tried the opposite
 * (own the backup useState, the mount fetch and handleBackup here — nothing outside
 * the panel read that state). It turned 3 tests red, and they are not query-scope
 * tests: DataManagementBackup.test.tsx pins that get_backup_status / create_backup
 * fire on MOUNT, including the known-hazard no-session-token case. Inside a
 * conditionally mounted child the fetch becomes lazy — deferred until the operator
 * opens the Backup tab — which silently changes WHEN the tokenless command runs. On
 * a parked gating decision that is not an extraction to make, so the state, the
 * fetch and the handler went back to the screen and the two ternaries stayed there
 * byte-identical and untouched.
 *
 * Registered in screenExtraction.test.ts (additionalTsx) because the data-mgmt-*
 * classes it uses are styled by DataManagementScreen.css.
 */
import { Localized, useLocalization } from '@fluent/react';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import type { BackupInfo } from '../dataManagementModel';

interface BackupSectionProps {
  /** The screen's flash map; also read by the import preview, so it stays there. */
  flashRows: Map<string, 'updated'>;
  backup: BackupInfo;
  onBackup: () => void;
}

/** Renders the backup status rows and the create-backup button. Owns no state. */
export function BackupSection({ flashRows, backup, onBackup }: BackupSectionProps) {
  const { l10n } = useLocalization();

// The section comment from DataManagementScreen.tsx:852, restated as a line comment: as
// a JSX {/* */} comment it was only legal inside the screen conditional wrapper, where it
// sat in an expression container; here it would be the first token of a parenthesised
// expression, which is not valid TypeScript (TS1005). The markup below is untouched.
  return (
        <div className="data-mgmt-tabpanel" role="tabpanel" aria-label={l10n.getString('data-mgmt-backup-status-aria')}>
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
                  onClick={onBackup}
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
  );
}
