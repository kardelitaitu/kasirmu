# Agents Configuration & Rules

<!-- Audit stamp: 2026-09-27 · BK · status: ACCURATE · version lock: 0.0.41
     change: roundtrip-economy rewrite — quick card (§0), economy protocol (§1),
     task playbook folded into §1; chunk-read rule replaced by whole-file reads (E4);
     seven-step gate count named explicitly (§2); discovery directive gains fallback order. -->

<!-- Correction 2026-09-29 (docs-auditor, round 6): the stamp above claimed ACCURATE
     while §4 named four variables the code does not read — KASIRMU_ADMIN_KEY,
     KASIRMU_API_SECRET, KASIRMU_ENFORCE_PLANS, KASIRMU_LICENSE_PRIVATE_KEY. All four
     have ZERO hits under apps/; the server reads the OZ_ spellings. Setting a KASIRMU_
     name did nothing, and the server fell back to its default — which for
     OZ_ENFORCE_PLANS means plan gating silently off, the worst direction to fail.
     Fixed to the OZ_ names, and §0/§4 headings corrected: there is no single prefix.
     KASIRMU_MASTER_KEY was already right and is unchanged. Names verified against
     apps/cloud-server/src/config.rs and apps/license-server; the OZ_ side became
     visible to check-env-docs.py only after that checker's scope was widened to the
     Rust cloud server in round 5. -->

## 0. Quick card — read this first

Every value measured 2026-09-27 on branch `0.0.41`. Do not probe to orient (E3); if a
value smells stale, refresh via §7.5 folded into a call you already need.

| Need | Answer |
|---|---|
| Branch | Stay on the checked-out branch. NEVER create or switch branches. |
| Version | Locked at `0.0.41`. NEVER modify version numbers in any manifest. |
| Commit | ONE permitted form: `git commit -m "<type>(<area>): <subject>" -- path/one path/two`. New files: one chained line `git add -- <paths> && git commit -m "..." -- <paths>`. Full policy + shared-index warnings: §7. |
| Push | Only on the user's explicit order. Never otherwise. |
| Gates | Opt-in per clone: `git config core.hooksPath .githooks` — seven steps, §2. |
| UI work | All npm scripts from inside `ui/`. Never bare `tsc`/`eslint` (§5). |
| Rust work | `cargo check -p <crate>` for iteration. Clippy/workspace tests: pre-push only (§5). |
| Secrets | user-scope env vars (§4) — mixed `KASIRMU_*` / `OZ_*` prefixes, copy the name verbatim. Never hardcode; never commit `.env`. |
| Plan docs | Filename keeps the `todo-`/`plan-`/`prd-` token. `done-` is earned only when the file's acceptance command ran and passed (§7.4). |
| Paths | Forward slashes in tool args. Never hardcode the checkout root — resolve with `git rev-parse --show-toplevel`. |
| Money / DB | `Money` (`i64` minor units), never float. SQLite writes only inside a rusqlite transaction. |

## 1. Economy protocol — roundtrips are the scarce resource

The account is rate-limited on **requests** (5-hour / daily windows). Every assistant
turn that fires tools and waits for results spends against it; tokens do not. Behave
accordingly.

- **E1 — Batch.** All independent tool calls go in ONE message. Never serialize what
  can run in parallel.
- **E2 — Chain.** Dependent shell steps go in ONE call joined with `&&` (or `;` where
  a failure is tolerable): `cargo check -p x && cargo test -p x <name>`. Never one
  check per call.
- **E3 — Trust the card.** §0 values are measured. Do not run `git rev-parse`,
  `git log`, or `git status` just to orient. Suspect staleness → refresh via §7.5,
  folded into a call you already need.
- **E4 — Read whole files.** One read per file, up to 2,000 lines. The old
  ≤500-line chunk rule is retired: requests are scarce, context is not.
- **E5 — Brief completely, wander never.** Exploration order: `codebase-memory-mcp`
  → Grep/Glob → ONE Explore subagent for open-ended searches. A subagent's prompt
  carries the question, candidate paths, and the exact output shape; its internal
  calls are billed too, so a wandering agent is worse than none.
- **E6 — Assume, don't ask (reversible only).** Local, reversible decisions: pick the
  most reasonable option, note the assumption inline, proceed. Money, migrations,
  branches, plan filenames, the shared index: ask first. When asking is unavoidable,
  batch ALL open questions into ONE message.
- **E7 — Don't re-read.** Context already injects this file and the project layout —
  never read what is injected. Never re-read a file just to edit it; the edit tool
  matches against disk itself.
