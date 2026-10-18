# The delegation nothing pinned — 2026-10-18

<!-- Audit stamp: 2026-10-18 - autonomous goal round 154 - status: 0 production defects.
     1 real gap closed: the one function 184 call sites depend on was untested. branch:
     0.0.41 - commit: 1a4f3a2fa -->

<!-- Scope: shared error normalizer, per the active goal. Opened from round 153 own
     closing observation: screens where the backend defends the write and the UI lies are
     the remaining class, and SyncConflictReviewScreen shows what honesty looks like. -->

## The premise was wrong, and chasing it found something better

Round 153 finished by noting that screens where the backend refuses a replay should report
that refusal the way SyncConflictReviewScreen does, instead of calling it a failure. The
obvious question was whether they can: does the error path distinguish a conflict?

First reading said no -- 184 call sites use `l10nErrorMessage`, which looked like a generic
mapper, while `userErrorMessage` (which does map conflicts) had 7 call sites. That reading
was WRONG. `l10nErrorMessage` delegates to `userErrorMessage` on one line
(app-error.ts:350), so every one of the 184 already gets the conflict and duplicate copy:

    "This record was changed by someone else. Refresh and try again."
    "An item or category with this name or code already exists."

and `userErrorKey` distinguishes a version/revision conflict from a name/code duplicate
(:270-279). The infrastructure is complete, correct, and tested for the mapping itself
(app-error.test.ts:126-129 pins exactly the cases this session fixed: categories,
products by sku/barcode, products by version).

## What was actually unpinned

The mapping is tested. **The delegation is not.**

Breaking one line in `l10nErrorMessage` -- returning the screen fallback directly instead of
calling through -- would silently stop the app-error-* mapping from reaching all 184
callers, and every existing assertion in app-error.test.ts would stay green, because they
all exercise `userErrorMessage` and `userErrorKey` directly.

Kill-tested exactly that. With the delegation broken the new case goes red:

    expected 'screen-fallback' to be 'This record was changed by someone else...'

and with it restored, green. So the pin is load-bearing, which is the only kind worth
having.

## Three more refutations from the sweep list

The remaining 7 from the sweep were worked down, and none was a defect. Recording them so
the next round does not repeat it:

  * **simulateQrisNotificationScoped** -- a PURE function. It parses a notification and
    returns the result (qris_listener.rs:117-136); it writes nothing, so a double submit is
    harmless by construction.
  * **setAvatarScoped** -- `PosScreen.tsx:435` already guards with a double-check,
    `if (!session?.user_id || avatarBusy) return;`, which is at least as strong as a ref.
  * **openQrisListenerSettingsScoped** -- a settings read at mount, inside the same
    pattern the other settings cards use.

## Two of my test drafts were wrong, and why that is worth a line

The first version of the new case had a stub `getString` reading Fluent's SECOND argument;
Fluent is `getString(key, args, fallback)`, so the stub returned the wrong string and the case
failed while the real call sites passed. The second draft asserted that an unparseable throw
returns the screen fallback verbatim -- it does not: `userErrorMessage` passes
`USER_ERROR_FALLBACKS[fallbackKey] ?? USER_ERROR_FALLBACKS['app-error-generic']` as the
fallback ARGUMENT (app-error.ts:334), so a stub returning that argument never sees the key.
The case now models a real Fluent lookup, which is what makes the fallback-path assertion
mean anything.

That is the same lesson as the kill-test that found the missing ref in round 145: a test that
passes for the wrong reason is worse than no test, because it looks like coverage.

## Evidence

- Red then green: the case fails against the broken delegation and passes against the real
  one; 20/20 in app-error.test.ts after.
- Kill-test: `l10nErrorMessage` made to return the screen fallback directly -> the conflict
  assertion goes red; restored byte-identical from a backup.
- Premise correction is sourced to the code: the delegation at :350 and the sub-kind
  discrimination at :270-279, with the existing mapping tests at :126-129.
- Gates: `npm run lint` PASS (0 errors, 116 warnings), `npm run typecheck` PASS,
  `npm run lint:i18n` PASS.
- Full suite: 810 passed | 4 failed files of 814; **12939 passed**. Two of the four failures
  are the long-standing cross-lane ones. The other two -- featureCommentPaths and
  OrderTypeDependentValueRule -- both cite `TableManagementScreen.tsx`, which is DIRTY IN
  MY WORKTREE BUT NOT MINE: I have never edited it this session (my round-135 change was
  fcc9ed8af), and the two lanes that own it (a234e44ca, b3eadb555) are committing around me.
  Verified with `git status --porcelain` on the specific path plus `git diff --numstat` on my
  own files, which shows exactly one file changed and 50 insertions with 0 deletions.

## Carried forward

The write-coverage sweep is now closed: all 14 of its original entries have a named verdict,
four of them fixed and the rest refuted with file and line. The error-reporting question that
opened this round is also closed, and it closed on the good side -- the shared normalizer
already does the right thing, and it now has a test that keeps it doing it.

What is genuinely left is not another instance of either class. The two remaining failures in
the suite are other lanes in-flight edits, and the honest next move is either to let them
land or to take a different question entirely -- the sweep has been answered.

> last audited 18-10-26 by docs-auditor
