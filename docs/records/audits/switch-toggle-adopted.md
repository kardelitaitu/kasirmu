# Round 181's component adopted at the site that motivated it (round 182)

## What this round

Round 181 built `SwitchToggle` and deliberately left all twelve call sites alone. This round
adopted it at ONE site — the one that motivated the extraction: the cash-drawer-kick switch,
where round 179 found a `role=switch` with no `aria-checked`.

## Why that site first

It is the site whose defect the component exists to prevent, which makes it the round-trip:
**the guard that would have caught the bug and the fix for the bug, in the same change.**

The rail switch in the same file was deliberately NOT touched. Its shape differs — it lives
inside the `RailCard` subcomponent with no outer `.settings-toggle` span, and its `onChange`
does two things (`onToggle` AND `setIsExpanded`). It is a different widget, not a copy of this
one, and forcing it into the shared component would have meant changing behaviour to fit the
abstraction.

## What changed

26 lines of hand-written markup became an 8-prop `<SwitchToggle>`. Net **-11 lines**
(15 insertions, 26 deletions). The same `id`, label, `checked` value, testid and handler
arguments — nothing about the behaviour.

The round-179 comment explaining the `aria-checked` requirement is replaced by one pointing
at where the requirement now lives, so the knowledge is not lost by the move.

## What proves behaviour did not change

| Evidence | Result |
|---|---|
| Round-179 E2E spec | **2 passed** unchanged — it addresses the control by testid, which is preserved |
| Payments + switch unit suites | **49 passed** |
| Round-181 kill-test | still valid — removing `aria-checked` from the component would now fail the E2E spec too |
| `tsc` / `eslint` | 0 / 0 |
| Full UI suite | 12,698 passed |

## Two errors, both from editing rather than reading

1. The first `replace` used an anchor that no longer matched — the round-179 comment had
   shifted lines. It reported `anchor: false`, wrote an identical file, and only the import
   went in. **A failed anchor must fail the step, not continue.**
2. The retry used a line range whose replacement block was missing its opening comment
   marker, which `tsc` caught immediately.

Both contained inside the round — the second by the compiler, the first by reading the
reported result rather than the exit code.

## Verified

| Item | Result |
|---|---|
| Call sites adopted | 1 of 12 — the motivating site |
| Diff | 1 file, +15 / -26 |
| Round-179 E2E spec | 2 passed |
| Payments + switch unit suites | 49 passed |
| Full UI suite | 12,698 passed |
| Remaining inline copies | 11, each with its own owner |