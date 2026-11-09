# A revision counter that only moves forward - 2026-10-18

<!-- Audit stamp: 2026-10-18 - autonomous goal round 150 - status: 1 real defect fixed
     (double faktur pengganti burn), 1 pre-existing checker credited rather than rebuilt
     - branch: 0.0.41 - commit: 293febdae -->

<!-- Scope: sales / e-Faktur, per the active goal. Opened from round 149 own
     carry-forward, which proposed building a mock-surface checker. -->

## The proposed checker already existed - and that is the finding

Round 149 finished by proposing: "for each vi.mock factory, does the module export a name
the factory omits? That check is a script, not a round, and it is the most valuable thing
left to build."

It is already built. ui/src/__tests__/mockFactorySurface.test.ts audits both directions:
KNOWN_DEAD ("what does the mock define that the module does not export?") and KNOWN_GAPS
("what does the module export that the factory omits?"), each asserted by EQUALITY so any
change in either direction is an explicit edit. Its own header records the exact failure
that motivated it - PosScreen calling getSettingScoped while createSettingsApiMock never
defined it, 125 tests in four files throwing at render, and the surface checker staying
green because it only looked for extra keys.

So the round pivoted. What the existing checker does NOT cover is inline per-file vi.mock
factories (891 of them across 733 files); it audits the nine shared factories in
test-utils/mocks/api.ts. Measuring the inline gap needed a heuristic parser over 891
near-miss shapes, and after three attempts it had parsed 4 of them - a parsing rabbit hole,
not a finding. The honest move was to stop and take the concrete target instead.

## The defect: a counter with no decrement path

This one is a new severity shape again. SalesHistoryScreen.handleCreatePengganti sets
penggantiLoading and awaits with no ref guard. And create_faktur_pengganti is not a create
at all - it is a deliberate INCREMENT:

    // crates/kasirmu-core/src/db/faktur_pajak.rs:278-300
    if current_status >= MAX_PENGGANTI_STATUS { return Err(Validation); }
    let new_status = current_status + 1;
    UPDATE sales SET faktur_pajak_status = ?1 WHERE id = ?2

The backend cannot refuse a repeat, and that is by design: its own test drives two calls in
a row and asserts 00 -> 01 -> 02 (faktur_pajak_tests.rs:195-205). An accidental second
revision is indistinguishable from an intentional one on the wire.

What makes it a defect rather than a no-op: **the status code only ever moves forward.** The
NSFP is preserved and no row is duplicated, so this is not the duplicate-row class - it is a
finite sequential slot in a legally numbered series, and an extra tap permanently advances
the sale to 02 with no revision 01 ever intended. There is no decrement path to undo it.

That is the fourth distinct severity shape this hunt has produced:

  * refused replay, false failure toast  (shift open/close, purchasing, staff)
  * duplicate row stored                (customers, cash payouts, memos, stock counts)
  * fixed-path overwrite, last write wins (the restore request)
  * forward-only counter consumed        (faktur pengganti -- this round)

## Evidence

- Red then green: expected 2 to be 1 before the guard; 46/46 in SalesHistoryScreen.test.tsx
  after.
- Kill-test: the guard check+set removed -> red; restored byte-identical from a backup.
- The pre-existing checker was run and PASSES (mockFactorySurface), so this round did not
  regress the surface it declined to duplicate.
- Gates: npm run lint PASS (0 errors, 113 warnings - one below the 114 baseline),
  npm run typecheck PASS, npm run lint:i18n PASS.
- Full suite: 811 passed | 3 failed files of 814; 12931 passed. The third failure is NOT
  mine and is documented below.

## A third cross-lane failure, named rather than absorbed

featureCommentPaths reported three dangling citations in
ui/src/features/tables/TableManagementScreen.tsx (`:899`, `:699`, `:773`). Verified rather than
assumed: that file is byte-identical to HEAD in this worktree (so not my edit), and its cited
line 899 is already past EOF at HEAD (file shrank from a longer revision in commit b3eadb555,
another lane, landed after my fcc9ed8af). My own comments carry no same-file citations at all,
so nothing in this round can have caused it.

It is recorded here because the baseline moved from 2 failures to 3 and that has to be
attributable. It is a real drift in committed code and belongs to whoever owns the tables file.

## Carried forward

The forward-only-counter shape is worth a deliberate look, because it is the one where the
backend CANNOT help: any write whose value is derived from a counter that only increments is
unrecoverable from a duplicate submit, and the UI is the only place it can be prevented. The
known instances are the e-Faktur status (fixed here) and fiscal document numbers (fixed in
rounds 148-149). Anything else that writes `value + 1` is the candidate set, and finding it is
a grep for increments rather than another sweep of the re-entry list.

> last audited 18-10-26 by docs-auditor
