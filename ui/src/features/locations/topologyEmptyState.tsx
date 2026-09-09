//! Empty state for the topology editor canvas (composition C4): the
//! "build your store topology" card shown while the graph has no nodes.
//!
//! Presentational only - no state, no hooks; classes and Fluent ids are
//! byte-verbatim from the inline original (the editor suite reaches them
//! directly).

import { Localized } from '@fluent/react';
import { NodesIcon } from './NodeTopologyIcons';

export interface TopologyEmptyStateProps {
  /** Whether the graph currently holds zero nodes. */
  isEmpty: boolean;
}

/** The canvas empty state the editor previously rendered inline. */
export function TopologyEmptyState({ isEmpty }: TopologyEmptyStateProps) {
  if (!isEmpty) return null;
  return (
    <div className="topology-empty-state" aria-live="polite">
      <div className="topology-empty-state-card">
        <NodesIcon size={30} />
        <h3>
          <Localized id="topology-empty-state-title">Build your store topology</Localized>
        </h3>
        <p>
          <Localized id="topology-empty-state-body">
            Drag tools from the palette onto the canvas, or press 1–4 to add a node. Connect nodes with the port sockets on each card.
          </Localized>
        </p>
      </div>
    </div>
  );
}
