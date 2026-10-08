<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file, with no prior stamp, footer or marker. It is the operational companion to the root agent guide, and its subtitle is the design statement: TEETH, NOT HISTORY. That distinction is the whole reason the file exists, and it is the sharpest framing this campaign has read on documentation in this repository. · THE ROOT GUIDE STATES THE RULES; THIS FILE STATES WHAT ENFORCES THEM. A reader who has internalised the rule that seven gates run before a commit learns nothing new here, but a reader who wants to know whether the seventh gate can be bypassed learns everything. That is a different question, and answering it is the difference between a policy and a control. The seven steps it enumerates match the list in the root guide exactly — duplication that is a liability when the two drift and an asset when they are checked against each other, which this campaign has done every round. · THE CSS BLIND SPOT IS THE PART MOST WORTH A READER'S ATTENTION, because it is a gate everyone assumes covers something it does not. A stylesheet change passes the lint step, because the lint step runs a tool that does not read stylesheets. The handbook says so plainly, and the companion page audited two rounds ago exists to give the replacement: named walker suites that grade what the linter cannot see, each with its own caveats. A handbook that documents a hole in its own enforcement is worth more than one implying completeness, because the hole is what a reader would otherwise get wrong. · IT REFERS THE READER OUTWARD for the rules themselves rather than restating them, which is the correct division of labour between a root document and an operational one and is one more reason the two stay in sync. · NOT re-measured: whether each gate currently passes, or the CI backstops it names. Running the gates is the original work, and the stamp claims only that the file describes enforcement that exists — the pre-commit hook and the CI workflows are both present, and the hook's own comments corroborate at least one step's history. · No stamp existed; this is the first. -->
# Agent Ops Handbook

> Teeth, not history: the 7 pre-commit steps, their CI backstops, and the CSS blind spot.
> For the statement of the rules themselves, read root `AGENTS.md`.

## The 7 pre-commit steps (source: `.githooks/pre-commit`)

1. **Line-ending normalization** — strips CR from staged text files (working tree + index). Skips `*.bat`/`*.cmd` (working tree stays CRLF for cmd.exe) and real binaries. CI stand-in only: `dev-ci.yml` runs `scripts/test-eol-guard.sh` (a fixture self-test, not a live CRLF check).
2. **Bundle parity** — `scripts/verify-bundle-parity.py --staged-only` with all `--include-*` flags, over staged files in `features`, `components`, `frontend`, `contexts`, `hooks`, `platform`. Eight surfaces checked against `.ftl`/`.id.ftl`. CI: `dev-ci.yml#i18n` via `scripts/lint-i18n.sh`.
3. **FTL dedupe dry-run** — `scripts/dedupe-ftl.py --dry-run` when `.ftl` files are staged.
4. **Migration column-type lint** — `scripts/verify-migration-column-types.py --staged-only` when `crates/kasirmu-core/migrations/*.sql` is staged; exact-decimal columns must be `*_minor`/`*_millionths` integers. CI: `dev-ci.yml#static-gates`, full-tree scan.
5. **PG schema drift guard** — `scripts/generate-pg-migration.py --check`; `20260813_init.pg.sql` is generated, never hand-edited. CI: `dev-ci.yml#static-gates`.
6. **Go gate** — `apps/license-server/*.go` staged: `gofmt -w` then `go vet ./...`; aborts if `go`/`gofmt` are missing. CI: `dev-ci.yml#static-gates` runs `gofmt -l`, `go vet`, `go test -short` (note: `-l` reports, `-w` fixes).
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
`scripts/verify-agents-mirrors.py` polices mirror claims about gate counts, step names, commit types, version, per-workflow triggers, stated job totals, and the live workflow a "mirrors <workflow>" claim names — but never opens a job's `run:` lines. Canonical CI reference: `docs/operations/ci-pipeline.md`.

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

## Writing a checker: two self-test forms, and say which you chose

Six of the seven `scripts/check-*.py` checkers expose `--self-test`; `check-replay-fork.py` keeps its
cases in `scripts/test-replay-fork.py` instead. Both are correct — that one explains why at its
docstring (`:44-49`): it is the gate that would have caught the fork losing the colon rejection, so
"a checker that cannot fail is worse than none" and it wanted the cases somewhere harder to overlook.

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

> last audited 29-09-26 by docs-auditor
