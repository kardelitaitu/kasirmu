---
num: 10
area: sync
title: ADR #10: Sync Performance Strategy
status: Implemented (all 3 phases complete as of 2026-07-15)
---

<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (0 major, 4 minor) · Fresh full audit of this decision record; the 2026-09-29 stamp and the 2026-07-24 marker are merged below as original evidence. · Correction note added; body left as the decision. REPAIRED (minor, coordinate drift): the `SyncPriority` path `crates/oz-core/src/offline.rs` → `crates/kasirmu-core/src/offline.rs:12` (rebrand); migration `073_offline_queue_priority.sql` no longer exists as a file — the numbered series was consolidated, and the column survives as `offline_queue.priority INTEGER NOT NULL DEFAULT 1` in `crates/kasirmu-core/migrations/20260813_init.sql`; the addendum's `apps/tablet-client/…` paths → `apps/mobile-tauri/…` and `apps/desktop-client/…` → `apps/desktop-tauri/…`; `oz-cloud-server` labelled as the decision-time name. VERIFIED UNCHANGED AT SOURCE: `MAX_BATCH_BYTES = 64*1024` (`platform/sync/src/lib.rs:151`), `build_batches` (`:162`, consumed `:627`), gzip (`platform/sync/src/transport.rs:336`), `SyncError::AnchorExpired` (`lib.rs:96`, `transport.rs:500`, `daemon_tick.rs:474`), `/metrics` + `/health` (`apps/cloud-server/src/main.rs`), all three phase specs present, `WAKEUP_DEBOUNCE = 1_500ms` (`platform/sync/src/daemon.rs:46`) with `nudge()` at `:797` and the PG twin at `pg_daemon.rs:770`, `sync_wakeup` select arm (`apps/mobile-tauri/src/lib.rs:661`). NOT re-measured: the phase commit counts (12/7/12, "31 total") and the sizing/cost table — dated planning figures. · Body left as written: an ADR records what was decided, not where things ended up — the repairs above are dated correction notes and dead-path fixes in present-tense contexts only. -->

<!-- STAMP MERGED INTO THIS ONE (2026-10-11) — superseded bodies kept verbatim as original evidence:

Superseded audit marker (2026-07-24, body kept verbatim) · Hermes-Agent · status: ACCURATE (0 findings, claims verified) · MAX_BATCH_BYTES=64KB at platform/sync/src/lib.rs:751; gzip compressed (transport.rs:124 .gzip(true)); AnchorExpired variant present; build_batches present; SyncPriority enum (0=Critical,1=Normal,2=Low) in crates/oz-core/src/offline.rs; migration 073_offline_queue_priority.sql exists; /metrics + /health endpoints in apps/cloud-server/src/main.rs; all 3 phase spec files exist

Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · ACCURATE, with line drift only. The specific numbers this ADR fixes still hold: `MAX_BATCH_BYTES` is `64 * 1024` at `platform/sync/src/lib.rs:151` (the 2026-07-24 stamp cites `:751`, ordinary drift in a file that has grown) and is consumed where the stamp says at `:609` inside `build_batches`. The gzip compression on the transport path and the `AnchorExpired` anchor variant are both present in `platform/sync/src/daemon.rs`. All three phase spec files the stamp confirms still exist, so this is a decision with its implementation record intact rather than an orphan. · The ADR status checker reports no drift for this row, and the front matter "Implemented (all 3 phases complete as of 2026-07-15)" is consistent with the index. · Left as written, including the `crates/oz-core` reference for SyncPriority (now `crates/kasirmu-core/src/offline.rs`) and the numbered migration `073_offline_queue_priority.sql` belonging to the retired sequential series. This is a decision record; its paths are how the decision was written down. · The 2026-07-24 Hermes stamp is retained as original evidence, re-labelled rather than superseded, and the stacked status lines under the old footer are collapsed to a single machine-read line.

-->

# ADR #10: Sync Performance Strategy

