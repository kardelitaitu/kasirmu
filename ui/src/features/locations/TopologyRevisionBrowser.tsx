// ── Deploy history browser (ADR #46 §2, §4, §8) ─────────────────────
//
// The standalone overlay module §10 calls for. It follows `topologyBranchCompare`
// rather than `NodeTopologyEditor`: this file is a panel, and the editor is not
// a place to add one (6,000+ lines, and ADR #45 §4.2 records a four-handler
// change there being attempted and reverted).
//
// # What "preview" is, and why it costs nothing
//
// Selecting a revision offers to draw it on the canvas. That reuses the
// `compareOverlay` prop the editor ALREADY has for branch comparison —
// `buildTopologyOverlay(current, other)` takes two graphs and does not care
// that one came from the past. So the browser needs no new editor surface, and
// the ghost/only-here/differing rendering is the same tested code.
//
// # What it is NOT
//
// Not restore. §5 requires a revision's diagram to land in the canvas as an
// UNSAVED DRAFT, which is a different seam (the editor has no diagram-seed
// prop) and is deliberately not faked here by pointing preview at Apply.
//
// # Deflated rows are shown, never hidden
//
// §4's retention prunes the snapshot and keeps the record, and §8 says the
// reason is incident reconstruction: "we deployed X on Tuesday" must remain
// answerable after the graph is gone. So a pruned row renders as a row, with
// its who/when/why intact, and only its preview/restore affordances are
// withdrawn.

import { useCallback, useEffect, useState } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import {
  listTopologyRevisions,
  loadTopologyRevision,
  pinTopologyRevision,
  type TopologyRevisionSummary,
  type TopologyRevisionGraph,
} from '@/api/topology';
import { diffTopologyGraphs, type TopologyGraphDiff } from './topologyRevisionDiff';
import { plainErrorMessage } from '@/utils/app-error';
import type { TopologyData } from '@/api/topology';
import './TopologyRevisionBrowser.css';

export interface TopologyRevisionBrowserProps {
  sessionToken: string;
  /** Empty string is the unscoped legacy graph — its own scope, not a
   *  catch-all — so this is passed through rather than defaulted. */
  branchId?: string | undefined;
  /** The live diagram, so a revision reads as a diff against what is
   *  deployed now rather than as a blob of JSON. */
  currentGraph: TopologyData | null;
  onClose: () => void;
  /** Draw the revision on the canvas through the existing compare overlay.
   *  `null` clears the preview. */
  onPreview: (graph: TopologyData | null) => void;
}

interface SelectedRevision {
  summary: TopologyRevisionSummary;
  graph: TopologyRevisionGraph | null;
  diff: TopologyGraphDiff | null;
}

/**
 * Resolve the active locale from the Fluent context. Replicated from
 * AuditLogScreen.tsx:35 rather than shared, because that file does not export
 * it and reaching into another feature to refactor it is exactly what Rule 3
 * forbids. Four lines, and the alternative is a cross-feature edit for a
 * formatting nicety.
 */
function activeLocale(l10n: ReturnType<typeof useLocalization>['l10n']): string {
  for (const bundle of l10n.bundles) {
    const locales = bundle.locales;
    const primary = locales && locales.length > 0 ? locales[0] : undefined;
    if (primary) return primary;
  }
  return 'en';
}

/**
 * Format a revision's instant for display (AUD-07 conventions, matching
 * AuditLogScreen). Deliberately an ABSOLUTE timestamp, not "3 days ago":
 * §8's whole purpose is reconstructing when something shipped, and a relative
 * stamp goes stale the moment you look at it twice.
 */
