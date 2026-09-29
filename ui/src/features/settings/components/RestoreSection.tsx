/**
 * RestoreSection — the "Restore" tab panel of the Data management screen
 * (C8 slice S5b).
 *
 * Lists the backup generations beside the live database with their verdicts and
 * lets an operator request a restore of one. Presentational: all state lives in
 * hooks/useRestore, following the section pattern BackupSection established.
 *
 * TWO RULES THIS MARKUP ENFORCES, both of which look like polish and are not:
 *
 * 1. NOTHING HERE PROMISES AN IMMEDIATE RESTORE. The request runs on the next
 *    boot, before the database is opened (D5 safe-mode). Every string says
 *    "the next time kasir.mu starts"; there is no "Restore now" button.
 *
 * 2. THE BACKUP'S STORE NAME IS NEVER SHOWN, SUGGESTED OR PRE-FILLED. The
 *    operator must type it, and the bridge refuses to echo it back precisely so
 *    that it is a real confirmation (crates/kasirmu-bridge/src/data/restore.rs
 *    :209-210). The field starts empty and the dialog says why it is not shown.
 *    Do not add a hint, a default, or an autocomplete.
 */
import { Localized, useLocalization } from '@fluent/react';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { formatBytes, verdictId, type RestoreState } from '../hooks/useRestore';
import type { RestoreCandidate } from '@/api/data';

interface RestoreSectionProps {
  restore: RestoreState;
  /** False on the tablet shell, where the restore commands are not registered. */
  isAvailable: boolean;
  onRefresh: () => void;
  onStartConfirm: (candidate: RestoreCandidate) => void;
  onCancelConfirm: () => void;
  onConfirmNameChange: (name: string) => void;
  onSubmit: () => void;
}

