//! Topology client for the kasir.mu cloud API (ADR-66 / done-plan-topology-web-authoring.md Phase 4).

import type { HttpClient } from './client';

export interface TopologyDiffSummary {
  created: number;
  updated: number;
  archived: number;
  typeChanged: number;
}

export interface TopologyPlanRequest {
  branch_id: string;
  nodes: unknown[];
  wires: unknown[];
  base_revision?: number;
}

export interface TopologyPlanResponse {
  valid: boolean;
  branchId: string;
  baseRevision?: number;
  summary: TopologyDiffSummary;
  contractSchemaVersion: number;
}

export interface TopologyPublishRequest {
  branch_id: string;
  org_id?: string;
  base_revision?: number;
  change_note?: string;
  nodes: unknown[];
  wires: unknown[];
  envelope?: unknown;
  step_up_pin?: string;
}

export interface TopologyPublishResponse {
  id: string;
  branchId: string;
  revision: number;
  baseRevision?: number;
  publishedAt: string;
  publishedBy: string;
  keyId: string;
  signature: string;
  changeNote: string;
  summary: TopologyDiffSummary;
}

export interface TopologyRevisionItem {
  id: string;
  branchId: string;
  revision: number;
  baseRevision?: number;
  changeNote: string;
  diagram?: string;
  workspaceCreations: number;
  workspaceUpdates: number;
  workspaceArchives: number;
  nodeCount: number;
  wireCount: number;
  contractSchemaVersion: number;
  pinned: boolean;
  publishedAt: string;
  publishedBy: string;
  tenantId: string;
  orgId: string;
  actor: string;
  keyId?: string;
  signature?: string;
}

export interface TopologyPullResponse {
  branchId: string;
  tenantId: string;
  revisions: TopologyRevisionItem[];
}

export class TopologyClient {
  constructor(private readonly http: HttpClient) {}

  /** Compute desired-state diff and validate graph before publishing. */
  async plan(payload: TopologyPlanRequest): Promise<TopologyPlanResponse> {
    return this.http.request<TopologyPlanResponse>('POST', '/api/v1/topology/plan', payload);
  }

  /** Publish a signed immutable topology revision with optional step-up PIN. */
  async publish(payload: TopologyPublishRequest): Promise<TopologyPublishResponse> {
    return this.http.request<TopologyPublishResponse>('POST', '/api/v1/topology/publish', payload);
  }

  /** Pull revisions since watermark for terminal synchronization. */
  async pull(
    branchId: string,
    sinceRevision?: number,
    limit?: number,
  ): Promise<TopologyPullResponse> {
    const params = new URLSearchParams({ branch_id: branchId });
    if (sinceRevision !== undefined) {
      params.set('since_revision', sinceRevision.toString());
    }
    if (limit !== undefined) {
      params.set('limit', limit.toString());
    }
    return this.http.request<TopologyPullResponse>(
      'GET',
      `/api/v1/topology/revisions/pull?${params.toString()}`,
    );
  }
}