function formatWhen(iso: string, locale: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(locale, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function TopologyRevisionBrowser({
  sessionToken,
  branchId,
  currentGraph,
  onClose,
  onPreview,
}: TopologyRevisionBrowserProps) {
  const { l10n } = useLocalization();
  const [rows, setRows] = useState<TopologyRevisionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedRevision | null>(null);
  const [busyRevision, setBusyRevision] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Explicit limit rather than the server default: this is a scrollable
      // panel, and a silent change to the default would silently change what the
      // operator can see without ever scrolling to it.
      setRows(await listTopologyRevisions(sessionToken, branchId, 50));
    } catch (err) {
      // `plainErrorMessage`, not `err.message`: ERR-10 forbids surfacing a raw
      // IPC error string to the operator, and it is the right call here on
      // usability grounds too — a serialized AppError is unreadable to a
      // merchant, where the sanitized fallback is not.
      setError(plainErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [sessionToken, branchId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const select = useCallback(async (summary: TopologyRevisionSummary) => {
    setSelected({ summary, graph: null, diff: null });
    const graph = await loadTopologyRevision(sessionToken, summary.revision, branchId);
    setSelected({
      summary,
      graph,
      // Only a restorable row can be compared; a deflated one has no graph to
      // judge, and inventing an empty one would read as "everything changed".
      diff: graph.status === 'restorable' && currentGraph && graph.diagram
        ? diffTopologyGraphs(graph.diagram, currentGraph)
        : null,
    });
  }, [sessionToken, branchId, currentGraph]);

  const togglePin = useCallback(async (summary: TopologyRevisionSummary) => {
    setBusyRevision(summary.revision);
    try {
      const result = await pinTopologyRevision(
        sessionToken, summary.revision, !summary.pinned, branchId,
      );
      if (result.status === 'not-found') {
        // The row vanished under us (a retention sweep cannot delete rows, so
        // this means the branch changed) — resync rather than guess.
        await refresh();
        return;
      }
      setRows((prev) => prev.map((r) => (
        r.revision === summary.revision
          ? { ...r, pinned: result.pinned, restorable: result.restorable }
          : r
      )));
      setSelected((prev) => (
        prev && prev.summary.revision === summary.revision
          ? { ...prev, summary: { ...prev.summary, pinned: result.pinned } }
          : prev
      ));
    } finally {
      setBusyRevision(null);
    }
  }, [sessionToken, branchId, refresh]);

  const locale = activeLocale(l10n);

  return (
    // Click-outside-to-close guard, not an interactive affordance — the panel
    // is dismissed by its own close button. Scoped to this element rather than
    // the whole file, matching the same decision in TopologyApplyConfirm.tsx.
    /* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */
    <div
      className="topology-rev-browser-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="topology-rev-browser-title"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* `noise-dither` because this panel is an elevated surface (it carries
          --shadow-lg). noiseDitherCompliance enforces that; the fix it prints
          suggests appending a legacy selector to themes/components.css, but
          that file's own header says the legacy list is DEPRECATED and new
          components should use the className — so the class goes here and the
          shared theme file stays untouched. */}
      <div className="topology-rev-browser noise-dither">
        <header className="topology-rev-browser-header">
          <h3 id="topology-rev-browser-title" className="topology-rev-browser-title">
            <Localized id="topology-rev-browser-title">Deploy History</Localized>
          </h3>
          <button
            type="button"
            className="topology-rev-browser-close"
            onClick={onClose}
            aria-label={l10n.getString('topology-rev-browser-close')}
          >
            ×
          </button>
        </header>

        {loading && (
          <p className="topology-rev-browser-status">
            <Localized id="topology-rev-browser-loading">Loading history…</Localized>
          </p>
        )}

        {error && (
          <p className="topology-rev-browser-error" role="alert">
            {error}
          </p>
        )}

        {!loading && !error && rows.length === 0 && (
          <p className="topology-rev-browser-status">
            <Localized id="topology-rev-browser-empty">
              Nothing has been applied to this branch yet.
            </Localized>
          </p>
        )}

        {!loading && rows.length > 0 && (
          <ul className="topology-rev-browser-list">
            {rows.map((row) => (
              <li key={row.revision} className="topology-rev-browser-row">
                <button
                  type="button"
                  className={`topology-rev-browser-row-main${
                    selected?.summary.revision === row.revision ? ' is-selected' : ''
                  }`}
                  onClick={() => void select(row)}
                >
                  <span className="topology-rev-browser-rev">#{row.revision}</span>
                  <span className="topology-rev-browser-note">
                    {row.changeNote || (
                      <em className="topology-rev-browser-note-empty">
                        <Localized id="topology-rev-browser-no-note">No note</Localized>
                      </em>
                    )}
                  </span>
                  <span className="topology-rev-browser-meta">
                    {row.publishedBy} · {formatWhen(row.publishedAt, locale)}
                  </span>
                  <span className="topology-rev-browser-counts">
                    {l10n.getString('topology-rev-browser-counts', {
                      nodes: row.nodeCount, wires: row.wireCount,
                    })}
                  </span>
                  {!row.restorable && (
                    <span className="topology-rev-browser-pruned">
                      <Localized id="topology-rev-browser-pruned">
                        Snapshot pruned — record kept
                      </Localized>
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className="topology-rev-browser-pin"
                  onClick={() => void togglePin(row)}
                  disabled={busyRevision === row.revision}
                  aria-pressed={row.pinned}
                  aria-label={l10n.getString(
                    row.pinned ? 'topology-rev-browser-unpin' : 'topology-rev-browser-pin',
                  )}
                >
                  {row.pinned ? '★' : '☆'}
                </button>
              </li>
            ))}
          </ul>
        )}

        {selected && <RevisionDetail selected={selected} onPreview={onPreview} l10n={l10n} />}
      </div>
    </div>
  );
}

/** The right-hand detail: what the revision was, and how it differs from now. */
function RevisionDetail({
  selected,
  onPreview,
  l10n,
}: {
  selected: SelectedRevision;
  onPreview: (graph: TopologyData | null) => void;
  l10n: ReturnType<typeof useLocalization>['l10n'];
}) {
  const { summary, graph, diff } = selected;
  if (!graph) {
    return (
      // Its OWN key, not a reuse of `topology-rev-browser-loading`: two
      // different English fallbacks under one id means whichever wins the
      // bundle silently contradicts the other in the source.
      <p className="topology-rev-browser-status">
        <Localized id="topology-rev-browser-loading-one">Loading revision…</Localized>
      </p>
    );
  }

  // §4/§8: the record survives precisely so it can still be read. Say what
  // happened, and be exact that the graph is gone rather than showing nothing.
  if (graph.status === 'deflated') {
    return (
      <div className="topology-rev-browser-detail">
        <h4 className="topology-rev-browser-detail-title">
          {l10n.getString('topology-rev-browser-detail-title', { revision: summary.revision })}
        </h4>
        <p className="topology-rev-browser-pruned-detail">
          {l10n.getString('topology-rev-browser-deflated-body', {
            by: summary.publishedBy,
          })}
        </p>
      </div>
    );
  }

  if (graph.status === 'not-found') {
    return (
      <p className="topology-rev-browser-error" role="alert">
        <Localized id="topology-rev-browser-not-found">
          This revision is no longer present.
        </Localized>
      </p>
    );
  }

  return (
    <div className="topology-rev-browser-detail">
      <h4 className="topology-rev-browser-detail-title">
        {l10n.getString('topology-rev-browser-detail-title', { revision: summary.revision })}
      </h4>

      {diff && diff.semanticallyIdentical && (
        <p className="topology-rev-browser-identical">
          <Localized id="topology-rev-browser-identical">
            Same configuration as now
          </Localized>
          {(diff.movedNodes > 0 || diff.reroutedWires > 0) && (
            <span className="topology-rev-browser-geometry">
              {l10n.getString('topology-rev-browser-geometry', {
                moved: diff.movedNodes, rerouted: diff.reroutedWires,
              })}
            </span>
          )}
        </p>
      )}

      {diff && !diff.semanticallyIdentical && (
        <>
          <p className="topology-rev-browser-diff-summary">
            {l10n.getString('topology-rev-browser-diff-summary', {
              count: diff.changes.length,
            })}
          </p>
          <ul className="topology-rev-browser-changes">
            {diff.changes.map((c) => (
              <li key={`${c.kind}:${c.id}`} className="topology-rev-browser-change">
                <span className={`topology-rev-browser-change-kind topology-rev-browser-change-kind--${c.kind}`}>
                  {c.kind}
                </span>
                <span className="topology-rev-browser-change-label">{c.label}</span>
                {c.fields.length > 0 && (
                  <span className="topology-rev-browser-change-fields">
                    {c.fields.map((f) => f.field).join(', ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <button
        type="button"
        className="topology-rev-browser-preview"
        onClick={() => onPreview(graph.diagram ?? null)}
      >
        <Localized id="topology-rev-browser-preview">Show on canvas</Localized>
      </button>
    </div>
  );
}
