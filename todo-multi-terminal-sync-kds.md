# Master Plan: Offline Multi-Terminal Sync (Track 2) & Restaurant Floor / KDS Live Firing (Track 3)

<!-- Audit stamp: 2026-10-06 · status: PLANNED · version lock: 0.0.41
     tracks:
       - Track 2: Offline Multi-Terminal Sync & Conflict Resolution (CRDT / SQLite WAL replication)
       - Track 3: Restaurant Floor Management & KDS Live Firing
     dependencies:
       - crates/kasirmu-lan (Noise_XXpsk3 transport, replay buffer, KDS sync protocol)
       - platform/sync (CRDT version vectors, delta mutation, Lamport clock)
       - crates/kasirmu-core (tables domain, KDS domain, offline queue, store sales)
       - apps/desktop-tauri & apps/mobile-tauri (IPC commands, event bridge, daemon)
       - ui (useKdsRealtime, TableManagementScreen, ExpoScreen, RestaurantMenu)
-->

## Executive Summary

kasir.mu already contains high-grade, audited foundational building blocks:
1. **`crates/kasirmu-lan`**: Hardened, headless LAN event transport using `Noise_XXpsk3_25519_ChaChaPoly_SHA256`, device-keyed bounded replay buffers (1,024 events/peer, 8,192 total), station-scoped delivery, and typed KDS sync events (`KdsOrderPlaced`, `KdsLineItemBumped`, `KdsOrderReady`, `KdsOrderRecalled`, `order.course_fired`).
2. **`platform/sync/src/crdt/`**: Mathematical CRDT primitives (`VersionVector`, `LamportClock`, `DeltaMutation`, `merge_deltas`), and additive stock merge (`resolve_stock_crdt`).
3. **`crates/kasirmu-core`**: Comprehensive `Table` and `TableStatus` state machine (`available`, `occupied`, `reserved`, `cleaning`), geometric validation, and active sale linking (`assign_table_order_scoped`, `release_table_scoped`).

**The Critical Architectural Gap**:
- Today, `LanEventForwarder` runs on Desktop, but **no client in `apps/mobile-tauri` or the UI connects to it**.
- Android tablets operate in isolation: they talk only to their local SQLite DB and periodic cloud HTTP sync. If store internet goes down:
  - Table seating and open tabs on Tablet A are invisible to Tablet B.
  - Kitchen orders bumped on a KDS tablet do not update the Expo display or cashier POS.
  - Course firing (`order.course_fired`) does not reach kitchen screens in real time.
  - Concurrent offline stock movements on multiple registers rely strictly on cloud reconciliation rather than instant peer convergence.

This master plan bridges the peer-to-peer gap over the audited `kasirmu-lan` transport, enabling **zero-cloud local store resilience**, **instant sub-10ms KDS live firing**, and **conflict-free multi-terminal floor management**.

---

## Architecture Blueprint

```
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                       STORE LOCAL AREA NETWORK (LAN)                        │
 └─────────────────────────────────────────────────────────────────────────────┘
                                        ▲
                 ┌──────────────────────┴──────────────────────┐
                 │                                             │
      Noise_XXpsk3 TCP (Encrypted)                  Noise_XXpsk3 TCP (Encrypted)
                 │                                             │
                 ▼                                             ▼
 ┌──────────────────────────────┐              ┌──────────────────────────────┐
 │   PRIMARY REGISTER / SERVER  │              │   MOBILE / KDS TABLET PEER   │
 │     (Desktop or Master POS)  │              │    (Android / iOS / Expo)    │
 ├──────────────────────────────┤              ├──────────────────────────────┤
 │ • LanEventForwarder (Listener)│              │ • LanClient (Auto-reconnect) │
 │ • Bounded Device Replay      │              │ • Station Filtering Sub      │
 │ • SQLite Master (rusqlite)   │              │ • Local SQLite Cache         │
 │ • Kernel Event Bus           │              │ • WebView Tauri Event Bridge │
 └──────────────────────────────┘              └──────────────────────────────┘
         ▲              ▲                              ▲              ▲
         │              │                              │              │
  Table Events     KDS Tickets                   Table Status     Bump / Fire
 (occupied/free)  (course fire)                  Realtime View    Action Uplink
```

