# The missing scoped-storage helper, built and pinned (round 168)

## From an open question to a prerequisite

Round 167's third sweep found 14 flat `resto_rcpt_*` keys in `RestaurantReceiptsScreen` — the
same unscoped-storage class round 104 (F44) fixed for the POS cart — and recorded it as an
open design question rather than a defect, because the fix looked large.

Measuring it showed **why** the class keeps recurring: there is no helper. Round 104's fix is
two inline template literals in `PosScreen` (`pos-locked-cart:${resolvedStoreId || 'unresolved'}`)
and nothing generalised them. The receipts screen has **88 call sites and 13 unique keys** with
no scoping at all.

So this round built the prerequisite rather than the migration: a helper to scope with, and
the key question it forces an answer to.

## What landed

`ui/src/utils/scopedStorage.ts` — three functions:

| Function | What |
|---|---|
| `scopedKey(base, storeId)` | the key builder, matching PosScreen's fallback |
| `readScoped(base, storeId)` | read, adopting a legacy unscoped value when none exists |
| `writeScoped(base, storeId, value)` | write |

## The three decisions worth recording

1. **`'unresolved'`, not `'default'`.** The fallback for a scope that has not resolved must
   not collide with a real store. `'default'` would: a store genuinely named `default` would
   share keys with every unresolved session. `'unresolved'` is a sentinel the backend has no
   reason to mint, which is what makes it safe.
2. **Legacy adoption, so scoping is a migration rather than a reset.** Without it, an
   operator who configured receipt headers today would find them empty the moment their key
   became scoped — the value still on disk, unreachable under the old spelling. This is the
   part that would have turned a leak fix into a data-loss bug.
3. **Adopt once.** After the first read the scoped key holds the value, so the legacy key
   cannot resurrect a stale value over a newer scoped one.

## Kill-tested, both halves

| Mutation | Result |
|---|---|
| key builder ignores `storeId` | **all 5 fail** |
| legacy read returns `null` | **1 fails** — the adoption case, precisely |

## Verified

| Item | Result |
|---|---|
| New tests | **5 passed** |
| Kill-tests | both fail as intended |
| `storageKeyPins` | 5 passed — the helper has **0 quoted key literals**, so the scanner
  correctly sees nothing to pin (`scopedKey` builds them at runtime, the same reason
  `pos-locked-cart` is covered by its own suite instead) |
| `tsc` / `eslint` | 0 / 0 |
| Full UI suite | 12,685 passed (up 5) |

## Not done, and deliberately

**No call site was migrated.** The receipts screen's 88 sites still use flat keys. That is the
next round's work, and doing it now would mean the helper's tests and the migration's tests
landing together — with the helper unproven at the moment the migration depended on it.
