<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (2 major, 1 minor) · Full re-audit of the ops handbook; the 2026-09-29 stamp is merged at the bottom as plain text (delimiters stripped so it cannot nest). Every gate name, script path, command and CI attribution re-derived against .githooks/pre-commit, scripts/check.sh, scripts/gates.json and .github/workflows/ — not inherited. · MAJOR 1 (§The 7 pre-commit steps, step 2): the scan-dirs list named three directories that are not the ones the hook scans. It read `features, components, frontend, contexts, hooks, platform`; the hook passes `--scan-dirs features,components,app,theme,registries,contexts,hooks`, and `ui/src/frontend` and `ui/src/platform` DO NOT EXIST. The checker's own docstring (:139) carries the same correct list, so the page contradicted a file it cites. Repaired to the hook's list. The `Eight surfaces checked` figure is CONFIRMED correct by running the census (`verify-bundle-parity: ... 8 surface(s)`). · MAJOR 2 (step 6, Go gate): its CI backstop was attributed to `dev-ci.yml#static-gates`, but the Go commands run in their OWN job — `dev-ci.yml#go-gate`, split out on 2026-09-24 — and the page's OWN job list 27 lines below already names `go-gate` separately, so the file contradicted itself. Commands were right (`gofmt -l`, `go vet`, `go test -short`); only the job was stale. Repaired. · MINOR (§Writing a checker): `Six of the seven scripts/check-*.py checkers expose --self-test` was wrong in BOTH numbers — there are EIGHT check-*.py files and SEVEN expose the flag (the eighth, `check-replay-fork.py`, keeps its cases in `scripts/test-replay-fork.py`, which the sentence already said). Repaired to seven of eight. · VERIFIED AND LEFT ALONE, each re-derived rather than trusted: the hook has exactly EIGHT `# ──` sections and all eight step names match; every step's command and flags match the hook verbatim, including `--staged-only`, the five `--include-*` flags, `--check-domain-pairs`, and the staged-only rustfmt step's `--check --edition 2024` (check-only, never `-w`); four live workflows with the documented triggers, 11 inert `.bak` in `attic/`; `dev-ci.yml` defines 18 jobs and `northflank-deploy` needs exactly the 13 named; `cargo-clippy` really runs `cargo clippy --workspace --all-targets -- -D warnings`; all six walker suites exist and `motionImportantEscapes` is genuinely a separate suite because `animationCompliance` counts `transitionDecls` as never-read; every referenced script exists; `check-replay-fork.py`'s self-test citation `:44-49` is line-exact and both documented self-test forms run green (2 and 10 cases). · NOT re-measured: whether each gate currently PASSES, the red-suite ownership anecdote's reproduction, and the walker suites' own pass counts — those are runs, not doc claims, and this audit claims only that the enforcement the page describes exists and is correctly attributed. · Superseded 2026-09-29 stamp follows as plain text:

Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file, with no prior stamp, footer or marker. It is the operational companion to the root agent guide, and its subtitle is the design statement: TEETH, NOT HISTORY. That distinction is the whole reason the file exists, and it is the sharpest framing this campaign has read on documentation in this repository. · THE ROOT GUIDE STATES THE RULES; THIS FILE STATES WHAT ENFORCES THEM. A reader who has internalised the rule that seven gates run before a commit learns nothing new here, but a reader who wants to know whether the seventh gate can be bypassed learns everything. That is a different question, and answering it is the difference between a policy and a control. The seven steps it enumerates match the list in the root guide exactly — duplication that is a liability when the two drift and an asset when they are checked against each other, which this campaign has done every round. · THE CSS BLIND SPOT IS THE PART MOST WORTH A READER'S ATTENTION, because it is a gate everyone assumes covers something it does not. A stylesheet change passes the lint step, because the lint step runs a tool that does not read stylesheets. The handbook says so plainly, and the companion page audited two rounds ago exists to give the replacement: named walker suites that grade what the linter cannot see, each with its own caveats. A handbook that documents a hole in its own enforcement is worth more than one implying completeness, because the hole is what a reader would otherwise get wrong. · IT REFERS THE READER OUTWARD for the rules themselves rather than restating them, which is the correct division of labour between a root document and an operational one and is one more reason the two stay in sync. · NOT re-measured: whether each gate currently passes, or the CI backstops it names. Running the gates is the original work, and the stamp claims only that the file describes enforcement that exists — the pre-commit hook and the CI workflows are both present, and the hook's own comments corroborate at least one step's history. · No stamp existed; this is the first. -->
# Agent Ops Handbook

> Teeth, not history: the 7 pre-commit steps, their CI backstops, and the CSS blind spot.
> For the statement of the rules themselves, read root `AGENTS.md`.

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

Four live workflows — re-derive with `ls .github/workflows/*.yml`, never quote this list:

| Workflow | Triggers |
|---|---|
| `dev-ci.yml` | `pull_request` to `main`, `push` to `main`, `workflow_dispatch` |
| `release.yml` | `push` on `v*` tags (desktop-only) |
| `android.yml` | `push` on `v*` tags, `workflow_dispatch` — no PR trigger |
| `website.yml` | `push` to `main` filtered to `website/**`, `prototypes/**`, `scripts/wrangler-deploy.sh` and the workflow file itself, plus `workflow_dispatch` |

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
`docs/records/audits/2026-08-31-glm-5.3f-crates-audit.md:2203` asserted it "runs the volume
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

> last audited 11-10-26 by docs-auditor
