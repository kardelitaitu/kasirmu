# The tab park cycle, and the defect two rounds misread (round 215)

## What rounds 213-214 thought they saw

Round 213: Save Tab produces nothing, because the shift precondition is unmet.
Round 214: the shift IS open, but Save Tab still produces no banner — and the spec was removed.

Both were reading a working feature as a broken one. The probe that settled it:

```
CLOSE_SHIFT=1                          <- a shift IS open (round 213's premise was wrong)
LINES=1   TOTALS=["Subtotal", "Rp 45.000"]
TOAST_AFTER_300=["Tab for Table 12 saved 02:21:08 AM", ...]   <- SAVE TAB WORKS
BANNER=0   LINES=0                      <- the cart emptied
HELD=[{"id":"held-mock-…","label":"Table 12", …}]        <- the tab persisted
```

Round 214 missed the toast because it polled `[class*=toast]` **after** the toast had gone.
What it read as "no dialog, no banner, nothing happened" was a successful save whose
confirmation had already faded.

## The model, which is deliberate

A saved tab is **PARKED**, not open. `handleOpenBill` (`usePosHeldCarts.ts:301-306`):

```ts
const wasUpdating = !!activeOpenBillId;
resetCart();
setTableNumber('');
setCustomerName?.('');
setGuestCount?.('');
setActiveOpenBillId(null);        // <- deliberately cleared
...
addToast({ message: wasUpdating ? 'pos-toast-bill-updated' : 'pos-toast-bill-saved' });
```

The cart empties so the next order can start, and the tab waits in the Open Bills list. The
`pos-active-tab-banner` tracks a **RESUMED** tab, which is why expecting it straight after Save
Tab was wrong in two consecutive rounds.

An empty cart plus no banner after a save is **the feature working**. The round-214 record called
it "every precondition satisfied and the click still raises nothing" — the click raised a toast,
wrote the tab, and did exactly what it should.

## What the spec pins — 2 passed

`restaurant-open-bills-cycle.spec.ts`:

| Case | Asserts |
|---|---|
| the park | no badge with no tabs; after Save Tab the cart is EMPTY, the table field is cleared, and the badge appears counting 1 |
| reopening | the badge opens the list, which names the tab ('Table 12', via `heldCartLabel` — not 'Table Table 12') |

The first assertion is deliberately two-sided: an empty cart alone would pass on a screen that
simply lost the order, so the badge appearing alongside it is what proves the tab was PARKED
rather than dropped.

**Kill-tested**: removing `resetCart()` fails the park case. Restored byte-identical.

## Verified

| Item | Result |
|---|---|
| New spec | 2 passed, 2 skipped (portrait) |
| Kill-test | 1 failed, the park case |
| `usePosHeldCarts.ts` | unchanged, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,709 passed |

## The shape, for the third time this session

**A probe that reports "nothing happened" is usually reporting that it looked at the wrong
moment.** Round 214's toast had faded; round 213's `OPEN_SHIFT=0` meant a shift was open. Both
times the code was right and the measurement window was wrong — which is the same lesson as
rounds 177 and 205, and the reason the probe is now reading state rather than absence.

> last audited 14-10-26 by docs-auditor
