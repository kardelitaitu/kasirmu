/**
 * Zero-allocation regression tests for `canvasStateEqual`.
 *
 * The original implementation projected every node/wire into a trimmed object,
 * then compared via `JSON.stringify` — creating O(N+W) temporary arrays and
 * strings per call. During a drag (~60 fps) that was the primary OOM vector:
 * ~80 KB of temp strings × 60 = ~5 MB/s of GC pressure.
 *
 * The replacement does a field-by-field comparison with zero intermediate
 * allocations. These tests lock that invariant so a future refactor cannot
 * reintroduce `map()` / `JSON.stringify` without breaking the suite.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { TopologyNodeData, TopologyWireData } from '../features/locations/NodeTopologyEditor';
import { canvasStateEqual } from '../features/locations/topologyEditorHelpers';

/* ── Fixtures ───────────────────────────────────────────────── */

const baseNodes: TopologyNodeData[] = [
  { id: 'store-1', type: 'store', name: 'Branch', subtitle: 'Primary', x: 80, y: 140 },
  { id: 'ws-1', type: 'workspace', name: 'POS', subtitle: 'Checkout', x: 380, y: 80, metadata: { typeKey: 'store-pos', purposeKey: 'checkout', enabled: true } },
  { id: 'wh-1', type: 'warehouse', name: 'Warehouse', subtitle: 'Storage', x: 680, y: 140, metadata: { capacity: 1000, lowStockThreshold: 50, stock: 200 } },
];

const baseWires: TopologyWireData[] = [
  { id: 'w-1', fromNodeId: 'store-1', toNodeId: 'ws-1', direction: 'one-way', fromPort: 'right', toPort: 'left', label: 'Binds Store' },
  { id: 'w-2', fromNodeId: 'ws-1', toNodeId: 'wh-1', direction: 'one-way', fromPort: 'right', toPort: 'left' },
];

/* ── Allocation spies ───────────────────────────────────────── */

let mapSpy: ReturnType<typeof vi.spyOn>;
let stringifySpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mapSpy = vi.spyOn(Array.prototype, 'map');
  stringifySpy = vi.spyOn(JSON, 'stringify');
});

afterEach(() => {
  mapSpy.mockRestore();
  stringifySpy.mockRestore();
});

/* ── Helpers ────────────────────────────────────────────────── */

/** Run canvasStateEqual and assert zero intermediate allocations. */
function assertNoAllocations(aN: TopologyNodeData[], aW: TopologyWireData[], bN: TopologyNodeData[], bW: TopologyWireData[]) {
  mapSpy.mockClear();
  stringifySpy.mockClear();

  const result = canvasStateEqual(aN, aW, bN, bW);

  expect(mapSpy).not.toHaveBeenCalled();
  expect(stringifySpy).not.toHaveBeenCalled();
  return result;
}

/* ── Tests ──────────────────────────────────────────────────── */

