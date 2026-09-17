# Agents Configuration & Rules

<!-- Audit stamp: 2026-09-08 · DSH · status: ACCURATE · version lock: 0.0.39 -->

## 🚨 Critical Agent Directives (MUST FOLLOW)

| Rule | Direct Instruction | Why / Context |
|---|---|---|
| **Branching** | **NEVER create new branches. NEVER switch branches.** | Always work directly on the currently active branch unless specifically requested by the user. |
| **Commits** | **ALWAYS commit with format `<type>(<area>): <description>`.** | Must follow conventional commits. Make local commits after each logical task — the permitted *form* of the commit is the **Commit Writing** row below. |
| **Commit Writing** | **NEVER `git add` — with the sole exception of the §3 one-line new-file chain —, NEVER `git stage`, NEVER `git commit -a`, NEVER `git commit --amend`, NEVER `git stash`. The only permitted commit form is ONE line with an explicit pathspec: `git commit -m "<type>(<area>): <subject>" -- path/one path/two`.** | A pathspec commit takes those files from the working tree and, for already-tracked paths, needs no prior `add` — a *new* file cannot enter a commit in that form, and the §3 new-file chain is the only sanctioned exception. Nor can a pathspec commit collect anything another session staged. In a checkout where several agents commit concurrently the index is a single shared object, so anything left staged is a hazard for someone else even when it is harmless for you. Git & Commit Policy §3 carries the detail. |
| **Pushing** | **NEVER run `git push` without an explicit direct order.** | Even after completing all checks, wait for the user to explicitly say "push". |
| **Version Lock** | **Version is locked at `0.0.39`. NEVER modify version numbers.** | Do not bump version in `Cargo.toml`, `package.json`, `tauri.conf.json`, etc. |
| **File Paths** | **ALWAYS use forward slashes (`/`) in path arguments on Windows.** | Avoid path escaping bugs. **Never anchor to a hardcoded checkout** — resolve the repo root with `git rev-parse --show-toplevel`, or script-relative with `$PSScriptRoot`/`__file__`/`import.meta.url`, so tools work in any worktree of the multi-root layout. |
| **File Reading** | **ALWAYS read files in small chunks (≤ 500 lines).** | Preserves context window and prevents output truncation. |
| **Discovery** | **ALWAYS use `codebase-memory-mcp` first for code exploration.** | Graph discovery saves context tokens and surfaces call chains faster. |
| **Currency** | **ALWAYS use `Money` struct (`i64` minor units). NEVER use float.** | Monetary values must never use `f32`/`f64`. |
| **DB Writes** | **ALWAYS use `rusqlite` transactions for database writes.** | Never write to SQLite outside an explicit transaction. |

---

## 🛠️ Quick Setup & Pre-Commit Gates

```bash
git config core.hooksPath .githooks   # opt-in per clone; enables the seven pre-commit steps
```

Seven steps, each firing only on the paths it cares about. The hook runs **seven steps**:
1. **Line-ending normalization**
2. **Bundle parity**
3. **FTL dedupe dry-run**
4. **Migration column-type lint**
5. **PG schema drift guard**
6. **Go gate**
7. **FTL orphan lint**
Per-step commands and CI backstops: `docs/operations/agent-gates.md`. `cargo fmt` is not a pre-commit step (removed 2026-09-13); formatting is check-only via pre-push, `dev-ci.yml#cargo-check`, `scripts/check.sh`, and `scripts/release.sh`.

---

## 🔑 Global Environment Variables (`KASIRMU_*`)

The developer machine's API keys are stored as **user-scope Windows environment variables** with a `KASIRMU_` prefix (persisted in `HKCU\Environment`; they survive reboots and are available in every **new** PowerShell session — the session that set them must be reopened). Source of truth: the gitignored `.env` at the repo root.

```powershell
$env:KASIRMU_CLOUDFLARE_API_TOKEN        # Cloudflare Workers deploy token
$env:KASIRMU_CLOUDFLARE_ACCOUNT_ID       # Cloudflare account id
$env:KASIRMU_CLOUDFLARE_ACCESS_KEY       # R2 access key id
$env:KASIRMU_CLOUDFLARE_SECRET_ACCESS_KEY# R2 secret access key
$env:KASIRMU_CLOUDFLARE_S3_ENDPOINT      # R2 S3 endpoint
$env:KASIRMU_NORTHFLANK_API_TOKEN        # Northflank deploy token
$env:KASIRMU_ADMIN_KEY                    # admin dashboard API key
$env:KASIRMU_API_SECRET                  # JWT signing secret
$env:KASIRMU_ENFORCE_PLANS               # plan gating flag
$env:KASIRMU_LICENSE_PRIVATE_KEY         # RSA license signing key (PEM, multiline)
```

