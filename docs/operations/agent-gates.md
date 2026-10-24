<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (2 major, 1 minor) · Full re-audit of the ops handbook; the 2026-09-29 stamp is merged at the bottom as plain text (delimiters stripped so it cannot nest). Every gate name, script path, command and CI attribution re-derived against .githooks/pre-commit, scripts/check.sh, scripts/gates.json and .github/workflows/ — not inherited. · MAJOR 1 (§The 7 pre-commit steps, step 2): the scan-dirs list named three directories that are not the ones the hook scans. It read `features, components, frontend, contexts, hooks, platform`; the hook passes `--scan-dirs features,components,app,theme,registries,contexts,hooks`, and `ui/src/frontend` and `ui/src/platform` DO NOT EXIST. The checker's own docstring (:139) carries the same correct list, so the page contradicted a file it cites. Repaired to the hook's list. The `Eight surfaces checked` figure is CONFIRMED correct by running the census (`verify-bundle-parity: ... 8 surface(s)`). · MAJOR 2 (step 6, Go gate): its CI backstop was attributed to `dev-ci.yml#static-gates`, but the Go commands run in their OWN job — `dev-ci.yml#go-gate`, split out on 2026-09-24 — and the page's OWN job list 27 lines below already names `go-gate` separately, so the file contradicted itself. Commands were right (`gofmt -l`, `go vet`, `go test -short`); only the job was stale. Repaired. · MINOR (§Writing a checker): `Six of the seven scripts/check-*.py checkers expose --self-test` was wrong in BOTH numbers — there are EIGHT check-*.py files and SEVEN expose the flag (the eighth, `check-replay-fork.py`, keeps its cases in `scripts/test-replay-fork.py`, which the sentence already said). Repaired to seven of eight. · VERIFIED AND LEFT ALONE, each re-derived rather than trusted: the hook has exactly EIGHT `# ──` sections and all eight step names match; every step's command and flags match the hook verbatim, including `--staged-only`, the five `--include-*` flags, `--check-domain-pairs`, and the staged-only rustfmt step's `--check --edition 2024` (check-only, never `-w`); four live workflows with the documented triggers, 11 inert `.bak` in `attic/`; `dev-ci.yml` defines 18 jobs and `northflank-deploy` needs exactly the 13 named; `cargo-clippy` really runs `cargo clippy --workspace --all-targets -- -D warnings`; all six walker suites exist and `motionImportantEscapes` is genuinely a separate suite because `animationCompliance` counts `transitionDecls` as never-read; every referenced script exists; `check-replay-fork.py`'s self-test citation `:44-49` is line-exact and both documented self-test forms run green (2 and 10 cases). · NOT re-measured: whether each gate currently PASSES, the red-suite ownership anecdote's reproduction, and the walker suites' own pass counts — those are runs, not doc claims, and this audit claims only that the enforcement the page describes exists and is correctly attributed. · Superseded 2026-09-29 stamp follows as plain text:

Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file, with no prior stamp, footer or marker. It is the operational companion to the root agent guide, and its subtitle is the design statement: TEETH, NOT HISTORY. That distinction is the whole reason the file exists, and it is the sharpest framing this campaign has read on documentation in this repository. · THE ROOT GUIDE STATES THE RULES; THIS FILE STATES WHAT ENFORCES THEM. A reader who has internalised the rule that seven gates run before a commit learns nothing new here, but a reader who wants to know whether the seventh gate can be bypassed learns everything. That is a different question, and answering it is the difference between a policy and a control. The seven steps it enumerates match the list in the root guide exactly — duplication that is a liability when the two drift and an asset when they are checked against each other, which this campaign has done every round. · THE CSS BLIND SPOT IS THE PART MOST WORTH A READER'S ATTENTION, because it is a gate everyone assumes covers something it does not. A stylesheet change passes the lint step, because the lint step runs a tool that does not read stylesheets. The handbook says so plainly, and the companion page audited two rounds ago exists to give the replacement: named walker suites that grade what the linter cannot see, each with its own caveats. A handbook that documents a hole in its own enforcement is worth more than one implying completeness, because the hole is what a reader would otherwise get wrong. · IT REFERS THE READER OUTWARD for the rules themselves rather than restating them, which is the correct division of labour between a root document and an operational one and is one more reason the two stay in sync. · NOT re-measured: whether each gate currently passes, or the CI backstops it names. Running the gates is the original work, and the stamp claims only that the file describes enforcement that exists — the pre-commit hook and the CI workflows are both present, and the hook's own comments corroborate at least one step's history. · No stamp existed; this is the first. -->
# Agent Ops Handbook

> Teeth, not history: the 7 pre-commit steps, their CI backstops, and the CSS blind spot.
> For the statement of the rules themselves, read root `AGENTS.md`.

## Which section to read when a gate surprises you

Eleven sections below, added 2026-10-25 across rounds 136-167, each records ONE failure mode a
gate itself had or could not see. They are not variations on a theme -- the mechanisms differ,
which is why they are separate -- but the entry point should not require reading all eleven.

| If this happened | Read |
|---|---|
| A grep says a name is unused, or used | "The UI calls it" needs three filters |
| Two things that should differ look identical | Sameness is a comparison |
| Tests pass but the feature never runs | A hook with no mount passes every test it has |
| An allowlist is red and you want to widen it | A hand-kept baseline only rots where someone looks |
| A gate reports the same number for many rounds | A guard the walk cannot see is not a gap, and the count is not the score |
| You need to know whether flagged code can execute | The question the gate cannot ask: can it run? |
| Two gates disagree about the same call | Two reachability gates, two different questions |
| A comment cites a file or line that is wrong | A note that names a file that does not exist |
| A test fails once and passes on re-run | A leaked mock is real; a grep for one is not a diagnosis |
| A test suite is green about unopenable code | Green tests on code nobody can open |
| You are about to build a new measurement | The unrequested-command report already exists |

> If your situation is not in this table, the answer is probably "run `scripts/check.sh` and read
> its output" -- 140 gates are declared and several already report what you are about to derive.

## The 7 pre-commit steps (source: `.githooks/pre-commit`)

1. **Line-ending normalization** — strips CR from staged text files (working tree + index). Skips `*.bat`/`*.cmd` (working tree stays CRLF for cmd.exe) and real binaries. CI stand-in only: `dev-ci.yml` runs `scripts/test-eol-guard.sh` (a fixture self-test, not a live CRLF check).
2. **Bundle parity** — `scripts/verify-bundle-parity.py --staged-only` with all `--include-*` flags, over staged files in `features`, `components`, `app`, `theme`, `registries`, `contexts`, `hooks` (the hook's `--scan-dirs` list, which also matches the checker's own docstring). Eight surfaces checked against `.ftl`/`.id.ftl`. CI: `dev-ci.yml#i18n` via `scripts/lint-i18n.sh`.
3. **FTL dedupe dry-run** — `scripts/dedupe-ftl.py --dry-run` when `.ftl` files are staged.
4. **Migration column-type lint** — `scripts/verify-migration-column-types.py --staged-only` when `crates/kasirmu-core/migrations/*.sql` is staged; exact-decimal columns must be `*_minor`/`*_millionths` integers. CI: `dev-ci.yml#static-gates`, full-tree scan.
5. **PG schema drift guard** — `scripts/generate-pg-migration.py --check`; `20260813_init.pg.sql` is generated, never hand-edited. CI: `dev-ci.yml#static-gates`.
6. **Go gate** — `apps/license-server/*.go` staged: `gofmt -w` then `go vet ./...`; aborts if `go`/`gofmt` are missing. CI: its OWN job, `dev-ci.yml#go-gate` (split out of `static-gates` on 2026-09-24), runs `gofmt -l`, `go vet` and `go test -short` (note: `-l` reports, `-w` fixes).
7. **FTL orphan lint** — `scripts/verify-ftl-orphans.py --staged-only` when a `.ftl` file is staged: a key you add must be referenced, a reference you delete must not strand a key. CI stand-in only: `--self-test` blocking plus `--census` informational in `dev-ci.yml#i18n`.

