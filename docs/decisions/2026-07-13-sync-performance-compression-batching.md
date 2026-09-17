---
num: 10
area: sync
title: ADR #10: Sync Performance Strategy
status: Implemented (all 3 phases complete as of 2026-07-15)
---
<!-- Audit stamp: 2026-07-24 · Hermes-Agent · status: ACCURATE (0 findings, claims verified) · MAX_BATCH_BYTES=64KB at platform/sync/src/lib.rs:751; gzip compressed (transport.rs:124 .gzip(true)); AnchorExpired variant present; build_batches present; SyncPriority enum (0=Critical,1=Normal,2=Low) in crates/oz-core/src/offline.rs; migration 073_offline_queue_priority.sql exists; /metrics + /health endpoints in apps/cloud-server/src/main.rs; all 3 phase spec files exist -->

# ADR #10: Sync Performance Strategy

**Status:** Implemented (all 3 phases complete as of 2026-07-15)
**Date:** 2026-07-13 (strategy), 2026-07-15 (implemented)
**Author:** Architecture Team & kasir.mu Contributors
**Tags:** sync, compression, batching, performance, network, low-bandwidth, hosting-cost, sqlite, retention

---

## Context

kasir.mu is designed to support low-end hardware (e.g., Android 9 tablets, Core2Duo PCs) operating in low-bandwidth, unstable, or offline environments.

Additionally, the project has a strict cost target: **the cloud sync server must cost no more than $2–$3 a month to host** (typically a tiny shared-core VPS with 512MB–1GB RAM and 1 shared vCPU), yet be capable of handling synchronization for thousands of active stores.

Currently:
- The client-side sync engine (`platform-sync`) retrieves all pending offline changes from the `offline_queue` SQLite table and sends them in a single massive HTTP request to the cloud sync server (`oz-cloud-server`). If a terminal has been offline for a long period, this causes OOM crashes, high CPU spikes, and request timeouts.
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
- **P-2** (7 commits): `SyncPriority` enum (`Critical=0, Normal=1, Low=2`), `priority` column (migration 073), `enqueue_offline_priority`, priority-sorted `build_batches`, `ConcurrencyLimitLayer` (API=10, sync=40), `worker_threads=2`.
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

**Affected files:**
- `platform/sync/src/daemon.rs` — `SyncDaemon::nudge()`, `WAKEUP_DEBOUNCE`, third `select!` arm
- `platform/sync/src/pg_daemon.rs` — same for `PgSyncDaemon`
- `apps/desktop-client/src/commands/pos.rs` — both `complete_sale_scoped` variants call nudge on Ok
- `apps/tablet-client/src/state.rs` — `AppState::sync_wakeup: Arc<Notify>`
- `apps/tablet-client/src/lib.rs` — inline sync daemon converted to `select!` with wakeup arm
- `apps/tablet-client/src/commands/pos.rs` — `complete_sale_scoped` calls `state.sync_wakeup.notify_one()`

**Expected latency after this change:** 1.5 s debounce + HTTP round-trip (~0.5–2 s) ≈ **2–4 s** to cloud portal visibility, down from up to 120 s.

> last audited 09-08-26 by buffy
> audit: Phase 1 Core Architecture & API Docs Audit; Phase 4 ADR Deep Audit
> status: ACCURATE (0 findings) · verified accurate: cargo check passed, no structural orphans, no stale version headers
> status: ACCURATE (verified against actual codebase)
