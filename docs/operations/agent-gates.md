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

**Step numbers in the run are NOT the numbers a text scan gives.** The file holds 193
`step "..."` lines, of which **42 are indented inside `if` blocks** and only run when
their condition holds; the rest is whatever the run reached before it exited. So the
runtime numbering is LOWER than a line count, by an amount that depends on the
environment. Measured the same day: `ui test` is runtime step **89** and static position
**93**, and a partial run's highest number was **131** against 193 lines.

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
| `check-auditor-selftests.sh` | No | **It IS a runner** — invokes 11 docs checkers' self-tests | `check.sh:253`, `required` |
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

Of the 16 `scripts/check-*.py` checkers, 13 expose `--self-test`; `check-replay-fork.py` keeps
its cases in `scripts/test-replay-fork.py` instead; `check-query-plans.py` and `check-scratch-leaks.py`
run their proof INSIDE `--check` (a detector probe over synthetic sources, first, before the tree is
graded) rather than behind a flag. (Re-measured 2026-10-23 by walking `scripts/check-*.py`: the count
was 12 and "check-dead-controls.py has no self-test at all" until that pass, and both numbers had been
wrong in both directions before — see the note below on why a text search is the wrong instrument.)
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
