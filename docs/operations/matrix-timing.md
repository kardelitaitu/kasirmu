# Where the local matrix actually spends its time

Measured 2026-10-23 on branch `0.0.41`, AMD Ryzen 9 7950X, steps 1-36 of `scripts/check.sh`
(the run stops at step 37 because this machine has no PostgreSQL — see
[agent-gates.md](agent-gates.md)).

```
36 steps measured    total 538 s
  clippy workspace            286 s   (53%)
  exhaustive-deps ratchet      88 s   (16%)
  rustdoc                     50 s   ( 9%)
  no-raw-params falsification 27 s   ( 5%)
  no-raw-params               15 s   ( 3%)
  scoped coverage             14 s   ( 3%)
  architecture boundaries     14 s   ( 3%)
  everything else             44 s   ( 8%)   <- 29 steps

  18 of 36 steps report 0 s
```

## What this says about merging gates

**Half the steps cost nothing.** Merging two zero-second steps saves zero seconds. A
proposal to "reduce the step count" is therefore cosmetic unless it touches the four
steps that actually run.

The three expensive steps are not mergeable with anything:

- **`clippy workspace` (286 s)** compiles the whole workspace. Its cost is the compiler,
  not the gate.
- **`exhaustive-deps ratchet` (88 s)** runs eslint over the UI tree.
- **`rustdoc` (50 s)** runs `cargo doc` over the workspace.

They are also the three steps that genuinely need a full build, which is why they are
expensive and why they cannot share a pass without changing what they check.

## What WOULD reduce it

Measured, not proposed-and-abandoned:

| Lever | Estimated saving | Evidence |
|---|---|---|
| A warm cargo cache | most of the 286 s | the machine is already warm; this is the residue of an incremental rebuild |
| Parallelising independent static gates | up to ~150 s | steps 5-36 are mostly independent subprocesses, the way `verify-selftest-sweep.py` already runs its 50 checkers 8-wide (362 s -> 232 s in round 46) |
| Merging "X" and "X self-test" pairs | **~0 s** | 18 of 36 steps are already at 0 s |

So the honest ranking is: parallelise the static middle, not the step list. The sweep
already proved the pattern works on this corpus.

## Why this file exists

`check.sh` has grown from 134 steps (round 45) to 141 today, and five of the last five
commits touching it ADDED a step. "The matrix is too big" became a recurring note in the
round agenda with no number behind it.

The number says the size is not the problem — **the shape is.** One step is half the
runtime, and half the steps are free.

