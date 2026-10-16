# Undo put the line back on top, and a wrong note of my own — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 95 · status: 1 defect fixed,
     1 previous round's claim CORRECTED · branch: 0.0.41 · commit: `bd201460d` -->

<!- - Scope: restaurant POS ticket integrity, plus a correction pass over round 94's
     own claims. Tree verified green at 811/811 (12,872 passed) going in. -->

## Defect — Undo restored a removed line to the TOP, not to its place

`handleUndoRemove` re-inserted with `setLines((prev) => [popped, ...prev])`
(usePosCartActions.ts:289): always index 0.

**Why it could not have been right.** The undo stack stored the bare `CartLine`
(`getId: (line) => String(line.id)`), and `CartLine` has NO position field
(`types/domain.ts:109-128`) — the list order IS the position. So the index was not
recorded anywhere and could not be restored even in principle.

**Measured:** three lines Alpha/Bravo/Charlie, remove the MIDDLE one, press Undo →
`[Bravo, Alpha, Charlie]`. The ticket reordered.

**Why that matters on a restaurant till specifically:** line order is the order the
waiter built the order, and the kitchen reads the ticket top-down. A reordered ticket
does not match the check the guest was shown or the KDS ticket that came off the printer.

**Why the existing test could not see it.** The pre-existing `undoes line removal` case
removes the ONLY line in the cart — every position is the same, so a prepend and a
splice are indistinguishable. The new case needs three lines and removes the middle
one, which is the only construction where position is observable.

**Fix:** a `RemovedLine` wrapper (`{ line, index }`) captured INTO the `setLines`
updater, so the index is read against the committed list rather than against whatever
the row rendered with — the same committed-state discipline `changeQty` established in
rounds 89-92. Restore splices at the recorded index, clamped, because the stack holds
up to 5 and the list can change underneath it.

Two consequences worth recording:

- `removeLine` became unused in the hook (the updater now filters inline), so the
  destructure was dropped. Typecheck caught it, not review.
- `CartPanel` typed the stack as `AnimatedUndoStack<CartLine>`. It only reads
  `shouldRender`/`isExiting` — never an entry — so the prop was widened to the wrapper
  shape and the fixture in `CartPanel.test.tsx` followed.

## Correction — round 94's own `--font-size-*` claim was wrong

Round 94 recorded that four `--font-size-*` spellings in `RestaurantMenu.css` were
undefined custom properties. **They are not, and no such token exists.**
`grep '\-\-font\-size'` over `ui/src` returns six hits, all the SINGLE name
`--font-size`:

- `RestaurantMenu.tsx:683` sets it from React — the menu font-size control;
- `RestaurantMenu.css:702, 793, 990, 1013` read it as `var(--font-size, 0)` with a
  deliberate `0` fallback.

That is a live, working control. The original claim came from my own regex matching
`--font-size-xs` as a SUBSTRING of `var(--font-size, 0) * 1px`-style expressions —
the same detector error this campaign has now paid for four times. **Nothing in the tree
needed changing**, and the claim is corrected in the round-93 record where it was made
rather than left standing.

The lesson is not "be careful with regex". It is that a finding inherited from an earlier
round is not evidence — this one survived a round because it *looked* like the kind of
thing the sweep finds.

## Verification

- **Full suite: 811/811 files, 12,873 passed, 0 failed** (3 skipped, 3 todo).
- New case fails before the fix with the exact reordering
  (`expected ['IBravo@ …', …] to deeply equal ['IAlpha@ …', …]`) and passes after.
- **Kill test:** restoring `[popped.line, ...prev]` fails only the new case.
- `npm run typecheck` 0 errors (it caught both type consequences); `npm run lint`
  0 errors; `npm run lint:i18n` clean.

## Standing rule

> A removed item can only be restored to its original position if the position was
> recorded at removal. Storing the item alone silently makes "put it back" mean
> "put it on top" — and the difference is invisible to any test whose list has one item.

> last audited 18-10-26 by autonomous-goal-round-95
