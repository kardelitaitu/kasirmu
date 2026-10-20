<!- - Audit stamp: 2026-10-19 · docs-auditor · status: ACCURATE AFTER REPAIR (2 minor) · Re-audit of the 2026-10-11 pass, whose evidence is retained verbatim after the FIXED block below. · MINOR 1: §Architecture's tree listed only `queue.rs`, `pg_transport.rs`, `replication.rs`, `conflict.rs` while the closing sentence of the same block said `queue/` and `crdt/` are "the only subdirectories here" — the tree never showed either. Both added (`queue/appliers.rs` is real: `pub mod appliers;` at `platform/sync/src/queue.rs:45`); the flat-file claim itself was true and is unchanged. · MINOR 2: §Usage imports `kasirmu_core::{SyncConfig, db::Store}`; the path resolves only because `crates/kasirmu-core/src/lib.rs:370-377` re-exports `SyncConfig` from `sync_client`, and that is now named so the next reader does not have to trust the blanket form. · The 2026-10-11 claim that the crate's own doc example mis-paths the import STILL HOLDS (`platform/sync/src/lib.rs:18`, `# use platform_sync::{SyncEngine, SyncConfig};`) and remains a code-side item, not repaired here. · VERIFIED AND LEFT ALONE at HEAD: all nine cited source files exist; `SyncEngine` (`platform/sync/src/lib.rs:143`) and `run_sync_cycle` (:594) exist; `nudge()` at `daemon.rs:797` and `pg_daemon.rs:770`; `WAKEUP_DEBOUNCE` 1_500 ms (`daemon.rs:46`) and `PG_WAKEUP_DEBOUNCE` (`pg_daemon.rs`); `DEFAULT_PG_SYNC_INTERVAL` 60 s (`pg_daemon.rs:33`); the wiring (`apps/desktop-tauri/src/commands/pos.rs:324-325`, tablet `sync_wakeup` in `apps/mobile-tauri/src/lib.rs:652-658`); the crate name `platform-sync` and the `PG_SYNC_TEST_URL` harness (`tests/pg_integration.rs`, two `#[ignore]`d tests). · Prior evidence, verbatim: the 2026-08-29 stamp is retained as original evidence below. · Every anchor re-verified against the tree: all nine cited source files exist (`src/{queue,transport,replication,conflict,daemon,pg_daemon,pg_transport}.rs`, `tests/pg_integration.rs`); the §Usage snippet is correct that `SyncConfig` comes from `kasirmu_core` and is NOT re-exported by `platform_sync` (it is imported `use kasirmu_core::sync_client::SyncConfig;` at `platform/sync/src/lib.rs:59`, and `platform/sync/src/lib.rs:18`'s own crate doc example is the one place that still shows the wrong path — code-side, left for its author); `SyncEngine` (`lib.rs:143`) and `run_sync_cycle` exist; `nudge()` exists on both daemons (`daemon.rs:797`, `pg_daemon.rs:770`); the debounce is 1_500 ms on each (`WAKEUP_DEBOUNCE` daemon.rs:46, `PG_WAKEUP_DEBOUNCE` pg_daemon.rs:46); the intervals are 60–120 s randomized for HTTP (`daemon.rs:624`) and a flat 60 s for PG (`DEFAULT_PG_SYNC_INTERVAL` pg_daemon.rs:33); the wakeup arrives as a third `tokio::sync::Notify` `select!` arm (`daemon.rs:666`, `pg_daemon.rs:232`); and the wiring claim is exact — `apps/desktop-tauri/src/commands/pos.rs:324-325` calls both daemons' `nudge()` guarded by `if result.is_ok()` after `complete_sale_scoped`, while the tablet selects on an `Arc<Notify>` `sync_wakeup` field (`apps/mobile-tauri/src/lib.rs:661`). · The §Architecture tree remains illustrative (the real layout is flat `src/` files), as the prior stamp already records. · NOT re-measured: the live PostgreSQL retention/recovery contracts, which need the ignored `pg_integration` harness and a database. -->

<!-- STAMP MERGED INTO THIS ONE (2026-10-11) — superseded bodies kept verbatim:

  [Audit stamp: 2026-08-29 · docs-auditor · status: ACCURATE (1 finding repaired + 1 minor note) · F1: usage snippet used `platform_sync::SyncConfig` but SyncConfig is NOT re-exported from platform_sync — correct path is `kasirmu_core::SyncConfig` (re-exported at kasirmu_core/src/lib.rs:236) · note: the directory tree (queue/, transport/, replication/, conflict/) is illustrative — actual layout is flat src/ files queue.rs, transport.rs, replication.rs, conflict.rs (+ daemon.rs, pg_daemon.rs, pg_transport.rs) · crate is platform-sync (Cargo.toml name); SyncEngine (src/lib.rs:1518) and run_sync_cycle (lib.rs:1784) verified; offline-first + LWW conflict resolution matches implementation]
-->

# platform-sync

Offline-first sync engine for kasir.mu. Provides an offline queue, HTTP transport, push/pull replication, and last-write-wins conflict resolution.

When a retained pull anchor expires, both `SyncEngine` and the SQLite-backed
`SyncDaemon` fetch the authoritative snapshot, import it transactionally, and
reset the durable pull anchor to the server's `oldest_available` boundary.
This prevents a terminal from re-fetching the same snapshot on every daemon
cycle.

The PostgreSQL-backed `PgSyncDaemon` follows the same recovery contract: it
checks the remote retention watermark, fetches reference data directly from
the PostgreSQL tables when the durable anchor has expired, imports it through
the shared typed importer, and resets the anchor only after a successful
import. PostgreSQL deployments use a dedicated sync database rather than the
HTTP snapshot endpoint.

### Real PostgreSQL integration checks

The crate includes ignored integration tests for the PostgreSQL retention and
snapshot contracts. They use a disposable database and do not run as part of
the normal unit-test suite:

```text
docker run --name kasirmu-pg-sync-tdd --rm -d \
  -e POSTGRES_USER=ozsync -e POSTGRES_PASSWORD=ozsync \
  -e POSTGRES_DB=ozsync -p 127.0.0.1:15432:5432 postgres:16-alpine

PG_SYNC_TEST_URL=postgresql://ozsync:ozsync@127.0.0.1:15432/ozsync \
  cargo test -p platform-sync --test pg_integration -- --ignored --nocapture
```

The harness verifies real PostgreSQL `MIN(created_at)` anchor expiry,
boolean/timestamp decoding in snapshots, and that credential verifier
material is absent from the typed snapshot. The disposable container must be
removed by the caller after the run (`docker stop kasirmu-pg-sync-tdd`).

## Architecture

```
platform/sync/
├── queue.rs          — Local change log (wraps kasirmu-core offline_queue table); queue/ holds its helpers
│   └── appliers.rs   — Remote-item appliers (ApplyOutcome, ResolvedItem)
├── pg_transport.rs   — HTTP/PG client for communicating with the remote sync server
├── replication.rs    — Push + pull orchestration
├── conflict.rs       — Conflict resolution strategies (LWW initially); crdt/ holds the CRDT types
└── crdt/             — CRDT types (clock_store, delta_mutation, lamport, push_stamp, version_vector)
```

These are flat files, not directories: `transport/` never existed as a path (the transport
lives in `pg_transport.rs`), and `queue/` and `crdt/` are the only subdirectories here.

## Usage

```rust
use platform_sync::SyncEngine;
use kasirmu_core::{SyncConfig, db::Store};

let engine = SyncEngine::new(config);
let result = engine.run_sync_cycle(&store).await?;
```

`SyncConfig` is not re-exported by `platform_sync`; `kasirmu_core` re-exports it from
`sync_client` (`crates/kasirmu-core/src/lib.rs:370-377`).

## Event-Triggered Wakeup (SYNC-EW)

Both `SyncDaemon` and `PgSyncDaemon` expose a `nudge()` method that signals the
run loop to wake up immediately and run a sync tick, instead of waiting for the
next periodic interval (60–120 s for HTTP, 60 s for PG).

```rust
// From any Tauri command that has AppState:
state.sync_daemon.nudge();
state.pg_sync_daemon.nudge();
```

The run loop listens on a `tokio::sync::Notify` as a third `select!` arm. After
the notifier fires, the daemon sleeps a 1.5 s debounce window to coalesce rapid
bursts (e.g. barcode-scan batch) before running a single sync cycle.

**Offline resilience:** `nudge()` is fire-and-forget. If the daemon cannot reach
the server the item stays in `offline_queue` and the normal exponential backoff
handles retry — the wakeup path does not change failure handling.

**Wiring:** `apps/desktop-tauri/src/commands/pos.rs` calls `nudge()` after a
successful `complete_sale_scoped`. The tablet uses an `Arc<Notify>` field on
`AppState` (`sync_wakeup`) that the inline sync daemon in `apps/mobile-tauri/src/lib.rs`
selects on.

> last audited 19-10-26 by docs-auditor