- Use them in commands instead of hardcoding secrets, e.g. the website deploy:
  ```powershell
  $env:CLOUDFLARE_API_TOKEN=$env:KASIRMU_CLOUDFLARE_API_TOKEN
  $env:CLOUDFLARE_ACCOUNT_ID=$env:KASIRMU_CLOUDFLARE_ACCOUNT_ID
  npm run deploy   # from website/
  ```
- Update `.env` → variables by re-running the save step (same names/prefix); never commit `.env`.
- ⚠️ These are plaintext in the user registry — local-dev convenience only, not a secrets manager.

---

## 💻 Running CLI Tools on Windows

> 🛑 **Run shell scripts through Git's bash by full path** — `& 'C:\Program Files\Git\bin\bash.exe' -c 'bash scripts/wtree-guard.sh check'`. Bare `bash` resolves to WSL here and hangs until killed; under WSL, `npx vitest` also crashes against Windows-built `ui/node_modules`. A `bash` call that times out with no output is a shell-resolution problem, not a broken script.

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

> **Stale-image guard:** `run-e2e.mjs` **refuses to start** when a locally-built image predates its own sources (exit 3). Re-run with `--build`; skipped under `CI`, where the workflow builds from the checkout.

*If `node_modules` is missing, install cleanly:*
```powershell
cd ui
npm ci --no-audit --no-fund
```

- **No linter sees `.css`** — never cite `eslint` for a stylesheet. Verify with the five walker suites; command and caveats: `docs/frontend/css-verification.md`.

### 2. Rust Backend CLI

- **Active Development Iteration:**
  - Quick compilation check: `cargo check -p <crate>`
  - Run specific test: `cargo test -p <crate> <test_name>`
  - 🛑 **Agents must NOT run `cargo clippy` or full workspace tests (`cargo test --workspace`) during routine iteration.**
- **Pre-Push / Final Verification Only:**
  - `cargo fmt --all`
  - `cargo clippy --all-targets --all-features -- -D warnings` (must resolve all warnings — **and you are the only thing that will**: no live workflow runs clippy, so CI neither blocks nor reports it)
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
- **"Settings" disambiguation:** "The Tauri Settings page" means `ui/src/features/settings/SettingsPage.tsx` — the master–detail UI (route `settings`) with the top-right Save button. Not `ui/src/api/settings.ts` (IPC client), `ui/src/contexts/SettingsContext.tsx` (shared state), the `settings.rs` IPC commands, the `kasirmu-core` settings service/DB, or `modules/settings/` (a kernel lifecycle stub, not the UI).
- **⚠️ "Is this screen dead code?" needs three greps, not one.** Feature screens register **lazily** (`lazy(() => import(...))` + `registerPage`/`registerNavItem` in `ui/src/features/*/register.tsx`), so an import search finds nothing on a live screen. Check the screen name, then `route: '<route>'`, across `ui/src` — and never trust a truncated (`head`-cut) hit list, since `ui/src/__tests__/` sorts before `ui/src/features/`.
- **⚠️ A `:!` pathspec built by inline string concatenation silently matches nothing** in PowerShell argument position. Build exclusion pathspecs as their own variable, and sanity-check any zero-reference dead-code claim with one unfiltered `git grep`.
- **Accessibility:** All React components must have ARIA labels and pass `eslint-plugin-jsx-a11y` checks.
- **Localization:** All user-visible strings must use `@fluent/react`. No hardcoded English strings in JSX.

### 4. Database & Hardware
- **HAL Drivers:** Hardware drivers must have a mock implementation in `crates/kasirmu-hal/src/drivers/mock.rs`.
- **SQLite is the schema source of truth:** `crates/kasirmu-core/migrations/*.sql` + the registry in `migrations.rs` (registry order is canonical). See `docs/records/sqlite-pg-roles.md`.
- **`init.pg.sql` is generated, never hand-edited:** after any migration change run `python3 scripts/generate-pg-migration.py` and re-stage `crates/kasirmu-core/migrations/20260813_init.pg.sql`. Pre-commit step 5 and `dev-ci.yml#static-gates` fail on drift.
- **PostgreSQL Drift:** When modifying Postgres schemas, run `bash scripts/reset-dev-pg.sh` to re-synchronize the shared dev container schema.

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
  - `style`: Cosmetic changes that alter no runtime behaviour (listed so the set matches what `.githooks/commit-msg` accepts)
  - `perf`: Performance improvements
  - `ci`: CI workflows, GitHub Actions, build scripts
  - `audit`: Code audit stamps and remediations
