# How to tell whether a gate can actually fail

**The only method that works here: construct the failure mode and run it.** Grepping for a
`--self-test` string, or asking an agent to audit, has produced wrong answers every time it
was tried (rounds 50-51: three of three audit findings were false; round 54: three of four
string-derived candidates were already guarded).

## The four shapes a guard can take

A checker without `--self-test` is not therefore unproven. This tree uses at least four
mechanisms, and only the first is detectable by grepping for a flag:

| Shape | Example | How to recognise it |
|---|---|---|
| `--self-test` flag | `verify-shell-syntax.py --self-test` | the literal string, wired as a `step` |
| A companion test | `check-replay-fork.py` + `scripts/test-replay-fork.py` (`check.sh:561`) | a `test-<name>.py|sh` beside it |
| A proof the checker RUNS first | `check-query-plans.py --check` runs the Rust test `forcing_a_scan_fails_the_probe` before grading | grep the checker for a subprocess call |
| An inline liveness guard | `check-scratch-leaks.py::detector_still_sees_a_call()` | grep for `exit 2` / `refus` / `drifted` |

## The method

1. **Run the checker.** Note its exit code on the real tree. A green tells you nothing yet.
2. **Break one thing it claims to detect, and re-run.** If it still exits 0, you have found a
   real gap. If it exits non-zero, the detector is alive -- note that and move on.
3. **Check the ZERO case separately.** Step 2 tests the detector; a census floor is a
   different property. Point it at an empty path, an empty file, or an empty corpus and see
   whether it says "clean" over nothing.

Steps 2 and 3 find different defects. Every real gap found in rounds 52-54 was a step-3
defect: `doc parity` and `check-audit-stamps.py` and `check-orphans.py` all reported clean
over an empty corpus while their detectors were perfectly alive.

## What each measurement cost, and what it found

| Round | Candidates | Real gaps | Ratio |
|---|---|---|---|
| 51 | 3 audit findings | 0 | 0/3 |
| 52 | 2 gates + 17 citations | 3 | 3/19 |
| 54 | 4 string-derived | 1 | 1/4 |
| 55 | 4 string-derived | 0 | 0/4 |

**A candidate list derived from an absent string has roughly a one-in-four hit rate.** Said
plainly because it sets the expectation: most of that list is not worth repairing, and the
cost of checking each one is three commands.

## The specific ones checked and cleared

Recorded so the next reader does not re-derive them:

| Checker | Why it needs no self-test |
|---|---|
| `check-debt-ledger.py` | cross-checks the ledger against `git log`; emptying either side is caught by the other |
| `verify-fluent-dynamic-families.py` | an empty locale corpus makes every family a gap -> rc 1 |
| `check-unified-routes.mjs` | three census guards, each printing "the parser drifted" and exiting 2 |
| `check-replay-fork.py` | has a companion test, wired at `check.sh:561` |
| `check-ui.mjs` | an AGGREGATOR (runs lint/tsc/vitest); it has no detector of its own |
| `check-font-claims.mjs` | 16 rows, each `if (!probe.ran) exit 2` then an exact-value assertion; empty -> false -> fail |
| `verify-scoped-coverage.sh` / `verify-scoped-authorization.sh` | corpus floors (`< 50` / `< 150`) |
| `check-query-plans.py` / `check-scratch-leaks.py` | run a proof before grading (see above) |

## The one rule

**Do not repair a gate because it lacks a flag. Repair it because you watched it pass
something it should have failed.**
