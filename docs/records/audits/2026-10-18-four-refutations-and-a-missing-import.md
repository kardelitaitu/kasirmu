# Four refutations, one real defect, and a regression my own test caught — 2026-10-18

<!-- Audit stamp: 2026-10-18 - autonomous goal round 153 - status: 1 real defect fixed
     (double staff/role restore), 4 of round 152 ranked leads refuted - branch: 0.0.41
     - commit: 5a0c5bdea -->

<!-- Scope: staff management / trash, per the active goal. Opened by re-running the
     write-coverage sweep from round 152 and working its top-ranked remainder. -->

## The sweep, re-run

The round-152 sweep (production writes no test names) was re-run before trusting the list,
and it moved: 14 became 12, because two of the names had since appeared in tests written by
other lanes. A sweep whose list can go stale is not a sweep worth quoting from memory.

The 12 remaining, worked in the ranked order round 152 proposed. Four were refuted by
reading the backend, one was real.

## The refutations, each with the reason it is safe

  * **resolveSyncConflictScoped** -- REFUSED and reported HONESTLY. The command returns
    ok=false and the UI surfaces "already resolved elsewhere" rather than an error
    (SyncConflictReviewScreen.tsx:96-106). This is a claim-check idiom, and it is the best
    behaviour in the whole class: the screen distinguishes "your resolve worked" from "someone
    else got there first" instead of calling the second a failure.

  * **restoreRoleScoped** -- a compare-and-set:
    `WHERE id = ?2 AND deleted_at IS NOT NULL AND deleted_at >= ?3`, `rows == 0` -> NotFound
    (roles.rs:627-637). A replay finds `deleted_at IS NULL` and restores nothing. There is a
    test named for it: `restore_role_refuses_a_role_whose_window_has_closed`.

  * **restoreStaffScoped** -- the same CAS, with a third predicate (`purged_at IS NULL`) and a
    retention cutoff that mirrors the purge exactly so the two clocks cannot drift
    (staff.rs:831-841).

  * **createRoleScoped / updateRoleScoped** -- ConstraintViolation -> CoreError::Conflict on a
    duplicate id or name (roles.rs:313-337).

  * **assignTableOrderScoped** -- lives inside the checkout, which the COR-7 replay guard
    already serialises. Not a double-tap surface at all.

## The real defect, and why the CAS is not enough

`restoreStaff` had the state-only shape. The CAS means no row is restored twice -- but the
SECOND call is refused with NotFound, and that refusal lands in the same catch that reports a
genuine failure. So a double tap raises "Failed to restore" for a member who WAS restored.
That is the rounds 136-137 shape, and it is the whole point of the sweep: a backend that
defends the write does not defend the MESSAGE.

The fix is a `Set<string>` of in-flight keys in a ref, not a boolean -- a staff row and a
role row are independent and restoring one must not block the other. Same per-item shape as
the credit settle in round 152.

## A regression my own change caused, caught in the same run

The first run of the full suite after the change produced **8 failures**:
`ReferenceError: useRef is not defined`. StaffTrashPanel.tsx imported
`{ useCallback, useEffect, useState }` and I had added a `useRef` call without the import.

It was caught because the file was run in full rather than only the new case -- which is the
round-136 lesson arriving for the third time: a single case passing proves nothing about
the file it lives in. Fixed the import, 73/73 green, and the kill-test then confirmed the
guard is load-bearing.

## Evidence

- Red then green: `expected 2 to be 1` before the guard; 73/73 in
  StaffManagementScreen.test.tsx after (including the 8 that failed on the missing import).
- Kill-test: both guard lines removed -> red; restored byte-identical from a backup.
- Refutations are backend-sourced with file and line, including the test that already pins
  one of them.
- Gates: `npm run lint` PASS (0 errors, 116 warnings -- three above the 113 baseline, none
  of them in my file; that came from another lane concurrent edits),
  `npm run typecheck` PASS, `npm run lint:i18n` PASS.
- Full suite: 811 passed | 3 failed files of 814; **12939 passed** (up 2). The 3 failures are
  all cross-lane and none is mine.

## Carried forward

The sweep list is down to 7, and every one of them is now either refuted or lower
consequence than the two that just closed: `setAvatarScoped`, `openQrisListenerSettingsScoped`
` / `simulateQrisNotificationScoped` (QRIS listener settings -- the one that most deserves a
look, because a QRIS listener is how money is notified), `listSyncConflictsScoped`,
`listRoleHoldersScoped`, and the `createRole`/`updateRole` pair already known to be refused.

Two things worth saying plainly. The sweep is close to exhausted on the writes it can see,
which means the next round should not expect another instance of this class by default. And
the best finding this round was not a defect at all: SyncConflictReviewScreen shows the shape
a refusal should take -- check the claim, report the difference, do not call it a failure.
That is worth copying to the screens where the backend defends the write and the UI still
lies.

> last audited 18-10-26 by docs-auditor
