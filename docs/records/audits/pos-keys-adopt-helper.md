# The POS keys adopt the helper, and a substring guard was hiding a spelling (round 170)

## The adoption

Round 169's closing note named the remaining consistency question: `PosScreen` carried the
same scope spelling as the new helper, inline. Three code lines:

```diff
+import { scopedKey } from '@/utils/scopedStorage';
-    () => `pos-locked-cart:${resolvedStoreId || 'unresolved'}`,
+    () => scopedKey('pos-locked-cart', resolvedStoreId),
-    () => `pos-active-draft:${resolvedStoreId || 'unresolved'}`,
+    () => scopedKey('pos-active-draft', resolvedStoreId),
```

The sentinel's justification moved to the builder that has to get it right for every caller.

## What the round actually found

`posDraftStoreScoping.test.ts` asserts against the REAL source with plain substrings — the file
says why (two attempts at regexes matched literal backslashes and read false). Its `scopedKey`
alternative was `includes('ACTIVE_DRAFT_KEY') && includes('resolvedStoreId')`, which the
migration satisfied trivially: both strings still appear. **The guard could not tell the
scoped call from an unscoped one.**

Attempting to strengthen it produced a second, better finding:

| Guard version | Kill-test |
|---|---|
| original (two substrings) | survives any spelling |
| `\|\| src.includes('scopedKey(')` | **survives** — one bad key hides behind two good ones |
| per-key call match | survives a single unscoped key — **correctly**, see below |
| per-key, with `',' + resolvedStoreId` matching | **survives** — clause matched the CALL, making it a no-op |

The third row is the interesting one. The case accepts **three** fixes — scope the key, clear
on switch, or validate a storeId — and `PosScreen` genuinely performs the second: two real
`removeItem(ACTIVE_DRAFT_KEY)` calls. So un-scoping one key is still a correct implementation of
the contract, and a guard that failed there would be wrong.

Removing **every** defence (both keys unscoped *and* the clear calls broken) fails the case.
That is the right test of a guard with this contract, and it is what was recorded.

## A note on how the file was nearly broken

The first strengthening used a multi-line string `replace` whose anchor matched a PREFIX of a
comment line, bisecting the file at line 124 and leaving it 154 lines of invalid TypeScript.
Detected by `tsc` naming the line, not by the tests. Restored from HEAD and redone with line
indices, then the whole file re-read to confirm the comment block was coherent — a `splice`
that drops the wrong two lines passes typecheck and reads as intended.

## Verified

| Item | Result |
|---|---|
| `PosScreen` adoption | 3 code lines; `git diff` shows only the two key builders |
| Guard strengthened | per-key, either spelling accepted |
| Kill-test | removing every defence **fails** the case |
| `RestaurantMenu` | untouched — a LOCATION scope (`restaurant-loc-${locId}-unavail`) and a different format |
| `tsc` / `eslint` | 0 / 0 |
| Full UI suite | 12,688 passed |