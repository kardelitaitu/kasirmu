// ── Apply confirmation dialog ─────────────────────────────────────────
//
// Extracted from NodeTopologyEditor.tsx under the one-time Rule 3 waiver
// recorded in ADR #46 ("Phase 1 status, and one rule conflict to adjudicate").
// The waiver is conditional: the move must NET-REMOVE the dialog's JSX and
// state from the editor, or it is void.
//
// # Why this stays mounted while closed
//
// `confirmApply` in the editor closes the dialog BEFORE verifying the PIN and
// re-opens it if the PIN is rejected, so the error message and the cleared
// input have to survive that round trip. A component that unmounted on close
// would lose them and silently drop the error — the failure
// TopologyApplyConfirm.characterization.test.tsx pins. So the editor renders
// this unconditionally and `open` only controls whether it returns null.
//
// # What deliberately did NOT move
//
// The Apply itself. `confirmApply` is entangled with editor internals
// (`beginApply`/`failApply`, `nodes`, `wires`, `topologyRevision`,
// `resolvedIssues`, the undo stacks, the id-map rewrite) — that is the editor's
// job, and relocating it would be a different, much larger refactor. This
// component owns the dialog's presentation and its PIN interaction, and calls
// back for everything else.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { Button } from '@/components/Button';
import { CheckIcon } from './NodeTopologyIcons';
import './TopologyApplyConfirm.css';

/** One workspace row in the diff summary. */
export type ApplyDiffItem = { id: string; name: string; typeKey: string };

/** Everything the dialog shows about the pending Apply. */
export interface TopologyApplyConfirmData {
  created: ApplyDiffItem[];
  updated: ApplyDiffItem[];
  archived: ApplyDiffItem[];
  typeChanged: ApplyDiffItem[];
  /** The store the operator is authenticated against. */
  sessionStoreId: string;
  /** The store workspace CRUD will actually target (the branch node's). */
  effectiveStoreId: string;
}

export interface TopologyApplyConfirmProps {
  open: boolean;
  data: TopologyApplyConfirmData | null;
  /** True while the editor is persisting, so Apply stays disabled. */
  saving: boolean;
  /** Whether this session already verified a PIN. When true the "Remember
   *  PIN" checkbox is not offered — there is nothing left to remember. */
  sessionPinVerified: boolean;
  /** Dismiss without applying. */
  onClose: () => void;
  /**
   * Verify `pin` and, if it holds, perform the Apply carrying `changeNote`.
   * Resolves false when the PIN was rejected, in which case the caller is
   * expected to re-open the dialog (it closes first, so the operator is not
   * staring at a dead canvas).
   *
   * `changeNote` is "" when the operator left the field empty — the backend
   * stores that as an empty note, which is what makes an un-noted deploy
   * distinguishable from a noted one in the history.
   */
  onConfirm: (pin: string, rememberPin: boolean, changeNote: string) => Promise<boolean>;
}

/** Re-focus the PIN input after the dialog is re-opened on a rejection. */
const FOCUS_DELAY_MS = 50;

/** Mirrors `TOPOLOGY_CHANGE_NOTE_MAX_CHARS` in
 *  apps/desktop-tauri/src/commands/topology/revisions.rs. Truncating here is
 *  a courtesy; the backend REJECTS a longer note with
 *  `topology-change-note-too-long`, and it counts CHARACTERS, not bytes — so
 *  maxLength on the textarea (which also counts UTF-16 code units) is the
 *  right control, and the counter below must not be the only guard. */
const CHANGE_NOTE_MAX = 500;

