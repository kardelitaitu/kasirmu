# The menu editor's stale-reload guard is pinned, and reachable (round 116)

## The finding

`RestaurantMenuEditorScreen.tsx:309` sequences its product/category reload:

```ts
const seq = ++loadSeqRef.current;
const [prodsRes, catsRes] = await Promise.allSettled([
  listProductsScoped(sessionToken), listCategoriesScoped(sessionToken),
]);
if (seq !== loadSeqRef.current) return;   // <- drops a superseded response
```

Measured: removing that line leaves `RestaurantMenuEditorScreen.test.tsx` at **25 passed**.
The guard was unpinned.

## Round 115's rule applied first: is it REACHABLE?

That rule exists because round 114 called an unreachable guard "a live last line of
defence". So before writing a test, the overlap had to be shown reachable. It is:

| Link | Evidence |
|---|---|
| `reloadData` depends on `sessionToken` | `:334` — a session change re-creates it |
| the mount effect depends on `reloadData` | `:337-338` — so it re-runs with it |
| EIGHT mutation paths call `reloadData` directly | `:689`, `:716`, `:785`, `:806`, `:834`, `:1939`, and the toggle/bulk handlers ABOVE the load read |

A save's refetch and a token-change refetch therefore overlap, and without the guard
whichever settles LAST wins regardless of which was issued first. Unlike the credit guard,
this one guards a state the screen can reach — so it is PINNED, not deleted.

## Added

`menuEditorStaleReload.test.tsx` holds read 1 open with a deferred, lets read 2 settle with
the fresh list, then resolves read 1 with the stale list and asserts the stale items never
appear. **Kill-tested**: neutralising `:309` fails it.

## The reachability check is now the established first step

Three findings this session turned on it, in both directions:

| Finding | Reachable? | Outcome |
|---|---|---|
| credit rail guard (rounds 114-115) | **NO** — `setMethod('credit')` appears nowhere | recorded as structural redundancy |
| shift interval stop (rounds 108-109) | yes | pinned |
| menu editor reload guard (this round) | yes — overlap shown above | pinned |

## A mistake of mine

`renderWithProviders` is ASYNC, so its result has no `rerender`; the matching helper is
`rerenderWithProviders`. My first version called `view.rerender(...)` and failed with
`TypeError: view.rerender is not a function`.

## Verified

| Gate | Result |
|---|---|
| New file | 1 passed; fails when `:309` is neutralised |
| Full suite | 12,657 passed, 0 failed (+1) |
| `tsc` / `eslint` | 0 / 0 |
| `RestaurantMenuEditorScreen.tsx` | restored; `scratch-kill.py` deleted |