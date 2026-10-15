# The view-gated exemption is now verified by a spec (round 274)

## What round 273 left open

Round 273 proved the scan's `VIEW_GATED` list can hide a gap, tried two guards, and neither bound —
because the real check needs a JSX parser rather than a regex. It left the list **trusted** and named
the unproven claim:

> `deduction-location-badge` and `deduction-override-indicator` are asserted covered-by-relocation
> … What is unverified is the script's claim that these two ids CANNOT RENDER in the scanned
> workspace.

**That is a testable claim, and it is now tested.**

## Measured first, then pinned

| State | Cart-panel badge | Sidebar row |
|---|---|---|
| fresh cart, no scope | 0 | 0 |
| after the sale scope starts | **0** | **1** — "Deducting: Main Stor…" |

So the exemption is correct in both directions: the ids genuinely cannot render on the restaurant
cart panel, and the control genuinely does render where round 243 covers it.

## 4 passed, both profiles

| Case | Asserts |
|---|---|
| the absence | the ids are absent **before and after** the scope exists |
| the relocation | the sidebar row renders, naming the location |

The first case checks both states deliberately: **an absence verified only at rest would pass on an
id that appears once a location is known**, which is exactly when this control has something to say.

The second is what keeps the exemption honest. **If the control existed nowhere, exempting it would
REMOVE coverage rather than move it** — and this is the assertion that catches that.

**Kill-tested**: removing `!sidebarOwnsTerminalActions` makes the ids render on the cart panel and
fails the first case. Restored, `RESTORED_TO_HEAD`.

## The shape this closes

| Round | What it did |
|---|---|
| 261 | added the `VIEW_GATED` split to stop a DESIGNED absence reading as a gap |
| 273 | proved the split can also HIDE a gap — an open id added to it changed no printed number |
| **274** | **pins the exemption's own claim in a spec, since the script cannot check it** |

The script is a heuristic and says so. What it cannot verify, a test can — and the division is now
explicit: **the scan counts, the spec certifies.**

## Verified

| Item | Result |
|---|---|
| New spec | 4 passed (2 cases x desktop/tablet) |
| Kill-test | 1 failed |
| `CartPanel.tsx` | restored, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,716 passed |

## The instrument ledger, now complete

| Instrument | Guard |
|---|---|
| scan `covered` | `SELF_CHECK_ID` |
| scan `used` | `USED_FLOOR` |
| acceptance `occludedControls` | the spec, proven both ways |
| view-gated split | **this spec — the script's exemption list is now certified by a test** |

**All four instruments carry a guard**, which is where this line of work started in round 272 with
three of four and an argument for the fourth. The argument was wrong and the guard is real.

> last audited 15-10-26 by docs-auditor