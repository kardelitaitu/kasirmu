---
num: 66
area: topology
title: "ADR-66: Centralized Topology Authoring — Desired-State Authority Model, Signed-Revision Contract, and Multi-Store Eligibility"
status: Ratified (2026-10-22) — ratifies D1–D5 and establishes the architectural contract for done-plan-topology-web-authoring.md
---

# ADR-66: Centralized Topology Authoring

**Status:** Ratified (2026-10-22).
**Date:** 2026-10-22
**Recorded against:** branch `0.0.41`
**Related:** ADR-22 (topology builder), ADR-45 (semantic contract v2), ADR-46 (topology revision history and restore), ADR-47 (scoped authorization), `done-plan-topology-web-authoring.md`
**Tags:** topology, sync, security, multi-store, authority, signing

> Cite this record by filename: `docs/decisions/2026-10-22-adr66-centralized-topology-authoring-authority-model.md`.

---

## 1. Context

In `kasir.mu`, store topology models cashier terminals, kitchen display systems (KDS), printers, barcode scanners, cash drawers, and warehouse allocation rules within a branch.

Previously (under ADR-22 and ADR-46), topology was authored exclusively on a single desktop or tablet terminal within the physical store (`ui/src/features/locations/TopologyScreen.tsx`), persisted into local SQLite (`topology_revisions` table, migration `20260915_topology_revisions.sql`). For a multi-store merchant (2 to 50+ branches), configuring devices and routing rules required physical presence at each store terminal.

