# Cart line badges and the special-request note, plus a validation of round 203's checker (round 204)

## First: validating the instrument against real shapes

Round 203's lesson was that a self-test written from the same mental model as the matcher cannot
reveal that the model is wrong. This round applied that to the checker itself: it was run against
a fixture whose three cases were **copied from the real tree** rather than written to match the
regex.

```
(1) const updatedLines = lines.map((l) => ({ ...l }));   // state read BEFORE the await
    setLines(updatedLines);                              // -> 1 candidate, correctly

(2) const fresh = await Promise.resolve(['a']);          // the awaited value
    setDrafts(fresh.map((r) => ({ ...r })));             // -> ignored, correctly

(3) setRows((prev) => prev.map((r) => r));               // the updater form
                                                         // -> ignored, correctly
```

**One of three, and it is the right one.** The checker is validated against the shapes it will
meet, not only against its own fixtures. Fixture deleted; tree back to 0 candidates.

## Second: the cart line's operator surface

`CartLineItem` had 2 of 17 testids referenced. Fifteen were untouched, including the two things
the KITCHEN reads off a chit and the waiter reads off the cart: the line's status and its
special-request note.

`ui/e2e/restaurant-cart-line-badges.spec.ts` — 3 passed (desktop; the portrait note tests skip for
round 201's measured reason).

| Case | Asserts |
|---|---|
| status transitions | a never-sent line carries NO badge; Send makes it Sent; raising the quantity makes it carry a remainder again |
| note round trip | type a note, save, and it renders ON the line — not merely in the input |
| note cleared | a saved note can be removed from the line |

## The error, and it was mine about the PRODUCT

The first draft asserted *"a line that has not been sent is New"*. It failed for 20 seconds
against a line with no badge at all. Reading `CartLineItem.tsx:192` and `:199`:

```tsx
{line.dispatchedQty !== undefined && line.dispatchedQty < line.qty && (  // the New badge
```

Both badges are gated on `dispatchedQty !== undefined`, and `dispatchedQty` is **only ever written
by a dispatch** (`PosScreen.tsx:1132`) — never initialised when a line is added. So a fresh line
shows neither badge, and `undefined` means "never been through a send cycle".

That is a defensible design (no badge is not the same as a wrong badge), and the assertion was
wrong, not the code. Corrected, with the measurement in the comment — the round-203 habit applied
to a product claim instead of a matcher.

**Kill-tested**: not advancing the dispatch record fails the status case. Restored byte-identical.

## Verified

| Item | Result |
|---|---|
| Checker against real shapes | 1 of 3, the right one |
| New spec | 3 passed |
| Kill-test | fails correctly |
| `PosScreen.tsx` | unchanged, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,707 passed |

> last audited 14-10-26 by docs-auditor
