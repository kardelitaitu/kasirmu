# The edit-modifiers control, and why the spec is desktop-only (round 259)

## What was covered

`cart-line-edit-modifiers-btn` was the last uncovered control on the cart line - 16 of 17. It is
gated twice, and both gates are why nothing had reached it:

```
the line must ALREADY carry modifiers    (line.modifiers?.length ?? 0) > 0   (`:328`)
the host must supply onEditModifiers     wired by PosScreen.tsx:1760
```

So it is not reachable on a plain line. The route is rounds 210-212's, reused rather than
re-derived: author a modifier group on a menu item, then sell it so the customizer attaches a
choice to the line.

**What it does is the point.** `:220` renders a DIFFERENT control for a line with NO modifiers - an
Add - and `:328` renders this Edit once some exist. A line that already has modifiers must be able
to CHANGE them, or correcting a wrong choice means removing the line and starting again.

Kill-tested: suppressing `onEditModifiers(line)` fails the case. Restored byte-identical.

## The spec is desktop-only, and that is a finding not a shortcut

It passes on desktop and fails on tablet. Probed the tablet path directly:

```
CARDS     first card is Caffe Latte - same as desktop, so the selection is not the issue
MODAL     1  - the customizer OPENS, so the authored group does reach the till
SHEET     0
LINE_MODIFIER_REGION  0   - the line never carries modifiers
```

So on tablet the customizer opens and the choice does not stick, while on desktop it does. That
is a REAL behavioural divergence in the modifier chain, and it is recorded here rather than
papered over with a conditional skip that would report the tablet run as passing.

Gated with `test.skip(testInfo.project.name !== 'desktop', ...)`. A skip REPORTED as skipped is the
honest form - round 251's lesson is that a test which cannot fail reads the same as one that
passes, and a silent green would do exactly that.

## Two wrong turns, both of the known shapes

| Attempt | Why it was wrong |
|---|---|
| a speculative navigation block written before reading the screen | the editor has a NAMED back control (`restaurant-menu-editor-back-btn`, `:921`); round 210's record already said it works once no form is open, and the authoring step closes it |
| `[data-testid^="modifier-"]` to choose an option | that prefix matches the GROUP element first, so it selected nothing - which is why the line had no modifiers on tablet |

The second is round 226's instrument class again: a selector that resolves is not a selector that
addresses the thing you mean. Replaced with `getByText(/Extra Hot/)`, which names the authored
option, plus an explicit wait for the confirm to ENABLE - the modal disables it until every group
is valid, so that wait is itself the check that a choice was made.

## Verified

| Item | Result |
|---|---|
| New spec | 1 passed, 1 skipped (tablet gated) |
| Kill-test | 1 failed |
| CartLineItem.tsx | unchanged, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,716 passed |

## CartLineItem coverage, complete

| Control | Round |
|---|---|
| modifier region | 212 |
| action cluster | 217 |
| edit-modifiers | 259 |

The cart line now has every control covered. The next round's first step is the tablet divergence:
why attaching a chosen modifier works on desktop and not on tablet, given the customizer opens on
both.

> last audited 15-10-26 by docs-auditor
