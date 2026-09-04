# Agents Configuration & Rules

<!-- Audit stamp: 2026-09-04 · DSH · status: ACCURATE · version lock: 0.0.37 · 9 pre-commit gates · conventional commits enforced -->

## 🚨 Critical Agent Directives (MUST FOLLOW)

| Rule | Direct Instruction | Why / Context |
|---|---|---|
| **Branching** | **NEVER create new branches. NEVER switch branches.** | Always work directly on the currently active branch unless specifically requested by the user. |
| **Commits** | **ALWAYS commit with format `<type>(<area>): <description>`.** | Must follow conventional commits. Make local commits after each logical task. |
| **Pushing** | **NEVER run `git push` without an explicit direct order.** | Even after completing all checks, wait for the user to explicitly say "push". |
| **Version Lock** | **Version is locked at `0.0.37`. NEVER modify version numbers.** | Do not bump version in `Cargo.toml`, `package.json`, `tauri.conf.json`, etc. |
| **File Paths** | **ALWAYS use forward slashes (`/`) in path arguments on Windows.** | Avoid path escaping bugs. **Never anchor to a hardcoded checkout** (e.g. `C:/My Script/oz-pos/`) — resolve the repo root with `git rev-parse --show-toplevel`, or script-relative with `$PSScriptRoot`/`__file__`/`import.meta.url`, so tools work in any worktree of the multi-root layout (`<base>/main` bare + `<base>/<release>` + `<base>/worktrees/*`). |
| **File Reading** | **ALWAYS read files in small chunks (≤ 500 lines).** | Preserves context window and prevents output truncation. |
| **Discovery** | **ALWAYS use `codebase-memory-mcp` first for code exploration.** | Graph discovery saves context tokens and surfaces call chains faster. |
| **Currency** | **ALWAYS use `Money` struct (`i64` minor units). NEVER use float.** | Monetary values must never use `f32`/`f64`. |
| **DB Writes** | **ALWAYS use `rusqlite` transactions for database writes.** | Never write to SQLite outside an explicit transaction. |

---

## 🛠️ Quick Setup & Pre-Commit Gates

```bash
git config core.hooksPath .githooks   # enable pre-commit hook (fmt + EOL + i18n + bundle-parity + FTL dedupe + column types + PG drift + Go + ui typecheck)
```

