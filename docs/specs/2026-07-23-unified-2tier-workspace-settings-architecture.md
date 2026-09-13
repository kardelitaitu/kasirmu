# ADR #22: Unified 2-Tier Workspace Settings Architecture — Centralized Hub, In-Workspace Contextual Controls & Topology Integration

**Status:** Proposed
**Date:** 2026-07-23
**Author:** Architecture Team & OZ-POS Contributors
**Tags:** settings, workspace, architecture, rbac, ui-components, design-system, i18n, a11y, multi-location, hal, event-bus, node-topology

---

## Context

Settings management in OZ-POS is currently fragmented across **5 distinct components and UI paradigms**:

1. **`SettingsPage.tsx`** (`ui/src/features/settings/SettingsPage.tsx`): Full-screen Settings Hub with a 13-section left sidebar tree (`SettingsNavTree.tsx`), accessible from the Admin workspace (`#/settings`). Uses modern design tokens and dither cards.
2. **`RetailOptionsScreen.tsx`** (`ui/src/features/retail/RetailOptionsScreen.tsx`): 8-tab modal overlay used when pressing `F10` / `Options` inside Store POS (`RetailPosScreen.tsx`). Uses legacy modal styles, hardcoded colors, and raw inputs.
3. **`SettingsSubScreen`** (`ui/src/features/sales/PosScreen.tsx`): 4-tab inline screen used when clicking the gear icon inside Restaurant POS (`PosScreen.tsx`).
4. **`SettingsPopup.tsx`** (`ui/src/frontend/shared/SettingsPopup.tsx`): 4-tab quick settings modal popup used in various management screens (Tax, Categories, Customers, Staff, Terminals, Suppliers).
5. **`KdsSettingsPanel.tsx`** (`ui/src/features/kds/KdsSettingsPanel.tsx`): Popover panel specifically for KDS screen preferences.

### Operational & Technical Challenges

1. **Inconsistent User Experience**: Depending on where a user opens settings, they see different tab layouts, styling tokens, and form controls.
2. **Duplicate Code & Maintenance Overhead**: Backend IPC commands (e.g. `get_store_settings`, `get_receipt_settings`) are duplicated across `RetailOptionsScreen`, `SettingsSubScreen`, and `SettingsPage`.
3. **Owner / Manager Needs vs. Cashier Scoping**:
   - **Owners & Managers** need a **Centralized Hub** where they can configure *all* workspace settings (Store POS, Restaurant POS, KDS, Inventory, Admin) from a single location without entering each workspace.
   - **In-Workspace Context**: When working inside a specific workspace (e.g. Store POS), an Owner or Manager needs quick access to *that workspace's settings* without wading through unrelated global options.
   - **Cashier / Staff Roles**: Staff working in a POS workspace should only have access to local terminal preferences (e.g. sound volume, dark mode toggle, scale zeroing), while administrative store settings must be protected.
4. **Lack of Real-Time Reactivity**: Changing a setting (e.g. tender presets or KDS SLA timers) in one screen currently requires a full manual reload for active UI components to reflect the update.
5. **Clear Separation of Hardware Config**: Thermal printers, cash drawers, customer displays, and barcode scanners are peripherals tied directly to a **workspace instance**. Hardware peripheral configurations (IP address, paper width, driver, test prints) belong strictly inside workspace settings, keeping the topology builder focused on high-level enterprise node routing (Stores, Workspaces, Warehouses).

### Current State (as of 2026-07-23)

Several pieces of the proposed architecture already exist in partial form:

- **SettingsNavTree.tsx** already includes a `topology` nav item (under the "Management" category) with SVG icon, Fluent localization key `settings-nav-topology`, and renders `<TopologyScreen />` via `SettingsPage.tsx`. This ADR extends rather than creates the topology integration.
- **`TerminalManagementScreen.tsx`** already exists as a settings section (nav key `terminals`), providing a foundation for terminal profile management.
- **`FeatureToggleScreen.tsx`** is already integrated as a settings section, establishing the pattern for embeddable feature screens.
- **`NodeTopologyEditor.tsx`** and **`TopologyScreen.tsx`** in `ui/src/features/stores/` provide the visual topology canvas with node drag, wire editing, and inspector drawer infrastructure.

This ADR builds on these existing components rather than replacing them. The net-new work spans **9 major pieces** across UI and backend: shared workspace card components, the `WorkspaceSettingsModal` for Tier 2, workspace-bound hardware peripheral configuration, event-bus reactivity, `SettingsContext` (React context with debounced listener + scoped refetch), `terminal_profile.json` format + `useTerminalProfile` hook, `setting_updated` delta ledger + `write_setting_delta` IPC, async event bus handler support, and `SettingsPage.tsx` section extraction (see Phase 0 prerequisites).

---

## Decision

