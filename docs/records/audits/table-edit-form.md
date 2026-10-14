# The table EDIT form, which must arrive prefilled (round 220)

## Why this round

Round 219 left the tables screen's `tables-edit-table-btn` uncovered, and round 165's spec
covered only the ADD path — `+ Add Table` and Cancel. Edit is a different handler
(`openEditTableModal`, `:305-314`) reaching the same modal, and nothing exercised it.

## What the case pins

```ts
setTableModal({
  id: t.id,        name: t.name,
  capacity: t.capacity,  section: t.section || 'Main',  shape: t.shape || 'circle',
});
```

**The prefill is what makes it an EDIT rather than a second Add.** An empty form would mean the
operator re-enters a table they already have — and, worse, saving it would silently overwrite
that table's section and shape with the modal's defaults.

The case reads the tile's OWN name first and compares against that, rather than a fixture
literal, so it survives a change to the seed. It then clears the name and asserts the same Save
gate the ADD case pins, which is what ties the two cases to one handler.

**Kill-tested**: making `openEditTableModal` seed a blank form like Add fails it. Restored
byte-identical.

## The locator trap this hit

```
[role="dialog"] resolved to 2 elements:
  1) <div role="dialog" aria-modal="true" class="tables-detail" aria-label="Table detail">
  2) <div role="dialog" aria-modal="true" class="tables-modal-backdrop">
```

**The detail panel is also a dialog.** The ADD case can use the bare role because no panel is
open when it runs; this one opens the panel first, so it needs `.tables-modal-backdrop`. Strict
mode is what caught it — Playwright refuses rather than picking one, which is the behaviour that
turned round 217's interception report into a defect rather than a flake.

## Verified

| Item | Result |
|---|---|
| Form spec | 6 passed (3 cases x desktop/tablet) |
| Kill-test | 1 failed, the prefill case |
| `TableManagementScreen.tsx` | unchanged, byte-identical to HEAD |
| `tsc` / `eslint` | 0 / 0 |
| Full UI suite | 12,709 passed |

## A lint warning fixed while passing through

The file's header used `import('@playwright/test').Page` inline, which
`@typescript-eslint/consistent-type-imports` flags. It was pre-existing — the warning surfaced
this round because the file was finally in the lint scope for a change — and is now a top-level
`type Page` import, matching round 211's fix in the sibling spec.

## Tables coverage, six rounds on

| Surface | Round |
|---|---|
| form + Save gate (ADD) | 165, 167 |
| floor plan live | 177 |
| release confirmation | 193 |
| delete guard | 194 |
| move a tab | 195 |
| toolbar, arrange mode, assign label | 219 |
| **edit form + prefill** | **220** |

Left there: `tables-print-bill-btn`, the section badges and the tab-conflict banner. The last
needs a second terminal — the constraint round 216 recorded for its cart-side twin.