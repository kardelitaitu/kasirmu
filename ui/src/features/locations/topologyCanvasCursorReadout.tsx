import { memo, useEffect, useRef, useState } from 'react';

/**
 * HUD cursor-position readout, isolated in its own memo component with
 * its own document mousemove listener and rAF throttle. The readout is
 * display-only, so a burst of moves coalesces into at most ONE state
 * update per frame — and that update is LOCAL to this span, so pointer
 * movement over a large diagram never re-renders the editor (which used
 * to re-render every node card and wire path up to 60×/sec). pan/zoom
 * come in as props so the conversion to canvas coords stays current.
 *
 * Extracted from `NodeTopologyEditor.tsx` (Phase 1 split).
 */
export const CanvasCursorReadout = memo(function CanvasCursorReadout({ pan, zoom }: { pan: { x: number; y: number }; zoom: number }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const elRef = useRef<HTMLSpanElement>(null);
  // Mount-once listener: pan/zoom are read via refs inside the handler so a
  // pan/zoom change never re-arms (and cancels a pending) rAF. Re-arming on
  // every pan would ALSO cancel an in-flight frame — leaving the readout
  // stuck until the next move re-schedules.
  const panRef = useRef(pan);
  panRef.current = pan;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      // The readout lives inside the canvas container; its rect is the
      // viewport origin for the pan/zoom conversion.
      const rect = elRef.current?.closest('.node-canvas-container')?.getBoundingClientRect();
      if (!rect) return;
      pendingRef.current = {
        x: Math.round((e.clientX - rect.left - panRef.current.x) / zoomRef.current),
        y: Math.round((e.clientY - rect.top - panRef.current.y) / zoomRef.current),
      };
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          setPos(pendingRef.current);
        });
      }
    };
    document.addEventListener('mousemove', onMove);
    return () => {
      document.removeEventListener('mousemove', onMove);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <span ref={elRef} className="canvas-hud-item canvas-hud-cursor">
      {pos ? `${pos.x}, ${pos.y}` : '—'}
    </span>
  );
});
