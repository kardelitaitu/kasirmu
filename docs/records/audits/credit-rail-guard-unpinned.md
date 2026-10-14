# The credit rail's `canComplete` guard is unpinned — and unreachable in the suite (round 114)

## What was checked

Round 113 verified the plan's last claim at HEAD (credit facility + ceiling wired
end-to-end). The BACKEND half was read with its symbols; the FRONTEND half was only
string-matched. This round kill-tested the frontend guards.

`PaymentModal.tsx:1158-1164` has three of them:

```ts
if (method === 'credit') {
  if (!customerName.trim().length) return false;
  if (!creditOffered) return false;                       // <- unpinned
  if (creditSettings?.enabled === false) return false;    // pinned
  if (creditSettings && creditSettings.maxLimitMinor > 0 && total.minor_units > ...) return false;
  return true;
}
```

## The measurement

| Mutation | Result |
|---|---|
| remove `!creditOffered` AND `creditSettings?.enabled` together | 1 failure |
| remove **only** `!creditOffered` | **129 tests pass — nothing catches it** |

So the facility guard is pinned (`PaymentModal.test.tsx:686`, *disables Credit Sale button
and shows warning when credit facility is disabled*) and the rail guard is not.

## Is it reachable, or harmless redundancy?

`creditOffered` is enforced in TWO places:

```ts
// :370 — an effect that resets the method
useEffect(() => { if (!creditOffered && method === 'credit') setMethod('cash'); },
  [creditOffered, method]);

// :1160 — the guard under test
if (!creditOffered) return false;
```

An effect runs AFTER render, and `canComplete` is a `useMemo` read DURING render — with
`creditOffered` in its dependency array (`:1187`). So in the render where the rail changes,
`canComplete` is recomputed with the withheld rail **before** the effect can reset the
method. The window is one render wide and the guard is the only thing covering it.

That makes it genuine defence-in-depth, not dead code — and it is the kind of guard whose
removal a refactor would not notice.

## Why no test exists, and what one needs

`PaymentModal.test.tsx` does not mock `useLocalPaymentRails`, so `rails` is `null` and
`coreRailWithheld` **fails open** (`useLocalPaymentRails.ts:48`, `rails === null ||
rails.length === 0` returns offered). `creditOffered` is therefore always `true` in that
suite, and the branch is UNREACHABLE there.

No suite currently mocks that hook (`grep "vi.mock('@/features/sales/useLocalPaymentRails'"
-> 0 hits). A test needs a harness that supplies a rail list with `credit` withheld and
then renders the modal — the shape `useLocalPaymentRails.test.ts` does not have, since it
exercises only the pure helpers.

## NOT done, and why

**I did not build that harness this round.** Standing one up means mocking the hook and its
IPC layer, seeding a rail list, and driving the select-then-withhold ordering that the
one-render window requires — and a test that drives the wrong ordering would pass without
touching the guard, which is the failure mode rounds 107-110 spent four rounds correcting.
Recording the gap with the exact precondition is worth more than a hurried case.

## Verified

| Gate | Result |
|---|---|
| Full suite | 12,654 passed, 0 failed |
| `tsc` | 0 |
| `PaymentModal.tsx` | restored; `scratch-kill.py` deleted; tree clean but for another lane's file |