---

## Detailed Phase Breakdown

### Track 2: Offline Multi-Terminal Sync & CRDT Replication

#### Phase 2.1: LAN Peer Client & Automatic Discovery [COMPLETED in 7fe413920]
- **Goal**: Give `apps/mobile-tauri` (and secondary desktop instances) a resilient LAN client that dials `LanEventForwarder`.
- **Implementation**:
  - [x] Implement `LanClient` in `crates/kasirmu-lan/src/client.rs` supporting:
    - Transport handshake: `Noise_XXpsk3` (with domain-separated PSK derived from store key).
    - Hello handshake with `device_id` and optional `station_ids`.
    - Auto-reconnect with exponential backoff + jitter (200ms -> 5s).
    - Background read loop receiving typed frames and emitting to a receiver channel.
    - Uplink write loop sending commands/actions upstream (`kds.bump`, `table.update`, `crdt.delta`).
  - [x] Discovery:
    - Discovery payload parsing and fallback to streaming events on connection.
  - [x] Add `kasirmu-lan` dependency to `apps/mobile-tauri/Cargo.toml`.
  - [x] Wire client lifecycle in `apps/mobile-tauri/src/lib.rs` under `platform_startup::spawn_daemon("tablet lan client", ...)`.

#### Phase 2.2: CRDT Delta Replication over LAN
- **Goal**: Replicate offline data mutations directly across terminals without needing cloud roundtrips.
- **Implementation**:
  - Define wire event `crdt.delta_broadcast` carrying `DeltaMutation` or `OfflineQueueItem` batch stamped with `VersionVector`.
  - Primary server receives delta, executes local `merge_deltas` and `resolve_stock_crdt`.
  - Broadcasts confirmed causal version vector back to all active peers.
  - Add integration tests in `crates/kasirmu-lan/tests/crdt_replication_tests.rs` proving:
    - Two offline tablets generate concurrent stock movement deltas.
    - LAN connection re-established -> deltas merge additively without losing minor units or stock count.

#### Phase 2.3: Table & Held Cart Distributed Lease Protocol
- **Goal**: Prevent split-brain cart checkout or double-seating across terminals when offline.
- **Implementation**:
  - Lease message on wire: `table.lock_acquired { table_id, terminal_id, lease_ttl_ms }` and `table.lock_released`.
  - Soft optimistic lock: If Tablet A has an open bill on Table 4, Tablet B shows "Occupied by Terminal A" with a badge.
  - Held cart transfer: Tablet B can request cart handover; Tablet A acknowledges and releases local lock.

---

### Track 3: Restaurant Floor Management & KDS Live Firing

#### Phase 3.1: Floor Plan Table Status Broadcast [COMPLETED in 7fe413920]
- **Goal**: When Table status changes on any terminal, all POS screens update within milliseconds.
- **Implementation**:
  - [x] In `crates/kasirmu-lan/src/table_sync.rs`:
    - Defined `TableSyncEvent`:
      - `table.status_changed`: `{ table_id, name, status, active_sale_id, section, updated_at }`.
      - `table.cleared`: `{ table_id, updated_at }`.
  - [x] In `crates/kasirmu-bridge/src/tables.rs` & `apps/desktop-tauri/src/commands/tables.rs`:
    - Hook table mutation commands (`assign_table_order_scoped`, `release_table_scoped`, `update_table_status_scoped`, etc.) to emit `tables:status-changed` / `tables:deleted` via `ctx.emitter` and publish `TableSyncEvent::StatusChanged` onto kernel event bus.
  - [x] In `apps/desktop-tauri/src/lib.rs` & `apps/mobile-tauri/src/lib.rs`:
    - Desktop forwards `"table.sync"` over LAN.
    - Mobile tablet LAN client daemon receives table sync events and emits `tables:status-changed` to the frontend webview.
  - [x] In `ui/src/features/tables/TableManagementScreen.tsx`:
    - Listen for `tables:status-changed` and `tables:deleted` using `@/api/tauri::listen`.
    - On event: dynamically patch local `tables` state in-place without triggering full network re-fetch (zero flicker).

