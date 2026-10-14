# Round 151's corrected note cited a path that no longer exists (round 152)

## The chain

Round 151 corrected `RestaurantMenu.tsx`'s storage-tiers comment, which claimed the 86 list
was terminal-local. The corrected text still cited the upstream review as
`.agents/resto-pos-ui-review.md` — a path that had **moved** to `.agents/reviews/`.

**Three files carried the old spelling**:

```
ui/src/features/restaurant/RestaurantMenu.tsx:77   (the one round 151 wrote)
ui/src/__tests__/CartLineItem.test.tsx:30
ui/src/__tests__/restoPosReviewAccuracy.test.ts:36  (correct)
```

`check-dead-refs.py` polices this for **docs** and found nothing, because all three are
**source comments**. Nothing policed it for source.

## The guard I wrote, and removed

A `restaurantCommentPaths.test.ts` that resolved every repo-relative path in a restaurant
comment. It fired immediately on **six** citations, and reading each showed my matcher was
wrong, not the tree:

| Citation | Why it is not a violation |
|---|---|
| `shared-ui/locales/*.ftl` | a GLOB — names a set, no single file satisfies it |
| `ui/src/features/<feature>/register.tsx` | a TEMPLATE — describes the per-feature convention |
| `ui/src/features/x/X.css` | an explicitly synthetic planted violation |
| `SetupWizard.css:625` | the deleted sheet the suite exists to keep buried — dangling is the claim |
| `ui/src/components/UpdateBanner.tsx` | a **real** stale path — see below |

Each widened the skip rules a little, and four exceptions for six hits is not a guard — it is
a baseline with extra steps. **Deleted it** rather than ship an exemption list that would
either rot or train readers to ignore it.

## What the guard DID earn, on the way out

The one real hit: `appUpdateBanner.test.tsx:4` cites a dead twin at
`ui/src/components/UpdateBanner.tsx` and says there are TWO UpdateBanner components.

**The twin is gone.** Measured: the only `UpdateBanner` files under `ui/src` are
`app/UpdateBanner.tsx`, `app/UpdateBanner.css`, and this test. The component and its
`UpdateBanner.test.tsx` were both retired. So the header is stale on three counts — the
file, its test, and the framing — and the suite is now simply the shipped banner's.

Corrected the header (6 cases still pass), and fixed the moved path in both other files.

## Verified

| Item | Result |
|---|---|
| `RestaurantMenu.tsx:77` | `.agents/reviews/` — verified present |
| `CartLineItem.test.tsx:30` | `.agents/reviews/` |
| `appUpdateBanner.test.tsx` | header rewritten; 6 passed |
| over-broad guard | deleted |
| Full UI suite | 12,670 passed, 0 failed |
| `tsc` | 0 |