# Orchestrator Agent 4: Dual-Terminal Live Validation of LAN KDS Sync

**Document:** `done-todo-kds-agents-4.md` (opened as `todo-kds-agents-4.md`)
**Role:** Orchestrator Agent 4 (Multi-Terminal Proof Architect)
**Goal:** Prove the kds-agents-2 feature works as *running code*, not just compiled wiring: a simulated station tablet and a simulated Expo tablet connected to a live `LanEventForwarder`, receiving correctly filtered `kds.*` events and a valid reconnect snapshot.

**Sibling Documents:**
- [`done-todo-kds-agents-2.md`](./done-todo-kds-agents-2.md) (the crate + desktop wiring this validates)
- [`done-todo-kds-agents-1.md`](./done-todo-kds-agents-1.md) (rules table — out of scope here)

---

## 🔒 Fence

- NEW: `apps/desktop-client/src/commands/kds_lan_live_tests.rs` (wired via one `#[cfg(test)] #[path=...] mod` line appended to `commands/kds.rs`)
- Existing test files in `apps/desktop-client/src/**` may be READ freely.
- FORBIDDEN: `crates/oz-lan/**` (validated as-is; any crate bug found is REPORTED, not fixed here), `crates/oz-bridge/**`, `crates/oz-core/**`, `lib.rs`, `state.rs`, `apps/tablet-client/**` (live session), `ui/**`, migrations, `registration_gate_tests.rs`.

## 📋 Task Checklist

### Phase 4.0: Baseline Audit
- [x] Determine the deepest reachable layer: if a `#[tauri::command]` shim can be invoked in a lib test (State construction problem), publish at the kernel bus instead and STAMP which layer was blocked. → **Stamped below: the production `publish_kds_sync` seam + real bus was reached; the public command wrappers were blocked one level higher.**

### Phase 4.1: Live dual-terminal test
- [x] Start a real `LanEventForwarder` on `127.0.0.1` with a PSK (dynamic port).
- [x] Connect two peers speaking the real wire protocol: station-A peer (hello with `station_ids=["grill"]`) and Expo peer (empty `station_ids`).
- [x] Publish the four `kds.*` transitions (real `KdsSyncEvent` values); assert station-A receives ONLY tickets whose `stations` include its id (or events with empty stations = broadcast), Expo receives ALL.
- [x] Offline-buffer proof: station-A peer disconnects, one targeted + one broadcast event fire, peer reconnects — buffer replay respects the same filter. → **Landed, split into positive-replay + filter-negative proofs; see stamp §3a/§3b for why the literal two-event one-buffer scenario is unreachable in the crate as written.**
- [x] Reconnect snapshot proof: `{"op":"discover","want_queue":true}` response carries the `active_queue` built from the AppState queue cache; a legacy `{"op":"discover"}` response stays byte-identical.

### Phase 4.2: Close
- [x] `cargo test -p oz-pos-app kds_lan_live` green; the existing `--lib registration` 10/10 and `--lib state` 13/13 stay green (no edits to their files). → **4/4 green (1 design-red demo `#[ignore]`d), 5 consecutive runs 5/5; see stamp for the concurrent-session red that is NOT this file's.**
- [x] Stamp results (what was proven, which layer was reached, crate bugs found if any) into this doc and rename `todo-` → `done-` ONLY if all proofs landed. → **All proofs landed; renamed.**

---

## ✅ Results stamp — 2026-09-13 (Orchestrator Agent 4)

**Code commit:** `0302039258` — `test(kds-lan): dual-terminal live validation - filtered broadcast, buffer replay, reconnect snapshot`
New `apps/desktop-client/src/commands/kds_lan_live_tests.rs` (657 lines, 5 tests) + 4-line `#[cfg(test)] #[path=...] mod` append to `commands/kds.rs`. No `#[tauri::command]` added — this commit touches no registration surface at all (for the live state of the 449 floor in a multi-session tree, see the verification note below).

### 0. Phase 4.0 — deepest layer actually reached