The `.githooks/pre-commit` hook runs **nine steps** automatically before every commit, in this order (~5–7s total on a typical commit; the i18n gate alone is ~4s). Step 9 is conditional and adds ~21s **only** when the commit stages `ui/src` TypeScript — measured end to end at 28.7s for a UI commit versus 7.1s for a docs-only one:
1. **`cargo fmt --all`** — auto-formats Rust and re-stages what it changed.
2. **Line-ending normalization** — strips CR from staged *text* files in both the working tree and the index, then re-stages them, so the committed blob is LF and `git status` is clean immediately after commit. Backs `.gitattributes` (`* text=auto eol=lf`); a no-op when already LF. **Two exclusions are load-bearing and were both missing until 0.0.36 (R36-15):** files whose effective `eol` is `crlf` (`*.bat`, `*.cmd`) are skipped — the index stores LF but the *working tree* must stay CRLF, because cmd.exe mis-parses labels/`goto` otherwise; and a `grep -qI` content check skips real binaries, because `* text=auto` makes `check-attr text` answer "auto" for **every** path, PNG included, and stripping CR from a PNG deletes the `0D 0A` its signature requires (measured: `apps/desktop-client/icons/32x32.png` 1515 → 1507 bytes, signature destroyed, mangled blob re-staged). `scripts/test-eol-guard.sh` extracts the live guard from the hook and asserts both exclusions.
3. **`i18n lint`** — runs `scripts/lint-i18n.sh`, fail-closed on three categories: `.id.ftl` siblings byte-identical to their English source, duplicate Fluent keys silently dropped at bundle join, and literal key references resolving in neither locale.
4. **`Bundle parity: staged files only`** — runs `scripts/verify-bundle-parity.py --staged-only --include-getstring --include-nav-keys --include-key-fields --include-dynamic-literals --include-id-maps --check-domain-pairs` over staged files in `features`, `components`, `frontend`, `contexts`, `hooks` and `platform`; fails if any of the **eight checked surfaces** references a key missing from `.ftl` or `.id.ftl`. Before the Fluent page audit this walked only literal `<Localized id>` under `ui/src/features/**`, and skipped every shared-chrome and context file it was handed — so 14 broken keys shipped while it reported clean.
5. **`FTL dedupe dry-run`** — runs `scripts/dedupe-ftl.py --dry-run` to detect duplicate Fluent keys before push.
6. **`Migration column-type lint`** — runs `scripts/verify-migration-column-types.py --staged-only` when `crates/oz-core/migrations/*.sql` is staged; exact-decimal columns must be fixed-point integers (`*_minor`/`*_millionths`), new floats need a justified whitelist entry.
7. **`PG schema drift guard`** — runs `scripts/generate-pg-migration.py --check` when any migration, the registry, or the generator is staged; `20260813_init.pg.sql` is generated, never hand-edited (see [`docs/records/sqlite-pg-roles.md`](./docs/records/sqlite-pg-roles.md)).
8. **`Go gate`** — when the commit stages `apps/license-server/*.go`: `gofmt -w` (auto-fix + re-stage) then `go vet ./...` (hard fail). **Aborts the commit if `go`/`gofmt` are not on PATH** — unlike the optional gates, this one has no skip path.
9. **`UI typecheck`** — when the commit stages `ui/src/*.ts` or `ui/src/*.tsx`: `npm run typecheck` (~21s), hard fail. Added in **0.0.37** after ten commits landed with HEAD failing `tsc --noEmit`: Vitest injects `describe/it/expect/beforeEach/vi` at runtime, so a test file that forgets to import one **passes `npm run test`** and only fails `tsc` — and nothing ran `tsc` before commit. `check.sh` always had it, but `check.sh` is opt-in. `OZPOS_SKIP_TYPECHECK=1` skips this step alone (prefer it to `--no-verify`, which skips all nine). Warns instead of failing when `ui/node_modules` is absent, so the skip is announced rather than invisible. `scripts/test-typecheck-gate.sh` extracts the live step from the hook and drives it against a throwaway repo with a stubbed `npm`, because the step only fires on UI commits and would otherwise go unexercised long enough to be indistinguishable from deleted.

> ✅ **All nine steps now have a CI backstop.** Steps 6 and 7 (`verify-migration-column-types.py`, `generate-pg-migration.py --check`) lived in `ci.yml`, were retired to `.bak` by `23c96330`, and were restored into `dev-ci.yml#static-gates` in **0.0.37** — until then the opt-in hook was their only guard, and they had **no `gates.json` record at all**, so the drift checker could not even report them as unenforced. CI runs the column-type check without `--staged-only`, so it scans all 28 migration files rather than only the ones a commit happened to touch. Both are pure text comparison (~1.1s together): no Docker, no psycopg, no sqlite handle — there was never a build-cost reason to leave them out. Step 8 (Go) has been CI-backed since 0.0.36: `dev-ci.yml#static-gates` runs `gofmt -l`, `go vet` and `go test -short` on `apps/license-server`. The hook's own Go-gate comment still claims that job lives in "`.github/workflows/ci.yml` # go job" — that workflow is retired (`.bak`); the coverage is real but the pointer is wrong. Note the CI gate is `gofmt -l` (report-only, fails on any unformatted file) while the hook runs `gofmt -w` and re-stages, so a commit made without `core.hooksPath` can be unformatted and CI will reject it rather than fix it. **Step 9's CI backstop is `dev-ci.yml#ui-test`, which runs `npm run typecheck` — but that job only runs on a PR to `main`, and `dev-ci.yml` has no `push` trigger, so on a long-lived release branch the hook is currently the only thing typechecking at all.**

