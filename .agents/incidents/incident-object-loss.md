# incident: object loss on 0.0.37, 2026-09-13, 05:46 to 05:50

written by the eod-pin worker at the request of the manager during the freeze. no git
write has been attempted since. every claim below carries the command that produced it.

## read this first, the two facts that matter most

- a 402-megabyte copy of the entire .git directory now lives OUTSIDE the repo, at
  C:/dev/ozpos/backups/git-20260913-061103. it carries all seven packs and every loose
  object, including the 1101 dangling ones, so the bargaining chip is out of reach of
  the next pass. point at it before touching anything in this checkout.
- the missing reachable blob e7c707c1 is apps/desktop-tauri/tests/kernel_lifecycle.rs,
  the exact content of the lost timing commit df0a103ad - working file, salvage copy
  (.agents/salvage/kernel_lifecycle.rs and .TIMING-FIX, one hash) and index entry all
  agree. TWO RECOVERIES happened here and they are not one event.
  object recovery, at some point after 05:52: the blob came back on its own. a worker
  ran git cat-file -t e7c707c1 before committing and it already answered blob, so the
  object existed before any repair commit landed - most plausibly written by the very
  attempt whose commit object the 05:52 prune ate, and it stayed reachable because the
  INDEX is a reachability root and the index never stopped naming it.
  edge recovery, at 8cefb1aea test(desktop-tauri): calibrate the retry-timing bound
  instead of guessing at it: that commit restored the EDGE, not the object. the blob is
  now named by a commit on the branch instead of dangling from an index entry alone.
  the two commands that tell them apart: git cat-file -t e7c707c1 answers blob, which is
  the object question; git ls-files -s -- apps/desktop-tauri/tests/kernel_lifecycle.rs
  answers whether the index is still the only root naming it, which is the edge question.
  the warning, kept in weaker form: an index-wide operation - bare git commit, git
  commit -a, git stash, or git commit --amend, which takes the index whatever the
  message meant - files what the index says without re-hashing it, and a stale index
  entry pointing at content nobody has re-hashed is bad hygiene even now that the object
  exists. pathspec commits only, and one re-hashed pathspec commit of a file whose blob
  was missing is still the cleanest way to make the branch self-consistent.

## the reads that proved it

git fsck --no-progress:

    error: refs/heads/0.0.37: invalid sha1 pointer df0a103ad56eb1f82504ac8ef370035cf036c622
    error: HEAD: invalid sha1 pointer df0a103ad56eb1f82504ac8ef370035cf036c622
    error: HEAD: invalid reflog entry bbd5feca7e4dd2c4d22ede1e7643d9e46447fde3
    error: HEAD: invalid reflog entry e6b57893d4c3b8ed662b3612ed0cb78aae4d32e8
    error: HEAD: invalid reflog entry df0a103ad56eb1f82504ac8ef370035cf036c622
    error: refs/heads/0.0.37: invalid reflog entry bbd5feca7e4dd2c4d22ede1e7643d9e46447fde3
    error: refs/heads/0.0.37: invalid reflog entry e6b57893d4c3b8ed662b3612ed0cb78aae4d32e8
    error: refs/heads/0.0.37: invalid reflog entry df0a103ad56eb1f82504ac8ef370035cf036c622

git log and git status return: fatal: bad object HEAD. the branch tip names a commit
that does not exist.

## three commits written in the same two minutes, one per writer, all unreachable

- df0a103ad  test(desktop-tauri): calibrate the retry-timing bound instead of guessing
             at it. apps/desktop-tauri/tests/kernel_lifecycle.rs, +51/-5. the tip the
             ref still points at.
- e6b57893d  test(ui): cover the second eod-report declaration - nav gate armed on
             reports:view too. ui/src/__tests__/eodReportExportPermissionDrift.test.ts,
             +57. git reported this commit as successful: [0.0.37 e6b57893d] ... 1 file
             changed, 57 insertions(+). it is now not a valid object name.
- bbd5feca7  an agent-3 baseline record. named only in the reflog; the object is gone.

## what still resolves (git cat-file -t <sha>, run by hand, output copied, not assumed)

    af6ec2eb2  -> commit   test(ui): pin the eod-report route ... (5-case pin, 159 lines)
    c54d9f9cc  -> commit   fix(ui): correct the widget gate comment and arm the three tiles
    e046e2f26  -> commit   test(desktop-tauri): re-pin the gate census rows ...
    a32b13aaa  -> commit   refactor(desktop-tauri): drop the ungated rotate_encryption_key
    48540aee0  -> commit   fix(ui): arm the widget gate on the two export tiles ...
    ce8666604  -> commit   dbcfaa13a -> commit   (also probed, both resolve)
    df0a103ad  -> fatal: Not a valid object name df0a103ad
    e6b57893d  -> fatal: Not a valid object name e6b57893d
    bbd5feca7  -> fatal: Not a valid object name bbd5feca7

