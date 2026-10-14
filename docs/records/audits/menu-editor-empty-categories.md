# The menu editor offers categories that can never contain an item (round 126)

## The finding

`RestaurantMenuEditorScreen.tsx` filters its ITEM list to restaurant products and does not
filter its CATEGORY list:

```ts
// :341-344  items ARE filtered
const restaurantItems = useMemo(
  () => items.filter((p) => p.product_type === 'restaurant' || !p.product_type || p.pr...),
  [items]);

// :1036, :1296  categories are NOT
{categories.map((c) => (
```

Measured live (Vite + Playwright, `owner` / PIN 1234, press `1`, sidebar -> Menu Editor):

```
All Items 27 | Processors (CPU) 0 | Graphics Cards (GPU) 0 | Memory (RAM) 0
            | Storage (SSD/HDD) 0 | Motherboards 0 | Power Supply 0 | Cooling & Cases 0
Food 11 | Snack 0 | Hot Drinks 5 | Cold Drinks 7 | Dessert 4
```

The restaurant categories sum to 27, which is the `All Items` count — so the PER-CATEGORY
COUNTS are correctly restaurant-only. The category ROWS are not: seven of them
(`Processors` through `Cooling & Cases`) are rendered, clickable, and permanently empty.

An operator scanning for a category sees a sidebar twice as long as their menu, half of it
dead. Clicking one shows the empty state for a category that will never hold a dish.

## Why this is dev-mock fidelity, not a product defect

Those categories come from the **retail demo catalog**, not from a restaurant store:

* `dev-mock/core/mockSeedData.ts:130` defines `{ id: 'cat-cpu', name: 'Processors (CPU)' }`;
* `dev-mock/handlers/catalog.ts:44-51` seeds CPU/GPU/RAM items into them;
* `features/retail/RetailPosScreen.tsx:91` carries the same list as retail demo fixtures.

With a real store DB a restaurant has its own categories, so the seven would not exist. The
dev-mock merges a retail catalog into a restaurant workspace, and the editor's item filter
splits them while the category list does not.

**That is worth stating rather than fixing here**: the defect is in the mock's shape, and a
fix belongs on the mock (seed restaurant-only categories per workspace) or on the editor
(filter categories by whether any restaurant item uses them). The second is a product change —
it would also hide a legitimately empty category an operator just created and has not filled.

## A second, smaller observation

The item-level availability toggles carry an accessible name:

```
aria-label="Toggle availability for Caffe Latte"
```

The two BULK controls at `:1098-1115` carry none — `"|Make all available"` and
`"|86 All (Hide)"` in the live button dump, where the first field is the aria-label and it is
empty. They do get an accessible name from their visible text, so this is not a violation —
but the sibling control two lines away sets the pattern, and matching it costs nothing.

## The sidebar's other five entries are live

Driven in this session across rounds 118-126: Payments (round 120, nine rail switches and the
preset chips), Menu Editor (this round). The header, back button and save control all render,
and the editor shows `All changes saved`.

## Verified

| Item | Result |
|---|---|
| Item filter | `:341-344`, restaurant-only |
| Category render | `:1036`, `:1296`, unfiltered `categories.map` |
| Live category counts | restaurant-only (sum to the All Items figure) |
| Empty non-restaurant categories shown | 7 |
| Source of those categories | dev-mock retail seed + RetailPosScreen fixtures |
| Tree | no source changed this round |
## CORRECTED (round 127): this is a recorded deferral, not a discovered defect

This record's framing — "the defect is in the mock's shape" — presents the seven retail
categories as something found. **They were deferred deliberately, in writing, by the commit that
added the restaurant half.** `dev-mock/core/mockSeedData.ts:122-127` reads:

> *The retail entries still carry ids that set does not define (`cpu-1`, `gpu-1`…), so they
> render as no glyph at all... They are left as they are here because changing them is a*
> ***separate decision about the retail demo, not a side effect of adding the restaurant***
> ***half.***

Both repairs this record proposed also fail against the code: `RetailPosScreen.tsx:559/:611/:639`
joins products to categories from the SAME `list_categories` result, so serving
restaurant-only categories breaks the retail grid; and filtering the editor's rail by item
count would hide `cat-snack` — seeded, restaurant-owned, 0 items, and MUST stay visible.

The observation stands (seven clickable, permanently empty rows; a rail twice the size of the
menu). The attribution and the priority do not: this is dev-only fidelity, not a merchant-facing
defect. See `menu-editor-categories-deferred.md` (round 127) for the least-blast-radius option —
scoping `MOCK_CATEGORIES` by workspace in the router rather than in the editor.