# The scan counted mentions as uses, and round 269 was the proof (round 270)

## The flaw round 269 exposed by hand

Round 269 found a spec that **named** `restaurant-menu-editor-manage-recipe-btn` in three
comments while driving a different route. The coverage scan counted it as covered, and the gap
survived a round.

That is not a one-off in the tool; it is what the tool measures. It counts an id as covered when
the string appears **anywhere** in a spec — including a comment explaining why the spec does
*not* use it.

## The fix, and the second reading it adds

The scan now prints two numbers per screen:

```
screen        covered   used   pct
payments      20/32   20/32    62%
receipts      12/15   12/15    80%
```

`covered` is unchanged. `used` counts ids that appear on a line that **also makes a selector
call** — `locator(`, `getByTestId(` or `querySelector(`.

**The two agree everywhere today**, which is the reassuring result: no other spec in the tree has
the round-269 shape. The value is that the instrument can now tell us so rather than leave it
assumed.

## The measure is deliberately loose, and said so

Line-based rather than comment-stripping, and erring toward **counting something as a use**. The
reverse error — calling a used id unused — would report a gap where there is none, and false gaps
cost this session more time than false coverage did. A second reading, not a stricter gate, which
is why the table prints both rather than replacing one.

## Verified against the case that motivated it

| Id | Specs present | Mentions | Selector uses |
|---|---|---|---|
| `manage-recipe-btn` | both recipe specs | 5 | 2 |
| `manage-recipe-btn` | neither (round 269's state) | 2 | **0** |
| `sort-select` | both | 2 | 1 |

The second row is the defect state: **mentioned, not used** — visible to the instrument without
anyone having to notice the comment.

The scan's existing self-check still passes (`sees restaurant-menu-editor-bulk-avail`), so the
change did not disturb the guard round 226 built.

## Verified

| Item | Result |
|---|---|
| The scan | exit 0, self-test passes, both columns agree on every screen |
| The discriminating case | reproduces 0 uses when the form-route spec is absent |
| Scratch corpus | removed |
| eslint | 0 |
| Full UI suite | 12,716 passed |

## Coverage, measured rather than summarised

| Screen | Covered | Used |
|---|---|---|
| CartLineItem | 100% | 100% |
| tables | 90% | 90% |
| editor | 90% | 90% |
| settings | 83% | 83% |
| receipts | 80% | 80% |
| payments | 62% | 62% |
| CartPanel | 50% | 50% |

**And each remainder has a named cause**: chrome for the first five, field plumbing with its
invariant covered for payments, and architecture for CartPanel. This is now a measurement with a
checkable instrument behind it, which is the third such instrument this session has had to build or
repair (the coverage scan's self-check in round 226, the view-gated split in round 261, and the
mention/use split here).