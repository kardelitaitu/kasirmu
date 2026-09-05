# Agents Configuration

<!-- Audit stamp: 2026-09-04 · DSH · status: ACCURATE · version lock: 0.0.37 · 10 pre-commit gates · re-audited from the 2026-07-25 Hermes-Agent stamp (that audit resolved A1: version lock and manifests all read 0.0.21, and its "4 pre-commit gates" was accurate then — gates 6, 7 and 8 landed afterwards and this file never followed) -->

## Global Rules

- Maintain documentation integrity. Preserve all existing comments and docstrings unless explicitly modified.
- Never switch local branches unless explicitly asked by the user.
- Never create new branches unless explicitly asked by the user.
- **Use codebase-memory-mcp for code exploration.** Before reading files or grepping for symbols, query the knowledge graph via `codebase_memory_mcp` (search_graph, trace_path, get_code_snippet). This saves tokens by avoiding full-file reads and provides structural context that grep cannot.


## Quick Setup

```bash
git config core.hooksPath .githooks   # enable pre-commit hook (fmt + EOL + i18n + bundle-parity + FTL dedupe + column types + PG drift + Go + ui typecheck + ftl orphans)
```

The `.githooks/pre-commit` hook runs **ten steps** before every commit (~5–7s typical):

1. **`cargo fmt --all`** — auto-formats Rust and re-stages what it changed.
2. **Line-ending normalization** — strips CR from staged text files in the working tree and index and re-stages them, so the committed blob is LF (backs `.gitattributes` `* text=auto eol=lf`). Skips files whose effective `eol` is `crlf` (`*.bat`/`*.cmd` — the working tree must stay CRLF for cmd.exe) and real binaries (`grep -qI`; `text=auto` reports "auto" for PNGs too, and stripping their CRs destroys the signature). Both exclusions were missing until 0.0.36; `scripts/test-eol-guard.sh` guards them.
3. **`i18n lint`** — `scripts/lint-i18n.sh`; fail-closed on byte-identical `.id.ftl` siblings, duplicate Fluent keys dropped at bundle join, and literal keys resolving in neither locale.
4. **`Bundle parity: staged files only`** — `scripts/verify-bundle-parity.py --staged-only` with six `--include-*` flags, over staged files in `features`, `components`, `frontend`, `contexts`, `hooks`, `platform`; fails if any of the **eight checked surfaces** references a key missing from `.ftl`/`.id.ftl`.
5. **`FTL dedupe dry-run`** — `scripts/dedupe-ftl.py --dry-run`.
6. **`Migration column-type lint`** — `scripts/verify-migration-column-types.py --staged-only`, when `crates/oz-core/migrations/*.sql` is staged.
7. **`PG schema drift guard`** — `scripts/generate-pg-migration.py --check`; `20260813_init.pg.sql` is generated, never hand-edited.
8. **`Go gate`** — `gofmt -w` + `go vet ./...` when `apps/license-server/*.go` is staged.
9. **`UI typecheck`** — when the commit stages `ui/src/*.ts` or `ui/src/*.tsx`: `npm run typecheck` (~21s), hard fail. Added in 0.0.37 after ten commits landed with HEAD failing `tsc --noEmit`: Vitest injects describe/it/expect/beforeEach/vi at runtime, so a test file that forgets to import one passes `npm run test` and only fails `tsc`. `OZPOS_SKIP_TYPECHECK=1` skips this step alone; prefer it to `--no-verify`, which skips all ten. `scripts/test-typecheck-gate.sh` proves the live step still fires.
10. **`FTL orphan lint`** — when the commit stages a `.ftl` file: `scripts/verify-ftl-orphans.py --staged-only`, hard fail. Mirror of step 4: that asks whether code names a key no bundle defines, this asks whether a key has any code that reads it. Nothing checked the second direction and the debt is real — `topology-shortcuts-*` (18 keys, feature removed) and ~23 `warehouse-*` keys with zero references anywhere. Staged-scoped because dynamic composition (`analytics-month-${m}`) leaves 93 honest whole-tree candidates; `--census` reports them informationally and `--self-test` proves the check can still fail.

