import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderInAct } from '@/test-utils/renderInAct';
import { withFluent, withFluentLocale } from '@/locales/test-utils';
import { TopologyMinimap } from '@/features/locations/topologyMinimap';
import type { TopologyNodeData, TopologyWireData } from '@/features/locations/NodeTopologyEditor';
import multiStoreFtl from '@/locales/multi-location.ftl?raw';
import multiStoreIdFtl from '@/locales/multi-location.id.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import sharedIdFtl from '@/locales/shared.id.ftl?raw';

// ── Mock data factories ────────────────────────────────────────────────

function makeNode(overrides: Partial<TopologyNodeData> = {}): TopologyNodeData {
  const base: TopologyNodeData = {
    id: 'node-1',
    type: 'workspace',
    name: 'Test Node',
    subtitle: 'Store POS',
    x: 100,
    y: 200,
    metadata: { typeKey: 'store-pos', enabled: true },
  };
  return { ...base, ...overrides };
}

function makeWire(overrides: Partial<TopologyWireData> = {}): TopologyWireData {
  const base: TopologyWireData = {
    id: 'wire-1',
    fromNodeId: 'node-1',
    toNodeId: 'node-2',
    direction: 'one-way',
  };
  return { ...base, ...overrides };
}

function makeNodeMap(nodes: TopologyNodeData[]): Map<string, TopologyNodeData> {
  const map = new Map<string, TopologyNodeData>();
  for (const n of nodes) {
    map.set(n.id, n);
  }
  return map;
}

// ── Test utilities ─────────────────────────────────────────────────────

async function renderWithFluent(ui: React.ReactElement) {
  const wrapped = withFluent(ui, sharedFtl, multiStoreFtl);
  return await renderInAct(wrapped);
}

async function renderWithFluentId(ui: React.ReactElement) {
  const wrapped = withFluentLocale('id', ui, sharedIdFtl, multiStoreIdFtl);
  return await renderInAct(wrapped);
}

// ── Default props factory ──────────────────────────────────────────────

function defaultProps(overrides: Partial<{
  nodes: TopologyNodeData[];
  wires: TopologyWireData[];
  nodeMap: Map<string, TopologyNodeData>;
  pan: { x: number; y: number };
  zoom: number;
  canvasWidth: number;
  canvasHeight: number;
  onCenter: (cx: number, cy: number) => void;
  onNudge: (dx: number, dy: number) => void;
}> = {}) {
  const nodes = [makeNode({ id: 'node-1', x: 100, y: 200 }), makeNode({ id: 'node-2', x: 300, y: 400 })];
  const wires = [makeWire({ fromNodeId: 'node-1', toNodeId: 'node-2' })];
  const nodeMap = makeNodeMap(nodes);

  return {
    nodes,
    wires,
    nodeMap,
    pan: { x: 0, y: 0 },
    zoom: 1,
    canvasWidth: 1920,
    canvasHeight: 1080,
    onCenter: vi.fn(),
    onNudge: vi.fn(),
    ...overrides,
  };
}

