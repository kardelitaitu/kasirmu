# The SKU-keying class is clean, verified against the backend contract — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 112 · status: NO DEFECT — the class
     swept is clean, and the reason is a documented backend contract · branch: 0.0.41 ·
     no code change -->

<!- - Scope: generalising round 111's keying defect (an identifier borrowed from a
     non-unique attribute) into a sweep. Tree verified green at 813/813 (12,902 passed)
     going in. -->

## The sweep

Round 111 found the dispatch record keyed by `sku` where `id` is the line identity. The
class is "state keyed on a non-unique attribute", so I swept for it:

```
725 source files scanned
  sku-keyed expressions: 105
  id-keyed expressions:  305
```

Filtering to maps/records **explicitly** keyed by sku left 11 sites, all hand-inspected.

## Every one is correct, and the strongest case is a written contract

| Site | Subject | Verdict |
|---|---|---|
| `MenuItemContextMenu` colour map, `RestaurantMenu` add-count ranking | a PRODUCT | correct — sku IS the identity |
| `RetailPosScreen` / `RetailCartPanel` serial-tracking map | a PRODUCT | correct |
| `StockShortfallDialog` splitMode + resolutions | a SKU, per the API | **correct by contract** |

The shortfall case is the one worth recording, because it looks exactly like round 111's
defect and is not. The backend states the design in its own doc comments:

```rust
// crates/kasirmu-core/src/sale_deduction.rs:60-63
/// A single SKU that could not be fulfilled from the resolved primary location.
///
/// Aggregated into [`PartialStockResult::shortfalls`] so the cashier sees
/// every affected line item in a single dialog.
pub struct Shortfall { pub sku: String, pub requested_qty: i64, ... }
```

and the invariant that makes it safe:

```rust
// :31
/// Sum of `qty` across all entries MUST equal the original `requested_qty`.
```

So `requested_qty` is **already aggregated across cart lines of that SKU** before the UI
sees it, and `ResolvedShortfall { sku, allocations }` is the API's own key. Keying the
dialog by sku mirrors the interface rather than inventing an identity — the opposite of
round 111, where the map was a LOCAL choice that collapsed two distinct lines.

## What distinguishes the two cases, stated once

> A key is wrong when it is **locally chosen to stand for something it cannot uniquely
> identify**. It is right when it **mirrors a contract whose own aggregation already
> collapsed the distinction.** Round 111 was the first; the shortfall dialog is the second.

The check is therefore not "does this use sku?" but "did something upstream already
aggregate on it, and does the interface say so?"

## Coverage behind the clean result

- `sale_deduction_tests.rs:672` — `plan_deductions_rejects_an_allocation_sum_that_does_not_match`
  pins the reconciliation invariant on the backend.
- `StockShortfallDialog.test.tsx` exercises the allocation cases against it.
- 103 test references to the dialog and its result types.

## Verification

- **Full suite: 813/813 files, 12,902 passed, 0 failed** (unchanged — no code edited).
- No production file was modified this round; the value is the verified negative.

> last audited 18-10-26 by autonomous-goal-round-112