We propose a **Bulletproof Unified 2-Tier Workspace Settings Architecture** built around **shared workspace settings components, real-time event-bus reactivity, offline delta sync, workspace-bound hardware peripheral controls, and visual node topology integration**.

### 1. Conceptual Model — 2-Tier Dual-Access with Topology Integration

```
                    ┌─────────────────────────────────────────┐
                    │       OWNER / MANAGER AUTHENTICATED     │
                    └────────────────────┬────────────────────┘
                                         │
        ┌────────────────────────────────┼────────────────────────────────┐
        ▼                                ▼                                ▼
 ╔═════════════════════════╗    ╔═════════════════════════╗    ╔═════════════════════════╗
 ║  TIER 1: CENTRAL HUB    ║    ║ TIER 2: IN-WORKSPACE    ║    ║   TOPOLOGY CANVAS       ║
 ║ (Admin / #/settings)    ║    ║  (Quick Modal / F10)    ║    ║ (Tier 1 Alternate View) ║
 ╠═════════════════════════╣    ╠═════════════════════════╣    ╠═════════════════════════╣
 ║ • Global Store Config   ║    ║ • Auto-scoped to active ║    ║ • Visual Node Diagram   ║
 ║ • Staff & Security      ║    ║   workspace             ║    ║ • Store Branch Nodes 🏢 ║
 ║ • License & Cloud Sync  ║    ║ • Renders Shared Card   ║    ║ • Workspace Nodes 🛒/🍽️ ║
 ║ • WORKSPACES SECTION:   ║    ║ • Workspace Hardware    ║    ║ • Warehouse Nodes 📦    ║
 ║   ├── Store POS Card    ║    ║   (Printers, Scanners)  ║    ║ • Stock Deduct Wires    ║
 ║   ├── Resto POS Card    ║    ║ • "Admin Settings ↗"    ║    ║ • Click Node → Opens    ║
 ║   ├── KDS Display Card  ║    ╚═════════════════════════╝    ║   Shared Settings Card  ║
 ║   └── Inventory Card    ║                                    ║   in Inspector Drawer   ║
 ║ • TOPOLOGY MAP (sub)    ║                                    ║ • Live Status Badges    ║
 ║   └── Same canvas as    ║                                    ╚═════════════════════════╝
 ║       right, embedded   ║
 ╚═════════════════════════╝
```

The Topology Canvas is **not a third tier** — it is an alternate entry point into Tier 1. Selecting any Workspace, Store, or Warehouse node on the canvas opens the right Inspector Drawer, embedding the same shared settings card that appears in the Central Hub's Workspaces section. The canvas is accessible both as a nav item within the Central Hub sidebar and as a standalone view for power users.

**Role paths**: The diagram shows the Owner/Manager flow. Cashiers follow a separate path: F10 opens `WorkspaceSettingsModal` but renders only `TerminalPreferencesCard` (no store settings, no `Admin Settings ↗` shortcut, no topology canvas access). The Cashier path is omitted from the diagram for clarity but enforced in §7 RBAC and Phase 5 wiring.

---

### 2. Bulletproof Architectural Pillars

#### Pillar A: Shared Card Modularization
All workspace configuration logic (including printer, scanner, and scale hardware options) lives in modular, reusable card components.

**Pre-Phase-3 prerequisite — SettingsPage section extraction**: `SettingsPage.tsx` is currently 2,000+ lines with all section content rendered inline inside a monolithic `renderSection()` switch statement. Before adding workspace card sections in Phase 3, each existing section case must be extracted into an individual screen component (following the pattern already used for `FeatureToggleScreen`, `StaffManagementScreen`, `TerminalManagementScreen`, etc.). This keeps `SettingsPage.tsx` maintainable and prevents the file from ballooning past 3,000+ lines after workspace cards are added.

**Code splitting**: Workspace card components will be imported via `React.lazy()` so the initial Settings page bundle only loads the General section. Cards for Store POS, Restaurant POS, KDS, and Inventory are loaded on-demand when the user navigates to their respective nav sections. This prevents the workspace card code (including printer driver UI, scanner config forms, and KDS SLA sliders) from bloating the initial bundle.

```
ui/src/features/settings/
├── workspace-cards/
│   ├── WorkspaceStorePosSettings.tsx     <-- Store POS: Receipt Layout, Printers, Scanners, Scale, Presets
│   ├── WorkspaceRestaurantPosSettings.tsx <-- Restaurant POS: Kitchen Printers, Tables, Course Rules
│   ├── WorkspaceKdsSettings.tsx           <-- KDS: Layout, SLA Timers, Ticket Colors, Audio Chimes
│   ├── WorkspaceInventorySettings.tsx     <-- Inventory: Low Stock Thresholds, Deduction Location
│   └── TerminalPreferencesCard.tsx        <-- Local Terminal: Theme, Sound, Scale Zeroing
├── SettingsNavTree.tsx                    <-- Nav tree with 'Workspace Configurations' & 'Topology'
├── SettingsPage.tsx                       <-- Tier 1 Central Hub (Renders Shared Cards & Canvas)
└── WorkspaceSettingsModal.tsx             <-- Tier 2 Contextual Modal (Renders Active Shared Card)
```

