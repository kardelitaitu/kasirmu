# Agents Configuration & Rules

<!-- Audit stamp: 2026-09-04 · DSH · status: ACCURATE · version lock: 0.0.37 · 10 pre-commit gates · conventional commits enforced -->

## 🚨 Critical Agent Directives (MUST FOLLOW)

| Rule | Direct Instruction | Why / Context |
|---|---|---|
| **Branching** | **NEVER create new branches. NEVER switch branches.** | Always work directly on the currently active branch unless specifically requested by the user. |
| **Commits** | **ALWAYS commit with format `<type>(<area>): <description>`.** | Must follow conventional commits. Make local commits after each logical task — the permitted *form* of the commit is the **Commit Writing** row below. |
| **Commit Writing** | **NEVER `git add`, NEVER `git stage`, NEVER `git commit -a`, NEVER `git commit --amend`, NEVER `git stash`. The only permitted commit form is ONE line with an explicit pathspec: `git commit -m "<type>(<area>): <subject>" -- path/one path/two`.** | A pathspec commit takes those files from the working tree, needs no prior `add`, and cannot collect anything another session staged. In a checkout where several agents commit concurrently the index is a single shared object, so anything left staged is a hazard for someone else even when it is harmless for you. Git & Commit Policy §3 carries the incidents and the detail. |
| **Pushing** | **NEVER run `git push` without an explicit direct order.** | Even after completing all checks, wait for the user to explicitly say "push". |
| **Version Lock** | **Version is locked at `0.0.37`. NEVER modify version numbers.** | Do not bump version in `Cargo.toml`, `package.json`, `tauri.conf.json`, etc. |
| **File Paths** | **ALWAYS use forward slashes (`/`) in path arguments on Windows.** | Avoid path escaping bugs (e.g., use `C:/My Script/oz-pos/`). |
| **File Reading** | **ALWAYS read files in small chunks (≤ 500 lines).** | Preserves context window and prevents output truncation. |
| **Discovery** | **ALWAYS use `codebase-memory-mcp` first for code exploration.** | Graph discovery saves context tokens and surfaces call chains faster. |
| **Currency** | **ALWAYS use `Money` struct (`i64` minor units). NEVER use float.** | Monetary values must never use `f32`/`f64`. |
| **DB Writes** | **ALWAYS use `rusqlite` transactions for database writes.** | Never write to SQLite outside an explicit transaction. |

---

## 🛠️ Quick Setup & Pre-Commit Gates

```bash
git config core.hooksPath .githooks   # enable pre-commit hook (fmt + EOL + bundle-parity + FTL dedupe + column types + PG drift + Go + ftl orphans)
```

The `.githooks/pre-commit` hook runs **eight steps** automatically before every commit, in this order (< 1s total on a typical commit; each step is *triggered* only when the paths it cares about are in the commit — note that step 1 is a trigger-scope and not a work-scope, see below):
1. **`cargo fmt`** — auto-formats Rust and re-stages what it changed; **triggered** only when `.rs` files are staged, so a docs or UI commit skips it entirely. The invocation itself is not path-scoped: `.githooks/pre-commit:47` gates on `git diff --cached --name-only -- '*.rs'` and `:49` runs `cargo fmt --all`, the whole workspace, while only the re-stage at `:65` is limited back to the previously-staged `.rs` set. Under concurrent agents that difference matters — committing one `.rs` file reformats every other session's in-flight `.rs` **in the working tree**, files that are edited but not committed, so whoever owns them next commits formatting they did not choose.
2. **Line-ending normalization** — strips CR from staged text files in the working tree and index, re-staging them so the committed blob is LF (backs `.gitattributes` `* text=auto eol=lf`). Skips files whose effective `eol` is `crlf` (`*.bat`/`*.cmd` — the working tree must stay CRLF for cmd.exe) and real binaries (`grep -qI`; `text=auto` reports "auto" for PNGs too, and stripping their CRs destroys the signature). Both exclusions were missing until 0.0.36; `scripts/test-eol-guard.sh` guards them.
3. **`Bundle parity: staged files only`** — `scripts/verify-bundle-parity.py --staged-only` with `--include-getstring --include-nav-keys --include-key-fields --include-dynamic-literals --include-id-maps --check-domain-pairs`, over staged files in `features`, `components`, `frontend`, `contexts`, `hooks` and `platform`. Fails if any of the **eight checked surfaces** references a key missing from `.ftl`/`.id.ftl`.
4. **`FTL dedupe dry-run`** — `scripts/dedupe-ftl.py --dry-run` when `.ftl` files are staged.
5. **`Migration column-type lint`** — `scripts/verify-migration-column-types.py --staged-only`, when `crates/oz-core/migrations/*.sql` is staged.
6. **`PG schema drift guard`** — `scripts/generate-pg-migration.py --check`; `20260813_init.pg.sql` is generated, **never hand-edited**.
7. **`Go gate`** — when `apps/license-server/*.go` is staged: `gofmt -w` + `go vet ./...`. Aborts if `go`/`gofmt` are missing.
8. **`FTL orphan lint`** — `scripts/verify-ftl-orphans.py --staged-only` when the commit stages a `.ftl` file. Mirror of step 3: that asks whether code names a key no bundle defines, this asks whether a key has any code reading it. Nothing checked the second direction, and the debt is real (`topology-shortcuts-*`, 18 keys whose feature was removed; ~23 `warehouse-*` keys with zero references anywhere). Staged-scoped because dynamic composition leaves 93 honest whole-tree candidates; `--census` reports them, `--self-test` proves the check can fail.

