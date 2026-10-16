# The blind-window sweep: 13 guards, 0 blind, and one false positive of mine — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 119 · status: NO DEFECT — the
     windowed-guard class is clean · branch: 0.0.41 · no code change -->

<!- - Scope: the sweep round 118 recommended after the blind-window defect bit twice
     (rounds 114 and 118). Tree verified green at 811/811 (12,889 passed) going in. -->

## The method, validated before it was believed

A windowed guard is blind when the assertion's target falls OUTSIDE its window — the
guard then passes on nothing. The check: take the anchor the test uses, slice by its width,
and measure where the target actually lands.

**Validated on the known case first.** The round-118 window (`at + 700`) reports BLIND with
the target at offset 864 — which is exactly what I fixed. Two healthy controls pass with
their targets at offset ~36. A method that does not flag the known case measures nothing.

## The result: 13 guards across 9 files, 0 blind

```
contextMenuEscapeGuard:49          400  OK — target at +36
contextMenuEscapeGuard:81          300  OK — negative assertion, prints the branch
KioskScreen:216                     400  OK — negative assertion working
PaymentModalOpenBillIdentity:46     800  OK — target at +674
PaymentModalOpenBillIdentity:62     800  OK — target at +4
posDispatchRecord:221              9000  OK — target at +3381 (widened in round 114)
posHookTokenGuardReports:92         300  OK — both targets inside
PosScreenKitchenChitTable:33       3500  OK — target at +1317
PosScreenOrderTypePersistence:68    200  OK — brace-balances instead of windowing
PosScreenTableRelease:60            120  OK — target at +35
PosScreenTableRelease:91           6000  OK — target at +3924
PosScreenTableSyncReporting:35      900  OK — target at +583
ReceiptPreviewGroupingParity:80    1400  OK — anchor and target are the same string
```

## A false positive of my own, and what it cost to catch

Two of the thirteen reported blind on the first pass.

**`KioskScreen:216`** — the target is `kiosk-pay-success` and it is absent from the window
**because round 110 removed it**. The guard is a NEGATIVE assertion (the success claim must
NOT appear), so absence is the pass condition. Reporting it needed reading what the test
asserts, not just where a string sits.

**`posHookTokenGuardReports:92`** — this one was my error outright. The test anchors on
`useEffect` AFTER a `handlerEnd` it derives two lines earlier; I used the first `useEffect`
in the whole file. Re-implementing the anchor exactly as the test does puts both targets
inside the window. I nearly filed a blind guard that was healthy, from a sloppy
re-implementation — the same failure mode as rounds 110 and 115, caught this time by
checking my own measurement before acting on it.

**The lesson that generalises:** verifying a guard requires reproducing ITS anchor, not
guessing a nearby one. Two of thirteen looked broken purely because I guessed.

## What the sweep does establish

The class is small and each guard carries either a tight anchor (a specific literal whose
following lines are short), a window an order of magnitude wider than the offset (9000 vs
3381), or an assertion that PRINTS what it found (`Arm found: …`, `Deps: …`) so a future
blind window would be visible in the failure output rather than silent.

That last property is the durable protection, and it is worth naming: a guard whose failure
message quotes the text it scanned cannot go quietly blind.

## Verification

- **Full suite: 811/811 files, 12,889 passed, 0 failed** — no code changed.
- The measurement is reproducible from this record: anchor, width, target offset per guard.

> last audited 18-10-26 by autonomous-goal-round-119

