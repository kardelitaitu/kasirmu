# Agents Configuration & Rules

<!-- Audit stamp: 2026-09-04 · DSH · status: ACCURATE · version lock: 0.0.37 · 9 pre-commit gates · conventional commits enforced -->

## 🚨 Critical Agent Directives (MUST FOLLOW)

| Rule | Direct Instruction | Why / Context |
|---|---|---|
| **Branching** | **NEVER create new branches. NEVER switch branches.** | Always work directly on the currently active branch unless specifically requested by the user. |
| **Commits** | **ALWAYS commit with format `<type>(<area>): <description>`.** | Must follow conventional commits. Make local commits after each logical task. |
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
git config core.hooksPath .githooks   # enable pre-commit hook (fmt + EOL + i18n + bundle-parity + FTL dedupe + column types + PG drift + Go + ui typecheck)
```

The `.githooks/pre-commit` hook runs **nine steps** before every commit, in this order (~5–7s typical; the i18n gate alone is ~4s):
1. **`cargo fmt --all`** — auto-formats Rust and re-stages what it changed.
2. **Line-ending normalization** — strips CR from staged text files in the working tree and index, re-staging them so the committed blob is LF (backs `.gitattributes` `* text=auto eol=lf`). Skips files whose effective `eol` is `crlf` (`*.bat`/`*.cmd` — the working tree must stay CRLF for cmd.exe) and real binaries (`grep -qI`; `text=auto` reports "auto" for PNGs too, and stripping their CRs destroys the signature). Both exclusions were missing until 0.0.36; `scripts/test-eol-guard.sh` guards them.
3. **`i18n lint`** — `scripts/lint-i18n.sh`; fail-closed on byte-identical `.id.ftl` siblings, duplicate Fluent keys dropped at bundle join, and literal keys resolving in neither locale.
4. **`Bundle parity: staged files only`** — `scripts/verify-bundle-parity.py --staged-only` with `--include-getstring --include-nav-keys --include-key-fields --include-dynamic-literals --include-id-maps --check-domain-pairs`, over staged files in `features`, `components`, `frontend`, `contexts`, `hooks` and `platform`. Fails if any of the **eight checked surfaces** references a key missing from `.ftl`/`.id.ftl`.
5. **`FTL dedupe dry-run`** — `scripts/dedupe-ftl.py --dry-run`.
6. **`Migration column-type lint`** — `scripts/verify-migration-column-types.py --staged-only`, when `crates/oz-core/migrations/*.sql` is staged.
7. **`PG schema drift guard`** — `scripts/generate-pg-migration.py --check`; `20260813_init.pg.sql` is generated, **never hand-edited**.
8. **`Go gate`** — when `apps/license-server/*.go` is staged: `gofmt -w` + `go vet ./...`. Aborts if `go`/`gofmt` are missing.
9. **`UI typecheck`** — when the commit stages `ui/src/*.ts` or `ui/src/*.tsx`: `npm run typecheck` (~21s), hard fail. Added in 0.0.37 after ten commits landed with HEAD failing `tsc --noEmit`: Vitest injects describe/it/expect/beforeEach/vi at runtime, so a test file that forgets to import one passes `npm run test` and only fails `tsc`. `OZPOS_SKIP_TYPECHECK=1` skips this step alone; prefer it to `--no-verify`, which skips all nine. `scripts/test-typecheck-gate.sh` proves the live step still fires.

> ✅ **All nine steps now have a CI backstop.** Steps 6 and 7 (`verify-migration-column-types.py`, `generate-pg-migration.py --check`) lived in `ci.yml`, were retired to `.bak` (`23c96330`), and were restored into `dev-ci.yml#static-gates` in **0.0.37** — until then the opt-in hook was their only guard, and they had no `gates.json` record either, so the drift checker could not report a gate it never saw. CI runs the column-type check without `--staged-only`, so it scans all 28 migration files, not just the ones a commit touched. Both are pure text comparison (~1.1s together): no Docker, no psycopg, no sqlite handle. Step 8 (Go) has been CI-backed since 0.0.36 (`13f2a1dc`): `dev-ci.yml#static-gates` runs `gofmt -l`, `go vet ./...` and `go test -short` on `apps/license-server`. Note the CI gate is `gofmt -l` (report-only, fails on any unformatted file) while the hook runs `gofmt -w` and re-stages, so a commit made without `core.hooksPath` can be unformatted and CI will reject it rather than fix it. On a clone without `core.hooksPath` set, none of the eight run at commit time — but CI now catches all of them.
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
