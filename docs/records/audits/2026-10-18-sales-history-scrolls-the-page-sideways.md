# Sales history scrolls the page sideways at 480px — 2026-10-18

<!- - Audit stamp: 2026-10-18 - autonomous goal round 167 - status: 1 real usability defect
     REPRODUCED and isolated to a measurement, fix NOT landed (my first attempt traded one
     assertion for another and was reverted), 1 stale assertion identified - branch: 0.0.41 -
     commit: none (no edits to commit) -->

<!- - Scope: the ~18 E2E failures round 165 left unexamined. This round took the ones that
     named different errors rather than the navigation shape. -->

## The defect, measured

`narrow-shell.spec.ts:277` fails in isolation (2 failed | 4 passed in that file, so the
harness is fine and this is specific to sales history). Reproduced at 480x800:

```
window.scrollTo(9999, 0) -> window.scrollX = 197
document.body.scrollWidth = 480        <- the LAYOUT is correct
document.documentElement.scrollWidth = 677
.sales-history  clientWidth 480  scrollWidth 480   <- also correct
.sales-history-filters  clientWidth 450  scrollWidth 823  overflow-x auto
```

**A tablet user can drag the page 197px sideways on a 480px screen.** That is real and
user-visible, and it is a usability defect this goal is chartered to find.

The mechanism: `.sales-history-filters` carries `overflow-x: auto` + `flex-wrap: nowrap` by
design (the compact 1-row bar from `f5772454c`), and it scrolls its own content correctly
(`barScrollLeft` reaches 373). But its scrollable overflow ALSO inflates the ROOT scroll
area, even though every box in the chain reports `scrollWidth == clientWidth == 480`.
Hiding the bar drops `html.scrollWidth` 677 -> 480, which pins the source to the bar.

## A stale assertion found alongside it

The second failure in the file (`:303`) asserts the OLD design. `f5772454c` (Oct 11) removed
`.sales-history-filter-input { min-width: 0; width: 100% }` and replaced it with
"compact 1-row filter bar — smooth horizontal scroll without wrapping" (`min-width: 9rem`).
The spec still expects `min-width: 0px` and the input to take the whole filter row. The test
encodes a design that was deliberately replaced three commits earlier.

## My fix attempt, and why it was reverted

I tested candidates inline against both assertions:

| candidate | scrollX | root.scrollWidth |
|---|---|---|
| baseline | 197 | 480 |
| `contain: paint` on `.sales-history` | **0** | **677** |
| `overflow-x: clip` on the bar | 197 | 480 |
| `overflow-x: clip` on `.sales-history` | 197 | 480 |
| `overflow-x: hidden` on `html` | 197 | 480 |
| bar `contain: inline-size` | 197 | 480 |

`contain: paint` suppressed the document scroll — and my first reading of the log said it
worked, because the assertion that failed changed. It had not worked: it moved
`root.scrollWidth` from 480 to 677, trading one failure for another. I had already written the
declaration into the CSS with a comment claiming it was "the ONLY one of four candidates that
worked" before measuring the second assertion, and reverted with `git checkout --` as soon as
the re-run showed it.

A later sweep over more candidates found **no single declaration that satisfies both**.
Retail POS is the counter-example proving it is achievable — its root reports
`scrollWidth == clientWidth == 480` **and** `scrollX == 0` while carrying its own scrollers
(`.retail-categories` sw 1632 / cw 192). So the difference is structural, in what sits between
the bar and the root, not in any one `overflow` value.

## What I am NOT claiming

I did not land a fix, and I am not calling the remaining failure stale either. The
`docScrollWidth` assertion is measuring a REAL user-visible symptom (197px of page scroll);
the `rootScrollWidth` assertion is the one that looks over-strict for a design that scrolls
internally. Separating those two cleanly needs the structural comparison against retail that
the evidence above only sets up.

## Evidence

- Isolation: `narrow-shell.spec.ts` alone -> 2 failed | 4 passed (54.9s), so not interference.
- The measurement chain is in the transcript: `body.scrollWidth 480` vs
  `documentElement.scrollWidth 677` with `scrollX 197` after a programmatic scroll; hiding the
  bar -> 480; the ancestor walk showing every level at 480; retail POS at 480/480/0.
- Throwaway probes under `ui/e2e/zz-narrow.spec.ts`, replaced repeatedly and finally DELETED
  (verified: 0 `zz-*` remain). `SalesHistoryScreen.css` and `narrow-shell.spec.ts` both
  confirmed clean against HEAD after the revert.
- **No production file changed.** Nothing to commit but this record.

## Carried forward

1. Finish this one defect rather than opening another. The next probe should diff the
   CHILDREN of `.sales-history` against those of `.retail-pos` at 480px — specifically which
   wrapper between the scrolling bar and the root differs, since no `overflow` value on the
   existing boxes changes the outcome.
2. The `:303` assertion needs an owner decision, not a lane decision: the spec asserts a
   filter-bar design that `f5772454c` deliberately replaced. Either the spec is updated to the
   compact-scroll design or the design is reverted; I should not silently pick one.
3. Remaining unexamined from round 165 list: `the seeded bill must attach to a table` and
   `the plan has a free table` (both fixtures/preconditions), plus the viewport-clipped-click
   errors. Those are separate from this layout finding.

> last audited 18-10-26 by docs-auditor