export default function TopologyApplyConfirm({
  open,
  data,
  saving,
  sessionPinVerified,
  onClose,
  onConfirm,
}: TopologyApplyConfirmProps) {
  const { l10n } = useLocalization();
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);
  const [pinVerifying, setPinVerifying] = useState(false);
  const [rememberPin, setRememberPin] = useState(false);
  const [changeNote, setChangeNote] = useState('');
  const pinRef = useRef<HTMLInputElement>(null);

  /** Fresh credentials every time the dialog is opened: a leftover PIN from a
   *  cancelled Apply must not be sitting in the field on next open. */
  useEffect(() => {
    if (!open) return;
    setPin('');
    setPinError(false);
    // `changeNote` is deliberately NOT reset here. A PIN rejection closes and
    // then re-opens the dialog, and from inside this effect a re-open is
    // indistinguishable from a fresh open — resetting on open therefore throws
    // away the paragraph the operator just wrote because they fat-fingered a
    // PIN. It is reset on DISMISSAL instead (see `dismiss` and the accepted
    // branch of `submit`), which is the moment the note has actually been
    // consumed or abandoned. The PIN keeps its reset here because it is a
    // credential and is cleared explicitly on rejection anyway.
    const timer = setTimeout(() => pinRef.current?.focus(), FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [open]);

  /** Cancel: the note is abandoned along with the Apply, so clear it. */
  const dismiss = useCallback(() => {
    setChangeNote('');
    onClose();
  }, [onClose]);

  const submit = useCallback(async () => {
    if (pin.length < 4 || pinVerifying) return;
    setPinVerifying(true);
    let accepted = false;
    try {
      accepted = await onConfirm(pin, rememberPin, changeNote);
    } finally {
      setPinVerifying(false);
    }
    if (accepted) {
      // The Apply went through: the note has been consumed.
      setChangeNote('');
      return;
    }
    if (!accepted) {
      // The caller re-opened the dialog; clear the rejected PIN so the
      // operator cannot resubmit it blind, and put the caret back.
      setPinError(true);
      setPin('');
      setTimeout(() => pinRef.current?.focus(), FOCUS_DELAY_MS);
    }
  }, [pin, pinVerifying, rememberPin, changeNote, onConfirm]);

  if (!open || !data) return null;

  const noChanges
        = data.created.length === 0
        && data.updated.length === 0
        && data.archived.length === 0
        && data.typeChanged.length === 0;

  return (
    // The overlay's onMouseDown is a click-outside-to-close guard, not an
    // interactive affordance — the dialog is dismissed by its own Cancel button
    // and by Escape handling elsewhere. NodeTopologyEditor.tsx silenced this
    // rule for the WHOLE file; scoped to the one element here so the rest of
    // the file stays checked. Behaviour is unchanged from before the move.
    /* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */
    <div
      className="topology-apply-confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="topology-apply-confirm-title"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="topology-apply-confirm">
        <h3 id="topology-apply-confirm-title" className="topology-apply-confirm-title">
          <Localized id="topology-apply-confirm-title">Confirm Topology Changes</Localized>
        </h3>

        {/* Diff summary */}
        <div className="topology-apply-confirm-diff">
          {data.created.length > 0 && (
            <div className="topology-apply-confirm-section">
              <h4 className="topology-apply-confirm-section-title topology-apply-confirm-section--created">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" /></svg>
                <Localized id="topology-apply-confirm-created">Created</Localized>
                <span className="topology-apply-confirm-count">{data.created.length}</span>
              </h4>
              <ul className="topology-apply-confirm-list">
                {data.created.map((item) => (
                  <li key={item.id} className="topology-apply-confirm-item">
                    <span className="topology-apply-confirm-dot topology-apply-confirm-dot--created" />
                    <span className="topology-apply-confirm-name">{item.name}</span>
                    <span className="topology-apply-confirm-type">{item.typeKey}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.updated.length > 0 && (
            <div className="topology-apply-confirm-section">
              <h4 className="topology-apply-confirm-section-title topology-apply-confirm-section--updated">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                <Localized id="topology-apply-confirm-updated">Updated</Localized>
                <span className="topology-apply-confirm-count">{data.updated.length}</span>
              </h4>
              <ul className="topology-apply-confirm-list">
                {data.updated.map((item) => (
                  <li key={item.id} className="topology-apply-confirm-item">
                    <span className="topology-apply-confirm-dot topology-apply-confirm-dot--updated" />
                    <span className="topology-apply-confirm-name">{item.name}</span>
                    <span className="topology-apply-confirm-type">{item.typeKey}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.archived.length > 0 && (
            <div className="topology-apply-confirm-section">
              <h4 className="topology-apply-confirm-section-title topology-apply-confirm-section--archived">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><circle cx="12" cy="12" r="10" /><line x1="8" y1="12" x2="16" y2="12" /></svg>
                <Localized id="topology-apply-confirm-archived">Archived</Localized>
                <span className="topology-apply-confirm-count">{data.archived.length}</span>
              </h4>
              <ul className="topology-apply-confirm-list">
                {data.archived.map((item) => (
                  <li key={item.id} className="topology-apply-confirm-item">
                    <span className="topology-apply-confirm-dot topology-apply-confirm-dot--archived" />
                    <span className="topology-apply-confirm-name">{item.name}</span>
                    <span className="topology-apply-confirm-type">{item.typeKey}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.typeChanged.length > 0 && (
            <div className="topology-apply-confirm-section">
              <h4 className="topology-apply-confirm-section-title topology-apply-confirm-section--type-changed">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /><circle cx="12" cy="12" r="3" /></svg>
                <Localized id="topology-apply-confirm-type-changed">Type Changed</Localized>
                <span className="topology-apply-confirm-count">{data.typeChanged.length}</span>
              </h4>
              <ul className="topology-apply-confirm-list">
                {data.typeChanged.map((item) => (
                  <li key={item.id} className="topology-apply-confirm-item">
                    <span className="topology-apply-confirm-dot topology-apply-confirm-dot--type-changed" />
                    <span className="topology-apply-confirm-name">{item.name}</span>
                    <span className="topology-apply-confirm-type">{item.typeKey}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {noChanges && (
            <p className="topology-apply-confirm-empty">
              <Localized id="topology-apply-confirm-no-changes">No workspace changes detected.</Localized>
            </p>
          )}
        </div>

        {/* Store scope debug info */}
        <div className="topology-apply-confirm-scope">
          <div className="topology-apply-confirm-scope-row">
            <span className="topology-apply-confirm-scope-label">
              <Localized id="topology-apply-confirm-scope-session">Session store</Localized>
            </span>
            <code className="topology-apply-confirm-scope-value">{data.sessionStoreId}</code>
          </div>
          <div className="topology-apply-confirm-scope-row">
            <span className="topology-apply-confirm-scope-label">
              <Localized id="topology-apply-confirm-scope-target">Target store</Localized>
            </span>
            <code className={`topology-apply-confirm-scope-value${data.sessionStoreId !== data.effectiveStoreId ? ' topology-apply-confirm-scope-value--mismatch' : ''}`}>
              {data.effectiveStoreId}
            </code>
          </div>
          {data.sessionStoreId !== data.effectiveStoreId && (
            <p className="topology-apply-confirm-scope-warning">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
              <Localized id="topology-apply-confirm-scope-mismatch">Session store differs from Branch Location store. Workspace CRUD will target the Branch Location&apos;s store.</Localized>
            </p>
          )}
        </div>

        {/* Change note (ADR #46 §6) — the "why" that the revision row and the
            audit entry both carry. Optional by design: forcing one on every
            Apply trains operators to type noise. */}
        <label className="topology-apply-confirm-note-label" htmlFor="topology-apply-note">
          <Localized id="topology-apply-confirm-note-label">What changed?</Localized>
          <span className="topology-apply-confirm-note-optional">
            <Localized id="topology-apply-confirm-note-optional">optional</Localized>
          </span>
        </label>
        <textarea
          id="topology-apply-note"
          className="topology-apply-confirm-note"
          placeholder={l10n.getString('topology-apply-confirm-note-placeholder')}
          value={changeNote}
          onChange={(e) => setChangeNote(e.target.value)}
          maxLength={CHANGE_NOTE_MAX}
          rows={2}
          disabled={pinVerifying}
        />
        {changeNote.length > 0 && (
          <span className="topology-apply-confirm-note-count">
            {l10n.getString('topology-apply-confirm-note-count', {
              count: changeNote.length,
              max: CHANGE_NOTE_MAX,
            })}
          </span>
        )}

        {/* PIN confirmation */}
        <label className="topology-apply-confirm-pin-label" htmlFor="topology-apply-pin">
          <Localized id="topology-apply-confirm-pin-label">Enter your PIN to confirm</Localized>
        </label>
        <input
          ref={pinRef}
          id="topology-apply-pin"
          type="password"
          className={`topology-apply-confirm-pin${pinError ? ' topology-apply-confirm-pin--error' : ''}`}
          placeholder={l10n.getString('topology-apply-confirm-pin-placeholder')}
          value={pin}
          onChange={(e) => { setPin(e.target.value); setPinError(false); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && pin.length >= 4 && !pinVerifying) {
              e.preventDefault();
              void submit();
            }
          }}
          autoComplete="off"
          inputMode="numeric"
          pattern="[0-9]*"
          disabled={pinVerifying}
        />
        {pinError && (
          <p className="topology-apply-confirm-pin-error">
            <Localized id="topology-apply-confirm-pin-error">Incorrect PIN. Please try again.</Localized>
          </p>
        )}
        {!sessionPinVerified && (
          <label className="topology-apply-confirm-pin-remember">
            <input
              type="checkbox"
              checked={rememberPin}
              onChange={(e) => setRememberPin(e.target.checked)}
            />
            <Localized id="topology-apply-confirm-pin-remember">Remember PIN for this session</Localized>
          </label>
        )}

        {/* Actions */}
        <div className="topology-apply-confirm-actions">
          <Button variant="secondary" onClick={dismiss}>
            <Localized id="topology-apply-confirm-cancel">Cancel</Localized>
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={saving || pinVerifying || pin.length < 4}
            icon={pinVerifying ? undefined : <CheckIcon size={16} />}
          >
            {pinVerifying
              ? <Localized id="topology-apply-confirm-verifying">Verifying…</Localized>
              : <Localized id="topology-apply-confirm-apply">Apply</Localized>}
          </Button>
        </div>
      </div>
    </div>
  );
}