Without `core.hooksPath` set, all ten are bypassed at commit time — but CI now covers **all ten**. The live `dev-ci.yml` `i18n` job runs **`lint-i18n.sh` as a hard failure** (not informational) and **`dedupe-ftl.py --dry-run`**, and since step 10 also runs `verify-ftl-orphans.py --self-test` (blocking) plus `--census` (informational). **Migration column types and PG schema drift are no longer in the uncovered list**: they lived in `ci.yml`, were retired to `.bak` by `23c96330`, and were restored into `dev-ci.yml#static-gates` in **0.0.37** — until then the opt-in hook was their only guard, and they had no `gates.json` record either, so the drift checker could not report a gate it never saw. CI runs the column-type check without `--staged-only`, so it scans all 28 migration files rather than only the ones a commit touched. **Go** has been CI-backed since 0.0.36 (`13f2a1dc`): `dev-ci.yml#static-gates` runs `gofmt -l`, `go vet ./...` and `go test -short` on `apps/license-server` — note CI uses report-only `gofmt -l` where the hook runs `gofmt -w` and re-stages, so an unformatted commit is rejected by CI rather than fixed. **Every one of the ten now has a CI backstop**, with one qualification worth stating: step 10's CI coverage is its self-test and census, not the staged check, because CI has no index to diff against — so rejecting a newly-orphaned key happens only in the hook. `verify-bundle-parity.py` (step 4) was the last holdout and is covered since 0.0.37 by `dev-ci.yml#static-gates`, running without `--staged-only` and with `--scan-dirs features,components,frontend,contexts,hooks,platform` — the flag is load-bearing, since the tool defaults to `features` alone and the six directories add 108 files (228 → 336).

> This list used to be purely hand-maintained: `scripts/bump-version.ps1` syncs the *version* lines in this file and its mirrors but nothing synced the *gate* list, which is how this file, `.agents/AGENTS.md` and root `AGENTS.md` ended up claiming 4, 4 and 6 gates against a real 8 — and, worse, how two of them ended up asserting CI coverage the repo contradicted. `scripts/verify-agents-mirrors.py` now derives the expected counts, commit types, CI jobs and triggers from the hook, the workflows and `Cargo.toml`, and fails when a mirror disagrees. Source of truth is still the hook itself: `grep -n '^# ──' .githooks/pre-commit`.

