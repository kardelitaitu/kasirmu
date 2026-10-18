# Three red suites that were never anyone else's — 2026-10-18

<!- - Audit stamp: 2026-10-18 - autonomous goal round 162 - status: 3 real defects fixed,
     the suite taken from 3 failed files to 0 - branch: 0.0.41 - commit: f26576e8f -->

<!- - Scope: closed out the carry-forward of rounds 155-161, which had been recording the
     suite's failures as cross-lane noise. Round 161 proved ONE of those "noise" files was a
     real in-scope guard; this round applied the same treatment to the rest. -->

## The triage that should have happened five rounds earlier

Rounds 155-160 carried a line reading roughly "all failures are cross-lane and none is mine".
Round 161 disproved that for one file. This round ran the full suite and checked the other
three the same way, and the verdict was the same each time: **every previously-failing file is
clean at HEAD and every failure is a real, committed, in-scope defect.**

That is worth stating without softening. The files were not another lane's in-flight work;
they were broken in committed code. The reason I kept calling them noise is that they were not
files I had edited, which is not evidence about anything.

Result: **815 files passed, 12966 tests passed, 0 failed** — from a session-long baseline of
810 passed with 4-5 failing files.

## Defect 1: a native OS dialog on a destructive table action

`TableManagementScreen.tsx:1471` asked for consent to delete a section with `window.confirm()`.
`nativeDialogCompliance.test.ts` names the reason it is a defect and not a style preference: an OS
modal is off-design, unlocalized by the app's own bundles, and **BLOCKS THE EVENT LOOP**. On a
tablet mid-service that last property is the operational one — the whole till freezes behind the
dialog while a cashier waits.

The fix follows the pattern `SyncSection.tsx` already established for the same situation: split
the handler into a REQUEST that opens the designed `ConfirmDialog` and the WORK that runs once
the operator agrees. The work body is unchanged — including the ref-carried result and the
state-closure reasoning it documents — so only the way consent is asked has moved. The message
reuses `tables-delete-section-confirm` verbatim, which was the wording the OS dialog carried, so
what the operator reads is unchanged.

## Defect 2: an elevated surface with no dither overlay

`.tables-arrange-inspector` carries `box-shadow: var(--shadow-lg)`
(`TableManagementScreen.css:1180`) and had no entry in the noise-dither `::after` lists. Fixed in
all three `components.css` lists (main + both `@media` parity blocks) and named in
`KNOWN_NOISE_SELECTORS`, which is the both-sides rule the file's own comments describe.

**The fix tripped a tripwire, and that was the tripwire working.** The known-list door asserts
the waiver count stays under a ceiling, precisely so that adding a surface to the list to dodge a
grade cannot pass silently. The failure message is explicit that a breach means a waiver got
wider, not that the tree got quieter.

I did not raise the ceiling on sight. I read the door's own stated rule — **"surfaces fixed
FIRST (the `::after` rules are what actually paint the overlay), entries named second"** — and
confirmed this change satisfies it: the `::after` entries went in, in all three lists, in the same
edit as the name. That is the sanctioned re-baseline the file's earlier entries (105 -> 107)
describe, so the ceiling moved 107 -> 108 with the population 122 -> 123 and the reasoning
recorded inline. A tree that was QUIETER would have breached the floor instead; that floor is
untouched.

## Defect 3: six comment citations pointing at nothing

`featureCommentPaths.test.ts` enforces one no-false-positive class: a same-file citation whose
target line is blank or past EOF. "No comment can be citing a blank line correctly" is a true
invariant, and it grows monotonically because a file that SHRINKS turns correct citations into
dangling ones.

Six were dangling, in two files, all drifted by other people's edits:

- `PosScreen.tsx:1382` cited `:1202` for the dispatch await — it is at `:1293`.
- `PosScreen.tsx:1900` listed three restaurant branches at `:395`, `:586`, `:1811` — all three had
  drifted; the live ones are `:458`, `:472`, `:681`.
- `TableManagementScreen.tsx` cited `:1319` for `handleRenameSection` in three places, and `:500`/
  `:506` for the chip counts.

Repairing these is where the round earned its lesson twice over. My first pass at the tables
citations was itself wrong: I rewrote `:1319` -> `:1393` from a stale line number, and the guard
immediately reported the three citations as dangling AGAIN, because `handleRenameSection` had
moved to `:1394` once my own edit shifted the file. **A citation repair is a line-number
measurement, not a substitution** — the second pass read the actual `grep` output and used it.

For the `:500`/`:506` citation the honest repair was different, because the comment describes the
PRE-fix state. Naming the live locations (`:635`/`:636`/`:637`/`:641`) and marking the old render
site as historical keeps the comment true about both the past and the present, which is what it
was trying to do and what a bare renumber would have destroyed.

## Evidence

- Full suite, chained after all three gates in one run: **815 passed (815 files), 12966 passed,
  3 skipped, 3 todo, 0 failed.**
- Gates: `npm run lint` PASS (0 errors, 116 warnings), `npm run typecheck` PASS (0),
  `npm run lint:i18n` PASS (0).
- Each defect verified against its own guard rather than by reading: native-dialog 4/4,
  noise-dither 10/10, comment-paths 2/2, all run individually before the full suite.
- The dither tripwire was read before being satisfied, and its stated ordering rule is quoted in
  the inline comment so the next breach can be judged the same way.
- Every file was confirmed dirt-free at HEAD before being edited, so none of the three fixes
  swept in another lane's work.
- Commit: `f26576e8f`, verified with `git show --name-only` -> exactly the four intended files.

## Carried forward

The suite is green for the first time in this session, which changes what "verification" means
for the rounds after this one: the baseline is now 0 failed, so ANY failure is new and must be
treated as mine to triage rather than as someone else's. That is the durable output of this
round — not the three fixes, but the removal of the excuse that let them sit.

Two things I would check next, in this order:

1. The `window.confirm` sites the native-dialog guard does NOT flag — it scans
   `ui/src/features` only, and `TransitAuditScreen.test.tsx` stubs `window.confirm`, which means
   there is at least one more out there, possibly outside the scanned roots.
2. Whether the dither-coverage walk can be made to grade through the element NAME, which this
   file's own header names as the durable remedy for the hand-synced both-sides rule.
   Every tripwire breach so far has been a symptom of that structural weakness.

> last audited 18-10-26 by docs-auditor
