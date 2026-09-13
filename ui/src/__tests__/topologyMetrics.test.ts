// ── topologyMetrics tests ─────────────────────────────────────────
//
// Pins the adaptive-height node card model (round 174): every height is a
// pure function of node type + port rows, so wire geometry, overlap
// detection, auto-layout, and the minimap can all compute in canvas space
// without measuring the DOM.

import { describe, expect, it } from 'vitest';
import type { TopologyNodeData } from '@/features/locations/NodeTopologyEditor';
import {
  NODE_HEADER_H,
  NODE_BODY_PAD,
  NODE_BODY_GAP,
  META_ROW_H,
  STATUS_ROW_H,
  CONFIG_ROW_H,
  PORT_ROW_H,
  mainRowCount,
  mainHeight,
  leftPortRowCount,
  rightPortRowCount,
  portRowCount,
  footerHeight,
  nodeHeight,
  portRowCenterY,
  semanticRowIndex,
} from '@/features/locations/topologyMetrics';

function node(overrides: Partial<TopologyNodeData>): TopologyNodeData {
  return {
    id: 'n-1',
    type: 'workspace',
    name: 'Node',
    x: 0,
    y: 0,
    metadata: { typeKey: 'store-pos' },
    ...overrides,
  };
}

const STORE = node({ type: 'store' });
const STORE_POS = node({ type: 'workspace', metadata: { typeKey: 'store-pos' } });
const RESTO = node({ type: 'workspace', metadata: { typeKey: 'restaurant-pos' } });
const KDS = node({ type: 'workspace', metadata: { typeKey: 'kds' } });
const WAREHOUSE = node({ type: 'warehouse' });
const HARDWARE = node({ type: 'hardware' });

describe('topologyMetrics', () => {
  it('computes main rows per node kind (workspace adds two config rows)', () => {
    expect(mainRowCount(STORE_POS)).toBe(4);
    expect(mainRowCount(RESTO)).toBe(4);
    expect(mainRowCount(STORE)).toBe(2);
    expect(mainRowCount(WAREHOUSE)).toBe(2);
    expect(mainRowCount(HARDWARE)).toBe(2);
  });

  it('applies the main-height floor to content-light cards', () => {
    // Content-light cards (store/warehouse/hardware): 24 pad + 8 gap +
    // 29 meta + 24 status = 85, above the MAIN_MIN_H floor.
    const light = NODE_BODY_PAD + NODE_BODY_GAP + META_ROW_H + STATUS_ROW_H;
    expect(mainHeight(STORE)).toBe(light);
    expect(mainHeight(WAREHOUSE)).toBe(light);
    // Workspace adds two config rows: + 2×CONFIG_ROW_H + 2 more gaps.
    expect(mainHeight(STORE_POS)).toBe(
      NODE_BODY_PAD + NODE_BODY_GAP * 3 + META_ROW_H + STATUS_ROW_H + 2 * CONFIG_ROW_H,
    );
  });

  it('counts stacked port rows per column from the semantic registry', () => {
    // Store: no left, one right (location-out).
    expect(leftPortRowCount(STORE)).toBe(0);
    expect(rightPortRowCount(STORE)).toBe(1);
    // Store POS: one left input, three right outputs.
    expect(leftPortRowCount(STORE_POS)).toBe(1);
    expect(rightPortRowCount(STORE_POS)).toBe(3);
    // Warehouse: four left inputs, one right output.
    expect(leftPortRowCount(WAREHOUSE)).toBe(4);
    expect(rightPortRowCount(WAREHOUSE)).toBe(1);
    // KDS: one input + one ticket output.
    expect(leftPortRowCount(KDS)).toBe(1);
    expect(rightPortRowCount(KDS)).toBe(1);
    // Hardware: two left (generic/ticket), one right.
    expect(leftPortRowCount(HARDWARE)).toBe(2);
    expect(rightPortRowCount(HARDWARE)).toBe(1);
  });

  it('sizes the footer to the taller column', () => {
    expect(portRowCount(STORE)).toBe(1);
    expect(portRowCount(STORE_POS)).toBe(3);
    expect(portRowCount(WAREHOUSE)).toBe(4);
    expect(footerHeight(WAREHOUSE)).toBe(4 * PORT_ROW_H);
    expect(footerHeight(STORE_POS)).toBe(3 * PORT_ROW_H);
  });

  it('computes a pure adaptive total height', () => {
    // header + main + footer
    const light = NODE_BODY_PAD + NODE_BODY_GAP + META_ROW_H + STATUS_ROW_H;
    expect(nodeHeight(STORE)).toBe(NODE_HEADER_H + light + PORT_ROW_H);
    expect(nodeHeight(STORE_POS)).toBe(
      NODE_HEADER_H
      + (NODE_BODY_PAD + NODE_BODY_GAP * 3 + META_ROW_H + STATUS_ROW_H + 2 * CONFIG_ROW_H)
      + 3 * PORT_ROW_H,
    );
    expect(nodeHeight(WAREHOUSE)).toBe(NODE_HEADER_H + light + 4 * PORT_ROW_H);
  });

  it('places port-row centers below header + main, top-aligned', () => {
    // Store POS: row 0 center = header + main + 10.
    const main = mainHeight(STORE_POS);
    expect(portRowCenterY(STORE_POS, 0)).toBe(NODE_HEADER_H + main + PORT_ROW_H / 2);
    expect(portRowCenterY(STORE_POS, 1)).toBe(NODE_HEADER_H + main + PORT_ROW_H / 2 + PORT_ROW_H);
    expect(portRowCenterY(STORE_POS, 2)).toBe(NODE_HEADER_H + main + PORT_ROW_H / 2 + 2 * PORT_ROW_H);
  });

  it('resolves a recorded semantic to its socket row, falling back to row 0', () => {
    // Store POS right column order: stock-out, transfer-out, operation-out.
    expect(semanticRowIndex(STORE_POS, 'right', 'stock-out')).toBe(0);
    expect(semanticRowIndex(STORE_POS, 'right', 'transfer-out')).toBe(1);
    expect(semanticRowIndex(STORE_POS, 'right', 'operation-out')).toBe(2);
    // Unknown semantic folds to the primary row.
    expect(semanticRowIndex(STORE_POS, 'right', 'nonsense')).toBe(0);
  });
});
