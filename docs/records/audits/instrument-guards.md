# The acceptance instrument detects real occlusion, and the scan's second measure had no floor (round 272)

## Two instruments, two questions

Round 271 found a probe that lacked the spec's own clip rule. That raised the reverse question for
two instruments: **does the acceptance test detect a REAL occlusion, and is the scan's new `used`
measure guarded?**

## The acceptance instrument: it does

Round 255's column caps were removed — the genuine defect state — and the acceptance spec:

```
1 failed   the kitchen chit button is clear of the memo stack on the receipts screen
```

Restored, `RESTORED_TO_HEAD`, and re-run to **2 passed**.

**So the clip walk is a filter, not a bypass.** Round 271 established that the spec ignores a
control clipped by its own column; this round establishes that it still FAILS when the control is
genuinely covered. The two together are what make the claim `\"clear of the memo stack at rest\"`
meaningful rather than vacuous — and that is now measured from both directions.

## The scan's `used` measure: it had none, and now does

`SELECTOR_CALL` was replaced with a pattern matching nothing. Every `used` count collapsed to 0-2
and **the script still exited 0**:

```
screen        covered   used   pct
receipts      12/15    0/15     0%      <- exit 0
```

The `covered` measure has carried `SELF_CHECK_ID` since round 226. The measure added in round 270
did not, and a broken measure that reports silently is worse than no measure — **the number is read
as a finding.**

A floor now guards it:

```python
total_used = sum(r['used'] for r in rows)
if total_used < USED_FLOOR:   # 50; measured healthy value is 200+
    print('REFUSING TO REPORT: the used measure found only %d selector uses.' % total_used)
    return 1
```

**Kill-tested**: the same mutation now refuses and exits 1 with the reason.

A FLOOR rather than a target: it need only be high enough that a collapsed measure cannot clear it,
and 50 is far below the healthy 200+ and far above zero. A floor set near the real value would fail
on legitimate corpus shrinkage, which is the opposite of what a guard is for.

## Verified

| Item | Result |
|---|---|
| Acceptance spec, caps removed | **1 failed** — detects real occlusion |
| Acceptance spec, restored | 2 passed |
| `RestaurantSettingsScreens.css` | `RESTORED_TO_HEAD`, byte-identical |
| Scan, measure broken | exits 1 with the reason |
| Scan, healthy | exit 0, self-test passes, both columns agree |
| `kill-test` leftovers | 0 |
| Full UI suite | 12,716 passed |

## The instrument ledger

| Instrument | Built | Self-guard |
|---|---|---|
| coverage scan, `covered` | round 226 | `SELF_CHECK_ID` |
| ~~the view-gated split~~ | round 261 | none needed — it only RELABELS ids, it cannot overstate coverage |
| coverage scan, `used` | round 270 | **`USED_FLOOR`, round 272** |
| acceptance `occludedControls` | round 255 | **the spec itself, proven both ways in 271-272** |

**Three of the four now carry a guard, and the fourth is argued rather than guarded** — the
view-gated split subtracts ids from `missing` and adds them to a separate list, so a mistake there
moves a name between two printed columns rather than inflating a percentage. That is a weaker
failure mode, and it is recorded as such rather than given a guard it does not need.