For comprehensive local validation that mirrors the entire CI matrix (not just the pre-commit subset), see [`scripts/check.sh`](./scripts/check.sh). For the full first-time setup walkthrough, see [`.agents/skills/onboarding-guide/SKILL.md#first-time-setup`](../.agents/skills/onboarding-guide/SKILL.md#first-time-setup).


## Running UI CLI Tools on Windows (tsc / eslint)

`tsc` and `eslint` are **project-local** — they live in `ui/node_modules/.bin/` and are
NOT on the system PATH by default. On Windows every command that calls
these tools must prefix the PATH for that session, because each shell subprocess
starts fresh.

### Preferred approach — use npm scripts

`ui/package.json` wraps the tools as npm scripts, and npm resolves
`node_modules/.bin` automatically on every platform:

| Task | Command (run from `ui/`) |
|------|--------------------------|
| All UI gates (chained) | `npm run check:all` |
| Type-check | `npm run typecheck` |
| Lint | `npm run lint` |
| Lint + auto-fix | `npm run lint:fix` |
| Build (type-check + bundle) | `npm run build` |
| Tests | `npm run test` |
| E2E suite (Docker → Vite → Playwright → cleanup) | `npm run e2e` |
| E2E with browser visible | `npm run e2e:headed` |
| E2E API tests only | `npm run e2e:api` |
| E2E UI tests only | `npm run e2e:ui` |

```powershell
# Always run from the ui/ directory
cd "ui"
npm run check:all   # full validation: lint → typecheck → test → i18n → E2E
```

> **Rule:** Agents must use `npm run <script>` (not bare `tsc`/`eslint`) unless the
> PATH prefix pattern above is applied first. Never assume `tsc` or `eslint` are
> globally available on this machine.
>
> The `check:all` runner (`scripts/check-ui.mjs`) detects Docker availability
> and, when Docker is up, provisions the full E2E environment via `npm run e2e`
> (Docker backend + Vite + Playwright + cleanup — AUDIT-27 CI-07). It skips the
> E2E gate gracefully when Docker is not running. For the E2E lifecycle alone,
> use `npm run e2e`.

### If node_modules is missing

Run `npm ci` inside `ui/` before any of the above (it uses the pinned install-script approvals in `ui/package.json`; see `ui/README.md#install-script-approvals`):

```powershell
cd ui
npm ci --no-audit --no-fund
```

## Project Specific Rules

- Follow the POS software framework conventions.
- Ensure all code follows the project's coding standards.
- **Version is locked at the current release (`0.0.37`).** Never change the version number
  (in `Cargo.toml`, `tauri.conf.json`, `package.json`, `CHANGELOG.md`,
  or anywhere else) unless the user explicitly asks you to bump it.

### Rust Standards
- **Development Iteration:** Use `cargo check` (or `cargo check -p <crate>`) for quick compilation validation and run specific target tests (e.g. `cargo test -p <crate> <test_name>`) during active development. **Agents must NOT run `cargo clippy` or full workspace tests (`cargo test --workspace`) during routine iteration unless specifically requested by the user or executing final pre-push verification.**
- **Pre-Push Verification:** Run `cargo fmt --all`, `cargo clippy --all-targets --all-features -- -D warnings` (resolving all warnings), and full workspace tests prior to pushing code or completing final verification.
- Every public function, struct, and trait must have a doc comment (`///`).
- Prefer `thiserror` for error types and `anyhow` for application-level error propagation.
- Store all monetary values as integer minor units (`i64`) using the `Money` struct; never use `f32`/`f64` for currency.
- Use `rusqlite` with transactions for all database writes; never write outside a transaction.

### Tauri / UI Standards
- Tauri commands must be defined in `apps/desktop-client/src/commands/` or `apps/tablet-client/src/commands/` and registered in their respective `lib.rs`.
- Front-end API calls go through `ui/src/api/` (per-domain files); do not call `invoke` directly in components.
- All React components must have ARIA labels and pass `eslint-plugin-jsx-a11y` checks.
- Use `@fluent/react` for all user-visible strings; no hardcoded English strings in JSX.

### Testing Standards
- Every new Rust module must include a `#[cfg(test)]` block with at least one unit test.
- HAL drivers must have a mock implementation in `crates/oz-hal/src/drivers/mock.rs` for testing.
- Front-end components must have a corresponding test in `ui/src/__tests__/`.

### Git & Branch Policy
- Branch naming: `feat/<name>`, `fix/<name>`, `docs/<name>`, `chore/<name>`, `test/<name>`, `refactor/<name>`.
- **Always make a local commit after each major modification.** Whenever a logical task, feature step, or significant code change is completed and verified locally, commit it before moving on to the next task. The commit message must accurately and comprehensively explain what was changed across all committed files.

- **Never run `git push` without an explicit, direct order from the user.** Even after committing code or completing verification, always wait for the user to explicitly instruct you to push before executing any `git push` command.
- All PRs must pass the CI pipeline (lint, test, build) before merging.


- CI runs on `pull_request` targeting `main`, plus manual `workflow_dispatch`. The live
  `dev-ci.yml` has **no `push` trigger at all** — not even on `main`. So pushing a
  feature branch runs nothing; open a PR targeting `main` to validate changes.
- Never commit secrets, `.env` files, or SQLite database files.

> [!NOTE]
> This file serves as the central place to define agents, rules, and customization for the POS framework.
