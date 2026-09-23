---
num: 34
area: topology
title: ADR #34: Topology Editor as the Business Logic Builder
status: Proposed
---
# ADR #34: Topology Editor as the Business Logic Builder

**Status:** Proposed  
**Date:** 2026-08-07  
**Author:** Architecture Team & kasir.mu Contributors  
**Tags:** topology, business-logic-builder, node-editor, typed-ports, parent-child, branch-location

---

## Context

The topology editor is not only an administration screen for displaying store and
workspace relationships. It is the key visual component of the business logic
builder: users use it to create and modify the application configuration that
defines how a business operates.

The existing topology implementation (ADR #22) provides a useful visual canvas,
but its model is still primarily a flat graph of entities connected through
geometric ports (`top`, `right`, `bottom`, and `left`). A user can therefore
connect visually plausible endpoints without necessarily understanding whether
the relationship is meaningful to the application.

That ambiguity is unacceptable for a business-logic builder. The editor must
make valid relationships discoverable and invalid relationships difficult or
impossible to create.

The intended interaction is inspired by Grasshopper and similar node-based
editors: nodes expose explicitly named inputs and outputs, and wires communicate
what data or relationship is flowing between them.

---

## Decision

We will evolve the topology editor into a typed, hierarchical business-logic
builder.

ADR #22 remains the reference for the currently implemented canvas, persistence,
workspace integration, license enforcement, and atomic apply behavior. This ADR
establishes the next architectural direction and supersedes only the parts of
ADR #22 that describe topology as an untyped, primarily flat entity graph. It
does not authorize an immediate implementation rewrite.

The current `store` node is the implementation predecessor of the semantic
**Branch Location** node. The target model will initially retain `store` as a
serialized compatibility alias for `branch-location`; existing diagrams do not
need an immediate destructive rename. New domain-facing APIs and UI copy should
use **Branch Location**, and the loader/validator must treat `store` and
`branch-location` as the same root concept. The two names must never coexist as
independent root types. A later migration may canonicalize persisted data to
`branch-location` after the compatibility period.

The current implementation also contains transitional behavior that must not
become part of the target contract: `TopologyScreen` derives workspace ownership
from geometric wires, matches a store by display name, and falls back to the
primary/`default` store when no relationship is found. That fallback is unsafe
for the business-logic builder and must be removed when mandatory typed
`Location In` validation is introduced.

### 1. One graph has exactly one Branch Location root

The top-level business context is a **Branch Location node**. A branch location
is the root scope from which the application configuration for that location is
built.

At minimum, a branch location represents:

- the business location or branch;
- the scope to which child workspaces belong; and
- the root context for validating and applying the child configuration.

A saved application graph represents exactly one branch location and contains
exactly one Branch Location root. Chain administration is represented as a
collection of separately scoped branch-location graphs, not as one graph with
multiple unrelated roots.

A workspace is not an independent top-level object in the business-logic graph.
It is a child of a branch location through a typed location relationship.

The first canonical relationship is:

```text
Branch Location
  Location Out ───────────────┬──> Location In · Workspace A
                               ├──> Location In · Workspace B
                               └──> Location In · Workspace C
```

One `Location Out` may fan out to multiple compatible `Location In` ports. A
user must not need to guess that this relationship is valid or manually infer
its meaning from node placement.

### 2. Nodes expose semantic ports

Every node type has a port schema. A port has at least:

- a stable port identifier;
- a human-readable label (for example, `Location Out` or `Location In`);
- a direction: `input` or `output`;
- a semantic data/relationship type; and
- a cardinality policy describing whether it accepts or produces one or many
  connections.

Port placement around the node remains a visual concern. Port identity and
compatibility are semantic concerns and must not be derived from screen position.

Final connector vocabulary (as implemented in the UX):

| Node | Input | Output | Notes |
|---|---|---|---|
| Branch Location (store) | — | `location-out` / **Location** | Provides branch-location context to child nodes; supports fan-out. |
| POS / register workspaces (`store-pos`, `restaurant-pos`) | `location-in` / **Location** (required) | `workspace-out` / **Operation** | Location ownership edge is required; the Operation output feeds downstream operational nodes. |
| Kitchen Display (KDS) | `operation-in` / **Operation** (required) | — | Sink: consumes exactly one Operation feed, forwards nothing. |
| Stock Room (`warehouse`) | `stock-in` or `transfer-in` (label follows the attached wire) | `stock-out` / **Stock Out** | Receives stock via `stock-routing` (from a POS workspace) or `inventory-transfer` (from another Stock Room — hub-and-spoke); its output feeds downstream Stock Rooms. A room without an inbound stock-bearing wire is flagged (see section 5). |

A workspace is invalid until it has its required ownership connection: POS-type
workspaces need exactly one `location-in` edge from a Branch Location's
`location-out`; KDS needs exactly one `operation-in` edge from Restaurant POS;
a Stock Room needs at least one inbound stock-bearing edge (`stock-routing`
or `inventory-transfer`). The Branch Location `location-out` supports fan-out
to multiple workspaces. A KDS inherits its
store scope transitively from the Branch Location-owned POS source; the
operation feed itself does not create a second direct Branch Location edge.

The exact internal schema is intentionally deferred to the implementation ADR
or follow-up design. The semantic contract above is fixed by this decision.

### 3. Wires connect compatible output/input ports

A wire is a typed relationship between one output port and one input port. The
editor will only allow a connection when the source output and target input are
compatible according to the port contract.

A valid wire communicates its purpose in the UI, for example:

```text
Location Out ──[provides branch location]──> Location In
```

The UI must show the port labels while creating a connection and on the saved
wire. The wire label is explanatory; the source and target port identifiers are
the authoritative relationship data.

The following rules apply:

1. Wires are directional from output to input.
2. An output may fan out when its cardinality allows it.
3. An input accepts only the number of connections declared by its cardinality.
4. A connection between incompatible port types is rejected before apply.
5. A wire cannot connect an input to an input or an output to an output.
6. A wire cannot create a parent-child relationship that violates the node
   hierarchy.
7. Duplicate relationships are rejected using stable node and port identities,
   not screen coordinates.

### 4. Parent-child relationships are business rules

The graph is not merely a drawing. It is a business-logic structure with
parent-child semantics.

For the initial model:

- `Branch Location` is the exactly-one root node.
- Every workspace exposes a required input, resolved per type (see the
  connector vocabulary in section 2): POS workspaces require `Location In`,
  KDS requires `Operation In`, a Stock Room requires an inbound stock-bearing
  feed (`stock-in` or `transfer-in`).
- Every workspace must receive exactly one compatible ownership connection
  from the Branch Location (via `Location Out → Location In`) before Apply is
  allowed; KDS receives its operational feed and a Stock Room receives its
  stock feed as their input.
- The Branch Location's `Location Out` may fan out to multiple workspaces.
- A workspace cannot be considered location-bound merely because it is near a
  branch location on the canvas, and there is no primary-store fallback when the
  relationship is missing.
- The same relationship must be represented consistently in the visual graph,
  serialized topology data, and applied backend configuration.

Future node types may introduce additional parent-child relationships, but each
must declare its allowed parent port, child port, cardinality, and resulting
application behavior before it is exposed in the palette.

### 5. The graph is the application configuration boundary

The builder creates and modifies an application's business configuration. The
editor therefore has two related representations:

1. **Graph representation:** typed nodes, ports, and wires used for authoring and
   validation.
2. **Runtime/configuration representation:** the backend records and settings
   affected when the user applies the graph.

Applying a graph must preserve the existing atomicity guarantee from ADR #22:
workspace changes and the persisted diagram must not partially commit. The
backend remains authoritative for security, entitlement, referential-integrity,
and runtime validation; client-side port validation is an early feedback layer,
not a security boundary.

The backend must independently reject Apply when any of these conditions fail:

- the graph does not have exactly one Branch Location root;
- a workspace is missing its required `Location In` or has more than one;
- source and target ports are incompatible;
- an input cardinality or duplicate-relationship rule is violated;
- ownership edges contain a cycle or a workspace is unreachable from the root;
- the graph has an unsupported schema version; or
- a legacy geometric relationship has not been mapped safely to a semantic
  relationship; or
- the warehouse stock-flow rules below are violated.

#### Warehouse stock-flow validation (hub-and-spoke)

Stock Rooms carry two design-time numbers — capacity and low-stock
threshold. The low-stock threshold drives the card's telemetry badge; the
graph enforces how stock flows in using capacity:

1. **Every Stock Room needs an inbound stock-bearing wire.** `stock-routing`
   (workspace → room) or `inventory-transfer` (room → room) both service the
   prompt; an outbound wire never services its sender. A room with capacity
   metadata and room to spare (`stock < capacity`) that has no inbound
   stock-bearing wire fails with `warehouse-missing-stock-routing`. The
   prompt is dismissible per diagram for a Stock Room intentionally staged
   empty; the dismissal bypasses both the editor's live gate and the screen's
   Apply boundary for that error code only.
2. **A full Stock Room rejects inbound stock.** An inbound stock-bearing wire
   into a room with `stock >= capacity` fails with `warehouse-at-capacity`,
   carrying the wire id so the warning marker renders on the wire itself.
3. **Transfers may originate from any Stock Room.** `inventory-transfer`
   accepts a warehouse source (hub-and-spoke: a hub feeds its satellites),
   mirroring the warehouse source already allowed for `stock-routing`. A
   chain of rooms (hub → mid → leaf) validates clean so long as every room
   is serviced and has room.
4. **Circular transfer chains are rejected.** A hub → mid → leaf → hub loop
   fails with `cycle-detected` — the servicing rule never blesses a cycle
   just because every room has an inbound wire.
5. **The guards are Pro-tier business features.** Both the capacity and the
   servicing checks run only on pro/enterprise (or when no tier context is
   available — the pure contract stays strict). Below Pro, a diagram may
   carry at most one Stock Room (`warehouse-tier-limit`); creation paths
   refuse a second room on the way in, and the same contract enforces the
   cap at Apply so the editor's live gate and the screen's Apply boundary
   can never disagree.

The first implementation scope is declarative configuration of existing
capabilities—workspace instances, branch ownership, routing, and settings. It
does not generate arbitrary source code, React screens, database tables, or
executable user-defined logic. Code-generating or module-generating behavior
would require a separate security and lifecycle ADR.

### 6. Node definitions become the source of connection guidance

The node palette and rendered node cards must be driven by node definitions that
expose their available ports. The editor should make the next valid action
obvious by:

- displaying named input and output ports;
- showing compatible target ports during connection mode;
- hiding or disabling incompatible targets where appropriate;
- explaining why a proposed connection is invalid; and
- showing the relationship label on completed wires.

The user should be able to understand the required connection by reading the
node and port labels, without relying on undocumented conventions or geometric
placement.

### Initial semantic port registry

The first release will use a closed registry of relationship types rather than
user-defined arbitrary schemas. The initial registry is:

| Relationship type | Initial purpose |
|---|---|
| `location` | Branch Location ownership of a workspace. |
| `stock-routing` | Workspace stock-deduction routing to an inventory location. |
| `ticket-routing` | Workspace routing of tickets to KDS or printer nodes. |
| `hardware-connection` | Binding a workspace or service to a hardware device. |
| `inventory-transfer` | Directional or bidirectional transfer between inventory locations. |

Each node definition declares its ports from this registry. A port definition
contains a stable ID, localized label ID, input/output direction, relationship
type, required flag, and cardinality. The registry is intentionally closed for
the first release so the UI and backend share predictable validation and runtime
meaning. Extensible node-definition manifests may be introduced in a separate
ADR after the first vertical slice is stable.

### Ownership and operational graphs

The topology contains two related but distinct relationship classes:

```text
Ownership graph:
Branch Location ──> Workspace
Strict tree; exactly one parent per workspace.

Operational graph:
Workspace ──> Warehouse / KDS / Printer
Typed routing graph; cardinality and cycles are defined per relationship type.
```

Only ownership edges determine location scope. Operational edges must not be
used to infer a workspace's parent or substitute for `Location In`.

---

## Proposed domain vocabulary

| Term | Definition |
|---|---|
| **Branch Location node** | Top-level root context for one business location's application configuration. |
| **Child node** | A node whose required parent relationship is established through a valid typed wire. |
| **Port** | A named input or output endpoint with a semantic type and cardinality. |
| **Typed wire** | A directional connection between compatible output and input ports. |
| **Fan-out** | One output connected to multiple compatible inputs, allowed by cardinality. |
| **Graph validation** | Checks that node, port, hierarchy, cardinality, and relationship rules are satisfied before apply. |
| **Apply** | The atomic operation that translates the valid graph into persisted backend configuration. |
| **Node definition** | A versioned registry entry that declares a node type's semantic ports and supported relationships. |
| **Ownership edge** | A typed `location` relationship that establishes the Branch Location → Workspace parent-child scope. |
| **Operational edge** | A typed non-ownership relationship that configures routing or capability behavior. |
| **Graph compiler** | The backend translation step from a validated semantic graph to existing runtime configuration records. |

---

## Graph compiler boundary

The target Apply pipeline is:

```text
Typed graph
   ↓
Graph validator
   ↓
Configuration compiler
   ↓
Atomic backend apply
```

The graph validator checks structure, ports, compatibility, cardinality,
ownership, cycles, and schema version. The configuration compiler translates
accepted semantic relationships into existing records and settings. For example:

```text
Branch Location.Location Out → Workspace.Location In
                       ↓
workspace.store_id = branch_location.id
```

The compiler must use stable node identity, never display-name matching. It must
fail when an ownership relationship is missing or ambiguous; it must not fall
back to a primary or `default` store.

---

## Compatibility with the current implementation

The current implementation uses:

- `TopologyNodeData` for node data;
- `TopologyWireData` with `fromNodeId`, `toNodeId`, and optional geometric
  `fromPort`/`toPort` values;
- `TopologyNodePayload` and `TopologyWirePayload` for persistence; and
- workspace/store diff application through `apply_topology_diff`.

These structures are an implementation baseline, not the final typed-port
contract. The current wire payload has no semantic port definition, relationship
type, cardinality, or graph schema version. The target contract must add those
concepts explicitly; the existing optional string fields are not sufficient.

In particular, `top`, `right`, `bottom`, and `left` are visual anchor names and
must not become the long-term business vocabulary for relationships. The target
persistence format must include a persisted `schema_version` and stable semantic
port identifiers. Legacy wires should either be upgraded through an explicit,
deterministic migration or loaded into a compatibility mode with clear
validation behavior. If their business meaning cannot be inferred safely, Apply
must be blocked until the user resolves them. Legacy geometry must never be
silently reinterpreted as a different business relationship.

Existing workspace `type_key` immutability and archive-plus-recreate behavior
remain in force. Existing license enforcement, session scoping, backend
validation, and atomic apply behavior also remain in force.

---

## Options considered

### Option A — Keep geometric ports and infer meaning from node type (Rejected)

This minimizes implementation work but requires users to remember which sides of
which node types should be connected. It preserves the exact ambiguity this ADR
is intended to remove.

### Option B — Use typed semantic ports with hierarchy (Chosen)

Named ports make valid relationships visible, allow the editor to guide the user,
and provide a durable contract for validation and backend translation. The
additional schema and migration work is justified because the topology graph is
becoming a business-logic authoring surface rather than a diagram only.

### Option C — Make the graph a free-form workflow with no required root (Deferred)

A free-form graph may be useful for future automation scenarios, but it would
weaken the location-scoped application model and make configuration ownership
ambiguous. Branch Location remains the required top-level context for this
builder. A separate ADR would be required to support rootless graphs.

---

## Consequences

### Positive

- Users can understand what a connection means from its labels.
- Invalid relationships can be rejected before they reach Apply.
- One branch location can clearly own multiple workspaces through fan-out.
- The graph becomes a foundation for future business rules and app modules.
- Port contracts provide a stable boundary between visual authoring and backend
  configuration.

### Negative

- The current geometric-port model requires a compatibility and migration plan.
- Node definitions, port schemas, cardinality, and validation become maintained
  domain concepts.
- The backend must translate a typed graph into existing relational workspace,
  location, inventory, hardware, and settings structures.
- The editor needs clearer validation and error states than a free-form canvas.

---

## Resolved decisions and remaining questions before implementation

The following decisions are resolved for the first version:

1. A saved application graph contains exactly one Branch Location root. Chain
   administration uses multiple separately scoped graphs.
2. Every workspace requires exactly one input edge, resolved per type: POS
   workspaces require a Branch Location `Location Out → Location In`;
   KDS requires one `Operation In` feed; inventory requires one flexible
   input (`Location` or `Operation`) before Apply.
3. The initial hierarchy is a strict ownership tree: one parent location per
   workspace, no ownership cycles, and no unreachable workspace nodes.
4. Missing location ownership never falls back to the primary or `default` store.
5. The first release configures existing capabilities declaratively; it does not
   generate arbitrary application code or executable logic.

The following implementation details remain for the implementation
ADR/specification:

6. For each non-ownership relationship, what are the exact cardinality and cycle
   rules, and should replacing a single-input connection be an explicit action
   or always prohibited? The first default is explicit replacement, never silent
   replacement. **Resolved for `ticket-routing` (2026-08-12):** output fans out
   to many targets; input accepts exactly one source; over-capacity drops are
   refused at drag time (explicit, never silent); no cycle rule needed (KDS →
   hardware only, hardware has no ticket-out). See the implementation ADR's
   [Ticket-routing cardinality](2026-08-08-adr44-typed-connection-gating.md#decision--ticket-routing-cardinality-2026-08-12)
   section. The other non-ownership relationships remain open.
7. What is the exact `schema_version` migration from geometric ports, including
   the UI for unresolved relationships? Legacy relationships whose meaning is
   uncertain must block Apply. **UI portion resolved (2026-08-12):** the
   load-time migration dialog resolves each ambiguous legacy wire in place from
   the pairing table's legal options (delete-only when none exist), one undo
   entry, Apply unchanged until every wire is resolved — see the implementation
   ADR's [Legacy-schema migration UI](2026-08-08-adr44-typed-connection-gating.md#decision--legacy-schema-migration-ui-2026-08-12)
   section. The identity-inference rules and `schema_version: 1` persistence
   already covered the inferable cases.
8. What are the concrete backend compiler effects and transactional records for
   each initial relationship type? A relationship must not be enabled for Apply
   until its runtime effect is defined and tested.
9. Which node-definition entries are included in the first vertical slice beyond
   Branch Location and Workspace? The recommended first slice is only location
   ownership; stock routing, ticket routing, hardware connection, and inventory
   transfer follow after that slice is validated.

---

## Implementation gates

No implementation should begin until the following are agreed in a follow-up
specification or implementation ADR:

- canonical node-definition and port-definition schema;
- the closed initial semantic port registry;
- compatibility matrix and cardinality rules;
- root and hierarchy validation rules, including required `Location In` for
  every workspace type;
- persisted `schema_version` and legacy topology migration strategy;
- graph validator and configuration-compiler contracts;
- graph-to-backend translation with stable identity and no primary-store
  fallback;
- atomic apply and rollback behavior for the expanded graph; and
- test matrix for valid connections, invalid connections, required ownership,
  fan-out, duplicate detection, cycle detection, legacy loading, compiler
  output, and failed apply.

---

## Recommended implementation sequence

The first implementation should be a narrow vertical slice rather than a full
editor rewrite:

1. Define the semantic node-definition and port registry for Branch Location and
   every existing workspace type.
2. Add `schema_version` and semantic port fields while retaining `store` as the
   legacy serialized alias.
3. Implement shared graph validation for exactly one root and exactly one
   `Location In` per workspace.
4. Add UI guidance for valid targets and explicit errors for invalid or missing
   ownership connections.
5. Implement the backend compiler for location ownership and remove geometric
   port inference, display-name matching, and primary-store fallback.
6. Migrate and test existing Store → Workspace diagrams, blocking ambiguous
   legacy wires until resolved.
7. Only then add operational relationship types such as stock routing,
   ticket routing, hardware connections, and inventory transfer.

---

## Implementation status (2026-08-07)

The first semantic ownership slice is implemented through the frontend and
Tauri backend boundary:

- the persisted envelope includes `schema_version: 1`;
- semantic `store_profile_id`, source/target port IDs, and relationship type are
  retained on save and returned on load;
- backend Save, Load, and Apply validate one identified Branch Location,
  required single-parent `Location In` ownership, and stable node/wire IDs;
- canonical Branch Location IDs are checked against `store_profiles`; and
- legacy geometric payloads remain accepted only as compatibility payloads.

The workspace transaction and global topology settings write use separate
SQLite databases. Apply therefore uses an explicit compensation boundary: it
snapshots the previous diagram and touched workspace rows, commits the workspace
transaction, writes the diagram, and restores both sides if the diagram write
fails. A recovery journal is written before compensation; interrupted or failed
compensation remains retryable on the next Apply and is returned explicitly for
operator recovery. UI
target compatibility guidance, purpose persistence, and deterministic legacy
normalization are implemented for the first location-ownership slice; later
operational relationship semantics remain out of scope.

## First-slice implementation specification

### Purpose persistence

`purpose_key` is owned by `workspace_instances`, not topology metadata and not
RBAC. Migration `122_workspace_instance_purpose.sql` adds a non-null `general`
default for existing instances. Workspace DTOs, create/update requests, topology
payloads, and the Apply compiler carry the field independently from the editable
instance `name`. The closed registry is: `general`, `checkout`, `returns`,
`dining-room`, `kitchen-hot-line`, `stock-control`, and `receiving`, with explicit
technical-type compatibility checks.

### Legacy migration safety matrix

| Legacy condition | First-slice behavior |
|---|---|
| `store` → `workspace`, endpoints identify existing nodes | Normalize to `location-out` → `location-in`, mark inferred, preserve coordinates |
| Missing/null geometric ports | Ignore geometry for meaning; renderer defaults are retained only as presentation |
| Existing semantic fields | Validate strictly; do not overwrite them with geometric inference |
| Non-store/workspace relationship | Do not infer as ownership; retain it as non-ownership/legacy and block if it prevents a valid graph |
| Missing endpoint, duplicate IDs, duplicate ownership, wrong direction | Surface actionable validation error and block Apply |
| `branch-location` node | Treat as the canonical alias of serialized `store` |
| Unsupported future schema version | Reject at load/apply with a structured error |

Legacy layout coordinates remain unchanged. No display-name or proximity matching
is performed. A legacy graph with an unidentifiable Branch Location or workspace
ownership is loaded for repair but cannot be applied.

### Apply transaction and recovery

Workspace creates, updates, and archives run inside one store-database SQLite
transaction. The global topology setting is a separate transaction. Before the
store transaction, Apply snapshots the existing diagram and every pre-existing
workspace row it may update/archive. If the global write fails, compensation
deletes newly created rows, restores snapshotted rows, and restores the exact
previous diagram. If either compensation step fails, the command returns both
failure contexts instead of claiming success. Session scope, permissions,
subscription entitlement, referential integrity, and immutable `type_key`
archive-plus-recreate behavior are checked before mutation.

### UI contract

Connection mode derives guidance from semantic port definitions. Valid
`Location Out` → `Location In` targets are highlighted; incompatible ports are
de-emphasized. Missing or multiple Location In connections, invalid purpose/type
pairs, missing Branch Location identity, and duplicate wires use localized
validation messages and prevent Apply. Node title remains the editable instance
label, while purpose and technical type are separate inspector fields.

## Slice 1+2 (DONE)

**Implementation date:** 2026-08-08

Two frontend slices of the typed-port contract are implemented and committed,
extending the first ownership slice above. Both live in the React editor
(`ui/src/features/stores/topologyCard.ts` + `NodeTopologyEditor.tsx`) with unit
coverage in `topologyCard.test.ts` and `NodeTopologyEditor.test.tsx`.

### Slice 1 — typed connection gating

The editor now enforces the pairing table live instead of letting any drop
through:

- **`gatingSemanticId(node, port)`** resolves EVERY authorable socket to a
  semantic port id — outputs (store `location-out`, POS/warehouse `stock-out`,
  KDS `ticket-out`, hardware `device-out`) and non-workspace inputs (warehouse
  `stock-in`, hardware `generic-in`) included. It is deliberately distinct
  from the recording-side `semanticPortId`, which stays minimal so persisted
  wire semantics and duplicate detection are stable.
- **`SEMANTIC_PORT_PAIRINGS` + `canSemanticPortsConnect`** is the closed pairing
  table: `location-out → location-in`,
  `stock-out → stock-in`, `ticket-out → ticket-in`,
  `operation-out → operation-in`, `device-out → generic-in`,
  `generic-out → generic-in`. Inputs are never sources; unknown combinations
  fail closed. A Branch Location feeds `location-in` only — a warehouse's
  `operation-in` is fed by Store POS `operation-out` via the generic row.
- `isPortCompatible` delegates to the table, so while a wire is being dragged
  only compatible target sockets highlight, and an invalid drop is rejected
  with the `topology-wire-incompatible` toast **before** any wire is drawn.
- Nine pre-existing wire-mechanics tests were repointed from the
  `warehouse → workspace` pair (which the old permissive gate allowed but the
  typed table correctly rejects) to a valid store → fresh-workspace pair.

### Slice 2 — live validation badges

The same validation the Apply gate runs now surfaces on the canvas while
editing, so a user sees what is wrong without applying:

- **`validateEditorGraph(nodes, wires, allowLegacyApply)`** is a shared helper
  that runs `normalizeTopologyGraph` + `validateTopologyGraph` under the exact
  Apply gate (canonical Branch Location identity, or strict mode when
  `allowLegacyApply` is false). Both the live badge surface AND the Apply
  handler call it, so the on-canvas badges and the Apply toast can never drift
  apart.
- Per-node errors (a workspace missing its `Location In`, a second Location
  feed, an invalid purpose/type pair) render as a `.node-validation-note` on
  the offending card — `role="status"`, floating in the card's reserved
  port-rail padding so the fixed card geometry is untouched.
- Graph-level errors (missing or multiple Branch Location roots, a wire
  referencing a ghost node) render as a fixed `.topology-validation-banner` at
  the top of the canvas — `role="alert"`, a sibling of the pannable viewport.
- Both surfaces clear live as the canvas is edited (no Apply round-trip), and
  legacy non-canonical canvases stay badge-free, mirroring the Apply gate.### Ticket routing is authorable (load-only gap closed 2026-08-08)

The Resto preset ships a loaded `ticket-out → ticket-in` KDS → printer wire,
and the pairing table admits that pair. A later slice closed the load-only
gap: KDS nodes now expose a visible right **Ticket Out** socket, and hardware
inputs admit the `ticket-in` semantic alongside `generic-in`, so a KDS →
printer drop resolves to exactly one `ticket-routing` option and authors the
wire in the preset's exact recorded format. See the implementation ADR
([2026-08-08-adr44-typed-connection-gating.md](2026-08-08-adr44-typed-connection-gating.md)).
`operation-out` remains load-compatible / future-facing only.

## Related decisions

- [ADR #34 Implementation: Typed Connection Gating & Live Validation](2026-08-08-adr44-typed-connection-gating.md)
- [ADR #22: Visual Node-Based Store & Workspace Topology Builder](2026-07-20-node-based-store-topology-builder.md)
- [ADR #4: Store-First Tenancy & Workspace Type/Instance Architecture](2026-07-10-workspace-type-instance-design.md)
- [ADR #7: Data Scope Guard](2026-07-10-data-scope-guard.md)

> last audited 26-08-26 by docs-auditor

