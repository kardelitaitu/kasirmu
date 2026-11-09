# Note on b0e7d28a6

`b0e7d28a6` is titled "run the ftl dedupe gate as a dry run instead of rewriting the
tree" and its --stat reports 8 insertions to `scripts/check.sh`, but the commit also
carried two UNRELATED steps that a parallel worker had added to the same file:

- `step "panic inventory self-test"` (check.sh:452) -- `scan-unwrap-panic.py --self-test`,
  18 cases. The enforcing scan runs as an inline `if`, not a `step()`, so no runner
  passed the flag.
- `step "pg schema drift self-test"` (check.sh:1153) -- `generate-pg-migration.py
  --self-test`, three fail-closed gate self-tests with named mutation cases.

Their PROOF existed and no runner executed it: a grep of scripts/check.sh,
.github/workflows/, .githooks/, scripts/run-pre-push.py and scripts/gates.json found no
call before this commit. The wiring is correct and each self-test passes when invoked
by hand, but the commit message does not describe them.

The commit is NOT amended. Amending on this branch is forbidden (AGENTS.md §7.3: the
index is a racing value shared with other sessions, and an amend re-commits the whole
index). This file records the discrepancy instead, which is the sanctioned recovery.

## Correction to the brief that produced it

The finding was reported as "NO runner ever executes" for all three checkers. That is
too strong for `scan-unwrap-panic.py`: `scripts/verify-selftests-wired.py` already
counted it as wired, because that checker greps for `<name>.py --self-test` anywhere in
its runner text. Verified with the original files stashed: `verify-selftests-wired: OK
-- 52 of 73` BEFORE the edit, so it reported no gap for this file.

That is itself worth knowing: `verify-selftests-wired.py`'s scope is `scripts/` (its
`SCRIPT_DIR`), so a checker under `.agents/skills/docs-auditor/scripts/` -- such as
`check-cite-lines.py` -- is outside it entirely, and its "52 of 73" never covered the
docs checkers the auditor loop runs.

## What is true, after checking each individually

| Checker | Ran anywhere before? | Now |
|---|---|---|
| `scan-unwrap-panic.py --self-test` | No shell/CI runner did | check.sh:452 |
| `generate-pg-migration.py --self-test` | No -- and it is `generate-*`, outside the wired checker's scope | check.sh:1153 |
| `.agents/.../check-cite-lines.py --self-test` | No -- inside the wired checker's blind spot | auditor loop (5c9af7c43) |
