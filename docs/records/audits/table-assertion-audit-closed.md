# The last surviving table assertion, and the audit closing (round 198)

## Continuing round 197's audit

Round 197 killed round 194's delete case (bound) and round 195's move case (did not bind, and was
fixed). A grep for the failure pattern — `hasText` against a table-tile class — found **one
remaining instance**: round 193's release case at `:118`.

```ts
page.locator('.tables-table--available').filter({ hasText: /Table 1/ }).first()
```

It carried **all three** flaws at once:

1. the plan already has several AVAILABLE tiles, so `.first()` could be one of those;
2. `hasText: /Table 1/` also matches `Table 12` (rounds 195, 197);
3. a release sets **CLEANING**, not available (`floorplan.ts:152-154`).

**Kill-tested**: removing `releaseTableScoped` from `statusAction` left all four cases passing —
the assertion did not bind at all.

## The fix, and the third time this shape has been written

The source tile is captured by index before the action and the assertion polls that index's class.
With it, the same mutation fails the case.

The `cleaning` end state has now been written wrong **three times** across rounds 196-198. That is
worth stating as a fact about the method rather than as an anecdote: **an end state reconstructed
from memory is wrong more often than it is right, and every one of these three was caught by
probing the DOM after the action rather than by reasoning about it beforehand.**

## The audit's final state

| Spec | Assertion | Kills correctly |
|---|---|---|
| round 193 release | tile index + `cleaning` | yes, after this round's fix |
| round 194 delete | disabled state, and confirm gate | yes, already |
| round 195 move | tile index + `cleaning` | yes, after round 197's fix |
| round 196 merge | tile index + combined total | yes, after round 196's fixes |

Every destructive table action now has an assertion proven to fail when its behaviour is
removed. That is the property the last three rounds were actually buying.

## Verified

| Item | Result |
|---|---|
| Release spec | 8 passed |
| Kill-test | 1 failed, the intended case |
| `TableManagementScreen.tsx` | unchanged, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,703 passed |

> last audited 14-10-26 by docs-auditor
