# The fourth F4 latch fires now: a one-line ordering fix (round 235)

## The fix

Round 234 named the mechanism from the source. The latch was set **before** the read:

```ts
:98   if (reloadNonce === 0 && originalsLoadedForRef.current === sessionToken) return;
:99   originalsLoadedForRef.current = sessionToken;     // ← set before the read
```

Under StrictMode run 1 sets the ref and starts the read, the cleanup cancels it, and run 2
returns at `:98` — so the only read that happens belongs to a closure whose `cancelled` is true,
and its outcome is discarded. `setLoadFailed(true)` was unreachable.

The fix moves the latch to the read's **settlement**:

```ts
const settle = () => { originalsLoadedForRef.current = sessionToken; };
getSettingScoped(...)
  .then((raw) => { … settle(); setLoadFailed(false); … })
  .catch(()    => { … settle(); setLoadFailed(true);  … });
```

**The intent is unchanged**: a read is attempted once per session, and a store switch re-seeds
because the token differs. What changed is that the outcome now lands.

## The kill-test that mattered, and one that did not

| Mutation | Result |
|---|---|
| `settle()` becomes a no-op | **survives** |
| the pre-read latch is restored | **fails** |

The first surviving is informative rather than a gap: with no latch at all the effect simply
re-reads every run, and every failure lands — so the guard fires for a different reason. **Only
the second mutation reproduces the actual defect**, and it is the one that proves the fix.

Worth stating because a surviving mutation reads as a weak test: here it identified that the
latch and the settlement are two independent mechanisms, and the defect lives in their ordering.

## Verified

| Item | Result |
|---|---|
| The defect spec, before the fix | `Expected: 0, Received: 1` — the banner appeared |
| After the fix | 4 passed |
| Kill-test (pre-read latch) | 1 failed |
| Combined with round 232's spec | 8 passed |
| `tsc` / `eslint` | 0 / 0 |
| Full UI suite | 12,713 passed |

## The spec was renamed, not left mis-named

`restaurant-workspace-card-f4-defect.spec.ts` became `…-f4-latch.spec.ts` in the same commit.
**A filename asserting a defect is wrong the moment the defect is fixed**, and its header now
records what it used to say. The assertion inverted exactly once — `toHaveCount(0)` to
`toBeVisible()` — because round 234 wrote it with the failure count asserted first, which is
what made the inversion provably about the guard rather than about the instrument.

## Four F4 guards, all working

| Screen | Round | State |
|---|---|---|
| receipts | 223 | guard works, tested |
| payments | 227 | guard works, tested |
| settings | 230 | guard works, tested |
| **workspace card** | 231-235 | **guard works, tested — was unreachable for four rounds** |

The card's failure mode was the quiet one: a `loadFailed` state, a banner, a retry and a
disabled-Save rule that all existed, compiled, and could never run. Nothing failed; the operator
was simply shown a default they could not distinguish from a real value, with Save armed over it.