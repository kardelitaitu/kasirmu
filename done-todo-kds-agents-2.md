# Orchestrator Agent 2: LAN Order Event Dispatcher & State Sync

**Document:** `done-todo-kds-agents-2.md` (was `todo-kds-agents-2.md`)  
**Role:** Orchestrator Agent 2 (Real-Time LAN & Synchronization Architect)  
**Goal:** Implement real-time multicasting of order status transitions (New, Preparing, Ready, Bumped) across LAN terminals so individual prep stations and the expediter (Expo) station stay synchronized with zero lag.

**Target Crates:** `crates/oz-lan/` (or `desktop-client/src/lan_server.rs`), `platform-sync`  
**Sibling Documents:**
- [`done-todo-kds-agents-1.md`](./done-todo-kds-agents-1.md) (Agent 1 — Multi-Station KDS Routing Engine)
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
registration-gate session) — **now landed, see “App wiring — 13-09-26” below** —
exact diff in the work-order final report;
`// INTEGRATION(oz-lan kds-sync):` markers sit at the crate boundaries:
1. `handle.kds_sync_handler()` registration in `apps/desktop-client/src/lib.rs`
   (`bus.subscribe("kds.sync", …)` next to the existing two).
2. `.with_kds_queue(provider)` chaining at forwarder construction.
3. KDS transition commands in `apps/desktop-client/src/commands/kds.rs`
   publishing the four `KdsSyncEvent` variants on the kernel event bus.

---

## App wiring — 13-09-26

Closes the three deferred items above. Scope was exactly
`apps/desktop-client/src/{state.rs, commands/kds.rs, lib.rs}` — `oz-lan`,
`oz-bridge`, `oz-core` untouched (dependency inversion kept: the publish
seam lives where both worlds are in scope). No new `#[tauri::command]`:
`generate_handler!` is byte-identical, the 449-floor registration gate
passes, `wiring_audit` 6/6.

| Milestone | Commit | Landed |
|---|---|---|
| 1 | `6da74bf47b` `feat(kds-lan): add kds_queue_cache in-memory snapshot field to AppState` | `AppState.kds_queue_cache: Arc<std::sync::RwLock<oz_lan::KdsQueueSnapshot>>`, initialised to `default()` in BOTH constructors (`new` + `for_test`); M-1 sync-primitive table updated with the std-RwLock rationale. |
| 2 | `716b5d6c0f` `feat(kds-lan): publish KdsSyncEvent and refresh queue cache from kds command shims` | Private `publish_kds_sync` (kernel lock → `bus.publish`, warn-only on failure — a committed transition never fails the command) and `refresh_kds_queue_cache` (all bridge awaits into owned locals: `get_kds_queue_scoped(None)` + per-order `get_kds_order_lines_scoped` + `resolve_kds_targets`, `generated_at = Utc::now().to_rfc3339()`, write guard taken after the last await, held for the swap only). Publish sites: `create_kds_order_from_sale_scoped` → one `OrderPlaced` per fan-out ticket; `update_kds_status_scoped` → `OrderReady` on `ready`, `Recalled` (`recall_to` = new status) on `preparing`/`pending`; `update_kds_line_item_status_scoped` → `LineItemBumped` (`to_status` from the returned row, skipped with a warn if the parent order’s `sale_id` can’t be resolved). Stations on every event come from `resolve_kds_targets`; empty vec = broadcast (Expo). All three shims refresh the cache afterwards. |
| 3 | `d8acb2e87d` `feat(kds-lan): register kds.sync handler and attach discovery payload plus queue provider to LAN forwarder` | Forwarder construction chains `.with_discovery(json).with_kds_queue(provider)`. Discovery payload = `KdsDiscoverResponse { restaurant_pos_id: terminal_id.try_lock() (empty-string fallback), devices: [], version: CARGO_PKG_VERSION, transports: ["noise-psk-v1","legacy-psk-v1"], active_queue: None }`; `active_queue` is injected per-request by the crate. The provider is `move \|\| cache.read().cloned().unwrap_or_default()` over the `std` RwLock — it runs synchronously inside the per-peer accept task and NEVER touches the async DB mutex (that is the whole point of the cache). LAN_LOCK_RETRIES block gains `bus.subscribe("kds.sync", Box::new(handle.kds_sync_handler()));`; the registered-handlers log now names kds.sync. |

**Markers:** the two `// INTEGRATION(oz-lan kds-sync):` notes at
`crates/oz-lan/src/lib.rs:291` and `:797` sit in a crate this pass was
fenced out of, so they remain in place — but they are now honored:
desktop-client does register the handler, does chain
`.with_kds_queue`, and does publish the four variants.

**Verification:** `cargo check -p oz-pos-app` clean (note: the package is
`oz-pos-app`; the work order’s `-p desktop-app` matches no workspace
member). `cargo test -p oz-pos-app --lib registration` 10/10 (incl. the
449 floor, run against the edited `lib.rs`); `--lib state` 13/13;
`--test wiring_audit` 6/6. The work order’s `kds` test filter matches no
desktop-client test *name* (0 executed) — the real pin guarding the
shims is `gate_audit`’s `("kds", 9, …)` row, which passes. gate_audit as
a whole was RED at session end on one row only — `sync: pin 10, source
12` — caused by another session’s still-uncommitted edits to
`commands/sync.rs` in both shells, not by these three commits.