```tsx
export interface WorkspaceCardProps {
  /** Session token for scoped IPC calls (ADR #7) */
  sessionToken?: string;
  /** Active location ID for multi-location scoping (ADR #18) */
  locationId?: string;
  /** Active terminal ID for reading/writing `terminal_profile.json` hardware bindings. Required when `variant='modal'` (Tier 2) so the card knows which register's printer/scanner config to display. */
  terminalId?: string;
  /** Whether the component is rendered inside Tier 2 modal or Tier 1 full page */
  variant?: 'full-page' | 'modal' | 'inspector-drawer';
  /** Callback fired after settings are successfully saved */
  onSaved?: () => void;
}
```

##### SettingsNavTree Integration

The new workspace config nav items will be placed in the **"Operations"** category (alongside `receipt`, `sync`, `email`), since workspace configuration is an operational concern. The existing `topology` nav item remains in the **"Management"** category.

- **Fuse.js search**: Workspace config items (e.g. "Store POS", "KDS") will be indexed by `SettingsNavTree`'s existing fuzzy search via `Fuse.js` without code changes — the search index is built from `NAV_ITEMS`, so adding new nav items automatically includes them.
- **Pin-to-top**: Workspace config items support the existing pin/unpin mechanism in `SettingsNavTree.tsx` (`pinnedSections` localStorage). No new code paths needed.
- **Category expansion**: The "Operations" category auto-expands when navigating to a workspace config section, matching the existing behavior for all other sections.

**Category rebalancing**: The current "Operations" category has 3 items (`receipt`, `sync`, `email`). Adding 4 workspace config items would make it 7 — proportionally the largest category. If the sidebar becomes unbalanced in user testing, split workspace config items into a dedicated **"Workspace Config"** category. For the initial implementation, workspace items remain in "Operations" to avoid premature category proliferation.

#### Pillar B: Workspace-Bound Hardware Peripheral Configuration
Peripherals belong strictly to workspace cards, with strict separation between Store-wide and Device-Local settings:
- **Store-Wide Receipt Rules**: Store Logo, Footer Text, Tax display, Margins (mm) save to SQLite `receipt_settings`.
- **Register-Local Hardware Bindings**: Printer IP address/USB path, Serial Scale COM Port, and Barcode Handler save to the local **`terminal_profile.json`** / `localStorage` per terminal ID. This prevents Register #2 from overwriting Register #1's hardware connections!
- **New terminal initialization**: When a terminal boots with no `terminal_profile.json`, `useTerminalProfile` creates a default profile with auto-detect defaults (empty printer IP = OS-default printer, empty scale COM port = no scale, no barcode handler). A toast notifies the operator: "New terminal detected — hardware config initialized with defaults. Configure in F10 → Settings." A store-wide hardware template system (to pre-configure defaults across terminals) is deferred to a follow-up ADR.

#### Pillar C: Real-Time Event Bus Reactivity & Deduplicated Context Refetching
- When settings change, backend emits `settings_updated` via `crates/oz-bus`.
- **Deduplication**: `SettingsContext` hosts the single listener. When `settings_updated` fires, `SettingsContext` performs a single, debounced refetch and updates shared React state. Individual UI components subscribe to `SettingsContext` rather than initiating independent concurrent IPC calls.
- **Async handler requirement**: The current `EventBus` dispatches handlers **synchronously** — the publisher blocks until every handler completes. If `SettingsContext`'s listener performs an IPC round-trip (`Tauri invoke()`) inside the handler, the UI thread freezes for the duration of the SQLite read + IPC call. The `settings_updated` handler **must** spawn a non-blocking task (`tokio::spawn` or `wasm_bindgen_futures::spawn_local`) to offload the refetch from the publishing thread. Without this, every settings save causes a perceptible UI hang on all active terminals.
- **Scoped refetch**: Rather than reloading all settings on every `settings_updated` event (current `SettingsPage.tsx` does 7 parallel IPC calls on load), `SettingsContext` should accept an optional `changedKey` parameter and only refetch the affected setting scope. This prevents unnecessary IPC round-trips when a single printer preference changes.

