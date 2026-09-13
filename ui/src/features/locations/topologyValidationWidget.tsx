//! Validation issues widget for the topology editor.
//!
//! The "Issues (N)" button plus its expandable panel. The issue lists,
//! dismissals, and jump/stock-wire actions stay owned by the editor; this
//! component owns only the presentation (button, panel, per-issue rows) and
//! the settled issues-count readout. Extracted so the validation UI's settle
//! timer and row rendering no longer live inline in the 6,000-line editor.

import { memo, useEffect, useRef, useState } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { CloseIcon, WarningIcon } from './NodeTopologyIcons';
import type { TopologyValidationError } from './topologyContract';

/** Milliseconds the issues-count readout waits after the LAST validation
 *  change before animating to the new count. Long enough to absorb the
 *  flicker of a drag or connect gesture that temporarily changes the issue
 *  set, short enough to feel responsive. */
const ISSUES_COUNT_SETTLE_MS = 300;

/** One node-scoped issue row's data (already filtered to visible). */
export interface TopologyValidationNodeIssue {
  nodeId: string;
  nodeName: string;
  messageId: string;
  code: string;
}

export interface TopologyValidationWidgetProps {
  totalIssues: number;
  open: boolean;
  onToggle: () => void;
  nodeIssues: TopologyValidationNodeIssue[];
  graphIssues: TopologyValidationError[];
  onSelectNode: (nodeId: string) => void;
  onAddStockWire: (nodeId: string) => void;
  onJumpToWire: (wireId: string) => void;
  onDismissNodeIssue: (nodeId: string, messageId: string) => void;
  onDismissGraphIssue: (messageId: string) => void;
}

/** Settled issues-count readout for the validation button. Receives the
 *  LIVE count on every validation recompute but only commits it (with a pop
 *  animation) once the value holds steady for [`ISSUES_COUNT_SETTLE_MS`] — a
 *  drag that flicks 1→2→1 never animates twice. Isolated as a memo component
 *  so the settle timer's re-renders are local to this label. */
const ValidationIssuesLabel = memo(function ValidationIssuesLabel({ count }: { count: number }) {
  const { l10n } = useLocalization();
  const [displayCount, setDisplayCount] = useState(count);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevCountRef = useRef(count);

  useEffect(() => {
    if (count === prevCountRef.current) return;
    prevCountRef.current = count;
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null;
      setDisplayCount(count);
    }, ISSUES_COUNT_SETTLE_MS);
  }, [count]);

  useEffect(
    () => () => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    },
    [],
  );

  // Re-keying on the settled count remounts the span so the pop keyframe
  // replays exactly when the readout settles on a new value.
  return (
    <span key={displayCount} className="topology-issues-label topology-issues-label-pop">
      {l10n.getString('topology-validation-details', { count: displayCount })}
    </span>
  );
});

/**
 * The issues button + panel. Renders node-scoped issues (with an optional
 * "Add stock wire" action) and graph-level issues (wire rows are jumpable;
 * static rows are not), each with its own dismiss action.
 */
export function TopologyValidationWidget({
  totalIssues,
  open,
  onToggle,
  nodeIssues,
  graphIssues,
  onSelectNode,
  onAddStockWire,
  onJumpToWire,
  onDismissNodeIssue,
  onDismissGraphIssue,
}: TopologyValidationWidgetProps) {
  const { l10n } = useLocalization();
  return (
    <div className="topology-validation-widget">
      <button
        type="button"
        className="topology-issues-btn"
        aria-expanded={open}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onToggle}
      >
        <WarningIcon size={14} />
        <ValidationIssuesLabel count={totalIssues} />
      </button>
      {open && (
        // The panel sits over the canvas; its mousedown must not fall through
        // and start a canvas marquee/pan. Interaction lives in the row
        // buttons, so the dialog itself has no activation handler.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <div
          className="topology-validation-panel"
          role="dialog"
          aria-label={l10n.getString('topology-validation-panel-aria')}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {nodeIssues.map((issue) => (
            <div key={`${issue.nodeId}-${issue.messageId}`} className="topology-validation-item">
              <button
                type="button"
                className="topology-validation-item-select"
                onClick={() => onSelectNode(issue.nodeId)}
              >
                <span className="topology-validation-item-node">{issue.nodeName}</span>
                <span className="topology-validation-item-msg">{l10n.getString(issue.messageId)}</span>
              </button>
              {issue.code === 'warehouse-missing-stock-routing' && (
                <button
                  type="button"
                  className="topology-validation-item-action"
                  onClick={() => onAddStockWire(issue.nodeId)}
                >
                  <Localized id="topology-validation-add-stock-wire">Add stock wire</Localized>
                </button>
              )}
              <button
                type="button"
                className="topology-validation-item-dismiss"
                aria-label={l10n.getString('topology-validation-dismiss')}
                title={l10n.getString('topology-validation-dismiss')}
                onClick={() => onDismissNodeIssue(issue.nodeId, issue.messageId)}
              >
                <CloseIcon size={12} />
              </button>
            </div>
          ))}
          {graphIssues.map((err) =>
            err.wireId ? (
              // WireId-only errors are JUMPABLE — the row selects + centers
              // the wire. The key is wire-scoped so two errors of the same
              // class stay distinct; dismissal remains messageId-scoped.
              <div key={`${err.wireId}-${err.messageId}`} className="topology-validation-item">
                <button
                  type="button"
                  className="topology-validation-item-select"
                  onClick={() => onJumpToWire(err.wireId!)}
                >
                  <span className="topology-validation-item-msg">{l10n.getString(err.messageId)}</span>
                </button>
                <button
                  type="button"
                  className="topology-validation-item-dismiss"
                  aria-label={l10n.getString('topology-validation-dismiss')}
                  title={l10n.getString('topology-validation-dismiss')}
                  onClick={() => onDismissGraphIssue(err.messageId)}
                >
                  <CloseIcon size={12} />
                </button>
              </div>
            ) : (
              <div key={err.messageId} className="topology-validation-item topology-validation-item-static">
                <span className="topology-validation-item-msg">{l10n.getString(err.messageId)}</span>
                <button
                  type="button"
                  className="topology-validation-item-dismiss"
                  aria-label={l10n.getString('topology-validation-dismiss')}
                  title={l10n.getString('topology-validation-dismiss')}
                  onClick={() => onDismissGraphIssue(err.messageId)}
                >
                  <CloseIcon size={12} />
                </button>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