/** Renders the generation list, the pending banner and the confirm dialog. */
export function RestoreSection({
  restore,
  isAvailable,
  onRefresh,
  onStartConfirm,
  onCancelConfirm,
  onConfirmNameChange,
  onSubmit,
}: RestoreSectionProps) {
  const { l10n } = useLocalization();

  // Desktop-only surface. Saying so plainly beats an error toast from a command
  // the tablet shell does not register (see useRestore's isAvailable note).
  if (!isAvailable) {
    return (
      <div className="data-mgmt-tabpanel" role="tabpanel" aria-label={l10n.getString('data-mgmt-restore-status-aria')}>
        <Card shadow="sm">
          <div className="data-mgmt-section">
            <Localized id="data-mgmt-restore-title">
              <h2 className="data-mgmt-section-title">Restore from backup</h2>
            </Localized>
            <Localized id="data-mgmt-restore-cli-hint">
              <p className="data-mgmt-section-desc">
                You can also restore from the command line: run the kasir.mu CLI restore
                command while the app is closed.
              </p>
            </Localized>
          </div>
        </Card>
      </div>
    );
  }

  const { candidates, loading, status, submitting, confirming, confirmName } = restore;
  // Only an ANSWERED pending read may show the banner. undefined = the read
  // failed, which is not the same claim as 'nothing pending'.
  const pending = status?.pending === true;
  const submitDisabled = submitting || confirmName.trim() === '';

  return (
    <div className="data-mgmt-tabpanel" role="tabpanel" aria-label={l10n.getString('data-mgmt-restore-status-aria')}>
      <Card shadow="sm">
        <div className="data-mgmt-section">
          <Localized id="data-mgmt-restore-title">
            <h2 className="data-mgmt-section-title">Restore from backup</h2>
          </Localized>
          <Localized id="data-mgmt-restore-desc">
            <p className="data-mgmt-section-desc">
              Replace the live database with one of the backup generations stored beside
              it. The restore runs the next time kasir.mu starts, before anything opens
              the database.
            </p>
          </Localized>

          {/* ── Already pending ───────────────────────────── */}
          {pending && (
            <div
              className="data-mgmt-restore-pending"
              role="status"
              aria-label={l10n.getString('data-mgmt-restore-pending-aria')}
            >
              <Localized id="data-mgmt-restore-pending-title">
                <strong>A restore is already pending</strong>
              </Localized>
              <Localized id="data-mgmt-restore-pending-desc">
                <p className="data-mgmt-section-desc">
                  A restore has been requested and will run the next time kasir.mu starts.
                  Requesting another would replace it.
                </p>
              </Localized>
              {/* An unparsable request file reports pending WITH an error. Show it:
                  it means a restore will be attempted and may not be understood. */}
              {status?.error && (
                <p className="data-mgmt-restore-pending-error">
                  <Localized id="data-mgmt-restore-pending-unreadable">
                    <span>The pending request could not be read</span>
                  </Localized>
                  {': '}
                  <span>{status.error}</span>
                </p>
              )}
              {status?.requested_at && (
                <div className="data-mgmt-backup-row">
                  <Localized id="data-mgmt-restore-pending-requested">
                    <span className="data-mgmt-label">Requested</span>
                  </Localized>
                  <span className="data-mgmt-value">{status.requested_at}</span>
                </div>
              )}
            </div>
          )}

          {/* ── Generation list ───────────────────────────── */}
          {loading ? (
            <Localized id="data-mgmt-restore-loading">
              <p className="data-mgmt-section-desc">Reading backup generations…</p>
            </Localized>
          ) : candidates.length === 0 ? (
            <Localized id="data-mgmt-restore-empty">
              <p className="data-mgmt-section-desc">
                No backup generations were found beside the database.
              </p>
            </Localized>
          ) : (
            <ul className="data-mgmt-restore-list">
              {candidates.map((candidate) => (
                <li key={candidate.path} className="data-mgmt-restore-item">
                  <div className="data-mgmt-restore-item-head">
                    <Localized id="data-mgmt-restore-generation" vars={{ number: candidate.generation }}>
                      <span className="data-mgmt-restore-gen">{`Generation ${candidate.generation}`}</span>
                    </Localized>
                    {/* The verdict is text, never colour alone. */}
                    <Localized id={verdictId(candidate.verdict)}>
                      <span className="data-mgmt-restore-verdict">{candidate.verdict}</span>
                    </Localized>
                  </div>

                  {/* The validator's own sentence: WHY a generation is unusable. */}
                  <p className="data-mgmt-restore-reason">{candidate.reason}</p>

                  <div className="data-mgmt-backup-row">
                    <Localized id="data-mgmt-restore-label-size">
                      <span className="data-mgmt-label">Size</span>
                    </Localized>
                    <span className="data-mgmt-value">{formatBytes(candidate.size_bytes)}</span>
                  </div>
                  {candidate.modified && (
                    <div className="data-mgmt-backup-row">
                      <Localized id="data-mgmt-restore-label-modified">
                        <span className="data-mgmt-label">Modified</span>
                      </Localized>
                      <span className="data-mgmt-value">{candidate.modified}</span>
                    </div>
                  )}
                  {/* Always rendered, including when the candidate carries no
                      schema. A pre-migration snapshot has no schema_migrations
                      table at all — that is WHY it reads OlderButAcceptable —
                      so 'Unknown' is real information, not a placeholder, and
                      omitting the row would hide it. */}
                  <div className="data-mgmt-backup-row">
                    <Localized id="data-mgmt-restore-label-schema">
                      <span className="data-mgmt-label">Backup schema</span>
                    </Localized>
                    <span className="data-mgmt-value">
                      {candidate.candidate_schema ?? (
                        <Localized id="data-mgmt-restore-schema-unknown">
                          <span>Unknown</span>
                        </Localized>
                      )}
                    </span>
                  </div>

                  {/* An unusable generation is LISTED and its button is disabled
                      rather than hidden — the list exists to show that a backup
                      is unusable, so hiding it would defeat the purpose. */}
                  <div className="data-mgmt-actions">
                    <Button
                      variant="primary"
                      disabled={!candidate.restorable}
                      onClick={() => onStartConfirm(candidate)}
                    >
                      <Localized id="data-mgmt-restore-request">Restore this backup</Localized>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="data-mgmt-actions">
            <Button variant="secondary" onClick={onRefresh}>
              <Localized id="data-mgmt-restore-status-aria">Restore status</Localized>
            </Button>
          </div>
        </div>
      </Card>

      {/* ── Typed store-name confirmation ─────────────── */}
      {confirming && (
        <Card shadow="sm">
          <div className="data-mgmt-section" role="dialog" aria-modal="true"
               aria-label={l10n.getString('data-mgmt-restore-confirm-title')}>
            <Localized id="data-mgmt-restore-confirm-title">
              <h2 className="data-mgmt-section-title">Restore from this backup?</h2>
            </Localized>
            <Localized id="data-mgmt-restore-confirm-desc">
              <p className="data-mgmt-section-desc">
                To confirm, type the store name that this BACKUP carries — not the name of
                the store you are running now. The name is not shown anywhere, on purpose:
                typing it is the confirmation that you have the right backup.
              </p>
            </Localized>

            {/* The established settings pattern: <Localized> is the label's
                DIRECT child (no wrapping span) and the input carries no
                aria-label of its own. That gives the control exactly one
                accessible name, which is what jsx-a11y/label-has-associated-control
                wants and what getByLabelText resolves unambiguously. */}
            <label htmlFor="restore-confirm-name" className="data-mgmt-label">
              <Localized id="data-mgmt-restore-store-name-label">
                Store name in the backup
              </Localized>
            </label>
            <input
              id="restore-confirm-name"
              className="data-mgmt-input"
              type="text"
              // NOT a password field: the operator is retyping a name they must
              // know, and masking it would only make a typo harder to catch.
              autoComplete="off"
              value={confirmName}
              onChange={(e) => onConfirmNameChange(e.target.value)}
              placeholder={l10n.getString('data-mgmt-restore-store-name-placeholder')}
            />

            <Localized id="data-mgmt-restore-next-boot">
              <p className="data-mgmt-section-desc">
                This restore will run the next time kasir.mu starts. You can keep using the
                app until then.
              </p>
            </Localized>

            <div className="data-mgmt-actions">
              <Button variant="secondary" onClick={onCancelConfirm}>
                <Localized id="data-mgmt-restore-cancel">Cancel</Localized>
              </Button>
              <Button
                variant="danger"
                loading={submitting}
                disabled={submitDisabled}
                onClick={onSubmit}
              >
                <Localized id="data-mgmt-restore-submit">Request restore</Localized>
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
