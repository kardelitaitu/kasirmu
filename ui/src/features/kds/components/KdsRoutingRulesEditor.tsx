// ui/src/features/kds/components/KdsRoutingRulesEditor.tsx
//
// Routing-rules editor section for the KDS settings surface (the deferred UI
// half of todo-kds-agents-1). Backed by the shipped `get/save_kds_routing_
// rules_scoped` IPC pair (crates/oz-bridge/src/kds_routing.rs):
//
//   - save is a WHOLE-SET REPLACE; ids/timestamps are server-assigned, so
//     the table edits draft rows and renumbers priority positionally on save
//     (kdsRoutingRulesModel.ts);
//   - "Clear all" = save([]) behind an inline confirm — an empty submitted
//     list is the documented way to wipe the session scope;
//   - TAG MATCHER DECISION: the `tag` option STAYS in the picker and every
//     tag row carries a "stored but not yet effective" hint (the backend
//     stores tag rules but they NEVER match — tags are unmodeled in the
//     catalog). Omitting the option instead would silently destroy a tag
//     rule on the next whole-set replace (delete-by-edit). That is the
//     stamped reason.
//
// `KdsRoutingRulesSection` is the mount point used by KdsHamburgerPanel: it
// collapses by default and only the expanded editor reads `useWorkspace()`,
// so the section is inert (and provider-free) until a user opens it.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { requiredLocalized } from '@/frontend/shared';
import { l10nErrorMessage } from '@/utils/app-error';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import {
  getKdsRoutingRulesScoped,
  saveKdsRoutingRulesScoped,
  type KdsRuleMatcher,
} from '@/api/kds';
import {
  incompleteRowKeys,
  moveRow,
  newDraftRow,
  rowsFromPersisted,
  toSavePayload,
  type KdsRuleRow,
} from '@/features/kds/kdsRoutingRulesModel';
import './KdsRoutingRulesEditor.css';

const MATCHERS: readonly KdsRuleMatcher[] = ['sku', 'category', 'tag'];
const MATCHER_LABEL_ID: Record<KdsRuleMatcher, string> = {
  sku: 'kds-routing-matcher-sku',
  category: 'kds-routing-matcher-category',
  tag: 'kds-routing-matcher-tag',
};

type Phase = 'loading' | 'ready' | 'error';

interface KdsRoutingRulesEditorProps {
  /** Session token for the scoped IPC pair (components/ convention). */
  sessionToken: string;
}

/**
 * KdsRoutingRulesEditor — priority-ordered rule table (matcher kind + value,
 * target station, active switch, up/down/remove), add-row, whole-set Save
 * with success feedback, and Clear-all behind an inline confirm. Load/save
 * errors are localized via `l10nErrorMessage` (ERR-10: raw backend text is
 * never rendered).
 */
