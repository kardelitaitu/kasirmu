# A flaky test on HEAD, and the shape that causes it (2026-10-12)

## The flake

`RestaurantMenuEditorScreen.test.tsx > filters items when a category is selected`
failed inside the full restaurant/KDS run while passing alone:

| Run | Result |
|---|---|
| the file alone | 25 passed |
| with one neighbour file | passed |
| a11y + the file | passed |
| KDS + the file | passed |
| **full restaurant/KDS surface, run 1** | **1250 passed, 1 failed** |
| same command, re-run (no code change) | 1251 passed |
| same command, further re-runs | passed |

Measured across five full-surface runs in this round: two red, three green, with no
code change between them. That is a FLAKE, not a regression — and a test that fails
only sometimes is worse than one that always fails, because it teaches the team to
re-run CI instead of reading it.

## The shape

```ts
await user.click(within(rail).getByText('Mains'));
expect(screen.getByText('Nasi Goreng Kampung')).toBeInTheDocument();
expect(screen.queryByText('Es Teh Manis')).not.toBeInTheDocument();   // <- races
```

The click sets `selectedCategoryName`; the filtered list is a new render, and the
item data itself arrives asynchronously. The FIRST assertion happened to be
retried-and-flaky-safe in practice; the **ABSENCE** one is the one carrying the
race, because a not-yet-settled render still contains the item it is asserting is
gone.

## The fix

The retry belongs on the assertion whose failure is the timing:

```ts
await waitFor(() => {
  expect(screen.queryByText('Es Teh Manis')).not.toBeInTheDocument();
});
```

Applied to both occurrences of the shape in this file — the category filter and the
identical real-time search case two tests below it, which had the same
`await user.type(...)` then bare-absence assertion. Six consecutive full-surface
runs were green after the fix.

## The shape is not unique to that file

A scan for `await user.<click|type|clear>(...)` followed within four lines by a
bare `.not.toBeInTheDocument()` with no `waitFor` between found **9** instances:

| File | Lines |
|---|---|
| RestaurantMenuEditorScreen.test.tsx | 145, 476, 484, 546, 551, 571, 654 |
| RestaurantPaymentsScreen.test.tsx | 378, 823 |

The two `Es Teh Manis` ones (145, 546) are fixed. The rest are **not** — they have
not been observed flaking, and several look timing-independent (asserting a dialog
absent after a click that opens nothing). Rewriting assertions that are not failing
risks masking a real regression behind a retry, so they are recorded here as a
known shape to check if one of them ever goes red intermittently, rather than
changed speculatively.

## Why this matters for the objective

The restaurant POS surface is 1251 tests. One of them could go red on any CI run
for no reason — and the round-49 finding showed CI is already the place genuine
problems surface (a settings key read by nothing was failing a guard). A flake
sitting in the same suite makes that signal harder to trust.

> last audited 14-10-26 by docs-auditor
