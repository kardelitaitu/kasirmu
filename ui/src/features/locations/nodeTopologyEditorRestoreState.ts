import { useEffect, useRef } from 'react';
import type { TopologyNodePayload, TopologyWirePayload } from '@/api/topology';

/** A one-shot persisted diagram seed supplied by the revision browser. */
export type TopologyRestoreSeed = {
  nodes: TopologyNodePayload[];
  wires: TopologyWirePayload[];
};

/**
 * Apply each restore seed object once. Clearing the prop is intentionally a
 * no-op so the parent can disarm a restore after Apply without clobbering the
 * newly saved canvas.
 */
export function useTopologyEditorRestoreSeed(
  restoreSeed: TopologyRestoreSeed | null | undefined,
  applyRestoreSeed: (seed: TopologyRestoreSeed) => void,
): void {
  const seededRestoreRef = useRef<TopologyRestoreSeed | null>(null);

  useEffect(() => {
    if (!restoreSeed || seededRestoreRef.current === restoreSeed) return;
    seededRestoreRef.current = restoreSeed;
    applyRestoreSeed(restoreSeed);
  }, [restoreSeed, applyRestoreSeed]);
}