[`done-plan-topology-web-authoring.md`](file:///c:/dev/kasirmu/done-plan-topology-web-authoring.md) proposes centralizing authoring to the cloud dashboard (`dashboard.kasir.mu`). This raises fundamental architecture and security questions:
1. Does the cloud become the source of truth, or does the local terminal retain authority?
2. How are offline-first guarantees preserved when a branch loses internet connectivity?
3. Who is eligible to author topology on the web?
4. How are concurrent edits between cloud and terminal prevented?
5. How is cryptographic authenticity and non-repudiation guaranteed for published topologies?

---

## 2. Decisions (Ratified D1–D5 & Verified D6)

### D1 — Desired-State Authority Model (Model B)
* **Decision:** The cloud authors **desired state**; the physical terminal's embedded SQLite database remains **authoritative at runtime**.
* **Mechanism:**
  1. Web authoring produces a desired-state topology document.
  2. The cloud server validates the document against topology schema, invariants, and node quotas (`QuotaDimension::TopologyNodes`).
  3. The server signs the document with a dedicated topology private key and publishes a signed immutable revision (`revision = N + 1`, referencing `base_revision = N`).
  4. Terminals pull published revisions asynchronously, verify the signature against their trusted public key set, validate semantic sanity, and apply the revision atomically inside a single SQLite transaction.
  5. If validation fails or a signature is invalid, the terminal rejects the revision, logs the event, and continues operating with its last known good revision.
* **Invariant I1:** The till opens, transacts, prints receipts, and dispatches to KDS with zero network connectivity. Boot never waits on cloud availability.
* **Rejected:** Cloud as live runtime source of truth (Model A). Rejected because it violates local-first offline availability and expands the blast radius of a network disruption or bad cloud deploy to all tills simultaneously.

### D2 — Multi-Store Eligibility Gate
* **Decision:** Centralized web authoring is restricted to **multi-store tenants only** (Subscription tier **Pro and above**).
* **Ground Truth:** `SubscriptionTier` defines location allowances: Free: 1, Plus: 1, Pro: 2, Premium: 5, Enterprise: unlimited (`crates/kasirmu-core/src/subscription/tier.rs:20-39`).
* **Rationale:** The administrative benefit of centralized management scales with branch count. A single-store merchant carries 100% of the operational risk of remote topology publishing for zero organizational benefit.
* **Enforcement:** Tenants with max locations = 1 author topology locally; web authoring endpoints return `403 PlanGateExceeded`.

### D3 — Single-Writer Policy (Read-Only Terminal Editor)
* **Decision:** When centralized web authoring is active for a branch, the terminal-local editor becomes **read-only**.
* **Rationale:** Eliminates the two-writer problem, silent last-writer-wins clobbering, and the need for complex multi-way CRDT rebase engines on physical receipt/KDS routing topologies.
* **Mechanism:** The terminal UI displays the current topology graph, node status, and active revision number, but editing tools (add node, connect edge, delete, change settings) are disabled with a visual badge indicating *"Managed via Web Dashboard"*.

### D4 — Dedicated Signing Key & Cryptographic Rotation
* **Decision:** Revisions are signed with an Ed25519 private key dedicated solely to topology (`OZ_TOPOLOGY_PRIVATE_KEY` / `KASIRMU_TOPOLOGY_PRIVATE_KEY`), held outside the database in secure deployment environment variables.
* **Envelope Metadata:** Every revision carries:
  * `tenant_id`: Scoped tenant identifier.
  * `branch_id`: Targeted branch profile ID.
  * `revision`: Monotonically increasing revision integer.
  * `base_revision`: Predecessor revision for optimistic concurrency.
  * `key_id`: Identifier of the signing key (e.g., `key-2026-10-v1`).
  * `signature`: Base64-encoded Ed25519 signature over `(tenant_id, branch_id, revision, base_revision, payload_hash)`.
* **Key Rotation:** Key rotation is additive. Terminals carry a trusted key registry (`key_id` $\to$ public key). Publishing with a new `key_id` requires no emergency terminal updates or flag-day migrations.
* **Rejected:** Reusing the software license key (`OZ_LICENSE_PRIVATE_KEY`) or at-rest database master key. Coupling signing keys creates cross-domain blast radius.

### D5 — Step-Up Authentication & Blast-Radius Preview
* **Decision:** Publishing a topology revision from the web dashboard requires **PIN step-up authentication** by an authorized tenant manager or administrator.
* **Requirements:**
  1. **Blast-Radius Preview:** Before confirmation, the UI displays the diff: added/removed terminals, re-routed printers, and affected active terminals.
  2. **Audit Logging:** Every published revision records an immutable audit trail entry (`audit_log` table) capturing `actor_id`, `tenant_id`, `branch_id`, `from_revision`, `to_revision`, and `client_ip`.

### D6 — Branch ↔ Location Equivalence
* **Verified:** `semantic_branch_profile_id` binds `branch_id` directly to `store_profile_id` (location) across `topology.rs:138`, `topology_tests.rs:439-460`, and `persistence.rs:708`. 1 Branch == 1 Store Location holds repo-wide.

---

## 3. Core Architectural Invariants

| ID | Invariant | Enforcement Mechanism |
|---|---|---|
| **I1** | **Offline Autonomy** | Local SQLite is system of record; terminal never blocks startup on cloud sync. |
| **I2** | **Atomic Application** | Revision apply executes inside a `rusqlite` transaction; statement failure triggers full rollback. |
| **I3** | **Monotonic Ordering** | Terminal verifies `revision > current_revision`; stale or replayed revisions are rejected. |
| **I4** | **Optimistic Concurrency** | Server checks `base_revision == current_db_revision`; conflicts return `topology-revision-conflict`. |
| **I5** | **Cryptographic Scoping** | Signature verifies `(tenant_id, branch_id)` binding; cross-tenant revision replay is impossible. |

---

## 4. Implementation Phasing

1. **Phase 0 (Complete with this ADR):** Architectural decisions ratified, D6 verified from codebase.
2. **Phase 1:** Extend `topology_revisions` table (`tenant_id`, `org_id`, `actor`, `key_id`, `signature`) and synchronize PostgreSQL schema twin in `init.pg.sql`.
3. **Phase 2:** Implement cloud server validation, signing, and revision plan generation (`kasirmu-cloud`).
4. **Phase 3:** Terminal replication client: pull, verify Ed25519 signature, atomic apply in `kasirmu-bridge`.
5. **Phase 4:** Web authoring UI in cloud dashboard with diff preview and PIN step-up modal.
6. **Phase 5:** Staged tenant rollout behind subscription plan gate (`Pro+`).
