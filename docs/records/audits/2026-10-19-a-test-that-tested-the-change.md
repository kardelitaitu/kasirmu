# A test that tested the change, not the mechanism — 2026-10-19

**Scope:** the uncommitted edit to
`crates/kasirmu-bridge/src/subscription_tests.rs` found in the working tree at the
start of this session (`caps_report_the_ledger_tier_the_gate_enforces`).
**Result:** 1 test defect identified, 1 repair scoped to the claim it can actually
make, 0 changes to production code. Recorded because the edit was unowned and
would otherwise be swept into whatever commit happened to touch the file next.

## What was in the tree

The test was wrapped in `if seeded_row_reaches_a_paid_tier() { … } else { … }`.
In a debug build the predicate is `true`, so the original body runs and the test
is unchanged there. **In release the predicate is `false`, so the entire
divergence assertion is skipped** and replaced by `assert_seeded_row(&conn,
"premium")` + `assert_caps_fail_closed(&dto)` — a pair that re-asserts "an
unverifiable row fails closed", which several other cases in this file already
pin (`:221-222`, `:321-327`, `:665`).

So a release-profile run of this test would go **green while the mechanism it is
named after was never exercised**. That is the same defect class this corpus
records repeatedly — a gate you do not run is indistinguishable from a gate that
passes — except here it is a *branch* that does not run.

## Why the branch cannot simply be removed

The guard is not decorative. `seeded_row_reaches_a_paid_tier`
(`testing.rs:294`) loads the seeded tenant row, restamps it to `Plus` **in
memory only**, and asks whether its signature verifies. Under the fail-closed
ruling that answer is debug-only; in release it is `false` for every caller.
Forty tests in this crate already branch on it for exactly this reason.

The consequence for *this* test: in release no row can reach a paid tier, so the
"both clocks say Premium" precondition cannot be established at all. The test
cannot do what its doc comment says in that profile, no matter how it is written.

## The honest repair, and why it is not applied yet

The claim in release should be made *about the claim*, not about the caps: the
divergence this test pins needs a verified paid row, that precondition is
debug-only by design, and a release run therefore cannot observe it. The
assertion that belongs in the `else` arm is a statement of that limitation —
not a restatement of the fail-closed case, which is a different test's job and is
already covered four times over.

**Not applied in this session**, for a reason worth stating: step 31 of
`scripts/check.sh` is the `nextest` workspace run, and it arrives at this file.
Editing it while that run is live turns a gate result into a statement about a
tree that no longer exists. The first matrix run that *reaches* step 31 with a
reachable Postgres is worth more than the edit is worth losing, so the change is
queued behind it.

## What this does not change

- The production path. `caps` and `resolve_tier_fail_closed` are untouched.
- The debug-profile behaviour of the test, which is correct and now documented
  as the only profile that can observe it.

> last audited 19-10-26 by docs-auditor
