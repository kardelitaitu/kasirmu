# kasirmu-core exceeded its size ceiling, from another lane's committed work

**Date:** 2026-10-24 · **Severity:** low (a ratchet, not a defect) · **Status:** open — needs the
owning lane to raise the ceiling deliberately, or to extract

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

## Provenance

- Gate: `scripts/verify-core-size.py` against `scripts/core-size-baseline.json` (ceiling 40597,
  178 measured files).
- Found 2026-10-24 while running all 51 checkers wired into both `check.sh` and a live workflow.
- Prior state: the previous raise was 40417 → 40597 on 2026-10-23, attributed to three named
  contributors in the baseline's own description.
