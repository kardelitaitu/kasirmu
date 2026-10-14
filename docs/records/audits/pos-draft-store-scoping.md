# A POS cart could follow the operator to another store (round 104)

## The defect

`PosScreen` held the cart's two persistence keys as plain constants:

```ts
const LOCKED_CART_KEY = 'pos-locked-cart';
const ACTIVE_DRAFT_KEY = 'pos-active-draft';
```

and the payload is entirely store-specific — the lines, `tableNumber`, `customerName`,
`guestCount` and `orderType` (`PosScreen.tsx:286-298`).

A store switch REMOUNTS the POS: `WorkspaceContext.switchStore` calls
`setActiveWorkspace(null)` (`:363`), and the mount effect at `PosScreen.tsx:185-247`
restores whatever that key holds (its deps are stable setters, so it runs on mount).

**So an operator who rang up a cart at one store and switched to another was shown the
first store's cart — its table number, its order type and its lines.**

## How it was found

`pos-module-state-audit.md` (round 103) closed with an explicit caveat: the
`localStorage` shape had not been swept. `module-collections-audit.md` (round 104) closed
with a sharper one — neither round had checked whether persisted keys are STORE-SCOPED.
This round read the two keys and their consumer.

## The fix

```ts
const LOCKED_CART_KEY = `pos-locked-cart:${resolvedStoreId || 'unresolved'}`;
const ACTIVE_DRAFT_KEY = `pos-active-draft:${resolvedStoreId || 'unresolved'}`;
```

`resolvedStoreId` comes from `useWorkspace()` (already in the file's destructure,
extended). The store id goes in the KEY rather than in the payload because the restore has
to reject a foreign draft BEFORE parsing it; a payload field would still have to be
validated, and a key cannot be forgotten. `''` yields a distinct `unresolved` slot rather
than colliding with a real store.

Both keys were scoped, not just the draft: `pos-locked-cart` carries the same store-specific
payload through the lock/logout path (`:1147`), so leaving it unscoped would have kept the
defect on that route.

## The guard

`posDraftStoreScoping.test.ts` asserts the property against the REAL source rather than
against a fixture, so it cannot be satisfied by editing the test. It accepts any of three
fixes — a store-scoped key, a clear on switch, or a validated `storeId` field — and it
failed before the change and passes after.

## Verified

| Gate | Result |
|---|---|
| New guard | 2 passed (1 failed before the fix) |
| `PosScreenCoreFlow` + `PosScreen.integration` | 109 passed — 6 failed before the key update |
| Full suite | 12,660 passed, 0 failed (+2 for the new cases) |
| `tsc` | 0 |

The six failures were tests writing the OLD unscoped literal; they now build the scoped
key from a `STORE_ID` constant matching each suite's mocked `resolvedStoreId: 'default'`.

## Scope

Two keys on one screen. Other persisted state — `useKdsOffline`'s cache/queue/dead-letter
(already store-scoped via `scopedKey`, `OFF-07`) and the settings/table keys — was not
re-audited here, and the storage-key pin ledger does not cover POS keys.