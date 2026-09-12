# Orchestrator Agent 1: Causality Clock & Delta Merge Contract

<!-- Audit stamp: 2026-09-13 · verified against HEAD `e046e2f26` (0.0.37).
Every claim below was read out of the files themselves. Supersedes the previous
revision of this document, which specified a PN-Counter for stock and listed
gift-card balances and loyalty points as additive fields. Both were wrong:
stock additive merge already exists and works end to end, and gift cards are
protected by invariants that additive merge would break. See "Baseline
findings" before writing any code. -->

**Document:** `todo-sync-conflict-agents-1.md`
**Role:** Orchestrator Agent 1 (Distributed State & CRDT Architect)
**Goal:** Give the sync engine a causality primitive (Lamport clock with a
deterministic terminal tie-break) and a typed, idempotent delta-merge contract
for stock movements — the two pieces that do **not** exist yet.

**Target Crate:** `platform/sync/` (package name `platform-sync`)
**Sibling Documents:**
- [`todo-sync-conflict-agents-2.md`](./todo-sync-conflict-agents-2.md) (Agent 2 — Cloud Conflict Detection)
- [`todo-sync-conflict-agents-3.md`](./todo-sync-conflict-agents-3.md) (Agent 3 — Resolution UI & Audit)

---

## Baseline findings (read these first — they change the scope)

1. **Stock CRDT merge already exists and is already applied.**
   `platform/sync/src/conflict.rs::resolve_stock_crdt` builds
   `{"local":…, "remote":…, "merge_type":"crdt_delta"}`, and
   `platform/sync/src/queue.rs` (lines ~454, 511, 615, 682) consumes that
   marker: for `stock.adjusted` it deserialises **both** halves and calls
   `apply_stock_adjustment_delta_in_tx` on each. The additive path is complete
   and tested (`conflict_tests.rs`, 899 lines, ~10 `stock_crdt_*` tests).
   **Do not build a second representation of stock.**

