// ── Node card metrics ─────────────────────────────────────────────
//
// Adaptive-height node boxes (round 174): the card is a three-region flex
// column — fixed header, content-driven main, port-driven footer — so a
// Warehouse with four stacked inputs grows while a Store stays compact.
//
// The geometry layer (wires, overlap, auto-layout, minimap, alignment)
// computes in TS canvas-space and can never measure the DOM, so every
// height must be a PURE function of the node's type and its port rows.
// This module is that single source of truth; CSS mirrors it, and the
// wire endpoints use portRowCenterY for the exact socket the wire
// attaches to (replacing the old constant NODE_PORT_Y rail).
//
// Rows are top-aligned within each column: the footer height is the
// taller of the two columns, and both left and right stacks start at the
// top of that band.

import type { TopologyNodeData, PortName } from './NodeTopologyEditor';
import { socketSemanticIds } from './topologyCard';

/** Fixed card header height (CSS `.node-header`). */
export const NODE_HEADER_H = 48;
/** Height of one stacked port row in the footer (CSS `.node-port-row`). */
export const PORT_ROW_H = 20;
/** Height of one main-content row (subtitle / status / config). */
export const MAIN_ROW_H = 24;
/** Minimum main-body height so a content-light card never collapses. */
export const MAIN_MIN_H = 56;

// ── Body content row heights (CSS values, kept in lockstep) ──────
/** Body padding top+bottom (2 × var(--space-3) = 2 × 12px). */
export const NODE_BODY_PAD = 24;
/** Gap between body rows (var(--space-2) = 8px). */
export const NODE_BODY_GAP = 8;
/** Subtitle row (min-height 2.4em at text-xs 12px = 28.8px ≈ 29). */
export const META_ROW_H = 29;
/** Status badge row (min-height 24px). */
export const STATUS_ROW_H = 24;
/** Config row (name input / enabled toggle, min-height 28px). */
export const CONFIG_ROW_H = 28;

/** Main-content rows per node kind. Used by the test suite to verify the
 *  row-count model; mainHeight() now uses the explicit budget below. */
export function mainRowCount(node: TopologyNodeData): number {
  return node.type === 'workspace' ? 4 : 2;
}

/** Height of the card's main region (between header and footer). The
 *  row-count × MAIN_ROW_H model underestimated real content by ~60px
 *  because it omitted body padding, inter-row gaps, and the fact that
 *  config rows are taller than MAIN_ROW_H. The explicit budget below
 *  mirrors the actual CSS layout so the card never clips its content. */
export function mainHeight(node: TopologyNodeData): number {
  const configRows = node.type === 'workspace' ? 2 : 0;
  const rowCount = 2 + configRows; // meta + status + configs
  const rowHeights = META_ROW_H + STATUS_ROW_H + configRows * CONFIG_ROW_H;
  const gaps = NODE_BODY_GAP * Math.max(0, rowCount - 1);
  return Math.max(MAIN_MIN_H, NODE_BODY_PAD + gaps + rowHeights);
}

/** Number of stacked port rows in a node's left column. */
export function leftPortRowCount(node: TopologyNodeData): number {
  return socketSemanticIds(node, 'left').length;
}

/** Number of stacked port rows in a node's right column. */
export function rightPortRowCount(node: TopologyNodeData): number {
  return socketSemanticIds(node, 'right').length;
}

/** Port-row count of the taller column — the footer's height band. */
export function portRowCount(node: TopologyNodeData): number {
  return Math.max(leftPortRowCount(node), rightPortRowCount(node));
}

/** Height of the card's footer region (the port stack). */
export function footerHeight(node: TopologyNodeData): number {
  return portRowCount(node) * PORT_ROW_H;
}

/** Total adaptive height of a node card, in canvas units. */
export function nodeHeight(node: TopologyNodeData): number {
  return NODE_HEADER_H + mainHeight(node) + footerHeight(node);
}

/** Canvas-space Y of a port row's CENTER, relative to the card's top.
 *  Left and right columns are both top-aligned; a column's row i sits at
 *  header + main + i*PORT_ROW_H, centered in its PORT_ROW_H band. */
export function portRowCenterY(node: TopologyNodeData, rowIndex: number): number {
  return NODE_HEADER_H + mainHeight(node) + PORT_ROW_H / 2 + rowIndex * PORT_ROW_H;
}

/** Row index of a specific semantic within a node's port column. Used to
 *  resolve a wire's recorded from_port_id / to_port_id back to the exact
 *  socket row it attaches to. Falls back to 0 (the primary) for a semantic
 *  the column does not currently expose. */
export function semanticRowIndex(node: TopologyNodeData, port: PortName, semanticId: string | undefined): number {
  const idx = socketSemanticIds(node, port).indexOf(semanticId as never);
  return idx === -1 ? 0 : idx;
}
