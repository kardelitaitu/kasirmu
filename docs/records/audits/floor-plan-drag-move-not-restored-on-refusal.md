# A refused floor-plan move left the table where the operator dropped it

**Date:** 2026-10-11 · **Round:** 55 (session) · **Status:** FIXED
**Area:** `ui/src/features/tables/TableManagementScreen.tsx` — the arrange-mode drag

## The defect

The drag is split across two handlers:

- `handlePointerMoveTable` (:863-887) writes the snapped position into **both**
  `tables` and `tablePool` on every move — optimistically, before any write;
- `handlePointerUpTable` (:900-921) is what actually persists, reading the position to
  save from `tablesRef.current` (:910), which is `tables` reassigned at :127.

When `updateTableScoped` is refused, the catch toasted `tables-action-error` and
**nothing else**. So:

1. the table stayed **visually** at the dropped position — the render derives
   `left: t.pos_x%; top: t.pos_y%` straight from that state (:1132-1133);
2. `tablesRef` still held the **refused** coordinates, so a retry re-sent the exact
   payload that was just rejected.

The operator was told the save failed *and* shown a floor plan that says it worked.
For table management that is not cosmetic: the server can believe a table sits where
the plan does not show it, and the next seat decision is made from the picture.

## Fix

A `dragOriginPos` ref captures the position at pointer-down, and the refusal restores
**both** lists *and* `tablesRef`.

The ref matters as much as the state: restoring only the React state would leave the
next attempt sending the refused coordinates again.

## Evidence

First drag test in the file — *returns the table to its saved position when the move
write is refused*. It seeds a table at `pos_x: 10`, enters arrange mode, drags it, and
asserts the rendered `left` returns to `10%` after the refusal.

**RED before the fix**, with the discrepancy measured exactly:

```
AssertionError: the floor plan kept a position the server refused:
  expected '50%' to be '10%'
```

**Kill-tested** by removing the restore block — the same `50%` vs `10%`, green on restore.

- `TableManagementScreen.test.tsx` **63 passed** (was 62)
- full UI suite **807 files, 12,820 passed**
- `typecheck` clean · `eslint` clean

## Two notes worth keeping

### jsdom had to be given a floor plan

`handlePointerMoveTable` bails on `rect.width <= 0` (:867), and jsdom reports a zero-size
rect — so **a naive drag test never moves anything**. The first version of this test
passed on a drag that did not move the table at all: `mockUpdateTable` was called by
pointer-up, not by the move, and both position assertions compared `10%` to `10%`.

That is the same green-on-nothing trap as rounds 51-54. The test now stubs
`getBoundingClientRect` and asserts the table **actually moved** before checking the
rollback, so it cannot pass vacuously again.

### The detector needed its third revision

The optimistic-write sweep missed this shape twice: first because it only looked for
setters *inside* the `try` (round 54's fix), then because it required the enclosing `try`
to be found by scanning *backwards* — and a setter that precedes the `try` has none. The
third revision searches *forward* for the try the mutation anticipates, and immediately
produced this finding. A detector has to be shown to find the known-bad shape before a
zero result means anything.

## Related

- `retail-optimistic-edit-not-rolled-back.md` (round 54) and
  `retail-optimistic-writes-not-rolled-back.md` (round 52) — the same three-part
  contract, in the retail grid.
- `mockfactory-gap-list-as-coverage-map.md` (round 53) — why no drag test existed at all.

> last audited 11-10-26 by docs-auditor
