# The 197px page scroll is FIXED — the fix had to go on the scroller — 2026-10-18

<!- - Audit stamp: 2026-10-18 - autonomous goal round 172 - status: the defect escalated in
     rounds 167-169 is FIXED; 6/6 narrow-shell cases pass; 3 gates green - branch: 0.0.41 -
     commit: 70a791e7e -->

<!- - Scope: finish the one open defect. Round 169 named the next probe as the fixed-position
     overlays; that was refuted, and the refutation pointed at the real answer. -->

## The fix

```css
.sales-history-filters {
  flex-wrap: nowrap;
  overflow-x: auto;
  contain: layout;   /* <- the fix */
}
```

One declaration, on the SCROLLER. Measured at 480x800: `window.scrollX` 197 -> **0**,
`documentElement.scrollWidth` 677 -> **480**. All 6 narrow-shell cases pass.

## Why every previous attempt failed, and what finally located it

Rounds 167-171 tested ~20 candidates and refuted them all. Every one of them put the fix on
something CONTAINING the bar — `.sales-history`, its ancestors, a new wrapper, the shell. This round
found that the fix had to go on the scroller itself, and getting there took one measurement
nobody had made:

```
children of the bar overflowing the bar's own box: 14   (right edge 831 vs bar right 466)
```

The bar is `overflow-x: auto`, so it IS a scrollport — but its 14 `flex-shrink: 0` children
still contributed to the ROOT scroll area. That is why every containing-box candidate failed:
containing the bar does not stop the bar's children from reaching the root, because the bar is
already their containing block. The containment had to be established ON the scroll container.

## How the refutation produced the answer

Round 169 escalated with one named suspicion: the `position: fixed` overlays interacting
with `container-type: inline-size`. Tested and REFUTED — hiding all six fixed elements left
`scrollX 197` unchanged, and none of them overlaps the right edge (max `right=459`).

But that probe forced a full inventory of what was escaping, which surfaced the 14 overflowed
children — the measurement that had been missing all along. **The suspicion was wrong and
still paid for itself**, which is the reason to write a suspicion down as a suspicion rather
than discarding it.

## Why `layout` and not `paint` or `content`

All three were measured equivalent for the fix AND for preserving function:

| candidate | page scrollX | root.sw | bar scrollable | bar scrollLeft | last child |
|---|---|---|---|---|---|
| baseline | 197 | 480 | 373 | 373 | visible |
| `contain: layout` | **0** | **480** | 373 | 373 | visible |
| `contain: paint` | **0** | **480** | 373 | 373 | visible |
| `contain: content` | **0** | **480** | 373 | 373 | visible |
| `contain: inline-size` | 197 | 480 | 373 | 373 | visible |

`layout` was chosen as the least side effect: it makes the bar a layout containment root
without clipping painting. `inline-size` does NOT fix it (it is what `.sales-history` already
carries, and it was never the problem). `paint` would work but clips, which is a stronger
guarantee than this bug needs on a scrollport — and the rule comment records exactly that, so
a future reader can revisit the choice with the numbers in front of them.

## A false alarm caught by attribution, not by assumption

The full suite showed 8 failures including one test I wrote (`a draft survives the mount that
restores it`). My first instinct was that a CSS change cannot break localStorage — which is a
reason to CHECK, not a reason to dismiss. Reverted the CSS and re-ran: **4 failed without my
change too**, so it is not mine. Then the cause: `PosScreen.tsx` is DIRTY — another lane is
mid-edit on the restore effect right now, adding a `currencyReady` gate and extra
`removeItem` calls (`git diff` shows it). Their in-flight work, not my commit.
CSS restored byte-identical by sha256.

## Evidence

- `narrow-shell.spec.ts` -> **6 passed (53.9s)**, from 4 passed | 2 failed.
- Gates: `npm run lint` PASS (0 errors), `npm run typecheck` PASS (0),
  `npm run lint:i18n` PASS (0).
- Full suite: 813 passed | 3 failed files, and the 8 failures are ATTRIBUTED to the other
  lane's dirty `PosScreen.tsx` by the revert-and-rerun above.
- Commit `70a791e7e` verified with `git show --name-only` -> exactly the one CSS file,
  24 insertions, 0 deletions.
- All scratch probes deleted (0 `zz-*` remain in `ui/e2e/`).

## Carried forward

1. The sales-history scroll defect is CLOSED. The refuted space is recorded in the CSS comment
   itself (every `overflow`/contain/min-width/width` on the bar and its ancestors, the
   wrapper experiments, the width experiments, the fixed-overlay test) so it is not re-walked.
2. The generalisable finding: **a scroll container's overflowing children still reach the root
   scroll area; containment must go on the scroller.** Five rounds of containing-box candidates
   failed for exactly this reason.
3. The other lane's in-flight `PosScreen.tsx` edits are breaking draft-restore tests. That is
   theirs to land, and I should re-check the suite once it settles rather than report it as a
   standing failure.

> last audited 18-10-26 by docs-auditor