> **What CI actually runs.** Two workflows are live. `.github/workflows/dev-ci.yml` ("Dev CI") runs on `pull_request` targeting `main` plus `workflow_dispatch` — **there is no `push` trigger**, so pushing a branch runs nothing and a PR is required to validate. Its jobs are `changes` (the path router), `website`, `cargo-check`, `cargo-nextest`, `ui-test`, `i18n`, `ci-docs-drift`, `static-gates`, `release-readiness`, and `northflank-deploy`. `.github/workflows/release.yml` ("Release") runs on `v*` tags and was **restored desktop-only in 0.0.36** after `23c96330` renamed it to `.bak` with no replacement (R36-11): it builds the three Tauri desktop installers, signs the updater manifests, attests provenance, and publishes the GitHub Release. Every other file in that directory is `.bak` and GitHub never executes it (`ci.yml.bak`, `nightly.yml.bak`, `e2e-pr.yml.bak`, `security.yml.bak`, `android.yml.bak`, `ios.yml.bak`, `deploy.yml.bak`, `website.yml.bak`, `docker-*.yml.bak`).
>
> `release.yml` covers **desktop only**. Mobile (`android.yml`, `ios.yml`) and release-time container images are still retired, and the build/sign/publish path cannot be verified without a real tag push — `dev-ci.yml#release-readiness` verifies the updater signing chain instead, and `scripts/verify-release-workflow.py` (in `static-gates`, with `--self-test`) validates the workflow statically. `northflank-deploy` `needs` every other `dev-ci.yml` job **except `ci-docs-drift`**, which is gated on `needs.changes.outputs.docs` — a skipped dependency skips the job, so depending on it would block deploys on docs changes. So **E2E, a11y, security and nightly suites are NOT enforced in CI** — a green Dev CI run is not proof those passed. `scripts/check.sh` is the local full-matrix equivalent; run it before declaring a change verified. Note that CI's `cargo nextest run --workspace --all-features` carries **no `--exclude`**, so CI tests the app crates that `check.sh` skips.
>
> The `i18n` job was restored by the Fluent page audit after `ci.yml` was retired without a replacement. Note that the pre-commit hook is **opt-in per developer**: `core.hooksPath` is set by `scripts/setup-dev.ps1` and is not versioned, so a fresh clone that skips setup has no local gate — CI is the backstop.

---

## 🔑 Global Environment Variables (`OZPOS_*`)

The developer machine's API keys are stored as **user-scope Windows environment variables** with an `OZPOS_` prefix (persisted in `HKCU\Environment`; they survive reboots and are available in every **new** PowerShell session — the session that set them must be reopened). Source of truth: the gitignored `.env` at the repo root.

```powershell
$env:OZPOS_CLOUDFLARE_API_TOKEN        # Cloudflare Workers deploy token
$env:OZPOS_CLOUDFLARE_ACCOUNT_ID       # Cloudflare account id
$env:OZPOS_CLOUDFLARE_ACCESS_KEY       # R2 access key id
$env:OZPOS_CLOUDFLARE_SECRET_ACCESS_KEY# R2 secret access key
$env:OZPOS_CLOUDFLARE_S3_ENDPOINT      # R2 S3 endpoint
$env:OZPOS_NORTHFLANK_API_TOKEN        # Northflank deploy token
$env:OZPOS_OZ_ADMIN_KEY                # admin dashboard API key
$env:OZPOS_OZ_API_SECRET               # JWT signing secret
$env:OZPOS_OZ_ENFORCE_PLANS            # plan gating flag
$env:OZPOS_OZ_LICENSE_PRIVATE_KEY      # RSA license signing key (PEM, multiline)
```

- Use them in commands instead of hardcoding secrets, e.g. the website deploy:
  ```powershell
  $env:CLOUDFLARE_API_TOKEN=$env:OZPOS_CLOUDFLARE_API_TOKEN
  $env:CLOUDFLARE_ACCOUNT_ID=$env:OZPOS_CLOUDFLARE_ACCOUNT_ID
  npm run deploy   # from website/
  ```
- Update `.env` → variables by re-running the save step (same names/prefix); never commit `.env`.
- ⚠️ These are plaintext in the user registry — local-dev convenience only, not a secrets manager.

---

## 💻 Running CLI Tools on Windows

