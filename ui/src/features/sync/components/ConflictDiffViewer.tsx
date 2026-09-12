import type { SyncConflictDto } from '@/api/syncConflicts';

// ── Conflict diff viewer ──────────────────────────────────────────
//
// Shows the two sides of a conflict side by side. Deliberately dumb: it
// renders and reports, it never decides. The payloads are shown as formatted
// JSON because this screen cannot know the shape of every entity type — and
// guessing would misrepresent the record a manager is being asked to judge.
//
// Money note: the payloads already carry `*_minor` integer amounts. Nothing
// here divides by 100 or formats a currency; doing so without the entity's
// currency code would render a wrong number.

interface ConflictDiffViewerProps {
  conflict: SyncConflictDto;
  /** Fired when the manager picks the stored (local) side. */
  onAcceptLocal: (resolution: string) => void;
  /** Fired when the manager picks the incoming (remote) side. */
  onAcceptRemote: (resolution: string) => void;
  /** Fired with a free-text custom merge value. */
  onCustomMerge: (resolution: string) => void;
  /** True while a resolution request is in flight. */
  busy?: boolean;
}

/** Pretty-print a JSON column, tolerating values that are not JSON. */
function formatPayload(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function ConflictDiffViewer({
  conflict,
  onAcceptLocal,
  onAcceptRemote,
  onCustomMerge,
  busy = false,
}: ConflictDiffViewerProps) {
  return (
    <div className="conflict-diff" data-testid="conflict-diff-viewer">
      <div className="conflict-diff__head">
        <span className="conflict-diff__entity">{conflict.entity_type}</span>
        <span className="conflict-diff__entity-id">{conflict.entity_id}</span>
        <span className={`conflict-diff__severity conflict-diff__severity--${conflict.severity}`}>
          {conflict.severity}
        </span>
      </div>

      <div className="conflict-diff__panes">
        <section className="conflict-diff__pane">
          <h4>Terminal {conflict.local_terminal_id}</h4>
          <pre className="conflict-diff__vector">{conflict.local_vector}</pre>
          <pre className="conflict-diff__payload">
            {formatPayload(conflict.local_payload)}
          </pre>
          <button
            type="button"
            disabled={busy}
            onClick={() => onAcceptLocal(conflict.local_payload)}
          >
            Accept Store A
          </button>
        </section>

        <section className="conflict-diff__pane">
          <h4>Cloud / Terminal B</h4>
          <pre className="conflict-diff__vector">{conflict.remote_vector}</pre>
          <pre className="conflict-diff__payload">
            {formatPayload(conflict.remote_payload)}
          </pre>
          <button
            type="button"
            disabled={busy}
            onClick={() => onAcceptRemote(conflict.remote_payload)}
          >
            Accept Cloud
          </button>
        </section>
      </div>

      <div className="conflict-diff__custom">
        <button
          type="button"
          disabled={busy}
          onClick={() => onCustomMerge('custom')}
        >
          Custom Merge
        </button>
      </div>
    </div>
  );
}

export default ConflictDiffViewer;