- **Reached: the production publish seam.** The test module mounts as a child of `commands::kds`, so it calls `publish_kds_sync(&state, event)` *itself* — the exact private function every kitchen-transition shim runs after its bridge commit — against the real kernel bus of `AppState::for_test()`, with the `bus.subscribe("kds.sync", Box::new(handle.kds_sync_handler()))` registration copied verbatim from `lib.rs` setup.
- **Blocked: the public `#[tauri::command]` wrappers** (`update_kds_status_scoped`, `create_kds_order_from_sale_scoped`, `update_kds_line_item_status_scoped`). `tauri::test` (dev-dependency, feature `test`) makes `State<'_, AppState>` constructible in principle, but each wrapper `?`-propagates out of the `oz_bridge` DB path long before its publish line: a seeded store DB, a live session token, real `kds_orders` rows and topology routing config — and `commands/kds_routing.rs` is being edited by a live sibling session. The work order's "do not contort the app" rule applies; no shim invocation was attempted at runtime.

### 1–2. Live forwarder + dual-terminal filtered broadcast

`kds_lan_live_dual_terminal_filtered_broadcast` — live `LanEventForwarder::new(127.0.0.1:<dynamic>, Some(PSK))` + `.with_discovery(...)` + `.with_kds_queue(...)`; station-A peer hellos `{"op":"hello","psk":…,"station_ids":["grill"],"device_id":"kds-grill-1"}` (legacy-psk-v1), Expo peer hellos with explicit empty `station_ids`. All four typed events published on the real bus. Over the sockets: **grill received exactly 3 lines** — the grill-scoped `kds.order_placed`, the `["grill","fry"]`-multi-station `kds.order_recalled`, and the empty-stations broadcast `kds.order_ready` — and **never** the fry-only `kds.line_item_bumped`; **Expo received all 4** (all four `kds.*` wire tags asserted present). End-of-stream is pinned by a sentinel line, not a timer.

### 3. Offline-buffer replay (two proofs over one real disconnect)

The work-order scenario "fire one targeted + one broadcast event at one disconnected peer" cannot fill the buffer with **both** lines as the crate is written: `handle_peer` buffers the *first* event whose write fails and then `return`s — every later broadcast has no subscriber for that address and is dropped. The proof is therefore split, both halves driving the real write-failure path (SO_LINGER(0) RST close):

- `kds_lan_live_offline_buffer_replays_station_event_on_reconnect` — grill peer disconnects, one grill event hits the failed write and is observed in the buffer via `buffered_count()`; the peer reconnects **from the same local socket address** (the buffer key) and receives the buffered event **first** (Phase-2 flush precedes live streaming), then the live event, and the buffer drains to 0.
- `kds_lan_live_offline_buffer_replay_respects_station_filter` — a legacy (unscoped) peer's disconnect buffers a fry-scoped line under its address; reconnecting a **grill** subscriber at that same address replays **nothing** (sentinel-terminated stream is empty): buffered replay obeys the station filter.

### 4. Reconnect snapshot + legacy byte-identity

`kds_lan_live_reconnect_snapshot_serves_seeded_queue_cache` — `state.kds_queue_cache` seeded with 2 tickets (brief std write-lock), provider wired exactly like lib.rs. `{"op":"discover","want_queue":true,"station_ids":["grill"]}` → response carries `active_queue` with exactly `snap-1`/`snap-2`, their stations and `generated_at`, base payload fields preserved (parsed through `KdsDiscoverResponse`). A plain `{"op":"discover"}` from a legacy peer on the same live server is **byte-identical** to the configured payload with no `active_queue` key.

### 🐛 Crate bugs found (REPORTED, not fixed — fence)