#### Pillar D: Offline-First Delta Sync & Transaction Isolation
- All database mutations run inside **rusqlite transactions** (`conn.transaction()`).
- Settings changes write a **last-write-wins (LWW) delta record** with a monotonically increasing `version` column to the `setting_updated` ledger, enabling consistent sync across multi-terminal offline clusters.
- **Version strategy — per-key counter**: The `version` column is incremented per `(key, terminal_id)` pair via `SELECT COALESCE(MAX(version), 0) + 1 FROM setting_updated WHERE key = ? AND terminal_id = ?`. This ensures only genuine conflicts on the same setting key trigger the concurrent-edit dialog (edge case #8). A global counter would fire false-positive conflict warnings on every unrelated setting change.
- **`SettingsUpdated` event payload**: The `settings_updated` event emitted by the backend includes `changed_keys: Vec<String>` and `terminal_id: String`. `SettingsContext` uses `changed_keys` to scope its refetch to only the affected settings, avoiding a full reload-all on every event.
- **Future consideration**: If LWW proves insufficient for concurrent multi-terminal edits (e.g. two managers changing the same KDS SLA timer simultaneously), a CRDT-based approach can replace LWW in a follow-up ADR. LWW is chosen as the initial strategy because it is significantly simpler to implement and test, and OZ-POS's typical deployment pattern (≤3 terminals per store) makes true concurrent-conflict scenarios rare.

#### Pillar E: Visual Topology Canvas Integration (`NodeTopologyEditor.tsx`)
- **Existing Foundation**: `SettingsNavTree.tsx` already includes a `topology` nav item that renders `<TopologyScreen />`. `NodeTopologyEditor.tsx` and `TopologyScreen.tsx` in `ui/src/features/stores/` provide the interactive node diagram with drag, wire editing, and inspector drawer infrastructure.
- **Inspector Drawer Integration**: Selecting any Workspace, Store, or Warehouse node on the canvas opens the right Inspector Drawer, embedding the node's shared settings card via `variant="inspector-drawer"`.
- **Live Status Badges**: Topology nodes display live settings telemetry badges on the canvas (Receipt Configured `✓`, KDS SLA `5m`, Low Stock `12`). These badges read from the same `SettingsContext` that powers the sidebar.
- **Sidebar Integration**: The existing `topology` nav item renders the interactive node diagram directly within `SettingsPage.tsx`. No structural changes needed — this ADR extends the existing integration with inspector drawer settings cards.

#### Pillar F: Resilient Error Boundaries & Form Draft Isolation
- **Local Form Draft Isolation**: Form fields inside shared cards operate on local draft state (`useState`). Unsaved edits are isolated; closing the modal via `Esc` discards uncommitted drafts without polluting global application state or active cart calculations.
- **Error Boundaries**: Each shared card is wrapped in a localized `<ErrorBoundary>`. IPC errors render `<ErrorState retry={refetch} />` without crashing the parent view.
- **Modal presentation variants**: `WorkspaceSettingsModal` accepts an internal `presentation` prop:
  - `'overlay'` — full-screen modal overlay (used for Store POS F10, matches legacy `RetailOptionsScreen` interaction).
  - `'slideover'` — slide-over panel from the right edge (used for Restaurant POS gear icon, preserves the existing inline sub-screen UX expectation).
  Phase 5 wires the correct presentation per workspace context. The prop is documented here so Phase 4 implementers are aware of the two modes before Phase 5 needs them.

---

### 3. Edge Case Mitigations & Prevention Matrix

| Identified Edge Case / Potential Bug | Impact | Architectural Mitigation |
| :--- | :--- | :--- |
| **1. Hardware Overwrite across Registers** | Register #2 overwrites Register #1's printer IP. | Split Store-wide rules (SQLite) from Register-local hardware bindings (`terminal_profile.json`). |
| **2. POS Hotkey Leakage in Modal** | Pressing `F1` (Pay) while typing in settings input triggers checkout. | Enforce `if (document.querySelector('[aria-modal="true"]')) return;` guard on all POS key listeners. |
| **3. IPC Event Storm on Refetch** | Multiple subscribers fire duplicate `get_store_settings` IPC calls. | Centralize `SETTINGS_UPDATED` event listener inside `SettingsContext` with debounced refetches. |
| **4. Unsaved Draft Pollution** | Closing modal without saving leaves dirty state in cart/app. | Hold all form inputs in local draft state; only commit to context/IPC upon explicit user submission. |
| **5. Session Role Swap / Timeout** | Manager session times out or swaps to Cashier while modal is open. | Re-evaluate `useAuth()` session reactively inside `WorkspaceSettingsModal`; fallback to `TerminalPreferencesCard`. |
| **6. Visual Snap on Dismissal** | Modal snaps shut without exit animation. | Gate unmounting through `useExitAnimation` / `useAnimatedModal` duration. |
| **7. Nested Modal Focus Trap Collision** | `SettingsPopup` (CRUD form) opens inside `WorkspaceSettingsModal` — two focus traps active simultaneously. `Esc` dismissal order is undefined; inner trap steals focus from outer. | `WorkspaceSettingsModal` must suspend its focus trap when a child `SettingsPopup` is mounted. Track nested modal depth via a ref counter; only re-engage the outer trap after the inner modal closes. |
| **8. Concurrent Workspace Card Edits** | Two managers on different terminals open the same workspace card (e.g., Store POS receipt settings) and save conflicting values. LWW resolves to the last write, but the first manager's changes are silently overwritten with no notification. | On save, the shared card checks the `version` column from the delta ledger. If the version incremented since the card loaded (another terminal saved), show a `ConfirmDialog`: "This setting was modified by another terminal. Overwrite?" The user can accept (force-push their value) or cancel (reload the other terminal's value). |
| **9. Workspace Archived While Modal Open** | Manager opens F10 modal for Store POS; another admin archives the Store POS workspace from the topology canvas. Modal displays a workspace that no longer exists; save will 404. | `WorkspaceSettingsModal` should subscribe to `workspace.deleted` events and auto-close with a toast notification when the active workspace is archived. |
| **10. Terminal Unplugged During Hardware Save** | Printer IP saved to SQLite store-wide rules, but `terminal_profile.json` write fails (disk full, permission denied). Store-wide rule committed, hardware binding lost — printer silently resets to default on next boot. Conversely, if JSON write succeeds but SQLite commit fails, an orphaned hardware binding exists with no corresponding store rule. | Wrap the SQLite + JSON writes in a three-phase commit: (1) backup existing `terminal_profile.json` → `.bak`, (2) write new JSON file, (3) commit SQLite transaction. If step 2 fails, abort SQLite. If step 3 fails, restore JSON from `.bak`. Delete `.bak` only after both succeed. |