the loss is shallow, not deep. history up to and including af6ec2eb2 is intact, and
af6ec2eb2 is the newest readable commit.

## store state and markers

git count-objects -v: count: 9, size: 29, in-pack: 102638, packs: 5, size-pack: 209801,
prune-packable: 0. nine loose objects against a 102k-object pack set.
ls .git | grep -iE "MERGE_HEAD|rebase|CHERRY_HEAD|REVERT|BISECT|gc" produced no output.
no rebase-apply, rebase-merge, MERGE_HEAD, CHERRY_HEAD or gc marker exists.
git fsck --no-progress --dangling | grep -c "^dangling blob" = 14.
the mechanism is now measured, not fitted. there is no repeating gc or maintenance task
in schtasks, no gc.* or maintenance entry in git config, no multi-pack-index, and no
.keep file protecting anything. the pack inventory moved under a check run by the
manager within four minutes: in-pack 102638 -> 185758 objects, packs 5 -> 7, size-pack
209801 -> 395263 kilobytes, with a 184763938-byte pack written at 06:07:57 and a
2820188-byte one at 06:07:58, on top of packs dated 05:48:26 and 05:49:32. zero git
processes were alive between passes, so each pass starts, finishes, and something starts
the next. the consequence, stated plainly: the 05:56:29 rewind made three just-created
commits unreachable and the next full repack with a prune deleted them legitimately.
that is why whole prefix directories such as objects/df and objects/e7 are gone as
directories rather than as entries, because git prune removes the directory when its last
object leaves, and it is why every pack scan came back clean. the three commits are
unrecoverable, not reattachable - that answer changed from hope to fact by measurement.
dangling counts since: 1101 objects, 704 commits, 383 trees.

## timeline, to the minute

- 05:46  ce8666604 lands, a dev-mock refactor. ui/src/dev-mock/tauri-api.ts had been
         dirty and in flight since about 05:35 and was the reason whole-suite runs
         failed to transform: Multiple exports with the same name invoke, isTauri.
- 05:48  two commits are written by two sessions and become unreachable: bbd5feca7 and
         the chain through df0a103ad.
- 05:49  e6b57893d is written and reported successful by git. it is unreachable too.
- 05:50  first failed traversal. git log after a successful commit returns fatal: bad
         object HEAD, and git ls-tree refs/heads/0.0.37 returns fatal: not a tree
         object while git rev-parse refs/heads/0.0.37 still prints df0a103ad. the ref
         answers, the object does not.
- 05:55  freeze from the manager: no git writes for anyone.
- 05:56  salvage copies plus MANIFEST.sha256, 19 lines, working-file copies only.
- 05:56:29  another session moves refs/heads/0.0.37 from the unreadable df0a103ad back
            to ce8666604, the last readable commit, by plumbing with an empty reflog
            message. no tree and no index touched. HEAD resolves again as a commit.
- 05:58  the 14 dangling blobs exported into .agents/salvage/blobs by read-only cat-file.
- 06:01  this record, and blobs/MANIFEST.sha256 (14 lines), written because the 05:56
         manifest predates the blobs directory and lists zero blobs.
- 06:03-06:08  two more repack passes land, 06:07:57 and 06:07:58. this is the window in
            which the three unreachable commits were deleted legitimately.
- 06:07  this addendum: mechanism measured, the two facts above, the backup path.
- 06:14:13, 06:17:37, 06:20:27  three more pack passes land while this record is being
             written (see the inventory note below). the passes are independent of any
             worker commit; they arrive on their own cadence.
- 06:20:30  the eod-pin extension lands as d57a8e7b3 test(ui): cover the second
             eod-report declaration - nav gate armed on reports:view too, one file,
             +57, pathspec-limited, proved by git cat-file -t d57a8e7b3 -> commit and
             git merge-base --is-ancestor d57a8e7b3 HEAD -> exit 0. it was written three
             seconds after the 06:20:27 pass, not before it.

## pack inventory observed during the hold, read-only ls --full-time

- pack-4803878f....pack, 184763938 bytes, mtime 06:07:57.45, and ls -l pack-4803878*
  returns that one file only: the pack has NO .idx alongside it.
- pack-af63f261....pack, 184769482 bytes with its .idx at 06:17:37.42 - a same-size
  successor written ten minutes later.
- pack-3f792cfc....pack 2808381 bytes at 06:20:27.7, read-only mode, with .rev and
  .mtimes; multi-pack-index present at 06:20. counts in the directory: 8 .pack against
  11 .idx, so index and pack sets no longer line up in either direction.
- tmp_pack_mg4Bqa, 8257536 bytes, read-only, mtime 06:05:07 - a leftover in-flight pack.
- no .git/gc.log and no .git/objects/info/commit-graph.
- nothing here concludes which pass wrote or unlinked what, and no worker has run any
  repack, gc, prune or multi-pack-index command. it is recorded so the owner can time
  the passes against the reflog.
