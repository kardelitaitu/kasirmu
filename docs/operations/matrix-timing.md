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

The 36 steps split by what they invoke:

```
HEAVY (cargo / npm / npx / go / docker)   8 steps   344 s   <- cannot be parallelised
STATIC (pure python / node checks)       28 steps   194 s   <- independent subprocesses
```

| Lever | Ceiling | Evidence |
|---|---|---|
| A warm cargo cache | most of the 286 s | the machine is already warm; this is the residue of an incremental rebuild |
| Parallelising the STATIC half | **~155 s** | 194 s of independent subprocesses; at 5x that is 39 s, so 155 s saved. The ceiling is the static half, not the matrix: the 344 s of cargo/npm work does not parallelise against itself |
| Merging "X" and "X self-test" pairs | **~0 s** | 18 of 36 steps are already at 0 s |

**So the honest ranking is: parallelise the static half, not the step list.** `verify-selftest-sweep.py`
already proved the pattern on this corpus — 50 checkers, 8-wide, 362 s -> 232 s in round 46.
The ceiling is 155 s, which is 29% of the 538 s measured, not the "half the matrix" the
step count suggests.

So the honest ranking is: parallelise the static middle, not the step list. The sweep
already proved the pattern works on this corpus.

## Why this file exists

`check.sh` has grown from 134 steps (round 45) to 141 today, and five of the last five
commits touching it ADDED a step. "The matrix is too big" became a recurring note in the
round agenda with no number behind it.

The number says the size is not the problem — **the shape is.** One step is half the
runtime, and half the steps are free.

## The build cache works; the history just has few repeats

`sccache --show-stats` on this checkout reports a **1.06 % hit rate** (51 hits, 4745 misses).
That reads as a broken cache. **It is not.** Measured directly:

```
cargo clean -p kasirmu-hal ; cargo check -p kasirmu-hal   -> hits 51 -> 52, misses unchanged
cargo clean -p kasirmu-hal ; cargo check -p kasirmu-hal   -> hits 52 -> 53, misses unchanged
```

The second and third compiles were served entirely from cache. The low RATE reflects what the
history contains -- 4595 compiles across changing RUSTFLAGS, profiles and crate subsets, each a
distinct cache key -- not a misconfiguration.

**One correction to an earlier reading of this file.** The first pass blamed
`[profile.dev] incremental = true` for the misses, on the strength of sccache's own
`Non-cacheable reasons: incremental 1456`. Setting `CARGO_INCREMENTAL=0` for a full clippy run
removed `incremental` from that list and **still produced zero hits** (hits stayed at 51 while
misses went 4522 -> 4745). The `incremental` counter explains why those compilations were not
CACHED, not why later ones do not HIT: a non-cacheable compile cannot seed the cache, so the
history is mostly un-seeded. Both readings are in the ledger; this one is the measured one.

### The consequence for the 286 s clippy step

It cannot be made cheaper by caching a DIFFERENT command: clippy's own output is a separate
cache key from `cargo check`'s, and this repo's clippy runs are not repeated often enough for a
warm entry to exist. What DOES help, on this machine, is not re-running it at all -- which is
what `CHECK_FROM=N` is for.

## Can the static half actually run concurrently?

Measured 2026-10-23 on eight representative static gates (the full 28 were not tested):

```
serial      22,898 ms
concurrent  12,073 ms      speedup 1.9x
```

Safety: 8/8 exit 0 across four concurrent batches, output identical to serial, and
`git status --porcelain` hashed to the SAME SHA-256 before and after. No script binds a port,
takes a lock, or shares a cache.

**The 1.9x is a structural ceiling, not a harness limitation.** Two of the eight are ~21 s of
the 23 s total (`verify-debt-markers.py` 11.2 s, `verify-shell-syntax.py` 10.1 s); the other six
sum to 1.5 s. Eight-way parallelism cannot beat the two longest jobs, and the same shape is
likely to recur across the remaining 20 static steps.

### The hazard the measurement found, which is independent of parallelism

`verify-shell-syntax.py --self-test` wrote its probe to `ROOT / "scripts" /
"_syntax_selftest_tmp.sh"` -- INSIDE the directory the checker enumerates. At one point it
writes an intentionally BROKEN script (unterminated quote) and leaves it on disk briefly.

Two consequences, and only one needs concurrency to bite:

1. `check.sh` runs the plain checker and its self-test as ADJACENT STEPS (87/88, and the same
   pair shape recurs at 216/221, 228/229, 470/471, 646/647, 872/873, 875/876, 886/887). A
   concurrent rewrite would schedule them together, and the plain run could read the
   half-written file and report a PARSE ERROR on a clean tree. **Ten deliberate trials did not
   reproduce this**, so it is recorded as LATENT, not demonstrated.
2. The scope differential a few lines ABOVE compares the git count against the no-git count. An
   untracked file present during that comparison makes the two disagree and fails the self-test
   for a reason that is not a scope bug. This one needs no concurrency at all.

Fixed (`538f9472c`) by moving the probe to `target/`, which is gitignored and therefore never
counted by the git path. Every assertion is unchanged: `check()` takes any path. Verified: 7/7
self-test cases, real run green at 63 scripts, and `scripts/` is clean of the probe afterwards.

### What this means for the parallelisation proposal

The measured ceiling on the static half stays **~155 s** (194 s of independent subprocesses, at
best 5x). Eight-way is not achievable because two jobs dominate, and the realistic figure is
closer to 1.9-2.5x on that slice -- **call it 60-100 s, not 155 s.** The earlier estimate assumed
uniform sizes, which this measurement disproves.
