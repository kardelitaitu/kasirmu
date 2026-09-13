# Orchestrator Agent 2: LAN Order Event Dispatcher & State Sync

**Document:** `done-todo-kds-agents-2.md` (was `todo-kds-agents-2.md`)  
**Role:** Orchestrator Agent 2 (Real-Time LAN & Synchronization Architect)  
**Goal:** Implement real-time multicasting of order status transitions (New, Preparing, Ready, Bumped) across LAN terminals so individual prep stations and the expediter (Expo) station stay synchronized with zero lag.

**Target Crates:** `crates/oz-lan/` (or `desktop-client/src/lan_server.rs`), `platform-sync`  
**Sibling Documents:**
- [`todo-kds-agents-1.md`](./todo-kds-agents-1.md) (Agent 1 — Multi-Station KDS Routing Engine)
- [`todo-kds-agents-3.md`](./todo-kds-agents-3.md) (Agent 3 — Station UI, Modifier Badges & Expo Screen)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `feat(kds-lan): ...`
2. **Owned Path Fence (Exclusive to Agent 2):**
   - LAN event payloads for KDS in `crates/oz-lan/`
   - Real-time order synchronization listener in `apps/desktop-client/src/commands/kds.rs`
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit routing tables (Owned by Agent 1).
   - DO NOT edit front-end components (Owned by Agent 3).

---

## 📋 Task Checklist — RECONCILED 2026-09-13 (commit `3fceb3b040`)

> The original Phase 2.0/2.1 wording assumed a bare transport. Actual
> baseline: `crates/oz-lan` already shipped the `EventHandler` bridges
> (`SaleCompletedHandler`/`CourseFiredHandler`), legacy-psk-v1 +
> noise-psk-v1 transports, the per-peer offline buffer (DC-2), and
> `KdsDiscoverResponse` (27 tests green). The KDS *state-sync event
> vocabulary*, station-scoped delivery, and reconnect snapshots did NOT
> exist — that is what landed here. `desktop-client/src/lan_server.rs`
> is a 9-line shim; all transport work is in the crate.

### Phase 2.0: Baseline Audit
- [x] Inspect LAN server event broadcasting mechanisms.
  → Recorded above; module docs in `crates/oz-lan/src/lib.rs` updated to
  reflect the shipped feature set.

### Phase 2.1: Multi-Terminal KDS Event Broadcasting
- [x] Implement typed broadcast events: `KdsOrderPlaced`, `KdsLineItemBumped`,
      `KdsOrderReady`, `KdsOrderRecalled`.
  → `crates/oz-lan/src/kds_sync.rs`: the four structs ride a tagged
  `KdsSyncEvent` enum (`{"type":"kds.order_placed",…}` — tag is the first
  key, pinned by test) plus `KdsSyncHandler` (`EventHandler<KdsSyncEvent>`
  bridge, same shape as `CourseFiredHandler`). No second routing engine:
  the frozen `oz_core::kds` types (`KdsOrder`, `KdsLineItem`, `KdsDevice`)
  are consumed verbatim; `stations` on each event comes from
  `resolve_kds_targets` callers.
- [x] Ensure terminal filtering: only stations subscribed to specific station
      IDs receive detailed line updates; Expo station receives all updates.
  → Peers subscribe via `station_ids`/`device_id` on the existing `hello`
  (PSK binds) or `discover` (loopback binds) messages — both added as
  `#[serde(default)]`, so pre-kds-sync bytes parse and behave exactly as
  before. `should_deliver()` gates live traffic, buffered replay, and
  rebuffering in `handle_peer`; empty `station_ids` = Expo = sees all
  (mirrors `KdsDevice::station_ids` semantics); filtering fails open.
- [x] Handle offline/reconnect state reconciliation: newly booted KDS terminal
      fetches active queue snapshot from register terminal.
  → `{"op":"discover","want_queue":true}` makes the responder inject a
  live `active_queue` `KdsQueueSnapshot` (from
  `LanEventForwarder::with_kds_queue(provider)`) into the discovery
  response — typed on `KdsDiscoverResponse.active_queue`
  (`Option`, `serde(default)`, `skip_serializing_if`); non-opting peers
  get a byte-identical response (tested). Snapshot-first apply rule
  (ignore events with `occurred_at <= generated_at`) documented in
  `kds_sync.rs`.
- [x] Verify: `cargo test -p oz-lan` — 62 unit tests + 1 doctest pass
      (baseline 27 + 1). New: per-variant serde round-trips, filter
      matrix incl. Expo-sees-all and legacy peers, old-schema
      hello/discover/discovery-response payload compat, socket-level
      filtering over plain + noise transports, snapshot injection +
      typed apply path.
- [x] **Commit Milestone:** shipped as ONE commit `3fceb3b040`
  `feat(kds-lan): typed multi-terminal KDS sync events with station-scoped
  delivery and reconnect queue snapshots` (milestone 1+2 combined: the
  delivery-filtering and snapshot code share the same files/`handle_peer`
  flow; a retroactive split would have required reworking hot files in a
  concurrently-committed checkout).

### ⏳ Deferred (path-fenced: `apps/desktop-client/**` owned by the live
registration-gate session) — exact diff in the work-order final report;
`// INTEGRATION(oz-lan kds-sync):` markers sit at the crate boundaries:
1. `handle.kds_sync_handler()` registration in `apps/desktop-client/src/lib.rs`
   (`bus.subscribe("kds.sync", …)` next to the existing two).
2. `.with_kds_queue(provider)` chaining at forwarder construction.
3. KDS transition commands in `apps/desktop-client/src/commands/kds.rs`
   publishing the four `KdsSyncEvent` variants on the kernel event bus.
