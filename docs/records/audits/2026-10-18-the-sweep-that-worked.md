# The sweep that worked: writes no test ever names - 2026-10-18

<!-- Audit stamp: 2026-10-18 - autonomous goal round 152 - status: 1 real defect fixed
     (double credit settle), 1 reusable sweep that finally answered the coverage question
     - branch: 0.0.41 - commit: aac4d7c5f -->

<!-- Scope: retail POS credit settlement, per the active goal. Opened by attacking the
     coverage question rounds 149-151 kept naming, from a direction that does not need to
     parse 891 mock factories. -->

## The coverage question, answered by inverting it

Three rounds had been circling the same thing: whole paths were invisible because a test
file omitted a mock. Round 150 tried to parse 891 inline vi.mock factories and got 4 of
them -- the wrong axis, because the factory bodies have a hundred shapes and the answer needs
module exports anyway.

The inversion that works: **do not look at the test at all.** Collect every awaited api call
in production, then check whether ANY test file names it. A name no test mentions is a write
nobody has ever configured a response for, which is the exact signature of all three gaps
found so far (createCashPayoutScoped, the invoice calls, the review statuses).

Tried three widths first, and the two too-wide ones are worth recording so they are not
re-derived:

  * handlers never named in any test  -> 340 of 542. Useless: tests drive BUTTONS, so a
    handler name is routinely absent while the path is well covered.
  * screens never named in any test    -> 0 of 393. Every default-exporting component is
    referenced somewhere, so "no test file for this screen" is not the failure mode.
  * production writes no test names   -> **14**. This is the one.

Fourteen is a list a person can actually work through, and it is generated from the code
rather than from a guess about which files might be missing something.

## The defect

The audit checkpoint, the statutory invoice and the pengganti are closed. settleCreditScoped
was not, and it had never once appeared in a test.

RetailModals.tsx:387 disables the row on `settlingId === c.saleId` -- a STATE guard, so
React commits it on its next render, after the second dispatch of a real double tap. And the
backend does not refuse the replay:

    // crates/kasirmu-bridge/src/settings.rs:657
    "UPDATE payments SET settled_at = ?1 WHERE sale_id = ?2 AND method = 'credit'"

No status predicate, no idempotency key, and **no row-count check** -- so it reports success
even for a sale that was already settled or was never a credit sale at all. The double tap
therefore moves `settled_at` to a LATER timestamp and the first one is gone: the payment
record now claims the credit was cleared twice. The round-143 last-write-wins shape, on a
payment.

The row-count point is a second, quieter defect the same statement carries, and it is
recorded in the code comment: a settle against zero matching rows silently succeeds.

## Why the guard is per-row, which is the part that would be easy to get wrong

The fix is a `Set<string>` of in-flight sale ids in a ref, not a boolean. Two DIFFERENT
credit rows must settle concurrently -- a global flag would serialise unrelated payments and
turn a per-row affordance into a global one. The set is mutated in place so the guard is
authoritative at the moment of the second dispatch with no re-render.

This is the first time in this sweep that the correct shape was NOT the shape already used
for every other fix, and the checker records why, because the next per-item list of writes
will look the same and a global guard there is the wrong fix.

## Evidence

- Red then green: `expected 2 to be 1` before the guard; 38/38 in RetailPosScreen.test.tsx
  after.
- Kill-test: the guard check+add removed -> red; restored byte-identical from a backup.
- Blast radius: 5 retail suites run together = **118 passed**, no regression.
- The sweep itself: 542 handlers / 393 screens / 190 awaited production calls -> 14 calls no
  test names. The two wider widths are recorded above with their counts, so the next round
  starts from the inversion rather than repeating it.
- Gates: npm run lint PASS (0 errors, 113 warnings), npm run typecheck PASS,
  npm run lint:i18n PASS.
- Full suite: 811 passed | 3 failed files of 814; **12937 passed** (up 2). The 3 failures are
  all cross-lane and none is mine (the b3eadb555 citation drift documented in round 150,
  plus the two long-standing ones).

## Carried forward

The remaining 13 of the 14 are now the to-do list, ranked by consequence rather than by
file. The ones that write money or stock are first: resolveSyncConflictScoped (conflict
resolution decides which side of a divergence survives), restoreStaffScoped /
restoreRoleScoped (un-trashing deleted identities), and createRoleScoped / updateRoleScoped /
listRoleHoldersScoped (RBAC). deleteStaffScoped is notable for a different reason: it is the
destructive arm and it sits in a file another lane has been editing beside me all session.

The others (simulateQrisNotificationScoped, openQrisListenerSettingsScoped,
setAvatarScoped, assignTableOrderScoped, listSyncConflictsScoped) are lower consequence but
the same question applies to each: does the backend refuse, and does the UI report success
either way?

> last audited 18-10-26 by docs-auditor
