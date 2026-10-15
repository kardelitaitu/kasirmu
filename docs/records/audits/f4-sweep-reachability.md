# The F4 sweep now checks reachability, and two more cards were fixed (round 238)

## What the round found that round 237 did not

Round 237 gave the KDS and inventory cards the `sessionToken` they were missing, and both began
to read. That looked like the whole fix. It was half of it:

```ts
// WorkspaceKdsSettings.tsx, immediately after round 237
:93  if (reloadNonce === 0 && originalsLoadedForRef.current === sessionToken) return;
:94  originalsLoadedForRef.current = sessionToken;   // ← still BEFORE the read
```

With the token supplied, the read now fires — but the **ordering defect round 235 fixed in the
restaurant card was still present in both of these.** Their `setLoadFailed(true)` remained
reachable only by luck: whether it fires depends on which StrictMode run's outcome lands first.

Both now latch in their `.finally()`, the same `settle()`-at-settlement shape round 235 used.
Three of the four workspace cards are fixed; the fourth (`WorkspaceStorePosSettings`) reads through
`hasPartialError` and never latched at all.

## The durable output: the existing sweep was extended, not duplicated

`ui/src/__tests__/baselineLoadSignal.test.ts` already guarded this class — and it is exactly the
check that **passed on all four broken cards**:

```ts
if (!LOAD_FAILURE_SIGNALS.some((s) => text.includes(s))) offenders.push(rel);
```

It verified the flag existed **as text**. Rounds 234-238 were all about flags that exist as text
and cannot fire, so the guard was structurally blind to the very bug it was written for.

Three cases were added, and they are the round's real product:

| Case | Property |
|---|---|
| a load-failure flag is SET somewhere | an assignment to it must exist, not just a declaration |
| a once-per-session latch is not set before its own read | the round-235 shape, by line position |
| no STALE latch exemption | an allow-list entry that no longer matches fails |

**Kill-tested**: reintroducing the pre-read latch in `WorkspaceKdsSettings` is caught by file and
line; moving an allow-list entry off its site reports `(no longer a pre-read latch)`. Both restored.

## Writing the checker found two of its own bugs

The flag case first demanded `setLoadFailed(true)` in every file, and flagged
`TerminalPreferencesCard` and `WorkspaceStorePosSettings`. Both are correct as written — they
**consume** a flag owned elsewhere:

| Form | Owner |
|---|---|
| `setLoadFailed(true)` | the card itself |
| `hasPartialError` | the settings context |
| `hw.loadFailed` | the `useTerminalHardware` hook |

Only the first owes an assignment. And the staleness case initially compared the wrong line — the
detector records the **assignment** line while the case assumed the **guard**. Both were caught by
running the case rather than by reading it.

**A checker that demands one shape reports its own shape, not the property.**

## The allow-list, and why it is not a suppression

Three pre-read latches remain, each with a reasoned entry:

| Site | Reason |
|---|---|
| `nodeTopologyEditorRestoreState.ts:23` | outside restaurant-POS; latches synchronous state, no async read to discard |
| `NodeTopologyEditor.tsx:1608` | outside restaurant-POS; `autoFitKeyRef` latches a synchronous key |
| `RestaurantMenu.tsx:391` | **IN the restaurant surface and NOT audited** — `menuStateUserIdRef` latches a userId, not a sessionToken; whether an async read follows is unestablished |

The third is named as unfinished rather than excused. Its entry records the next step in the same
words the fix would need.

## Verified

| Item | Result |
|---|---|
| New sweep cases | 3 (6 in the file, all passing) |
| Kill-tests | 2, each failing on the reintroduced condition |
| Cards fixed | 2 |
| `tsc` / `eslint` | 0 / 0 |
| Full UI suite | 12,716 passed (was 12,713) — 0 failed |

## The shape of this round

Two fixes and three tests, but the durable part is the third case. Rounds 234-238 found five
instances of one class by hand, one instrumented run at a time. **The guard that should have caught
all five was already in the tree, checking the wrong property.** Extending it is what makes the
sixth instance cost a failing test instead of five rounds.

> last audited 15-10-26 by docs-auditor
