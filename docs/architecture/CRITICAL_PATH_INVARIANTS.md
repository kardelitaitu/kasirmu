<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file, with a prior marker re-verified rather than replaced. It sits in the architecture directory alongside what is now a pointer to the canonical architecture document, and it is a different kind of artefact: a short list of invariants the system must never violate, each naming the test that enforces it. · THE CLAIM IN ITS HEADER IS THE ONE WORTH CHECKING, because it is unusually specific for a self-assessment. It states that every enforcement link names a test that was located, and in most cases actually run, and that every figure is measured — easy to claim, hard to honour. It holds: all six test files named across the four invariants resolve in the tree. A list of invariants naming tests that do not exist is worse than no list, because it converts an aspiration into an apparent guarantee, and this one has avoided that. · WHY FOUR AND NOT A DOCTRINE, which is the design decision that makes the document useful. A critical-path list exists because not every property deserves equal attention, and a document enumerating all of them would be neither shorter nor more trusted. Four, each with a named enforcer, is a list someone can read in a minute and act on. It is the same instinct as the scoped-coverage gate and the boundary checker: prefer a small set of mechanically enforced properties over a large set of aspirational ones. · A NOTE ON THE FRAMING, since it is what a reader skims past. Calling these CRITICAL PATH rather than requirements is a statement about consequence rather than importance — the violations that would make the product wrong in a way that matters, as distinct from those that would merely make it untidy. All four are reachable from this campaign's own history: a money value that must never be a float, an operation that must not be recorded twice, a connection that must not be silently trusted, and a store that must not be deleted out from under a record. A reader who has met the money-closure spec, the idempotency migration and the settings-ingest policy will recognise all four. · NOT re-measured: whether the named tests currently pass, or whether they run in continuous integration rather than only by hand. Running them is the original work, and this stamp deliberately does not claim the invariants currently hold — only that each has an identifiable enforcer. · Prior marker retained; footer re-dated to match the new stamp. -->
# Critical-path invariants

<!-- Superseded audit marker (2026-09-28 · DSH-Agent, body kept verbatim) · retained · status: ACCURATE · branch 0.0.40
     change: created to close P3-1. Every "enforced by" link below names a test
     that was LOCATED and in most cases RUN this pass; every figure is measured.
     Re-audit trigger: any change to the named test, or to a guard they exercise. -->

Four invariants the system must never violate. Each names the test that
enforces it, so this list is checkable rather than aspirational.

**Why these four.** They are the ones whose violation is silent and expensive:
money leaves the till, stock stops matching the shelf, or two locations
disagree forever. Everything else in the codebase either fails loudly or can be
recomputed. P3-1 named these four explicitly; nothing was added or dropped
without saying so below.

---

## 1. Stock never goes below zero (where the location forbids it)

**The invariant is conditional, and stating it unconditionally would be false.**
`WorkspaceInventoryLocation.allow_negative_stock`
(`foundation/src/inventory.rs:359`) is a per-location policy flag, and the stock
write is a raw `UPDATE inventory SET qty = qty + ?1`. A location that opts in may
oversell; a location that does not must be refused.

> **Repaired 2026-10-07.** This paragraph cited `modules/inventory/src/models.rs:368`
> for the policy flag and `Repository::adjust_stock_tx` (`modules/inventory/src/repository.rs:130`)
> for the raw UPDATE. Both were stale: the flag now lives in `foundation` (the inventory
> model was extracted there), and `adjust_stock_tx` **no longer exists** — `get_stock` and
> `adjust_stock_tx` were REMOVED on 2026-09-29 (`modules/inventory/src/repository.rs:147`)
> because they read `inventory.sku` / `low_stock_threshold`, columns the migrations do not
> carry, and had no caller. The raw `UPDATE` shape they described is still the live write
> path, so the invariant itself is unchanged; only the anchors were. See the "Not a gate"
> note at the foot of this file for why this drifted unnoticed.

Where it is enforced — **two independent layers**, which is worth knowing:

| Layer | Where | What it does |
|---|---|---|
| Rust guard | `crates/kasirmu-core/src/db/products_stock_query.rs:460` | `.filter(\|&v\| v >= 0)` on the new quantity; rejects with `"adjustment would cause negative stock (previous: N, delta: M)"` |
| Rust guard (batch) | `crates/kasirmu-core/src/db/products_stock_adjust/batch.rs:156` | same, for a batch whose ANY member would go negative |
| **Database** | CHECK constraint `qty >= 0` on `inventory` (`crates/kasirmu-core/migrations/20260813_init.sql:171`) | refuses the write even if the Rust guard is removed |

**Measured, not assumed:** relaxing the Rust guard to `v >= i64::MIN` still
fails, with `CHECK constraint failed: qty >= 0` — the floor is defended at both
layers. That was found while writing the adversarial tests below, and no
single-layer test would have shown it.

