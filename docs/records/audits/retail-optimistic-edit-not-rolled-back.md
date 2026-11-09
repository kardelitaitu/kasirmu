# The optimistic EDIT, not rolled back — the third copy of the same defect

**Date:** 2026-10-11 · **Round:** 54 (session) · **Status:** FIXED
**Area:** `ui/src/features/retail/RetailPosScreen.tsx` — `handleSaveProductEdit`

## The defect

`handleSaveProductEdit` (:547) does three things BEFORE attempting the write:

```ts
const prev = products.find((p) => p.sku === updatedProduct.sku);   // :548
setProducts((prevList) => prevList.map((p) => (p.sku === updatedProduct.sku ? updatedProduct : p)));  // :549
invalidateCatalog(sessionToken);                                    // :553
setEditingProduct(null);                                            // :554
try { await updateProductScoped(...) }                              // :560
catch (err) { addToast({ ... 'retail-toast-save-product-failed' }) } // :590
```

The catch toasts and **never restores the old values**. So a refused edit — permission,
validation, dropped connection — leaves the grid showing the operator's new name and price
while the server still holds the old ones. The stale row persists until the next reload,
by which time the toast is long gone and the discrepancy looks like data corruption.

**`prev` is captured at :548 for exactly this rollback, and was never used.** The
optimistic-update pattern was written correctly and then only half-finished.

## Fix

```ts
} catch (err) {
  if (prev) {
    setProducts((prevList) => prevList.map((p) => (p.sku === prev.sku ? prev : p)));
  }
  addToast({ ... });
}
```

## This is the third instance of one defect

| Round | Handler | Optimistic action | Rollback |
|---|---|---|---|
| 52 | `handleSaveNewProduct` | prepend the new product | **none** → fixed |
| 52 | `handleSaveNewCategory` | append the category | **no write at all** → fixed |
| 54 | `handleSaveProductEdit` | replace the product | **none** → fixed here |

All three are in the same file, within 90 lines of each other, and all three were written
under the same ADR #36 pass. The pattern is not "retail is careless" — it is that an
optimistic update is a THREE-part contract (apply, attempt, undo-on-failure) and these
implementations stopped after two.

## Evidence

New test — *restores the previous product values when the edit is refused*. It edits the
first product through its own card control, rejects `updateProductScoped`, and requires
both that the rejected value is gone AND that the original is back.

**RED before the fix**: `EDITED NAME` present on screen after the refusal. **Kill-tested**
by removing the rollback line — red again, green on restore.

- `RetailPosScreenInteractions.test.tsx` **47 passed** (was 46)
- full UI suite **807 files, 12,819 passed**
- `typecheck` clean · `eslint` no new findings

## The sweep, and what it cost me

I found this with a detector for *a state setter before an `await`, inside an async handler
whose catch has no compensating setter*. **The first version returned zero hits —
including on the very defect it was written to find** — because it only looked for setters
INSIDE the `try`. This handler sets state in the prologue, before `try` opens. Widening the
window to the whole handler head turned the same sweep into 9 candidates.

A detector that cannot find the known case is not evidence of absence, and running it once
would have produced a confident, wrong "none found". Recording it because the failure
mode is the one this whole campaign keeps hitting: **a green result means nothing until the
check has been shown to go red on a known-bad input.**

## The other 8 candidates, checked and clean

| Site | Verdict |
|---|---|
| `StockCountHistory.tsx:76` | clears `setSelectedLines([])` in the catch — the rollback is there |
| `ProductLookupScreen.tsx:169` | the setter runs on the SUCCESS path only (`setBarcodeInput('')` after a hit) |
| `RetailPosScreen.tsx:847,861` | SKU/scan inputs; the catch reports and the input is intentionally kept for retry |
| `usePosHeldCarts.ts:202` | body is a busy flag; the `finally` resets it |
| `useAutoQr.ts:124` | the catch explicitly voids the pending sale it created (:146-149) |
| `TableManagementScreen.tsx:521,567` | busy flags, `finally`-reset |

## Related

- `retail-optimistic-writes-not-rolled-back.md` (round 52) — the add path and the categories.
- `mockfactory-gap-list-as-coverage-map.md` (round 53) — why no test could reach these.

> last audited 11-10-26 by docs-auditor
