# The mock dropped the field modifier groups live in (round 210)

## What was attempted

Round 209 closed the `CartLineItem` modifiers region but left three testids out of reach:
the EDIT button and the modifier CHIPS need a line that actually HAS modifiers, and **no
seeded product carries any** (`catalog.ts`: 2 `notes` values, neither JSON-shaped, 0
`modifierGroups`).

The obvious fix — seed a product with groups — is wrong on two counts. `MOCK_PRODUCTS` is a
**static literal**, not a localStorage slice, so it cannot be seeded at all; and round 193's
lesson was that a spec's need is not a licence to change shared fixtures.

So the precondition was to be built through the **operator's own path**: author a group in the
menu editor, save, then sell the item. That round-trip is worth more than a seeded fixture
because it exercises the serializer, the storage, `getProductModifierGroups` and the cart
rendering as one chain.

## The defect it found

Driving that path exposed a real mock bug:

```
CREATE a modifier group  ->  Save reports success  ->  reopen the item
SAVE_DISABLED_AFTER=true    GROUP_BACK=0    NOTES=
```

`updateMockProduct` assigned `name`, `priceMinor`, `categoryId` and `isActive`, and
**silently dropped `notes`**. That matters more than one field usually would, because modifier
groups LIVE in `notes` as JSON — `serializeDraftModifierGroups` (`menuEditorLogic.ts:257`)
writes them there and `getProductModifierGroups` (`types/domain.ts:224`) reads them back. The
mock made the editor's whole Modifier Groups builder a **no-op**.

**The core has always accepted the field.** `UpdateProductScopedArgs.notes` is
`Option<Option<String>>` (`kasirmu-bridge/src/products.rs:695`) with documented PATCH semantics:
`null` clears, a string sets, absent keeps. So the real till saved what the mock discarded —
the worst kind of divergence. *A mock more permissive than the core hides a bug; one less
permissive invents one. This was the second kind.*

## What landed

| Change | |
|---|---|
| `catalog.ts` | `if (a.notes !== undefined) target.notes = a.notes;` plus the type field, matching the core's PATCH semantics |
| `devMockProductNotes.test.ts` | 2 cases driven through the mock's own `invoke` |

**Kill-tested**: removing the assignment fails the storage case. Restored.

## What did NOT land, and why

The end-to-end spec was **deleted**, not left failing. Its two halves need to share one page
load — `MOCK_PRODUCTS` is in-memory, and `loginAs` calls `page.goto('/')`, which rebuilds the
module graph and discards the edit — and getting from the menu editor back to the till without
a navigation proved fragile: the editor's back button exits an open item form first, so the
click count depends on state the spec had not accounted for.

The unit test pins the FIX, which was the discovery worth keeping. The round-trip spec is a
separate problem — in-app navigation between two workspaces — and belongs in a round that can
give it the attention the selector archaeology deserves rather than another attempt here.

## Verified

| Item | Result |
|---|---|
| New unit test | 2 passed |
| Kill-test | 1 failed, the storage case |
| `tsc` / `eslint` | 0 / 0 |
| Full UI suite | 12,709 passed (up 2) |