- **E8 — Verify once.** At the end, with the narrowest applicable gate, chained per
  E2. Do not re-verify intermediate steps.

**Roundtrip budget** (expected, not enforced — a task that blows past its row stops
and re-plans instead of grinding):

| Task type | Canonical path | Budget |
|---|---|---|
| Doc / plan edit | Edit → commit, with `git show --stat` chained into the same call | 2–3 |
| Single-crate change | Batched whole-file reads → edit (code + `*_tests.rs`) → `cargo check -p && cargo test -p` → commit | 5–8 |
| UI change | Read → edit → `npm run lint && npm run typecheck` (from `ui/`) → commit | 4–6 |
| Migration change | Edit `*.sql` + registry in `migrations.rs` → `python3 scripts/generate-pg-migration.py` → commit both paths | 5–8 |

## 2. Pre-commit gates — seven steps

Opt in per clone: `git config core.hooksPath .githooks`. Each step fires only on the
paths it cares about:

1. **Line-ending normalization**
2. **Bundle parity**
3. **FTL dedupe dry-run**
4. **Migration column-type lint**
5. **PG schema drift guard**
6. **Go gate**
7. **FTL orphan lint**

The labels are bold for a reason: `scripts/verify-agents-mirrors.py` grades this list
(`N. **name**`) against the hook's own section names, and an unbolded list is read as a
numeral alone, which leaves the names ungraded.

Per-step commands and CI backstops: `docs/operations/agent-gates.md`. `cargo fmt` is
not a pre-commit step (removed 2026-09-13); formatting is check-only via pre-push,
`dev-ci.yml#cargo-check`, `scripts/check.sh`, and `scripts/release.sh`.

## 3. Critical directives (MUST FOLLOW)

| Rule | Direct instruction | Why / context |
|---|---|---|
| **Branching** | **NEVER create new branches. NEVER switch branches.** | Always work directly on the currently active branch unless specifically requested by the user. |
| **Commits** | **ALWAYS commit with format `<type>(<area>): <description>`.** | Conventional commits, after each logical task — the permitted *form* is the Commit Writing row below and §7. |
| **Commit Writing** | **NEVER `git add` (sole exception: the §7.3 one-line new-file chain), NEVER `git stage`, NEVER `git commit -a`, NEVER `git commit --amend`, NEVER `git stash`. Only ONE line with an explicit pathspec: `git commit -m "<type>(<area>): <subject>" -- path/one path/two`.** | The shared checkout's index is a single racing object — see §7.3. |
| **Pushing** | **NEVER run `git push` without an explicit direct order.** | Even after all checks pass, wait for the user to say "push". |
| **Version Lock** | **Version is locked at `0.0.41`. NEVER modify version numbers.** | `Cargo.toml`, `package.json`, `tauri.conf.json`, etc. |
| **File Paths** | **ALWAYS use forward slashes (`/`) in path arguments on Windows. NEVER hardcode the checkout root** — resolve via `git rev-parse --show-toplevel` or script-relative (`$PSScriptRoot` / `__file__` / `import.meta.url`). | Escaping bugs; multi-root worktree layout. |
| **File Reading** | **ALWAYS read whole files in ONE call (≤ 2,000 lines). Never chunk-read.** | Roundtrips are the scarce resource, not context (E4). |
| **Discovery** | **ALWAYS use `codebase-memory-mcp` first; fallback order Grep/Glob → ONE Explore subagent (E5).** | Graph discovery saves requests; the fallback keeps the mandate actionable when the tool is absent. |
| **Currency** | **ALWAYS use `Money` struct (`i64` minor units). NEVER use float.** | Monetary values must never be `f32`/`f64`. Agent-enforced; no gate. |
| **DB Writes** | **ALWAYS use `rusqlite` transactions for database writes.** | Never write to SQLite outside an explicit transaction. Agent-enforced; no gate. |

## 4. Global environment variables (mixed prefixes — read the list)

API keys live as **user-scope Windows environment variables** (HKCU\Environment;
survive reboots, visible in every NEW PowerShell session — the session that set them
must be reopened). Source of truth: the gitignored `.env` at the repo root.

**There is no single prefix.** The rename to `KASIRMU_*` is mid-migration and has
reached the deploy tooling but not the server config: deploy tokens are `KASIRMU_*`,
the server's own knobs are still `OZ_*`, and at-rest encryption has moved to
`KASIRMU_MASTER_KEY` with `OZ_MASTER_KEY` still read as a legacy alias. Copy the names
below verbatim; do not normalise them to one prefix.

