# The same silent-save defect, a third time, on the table form (round 165)

## How it was found

Round 164's sweep for `sessionToken ?? ''` came up empty — the class is exhausted, only my own
comment remains. So this round went to the largest remaining uncovered surface instead:
`TableManagementScreen`, carrying **17 testids of which E2E touched exactly one** — the back
button round 149 added to prove the sidebar route.

## The defect

`+ Add Table` seeds the modal from `{ name: '', capacity: 4, … }` (`:296-301`). The Save Table
button carried **no `disabled` gate at all**, while `handleSaveTableModal` returns silently on a
blank name (`:323`). Probed live:

```
ADD_BTN=1
SUBMIT_COUNT=1
SUBMIT_DISABLED=false
ERROR_SHOWN=0            // after clicking, with a blank name
```

The identical shape to round 163's menu-editor defect, on a different screen — the third
instance of "Save armed for a save the handler refuses" in three rounds.

## The fix

One code line: `disabled={!tableModal.name.trim()}` on the submit, matching the handler's own
test. `Button` forwards `disabled` through (`components/Button.tsx:64,72,128`), verified before
trusting it.

There is a **deliberate contrast** recorded in the comment: the token guard twelve lines up
(`:318-321`) REPORTS the missing token with a toast rather than returning silently, so the
blank-name path is closed by disabling the control rather than adding a second toast — the
field is empty and the reason is self-evident.

## A reachability note, because this screen hides behind a feature flag

The sidebar ROW is feature-gated on `FEATURES.TABLE_MANAGEMENT`, which the dev mock omits — so
`openRestaurantSidebarRow(page, 'tables')` cannot reach the screen at all. The SCREEN is not
gated: `PosScreen` renders it for `showTables` (`:1542`), which `Shift+L` sets. So the spec
routes through the shortcut rounds 158-160 added, and its first assertion doubles as coverage
that the shortcut lands somewhere real.

## Covered, and kill-tested

`ui/e2e/restaurant-tables-form.spec.ts` — **4 passed**, desktop and tablet:

| Assertion |
|---|
| blank name → Save Table disabled |
| typed name → enabled (the gate is the NAME) |
| whitespace only → disabled (a space would arm a save the handler `trim()`s away) |
| the modal stays open through all of it |
| Cancel dismisses the modal and leaves the screen mounted |

**Kill-tested**: removing the gate fails both projects.

## Verified

| Item | Result |
|---|---|
| Probe before | `SUBMIT_DISABLED=false`, `ERROR_SHOWN=0` |
| Probe after | `SUBMIT_DISABLED=true` |
| New spec | **4 passed** |
| Kill-test | **2 failed** (both projects) |
| Code diff | one line; the rest is the comment |
| Full UI suite | 12,680 passed |