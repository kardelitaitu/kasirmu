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

## What CI actually runs

Live workflows: `dev-ci.yml` and `release.yml` (desktop-only, `v*` tags). Everything else lives in `.github/workflows/attic/` as inert `.bak`.
`dev-ci.yml` triggers: `pull_request` to `main`, `push` to `main`, `workflow_dispatch`. A push to `main` runs CI and deploys (`northflank-deploy`); a push to a non-`main` branch runs nothing.
Jobs (14): `changes`, `website`, `rust-fmt`, `cargo-check`, `cargo-nextest`, `ui-test`, `i18n`, `ci-docs-drift`, `static-gates`, `go-gate`, `ipc-parity`, `release-readiness`,
`release-bridge-test` (push-only, desktop bridge tests in release profile), `northflank-deploy`. `northflank-deploy` needs 10 of them (excludes `ci-docs-drift`, `release-readiness` and the push-only `release-bridge-test`).
`rust-fmt` is `cargo fmt --all -- --check` on its own (~20s, no apt layer and no cargo cache); `cargo-check` is `cargo check --workspace --all-targets --all-features`. **No live workflow runs clippy** — it is local-only via `scripts/check.sh` and `scripts/release.sh`.
`scripts/verify-agents-mirrors.py` polices mirror claims about gate counts, step names, commit types, version, per-workflow triggers, stated job totals, and the live workflow a "mirrors <workflow>" claim names — but never opens a job's `run:` lines. Canonical CI reference: `docs/operations/ci-pipeline.md`.

## CSS has no linter — verify stylesheets with the walker suites

ESLint ignores `.css` (no matching config, exits 0) and no hook step sees stylesheets, so never cite `eslint exit 0` for a `.css` change. Verify with the five walkers and report the pass counts they print:

```powershell
cd ui
npx vitest run src/__tests__/themeTokenCompliance.test.ts src/__tests__/composedRuleIdenticalPair.test.ts src/__tests__/popupBackgroundCompliance.test.ts src/__tests__/animationCompliance.test.ts src/__tests__/noiseDitherCompliance.test.ts
```

Caveats: each suite grades a fixed set of shapes (a printed denominator, not full coverage); walkers read the working tree, so record dirty `.css` paths alongside any result. Full analysis: `docs/audits/frontend/css-verification.md`.

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
