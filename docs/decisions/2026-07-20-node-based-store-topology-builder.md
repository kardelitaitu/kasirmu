---
num: 22
area: topology
title: ADR #22: Visual Node-Based Store & Workspace Topology Builder
status: Implemented (2026-07-22) — Amended (2026-07-23)
---
# ADR #22: Visual Node-Based Store & Workspace Topology Builder

**Status:** Implemented (2026-07-22) — Amended (2026-07-23)  
**Date:** 2026-07-20  
**Author:** Architecture Team & kasir.mu Contributors  
**Tags:** store-topology, node-editor, multi-store, workspaces, inventory-routing, ux  

---

## Context

Managing multi-store retail and food & beverage enterprises involves complex relationships between store branches, checkout registers (workspaces), inventory storage locations (warehouses), and physical peripherals (printers, KDS displays). 

Historically, managing these entity relationships required navigating separate administrative forms and database tables:
- Stores registered in `store_profiles`
- Workspaces registered in `workspace_instances`
- Inventory locations registered in `inventory_locations`
- Deduction priorities configured via junction tables

This traditional form-based approach lacks visual clarity, making it difficult for merchants to understand their enterprise topology or configure multi-warehouse stock deduction fallbacks.

To solve this, this decision introduces a **Visual Node-Based Store Topology Builder** (inspired by node graph interfaces in **Blender**, **Grasshopper**, and **Node-RED**). It ships as a dedicated **Topology** entry in the Settings sidebar (Management category), rendered by the standalone `TopologyScreen`; it is **not** embedded inside the Stores dashboard, which remains stores-only.

---

## Decision

We have implemented an interactive, canvas-based **Node Topology Editor** allowing store owners to visually assemble and wire up their enterprise hierarchy using node cards and directional **1-Way (`→`)** or **2-Way (`↔`)** arrow connections.

### 1. Node Types & Capabilities

| Node Type | Icon | Output Ports | Input Ports | Description |
|---|:---:|---|---|---|
| **Store Node** | 🏢 | Store Out (`→`) | — | Central store branch profile. Displays online terminal count telemetry. |
| **Workspace Node** | 🛒 / 🍽️ | Stock Out (`→`), Print Out (`→`) | Store In (`→`) | POS checkout register / KDS instance. |
| **Warehouse Node** | 📦 / 🥬 | Transfer (`↔`) | Stock In (`→`), Transfer (`↔`) | Physical inventory storage location. Displays live stock & low-stock alerts. |
| **Hardware Node** | 🖨️ | — | Print In (`→`) | Thermal receipt printers, cash drawers, or hardware displays. |

---

### 2. Arrow Connection Specification

Connections between nodes on the SVG canvas are represented by clean directional wires:

#### 1-Way Arrow Connections (`─>`)
- **Store ─> Workspace**: Binds a workspace instance (`workspace_instances.store_id`) to a store location.
- **Workspace ─> Warehouse**: Directs stock deduction routing (`inventory_locations.bound_workspace_id`). Multiple wires from a single POS workspace automatically assign **Priority 1, Priority 2 (Fallback)** tags.
- **Workspace ─> Printer / KDS**: Routes receipts or kitchen tickets to target peripherals.

#### 2-Way Arrow Connections (`<─>`)
- **Warehouse A <─> Warehouse B**: Configures bi-directional inventory transfer capabilities between storage locations.
- **Store <─> Cloud Daemon**: Indicates bi-directional cloud data synchronization.

---

### 3. Architecture Overview

```
MultiStoreDashboardScreen (parent tab view)
  ├─ [ Card View ]
  └─ [ Node Topology Editor ] (Canvas View)
       ├─ NodeToolRack (Left Sidebar: Drag & Drop palette + Presets)
       ├─ NodeCanvas (SVG bezier arrow rendering + pan/zoom + grid)
       │    ├─ StoreNode (telemetry badges + ports)
       │    ├─ WorkspaceNode (accent colors + ports)
       │    ├─ WarehouseNode (stock alert indicators + ports)
       │    └─ HardwareNode (connection status + test print)
       ├─ NodeInspectorDrawer (Right Slide-over: node properties + per-node role overrides)
       ├─ SimulationDebugger (Animated energy pulse packets along arrow paths)
       └─ TopologyDiffModal (Summary of SQLite changes before atomic commit)
```

---

### 4. Enterprise Subsystems & UX Features

1. **⚡ 1-Click Topology Presets**:
   - *Simple Retail Preset*: 1 Store ─> 1 Retail POS ─> 1 Main Warehouse.
   - *Restaurant Preset*: 1 Store ─> 1 Resto POS ─> 1 Kitchen KDS ─> 1 Kitchen Pantry.
   - *Franchise Preset*: 1 Central Store ─> 3 POS Workspaces ─> 2 Warehouses.

2. **🎛️ Node Properties Inspector Drawer**:
   - Contextual right-side drawer to inspect and edit Store details, Workspace colors/roles, Warehouse low-stock alert thresholds, and Printer IP addresses.