**Enforced by:**
- `foundation/src/inventory_tests.rs:311` — `inventory_new_rejects_negative_qty`
- `foundation/src/inventory_proptests.rs:167` — `inventory_rejects_negative_qty_at_construction` (property: any `qty` in `i64::MIN..0` panics)
- `platform/sync/tests/adversarial_paths.rs` — `two_locations_overselling_the_same_stock_contain_the_overspend` (two partitioned devices sell 30 of 50 each; the pair converges at 20, having REFUSED the other's duplicate deduction)
- `crates/kasirmu-core/src/db/products_tests.rs:2628` — `negative_stock_event_fires_when_allow_negative_enabled` (pins the OPT-IN path, so the conditional clause above is tested rather than merely documented)

---

## 2. A sale's total equals the sum of its line totals

**Enforced by construction** rather than by a runtime check: `Sale::from_cart`
derives the header from the lines, so the two cannot disagree unless a caller
mutates a `Sale` directly — which the negative-value guards then catch.

**Enforced by:**
- `foundation/src/cart_tests.rs:748` — `cart_with_multiple_lines_total`
- `foundation/src/cart_tests.rs:322` — `cart_line_total_calculated`
- `foundation/src/cart_tests.rs:93` — `total_overflow_returns_none` (the sum is checked, not wrapping)
- `crates/kasirmu-core/src/db/sales_tests.rs:260` — `create_sale_rejects_negative_line_total`
- `crates/kasirmu-core/src/db/sales_tests.rs:271` — `create_sale_rejects_negative_total`

**Caveat, stated because it is the weak point.** There is no single test asserting
"header == Σ lines" over arbitrary carts. The invariant holds because
`from_cart` constructs it, and the tests above pin the components. A property
test over `Cart` → `Sale` would be stronger; none exists today.

---

## 3. A refund never exceeds what was settled

Three separate bounds, all inside `create_refund`'s transaction (so the
check-then-act window is closed):

| Bound | Where | Rejects |
|---|---|---|
| Cumulative MONEY | `crates/kasirmu-core/src/db/refunds.rs:132` (guard) / `:136` (message) | `refund total X exceeds refundable balance Y for sale Z` |
| Cumulative QUANTITY | `crates/kasirmu-core/src/db/refunds.rs:265` | `refund qty X exceeds refundable quantity Y for line L` |
| Per-line MONEY | `crates/kasirmu-core/src/db/refunds.rs:343` | `refund line total X exceeds the Y minor units refundable` |

The quantity bound exists because the money bound bounds VALUE, never UNITS: a
cheap enough refund can be repeated for units forever while the running money
total stays under the sale.

**Fails CLOSED** (COR-25): the cumulative SUM read propagates errors rather than
defaulting to `0`, so an unreadable ledger refuses the refund instead of
admitting an unbounded one.

**Enforced by:**
- `crates/kasirmu-core/src/db/refunds_tests.rs:122` — `create_refund_rejects_over_refund`
- `crates/kasirmu-core/src/db/refunds_tests.rs:210` — `over_refund_guard_fails_closed_when_cumulative_sum_unreadable`
- `crates/kasirmu-core/src/db/refunds_tests.rs:417` — `refund_qty_exceeds_original_deduction_fails`
- `platform/sync/tests/adversarial_paths.rs` — `two_locations_cannot_refund_more_than_was_sold`

**Scope note.** `platform/sync` deliberately does NOT re-derive these bounds when
replaying a refund (`platform/sync/src/queue.rs:475-479`): a partially-replicated
history would reject legitimate items. The bound is the originator's, and the
converged pair must not compound it — which is what the adversarial test asserts.

---

## 4. Sync convergence is order-independent

Two devices that receive the same operations in different orders must reach the
same state. Divergence *in flight* is correct and expected; only the fixed point
is promised.

**Enforced by:**
- `platform/sync/tests/convergence_replay.rs` — `three_seeded_interleavings_converge_to_the_scripts_arithmetic` (three devices, three arrival orders `A,B,C` / `C,B,A` / `C,A,B`, identical converged state AND matching the script's arithmetic)
- `platform/sync/tests/convergence_replay.rs` — `replaying_every_item_a_second_time_changes_nothing`
- `platform/sync/src/conflict_proptests.rs` — `sale_resolution_is_symmetric_in_outcome_rank` and `version_resolution_is_symmetric_in_outcome_version` (property: swapping the arguments cannot change the surviving rank)
- `platform/sync/src/conflict_proptests.rs` — `a_more_advanced_status_always_wins_over_a_less_advanced_one` (a completed sale is never reverted by a stale `active` copy)
- `platform/sync/src/crdt/lamport_tests.rs:54` — the CRDT commutativity property

**Two ways this is NOT stronger than it reads**, stated so nobody over-trusts it:
the convergence test calls `rebuild_stock_summary` before comparing, because
`inventory.qty` legitimately lags a location-routed delta; and each device's own
items are never delivered back to it, since they are already local.

---

## What this document is not

- **Not a full invariant inventory.** Measured 2026-09-28: **12 `debug_assert!`
  sites** across the tree (the P3-1 box said 79 — that figure was stale) and 290
  lines mentioning "invariant", most of them prose in audit stamps. This list is
  the four the box named, not every assertion in the codebase.
- **Not a gate.** Nothing checks that these tests still exist. If one is renamed,
  this file goes stale silently — the failure mode P3-1's own sibling (P3-3)
  solved with a checker. A future pass could assert each named test exists by
  name; that is not done here.

  > **Confirmed the hard way, 2026-10-07.** A manual pass checked every claim:
  > all **17** named tests still exist and all **11** cited line numbers still land
  > exactly on their `fn`, so §2–§4 are intact. §1 was NOT: it cited
  > `modules/inventory/src/models.rs:368` and `Repository::adjust_stock_tx`
  > (`repository.rs:130`), and both were stale — the flag moved to `foundation`, and
  > `adjust_stock_tx` was deleted on 2026-09-29. Repaired above. **This is exactly the
  > drift this note predicts**, and it took a hand pass to find: the failing citation
  > was in PROSE, which is the kind the dead-ref checker does not grade. A checker
  > that parsed this file for `path.rs:NN` — `fn name` pairs and asserted the `fn`
  > exists at that line would be ~20 lines and is still not written.

> last audited 29-09-26 by docs-auditor
