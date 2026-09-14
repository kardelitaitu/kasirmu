# Agents Configuration & Rules

<!-- Audit stamp: 2026-08-30 · Antigravity · status: ACCURATE · version lock: 0.0.38 · 4 pre-commit gates · conventional commits enforced -->

## 🚨 Critical Agent Directives (MUST FOLLOW)

| Rule | Direct Instruction | Why / Context |
|---|---|---|
| **Branching** | **NEVER create new branches. NEVER switch branches.** | Always work directly on the currently active branch unless specifically requested by the user. |
| **Commits** | **ALWAYS commit with format `<type>(<area>): <description>`.** | Must follow conventional commits. Make local commits after each logical task. |
| **Pushing** | **NEVER run `git push` without an explicit direct order.** | Even after completing all checks, wait for the user to explicitly say "push". |
| **Version Lock** | **Version is locked at `0.0.38`. NEVER modify version numbers.** | Do not bump version in `Cargo.toml`, `package.json`, `tauri.conf.json`, etc. |
| **File Paths** | **ALWAYS use forward slashes (`/`) in path arguments on Windows.** | Avoid path escaping bugs (e.g., use `C:/My Script/oz-pos/`). |
| **File Reading** | **ALWAYS read files in small chunks (≤ 500 lines).** | Preserves context window and prevents output truncation. |
| **Discovery** | **ALWAYS use `codebase-memory-mcp` first for code exploration.** | Graph discovery saves context tokens and surfaces call chains faster. |
| **Currency** | **ALWAYS use `Money` struct (`i64` minor units). NEVER use float.** | Monetary values must never use `f32`/`f64`. |
| **DB Writes** | **ALWAYS use `rusqlite` transactions for database writes.** | Never write to SQLite outside an explicit transaction. |

---

## 🛠️ Quick Setup & Pre-Commit Gates

```bash
git config core.hooksPath .githooks   # enable pre-commit hook (cargo fmt + i18n lint + bundle-parity + FTL dedupe)
```

The `.githooks/pre-commit` hook runs four gates automatically before every commit (~1s total):
1. **`cargo fmt --all`** — auto-formats staged Rust files and re-stages them.
2. **`i18n lint`** — runs `scripts/lint-i18n.sh` (validates Fluent `.id.ftl` vs `.ftl` bundles).
3. **`Bundle parity: staged files only`** — runs `scripts/verify-bundle-parity.py --staged-only` on staged `ui/src/features/**` files; fails if an `<Localized id>` key is missing from `.ftl`.
4. **`FTL dedupe dry-run`** — runs `scripts/dedupe-ftl.py --dry-run` to detect duplicate Fluent keys before push.

> For full repository verification mirroring the entire CI matrix, see [`scripts/check.sh`](./scripts/check.sh).

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
  - `perf`: Performance improvements
  - `ci`: CI workflows, GitHub Actions, build scripts
  - `audit`: Code audit stamps and remediations
- **`<area>`**: Domain, crate, or component (e.g. `sales`, `admin`, `website`, `ci`, `core`, `desktop-client`, `ui`, `licensing`, `agents`).
- **`<description>`**: Imperative, concise summary of the change (e.g. `add gift card tender`, `resolve modal overflow`).

### 3. Commit Cadence & Push Rule
- **Always make a local commit after each major modification.** Whenever a logical task or feature step is completed and verified locally, commit it before moving on to the next task.
- **Never run `git push` without an explicit, direct order from the user.** Even after committing code or completing verification, always wait for the user to explicitly instruct you to push before executing any `git push` command.
- Never commit secrets, `.env` files, or SQLite database files (`*.db`, `*.sqlite`).