describe('canvasStateEqual', () => {
  // ── Correctness ──────────────────────────────────────────

  it('returns true for identical node and wire arrays', () => {
    const result = canvasStateEqual(baseNodes, baseWires, [...baseNodes], [...baseWires]);
    expect(result).toBe(true);
  });

  it('returns false when node count differs', () => {
    expect(canvasStateEqual(baseNodes, baseWires, baseNodes.slice(0, 1), baseWires)).toBe(false);
  });

  it('returns false when wire count differs', () => {
    expect(canvasStateEqual(baseNodes, baseWires, baseNodes, baseWires.slice(0, 1))).toBe(false);
  });

  it('returns false when a node name changes', () => {
    const changed = baseNodes.map((n, i) => i === 0 ? { ...n, name: 'Renamed' } : n);
    expect(canvasStateEqual(baseNodes, baseWires, changed, baseWires)).toBe(false);
  });

  it('returns false when a node position changes (drag)', () => {
    const moved = baseNodes.map((n, i) => i === 1 ? { ...n, x: n.x + 24 } : n);
    expect(canvasStateEqual(baseNodes, baseWires, moved, baseWires)).toBe(false);
  });

  it('returns false when a wire direction changes', () => {
    const cycled = baseWires.map((w, i) => i === 0 ? { ...w, direction: 'two-way' as const } : w);
    expect(canvasStateEqual(baseNodes, baseWires, baseNodes, cycled)).toBe(false);
  });

  it('returns false when a wire label changes', () => {
    const relabeled = baseWires.map((w, i) => i === 0 ? { ...w, label: 'New Label' } : w);
    expect(canvasStateEqual(baseNodes, baseWires, baseNodes, relabeled)).toBe(false);
  });

  it('returns false when a wire port changes', () => {
    const repported = baseWires.map((w, i) => i === 0 ? { ...w, fromPort: 'left' as const } : w);
    expect(canvasStateEqual(baseNodes, baseWires, baseNodes, repported)).toBe(false);
  });

  it('returns true when only transient fields change (telemetryBadge)', () => {
    const withBadge = baseNodes.map((n, i) => i === 0 ? { ...n, telemetryBadge: 'Online', telemetryStatus: 'online' as const } : n);
    expect(canvasStateEqual(baseNodes, baseWires, withBadge, baseWires)).toBe(true);
  });

  it('returns true when only transient fields change (metadata.persisted)', () => {
    const withPersisted = baseNodes.map((n, i) => i === 1 ? { ...n, metadata: { ...n.metadata, persisted: true } } : n);
    expect(canvasStateEqual(baseNodes, baseWires, withPersisted, baseWires)).toBe(true);
  });

  it('returns false when metadata.typeKey changes', () => {
    const retyped = baseNodes.map((n, i) => i === 1 ? { ...n, metadata: { ...n.metadata, typeKey: 'kds' } } : n);
    expect(canvasStateEqual(baseNodes, baseWires, retyped, baseWires)).toBe(false);
  });

  it('returns false when metadata.stock changes', () => {
    const restocked = baseNodes.map((n, i) => i === 2 ? { ...n, metadata: { ...n.metadata, stock: 500 } } : n);
    expect(canvasStateEqual(baseNodes, baseWires, restocked, baseWires)).toBe(false);
  });

  it('returns false when tierRequirement changes', () => {
    const tiered = baseNodes.map((n, i) => i === 1 ? { ...n, tierRequirement: 'pro' as const } : n);
    expect(canvasStateEqual(baseNodes, baseWires, tiered, baseWires)).toBe(false);
  });

  it('returns true when subtitle is undefined on both sides', () => {
    const noSub = baseNodes.map((n) => { const { subtitle: _, ...rest } = n; return rest; });
    expect(canvasStateEqual(noSub as TopologyNodeData[], baseWires, noSub as TopologyNodeData[], baseWires)).toBe(true);
  });

  it('returns false when one subtitle is defined and the other is not', () => {
    const withSub = [{ ...baseNodes[0]!, subtitle: 'Primary' }, ...baseNodes.slice(1)];
    const noSub = baseNodes.map((n, i) => i === 0 ? (() => { const { subtitle: _, ...rest } = n; return rest; })() : n);
    expect(canvasStateEqual(withSub, baseWires, noSub as TopologyNodeData[], baseWires)).toBe(false);
  });

  it('returns true when both wires have undefined bends', () => {
    const noBends = baseWires.map((w) => { const { bends: _, ...rest } = w; return rest; });
    expect(canvasStateEqual(baseNodes, noBends as TopologyWireData[], baseNodes, noBends as TopologyWireData[])).toBe(true);
  });

  it('returns false when bends differ', () => {
    const a = [...baseWires];
    const b = baseWires.map((w, i) => i === 0 ? { ...w, bends: [{ x: 100, y: 200 }] } : w);
    expect(canvasStateEqual(baseNodes, a, baseNodes, b)).toBe(false);
  });

  it('returns false when bend coordinates differ', () => {
    const a = baseWires.map((w, i) => i === 0 ? { ...w, bends: [{ x: 100, y: 200 }] } : w);
    const b = baseWires.map((w, i) => i === 0 ? { ...w, bends: [{ x: 100, y: 224 }] } : w);
    expect(canvasStateEqual(baseNodes, a, baseNodes, b)).toBe(false);
  });

  it('returns true when both wires have empty bends arrays', () => {
    const a = baseWires.map((w) => ({ ...w, bends: [] as Array<{ x: number; y: number }> }));
    const b = baseWires.map((w) => ({ ...w, bends: [] as Array<{ x: number; y: number }> }));
    expect(canvasStateEqual(baseNodes, a, baseNodes, b)).toBe(true);
  });

  it('returns true when metadata is undefined on both sides', () => {
    const noMeta = baseNodes.map((n) => {
      const { metadata: _, ...rest } = n;
      return rest;
    });
    expect(canvasStateEqual(noMeta as TopologyNodeData[], baseWires, noMeta as TopologyNodeData[], baseWires)).toBe(true);
  });

  it('returns false when one side has metadata and the other does not', () => {
    const withMeta = baseNodes;
    const noMeta = baseNodes.map((n) => {
      const { metadata: _, ...rest } = n;
      return rest;
    });
    expect(canvasStateEqual(withMeta, baseWires, noMeta as TopologyNodeData[], baseWires)).toBe(false);
  });

  it('returns false when metadata.enabled changes', () => {
    const disabled = baseNodes.map((n, i) => i === 1 ? { ...n, metadata: { ...n.metadata, enabled: false } } : n);
    expect(canvasStateEqual(baseNodes, baseWires, disabled, baseWires)).toBe(false);
  });

  it('returns false when metadata.capacity changes', () => {
    const resized = baseNodes.map((n, i) => i === 2 ? { ...n, metadata: { ...n.metadata, capacity: 2000 } } : n);
    expect(canvasStateEqual(baseNodes, baseWires, resized, baseWires)).toBe(false);
  });

  it('returns false when metadata.lowStockThreshold changes', () => {
    const retuned = baseNodes.map((n, i) => i === 2 ? { ...n, metadata: { ...n.metadata, lowStockThreshold: 100 } } : n);
    expect(canvasStateEqual(baseNodes, baseWires, retuned, baseWires)).toBe(false);
  });

  it('returns false when metadata.purposeKey changes',   () => {
    const repurposed = baseNodes.map((n, i) => i === 1 ? { ...n, metadata: { ...n.metadata, purposeKey: 'returns' } } : n);
    expect(canvasStateEqual(baseNodes, baseWires, repurposed, baseWires)).toBe(false);
  });

  it('returns false when a wire node endpoint changes', () => {
    const rewired = baseWires.map((w, i) => i === 0 ? { ...w, toNodeId: 'wh-1' } : w);
    expect(canvasStateEqual(baseNodes, baseWires, baseNodes, rewired)).toBe(false);
  });

  it('returns false when wire fromPort is undefined on one side', () => {
    const a = baseWires.map((w, i) => i === 0 ? { ...w, fromPort: 'right' as const } : w);
    const b = baseWires.map((w) => { const { fromPort: _, ...rest } = w; return rest; });
    expect(canvasStateEqual(baseNodes, a, baseNodes, b as TopologyWireData[])).toBe(false);
  });

  it('returns false when wire toPort changes', () => {
    const repported = baseWires.map((w, i) => i === 0 ? { ...w, toPort: 'right' as const } : w);
    expect(canvasStateEqual(baseNodes, baseWires, baseNodes, repported)).toBe(false);
  });

  it('returns false when wire id changes', () => {
    const rekeyed = baseWires.map((w, i) => i === 0 ? { ...w, id: 'w-new' } : w);
    expect(canvasStateEqual(baseNodes, baseWires, baseNodes, rekeyed)).toBe(false);
  });

  // ── Zero-allocation invariant ─────────────────────────────

  it('does not call Array.prototype.map (zero intermediate arrays)', () => {
    const result = assertNoAllocations(baseNodes, baseWires, [...baseNodes], [...baseWires]);
    expect(result).toBe(true);
  });

  it('does not call JSON.stringify (zero temp strings)', () => {
    assertNoAllocations(baseNodes, baseWires, [...baseNodes], [...baseWires]);
  });

  it('still allocates nothing even when the result is false', () => {
    const moved = baseNodes.map((n, i) => i === 0 ? { ...n, name: 'Changed' } : n);
    const result = assertNoAllocations(baseNodes, baseWires, moved, baseWires);
    expect(result).toBe(false);
  });

  it('allocates nothing on a large diagram (50 nodes, 20 wires)', () => {
    const largeN: TopologyNodeData[] = Array.from({ length: 50 }, (_, i) => ({
      id: `n-${i}`, type: 'workspace' as const, name: `Node ${i}`, x: i * 100, y: i * 60,
      metadata: { typeKey: 'store-pos', enabled: i % 2 === 0, stock: i * 10 },
    }));
    const largeW: TopologyWireData[] = Array.from({ length: 20 }, (_, i) => ({
      id: `w-${i}`, fromNodeId: `n-${i}`, toNodeId: `n-${i + 1}`, direction: 'one-way' as const,
    }));
    assertNoAllocations(largeN, largeW, [...largeN], [...largeW]);
  });

  it('allocates nothing when calling repeatedly (drag simulation: 100 calls)', () => {
    mapSpy.mockClear();
    stringifySpy.mockClear();

    for (let i = 0; i < 100; i++) {
      canvasStateEqual(baseNodes, baseWires, [...baseNodes], [...baseWires]);
    }

    expect(mapSpy).not.toHaveBeenCalled();
    expect(stringifySpy).not.toHaveBeenCalled();
  });
});
