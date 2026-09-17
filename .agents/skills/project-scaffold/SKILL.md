---
name: project-scaffold
description: Project scaffolding, Cargo workspace layout, CI configuration, and Git conventions for kasir.mu. Use when setting up the initial repo, adding a new crate, configuring GitHub Actions, or committing changes.
---

<!-- Audit stamp: 2026-09-03 · DSH · status: ACCURATE (rev 2 — version lock corrected 0.0.33 → 0.0.35; branch policy aligned with the never-create-branches repo rule; CI section rewritten against the real single active workflow .github/workflows/dev-ci.yml (website/cargo-check/cargo-nextest/ui-test/northflank-deploy, ubuntu, node 24, PG 17 service, RUSTFLAGS -D warnings; ci.yml/security.yml/release.yml exist only as .bak); workspace tree fixed — ARCHITECTURE.md at root, no ROADMAP/WHITEPAPER, docs/ carries guides|specs|decisions|records; spec workflow fixed — the phantom spec `_template` dir removed (does not exist; drafts go straight into `_active`), example swapped to the real 0043-architecture-boundary-checker; lockfile guidance corrected to single committed root Cargo.lock) · verified this pass: Cargo.toml (members globs, exclude, workspace.package, workspace.lints missing_docs, rusqlite 0.31 bundled+backup, thiserror/anyhow/tracing), scripts/check.sh + check.ps1, docs/specs/_active/0043-architecture-boundary-checker (spec.yaml + plan.md + validation.md), .gitignore · STAMPS MERGED INTO THIS ONE on 2026-09-08 (§13: replace, do not stack) — carrying forward the superseded audits’ evidence verbatim:  ·· [2026-08-31] · docs-auditor · status: ACCURATE (workspace-layout example repaired) · FIXED 31-08: license MIT -> "SEE LICENSE IN LICENSE" (proprietary — an agent scaffolding with MIT would mislicense the codebase); version 0.0.1 -> 0.0.33 (locked); rust-version 1.85 -> 1.88 (axum/time require >=1.88); members explicit-8 -> real globs (crates/*, modules/*, platform/*, foundation, apps listed explicitly since Go license-server breaks an apps/* glob); rusqlite features +backup; migrations moved from phantom repo-root to crates/kasirmu-core/migrations/; kasirmu-lua rlua -> mlua · verified against HEAD Cargo.toml + ui/package.json · F6 (node-version) not present in skill body (it lives in .github/workflows) -->
# Project Scaffold, CI & Git

kasir.mu is a multi-crate Cargo workspace with a Tauri front-end, a strict style policy, and a CI pipeline that catches mistakes before they merge. This skill covers the workspace layout, the CI matrix, and the Git workflow.

---

## When to use

- Scaffolding the initial repository (Cargo workspace, crates, CI).
- Adding a new crate to the workspace.
- Adding a new CI check (lint, test, build, security audit).
- Committing a change (branch name, commit message format).
- Reviewing a PR for missing checks, wrong scope, or wrong branch.
- Configuring the GitHub Actions matrix (Linux, Windows, macOS, Android, iOS).

---

## Golden rules

| # | Rule | Why |
|---|------|-----|
| 1 | **Work on the currently active branch. Never create or switch branches** unless the user explicitly orders it. | Repo policy (AGENTS.md). When a branch name is genuinely requested, use `feat/<name>`, `fix/<name>`, `docs/<name>`, `chore/<name>`, `test/<name>`, `refactor/<name>`. |
| 2 | **Commit messages follow Conventional Commits.** | Auto-generated changelogs, semantic versioning. |
| 3 | **PRs pass CI before merge.** | `dev-ci.yml`'s **eleven** jobs: `changes`, `website`, `cargo-check`, `cargo-nextest`, `release-bridge-test`, `ui-test`, `i18n`, `ci-docs-drift`, `static-gates`, `release-readiness`, `northflank-deploy`. Derive rather than restate: `awk '/^jobs:/{f=1;next} /^[^[:space:]]/{f=0} f && /^  [a-z][a-z0-9_-]*:$/{gsub(/[: ]/,"");print}' .github/workflows/dev-ci.yml`. **Do not use a bare two-space key grep** — it also returns `pull_request`, `workflow_dispatch` and `run` as if they were jobs, because the `on:` block is indented the same way. This cell listed four and went stale as the rest were restored; `ci-docs-drift` is advisory and `northflank-deploy` does **not** depend on it. |
| 4 | **Never commit `.env`, secrets, or SQLite database files.** | PCI-DSS, basic hygiene. |
| 5 | **One crate per `kasirmu-*` responsibility.** | Compile-time boundaries, fast incremental builds. |

---

## Cargo workspace layout

```toml
# Cargo.toml (workspace root)

[workspace]
resolver = "2"
members = [
    "crates/*",          # utility crates (globbed — a new crate auto-joins)
    "modules/*",         # domain modules (globbed)
    "platform/*",        # kernel, core, sync, startup (globbed)
    "foundation",
    "apps/cloud-server",
    "apps/desktop-tauri",
    "apps/mobile-tauri",
    # apps/license-server is Go (no Cargo.toml) — excluded; a glob over
    # apps/* would break `cargo metadata`, so apps are listed explicitly
]

[workspace.package]
version = "0.0.39"          # locked — do not bump without an explicit order
edition = "2024"
rust-version = "1.88"       # axum/tower-http deps (time 0.3.47+) require ≥ 1.88
license = "SEE LICENSE IN LICENSE"   # proprietary — NOT open source

[workspace.dependencies]
# all crates import from here: kasirmu-core = { workspace = true }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
rusqlite = { version = "0.31", features = ["bundled", "backup"] }
thiserror = "1"
anyhow = "1"
tracing = "0.1"
tracing-subscriber = "0.3"
```

```
oz-pos/
├── Cargo.toml                  # workspace root (single committed Cargo.lock)
├── AGENTS.md · ARCHITECTURE.md · CONTRIBUTING.md · README.md   # root docs
├── crates/
│   ├── kasirmu-core/                # money, currency, cart, sale, inventory domain; migrations/ (init.sql + init.pg.sql, embedded via include_str!)
│   ├── kasirmu-hal/                 # hardware abstraction + drivers
│   ├── kasirmu-lua/                 # mlua runtime + script bindings
│   ├── kasirmu-security/            # encryption, secrets, PCI helpers
│   ├── kasirmu-payment/             # Stripe, Square, EMV abstraction
│   ├── kasirmu-reporting/           # analytics + CSV export
│   ├── kasirmu-logging/             # structured logging
│   └── kasirmu-cli/                 # migrations, backup, export CLI
│   (also: kasirmu-api, kasirmu-bridge, kasirmu-crypto, kasirmu-lan, kasirmu-local-api, kasirmu-media,
│    kasirmu-notification, kasirmu-plugin, and qris-core — globbed via crates/*)
├── apps/desktop-tauri/        # the desktop shell
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs
│       ├── lib.rs
│       ├── commands/
│       ├── error.rs
│       └── state.rs
├── apps/mobile-tauri/         # the mobile shell
├── apps/cloud-server/          # the PostgreSQL cloud backend
├── ui/                         # React + TypeScript
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
├── docs/
│   ├── guides/                 # api-reference, QUICKSTART, contributor guides
│   ├── decisions/              # decision records (ADRs)
│   ├── records/                # historical implementation records
│   └── specs/
│       ├── _active/            # in-progress specs (folders or single .md files)
│       └── _done/              # finished specs
├── .github/
│   └── workflows/
│       ├── dev-ci.yml          # active: PR + push to main + manual dispatch
│       ├── release.yml         # active: v* tag → signed desktop installers
│       └── attic/              # dormant *.yml.bak references (ci, security, deploy, …)
└── scripts/                    # local dev scripts (PowerShell + bash)
```

---

## Scaffolding a new crate

```bash
# from the crates/ directory — crate names carry the kasirmu- prefix
cd crates
cargo new --lib kasirmu-<name>
```

```toml
# crates/<name>/Cargo.toml  (name the package "kasirmu-<name>")

[package]
name = "kasirmu-<name>"
version.workspace = true
edition.workspace = true
license.workspace = true

[dependencies]
kasirmu-core = { workspace = true }
serde = { workspace = true }
thiserror = { workspace = true }
```

Every member manifest also inherits the workspace lint set — put this above
`[dependencies]`:

```toml
# Inherits [workspace.lints] from the root Cargo.toml (missing_docs = warn).
[lints]
workspace = true
```

```rust
// crates/<name>/ — the new crate's lib.rs

//! <One-line summary of what this crate does>.
//!
//! <Longer paragraph explaining the responsibility, the public surface,
//! and any non-obvious invariants.>

#![deny(unsafe_code)]   // unless the crate genuinely needs unsafe

pub mod error;

pub use error::<Crate>Error;
```

The root `members` list globs `crates/*`, `modules/*`, and `platform/*`, so a
new crate in one of those directories becomes a workspace member with no root
manifest edit. `apps/` entries are listed explicitly because not every `apps/`
subdirectory is a Cargo crate.

**Rules:**
- `missing_docs = "warn"` comes from the root `[workspace.lints]` and applies through `[lints] workspace = true`; do not add a per-crate `#![warn(missing_docs)]`. Public items without `///` produce warnings; fix them, don't suppress.
- Cargo rejects a manifest that has both `[lints] workspace = true` and a local `[lints.rust]` override, so a crate-level need for a different lint level must use an inner attribute in `lib.rs` (as `#![deny(unsafe_code)]` does).
- `#![deny(unsafe_code)]` unless the crate is `kasirmu-hal` (drivers may need `unsafe` for FFI). Even then, wrap `unsafe` blocks with `// SAFETY:` comments.
- Each crate has a `README.md` with a one-paragraph summary, public API overview, and example.
- The crate's `mod.rs` re-exports the public surface so users can `use kasirmu_<name>::Type;`.

---

## Git workflow

### Branch naming

> **Repo policy (AGENTS.md): never create new branches, never switch branches.** Always work directly on the currently active branch — the version branch, e.g. `0.0.39` — and let the user manage branching. The table below applies only when the user explicitly requests a named branch.

| Prefix | When to use | Example |
|--------|-------------|---------|
| `feat/<name>` | New feature, capability, or user-visible change | `feat/cart-line-discount` |
| `fix/<name>` | Bug fix | `fix/cart-overflow-on-coupon` |
| `docs/<name>` | Documentation only | `docs/guides/api-reference.md` refresh |
| `chore/<name>` | Maintenance, deps, config, refactor with no behavior change | `chore/bump-tauri-v2.1` |
| `test/<name>` | Test additions or fixes | `test/integration-sales-flow` |
| `refactor/<name>` | Code restructuring, no behavior change | `refactor/extract-payment-port` |

`<name>` is kebab-case, short, and describes the change.

### Commit message format (Conventional Commits)

```
<type>(<optional scope>): <short summary> [optional body] [optional footer(s)]
```

- `type` matches the branch prefix.
- Summary is ≤ 72 characters, imperative mood ("add" not "added").
- Body explains *why*; the diff shows *what*.
- Footer for breaking changes: `BREAKING CHANGE: <description>`.

**Examples:**

```
feat(cart): apply line-level discounts before tax

Line-level discounts were applied after tax computation, producing
incorrect totals for high-tax jurisdictions. Apply discounts to the
line subtotal first, then tax the discounted amount.

Closes #142
```

```
fix(payment): retry once on transient network errors

Stripe occasionally returns 502 on authorization. A single retry with
a 250ms backoff recovers most cases without idempotency risk.
```

```
chore: bump tauri to v2.1 and refresh lockfile
```

**Forbidden prefixes:** `update`, `fix`, `changes`, `wip`, `minor`. These are too vague.

---

## CI pipeline

There are **two active workflows**: `.github/workflows/dev-ci.yml` ("Dev CI") and `.github/workflows/release.yml` (a `v*` tag → signed desktop installers and updater manifests). `dev-ci.yml` runs on pull requests targeting `main`, **on push to `main`**, and on manual `workflow_dispatch`; `release.yml` fires only on `v*` tags. Everything else is dormant, and it lives one level down: the retired references are in `.github/workflows/attic/` as `*.yml.bak` (ci, security, deploy, nightly, …) — do not treat those as active.

```yaml
name: Dev CI

on:
  pull_request:
    branches: [main]
  workflow_dispatch:

env:
  CARGO_TERM_COLOR: always
  RUSTFLAGS: -D warnings          # every rustc warning is an error, workflow-wide
  SCCACHE_GHA_ENABLED: "true"
```

Jobs (all on `ubuntu-latest`, Node pinned to **24**):

| Job | What it does |
|---|---|
| `website` | `website/` npm ci → typecheck & lint → unit tests → build (installs Playwright chromium for Mermaid rendering). |
| `cargo-check` | Installs Tauri's Linux system libs, creates the frontend build-output stubs (the `ui` dist folders) for the Tauri macro, then `cargo check --workspace --all-targets --all-features` with sccache + Swatinem/rust-cache. |
| `cargo-nextest` | Same environment plus a `postgres:17-alpine` service (`OZ_TEST_PG_URL`), then `cargo nextest run --workspace --all-features`. |
| `ui-test` | `ui/` npm ci → `npm test` (Vitest suite). |
| `northflank-deploy` | Needs **seven** jobs — `changes, website, cargo-check, cargo-nextest, ui-test, i18n, static-gates` — so it excludes `ci-docs-drift` (advisory by design) and `release-readiness` (unexplained; see `docs/plans/0.0.36-backlog.md`), and `release-bridge-test` (push-only). Reached by **both** entry points, not dispatch alone: `on.push.branches: [main]` is declared at `dev-ci.yml:6-7`, so a merge to `main` runs this workflow and the `if:` (now at `dev-ci.yml:722`, gated on `github.ref == 'refs/heads/main'`) deploys it. The file's own comment says the earlier “workflow_dispatch is the only non-PR event” claim was false. `workflow_dispatch` declares no branch filter, which is exactly why the `if:` gates on the ref. Calls the Northflank API; skips gracefully without `NORTHFLANK_API_TOKEN`. |

**Rules:**
- `RUSTFLAGS: -D warnings` means warnings fail the workflow even where no explicit clippy job runs.
- CI compiles/tests on Linux only. Windows/macOS parity is verified locally — `scripts/check.sh` (POSIX) and `scripts/check.ps1` (Windows) mirror the full gate set (fmt, workspace clippy `-D warnings`, no-raw-params, scoped coverage, IPC parity, architecture boundaries, i18n, UI suite, …). Run the relevant script before pushing; agents must not run bare `cargo clippy` or `cargo test --workspace` during routine iteration (see AGENTS.md).
- Don't disable platform-specific tests; fix them.
- The frontend build-output stubs (the `ui` dist folders, incl. the desktop and tablet ones) exist because Tauri build macros expect them; CI creates them with `mkdir -p` before running cargo.

---

## Local verification

- **`.githooks/pre-commit`** runs on every commit. **Source of truth is the hook itself — `grep -n '^# ──' .githooks/pre-commit` — and [`AGENTS.md`](../../../AGENTS.md) § Quick Setup enumerates every step with its rationale.** As of 0.0.39 there are seven: LF normalization, staged bundle parity, FTL dedupe, migration column-type lint, PG schema drift guard, Go, and FTL orphan lint (heavy UI typecheck and Vitest i18n are offloaded to pre-push and CI). cargo fmt was a pre-commit step until 2026-09-13, when it was removed — it ran `cargo fmt --all` workspace-wide under concurrent agents, reformating other sessions' in-flight `.rs` files; formatting is now check-only in pre-push/CI/`check.sh`/`release.sh`. `scripts/verify-agents-mirrors.py` now polices skill files against the hook, so a restated count that disagrees is a red build rather than a wrong belief.
- **`scripts/check.sh`** (POSIX) / **`scripts/check.ps1`** (Windows) mirror the full verification matrix for pre-push use — fmt, workspace clippy with `-D warnings`, repo-specific boundary gates (no-raw-params, scoped coverage, IPC parity, architecture boundaries), i18n, and the UI suite. Run the relevant script before pushing; CI runs on Linux only, so a local pass is what protects the other platforms.

Run these before pushing. The CI workflow is the merge gate, but a local pass catches the bulk of issues.

---

## What NOT to commit

- `.env`, `.env.local`, `.env.production` — secrets (the repo ignores `.env` and `.env.*`, keeping only `.env.example`).
- `*.db`, `*.sqlite`, `*.sqlite3` — local databases.
- `target/` and per-crate `target/` trees, `dist/` outputs (including the ui build outputs), `node_modules/` — build artifacts.
- `*.key`, `*.pem`, `secrets/` — credentials.
- **Cargo.lock:** the workspace keeps a **single `Cargo.lock` at the root and it is committed** (kasir.mu ships binaries — `kasirmu-cli`, the Tauri app). Do not add per-crate lockfiles; the only exception is the standalone `tools/fuzz/` workspace, whose lockfile is a dev-only artifact and is ignored.

A `.gitignore` template (matches the repo's real one):

```gitignore
# Build artifacts
/target/
/target-*/
/crates/*/target/
/modules/*/target/
/platform/*/target/
/foundation/target/
/apps/*/target/
# (plus the ui build outputs — dist, dist-mobile, playwright-report,
#  test-results, e2e results — see the repo's real .gitignore)

# Local state
*.db
*.sqlite
*.sqlite3
.env
.env.*
!.env.example
*.key
*.pem

# Editor
.vscode/
.idea/
*.swp

# OS
.DS_Store
Thumbs.db
```

---

## Spec workflow (optional but recommended)

Larger changes are tracked as specs under `docs/specs/_active/<id>/`. Each spec is a small package:

```
docs/specs/_active/0043-architecture-boundary-checker/
├── spec.yaml          # metadata: id, title, status, owner, priority, scope
├── plan.md            # baseline, implementation steps, API changes, validation
└── validation.md      # acceptance criteria, test commands, visual checks
```

**Status values** (by directory):

- `_active/` — `approved`, `in-progress`, `implemented`, `needs-human-approval`
- `_done/` — `done`

Drafts go straight into `_active/` (there is no `_template/` directory). Specs may also be single `.md` files (e.g. `0046b-product-menu-images.md`) when a folder is overkill.

**Rules:**
- Specs are for changes that touch more than one crate or have user-visible behavior.
- Bug fixes and small features don't need a spec.
- A spec's `id` is `NNNN-kebab-summary` (zero-padded to 4 digits, kebab-case summary).
- The `owner` is the human or team responsible. The `implementer` is whoever writes the code (often an agent).

---

## Adding a new CI check — checklist

- [ ] Define the check in `.github/workflows/dev-ci.yml` (the only active workflow) or as a `*.yml.bak`-referenced follow-up if dormant.
- [ ] Add the corresponding local script under `scripts/` and wire it into `scripts/check.sh` (and `check.ps1` when it applies to Windows).
- [ ] Document the check in this skill (so future contributors know it exists).
- [ ] Update the pre-push checklist at the bottom of this file if it's a blocking check.
- [ ] Add a status badge to `README.md`.

---

## Common pitfalls

1. **Adding a new crate to the wrong place** (e.g., `src/` instead of `crates/`). The workspace `members` list must include it, and it should follow the `kasirmu-<name>` naming.
2. **Adding a per-crate `Cargo.lock`.** The workspace keeps one root lockfile, committed. Only the standalone `tools/fuzz/` workspace has its own (ignored).
3. **Using `git commit --no-verify`** to skip pre-commit hooks. Fix the issue, don't bypass it.
4. **Renaming a branch after pushing.** The PR link changes, CI re-runs needlessly. Pick the name right the first time.
5. **Squash-merging a multi-commit feature branch** — fine, but the squash message must be a clean Conventional Commit, not the WIP history.
6. **Adding `cargo update` to a feature PR.** Bumping unrelated deps makes the diff unreviewable. Update in a separate `chore/` commit.
7. **Forgetting to register a new command** in `tauri::generate_handler!` — the command compiles but is not callable. The IPC-parity gate in `scripts/check.sh` catches this.
8. **Skipping `scripts/check.sh` before push.** CI compiles and tests on Linux only; the boundary gates (fmt, clippy, IPC parity, architecture) run locally via the script, not in the workflow.

---

## Pre-push checklist (every PR)

- [ ] `bash scripts/check.sh` (POSIX) or `scripts/check.ps1` (Windows) passes — fmt, workspace clippy `-D warnings`, boundary gates, i18n, UI suite
- [ ] `cargo nextest run --workspace --all-features` (or `cargo test --workspace --all-features`) passes
- [ ] `cd ui && npm run lint && npm run typecheck && npm run test` pass
- [ ] No `.env`, `.db`, `*.key`, or `target/` files in the diff
- [ ] Commit messages follow Conventional Commits
- [ ] Working directly on the active branch (no new branches created)
- [ ] Spec folder moved to `_done/` if it was a spec-driven change

---

> last audited 18-09-26 by Budak-Korporat
