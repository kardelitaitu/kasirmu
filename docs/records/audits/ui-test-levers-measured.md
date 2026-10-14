# Worker cap, happy-dom and merging: three experiments, two refusals (2026-10-12)

Three levers were proposed after the node-environment conversion. **Only one was
worth taking.** The other two were measured and REFUSED, and the measurements are
the useful part.

## 1. `maxWorkers`: measured, and REFUSED

The config's own note demands re-measuring with the **contended pair** — two full
suites at once, this checkout's normal state — before the cap may change. Done:

| Workers | Pair wall clock | Failures (A / B) |
|---|---|---|
| **16** (current) | **149.0s** | **17 / 17** |
| 32 (uncapped) | 156.1s | 18 / 18 |

Both numbers reproduce the config's 2026-10-07 finding. Two things to note:

- **17/17 is EXACTLY the solitary baseline**, so at 16 the pair produces **zero**
  contention-induced failures. Uncapped produced one extra failure per suite.
- The cap is **also faster** under contention (149s vs 156s), because work that
  starves does not finish.

No change. The lever is real on an idle machine and a loss on a busy one, and a busy
one is the state that matters.

## 2. happy-dom: not installable, and REFUSED as a dependency decision

`--environment=happy-dom` failed with `Cannot find package 'happy-dom'`. Adopting it
means a **new dependency** (lockfile, supply chain, CI), which is not a decision to
make inside a performance pass. The remaining jsdom cost is real but it does not
justify taking on a new runtime dependency silently.

## 3. Merging tiny files: taken, on the one group that was provably safe

The premise was measured first. `environment` is a **fixed per-FILE cost**:

| File | Tests | `environment` |
|---|---|---|
| Badge.test.tsx | 6 | 1.11s |
| CartPanel.test.tsx | 27 | 1.21s |

So a file with 3 tests pays the same window cost as one with 30. Eight
`nodeTopologyEditor*` state-machine files — 74 tests between them — were spending
**16.04s** of environment.

### Why only that group

`vi.mock` is hoisted and FILE-SCOPED, so merging two files that mock the same module
differently silently changes one of them. The eight state-machine files carried
**zero `vi.mock` calls** — checked, not assumed.

The 12 unmocked **a11y** files looked like the next candidate and were **REJECTED**:
they collide on `FTL` (four DIFFERENT values across eleven files), `makeProps` (four
different bodies) and `STAMP`. A naive merge would have handed each test another
file's fixture — the same silent-substitution class this session has been fixing.
Roughly 11s was not worth that risk.

### Result

`nodeTopologyEditorStateMachines.test.ts`: **74 tests, 15 describes**, verified to
carry every original describe/`it` title and an identical `it()` count before the
originals were deleted.

| | Before | After |
|---|---|---|
| files | 8 | 1 |
| `environment` | 16.04s | **0.94s** |

## The measurement caveat, stated so the numbers are not over-read

Two consecutive full-suite runs of the SAME code measured **106.40s** and **96.82s**
— a 10s spread from other sessions' load on this machine. Any single full-suite
figure in these records carries roughly that error bar. The per-file and per-phase
numbers used above are from narrow, repeated runs and are much tighter; the
wall-clock totals are not.

## Commits

- `1a61492f0` — the eight-way merge.

## What is left

The remaining environment cost is ~488s across 525 jsdom files, and it is now known
to be mostly irreducible without either a new dependency (happy-dom) or a worker
change that measurement refuses. The honest position: the cheap wins are taken, and
the next one requires a decision rather than a technique.

> last audited 14-10-26 by docs-auditor