#### Phase 3.2: KDS Live Firing & Course Control
- **Goal**: Real-time kitchen ticket placement, course firing, and instant acoustic/visual alerts on KDS.
- **Implementation**:
  - Wire `order.course_fired` event end-to-end:
    - POS UI (`RestaurantCartSheet.tsx` or `CartPanel.tsx`): "Fire Mains" / "Fire Course 2" button triggers `fire_course_scoped(sale_id, course_id)`.
    - Core emits `order.course_fired` onto kernel bus.
    - `LanEventForwarder` routes to kitchen stations matching station filter.
    - KDS Tablet receives `order.course_fired`:
      - Front-end plays `useNewTicketSound.ts`.
      - Highlights fired course with pulsing timer badge (`KdsTimerBadge.tsx`).
  - Wire bidirectional ticket bumps:
    - Cook taps line item / card on tablet KDS (`ExpoScreen.tsx` / `KdsTicketCard.tsx`).
    - Tablet calls `bump_kds_item_scoped` -> emits `kds.line_item_bumped` over LAN client.
    - Primary server updates SQLite `kds_order_items.status = 'prepared'` and broadcasts to all other KDS screens.
    - Expediter screen immediately sees the line item change to green / completed.

#### Phase 3.3: Reconnect Snapshots & Failure Recovery
- **Goal**: When a tablet walks out of Wi-Fi range and reconnects, it receives missed events without duplicating tickets.
- **Implementation**:
  - Leverage `crates/kasirmu-lan/src/replay.rs` and `kds_sync::KdsDiscoverResponse`.
  - Upon reconnection, tablet sends `{"op":"discover","want_queue":true,"want_tables":true}`.
  - Primary server returns active KDS tickets snapshot (`KdsQueueSnapshot`) + table statuses snapshot.
  - Tablet reconciles snapshot first, then applies bounded replay queue items where `occurred_at > snapshot.generated_at`.
  - Add comprehensive disconnect-reconnect test harness.

---

## Acceptance Criteria & Automated Verification Commands

### Track 2 (Offline Multi-Terminal Sync & CRDT)
1. **Crate compilation & unit tests**:
   ```powershell
   cargo check -p kasirmu-lan && cargo test -p kasirmu-lan
   ```
2. **CRDT merge verification**:
   ```powershell
   cargo check -p platform-sync && cargo test -p platform-sync crdt
   ```
3. **Multi-terminal SQLite integration tests**:
   ```powershell
   cargo test -p kasirmu-core db::multi_terminal_tests
   ```

### Track 3 (Floor Plan & KDS Live Firing)
1. **Tables domain tests**:
   ```powershell
   cargo test -p kasirmu-core table
   cargo test -p kasirmu-core db::tables
   ```
2. **KDS routing & LAN sync tests**:
   ```powershell
   cargo test -p kasirmu-lan kds_sync
   cargo test -p kasirmu-core db::kds
   ```
3. **Frontend lint & typecheck**:
   ```powershell
   cd ui && npm run typecheck && npm run lint
   ```

---

## Invariants & Rules Enforced

- **INV-1 (Money Protection)**: All currency math in tickets, table open tabs, and split bills uses `Money` (`i64` minor units). Never float.
- **INV-2 (Transactional SQLite Writes)**: Every database state mutation (table assign, status release, ticket bump, offline queue write) occurs strictly inside an explicit `rusqlite` transaction.
- **INV-3 (Transport Security)**: LAN peer traffic must use `Noise_XXpsk3_25519_ChaChaPoly_SHA256` with domain separation. Cleartext transmission of tokens is prohibited.
- **INV-4 (Device-Keyed Bounded Buffering)**: Reconnection buffers must be keyed by `device_id` (surviving ephemeral port re-binds) and capped at 1,024 events/peer and 8,192 total.
- **INV-5 (Fail-Open Station Filtering)**: If station filtering metadata is missing or corrupted, events fail open (broadcast to all) to ensure kitchen tickets are never lost.
- **INV-6 (Single-Line Commits)**: All commits follow `<type>(<area>): <description>` with explicit pathspecs and zero untracked leaks.
