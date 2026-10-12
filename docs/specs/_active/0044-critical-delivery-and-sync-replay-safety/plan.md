<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (0 major, 1 minor) · Fresh full audit; the 2026-09-29 stamp is merged at the bottom. · MINOR (a stale coordinate in a present-tense pointer): the plan's Phase-1 sentence named `apply_remote_atomic_full` as the daemon's call; the 2026-09-29 pass recorded the FUNCTION name correctly but the call-site line it named has drifted. Re-measured: the production call site is `platform/sync/src/daemon_tick.rs:850`, and the PostgreSQL daemon takes the same path at `platform/sync/src/pg_daemon.rs:944`. Both added inline. · VERIFIED AND LEFT ALONE (re-measured at source, not inherited): `apply_remote` is still a public fn (`platform/sync/src/queue.rs:576`), as are `apply_remote_atomic` (:210) and `apply_remote_atomic_full` (:233), so the plan's "the standalone remains available" claim holds against the real symbol set; the `sync_applied_items` receipt table exists in `crates/kasirmu-core/migrations/20260813_init.sql` (:831) and in the registry; the event-bus premise (handlers caught individually, loop continues) still matches `platform/kernel/src/event_bus.rs`. · NOT re-measured: the opening order claim ("checkout commands publish after their local sale transaction commits") — a claim about sequence, not existence, so it needs a flow trace rather than a symbol search — and the Phase-3 EventBus classification, which is DESIGN rather than an implemented claim. · Prior evidence retained verbatim below. -->

<!-- STAMP MERGED INTO THIS ONE (2026-10-11) — superseded body kept verbatim:
Audit stamp: 2026-09-29 · docs-auditor · status: ACCURATE (0 major, 1 minor — repaired here) · Audited on branch 0.0.40. Every anchor re-measured at the source line, not quoted. MATCH: the "event bus catches individual handler failures and continues" premise holds — `platform/kernel/src/event_bus.rs:254-282` invokes each handler inside `std::panic::catch_unwind`, logs a failed handler as "event handler failed (continuing)" and a panicking one as "event handler panicked (continuing)", and neither arm breaks the loop. MATCH: the `sync_applied_items` receipt table exists (`crates/kasirmu-core/migrations/20260813_init.sql`, registry `crates/kasirmu-core/src/migrations.rs`). MATCH: "the existing standalone `apply_remote` remains available" — it is still a public fn at `platform/sync/src/queue.rs:559`. Repaired 1 (minor): the doc named `apply_remote_atomic` as the daemon's call, but the production call site is `platform/sync/src/daemon_tick.rs:686` → `queue.apply_remote_atomic_full(store, item)`. Both names are real public fns (`platform/sync/src/queue.rs:196` and `:219`), so the reference never dangled; it was a stale name, and a plan that tells a reader which fn owns the transaction boundary has to name the right one. · NOT re-measured: the "checkout commands publish after their local sale transaction commits" half of the opening premise — that traces into the sale commit path and is a claim about ORDER, not existence, so it needs a flow trace rather than a symbol search. · Deliberately not renamed: the `oz-core` crate this spec's sibling validation.md still names no longer exists (see docs/specs/_active/0044-critical-delivery-and-sync-replay-safety/validation.md); plan.md itself names no crate, so it needs no edit on that axis.
-->


# Critical delivery and sync replay safety

## Decision boundary

The event bus currently catches individual handler failures and continues, while
checkout commands publish after their local sale transaction commits. Making
`publish()` fail for every handler would couple checkout correctness to audit,
reporting, loyalty, notifications, and UI bridges. This pilot therefore keeps
that API stable and hardens the separate sync replay boundary first.

## Phase 1 — atomic remote application

1. Begin one SQLite transaction for each remote item.
2. Check `sync_applied_items` inside that transaction.
3. Apply the supported remote mutation through transaction-aware helpers.
4. Insert the remote receipt in the same transaction.
5. Commit only after both mutation and receipt succeed.
6. Leave the pull anchor unchanged when an item fails.

The existing standalone `apply_remote` remains available for isolated callers and
compatibility tests. The daemon uses `apply_remote_atomic_full` so production replay
handling has one explicit transaction boundary. *(`platform/sync/src/daemon_tick.rs:850`; `pg_daemon.rs:944` takes the
same path for the PostgreSQL daemon.)*

## Phase 2 — tests and observability

- Verify a second application of the same remote item does not change stock.
- Verify a failed mutation does not leave a receipt.
- Verify a duplicate stock movement is blocked by its remote receipt.
- Record atomic-apply failures in daemon status and logs.
- Add metrics for applied, skipped, and failed remote items.

## Phase 3 — critical event policy design

Before changing EventBus behavior, classify handlers:

- **Critical/domain durability:** sale sync enqueue and audit persistence, with
  explicit policy on whether failure blocks checkout or creates an outbox retry.
- **Best effort:** reporting, UI bridge, LAN broadcast, telemetry, notifications.
- **Exactly once is not assumed:** every handler must be idempotent or consume a
  stable event/operation key.

The implementation should prefer a transactional outbox for post-commit critical
work rather than making the in-process bus globally fail-fast.

## Phase 4 — durable ordering and recovery

- Add per-aggregate sequence or causality keys for sale and stock events.
- Persist retry state and operator-visible failure reasons.
- Add crash/restart and concurrent-consumer tests.
- Reconcile desktop and tablet sync paths around the same application service.

> last audited 11-10-26 by docs-auditor