---

### 4. Storage Layer & Data Persistence Mapping

| Setting Scope | Target Persistence Layer | Backend IPC / Storage Key | Example Properties |
| :--- | :--- | :--- | :--- |
| **Global Store Settings** | SQLite DB (`store_settings`) | `set_store_settings_scoped` | Store Name, Address, Tax ID, Currency |
| **Receipt & Print Settings** | SQLite DB (`receipt_settings`) | `set_receipt_settings_scoped` | Paper width (58mm/80mm), Footer, Margins |
| **Terminal Hardware Bindings** | Device File / `localStorage` | `terminal_profile.json` | Printer IP/USB path, Scale COM port |
| **Topology Connections** | SQLite DB (`workspace_instances`) | `apply_topology_diff` | Node positions, stock deduction priority wires |
| **User Display Preferences** | SQLite DB (`user_preferences`) | `set_user_preference` | KDS layout mode (`kanban`/`focus`), Table toggles |
| **Local Terminal Preferences** | `localStorage` | `localStorage.setItem(...)` | Sound volume, Dark/Light theme, Scale Zeroing |
| **Settings Delta Ledger** | SQLite DB (`setting_updated`) | `write_setting_delta` (in `platform/core/src/settings.rs`) | LWW version column, setting key, new value, terminal_id, timestamp |

---

### 5. Accessibility (A11y) & Keyboard Navigation Standards

- **Keyboard Hotkey**: Pressing `F10` opens `WorkspaceSettingsModal`. For Owners and Managers, the modal renders the full shared workspace card. For Cashiers, the modal renders only `TerminalPreferencesCard` (role-gated content, see §7). The F10 binding itself fires for all roles — the modal internally inspects `useAuth().role` to decide which card to render.
- **Keyboard Dismissal**: Pressing `Esc` closes the modal using `useExitAnimation`.
- **Focus Management**: Uses `useFocusTrap` to trap tab focus within `WorkspaceSettingsModal` while open.
- **ARIA Semantics**:
  - Container uses `role="dialog"` and `aria-modal="true"`.
  - Heading linked via `aria-labelledby="workspace-settings-title"`.

---

### 6. Internationalization (i18n) & Fluent FTL Contract

In accordance with project standards and githooks bundle parity verification (`scripts/verify-bundle-parity.py`):
- All user-visible text uses `@fluent/react` (`<Localized id="...">`).
- New Fluent keys added symmetrically to `ui/src/locales/settings.ftl` and `ui/src/locales/settings.id.ftl`.
- **Naming convention**: Workspace card labels use the `settings-workspace-*` prefix rather than `settings-nav-*` because these keys label card headings and modal titles, not sidebar navigation links. The existing `settings-nav-*` prefix remains reserved for `SettingsNavTree` sidebar items.
  - `settings-workspace-category-title`
  - `settings-workspace-store-pos`
  - `settings-workspace-restaurant-pos`
  - `settings-workspace-kds`
  - `settings-workspace-inventory`
  - `settings-workspace-topology-map`
  - `settings-workspace-admin-shortcut`

---

### 7. Role-Based Access Control (RBAC) Matrix

