# The three shift dialogs: no trap, and Escape with two owners waiting to happen

**Round 33 · 2026-10-11 · POS till · shift dialogs**

`ShiftModals.tsx` was the last POS-cashier dialog in the untrapped class — 3 dialogs on
the till (open shift, close shift, shift summary), and the nearest of the six remaining
from round 32's enumeration.

## The defect

None of the three installed `useFocusTrap`. Measured before the fix, on all three:

```
focus must land inside the dialog on open  -> expected false to be true
```

## The trap that would have double-fired

Wiring the hook naively would have created a **second** Escape owner. `useFocusTrap`
listens on `document` and, on Escape, calls its callback and returns — it does not
`preventDefault` or `stopPropagation`. But the close and open dialogs already handled
Escape on their **overlay**, whose keydown bubbles to that same document listener. Two
closers means `requestClose()` twice and the error reset twice.

So Escape ownership was **moved** rather than added: the hook is now the single owner for
all three, and the overlay branches were removed. Pinned by measuring the fire count:

```
close dialog: Escape fires requestClose exactly once   (1)
open dialog:  Escape fires requestClose exactly once   (1)
```

`ShiftSummary` had no keydown handler at all, so for it the hook also **adds** Escape — the
summary previously had no keyboard dismiss.

## Verification

| Check | Result |
|---|---|
| all three traps disabled (kill-test) | **6** cases -> **red** |
| Escape cases under that kill-test | `expected 1 times, got 0` — the hook is the ONLY closer |
| re-kill-tested after a fixture refactor | still red |
| round 30's Enter guards | **5 passed, unchanged** |
| shift + POS suites | **98 passed**, 1 skipped |
| wide POS sweep (11 files) | **134 passed** |
| ESLint / typecheck | **0 errors** / clean |

The Escape cases going to **0** when the trap is disabled is the evidence that ownership
moved rather than duplicated — a duplicated handler would have left one call behind.

## Typecheck caught what the tests could not, again

`vitest` passed 6/6 while `tsc` reported a real error: spreading the fixture
(`{ ...shift(), status: 'closed' }`) widens every property to optional, which the all-required
`ShiftDto` rejects. This is the **second round running** that typecheck found a defect
invisible to the test run — the two gates are not redundant, and a test file is code that
needs typechecking like any other.

## Remaining, recorded

The untrapped-dialog list is now **5**, none on the POS cashier path:
`ThresholdConfigScreen`, `TopologyApplyConfirm`, `topologyMigrationDialog`,
`TopologyRevisionBrowser`, `RestoreSection`. All are topology/inventory/settings surfaces
rather than the till, so they are lower priority for this objective's focus.

## Method notes

- **Adopting a shared hook means adopting its side effects.** The hook does autofocus AND
  Escape; taking it for the autofocus silently took Escape too, on two dialogs that already
  had it. Reading what a hook does before installing it is what turned a would-be
  double-fire into a single-owner refactor.
- The kill-test produced a **stronger** result than expected: I predicted the focus cases
  would fail, and the Escape cases failing with `got 0` is what proved the ownership moved.
  A kill-test that measures more than you asked for is worth reading carefully.

> last audited 16-10-26 by docs-auditor
