# Two UI guards were red at HEAD: nine stale citations and one uncovered shadow

**Date:** 2026-10-16
**Scope:** `ui/src/__tests__/featureCommentPaths.test.ts`,
`ui/src/__tests__/noiseDitherCompliance.test.ts`.
**Result:** both green. **The full UI unit suite is now 817 files / 13,012 tests passing.**
Committed `b382daa60`.

Both failures were found by running the suite, which had not been run whole this session —
the same lesson as the E2E pass: an unrun gate is not a passing gate.

## Finding 1 — nine line citations had drifted onto blank lines

`featureCommentPaths` is the cross-file citation checker built earlier in this session. It
caught real drift in committed code. Each citation was verified against the file before being
rewritten; every one pointed at a bare `}` or a blank line rather than the code it described.

| File | Cited | Now points at | Corrected to |
|---|---|---|---|
| RestaurantMenu.tsx | `:342, :354` | a comment line, then a bare `}` | `:343, :352` (`refetchUnavailable` def, the gate flip) |
| RestaurantMenu.tsx | `:500` | a bare `}` | `:316` (the initial-fetch flip site) |
| PosScreen.tsx | `:1293` | a bare `}` | `:1337` (`await handleDispatchKitchenDelta`) |
| TableManagementScreen.tsx | `:1394` ×3 | `);` | `:1426` (`handleRenameSection`) |
| TableManagementScreen.tsx | `:635` | **blank** | `:649` (`activeTableList`) |
| TableManagementScreen.tsx | `:699` | a bare `}` | `:702` (`handleOpenMoveTable`) |

These matter because they are the breadcrumbs that make a subtle defect's explanation
findable — several of the corrected comments explain lost-update and stale-closure hazards
where the code is correct only because of a specific ordering.

### One flagged citation was TRUE, and the checker was wrong about it

`PosScreen.tsx:187` cited `(:363)` for
"`WorkspaceContext.switchStore` sets `setActiveWorkspace(null)`". Verified: in
`ui/src/contexts/WorkspaceContext.tsx`, `setActiveWorkspace(null)` at **:363** IS inside
`switchStore` (defined :354). The citation was correct.

The checker missed it because its cross-file escape hatch only recognises tokens shaped like
a filename (`name.ext:NN` or `.ext`), and `WorkspaceContext.switchStore` is a **dotted
identifier with no extension**. So a correct cross-file citation was graded as a same-file
one. The fix names the file explicitly — `(WorkspaceContext.tsx:363)` — which is strictly
more informative than the bare `:363` it replaces and puts the citation through the escape
hatch that already existed. The checker's blind spot is recorded rather than papered over.

## Finding 2 — the kiosk success card had a shadow and no dither

`noiseDitherCompliance` reported exactly one uncovered surface, with the fix in the message:

    features/kiosk/KioskScreen.css
      Selector: .kiosk-success-card

Confirmed: `KioskScreen.css:487` carries `box-shadow: var(--shadow-lg)` — the
order-confirmation card raised over the attract screen — with no noise-dither entry. Fixed the
documented way, in the order the guard's own comment demands (**surface first, entry
second**):

1. `.kiosk-success-card::after,` added to all three lists in `theme/components.css` (main +
   both `@media` parity blocks), with a comment naming the rule and the line.
2. `.kiosk-success-card` added to `KNOWN_NOISE_SELECTORS`.
3. The ratchet ceiling raised **108 -> 109** with a recorded reason — the same sanctioned
   shape as `.tables-arrange-inspector` (+1, 2026-10-18): an elevated surface given the
   overlay in the same change that named it, so it is not a new waiver.

### Kill tests

| Reverted | Result |
|---|---|
| One corrected citation (`:1426` -> `:1394`) | checker **fails**, naming it |
| The three `::after` entries | **3 tests fail**, naming `.kiosk-success-card` |

## Suite state

`npm run test`: **817 passed (817 files) · 13,012 passed · 3 skipped · 3 todo · 0 failed.**
`npm run lint`: 0 errors. `tsc --noEmit`: clean.

## Housekeeping

`ui/src/__tests__/featureCommentPaths.test.ts` was **already dirty from another lane** (a
3-line comment edit to its own historical note) before this round began. My commit names only
my five files, so their work was not swept in — verified with `git show --stat`.

> last audited 16-10-26 by docs-auditor