```powershell
$env:KASIRMU_CLOUDFLARE_API_TOKEN        # Cloudflare Workers deploy token
$env:KASIRMU_CLOUDFLARE_ACCOUNT_ID       # Cloudflare account id
$env:KASIRMU_CLOUDFLARE_ACCESS_KEY       # R2 access key id
$env:KASIRMU_CLOUDFLARE_SECRET_ACCESS_KEY# R2 secret access key
$env:KASIRMU_CLOUDFLARE_S3_ENDPOINT      # R2 S3 endpoint
$env:KASIRMU_NORTHFLANK_API_TOKEN        # Northflank deploy token
# The four below are the SERVER's names, not KASIRMU_* ones. The codebase is
# mid-migration: deploy tokens above are KASIRMU_*, these are still OZ_*, and
# setting a KASIRMU_ spelling of one of these does nothing -- the server reads
# OZ_ and falls back to its default, which fails open. Verified against
# apps/cloud-server/src/config.rs (round-5 check-env-docs scope) and
# apps/license-server. KASIRMU_MASTER_KEY below IS correct: kasirmu-crypto reads it.
$env:OZ_ADMIN_KEY                        # admin dashboard API key
$env:OZ_API_SECRET                       # JWT signing secret
$env:OZ_ENFORCE_PLANS                    # plan gating flag
$env:OZ_LICENSE_PRIVATE_KEY              # RSA license signing key (PEM, multiline)
$env:KASIRMU_MASTER_KEY                  # at-rest master key (64 hex); OZ_MASTER_KEY is the legacy alias, still read
```

- Use them in commands instead of hardcoding secrets (example: website deploy sets
  `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` from the `KASIRMU_*` pair, then
  `npm run deploy` from `website/`).
- Update `.env` → variables by re-running the save step (same names/prefix); never commit `.env`.
- ⚠️ Plaintext in the user registry — local-dev convenience, not a secrets manager.

## 5. Running CLI tools on Windows

> 🛑 **Run shell scripts through Git's bash by full path** — `& 'C:\Program Files\Git\bin\bash.exe' -c 'bash scripts/wtree-guard.sh check'`. Bare `bash` resolves to WSL here and hangs until killed; under WSL, `npx vitest` also crashes against Windows-built `ui/node_modules`. A `bash` call that times out with no output is a shell-resolution problem, not a broken script.

### 5.1 UI & front-end (TypeScript / ESLint / Vite)

> ⚠️ `tsc` and `eslint` are **project-local** in `ui/node_modules/.bin/`, NOT on PATH.
> **ALWAYS run npm scripts from inside `ui/` (`npm run <script>`).** Never bare `tsc`/`eslint`.

| Task | Command (from `ui/`) | Description |
|---|---|---|
| **All UI gates** | `npm run check:all` | Chained: lint → typecheck → test → i18n → E2E |
| **Type check** | `npm run typecheck` | TypeScript project type-check |
| **Lint** | `npm run lint` | ESLint (a11y + React rules) |
| **Lint auto-fix** | `npm run lint:fix` | ESLint with auto-fix |
| **Unit tests** | `npm run test` | Vitest |
| **Build bundle** | `npm run build` | Validates bundle compilation |
| **E2E** | `npm run e2e` | Docker backend + Vite + Playwright + cleanup |
| **E2E UI subset** | `npm run e2e:ui` | Playwright UI spec subset |
| **E2E + rebuild** | `npm run e2e -- --build` | Rebuilds stale images first |

> **Stale-image guard:** `run-e2e.mjs` refuses to start when a locally-built image
> predates its sources (exit 3) — re-run with `--build`; skipped under `CI`.

*Missing `node_modules`: `cd ui && npm ci --no-audit --no-fund`.*

- **No linter sees `.css`** — never cite `eslint` for a stylesheet. Verify with the
  five walker suites; command and caveats: `docs/records/audits/frontend/css-verification.md`.

### 5.2 Rust backend

- **Iteration:** quick check `cargo check -p <crate>`; single test
  `cargo test -p <crate> <test_name>`.
- 🛑 **NOT during routine iteration:** `cargo clippy`, `cargo test --workspace`.
- **Pre-push / final only:** `cargo fmt --all`; then
  `cargo clippy --all-targets --all-features -- -D warnings` (must resolve all
  warnings — CI's `dev-ci.yml#cargo-clippy` job runs `--workspace --all-targets`
  and fails on any warning, but it does **not** pass `--all-features`, so that
  lane is yours alone);
  then full workspace tests.

