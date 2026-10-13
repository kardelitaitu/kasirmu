# Test environment: 223 files moved off jsdom, and a CSS defect found (2026-10-12)

## The measurement that started it

After the topology split the suite was still ~105s, with `environment: 653s`
summed across 16 workers — the largest phase by far. **748 test files x ~0.9s of
jsdom startup each.**

A/B on the same DOM-free files:

| Environment | `environment` phase | Wall |
|---|---|---|
| jsdom | 412ms | 741ms |
| node | **0ms** | 324ms |

## The actual blocker was not the tests

Switching 235 "DOM-free" files to `--environment=node` failed **all of them** with
`ReferenceError: localStorage is not defined`. The cause was not in any test:

> `ui/src/test-setup.ts` called `localStorage.clear()` and touched
> `document.documentElement` in a GLOBAL `beforeEach`.

So every file in the repo required jsdom regardless of what it tested. The fix
guards that block on the globals themselves (`typeof localStorage !== 'undefined'`,
`typeof document !== 'undefined'`) — including `cleanup()` in `afterEach` — rather
than on an env flag, so a file that opts in via docblock needs no knowledge of how
it was selected.

## The per-file opt-in

`/** @vitest-environment node */` at the top of each converted file, because the
config cannot know which files are safe. **223 files converted** (30% of the suite),
**2902 tests, 0 failures**.

Selection was by resolved IMPORT GRAPH, not by the test file's own text: a file
that looks DOM-free still needs jsdom if a module it imports touches `document`.
The first 102 candidates were found that way; a further 132 were selected by
running them and keeping only those that passed (121 of 132).

### Three files passed the static scan and still failed at runtime

`canvasStateEqual.test.ts`, `dynamicFluentFamilies.test.ts` and
`topologyLoadModel.test.ts` all reported:

> \`document\` is undefined. Without it, translations cannot be safely sanitized.

They reach an i18n sanitiser that touches `document` only on a missing
translation — a runtime path no static scan can see. All three were reverted.
**This is why the conversion was validated by running, never by analysis alone.**

## Result

| Metric | Before | After |
|---|---|---|
| `environment` phase (summed) | 653s | **478s** |
| Full-suite wall clock | 105.18s | **98.34s** |
| Files needing jsdom | 748 | 525 |

The wall clock moves far less than the phase total because — as the round-50
correction recorded — the full suite is **contention-bound**, not bound by any one
phase. Removing 175s of summed environment work buys ~7s of wall clock at 32%
parallel efficiency.

## A real CSS defect, found as a side effect

`cssCommentIntegrity.test.ts` was RED on HEAD, under jsdom as well as node —
pre-existing and unrelated to the environment work:

```
features/tables/TableManagementScreen.css:123:1: Unclosed block
```

`.tables-legend-item` (line 123) was never closed, so `.tables-legend-text` and
everything after it were parsed as NESTED inside it. The file was one `}` short.
PostCSS reported it as a syntax error, which means **the whole stylesheet failed to
parse** — not just the one rule.

Fixed in `165b16304`; the guard went 3 failed -> 4 passed.

## Commits

- `62e26f747` — the setup guard (the enabling change).
- `f465e2b63` + `044949af9` — the 223 converted files.
- `165b16304` — the unclosed CSS block.

## Remaining levers, in the order the numbers support

1. **525 files still need jsdom.** The next tranche is files that render a single
   component; they cannot move. But `environmentMatchGlobs`-style grouping or a
   lighter DOM (happy-dom) would cut the remaining 478s.
2. **Merge the ~15 tiny files** (0.0-0.1s each) that still pay full setup.
3. **Raise `maxWorkers`** — the largest single lever, but the config documents
   measuring the CONTENDED pair first, and that has not been done.

> last audited 14-10-26 by docs-auditor