### 1. UI & Front-End CLI (TypeScript / ESLint / Vite)

> ⚠️ **MANDATORY RULE:** `tsc` and `eslint` are **project-local** in `ui/node_modules/.bin/` and are NOT on the system PATH.
> **Agents must ALWAYS run npm scripts from inside the `ui/` directory (`npm run <script>`).** Never invoke bare `tsc` or `eslint`.

| Task | Command (Run from `ui/`) | Description |
|---|---|---|
| **All UI Gates** | `npm run check:all` | Chained gate: lint → typecheck → test → i18n → E2E |
| **Type Check** | `npm run typecheck` | Runs project TypeScript type-checking |
| **Lint** | `npm run lint` | Runs ESLint (a11y + React rules) |
| **Lint Auto-Fix** | `npm run lint:fix` | Runs ESLint with auto-fix |
| **Unit Tests** | `npm run test` | Runs Vitest unit tests |
| **Build Bundle** | `npm run build` | Validates bundle compilation |
| **E2E Suite** | `npm run e2e` | Docker backend + Vite + Playwright + cleanup |
| **E2E UI Only** | `npm run e2e:ui` | Runs Playwright UI spec subset |
| **E2E + Rebuild Images** | `npm run e2e -- --build` | Rebuilds stale `e2e-{cloud,license}-server` images first |

> **Stale-image guard:** `compose up --pull=missing` never rebuilds a tag that already exists, so `run-e2e.mjs` **refuses to start** when a locally-built image predates its own sources (exit 3 · `E2E SETUP FAILED`). Re-run with `--build`. Agents must not treat a green local E2E run as proof of current backend behaviour unless the guard passed. Skipped under `CI`, where the workflow builds from the checkout.

*If `node_modules` is missing, install cleanly:*
```powershell
cd ui
npm ci --no-audit --no-fund
```

### 2. Rust Backend CLI

- **Active Development Iteration:**
  - Quick compilation check: `cargo check -p <crate>`
  - Run specific test: `cargo test -p <crate> <test_name>`
  - 🛑 **Agents must NOT run `cargo clippy` or full workspace tests (`cargo test --workspace`) during routine iteration.**
- **Pre-Push / Final Verification Only:**
  - `cargo fmt --all`
  - `cargo clippy --all-targets --all-features -- -D warnings` (must resolve all warnings)
  - Full workspace tests prior to pushing

---

## 📐 Architecture & Coding Standards

### 1. Rust Standards
- Every public function, struct, enum, and trait must have a doc comment (`///`).
- **Module Documentation:** Every production `.rs` file must start with a short module-level doc comment (`//!`, 5–15 lines max: purpose, key types, main functions, invariants).
- Use `thiserror` for error types and `anyhow` for application-level error propagation.
- **Monetary Values:** Store as integer minor units (`i64`) using `Money`. Never use `f32`/`f64`.
- **Database Writes:** Must run inside a `rusqlite` transaction.

### 2. Test File Organization
- Keep production `.rs` files under 1,000 lines (preferably < 600 lines).
- **Never put unit tests inside production `.rs` files.**
  - Place unit tests in a sibling file named `*_tests.rs` (e.g. `sales.rs` → `sales_tests.rs`).
  - At the bottom of the production file, wire:
    ```rust
    #[cfg(test)]
    #[path = "sales_tests.rs"]
    mod tests;
    ```
  - Inside `sales_tests.rs`, start with `use super::*;`.
  - Integration tests belong in the top-level `tests/` directory (outside `src/`).

