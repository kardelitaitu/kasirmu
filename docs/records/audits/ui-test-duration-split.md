# UI test duration: the split, and the ceiling I got wrong (2026-10-12)

## What was done

`NodeTopologyEditor.test.tsx` — **12,246 lines, 550 tests, 94 describes** — was
split into four files plus a shared harness:

| File | Lines | Describes | Time |
|---|---|---|---|
| `nodeTopologyEditorCore.test.tsx` | 3,004 | 30 | 9.4s |
| `nodeTopologyEditorWiresAndShortcuts.test.tsx` | 2,908 | 26 | 9.4s |
| `nodeTopologyEditorWarehouseAndCanvas.test.tsx` | 2,580 | 25 | 9.6s |
| `nodeTopologyEditorSweepsAndExport.test.tsx` | 3,767 | 13 | 10.5s |
| `topologyEditorTestHarness.tsx` | 431 | — | (shared) |

**Line counts corrected 2026-10-11 (docs-auditor).** The four per-file line numbers above
were drafted before the final edit and were never true: each file has exactly ONE revision
(`20da3835c`) and has not changed since, so the committed blob gives 3,004 / 2,908 /
2,580 / 3,767 rather than the 3,021 / 2,926 / 2,597 / 3,782 first written.

  **Method corrected 2026-10-14 (docs-auditor): the figures are right and `wc -l` was the wrong
tool to name.** Re-measured: the file's single revision still ends at byte `.` with **no trailing
newline**, so `wc -l` reports 3,003 for it, not 3,004 — and did so at `20da3835c` too. The four
values above are correct; they come from counting lines, not newlines. Two of the five files
(`Core` 3,003/3,004 and `WarehouseAndCanvas` 2,579/2,580) show the `+1` gap; on the other three a
blank final line makes both tools agree. **The lesson is narrower than a wrong number: naming a
command as the SOURCE of a figure is itself a claim, and it needs the same check as the figure.**
`grep -c ''` or a splitlines count is the right citation here. The describe counts
(30/26/25/13 = 94), the `it()` count (549) and the timings are unaffected and verified exact.

Balanced against the MEASURED per-describe durations, not line counts.

### Verified equivalent

- **550 tests before, 550 after** (exact).
- **94 describes before, 94 after**; 549 `it()` before and after.
- Isolated: **36.6s -> 12.96s** for the same tests.
- `tsc --noEmit` clean; `eslint` exit 0.

## The correction: the full suite is NOT file-bound

The full suite went **107.58s -> 105.18s**. That is a 2.4s gain, not the ~50s the
isolated measurement implied. My round-50 analysis said:

> "the longest single file is a hard lower bound on wall clock"

That was TRUE when the file was 49.2s and 46% of the run. It is false now, and
the full-suite numbers say why:

| Quantity | Value |
|---|---|
| sum of all file durations | 551s |
| workers | 16 |
| ideal wall clock (sum / workers) | **34s** |
| measured wall clock | **~105s** |
| longest single file | 16.5s (3% of the sum) |

The suite runs at about **32% of its theoretical parallelism**. The binding
constraint is **contention and worker scheduling**, not any one file — the longest
file would only bind if wall clock fell below ~34s.

So the split removed a real bottleneck that was there, and the NEXT bottleneck was
already larger. That is worth stating plainly rather than presenting a 2.4s win as
if it were the 50s the isolated number suggested.

## What the split is still worth

- The 49.2s file is gone: no single file dominates, and the worst is 16.5s.
- **Isolated runs of this suite are 2.8x faster** (36.6s -> 13.0s). Anyone
  iterating on the topology editor feels that on every run.
- It removes a latent cliff: with more workers (CI has more) the old file would
  have re-become the floor.

## Where the remaining time actually goes

`environment: 653s` and `setup: 181s` summed across 16 workers are the real mass —
every test file pays a jsdom window and a module graph. With 748 files that is
~0.9s of environment per file. The levers, in order:

1. **Raise worker count** — the config caps at 16 for a documented reason
   (contended-pair correctness). At 32 the ideal wall is 17s, but the config's own
   measurement found uncapped produced 39 starvation failures. Re-measure before
   touching it.
2. **Cut per-file environment cost** — a lighter environment (happy-dom) or
   `environmentMatchGlobs` for the many files that need no DOM.
3. **Merge trivial files** — there are now ~15 tiny `nodeTopologyEditor*.test.ts`
   files at 0.0-0.1s each, every one paying full setup.

## Why each describe moves WHOLE

The one non-obvious constraint, and the reason this took several passes:

> **62 of the 94 describes read helpers from an OUTER scope.**

Names like `nodes`, `pos`, `selected`, `selectNode`, `nodeCount` are declared
inside a parent describe and used by its children. Promoting a nested describe to
top level breaks that link — the tests fail with `ReferenceError: nodeCount is not
defined`. So nested describes were NOT extracted (except where provably
self-contained), and the 3,618-line Component block moves as one unit.

Two further traps, both hit and fixed:

- **`vi.mock` is hoisted and file-scoped.** A mock declared in the shared harness
  module does NOT apply to importers, so each of the four files carries its own
  mock prologue. This is the one thing the split has to duplicate.

- **Brace counting is not a validator.** The original file has a net brace depth of
  +2 because braces appear inside template literals (`` `${x + 24}px` ``). A naive
  counter reported blocks as unbalanced that are perfectly valid. Slicing needs a
  string-aware scanner; correctness was ultimately verified by RUNNING the tests.

## Method note

The extraction script first OVERWROTE the original file, destroying it. It was
recovered with `git checkout --` because the file was committed — worth remembering
that the recovery existed only because the work had been committed first.

> last audited 14-10-26 by docs-auditor