| Role | Access Level | Canvas & Modal Behavior |
| :--- | :--- | :--- |
| **Owner** | Full Access | Full node drag/wire editing + Inspector settings cards + `Admin Settings ↗` button. |
| **Manager** | Store & Workspace Level | Node inspector viewing/editing + `Admin Settings ↗` button. |
| **Cashier / Staff** | Local Terminal Only | Topology canvas hidden. In-workspace settings limited to `TerminalPreferencesCard`. |

---

### 8. Prerequisites & Dependencies

The following existing ADRs and components must be in place before Phase 1 begins:

| Dependency | Status | Rationale |
| :--- | :--- | :--- |
| **ADR #7 (Session Tokens)** | Implemented | `WorkspaceCardProps.sessionToken` requires scoped IPC calls. |
| **ADR #18 (Multi-Location Scoping)** | Implemented | `WorkspaceCardProps.locationId` requires location-aware settings queries. |
| **`NodeTopologyEditor.tsx` / `TopologyScreen.tsx`** | Implemented (`ui/src/features/stores/`) | Inspector drawer must exist before shared cards can be embedded in it. |
| **`SettingsNavTree.tsx` topology nav item** | Implemented | Already renders `<TopologyScreen />`; needs extension, not creation. |
| **`crates/oz-bus` event bus** | Implemented (`platform/kernel/src/event_bus.rs`) | `settings_updated` event must be publishable before `SettingsContext` can subscribe. |
| **`TerminalManagementScreen.tsx`** | Implemented | Provides terminal CRUD; `WorkspaceSettingsModal` references active terminal ID. |
| **`SettingsContext` (React context)** | ❌ Not Started — **new prerequisite** | All shared cards and live telemetry badges subscribe to `SettingsContext`. Must provide a single debounced `settings_updated` listener with scoped refetch capability. Without this, Phases 2–5 cannot function. |
| **`terminal_profile.json` format + `useTerminalProfile` hook** | ❌ Not Started — **new prerequisite** | Pillar B's register-local hardware binding separation depends on this file format and hook. Without it, multi-terminal printer/scanner configs silently overwrite each other. Format spec and hook must exist before Phase 1. |
| **`setting_updated` delta ledger + `write_setting_delta` IPC** | ❌ Not Started — **new prerequisite** | Pillar D's LWW delta sync and the concurrent-edit conflict detection (edge case #8) depend on this table and IPC command. Must be built in `platform/core/src/settings.rs` before Phase 2. |
| **Async event bus handler support** | ❌ Not Started — **new prerequisite** | Pillar C requires the `settings_updated` handler to be non-blocking. The current synchronous `EventBus::publish()` blocks the publisher until all handlers complete. This must be addressed (via `tokio::spawn` in the handler or a new `publish_async` API) before Phase 3. |
| **SettingsPage section extraction** | ❌ Not Started — **new prerequisite** | `SettingsPage.tsx` is 2,000+ lines with inline JSX for every section. Before adding workspace card sections in Phase 3, each existing section must be extracted into an individual component (following the `FeatureToggleScreen` pattern). This is a pure refactor with no behavioral changes. |

Five new infrastructure dependencies have been identified that are not satisfied by existing code. These must be completed before their dependent phases begin.

---

### 9. Testing Strategy

