# A checker found what six rounds of reading did not — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 135 · status: 1 real defect
     fixed, found by RUNNING a previously-unused checker, not by reading · branch:
     0.0.41 · commit: `fcc9ed8af` -->

<!- - Scope: restaurant POS / tables UI, per the active goal. Tree verified green at
     813/813 files (12,911 passed) going in. -->

## How it was found

Not by reading. `scripts/check-state-closure-after-await.py` had never been run in this
session; it is a checker written for the round-201 `handleSendToKitchen` defect and it
reported exactly **two** candidates, both in
`ui/src/features/tables/TableManagementScreen.tsx`:

- `:1322` — `handleRenameSection`
- `:1382` — `handleDeleteSection`

Both read the `sections` **render closure** *after* awaiting `updateTableScoped` once per
table in the section:

```ts
const tablesInSection = tables.filter((t) => (t.section || 'Main') === oldName);
if (tablesInSection.length > 0) {
  await Promise.all(tablesInSection.map((t) =>
    updateTableScoped(sessionToken, { ...t, section: trimmed })));
}
const updated = sections.map((s) => (s === oldName ? trimmed : s));  // render closure
setSections(updated);                                                // REPLACES the array
```

`sections` was captured before those awaits, and `setSections` **replaces** rather than
updates. `handleAddSection` (`:1276`) is a separate control on the same modal and nothing
disables it while a rename is in flight, so a section added inside that window is absent
from `updated` and is **dropped with no message**.

## Why the reading rounds missed it

Rounds 121-134 looked at this file repeatedly. What they saw was a handler that "awaits,
then writes" — a shape that reads as sequential and correct. The defect is not in the shape
of the code; it is in **which array the code reads**, and that is only visible when you
notice the array was captured before the `await` on the line above. Round 134's lesson was
that running the linter found what six rounds of reading could not; this round is the same
lesson for a purpose-built checker.

## The fix

Both handlers now resolve the value **inside the updater**, keyed on `prev`:

```ts
setSections((prev) => {
  const next = prev.map((s) => (s === oldName ? trimmed : s));
  sectionsResultRef.current = next;
  return next;
});
const updated = sectionsResultRef.current ?? [];
```

Three things were changed beyond the two lines the checker named:

1. **A local `let updated` was rejected after measuring it.** The first version captured
   the updater's result in a local `let`. `setSections` runs the updater eagerly ONLY when
   the fiber has no pending lanes, while `JSON.stringify(updated)` on the next line is
   evaluated regardless — so under a deferred update the local is still `[]` and the write
   persists an **empty array, wiping every section**: strictly worse than the bug being
   fixed. A ref is assigned only by the updater that actually ran.
   **MEASURED HONESTLY:** jsdom under `act()` flushes eagerly, so *both* forms persist the
   same value there. The kill-test that kept the functional updater and restored the local
   `let` still **passed**. The ref is therefore a defence against a case this suite
   **cannot reproduce** — the comment says so rather than implying the test covers it.
2. **The stale `sections` dependency was dropped** from both `useCallback` dep arrays
   (`:1373`, `:1424`). `npm run lint` flagged them as *unnecessary* the moment the bodies
   stopped reading the closure — the warning is a direct signal that the closure is gone.
   Warnings went 116 -> 114, exactly two, one per handler.
3. **A pre-existing citation defect was found by the fix's own side effect.** Adding 42
   lines shifted two unrelated citations in the same file — `:1272` -> `:1276` for
   `handleAddSection`, and `:436`'s `onSubmit` target `:1525` -> `:2187`. Both were caught
   by `featureCommentPaths.test.ts` (three failures appeared in the full run; the third was
   this checker reporting the citation half of my own edit). Re-pointed, and the test-side
   citations in the same commit were re-pointed to match.

## Evidence

- **Red, then green.** `TableManagementScreen.test.tsx` case *"keeps a section added while
  a rename is in flight"* — `expected 0 to be greater than or equal to 1` before the fix.
  Kill-tested by reverting **both** production sites: red at the rendering assertion, then
  restored and re-verified byte-identical against the backup.
- **The write is asserted, not just the render.** The case reads the `setSettingScoped`
  payload and requires `['Utama', 'Patio', 'Teras']` — so it proves the *persisted* array
  carries the mid-flight section, not merely that the DOM showed it.
- **Gates:** `npm run lint` PASS (0 errors, 114 warnings, two fewer than before),
  `npm run typecheck` PASS, `npm run lint:i18n` PASS.
- **Full suite:** 811 passed | 2 failed files; 12,912 passed tests (up one, this case).
  The 2 failures are the unchanged pre-existing cross-lane ones —
  `nativeDialogCompliance` (`window.confirm` in this same file, another lane's committed
  code) and `noiseDitherCompliance`. Neither is mine and neither regressed.

## Carried forward

The same checker output should be re-run against the rest of the tree; it was written for a
defect class that has now been found twice. `handleAddSection` (`:1276`) was checked this
round and is clean: it has no `await` before its `sections` read, which is precisely the
condition the checker keys on.

> last audited 18-10-26 by docs-auditor