> ✅ **All eight steps now have a CI backstop.** Heavy UI typechecking (`npm run typecheck`) and Vitest i18n (`scripts/lint-i18n.sh`) are offloaded from per-commit to `pre-push` (which runs them in parallel via `scripts/run-pre-push.py`) and CI (`dev-ci.yml#ui-test` and `dev-ci.yml#i18n`), keeping atomic pre-commit fast (<1s) for multi-agent workflows. Steps 5 and 6 (`verify-migration-column-types.py`, `generate-pg-migration.py --check`) lived in `ci.yml`, were retired to `.bak` (`23c96330`), and were restored into `dev-ci.yml#static-gates` in **0.0.37** — until then the opt-in hook was their only guard, and they had no `gates.json` record either, so the drift checker could not even report them as unenforced. CI runs the column-type check without `--staged-only`, so it scans every migration file in the checkout, not just the ones a commit touched — 44 today; the checker prints its own count because the number moves with every migration. Both are pure text comparison (~1.1s together): no Docker, no psycopg, no sqlite handle. Step 7 (Go) has been CI-backed since 0.0.36 (`13f2a1dc`): `dev-ci.yml#static-gates` runs `gofmt -l`, `go vet ./...` and `go test -short` on `apps/license-server`. Note the CI gate is `gofmt -l` (report-only, fails on any unformatted file) while the hook runs `gofmt -w` and re-stages, so a commit made without `core.hooksPath` can be unformatted and CI will reject it rather than fix it. On a clone without `core.hooksPath` set, none of the eight run at commit time — but CI now catches all of them.
>
> **What CI actually runs.** Two workflows are live: `dev-ci.yml` (PR to `main` + `workflow_dispatch`) and `release.yml` (`v*` tags, restored desktop-only in 0.0.36). `dev-ci.yml` jobs: `changes`, `website`, `cargo-check` (fmt → check → clippy), `cargo-nextest`, `ui-test` (typecheck → lint → vitest → tz-invariance), `i18n`, `ci-docs-drift`, `static-gates`, `release-readiness`, `northflank-deploy`. CI's `cargo nextest run --workspace --all-features` carries **no `--exclude`**, so it tests app crates that `check.sh` skips. E2E, a11y, security and nightly are **not** enforced — a green Dev CI run is not proof those passed.


> **Keeping this list honest:** `scripts/bump-version.ps1` updates the *version* lines in these mirrors but never did anything about the *gate* list — which is how all three drifted to different counts, and twice into claims the repo contradicts. `scripts/verify-agents-mirrors.py` now closes that: it reads the gate count from `.githooks/pre-commit`, the CI coverage from `.github/workflows/*.yml`, the accepted commit types from `.githooks/commit-msg` and the version from `Cargo.toml`, then fails if any mirror disagrees. It runs in `check.sh` and in `dev-ci.yml#ci-docs-drift`, so a stale mirror is a red build rather than a silent wrong belief. The hook is still the source of truth: `grep -n '^# ──' .githooks/pre-commit`.

> For full repository verification mirroring the entire CI matrix, see [`scripts/check.sh`](../scripts/check.sh).

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
- **Accessibility:** All React components must have ARIA labels and pass `eslint-plugin-jsx-a11y` checks.
- **Localization:** All user-visible strings must use `@fluent/react`. No hardcoded English strings in JSX.

### 4. Database & Hardware
- **HAL Drivers:** Hardware drivers must have a mock implementation in `crates/oz-hal/src/drivers/mock.rs`.
- **SQLite is the schema source of truth:** `crates/oz-core/migrations/*.sql` + the registry in `migrations.rs` (registry order is canonical). See [`docs/records/sqlite-pg-roles.md`](../docs/records/sqlite-pg-roles.md).
- **`init.pg.sql` is generated, never hand-edited:** after any migration change run `python3 scripts/generate-pg-migration.py` and re-stage `crates/oz-core/migrations/20260813_init.pg.sql`. Pre-commit step 7 fails on drift, and since **0.0.37** so does CI (`dev-ci.yml#static-gates` → `generate-pg-migration.py --check`). Between `23c96330` retiring `ci.yml` and 0.0.37 the local hook really was the only guard — and because the gate had no `gates.json` record, the drift checker could not report a gate it never saw.
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
  - `style`: Cosmetic changes that alter no runtime behaviour — `cargo fmt` wraps, CSS adjustments, copy edits. In established use (`130c7556`, `c3b7c72b`, `ad9c60e9`, `e0f2ca9b`, `04465711`, `2d517b55`, `7dde51c2`, `cfd0f183`); listed here so this mirror matches the set `.githooks/commit-msg` actually accepts.
  - `perf`: Performance improvements
  - `ci`: CI workflows, GitHub Actions, build scripts
  - `audit`: Code audit stamps and remediations