### 3. Tauri & UI Standards
- Tauri IPC commands live in `apps/desktop-client/src/commands/` or `apps/tablet-client/src/commands/` and are registered in their respective `lib.rs`.
- Front-end API calls must route through `ui/src/api/` (per-domain files). **Never call `invoke(...)` directly inside React components.**
- **"Settings" disambiguation:** "The Tauri Settings page" means `ui/src/features/settings/SettingsPage.tsx` — the master–detail UI (route `settings`) with the top-right Save button. Do not confuse it with the other `settings` surfaces: `ui/src/api/settings.ts` (IPC client) · `ui/src/contexts/SettingsContext.tsx` (shared state) · `apps/desktop-client/src/commands/settings.rs` and `apps/tablet-client/src/commands/settings.rs` (IPC commands) · `crates/oz-core/src/settings.rs` and `crates/oz-core/src/db/settings.rs` (backend service/DB) · `modules/settings/` (the kernel module — a lifecycle stub, not the UI).
- **⚠️ "Is this screen dead code?" needs three greps, not one.** Feature screens are registered **lazily**, so a `from '…'` search finds nothing and the screen looks unreachable. `ui/src/features/*/register.tsx` opens with `const X = lazy(() => import('./X'))` and then calls `registerPage({ route, component: X, … })` + `registerNavItem(...)`. Concluding "not routed" from one grep is how a live, nav-linked manager screen got written up as deletable. Check all three:
  ```bash
  git grep -n "ScreenName" -- ui/src ':!ui/src/__tests__'   # no -head/-First truncation
  git grep -n "route: '<route>'" -- ui/src                  # page + nav + workspace cards
  ```
  Also beware truncated output: `ui/src/__tests__/` sorts before `ui/src/features/`, so `| head -6` on an importer search shows only test files and hides the real registration.
- **⚠️ A `:!` pathspec built by inline concatenation silently returns zero matches.** In PowerShell argument position, `git grep -n X -- ui/src ':!ui/src/__tests__' ':!dir/'+$f+'.tsx'` yields **0 hits** with no error, while assigning the same string to a variable first yields the correct 2. A false "no references" result is precisely the evidence that makes a live screen look dead — this produced a wrong "not routed, delete it" conclusion once already. Build exclusion pathspecs as their own variable, and sanity-check any zero-reference dead-code claim with one unfiltered `git grep`.
- **Accessibility:** All React components must have ARIA labels and pass `eslint-plugin-jsx-a11y` checks.
- **Localization:** All user-visible strings must use `@fluent/react`. No hardcoded English strings in JSX.

### 4. Database & Hardware
- **HAL Drivers:** Hardware drivers must have a mock implementation in `crates/oz-hal/src/drivers/mock.rs`.
- **SQLite is the schema source of truth:** `crates/oz-core/migrations/*.sql` + the registry in `migrations.rs` (registry order is canonical). See [`docs/records/sqlite-pg-roles.md`](./docs/records/sqlite-pg-roles.md).
- **`init.pg.sql` is generated, never hand-edited:** after any migration change run `python3 scripts/generate-pg-migration.py` and re-stage `crates/oz-core/migrations/20260813_init.pg.sql`. Pre-commit step 7 fails on drift, and since **0.0.37** so does CI: `dev-ci.yml#static-gates` runs `generate-pg-migration.py --check`. (For two releases the job sat nowhere — it was retired with `ci.yml` in `23c96330` and never restored, and it had no `gates.json` record either, so the drift checker could not report a gate it never saw. On a clone without `core.hooksPath`, a hand-edited generated file committed and merged clean.)
- **PostgreSQL Drift:** When modifying Postgres schemas, run `bash scripts/reset-dev-pg.sh` to re-synchronize the shared dev container schema (`oz-pg-test-15432`).

---

## 🌿 Git & Commit Policy

### 1. Branch Policy
- **Never create new branches unless asked specifically by the user.** Always work directly on the currently active branch.
- **Never switch local branches unless explicitly asked by the user.**
- Branch naming convention (when explicitly requested): `feat/<name>`, `fix/<name>`, `docs/<name>`, `chore/<name>`, `test/<name>`, `refactor/<name>`.

### 2. Commit Format Requirement
Every commit message **MUST** strictly follow the conventional format:
```
<type>(<area>): <description>

[optional body explaining changes, rationale, or issue references]
```

