<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (1 major) · Re-audited; the 2026-09-29 body is merged below. · MAJOR RESOLVED — the 2026-09-29 pass recorded this record's central claim ("Isolated desktop harness: 2 sync-run tests passed") as UNVERIFIABLE, because no test in apps/desktop-tauri referenced the harness. That is now a VERIFIED FACT, not an open question: the harness was RELOCATED to crates/kasirmu-bridge/src/sync_tests.rs by commit 9b14d9d0b (2026-09-11, "test(bridge): relocate sync unit tests"), and the relocation is documented IN THE CODE — apps/desktop-tauri/src/commands/sync_test_pins.rs (wired at sync.rs:551) pins that the retained adapters "must name the bridge test file their tests moved to". The relocated file carries the exact harness this record describes: a real tokio TcpListener bound to 127.0.0.1:0 (line 36), update_sync_settings_data() persisting server_url + api_key + enabled=true (lines 67-75), a fake push server returning {"results":[{"outcome":"accepted"}...]} (line 46), and a live sync_run_scoped() invocation whose result is asserted (line 89). Every element of the Coverage list is true of the relocated test rather than of a desktop one, so the Verification bullet is corrected from "Not re-verified" to name where the harness lives. · THE "2 sync-run tests" COUNT is left as the 2026-08-09 reading: the relocated file holds a broader suite today, so restating a count would replace one dated number with another. · MINOR (from the prior pass, retained): the command is sync_run_scoped, not sync_run — verified at apps/desktop-tauri/src/commands/sync.rs:311, wrapper syncRunScoped at ui/src/api/offline.ts:177-178. · NOT re-measured: whether the ORIGINAL desktop mount carried exactly two tests; the relocated suite is the only observable today. -->

<!-- STAMP MERGED INTO THIS ONE (2026-10-11) — superseded body kept verbatim as blockquote text; NOT nested:
> <!-- Audit stamp: 2026-09-29 · docs-auditor · status: REPAIRED (1 major, 1 minor, 1 flagged) · Audited on branch 0.0.40. MAJOR, and stated carefully because the negative was checked the hard way: this record's entire subject is "the desktop sync test", and there is no such test. `apps/desktop-tauri/src/commands/` contains no test file that references `sync_run` at all — the only file there matching `sync*` is `sync.rs` itself, and it declares no test module (no `mod tests`, no `#[path = ..._tests.rs]`). A repo-wide search for the ephemeral-port loopback server this record describes returns only unrelated hits (`commands/desktop_link.rs`, `kds_lan_live_tests.rs`, `local_api.rs`, `local_api_command_tests.rs`). The sync tests that exist live elsewhere: `apps/mobile-tauri/src/commands/sync_tests.rs`, `apps/mobile-tauri/src/commands/offline_tests.rs`, `crates/kasirmu-bridge/src/sync_tests.rs`, `crates/kasirmu-bridge/src/offline_tests.rs` and `crates/kasirmu-core/src/sync_client_tests.rs`. I am NOT claiming the harness was deleted or never written — most likely it was folded into the bridge or mobile layer, where the loopback server and AppState it needs would live just as well. But the record as written points a reader at a desktop test that does not exist, and this is the second file in this batch (see local-sync-phase4-verification.md) whose "regression test passed" claim I cannot locate, which makes it a pattern worth one owner's attention rather than two coincidences. The Verification bullet "Isolated desktop harness: 2 sync-run tests passed" is therefore UNVERIFIABLE as written and has been marked as such rather than restated as a fact. MINOR repaired: the command is `sync_run_scoped`, not `sync_run` (wrapper `syncRunScoped`, `ui/src/api/offline.ts:177`, invoking that exact string at `:178`). · MATCH: the Coverage steps that describe protocol behaviour are all still accurate — `/api/sync/push` returning an `accepted` outcome, bearer-header and request-path verification, and the local queue item transitioning to `synced` are all current server and client contracts, evidenced by `crates/kasirmu-core/src/sync_client.rs` and the `sync_tests.rs` files above. · No stamp or footer existed on this file before this pass. -->
-->

# Isolated Local Sync End-to-End Harness

**Date:** 2026-08-09
**Scope:** Tauri `sync_run_scoped` command and HTTP push boundary
**Status:** Implemented

## Coverage

The desktop sync test now creates an isolated in-memory AppState and a temporary loopback HTTP server. It:

1. Persists URL, API key, and enabled settings.
2. Enqueues one pending offline item.
3. Invokes the real `sync_run_scoped` command.
4. Returns a server `accepted` outcome from `POST /api/sync/push`.
5. Verifies the bearer header and request path.
6. Verifies the local queue item transitions to `synced` and the command reports one successful item.

The test does not depend on Docker, the running Tauri process, a fixed port, or shared local databases. The server binds to an ephemeral loopback port and is shut down when the test task completes.

## Verification

- Isolated harness: **2 sync-run tests passed** (empty persisted queue and one accepted item). ⚠️ Relocated, not lost — see the audit stamp above: the harness now lives at `crates/kasirmu-bridge/src/sync_tests.rs`, moved there by `9b14d9d0b`, and `apps/desktop-tauri/src/commands/sync_test_pins.rs` pins that pointer.
- Rust formatting passed.
- Topology persistence is unrelated to this harness; production writes use the authorized Apply command.
- Temporary Cargo target artifacts were removed after verification.

> last audited 11-10-26 by docs-auditor