**Residuals (deliberate, out of this wiring’s scope):**
1. `devices` in the discovery payload is a static empty list — QR
   enrolment records live in the store DB and their propagation into the
   LAN advertisement is not part of the kds-sync crate contract.
2. The cache is refreshed only by transitions this desktop process
   executes through these shims. A KDS tablet running its own
   tablet-client binary applies its kitchen transitions in *its* process
   and publishes on *its* bus — such transitions never reach the desktop
   kernel bus here, so this terminal’s `active_queue` can lag a
   tablet-driven change until the next desktop-side transition rebuilds
   the snapshot from the shared store DB (the refresh is a full queue
   re-query, so it self-heals; it is staleness-bounded, not
   event-complete). Inbound *consumption* of peer events into a
   desktop-side mirror is not wired (the forwarder is send-only on this
   surface).
3. The snapshot starts empty at boot and is first populated by the
   first desktop-side KDS transition — at setup time no session token
   exists yet, so a boot-time refresh would have to bypass the scoped
   (permission-gated) bridge queries. A reconnecting peer before that
   point gets `active_queue` with zero tickets and the same self-heal
   afterwards.
4. Status moves to `served`/`cancelled` publish no event variant (the
   protocol defines only the four); they do refresh the cache, so the
   ticket correctly disappears from the next snapshot.

## Post-close fix — Phase-0 over-read (13-09-26)

**Fix commit:** `355d651a5f` · `fix(kds-lan): answer discover pipelined into the legacy hello segment` · files: `crates/oz-lan/src/lib.rs`, `crates/oz-lan/src/noise.rs`, `crates/oz-lan/src/lib_tests.rs`, `apps/desktop-client/src/commands/kds_lan_live_tests.rs`.

**The bug** (root-caused by the kds-lan-live suite, left unfixed there per its fence): `handle_peer`'s Phase-0 legacy-psk-v1 branch read the hello line through a *transient* `BufReader` inside a `{ }` block. BufReader fills its 8 KB buffer past the newline; when the block ended the reader was dropped and everything it had over-read — a `{"op":"discover",...}` line the tablet wrote back-to-back with its hello, coalesced by TCP into one segment — was discarded. The client then got no discovery response, no `active_queue` snapshot, and Phase 1 (which built a *second*, fresh reader) blocked on the socket until its 5 s timeout while the event stream began with heartbeats. The four green live proofs had been routed *around* the defect with a client-side 150 ms hello→discover pace.

**The fix:** one connection-level `BufReader`, created before the first byte is read and moved into `PeerTx::Plain`/`PeerTx::Noise`, serves every read on the connection — Phase-0 selector, legacy hello, noise handshake frames, Phase-1 discovery — so buffered bytes survive the phase handoff. `read_frame`/`write_frame`/`noise_handshake_responder` were generalized from `&mut TcpStream` to `AsyncRead`/`AsyncWrite` (+ `Unpin`) bounds so the handshake consumes through the same reader (the selector read can already have buffered message 1 — a later raw-stream read would invert the over-read into a frame-reorder bug, so two readers never cover one stream and nothing reads the socket under the reader). Writes bypass the reader explicitly via `get_mut()`; no serialization changed, so the frozen wire contract is byte-identical (pinned by the existing byte-identity and noise roundtrip tests). New unit test `discover_pipelined_with_hello_is_answered` sends both JSON lines in one write and asserts both are processed.

**Acceptance:** baseline (pre-fix): `cargo test -p oz-lan` 62 passed + 1 doctest; `cargo test -p oz-pos-app kds_lan_live` 4 passed / 1 ignored; the `-- --ignored` run red at `apps/desktop-client/src/commands/kds_lan_live_tests.rs:651` with first server line `{"type":"ping"}`. After: oz-lan 63 passed + 1 doctest green (incl. the new test); kds_lan_live **5 passed / 0 ignored**, twice back-to-back (the unpaced burst client now works); `-- --ignored` selects 0 tests; `cargo check -p oz-pos-app` clean. The `#[ignore]` on `kds_lan_live_bugdemo_discovery_lost_when_sent_with_hello` is off — it is now the active regression test; the other tests' 150 ms paces were deliberately left in place.

**Still-open design observation (NOT implemented, named follow-up):** the offline buffer is keyed by the ephemeral peer `ip:port` (`handle_peer`'s `peer_addr`, drained by the accept loop's `remove(&addr)`). A real reconnecting tablet gets a new ephemeral source port every time, so its buffered events sit under an address that never recurs — replay-on-reconnect effectively never fires in production (the tests see it only because they rebind the exact local port). Keying the buffer by the hello/discover `device_id` (already parsed into `PeerSubscription`) is the suggested follow-up; it needs a device_id↔peer_addr mapping established at handshake time.

**RESOLVED by `212078e554`** (13-09-26, agent 5) — the replay buffer now keys by `device_id` when the peer presents one (legacy peers stay `peer_addr`-keyed), drains inside `handle_peer` once the handshake has revealed the identity, and is bounded per-device + in total; full proof in [`done-todo-kds-agents-5.md`](./done-todo-kds-agents-5.md).