- 06:11:03  the 402 MB copy of .git written outside the repo, backups/git-20260913-061103.
- later     the branch tip moves again under normal traffic, 2f30bdf00 then 438ebeec51a7,
            each carrying other sessions work and none of the three lost commits.

## salvage manifest, and its flaw

- .agents/salvage/MANIFEST.sha256 - 19 entries, sha256 plus path. covers working-file
  copies: eodReportExportPermissionDrift.test.ts, gate_audit.rs.REPIN, keys.rs, raw.rs,
  raw_tests.rs, registration_gate_tests.rs and .CEILINGS, registration_gate_debt
  .generated.rs and .CEILINGS, queue_tests.rs, tauri-api.ts, lib.rs.REMOVE-UNGATED,
  security.rs.REMOVE-UNGATED, api-security.ts and api-security-contract.test.ts, the
  widget index.ts, kernel_lifecycle.rs, .TIMING-FIX and COMMIT-MSG. two pairs are
  byte-identical duplicates sharing one hash.
- flaw, recorded rather than tidied away: one worker overwrote a possibly earlier
  manifest with a glob while writing it, so an unknown number of earlier lines were
  replaced instead of appended. read the manifest as the state at 05:56, not as a
  cumulative log.
- .agents/salvage/blobs/MANIFEST.sha256 - 14 entries, one per dangling blob, written
  this minute so the blobs are identifiable without any git command.
- .agents/salvage/eodReportExportPermissionDrift.test.ts - sha256
  665fdf8d2b55742434db551304adb50a215df75595ad61c16a3220c236919229, 216 lines, 6 cases,
  cmp-identical to the working file. this is the only copy of the content of e6b57893d
  that exists anywhere.

## the 14 dangling blobs, size and first line, from ls -la and head inside the blobs dir

    008f67ffbf    97  import { l10n } from ... reverse-parity-probe          probe
    519c24b5b7    15  # probe second                                         probe
    7dcf9f66cf    54  export const PROBE_LABEL = reverse-parity-probe-zz     probe
    808f3c7673   305  // Throwaway: proves the reverse-parity check fires    probe
    0e236d953e 23327  # ui/src/locales/shared.ftl shared UI strings          bundle
    95a3eada65 47574  # ui/src/locales/settings.ftl settings page            bundle
    6a49bfb415 48742  settings-title = Pengaturan                            id bundle
    1ddfdc078d 23579  -app-name = OZ-POS  save = Simpan                      id bundle
    7b8db5f67e 23553  -app-name = OZ-POS  save = Simpan                      near-dup
    6e083e458f 34319  //! License Activation Tauri commands.                 rs
    e8c44df587 49343  use super::*; use crate::picker; TestBridge            rs test
    ee053c4e02 23547  import { useState, useCallback, useRef ...             hook
    af486025b4  5037  @echo off REM ...                                      bat
    69b1ff6a9e 49106  # Topology Editor Refactor Checklist                   planning

four are self-labelled probes and are not lost history. the two locale bundles and the
two .id.ftl blobs are the ones to read first, because a half-written fluent bundle is
content that tends to exist in one place only. nothing here claims which commit any of
the 14 belonged to. a dangling blob is a candidate, not a verdict.

## options, none chosen

1. git update-ref refs/heads/0.0.37 af6ec2eb2
   touches: one ref file. no index, no working tree, no object write.
   gives: git log, git status and git diff work again for all six concurrent writers,
   on a readable base.
   risks: it orphans a tip chain that is already orphaned, and it does not touch the
   blobs or the files. any worker still holding one of the three commits in memory
   finds it gone later, not now. content survives either way: the working tree already
   holds the content of all three lost commits, salvaged by hash. the cost of this
   option is history, not files.
2. fetch from the remote.
   cannot work. nothing has been pushed tonight, so the remote has never seen
   df0a103ad, e6b57893d or bbd5feca7. the number of places those objects existed is
   one, and it is already zero. written plainly because it is the option people reach
   for first.
3. wait with every writer frozen, which is where we are.
   touches: nothing. risks: six sessions keep producing work that cannot be committed,
   and the uncommitted pile grows. the store stays as it is, which is not worse.

common to all three:
- do not run gc, prune, repack or fsck --repair. the 14 dangling blobs may be the only
  copy of content that exists nowhere else, and those are the commands that delete them.
- no session commits until the owner picks.

## who found it

not the manager. a worker ran git log immediately after its own commit, which git had
reported as successful, saw fatal: bad object HEAD and the fsck pointer errors, and
reported the traversal failure instead of retrying the commit. two other workers had
already stopped at the ref boundary on their own before the freeze arrived, each
holding a file on disk and a salvage copy rather than pressing retry into a broken ref.
the content of the three lost commits survives because of that. the history does not.
that asymmetry is the finding.
