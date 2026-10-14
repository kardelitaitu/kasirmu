# The checker round 202 said a grep could not be (round 203)

## Why

Round 202 hunted round 201's closure-after-await shape across 741 files and concluded:

> the shape is not widespread, and the search that would find it is not a text search.

That was half an answer. The other half was named in the same record — a lint rule — and this
round built it: `scripts/check-state-closure-after-await.py`.

## It took four corrections to work, and every one was the same mistake

The checker went through four versions. Each was **green on its own self-test while blind to the
real defect**, and the fix was always to stop modelling the shape and read the actual line.

| Version | Self-test | Found the defect? | Why not |
|---|---|---|---|
| 1 | pass | no | body scope walked back 40 lines and caught the PREVIOUS handler's `await` |
| 2 | pass | no | collected `useState` names only — `lines` comes from `usePosHeldCarts` |
| 3 | pass | no | matched `setX(v.map(` on ONE line; the defect splits it across two |
| 4 | pass | **yes** | added the split form, matched on the bound local |

**The self-test was green through all four.** That is the finding worth keeping: a self-test
written from the same mental model as the matcher cannot reveal that the model is wrong. Version
3's fixture read

```ts
setLines(lines.map((l) => ({ ...l })));   // one line — as I imagined it
```

while the tree contained

```ts
const updatedLines = lines.map((l) => ({ ...l }));
setLines(updatedLines);                    // two lines — as it is
```

**The only reason this checker works is that it was tested against the real defect, not only
against its own fixtures.**

## What it does now

```
$ python3 scripts/check-state-closure-after-await.py --self-test
  ok   stale closure after await    (1)
  ok   fresh awaited value          (0)
  ok   updater form is the fix      (0)
  ok   no await at all              (0)
  ok   variable is not state        (0)
self-test: all 5 cases pass

$ python3 scripts/check-state-closure-after-await.py
state-closure-after-await: 0 candidates in ui/src
```

And with round 201's defect temporarily restored:

```
state-closure-after-await: 1 candidate(s)
  ui/src/features/sales/PosScreen.tsx:1092  setLines(lines.map(
      const updatedLines = lines.map((l) => ({ ...l, dispatchedQty: l.qty }));
```

**Exactly one candidate, zero false positives, and it is the real defect.** Two earlier false
positives were found and closed: `StockTransfersScreen:250` (no `await` in its own body) and
`TopologyScreen:1000` (a JSX prop one line above an unrelated `.map(`).

## Deliberately report-only

Default exit is 0 even with candidates. A setter of this shape is not always a defect — the
awaited-value form is correct — so the checker produces a short list a human reads rather than a
gate that blocks a lane on a heuristic. `--strict` exits 1 when a pipeline wants that.

Its docblock carries round 201's measurement, round 202's negative result, and why the two
correct-looking forms differ.

## Verified

| Item | Result |
|---|---|
| `--self-test` | 5 cases pass |
| Detection on the pre-fix form | 1 candidate, the right one |
| Detection on the fixed tree | 0 candidates |
| False positives | 2 found and closed |
| `PosScreen.tsx` | restored byte-identical to HEAD |
| Full UI suite | 12,707 passed, 0 failed |

> last audited 14-10-26 by docs-auditor
