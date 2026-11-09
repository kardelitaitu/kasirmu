# The kitchen chord is safe, a comment was stale, and my own test leaked into another file

Date: 2026-10-18 (round 130). Commits: `764f116e0` — *docs(sales): correct the
split-bill coverage note made stale by round 129*; `ad2f1f89e` — *test(sales): pin that
a double Send-to-Kitchen chord dispatches once*.

## Finding 1 — a comment my own round had falsified

`PosScreen.tsx:1053-1057` read: *"Displaying it needs `activeOpenBillId` set, and that
is only ever set by resuming an open bill (usePosHeldCarts.ts:418), which no case in
the file does."* That was measured-true when written. My round-129 test resumes a real
tab, so it is now false.

Corrected, and while checking the replacement I nearly wrote a second wrong claim: the
first draft said "this handler's own delete is still unpinned". It is not —
`heldCartReplacementOrder.test.ts` grades hold-before-delete across four sites
including this one, deliberately, because reaching the handler needs the whole POS. The
committed wording says that instead.

## Finding 2 — the Send-to-Kitchen chord is safe, by a different mechanism than assumed

`handleSendToKitchen` has no re-entry ref, and `sendingToKitchen` is read only to
disable the button (`CartActionBar.tsx:220`). Its comment at :1811 calls the shortcut
handlers 'self-guarding'. There are two entry points and the hotkey
(`send-kitchen` = **Shift+K**, PosScreen.tsx:1835) never touches the DOM, so this looked
like the round-124/126 class.

MEASURED, one chord at a time:

```
after 1st chord: dispatch=1, button disabled=true
after 2nd chord: dispatch=1, button disabled=true
```

One dispatch. The protection is the empty-delta early return at `:1195-1198`: the second
chord arrives while the first dispatch is in flight, recomputes its delta from `lines`
and finds nothing to send. That is a real guard — incidental, but real — so the code is
correct and the new case pins it rather than a fix.

**The kill test for it does not exist.** Three attempts were made and all three stayed
GREEN, i.e. measured nothing:

| Kill | Result |
|---|---|
| remove `disabled={sendingToKitchen}` | RED — but only for the BUTTON path, not the chord |
| drop the `return` in `useRestaurantShortcuts` | GREEN — does not change single-dispatch |
| do not advance `dispatchedQty` in the write | GREEN — the second chord fires while the FIRST is still in flight, so `lines` has not advanced either way |

The third is the informative one: it shows the guard is the in-flight window, not the
bookkeeping, and that the assertion window I chose cannot distinguish the two. The case
is therefore landed as CHARACTERIZATION — it states what is true and names the mechanism
in its own comment — not as proof that a specific line prevents a specific failure.

## Finding 3 — my test leaked into another file, and the full suite caught it

The full run showed a FIFTH failure: `TableManagementScreen.test.tsx` > 'does not
clobber a section change that lands during a pending mutation'. Isolated, that file
passes 75/75; the two files together pass; and removing MY file from the full run
restores 4 failures. So my case leaked state across files.

The cause is one this file already documents at length (:488-516): a `vi.fn()` from a
`vi.mock` factory keeps its IMPLEMENTATION across cases, and a queued
`mockResolvedValueOnce` survives even `clearAllMocks`. The file's `beforeEach` reset the
mocks its own cases override — but the three my open-bill case overrides
(`listOpenBillsScoped`, `getHeldCartScoped`, `printSalesReceipt`) were not in that list.
Added, with the measurement recorded beside them. Full suite back to the baseline 4.

## Verification

* `npm run typecheck` clean; `npm run lint` 0 errors (114 pre-existing warnings).
* Full suite: `810 passed | 3 failed (813)` files, `12905 passed | 4 failed` tests — the
  same four `TableManagementScreen`-CSS failures from commit `4347b36d2`, another lane.
  This round adds one test.
* The stale comment is corrected in `764f116e0`; the case and the leak fix are
  `ad2f1f89e`.

## What this round is worth

One stale comment fixed, one characterization test added, one real self-inflicted
leak found and repaired. No production defect — the two candidates I chased (the chord
double-fire, the split handler's delete) were both already safe.

The transferable part is Finding 3. The file's own comment predicted the exact failure
mode, I read it while adding the case, and still hit it — because the list it names is
of mocks THAT FILE'S CASES override, and I extended the file without extending the list.
A documented invariant is not enforced by having been read.

> last audited 18-10-26 by docs-auditor