2. **Stock is already an op-based counter.** `stock_movements` is an
   append-only immutable delta ledger (ADR #6) and `stock_summary` is
   materialised from it. A state-based PN-counter needs per-replica `P`/`N`
   maps and a compaction story; adopting it alongside the ledger creates two
   competing sources of truth for the same quantity. The work here is to
   *describe* the existing delta path in types, not to replace it.

3. **Gift cards are out of scope — permanently, not for now.**
   `crates/oz-core/src/db/gift_cards.rs` redeems via an atomic conditional
   `UPDATE` with an `i64::MAX` overflow guard, and migration `20260901` added
   the partial unique index `uq_gift_card_redeem_sale` to make redemption
   idempotent under sync replay. Additive merge defeats both: two offline
   terminals redeeming the same card merge into a legitimate-looking double
   spend, and the balance can go negative with no invariant ever checked.
   Gift cards belong to Agent 2's *conflict* bucket.

4. **Loyalty points are out of scope.** `customers.loyalty_points` is a plain
   mutable column with no movement ledger. Making it a counter requires a new
   migration and a decision about negative balances. Not this work order.

5. **No clock exists anywhere.** `grep -rniE "lamport|vector_clock"` over
   `crates platform foundation apps modules` returns nothing. This is the
   genuinely new piece.

6. **The old verification command was a no-op.** `cargo test -p platform-sync
   crdt` filter-matches the pre-existing `stock_crdt_*` tests, so it passes
   with zero tests in any new module. Filter by module path instead (Phase
   1.4).

---

## Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `feat(sync-crdt): …`
2. **Owned Path Fence (exclusive to Agent 1):**
   - `platform/sync/src/crdt/` (NEW)
     - `lamport.rs` — clock + tie-break
     - `lamport_tests.rs`
     - `delta_mutation.rs` — typed delta merge contract
     - `delta_mutation_tests.rs`
   - `platform/sync/src/lib.rs` — **only** the `pub mod crdt;` line
   - `crates/oz-core/migrations/<date>_sync_clock.sql` (NEW)
3. **Forbidden Paths (owned by siblings):**
   - `apps/cloud-server/**` (Agent 2)
   - `ui/src/**`, `apps/desktop-client/**` (Agent 3)

### Shared seams — who owns the join

| Seam | Owner | Note |
|---|---|---|
| `pub mod crdt;` in `platform/sync/src/lib.rs` | Agent 1 | Unowned in the previous revision |
| Route registration in `apps/cloud-server/src/sync_api.rs` | Agent 2 | |
| IPC command `resolve_sync_conflict_scoped` | Agent 3 | Does not exist yet |

### Ordering dependency

Agent 2's detector consumes `LamportClock` ordering. Land Phase 1.1 and expose
the comparison API **before** Agent 2 starts Phase 2.1. Agent 1 does not need
to wait for anyone.

---

## Task Checklist

### Phase 1.0: Baseline Audit
- [ ] Read `platform/sync/src/conflict.rs` (227 lines) and
      `platform/sync/src/queue.rs` lines 440–470 — confirm findings 1 and 2
      above against the code, not against this document.
- [ ] Read `crates/oz-core/src/db/products_stock_adjust.rs` — understand the
      `stock_movements` ledger and the `rebuild_stock_summary` shortfall
      backfill (lines ~746–800) so the delta contract does not fight it.
- [ ] Record findings as an audit-stamp comment on each file touched, in the
      house style (`last audited … | status: … | findings: … | next: …`).

### Phase 1.1: Lamport Clock with Deterministic Tie-Break
- [ ] Add `LamportClock { counter: u64, terminal_id: String }`.
      - `tick()` — increment on local mutation.
      - `observe(other)` — `counter = max(counter, other.counter)`, then tick.
- [ ] Implement `Ord` as `(counter, terminal_id)`. **The tie-break is
      load-bearing, not cosmetic:** a bare Lamport counter only orders events
      consistently with causality; two concurrent events can carry the same
      counter, and without a total order each replica may resolve the tie
      differently and diverge. Terminal id comes from the existing
      `sync_terminals.terminal_id` column.
- [ ] Tests (`lamport_tests.rs`): monotonic tick; observe-then-exceed; equal
      counter resolves by terminal id; the tie-break is deterministic across
      argument order (`a.cmp(b) == b.cmp(a).reverse()`); serde round-trip.

### Phase 1.2: Clock Persistence
- [ ] Add `crates/oz-core/migrations/<date>_sync_clock.sql` following the
      single-row guard pattern already used by `sync_pull_state`
      (`id INTEGER PRIMARY KEY CHECK (id = 1)`), with `counter` as an
      integer column — never a float (hook gate 6 enforces fixed-point
      integers for exact-decimal columns).
- [ ] Regenerate the PG port: `python scripts/generate-pg-migration.py`.
      `crates/oz-core/migrations/20260813_init.pg.sql` is **generated — never
      hand-edit it**. The cloud server applies `PG_INIT` at startup
      (`apps/cloud-server/src/db.rs`, `apply_schema`).
- [ ] The pre-commit PG drift guard (gate 7) fires when a migration, the
      registry or the generator is staged. Do not bypass it — run the
      generator and stage its output in the same commit.
- [ ] Test: counter survives a simulated restart (reloaded from the store,
      not from a static).

### Phase 1.3: Typed Delta Merge Contract
- [ ] Add `DeltaMutation { movement_id, sku, quantity: i64, terminal_id,
      clock: LamportClock }`. **`quantity` is `i64`.** No `f32`/`f64`
      anywhere in this module (AGENTS.md: money and counts are integer minor
      units).
- [ ] Make merge **idempotent by `movement_id`**: replaying the same movement
      must not apply twice. The current blob merge has no such key, so a
      redelivered item double-applies.
- [ ] Expose `merge_deltas(local, remote) -> Vec<DeltaMutation>` for Agent 2,
      preserving the "both deltas apply" semantics that `queue.rs` already
      implements.
- [ ] Keep `resolve_stock_crdt` in `conflict.rs` working **unchanged** — it is
      consumed in four places. Do not alter the `crdt_delta` payload shape in
      this work order; migrating `queue.rs` off the blob is separate work.
- [ ] Tests (`delta_mutation_tests.rs`): two independent deltas both survive;
      a duplicate `movement_id` applies once; overflow guarded on summation
      (saturating or explicit error — pick one and document it); missing or
      unknown fields fail safe rather than silently dropping a delta.

### Phase 1.4: Verification
- [ ] `cargo fmt --all` (hook gate 1 re-stages automatically).
- [ ] `cargo test -p platform-sync crdt::lamport` — **must report at least 5
      tests.** A filter that can pass with zero tests is not a gate.
- [ ] `cargo test -p platform-sync crdt::delta_mutation` — **at least 4 tests.**
- [ ] `cargo test -p platform-sync` (full crate — the `stock_crdt_*` tests in
      `conflict_tests.rs` must stay green; they are the regression net for
      finding 1).
- [ ] `cargo clippy -p platform-sync -- -D warnings`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "feat(sync-crdt): add Lamport clock with terminal tie-break and typed idempotent stock delta merge"
  ```

---

## Non-goals (explicit)

- No PN-Counter, no per-replica `P`/`N` maps. The op-based ledger in
  `stock_movements` already provides counter semantics.
- No changes to gift card balances or loyalty points.
- No changes to `resolve_sale_lww` or `resolve_version_lww` dispatch.
- No new branches, no version bump (locked at `0.0.37`), no `git push`.