## 6. Architecture & coding standards

### 6.1 Rust
- Every public function/struct/enum/trait carries a doc comment (`///`).
- Every production `.rs` file starts with a module doc (`//!`, 5–15 lines: purpose,
  key types, main functions, invariants).
- `thiserror` for error types; `anyhow` for application-level propagation.
- **Money:** integer minor units (`i64`) via `Money`. Never `f32`/`f64`.
- **DB writes:** inside a `rusqlite` transaction.

### 6.2 Test file organization
- Production `.rs` files under 1,000 lines (preferably < 600).
- **Never put unit tests inside production `.rs` files.** Sibling `*_tests.rs`
  (`sales.rs` → `sales_tests.rs`), wired at the bottom of the production file:
  `#[cfg(test)] #[path = "sales_tests.rs"] mod tests;` — and `use super::*;` at the
  top of the test file. Integration tests live in the crate's top-level `tests/`.

### 6.3 Tauri & UI
- Tauri IPC commands live in `apps/desktop-tauri/src/commands/` or
  `apps/mobile-tauri/src/commands/`, registered in the shell's `lib.rs`.
- Front-end calls route through `ui/src/api/` — **never `invoke(...)` inside React
  components**.
- **"Settings" disambiguation:** the Tauri Settings page is
  `ui/src/features/settings/SettingsPage.tsx` (route `settings`, master–detail, top-right
  Save). Not `ui/src/api/settings.ts`, not `SettingsContext.tsx`, not `settings.rs` IPC,
  not the core settings service/DB, not `modules/settings/` (a kernel lifecycle stub).
- **Dead-screen checks need three greps, not one.** Screens register lazily
  (`lazy(...)` + `registerPage`/`registerNavItem` in `ui/src/features/*/register.tsx`),
  so an import search finds nothing on a live screen. Check the screen name, then
  `route: '<route>'`, across `ui/src` — and never trust a truncated hit list, since
  `ui/src/__tests__/` sorts before `ui/src/features/`.
- **⚠️ A `:!` pathspec built by inline string concatenation silently matches nothing**
  in PowerShell argument position. Build exclusion pathspecs as their own variable and
  sanity-check any zero-reference dead-code claim with one unfiltered `git grep`.
- **Accessibility:** ARIA labels on components; pass `eslint-plugin-jsx-a11y`.
- **Localization:** all user-visible strings via `@fluent/react`; no hardcoded English.

### 6.4 Database & hardware
- **HAL drivers:** every driver has a mock in `crates/kasirmu-hal/src/drivers/mock.rs`.
- **SQLite is the schema source of truth:** `crates/kasirmu-core/migrations/*.sql` +
  the registry in `migrations.rs` (registry order canonical). See
  `docs/records/sqlite-pg-roles.md`.
- **`init.pg.sql` is generated, never hand-edited:** after any migration change run
  `python3 scripts/generate-pg-migration.py` and re-stage
  `crates/kasirmu-core/migrations/20260813_init.pg.sql`. Pre-commit step 5 and
  `dev-ci.yml#static-gates` fail on drift.
- **Postgres drift:** when modifying PG schemas, re-sync the shared dev container with
  `scripts/reset-dev-pg.sh` — run through Git's bash by full path (§5); bare `bash`
  resolves to WSL here and hangs.

## 7. Git & Commit Policy

### 7.1 Branch policy
- **Never create new branches unless specifically asked. Never switch branches.**
- Naming (only when explicitly requested): `feat/<name>`, `fix/<name>`, `docs/<name>`,
  `chore/<name>`, `test/<name>`, `refactor/<name>`.

### 7.2 Commit format
`<type>(<area>): <description>` — subject enforced by `.githooks/commit-msg` (bodies
free-form; `Merge …`/`Revert …`/`fixup!`/`squash!`/empty pass through; hook needs
`core.hooksPath`). Types: `feat` `fix` `docs` `chore` `test` `refactor` `style`
`perf` `ci` `audit` `build`. Area: domain/crate/component, lowercase. Description:
imperative, present tense ("add gift card tender"). `build` covers build-system and
dependency-packaging changes (Docker stages, cache priming) and joined 2026-10-01,
when `c5fee807` landed with it and could not be amended; the list in
`.githooks/commit-msg` is the enforced copy and the two must stay identical.