| Layer | What to Test | Tools | Gate |
| :--- | :--- | :--- | :--- |
| **Unit** | Each shared card's save/load cycle, draft isolation, form validation | Vitest + React Testing Library | Must pass before Phase 1 PR merge |
| **Unit** | `SettingsContext` event listener deduplication, scoped refetch, debounce timing | Vitest | Must pass before Phase 0b PR merge |
| **Unit** | `terminal_profile.json` read/write/validate round-trip; corruption recovery | Vitest | Must pass before Phase 1 |
| **Unit** | `write_setting_delta` LWW version increment, concurrent-edit detection | Vitest + in-memory SQLite | Must pass before Phase 2 |
| **Integration** | Event bus → `SettingsContext` → UI reactivity chain (change setting, verify all subscribers update within debounce window) | Vitest + mocked `oz-bus` | Must pass before Phase 3 |
| **Integration** | Async `settings_updated` handler does not block UI thread (timing assertion) | Vitest + mocked `oz-bus` | Must pass before Phase 3 |
| **Integration** | `WorkspaceSettingsModal` role-swap: Manager → Cashier session timeout mid-modal | Vitest + mocked `useAuth` | Must pass before Phase 5 |
| **Integration** | Nested modal focus trap: `SettingsPopup` inside `WorkspaceSettingsModal`, Esc dismissal order | Vitest + React Testing Library | Must pass before Phase 5 |
| **Integration** | Three-phase commit: backup → write JSON → commit SQLite → restore from `.bak` on SQLite failure (edge case #10) | Vitest + mocked filesystem | Must pass before Phase 1 |
| **E2E** | F10 modal → Admin Settings shortcut flow (Store POS → WorkspaceSettingsModal → Admin Settings ↗ → SettingsPage) | Playwright (desktop project) | Must pass before Phase 6 |
| **E2E** | Topology canvas → inspector drawer → shared card render cycle | Playwright (desktop project) | Must pass before Phase 6 |
| **E2E** | Multi-terminal concurrent edit: Terminal A saves, Terminal B's card detects stale version and shows conflict dialog | Playwright (desktop project, 2 contexts) | Must pass before Phase 6 |
| **Security** | Cashier types `#/settings` in URL bar → route guard redirects to workspace selector | Playwright (desktop project) | Must pass before Phase 5 |
| **Offline** | Admin Settings ↗ shortcut when offline: graceful degradation with toast | Playwright (desktop project, offline mode) | Must pass before Phase 6 |
| **A11y Audit** | Focus trap, Esc dismissal, `aria-modal`, screen reader announcements for all modal states (including nested modal) | Playwright + `@axe-core/playwright` | Must pass before Phase 6 |

All E2E tests must use `locale: 'en-US'` (already configured in `ui/e2e/playwright.config.ts`) and must not rely on translated text for selectors. Use ARIA roles and `data-testid` attributes for locale-independent element selection.

---

## Migration & Implementation Plan

### Phase 0 — Prerequisite Build-Out (Must Complete Before Phases 1–6)

| Task | Description | Key Files | Testing Gate (see §9) |
| :--- | :--- | :--- | :--- |
| **0a: SettingsPage extraction** | Extract each section case from `SettingsPage.tsx` into individual screen components (`GeneralSection`, `ReceiptSection`, `SyncSection`, etc.) following the existing `FeatureToggleScreen` pattern. Pure refactor — no behavioral changes. | `SettingsPage.tsx`, `ui/src/features/settings/sections/*` | Unit: existing SettingsPage unit tests must pass |
| **0b: `SettingsContext`** | Build React context with: single debounced `settings_updated` listener, scoped refetch via `changedKey`, and `useSettings()` hook for consumer components. | `ui/src/contexts/SettingsContext.tsx`, `ui/src/hooks/useSettings.ts` | Unit: `SettingsContext` event listener deduplication + debounce timing |
| **0c: `terminal_profile.json` + hook** | Define JSON schema for register-local hardware bindings (printer IP/USB, scale COM port, scanner handler). Build `useTerminalProfile(terminalId)` hook with read/write/validate + corruption recovery. | `ui/src/hooks/useTerminalProfile.ts`, `docs/terminal-profile-schema.md` | Unit: `terminal_profile.json` read/write/validate round-trip; corruption recovery |
| **0d: Delta ledger + `write_setting_delta`** | Add `setting_updated` table with `version INTEGER, key TEXT, value TEXT, terminal_id TEXT, timestamp TEXT` to the SQLite schema. Implement `write_setting_delta` IPC in `platform/core/src/settings.rs`. **All ~50 existing `Settings::set_*` methods** (store name, address, tax ID, receipt fields, printer, scanner, sync, brand, credit, exchange rate, currency display) must also call `write_setting_delta`. This is the largest single refactor in the ADR — a cross-cutting instrumentation of the entire settings backend. | `platform/core/src/settings.rs`, migration SQL | Unit: `write_setting_delta` LWW version increment, concurrent-edit detection |
| **0e: Async event bus handler** | Ensure `settings_updated` handler runs non-blocking. Either wrap the handler body in `tokio::spawn`, or extend `EventBus` with `publish_async` that spawns handlers on a dedicated runtime. | `platform/kernel/src/event_bus.rs` | Integration: async `settings_updated` handler does not block UI thread (timing assertion) |

---

| Phase | Description | Key Files Created/Modified | Testing Gate (see §9) |
| :--- | :--- | :--- | :--- |
| **Phase 1: Shared Cards & Local Profile** | Extract settings logic (with terminal profile separation for local hardware) into `WorkspaceStorePosSettings`, `WorkspaceRestaurantPosSettings`, `WorkspaceKdsSettings`, and `TerminalPreferencesCard`. Depends on Phase 0b (SettingsContext for live updates) and Phase 0c (terminal profile hook). | `ui/src/features/settings/workspace-cards/*`, `hooks/useTerminalProfile.ts` | Unit: shared card save/load + draft isolation |
| **Phase 2: Topology Integration** | Wire shared workspace cards into `NodeTopologyEditor.tsx` right Inspector Drawer via `variant="inspector-drawer"`. Add live status badges reading from `SettingsContext`. Depends on Phase 0b (SettingsContext), Phase 0d (delta ledger), and Phase 1 (shared cards must exist). | `NodeTopologyEditor.tsx`, `TopologyScreen.tsx` | E2E: topology → inspector drawer → card render |
| **Phase 3: Tier 1 Integration** | Add new nav items for workspace config cards to `SettingsNavTree.tsx` under the "Operations" category. Update `SettingsPage.tsx` to render shared cards in the main content area. | `SettingsNavTree.tsx`, `SettingsPage.tsx` | Integration: event bus → SettingsContext reactivity |
| **Phase 4: Tier 2 Modal** | Implement `WorkspaceSettingsModal.tsx` with Event Bus subscription, role checking, hotkey isolation, and `Admin Settings ↗` header shortcut. | `WorkspaceSettingsModal.tsx` | Unit: SettingsContext dedup |
| **Phase 5: Workspace Wiring** | Replace `RetailOptionsScreen` in `RetailPosScreen.tsx` (F10 hotkey, full overlay modal) and `SettingsSubScreen` in `PosScreen.tsx` (gear icon click, inline sub-screen) with `WorkspaceSettingsModal`. In Restaurant POS, the modal renders as a **slide-over panel** (not a full overlay) to preserve the existing inline UX expectation — controlled via an internal `presentation?: 'overlay' | 'slideover'` prop. Add `aria-modal="true"` guards to all POS hotkey handlers. The F10 binding fires for all roles; the modal role-gates its content (Cashiers see only `TerminalPreferencesCard`). | `RetailPosScreen.tsx`, `PosScreen.tsx` | Integration: role-swap timeout + E2E: F10 → Admin shortcut |
| **Phase 6: Deprecation** | Delete obsolete `RetailOptionsScreen.tsx` and clean up legacy CSS rules. | `RetailOptionsScreen.tsx`, `RetailPosScreen.css` | All §9 gates must pass |

### Backward Compatibility & Rollback

- **Coexistence**: During Phases 1–5, the old components (`RetailOptionsScreen`, `SettingsSubScreen`, `SettingsPopup`, `KdsSettingsPanel`) remain functional and untouched. The new shared cards and `WorkspaceSettingsModal` are added alongside them without removing any existing code paths.
- **Feature Flag**: A Tauri-level feature flag (`workspace-settings-v2`) gates the new `WorkspaceSettingsModal`. When disabled, `F10` continues to open the legacy `RetailOptionsScreen`. The flag is enabled by default in development builds and can be toggled per-terminal via `terminal_profile.json`.
- **Rollback**: If Phase 5 or 6 introduces regressions, disabling the feature flag immediately restores the legacy components. Phase 6 (deletion of `RetailOptionsScreen.tsx`) must not occur until the feature flag has been enabled in production for at least one full release cycle with no reported regressions.
- **Data Compatibility**: New settings written through shared cards use the same SQLite schema as the existing `set_store_settings` / `set_receipt_settings` IPC commands. No schema migration is required. A rollback to legacy components reads settings written by shared cards without data loss. The `setting_updated` delta ledger is write-only during Phases 1–5; the legacy components ignore it.
- **`KdsSettingsPanel` migration**: `KdsSettingsPanel.tsx` is a popover (gear icon → portal), not a full modal. During Phases 1–5 it remains functional. In Phase 4, `WorkspaceKdsSettings` will be embedded inside `KdsSettingsPanel`'s popover body rather than replacing the popover with a modal — preserving the kitchen staff's existing interaction model (no modal overlay blocking the ticket board). The standalone `KdsSettingsPanel.tsx` is deprecated once `WorkspaceKdsSettings` is feature-complete.
- **Offline degradation for Admin Settings shortcut**: When `WorkspaceSettingsModal`'s "Admin Settings ↗" button is clicked while offline (no `#/settings` route available), the UI must show a toast: "Settings Hub is unavailable offline. Connect to the network to access all workspace settings." The modal itself remains functional for local terminal preferences.

---

## Status Tracking

| Phase | Status | Notes |
| :--- | :--- | :--- |
| Phase 0a: SettingsPage extraction | ⬜ Not Started | |
| Phase 0b: SettingsContext | ⬜ Not Started | |
| Phase 0c: terminal_profile.json + hook | ⬜ Not Started | |
| Phase 0d: Delta ledger + write_setting_delta | ⬜ Not Started | |
| Phase 0e: Async event bus handler | ⬜ Not Started | |
| Phase 1: Shared Cards & Local Profile | ⬜ Not Started | |
| Phase 2: Topology Integration | ⬜ Not Started | |
| Phase 3: Tier 1 Integration | ⬜ Not Started | |
| Phase 4: Tier 2 Modal | ⬜ Not Started | |
| Phase 5: Workspace Wiring | ⬜ Not Started | |
| Phase 6: Deprecation | ⬜ Not Started | |

---

> last audited 08-08-26 by docs-auditor
