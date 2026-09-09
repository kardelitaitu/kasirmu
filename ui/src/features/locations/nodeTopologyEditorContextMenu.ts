//! Right-click context-menu state and open/close controllers for the
//! topology editor (slice G18).
//!
//! Extracted verbatim from NodeTopologyEditor.tsx: the popover state
//! (ContextMenuPoint | null), the document-level close effect (Escape with
//! stopPropagation + outside-mousedown, cleaned up on close), and the two
//! object-scoped open handlers (openNodeMenu / openWireMenu — right-click
//! selects the object and spawns the menu at container-relative cursor px).
//! Bodies, comments and dep arrays are byte-identical to the inline
//! originals; nothing was rewrapped.
//!
//! The canvas-level context-menu SWALLOW-GATE (right-button pan ends in a
//! contextmenu that must be consumed) stays in the pointer hook — it is a
//! gesture concern, not menu state. The keyboard hook has no menu
//! dependency (verified by grep at extraction time); the consumers of
//! setContextMenu are the pointer hook, the touch hook and the parent's
//! resetTransientCanvasState, all of which keep the identical name through
//! this hook's return.
//!
//! Dep arrays need NO deviations: every name in the original arrays
//! (selectOnly / selectWire / canvasRef / setContextMenu) is either a deps
//! field of this hook or hook-internal state.

import { useCallback, useEffect, useState } from 'react';
import type { ContextMenuPoint } from './nodeTopologyEditorPointer';

/** Everything the menu open-handlers read from the editor. */
export interface TopologyEditorContextMenuDeps {
  /** Canvas element ref — supplies the rect that converts client px to
   *  container-relative menu coordinates. */
  canvasRef: React.RefObject<HTMLDivElement>;
  /** Right-click selects the object (unless Shift is held for additive). */
  selectOnly: (nodeId: string) => void;
  selectWire: (wireId: string) => void;
}

/** Owns the menu state, the document close effect, and the two open
 *  handlers. The returned names are the original locals, so every consumer
 *  (pointer/touch hooks, resetTransientCanvasState, the JSX mount) keeps
 *  its pre-extraction text. */
export function useTopologyEditorContextMenu(deps: TopologyEditorContextMenuDeps) {
  const { canvasRef, selectOnly, selectWire } = deps;

  /** Right-click canvas context menu position (container-relative screen
   *  px). Null while closed. Closed by Escape, any document mousedown
   *  outside the menu, a canvas left-click, or picking an item. */
  const [contextMenu, setContextMenu] = useState<ContextMenuPoint | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  /** Node card context menu (right-click): select the object and open the
   *  NODE menu (rename/duplicate/delete) instead of the canvas menu.
   *  Stable so the memoized cards can receive it as a prop. */
  const openNodeMenu = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.shiftKey) selectOnly(nodeId);
    const rect = canvasRef.current?.getBoundingClientRect();
    setContextMenu({ x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0), nodeId });
  }, [selectOnly, canvasRef, setContextMenu]);

  /** Wire context menu (right-click): object-scoped wire menu (direction +
   *  delete) instead of the canvas menu. Stable. */
  const openWireMenu = useCallback((e: React.MouseEvent, wireId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = canvasRef.current?.getBoundingClientRect();
    selectWire(wireId);
    setContextMenu({ x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0), wireId });
  }, [selectWire, canvasRef, setContextMenu]);

  return { contextMenu, setContextMenu, openNodeMenu, openWireMenu };
}
