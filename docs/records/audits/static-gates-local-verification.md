# Static Gates: every step verified locally (2026-10-13)

## Why this record exists

`dev-ci.yml#static-gates` was the last CI check on branch `0.0.41` with no local
reproduction. Rounds 24-29 of the restaurant-POS objective verified the individual
gates piecemeal (root policy, skill-drift, records, shadow copies), but nobody had run
the job's full step list and said so. This is that run.

It is a record rather than a gate: the gates themselves already run in CI and in
`scripts/check.sh`. What was missing was the statement that **all of them pass on this
tree**, so the next reader does not have to re-derive it from 40-odd exit codes.

## The steps, as run

Every `- name:` in the job at `dev-ci.yml:1036-1471`, executed locally:

| Step | Result |
|---|---|
| Architecture boundaries (`--strict`) | PASS - 0 findings |
| DB backup / restore self-tests | PASS - relative and absolute both work |
| No hardcoded money formatting | PASS - 1323 production `.rs` files |
| Windows config drift | PASS - 0 violations |
| Skill drift guard (+ its 40 bats self-tests) | PASS - no drift, 40/40 |
| Unified healthcheck | PASS - 20/20 |
| Dockerfile workspace parity | PASS - all 43 members |
| Panic inventory (ADR #33) | PASS |
| PG receipt checker self-test | PASS |
| Debt markers (+ self-test) | PASS |
| Client type drift (+ self-test) | PASS - every shared type matches its schema |
| Mapper alignment (+ self-test) | PASS |
| Merged source lines (+ self-test) | PASS - 7 cases |
| Replay fork control set | PASS |
| Gate roster runners / completeness (+ self-tests) | PASS - every `check.sh` step named |
| Release workflow validation (+ self-test) | PASS |
| Conventional-commit subjects | PASS - **285 commits, 0 non-conforming** |
| i18n bundle parity (+ self-test) | PASS - 0 missing keys |
| FTL attribute requests (+ self-test) | PASS - 5 cases |
| PG schema drift / migration column types | PASS - 75 migrations |
| UI typecheck gate / tripwire self-tests | PASS - 24 cases |
| EOL guard, post-commit hook guard self-tests | PASS - 22 cases |
| Records index escaping self-test | PASS - 7 cases |
| Test shadow copies | PASS - 0 shadows (fixed round 28) |
| IPC invoke token parity | PASS - 0 violations |
| Topology template parity (+ self-test) | PASS - 7 pairings |
| Feature registry | PASS - 0 issues |
| Plugin guide parity (+ self-test) | PASS |
| Fluent dynamic families | PASS - 0 gaps |
| Runner commands resolve (+ self-test) | PASS |
| Self-tests are wired (+ self-test) | PASS - 49 of 66 checkers |
| Settled-read copies (+ self-test) | PASS - 1493 files swept |
| Shell syntax (+ self-test) | PASS - 60 entry points, 7 cases |
| PowerShell syntax (+ self-test) | PASS - 26 entry points |
| Workflow syntax (+ self-test) | PASS - 4 live workflows |
| No raw query params | PASS |
| Scoped command coverage | PASS - all registered commands covered |
| Scoped ambient reads / unguarded IPC | PASS |

## Two notes for whoever repeats this

1. **`verify-commit-subjects.py` needs a range.** Run bare it exits 2 with
   `need --range <a..b> or --base <sha>` - that is the tool asking for an argument, not
   a finding. CI passes `base..HEAD`; use `origin/main..HEAD` locally.
2. **The gates are kept in step by other gates.** `check.sh`'s step list and
   `gates.json` are reconciled by `verify-gate-completeness.py`, and every checker that
   declares `--self-test` must be invoked by a runner (`verify-selftests-wired.py`), so
   a gate added to one and not the other fails rather than silently not running.

## What this does not say

A green static-gates job does not mean CI is green. As of this record the branch is
**285 commits ahead of `origin/main`**, so CI has never run against any of them; the
local runs above are the only evidence. The Rust legs need their own runs
(`cargo clippy --workspace`, the nextest suites), and the bridge suite alone takes 17.3
minutes - see `kasirmu-bridge-suite-runtime.md`.