> **CORRECTION NOTE (2026-10-11, docs-auditor) — the decision holds; two coordinates moved.**
>
> This record's substance verifies: `MAX_BATCH_BYTES = 64 * 1024` at `platform/sync/src/lib.rs:151`,
> consumed at `:627` inside `build_batches` (`:162`); gzip on the transport path
> (`platform/sync/src/transport.rs:336` — `.gzip(true)`); `SyncError::AnchorExpired` present
> (`platform/sync/src/lib.rs:96`, `transport.rs:500`, `daemon_tick.rs:474`); `SyncPriority` enum in
> the tree; `GET /metrics` + `GET /health` in `apps/cloud-server/src/main.rs`; all three phase spec
> files present under `docs/specs/_active/`.
>
> **Two coordinates the body cites are stale:**
> 1. **`crates/oz-core/src/offline.rs`** — the `SyncPriority` enum is now at
>    **`crates/kasirmu-core/src/offline.rs:12`** (the `oz-core` → `kasirmu-core` rebrand).
> 2. **migration `073_offline_queue_priority.sql`** — the numbered migration series was retired and
>    consolidated. **Zero** `0NN_*`/`1NN_*` files remain under `crates/kasirmu-core/migrations/`;
>    the column the migration added survives as `offline_queue.priority INTEGER NOT NULL DEFAULT 1`
>    in the consolidated `crates/kasirmu-core/migrations/20260813_init.sql`. The decision is
>    implemented; the *filename* it was implemented in is history.
>
> **The addendum's file list also predates a rename:** every `apps/tablet-client/…` path under
> *Affected files* is now **`apps/mobile-tauri/…`** (`state.rs`, `lib.rs`, `commands/pos.rs`), and
> `apps/desktop-client/src/commands/pos.rs` is now `apps/desktop-tauri/src/commands/pos.rs`. The
> mechanism itself is intact and verified: `WAKEUP_DEBOUNCE = 1_500ms` at `daemon.rs:46` with
> `SyncDaemon::nudge()` at `:797`, the PG twin (`PG_WAKEUP_DEBOUNCE`, `PgSyncDaemon::nudge()` at
> `pg_daemon.rs:770`), and `AppState::sync_wakeup` consumed as a `select!` arm at
> `apps/mobile-tauri/src/lib.rs:661`.
>
> **NOT re-measured:** the phase-by-phase commit counts (P-1 12 / P-2 7 / P-3 12, "31 commits total")
> and the sizing/cost table, which are dated planning figures rather than facts about the code.

**Status:** Implemented (all 3 phases complete as of 2026-07-15)
**Date:** 2026-07-13 (strategy), 2026-07-15 (implemented)
**Author:** Architecture Team & kasir.mu Contributors
**Tags:** sync, compression, batching, performance, network, low-bandwidth, hosting-cost, sqlite, retention

---

## Context

kasir.mu is designed to support low-end hardware (e.g., Android 9 tablets, Core2Duo PCs) operating in low-bandwidth, unstable, or offline environments.

Additionally, the project has a strict cost target: **the cloud sync server must cost no more than $2–$3 a month to host** (typically a tiny shared-core VPS with 512MB–1GB RAM and 1 shared vCPU), yet be capable of handling synchronization for thousands of active stores.

Currently:
- The client-side sync engine (`platform-sync`) retrieves all pending offline changes from the `offline_queue` SQLite table and sends them in a single massive HTTP request to the cloud sync server (now `apps/cloud-server`, written `oz-cloud-server` at decision time). If a terminal has been offline for a long period, this causes OOM crashes, high CPU spikes, and request timeouts.
- The sync payload is currently sent uncompressed, consuming significant cellular or satellite data.
- High-frequency active polling by thousands of stores would easily overwhelm a low-tier $2 VPS with connection overhead and concurrent database queries.

## Strategy

This ADR sets the overall direction. The implementation is split into 3 independent phases, each with its own spec, acceptance criteria, and ship timeline:

| Phase | Spec | Focus | Est. effort |
|-------|------|-------|-------------|
| **1** | `docs/specs/_active/p1-sync-batching-compression-retention.md` | Client-side batching (64 KB), Gzip compression, 90-day retention, `AnchorExpired` (410 Gone), cursor-based pruning | 2-3 weeks | ✅ **DONE** (2026-07-15) |
| **2** | `docs/specs/_active/p2-sync-priority-concurrency.md` | Sync priority tiers (`SyncPriority`), per-route-group concurrency limits, 2-thread Tokio runtime | 1-2 weeks | ✅ **DONE** (2026-07-15) |
| **3** | `docs/specs/_active/p3-sync-pagination-snapshot-observability.md` | Pull pagination, snapshot endpoint + cache + recovery, tiered heartbeat, Prometheus metrics, health endpoint, structured logging | 2-3 weeks | ✅ **DONE** (2026-07-15) |

### Implementation summary

- **P-1** (12 commits): 64 KB batch splitting (`build_batches`), gzip via `reqwest`, `MAX_BATCH_BYTES`, 90-day retention with cursor-based `DELETE LIMIT 1000`, `AnchorExpired` error type, prune loop in `oz-cloud-server`.
- **P-2** (7 commits): `SyncPriority` enum (`Critical=0, Normal=1, Low=2`) at `crates/kasirmu-core/src/offline.rs:12`, `priority` column (shipped as migration 073; consolidated into `20260813_init.sql`), `enqueue_offline_priority`, priority-sorted `build_batches`, `ConcurrencyLimitLayer` (API=10, sync=40), `worker_threads=2`.
- **P-3** (12 commits): Cursor-based pull pagination (`created_at|id`, LIMIT 501/500), `GET /api/sync/snapshot` with 5-min in-memory cache, `AnchorExpired` → snapshot recovery + `import_snapshot`, tiered heartbeat in status response, Prometheus `/metrics` (6 metrics), `GET /health`, structured logging per sync cycle.

