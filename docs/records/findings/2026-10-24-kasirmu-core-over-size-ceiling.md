# kasirmu-core exceeded its size ceiling, from another lane's committed work

**Date:** 2026-10-24 · **Severity:** low (a ratchet, not a defect) · **Status:** RESOLVED —
ceiling raised 40597 → 40616 with full attribution, in the same round the finding was filed

## What was measured

`python scripts/verify-core-size.py` at HEAD (verified against a clean `git worktree add` of
HEAD, not the working tree):

```
verify-core-size: measured 40616 vs ceiling 40597 (+19 lines)
verify-core-size: FAIL: kasirmu-core grew by 19 production line(s) above the 40597-line ceiling.
```

## Attribution, because the baseline file asks for it

`git log -- crates/kasirmu-core/src` names the source: **`7116e47c1`** (2026-10-24,
*"feat(payment): wire ADR-64 tender lifecycle state machine into checkout"*). Its diff is
+24 production lines in `payment.rs` and +58 in `payment_tests.rs` (tests are excluded from the
measure), plus two 3-line edits in `db/sales_checkout.rs` and `db/sales_lifecycle.rs`.

So the ceiling raise is that lane's to make, in a commit that says why — which is exactly the
contract `scripts/core-size-baseline.json` states in its own description:

> *"the intended use is to move it deliberately as part of a change that also says why"*, and
> *"a ceiling that is only ever moved after the fact is a changelog rather than a ratchet"*.

**That description also records that this gate has been RED before without being noticed** — the
2026-10-19 entry says a doc pass found it while quoting the *previous* ceiling. This round's red
was found by running every checker wired into a live runner, which is the point of that list.

## Why it is not fixed here

Raising the ceiling is a deliberate edit that must carry the reasoning, and the reasoning belongs
to whoever wrote the +24 lines. A ratchet moved by an unrelated lane to make a tree green is the
failure mode the baseline file explicitly warns about. Extraction is the other option — and the
2026-10-23 entry records that extraction was tried and did not help, because the measure counts
production lines across the whole crate, so moving code between files does not lower the total.

## Resolution, and two corrections to the analysis above

**Resolved 2026-10-24** by raising the ceiling to 40616 with the attribution written into
`scripts/core-size-baseline.json`'s own description. The gate is green (delta 0) and its
`--self-test` still passes 18/18.

The delta was attributed **by re-measuring, not by reading diffs**: running this checker's own
masker over the tree at `7be89ae53` (the revision that set 40597) returns **exactly 40597**, so
the baseline was not stale and the entire +19 is post-baseline work. Per file, net across 9:

| file | delta | note |
|---|---|---|
| `payment.rs` | **+19** (24 → 43) | `PaymentSplitArg::effective_gateway_status`, the ADR-64 method |
| `location_resolver.rs` | +3 | incidental |
| `sales_checkout.rs`, `sales_lifecycle.rs`, `rate_limiter.rs`, `sync_client/types.rs` | +1 each | incidental |
| `db/roles.rs` | **−5** | clippy/refactor cleanup |
| `license_verification/crl.rs`, `migrations.rs` | −1 each | refactor cleanup |

### Correction 1 — the "1151 production lines" was a RAW count, not the gate's measure

The table above this section was produced by counting lines with `Measure-Object`, which counts
blanks and comments. The gate masks comments, strings and blank lines before counting. The two
numbers for the same file:

| file | raw lines | **masked production lines** |
|---|---|---|
| `db/popularity.rs` | 1151 | **834** |
| `db/audit.rs` | 1118 | **743** |

**No file in `kasirmu-core` is over 1000 masked lines.** The strongest file is `popularity.rs` at
834. So the house's 1000-line rule — the reason this section nominated `popularity.rs` — is not in
play at all, and the nomination was an artefact of the wrong counter. A finding built on the wrong
measure points the next reader at a refactor nobody needs.

### Correction 2 — extraction cannot fix this gate, in either direction