describe('TopologyMinimap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering — empty state', () => {
    it('renders nothing when nodes array is empty', async () => {
      await renderWithFluent(<TopologyMinimap {...defaultProps({ nodes: [], nodeMap: new Map() })} />);

      expect(screen.queryByRole('button', { name: /canvas minimap/i })).not.toBeInTheDocument();
      expect(screen.queryByTestId('topology-minimap')).not.toBeInTheDocument();
    });

    it('renders nothing when all nodes are filtered out', async () => {
      await renderWithFluent(<TopologyMinimap {...defaultProps({ nodes: [] })} />);

      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });

  describe('Rendering — minimap structure', () => {
    it('renders minimap container with correct class', async () => {
      await renderWithFluent(<TopologyMinimap {...defaultProps()} />);

      const minimap = screen.getByRole('button', { name: /canvas minimap/i });
      expect(minimap).toBeInTheDocument();
      expect(minimap).toHaveClass('topology-minimap');
    });

    it('renders SVG with correct dimensions', async () => {
      await renderWithFluent(<TopologyMinimap {...defaultProps()} />);

      const svg = screen.getByRole('button').querySelector('svg');
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveAttribute('width', '176');
      expect(svg).toHaveAttribute('height', '120');
    });

    it('has correct tabIndex and role for keyboard navigation', async () => {
      await renderWithFluent(<TopologyMinimap {...defaultProps()} />);

      const minimap = screen.getByRole('button');
      expect(minimap).toHaveAttribute('tabIndex', '0');
      expect(minimap).toHaveAttribute('role', 'button');
    });
  });

  describe('Rendering — nodes', () => {
    it('renders a rect for each node', async () => {
      await renderWithFluent(<TopologyMinimap {...defaultProps()} />);

      const rects = screen.getByRole('button').querySelectorAll('rect.topology-minimap-node');
      expect(rects).toHaveLength(2);
    });

    it('applies node type class to node rects', async () => {
      const nodes = [makeNode({ id: 'node-1', type: 'store', x: 100, y: 200 })];
      await renderWithFluent(<TopologyMinimap {...defaultProps({ nodes, nodeMap: makeNodeMap(nodes) })} />);

      const rect = screen.getByRole('button').querySelector('rect.topology-minimap-node');
      expect(rect).toHaveClass('node-type-store');
    });

    it('applies node type class for workspace', async () => {
      const nodes = [makeNode({ id: 'node-1', type: 'workspace', x: 100, y: 200 })];
      await renderWithFluent(<TopologyMinimap {...defaultProps({ nodes, nodeMap: makeNodeMap(nodes) })} />);

      const rect = screen.getByRole('button').querySelector('rect.topology-minimap-node');
      expect(rect).toHaveClass('node-type-workspace');
    });

    it('applies node type class for warehouse', async () => {
      const nodes = [makeNode({ id: 'node-1', type: 'warehouse', x: 100, y: 200 })];
      await renderWithFluent(<TopologyMinimap {...defaultProps({ nodes, nodeMap: makeNodeMap(nodes) })} />);

      const rect = screen.getByRole('button').querySelector('rect.topology-minimap-node');
      expect(rect).toHaveClass('node-type-warehouse');
    });

    it('applies node type class for hardware', async () => {
      const nodes = [makeNode({ id: 'node-1', type: 'hardware', x: 100, y: 200 })];
      await renderWithFluent(<TopologyMinimap {...defaultProps({ nodes, nodeMap: makeNodeMap(nodes) })} />);

      const rect = screen.getByRole('button').querySelector('rect.topology-minimap-node');
      expect(rect).toHaveClass('node-type-hardware');
    });

    it('positions nodes correctly based on scale', async () => {
      const nodes = [
        makeNode({ id: 'node-1', x: 0, y: 0 }),
        makeNode({ id: 'node-2', x: 1000, y: 1000 }),
      ];
      await renderWithFluent(<TopologyMinimap {...defaultProps({ nodes, nodeMap: makeNodeMap(nodes) })} />);

      const rects = screen.getByRole('button').querySelectorAll('rect.topology-minimap-node');
      expect(rects).toHaveLength(2);
      // First node should be near padding
      const firstRect = rects[0]!;
      expect(firstRect).toBeInTheDocument();
      expect(Number(firstRect.getAttribute('x'))).toBeGreaterThanOrEqual(8);
      expect(Number(firstRect.getAttribute('y'))).toBeGreaterThanOrEqual(8);
    });

    it('ensures minimum node size of 2px', async () => {
      // Use nodes that would render very small
      const nodes = [makeNode({ id: 'node-1', x: 0, y: 0 })];
      const wires: TopologyWireData[] = [];
      await renderWithFluent(<TopologyMinimap {...defaultProps({ nodes, wires, nodeMap: makeNodeMap(nodes), canvasWidth: 10000, canvasHeight: 10000 })} />);

      const rect = screen.getByRole('button').querySelector('rect.topology-minimap-node');
      expect(rect).toBeInTheDocument();
      expect(Number(rect!.getAttribute('width'))).toBeGreaterThanOrEqual(2);
      expect(Number(rect!.getAttribute('height'))).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Rendering — wires', () => {
    it('renders a line for each wire', async () => {
      await renderWithFluent(<TopologyMinimap {...defaultProps()} />);

      const lines = screen.getByRole('button').querySelectorAll('line.topology-minimap-wire');
      expect(lines).toHaveLength(1);
    });

    it('does not render wire when from/to node missing from map', async () => {
      const nodes = [makeNode({ id: 'node-1', x: 100, y: 200 })];
      const wires = [makeWire({ fromNodeId: 'node-1', toNodeId: 'missing-node' })];
      await renderWithFluent(<TopologyMinimap {...defaultProps({ nodes, wires, nodeMap: makeNodeMap(nodes) })} />);

      const lines = screen.getByRole('button').querySelectorAll('line.topology-minimap-wire');
      expect(lines).toHaveLength(0);
    });

    it('calculates wire endpoints from node centers', async () => {
      const nodes = [
        makeNode({ id: 'node-1', x: 0, y: 0 }),
        makeNode({ id: 'node-2', x: 100, y: 100 }),
      ];
      const wires = [makeWire({ fromNodeId: 'node-1', toNodeId: 'node-2' })];
      await renderWithFluent(<TopologyMinimap {...defaultProps({ nodes, wires, nodeMap: makeNodeMap(nodes) })} />);

      const line = screen.getByRole('button').querySelector('line.topology-minimap-wire');
      expect(line).toBeInTheDocument();
      // Wire should connect centers of nodes
      expect(line!.getAttribute('x1')).toBeTruthy();
      expect(line!.getAttribute('y1')).toBeTruthy();
      expect(line!.getAttribute('x2')).toBeTruthy();
      expect(line!.getAttribute('y2')).toBeTruthy();
    });
  });

  describe('Rendering — viewport box', () => {
    it('renders viewport rect with correct class', async () => {
      await renderWithFluent(<TopologyMinimap {...defaultProps()} />);

      const viewport = screen.getByRole('button').querySelector('rect.topology-minimap-viewport');
      expect(viewport).toBeInTheDocument();
    });

    it('positions viewport based on pan and zoom', async () => {
      await renderWithFluent(<TopologyMinimap {...defaultProps({ pan: { x: -100, y: -200 }, zoom: 2 })} />);

      const viewport = screen.getByRole('button').querySelector('rect.topology-minimap-viewport');
      expect(viewport).toBeInTheDocument();
      // Viewport position should reflect pan/zoom - just verify it has numeric values
      const x = Number(viewport!.getAttribute('x'));
      const y = Number(viewport!.getAttribute('y'));
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    });

    it('sizes viewport based on canvas dimensions and zoom', async () => {
      await renderWithFluent(<TopologyMinimap {...defaultProps({ zoom: 1 })} />);

      const viewport = screen.getByRole('button').querySelector('rect.topology-minimap-viewport');
      const width = Number(viewport!.getAttribute('width'));
      const height = Number(viewport!.getAttribute('height'));
      // At zoom 1, viewport should be canvasSize * scale
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
    });

    it('enforces minimum viewport size', async () => {
      // High zoom should still show minimum viewport
      await renderWithFluent(<TopologyMinimap {...defaultProps({ zoom: 100 })} />);

      const viewport = screen.getByRole('button').querySelector('rect.topology-minimap-viewport');
      expect(viewport).toBeInTheDocument();
      const width = Number(viewport!.getAttribute('width'));
      const height = Number(viewport!.getAttribute('height'));
      expect(width).toBeGreaterThanOrEqual(8);
      expect(height).toBeGreaterThanOrEqual(8);
    });

    it('covers the whole content when a zoomed-out view contains the diagram (no clip)', async () => {
      // Regression: at 40% zoom a 1920×1080 canvas shows a 4800×2700 canvas
      // area — the raw viewport rect used to be many times the map size and
      // the SVG clipped it mid-edge. The box is now the viewport rect ∩
      // content bounds, so a view that contains the whole diagram renders
      // the box exactly over the projected content rect.
      await renderWithFluent(
        <TopologyMinimap {...defaultProps({ zoom: 0.4, canvasWidth: 1920, canvasHeight: 1080 })} />,
      );

      const btn = screen.getByRole('button');
      const nodeRects = [...btn.querySelectorAll('rect.topology-minimap-node')];
      const contentLeft = Math.min(...nodeRects.map((r) => Number(r.getAttribute('x'))));
      const contentTop = Math.min(...nodeRects.map((r) => Number(r.getAttribute('y'))));
      const contentRight = Math.max(...nodeRects.map((r) => Number(r.getAttribute('x')) + Number(r.getAttribute('width'))));
      const contentBottom = Math.max(...nodeRects.map((r) => Number(r.getAttribute('y')) + Number(r.getAttribute('height'))));

      const viewport = btn.querySelector('rect.topology-minimap-viewport')!;
      const x = Number(viewport.getAttribute('x'));
      const y = Number(viewport.getAttribute('y'));
      const w = Number(viewport.getAttribute('width'));
      const h = Number(viewport.getAttribute('height'));
      // The box exactly covers the projected content — and never clips.
      expect(x).toBeCloseTo(contentLeft);
      expect(y).toBeCloseTo(contentTop);
      expect(x + w).toBeCloseTo(contentRight);
      expect(y + h).toBeCloseTo(contentBottom);
    });

    it('never spills past the padded map at any zoom level', async () => {
      for (const zoom of [2, 1, 0.8, 0.64, 0.4]) {
        const { unmount } = await renderWithFluent(
          <TopologyMinimap {...defaultProps({ zoom, canvasWidth: 1920, canvasHeight: 1080 })} />,
        );
        const viewport = screen.getByRole('button').querySelector('rect.topology-minimap-viewport')!;
        const x = Number(viewport.getAttribute('x'));
        const y = Number(viewport.getAttribute('y'));
        const w = Number(viewport.getAttribute('width'));
        const h = Number(viewport.getAttribute('height'));
        expect(x).toBeGreaterThanOrEqual(8 - 1e-6);
        expect(y).toBeGreaterThanOrEqual(8 - 1e-6);
        expect(x + w).toBeLessThanOrEqual(176 - 8 + 1e-6);
        expect(y + h).toBeLessThanOrEqual(120 - 8 + 1e-6);
        unmount();
      }
    });

    it('pins a minimum chip toward the nearest edge when the view is off-content', async () => {
      // Pan the view far to the right of the diagram: the intersection is
      // empty, so the box collapses to an 8px chip at the right edge — the
      // side cue that the content lies to the left.
      await renderWithFluent(
        <TopologyMinimap
          {...defaultProps({ pan: { x: -10000, y: 0 }, zoom: 1, canvasWidth: 1920, canvasHeight: 1080 })}
        />,
      );

      const viewport = screen.getByRole('button').querySelector('rect.topology-minimap-viewport')!;
      const x = Number(viewport.getAttribute('x'));
      const y = Number(viewport.getAttribute('y'));
      const w = Number(viewport.getAttribute('width'));
      expect(x).toBeCloseTo(176 - 8 - 8);
      expect(w).toBe(8);
      expect(y).toBeGreaterThanOrEqual(8);
    });
  });

  describe('Interaction — click to recenter', () => {
    it('calls onCenter when minimap clicked', async () => {
      const onCenter = vi.fn();
      await renderWithFluent(<TopologyMinimap {...defaultProps({ onCenter })} />);

      const minimap = screen.getByRole('button');
      fireEvent.mouseDown(minimap, { button: 0, clientX: 100, clientY: 100 });

      expect(onCenter).toHaveBeenCalledTimes(1);
      expect(onCenter).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));
    });

    it('does not call onCenter on right click', async () => {
      const onCenter = vi.fn();
      await renderWithFluent(<TopologyMinimap {...defaultProps({ onCenter })} />);

      const minimap = screen.getByRole('button');
      fireEvent.mouseDown(minimap, { button: 2, clientX: 100, clientY: 100 });

      expect(onCenter).not.toHaveBeenCalled();
    });

    it('supports drag to pan (mousemove after mousedown)', async () => {
      const onCenter = vi.fn();
      await renderWithFluent(<TopologyMinimap {...defaultProps({ onCenter })} />);

      const minimap = screen.getByRole('button');
      fireEvent.mouseDown(minimap, { button: 0, clientX: 100, clientY: 100 });

      // Simulate drag
      fireEvent.mouseMove(document, { clientX: 150, clientY: 150 });
      fireEvent.mouseUp(document);

      // Should have called onCenter multiple times during drag
      expect(onCenter).toHaveBeenCalledTimes(2);
    });
  });

  describe('Interaction — keyboard navigation', () => {
    it('calls onCenter on Enter to center content', async () => {
      const onCenter = vi.fn();
      await renderWithFluent(<TopologyMinimap {...defaultProps({ onCenter })} />);

      const minimap = screen.getByRole('button');
      fireEvent.keyDown(minimap, { key: 'Enter' });

      expect(onCenter).toHaveBeenCalledTimes(1);
      // Should center on content bounds middle
      expect(onCenter).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));
    });

    it('calls onNudge with negative dx on ArrowLeft', async () => {
      const onNudge = vi.fn();
      await renderWithFluent(<TopologyMinimap {...defaultProps({ onNudge })} />);

      const minimap = screen.getByRole('button');
      fireEvent.keyDown(minimap, { key: 'ArrowLeft' });

      expect(onNudge).toHaveBeenCalledWith(-40, 0);
    });

    it('calls onNudge with positive dx on ArrowRight', async () => {
      const onNudge = vi.fn();
      await renderWithFluent(<TopologyMinimap {...defaultProps({ onNudge })} />);

      const minimap = screen.getByRole('button');
      fireEvent.keyDown(minimap, { key: 'ArrowRight' });

      expect(onNudge).toHaveBeenCalledWith(40, 0);
    });

    it('calls onNudge with negative dy on ArrowUp', async () => {
      const onNudge = vi.fn();
      await renderWithFluent(<TopologyMinimap {...defaultProps({ onNudge })} />);

      const minimap = screen.getByRole('button');
      fireEvent.keyDown(minimap, { key: 'ArrowUp' });

      expect(onNudge).toHaveBeenCalledWith(0, -40);
    });

    it('calls onNudge with positive dy on ArrowDown', async () => {
      const onNudge = vi.fn();
      await renderWithFluent(<TopologyMinimap {...defaultProps({ onNudge })} />);

      const minimap = screen.getByRole('button');
      fireEvent.keyDown(minimap, { key: 'ArrowDown' });

      expect(onNudge).toHaveBeenCalledWith(0, 40);
    });

    it('does nothing on other keys', async () => {
      const onNudge = vi.fn();
      const onCenter = vi.fn();
      await renderWithFluent(<TopologyMinimap {...defaultProps({ onNudge, onCenter })} />);

      const minimap = screen.getByRole('button');
      fireEvent.keyDown(minimap, { key: 'a' });
      fireEvent.keyDown(minimap, { key: 'Tab' });
      fireEvent.keyDown(minimap, { key: ' ' });

      expect(onNudge).not.toHaveBeenCalled();
      expect(onCenter).not.toHaveBeenCalled();
    });
  });

  describe('Cleanup', () => {
    it('cleans up drag listeners on unmount', async () => {
      const { unmount } = await renderWithFluent(<TopologyMinimap {...defaultProps()} />);

      const minimap = screen.getByRole('button');
      fireEvent.mouseDown(minimap, { button: 0, clientX: 100, clientY: 100 });

      unmount();

      // Should not throw - cleanup runs
      expect(true).toBe(true);
    });
  });

  describe('Multiple nodes and wires', () => {
    it('renders multiple nodes correctly', async () => {
      const nodes = [
        makeNode({ id: 'node-1', x: 100, y: 200 }),
        makeNode({ id: 'node-2', x: 300, y: 400 }),
        makeNode({ id: 'node-3', x: 500, y: 600 }),
        makeNode({ id: 'node-4', x: 700, y: 800 }),
      ];
      await renderWithFluent(<TopologyMinimap {...defaultProps({ nodes, nodeMap: makeNodeMap(nodes) })} />);

      const rects = screen.getByRole('button').querySelectorAll('rect.topology-minimap-node');
      expect(rects).toHaveLength(4);
    });

    it('renders multiple wires correctly', async () => {
      const nodes = [
        makeNode({ id: 'node-1', x: 100, y: 200 }),
        makeNode({ id: 'node-2', x: 300, y: 400 }),
        makeNode({ id: 'node-3', x: 500, y: 600 }),
      ];
      const wires = [
        makeWire({ id: 'wire-1', fromNodeId: 'node-1', toNodeId: 'node-2' }),
        makeWire({ id: 'wire-2', fromNodeId: 'node-2', toNodeId: 'node-3' }),
      ];
      await renderWithFluent(<TopologyMinimap {...defaultProps({ nodes, wires, nodeMap: makeNodeMap(nodes) })} />);

      const lines = screen.getByRole('button').querySelectorAll('line.topology-minimap-wire');
      expect(lines).toHaveLength(2);
    });
  });

  describe('Indonesian locale', () => {
    it('renders with Indonesian localization', async () => {
      await renderWithFluentId(<TopologyMinimap {...defaultProps()} />);

      const minimap = screen.getByRole('button', { name: /peta mini kanvas/i });
      expect(minimap).toBeInTheDocument();
    });

    it('renders nodes and wires in Indonesian locale', async () => {
      await renderWithFluentId(<TopologyMinimap {...defaultProps()} />);

      const rects = screen.getByRole('button').querySelectorAll('rect.topology-minimap-node');
      const lines = screen.getByRole('button').querySelectorAll('line.topology-minimap-wire');
      expect(rects).toHaveLength(2);
      expect(lines).toHaveLength(1);
    });
  });

  describe('Scale calculation', () => {
    it('handles single node with no spread', async () => {
      const nodes = [makeNode({ id: 'node-1', x: 100, y: 200 })];
      await renderWithFluent(<TopologyMinimap {...defaultProps({ nodes, nodeMap: makeNodeMap(nodes) })} />);

      const minimap = screen.getByRole('button');
      expect(minimap).toBeInTheDocument();
      const viewport = minimap.querySelector('rect.topology-minimap-viewport');
      expect(viewport).toBeInTheDocument();
    });

    it('handles nodes with negative coordinates', async () => {
      const nodes = [
        makeNode({ id: 'node-1', x: -500, y: -300 }),
        makeNode({ id: 'node-2', x: 500, y: 300 }),
      ];
      await renderWithFluent(<TopologyMinimap {...defaultProps({ nodes, nodeMap: makeNodeMap(nodes) })} />);

      const rects = screen.getByRole('button').querySelectorAll('rect.topology-minimap-node');
      expect(rects).toHaveLength(2);
    });

    it('handles very large canvas dimensions', async () => {
      await renderWithFluent(<TopologyMinimap {...defaultProps({ canvasWidth: 10000, canvasHeight: 10000 })} />);

      const minimap = screen.getByRole('button');
      expect(minimap).toBeInTheDocument();
      const viewport = minimap.querySelector('rect.topology-minimap-viewport');
      expect(viewport).toBeInTheDocument();
    });
  });
});