**Total: 31 commits across all 3 phases.**

### Rationale for phasing

- **Phase 1** removes the immediate OOM risk and bandwidth cost. It is the highest-ROI change and can ship standalone.
- **Phase 2** improves fairness and resource isolation, but only matters under load that Phase 1 may already mitigate.
- **Phase 3** addresses edge cases (90-day offline terminals, large-scale observability) that are speculative until real usage data is available.

All phases are backward-compatible with existing clients. The server accepts both legacy (flat array) and batched (array-of-arrays) push formats. Clients can be upgraded independently.

## Sizing & Target Cost

| Workspace Count | Min SSD (90-day) | CPU | RAM | Monthly Cost |
|:---|:---|:---|:---|:---|
| 100 | 30 GB | 1 core | 1-2 GB | $2.50 – $4.00 |
| 500 | 100 GB | 1-2 cores | 2 GB | $6.00 – $10.00 |
| 2,000 | 375 GB | 2 cores | 4 GB | $15.00 – $25.00 |

Target: **100 tenants @ ≤$4/mo**. The $2-$3 VPS constraint applies only to the sub-500-tenant tier.

## Related

- ADR #4 — Store-First Tenancy & Workspace Tenancy
- ADR #6 — CRDT Delta Ledger & Offline Sync
- `docs/specs/_active/p1-sync-batching-compression-retention.md`
- `docs/specs/_active/p2-sync-priority-concurrency.md`
- `docs/specs/_active/p3-sync-pagination-snapshot-observability.md`

## Addendum: Event-Triggered Wakeup (SYNC-EW, 2026-09-17)

**Problem:** The periodic 60–120 s jitter is optimal for steady-state bandwidth cost, but means a completed sale can take up to 2 minutes to appear in the cloud portal. For the "cashier charges → manager sees it on dashboard immediately" UX, this is too slow.

**Solution (SYNC-EW):** After a cashier calls `complete_sale_scoped`, the Tauri command calls `SyncDaemon::nudge()` (and `PgSyncDaemon::nudge()`). The `nudge()` method fires a `tokio::sync::Notify` that the daemon's run loop listens on as a **third `select!` arm**:

```
select! {
    _ = sleep(60..=120 s)        =>  normal periodic tick
    _ = rx.changed()             =>  shutdown signal
    _ = wakeup.notified()        =>  SYNC-EW: event-triggered wakeup
}
```

A 1.5 s debounce inside the wakeup arm coalesces rapid bursts (e.g. barcode scan of 20 items) into a single HTTP round-trip. Offline resilience is unchanged: if the daemon cannot reach the server, the items stay in `offline_queue` and the existing exponential backoff handles retry — `nudge()` is fire-and-forget.

**Affected files** (app paths below are the decision-time names; `apps/desktop-client/` → `apps/desktop-tauri/` and `apps/tablet-client/` → `apps/mobile-tauri/` since the rebrand):
- `platform/sync/src/daemon.rs` — `SyncDaemon::nudge()` (:797), `WAKEUP_DEBOUNCE` (:46), third `select!` arm ✅ path current
- `platform/sync/src/pg_daemon.rs` — same for `PgSyncDaemon` (`nudge()` :770, `PG_WAKEUP_DEBOUNCE` :46) ✅ path current
- ~~`apps/desktop-client/src/commands/pos.rs`~~ → `apps/desktop-tauri/src/commands/pos.rs`
- ~~`apps/tablet-client/src/state.rs`~~ → `apps/mobile-tauri/src/state.rs` — `AppState::sync_wakeup: Arc<Notify>`
- ~~`apps/tablet-client/src/lib.rs`~~ → `apps/mobile-tauri/src/lib.rs` — inline sync daemon `select!` with wakeup arm (:661)
- ~~`apps/tablet-client/src/commands/pos.rs`~~ → `apps/mobile-tauri/src/commands/pos.rs` — `complete_sale_scoped` calls `state.sync_wakeup.notify_one()`

**Expected latency after this change:** 1.5 s debounce + HTTP round-trip (~0.5–2 s) ≈ **2–4 s** to cloud portal visibility, down from up to 120 s.

> last audited 11-10-26 by docs-auditor