The 2026-10-23 entry already records that extraction did not lower the total; what it does not say
is that **the converse also holds**: splitting a file does not raise it either. The ceiling counts
production lines across the whole of `crates/kasirmu-core/src`, so `popularity.rs` could be split
into a submodule tomorrow and the number would not move by one line. The only lever that lowers it
is moving code OUT of the crate.

That makes "extract or raise" a false choice here. The honest reading of +19 from one cohesive
domain method plus eight files of incidental churn is **raise**, which is the same judgement the two
previous raises in the baseline's own history reached on larger deltas.

## Extraction candidates, measured properly (2026-10-24, round 111)

The ceiling is now 40616 with **zero headroom**, so the next production commit to the crate turns
`core-size-ratchet` red. That makes "is there anything to extract?" a live question rather than a
tidiness one. Measured with the checker's own masker, and the answer is **no, not without an owner
decision**:

| file | masked lines | `impl Store` blocks | free `pub fn` | verdict |
|---|---|---|---|---|
| `db/popularity.rs` | 834 | 1 | 1 | SQL on `Store` — cannot leave the crate |
| `db/audit.rs` | 743 | 1 | 2 | same |
| `db/products_crud.rs` | 721 | 1 | 0 | same |
| `topology.rs` | 669 | **0** | **11** | **the one real candidate** |
| `db/inventory.rs` | 637 | 1 | 0 | SQL on `Store` |
| `db/loyalty.rs` | 633 | 2 | 1 | SQL on `Store` |
| `db/stock_transfers.rs` | 629 | 1 | 0 | SQL on `Store` |
| `export/mod.rs` | 620 | 2 | 1 | built on `crate::db::Store` + `db::reports` |

**The `db/` files are structurally unmovable.** Each is essentially one `impl Store<'_>` block —
inherent methods on the crate's own database handle. Moving them means moving `Store` itself, which
is the crate. This is the same conclusion the baseline's own history reached twice before, now
measured per file rather than asserted.

**`topology.rs` is the genuine candidate, and it is real but blocked.** Its own module doc says it
is *"Tauri-free and value-level, so any client (desktop Apply, tablet preview, tooling) can run the
same gates"* — 11 free `pub fn`s, zero `impl Store`, and exactly three crate dependencies
(`workspace_type`, `CoreError`, and `include_str!` of a vendored JSON contract). All ten consumers
import it as `kasirmu_core::topology::…`, so a move plus a `pub use` re-export would leave every
call site unchanged.

**What blocks it is structural, not technical:** there is no existing crate it belongs in
(`kasirmu-core`, `-api`, `-bridge`, `-cli`, `-crypto`, `-hal`, `-lan`, `-local-api`, `-logging`,
`-lua`, `-media`, `-notification`, `-payment`, `-plugin`, `-reporting`, `-security`, `-test-support`,
`qris-core` — none is a topology-contract home), so extracting it means **creating a new workspace
crate**: a new `Cargo.toml`, new workspace membership, new dependency edges in `kasirmu-api` and
`kasirmu-bridge`, and a doc's worth of justification. That is an architecture decision, and a
half-finished version would be worse than the overrun.

**So the recommendation stands and is now evidence-backed:** re-emit the ceiling as part of whatever
change grows core (which is what the baseline's description asks for, and what has been done
correctly on each of the last three raises) — and if the crate is to shrink for real, the move is
`topology.rs` into a new crate, which needs an owner's ruling first.
## Provenance

- Gate: `scripts/verify-core-size.py` against `scripts/core-size-baseline.json` (ceiling now
  40616; the 178-file figure was the baseline's own count at raise time, the tree holds 181).
- Found 2026-10-24 while running all 51 checkers wired into both `check.sh` and a live workflow.
- Prior state: the previous raise was 40417 → 40597 on 2026-10-23, attributed to three named
  contributors in the baseline's own description.
- **Method note for the next reader:** per-file masked counts come from the checker's own
  `count_lines()`, imported and run over `git show <rev>:<path>` blobs. A raw line count
  disagrees with this gate by 38% on `popularity.rs`, and that disagreement is what produced
  Correction 1.
