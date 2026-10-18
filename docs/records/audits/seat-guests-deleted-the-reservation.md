# The third handler in the same file had the same defect, and round 292 had left it
# (round 308)

## How it was found

A commit landed in the crate this session has been editing that was not mine
(`ed1db7450`), including `TableManagementScreen.tsx` — the file I left uncommitted across
rounds 292-293 because of a foreign hunk. Checking whether my round-292 fix had survived it, I
listed the file's held-cart writes rather than trusting the memory:

```
604: await holdCartScoped(sessionToken, {
616: await deleteHeldCartScoped(sessionToken, activeBill.id);
689: await holdCartScoped(sessionToken, {
756: await holdCartScoped(sessionToken, {
799: await deleteHeldCartScoped(sessionToken, reservationBill.id);   <-- delete
800: await holdCartScoped(sessionToken, {                            <-- then hold
```

The third handler — `handleSeatReservedGuests` — **deleted before it created**, the exact order
round 292 fixed for the other two.

## The defect

Seating a reserved party converts the reservation's bill into an open bill:

```tsx
await deleteHeldCartScoped(sessionToken, reservationBill.id);   // reservation destroyed
await holdCartScoped(sessionToken, { ... });                    // replacement
```

A rejected hold — locked DB, dropped IPC, lapsed session — destroys the reservation with nothing
to recreate it, while the catch toasts only "seat failed". **The party ends up neither booked nor
seated**, and the operator has no signal that the booking is gone rather than merely unseated.

## Why round 292 missed it, which is the honest part

Round 292 fixed two handlers in this file and closed with a "Next" section naming
`releaseTableScoped`. It **did not enumerate the file's held-cart writes**; it fixed what it had
found and speculated about what to look at next. A speculative next-step list is not an
enumeration, and this third handler sat between the two that were fixed.

The lesson is the same one rounds 302-304 kept teaching at the backend: **before concluding a
class is closed, list the members of the class rather than the sites you happened to visit.**

## Reproduction first, then the fix

The test was written and run against the unfixed handler before anything changed:

```
AssertionError: expected "deleteHeldCartScoped" to not be called at all,
  but it was called 1 times
```

Then the same reorder round 292 applied — hold, then delete — and the case went green.

The discriminating assertion is the **negative** one. Asserting only the error toast would pass
against the old order, which toasts the same message *after* the damage. That is the
round-229/230 pairing rule, applied for the Nth time and still worth restating because it is
the thing that makes the case mean anything.

## Kill-tested

Restoring delete-first:

```
Tests  1 failed | 61 skipped
```

Restored; the whole `TableManagementScreen` suite is **62 passed**.

## The file is now uniformly ordered

| Handler | Order |
|---|---|
| `handleConfirmMoveTable` (604 → 616) | hold, then delete ✓ |
| `handleConfirmMergeTable` (689) | hold only |
| `handleSeatReservedGuests` (808 → 818) | hold, then delete ✓ — **fixed this round** |

## Verified

| Item | Result |
|---|---|
| New test, BEFORE the fix | **FAILED** — `deleteHeldCartScoped` was called |
| New test, after the fix | passed |
| Kill-test (delete-first restored) | **1 failed**, then restored |
| `TableManagementScreen` suite | **62 passed** |
| POS / tables / held-cart / restaurant suites | **878 passed, 62 files, 0 failed** |
| E2E: seating, reserve, move, merge | **8 passed** |
| `npm run typecheck` | exit 0 |
| eslint | 0 |
| Commit | `b32b52107` |

## Closing a loose end from round 292

Rounds 292-293 deliberately left `TableManagementScreen.tsx` **uncommitted** because it carried
another session's hunk; the fix was verified but not committed, and the audit said so. That
session's `ed1db7450` has since landed the working tree, so the round-292 fix is now in HEAD —
verified by grepping the committed file, not by assuming. The loose end is closed, and this
round's fix sits on top of it.

> last audited 16-10-26 by docs-auditor
