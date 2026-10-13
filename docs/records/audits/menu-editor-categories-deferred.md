# The empty categories are a recorded deferral, not an oversight (round 127)

## What round 126 concluded, and what the code says

`menu-editor-empty-categories.md` (round 126) found seven retail categories in the restaurant
menu editor's rail and called the mock's shape the defect. **The tree already carries the
decision**, and it is not an oversight.

`dev-mock/core/mockSeedData.ts:108-127`, immediately above `MOCK_CATEGORIES`:

> *The restaurant half was MISSING until 2026-10-08, and its absence was a real defect rather
> than an omission: the catalogue fixtures carry four restaurant categories by name ... and
> `ProductDto.category` is a NAME, so every one of those products pointed at a category that
> did not exist. A screen that joins products to categories ... then had nothing to join to in
> the preview, so the menu looked empty while the products were plainly there.*
>
> *The retail entries still carry ids that set does not define (`cpu-1`, `gpu-1`…), so they
> render as no glyph at all... **They are left as they are here because changing them is a
> separate decision about the retail demo, not a side effect of adding the restaurant half.***

So the seven retail categories were shown to their author, understood as a consequence, and
explicitly deferred with a reason. Round 126 filed that as a discovered defect.

## Why the deferral is sound

The two fixes round 126 proposed both fail against the code:

| Proposed fix | Why it fails |
|---|---|
| serve restaurant-only categories to the restaurant workspace | `RetailPosScreen.tsx:559/:611/:639` joins products to categories from the SAME `list_categories` result. Removing the retail seven breaks the retail grid's `categories.find((c) => c.name === ...)`. |
| filter the editor's rail to categories that hold items | hides a legitimately empty category — `cat-snack` is seeded, restaurant-owned, and has 0 items today. A filter keyed on item count hides a category the operator just created. |

The second is the sharper objection, and round 126 raised it against its own proposal without
following it through. `Snack` is the counter-example sitting in the same screenshot: an empty
restaurant category that MUST stay visible.

## What the deferral leaves on the table

A third option neither record has costed: **give `MOCK_CATEGORIES` a workspace scope and have
the mock router filter on it.** The categories are mock-only data, the router already knows
the workspace (`handlers/workspaces.ts:73`, `{ key: 'restaurant-pos', name: 'Restaurant POS' }`,
and `mockSeedData.ts:210` binds `ws-2` to `type_key: 'restaurant-pos'`), and filtering there
would fix the rail without touching the editor's behaviour or the retail grid.

That is a change to the dev-mock's fidelity, not to the product, and it is not what round 126
described. Recording it as the option with the least blast radius.

## The corrected finding

Round 126's OBSERVATION stands: seven clickable categories in the restaurant menu editor are
permanently empty, and an operator sees a rail roughly twice the size of their menu. The
ATTRIBUTION does not: this is a known, documented trade-off in a dev-only fixture, not an
error in the editor and not reachable with a real store database.

The consequence for priority: nothing here affects a merchant. The mock's fidelity affects
what the preview and the E2E specs exercise.

## Verified

| Item | Result |
|---|---|
| The deferral is recorded in-tree | `mockSeedData.ts:122-127` |
| Retail joins by name to the same list | `RetailPosScreen.tsx:559`, `:611`, `:639` |
| An empty restaurant category exists | `cat-snack`, seeded, 0 items |
| Mock workspace identity available | `workspaces.ts:73`, `mockSeedData.ts:210` |
| Tree | no source changed this round |