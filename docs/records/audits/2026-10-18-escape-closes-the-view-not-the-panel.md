# Escape closes the table view, not the panel — 2026-10-18

<!- - Audit stamp: 2026-10-18 - autonomous goal round 176 - status: 2 E2E specs repaired (2
     failed -> 6 passed across them), root cause established as a HARNESS misunderstanding of
     Escape ownership - branch: 0.0.41 - commit: a9f2684fc -->

<!- - Scope: the unexamined E2E failures round 164 named as fixtures ("the seeded bill must
     attach to a table", "the plan has a free table"). Both are restaurant TABLES surfaces,
     which is this goal lane. -->

## The failure, and what it was NOT

Running `restaurant-tables-print-bill.spec.ts` reproduces it: 1 failed | 2 passed, with
"the seeded bill must attach to a table". The obvious suspects were both wrong, and I checked
each before moving on:

- **Not the seed.** The spec writes `oz-dev-mock:held-carts`. Tracing the live DOM after
  the same setup showed `has-bill tiles: 1`, `available tiles: 5`, 12 tiles total — exactly
  what the case expects. The seed key matches `MOCK_HELD_CARTS_KEY` and the payload satisfies
  `matchesTableBill`.
- **Not timing.** Polling from the first tick: `hasBill=1` at 0ms and at every sample
  through 1750ms. Nothing loads late.

## What it actually is

The case clicks a FREE table, asserts the panel opens, then presses `Escape` to "leave the
panel", and looks for the billed tile. Tracing that exact sequence:

```
before-click      hasBill=1   tiles=12
after-free-click  hasBill=1
after-escape      hasBill=0   tiles=0     <- every tile gone
```

**Escape does not close the detail panel. It closes the whole TABLE VIEW.** The panel is not an
ARIA modal — `isAnyAriaModalOpen()` is false for it — so it can never claim the key. Escape is
owned by `useWorkspaceNavShortcuts` (`AppShell.tsx:59`), whose guard at `:79` is:

```js
!e.defaultPrevented && !isSidebarOverlayPresented() && !isAnyAriaModalOpen() && active !== 'restaurant-pos'
```

The restaurant-pos exemption is what makes this subtle: on that workspace Escape does NOT return
to the picker (measured `picker: false` after Escape), it returns to the workspace own
default view — the POS grid — and the tables sub-view goes with it.

So the case was looking for a billed tile on a screen it had just navigated away from. The
product is correct; the spec misunderstood which component owns the key.

## The repair, and the evidence it is the right one

The panel has its own **Close** button — enumerated from the live DOM:

```
["Select for Order", "Mark Reserved", "Reserve Table", "1p".."6p", "Edit Table", "Delete Table", "Close"]
```

That is what an operator presses. Replaced `Escape` with a Close-by-role click in both
specs, and added an explicit `.tables-detail-actions` count assertion where the old code
relied on Escape having worked.

**`restaurant-tables-print-bill.spec.ts` 3 passed** (from 1 failed | 2 passed).
**`restaurant-tables-toolbar.spec.ts` 3 passed** (from 2 failed | 1 passed).

## The other two specs named by the same failures, checked and cleared

Round 164 grouped four specs under these two failure messages. The other two —
`restaurant-table-move.spec.ts` and `restaurant-table-release.spec.ts` — do NOT use Escape
(`grep` confirmed) and **6 passed** when run together. So the defect was specific to the
Escape-shaped cases, and repairing two of four was the whole fix rather than a partial one.

## Evidence

- Seed and timing both refuted by live measurement before the cause was named — the two
  hypotheses a reader would reach first, and both wrong.
- The Escape ownership is read from source (`AppShell.tsx:59-84`), not inferred, and the
  exemption at `:79` explains why the picker was NOT shown while the view still changed.
- Close button enumerated from the rendered DOM rather than guessed from the source.
- Both repaired specs re-run green; the two unaffected specs re-run green.
- Commit `a9f2684fc` -> exactly the two spec files (23 insertions, 3 deletions). **No
  production file changed.** All scratch probes deleted (0 `zz-*` remain).

## Carried forward

1. Escape as a panel-closer is a trap in this suite. Any OTHER spec that presses Escape to
   dismiss a non-modal panel on a workspace screen has the same defect. Worth one grep-and-check
   pass rather than a claim that these two were the only ones — I checked the two the failure
   messages named, not the whole suite.
2. The generalisable finding: **a keyboard shortcut can be owned by a component several levels
   above the one under test.** The spec called Escape "leave the panel"; the shell called it
   "leave the workspace view". Both were reasonable and only one was true.
3. `PosScreen.tsx` is still dirty from another lane (last written ~40 min before this
   round). Untouched.

> last audited 18-10-26 by docs-auditor