export function KdsRoutingRulesEditor({
  sessionToken,
}: KdsRoutingRulesEditorProps) {
  const { l10n } = useLocalization();
  const [phase, setPhase] = useState<Phase>('loading');
  const [rows, setRows] = useState<KdsRuleRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [invalidKeys, setInvalidKeys] = useState<Set<string>>(new Set());
  const [confirmClear, setConfirmClear] = useState(false);
  const rowSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    if (!sessionToken) {
      setPhase('error');
      setLoadError(requiredLocalized(l10n, 'kds-routing-load-failed'));
      return;
    }
    setPhase('loading');
    setLoadError(null);
    getKdsRoutingRulesScoped(sessionToken)
      .then((list) => {
        if (cancelled) return;
        setRows(rowsFromPersisted(list));
        setPhase('ready');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoadError(l10nErrorMessage(e, l10n, 'kds-routing-load-failed'));
        setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [sessionToken, l10n, reloadNonce]);

  /** Any row edit drops the stale success banner and per-row invalid flags. */
  const invalidateFeedback = useCallback(() => {
    setSavedMsg(null);
    setActionError(null);
    setInvalidKeys(new Set());
  }, []);

  const patchRow = useCallback(
    (key: string, patch: Partial<Omit<KdsRuleRow, 'key'>>) => {
      invalidateFeedback();
      setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    },
    [invalidateFeedback],
  );

  const onAddRow = useCallback(() => {
    invalidateFeedback();
    rowSeq.current += 1;
    setRows((rs) => [...rs, newDraftRow(rowSeq.current)]);
  }, [invalidateFeedback]);

  const onRemoveRow = useCallback(
    (key: string) => {
      invalidateFeedback();
      setRows((rs) => rs.filter((r) => r.key !== key));
    },
    [invalidateFeedback],
  );

  const onMove = useCallback(
    (index: number, delta: -1 | 1) => {
      invalidateFeedback();
      setRows((rs) => moveRow(rs, index, delta));
    },
    [invalidateFeedback],
  );

  /** Whole-set replace; on success the persisted set (with server ids) is
   *  what the table keeps editing, so a later Save never re-inserts rows
   *  that a previous Save already stamped. */
  const persist = useCallback(
    async (next: KdsRuleRow[], successKey: string) => {
      setBusy(true);
      setActionError(null);
      setSavedMsg(null);
      setConfirmClear(false);
      try {
        const persisted = await saveKdsRoutingRulesScoped(
          sessionToken,
          toSavePayload(next),
        );
        setRows(rowsFromPersisted(persisted));
        setSavedMsg(requiredLocalized(l10n, successKey));
        setPhase('ready');
      } catch (e: unknown) {
        setActionError(l10nErrorMessage(e, l10n, 'kds-routing-save-failed'));
      } finally {
        setBusy(false);
      }
    },
    [sessionToken, l10n],
  );

  const onSave = useCallback(() => {
    const incomplete = incompleteRowKeys(rows);
    setInvalidKeys(incomplete);
    if (incomplete.size > 0) {
      setActionError(
        requiredLocalized(l10n, 'kds-routing-error-incomplete'),
      );
      return;
    }
    void persist(rows, 'kds-routing-saved');
  }, [rows, l10n, persist]);

  const onClearAll = useCallback(() => {
    // save([]) is the documented clear: the empty submitted set replaces
    // the whole scope. The confirm lives inline in the UI; this is the
    // confirmed call site.
    void persist([], 'kds-routing-cleared');
  }, [persist]);

  const controlsDisabled = busy || phase !== 'ready';

  return (
    <div className="kds-routing-editor" aria-busy={busy}>
      {phase === 'loading' && (
        <p className="kds-routing-status" role="status" data-testid="kds-routing-loading">
          <Localized id="kds-routing-loading">
            <span>Loading routing rules…</span>
          </Localized>
        </p>
      )}

      {phase === 'error' && (
        <div className="kds-routing-banner" role="alert" data-testid="kds-routing-load-error">
          <span className="kds-routing-banner-text">{loadError}</span>
          <button
            type="button"
            className="kds-routing-retry"
            onClick={() => setReloadNonce((n) => n + 1)}
            data-testid="kds-routing-retry"
          >
            {/* Reuses the existing generic "Retry" key — one Retry copy per bundle. */}
            <Localized id="kds-offline-retry">Retry</Localized>
          </button>
        </div>
      )}

      {phase !== 'error' && (
        <>
          <table className="kds-routing-table">
            <caption className="kds-routing-caption">
              <Localized id="kds-routing-table-caption">
                Rules in priority order — the lowest number wins.
              </Localized>
            </caption>
            <thead>
              <tr>
                <th scope="col"><Localized id="kds-routing-col-priority">#</Localized></th>
                <th scope="col"><Localized id="kds-routing-col-match">Match</Localized></th>
                <th scope="col"><Localized id="kds-routing-col-station">Station</Localized></th>
                <th scope="col"><Localized id="kds-routing-col-active">Active</Localized></th>
                <th scope="col"><Localized id="kds-routing-col-actions">Actions</Localized></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const n = i + 1;
                const valueHintId = `kds-routing-tag-hint-${row.key}`;
                return (
                  <tr
                    key={row.key}
                    className="kds-routing-row"
                    tabIndex={0}
                    aria-label={requiredLocalized(l10n, 'kds-routing-row-aria', { n })}
                  >
                    <td className="kds-routing-pri">{n}</td>
                    <td className="kds-routing-match">
                      <select
                        className="kds-routing-select"
                        value={row.matcher}
                        onChange={(e) =>
                          patchRow(row.key, { matcher: e.target.value as KdsRuleMatcher })
                        }
                        disabled={controlsDisabled}
                        aria-label={requiredLocalized(l10n, 'kds-routing-matcher-aria', { n })}
                        data-testid={`kds-routing-matcher-${row.key}`}
                      >
                        {MATCHERS.map((m) => (
                          <option key={m} value={m}>
                            {requiredLocalized(l10n, MATCHER_LABEL_ID[m])}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        className={
                          invalidKeys.has(row.key)
                            ? 'kds-routing-input kds-routing-input--invalid'
                            : 'kds-routing-input'
                        }
                        value={row.matcher_value}
                        onChange={(e) => patchRow(row.key, { matcher_value: e.target.value })}
                        disabled={controlsDisabled}
                        placeholder={requiredLocalized(l10n, 'kds-routing-value-placeholder')}
                        aria-label={requiredLocalized(l10n, 'kds-routing-value-aria', { n })}
                        aria-invalid={invalidKeys.has(row.key) ? 'true' : 'false'}
                        aria-describedby={
                          row.matcher === 'tag' ? valueHintId : undefined
                        }
                        data-testid={`kds-routing-value-${row.key}`}
                      />
                      {/* Tag honesty — see the header stamp. */}
                      {row.matcher === 'tag' && (
                        <span className="kds-routing-hint kds-routing-hint--tag" id={valueHintId}>
                          <Localized id="kds-routing-tag-hint">
                            Tags are not modeled in the catalog yet — this rule is stored but never routes a line.
                          </Localized>
                        </span>
                      )}
                    </td>
                    <td className="kds-routing-station">
                      <input
                        type="text"
                        className={
                          invalidKeys.has(row.key)
                            ? 'kds-routing-input kds-routing-input--invalid'
                            : 'kds-routing-input'
                        }
                        value={row.target_station}
                        onChange={(e) => patchRow(row.key, { target_station: e.target.value })}
                        disabled={controlsDisabled}
                        placeholder={requiredLocalized(l10n, 'kds-routing-station-placeholder')}
                        aria-label={requiredLocalized(l10n, 'kds-routing-station-aria', { n })}
                        aria-invalid={invalidKeys.has(row.key) ? 'true' : 'false'}
                        data-testid={`kds-routing-station-${row.key}`}
                      />
                    </td>
                    <td className="kds-routing-active">
                      <button
                        type="button"
                        className={
                          row.is_active
                            ? 'kds-routing-switch kds-routing-switch--on'
                            : 'kds-routing-switch'
                        }
                        role="switch"
                        aria-checked={row.is_active}
                        onClick={() => patchRow(row.key, { is_active: !row.is_active })}
                        disabled={controlsDisabled}
                        aria-label={requiredLocalized(l10n, 'kds-routing-active-aria', { n })}
                        data-testid={`kds-routing-active-${row.key}`}
                      />
                    </td>
                    <td className="kds-routing-actions">
                      <button
                        type="button"
                        className="kds-routing-icon-btn"
                        onClick={() => onMove(i, -1)}
                        disabled={controlsDisabled || i === 0}
                        aria-label={requiredLocalized(l10n, 'kds-routing-up-aria', { n })}
                        data-testid={`kds-routing-up-${row.key}`}
                      >
                        <span aria-hidden="true">↑</span>
                      </button>
                      <button
                        type="button"
                        className="kds-routing-icon-btn"
                        onClick={() => onMove(i, 1)}
                        disabled={controlsDisabled || i === rows.length - 1}
                        aria-label={requiredLocalized(l10n, 'kds-routing-down-aria', { n })}
                        data-testid={`kds-routing-down-${row.key}`}
                      >
                        <span aria-hidden="true">↓</span>
                      </button>
                      <button
                        type="button"
                        className="kds-routing-icon-btn kds-routing-icon-btn--remove"
                        onClick={() => onRemoveRow(row.key)}
                        disabled={controlsDisabled}
                        aria-label={requiredLocalized(l10n, 'kds-routing-remove-aria', { n })}
                        data-testid={`kds-routing-remove-${row.key}`}
                      >
                        <span aria-hidden="true">✕</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {rows.length === 0 && phase === 'ready' && (
            <p className="kds-routing-empty" data-testid="kds-routing-empty">
              <Localized id="kds-routing-empty">
                No rules yet — every line routes by its product kitchen zone.
              </Localized>
            </p>
          )}

          {actionError && (
            <div className="kds-routing-banner" role="alert" data-testid="kds-routing-save-error">
              <span className="kds-routing-banner-text">{actionError}</span>
            </div>
          )}

          {savedMsg && (
            <p className="kds-routing-saved" role="status" data-testid="kds-routing-saved">
              <span className="kds-routing-check" aria-hidden="true">✓</span>
              <span>{savedMsg}</span>
            </p>
          )}

          {confirmClear && (
            <div
              className="kds-routing-confirm"
              role="alertdialog"
              aria-labelledby="kds-routing-confirm-title"
              aria-describedby="kds-routing-confirm-desc"
              data-testid="kds-routing-confirm"
            >
              <p className="kds-routing-confirm-title" id="kds-routing-confirm-title">
                <Localized id="kds-routing-confirm-title">Clear all routing rules?</Localized>
              </p>
              <p className="kds-routing-confirm-msg" id="kds-routing-confirm-desc">
                <Localized id="kds-routing-confirm-msg">
                  This replaces the whole rule set with nothing: every line routes by its product kitchen zone again. It cannot be undone from here.
                </Localized>
              </p>
              <div className="kds-routing-confirm-actions">
                <button
                  type="button"
                  className="kds-routing-btn kds-routing-btn--danger"
                  onClick={onClearAll}
                  data-testid="kds-routing-confirm-ok"
                >
                  <Localized id="kds-routing-confirm-ok">Clear all</Localized>
                </button>
                <button
                  type="button"
                  className="kds-routing-btn kds-routing-btn--ghost"
                  onClick={() => setConfirmClear(false)}
                  data-testid="kds-routing-confirm-cancel"
                >
                  <Localized id="kds-routing-confirm-cancel">Keep rules</Localized>
                </button>
              </div>
            </div>
          )}

          <div className="kds-routing-toolbar">
            <button
              type="button"
              className="kds-routing-btn kds-routing-btn--add"
              onClick={onAddRow}
              disabled={controlsDisabled}
              data-testid="kds-routing-add"
            >
              <Localized id="kds-routing-add">Add rule</Localized>
            </button>
            <button
              type="button"
              className="kds-routing-btn kds-routing-btn--clear"
              onClick={() => setConfirmClear(true)}
              disabled={controlsDisabled || rows.length === 0}
              data-testid="kds-routing-clear-all"
            >
              <Localized id="kds-routing-clear-all">Clear all rules</Localized>
            </button>
            <button
              type="button"
              className="kds-routing-btn kds-routing-btn--save"
              onClick={onSave}
              disabled={controlsDisabled}
              aria-busy={busy}
              data-testid="kds-routing-save"
            >
              {busy ? (
                <Localized id="kds-routing-saving">Saving…</Localized>
              ) : (
                <Localized id="kds-routing-save">Save rules</Localized>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Session wiring kept out of the editor core so the core stays prop-pure. */
function KdsRoutingRulesEditorWithSession() {
  const { sessionToken: rawToken } = useWorkspace();
  return <KdsRoutingRulesEditor sessionToken={rawToken || ''} />;
}

/**
 * KdsRoutingRulesSection — the panel section heading + collapsible editor.
 * Collapsed by default; the editor (and its `useWorkspace()` read) only
 * mounts when expanded, mirroring how the rest of the KDS settings panel
 * keeps inert until opened.
 */
export function KdsRoutingRulesSection() {
  const { l10n } = useLocalization();
  const [open, setOpen] = useState(false);
  return (
    <div className="kds-routing-section">
      <div className="kds-routing-section-head">
        <h3 id="kds-routing-heading">
          <Localized id="kds-routing-title">Routing rules</Localized>
        </h3>
      </div>
      <p className="kds-routing-section-caption">
        <Localized id="kds-routing-caption">
          Send matching order lines to a station, overriding the product kitchen zone.
        </Localized>
      </p>
      <button
        type="button"
        className="kds-routing-section-btn"
        onClick={() => setOpen((p) => !p)}
        aria-expanded={open}
        aria-controls="kds-routing-rules-region"
        aria-label={requiredLocalized(
          l10n,
          open ? 'kds-routing-collapse-aria' : 'kds-routing-expand-aria',
        )}
        data-testid="kds-routing-toggle"
      >
        <Localized id={open ? 'kds-routing-collapse' : 'kds-routing-expand'}>
          <span>{open ? 'Close rule editor' : 'Configure rules'}</span>
        </Localized>
      </button>
      {open && (
        <div
          id="kds-routing-rules-region"
          className="kds-routing-region"
          role="group"
          aria-labelledby="kds-routing-heading"
        >
          <KdsRoutingRulesEditorWithSession />
        </div>
      )}
    </div>
  );
}
