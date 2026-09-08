//! Selection, snap, and gesture announcements for the topology editor
//! (Phase 3.3 extraction).
//!
//! Owns the visually-hidden live-region state (the editor renders it as
//! `role="status" aria-live="polite"`) and the two SCHEDULED effects:
//! the snap-announcement entry latch (fires on null → guide only — the
//! recreated guide object must not re-announce while the guide stays
//! visible; the mouseup clear resets the latch so the next approach
//! re-announces) and the selection settle debounce (a marquee that
//! flicks 1→2→3 announces once, with the final set; wire selection,
//! multi-node counts, and clears are all announced). One-shot
//! announcements (layout, duplicate commit/cancel, migration) are
//! imperative writes via `announce`; their message composition stays at
//! the call sites so each owns its own l10n keys. The settle timer is
//! cleared on unmount so a pending settle never writes after unmount.

import { useEffect, useRef, useState } from 'react';
import type { ReactLocalization } from '@fluent/react';

/** Milliseconds the selection-announcement waits after the LAST selection
 *  change before speaking. Long enough to absorb a marquee drag that
 *  flicks 1→2→3 (one announcement, on the final set), short enough that a
 *  click or keyboard select still feels immediate. */
export const SELECTION_ANNOUNCE_SETTLE_MS = 120;

export interface TopologyAnnouncementDeps {
  /** Current alignment-guide state: null while idle, the guide while a
   *  drag/nudge is snapped. Drives the snap entry latch. */
  alignmentGuide: { x?: number; y?: number } | null;
  selectedNodeIds: Set<string>;
  selectedWireId: string | null;
  /** Node id → node, for the single-selection name lookup. */
  nodeMap: Map<string, { name: string }>;
  /** Latest localization, read at announce time so announcement strings
   *  always come from the current bundle. */
  l10nRef: { current: ReactLocalization };
}

/**
 * Own the editor's live-announcement state: `announcement` feeds the
 * rendered live region; `announce` is the imperative one-shot write the
 * gesture callbacks use.
 */
export function useTopologyEditorAnnouncements(deps: TopologyAnnouncementDeps): {
  announcement: string;
  announce: (message: string) => void;
} {
  const { alignmentGuide, selectedNodeIds, selectedWireId, nodeMap, l10nRef } = deps;
  const [announcement, setAnnouncement] = useState('');
  const announce = setAnnouncement;

  // Accessible snap feedback: the alignment guides are aria-hidden, so the
  // live region announces when a drag/nudge SNAPS. The announcement fires
  // on ENTRY only (null → guide); while the guide stays visible (snapped),
  // the recreated guide object must not re-announce on every mousemove —
  // the mouseup clear resets the latch so the next approach re-announces.
  const prevGuideRef = useRef<{ x?: number; y?: number } | null>(null);
  useEffect(() => {
    const prev = prevGuideRef.current;
    prevGuideRef.current = alignmentGuide;
    if (alignmentGuide && !prev) {
      setAnnouncement(l10nRef.current.getString('topology-snap-announce'));
    }
  }, [alignmentGuide, l10nRef]);

  // Announce selection changes through the polite live region. The cards
  // cannot carry aria-selected (role=group supports no selection state;
  // axe flagged it, and no aria-selected role allows their nested
  // controls), so the spoken summary IS the screen-reader contract for
  // selection. Settled like the issues readout: a marquee that flickers
  // 1→2→3 announces once with the final set. Wire selection, multi-node
  // counts, and clears are all announced.
  const selectionAnnounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSelectionSignatureRef = useRef('');
  useEffect(() => {
    const signature = [...selectedNodeIds].sort().join('|') + (selectedWireId ? `|w:${selectedWireId}` : '');
    if (signature === prevSelectionSignatureRef.current) return;
    prevSelectionSignatureRef.current = signature;
    const announceSelection = () => {
      if (selectedWireId) return l10nRef.current.getString('topology-selection-wire-announce');
      if (selectedNodeIds.size === 0) return l10nRef.current.getString('topology-selection-clear-announce');
      if (selectedNodeIds.size === 1) {
        const onlyId = [...selectedNodeIds][0]!;
        return l10nRef.current.getString('topology-selection-announce', { name: nodeMap.get(onlyId)?.name ?? onlyId });
      }
      return l10nRef.current.getString('topology-status-selection', { count: selectedNodeIds.size });
    };
    if (selectionAnnounceTimerRef.current) clearTimeout(selectionAnnounceTimerRef.current);
    selectionAnnounceTimerRef.current = setTimeout(() => {
      selectionAnnounceTimerRef.current = null;
      setAnnouncement(announceSelection());
    }, SELECTION_ANNOUNCE_SETTLE_MS);
  }, [selectedNodeIds, selectedWireId, nodeMap, l10nRef]);

  useEffect(
    () => () => {
      if (selectionAnnounceTimerRef.current) clearTimeout(selectionAnnounceTimerRef.current);
    },
    [],
  );

  return { announcement, announce };
}