- **`<area>`**: Domain, crate, or component (e.g. `sales`, `admin`, `website`, `ci`, `core`, `desktop-client`, `ui`, `licensing`, `agents`).
- **`<description>`**: Imperative, concise summary of the change (e.g. `add gift card tender`, `resolve modal overflow`).

> Enforced by `.githooks/commit-msg` (subject line only; bodies stay free-form). Git-generated messages (`Merge …`, `Revert …`, `fixup!`, `squash!`) and an empty subject pass through. Like every hook it needs `core.hooksPath`.

### 3. Commit Cadence & Push Rule
- **Always make a local commit after each major modification.** Whenever a logical task or feature step is completed and verified locally, commit it before moving on to the next task.
- **Never run `git push` without an explicit, direct order from the user.** Even after committing code or completing verification, always wait for the user to explicitly instruct you to push before executing any `git push` command.
- Never commit secrets, `.env` files, or SQLite database files (`*.db`, `*.sqlite`).
- **⚠️ Multiple agents commit to this branch concurrently. The ONLY permitted commit form is ONE line with an explicit pathspec — `git commit -m "<type>(<area>): <subject>" -- path/one path/two`.** Never bare `git commit`, never `git commit -a`, and never `git add` or `git stage` as a separate step first. A whole-tree commit consumes whatever *another* agent has staged and files it under your message. If `git commit` reports nothing to commit when you expected it to, **do not conclude your work was lost** — check `git show --stat HEAD` first; your files may already be in someone else's commit.
  ```bash
  git commit -m "<type>(<area>): <subject>" -- path/one path/two   # one line, no prior add, only your files
  git show --stat                                                   # prove the file list is exactly yours
  git status --porcelain                                            # after committing: confirm leftovers are theirs
  ```
- **⚠️ New files are the one case the no-staging rule needs its own form.** A bare pathspec commit rejects untracked paths, so new files go through ONE chained line in which the `add` names exactly the new paths and is consumed at once by a pathspec commit:
  ```bash
  git add -- new/one new/two && git commit -m "<type>(<area>): <subject>" -- new/one new/two
  ```
  The `add` lists **only untracked new paths**; the commit pathspec is a superset of the add list. If the commit half fails (usually `index.lock` held by a concurrent agent), **re-run the whole line, never the commit alone**. Verify with `git show --stat` that the `create mode` entries are exactly your files.
- **⚠️ In a shared checkout the index is a single shared object: never leave anything staged, even your own.** Inspect the paths you are about to name immediately before naming them (`git --no-optional-locks status --porcelain -- path/one path/two`). A pathspec commit records the *working-tree* copy, so if another session has uncommitted edits in the same file your commit sweeps them in — if a path you want is dirty with content that is not yours, stop and say so.
- **⚠️ Never `git commit --amend`, `git reset`, or `git stash` on a shared branch.** An amend re-commits the whole index and inherits whatever another agent staged since you last looked — inspecting it first proves nothing, because the index is a racing value. Stashing is worse: it removes their uncommitted work with no trace in any message. **The recovery for a bad commit is a NEW commit that undoes it** (`git revert`, recorded with a pathspec line); to tell committed apart from in-flight, compare `git show HEAD:<path>` against the file on disk.
- **⚠️ Not every ` M` is content.** Under `text=auto` a file can show as modified while its bytes are identical to the HEAD blob. Compare `git hash-object <path>` with `git rev-parse :<path>`; if the hashes match there is nothing to commit.

### 4. Plan-doc naming is a checker token, not just a convention
- **`done-todo-*` is earned ONLY when that file's own acceptance command was RUN and PASSED.** Anything else — however complete the code — stays `todo-`. Parked, superseded, or audit-with-open-verdicts states belong in a dated header line, never in the filename. Renames happen in place at the repo root.
- **A tool reads the name:** `check-dead-refs.py` exempts any doc whose name contains `todo-`, `plan-`, or `prd-` — keep the token wherever the file lives.
- **Never rename or move another session's uncommitted plan file** — the name is shared state, like the index.

> last audited 08-09-26 by docs-auditor
