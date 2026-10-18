# A dead-control sweep that had to be made honest first — 2026-10-18

<!- - Audit stamp: 2026-10-18 - autonomous goal round 157 - status: 1 candidate refuted
     (a comment line, not a control), 1 automation added, 0 defects open - branch: 0.0.41 -
     commit: 8d45d7638 -->

<!- - Scope: UI reliability tooling, per the active goal. Closes the two-round carry-forward
     from rounds 155 and 156, which ended by naming KioskScreen.tsx:247 as the last real
     candidate of the static no-handler sweep. -->

## The last candidate was not a control

Round 156 closed by naming `KioskScreen.tsx:247` as the last real candidate and asking for the
same ancestor check that refuted one button and fixed another. The check takes one read, and
the answer is that `:247` is a **comment line** -- the control it describes starts at `:252`
and already carries `onClick={() => addToCart(p)}`.

So the sweep list from rounds 155-156 is exhausted: of the three candidates it produced, one
was a real dead button (fixed, round 156), one worked by accident through bubbling (given its
own handler, round 155), and one did not exist. Reporting that third one as a control would have
been the same error in the opposite direction -- a false defect is as expensive as a missed one,
because it spends the next round refuting it.

## An automated sweep, and four bugs it had before it could be trusted

Rounds 155-156 were done by hand, which is why the same question needed two rounds and why one
answer changed between them. `scripts/check-dead-controls.py` turns the question into a command.
It found four defects in itself first, and each is worth naming because each would have produced
a false reading:

- **An unterminated string literal** in the quote set, which is a syntax error the moment the file
  is parsed -- caught on the first run, not in review.
- **`re.Match.index`** was removed in Python 3.12; `m.start()` is the surviving spelling. A
  checker written against an older interpreter fails on the machine that runs it, silently, if
  nobody reads the traceback.
- **`type="submit"` counted as dead.** Five legitimate Save buttons in retail/SettingsPage carry
  no `onClick` because the enclosing form handles them. A raw "no handler" test is wrong about
  the most common correct pattern in the codebase.
- **My own round-155/156 comment blocks** were re-reported as defects -- because the comments I
  wrote to explain the previous fixes quote the markup that had no handler. The script needed an
  `in_comment()` check before it could read my own notes without flagging them.

That last one is the sharpest: an explanatory comment describing a bug is indistinguishable from
the bug to a scanner that does not skip comments. The better the fix is documented, the more
likely it is to be re-reported.

## The check was self-tested, not just run

A checker that reports `0 candidates` is indistinguishable from a checker that matches nothing,
and this script reports 0. So the zero was proved by reverting the round-156 fix: with
`onClick={onOpenProfile}` removed, the script reports `WorkspaceHome.tsx:298`; restored
byte-identical, it reports `0 candidate(s)` again. The script can fail, and does so on exactly
the input that is known to be a defect.

## Evidence

- Candidate refuted by read: `KioskScreen.tsx:247` is a comment; the button at `:252` has its
  handler.
- Script self-test: revert `WorkspaceHome.tsx:298` -> `1` candidate reported there; restore ->
  `0`. This is the kill-test applied to the checker rather than to a fix.
- No regression across the checker set: `check-state-closure-after-await.py` 0 candidates,
  `check-reentry-guards.py` 75 write handlers guarded by a state flag only (its known, argued
  population), `check-dead-controls.py` 0, `check-tz-invariance.py` zone preflight skipped as
  documented -- all exit as before.
- Gates: `npm run lint` PASS (0 errors, 116 warnings), `npm run typecheck` PASS (0),
  `npm run lint:i18n` PASS (0).
- Commit: `8d45d7638`, verified with `git show 8d45d7638 --name-only` -> exactly one file,
  `scripts/check-dead-controls.py`, `create mode 100644`. The file was confirmed untracked with
  `git cat-file -e HEAD:<path>` before the chained add-and-commit.

## What the sweep reports, and what it does not

Its own output line carries the limit rather than hiding it: `0 candidate(s) with no handler,
ancestor check not automated`. That is deliberate. Rounds 155 and 156 established that "no
`onClick`" splits into two classes -- rescued by an ancestor handler, or genuinely inert -- and
only reading the ancestor chain separates them. The script narrows the search to a handful of
controls and refuses to claim the last step. A verifier that reported "0 dead controls" would be
asserting the very thing it cannot see.

## Carried forward

The no-handler class is now closed by automation plus one manual read per candidate, and the
remaining 50 design-showcase hits need no action. The UI reliability lane is still open under the
active goal; the next round should take a class that has no automated check rather than re-running
a sweep that has reached zero.

> last audited 18-10-26 by docs-auditor
