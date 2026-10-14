# The receipts keys are store-scoped, with the migration pinned (round 169)

## The migration

Round 168 built `utils/scopedStorage.ts` and deliberately migrated nothing. This round
migrated the screen that motivated it:

```
42 call sites rewritten  (14 reads @295-325, 14 writes @421-501, 14 writes @1185-1198)
0 raw localStorage 'resto_rcpt_*' sites remain
```

`resolvedStoreId` joined the `useWorkspace()` destructure, and each site became
`readScoped(key, resolvedStoreId)` / `writeScoped(key, resolvedStoreId, value)`.

Two of the 42 needed a second pass — `resto_rcpt_header_line1`/`_line2` sat at different
indentation in the flat-write block, so the batch regexes skipped them. Found by re-counting
rather than by assuming the rewrite was total.

## The migration is the risky part, so it is what got pinned

`ui/src/__tests__/receiptKeysStoreScoped.test.ts` — **3 passed** — asserts the operator-facing
claims, not the helper's internals (those are `scopedStorage.test.ts`'s job):

| Claim | Why it matters |
|---|---|
| a flat legacy value is ADOPTED | an operator's existing configuration must not vanish the moment its key becomes scoped |
| a stale flat value cannot shadow a newer scoped one | otherwise the legacy key wins forever |
| another store is unaffected | the leak this whole exercise exists to close |

**Kill-tested**: removing the legacy read fails **3 tests across the two suites** — the two
migration cases plus `scopedStorage`'s own adoption case.

## Two guards fired, both correctly

1. **`RestaurantReceiptsScreen.test.tsx:772`** asserted the remote preference landed at the
   FLAT key. Re-pointed to the scoped address with a comment saying the claim is unchanged
   and only its address moved — a test asserting the old address would have pinned the bug.
2. **`storageKeyPins.test.ts`** failed its own *"names key(s) not found in production"* check
   for the five scoped keys. The registry now carries a note instead of the fourteen entries,
   following the `pos-locked-cart` precedent it documents two blocks above: a key behind an
   interpolation has no literal to pin, so coverage moves to the suite that asserts the
   interpolation. That guard caught a real consequence of the change rather than being
   silenced.

## Verified

| Item | Result |
|---|---|
| Call sites migrated | 42, zero raw sites left |
| `RestaurantReceiptsScreen.test.tsx` | **48 passed** |
| New migration suite | **3 passed** |
| Kill-test | **3 failed** |
| `storageKeyPins` | 5 passed |
| `tsc` / `eslint` | 0 / 0 (2 pre-existing warnings) |
| Full UI suite | 12,688 passed, 0 failed |

## Not done

`RestaurantMenu.tsx`'s location-scoped keys and `PosScreen`'s inline scoped keys still use
their own spellings rather than the helper. Neither is unscoped — both already carry a scope —
so they are a consistency question rather than a leak, and worth a look before assuming they
need touching.