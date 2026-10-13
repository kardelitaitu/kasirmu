# ROOT CAUSE: the scanner is disabled on restaurant-pos, so the case only passed on a leak

## The finding

`PosScreen.tsx:566-568`:

```ts
// ── Barcode scanner integration ─────────────────────────────
// Disabled on restaurant POS workspace (scanners are for retail checkout).
useBarcodeScanner({
  enabled: activeWorkspace !== 'restaurant-pos',
```

`PosScreenCoreFlow.test.tsx`'s case `ignores a slower course-firing read from the
previous store` sets `wsState.activeWorkspace = 'restaurant-pos'` (it must: the course bar
is gated on that workspace) and then gives the cart a line **by scanning**.

**On that workspace no scan handler is ever registered.** The case never worked; it passed
because the mock keeps ONE module-level slot, and a RETAIL case earlier in the file left
its registration in it. The leaked registration silently answered the scan.

That is the whole story of the two failing shuffle seeds, and it is more specific than the
slot race recorded in round 95: the slot race is real, but this case could not have worked
on its own in any order.

## How it was found

Round 95 established: the scan fires, the slot is occupied, `handleBarcode` never runs.
Round 96 probed `useBarcodeScanner`'s registrations with an owner flag and saw
**`owner=false` on every registration near the failure** -- and no registration at all
during the case's own render, after a `claim()` cleared the slot. An empty slot plus
`slotSet=true` before the claim can only mean the callback came from an earlier case.

The `enabled` flag at `:567` explains it exactly.

## The correct fix, and what was tried

The line must reach the cart WITHOUT the scanner. `pos-active-draft` is the mount-time
restore path (`PosScreen.tsx:185-247`) and is what the two `restores active draft` cases
already use; seeding it before the render needs no scanner and no workspace exception.

**Not shipped.** Seeding the draft was implemented and moved failures around rather than
removing them -- seed 2 went from 1 failure to 2 -- and the change was REVERTED to HEAD
rather than left in a worse state. `git status` on both files is clean.

## What to try next

1. Seed `pos-active-draft` before the render (as attempted) and then re-check whether the
   two `restores active draft` cases need their own cleanup, since they also write that
   key -- the interaction is the likely cause of the 1 -> 2 regression.
2. Alternatively split the case: assert the course-bar container under `restaurant-pos`
   with no cart line by using a DIFFERENT observable. The container needs
   `lines.length > 0`, so this may not be available -- check `CartPanel.tsx:961` before
   assuming.

## Why this took four rounds

Each earlier round fixed what the failure looked like rather than what it was:

| Round | Fixed | Why it did not hold |
|---|---|---|
| 88 | a bare `act()` race | not the cause |
| 90 | a 1000ms timeout | not the cause |
| 91 | the shared once-value | real, but a second-order effect |
| 94 | the missing `setSettingScoped` | a real defect, unrelated to this case |
| 95 | named the slot race | correct, but one level above the cause |

The cause is a single line of production code (`enabled:`) and a test that used the wrong
machinery for its workspace. **Reading `enabled` first would have found it in round 88.**