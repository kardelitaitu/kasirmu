# The rail cap is real but insufficient: 6px of arithmetic I could not close (round 253)

## What the content-aware sweep found

Round 252 concluded the menu-rail occlusion was fixed and the kill-test bound. This round re-ran
round 249's sweep with the rule round 252 established — **wait for the content whose size you are
measuring** — and the result contradicts the conclusion:

```
SURFACE receipts      occluded=2   preview-chit @628, drawer @682
SURFACE menu-editor   occluded=6   cat-edit-snack @601, cat-edit-cold-drink @696, cat-del @696, …
SURFACE payments      occluded=0
SURFACE settings      occluded=0
SURFACE kds           occluded=0
```

**Both screens round 248 and 252 declared fixed still show occlusion at rest.** Their rules work at
the scroll END — which is where their specs scroll to — and not at the position an operator meets.

## What the rail cap actually achieves

Measured at rest with the cap in place:

| Profile | Rail bottom | Stack top | Overlap | Occluded |
|---|---|---|---|---|
| desktop 1366x768 | 616 | 610 | **+6** | 5 |
| tablet 1024x1366 | 831 | 1204 | -373 | **0** |

So the cap **halves** the desktop collision (bottom 803 -> 616, occluded 6 -> 5) and **fully clears**
tablet. It is a real improvement and **not a fix**, and round 252's record called it one.

## The 6px, and where the arithmetic stopped adding up

The cap resolves honestly — `h === maxHeight === 511px`, `box-sizing: border-box` — and the tokens
check out:

```
768 (100dvh) - 24 (--memo-bottom-inset, 1.5rem) - 215 - 16 (--space-4) = 513
```

for which the browser reported **511**. Two pixels of rounding are unobjectionable. The problem is
the **215**: it is the TABLET stack's height, and the desktop stack measures **137px**. Using the
larger constant is what keeps tablet safe, and it is also what leaves the desktop rail 6px too tall
— the constant cannot serve both profiles because it is subtracted from the same expression.

Subtracting a further `--space-2` and 2px moved the overlap to 6 and then to 4, **but the occluded
count went 5 -> 5 -> 5**, because a shorter rail brings different rows into the band. That is a
game of 2px with no winning move, and it was stopped rather than played.

**The shape that would work is a per-profile constant** — a second value under the tablet media
query — and it is not written here because the correct tablet/desktop pair was not measured far
enough to commit.

## Verified

| Item | Result |
|---|---|
| Content-aware sweep, 5 surfaces | receipts 2, menu-editor 6, others 0 |
| Rail cap at rest, desktop | overlap +6, occluded 5 |
| Rail cap at rest, tablet | overlap -373, occluded 0 |
| `RestaurantMenuEditorScreen.css` | byte-identical to HEAD — no new CSS shipped |
| Probes | 5, all removed |
| New tests | zero |

## Two records now need reading together

| Round | Said | Correct? |
|---|---|---|
| 249 | the rail is occluded | **yes** |
| 250 | not demonstrable, reverted | the revert was wrong |
| 251 | never real, withdrawn | **wrong** — measured the skeleton |
| 252 | real, fixed, kill-test binds | **half right**: real, bounded, not fixed |
| **253** | bounded but 6px short on desktop | — |

Five rounds on one defect, and the records disagree with each other because each measured a
different thing. **The fix for that is not another measurement — it is a specification**: what
exactly must be true (no control's centre hit-tests to a `memo-*` node, with the content loaded),
asserted at BOTH profiles, before any further CSS is written.

## The next round's first step

Write that specification as the acceptance test for receipt and menu-editor occlusion, at both
profiles, with content-aware waits. It fails today on both screens. **Then** the per-profile
constant has something to satisfy, and the 6px is a number to close rather than a guess to
iterate.

> last audited 15-10-26 by docs-auditor
