# Orchestrator Agent 4: Dual-Terminal Live Validation of LAN KDS Sync

**Document:** `todo-kds-agents-4.md`
**Role:** Orchestrator Agent 4 (Multi-Terminal Proof Architect)
**Goal:** Prove the kds-agents-2 feature works as *running code*, not just compiled wiring: a simulated station tablet and a simulated Expo tablet connected to a live `LanEventForwarder`, receiving correctly filtered `kds.*` events and a valid reconnect snapshot.

**Sibling Documents:**
- [`done-todo-kds-agents-2.md`](./done-todo-kds-agents-2.md) (the crate + desktop wiring this validates)
- [`todo-kds-agents-1.md`](./todo-kds-agents-1.md) (rules table — out of scope here)

---

## 🔒 Fence

- NEW: `apps/desktop-client/src/commands/kds_lan_live_tests.rs` (wired via one `#[cfg(test)] #[path=...] mod` line appended to `commands/kds.rs`)
- Existing test files in `apps/desktop-client/src/**` may be READ freely.
- FORBIDDEN: `crates/oz-lan/**` (validated as-is; any crate bug found is REPORTED, not fixed here), `crates/oz-bridge/**`, `crates/oz-core/**`, `lib.rs`, `state.rs`, `apps/tablet-client/**` (live session), `ui/**`, migrations, `registration_gate_tests.rs`.

## 📋 Task Checklist

### Phase 4.0: Baseline Audit
- [ ] Determine the deepest reachable layer: if a `#[tauri::command]` shim can be invoked in a lib test (State construction problem), publish at the kernel bus instead and STAMP which layer was blocked.

### Phase 4.1: Live dual-terminal test
- [ ] Start a real `LanEventForwarder` on `127.0.0.1` with a PSK (dynamic port).
- [ ] Connect two peers speaking the real wire protocol: station-A peer (hello with `station_ids=["grill"]`) and Expo peer (empty `station_ids`).
- [ ] Publish the four `kds.*` transitions (real `KdsSyncEvent` values); assert station-A receives ONLY tickets whose `stations` include its id (or events with empty stations = broadcast), Expo receives ALL.
- [ ] Offline-buffer proof: station-A peer disconnects, one targeted + one broadcast event fire, peer reconnects — buffer replay respects the same filter.
- [ ] Reconnect snapshot proof: `{"op":"discover","want_queue":true}` response carries the `active_queue` built from the AppState queue cache; a legacy `{"op":"discover"}` response stays byte-identical.

### Phase 4.2: Close
- [ ] `cargo test -p oz-pos-app kds_lan_live` green; the existing `--lib registration` 10/10 and `--lib state` 13/13 stay green (no edits to their files).
- [ ] Stamp results (what was proven, which layer was reached, crate bugs found if any) into this doc and rename `todo-` → `done-` ONLY if all proofs landed.

## Verification
- `cargo test -p oz-pos-app kds_lan_live` from repo root (package is `oz-pos-app`, NOT desktop-app).
- Per-file `rustfmt --edition 2024` on the two touched files only; never `cargo fmt --all`.
- Commit form: pathspec one-liner; the new test file + the kds.rs mod-wiring line may share one commit (chain form for the new file).
