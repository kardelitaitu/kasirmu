/**
 * Shared topology revision state.
 *
 * Kept separate from the handler modules so that staff (pin_topology_revision)
 * and topology handlers can both import it without creating a cycle.
 */
import { MOCK_TOPOLOGY_REVISIONS_KEY, readSlice, writeSlice } from '../core/mockDatabase';

export interface MockTopologyNode {
  id: string;
  type: string;
  name: string;
  subtitle?: string;
  x: number;
  y: number;
  tier_requirement?: string;
  telemetry_badge?: string;
  telemetry_status?: string;
  metadata?: Record<string, unknown>;
}

export interface MockTopologyWire {
  id: string;
  from_node_id: string;
  to_node_id: string;
  direction: string;
  label?: string;
  from_port?: string;
  to_port?: string;
}

export interface MockTopology {
  revision?: number;
  resolved_issue_keys?: string[];
  nodes: MockTopologyNode[];
  wires: MockTopologyWire[];
}

/** Mirrors `TOPOLOGY_REVISION_RESTORABLE_KEEP` in revisions.rs. */
export const MOCK_TOPOLOGY_REVISION_KEEP = 20;

export interface MockTopologyRevision {
  /** The branch scope the row belongs to. */
  branchId: string;
  revision: number;
  changeNote: string;
  publishedAt: string;
  publishedBy: string;
  pinned: boolean;
  nodeCount: number;
  wireCount: number;
  workspaceCreations: number;
  workspaceUpdates: number;
  workspaceArchives: number;
  contractSchemaVersion: number;
  /** The stored envelope; deleted when the row is deflated. */
  diagram?: MockTopology;
}

export function loadMockTopologyRevisions(): MockTopologyRevision[] {
  return readSlice(MOCK_TOPOLOGY_REVISIONS_KEY, () => []);
}

export function saveMockTopologyRevisions(rows: MockTopologyRevision[]): void {
  writeSlice(MOCK_TOPOLOGY_REVISIONS_KEY, rows);
}

export const mockTopologyRevisions: MockTopologyRevision[] = loadMockTopologyRevisions();

/** Append one immutable revision, then deflate anything past the budget. */
export function recordMockTopologyRevision(row: MockTopologyRevision): void {
  mockTopologyRevisions.push(row);
  const unpinned = mockTopologyRevisions
    .filter((r) => !r.pinned && r.branchId === row.branchId)
    .sort((a, b) => b.revision - a.revision);
  for (const stale of unpinned.slice(MOCK_TOPOLOGY_REVISION_KEEP)) {
    delete stale.diagram;
  }
  saveMockTopologyRevisions(mockTopologyRevisions);
}

/** The metadata projection the list command returns — never the diagram. */
export function summarizeMockTopologyRevision(r: MockTopologyRevision) {
  const { diagram, ...rest } = r;
  return { ...rest, restorable: diagram !== undefined };
}
