# Round 99's own comparison, one field further — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 113 · status: 1 defect fixed,
     found by continuing the round-111 verification pass over my own fixes; 2 of my own
     fixes verified CLEAN; 1 false alarm caught before acting · branch: 0.0.41 ·
     commit: `a4ac63453` -->

<!- - Scope: the residual of round 111's recommendation — re-read the shipped code of this
     session's own fixes. Tree verified green at 813/813 (12,902 passed) going in. -->

## The defect: New Tab still leaked the party size

Round 99's fix was itself found by COMPARING New Tab against the hold path, and it named
that path "the reference". Comparing them properly leaves one field that round 99 did not
carry over:

```
hold  : resetCart(), setTableNumber(''), setCustomerName?.(''),
        setGuestCount?.(''), setActiveOpenBillId(null), setAppliedPromotions([])
newTab: resetCart(), setTableNumber(''), setCustomerName?.(''),
        setActiveOpenBillId?.(null), setAppliedPromotions([])      <- no guestCount
```

`resetCart` already covers tip and service charge (usePosState.ts:398-406), so `guestCount`
is the whole gap.

**Reachable and persisted**, which is what makes it worth a round rather than a nit: the
field renders for dine-in (CartPanel.tsx:931-943), and the hold path's deps array (:324)
shows `guestCount` is READ when a tab is saved — so the leaked party size is written onto
the next order. **Two of the three reset paths clear it** (the after-sale reset at
PosScreen.tsx:871 and the hold path); New Tab was the outlier.

**Measured:** `setGuestCount` was called 0 times before the fix.

## Two of my own fixes verified clean

The pass was not only looking for faults, and saying so matters:

- **Round 104's split toggle** (`SplitBillModal.tsx:100-107`). I suspected `current === maxQty`
  fell through to `maxQty` instead of `0`, which would have made the line undeselectable.
  **I was wrong** — the truth table is `0 -> max`, `partial -> max`, `full -> 0`, which is
  the intended three-state toggle. Caught before I acted, which is the third time this
  session a suspected defect did not survive checking.
- **Round 108's kiosk `endSession`.** Both timer paths (`resetIdle` and the mount effect)
  route through it, every install clears its predecessor or has a cleanup, and the mount
  effect lists `endSession` in its deps. No double-timer leak.

## Why round 99 stopped one field short

Round 99 compared New Tab against the hold path by FIELDS IT CLEARED, and `guestCount` was
in neither list because the comparison stopped at the fields the original bug report named.
The generalisation:

> When one reset is made to match another, diff the two **whole bodies**, not the fields the
> bug report happened to mention. The same is true of the reverse direction — the field set
> is the contract, and a partial diff finds a partial fix.

## Verification

- **Full suite: 813/813 files, 12,903 passed, 0 failed** (3 skipped, 3 todo).
- The new case fails pre-fix (`Number of calls: 0`) and passes after; **kill test** removes
  the reset and fails it; file restored byte-identical.
- `npm run typecheck` 0 errors — it rejected a `releaseLease` prop my first draft invented,
  the same trap as rounds 103 and 104.
- `npm run lint` 0 errors; `npm run lint:i18n` clean.

> last audited 18-10-26 by autonomous-goal-round-113
