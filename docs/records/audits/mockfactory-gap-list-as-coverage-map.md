# `KNOWN_GAPS` is a coverage map: which of those names a production component actually calls

**Date:** 2026-10-11 · **Round:** 53 (session) · **Status:** GUARD ADDED (no defect this round)
**Area:** `ui/src/__tests__/mockFactorySurface.test.ts`

## Where this came from

Round 52 found a retail defect whose *cause* was a mock-factory gap:
`createCategoryScoped` sat on `createRetailProductsApiMock`'s `KNOWN_GAPS` list, so the
factory had no such key, so no suite routing through it could call the function — and the
screen never called it either. **The gap and the defect were the same omission.**

The recorded lesson was that a gap list is a coverage map and should be read as a suspect
list. This round tested that claim against the whole ledger.

## What the sweep found

For each of the 60-odd gap names, I checked whether any non-test file calls it. Then I
checked whether the *calling screen's* suite routes through the gapped factory.

The answer is: **many gap names ARE reachable, and that is largely fine.** A gap only
throws when a suite mocks the module through the factory AND exercises the call. Most
reachable gaps are covered by a screen that hand-rolls its own mock:

| Reachable gap | Calling screen | Why it is not a live defect |
|---|---|---|
| `setSettingsScoped` (settings) | 4 workspace cards | each card's suite hand-rolls `@/api/settings` |
| `getShiftReportScoped`, `createCashPayoutScoped` | `ShiftManagementScreen` | its suite hand-rolls `@/api/shifts` (:25-38) |
| `createCategoryScoped` (products) | `CategoryManagementScreen`, menu editor | both suites hand-roll, and both are asserted |
| `printKdsChitScoped`, `publishCourseFiredScoped` | `PaymentModal` | `PaymentModalSaleFlow` hand-rolls `@/api/kds` |

So the round-52 case was not "a gap implies a defect". It was "a gap implies **no test can
make this call from that factory**", and the retail case had no hand-rolled alternative.
**No new defect was found this round**, and I am recording that rather than stretching a
weak finding to fill the round.

## What was added

`mockFactorySurface.test.ts` already asserted the gap SET for equality, so the list is
accurate. What it could not say is which entries are *reachable* — the property that made
round 52 findable.

A new case measures that. It scans every non-test `.ts`/`.tsx` under `ui/src` for call
positions, then asserts the set of reachable gap names equals a recorded map. The map does
**not** demand the gaps be closed — plenty are legitimate and documented per-entry. It
requires each to be *named*, so the next reader sees "these gaps are live calls" rather than
"these gaps are paperwork".

Writing the map immediately corrected my own under-count: I listed 8 groups, the scanner
measured 10. It found that the **retail currency** factory is missing seven names production
calls (`convertMinorUnits`, `formatExchangeRate`, `reciprocalMillionths`, …) and the
**retail products** factory is missing five more beyond `categoryScoped`
(`productsClearImageScoped`, `productsListImagesScoped`, `productsSetImageScoped` — all
called by `EditProductModal`). Those are now recorded facts rather than an assumption.

## Evidence

**Kill-tested.** Adding a real production call to `printEdcSettlementSlipScoped` — the one
gap name the ledger documents as having ZERO callers (`mockFactorySurface.test.ts:302`) —
made the case fail and name it:

```
AssertionError: the set of REACHABLE gap names changed...
+     "printEdcSettlementSlipScoped",
```

Reverted; `git hash-object` confirms `RetailPosScreen.tsx` is byte-identical to HEAD, so the
kill-test left no residue.

- `mockFactorySurface.test.ts` **28 passed** (was 27)
- full UI suite **807 files, 12,818 passed**
- `typecheck` clean · `eslint` clean

## Leads examined and found clean (recorded so they are not re-walked)

- **Category writes outside retail** — `createCategoryScoped` / `updateCategoryScoped` /
  `deleteCategoryScoped` are properly called and asserted in `CategoryManagementScreen`
  and `RestaurantMenuEditorScreen`. Round 52's defect was retail-only.
- **Shift-close money sign** — `cashDifferenceMinor` is `closing - expected`
  (`kasirmu-core/src/db/shifts.rs:126`), and the Over/Short ternaries at
  `ShiftManagementScreen.tsx:996,1108` match that convention.
- **Float arithmetic on money** — the only hits were chart axis bounds in
  `MenuEngineeringScreen.tsx:266,271` (`* 1.15` on a volume threshold), which is a display
  heuristic, not money movement.
- **`usePosCartActions.ensureCart`** — its inner catch has a deliberate, documented fallback
  (:102-119); the outer catch reports. Both correct.

> last audited 11-10-26 by docs-auditor