1. **`oz-lan handle_peer` Phase-0 over-read swallows a following `discover` line.** The legacy-psk-v1 hello branch reads its line through a *transient* `BufReader`; a `TcpStream` read can return several lines at once, and the bytes past the hello newline are **discarded** when that reader drops. A tablet that writes `hello` and `discover` back-to-back (one segment or a starved accept task) silently loses its discovery: no response, no `want_queue` snapshot, no discover-time subscription, then a 5 s Phase-1 stall. The same transient-reader pattern exists at Phase 1 for any second client line. The crate's own tests miss it because no test sends hello *and* discover over one PSK connection. **Demonstrating test:** `kds_lan_live_bugdemo_discovery_lost_when_sent_with_hello` — asserts the CORRECT behaviour, red by construction, kept `#[ignore]`d so the suite stays green; `cargo test kds_lan_live -- --ignored` fails in ~10 s with `first server line was "{\"type\":\"ping\"}"`. The green proofs pace hello→discover 150 ms client-side (a legitimate workaround a real client can also adopt); the asserts stay loud if a starved machine ever beats the pace. **Suggested crate fix (for its owner, not applied here):** keep ONE `BufReader` for the whole connection instead of constructing it per phase.
2. **Design observation — the offline buffer's peer key is ephemeral in practice.** Buffer keys are the accept-time `peer_addr` (client IP:port). A reconnecting tablet gets a NEW ephemeral source port, so replay never finds its entries — tests 3a/3b had to rebind the same local port deliberately to exercise the path. If replay is meant to serve real reconnects, the key should be a stable identity (`device_id` is already on the wire).

### Verification tail

```
$ cargo test -p oz-pos-app kds_lan_live
running 5 tests
test commands::kds::kds_lan_live_tests::kds_lan_live_dual_terminal_filtered_broadcast ... ok
test commands::kds::kds_lan_live_tests::kds_lan_live_offline_buffer_replays_station_event_on_reconnect ... ok
test commands::kds::kds_lan_live_tests::kds_lan_live_offline_buffer_replay_respects_station_filter ... ok
test commands::kds::kds_lan_live_tests::kds_lan_live_reconnect_snapshot_serves_seeded_queue_cache ... ok
test commands::kds::kds_lan_live_tests::kds_lan_live_bugdemo_discovery_lost_when_sent_with_hello ... ignored, demonstrates the oz-lan handle_peer Phase-0 over-read defect; the assert below fails by design
test result: ok. 4 passed; 0 failed; 1 ignored; 0 measured; 139 filtered out

$ cargo test -p oz-pos-app kds_lan_live   # x5 consecutive: 5/5 identical results, ~4.9 s each
$ cargo test -p oz-pos-app --lib state    # 13/13 green (unchanged)
```

`--lib registration`: the original 10 baseline tests were green at every check through the code commit (11:28 baseline and 11:35–11:38 rechecks). A post-commit recheck at 11:41 found two reds, BOTH owned by the concurrent sessions and neither reachable by this commit: (a) `drift_pin_registration_floor_is_met` — the sibling's in-flight `lib.rs`/`kds_routing.rs` work now registers **451** commands against the file's still-449 floor; this commit adds ZERO `#[tauri::command]` (proven by `git show --stat 0302039258`: one test file + a `#[path]` mod append), so the ratchet belongs to whoever raises the floor in their own JOURNAL'd pass; (b) `pin_a_comment_between_the_paren_and_the_argument_is_not_the_argument` — one of two new pins that appeared in `registration_gate_tests.rs` as working-copy-only edits of the rules session (absent from every HEAD blob at check time); its companion `pin_the_offender_predicate_...` went green minutes later as that session progressed, confirming in-flight authorship. This file touches no TS, no `ui/**`, no command surface — it owns none of these reds and none of their fixes.

rustfmt `--edition 2024` applied to exactly the two touched files. `create mode` in the commit: exactly `kds_lan_live_tests.rs`.

## Verification
- `cargo test -p oz-pos-app kds_lan_live` from repo root (package is `oz-pos-app`, NOT desktop-app). ✅ 4/4 green, 1 by-design red `#[ignore]`d.
- Per-file `rustfmt --edition 2024` on the two touched files only; never `cargo fmt --all`. ✅
- Commit form: pathspec one-liner; the new test file + the kds.rs mod-wiring line may share one commit (chain form for the new file). ✅ `0302039258`.
