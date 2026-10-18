# Two store actions that failed with no message at all

**Date:** 2026-10-11 · **Round:** 56 (session) · **Status:** FIXED (both)
**Area:** `ui/src/features/locations/MultiStoreDashboardScreen.tsx`

## The defect

Two handlers ended in a literal `catch { // silently fail }`.

Both are consequential:

- **Set as Primary** decides which store the dashboard and the workspace treat as the
  default — the one the POS opens against.
- **Delete** removes a store profile outright, and the backend refuses one with
  dependents.

Note this is **not** the optimistic-update shape from rounds 52-55: the state setters run
*after* the `await`, so a refusal correctly leaves the row and badge untouched. What the
operator got instead was a click that did nothing **with no explanation** — the badge
stayed on the old store, the row stayed in the list, and nothing said either had failed.
The natural response is to click again.

## Fix

A new `actionError` state, reported inline as a `role="alert"` span — the same pattern
the ticket-prefix editor already uses (`:491-495`). Not the existing `error` state, which
replaces the **whole dashboard** (`:245-251`) and would be wrong for one failed row
action.

New bilingual keys `multi-store-error-set-primary` and `multi-store-error-delete`.

## Evidence

Two new tests. Both RED with the silence measured exactly:

```
AssertionError: a refused Set-Primary produced no message at all:
  expected '' not to be ''
AssertionError: a refused Delete produced no message at all:
  expected '' not to be ''
```

**Kill-tested** by replacing each `setActionError(...)` with `void err;` — both red again,
green on restore.

- `MultiStoreDashboardScreen.test.tsx` **17 passed** (was 15)
- full UI suite **807 files, 12,822 passed**
- `typecheck` clean · `eslint` clean · `lint:i18n` clean

## Why the suite could not see this

`setPrimaryLocationScoped` and `deleteLocationProfileScoped` were bare `vi.fn()` in the
module mock with **no alias**, so no test could arrange a refusal for either. The same
omission class as round 52's `KNOWN_GAPS`: a call nobody can make is a failure nobody can
observe. Both are now named mocks with resets registered in `beforeEach`.

## How this was found

Round 55's corrected optimistic-write detector, run across **all** of `ui/src` rather than
the features already swept. Seven hits; this was the only live one:

| Hit | Verdict |
|---|---|
| `BundleManagementScreen.tsx:110` | local form edit, no await — the `try` belongs to a neighbouring handler |
| `StatutoryNumberingCard.tsx:148` | `setDraft` is a form patch; `handleSave` re-reads the series rather than trusting it |
| `RecipeEditorModal.tsx:208` | reports through `setError` |
| `EmailReportSettings.tsx:231` | reports |
| `useStoreDraft.ts:145` | reports (field errors) |
| `WorkspaceKdsSettings.tsx:170` | reports |

The detector also no longer matches the retail and tables sites fixed in rounds 54-55,
because it reads current source — a fixed site stops matching, which is the direction that
confirms those fixes held.

## Related

- `retail-optimistic-edit-not-rolled-back.md` (54),
  `retail-optimistic-writes-not-rolled-back.md` (52),
  `floor-plan-drag-move-not-restored-on-refusal.md` (55) — the optimistic shape. This one
  is the sibling: correct rollback, no feedback.
- `barcode-lookup-failure-was-silent.md` (48), `kds-item-status-failure-was-silent.md` (47)
  — the same "operator told nothing" family.

> last audited 11-10-26 by docs-auditor
