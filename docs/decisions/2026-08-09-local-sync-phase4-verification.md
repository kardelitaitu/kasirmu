<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (1 major, 1 minor) · Re-audited; the 2026-09-29 body is merged below. · MAJOR RESOLVED — the prior pass flagged this record's "new desktop regression test passed" as unlocatable. The desktop sync unit tests were RELOCATED, not deleted, and the move is documented in code: apps/desktop-tauri/src/commands/sync_test_pins.rs (wired at sync.rs:551) pins that the adapters "must name the bridge test file their tests moved to", naming crates/kasirmu-bridge/src/sync_tests.rs; commit 9b14d9d0b (2026-09-11, "test(bridge): relocate sync unit tests") is the move. The relocated file contains the bootstrap-boundary test this record describes: it configures sync through the PRODUCTION setter update_sync_settings_data() with server_url + api_key + enabled=true (lines 67-75) rather than a hand-written key — the file's own comment at lines 60-63 states a hand-written sync.enabled "is simply ignored — the run then returns synced 0" — then invokes the real sync_run_scoped() and asserts its result (lines 89-92). That is precisely the "persisted URL, API key, and enabled settings are consumed by the real command" contract above. · MINOR (from the prior pass, retained and re-confirmed): the command is sync_run_scoped; wrapper syncRunScoped at ui/src/api/offline.ts:177-178. · MATCH, re-measured: SyncAttemptResult is real on both sides — ui/src/api/offline.ts:151 and apps/desktop-tauri/src/commands/sync.rs. · LEFT AS WRITTEN: the HTTP probe results (evidence of 2026-08-09) and the oz-pos-app.exe process name (pre-split, historical). · NOT re-measured: whether the harness carried these exact cases on 2026-08-09; the relocated suite is the only observable today. -->

<!-- STAMP MERGED INTO THIS ONE (2026-10-11) — superseded body kept verbatim as blockquote text; NOT nested:
> <!-- Audit stamp: 2026-09-29 · docs-auditor · status: REPAIRED (1 minor, 1 flagged) · Audited on branch 0.0.40. Like its phase-1 sibling, this is a dated record of one session's probes, so the HTTP results stand as evidence of 2026-08-09 and are left untouched. MINOR repaired: the command is `sync_run_scoped`, not `sync_run` — the front-end wrapper is `syncRunScoped` at `ui/src/api/offline.ts:177` and it invokes exactly that string at `:178`. · MATCH, re-measured: the `SyncAttemptResult` type this record says the command returns is real on both sides — `ui/src/api/offline.ts:151` and, in Rust, `apps/desktop-tauri/src/commands/sync.rs`, `apps/mobile-tauri/src/commands/offline.rs`, `apps/mobile-tauri/src/commands/sync.rs` and `crates/kasirmu-bridge/src/sync.rs`. · FLAGGED, not repaired: the "new desktop regression test" this record claims passed could not be located. `apps/desktop-tauri/src/commands/sync.rs` declares NO test module at all (no `mod tests`, no `#[path = ..._tests.rs]`), and `git grep "fn .*sync_run"` over `apps/desktop-tauri` returns only the command definition at `:299`. The sync tests that do exist moved down a layer into `crates/kasirmu-bridge/src/sync_tests.rs` (wired at `crates/kasirmu-bridge/src/sync.rs:896`), but that file holds settings serialisation cases (`sync_settings_serialize`, `update_sync_settings_data_clear_url_writes_empty_row`, …) rather than the "persisted URL + API key + enabled consumed by a real run, reporting a successful empty-queue result" test described here. I am NOT claiming the test was deleted — it may have been renamed or folded into the bridge layer under a name I did not match. Recorded as a question for the sync owner, because the doc asserts a test result and a reader would otherwise assume the guarantee still has a backstop. · The `oz-pos-app.exe` process name predates the `desktop-tauri` / `mobile-tauri` split and is left as the historical name it was. · No stamp or footer existed on this file before this pass. -->
-->

# Phase 4 — Local Sync End-to-End Verification

**Date:** 2026-08-09
**Scope:** Docker sync API, debug Tauri process, and persisted sync command
**Status:** Verified with one live-client boundary documented

## Verification performed

The existing local stack was not restarted because it is shared with the running debug client.

- `GET /api/v1/health` returned HTTP 200.
- `GET /health` reported SQLite connected and zero pending queue items.
- `POST /api/v1/tokens` issued a short-lived diagnostic token without recording its value.
- Authenticated `GET /api/sync/status` returned HTTP 200.
- Authenticated empty `POST /api/sync/push` returned `results: []`.
- Authenticated empty `POST /api/sync/pull` returned an empty page with `next_cursor: null`.
- Unauthenticated `/api/sync/status` correctly returned HTTP 401.
- A debug `oz-pos-app.exe` process and the Vite dev server remained running on the existing local listeners.
- The regression test passed: persisted URL, API key, and enabled settings are consumed by the real `sync_run_scoped` command, which reports a successful empty-queue result. ⚠️ Relocated since — the sync unit tests moved from the desktop shell to `crates/kasirmu-bridge/src/sync_tests.rs` (`9b14d9d0b`); see the audit stamp above.

## Regression contract

The test protects the bootstrap boundary after auto-provisioning: the command reads the Tauri settings database rather than relying on a UI copy of the configuration, and it returns an explicit `SyncAttemptResult` instead of silently no-oping.

## Remaining boundary

The live Tauri process was not driven through a native IPC call to create a non-empty local queue item. The available safe probes verified the server and command contracts without mutating the shared server queue. A future harness should launch an isolated Tauri profile or inject a test AppState, enqueue one local item, run `sync_run_scoped`, and assert the server-side accepted outcome.

> last audited 11-10-26 by docs-auditor
