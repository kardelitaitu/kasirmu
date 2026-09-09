//! Canvas alignment guides for the topology editor (composition C6-a):
//! the thin cross-axis lines shown while dragging, anchored to the snap
//! position the pointer hook publishes.
//!
//! One prop, no state, no hooks, no memoization - the guides render
//! 1:1 where the inline conditionals sat. The fragment preserves the
//! editor suite's direct element reach (no extra DOM wrapper). Class
//! names and the aria-hidden marking are byte-verbatim.

/** The pointer hook's snap publication: one optional coordinate per axis. */
export interface TopologyAlignmentGuide {
  x?: number;
  y?: number;
}

export interface TopologyAlignmentGuidesProps {
  /** The live snap position; a missing axis renders no guide line. */
  alignmentGuide: TopologyAlignmentGuide | null;
}

/** The alignment guides the editor previously rendered inline. */
export function TopologyAlignmentGuides({ alignmentGuide }: TopologyAlignmentGuidesProps) {
  return (
    <>
      {alignmentGuide?.x !== undefined && (
        <div className="alignment-guide alignment-guide-x" style={{ left: alignmentGuide.x }} aria-hidden="true" />
      )}
      {alignmentGuide?.y !== undefined && (
        <div className="alignment-guide alignment-guide-y" style={{ top: alignmentGuide.y }} aria-hidden="true" />
      )}
    </>
  );
}
