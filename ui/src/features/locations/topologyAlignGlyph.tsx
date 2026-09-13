/**
 * Alignment toolbar glyph + its shared mode vocabulary, extracted from
 * `NodeTopologyEditor.tsx` (Phase 1 split). `AlignMode` describes the 8
 * alignment/distribution operations; `ALIGN_ACTIONS` maps each to an aria
 * id for the multi-select toolbar; `AlignGlyph` renders the compact
 * three-bar icon encoding the mode. Pure presentational — no editor state.
 */

/** Alignment / distribution modes for the multi-select toolbar. */
export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom' | 'dist-h' | 'dist-v';

export const ALIGN_ACTIONS: { mode: AlignMode; ariaId: string }[] = [
  { mode: 'left', ariaId: 'topology-align-left' },
  { mode: 'hcenter', ariaId: 'topology-align-hcenter' },
  { mode: 'right', ariaId: 'topology-align-right' },
  { mode: 'top', ariaId: 'topology-align-top' },
  { mode: 'vcenter', ariaId: 'topology-align-vcenter' },
  { mode: 'bottom', ariaId: 'topology-align-bottom' },
  { mode: 'dist-h', ariaId: 'topology-distribute-h' },
  { mode: 'dist-v', ariaId: 'topology-distribute-v' },
];

/** Compact alignment glyphs — three bars whose arrangement encodes the
 *  mode (edges, centers, or even spacing), matching the standard diagram-
 *  tool icon language. */
export function AlignGlyph({ mode }: { mode: AlignMode }) {
  let bars: JSX.Element[];
  switch (mode) {
    case 'left':
      bars = [0, 4, 8].map((y) => <rect key={y} x={0} y={y} width={16 - y} height={3} rx={1} fill="currentColor" />);
      break;
    case 'hcenter':
      bars = [0, 4, 8].map((y) => <rect key={y} x={y / 2} y={y} width={16 - y} height={3} rx={1} fill="currentColor" />);
      break;
    case 'right':
      bars = [0, 4, 8].map((y) => <rect key={y} x={y} y={y} width={16 - y} height={3} rx={1} fill="currentColor" />);
      break;
    case 'top':
      bars = [0, 4, 8].map((x) => <rect key={x} x={x} y={0} width={3} height={16 - x} rx={1} fill="currentColor" />);
      break;
    case 'vcenter':
      bars = [0, 4, 8].map((x) => <rect key={x} x={x} y={x / 2} width={3} height={16 - x} rx={1} fill="currentColor" />);
      break;
    case 'bottom':
      bars = [0, 4, 8].map((x) => <rect key={x} x={x} y={x} width={3} height={16 - x} rx={1} fill="currentColor" />);
      break;
    case 'dist-h':
      bars = [0, 6.5, 13].map((x) => <rect key={x} x={x} y={6.5} width={3} height={3} rx={1} fill="currentColor" />);
      break;
    case 'dist-v':
      bars = [0, 6.5, 13].map((y) => <rect key={y} x={6.5} y={y} width={3} height={3} rx={1} fill="currentColor" />);
      break;
  }
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      {bars}
    </svg>
  );
}
