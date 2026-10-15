# Session close: rounds 221-256 on restaurant POS (round 256)

## Why a closing record

This is round 256 of 256. Thirty-six rounds produced 35 audit records, each about one finding, and
**none of them is readable as a whole.** A reader arriving at the directory sees 35 files and no
map. This is the map: what the session set out to do, what it found, what it got wrong, and what
is still open.

## The objective

> continue the development of the codebase. proceed carefully. always test and commit your changes.
> focus on restaurant-pos and its components usability and reliability

Open-ended by design. The session interpreted it as: **find and fix defects in the restaurant POS
surface, prove each with a test that fails without the fix, and leave a record.**

## Defects found and fixed

| Defect | Where | Round |
|---|---|---|
| the tablet cart sheet stacked ABOVE every modal | `RestaurantCartSheet.css` | 243 |
| the section filter narrowed the counts, not the floor plan | `TableManagementScreen.tsx` | 244 |
| the workspace settings modal threw — no `SettingsProvider` | `WorkspaceSettingsModal.tsx` | 231, 232 |
| two cards never received `sessionToken`, so never read | `WorkspaceSettingsModal.tsx` | 237 |
| the F4 latch was set before its read (three cards) | the three workspace cards | 235, 238 |
| the memo stack covered the receipts drawer and the menu rail | two stylesheets | 255 |

**Six defects, eleven commits, and a kill-test behind each one.**

## Coverage moved

| Screen | Session start | End |
|---|---|---|
| tables | 62% | **86%** |
| receipts | 60% | **73%** |
| payments | 25% | **44%** |
| settings | 67% | **83%** |
| editor | 81% | 81% |

New specs: **24**. Full suite: **12,716 passed**, from 12,709.

## What the session got wrong, and it is the largest section

**Eleven measurement errors across twelve rounds**, and they cluster into one class the session
eventually named: *the probe read at the wrong moment, or with the wrong instrument*.

| Round | Claimed | True |
|---|---|---|
| 222 | receipts at 5/15, the weakest screen | the scan could not see templated testids |
| 224 | the EDC block is unreachable | it is a custom dropdown; the probe looked for `<option>` |
| 231 | the F4 card guard works | the modal threw before rendering it |
| 249 | menu rail occluded | right finding, mid-transition measurement |
| 250 | not demonstrable — reverted | the revert was wrong |
| 251 | never real — withdrawn | measured the rail's 128px skeleton |
| 252 | fixed, kill-test binds | bounded, not fixed |
| 253 | 6px short | right, and the sweep was still mid-transition |

The single most expensive was round 251: it **withdrew a real defect** on a reading of a state that
had not loaded, and round 252 had to reverse it. Both rounds wrote confident records.

## The three rules the session earned

**1. Wait for the thing whose size you are measuring.** Not for its container. A `toBeVisible()`
on a wrapper proves nothing when the children that give it height arrive later (round 252).

**2. An empty reading is evidence about the instrument until the instrument is shown able to see a
positive.** Rounds 175, 218, 224 and 225 each read an absence as a fact about the product. The
coverage scan now refuses to report when its self-check fails.

**3. State the property before writing the CSS.** Rounds 249-253 wrote five CSS variants against
measurements that disagreed. Round 254 wrote the acceptance specification; round 255 satisfied it
in two lines.

## Where the work deliberately stopped

| Surface | State | Why |
|---|---|---|
| `pos-cart-conflict-alert` + takeover | not covered | needs **two terminals** — re-verified this round: `getConflict` requires `lease.terminalId !== currentTerminalId` |
| payments credential forms | partly covered | the credential **boundary** is covered (228, 229); the Midtrans/Stripe field-by-field entry is not |
| receipts header chrome | not covered | static title, icon and back button |
| settings/editor icons | not covered | same |

**The conflict alert is the one worth naming as genuinely blocked**, because it is behavioural and it
has now survived four separate re-examinations (rounds 216, 233, 242, 256) with the same answer.

## What a next session should read first

1. **This file** — the map.
2. `three-instrument-failures.md` (round 226) — the measurement-error taxonomy, with the tell for each class.
3. `memo-clearance-closed.md` (round 255) — the worked example of how the session finally got one
   right, after five rounds of getting it wrong.

Those three carry the transferable part. The other 32 records are the evidence behind them.

## Verified at close

| Item | Result |
|---|---|
| Working tree | all session files committed |
| Full UI suite | 12,716 passed |
| This session's records | 35 of 35 present |
| Kill-test leftovers | 0 |
| Probe files | 0 |

## The honest summary

**Six real defects fixed, seven real defects found and characterised, twenty-four specs added — and
eleven measurements that were wrong before they were right.** The measurement errors are not noise
around the work; they are the larger part of it, and rounds 226 and 254-255 are where the session
finally learned to build instruments that prove themselves first.

The objective is open-ended and the goal is left **active** at its round limit rather than marked
complete: the restaurant surface still has uncovered behavioural controls (the conflict alert,
the gateway credential fields), and "continue the development" does not terminate.

> last audited 15-10-26 by docs-auditor