- **`<area>`**: Domain, crate, or component (e.g. `sales`, `admin`, `website`, `ci`, `core`, `desktop-client`, `ui`, `licensing`, `agents`).
- **`<description>`**: Imperative, concise summary of the change (e.g. `add gift card tender`, `resolve modal overflow`).

### 3. Commit Cadence & Push Rule
- **Always make a local commit after each major modification.** Whenever a logical task or feature step is completed and verified locally, commit it before moving on to the next task.
- **Never run `git push` without an explicit, direct order from the user.** Even after committing code or completing verification, always wait for the user to explicitly instruct you to push before executing any `git push` command.
- Never commit secrets, `.env` files, or SQLite database files (`*.db`, `*.sqlite`).
- **⚠️ Multiple agents commit to this branch concurrently. The ONLY permitted commit form is ONE line with an explicit pathspec — `git commit -m "<type>(<area>): <subject>" -- path/one path/two`.** Never bare `git commit`, never `git commit -a`, and never `git add` or `git stage` as a separate step first. A pathspec commit takes those paths from the *working tree*, needs no prior `add`, and cannot collect anything another session staged. A whole-tree commit does the opposite: it consumes whatever *another* agent has staged and files it under your message; their 90-line rationale is then discarded while their 10 files silently join your commit. This happened at `3b10ea3a`, whose subject describes a pricing-card tweak and whose diff includes the restoration of the entire release pipeline. The victim's `git commit` returns `nothing to commit, working tree clean` — a success-looking message that actually means "someone else took your index".
  ```bash
  git commit -m "<type>(<area>): <subject>" -- path/one path/two   # one line, no prior add, only your files
  git show --stat                                                   # prove the file list is exactly yours
  git status --porcelain                                            # after committing: confirm leftovers are theirs
  ```
  If `git commit` reports nothing to commit when you expected it to, **do not conclude your work was lost** — check `git show --stat HEAD` first; your files may already be in someone else's commit, in which case record your rationale in the relevant doc (see R36-13). Review a commit by its **file list**, not its subject line: the offender's commit looks entirely normal at a glance.
- **⚠️ In a shared checkout the index is a single shared object: never leave anything staged, even your own.** `git add` is not a harmless preparatory step here. Whatever is staged when someone else commits is what *they* commit — a staged set that is harmless for you is live ammunition for the next agent — which is why the form above has no staging step at all. Inspect the paths you are about to name, immediately before naming them: `git --no-optional-locks status --porcelain -- path/one path/two`. A pathspec commit records the *working-tree* copy of those paths, so if another session has its own uncommitted edits in the same file, your commit sweeps them in under your subject; if a path you want is dirty with content that is not yours, stop and say so rather than committing it. A docs-only commit is not exempt from this — it is the same mechanism on smaller files.
- **⚠️ Never `git commit --amend` on a shared branch — not even with a pathspec, and not even after inspecting the index.** An amend re-commits the whole index, so it inherits whatever another agent staged in the seconds since you last looked. This bullet previously taught the opposite ("an amend needs an explicit pathspec too") and that is the same hazard wearing a pathspec: the incident it cited happened while *following* that advice — `git diff --cached --name-only` printed only my file, and four seconds later `git commit --amend -m ...` produced a 5-file commit containing someone else's `.circleci/config.yml`, `scripts/compose-circleci.py`, and two generated workflow files. The check was true when it ran and false by the time it mattered, because with concurrent agents the index is a racing value, so inspecting it before an amend proves nothing.
  **The recovery for a bad commit is a NEW commit that undoes it — not an amend, not a reset.** `git revert` with a pathspec where possible; when the undo needs to be staged first, the commit that records it is still one pathspec line (`git revert --no-commit <sha>`, then `git commit -m "fix(<area>): undo <sha>" -- path/one path/two`), and if the bad commit swept in another agent's files, undo only yours and tell them what landed where. A revert is additive: the original commit and its subject stay visible for the person who wrote them, and no branch tip moves under anyone. The `git reset --mixed HEAD~1` this bullet used to offer as the recovery is withdrawn for the same reason — it relocates a tip that other agents are committing to at the same moment.
- **⚠️ Never `git stash` to work around a dirty file another agent may own.** Stashing removes their uncommitted work from the working tree for the duration; if they write to that file while it is stashed, the `pop` conflicts or silently discards their edit. That is the same loss as a swept commit but with *no trace in any message*, so nothing later reveals it. To find out whether a failure is committed or only in flight, compare the versions directly instead — `git show HEAD:<path>` versus the file on disk — or check a `git worktree add` of HEAD, neither of which touches their tree. If you have already stashed, verify the round-trip before moving on: byte size, a content count, and an empty `git stash list`.

> last audited 04-09-26 by DSH