- **`<type>`** must be one of:
  - `feat`: New feature or capability
  - `fix`: Bug fix
  - `docs`: Documentation updates
  - `chore`: Maintenance, dependencies, configs
  - `test`: Adding or modifying tests
  - `refactor`: Code refactoring without functional changes
  - `style`: Cosmetic changes that alter no runtime behaviour — `cargo fmt` wraps, CSS adjustments, copy edits. In established use (`130c7556`, `c3b7c72b`, `ad9c60e9`, `e0f2ca9b`, `04465711`, `2d517b55`, `7dde51c2`, `cfd0f183`); added to this list so the documented set matches practice and the `commit-msg` gate does not reject it.
  - `perf`: Performance improvements
  - `ci`: CI workflows, GitHub Actions, build scripts
  - `audit`: Code audit stamps and remediations
- **`<area>`**: Domain, crate, or component (e.g. `sales`, `admin`, `website`, `ci`, `core`, `desktop-client`, `ui`, `licensing`, `agents`).
- **`<description>`**: Imperative, concise summary of the change (e.g. `add gift card tender`, `resolve modal overflow`).

> **This is now actually enforced** by `.githooks/commit-msg`, which rejects a
> non-conforming subject and prints the allowed list. Subject line only — bodies
> stay free-form. Git-generated messages (`Merge …`, `Revert …`, `fixup!`,
> `squash!`) and an empty subject pass through, so normal git workflows still
> work. Like every other hook here it needs `core.hooksPath`, so a fresh clone
> that skips `scripts/setup-dev.ps1` is not gated.

### 3. Commit Cadence & Push Rule
- **Always make a local commit after each major modification.** Whenever a logical task or feature step is completed and verified locally, commit it before moving on to the next task.
- **Never run `git push` without an explicit, direct order from the user.** Even after committing code or completing verification, always wait for the user to explicitly instruct you to push before executing any `git push` command.
- Never commit secrets, `.env` files, or SQLite database files (`*.db`, `*.sqlite`).
- **⚠️ Multiple agents commit to this branch concurrently. Always commit with an explicit pathspec, never bare `git commit` or `git commit -a`.** A whole-tree commit consumes whatever *another* agent has staged and files it under your message; their 90-line rationale is then discarded while their 10 files silently join your commit. This happened at `3b10ea3a`, whose subject describes a pricing-card tweak and whose diff includes the restoration of the entire release pipeline. The victim's `git commit` returns `nothing to commit, working tree clean` — a success-looking message that actually means "someone else took your index".
  ```bash
  git commit -m "..." -- path/one path/two    # only your files, always
  git status --porcelain                      # after committing: confirm leftovers are theirs
  ```
  If `git commit` reports nothing to commit right after you staged, **do not conclude your work was lost** — check `git show --stat HEAD` first; your files may already be in someone else's commit, in which case record your rationale in the relevant doc (see R36-13). Review a commit by its **file list**, not its subject line: the offender's commit looks entirely normal at a glance.
- **⚠️ `git commit --amend` needs an explicit pathspec too, and verifying the index first is NOT sufficient.** `--amend` commits the whole index, so it inherits every file another agent has staged since your last look. This was hit while *following* the rule above: `git diff --cached --name-only` printed only my file, and four seconds later `git commit --amend -m ...` produced a 5-file commit containing someone else's `.circleci/config.yml`, `scripts/compose-circleci.py`, and two generated workflow files. The check was true when it ran and false by the time it mattered — with a concurrent agent the index is a racing value, so a pre-commit inspection of it proves nothing. Recovery is `git reset --mixed HEAD~1` (moves the commit, leaves the working tree and everyone's staging alone), then re-commit **with** a pathspec. Prefer not amending on a shared branch at all: a pathspec-limited commit is immune to the race, an amend is not.
- **⚠️ Never `git stash` to work around a dirty file another agent may own.** Stashing removes their uncommitted work from the working tree for the duration; if they write to that file while it is stashed, the `pop` conflicts or silently discards their edit. That is the same loss as a swept commit but with *no trace in any message*, so nothing later reveals it. To find out whether a failure is committed or only in flight, compare the versions directly instead — `git show HEAD:<path>` versus the file on disk — or check a `git worktree add` of HEAD, neither of which touches their tree. If you have already stashed, verify the round-trip before moving on: byte size, a content count, and an empty `git stash list`.
