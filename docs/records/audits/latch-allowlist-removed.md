# The last latch entry was a false positive, and the allow-list is gone (round 239)

## The site round 238 could not classify

`RestaurantMenu.tsx:391` was listed as *"IN the restaurant surface and NOT yet audited"*. Audited:

```ts
useLayoutEffect(() => {
  if (menuStateUserIdRef.current === userId) return;
  menuStateUserIdRef.current = userId;      // ← the scanner's match
  …all synchronous assignments…
}, [userId, locationId]);
```

**It is correct.** It syncs a ref to a prop on a user switch, everything after it is synchronous,
and there is nothing whose outcome a cleanup could discard. Its actual async read — `:460`,
`getUserPreferencesScoped` — has a proper `cancelled` + cleanup guard and **no latch before it**.

And the decisive measurement, which should have been the first question:

```
originalsRef.current =   false
setLoadFailed            false
loadFailed               false
```

**The file has no dirty-tracking baseline and no load-failure flag, so the F4 premise does not
apply to it at all.** The scanner matched a shape that has a legitimate use.

## The fix is a precondition, and it retired the whole allow-list

The case now requires the premise before it can report anything — a baseline AND a load-failure
flag — which is what stops it reporting its own shape. Measuring that, all three allow-list
entries turned out to lack the premise too:

| Site | Baseline | Flag |
|---|---|---|
| `RestaurantMenu.tsx:391` | no | no |
| `nodeTopologyEditorRestoreState.ts:23` | no | no |
| `NodeTopologyEditor.tsx:1608` | no | no |

**The list is now empty**, and there is a detector self-check asserting it still finds sites, so
the case cannot pass by scanning nothing (round 226's rule, applied to this file's own instrument).

## The kill-tests, including the ones that survived

| Mutation | Result |
|---|---|
| the baseline gate alone | **survives** |
| the flag gate alone | **survives** |
| **both gates** | **fails — the exact three sites the allow-list held** |

Neither gate binds alone, and that is not a weakness: all three sites lack *both*, so either one
suffices to exclude them. **They are individually redundant and jointly the precondition.** A
round that reported only "the kill binds" without saying which mutation bound would have hidden
that.

## A self-inflicted error worth recording

Two kill-tests appeared to survive when the check being killed **had already been deleted by an
earlier restore**. The file looked right — the comment was there — but the code line was gone, so
there was nothing to mutate. It was found by inserting a canary (`offenders.push('CANARY')`) and
seeing it fire **700 times**, once per scanned file, which exposed that the case was running with
only one gate.

**A surviving kill-test means "the feature is unguarded" or "my mutation is a no-op"**, and the
second is indistinguishable from the first until the mutation is proven to have applied. The
canary is cheap and it settled it.

## Verified

| Item | Result |
|---|---|
| Sweep cases | 6 passing |
| Kill-tests | 1 binds (joint), 2 documented as individually redundant |
| `kill-test` leftovers in the file | 0 |
| `tsc` / `eslint` | 0 / 0 |
| Full UI suite | 12,716 passed — 0 failed |

## The F4 class, closed

| Card | Rounds | Outcome |
|---|---|---|
| receipts | 223 | worked |
| payments | 227 | worked |
| settings screen | 230 | worked |
| workspace restaurant card | 231-235 | **fixed** — latch ordering |
| workspace KDS card | 237-238 | **fixed** — missing token, then latch ordering |
| workspace inventory card | 237-238 | **fixed** — same two |
| `RestaurantMenu` | **239** | **not a defect** — premise does not apply |

Seven candidate sites across six rounds. Four were real, one was examined and cleared, and the
sweep that should have caught all of them now checks the property that was missing:
**reachability, not presence.**