Setup (opt-in per clone, not versioned): `git config core.hooksPath .githooks`.
Removed 2026-09-13: the `cargo fmt --all` pre-commit step (reformatted other agents' in-flight files). Format is check-only now: `cargo fmt --all -- --check` in pre-push, `dev-ci.yml#cargo-check`, `scripts/check.sh`, `scripts/release.sh`.
Amended 2026-10-09: the eighth pre-commit step is **Rust format (staged)** —
`rustfmt --check --edition 2024` over `git diff --cached --name-only
--diff-filter=ACM -- '*.rs'`. Check-only (never `-w`), so it cannot rewrite
another agent's in-flight file, and scoped to the files the committer owns, so
drift stops landing instead of being discovered at push time. Missing rustfmt
aborts the commit with the install hint; CI keeps the workspace-wide check as
the backstop. Per-step: seconds on a commit that stages one crate.

Amended 2026-10-08 (`a9837a2ec`): in pre-push, the workspace-wide `cargo fmt --all -- --check` is now ADVISORY — it reports drift but no longer fails the push. The pre-push verdict is diff-scoped: `rustfmt --check --edition 2024 <the push's own .rs files>` (chunked, 25 per task), with the file list handed over by the hook as `--rust-files`. Rationale: the workspace check was red at HEAD almost every day from other lanes' hunks (8 hunks / 6 files on 2026-10-08), which failed every Rust-touching push for drift it did not introduce. `dev-ci.yml#cargo-check`, `scripts/check.sh` and `scripts/release.sh` keep the workspace-wide check as-is.

## What CI actually runs

Five live workflows — re-derive with `ls .github/workflows/*.yml`, never quote this list:

| Workflow | Triggers |
|---|---|
| `dev-ci.yml` | `pull_request` to `main`, `push` to `main`, `workflow_dispatch` |
| `release.yml` | `push` on `v*` tags (desktop-only) |
| `android.yml` | `push` on `v*` tags, `workflow_dispatch` — no PR trigger |
| `website.yml` | `push` to `main` filtered to `website/**`, `prototypes/**`, `scripts/wrangler-deploy.sh` and the workflow file itself, plus `workflow_dispatch` |
| `docker-digest-drift.yml` | `schedule` (Monday 05:00 UTC), `workflow_dispatch` — advisory: it **opens an issue** on pin drift rather than failing a branch, because the pinned images use moving tags and drift is expected. Restored 2026-10-24 (`54d877434`) after seven pins rotted for two months with nothing alerting |

Everything else lives in `.github/workflows/attic/` as inert `.bak`. A push to `main` runs CI, deploys the backend (`northflank-deploy`) and deploys the site; a push to a non-`main` branch runs nothing.
`dev-ci.yml` jobs (18): `changes`, `website`, `rust-fmt`, `cargo-check`, `cargo-clippy`, `rust-doc`, `fuzz-typecheck`, `coverage-floors`, `cargo-nextest`, `release-bridge-test` (push-only, desktop bridge tests in release profile), `ui-test`, `i18n`, `ci-docs-drift`, `static-gates`, `go-gate`, `ipc-parity`, `release-readiness`, `northflank-deploy`.
`northflank-deploy` needs 13 of them (`changes`, `website`, `rust-fmt`, `cargo-check`, `cargo-clippy`, `fuzz-typecheck`, `coverage-floors`, `cargo-nextest`, `ui-test`, `i18n`, `static-gates`, `go-gate`, `ipc-parity`), so it excludes `ci-docs-drift`, `release-readiness` and the push-only `release-bridge-test`. `release.yml` defines three of them, `android.yml` and `website.yml` one each — the four files together are the live set that `scripts/verify-agents-mirrors.py` polices, so re-derive any total there rather than restating one here.
`rust-fmt` is `cargo fmt --all -- --check` on its own (~20s, no apt layer and no cargo cache); `cargo-check` is `cargo check --workspace --all-targets --all-features`. **Clippy runs in CI** as `cargo-clippy`, path-gated on Rust changes and running `cargo clippy --workspace --all-targets -- -D warnings`; `scripts/check.sh` and `scripts/release.sh` still cover the `--all-features` lane CI does not. This section said two workflows were live and that clippy was local-only until 2026-09-29 — both were true when written, and stopped being true on 2026-09-22, 2026-09-24 and 2026-09-25.
`scripts/verify-agents-mirrors.py` polices mirror claims about gate counts, step names, commit types, version, per-workflow triggers, stated job totals, and the live workflow a "mirrors <workflow>" claim names — but never opens a job's `run:` lines. **Stated job totals are graded only in the four carriers listed in the script's `JOB_PROSE_FILES`** (`docs/operations/agent-lanes.md`, `.agents/skills/pr-repair/SKILL.md`, `.agents/skills/tdd/SKILL.md`, `docs/operations/ci-pipeline.md`) — a job total written anywhere else, **including this page**, is ungraded prose that can go stale silently. This sentence claimed the checker polices job totals without that qualifier until 2026-10-11, which told a reader a machine enforces what nothing does. Canonical CI reference: `docs/operations/ci-pipeline.md`.

## CSS has no linter — verify stylesheets with the walker suites

ESLint ignores `.css` (no matching config, exits 0) and no hook step sees stylesheets, so never cite `eslint exit 0` for a `.css` change. Verify with the five walkers and report the pass counts they print:

```powershell
cd ui
npx vitest run src/__tests__/themeTokenCompliance.test.ts src/__tests__/composedRuleIdenticalPair.test.ts src/__tests__/popupBackgroundCompliance.test.ts src/__tests__/animationCompliance.test.ts src/__tests__/noiseDitherCompliance.test.ts
```

Caveats: each suite grades a fixed set of shapes (a printed denominator, not full coverage); walkers read the working tree, so record dirty `.css` paths alongside any result. Full analysis: `docs/records/audits/frontend/css-verification.md`.

One shape needs a suite of its own: a motion-enabling `!important` declaration outranks the blanket reduced-motion kill in `reset.css` (both important → specificity decides, and the kill sits at (0,0,0)). `npx vitest run src/__tests__/motionImportantEscapes.test.ts` flags those; it exists because `animationCompliance` never reads `transition` declarations at all, which is where all six escapes found on 2026-09-25 were hiding.

## Lanes, chokepoints and parallel work

The lane map, the chokepoint list, the manager loop and a quick-start tutorial live in
[agent-lanes.md](agent-lanes.md). Read it before starting a second lane.

## A red suite in a shared checkout: check ownership before you believe it

Several agents commit to one branch, so a failing suite is not automatically *yours*. Measured twice in
one session: `npm run test` reported `1 failed | 10142 passed`, then `115 failed`, with the feature under
test untouched — another session was mid-edit on shared UI files both times.

Before debugging, or "fixing", a failure you cannot connect to your own diff:

1. `git --no-optional-locks status --porcelain -- ui` — uncommitted files are someone's live edit, and the
   paths you did not touch are the ones to look at first.
2. Run the failing file alone. A failure that passes in isolation is an interaction or a flake; one that
   reproduces is real.
3. `git log --oneline -3` — if a fresh commit names the area, start there.

Do not edit another session's in-flight file to turn a suite green: it is a moving target and the commit
would sweep their half-finished work. Report it instead, and verify your own change directly — the
smallest command that covers it (`npm run test -- <file>`) is stronger evidence than a whole-suite run
you cannot attribute.

## The two steps of `check.sh` that cannot pass on a Windows workstation, and why

Both were measured 2026-10-23 during a full-matrix sweep. Neither is a code defect and neither
should be "fixed" by weakening the gate; both are recorded here so the next reader does not
re-derive them.

### Step 34 (`test workspace`) needs a PostgreSQL no unprivileged account can start

`cargo nextest run --workspace --all-features` turns on `kasirmu-api`'s `pg-tests` feature. With no
server reachable, `throwaway_test_pool` returns `None` and the arm panics by design:

```
PG integration: admin pool get failed: Error occurred while creating a new object: error connecting to server
PG sale-batch test skipped: throwaway_test_pool returned None (postgres://postgres:postgres@localhost:15432/postgres)
thread 'pg::tests::pg_create_sale_batches_product_lookup' panicked: PG test enabled but the resource is unreachable
```

CI supplies a real one (`dev-ci.yml` declares a `postgres:17-alpine` service and `OZ_TEST_PG_URL`).
**On a Windows workstation the usual local answer -- the `oz-pg-test-15432` Docker container --
needs a running Docker daemon, and a native install needs more privilege than an agent has.**
Both attempts were made and both failed for environmental reasons, not configuration ones:

| Attempt | Result |
|---|---|
| `Start-Service com.docker.service` | stays `Stopped`; `docker ps` cannot open the engine pipe |
| `choco install postgresql17` | needs elevation; failed on a NuGet lock file it could not take |
| EDB portable binaries, `initdb`, `pg_ctl` | initdb OK, start fails: `could not create shared memory segment: error code 1314` (`ERROR_PRIVILEGE_NOT_HELD`) on `CreateFileMapping(name=Global/PostgreSQL:...)` |
| same, with `shared_buffers = 16MB` | fails identically at 22 MB -- it is the `Global\` namespace, not the size |

So on such a host step 34 is expected red, and **step 36 (the JUnit receipt) inherits it** because
it grades step 34's report. To verify the rest of the workspace, run the matrix with the feature
off rather than with the step removed:

```
cargo nextest run --workspace --exclude kasirmu-app --exclude kasirmu-mobile
```

Measured that way, re-run in full on 2026-10-23 with `--no-fail-fast` so one root
cannot hide the rest:

```
Summary [ 324.861s] 10525 tests run: 10525 passed, 92 skipped      exit 0
```

The earlier figure on this page was "3771 passed, 1 failed", and the gap between the two
is the point: the first number came from a run that STOPPED at its first failure, exactly
as the note two paragraphs up warns. `--no-fail-fast` is what turns "1 failed" into a
count of everything that was verified. Nothing in this workspace depends on PG: the whole
suite is green with the feature off.

**The two totals differ by 105 tests, and the difference is the FEATURES, not the flag.**
Measured side by side on 2026-10-23:

| run | command | total |
|---|---|---|
| matrix step 45 | `--workspace --all-features --exclude …` | **10630** |
| with PG off | `--workspace --exclude … --no-fail-fast` | **10525** |

So "10525 passed" is not "the same 10525 that were pending a moment ago": `--all-features`
compiles 105 more tests into the binary, almost all of them the PG arms. Do not compare a
total from one feature set against a total from the other; the two numbers answer
different questions.

Do **not** add a silent skip for a missing server. The panicking arm is the design: a PG test
that quietly does not run is indistinguishable from one that passed, which is the failure mode
`scripts/verify-pg-tests-ran.py` exists to catch.

### `CHECK_FROM` reaches the steps a stopped run never got to

The matrix stops at its first red step, so a single environment failure hides every later
step. Measured 2026-10-23: the full run stopped at 45 (`test workspace`, no PostgreSQL) and
the UI and website steps -- 86 onward -- had not executed in any run recorded here.

```bash
CHECK_FROM=90 bash scripts/check.sh
```

Skipped steps print `NN. skipping <name> (CHECK_FROM=90)... SKIPPED` and are **not**
counted as passes, which is what makes a resumed run honest. Measured that way, steps
86-131 give **41 PASS, 1 FAIL**, and the one failure was a transient.

**Step numbers in the run are NOT the numbers a text scan gives.** The file holds 197
`step "..."` lines, of which **32 are indented inside `if` blocks** and only run when
their condition holds; the rest is whatever the run reached before it exited. So the
runtime numbering is LOWER than a line count, by an amount that depends on the
environment. Measured the same day: `ui test` is runtime step **89** and static position
**93**, and a partial run's highest number was **131** against 193 lines.

**Both figures above were re-measured 2026-10-24 and had drifted** (193→197, 42→32): the
matrix grew by 36 steps across this session's rounds, and the paragraph kept quoting the
count from the day it was written. The historical measurements below the line are kept
as-written because they are dated observations, not claims about the current tree — only
the two live counts in this paragraph are meant to be current, and they were not. Re-derive
with `grep -c '^\s*step "' scripts/check.sh`.

Never derive a `CHECK_FROM` value by counting step lines; read the number off a real run.

### One intermittent failure worth knowing about: `selftest-sweep` under a running matrix

In the run above, step 131 (`selftest sweep`) failed with

```
FAILED verify-agents-mirrors.py: rc=1 MISSED AGENTS.md  renamed header, no HEAD
readable -- accepted but announced -- the no-git fallback was turned into a failure
```

Re-run standalone immediately afterwards, the same checker and its case pass, and three
consecutive runs gave `40 green = 31 CAUGHT + 9 CLEAN; 0 red; exit 0` every time. The
anchor it needs (`.githooks/pre-commit`'s "Go gate: apps/license-server" header) is
present. So this is a TRANSIENT under concurrent load -- the checkout is shared and
several agents write to it -- and not a defect in the case.

Recorded rather than dismissed because a sweeper that reports a red on a shared checkout
is indistinguishable, at a glance, from one that found a real problem. If it recurs
outside a concurrent run, treat it as real.

### The heavy steps that had never run here, measured one by one

Beyond the 29 steps above, the matrix's 21 `cargo`/`go`/`docker`/`npm` legs had never all
been run on this host -- several are the slowest in the file and were assumed rather than
measured. Measured 2026-10-23:

| step | verdict |
|---|---|
| `cargo fmt --all -- --check` | clean |
| `gofmt -l apps/license-server` | clean |
| `go vet ./...` | clean |
| `go test -short ./...` | `ok github.com/kasirmu/license-server` — 280s when forced with `-count=1` |
| `cargo test --doc --workspace` | **14 doctests, 0 failed** |
| `migration smoke test` + `idempotency` | `migrations up to date` on BOTH runs, exit 0 |
| `test application shells` | **900 passed, 0 skipped** |
| `ui lint` / `ui typecheck` / `ui test` | exit 0 / exit 0 / 13127 passed |

Two measurement traps, both hit while doing this:

**A `cached` Go result is not a run.** `go test -short ./...` reports `ok ... (cached)` and
exits 0 without executing anything. `-count=1` forces the real run; the 280s difference
is the point. Treat any `(cached)` in a verification log as "not measured".

**`cmd | Tee-Object f | Select-Object -Last N` reports the SELECT's exit code, not the
command's.** A migration that printed `migrations up to date` came back as exit 1 through
that pipe and exit 0 when read directly. The fix is to capture `$LASTEXITCODE` in the
same statement, not through a pipeline -- the same class of trap documented above for
`--self-test` output, one level down.

### "Has a self-test" and "can fail" are different questions, and only one is greppable

Measured 2026-10-23 while auditing the checker population. A text scan for a failure path
`(SELF-TEST WRONG|return 2|assert|FAILED)` flagged four checkers as having none:
`verify-coverage-floors.py`, `verify-doc-uniqueness.py`, `verify-invoke-parity.py` and
`verify-settled-read-copies.py`.

**All four were false positives.** They fail for reasons the scan did not guess:
`verify-invoke-parity.py` collects into a `failed` list and prints
"`N self-test case(s) FAILED`" at :284; `verify-coverage-floors.py` uses a `failed`
boolean set at :105/:114/:125. Run for real, all four printed a case count and exited 0.

This is the FOURTH census in two rounds to report a gap that did not exist (350 → 59 → 7
for module docs; 4 → 0 here). The pattern is consistent enough to state as a rule:

**A grep can tell you a checker DECLARES a self-test. Only a mutation can tell you it
WORKS.** To settle it for `verify-doc-uniqueness.py` this round: the file documents its own
historical bug at :166-170 (`str(Path(f))` backslashes on Windows, so
`startswith('docs/')` was silently False for every file and the gate passed over a known
live defect). Reintroducing exactly that line made its self-test print

```
MISSED! two files both claiming single-source-of-truth were not detected
```

and exit 1 — so that case is load-bearing. Reverting restored green. That is the only
evidence worth having, and it took two minutes, which is the point.

#### The sweep, and what it found: 17 of 55 self-tests could not see their detector gutted

`scripts/sabotage-selftests.py` automates that two-minute experiment. For each checker it
blanks the body of the first top-level function that returns something (skipping
`main`/`self_test`), runs `--self-test` on a COPY under `target/`, and records whether the
exit code changed. Measured 2026-10-23 over the whole population:

```
sabotage: 55 checker(s), 17 SURVIVED (their self-test did not notice the gutted
detector), 38 killed.
```

**17 survivors is not 17 bugs**, and that distinction is the whole value of running the next
step: a first-function mutation finds *a* helper, not necessarily the DETECTOR. Every
survivor was re-triaged by mutating ALL of its functions (after the filter fix below the
population is 54, not 55; the surviving rows are the same set minus one false row):

| Checker | functions | killed | Verdict |
|---|---|---|---|
| `verify-fluent-dynamic-families.py` | 11 | 9 | covered |
| `check-debt-ledger.py` | 7 | 5 | covered |
| `verify-shell-syntax.py` | 6 | 5 | covered |
| `verify-coverage-floors.py` | 4 | 3 | covered |
| `check-chokepoints.py` | 8 | 3 | covered |
| `check-mapper-alignment.py` | 8 | 3 | covered |
| `check-rust-doc-paths.py` | 4 | 3 | covered (was 0/4 — fixed this round) |
| `verify-runner-commands.py` | 4 | 2 | covered |
| `verify-unsafe-safety.py` | 3 | 2 | covered |
| `verify-topology-parity.py` | 3 | 1 | covered (was 1/3 — phase 1 unpinned, fixed) |
| `check-orphan-prototype-files.py` | 3 | 1 | covered |
| `verify-deployment.py` | 2 | 1 | covered (`probe` is I/O; `classify` is graded) |
| `verify-exhaustive-deps.py` | 2 | 1 | covered (`run_eslint` is I/O; `measure` is graded) |
| `verify-flaky-quarantine.py` | 5 | 1 | covered |
| `verify-settled-read-copies.py` | 3 | 1 | covered |

**Final sweep after the fixes: `55 checker(s), 15 SURVIVED, 40 killed`** — the same 15
names as the table above, all I/O shells, and four checkers moved from SURVIVED to covered
as their branches were pinned. Re-run the sweep after changing any self-test; a fix is a
hypothesis until the mutant dies.

**No checker has zero killed functions.** The always-surviving names are the I/O shells —
`git`, `repo_root`, `tracked`, `tracked_files`, `repo_root`, `live_runner_files`,
`ui_sources`, `bundle_files`, `load_floors`, `select_column_list` — because a self-test that
touches no file cannot exercise a function whose whole job is to find files. That is the
correct trade: the docs say a self-test is pure, so these stay unpinned **by design**, and
the rule is that every DISTINCT DETECTOR must have at least one killed function.

**Two survivors were real holes, and the triage is what found them:** `check-rust-doc-paths.py`
(killed 0 of 4 before the fix) and `verify-topology-parity.py` (phase 1, three hand-reasoned
branches, ungraded). Both now pin their branch, so they moved off this table's problem
column — a survivor row is only harmless once you have counted its kills.

**The one false row was my census, again.** `verify-website-assets.py` turned up as
"PATH ALREADY RED, unrecognized arguments: --self-test" because my filter tested
`"--self-test" in source` — and that file carries a PARAGRAPH explaining why it deliberately
has none (:20-27, with the mutation measurement that justified the decision). The prose was
read as a capability. Fixed by requiring the quoted argparse literal. That single line
would otherwise have been filed as a broken gate; it is one of the two checkers whose
proof form is (correctly) not `--self-test`.

**The five real holes, all now pinned:**

1. `verify-architecture-boundaries.py` — `normalize_path` (:151) has a docstring describing
   the `.lstrip("./")` bug it fixed (ate `../` and the leading `/`), and no case called it.
   Seven cases green; restoring the bug left all seven green. Now 14 cases, and the bug
   reddens three of them by name.
2. `verify-core-size.py` — 16 cases graded masking/stripping rules; none ran `fail()`.
   Not cosmetic: `main()` returns `fail(...)` for a violation, and `return None` exits 0,
   so a finding would print `FAIL` and **exit success**. Now 18 cases, capturing `fail()`'s
   answer and its stderr.
3. `check-rust-doc-paths.py` — the self-test drove `ever_existed_stub`, a **parallel copy**
   of a branch that lives inline in `scan()`. Blanking `scan` survived 5/5. Now 15 cases
   that run the REAL `scan()` over synthetic docs, and the real `ever_existed()` through a
   pre-filled cache (its cache is consulted before git, so no subprocess is needed).
4. `check-rust-doc-paths.py` (second) — both history cases first replaced `ever_existed`
   with a recording stub, which meant blanking the real function still survived. Caught only
   because the sweep was re-run after the fix. **Re-run the mutation after every fix**; a
   fix is a hypothesis until the mutant dies.

5. `verify-topology-parity.py` — phase 2's `expected_kinds` was graded; phase 1
   (`check_contract_copies`), whose three branches are three different verdicts including
   the subtle "a ui/ tree with no contract file is DRIFT, not a server-only skip", was
   never called. Now driven through a temp dir by rebinding its three module-path globals
   (which needs `global` — otherwise the first read raises `UnboundLocalError`).

**A stub is not the code.** When a self-test substitutes a function to make a branch
reachable, that substitution also hides the function's own body from the mutation. Test both:
the branch through the stub, and the real function through an input it can answer without
I/O (here: a pre-filled cache).

#### The census that required the flag, and the checker it uncovered

The same round counted checkers by requiring the **quoted literal** `"--self-test"` in their
source. Result: 54 with the flag, 3 without —

| Checker | Why it lacks the flag | Verdict |
|---|---|---|
| `verify-website-assets.py` | Documents the decision at :20-27, with the mutation that justified it | **Legitimate exception** |
| `check-replay-fork.py` | Its proof is a companion test, `scripts/test-replay-fork.py` (form 2) | **Legitimate** |
| `check-query-plans.py` | Nothing. No self-test, no companion test, no mutation on record. | **Real gap — now fixed** |

`check-query-plans.py` had zero hits for `self.?test` anywhere. Its Rust-side assertions are
covered by the probe's own falsification test, but everything between probe output and the
console was ungraded — and that Python half is where the file records three measured
defects (ANSI noise, phantom blocks from cargo's "Compiling ..." lines, a plan body running
past the harness footer). Added a `--self-test` with 14 cases over those exact shapes.

**Mutation score for the new test, 5 of 5 graded functions killed:**

```
ascii_only       KILL   is_harness_line  KILL   offender_blocks  KILL
clean_block      KILL   count_probed     KILL
```

The eight survivors are the shells that build, run cargo, and read the probe file from
disk — they cannot be exercised without a build, and the self-test says so in its docstring.

**"No self-test" is not the same as "untested."** Two of the three flag-less checkers were
already proven; only reading which one had *nothing* found the gap. Require the quoted flag
for the census (prose mentions are not capabilities), then read each exception.

#### The checker the census could not see, because it lives in another directory

Widening the census to the parser's own scope (92 checkers across `scripts/`,
`website/scripts/` and `.agents/skills/*/scripts/`, `.py`/`.mjs`/`.sh`) surfaced a fourth:

| Checker | Declares `--self-test`? | Proof that exists | Runner |
|---|---|---|---|
| `check-auditor-selftests.sh` | No | **It IS a runner** — invokes 11 docs checkers' self-tests | `check.sh:260`, `required` |
| `check-replay-fork.py` | No | Companion test, `scripts/test-replay-fork.py` | wired |
| `verify-website-assets.py` | No | In-file mutation probe, documented at :20-27 | wired |
| `verify-docker-persistence.sh` | **No** | **Nothing at all** | **Nowhere** |

`verify-docker-persistence.sh` is the sharp one. It had no `--self-test`, no companion test,
no measured mutation, no note explaining an absence, **and no runner**: zero hits in
`check.sh` and in every live workflow. The only path that reaches it is
`verify-docker-all.sh:102` (STAGE 1), which `--self-test` exits before at `:83-86`. So the
"A ✔ Persistence verified" line it prints had never been produced by CI at all — while
`docs/records/audits/2026-08-31-glm-5.3f-crates-audit.md:2203` <!-- dead-ref: ok: names a prose bullet in a dated record, not a symbol --> asserted it "runs the volume
contract in CI".

**Fixed:** a `--self-test` (7 cases, no daemon) grading the three verdicts every run
depends on — the `survived()` substring test (a persistence gate that reported a LOST
record as present is the worst possible direction), the collection-completeness verdict, and
`fail()` actually *exiting* rather than returning — plus a structural case that the block
sits above the first `docker` call. Wired as `check.sh` step `docker persistence self-test`.

**Two drafts of that self-test were worthless, and both were caught by running them:**

1. Case 4 called a function that does not exist and fell back to `|| echo absent`. It
   asserted nothing and would have passed even if `--self-test` had gone on to build images.
2. The replacement re-ran `sh "$0" --self-test`, which is **recursion** — it hung until
   killed. Replaced with a structural read of the file itself.

#### The scope bug this exposed in `verify-runner-claims.py`

That audit's false claim sat in the checker built to catch exactly it, because
`docs/records/` was in `SKIP_DIRS`. The blanket skip existed for a good reason — rewriting
a dated record destroys evidence — but it conflated two kinds of document. The rule is now
**positive**: a record is skipped only when it says of *itself* that it is superseded
(`SUPERSEDED` / `HISTORICAL RECORD` / `DO NOT TRUST THIS FOR CURRENT`). A date in a
filename says when it was written, not that its claims have been retired.

Scope went from 6 to 8 claims checked, and the audit's sentence is now corrected **in
place** — "was believed to run … it does not" — rather than annotated below the line it
contradicts. Proven by restoring the false wording: exit 1, naming the file and the script.

**One more trap, in my own fix:** the first attempt filtered collected paths by
`records not in p.parents`, but `SKIP_DIRS` had already pruned the walk, so the filter ran
over a list that could not contain those files — 0 scanned, gate green. The collector now
*enters* `docs/records/` instead of pruning it. A filter downstream of an exclusion is dead
code that reads as a fix.

### Mutating shell and JavaScript, and the mutant that would have lied

The sweep covered Python only for its first two rounds, which was a stated blind spot rather
than a claim of total coverage. Widening it to 72 checkers (55 `.py`, 9 `.sh`, 8 `.mjs`)
needed a second mechanism: Python is mutated through its AST, while `.sh` and `.mjs` are
mutated by TEXT — locate `name() {` / `function name(`, then walk braces to find the close.

**The braces must be walked over a comment-and-string-blanked copy.** A `}` inside a quoted
message closes the function early, the blanking eats the rest of the file, the file no longer
parses, and every self-test "fails" — scoring as KILLED while proving nothing. A mutation
harness whose mutants are syntactically invalid reports a clean sheet over checkers it never
tested, and that is the failure this whole exercise exists to catch. The harness now carries a
`--self-test` (10 cases) that grades exactly this: the mutants parse, the braces balance, the
trailing line survives, `export function` is a candidate, and `self_test` never is.

**Bare `bash` is WSL here and exits 127.** The first run of the widened sweep would have
recorded every `.sh` self-test as "catching" its mutation, because a checker that cannot start
looks exactly like a checker that fails. Fixed with the full Git-bash path, the same rule §5
of AGENTS.md already states.

**Two scanner bugs found by triaging the survivors, both mine:**

| Symptom | Cause | Effect if believed |
|---|---|---|
| `check-release-version.mjs`: 2 funcs, 0 killed | `MJS_FUNC` anchored on `^function`, missing `export function collectErrors(...)` | A covered checker filed as an uncovered one |
| `verify-quota-coverage.sh` exit 127 | bare `bash` resolving to WSL | A real kill indistinguishable from a broken runner |

After the fixes all three `.mjs` survivors show a killed detector (`classify`, `collectErrors`,
`admits`), so none was a real gap.

**Three `.sh` checkers stay unmutable by the harness, and the row says so.** They declare
exactly one function — `self_test` — with the detector written inline in the script body, so
there is no function to gut and they report `NO MUTATABLE FUNCTION` rather than passing.
Graded by hand instead, and all four mutations were killed:

| Checker | Mutation | Result |
|---|---|---|
| `verify-docker-digests.sh` | `PIN_RE` → a non-matching pattern | exit 2 |
| `verify-docker-digests.sh` | `PIN_RE` → drops its `{64}` floor | exit 2 |
| `verify-scoped-authorization.sh` | `PERM` → a non-matching pattern | exit 2 |
| `verify-scoped-authorization.sh` | `STORE` → a non-matching pattern | exit 2 |

Both scripts define those patterns ONCE and pass the same value to the self-test and the live
scan (`awk -v PERM="$PERM"`), which is why a mutation reaches the cases at all — a self-test
grading its own private copy of a regex proves nothing about the scan.

**Final sweep: `72 checker(s), 16 SURVIVED, 56 killed`.** The survivors are the same I/O shells
(`git`, `repo_root`, `tracked`, `load_floors`, `cleanup`) plus three `NO MUTATABLE FUNCTION`
rows; every checker that has a distinct detector kills at least one mutant.

The last one pinned (round 89) was `check-debt-ledger.py`'s `entries_with_dead_file_refs` — the
rule that catches a ledger entry citing a file deleted weeks earlier. Its fixture wrote the paths
**bare**, and `FILE_REF_RE` requires backticks, so the first draft would have passed vacuously:
a regex matching nothing finds no refs, and "no refs" skips the entry. Caught by the mutation, not
by reading. That is the fourth vacuous case this session, and every one of them was a fixture that
could not reach the rule it was testing.

#### Defect-planting, and the one time it lied (rounds 90-91)

Mutation proves a SELF-TEST can fail. It says nothing about whether the LIVE gate can, so the
stronger experiment is to plant a real defect in the tree the gate reads and check it reddens.
Three results:

| gate | planted | outcome |
|---|---|---|
| `website/scripts/check-seo.mjs` | a second `<title>` on a built page | **silent pass** — `html.match(...)` without `/g` sees only the first title, while the header claims titles are "unique site-wide". Fixed: exit 1 now. |
| `website/scripts/check-ui-strings.mjs` | `<p>Planted hardcoded sentence here</p>` | reported clean — **but the fixture was mine, not the gate's**: the rule requires an English STOPWORD, and that sentence has none. Re-planted `Please confirm the deletion of this record` → exit 1. |
| `website/scripts/check-password-policy.mjs` | flipped a fixture case; removed `password_confirm` from `AuthForm.tsx` | exit 1 in both, naming the case and the flow. |

**The second row is the lesson.** A planted defect that is not the shape the rule targets proves
nothing, and it *reads* like a gate failure — the most misleading possible result. Before concluding
"the gate missed it", check that the plant satisfies the rule's own predicate. Here that meant
reading `hasStopword()` and discovering the rule grades PROSE, not arbitrary text.

#### The same trap, twice more in one round

| gate | plant | why it did not fire |
|---|---|---|
| `check-debt-ledger.py` | `**O-Z99 planted probe**` citing a dead path | the entry-ID pattern is `O-[HMLT]\d+`; **`Z` is not a tier**, so the heading never parsed. Re-planted as `O-H99` → exit 1, naming the entry and the path. |
| `verify-architecture-boundaries.py` | — | not planted: a real violation means editing a crate's `Cargo.toml`, too invasive. Its `--metadata-file` fixture mode covers the logic instead. |

**Two of the four plants this round were the wrong shape, and both looked exactly like a gate
defect.** That is the single most important measurement lesson of this session, and it is worth
stating as a rule: **a plant that does not fire proves the plant is wrong, not that the gate is —
unless you have first checked the plant against the rule's own predicate.** The two gates that did
fire (`check-seo.mjs`, `check-rust-doc-paths.py`, `check-password-policy.mjs`) fired because the
plant satisfied the predicate; the two that did not, did not.

#### Five more gates defect-planted (round 92) — all sound

| gate | plant | result |
|---|---|---|
| `check-merged-lines.py` | `const plantedSeq = 0;  useEffect(...)` in `ui/src` | exit 1, naming file:line — exactly the generator-merge shape it exists for |
| `check-scratch-leaks.py` | an unguarded `scratch_dir` call in a real test file | exit 1, naming the file, the count and the budget (0) |
| `check-tz-invariance.py` | live run, no plant | exit 0 — 5 zones × 426 tests, identical. Windows skips only the `tzset` preflight, which the file documents |
| `verify-invoke-parity.py` | dropped `sessionToken` from a real invoke | exit 1: *"the Rust command requires a session_token, but the payload carries no sessionToken; the call fails at Tauri arg deserialization"* |
| `check-rust-doc-paths.py` | a dead path citation in a real `.rs` file | exit 1, naming path and line |

**Tally: 9 gates defect-planted across rounds 90-92, 1 real defect found** (`check-seo.mjs`), 8
proven sound. The one defect was in a gate wired into two live CI jobs.

The 1-in-9 rate is the useful number: defect-planting is worth the setup cost because it finds the
failures a self-test cannot — a self-test proves the *detector* works on fixtures, and a plant
proves the *live path* works on the real tree. They fail independently, which is why both are
needed.

#### The gates I broke myself, and the one that caught it (round 93)

Widening the sweep to claim-heavy headers turned up `verify-gate-completeness.py` **already RED on
HEAD**, naming three steps with no roster row:

```
unclaimed step: 'docker persistence self-test'      -- no gates.json row names it
unclaimed step: 'query plan formatter self-test'    -- no gates.json row names it
unclaimed step: 'sabotage mutator self-test'        -- no gates.json row names it
```

**All three were mine**, added in rounds 81-92. I had run `verify-selftests-wired.py` after each
one and it said "OK — every one is invoked by a runner", which was true: the step existed and was
invoked. What it could not say was that **no roster row claimed the step**. That is a different
question, and the checker that asks it was never in my verification loop.

**The cost of the gap:** those three steps are invisible to `verify-ci-docs-drift.py`, which
iterates the gates PRESENT in the manifest — so each could never be reported as
required-but-unenforced. A step wired into `check.sh` with no row is enforcement that no audit
can see.

**Fixed**, and fixing it exposed a second, subtler error: I gave `query-plan-formatter` a `ci`
block pointing at `dev-ci.yml/static-gates` while marking it `advisory`. `verify-ci-docs-drift.py`
rejected that immediately — *"status advisory but job lacks continue-on-error: true"* — because an
advisory gate may not block a job. The step does run in CI and does fail the build, so `required`
was the honest status, not `advisory`.

**The lesson is about the verification loop, not the patch.** Ten rounds of adding steps, each one
checked with the gate that answers "is this self-test invoked?" — and never with the gate that
answers "is this step rostered?". Several gates look at the same artifacts from different angles,
and running one of them is not running the class.

#### Round 93 plants: three more, all sound

| gate | plant | result |
|---|---|---|
| `verify-debt-markers.py` | `TODO ZZ99` with no definition, in a real `.rs` file | exit 1, naming file:line and the pointer |
| `verify-feature-registry.py` | `feature: 'planted-nonexistent-feature'` on a real `registerPage` | exit 1, naming file:line and the key, twice (Rust side and FEATUREs side) |
| `verify-gate-completeness.py` | — | **already RED on HEAD** for three rows I had omitted (above) |

**Running total: 12 gates defect-planted, 1 real gate defect** (`check-seo.mjs`) **plus 1 real
process defect** (my own missing roster rows). The second kind was invisible to every gate I had
been running and only surfaced because `verify-gate-completeness.py` happened to sit in the batch
I ran this round.

**The practical rule for picking the next target:** a gate is worth planting when its header makes
a claim a plant can falsify. `verify-gate-completeness.py` ranked high precisely because its
header says "every label DECLARED in the roster resolves to a real step" — a sentence with a
checkable subject, unlike "this gate is important".

#### Running the class, not one of it (round 94)

The lesson from round 93 applied: instead of one gate, run **every checker wired into both
`check.sh` and a live workflow** — 51 of them. Twenty-odd had never been run in this session.
Three reported failure, and each had a different cause:

| checker | verdict | cause |
|---|---|---|
| `check-font-claims.mjs` | exit 1 | **a real drift.** It pins the count of required gates with no `ci` block to `13`; the tree holds **14**. The `+1` is `pipeline-verdicts`, rostered by another lane in `01b8bd378` without updating the pin. Fixed the literal. |
| `verify-coverage-floors.py` | exit 1 | *environmental.* It needs `coverage-probe.json`, which only exists after a `cargo llvm-cov` run. Not a defect. |
| `verify-commit-subjects.py` | exit 2 | *by design.* It requires `--range`/`--base`; bare, it prints that and exits 2. With a range: 0 non-conforming subjects. |

**Two of the three "failures" were the checker working exactly as specified**, which is the same
trap as rounds 90-92 in a new place: an exit code is not a verdict until you know what the tool
requires. The third was genuine and was in a gate I had never once run.

#### Final tally over the 28 never-run checkers

| outcome | count |
|---|---|
| passed as invoked | 23 |
| failed for a **real** reason (`check-font-claims.mjs`, count pin) | 1 |
| needed an argument I had not supplied (`verify-commit-subjects.py --range`, `verify-updater-signature.mjs --self-test`) | 2 |
| needed an environment artefact (`verify-pg-tests-ran.py` runs `cargo test`; `verify-coverage-floors.py` needs `coverage-probe.json`) | 2 |

**1 real defect in 28** — a lower rate than the planted 1-in-12, which is the expected direction:
running a gate needs no fixture and therefore catches fewer "the gate cannot see it" failures.
Both methods earn their place; planting finds blind spots, running finds drift.

**And note the shape of the one defect.** `check-font-claims.mjs` was green for every lane that
ran it, and red only because a *different* lane added a gate row without updating its pin. A pin
that another lane's commit can invalidate is a coordination surface, and this repo has several.

#### The 27 `check.sh`-only checkers (round 95)

Same method, the other half of the roster. Of 17 run:

| outcome | count | checkers |
|---|---|---|
| passed | 12 | chokepoints, dead-controls, orphan-prototype-files, reentry-guards, server-origins, state-closure, testid, unified-routes, namespace-governance, root-policy, doc-uniqueness, flaky-quarantine |
| **real defect** | 1 | `verify-core-size.py` — see the finding filed this round |
| needed an argument | 1 | `check-ui.mjs` (its `check:all` role) |
| needed an environment artefact | 3 | `check-bundle.mjs` (the documented `TEMP` trap), `check-font-bundle.mjs` (`ui/dist`), `verify-deployment.py` (live network) |

**The `verify-core-size.py` finding is the most useful thing this round produced.** It is real,
committed, and attributable: `7116e47c1` (another lane's ADR-64 tender work) added +24 production
lines to `payment.rs`, taking the crate to 40616 against a 40597 ceiling. It was verified against a
**clean `git worktree` of HEAD**, because the working tree carries stat-noise entries that would
have muddied the attribution.

**Not fixed here, deliberately.** `scripts/core-size-baseline.json`'s own description says the
ceiling is to be moved *"deliberately as part of a change that also says why"* and warns that
*"a ceiling that is only ever moved after the fact is a changelog rather than a ratchet"*. Raising
it from an unrelated lane to make a tree green is exactly that failure mode — so it is filed for
the owning lane instead.

**Across rounds 94-95: 45 checkers run, 2 real defects found** (a stale pin, a ceiling overrun),
**7 "failures" that were the caller's fault** — a missing argument, a missing build artefact, a
needed network probe, or the repo's own documented `TEMP` trap. The ratio is the argument for
recording how each gate is meant to be invoked: a roster of "passes as invoked" is worth far more
than a green tick.

#### The whole UI suite, end to end (round 96)

`node scripts/check-ui.mjs` — the `check:all` runner, 460s — reported **3 failures of 9 steps**.
Diagnosed one at a time, all three are environmental, and the tree is clean:

| step | verdict | cause |
|---|---|---|
| ESLint | **Pass** (64s) | — |
| TypeScript type check | **Pass** (37s) | — |
| Unit tests (vitest) | **Pass** — 13,127 tests, 232s | — |
| Data-testid compliance | **Pass** | — |
| Perf smoke (Playwright) | **Pass** (27.5s) | — |
| FTL dedupe | **Pass** | — |
| `i18n lint` | FAIL | `Cannot find module @rollup/rollup-linux-x64-gnu` — a broken npm optional dep in `ui/node_modules`, not the repo |
| `Bundle budget` + `Bundle budget (mobile)` | FAIL ×2 | the documented `TEMP` trap; with `$env:TEMP` at a writable dir both pass |

**Two of the three failures are the same `TEMP` trap the gates doc already records**, which is
the strongest argument yet for treating that entry as a standing rule rather than a note: a fresh
clone or a new terminal hits it every time, and the failure lands 2,122 modules into a build,
where it reads like a code error.

**And `i18n lint` behaved exactly as designed.** Its own output is
*"no i18n issues detected but the test runner crashed"* — it refuses to call a crashed runner
clean, which is the distinction that makes a gate trustworthy. A gate that reported "0 issues"
there would be worse than the crash.

#### Re-verifying the round-90 fix, and the eighth false alarm

The `check-seo.mjs` duplicate-title fix was re-planted to confirm it had survived six rounds. It
had — for a page the gate grades. A second plant on `/admin/index.html` reported clean, which
looked like a hole until `classify()` was read: `HEADLESS_TREES` gives those pages
`canonicalPath: null` at :538 **by design**, and `titled` filters on that field at :982. So
`/admin/` is a deliberately walked-past surface, and the same plant on an in-scope page
(`/en/about/`) reddens the gate as intended.

**That is the eighth time this session a measurement looked like a defect and was not.** The
through-line across all eight is the same, and it is now the single most repeated lesson of the
session: *the measurement is the most likely thing to be wrong.* Re-verifying a fix is worth doing
— but a re-plant must satisfy the rule's own scope before its silence means anything.

#### A redundancy census of the matrix itself (round 96)

199 `step()` invocations, parsed mechanically. **64% (128 steps) share a checker with another
step** — but 104 of those are the deliberate *bare gate + its `--self-test`* pairing, which is not
redundancy. The genuine findings are narrow:

| group | steps | verdict |
|---|---|---|
| `migration smoke test` / `migration idempotency` | 2 | **byte-identical commands.** `run_migrate` (`db.rs:17`) calls `migrations::run` once with no flag, so the second pass could not have tested idempotency. |
| `check-release-version.mjs --self-test`, `verify-updater-signature.mjs --self-test` | 4 | identical command under two different labels, from two separate wiring rounds |
| `verify-scoped-reads.py`, `verify-unsafe-safety.py` | 4 | `--self-test` and bare labels inverted versus the other 52 pairs — a relabel risk, not a merge |
| two same-basename `check-gate-runners.py` files | 2 | different files (8.6 kB vs 15.2 kB) auditing the same manifest 600 lines apart |
| `verify-namespace-governance.py` | 4 | the only 4x group; each flag is a documented distinct rule set — **not** a merge |

**The first group was fixed, not filed.** The "idempotency" step is now two real runs with an
assertion on the second (`grep -q "migrations up to date"`), and it was proven to **fail** when
that assertion does not hold. A step that cannot fail is worse than no step: it reads as coverage.

**The census also produced two useful negatives:** no step invokes a script that does not exist,
and no step sits inside a never-true conditional. Both were measured rather than assumed, because
a census that only reports the things it expected to find is not a census.

#### Acting on the census (round 97), and the roster went stale twice

Three fixes, each verified:

1. **Two duplicate steps removed.** `release version gate` and `updater signature verifier` ran the
   identical `--self-test` as the unguarded pair ~110 lines above. The deciding fact was the
   **guard**: the later block sits inside `command -v node`, so the copy there is the weaker one —
   deleting it keeps a caller on a node-less box and halves the runtime.
2. **The `verify-scoped-reads.py` labels un-inverted.** Measured: **46 pairs run bare-then-self-test,
   3 run self-test-first**, and of those 3 only this one was wrong — the other two
   (`state-closure`, `reentry-guards`) say `(self-test)` / `(report)` in their labels and carry a
   comment explaining the order. The fixed pair now reads
   `unguarded ambient ipc calls` then `unguarded ambient ipc calls self-test`.
3. **Four roster rows repointed**, because each of the two fixes above left a `gates.json` row
   naming a step that no longer existed.

**That second point is the round's real lesson.** `verify-ci-docs-drift.py` caught it immediately —
*"declares runner 'release version gate' ... but no step there matches it -- the label was either
renamed or the step deleted"* — which is precisely the gate that was red in round 93 for the same
underlying reason: **editing `check.sh` is a two-file change, and the second file is
`gates.json`.** It is now the second time in five rounds; the pair belongs in the same commit, and
running `verify-gate-completeness.py` + `verify-ci-docs-drift.py` *before* committing is what makes
that automatic rather than remembered.

#### The two same-named gate-runner checkers are NOT redundant (round 98)

The census flagged `scripts/check-gate-runners.py` and
`.agents/skills/docs-auditor/scripts/check-gate-runners.py` as a basename collision 600 lines
apart. Reading both headers settles it — they answer different questions:

| file | question it answers |
|---|---|
| `scripts/check-gate-runners.py` | does every declared step name RESOLVE? (prefix-matched, because steps carry decorators like `step "clippy workspace"`) |
| `.agents/.../check-gate-runners.py` | can a `required` gate be RUN at all? (a step that literally appears, a runner whose script exists, or a `ci` block naming a real workflow and job) |

Neither subsumes the other: the first tolerates a decorated prefix, the second requires a literal
appearance — so a gate could satisfy one and fail the other. **Recorded rather than merged**, and
both still pass. Merging them is a real design decision (which of the two matching rules wins?), and
this repo already has five checkers over `gates.json`; a sixth angle is cheaper than a merge that
changes one of the five's behaviour.

#### `verify-selftest-sweep.py` was sweeping a third of the population

Its docstring opens *"run EVERY checker's self-test, in one roster"*. Measured 2026-10-24, the
roster was `scripts/*.{py,mjs}` only — **65 checkers, while 24 more declared the same flag and
were never run by it**:

| excluded | count |
|---|---|
| `.sh` checkers beside the `.py` ones in `scripts/` | 7 |
| `website/scripts/` | 6 |
| `.agents/skills/docs-auditor/scripts/` | 11 |

Widened to three directories and three extensions. **The order mattered:** all 24 were run by hand
first and all 24 passed, so the widening closed a hole without reddening anything. A scope change
that immediately goes red is indistinguishable from a scope change that is wrong — and this repo
has already made that mistake twice (the module-doc census that went 350 → 59 → 7, and the
`--self-test` census in round 81).

**After: `89 self-test(s) across 92 checker(s); 3 declare none and were skipped`.**
`GIT_BASH` by full path is used for `.sh` for the reason this file records elsewhere: a bare
`bash` resolves to WSL here and exits 127, which would read as a failing case rather than a
checker that never ran.

#### A comment that claimed a discipline it did not keep (round 99)

`verify-debt-markers.py` opened its scope with:

> *"Directories that hold first-party source. Deriving this from the workspace rather than typing a
> list is the same discipline the other gates use: a list of package names is a list that rots."*

followed by a typed list. **It was never derived.** Measured 2026-10-24: all 11 listed roots exist,
and three tracked top-level directories are not covered — `assets` (6 source-ish files), `tools`
(7), `website` (200). None of the three carries a single `TODO O-<id>` pointer today, so the hole
is **prospective**, recorded rather than widened.

**Why the honest fix was the comment, not the list.** Deriving from the Cargo workspace covers
`crates`/`apps`/`platform`/`modules`/`foundation` but *not* `docs`, `ui/src`, `shared-ui`,
`.agents`, `ops` or `scripts` — first-party source with no Cargo member — so a derivation would
still need a list, and the comment would be half-true in a new way. The gate's real defence is
`is_scannable()`'s self-test, which asserts the corpus boundary directly; its own docstring records
that a previous version let "every .ftl in shared-ui" go unread for the life of the first release.

**A comment that describes an aspiration as an implementation is worse than no comment**: the next
reader trusts it and stops looking.

#### The ninth false alarm, with a new mechanism

While checking this, a run of `verify-debt-markers.py --self-test` appeared to print
`SELF-TEST OK` **and then** `REFUSED — no source file was scanned`, which would have been a real
dispatch bug. It was not: `--self-test` exits 0 with **zero** stderr lines, and the REFUSED text
came from a **stale file** (`target/mstmp/tz.txt`, a round-92 artifact) that my
`Select-Object -Last 3` had read because it merged two different commands' outputs.

**New mechanism, same rule:** check that the text you are reading came from the command you just
ran. Earlier instances were a pipe swallowing a status, a chained `echo` consuming it, a wrong
interpreter, and a fixture that could not reach its rule; this one is a stale buffer.

#### Proving the round-98 widening from the other direction (round 100)

Widening a scope is a claim that the new coverage WORKS. The round-98 evidence was that all 24
previously-unswept self-tests passed when run — which proves the tree is clean, not that the sweep
would notice if it were not. The complementary test is to break one and watch the sweep redden:

| plant | result |
|---|---|
| `self_test() { echo "  PLANTED FAILURE" >&2; return 2 }` in `scripts/verify-scoped-coverage.sh` | **exit 1** — `FAILED verify-scoped-coverage.sh: rc=2 PLANTED FAILURE` |
| `console.error('  PLANTED FAILURE'); process.exit(1)` in `website/scripts/check-password-policy.mjs` | **exit 1** — `FAILED check-password-policy.mjs: rc=1 PLANTED FAILURE` |

Both are in the coverage the widening added. Before round 98 neither failure would have appeared in
the sweep at all, so the sweep would have stayed green over a broken self-test — the exact shape its
own docstring opens by describing.

**A scope change needs two proofs, not one:** that the new scope passes on the tree as it stands,
and that it FAILS when the thing it grades breaks. One without the other is a green tick.

#### The last untested proof form (round 102)

Three checkers carry no `--self-test`; two of them are documented exceptions with a measured
reason. The third, `check-replay-fork.py`, keeps its cases in a companion test
(`scripts/test-replay-fork.py`) — the one proof form the sabotage sweep cannot reach, because it
mutates only `main`-adjacent functions in the checker itself and the companion lives elsewhere.

It was untested in a more specific way than "no coverage": the companion grades **`has_control()`,
a helper**, and asserts only that `main` *exists*. Gutting the checker's verdict survived:

| mutation | before | after |
|---|---|---|
| the finding branch's `return 1` → `return 0` | companion **green, 10/10** | companion **red**, naming the case |

So a tree with a one-sided COR-7 control — a real regression, per this checker's own docstring —
would have passed its entire proof form. Fixed by driving `main` against a temp fixture in both
directions: an unmodified pair approves, a control removed from the fork fails.

**And the fix needed a second correction.** The first version called `mod.main()` in-process, which
returned 0 for a fixture the subprocess correctly fails on: `main()` parses `sys.argv` itself, so an
in-process call silently re-reads the test runner's own argv. A case that passes for the wrong
reason is worse than a missing case — and it was caught only by asserting the FAILING direction,
which is the half a happy-path test would not have.

#### A probe with the wrong threshold, twice in one round (round 103)

Extending the round-90 method ("does the LIVE path use the code the self-test grades?") produced a
clean-looking report — 15 regex constants "DEAD IN PRODUCTION" across 6 checkers. All 15 were
false. The probe counted a constant's DEFINITION as its only live use and flagged anything at
`uses_live <= 1`:

| constant | probe said | actually used at |
|---|---|---|
| `OZ_SET` (`verify-plugin-guide-parity.py:84`) | dead | :178 |
| `LEGACY_HEAD` (:90) | dead | :183 |
| `CLI_DOC` (:92) | dead | :211 |
| `KUBE_TOKEN` (`verify-ci-docs-drift.py:134`) | dead | :971, :974 |
| `JOB_MATRIX_ROW` (:136) | dead | :940 |

The threshold, not the tree, was wrong. **A count that includes the declaration is not a use
count**, and a probe that reports a whole family of the same finding in one pass is usually
reporting its own arithmetic — the same lesson as the round-84 "twenty dangling paths", in a new
place.

**The delegation on the same question had not returned when round 103 closed**, so it was closed
by measurement instead (round 104), and the probe needed **three** corrections before its answer
was worth anything:

| version | classifier | answer |
|---|---|---|
| v1 | referenced anywhere, definition counted as a use | 15 "dead" — all false |
| v2 | "after `def self_test` starts" | same 15 — `main()` is defined AFTER `self_test`, so live code was read as test code |
| v3 | by **enclosing function** | 6 candidates |

v2's failure is the interesting one: the obvious line-order heuristic is wrong because these files
put `self_test` near the TOP (:105 in one file, :634 in another) and `main` at the BOTTOM. A
classifier built on "test code comes last" reads the entire live path as a test.

**What v3 found, after hand-checking every hit:**

- **2 genuinely dead constants**, now removed: `USE_STATE_RE`
  (`check-state-closure-after-await.py:75`) and `HANDLER_BLOCK_RE` (`verify-ipc-parity.py:122`) —
  one occurrence each, the definition itself. Both files' self-tests and live runs unaffected.
- **4 false positives**, all one shape: constants referenced from a `PATTERNS` list literal
  (`verify-no-hardcoded-money-format.py:148-153`) that the live path iterates at :324. **A lexical
  probe cannot follow indirection through a collection**, and that is a limit worth stating rather
  than patching: the next person running this census will hit it.

**The question this closes:** no other check-seo-style divergence was found. The one real defect of
that shape (round 90) was in `.mjs`, where the live code and the tested code were different
expressions; in Python the checkers route rules through named constants, and the two that did not
are now deleted.

#### Running the gates found what auditing them could not (round 105)

Rounds 103-104 audited the checkers by READING them. This round RAN them, and two gates went red
for reasons no audit would have found:

| gate | failure | cause |
|---|---|---|
| `verify-runner-claims.py` | "2 claim(s) assert CI enforcement that does not exist" | an untracked, un-gitignored **`.tmp_windows.txt`** (10,866 lines of another session's captured output) at the repo root, read as a live document. It quoted THIS file's docstring, so the gate reported itself. |
| `check-dead-refs.py` | "8 unresolved reference(s)" | **my own round-84 paragraph** documenting the `.json`/`.js` path bug — quoting the phantom spellings as examples, which the gate read as real paths. |

**Both fixed.** The gate now skips `.tmp_*`/`tmp_*` filenames (a claim in a scratch file is not a
claim), and the paragraph describes the phantom spellings instead of writing them. Result:
`runner-claims` 7 claims all hold, `dead-refs` **0 unresolved references**.

**The lesson is about which method finds what.** Reading a checker tells you its logic; running it
tells you whether the tree still satisfies it. Rounds 103-104 read, and found dead constants. This
round ran, and found a stray file and a self-inflicted doc error — neither visible by reading.

**And one of them was mine, caused by the round that produced the record.** The round-84 entry
documented a bug by quoting its output, and the quoting became the bug twelve rounds later. A record
of a failure should describe the shape, not reproduce the artefact.

#### And a tenth false alarm, from my own probe (round 100)

Auditing my own citations in this file, a scan reported **3 of 4 `file:LINE` citations broken** —
`check.sh:253`, `verify-docker-all.sh:102`, `check-ui.mjs:287` all "FILE MISSING". They are not:
the citations are written relative and the files live under `scripts/`, which my probe did not try
resolving against. All four resolve, and each lands on the line it claims.

**This is the tenth time a measurement was wrong and the code was right**, and it is the third time
the measurement was mine rather than a tool's — a pipe, a chained `echo`, a stale buffer, and now a
probe with too few candidate paths. The count is the point: at some frequency the prior is not
"the code is wrong", it is *"re-read the measurement"*, and the cheapest first move on any failure
is to re-derive it a second way.

#### Auditing my own doc, and a subagent that was also wrong (round 100)

A delegated audit of `docs/operations/agent-gates.md` + `ci-pipeline.md` reported **8 FALSE/STALE
claims**. Six were real and are now fixed; two were the auditor's own errors, which is the more
useful half:

| its claim | what I measured |
|---|---|
| "16 `check-*.py` files, 13 declare `--self-test`" → should be 17/14 | **17 files, 16 declare.** It missed that `check-ftl-attrs.py` and `check-state-closure-after-await.py` use **single-quoted** `'--self-test'` — the very trap it had just identified. |
| "the `:695` pointers are stale" | They are stale, but they sit **above** the file's own 2026-09-24 disclaimer block that already declares them stale and says why. No action needed. |

**Fixed for real:** 161→197 steps (×2 files), 193/42→197/32 step and indented counts, the 16/13
census, `check.sh:253`→`:260`, a live table row's `dev-ci.yml:695` pointer, and the
`release.yml.bak` row (it is in `attic/`, not a sibling, and at 516 lines the live file is now the
longer of the two — so the "stale twin" is the *shorter*).

**The rule this adds:** a delegated audit needs its findings re-derived too. It was right about
every *number* it could count and wrong about two things that needed *context* — a quote style and
a disclaimer block. Reading beats measuring for context; measuring beats reading for numbers.

#### Measuring the extraction candidates behind the size overrun (round 101)

The `kasirmu-core` finding says "extract or raise", which is only useful if the extraction target
is named. Measured 2026-10-24:

- the +24 lines themselves are a **poor candidate**: `payment.rs` is 119 lines (100 production),
  two structs, no free functions — a cohesive domain type;
- the production files actually over the house's 1000-line rule are `db/popularity.rs` (**1151**)
  and `db/audit.rs` (**1118**);
- `audit.rs` was analysed and rejected on the record (its four concerns share one
  `insert_audit` body);
- **`popularity.rs` is the candidate**: 4 free functions plus a single `impl Store<'_>` block
  spanning :192-1203, which is exactly the shape the 1000-line rule was written for.

Filed into the finding rather than acted on — refactoring another lane's domain is not this
lane's call, and a half-finished extraction would be worse than the overrun.

#### An empty-corpus census, done two ways

Delegated a sweep for gates that can print a clean verdict over a corpus of zero. While it ran, the
`.mjs` half was measured directly: **every corpus-collecting `.mjs` checker has a guard**
(`walkAll`/`readdirSync` paired with a refusal or floor), and the two without one
(`check-updater-compat.mjs`, `verify-updater-signature.mjs`) collect no corpus at all — they take
arguments, so the mode does not apply.

**The useful output of this round is the *list*, not the fixes.** 51 wired checkers is a roster
anyone can re-run, and now one more of them is green. A gate nobody runs is not a gate — the same
sentence this project has written three times about gates, now applied to the gates themselves.

#### Extending the sweep to EVERY function found three more unpinned detectors

The sweep mutates only the FIRST candidate per checker. Triaging every survivor by mutating *all*
of its functions (round 88) found three more unpinned detectors, all pure functions whose
docstrings record a past bug and which no case ever called:

| function | checker | what the docstring claims | what the code does |
|---|---|---|---|
| `select_column_list` | `check-mapper-alignment.py` | ends the list at the first TOP-LEVEL FROM, so a nested subquery does not truncate it | ✅ holds — pinned over 5 shapes |
| `large_tables`, `covered_probes` | `check-query-plans.py` | regex reads of the Rust probe source | ✅ hold — pinned |
| `column_base` | `check-mapper-alignment.py` | `CAST(x AS t)` resolves to `x` | ❌ returns `"x as integer"` |
| `words_related` | `check-mapper-alignment.py` | accepts `closed_count`→`closed_shift_count` "while still catching `shift_count`" | ❌ `shift_count` **is accepted** — both its words appear in the field |

**The two ❌ rows are pinned as the CODE behaves, not as the comment says.** Pinning them to the
docstring would make the suite red on a tree that is green, and "fixing" the code is a behaviour
change nobody asked for. Pinning reality and naming the divergence is the only option that leaves
the gate useful — the next reader learns the comment is optimistic rather than the gate broken.
#### The contract tests I set out to write already existed (round 124)

The plan was to convert "four acquirer behaviours unproven by anything in this repo" into contract
tests. **They are already there** — 21 passing integration tests plus 22 unit tests — and the
`payment-methods` plan's §1.4 described all three of its Phase-2 bullets as future work when all
three have shipped. Re-derived and corrected (`3c40d667e`).

| §1.4 bullet | stated | measured 2026-10-24 |
|---|---|---|
| "Implement the stubbed `payment_gateways` CRUD" | future | live CRUD + encrypted at rest, wired to both shells and a 52-test screen (already corrected round 120) |
| "Midtrans SNAP client in Rust" | future | `authorize`/`capture`/`refund`/`void`/`receipt` with polling, 21 integration tests |
| "`idempotency_key` … (field already in schema, waiting)" | future | honoured in `order_id_for()`; five properties pinned |

**And the four "unproven" behaviours each have a named test:** generic-QR interop
(`authorize_happy_path`, `authorize_blank_acquirer_falls_back_to_generic`), targeted-QR restriction
(`authorize_sends_configured_acquirer_verbatim` — acquirer forwarded verbatim, nothing else about the
charge changes), refund behaviour (four tests including partial amounts and non-IDR rejection), and
per-merchant activation (the same two acquirer tests). `qris_order_id_uses_idempotency_key` pins
determinism, the 50-char Midtrans cap, charset sanitisation, the sanitises-to-empty fallback and
fresh-id uniqueness — which is the whole double-charge mechanism, not a proxy for it.

**The owner-question file was right and I was wrong to suspect it.** Its Q2 paragraph says the four
behaviours are "accepted as unproven by this repository" and then explains precisely why: `qris_tests`
asserts in **both** directions (`Ok(_) => assert!(result.is_ok())` vs `Err(_) => … contains "not set"`),
so it is green with and without the credential, and the 21 integration cases run against a **local
`wiremock`**. Both claims verified at source. *"Nothing here may be cited as proof of acquirer
behaviour"* is the correct statement, and it is a different sentence from "there are no tests" — the
one I had been carrying. **What is unproven is the acquirer's RESPONSE; what is proven is our
side of the contract.**

**The lesson is about plan rot, not about testing.** A plan section written as a to-do list keeps
reading as pending long after each line ships, because nothing rewrites a bullet when the work
lands — the same failure as the `payment_gateways` RLS reason corrected in round 120, in the
document that spawned it. Two rounds running, the stale artefact was a *description of work*, not
the work.

#### Both agenda items came back clean, and one of my own records did not (round 123)

Two questions were left open last round. **Neither was a defect**, and the more useful outcome is
that one of them exposed a false claim I had written the round before.

**1. Is there a count-versus-verdict blind spot in `verify-agents-mirrors.py`? No.** Round 122
recorded that a 9-section hook "still reported every mirror agrees", and called that a blind
spot. Re-derived this round by feeding `scan()` a hook text carrying the 9-section header: it
returns **4 problems**, naming `AGENTS.md` and two skill mirrors with *"claims 8 pre-commit steps,
which matches the working tree but NOT the committed hook"*, and a clean tree returns **0**. The
rule at :1647 is a plain `claimed != n_steps`, and it works.

**The error was mine and its shape is worth naming:** I compared the checker's exit code from a run
made *before* the offending header existed. The verdict was real for the tree I ran it on and
irrelevant to the tree I was describing — a stale measurement presented as a conclusion. The record
is corrected in place rather than deleted, because a false claim about a gate is exactly the kind of
thing someone re-derives a year later and believes.

**2. Does the records-index drift message name the fix? Yes, and it always did.**

> `error: docs/records/README.md has drifted from the generator (3 differing lines; 684 generated vs
> 687 committed). Generated is authoritative.`
> `Never hand-edit the index — run: node scripts/generate-records-index.mjs`

Planted by appending a comment, measured, and restored — the file is byte-identical to HEAD
afterwards (`git hash-object` matches `HEAD:`). So the 82 historical skips round 122 counted were
not caused by an unhelpful gate; the gate says exactly what to do.

**What this round actually produced is a correction, not a fix.** That is a legitimate outcome and
worth stating plainly: the honest tally over the last four rounds is one real defect (a stale RLS
reason), one real red gate (my own stale records index), one guard added, and two false alarms of
mine — one about a corpus floor that was already fine, one about a count check that was already
right. **The measurement layer is now more trustworthy than the claims I have been making about it,**
which is the argument for spending the next round on product code rather than on more gate auditing.

#### The trigger ports were sound; the records index was red, and it was mine (round 122)

The agenda was `TRIGGER_VERIFICATION` — 8 ports, each naming a test and a body digest, with the
generator's own docstring conceding *"verified_by is only as strong as the named test"*. It held up
under every check available:

| check | result |
|---|---|
| all 6 `pg_trigger_ports` ports named in their test file | 3-6 hits each |
| do the tests assert BEHAVIOUR, not just absence of error | yes — `assert_refused` pins the plpgsql `RAISE` and rejects naive `is_err()` |
| is there a negative case | yes — "the sweep marker must NOT open an UPDATE path" |
| do they run in CI | yes — `dev-ci.yml#cargo-nextest` sets `OZ_TEST_PG_URL` (:502, :599) |
| 8 body digests vs `TRIGGER_MAP` | **0 mismatches**, and the digest covers the full PL/pgSQL function |

So the answer to the agenda's question was **no gap**, which is worth recording as plainly as a
finding. The one real defect the round produced was in a different place, and it was mine.

**`records-index` was RED at HEAD, from `20c0332f2`.** Adding ADR-67, I updated the hand-maintained
table in `docs/decisions/README.md` and not the generated `docs/records/README.md`. That second file
is named the AUTHORITATIVE index in the same file, 8 lines above the table I edited — and
`records-index` is a **required** gate (`dev-ci.yml#ci-docs-drift`). Verified against a worktree of
that commit: `--check rc = 1`. CI would have blocked it. Fixed in `09d6611e0`; HEAD is green.

**Two measurement traps on the way, both repeats.** The drift report said *"611 differing lines"*
for what turned out to be **one substantive row** — count and content disagree because the generator
emits LF while the committed file round-tripped differently, the same CRLF noise recorded in round
119. And of **87 ADR additions in history, 82 skipped** the records-index regeneration, so this is
not an unusual slip; it is the normal path, absorbed later by the freshness gate.

**The fix is a commit-time guard**, not another doc note. `.githooks/pre-commit` gains a
path-triggered check on `docs/decisions/*.md`, `docs/records/**`, the generator and the index itself,
and it aborts the commit naming the command to run. Proved in both directions: it fires on a
worktree of the red commit and passes on HEAD.

**And it is deliberately folded into the existing PG-drift section rather than added as a ninth
`# ──` section.** AGENTS.md §2 and `verify-agents-mirrors.py` both grade the section COUNT, so a new
section costs three coordinated edits; my first attempt did add a `# ──` header, which took the hook
to 9 sections against AGENTS.md's 8. Renaming it to a plain comment restored 8 and kept the guard.

> **CORRECTED 2026-10-24 (round 123).** The paragraph above originally ended by claiming that with 9
> sections the checker "still reported every mirror agrees" — *"the count moved and the verdict did
> not"* — and called that a blind spot. **That was false, and the measurement was mine, not the
> tool's.** I compared the checker's exit code from a run made *before* the header existed. Re-derived
> properly this round by feeding `scan()` a hook text with the 9-section header: it returns **4
> problems**, naming `AGENTS.md` and two skill mirrors (*"claims 8 pre-commit steps, which matches the
> working tree but NOT the committed hook"*), and a clean tree still returns **0**. The count/verdict
> machinery is correct and the blind spot I recorded does not exist. Left here rather than deleted
> because a false claim about a gate is exactly the kind of thing that gets re-derived a year later.

#### Grading the REASON, not just the membership (round 121)

Last round found `payment_gateways`'s RLS exemption calling live CRUD a "fail-fast stub".
`check_rls_coverage` proves an exempt table still NEEDS its exemption — membership, both
directions — and never re-reads the sentence giving the reason. This round grades the sentences
whose truth is mechanically checkable, and **verifies the other twenty are still true too**.

**First, the audit: all 22 exemptions, checked against the tree.** Five claimed either "no writer
anywhere in the repo" or "fail-fast stub (NAME returns PLANNED)". Four were `media_assets`,
`media_thumbnails`, `payment_settlements` and `user_location_access` — and all four hold under both
probes (no `INSERT`/`UPDATE` naming the table in any of 800 production `.rs` files **or** 85 `.sql`
files), with the two named stub functions genuinely returning `Err(...PLANNED...)`. The fifth was
`payment_gateways`, already corrected last round. **So the audit changed no code and that is the
result** — the same shape as round 109's checker sweep: re-running a known-good population to prove
it is still known-good is cheaper than discovering it is not.

**Then the gate, `check_rls_exempt_reasons`** (`531e3cd18`). It grades exactly two claim shapes —
"no writer" and "fail-fast stub (NAME returns PLANNED)" — and deliberately ignores the other
twenty, which are prose about intent ("cover when cloud sync lands") that no checker could
adjudicate without guessing. A census that manufactures work is worse than one that admits its floor.

**Every direction was verified by construction, not by reading:**

| check | result |
|---|---|
| plant the round-120 falsehood back | **caught** — `payment_gateways claims no writer, but crates/kasirmu-core/src/db/payment_gateways.rs:150 writes it` |
| plant a "stub" claim naming a function with a real body | **caught** — `media_assets says delete_category is a stub, but its body is 12 lines` |
| the real 22-entry map | **passes** — no false positive |
| plant through the real `--check` path (what CI runs) | **caught**, exit 1 |
| delete the call from `check_rls_coverage` | **caught** by a wiring pin that inspects the caller's source |

That last row is the one worth keeping. The two gates are exercised independently, so deleting the
call left every case passing and a falsified reason sailing through the coverage gate. The self-test
now asserts `check_rls_exempt_reasons` appears in `check_rls_coverage`'s own source — **a gate
nobody calls grades nothing**, and that is invisible to any test of the gate alone.

**CI coverage came free.** `dev-ci.yml:1382` runs `generate-pg-migration.py --check`, which reaches
`dump_rls` → `check_rls_coverage` → the new gate; `check.sh:1385` already ran `--self-test`. Both
paths verified with a real plant rather than assumed from the call graph.

**A process note, because it cost a rebuild.** Restoring a plant with `git checkout -- <file>` also
reverted the uncommitted work being tested — a `git stash` in spirit, which AGENTS.md forbids on
this shared branch for exactly this reason. The gate was rewritten from the text already in hand and
committed **first**, then re-verified. Commit before planting is now the rule.

#### A "fail-fast stub" that had been replaced, and the exemption that still said so (round 120)

`scripts/generate-pg-migration.py`'s `RLS_EXEMPT` map carries a documented reason for every
`tenant_id` table that is not under row-level security. Its own header states the discipline:
*"every uncovered table must carry a documented reason in RLS_EXEMPT or generation fails (coverage
debt can neither appear nor vanish silently)"*.

The reason recorded for `payment_gateways` was **false, and had been for a while**:

> *"db/payment_gateways.rs is a fail-fast stub (upsert_gateway returns PLANNED)"*

Measured 2026-10-24: the file holds **full encrypted-at-rest CRUD** — `upsert_payment_gateway`,
`get_payment_gateway`, `list_payment_gateways`, `delete_payment_gateway` — with an `INSERT INTO
payment_gateways` at :150, reached through `kasirmu-bridge/src/local_payment.rs`, exposed as four
`*_gateway*_scoped` commands registered in **both** shells, consumed by
`ui/src/api/payment-gateways.ts`, and surfaced in `RestaurantPaymentsScreen.tsx` with **52 passing
tests**. The named function `upsert_gateway` still exists, but as a deprecated shim returning
`CoreError::Internal` with **zero callers** — a reader who grepped the name would find it and stop.

**The generator could not see this.** `--check` verifies that an exempt table is still absent from
`RLS_TABLES` — a structural fact — and never re-reads the English reason beside it. So `--check`
was green, correctly, while the sentence it prints into a 3,900-line generated schema was stale.
**A reason field is documentation with a validator's address on it, and nothing validates the
reason.**

Corrected at the source (never hand-edited — the file says `DO NOT EDIT BY HAND`), regenerated, and
the drift guard re-run: `1 differing lines` before, `ok` after, with the table count unchanged at
129 so only the comment moved.

**And the same staleness had spread to the plan that spawned it.**
`docs/plans/_active/payment-methods-plan.md` §1.3 still sketches `qris = false` / `ewallet = false`
against a `settings` blob that was superseded by a `local_payment_methods` table keyed by
`(scope_type, rail_code, is_enabled, parameters)`. Its §1.4 "Midtrans (Phase 2)" now describes
work that has largely shipped. Both got a dated note at the point of confusion rather than a
rewrite: the sketch is the record of what was designed, and the note says what replaced it.

**What is genuinely still open** (and is an owner item, not a lane one): the acquirer-side
credential and the four behaviours `owner-question-2026-09-28-r4-r6-r7.md` records as unproven —
generic-QR interop, targeted-QR restriction, real refund behaviour, per-merchant acquirer
activation. The code is built; the acquirer evidence is not.

#### Implementing ADR-67's split, and the half that silently did nothing (round 119)

ADR-67 was written last round and this round implemented **D2 only** (`4054871f9`): the core-size
ratchet now grades a `db/` budget and a modularity budget alongside the whole-crate ceiling, which
is left at its historical value so every earlier raise keeps its meaning.

**The implementation caught something the proposal had not settled: half the split did nothing.**
Writing the db failure branch was straightforward and the plant fired immediately. Planting
`non_db_ceiling` one line below its measured value produced `non-db 13135 (ceiling 13134, +1)` and
**exit 0**. Reporting a breach is not grading it — the second ceiling was decorative until it got
its own branch. The JSON `ok` field had the identical hole.

**A second defect surfaced from the same plant.** `Path.relative_to` raises `ValueError` when
`--baseline-file` points outside the checkout, and it raises *inside the failure string* — so the
gate detected the violation correctly, then lost it to a traceback. Only a plant at a temp path
finds that; the live run never does.

**And a lesson about JSON edits that cost nothing to avoid.** Rewriting `gates.json` through
`json.dump` re-encoded its 28 `\u` escapes as literal Unicode, turning a one-line note edit into a
**24-line diff across unrelated rows**. Caught by reading the diff before committing, redone with
`ensure_ascii=True`, and the diff fell back to one line. A tooling change that reformats a file it
was not asked to touch is churn that hides the real edit.

**Verification, all by construction:** `--self-test` 21/21 with three new cases grading the
partition (disabling the bucket assignment reddens exactly those two, `got 0, want 3` and
`got 5, want 2`); each ceiling planted one line low gives its own message and exit 1; the live
run is green at `db 27481 + non-db 13135 = 40616`; and a baseline **without** the new keys still
grades exactly as before — the compatibility promise the optional-key design makes, tested rather
than asserted.

**Why this was worth doing now.** The crate sat at exactly its ceiling, so the next production line
anywhere in it would have reddened the gate and required a raise. The rise now lands in a bucket
that says which question is being asked: **SQL debt in `db/`** (unmovable, 67.7%) versus
**logic landing back in core** (the thing Phase 3 P3.4 was actually written about).

#### The 13 captures the pipeline gate cannot see, and why that is correct (round 118)

`check-pipeline-verdicts.py` grades only a substitution inside an `if`/`elif` condition
(`ASSIGN_HEAD_RE`), so a **standalone** `name=$(… | tail -1)` followed by a separate `[ -n … ]` test
is outside its scope. That looks like a coverage gap, so it was measured rather than assumed:

| measurement | result |
|---|---|
| shell files scanned under `TARGET_DIRS` | 50 |
| standalone captures ending in a swallower | **13** |
| of those, guarded by `|| true` | **0** |
| of those whose captured variable then feeds a condition | **5** |
| of those that read the swallowed **status** rather than the **content** | **0** |

**The last row is the one that decides it.** Every conditioned capture uses the variable's *content*
— `[ -n "$test_name" ]`, `[ -n "$latest" ]`, `rotation_ok "$cfg" "$total"`, `for f in $files` — never
`if <capture>; then`. A swallowed exit status is only dangerous when the status is the verdict; when
the *output* is the value, `tail`'s status is irrelevant. So extending the checker to standalone
assignments would flag 13 safe sites to catch nothing, which is the "census that manufactures work"
failure this file recorded one round ago.

**Two of my own probes were wrong on the way to that answer, both in the familiar way.**

1. A single-line `grep -E '^\s*[a-z_]+=\$\(.*\|\s*(tail|head|…)'` reported **0 instances** — because
   the largest one (`deny_summary` in `check.sh`) spans a **backslash continuation** and is invisible
   to a line-anchored regex. Joining continuations the way the checker does turned 0 into 13.
2. Before that I planted the cargo-deny bug by deleting `|| true` from that standalone assignment and
   expected a red. The checker stayed green *and was right to* — see the entry above. **A plant that
   does not fire proves the plant is wrong, not that the gate is**, unless the plant has first been
   checked against the rule's own predicate. That is the fourth arrival of this lesson this session.

**What the round establishes:** the advisory layer is consistent (12 advisory gates, all `ci: null`;
zero job-level `continue-on-error`), the pipeline gate covers the dangerous shape and correctly
ignores the safe one, and the cargo-deny fix is verified by construction rather than by its comment.

#### The advisory layer, verified consistent — and a plant that was the wrong shape (round 118)

The open question was whether the matrix's *advisory* legs can silently downgrade a real problem.
Answered mechanically rather than by reading:

| check | result |
|---|---|
| `gates.json` records with `status: advisory` | **12**, and **all 12 carry `ci: null`** — none claims CI enforcement |
| workflows with **job-level** `continue-on-error` | **0** |
| workflows with **step-level** `continue-on-error` | **3**, each with a stated reason and none inside a job the roster marks `required` |

So the advisory posture is internally consistent: a gate that cannot block does not claim it does, and
no job is quietly excused as a whole. The inline `check.sh` legs that bypass `step()` (cargo-deny,
the a11y re-run) are the only place an advisory verdict can exist without a roster row — and both
print `WARN`/`SKIP` in yellow with wording that cannot be read as a pass.

**The cargo-deny block's own bug account was verified by construction, not trusted.** Its comment
(check.sh:823-829) says the old shape `s=$(… | grep … | tail -1)` made the `else` unreachable. Built
both shapes and ran them under `set -euo pipefail`: the old one's assignment **fails** (so the
`else` is unreachable), the new one with `|| true` reaches `else` and prints the unrecognised-summary
branch. The fix is real and the comment describing it is accurate.

**And then my plant of that bug did not fire — because the plant was the wrong shape.** I removed
`|| true` from the standalone assignment and expected `check-pipeline-verdicts.py` to redden. It
reported 0 findings, and it was right to: `ASSIGN_HEAD_RE` only grades a substitution that sits
*inside* an `if`/`elif` condition, and the shipped code is a standalone `deny_summary=$(…)` followed
by a separate `[ -n … ]` test. Re-planting the shape the checker actually targets —
`if deny=$(cargo deny check 2>&1 | tail -1); then` — reddens immediately with *"conditions on the
status of `tail`, which succeeds on empty input"*. The checker is correct and my expectation was not.

**And the shipped form is independently safe,** proved by running it: with no matching summary it
reaches the `else` branch and says so. So this is a case where the code is right, the gate is right,
and the only defect was in my test of them — the round-90 lesson ("a plant that does not fire proves
the plant is wrong, not that the gate is") arriving for the fourth time.

#### Defect-planting the flake receipt, and finding it mostly right (round 117)

The question this round was whether a red step actually fails `scripts/check.sh`. Reading the
mechanism first: `step()` runs `"$@" >"$log" 2>&1` and on failure prints the last 25 lines and
`exit 1`, under `set -euo pipefail`, with no `trap` and no swallowing `exit 0`. So the simple case
was already sound.

**The subtle case is the one worth planting, and `check.sh` already handles it deliberately.**
`cargo nextest` turns a genuine failure into `passed (1 flaky)` with **exit 0**, and the JUnit
report's own `failures=` attribute counts a rescued flake as a pass — `<flakyFailure>` is the only
place it survives. So the matrix grades the receipt rather than the exit code (`check.sh:368-383`).
Measured on the real report this round:

| planted | result |
|---|---|
| a `<flakyFailure>` injected into a copy of the live `junit.xml` | **FAIL, exit 1** — names the test (`kasirmu-app::commands::authz::tests::owner_role_grants_loyalty_management`) despite the report saying `failures=0` |
| the unmodified live report | PASS, exit 0 |

**The checker is unusually honest about its own limits**, which is worth recording as a positive
example rather than a fix: it prints the run identity (`timestamp` + `uuid`) because a stale report
at the same path would otherwise read as fresh; it warns that `fail-profile.fail-fast = max-fail 1`
means a small `tests=` count is not evidence the suite is small; and it states that a PASS says
nothing about any case that never ran.

**One real gap, in the failure mode.** `--nextest-junit <missing path>` raised an uncaught
`FileNotFoundError`. That exits 1 — the right DIRECTION, but by accident of Python's exception
handling rather than by decision, and the reader gets a stdlib traceback instead of a sentence. The
file's own comment already states the rule (*"a missing report must not be able to read as a clean
one"*), so the refusal belongs in words. Now: `FAIL JUNIT: no report at … / Nothing was graded`, the
two usual causes named (nextest has not run, or `path` resolved somewhere else because it is
relative to the PROFILE's artifact dir), and three self-test cases.

**And the cases were proved load-bearing, not merely added.** Removing the refusal makes the
self-test crash with the very `FileNotFoundError` traceback that one of the cases asserts is absent
— so the guard cannot be deleted silently.

**A measurement note that cost a call.** Reading `$LASTEXITCODE` after piping the output through
`Select-Object` reported **0** for a run that actually exits 1. That is the pipe-eats-the-status trap
this file has recorded since round 90, hit again in a new place. The fix is the one `check.sh`
itself uses: capture to `$null` and read the status, or grep a captured log — never test a pipeline's
status.

#### Chasing one blind spot class, and the two probes that over-reported it (round 116)

Last round's ADR-index defect was structural: a checker whose corpus is built *from the list it
validates* cannot see a missing member. This round looked for siblings of that shape, and found
**one real instance** — along with two of my own probes that cried wolf first.

**The real one: `check-rust-doc-paths.py` had no corpus floor.** Its corpus is a `rglob('*.rs')`
over seven hardcoded top-level directories, and with all seven absent it printed
`clean - 0 .rs file(s) scanned` and **exited 0**. Proved by construction, not by reading: retarget
`ROOT` at an empty temp directory and `main()` returned 0 with that line. A renamed `crates/`,
a broken `ROOT`, or a moved tree would have produced a clean bill of health over zero Rust files.

Fixed with a `MIN_RUST_FILES = 500` floor (a real tree holds ~1430), hoisted to module scope so
three new self-test cases can grade the guard itself — because the refusal branch is unreachable
from a normal run, and an ungraded guard is exactly what this file keeps recording. Verified all
three behaviours: live run green at 1430 files, `--self-test` 18/18, and an empty `ROOT` gives
**exit 2 with a refusal** where it used to give exit 0.

**Probe 1 over-reported 25 checkers with "no visible zero-guard".** The filter looked for a printed
count and found 11 of 36 glob-driven checkers printing one. Re-checking the other 25 against a wider
guard vocabulary (`MIN_*`, `FLOOR`, `refus`, `== 0`, `no … found`, `empty`) moved **all 25** into
the guarded set. The first number was an artefact of a regex, not a finding.

**Probe 2 was the round-112 failure mode again, in a new place.** A `for … in (rows|entries|records)`
scan suggested seven checkers build their corpus from a parsed list. Reading two of them showed the
opposite: `verify-namespace-governance.py` explicitly returns an `unclassified` bucket described as
*"an impl with no registry row"*, and `verify-test-shadow-copies.py` carries a self-test case
asserting *"an empty production tree must be loud"*. **Both already had the other half of the
census** — they were the pattern done right, and a loop-shape grep cannot tell the two apart.

**What actually generalises.** Of the shapes examined, the ones that were already correct share one
property: they enumerate the corpus from the *filesystem* and join it against the registry, so a
missing row surfaces as `unclassified`/`retired`. The one that was wrong built its map *from* the
rows. That is the discriminator worth grepping for in future — **which side of the join is
enumerated** — and it is not visible in a loop shape, only in what the loop iterates.

#### A census that can only see what it is given (round 115)

`check-adr-status.py` grades the ADR index in `docs/decisions/README.md` against the files those
rows name. It reported **0 findings across 59 rows** — and it was green while **three decision
records had no row at all**: ADR-66 (ratified eight days earlier), the OPEN BRIDGE-7 gap record, and
a new ADR-67. The index was 81 of 84 complete and nothing counted the missing three.

**The defect is structural, not a bug.** The checker built its file map *from the rows*:
`for _, _, path, _ in rows: files[path] = read(path)`. Every rule it applies starts from a row, so a
record with no row is invisible by construction. It is the same anti-pattern as a self-test that
grades a corpus of zero — a green whose subject was never gathered. The fix is the other half of the
census: enumerate the files on disk and subtract the ones the table names.

**And the fix's own first version was wrong in the way this file keeps recording.** Globbing
`20*.md` reported **25 unlisted** files, and every one was a NON-ADR: six `.status.md` companions,
four `research` notes that this README lists under a separate heading, and fifteen `phaseN` topology
and sync implementation records. The scope had to come from the records' own contract — a file is an
ADR when its front matter declares a numeric `num:` — which lands on exactly **0 unlisted**, and
fires on exactly the right file when planted (remove the ADR-67 row and it names that one file).
**A census that demands a row for a research note manufactures work rather than finding it.**

**Also settled this round, and it changes a recommendation I made two rounds ago.** The `topology.rs`
extraction is technically cleaner than I described and buys far less:

| fact | measured | consequence |
|---|---|---|
| `foundation` already exists as the right home | no `kasirmu-core` dep, has `serde_json` | **no new crate needed** — my earlier framing was wrong |
| the move touches | 5 artefacts incl. a parity gate's 6 hardcoded paths | more churn than "one file" |
| it would shed | 684 lines = **1.7%** of 40,616 | a rounding error on the ratchet |
| it would decouple | **nothing** — `kasirmu-api` uses 41 `kasirmu_core::` symbols across 39 files | the dependency survives untouched |
| `db/` is | **27,481 lines = 67.7%** of the measured total | most of what the ratchet counts cannot move |

That last row is the argument, and it is now **ADR-67** (`docs/decisions/2026-10-24-adr67-core-size-ratchet-measurement.md`,
Proposed, needs a ruling): the single crate-wide ceiling adds an immovable database layer to a movable
remainder, and only the remainder is what Phase 3 P3.4 was written about. The four raises on record
moved it **+1,548 lines in five days** — each correctly attributed, which is precisely the problem:
a ratchet raised correctly every time it fires is a changelog with a build step.

**The lesson worth keeping:** I set out this round to write the ADR that ARGUES FOR the extraction,
and measuring first turned it into the ADR that argues against it. The proposal survived; the
conclusion inverted. That is the value of writing the measurement into the decision record rather
than after it.

#### The ungraded ceiling is ZERO, and a 500-line-stale range was hiding in it (round 114)

Round 113 took `NOT graded` from 101 to 70. This round every remaining citation was classified,
and the tree now holds **221 OK and 70 SUPPRESSED, with not one NO-ANCHOR.** Measured by importing
the checker and counting verdicts across `live_docs()`, not by reading its summary line — because
SUPPRESSED is still reported *inside* the "NOT graded" bucket, so the printed number does not fall
when a citation is suppressed. That is a reporting quirk worth knowing before anyone concludes a
pragma did nothing.

**The last eight were each read before being classified, and they split two ways:**

*Two had a real symbol after all.* `generate_handler!` in both shells' `lib.rs` is a genuine
symbol the checker can grade, so naming it converted both to OK.

*Six name prose and can never be graded* — a doc-comment span in `auth.rs`, a `//!` module
invariant in `recovery.rs`, a bullet in a dated audit record, a range in
`manager-codebase-review-decisions.md`. Each got the `dead-ref: ok:` pragma **with the reason
inline**, so a future reader learns why it is ungradeable rather than assuming it was overlooked.

**And the pragma's scope had to be learned the hard way.** The first attempt put a four-line HTML
comment above the table. It suppressed nothing: `suppressed()` checks `PRAGMA in here or PRAGMA in
above` — the citation's own line, or the single line immediately before it. A block comment
spanning five lines is neither. The pragma has to sit **on the citation's own line**.

**One genuine drift surfaced, and it was large.** Desktop's handler list was cited as
a range near the top of `apps/desktop-tauri/src/lib.rs` with a count of 453 commands. The symbol
the checker finds lives at **:1362**, and the list now runs to **:1916** — stale by more than 500
lines and 57 commands. (The old range is described rather than reproduced: quoting it here would
make it a fresh claim, which is how this page has tripped the same checker twice before.) Re-derived against the authority rather than a guess: `check-api-surface.py` reports
`desktop=510 tablet=437 distinct=529`, and an independent count of `commands::` entries from :1362
to the closing bracket gives 510. The citation is left as the dated record it is (a 2026-09-29
note below it already re-measured every number on that page) with the current figures named
beside it.

**Why this closes something.** `check-cite-lines.py` has said `Read this as a floor, not a
certificate` on every run this session. A floor is what you stand on to reach higher; it is not a
result. With NO-ANCHOR at zero, that sentence is false in the useful direction: there is no
unmeasured residue left for drift to hide in. Shrinking the unmeasured set found real drift in
each of the last two rounds — `recovery_tests.rs:141` → `:79` last round, this 500-line range now.
**An unmeasured population is not neutral; it is where drift goes undetected.**


#### Shrinking the ungraded ceiling, and the checker catching my own guesses (round 113)

`check-cite-lines.py` prints its own ceiling every run — `NOT graded : N (no symbol on the doc line;
not a pass)`. It had sat at 101 for several rounds, recorded and never reduced. This round it went
to **70**, by naming a backticked symbol on the doc line for each citation.

| doc | citations fixed |
|---|---|
| `docs/operations/runbook.md` | 24 → 6 |
| 6 other live docs | 7 |
| **total** | **31 citations now graded, 0 drifted** |

**What the rule turned out to be, learned by getting it wrong twice.** `anchors_on()` accepts only a
**backticked** token, ≥4 characters, not a path and not a keyword — a bare prose identifier is
deliberately not trusted, because the tool shipped once with a false OK from prose that happened to
appear near the cited line. And it grades against `group(2)` of the citation, i.e. a range's
**start**, within ±8 lines — so a symbol 19 lines past the start is DRIFTED even when it sits
inside the range. Both facts came from failures, not from reading.

**The checker caught two of my own wrong guesses, which is the entire point of grading them:**

| my guess | the checker's answer | the truth |
|---|---|---|
| `CoreError::Validation` for `recovery.rs:20-21` | DRIFTED → actually `:41` | lines 20-21 are the `//!` invariant prose; no symbol lives there |
| `recovery_tests.rs:141` for the mobile test | DRIFTED → actually `:79` | `consumes_a_request_and_restores_the_candidate` is at **:79**; the citation had been wrong and hiding in the ungraded set |

**And one guess of mine was wrong in the other direction, which is the more instructive failure.**
For `subscription-tiers.md:248` I read the checker's own `-> actually :278` as an instruction and
"fixed" the citation to :278. It reddened again: `-> actually :298`. Reading the file showed
`pub async fn list_sales_scoped(` at **:298**, so the ORIGINAL citation had been correct and my
"fix" introduced the error. The checker reports where the symbol is; it does not say the citation
was wrong. **A drift report is evidence about the symbol's location, not a verdict on the doc —
and acting on it without reading the target is how a correct citation gets broken.**

**Why this was worth a round.** These 101 citations were invisible to every gate this repo runs: a
citation that names no symbol is refused rather than graded, which is the right refusal but leaves
the number rotting. Two of the ones promoted this round were genuinely wrong, so the ungraded set
was not merely unmeasured — it was **harbouring drift**. That is the argument for shrinking it
rather than recording it: an ungraded citation is a claim no tool will ever contradict.

#### Hunting real code defects, and finding none — with the triage recorded (round 112)

Rounds 95-111 were almost all doc-drift and gate-wiring work. This round went looking for code a
user would feel, in the three highest-risk places: money arithmetic, transaction safety, and
swallowed errors. **The result is a verified negative, and the triage is worth more than a green
tick because it says what was checked.**

**Money: no float anywhere near it.** Every `f64`/`f32` in `kasirmu-core` and `kasirmu-bridge` is
legitimately non-monetary — popularity scores, percentiles, image quality constants, canvas
coordinates. The one place floats once lived is fixed and the fix is pinned:
`compute_points` (`db/loyalty.rs:59`) does `round_half_up(base × multiplier / (100 × 1e6))` in
**i128** with saturating narrowing, and its docstring names the exact bug it replaced (a $22.50 sale
at 1.4× earned 31 where decimal gives 32).

**Transactions: 16 writes on `tx.`, 9 single-statement DELETEs on `self.conn`, zero violations.**
The nine are each one `DELETE … WHERE id = ?1` plus a row-count check that turns 0 into `NotFound` —
a single SQL statement is atomic in SQLite, so no transaction is needed. The sibling that DOES need
one has one: `delete_category_with_unlink` wraps its two statements in
`unchecked_transaction()` and commits. So the house rule holds in substance: **transactions guard
multi-statement operations; single statements do not need guarding.**

**Swallowed errors: 398 raw matches, 356 in code, and after triage — all legitimate.** The
breakdown is the useful part:

| shape | count | why it is fine |
|---|---|---|
| `args.<field>.as_deref().unwrap_or_default()` | 32 in `purchasing.rs` alone | `Option<String>` → `String` for optional DTO fields |
| `.unwrap_or(0)` on a map lookup | 20 in `db/popularity.rs` | a default for absent data, not a discarded failure |
| `.ok()` on a date parse | several | documented: a bad date is absent data |
| `let _ =` on I/O or a channel | ~10 | flush/send/remove_file — nothing to recover |
| `let _ =` on `#[cfg(test)]` helpers | 3 | test-only setup |

**The one that looks like a defect and is not:** `check_audit_rate_limit`'s `write_u64` closure
(`db/audit.rs:358`) discards the result of writing the rate-limit counter, so a failed write fails
OPEN — the next audit write is allowed. That is deliberate and documented four lines above the
function: *"the limiter is a guard rail, and failing closed on a settings read would drop audit rows
for a reason that has nothing to do with rate."* An audit row is worth more than rate accuracy, and
the docstring says so before the code does.

**So the honest finding of a code hunt is that the code is well-defended** — which is a weaker
result than a fix, and worth stating plainly rather than dressing up as one. The residual risk
that IS real was already filed: `base_total_minor` is client-supplied and re-derived by no server
read, and bounding it needs a sale ceiling that is defined nowhere. That one needs an owner.

**And the method note that mattered more than the result:** this round's first probe reported
*zero* swallowed errors, which was a regex that never compiled (see the entry above). The negative
was worthless until the probe was made capable of failing. A clean result from a tool that cannot
fail is not evidence.

#### A false NEGATIVE, and the probe that produced it by never running (round 112)

Hunting real code defects rather than doc drift, I wrote a probe for swallowed errors in the money
paths — `let _ =`, `.ok()`, `unwrap_or_default()` — across 274 non-test files in `kasirmu-core`
and `kasirmu-bridge`. It printed **nothing**. Clean result, exactly what I wanted to report.

It was wrong. The probe was written to disk from a JS template literal, and every backslash in
the regex was consumed by the template — so the file on disk contained `lets+_s*=|.ok()|...`
with no escapes. `re.compile` raised, Python printed the traceback to **stderr**, and the tool
wrapper surfaced only stdout. **A regex that never compiled looks exactly like a corpus with no
matches.**

Re-run with `String.raw`, the same probe finds **398 matches across 274 files** — two orders of
magnitude more, and enough to actually triage.

**The same defect invalidated the round-111 result it was built on.** Round 111 reported
"zero bare SQLite writes" from a probe using the identical write path. That claim is
re-derived here the honest way — grep for `INSERT|UPDATE|DELETE|REPLACE` near `.execute(`, then
read every hit — and the corrected finding is:

| shape | count | verdict |
|---|---|---|
| writes on `tx.` inside a transaction | 16 | correct |
| writes on `self.conn` with **no** transaction | **9** | single-statement DELETEs — see below |

**The nine are not rule violations.** Each is one `DELETE … WHERE id = ?1` followed by a row-count
check that turns 0 into `NotFound`. A single SQL statement is atomic in SQLite by itself, so no
transaction is needed — and the sibling that DOES need one has one: `delete_category_with_unlink`
wraps its two statements (`UPDATE products …` then `DELETE`) in
`unchecked_transaction()` and commits. So the rule is honoured in substance: **transactions guard
multi-statement operations, and single statements do not need guarding.**

**The lesson, and it is the twelfth this session:** the earlier eleven false alarms were cases of a
measurement being *read* wrong — a pipe eating an exit code, a wrong interpreter, a stale buffer.
This one is different and worse: the measurement **never executed at all** and still produced a
plausible empty result. The tell is that stdout was empty while stderr was not, which is exactly
what a wrapper that surfaces only stdout hides.

**Two rules that would have caught it, both cheap:**

1. **A zero-result probe is a hypothesis, not a finding.** Before reporting "no matches", run the
   same probe against a corpus known to contain the pattern, or print the match count. A probe
   that cannot fail cannot report clean.
2. **Capture stderr.** `2>&1` in the same call, not a separate one. The traceback was there the
   whole time; it was filtered out by how the result was read, which is the round-107 lesson in a
   new place.

**And the corrected result is more useful than the false one.** "Zero bare writes" invited the
reader to stop looking. "Nine single-statement DELETEs, all correct, and here is why the
multi-statement sibling differs" is a real statement about the code that a future change can be
checked against.

#### Restoring one workflow reddened FOUR claims, and the sweep caught what a direct run did not (round 110)

Adding `.github/workflows/docker-digest-drift.yml` was a three-file change as far as
`verify-ci-docs-drift.py` was concerned. It was a **five-file** change once `verify-agents-mirrors.py`
ran, and that gate found two more stale counts:

Four files carried a stale live-workflow or live-job count. The claims are DESCRIBED rather than
reproduced, because this page is itself policed by the same checker — quoting the old number here
would make it a fresh claim (the round-84 lesson, in the same file for the third time):


| file | what was stale | fixed to |
|---|---|---|
| `scripts/check.sh:10` <!-- dead-ref: ok: names a prose comment, not a symbol --> | the spelled-out workflow count, one short | the correct count, plus the new file in the list |
| `docs/operations/agent-gates.md:33` <!-- dead-ref: ok: names a prose heading, not a symbol --> | the spelled-out workflow count, one short | the correct count, plus a trigger-table row |
| `docs/operations/ci-pipeline.md:22` <!-- dead-ref: ok: names a prose callout, not a symbol --> | the bolded workflow count, one short | the correct count, with the measured list |
| `docs/operations/ci-pipeline.md:1` (audit stamp) <!-- dead-ref: ok: names a prose stamp, not a symbol --> | the digit job count, one short | a dated CORRECTION, not a rewrite |

**The fourth is the interesting one, and the sweep is what caught it.** Running
`verify-agents-mirrors.py` DIRECTLY passed — it polices only `AGENTS.md` and its declared mirrors, and
both had just been fixed. `verify-selftest-sweep.py` runs the same checker over its own falsification
corpus and caught that `ci-pipeline.md`'s audit stamp still carried the pre-restoration job count
while the tree holds one more workflow and one more job.
**A direct run and a sweep are not the same test, and the sweep found what the direct run could
not.** That is the second time this session a second, differently-shaped measurement caught what the
first missed.

**And the stamp was corrected rather than rewritten.** A dated audit stamp is a record of what was
true when it was written; overwriting the old figure with the new one would destroy the evidence
that the count moved.
The checker agrees — it skips any line carrying a HISTORICAL_MARKER such as `corrected`, on the
explicit rule that *"a dated record is evidence, not a claim."* The skip was then verified to be
legitimate rather than lucky: importing the module shows line 1 is skipped because it now contains
`corrected`, and `job_total_claims()` returns an empty list. A green produced by an exemption has to
be re-derived, exactly as with the ci-docs-drift history exemption in the round before.

**The rule this adds:** when you add a file the docs count, grep the COUNT words, not the filename.
`grep -rn 'live workflows' docs scripts` finds every mirror in one pass; trusting the gate you
happened to run finds them one red at a time.

#### A prose ceiling has no gate — the fourth recurrence, found by measuring (round 111)

`docs/architecture/module-namespace-firewall.md` §6 quoted the `core-size-ratchet` ceiling as
**39069 lines across 178 files**. The tree measures **40616 across 181**. Three raises had happened
since the page's own 2026-10-19 pass — 39069 → 40417 → 40597 → 40616, **+1547 lines** — and the page
never followed.

**The page itself predicted this.** Its own callout says 2026-10-19 was "the third recurrence of the
same pattern — committed growth merged without the ceiling edit." A fourth is now on the record, and
the shape is byte-for-byte identical: the ceiling was re-emitted correctly each time, and the
*narrative page* was not updated. So the recurrence is not carelessness about the gate; it is that
the gate and the prose are two artefacts and only one of them is policed.

**The rule worth extracting:** `verify-core-size.py` polices `core-size-baseline.json`. Nothing
reads the paragraph in `module-namespace-firewall.md`, so that number rots silently between doc
passes — and it rots in the *safe* direction (it under-states the ceiling), which is why nobody
noticed: a stale-low ceiling does not fail anything, it just misinforms. **A number quoted in prose
is a claim with no checker, and the fix is to re-derive rather than to remember.**

**Also settled this round, so the next reader does not re-litigate it:** "headroom 0" is the
*designed* state of this gate, not a symptom. The 2026-10-19 stamp on that same page records
`39069 vs 39069, headroom 0`, and the phase-5 tickets say "exits 0 at 0 lines of headroom." The gate
is a ratchet that fails on +1 and reports headroom when the count falls; it was never meant to sit
below its ceiling. So the correct response to zero headroom is NOT a pre-emptive raise — it is to
re-emit as part of whatever change grows core, which is exactly what the baseline's own description
demands.

**And extraction was measured rather than assumed.** The gate counts the whole crate, so splitting a
file inside it cannot help; only moving code out of `crates/kasirmu-core/src` lowers the number.
The top candidates are all `impl Store` blocks in `db/` (popularity 834, audit 743, products_crud
721) plus `export/mod.rs` 620 — and `export/mod.rs` is ruled out on inspection: it is built entirely
on `crate::db::Store`, `crate::db::popularity` and `crate::db::reports`, so moving it out means
moving the store interface too. That is a refactor with no natural seam, which is the same
conclusion the baseline's own history reached twice before.

#### Closing the "nobody is alerted" gap, and why the new workflow is advisory (round 110)

The drifted-pin finding's real defect was never the seven stale digests — it was that **nothing
ran the gate**. Its only caller was this workflow in a retired `.bak` form, which GitHub never
executes. Restored as `.github/workflows/docker-digest-drift.yml` (`54d877434`), weekly Monday
05:00 UTC plus manual dispatch.

**It opens an ISSUE on drift instead of failing a branch, and that is the load-bearing decision.**
The images use moving tags — `bookworm-slim`, `2-alpine`, `16-alpine`, `7-alpine` — so their index
digest is *expected* to move; caddy alone moves roughly four times a month. A blocking job would be
permanently red, and a permanently red job is one nobody reads, which is the exact failure this
workflow exists to prevent. A human decides whether each drift is security-relevant, and the case
where that judgement matters is real: debian was pinned to a 2026-08-24 artifact while current is
the bookworm-20261020 point release, and Debian point releases bundle security fixes.

**Adding a workflow is a THREE-file change here, and the third file is what the gate enforces.**
The workflow alone left `verify-ci-docs-drift.py` red with `UNDOCUMENTED LIVE JOBS — check`,
because that checker parses `ci-pipeline.md`'s Job Matrix and Workflow inventory against what is
on disk. The workflow row (`docker-digest-drift.yml` retired → LIVE) and a new `check` job row both
had to be written. It is the same rule this file already records for `check.sh`/`gates.json`, in a
third place: **a file the docs do not describe is a finding, not a footnote.**

**And it was verified green by proving the rows are parsed as LIVE, not waved through.**
`verify-ci-docs-drift.py` has a history exemption — any row naming a `.bak`-only workflow counts as
documentation-of-history and is not drift. That exemption is exactly what let ten `ci.yml` rows
misfile themselves for months (see the ⚠️ block at `ci-pipeline.md:96-108`). So the check was run
by importing the module and using its own regexes: `check` appears among **31** matrix rows,
`docker-digest-drift.yml` among **12** inventory rows, and `looks_like_actions_workflow()` returns
True for the on-disk file. A green that could be produced by the exemption is not a green.

**A fourth file, corrected in the same commit:** `gates.json`'s `docker-digests` note still said
"the six Dockerfiles and Compose files" and "11 pins" after round 108 added `run-e2e.mjs` to the
gate's `FILES` array. Now seven files, 12 pins. A note that describes a gate's scope is a claim
like any other, and it rots the same way.

#### The whole checker tree re-run in one round, and the two exceptions both hold (round 109)

A delegated sweep of every wired checker was started and then **interrupted for overrunning** — it
was attempting 57 Python checkers in one pass against a 2-minute tool cap. The scope was then run
directly in batches, which was both faster and gave a readable result. Final state, per extension:

| family | count | result |
|---|---|---|
| `scripts/*.py` (`check-*` + `verify-*`) | **57** | 55 ok, 2 RC2 — both documented exceptions |
| `scripts/*.mjs` checkers | **10** | 10 ok |
| `scripts/*.sh` with a self-test | **7** | 7 ok (incl. `verify-docker-all.sh`, 4 cases, no daemon) |
| `.agents/skills/docs-auditor/scripts/*` | **12** | 12 ok |
| **total via `verify-selftest-sweep.py`** | **89 across 92** | **OK, exit 0** |

**The two RC2s are the two exceptions this project has already ruled on**, and each was confirmed
by running its actual proof form rather than by assuming:

- `check-replay-fork.py` → `python scripts/test-replay-fork.py` → **12 cases OK**. Its proof is a
  companion test by design, and the file's own docstring says why.
- `verify-website-assets.py` → no `--self-test` flag at all (argparse rejects it); its proof is an
  in-file mutation probe at :20-27, and its **live run passes** (`8 file(s), budget 102,400 B`,
  OK).

**What this round adds to the census: nothing.** That is the result worth recording. The tree was
last swept to this state and has been kept there by the mutation harness; a re-run that finds no
new defect is evidence the harness is load-bearing, not evidence the sweep was unnecessary.

**And a note on the delegation itself.** The interrupted agent was attempting the right thing the
wrong way — 57 checkers in a single unbounded pass. The correct shape was batches of 6-12, each
under the tool cap, with the authoritative `verify-selftest-sweep.py` run once at the end as the
tie-breaker. Interrupting it cost one round of budget and saved nothing except the time, which is
the right trade only when the sub-agent's output is genuinely replaceable by a direct measurement —
here it was.

#### Provenance comments that were provably false (round 109)

Three Dockerfiles carried `refreshed <date>` comments whose dates **predate the artifact they
pin**. Re-measured 2026-10-24 from the registry, by fetching each pinned index and reading the
`created` field of its amd64 image config (the daemon is down, so this is the only path that
works — and it is better evidence than a build, because it dates the artifact itself):

| comment | claims | artifact actually created | verdict |
|---|---|---|---|
| `Dockerfile.server:185` | debian refreshed 2026-09-17 | **2026-08-24** | false |
| `Dockerfile.unified:193` | debian refreshed 2026-08-17 | **2026-08-24** | *impossible* — a refresh on 08-17 cannot pin an 08-24 artifact |
| `Dockerfile.unified:189` | caddy refreshed 2026-08-14 | **2026-06-22** | false by ~2 months |

**The two debian lines pin the IDENTICAL digest under two different dates**, so at most one could
ever have been true — and neither was. All three now state the measured artifact date and say
plainly that the old claim was wrong.

**Why this matters more than a stale pin.** A digest pin's whole value is that it is immutable and
that its refresh history is knowable. A refresh date that predates the pinned artifact does not
merely age badly; it tells the next reader the pin is fresher than it is, which is the direction
that stops them checking. That is the same failure as a footer that under-reports an audit, in a
file whose job is supply-chain integrity.

**The refresh itself is deliberately NOT applied.** Every current digest was re-derived and is
recorded in the finding, so the swap is mechanical — but a pin change can only be made safe by
building on the new bases, and with no daemon that is exactly the step that cannot run. Trading a
known-stale pin for an unverified one is worse than leaving the table of verified digests behind
for whoever has a daemon.

#### A "required" gate that is red on one flag and green on another (round 109)

`verify-scoped-reads.py` prints 29 tablet findings under `--shell tablet` and **exit 0** under its
default invocation. That looks like a gate hiding its own findings, and it is worth stating why it
is not:

- `--shell` defaults to `desktop` **by design** (`verify-scoped-reads.py:97,375`), and that is what
  `check.sh:189` and CI run. Desktop is clean, so the `required` gate is honestly green.
- The tablet half needs a **product ruling** on which surfaces the tablet should carry — it is the
  documented open finding, not an undiscovered failure.
- The checker is built so the ungraded section is still **printed**: it states the tablet numbers
  and says the verdict covers desktop alone. A gate that hides a section is the failure mode; this
  one announces it.

**The lesson for anyone re-measuring this:** run BOTH invocations before concluding anything. A
single default run says "clean" and a single `--shell tablet` run says "29 failures"; both are true
and neither is the whole answer.

#### A delegated audit that re-derived everything, and the one gap it found (round 108)

The open drifted-pin finding was delegated to a subagent with instructions to re-measure rather
than read the finding. It came back having done exactly that: every pin re-resolved two ways that
need no daemon (Docker Hub's `docker-content-digest` header, and SHA-256 of the raw manifest
bytes for public ECR, which returns no header), reproducing all 7 drifted digests exactly. Its
numbers also matched an independent live run of the gate in this session, so the finding is
corroborated rather than merely restated.

**Three things it found that the finding did not record, each verified here before acting:**

| claim | how it was verified here | verdict |
|---|---|---|
| the pins are STALE, not frozen | `git grep -inE "frozen\|freeze"` over Dockerfiles, gate, `.trivyignore`, `agent-gates.md` → zero hits | confirmed |
| the "refreshed" comments are partly false | `Dockerfile.unified:193` claims debian refreshed 08-17 but pins an artifact created 08-24 | confirmed |
| a 12th pin the gate cannot see | `run-e2e.mjs:126` carries the same redis digest with "Keep in sync"; file absent from `FILES` | confirmed |

The third was the only one with a safe, mechanical fix, and it is the one that mattered: refreshing
the compose pin alone would have left `prePullRedis()` pulling the OLD digest while compose started
the NEW one — two different images in one e2e run. `run-e2e.mjs` is now in `FILES`, taking the gate
from **11 pins across 6 files to 12 across 7**. The pattern already matched the line (verified
before the edit), so the only change needed was the path.

**And the proof that the edit worked is not the self-test.** `--self-test` still passes 8/8, but it
grades `PIN_RE`, not `FILES` — it would have passed identically before the change. The pin count
was re-measured directly instead: 2+4+2+1+1+1+1 = **12**. A gate whose self-test does not cover its
own scope list is exactly the shape that let this blind spot exist.

**Also corrected in the finding:** an arithmetic slip *inside a paragraph already correcting
arithmetic* — the two current images were said to hold "3 references" when they hold **4**
(rust x2, golang x2), and 7 drifted + 4 current = 11, which is what `gates.json`'s own "11 pins"
row says all along. The gate was right; the prose was off by one.

**What was deliberately NOT done:** refreshing the 7 pins themselves. That is the owner's call
(debian is the only security-relevant one, a ~2-month-overdue point release), and the audit's
recommendation to wire the retired Monday cron as an *advisory*, issue-opening job rather than a
blocking one is sound — caddy alone moves roughly 4x a month, so a blocking job would be
permanently red. Recorded in the finding for whoever makes that call.

#### Resolving the size-ceiling finding, and correcting what it said (round 108)

The finding filed in round 95 said "extract or raise" and named `db/popularity.rs` as the extraction
candidate at **1151 lines**. Both halves were wrong, and the measurement that proved it is worth
recording.

**The gate measures the CRATE TOTAL, so splitting a file cannot fix it.** `verify-core-size.py`
counts non-blank production lines across all of `crates/kasirmu-core/src`. Moving code between files
inside the crate leaves the number untouched. The only lever that lowers it is moving code OUT of
the crate — so "extract `popularity.rs`" was never an option, and the earlier note that proposed it
was reasoning about the wrong quantity.

**And 1151 was a RAW count, not the gate's measure.** The gate masks comments, strings and blank
lines first. Under its own masker `popularity.rs` is **834**, and **no file in the crate is over
1000 masked lines**. The house 1000-line rule — the reason the finding nominated that file — was
never in play. The nomination was an artefact of counting lines with the wrong tool.

**Attribution by re-measuring, not by reading diffs.** Running the checker's own `count_lines()`
over `git show <rev>:<path>` blobs established that the tree at `7be89ae53` measures **exactly
40597** — the ceiling — so the baseline was not stale and all +19 is post-baseline work. Per file:
`payment.rs` +19, `location_resolver.rs` +3, four files +1, against `db/roles.rs` −5 and two −1s.
The +19 is entirely `PaymentSplitArg::effective_gateway_status` (ADR-64), a cohesive 24-line method
with its own doc comment and 58 lines of companion tests.

**Resolved by raising the ceiling to 40616**, with the attribution written into the baseline's own
description, and the finding rewritten to carry the two corrections. Gate green (delta 0),
`--self-test` 18/18.

**The transferable rule:** a finding built on the wrong measure points the next reader at work
nobody needs. `Measure-Object -Line` and a masking line-counter disagree by 38% on this file, and
that disagreement produced a confident nomination of a refactor that could not have helped.

#### Probing the 94 ungraded citations for a checkable property (round 108)

`check-cite-lines.py` prints its own ceiling every run: `NOT graded : 94 (no symbol on the doc line;
not a pass)`. Most are range citations (`:493-503`, `:31-33`) — a shape with no symbol to anchor
on, so the checker refuses to grade them rather than guessing. That is the right refusal, but it
leaves 280 in-range citations unverified, so the question is whether any of them carry a property
that IS checkable without a symbol.

**A range has one: if the range's end exceeds the file's current line count, it is provably stale.**
No symbol needed. Measured over all 48 live docs — **280 in range, 4 out of range** — and all four
were already handled:

| citation | state |
|---|
| `CRITICAL_PATH_INVARIANTS.md:29,173` → `modules/inventory/src/models.rs:368` | `dead-ref: ok:` — a "Repaired:" note quoting the coordinate it records as stale |
| `PCI-DSS_CHECKLIST.md:62` → `modules/loyalty/src/models.rs:88-125` | `dead-ref: ok:` at :71, with the reason spelled out |
| `EXTENDING.md:1` → `apps/desktop-tauri/src/local_api.rs:95` | `dead-ref: ok:` inside the audit-stamp narrative |

**The interesting one is PCI-DSS, because it is not merely drifted — the control it describes no
longer exists.** `modules/loyalty/src/models.rs` is now a 13-line re-export stub (types moved to
`foundation/src/loyalty.rs` by ADR-61 / C26), and the `pin` field itself was DELETED on 2026-09-29
(`ffac0fa423`, then `20261015_gift_cards_drop_pin.sql`). The paragraph above the citation says so
in three stages — "nothing checks the PIN", then "it is protected in transit but never verified",
then "RESOLVED: the PIN was REMOVED, not hashed". So the citation is load-bearing evidence in a
record of a removal, and re-pointing it to the current file would have described code that the
same paragraph records as deliberately deleted. The `dead-ref: ok:` at :71 is the correct call and
says exactly that.

**Zero new findings, and that is the result.** The 94 ungraded citations are not hiding stale
coordinates. What the probe added is a property the checker could adopt — an out-of-range range is
graded without a symbol — and the discipline of reading each hit rather than fixing the list: three
of four were already suppressed, and the fourth needed reading its own paragraph to understand why.

#### The two reds left by the round-107 sweep were both drift, and both one line each

62 wired checkers run in both invocation modes. Seven reported FAIL; four were invocation errors on
my side (`.mjs` needs `--self-test`, `verify-commit-subjects.py` needs `--range`, `verify-scoped-coverage.sh`
is a `.sh` needing bash by full path, and the two coverage/probe checkers need build artifacts). The
two real ones were both in the docs-auditor family, which the heavy doc edits of rounds 100-107
were always the likeliest thing to have disturbed:

- `check-audit-stamps.py` — the footer of a `done-` plan read `11-10-26` while its newest stamp said
  `2026-10-23`. Under-reports, the dangerous class: the field people read to decide whether a doc
  needs work said the doc was audited three weeks AFTER the stamp it under-reports.
- `check-cite-lines.py` — `module-boot-sequence.md:8` cited `scripts/check.sh:708` for the namespace
  `--strict` step and `:731` for capability parity. Both are now `:745` and `:768`; check.sh grew by
  29 and 37 lines. The citation names no symbol, so it graded DRIFTED on the file alone.

Two one-line edits, both gates green, both committed (`c6e99ade1`). The lesson is the same one this
file has recorded since round 84: a coordinate is a claim about the tree at a moment, and the tree
keeps moving. What makes these cheap is that the checker prints the real line — `-> actually :737`
means the repair is a substitution, not a search.

**The general rule this gives:** a self-test that grades a *documented* contract is testing
someone's memory, not the code. Run the function, see what it answers, and pin that. Where it
disagrees with its own docstring, the disagreement is the finding — do not resolve it silently in
either direction.

#### A survivor that was neither an I/O shell nor harmless: `is_shell`

Every other survivor so far was a lookup helper. `verify-shell-syntax.py`'s `is_shell` is not:
it decides **which files the gate parses**. Blanking it to `return None` makes the gate parse
zero files and print a clean tree — the same anti-zero shape as the digest gate, in the gate
that parses 63 shell entry points.

The self-test around it is unusually strong (a git-vs-no-git differential, a glued-`fi` case,
a dead-interpreter case), but no case ever *called* `is_shell`. Now pinned both ways: the
shebang decides, not the `.sh` suffix (the docstring records seven tracked scripts the suffix
rule got wrong), with cases for a suffix-less hook, a missing shebang, a Python shebang and an
unreadable path. Both mutations die — `return None` and always-`False` — and the checker now
kills **6 of 6** functions, up from 5 of 6.

**And one survivor was the harness's own blind spot, not the checker's.** `verify-docker-persistence.sh`
reports `0 killed`, and that is because `SH_FUNC` is anchored at column 0: the file's three
graded predicates are defined *inside* the `--self-test` block, deliberately, so the live path
cannot reach them. Its only top-level function is `cleanup()`. The three verdict mutations
(`survived` always-true, always-false, `colls` always-OK) still each turn it red — measured
again this round. So the row means "the harness cannot see the graded logic", not "the logic
is ungraded", and the harness now says so where it prints the row.

**The lesson, which is the same one three times now:** a survivor is a question, never a
verdict. `is_shell` was a real hole; `cleanup()` was the harness's scope. Both look identical
in the table.

#### A census that invented 20 findings, and the regex that made them

Measured 2026-10-24 while auditing `scripts/gates.json` for paths that no longer exist. The
first sweep said **20 dangling references** across 17 records, each one a `.json` file reported
under a `.js` spelling (the manifest path, `ui`'s package file, the website's). It was wrong in three separate ways, and each way
is a reusable rule:

1. **A greedy path regex eats the prefix of a longer filename.** `[A-Za-z0-9_-]+(?:/[A-Za-z0-9_.-]+)+\\.(?:js|...)`
   tested against `scripts/gates.json` matches the shorter spelling `scripts/gates` plus `.js`, because the `.json` extension is
   simply not required to end where the match ends. Every "`.js` where the file is
   `.json`" row was this artefact. Fixed with a trailing `(?![A-Za-z0-9_])`.
2. **A prefix is a prefix.** Acting on that phantom list, a plain `str.replace` of
   the `.js` spelling turned every CORRECT `scripts/gates.json`
   into a `.jsonon` spelling. Twelve corruptions in one pass, caught only by asserting
   `.jsonon` was absent afterwards. If a replacement target is a prefix of a correct
   string, the replacement needs a boundary, not a `replace`.
3. **Prose that describes the past is not a dangling reference.** After the regex was
   fixed, 6 references remained: two names under `scripts/` that are not files there
   and four `skills/docs-auditor/...` paths. Read in context, every one is a sentence about
   history — "a checker under `scripts/` was written before anyone looked in
   .agents/skills/docs-auditor/scripts/`" names a file that the sentence says was never
   the real one. **Zero real findings.**

The final state is `gates.json` unchanged: 134 records, valid JSON, nothing to fix. The
hour here bought a rule, not a patch — **a path census that reports a whole family of the
same typo is reporting its own regex**, and the correct response is to read three hits
before writing the fixer.

**What the census DID establish, since it was run anyway:**

| Fact | Measured |
|---|---|
| Gate records | 134 (109 required / 15 retired / 10 advisory) |
| `required` records with NO `ci` block | **14** |
| Records naming a workflow file that does not exist | **0** |
| Dangling paths in `_note` prose | **0** |

The 14 are `root-policy`, `docker-dry-run`, `migration`, `script-tests`,
`gate-completeness`, `e2e`, `debt-ledger`, `core-size`, `updater-signature`,
`server-origins`, `unified-routes`, `checker-selftest-companions`,
`local-matrix-unlisted-gates` and `pipeline-verdicts` — all `check.sh`-only except `e2e`
(`check:all`). **And every one of the 14 resolves**: 13 declare a `check.sh` label that
exists, and `e2e` declares `check:all`, whose runner is `check-ui.mjs:287`
(`npm run e2e` via `run-e2e.mjs`, skipped when Docker is absent). So the "required but
unwired in CI" shape has 14 members and 14 runners — it is a posture, not a backlog.

**This corrects an overstatement in the round-82 notes**: `e2e` is not an anomaly in an
otherwise CI-covered roster. It is one of fourteen required gates whose enforcement is the
local matrix. That is a deliberate, documented posture (`check.sh` carries the rationale for
each), not 14 defects — and the number is worth knowing before anyone "fixes" one of them.

### Two ways a documentation census measures the WRONG THING

Both measured 2026-10-23 while trying to establish how many Rust modules lack the
`//!` header AGENTS.md §6.1 asks for. The first answer said 350 of 1430 files. The
correct answer is **7, and every one of those 7 is a legitimate exception.**

**1. Build output is not source.** A `rglob('*.rs')` over the working directory picked up
`target-review/debug/build/.../out/*.rs` and `scratch/` — 15 of the first 16 "findings"
were generated code. Census TRACKED files (`git ls-files '*.rs'`), which is what a doc
rule is about.

**2. This repo documents modules TWO ways, and only one of them is `//!`.** 31 files open
with a block comment carrying the house audit shape:

```
/*
last audited DD-MM-YY by <agent>
crate: kasirmu-core | status: SAFE | lint: CLEAN
findings: ...
next: ... | perf: ...
*/
```

A detector matching only `//!` reports all 31 as undocumented. Match the block form too
(`/*` followed by a `crate:` field), or the census will keep finding a gap that is not
there.

**And the 7 survivors are not gaps either**: one is a `pub mod` list, two are `//`-commented
harnesses, two are `tests.rs` files inside `src/`, and two open with prose `//` blocks.
Before "fixing" a doc census, read three of its hits — if they are all exceptions, the
detector is wrong, not the tree.

### The 29 steps that never left a log, measured one by one

`target/check-logs/` holds a log per step per run, and 29 of the current 194 steps have
never produced one -- every step added recently, plus the UI and website block that the
matrix never reached (it stops at 45 on a host with no PostgreSQL). Measured directly on
2026-10-23, each run on its own:

| gate | result |
|---|---|
| `npm run lint` (ui) | exit 0 |
| `npm run typecheck` (ui) | exit 0, `tsc --noEmit` clean |
| `npm run test` (ui) | **828 files, 13127 passed, 3 skipped, 3 todo** |
| 9 self-test steps added since round 55 | all exit 0, each printing its own verdict |

The 9 were: `scratch leak gate`, `font-claims`, `bundle budget`, `font bundle`,
`commit subjects`, `ci docs drift`, `rust doc paths`, `release workflow`, `selftest
sweep`. Every one is wired into `check.sh` AND named by a `gates.json` runner label, so
`verify-gate-completeness.py` would fail if a later edit dropped either half.

**A caution learned the hard way while doing this.** Reading "the last line" of a
checker's output is not reliable across checkers: `check-font-bundle.mjs --self-test`
ends with an EMPTY line after `SELF-TEST OK (35 rows)`, so a naive
`(stdout+stderr).splitlines()[-1]` returns `''` while `stdout.strip().splitlines()[-1]`
returns the verdict. Concatenating stdout and stderr before splitting also reorders them
in ways that can put a case's *observed text* last — one run made
`Refusing to print zeros for a pipeline that was not read.` look like a failure when the
suite had passed 35/35. Match the verdict pattern; do not trust position.

### What a HEALTHY matrix run looks like, measured end to end

`bash scripts/check.sh` on this checkout, 2026-10-23, run to its stopping point and graded
step by step:

```
PASS=44  FAIL=1  SKIP=0        (stops at step 45)
45. test workspace (nextest)  FAIL   <- the ONLY failure
   Summary: 668/10630 tests run: 667 passed, 1 failed, 4 skipped
   the failure is pg::tests::pg_create_sale_batches_product_lookup
   "PG integration: admin pool get failed: error connecting to server"
```

That single line is the whole story of this host: **the matrix is healthy and the one red
step is the documented missing PostgreSQL**, not a code defect. Knowing the shape of a
good run is what separates "the suite is broken" from "this workstation has no PG", and
the two present identically in the matrix's first red line.

Note the asymmetry worth internalising: `667 passed, 1 failed` reads like a small
problem, while `9962/10630 tests were not run` (nextest's own warning, because it stops
at the first failure) reads like a large one. Both are the same run, and only the second
tells you how much was NOT verified. Run with `--no-fail-fast` when the failure is
environmental and you want the rest of the number.

### `git status` shows files modified when their content is IDENTICAL to HEAD

Measured 2026-10-23 on this checkout, every round. Nine files report ` M` while their
bytes match `HEAD` exactly:

```
.config/nextest.toml · apps/*/src/commands/registration_gate_tests.rs
crates/kasirmu-bridge/src/workspaces.rs · crates/kasirmu-core/src/db/audit*.rs
crates/kasirmu-core/tests/integration/backup_restore.rs
crates/kasirmu-local-api/src/lib_tests.rs · scripts/scratch-leak-budget.json
```

Three commands disagree, and knowing which to trust is the whole point:

| command | verdict |
|---|---|
| `git status --porcelain` | modified |
| `git diff` / `git diff --stat` | **empty** |
| `git diff-index HEAD -- <path>` | modified |

Neither `git update-index --refresh` nor `git add --refresh` clears it; there is no
`index.lock`. **The only authority is content**, and it is two commands:

```bash
git hash-object <path>            # the working tree's blob id
git rev-parse HEAD:<path>         # the committed blob id
```

Equal ids mean there is nothing to commit, whatever `git status` says. This checkout is
shared by several agents that write to it concurrently, and the index is a single racing
object, so a stale stat entry is expected rather than alarming -- but a ` git add` or a
bare `git commit -a` would still record every one of these paths, which is why §7.3
forbids both.

Do **not** "clean up" these files, and do not conclude a commit lost work. Confirm with
the two commands above and move on.

### `npm run build` in `ui/` needs a TEMP the process can WRITE TO

Measured 2026-10-23, twice in one round. With the default Windows `TEMP`
(`C:\WINDOWS\TEMP`), `ui`'s vite build fails AFTER transforming all 2122 modules:

```
✗ Build failed in 10.52s
[vite:esbuild-transpile] remove C:\WINDOWS\TEMP\esbuild-<hash>: Access is denied.
```

esbuild writes a transpile cache entry and then cannot remove it, and vite treats that
as fatal. Nothing is wrong with the code -- `tsc -b` has already passed and the failure
is staged in dependency order, so it reads like a source problem. Pointing TEMP at a
directory the process owns fixes it with no other change:

```powershell
$env:TEMP='C:\dev\kasirmu\target\mstmp'; $env:TMP=$env:TEMP; cd ui; npm run build
```

This is the same class as the MSYS path-conversion trap: an environment detail that
presents as a code failure. It matters more than it looks, because two gates depend on a
built artifact -- `check-font-claims.mjs` ("the artifact is current with HEAD") and
`check-seo.mjs` (which walks `dist/`) -- so a stale or missing build turns them red for a
reason that has nothing to do with what they measure.

### Step 108 (`selftest sweep`) needs `sh` on PATH, which a bare Windows child does not have

`verify-shell-syntax.py` spawns `sh -n` and `bash -n`. `scripts/check.sh` runs it through bash, so
it inherits Git's PATH and passes; the SWEEP launches it as a direct child of Python, which does
not, and `shutil.which(`sh`)` returned `None`. The old code then fell back to the bare name and
`subprocess` raised `[WinError 2] The system cannot find the file specified`.

Fixed in the checker rather than in the caller (79a2875f1): PATH first, then the known
Git-for-Windows locations, then the bare name. The last fallback is kept on purpose -- on a host
with no POSIX shell at all the gate must still fail loudly at spawn time rather than parse
nothing and report clean, and it does: breaking BOTH discovery paths yields `rc 2` with
`could not run sh`.
## Writing a checker: two self-test forms, and say which you chose

Of the 17 `scripts/check-*.py` checkers, 16 expose `--self-test`; `check-replay-fork.py` keeps
its cases in `scripts/test-replay-fork.py` instead. (Re-measured 2026-10-24: 17 files, 16 declaring
the flag, 1 not — and the earlier "16 files / 13 declaring" had drifted in both halves.)
`python3 scripts/check-replay-fork.py --self-test` still exits 2 with `unrecognized arguments`. Both of the first two are correct — `check-replay-fork.py` explains why at its
docstring (`:44-49`): it is the gate that would have caught the fork losing the colon rejection, so
"a checker that cannot fail is worse than none" and it wanted the cases somewhere harder to overlook.

**Two checkers can never carry a flag, and that is a property of what they do, not an oversight.**
`scripts/verify-docker-persistence.sh` asserts that a container REPLACEMENT leaves data behind: every
one of its decisions is a live `docker`/HTTP response, so nothing in it can be graded without a
daemon. `verify-docker-all.sh` used to be the same shape until 2026-10-23, when its log-rotation
decision — pure text over a rendered config — was extracted and given 4 cases; the rest of that
script still needs Docker. Both are wired into `scripts/check.sh` only where the part that CAN be
graded lives. Do not "fix" either by adding a flag that grades nothing.

**The absence of the flag is not the absence of a self-test.** A text search for "self-test" marks the
fork checker as having none, and the next step is to "fix" it by adding a flag the author had already
considered and rejected. Check by RUNNING both forms:

```
python3 scripts/check-<name>.py --self-test
python3 scripts/test-<name>.py
```

Either form is fine. What is not fine is silence: if your checker has no self-test, or has one and does
not say where, nothing distinguishes that from a checker whose cases were never written.

**And make the cases reproduce the bug they pin.** Three self-tests this project added were vacuous on
first write — they passed with the defect deliberately reintroduced — because the case exercised a shape
the detector could not actually see. Run the mutation: reintroduce the bug, confirm the self-test fails,
then restore. `check-mapper-alignment.py` carries two cases for its two directions, and rebuilding the
original line-walk makes both fail, which is the only reason to trust them.

## Two gates, one brace, opposite verdicts: the tablet memo guard

Measured 2026-10-24, round 126. `ui/src/features/memo/MemosScreen.tsx` gained
`isTabletShell()` guards on `create_memo_scoped` and `revise_memo_scoped`. That single
edit moved one gate toward green and another gate to red, and the second one is red
BECAUSE of the guard.

**What the two gates want:**

- `scripts/verify-scoped-reads.py --shell tablet` grades *unregistered invokes*. It
  walks brace depth (`_platform_guard_excludes_shell`) and treats a call inside
  `if (!isTabletShell()) { ... }` as not-taken by this shell. Adding a guard removes a
  finding. Findings went 27 → 24 when the two call sites were wrapped.
- `scripts/verify-ipc-parity.py` grades the C40 shape: shared UI that *branches on the
  shell* and calls a command this shell does not register. Its rule reads the branch
  itself as the evidence — "a file that branches on the shell (so this shell runs it)".
  Adding a guard to a call in such a file does not hide the call; it CREATES the
  finding, because the branch is what the leg keys on.

So the obvious fix for one gate is the defect report for the other. The round that
learned this also learned the measurement trap that hid it: the two gates were last run
in different rounds, and each was green-by-improvement in its own round.

**What the code actually did, and why the guard was reverted.** Round 126 wrapped
`list_authored_memos_scoped` inside `load()`, watched the tablet test fail (the seeded
row a guarded load can never deliver), and reverted it. The tablet registers no memo
authoring surface at all — it has `list_active_memos_scoped` and
`acknowledge_memo_scoped`, a different screen. A guarded empty list on this screen is
not a degraded truth; it is a lie about a screen the tablet should never open. The
honest remedies are to register the command on the tablet or to route the tablet to its
own screen. Both are product decisions; neither is a brace. The gap is recorded in
`scripts/ipc-parity-allowlist.json` under `shell_blind` with that reasoning attached,
so the next reader inherits the trap instead of re-discovering it.

**The three terminal-binding commands in the same round went the other way**, and the
contrast is the lesson: `get_device_binding_scoped` and `clear_device_binding_scoped`
were registered on the tablet (`apps/mobile-tauri/src/lib.rs`, two `#[command]` wrappers
in `commands/terminals.rs`) and their two allowlist entries were DELETED. That makes
both gates agree rather than trading one for the other.

**Rule.** When a shell-consistency change touches shared UI, run BOTH gates in the same
breath and read the two verdicts together:

```
python scripts/verify-scoped-reads.py --shell tablet
python scripts/verify-ipc-parity.py
```

A guard is a fix only when the shell has a correct thing to do instead. When it does not,
the guard trades a runtime error for a silent wrong answer AND reddens the parity gate —
so register the command, or rule the screen shell-specific, and write down which gate you
chose to satisfy and why.

## A gate that cannot see the shape the repo writes: the else arm

Measured 2026-10-24, round 127, one round after the brace trap two sections above. The memo
authoring surface in the dev overlay (`ui/src/features/design/DevToolbar.tsx`) sent
`create_memo_scoped` and `publish_memo_scoped` on every shell. `DEV_TOOLBAR_ENABLED` gates on
`import.meta.env.DEV` and not on the shell, so a `tauri dev` build on the Android tablet renders
the overlay, sends both invokes, and renders `command not found` in its own status line — a dev
tool reporting a missing command as if the app were broken.

The first fix was the brace-guard shape:

    if (isTabletShell()) { ...status...; return; }
    const memo = await createMemoScoped(...);

It made the behaviour right and BOTH gates still failed. `verify-scoped-reads.py` grades a call
"guarded" when the enclosing `if` is still in force, and its walk breaks on the closing brace of the
block the guard opened. A braceless guard whose arm RETURNS puts the real body after that closing
brace, so the walk cannot see the guard at all for the very shape people reach for when the guarded
arm is the short one.

**The fix that both gates accept is the if/else form**, because the else arm is inside the same
if-statement:

    if (isTabletShell()) { ...status...; } else { await createMemoScoped(...); }

`verify-ipc-parity.py` already treats an else block as inheriting its guard (`shell_guarded_spans`
says so in its docstring and implements it). `verify-scoped-reads.py` did not — so the two gates
disagreed about the same four lines, and the disagreement was a defect in the second one.

**What was actually wrong, once the classifier was suspected.** `_in_force(..., strict_block=True)`
broke the moment the guard's block closed, without asking what followed it. `} else {` continues the
same if-statement; the else block runs exactly when the condition does. The walk now looks past the
brace for `else` and stays in force, resetting `opened` for the else block's own braces. Two
self-test cases pin it, in the file's usual pair: the else arm under a real shell guard is graded
guarded, and an else arm under a guard that names no shell is not. The control is the load-bearing
one — without it, any predicate answering True after `} else {` would pass.

**The transferable part, and it recurs.** When a gate disagrees with the code, the first question is
not "what does the gate want" but "can this gate see the shape I wrote". Three measurements paid for
this one: the guarded span list printed from the real file (`inSpan: True` — parity was fine), the
depth walk replayed by hand (`gd 3, break at line 324`), and a four-case fixture comparing the old
and new predicate (else arm flipped, control stayed put). Each is one line of instrumentation and
each answered a question that reading the diff twice would not have.

## What the topology walk taught, and what not to do about it

Measured 2026-10-24, rounds 127-128. The tablet shell still grades six topology calls
reachable, and every attempt to fix them by editing the guard walk has failed the same way:
one fixture goes green as another goes red.

**The shape.** `TopologyScreen.tsx:173` is

    if (isTabletShell()) { return <Notice />; } else { /* the whole desktop editor */ }

The walk in `_in_force` in `verify-scoped-reads.py` measures "is the arm still open at the
call" with a brace-depth counter that starts at 0 at the head of the text and knows nothing
about what precedes the guard. On this file it reads the guard's own depth as 1 and the
else arm's closing brace as landing back on 1, so `depth > guard_depth` is false at the call
and the guard reads as spent. The call sites are then reported unreachable-on-desktop.

**The trap, stated so the next attempt does not repeat it.** `_in_force` serves TWO callers
that want opposite things. `_dominating_bail` (the `if (!sessionToken) return;` idiom) calls it
with `strict_block=False` and needs "still open" to be TRUE for a bare bail whose callback's
closing brace is already inside the window. `_platform_guard_excludes_shell` calls it with
`strict_block=True` and needs the else arm's end to be recognised. Every threshold that fixes
one breaks a fixture pinning the other:

| Change tried | Tablet findings | Self-test |
|---|---|---|
| none (HEAD) | 24 | PASS |
| stop truncating `head` at its last line | 24 | PASS |
| also feed the whole prefix (`text[:pos]`) | 24 (the two gates disagreed mid-run) | PASS |
| `}` at `depth >= guard_depth` closes the arm | 24 | PASS |
| ...plus re-arming `opened` on `else` | 24 | PASS |
| any variant that moves the loose walk's threshold by one level | 24 | FAIL |

Ten variants were tried across two rounds. **None moved the tablet count**, and five
combinations that looked right turned one of the two bail fixtures red. The walk is not one
predicate; it is two, sharing a counter.

**What to do instead.** Do not tune the thresholds. Give the strict path its own function --
it is the only caller that wants arm semantics -- and leave `_dominating_bail` on the walk it
has always had, unchanged, with its fixtures as the contract. That is a refactor, not a
one-line change, and it needs the strict path's own fixtures before the tree measurement, in
that order. Two rounds here did it backwards and paid for it twice.

**Meanwhile the code is correct and the gate is wrong.** `TopologyScreen.tsx` and
`PosScreen.tsx` were rewritten to the if/else shape in round 127 (`9df07bb5b`); the desktop
editor genuinely cannot run on the tablet, and the six findings are the checker's, not the
screen's. A guard the checker cannot see is still a guard.

## When the allowlist entry is wrong, and when the gate cannot be satisfied

Measured 2026-10-25, rounds 132-133. `scripts/ipc-parity-allowlist.json` carries a
`shell_blind` section: shared-UI calls a shell "will make" but registers no door for. Six
entries left this section over two rounds, and they left by two different routes — one of
which is not a fix at all, and knowing which is which is the point.

**Route 1 — the entry was describing a hazard that did not exist (round 132).** Four
licensing entries (`pause_subscription`, `resume_subscription` and their `_scoped` twins)
claimed "calls in files that DO run on the tablet". They did not: `actionsAvailable =
!isTabletShell()` gated both buttons and the survey modal's only `setShowExitSurvey(true)`.
The entries had been carried as debt for months because the code *looked* the way the entry
described. Two OverQuotaCard entries were the same shape and left the same way in round 133.

The mechanical fix in both files was identical, and it is worth knowing because the obvious
version does not work: a bare `if (!actionsAvailable) return;` is correct code and moves the
gate **not at all**, because `shell_guarded_spans` records brace-delimited regions whose
header names a shell-derived boolean. Wrapping the invokes in `if (actionsAvailable) { ... }`
puts them inside a span. Then the gate fails with "stale shell_blind entry — no shell-blind
call site reproduces it any more", which is the section working as designed: an entry is a
debt, and paying it must break the ledger.

**Route 2 — the gate cannot be satisfied without breaking the Rules of Hooks (round 133).**
The five topology entries (`load_topology`, `load_topology_revision`,
`update_workspace_instance_scoped`, `can_save_topology`, `list_workspaces_scoped`) are
**not** stale debt. `TopologyScreen.tsx` has guarded the shell since `9df07bb5b`, and the
flagged sites are real references — they just sit inside `useCallback(...)` bodies, hook
dependency arrays and effect arguments, all of which execute before any render-time branch.
The only way to put them inside the arm the gate reads is to move the callbacks below the
`return`, which is a conditional hook and forbidden.

Round 133 did add a guard to `TopologyScreenContent` anyway (it is honest, and it stops the
component body from mounting on the tablet even if a future refactor reaches it another
way), and the gate stayed red with the same five entries. That is the correct outcome and it
is recorded in the code. **The entries stay.** They describe a shape the leg cannot read, not
a gap that exists.

**The transferable rule.** A stale-entry failure is a gift — take it, it means the debt was
payable. A leg that stays red after an honest fix is telling you the *gate* models the wrong
thing, and the wrong response is to contort the source until the model agrees. Write down
which one you are looking at before you write another line.

## A "scoped twin" is two different things, and the ledger said neither

Measured 2026-10-25, round 144. `scoped_orphans` in `scripts/ipc-parity-allowlist.json`
is a DEBT LEDGER: commands that are registered in both shells, carry a
`*_scoped` suffix, and have no caller. Round 143 gave every entry a written reason;
round 144 measured whether those reasons were true and found one group of eleven
carrying the same false claim.

**The claim.** All eleven said the unscoped twin is what the UI calls, so the scoped
one was "a scoped duplicate waiting for someone to route the caller through the gated
door". That presumes the scoped twin HAS a gate.

**The measurement.** Scan each `pub async fn <name>_scoped` body for
`permissions::*`:

| Gate in the scoped twin | Count | What "use the scoped one" would buy |
|---|---|---|
| none (`ctx.resolve_session` then delegate) | 7 | nothing but a session check |
| `SETTINGS_EDIT` / `SECURITY_MANAGE` | 4 | a real authorisation step |

`resolve_session` is the gate every one of these twins runs first; the module doc at `crates/kasirmu-bridge/src/license/scoped.rs:3-5` states the rule the split follows (dead-ref: ok: a MODULE DOC block, not a symbol, so the checker cannot anchor it):
the permission is applied "where the operation mutates a credential or a subscription". A
read does not mutate, so its scoped twin validates the session and delegates — by design,
not by omission. Seven of the eleven are reads.

**Why the first pass got it wrong, in two separate ways.**

1. A one-line regex for `require_session_permission\(&\w+, (\w+)\)` found nothing in
   `renew_license_scoped` because its permission argument sits on the NEXT line. That
   single miss made a gated twin look ungated, which would have turned a correct entry
   into a wrong one. The fix was a body-window scan (~700 chars past the signature), not
   a better-anchored regex.
2. `rotate_encryption_key_scoped` was recorded as having a "production reference".
   `ui/src/api/security.ts:34` mentions it — **in a doc comment**, which says the front
   door is deliberately absent and that a wrapper "is a decision for an owner". A
   file-level grep cannot tell prose from a call. The entry now cites that ruling.

**The rule.** When a ledger entry claims another door is stronger, measure the door.
`grep -c require_session_permission` over a file is not that measurement — it counts
occurrences, and the question is which function they sit in.

## "The UI calls it" needs three filters, and a grep gives you one

Measured 2026-10-25, rounds 143-145. Recording a REASON on a ledger entry is only worth
doing if the reason is measured. Three rounds running, the measurement was wrong in the
same direction: a name found in a file was read as a caller.

**The three false positives, in the order they were caught.**

1. **The definition counted as a reference.** `grep -l 'renew_license' ui/src` returns
   `ui/src/api/license.ts` — the line `logger.invoke('renew_license', ...)` inside the
   wrapper. That is where the wrapper is DEFINED. It is not a call, and the wrapper
   itself had zero callers.
2. **A doc comment counted as a reference.** `rotate_encryption_key_scoped` "appeared" in
   `ui/src/api/security.ts` — in prose explaining that no wrapper exists for it on purpose
   and that one "is a decision for an owner". A file-level grep cannot tell a call from a
   comment about the absence of a call.
3. **The wrapper's caller was itself dead.** `get_key_rotation_info` really is imported and
   called, by the module function in `ui/src/hooks/useKeyAge.ts`. But that hook's only consumer,
   `useKeyRotationReminder`, is mounted in NO file outside its own module and its test. One
   hop of reach is not reach.

**The measurement that works**, in one line per name:

```bash
# references that are neither the definition nor a test/mock
grep -rn '<wrapperName>' ui/src --include='*.ts' --include='*.tsx' \
  | grep -v __tests__ | grep -v dev-mock \
  | grep -vE 'export (const|async function|function) <wrapperName>'
```

Then take ONE MORE hop: for every reference, ask whether its consumer is itself reachable.
Rounds 143-145 each stopped one hop early and each wrote a confident sentence that the
next round had to retract.

**Why this is a gate-documentation problem, not a note-taking one.** The ledger's own
reason field is what makes an accepted debt reviewable. A reason that says "the UI calls
the other one" and is false converts a reviewable entry into a misleading one — worse than
the bare name it replaced, because a bare name at least announces that nothing is known.
The rule: write the reason only from a call-site measurement, and name the file and line
you measured.

## Sameness is a comparison, and no text-level gate can see it

Measured 2026-10-25, round 146. Every stylesheet gate in this repo reads CSS TEXT:
`themeTokenCompliance` walks consumers, `shadowTokenLiveness` parses definitions,
`stylesheetImportEdgeCompliance` checks the import graph, the walker suites check that
declarations exist and tokens resolve. All of them passed while
`.pos-cart-discount-pct` and `.pos-cart-discount-name` — a number input and a free-text
input, side by side in one row — declared the SAME border, radius, padding and colour
tokens, differing only in width.

A file's text cannot express "this rule equals that one". Sameness is a comparison, so a
text-level gate has no place to put the assertion. The two fields were visually identical
and every gate was green.

**What actually discriminates.** Not `querySelector('.pos-cart-discount-pct')` — a swapped
`className` on the JSX leaves both nodes mounted and that assertion green. The assertion
that fails on the swap pins EACH class to its own `input.type`:

```tsx
expect(container.querySelector<HTMLInputElement>('.pos-cart-discount-pct')?.type).toBe('number');
expect(container.querySelector<HTMLInputElement>('.pos-cart-discount-name')?.type).toBe('text');
```

Verified by mutation, twice: restoring the original hardcoded toast string in
`useKeyAge.ts` failed the new `message` assertion (10 passed, 1 failed), and swapping the
two `className` props in `CartFooterTotals.tsx` failed the binding case (3 passed, 1
failed). Both files were restored and `git hash-object` was checked against
`git rev-parse HEAD:<path>` afterwards — a mutation test that leaves the tree changed is a
worse outcome than not running it.

**The general rule.** A gate that grades reachability, presence or resolution cannot grade
IDENTITY. When the risk is "two things that should differ are the same", the assertion has
to be a comparison between two rendered things, and it has to name which is which —
otherwise the swap is invisible, which is precisely the failure mode that motivated the
test.

## A hook with no mount passes every test it has

Measured 2026-10-25, round 147. `useKeyRotationReminder` was written, localized (round
146), and covered by three unit cases. It was rendered by NOBODY:

```
$ grep -rn 'useKeyRotationReminder' ui/src
ui/src/hooks/useKeyAge.ts:58:  export function useKeyRotationReminder() {   <- the definition
ui/src/__tests__/useKeyAge.test.ts:176:  renderHook(() => useKeyRotationReminder()); <- the test
```

Three of three cases pass. The feature has never run in the app. This is the third
instance of the same lesson on this file (see "The UI calls it" above), and it is the
one that shows why the lesson generalizes beyond grep hygiene:

**`renderHook` is not a mount.** It proves a hook BEHAVES when rendered. It cannot
prove the hook is ever rendered by the app, because it IS the rendering. A suite of
hook tests is evidence about the hook and no evidence at all about its reachability.

The fix is a mount in `AppProviders` (the app's single provider composite, so anything
there is app-wide on both shells) and a test that asserts the EFFECT, not the presence:

```tsx
render(<AppProviders>{null}</AppProviders>);
await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith(
  expect.objectContaining({ type: 'warning', duration: 0 }),
));
```

Deleting `<KeyRotationReminder />` from the tree fails this and leaves all three
`renderHook` cases green — which is precisely the state the repo shipped in.

**Where an app-wide hook belongs.** Follow the existing pattern rather than inventing a
mount: `GlobalErrorReporter`, `IpcErrorReporter`, `CurrencyWorkspaceSync` and
`OrgLocaleSync` are all null-rendering components in `AppProviders` that need toast or
locale context and no DOM. Mounting in a SHELL instead would need one copy per shell,
and that is how one of them gets forgotten — the same failure this section is about.

## A hand-kept baseline only rots where someone looks

Same round. `mockFactorySurface.test.ts` asserts that each `create*ApiMock` factory
defines every export its module has, or names the gap in `KNOWN_GAPS` — and asserts
`KNOWN_GAPS` by EQUALITY, so both directions force an edit. The full UI suite still went
red with two failures on `getPiutangCollections` and `setLineCourseScoped`.

Neither name was in `KNOWN_GAPS`. Both were exports the FACTORY did not mock, added by
features (an analytics card, the coursing wire) whose authors did not run this file. The
file's own header warns about exactly this — "baseline generated from the runtime rather
than transcribed" — and the baseline had been transcribed.

The correct repair was to MOCK them, not to list them. Listing a gap is the honest
outcome for an export the factory cannot sensibly fake; these two have obvious shapes,
and `setLineCourseScoped` was a live throw at a call site inside a DOM event handler,
which lands the screen in its error boundary instead of failing readably.

**The rule.** When an equality-asserted allowlist is red, ask which direction the
pressure points. `KNOWN_GAPS` exists so a gap is a recorded debt; adding a name it never
had converts a live throw into an accepted one. A baseline that is compared by equality
must be GENERATED from the runtime, because a hand-kept list is only as complete as the

## A guard the walk cannot see is not a gap, and the count is not the score

Measured 2026-10-25, round 149. `verify-scoped-reads.py --shell tablet` had reported 24
findings for many rounds. The number was stable, so it read as a fixed backlog. It was
neither: two were a gate BUG and several more are guards the walk structurally cannot
see.

**The bug: the else arm of a POSITIVE shell guard.** For `--shell tablet` the guard
classifier tested two forms -- `isDesktopShell()` and `!isTabletShell()` -- and neither
matches `if (isTabletShell()) { A } else { B }`, which is the shape the repo most often
writes. Graded tablet, `B` can never run, so it is unreachable code. The self-test carried
an else-arm case, but only for the NEGATED form, so the positive form had no coverage and
the asymmetry was invisible. Two `DevToolbar.tsx` sites (memo authoring) were reported as
unguarded tablet calls for a branch that only executes on desktop.

The fix is `_in_else_arm_of`, a brace walk that reports whether a position sits past a
brace-balanced `} else {`. With it: 24 findings -> 22, cleared 35 -> 37, desktop still
clean, self-test PASS.

**The class the walk cannot see: a desktop-only SUBTREE.** `create_backup` is called from
`createBackup()` at `ui/src/app/UpdateBanner.tsx:157`, graded an unguarded tablet call. It is not. The mount
chain is:

```
main.mobile.tsx -> TabletAppShell -> TabletAppLayout      (no UpdateBanner anywhere)
main.tsx       -> App -> AppShell -> AppLayout -> UpdateBanner -> createBackup()
```

`grep -rn 'UpdateBanner|createBackup' ui/src/app/tablet` returns ZERO. The file is
reachable only from the desktop shell, and no per-call-site pattern can express that --
the guard is the ABSENCE of an import three files up, which is a module-graph fact, not a
text fact. The same holds for the `TopologyScreen` cluster (topology editing is
desktop-only).

**What to do about it, and what not to.** Do not widen the allowlist reasons to cover
these, and do not add a runtime `isTabletShell()` guard to code that already cannot run on
the device -- that is a lie in the source to satisfy a checker. The honest reading is that
the gate's number is an upper bound on real defects, and the useful question is never "how
many findings" but "which of these can actually execute". Answer it by walking the mount
chain once per cluster, as above.

**The general rule.** A stable red number is a claim that has stopped being tested. When a
gate reports the same count for many rounds, audit the gate before the tree: this one had

## The question the gate cannot ask: can it run?

Measured 2026-10-25, round 152. `verify-scoped-reads.py` answers one question exactly -- does
this call site sit inside a guard the walk can see -- and it answers it well. It cannot answer
the question an operator actually has: **is this code reachable at all?**

By round 151 the tablet list held 24 findings, and they were three different things wearing
the same label:

| Kind | Example | What it is |
|---|---|---|
| a live defect | `open_product_images_scoped` in `RetailPosScreen` | threw on every tap |
| a guard the walk can't see | `useRestore`'s `isAvailable` | correct, just not syntactically a block |
| unreachable on BOTH shells | `EmailReportSettings`, `MachineIdStatus` | nothing renders them |

A list that mixes these is a list nobody reads, and the third kind actively misleads: three
findings that look like shell-parity gaps are symptoms of dead surface.

`scripts/classify-finding-reachability.py` takes the finding list as given and asks the
reachability question per finding. It does not re-grade guards -- that is the other gate's job,
and duplicating it would give two gates that can disagree.

**Three kinds of module, three rules.** A JSX-only predicate was measured to report
`TopologyScreen`, `WarehouseConsole`, `useKeyAge`, `useRestore` and `useTerminalProfile` as
dead. All five are live. They are reached differently:

```
component  RENDERED    <Name ... />
hook       CALLED      useName(...)
screen     REGISTERED  component: Name   (inside a registerPage call)
```

**The trap that broke the first version.** The first pass searched for the FILE name
(`useKeyAge`) and reported zero consumers -- alarming and wrong. The consumer imports
`useKeyRotationReminder`, a different symbol in the same file. So the script resolves each
file's EXPORTED SYMBOLS and searches for those, and it reports the symbol that encloses the
flagged LINE rather than the first export it finds. Measured: before that fix, `useRestore`
was 'proved' reachable via `formatBytes`, a formatter in the same file that has nothing to do
with the restore calls.

Comments are blanked before matching, because every false reference in round 151 was prose:
`ui/src/features/settings/screens/SecurityAccountScreen.tsx:33` names `EmailReportSettings` in a sentence explaining it is
orphaned, and a plain grep reads that as a consumer.

**Result on the tree**: 20 findings -- 17 REACHABLE, 3 DEAD. The three DEAD ones
(`get_machine_id`, `save_report_schedule`, `send_test_report`) match, one for one, the
findings a human verified by hand in round 151.

**A test that passes under the mutation is not a test.** Round 153 added four cases
for the new shell-registration read, then broke the parser to read the WHOLE lib.rs instead

## Two reachability gates, two different questions

Measured 2026-10-25, rounds 152-162. `classify-finding-reachability.py` and
`census-orphan-modules.py` look similar and answer different questions. Using one where the other
belongs is how a green run gets read as coverage it never had.

| Gate | Input | Question |
|---|---|---|
| `classify-finding-reachability` | the `verify-scoped-reads` finding list | Is the module behind THIS FINDING reachable? |
| `census-orphan-modules` | every shipping module under `ui/src` | Does ANY production code name this module? |

The first one's scope is a consequence of its input: fixing a finding removes it from the list, so
it stops being classified. Measured in round 156 -- removing a registry entry left `--strict`
green while the screen it registered went dark.

**The census's own scope was too narrow, and for a whole file class.** Until round 162 it skipped
every non-`.tsx` file, so its printed `ORPHAN` count described components only. `hooks/useMediaQuery.ts`
was named by no other file in the tree and the census could not see it -- because it was not a
`.tsx`. Widening to hooks and capitalised `.ts` modules raised the count 7 -> 8 and the corpus
330 -> 416 modules.

That is the same defect the sibling gate's docstring records for the verify-only era, in a third
place: **a gate whose scope is narrower than the convention it enforces cannot see half the rot it
exists to catch.** The tell was the same both times -- a number that did not move when a new case
was added to the tree.

Neither gate is a census of dead code in general. Together they cover: findings nobody has
resolved, and named modules nothing imports. They do NOT cover an unused export inside a live
module, or a module reached only through a chain of itself-unreachable modules -- both are open.

## A note that names a file that does not exist is worse than no note

Round 162. Two archive banners naming `WarehouseConsole` (`ui/src/features/products/register.tsx:20`,
`WarehouseConsole` again at `ui/src/features/products/ProductManagementScreen.tsx:2`) said the
screen was "replaced by WarehouseScreen (features/warehouse/)". `git ls-files
'ui/src/features/**/WarehouseScreen*'` returns nothing. The successor is `WarehouseConsole.tsx`,
registered at route `warehouse`.

This is small but it is the exact shape of the failure this file keeps recording: a claim written
from intent ("the warehouse thing replaced it") rather than from a lookup. A reader who trusts the
banner concludes the question is settled and stops looking. A reader who checks finds a phantom
and no longer trusts the other three lines either.

`start_and_store` -- because a whole-file parse reports it registered and a list-scoped parse
does not. That one goes red under the mutation. Four cases that all agree with both
implementations are measuring nothing.

The report also names, per finding, which SHELLS register the command. That is what turns a
DEAD verdict into an instruction: DEAD with `desktop` means a missing MOUNT, DEAD with
`none` means a missing BACKEND. Measured on the tree: all three DEAD findings are
desktop-registered, so the email-report and machine-id components are unreachable through a
missing mount rather than missing commands.

**Exit codes**: the bare report exits 0 (it is an inventory, not a verdict); `--self-test`
exits 0/1; `--strict` exits 1 when anything is DEAD.

**The ratchet is ARMED (round 156).** When this file was written the tree carried three DEAD
findings and the gate only reported. Round 154 deleted `MachineIdStatus` (dead since
`20bb94c5c8` replaced it with `StatusBar`) and round 155 mounted `EmailReportSettings` (dead
since `75eb83d7c5` rebuilt the settings nav), which took the count to zero, so `check.sh` now
runs `--strict`.

**Proven before arming, not assumed.** A ratchet nobody has seen fail is a green light that
means nothing. Planting an unmounted component that invokes a desktop-only command made
`--strict` exit 1 and named the file and line; deleting it returned 0. Both directions were
measured before the switch was thrown.

**Its scope, stated because the first version of this paragraph overclaimed it.** The input is
the `verify-scoped-reads` finding list, so the ratchet asks "is the module behind this FINDING
reachable" -- it is not a census of dead code. Measured 2026-10-25 by removing the
`'email-reports'` registry entry again: `--strict` stayed at 0, because
`EmailReportsScreen.tsx` still imports `EmailReportSettings` and the classifier counts a
reference. And once a finding is GUARDED (as the two email writes now are) it leaves the list
entirely, so it is never classified at all.

So the ratchet protects exactly one thing, and it protects it well: a finding nobody has
resolved yet must not sit in a module the bundle cannot reach, because that combination is
what makes a parity report unreadable. It does not replace a dead-code census, and a green run
here is not evidence that every component in `ui/src` is mounted.

**A note on why the two deletions and the mount were the right calls, since they went in
opposite directions.** `MachineIdStatus` had a shipped successor (`StatusBar`) and a hardcoded
English string, so deleting it removed a surface nothing could reach. `EmailReportSettings` had
a fully built backend (four commands registered at `desktop-tauri/src/lib.rs:1421-1424`), an API

## A leaked mock is real; a grep for one is not a diagnosis

Measured 2026-10-25, round 163. A full-suite run failed
``does not leave an unsaved product on screen when the add is refused`` once, then passed on two
re-runs while passing in isolation every time. The cause was a mock leak, and the fix was real.

**The mechanism.** `RetailPosScreenInteractions.test.tsx` mutates shared module mocks about
thirty times (`createProduct.mockRejectedValue`, `updateProduct.mockRejectedValue`,
`holdCartScoped.mockImplementation`, ...) and undid each one on the LAST LINE of its own test.
That works only while every assertion passes: the first throw skips its cleanup, and the
permanent rejection leaks into every later case in the file. The victim then looks unrelated to
the cause, and a re-run passes because the order that tripped it does not recur.

**The fix, and the proof it works.** An `afterEach(() => vi.restoreAllMocks())` at file scope —
`restoreAllMocks` rather than `resetAllMocks`, because the file also installs `vi.spyOn` pairs
for `requestAnimationFrame`. Proven by planting a deliberate failure BEFORE the inline reset:
exactly one test failed and the other 54 passed. Without the `afterEach` that failure would have
cascaded.

**What the grep could NOT do.** The obvious next step is to find every file with the same shape.
Three predicates were tried against the tree:

| Predicate | Files flagged | Actually flaky |
|---|---|---|
| mutates shared mocks >= 3x, no `afterEach` | 49 | not tested |
| + persistent `mockRejectedValue` >= 2 | 40 | not tested |
| + no RE-SEEDING `beforeEach` either | 8 | **0 of 8, over 3 runs each** |

The last predicate is the tightest available and it still flagged eight clean files. The reason
is that `DashboardScreen.test.tsx` — which sets ten PERSISTENT rejections and has no `afterEach` —
is perfectly safe, because its `beforeEach` re-seeds every mock with `mockResolvedValue` (:175-181),
overwriting any leak. A static reader cannot distinguish "this mock is re-seeded before each test"
from "this mock is not", without simulating the file's control flow.

**The rule.** A leaked mock explains a flake; it does not predict one. Fix the file that failed,

## Green tests on code nobody can open

Measured 2026-10-25, rounds 164-165. Two facts that are individually unsurprising and jointly
expensive:

- `git log -S'<ShiftBar' -- ui/src` returns only commits that MODIFIED `ShiftBar.tsx`. No commit
  ever removed a mount, because there never was one. Three separate rounds repaired races and
  double-submits in it (`88415f10f`, `b245189b6a`, `dcdc57f155`), plus a token cleanup where
  every declaration "rendered NOTHING".
- Seven module(s) that no production code reaches currently carry **68 dedicated `it()` cases**,
  and are named in ten more test files as CSS-inventory rows.

Every one of those rounds passed its gates. That is not a gate failure: the gates test BEHAVIOUR
of a module, and reachability is not a behaviour. A suite can be green, well-written, and
entirely about code no user can execute.

**The remedy is visibility, not deletion.** `census-orphan-modules.py` now prints, per orphan,
how many dedicated test cases it carries and how many test files name it, then totals them:

```
  ORPHAN  features/products/ProductManagementScreen.tsx
          no import, render, registration or imported barrel names it
          24 dedicated test case(s); named in 5 test file(s)
  ...
  68 test case(s) exercise modules nothing in the app reaches.
```

Deleting remains an owner call -- several of these are `UNRESOLVED` rather than dead, and one
(`GiftCardPayment`) needs a migration before it could be mounted. Reporting the cost is the part
that needs no permission and changes the next round's priorities.

**The bug that produced seven silent zeros.** The first version of this helper matched a
dedicated suite with `os.path.splitext(name)[0] == stem`. A test file is `CartScreen.test.tsx`,
which has TWO extensions: splitext strips only the last, yielding `'CartScreen.test'`, so the
comparison never matched and every orphan reported `0 dedicated test case(s)`. The output looked

## The unrequested-command report already exists; re-deriving it is the waste

Measured 2026-10-25, round 167. I set out to find "registered commands no UI reaches" on the Rust
side, as a counterpart to the UI orphan census. I found 23. Then I checked whether the project
already knew, and it did, in more detail than I had:

```
info[desktop-unrequested]: 18 of 511 registered commands are named by no shipped UI file
  = 0 called by this shell's own Rust (load-bearing, not dead)
  + 18 named by neither side (the only population a retirement can start from;
    read the other shell's UI before believing one is dead everywhere)
info[tablet-unrequested]: 10 of 440 ... (same shape)
```

`verify-ipc-parity.py` prints both lines on **every run**. It is not a gap in coverage; it is an
inventory nobody has acted on. Worse, `docs/records/findings/audit-open-findings.md:402-408`
already discusses two of the names in detail -- including two CORRECTIONS to its own earlier
claims about them. The territory is charted.

**My own second pass was wrong in the instructive way.** I filtered the 23 down to five with
"no Rust caller either", searching `crates/` and `platform/`. All five have real implementations
and tests under `apps/*/src/commands/`, which my walk never looked at. A search of two
directories, reported as a fact about the tree -- the same error as the `shared.ftl` key hunt in
round 161 and the `.tsx`-only census in round 162.

**What is worth keeping.** The report's own wording contains the rule this lane needed and did
not apply: *"read the other shell's UI before believing one is dead everywhere."* The gate
already knew that a name absent from one shell's UI is not absent from both, which is exactly
what my five "retirable" commands turned out to be.

**The general rule for this file.** Before building a measurement, check whether an existing gate
already prints it. Six rounds of this session were spent rediscovering facts a `check.sh` step
reports every run -- the census kept finding UI orphans that `verify-scoped-reads` and
`classify-finding-reachability` already adjudicated, and this round re-derived
`*-unrequested`. The gates are numerous (140 declared) and the reading of them is the scarce
skill, not the writing.

## The `-unrequested` line is per shell, and the number nobody could cite was the intersection

Measured 2026-10-25, round 169. The section above ends by saying to read the two `-unrequested`
lines together. This round did that, and the two lines do not add: `desktop 18 + tablet 10` is
28, and the population named by no shipped UI file **on either shell** is not 28. It is smaller,
and the gap between them is not slack -- it is commands one shell's UI names and the other's
tooling registers anyway.

`verify-ipc-parity.py` now prints the intersection itself, after both shells have spoken:

```
info[cross-shell-unrequested]: 28 per-shell unrequested registration(s) are 5 command(s)
  named by no shipped UI file on ANY shell (desktop=13, tablet=5) = 5 named by neither side
  + 18 named by the other shell's UI only
```

**Why 18 of the 23 were not dead.** They are strings that A GATE quotes, not strings any UI
invokes. The first gate doc I wrote on this called them "23" and filtered them by hand to five --
the right number by luck, not by method. Round 167 named the next class down. `enqueue_offline_scoped`
and `list_pending_offline_scoped` appear in `ui/src/api/offline.ts` nowhere; `pending_offline_count_scoped`
does, and `OfflineQueueScreen` imports its wrapper. A name in `ui/src/api/` is not a call, and a call
is not on screen.

**The measurement that settles it.** `pendingOfflineCountScoped` (`ui/src/api/offline.ts:78`)
invokes `pending_offline_count_scoped`, and `OfflineQueueScreen` imports it --
`import { pendingOfflineCountScoped }` at `ui/src/features/offline/OfflineQueueScreen.tsx:7`.
The other four are named by no shipped file at all: `enqueue_offline_scoped`, `list_pending_offline_scoped`
(`commands/offline.rs:47,60`), `list_scale_devices_scoped` (`commands/scale.rs:31`), and
`get_over_quota_report` (`commands/subscription.rs:90`), whose wrapper is `getOverQuotaReport`
(`api/subscription.ts:287`) mounted at `features/settings/OverQuotaCard.tsx:94` -- but `OverQuotaCard`
imports it and nothing mounts `OverQuotaCard` except `LicenseSettings.tsx:689`, which no `ui/src`
production file imports. So the CLIFF: the command is named, the wrapper exists, the component imports
it, and the chain stops two links short of a screen. `get_over_quota_report_scoped` (the `_scoped`
twin, `subscription.rs:111`) is the one the gate does see, and that is the one `OverQuotaCard` uses.

The general rule, this file's usual one in a new place: **a per-shell report read alone is arithmetic,
not a measurement.** Two numbers that describe overlapping populations do not add, and the summarised
figure -- 28, which the project quoted from memory for several rounds -- was the sum.

## The re-entry report names a candidate; the backend decides whether it is a defect

Measured 2026-10-25, round 170. `check-reentry-guards.py` prints **76** handlers whose only
guard is a React state flag, and says of each that it is "a CANDIDATE, not a defect: the cost of
the replay depends on the backend. Ask first whether a unique index REFUSES it, then whether the
UI still reports success." That sentence is the whole method, and this round ran it on the four
storage-backed create or save paths, three in round 170, three in round 171 and two in round 172. Only two were already covered.

| Handler | Refused by the backend? | What the operator sees | Verdict |
|---|---|---|---|
| `VariantManagementScreen.handleSave` | yes -- `product_variants.sku` UNIQUE (`20260813_init.sql:429`, kept at `20260831:164`) | "product not found", because `create_product_variant_on` maps EVERY constraint violation to `NotFound` (`products.rs:369-377`) | **defect**, fixed |
| `BundleManagementScreen.handleSave` | yes -- `bundle_items.bundle_sku` UNIQUE (`:389`) | the generic `bundles-error-save`, i.e. "the save FAILED" while the first tap succeeded | **defect**, fixed |
| `PromotionManagementScreen.handleSave` | **no** -- `promotions` has only an `id` PK, and the bridge mints a UUID per call | nothing; TWO live promotions, both applied at the till | already guarded by `loading={saving}`, and already tested |
| `CategoryManagementScreen.handleCreate` | yes, twice over: `id` is a PK derived from the name by `colourToId`, and `categories.name` is UNIQUE | `categories-error-create`, i.e. "could not create" over a category that was created | **defect**, fixed || `CategoryManagementScreen.handleCreate` | yes, twice over: `id` is a PK derived from the name by `colourToId`, and `categories.name` is UNIQUE | `categories-error-create`, i.e. "could not create" over a category that was created | **defect**, fixed |
| `ExchangeRateScreen.handleSave` | yes -- UNIQUE (from_currency, to_currency, effective_date), and the modal defaults the date so both taps send the same triple | `currency-save-error` | **defect**, fixed (round 171) |
| `IssueGiftCardModal.handleSubmit` | yes -- `gift_cards.card_number` UNIQUE | `gift-cards-error-issue`, i.e. a minted card the till says was not issued | **defect**, fixed (round 171) |
| `LoyaltyManagementScreen.handleSaveTier` | n/a -- an idempotent `UPDATE ... WHERE id = ?`; a replay rewrites the same row | nothing | **not a defect**; left on the report deliberately |
| `StaffDetailDrawer.handleSave` | yes -- `users.username` UNIQUE (`20260813_init.sql:974`) | `staff-error-save-failed` over an account that was created | **defect**, fixed (round 172) |
| `RoleAuthoringPanel.save` | yes -- `roles.name` UNIQUE (`:573`) | the backend message, which now reads "that name already exists" about the role just created | **defect**, fixed (round 172) |


**Round 171 added three rows and one negative result, and the negative matters as much.**
`LoyaltyManagementScreen.handleSaveTier` sits on the report and is NOT a defect: core runs
`UPDATE loyalty_tiers SET ... WHERE id = ?6` (`db/loyalty/tier.rs`), which a replay
rewrites to the same values. Nothing is minted, nothing is duplicated, and no message lies — so it
is left on the report rather than "fixed". A candidate cleared by reading the write is worth as
much as one confirmed: the report's own words are that each entry is a candidate whose cost
"depends on the backend", and the only way to discharge that is to open the INSERT.

**The one new failure mode found this round: a guard placed above validation strands itself.**
In `IssueGiftCardModal` the handler returns early on an invalid amount and on an empty card
number, and those returns happen BEFORE the `try`. The obvious edit — put the re-entry guard at
the top of the handler — takes the flag on the first invalid submit, never reaches the `finally`
and leaves the form permanently unable to issue a card. The guard has to sit after validation and
before the `try`. Two cases pin it, and they fail on different mutations:

```
guard removed                    -> "issues a card once for a double click" fails (expected 2 to be 1)
guard moved above validation     -> "does not strand the re-entry guard" fails
guard after validation            -> 20 passed
```

**A case that clicks a DISABLED button reaches no handler, and proves nothing about it.**
Round 171 recorded the ordering trap — a guard placed above validation strands itself. Round 172
applied that lesson to `StaffDetailDrawer.handleSave` in the right place and wrote the two cases
that had caught it before: one for the double click, one for the stranding. **The second one passed
with the guard deliberately moved to the broken position.** The reason is the button:
`saveDisabled` already mirrors the required-field checks, so calling the drawer's Save with an
empty form is a click on a disabled element, which React never routes to`onClick`. The case
asserted `expect(mockCreateStaff).not.toHaveBeenCalled()` and then filled the form and saved —
and both halves hold whether the guard is taken before validation or after it, because the
handler was never entered either way.

Measured, rather than reasoned: a probe rendered the drawer and logged the button through three
states — `disabled=true` before the first click, `true` after it, `0` calls
throughout. The refusal that exercises the handler has to be one the BUTTON permits. Here that is
a malformed email or phone: nothing on the button reads them, and `validateProfileForm` rejects
them after the click.

**The rule this adds to the two above.** A mutation test proves a case measures something only if
the mutated code is REACHED. A disabled control, an early return, a guard that short-circuits, or a
mounted-only-when-open branch all sit between the test and the line under test, and each makes the
case green for a reason unrelated to the mutation. Assert the precondition that lets the code run —
the fixed case now asserts `expect(saveBtn.disabled).toBe(false)` before it clicks, so
re-introducing the same blindness fails loudly instead of silently.

Every one of the seven rows above is the same two questions in the same order. What changed
between rounds 170 and 171 is not the method; it is that the answers are now written down, so the
next lane can start from the table instead of re-opening seven handlers.

**The two classes the report cannot tell apart, and why both belong in a table like this.** The
variant and bundle rows are the SAME shape: a unique index refuses the replay (`question 1`
satisfied) and the UI then lies about it, because its catch maps every failure to one generic
message (`question 2` unsatisfied). That is worse than the promotion row, where nothing refuses
the replay and the damage is silent duplication -- a wrong message at least tells the operator
to look, whereas two discounts both applying at checkout produce no signal at all.

**A guard is not fixed by adding a ref where one already exists.** `PromotionManagementScreen`
already carried `loading={saving}` on its Save button, and its own test kill-tested exactly that:
removing the prop makes the case go red. Adding a ref there was defence in depth, and the
measurement that proves it was a two-step mutation, not the usual one:

```
ref broken + loading={saving} present   -> 20 passed   (the button was doing the work)
ref broken + loading={saving} REMOVED   -> 1 failed    (expected 2 to be 1)
ref restored                            -> 20 passed
```

Removing one guard at a time would have shown the ref "preventing" a defect the prop was already
preventing, and the case that named it would still have been green with the ref gone. When two
guards stand in front of the same write, the mutation has to remove both before it measures
anything.

**What the report counts after this round: 74.** Not because 76 was wrong -- each of the three
thrown off it now has an atomic ref plus a case that fails with `expected 2 to be 1` when the ref
is hollowed out. The other 69 are untouched, and the questions above have not been asked of them.


## Fifteen "unguarded" tablet calls, and the mount chain that made every one of them safe

Measured 2026-10-25, round 174. `verify-scoped-reads.py --shell tablet` reports **15 call
sites of commands the tablet does not register, with no guard pattern matched in the window**,
across eight files. The first instinct — route them through a scoped twin — would have been wrong
fifteen times. Three subagents traced the mount chain for every site and this lane re-verified the
load-bearing claims; **zero were live defects.**

| Shape the reader cannot see | Live example | Why it is a real guard |
|---|---|---|
| an early return AFTER the hooks, in the component that owns the call | `TopologyScreen.tsx:847-849`, ahead of `NodeTopologyEditor` (:860) and `TopologyRevisionBrowser` (:1016) | the JSX mounting both children is unreachable on the tablet; Rules of Hooks forbid hoisting the callbacks above the return |
| a hoisted `const isAvailable = !isTabletShell() && …` plus an effect guard | `settings/hooks/useRestore.ts:143` and `:148` | the effect returns before either read; `RestoreSection` renders no submit control when unavailable |
| a shell branch INSIDE the handler, routing each shell to its own command | `settings/hooks/useBackupStatus.ts:140` | the tablet takes `create_backup_to` and never reaches `create_backup` |

**The advice the gate printed was wrong for all three.** It said "If the ambient call is genuinely
unreachable, remove the allowlist entry instead" — but removing the entry makes the finding
REAPPEAR, because the entry is what records the decision. The message now says so, and names the
three shapes so the next reader can check a finding before acting on it.

**What this round did not do.** No allowlist entry was added or removed, and no call site was
rewritten: the guards were already correct. The `--shell tablet` run still exits 1, and should —
the entries say "known and accepted", not "clean". What changed is that the failure now tells a
reader how to tell a blind spot from a bug.

**One correction to an earlier record.** Round 154 wrote that six sibling topology findings were
"not defects" on the strength of a comment. The comment holds, and this round read the two guard
sites at `:173-175` and `:847-849` verbatim rather than trusting it. The claim was
right; it had not been verified.


**Round 175 tried to teach this reader the early-return shape. It could not be done safely, and
the attempt was reverted.** The plan was a fourth guard shape: a component that returns a shell
notice BEFORE its JSX, which is what `TopologyScreenContent` does at :847. Four
implementation attempts each failed on a measured fact rather than on reasoning:

1. **a brace walk from the call** — found the callback body, not the component, because the
   nearest opening brace above a call inside `useCallback(async () => {...})` is the callback;
2. **walking to the outermost balance point** — overshot, because the body between
   `TopologyScreenContent`'s opening brace and a call 12KB in has a net depth of **+3**: JSX
   and object literals are not the balanced code a brace walk assumes;
3. **anchoring on the function head** (`function name(` then the first brace after the
   parameter list closes) — correct, and it finds the innermost function reliably;
4. **collecting the returns by indentation** — also correct in isolation, and then the decisive
   fact: **the guard is not in the same function as the call.** `TopologyScreenContent` starts
   at offset 8556; the `if (isTabletShell()) { return … }` that protects it is at offset 8029, inside
   `TopologyScreen`, the PARENT. Entering the child is what the parent refuses, so no
   single-function reader can see it.

Widening to the whole file would be unsound: a sibling function's early return does not guard
this one, and a reader that believed it did would clear genuine findings. The tool for that is a
JS/TS parser, not a text pass. **The correct state is the one round 174 left**: the finding stands,
and the failure message explains how to tell a blind spot from a bug. Filed here so the next lane
does not spend a round rediscovering it — attempt 4 is where a reasonable person stops, and the
answer is above.


## The self-test sweep already exists, and it is step 1167 of the thing I was running

Measured 2026-10-25, round 179. Round 178 ended on a self-test that had been red since round 176
— `verify-ipc-parity.py --self-test` failing case 10 — and the lesson I wrote down was
"check the gates' own proof". This round I went to build that check, and found it:

```
$ python3 scripts/verify-selftest-sweep.py
verify-selftest-sweep: OK — 90 self-test(s) across 93 checker(s); 3 declare none and were skipped.
```

It is a step of `scripts/check.sh` (`:1167`, with its own self-test at :1168 and the
sabotage mutator at :1175). So the sweep that would have caught round 176's break was already in
the command I ran in round 178 — which reported **exit 1 at step 34**, the Postgres test that is
documented as "expected red" on a host without a server. The self-test sweep is step 1167 of 140.
**A suite that stops at step 34 has not run step 1167, and I read its failure as "the one known
environmental red" and stopped.** The instrument existed; the reading of it did not.

**A second, smaller version of the same error happened while verifying this.** My first sweep
script grepped each file for the STRING `--self-test` and reported 67 checkers. One
(`verify-website-assets.py`) came back `rc=2 unrecognized arguments` — because its docstring
contains the sentence "NO --self-test HERE, AND THE REASON IS MEASURED, NOT ASSUMED", explaining why
it deliberately has none. My second attempt narrowed the filter to files containing
`add_argument`, which still matched it, because that file parses three OTHER flags. Only
the third attempt — matching the actual registration, `add_argument("--self-test"` — gave 50
checkers and 0 failures. A text search for a feature is not a measurement of the feature, and this
file has said so before in a different costume.

**What that leaves for a reader.** Run `scripts/verify-selftest-sweep.py` alone when the question is
"are the proof forms green"; do not infer it from a `check.sh` run that stopped early. The 90 it
covers and the 50 my own filter found differ because the repo's sweep also walks the shell
checkers, which mine did not — the repo's number is the one to quote.


## What `CHECK_FROM` actually reaches: steps 53 to 142, measured in one evening

Measured 2026-10-25, round 180. The section above explains `CHECK_FROM`; this one reports what
it found when someone finally used it to walk past the documented-red steps. Everything below is
from real runs — `CHECK_FROM=35`, `=53`, `=55`, `=57`, `=93` — each writing its
full output to `target/mstmp/checkNN.txt`.

**The frontier moved from step 34 to step 142.** Steps 35-51 pass. Steps 53, 55, 57-91 pass except
two, 93-141 pass, and the run reached **142** — past the 131 the older note recorded. Four reds total,
and they sort into three kinds:

| Step | What | Whose |
|---|---|---|
| 52 | `test workspace (nextest)` — no PostgreSQL | environmental, documented |
| 54 | `flake receipt (junit)` | inherits 52 |
| 56 | `test application shells (nextest)` — `drift_pin_registration_floor_is_met`, 510 vs 511 | **REAL**, fixed this round |
| 92 | `core size ratchet` — +177 production lines | **REAL**, another lane's `payment_methods.rs` (+131) and `sales_checkout.rs` (+120) |
| 142 | `selftest sweep` — `verify-agents-mirrors.py` rc=1 | **transient**, not reproducible in 3 reruns |

**Step 56 is the finding this method exists for.** `03a506f87` (feat(reports): make the
piutang collections report reachable from the UI) registered
`get_piutang_collections_scoped` in the desktop shell and did not raise
`REGISTERED_FLOOR`. The command arrived ALREADY GATED at the bridge, which is precisely the
case the pin names in its own failure message: a gated arrival moves no permission ceiling and no
generated-ledger row, so **no other leg in that file can see it**. The pin was raised to 511 with the
commit and command named above the constant, and a matching entry in
`docs/records/journal/JOURNAL-part-8.md`, which is what the message asks for.

**Step 92 is not mine and was left red.** `verify-core-size.py` counts production lines only —
it excludes `*_tests.rs` by basename (`verify-core-size.py:10`) — so the 46 lines this
lane added to `receivables_tests.rs` do not count. The +177 is `payment_methods.rs` and
`sales_checkout.rs`, both from other sessions' commits. Raising a ceiling is a deliberate
act that names what landed; doing it for work you did not write, in a lane that cannot see the
intent, is the thing `archive/bulk-rename`-style caution in AGENTS.md §7.4 is about. Left for whoever
owns those commits.

**Step 142 is NOT the honest kind of red, and calling it transient was wrong.** Round 180
reported it as "transient, not reproducible in 3 reruns", on the strength of three standalone
runs that passed. Round 181 reproduced it on the very next matrix run, then found the cause in
one experiment:

```
$ python scripts/verify-selftest-sweep.py                          # 90/90, OK
$ python scripts/verify-agents-mirrors.py --self-test               # 40 green, 0 red
$ TEMP=<repo>/target/.tmp-check  python scripts/verify-agents-mirrors.py --self-test
  MISSED  AGENTS.md  renamed header, no HEAD readable -- the no-git fallback was turned
  count line: 39 green = 31 CAUGHT + 8 CLEAN; 1 red; exit 1
```

`scripts/check.sh:387-388` sets `TMP` and `TEMP` to `$PWD/target/.tmp-check`. The mirrors
self-test builds its fixtures with `tempfile.TemporaryDirectory()`, so under the matrix those live
**inside the checkout**, and `committed_hook_text` runs `git show HEAD:.githooks/pre-commit` with
`cwd=<fixture>`. Git walks UP from its cwd, so instead of failing it answered with the REAL
repository's HEAD — and the case that asserts "no HEAD readable" then compared the fixture against
a hook it was never meant to see.

**The fix** is one guard: `git rev-parse --show-toplevel` compared against the fixture root,
returning None ("cannot compare") when they differ. Verified 40/40 under BOTH TEMP settings, and
the whole sweep green under the matrix's own environment.

**The lesson, and it is sharper than "run the proof".** Three standalone passes were read as
"not reproducible" when they were "reproduced under the wrong environment". `check.sh` does not
just run checkers — it sets the environment they run in, and a checker that passes outside the
matrix and fails inside it is telling you which of the two is different, not that it is flaky.

**The lesson, and it is the same one twice.** Round 179 wrote that a suite stopping at step 34 has not
run step 1167. This round proves the sharper version: **the steps after a documented-red step hold
real, unfixed defects, and nobody had looked because the matrix never got there.** One registration
pin was red on the shared branch, seen by nothing, for a day. `CHECK_FROM` costs one command per
failed step and reaches the frontier.


## Archiving a plan is a rename with 1430 readers, and the reader that notices is step 161

Measured 2026-10-25, round 182. `a040b7fff` (docs(plans): archive completed payment resilience
design plan to _done) moved the plan out of `docs/plans/_active/` into
`docs/plans/_done/done-plan-payment-resilience-design.md` and added a two-line acceptance stamp
above the body. Eleven `///` comments across `crates/kasirmu-payment/src/` still cited the old path,
and four of them cited BODY LINE NUMBERS that the stamp moved:

| Cited | What the comment says it quotes | Where it actually is |
|---|---|---|
| `:217` | §8 row "a keyless money-moving call is not retried" | `:262` |
| `:219` | §8 row about a blank `idempotency_key` | `:265` |
| `:221` | §8 row "two decorators share one breaker" | `:266` |
| `:223` | §5 "HalfOpen admits exactly one probe" | `:220` |
| `:117` | the split-key table | `:118` |
| `:125` | §3 health | `:127` |

**Two separate errors, and only one of them is mechanical.** The path was stale in all eleven —
`check-rust-doc-paths.py` caught exactly that, and it is step 161 of the matrix. The LINE
NUMBERS were wrong in six of them in a way the gate cannot see: it checks that a cited path
RESOLVES, not that the line at that path says what the comment claims. Repointing the path alone
would have left six comments quoting the wrong paragraph while the gate printed clean.

**Why nobody saw it.** The archiver committed a step-161 risk without running step 161, and the
matrix had never reached 161 in any recorded run until round 181 moved the frontier past 144.
The red surfaced on the first run that got that far. This is the third round in a row where the
answer was "the gate exists, nobody has run it".

**What this round did.** Repointed all eleven at the archived file and corrected the six line
numbers, then verified each by CONTENT — the needle each comment claims to quote is read back from
the cited line, 8 of 8 matching. `cargo test -p kasirmu-payment` green (18 + 13 + 5 doctests).

**The rule for the next archival.** A plan file that Rust comments cite by `path:line` is a
published interface. Moving it needs `python3 scripts/check-rust-doc-paths.py` before the commit,
and the line-number shifts need reading the quoted text back, because no checker does that part.


## The frontier reached step 197, and every step from 86 to 197 now passes

Measured 2026-10-25, round 182, by walking the matrix with `CHECK_FROM` past each documented-red
step. Rounds 180-181 moved the frontier from 34 to 144; this round carried it to the end:

| Range | Result |
|---|---|
| 35-51 | PASS |
| 52, 54 | expected red — no PostgreSQL on this host |
| 53, 55, 57-91 | PASS |
| 92 | PASS after the ceiling raise (round 181) |
| 93-141 | PASS |
| 142-144 | PASS after the mirrors fix (round 181) |
| 160-162 | PASS after repointing the archived plan (round 182) |
| 163-171 | PASS after the api-reference markers (round 182) |
| 172-197 | PASS after six citation repairs (round 182) — **no failures** |

**Four defects were sitting behind the red**, all found on these walks and none of them visible
before: a registration pin 510-vs-511, a mirrors self-test reading the real HEAD through a fixture,
eleven design-doc citations pointing at a file an archive had moved, and six `path:line` citations
whose symbols had moved under them. Every one had been committed by a lane that ran a scoped check
and never the matrix step that grades the thing it touched.

**The pattern worth carrying.** A helper that commits a change to a path OTHER work cites — a plan
file, a shell script, a testid — should run the step that reads citations in that direction. The
steps that grade citations are 160-162 (`rust doc paths`, `docs dead refs`) and 172
(`cite lines`), and they are all far past the red. Running `scripts/check.sh` alone does not
discharge that obligation on this host, because it stops at 52.
> last audited 11-10-26 by docs-auditor
