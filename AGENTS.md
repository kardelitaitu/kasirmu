# Agents Configuration & Rules

<!-- Audit stamp: 2026-09-08 · DSH · status: ACCURATE (rev 2 · the retired-workflow enumeration was incomplete: it named 8 `.bak` files plus a `docker-*.yml.bak` glob covering 2, but the directory holds 11. The missing one is `release.yml.bak`, which is not ordinary dead weight - it is the retired copy of the LIVE release pipeline, left behind when `release.yml` was restored from history by `3b10ea3a2` on 09-04 instead of by renaming the `.bak` back. Both tracked, 512 vs 470 lines. Everything else re-confirmed against the files themselves, not against another doc: two live workflows (dev-ci.yml, release.yml), dev-ci triggers pull_request + workflow_dispatch and no push trigger, ten jobs, 28 named steps in static-gates (down from 29 earlier this week because `0938af645` removed a gate that claimed a step which did not exist - a correct fix that quietly rotted any count quoted elsewhere). · `verify-agents-mirrors.py` passes but could not have caught this: it compares gate counts, commit types, versions and workflow jobs, not the membership of a parenthetical list. An enumeration inside prose is unenforced by construction. -->

## 🚨 Critical Agent Directives (MUST FOLLOW)

| Rule | Direct Instruction | Why / Context |
|---|---|---|
| **Branching** | **NEVER create new branches. NEVER switch branches.** | Always work directly on the currently active branch unless specifically requested by the user. |
| **Commits** | **ALWAYS commit with format `<type>(<area>): <description>`.** | Must follow conventional commits. Make local commits after each logical task — the permitted *form* of the commit is the **Commit Writing** row below. |
| **Commit Writing** | **NEVER `git add` — with the sole exception of the §3 one-line new-file chain —, NEVER `git stage`, NEVER `git commit -a`, NEVER `git commit --amend`, NEVER `git stash`. The only permitted commit form is ONE line with an explicit pathspec: `git commit -m "<type>(<area>): <subject>" -- path/one path/two`.** | A pathspec commit takes those files from the working tree and, for already-tracked paths, needs no prior `add` — a *new* file cannot enter a commit in that form, and the §3 new-file chain is the only sanctioned exception. Nor can a pathspec commit collect anything another session staged. In a checkout where several agents commit concurrently the index is a single shared object, so anything left staged is a hazard for someone else even when it is harmless for you. Git & Commit Policy §3 carries the incidents and the detail. |
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
git config core.hooksPath .githooks   # enable pre-commit hook (EOL + bundle-parity + FTL dedupe + column types + PG drift + Go + ftl orphans)
```

The `.githooks/pre-commit` hook runs **seven steps** automatically before every commit, in this order (< 1s total on a typical commit; each step is *triggered* only when the paths it cares about are in the commit):
1. **Line-ending normalization** — strips CR from staged *text* files in both the working tree and the index, then re-stages them, so the committed blob is LF and `git status` is clean immediately after commit. Backs `.gitattributes` (`* text=auto eol=lf`); a no-op when already LF. **Two exclusions are load-bearing and were both missing until 0.0.36 (R36-15):** files whose effective `eol` is `crlf` (`*.bat`, `*.cmd`) are skipped — the index stores LF but the *working tree* must stay CRLF, because cmd.exe mis-parses labels/`goto` otherwise; and a `grep -qI` content check skips real binaries, because `* text=auto` makes `check-attr text` answer "auto" for **every** path, PNG included, and stripping CR from a PNG deletes the `0D 0A` its signature requires (measured: `apps/desktop-client/icons/32x32.png` 1515 → 1507 bytes, signature destroyed, mangled blob re-staged). `scripts/test-eol-guard.sh` extracts the live guard from the hook and asserts both exclusions.
2. **`Bundle parity: staged files only`** — runs `scripts/verify-bundle-parity.py --staged-only --include-getstring --include-nav-keys --include-key-fields --include-dynamic-literals --include-id-maps --check-domain-pairs` over staged files in `features`, `components`, `frontend`, `contexts`, `hooks` and `platform`; fails if any of the **eight checked surfaces** references a key missing from `.ftl` or `.id.ftl`. Before the Fluent page audit this walked only literal `<Localized id>` under `ui/src/features/**`, and skipped every shared-chrome and context file it was handed — so 14 broken keys shipped while it reported clean.
3. **`FTL dedupe dry-run`** — runs `scripts/dedupe-ftl.py --dry-run` when `.ftl` files are staged to detect duplicate Fluent keys before push.
4. **`Migration column-type lint`** — runs `scripts/verify-migration-column-types.py --staged-only` when `crates/oz-core/migrations/*.sql` is staged; exact-decimal columns must be fixed-point integers (`*_minor`/`*_millionths`), new floats need a justified whitelist entry.
5. **`PG schema drift guard`** — runs `scripts/generate-pg-migration.py --check` when any migration, the registry, or the generator is staged; `20260813_init.pg.sql` is generated, never hand-edited (see [`docs/records/sqlite-pg-roles.md`](./docs/records/sqlite-pg-roles.md)).
6. **`Go gate`** — when the commit stages `apps/license-server/*.go`: `gofmt -w` (auto-fix + re-stage) then `go vet ./...` (hard fail). **Aborts the commit if `go`/`gofmt` are not on PATH** — unlike the optional gates, this one has no skip path.
7. **`FTL orphan lint`** — when the commit stages a `.ftl` file: `scripts/verify-ftl-orphans.py --staged-only`, hard fail. The mirror of step 2, which only asks whether code names a key no bundle defines. Nothing ever asked whether a key has any code that reads it, and the debt is real: `topology-shortcuts-*` (18 keys whose feature was removed, per `popoverSurfaceCompliance.test.tsx:54`) and ~23 `warehouse-*` keys with zero references anywhere. **Staged-scoped deliberately** — a whole-tree blocker is unusable because dynamic composition (`analytics-month-${m}`) makes an entire family live from one template hit, leaving 93 honest candidates of which an unknown fraction are detection gaps rather than debt. So it holds a commit to two things a commit can answer: a key you *add* must be referenced, and a reference you *delete* must not strand a key. `--census` reports the tree picture informationally (in CI, non-blocking); `--self-test` exercises all four parser directions and blocks in CI, because a gate whose diff-parsers silently break checks nothing.

> 🚫 **`cargo fmt` is no longer a pre-commit step (removed 2026-09-13).** The old step ran `cargo fmt --all` — the *whole workspace* — whenever any `.rs` file was staged, which under concurrent agents reformatted every other session's in-flight `.rs` files **in the working tree**, files that were edited but not committed; whoever owned them next committed formatting they did not choose. Rust formatting is still enforced, but check-only and outside the commit path: `cargo fmt --all -- --check` runs in pre-push (`scripts/run-pre-push.py`), CI (`dev-ci.yml#cargo-check`), `scripts/check.sh`, and `scripts/release.sh`. Run `cargo fmt --all` yourself before pushing; a commit no longer fixes or rejects formatting.

> ✅ **All seven steps now have a CI backstop.** Heavy UI typechecking (`npm run typecheck`) and Vitest i18n (`scripts/lint-i18n.sh`) are offloaded from per-commit to `pre-push` (which runs them in parallel via `scripts/run-pre-push.py`) and CI (`dev-ci.yml#ui-test` and `dev-ci.yml#i18n`), keeping atomic pre-commit fast (<1s) for multi-agent workflows. Steps 4 and 5 (`verify-migration-column-types.py`, `generate-pg-migration.py --check`) lived in `ci.yml`, were retired to `.bak` by `23c96330`, and were restored into `dev-ci.yml#static-gates` in **0.0.37** — until then the opt-in hook was their only guard, and they had **no `gates.json` record at all**, so the drift checker could not even report them as unenforced. CI runs the column-type check without `--staged-only`, so it scans every migration file in the checkout rather than only the ones a commit happened to touch — 44 today, and the checker prints its own count ("44 files scanned") because the number moves with every migration. Note it globs the working tree, so a migration staged by another session is counted locally before it exists in CI. Both are pure text comparison (~1.1s together): no Docker, no psycopg, no sqlite handle — there was never a build-cost reason to leave them out. Step 6 (Go) has been CI-backed since 0.0.36: `dev-ci.yml#static-gates` runs `gofmt -l`, `go vet` and `go test -short` on `apps/license-server`. The hook's comments used to cite `.github/workflows/ci.yml` in four places (the bundle-parity, migration-column-types, pg-schema-drift and Go steps) — that workflow is retired (`.bak`), so the coverage was real but every pointer was wrong. **All four now name `dev-ci.yml`, and `verify-ci-docs-drift.py` polices it:** any `.github/workflows/<name>.yml` mentioned in the hook must be a live workflow file, so a future retirement that leaves the prose behind fails the gate instead of quietly inverting the claim. Note the CI gate is `gofmt -l` (report-only, fails on any unformatted file) while the hook runs `gofmt -w` and re-stages, so a commit made without `core.hooksPath` can be unformatted and CI will reject it rather than fix it. Step 7's backstop is `dev-ci.yml#i18n`, which cannot reproduce the staged check (CI has no index to compare against) so it runs `--self-test` blocking and `--census` informational instead — meaning **the orphan gate's enforcement is local-only at commit time.**

> **What CI actually runs.** Two workflows are live. `.github/workflows/dev-ci.yml` ("Dev CI") runs on `pull_request` targeting `main` plus `workflow_dispatch` — **there is no `push` trigger**, so pushing a branch runs nothing and a PR is required to validate. Its jobs are `changes` (the path router), `website`, `cargo-check`, `cargo-nextest`, `ui-test`, `i18n`, `ci-docs-drift`, `static-gates`, `release-readiness`, and `northflank-deploy`. `.github/workflows/release.yml` ("Release") runs on `v*` tags and was **restored desktop-only in 0.0.36** after `23c96330` renamed it to `.bak` with no replacement (R36-11): it builds the three Tauri desktop installers, signs the updater manifests, attests provenance, and publishes the GitHub Release. Every other file in that directory is `.bak` and GitHub never executes it (`ci.yml.bak`, `nightly.yml.bak`, `e2e-pr.yml.bak`, `security.yml.bak`, `android.yml.bak`, `ios.yml.bak`, `deploy.yml.bak`, `website.yml.bak`, `docker-*.yml.bak`, and `release.yml.bak`). That last one differs from the rest and was missing here until 08-09-26: it is the retired copy of the **live** release pipeline, left behind when `release.yml` was restored from history by `3b10ea3a2` on 09-04 instead of by renaming the `.bak` back. Both are tracked and they differ by 42 lines (512 vs 470), so a `grep release.yml` in that directory hits two files - inert to GitHub, which reads only `*.yml`, but not inert to a reader deciding which release workflow it is looking at. See [`docs/operations/ci-pipeline.md`](./docs/operations/ci-pipeline.md).
>
> `release.yml` covers **desktop only**. Mobile (`android.yml`, `ios.yml`) and release-time container images are still retired, and the build/sign/publish path cannot be verified without a real tag push — `dev-ci.yml#release-readiness` verifies the updater signing chain instead, and `scripts/verify-release-workflow.py` (in `static-gates`, with `--self-test`) validates the workflow statically. `northflank-deploy` `needs` **seven** of `dev-ci.yml`'s ten jobs — `changes, website, cargo-check, cargo-nextest, ui-test, i18n, static-gates` — so it excludes **two**, not one: `ci-docs-drift`, deliberately, because it is advisory and gating a deploy on a known-red count trains people to ignore the gate (the workflow comment at `dev-ci.yml:643` says so), and **`release-readiness`, which no comment accounts for**. This sentence previously claimed it `needs` every job except `ci-docs-drift`, which made the deploy look gated on the updater signing chain when it is not: `release-readiness` can fail and `northflank-deploy` still runs. Whether that is intentional (a backend container deploy arguably does not depend on desktop-artifact signing) is an open question for whoever owns the deploy — recorded in `docs/plans/0.0.36-backlog.md` rather than silently accepted, because the safe reading and the dangerous reading differ by exactly one job name. So **E2E, a11y, security and nightly suites are NOT enforced in CI** — a green Dev CI run is not proof those passed. `scripts/check.sh` is the local full-matrix equivalent; run it before declaring a change verified. Note that CI's `cargo nextest run --workspace --all-features` carries **no `--exclude`**, so CI tests the app crates that `check.sh` skips.
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

> 🛑 **`bash <script>` hangs on this platform — use Git's bash by full path.** Every
> `bash scripts/foo.sh` <!-- dead-ref: ok: a generic example filename, not this repo's script --> in this file and in the `tdd` skill resolves to
> `C:\Windows\System32\bash.exe`, which is **WSL**, not Git Bash. Where WSL is installed but its
> distro is not running (or the sandbox blocks the VM's named pipes), the process never returns —
> it does not fail, it **hangs until an external timeout kills it**. Measured directly:
> `c:\windows\system32\bash.exe -c 'echo wsl-ok'` never returned in 12s, while
> `C:\Program Files\Git\bin\bash.exe -c 'echo gitbash-ok'` returned instantly.
>
> ```powershell
> & 'C:\Program Files\Git\bin\bash.exe' -c 'bash scripts/wtree-guard.sh check'
> ```
>
> **The failure mode is the dangerous part.** A hang looks like a broken script, so the natural
> conclusion is "this tool is faulty" — which is false; `wtree-guard.sh` and
> `verify-scoped-coverage.sh` both run correctly under Git bash in under a second. Two 10-minute
> timeouts were spent this way before the shell was suspected. If a `bash` invocation times out
> with no output at all, suspect shell resolution before suspecting the script, and confirm by
> running the same command through the explicit path.
>
> **This has now cost two agents in two different ways.** The earlier form is recorded in
> [`docs/records/JOURNAL.md`](./docs/records/JOURNAL.md) under *2026-08-22 — i18n-lint "env issue"
> resolved (was never a repo bug)*: under WSL, `npx vitest` runs the **Linux** node against the
> Windows-built `ui/node_modules`, whose rollup binary is `rollup-win32-x64-*`, so vitest crashes
> with `MODULE_NOT_FOUND` and the pre-commit i18n gate **appears** to fail. Git's own bash runs the
> Windows node and passes cleanly. So WSL produces two opposite-looking symptoms — a silent hang,
> or a red gate that is not the repo's fault. **That entry sat in a 10,000-line journal and did not
> prevent the recurrence, which is why this one is here instead.**

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
- **`init.pg.sql` is generated, never hand-edited:** after any migration change run `python3 scripts/generate-pg-migration.py` and re-stage `crates/oz-core/migrations/20260813_init.pg.sql`. Pre-commit step 5 fails on drift, and since **0.0.37** so does CI: `dev-ci.yml#static-gates` runs `generate-pg-migration.py --check`. (For two releases the job sat nowhere — it was retired with `ci.yml` in `23c96330` and never restored, and it had no `gates.json` record either, so the drift checker could not report a gate it never saw. On a clone without `core.hooksPath`, a hand-edited generated file committed and merged clean.)
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
- **⚠️ Multiple agents commit to this branch concurrently. The ONLY permitted commit form is ONE line with an explicit pathspec — `git commit -m "<type>(<area>): <subject>" -- path/one path/two`.** Never bare `git commit`, never `git commit -a`, and never `git add` or `git stage` as a separate step first. A pathspec commit takes those paths from the *working tree* and — for already-tracked paths — needs no prior `add`; a new file cannot be introduced in that form, and the chain below is the only sanctioned exception. Nor can it collect anything another session staged. A whole-tree commit does the opposite: it consumes whatever *another* agent has staged and files it under your message; their 90-line rationale is then discarded while their 10 files silently join your commit. This happened at `3b10ea3a`, whose subject describes a pricing-card tweak and whose diff includes the restoration of the entire release pipeline. The victim's `git commit` returns `nothing to commit, working tree clean` — a success-looking message that actually means "someone else took your index".
  ```bash
  git commit -m "<type>(<area>): <subject>" -- path/one path/two   # one line, no prior add, only your files
  git show --stat                                                   # prove the file list is exactly yours
  git status --porcelain                                            # after committing: confirm leftovers are theirs
  ```
  If `git commit` reports nothing to commit when you expected it to, **do not conclude your work was lost** — check `git show --stat HEAD` first; your files may already be in someone else's commit, in which case record your rationale in the relevant doc (see R36-13). Review a commit by its **file list**, not its subject line: the offender's commit looks entirely normal at a glance.
- **⚠️ New files are the one case the no-staging rule needs its own form.** `git commit -m "..." -- new/file` fails with *"pathspec 'new/file' did not match any file(s) known to git"*, and `git commit --include -- new/file` fails the same way — both proved live here on 2026-09-13; do not re-derive them. The sanctioned exception is ONE shell line in which the `add` names exactly the new paths and is consumed at once by a pathspec commit:
  ```bash
  git add -- new/one new/two && git commit -m "<type>(<area>): <subject>" -- new/one new/two
  ```
  Chain rules: the `add` lists **only untracked new paths** (a `git add` of a *tracked* file with pending edits is precisely the forbidden staging); the commit pathspec is a superset of the add list; and it is one `&&` line, so the staged window is the milliseconds inside a single invocation rather than the minutes a separately-typed `add` leaves open. If the commit half fails — most often `index.lock` held by a concurrent agent, which happened twice on 2026-09-13 — **re-run the whole line, never the commit alone**: committing without its add fails loudly, and a retry that stages without committing leaves new content as live ammunition for the next agent. Verify with `git show --stat` that the `create mode` entries are exactly your files.
- **⚠️ In a shared checkout the index is a single shared object: never leave anything staged, even your own.** `git add` is not a harmless preparatory step here — the one sanctioned exception is the same-line new-file chain above. Whatever is staged when someone else commits is what *they* commit — a staged set that is harmless for you is live ammunition for the next agent — which is why the form above has no staging step of its own. Inspect the paths you are about to name, immediately before naming them: `git --no-optional-locks status --porcelain -- path/one path/two`. A pathspec commit records the *working-tree* copy of those paths, so if another session has its own uncommitted edits in the same file, your commit sweeps them in under your subject; if a path you want is dirty with content that is not yours, stop and say so rather than committing it. A docs-only commit is not exempt from this — it is the same mechanism on smaller files. None of this is mechanically enforceable: a pre-commit hook never sees the commit's command line, so it cannot tell a pathspec commit from a bare one — §3 is prose law, and the only backstop is the discipline itself.
- **⚠️ Never `git commit --amend` on a shared branch — not even with a pathspec, and not even after inspecting the index.** An amend re-commits the whole index, so it inherits whatever another agent staged in the seconds since you last looked. This bullet previously taught the opposite ("an amend needs an explicit pathspec too") and that is the same hazard wearing a pathspec: the incident it cited happened while *following* that advice — `git diff --cached --name-only` printed only my file, and four seconds later `git commit --amend -m ...` produced a 5-file commit containing someone else's `.circleci/config.yml`, `scripts/compose-circleci.py`, and two generated workflow files. The check was true when it ran and false by the time it mattered, because with concurrent agents the index is a racing value, so inspecting it before an amend proves nothing.
  **The recovery for a bad commit is a NEW commit that undoes it — not an amend, not a reset.** `git revert` with a pathspec where possible; when the undo needs to be staged first, the commit that records it is still one pathspec line (`git revert --no-commit <sha>`, then `git commit -m "fix(<area>): undo <sha>" -- path/one path/two`), and if the bad commit swept in another agent's files, undo only yours and tell them what landed where. A revert is additive: the original commit and its subject stay visible for the person who wrote them, and no branch tip moves under anyone. The `git reset --mixed HEAD~1` this bullet used to offer as the recovery is withdrawn for the same reason — it relocates a tip that other agents are committing to at the same moment.
- **⚠️ Never `git stash` to work around a dirty file another agent may own.** Stashing removes their uncommitted work from the working tree for the duration; if they write to that file while it is stashed, the `pop` conflicts or silently discards their edit. That is the same loss as a swept commit but with *no trace in any message*, so nothing later reveals it. To find out whether a failure is committed or only in flight, compare the versions directly instead — `git show HEAD:<path>` versus the file on disk — or check a `git worktree add` of HEAD, neither of which touches their tree. If you have already stashed, verify the round-trip before moving on: byte size, a content count, and an empty `git stash list`.
- **⚠️ Not every ` M` is content.** Under `text=auto` + `core.autocrlf=true` a file can show as modified while its working-tree bytes are identical to the HEAD blob — an EOL/stat artifact. Before "committing" it, compare `git hash-object <path>` with `git rev-parse :<path>`; if the hashes match there is nothing to commit, and the entry clears on its own or via `git update-index --refresh`. Four phantom entries cost one full review pass on 2026-09-13.

<!-- Amendment: 2026-09-13 · DSH · Commit Writing row added to the table above · amend-with-pathspec withdrawn from §3 · reason: this rule hardened because agents in this session were briefing workers with the word "staging", which is the one step the pathspec form exists to make unnecessary, and the hazard was observed live rather than reconstructed - at 07:0x one unrelated path sat in this checkout's index with content differing from HEAD, and it had cleared again within minutes, which is exactly the racing, transient, shared state the rule has to assume rather than a standing condition anybody could check for. The documentation was part of the problem: §3 previously sanctioned `git commit --amend` provided a pathspec was added and the index had just been inspected, and that is the same hazard wearing a pathspec, because an amend re-commits the whole index and inherits whatever another agent staged in the seconds since you last looked. The recovery offered there (`git reset --mixed HEAD~1`) is replaced by a new commit that undoes the bad one. · scope: prose only - no count in the 2026-09-08 audit stamp above is touched, and `verify-agents-mirrors.py` compares gate counts, commit types, versions and workflow jobs, never this sentence, so a bullet that contradicts its neighbour stays unenforced by construction. · REV 2 (2026-09-13, same day): the row's unqualified "needs no prior `add`" proved false for *untracked* paths — both the bare pathspec form and `git commit --include` reject them with "did not match any file(s) known to git", which made every new-file commit in this repo a silent rule-break — so §3 now names the one-call new-file chain, records the stat-noise no-op (` M` with an identical blob), and states that no hook can tell a bare commit from a pathspec one. -->

> last audited 08-09-26 by docs-auditor