3. **🧪 Live Order Simulation Debugger**:
   - A `[ Test Order Simulation ]` button triggers an animated test transaction where glowing energy pulse packets travel along arrow wires from POS to Warehouse and KDS/Printer nodes.

4. **🔲 Zone Group Containers**:
   - Collapsible regional containers (e.g. *"Jakarta Region"*, *"Logistics Hub"*) to group and drag multi-store clusters together.

5. **🔍 Topology Change Diff Preview**:
   - An `[ Apply Topology Changes ]` button opens a clean diff modal displaying precise SQLite record insertions, updates, and wire deletions before committing.

6. **⌨️ Canvas UX & Shortcuts**:
   - Pan/Zoom (0.2x – 2.0x), `Delete`/`Backspace` to remove nodes/wires, `Ctrl+Z`/`Ctrl+Y` undo/redo, and single-click wire mode toggle (`→` ↔ `↔`).

---

### 5. License Tier Entitlement & Access Control

The Node Topology Builder dynamically enforces license limits based on the active subscription tier (`TenantSubscription`):

> **Tier-name note:** the `1-Time / Standard / Pro / Enterprise` tier labels
> in the table below are superseded by `subscription-tiers.md` (FINAL
> 2026-08-17) — the lineup is now **Free · Plus · Pro ⭐ · Premium ·
> Enterprise**, and the numeric quotas come from `subscription-tiers.md` §3
> (e.g. Pro = 2 stores / 5 registers / 3 warehouses; Premium = 5 stores /
> unlimited registers & warehouses / 50 staff).
> The feature gates map cleanly: multi-warehouse fallback + 2-way transfer
> wires stay Pro+ (per the doc's Business Logic matrix), and regional zone
> containers stay Enterprise-only.

| Node / Topology Feature | Free | Plus | Pro | Premium | Enterprise |
|---|:---:|:---:|:---:|:---:|
| **Max Store Nodes** | **1** | **1** | **2** | **5** | **Unlimited** |
| **Max Workspace Nodes** | **1** | **2** | **5** | **Unlimited** | **Unlimited** |
| **Max Warehouse Nodes** | **1** | **2** | **3** | **Unlimited** | **Unlimited** |
| **Multi-Warehouse Fallback Wires** | 🔒 Disabled | 🔒 Disabled | **✓ Enabled** | **✓ Enabled** | **✓ Enabled** |
| **2-Way Warehouse Transfer Wires** | 🔒 Disabled | 🔒 Disabled | **✓ Enabled** | **✓ Enabled** | **✓ Enabled** |
| **Regional Zone Containers** | 🔒 Disabled | 🔒 Disabled | 🔒 Disabled | 🔒 Disabled | **✓ Enabled** |

#### Enforcement Mechanism
- **Palette Lock Badges**: Node cards in the left tool rack display a lock badge (`🔒 Pro` / `🔒 Enterprise`) when the current license tier limits are reached.
- **Wire Restriction Toasts**: Dragging a fallback stock wire or 2-way warehouse transfer line on a lower tier displays an in-context upgrade prompt (e.g. *"Multi-warehouse stock deduction fallback requires a Pro Tier license"*).
- **Backend Validation**: Tauri IPC `create_store_profile`, `create_workspace_instance_scoped`, and `create_inventory_location` enforce hard server-side license checks using `oz_core::subscription::TenantSubscription`.

---

## Consequences

### Positive
- **Visual Clarity**: Eliminates administrative friction when configuring complex multi-store, multi-warehouse enterprises.
- **Immediate Validation**: Order simulation debugger prevents misconfigured stock deduction rules before going live.
- **Full Backend Alignment**: Maps cleanly to existing SQLite schemas (`store_profiles`, `workspace_instances`, `inventory_locations`) without requiring breaking schema migrations.

### Negative
- Requires maintaining SVG arrow connection rendering and node canvas state logic in React/TypeScript.

---

## Verification Plan

### Automated Tests
- Unit tests for topology serializer: canvas graph JSON → SQLite relational commands.
- Vitest React component tests for node dragging, wire connections, and undo/redo state stack.

### Manual Verification
- Open **Settings → Management → Topology** (standalone `TopologyScreen`; not embedded in Stores).
- Drag preset or custom nodes onto canvas and draw 1-Way and 2-Way arrow wires.
- Run **Test Order Simulation** and verify pulse animation travels along connected arrow paths.
- Click **Apply Topology Changes** and confirm SQLite updates atomically.

---

## Amendment 1 (2026-07-23) — Atomic Commit & Type-Change Handling

This amendment documents two implementation decisions discovered during the
topology editor audit (TOPOLOGY_AUDIT.md, Critical #1 and #4):

### A. Workspace type_key is immutable — type changes require archive + recreate

The `UpdateInstanceFields` DTO in `ui/src/api/workspaces.ts:101-106` documents
that `type_key` and `store_id` are immutable fields on workspace instances. The
backend update command does not accept `type_key`. Changing a workspace's type
(e.g., `store-pos` → `restaurant-pos`) therefore cannot be a simple UPDATE.

**Implementation** (`TopologyScreen.tsx:handleTopologySave`):

When a persisted workspace node's `typeKey` differs from the backend's
`type_key`, the save handler:

1. **Archives** the old instance via `applyTopologyDiff` (sets `archived = 1`)
2. **Creates** a replacement instance with the new `typeKey`, a freshly
   generated UUID (`crypto.randomUUID()`), the same `name`, and the correct
   `store_id` resolved from topology wires
3. **Remaps** the topology diagram: all wire endpoints referencing the old
   instance ID are updated to the new UUID, and the saved diagram node's
   `id` is replaced
4. Returns an `oldId → newId` map to the editor so the canvas state stays
   consistent without requiring a full reload

The type-change count is surfaced in the save toast: e.g.,
"Topology saved: 0 created, 1 updated, 1 archived, 1 type-changed."

For freshly-added workspace nodes (`metadata.persisted === false`), the type
selector is fully functional — the user picks any type before the first save,
and the chosen type is used at creation time. For persisted nodes, the visual
type selector in the inspector is available; the archive+recreate path handles
the backend constraint transparently.

### B. Atomic commit promise (§4.5) is fulfilled by `applyTopologyDiff`

The original ADR §4.5 promised a "TopologyDiffModal … before committing
atomically." The implementation evolved from that design:

1. **Atomic backend command**: The Tauri command `apply_topology_diff`
   (`apps/desktop-client/src/commands/topology.rs`) accepts the full set of
   workspace node changes (creates, updates, archives) plus the topology
   diagram payload in a single call. All SQL writes execute inside one
   `conn.transaction()`. On any error, the entire diff rolls back — partial
   creates or orphaned diagram saves are impossible.

2. **Diagram persistence is coupled**: The diagram (nodes + wires JSON) is
   saved in the same atomic call as the workspace instance mutations, ensuring
   the relational truth and the visual representation never drift.

3. **Diff modal deferred**: The originally planned `TopologyDiffModal`
   (interactive preview with Confirm/Cancel) is deferred to a follow-up UX
   iteration. The current UX uses an `[ Apply Topology Changes ]` button with
   a save toast showing the count of affected records. The atomic commit
   guarantee is fully enforced at the backend layer regardless of the
   frontend UX surface.

4. **Post-save reload guard**: After a successful save, the editor sets
   `skipNextLoadRef` to prevent the `workspaceInstances` prop change from
   triggering a full canvas rebuild — in-flight edits are preserved
   (TOPOLOGY_AUDIT.md, Major #8).

### C. Wire-based store_id binding (§2)

The original ADR §2 specified "Store ─> Workspace: Binds a workspace instance
to a store location." The implementation (`TopologyScreen.tsx:handleTopologySave`)
now resolves `store_id` for each new workspace node by walking the topology
wires: it finds wires where the other endpoint is a `type === 'store'` node
(in either direction) and uses that store node's `id` as the `store_id`. A
fallback to the first primary store is used only when no Store→Workspace wire
exists (TOPOLOGY_AUDIT.md, Critical #5).

### D. Client-generated IDs replaced with UUIDs

Node and wire IDs now use `crypto.randomUUID()` instead of the original
`Date.now()`-based scheme. This eliminates same-millisecond collision
risk when rapidly adding nodes/wires (TOPOLOGY_AUDIT.md, Major #9).
Backend-assigned IDs (from `createWorkspaceInstanceScoped`) are remapped
via the `idMap` return value so the canvas and backend stay synchronized.

### E. Undo/Redo stack

The editor implements a full undo/redo history (50-entry ring buffer) with
standard semantics:
- Every mutating action pushes the prior state to the undo stack and clears
  the redo stack
- `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` keyboard shortcuts
- Dedicated Undo/Redo buttons in the tool rack
(TOPOLOGY_AUDIT.md, Major #6 and #7)

### F. Keyboard input guard

The global `keydown` handler checks `e.target` for `INPUT`, `TEXTAREA`, or
`contentEditable` elements and skips all canvas shortcuts (Delete, Backspace,
Ctrl+Z, arrows) while the user is typing in a text field. This prevents
accidental node/wire deletion while editing the Node Name or Subtitle inputs
(TOPOLOGY_AUDIT.md, Critical #3).

### G. Design constraint: type_key immutability

The `type_key` column on `workspace_instances` is immutable by backend
contract. The `UpdateInstanceFields` DTO (`ui/src/api/workspaces.ts`) only
accepts `name`, `description`, and `colour`. Any future feature that requires
in-place type changes (without archive+recreate) would require:
1. A backend migration to accept `type_key` in the update command
2. A corresponding `UpdateInstanceFields` DTO change
3. Validation that the new `type_key` references a valid `workspace_types.key`

Until then, archive+recreate is the only supported path for type changes.

> last audited 09-08-26 by buffy
> audit: Phase 1 Core Architecture & API Docs Audit

> status: ACCURATE (0 findings) · verified accurate: cargo check passed, no structural orphans, no stale version headers

