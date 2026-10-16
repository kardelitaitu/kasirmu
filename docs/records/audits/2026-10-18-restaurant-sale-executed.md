# Executed, not scanned — and the splice that ate a describe block — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 101 · status: 1 coverage gap closed,
     hook verified correct, 1 near-miss recorded · branch: 0.0.41 · commit: `f9074cf84` -->

<!- - Scope: acting on round 100's own conclusion — lead with execution rather than source
     scans. Tree verified green at 812/812 (12,888 passed) going in. No production code
     changed. -->

## The gap

Round 100 closed the shortcut hook's behavioural coverage and concluded that executing a
feature beats scanning it. This round applied that to the restaurant sale itself.

`PosScreenCoreFlow.test.tsx` carries 41 cases, but the restaurant workspace's own path —
render in `restaurant-pos`, scan an item, type the table, and assert the field still holds
it — had none. The file's workspace mock is mutable precisely so a case can declare the
restaurant vertical (:192-198), and its comment records a prior case where setting only
`activeWorkspace` left a path permanently unreachable: the two fields
(`activeWorkspace` and `scopeTypeKey`) are DIFFERENT and both must be set, so
half-setting them is how this case would silently test nothing.

## What it pins

The controlled input at `CartPanel.tsx:893-901` — `value={tableNumber}` with
`onChange` → `setTableNumber`. That field is the one rounds 96 and 97 both showed leaks
across resumes, and no existing case executed a keystroke into it. Kill-tested: replacing
the onChange with a no-op fails the case with `expected '' to be 'T7'`, so it measures the
real wiring rather than the presence of an element.

## The near-miss worth recording

My first attempt **destroyed the file's `describe` block**. The splice computed an end
index from a string match on the describe header and cut it out entirely — vitest reported
`Tests: no tests`, which is the quietest possible failure: a suite that has silently
vanished still "passes".

- Recovered with `git checkout --`, verified byte-identical by `git hash-object`.
- Re-applied with a precise anchor and gated on **`tsc`**, not a character count.
- **A character-count gate would have been wrong**: I first gated on brace balance, found
  452 vs 451, and reverted. Measuring the ORIGINAL showed a baseline diff of **+1** (braces
  appear inside strings and regexes), so my "imbalance" was measuring a pre-existing
  offset and the gate was meaningless. Only `tsc` decides whether a file parses.

This is the third scripted-splice failure of the session. The rule that finally works:
verify with the language tool, never with a heuristic over the cursor position.

## Verification

- **Full suite: 812/812 files, 12,889 passed, 0 failed** (3 skipped, 3 todo).
- Kill test: no-op the `onChange` → `expected '' to be 'T7'`; restored byte-identical.
- `npm run typecheck` 0 errors; `npm run lint` 0 errors.

## Standing rule

> Executing a feature is the only test that can prove the feature runs. "Tests: no tests"
> is the failure mode to fear — a suite that has silently vanished reports green, so a
> scripted edit must be gated by `tsc`, and a destroyed `describe` block is recovered by
> `git checkout` plus a `git hash-object` comparison, never by trusting the edit.

> last audited 18-10-26 by autonomous-goal-round-101