### 7.3 Cadence & push rule — and the shared-index protocol
- **Commit after each logical task once verified locally.**
- **Never `git push` without an explicit, direct order** — even after all checks pass.
- Never commit secrets, `.env`, or SQLite databases (`*.db`, `*.sqlite`).
- **⚠️ Multiple agents commit to this branch concurrently. The ONLY permitted form is
  ONE line with an explicit pathspec** — `git commit -m "<type>(<area>): <subject>" -- path/one path/two`. Never bare `git commit`, never `-a`, never `git add`/`git stage` as a
  separate step. A pathspec commit takes tracked files from the working tree (no prior
  `add` needed) and cannot collect what another session staged. If `git commit` reports
  nothing to commit, **your work may already be in someone else's commit** — check
  `git show --stat HEAD` before concluding anything was lost.
  ```bash
  git commit -m "<type>(<area>): <subject>" -- path/one path/two   # one line, no prior add, only your files
  git show --stat                                                   # prove the file list is exactly yours
  git status --porcelain                                            # after committing: confirm leftovers are theirs
  ```
- **⚠️ New files are the one case the no-staging rule needs its own form.** A bare
  pathspec commit rejects untracked paths; new files go through ONE chained line:
  `git add -- new/one new/two && git commit -m "<type>(<area>): <subject>" -- new/one new/two`.
  The `add` lists **only untracked new paths**; the commit pathspec is a superset of the
  add list. If the commit half fails (usually `index.lock` held by a concurrent agent),
  **re-run the whole line, never the commit alone.** Verify with `git show --stat` that
  the `create mode` entries are exactly your files.
- **⚠️ Never leave anything staged, even your own.** Inspect paths immediately before
  naming them (`git --no-optional-locks status --porcelain -- path/one path/two`). A
  pathspec commit records the working-tree copy — if another session has uncommitted
  edits in the same file, your commit sweeps them in. A path that is dirty with content
  that is not yours: stop and say so.
- **⚠️ Never `git commit --amend`, `git reset`, or `git stash` on a shared branch.**
  An amend re-commits the whole index and inherits whatever another agent staged since
  you last looked — the index is a racing value. Stashing removes their uncommitted work
  with no trace. The recovery for a bad commit is a NEW commit that undoes it
  (`git revert`, recorded with a pathspec line); to tell committed apart from in-flight,
  compare `git show HEAD:<path>` against the file on disk.
- **⚠️ Not every ` M` is content.** Under `text=auto` a file can show modified while its
  bytes equal the HEAD blob — compare `git hash-object <path>` with `git rev-parse :<path>`;
  matching hashes mean nothing to commit.

### 7.4 Plan-doc naming is a checker token, not just a convention
- **`done-todo-*` is earned ONLY when that file's own acceptance command was RUN and
  PASSED.** Anything else stays `todo-`. Parked/superseded states belong in a dated
  header line, never the filename. Renames happen in place at the repo root.
- **A tool reads the name:**
  `.agents/skills/docs-auditor/scripts/check-dead-refs.py` exempts any doc whose name
  contains `todo-`, `plan-`, or `prd-` — keep the token wherever the file lives.
- **Never rename or move another session's uncommitted plan file** — the name is shared
  state, like the index.
- **`done-` is earned by an acceptance, and a BULK rename does not earn it.** This clause was
  added 2026-10-07 after `68cecff21` archived ten plan files in one commit under the subject
  *"archive completed pre-rebrand todo files to .agents/ with done- prefix"*, with an `R100` on
  each and no acceptance run — seven of the ten argue against the prefix in their own text.
  The rule above was already correct and was simply not read: a rename that classifies a batch
  cannot have run each file's own command. **If a file is archived without its acceptance
  being satisfied, say so in the file** (an *ARCHIVED, NOT EARNED* note naming the commit that
  renamed it) rather than leaving the prefix to be read as a pass. Archival and acceptance are
  different facts and the filename carries only one of them.

### 7.5 Orientation & freshness (the only sanctioned probes)
When §0/§2 values must be re-verified, run these — chained (E2) into a call you already
need, never as standalone orientation:
```bash
git rev-parse --abbrev-ref HEAD      # current branch (expect: 0.0.41)
git config --get core.hooksPath      # gates enabled? (expect: .githooks)
git rev-parse --show-toplevel        # repo root
```

> last audited 27-09-26 by BK
>
> roundtrip-economy rewrite; prior stamp 08-09-26. The line above IS the audit footer and is
> shape-checked by the skill drift guard, so it stays exactly `> last audited DD-MM-YY by <name>`:
> trailing detail on that line fails Check 10.
