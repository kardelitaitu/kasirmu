# Seventy NUL-filled files in node_modules, and the gate failures they faked — 2026-10-19

**Scope:** `ui/node_modules`, which is gitignored and therefore invisible to every review and
every diff. **Result:** 70 files were found zero-filled; one reinstall cleared them; a
half-hour of "test failures" turned out to be an environment fault, not code drift.

## How it surfaced

Two gates went red on files nobody had touched:

- `npm run typecheck` died with `SyntaxError: Invalid or unexpected token` inside
  `node_modules/typescript/lib/_tsc.js`, reported through Node's module loader rather than
  as a TypeScript diagnostic — the first clue that the file, not the source, was wrong.
- `vitest` reported `Startup Error` for `featureCommentPaths.test.ts`, with no file named.

Reading the file settled it: `_tsc.js` was 6,213,092 bytes and its first four were
`00 00 00 00`. The size was right and the content was all zeros — a classic
truncate-then-fail-to-rewrite signature, not a malformed build output.

## The scan, and a bug in the scan

A first pass compared the first four bytes to zero and reported **70 corrupted files**,
including `echarts/dist/*.js`, `axe-core/axe.js`, and both `_tsc.js` and `typescript.js`.

That count was wrong in a way worth recording: the same predicate also matches a
**zero-length** file, because indexing past the end of an empty byte array yields `null`,
which compares equal to `0`. `echarts.js` is 0 bytes — empty, not NUL-filled — and my
scanner threw `Cannot index into a null array` 40 times while still counting it. The fix
was to skip files shorter than 4 bytes before comparing and to require **all four** bytes
to be zero. After the reinstall the corrected scan reported **0 of 13,661**.

Empty and NUL-filled are different faults with different causes. A scan that conflates them
reports a number that cannot be acted on.

## The cause: `npm ci` was interrupted mid-rmdir

`check.sh` step 66 (`npm ci`) failed with:

```
npm error code ENOTEMPTY
npm error syscall rmdir
npm error path C:\dev\kasirmu\ui\node_modules\typescript\lib
```

`npm ci` deletes `node_modules` wholesale and rebuilds it. Interrupting that sequence —
which the matrix does routinely, since it stops at the first failing step and several runs
this session were killed by tool timeouts — leaves packages partially removed. The
zero-filled files are the residue.

**The general lesson is not "reinstall node_modules".** It is that `node_modules` is the
one large mutable dependency of the gate suite that no gate validates, so damage there
presents as arbitrary, unrelated, self-contradictory test failures across the tree. The
first `vitest` run after the corruption reported 6 failures across 4 files; a second run
of the same three files reported 1 failure in a different file, and a later run reported 3.
A failure set that changes shape between runs on unchanged source is evidence of an
environment fault, not of flaky code.

## What was NOT wrong

Every source-side finding in this stretch held up and was fixed on its own merits, with
the corrupted `node_modules` merely making them harder to see:

- seven dead CSS classes from `82a0dc983` (`screenExtraction`),
- seven restaurant cart surfaces missing the noise-dither overlay
  (`noiseDitherCompliance`),
- `isoLocalMonday()` reading local date parts where the loader reads UTC
  (`check-tz-invariance`, one zone of five).

The last one is the clearest: it reproduced identically before and after the reinstall,
which is what distinguishes a real defect from an environment fault.

## Recovery, and what to do next time

```
cd ui
Remove-Item -Recurse -Force node_modules/typescript   # targeted, when one package is named
npm install --no-audit --no-fund --ignore-scripts
```

Verified afterwards: `npx tsc --version` → `5.5.3`, `npm run typecheck` → clean,
full `vitest` → 13,045 passed / 819 files, and the corruption scan → 0 of 13,661.

A targeted `npm rebuild typescript` does **not** work — it re-runs install scripts without
restoring file contents, and left the NUL-filled file exactly as it was. The package has to
be refetched.

> last audited 19-10-26 by docs-auditor
