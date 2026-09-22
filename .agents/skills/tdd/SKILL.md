---
name: tdd
description: Test-driven development workflow for kasir.mu — the 7-phase loop (Analyze → Find Weaknesses → Red/Green/Refactor → Verify → Journal → Update Docs → Commit), the fast TDD loop tooling (scripts/test-tdd.sh, [profile.tdd], nextest), and per-layer testing conventions. Use when fixing a bug, adding a feature test-first, or running a TDD cycle in any kasirmu-* crate, platform/*, modules/*, app, or ui/.
---

<!-- Audit stamp: 2026-09-22 · Budak-Korporat · status: ACCURATE — 0 findings · Audited against branch `0.0.39` at `e56bf8307`, working tree clean. Re-measured this pass: `grep -c '^# ──' .githooks/pre-commit` returns **7**, matching the "seven gates" claim and the enumerated list (LF normalization, staged bundle parity, FTL dedupe, migration column-type lint, PG drift guard, Go, FTL orphan lint). The version-lock claim reads `0.0.39`, which matches `Cargo.toml:37`. All 16 paths the file cites exist, including `scripts/{check.sh,test-tdd.sh,test-changed.sh,test-ui-changed.sh,run-pre-push.py,scan-unwrap-panic.py,verify-agents-mirrors.py,wtree-guard.sh}`, `docs/{guides/api-reference.md,guides/user-guide.md,records/JOURNAL.md,specs/_active/}`, `.github/workflows/attic/ci.yml.bak`, `crates/kasirmu-hal/src/drivers/mock.rs` and `platform/sync`. The `oz-*` naming drift the 18-09-26 audit found in the description and Phase 1 is confirmed repaired. · NOT re-measured: the TDD loop timings and the gate-by-gate runtime. -->

<!-- Superseded audit stamp: 2026-09-03 · DSH · status: ACCURATE at audit time (0 findings on 22-09-26) (rev 2 — Rust test convention corrected in Phase 3 and the per-layer table: unit tests live in sibling *_tests.rs files wired via #[cfg(test)] #[path = ...] mod tests (never inline in the production file — AGENTS.md rule); UI bundle names corrected en.ftl/id.ftl → per-feature <feature>.ftl/<feature>.id.ftl; push rule softened to match AGENTS.md (never push without an explicit direct user order — not "refuse even then"); 'audit/ numbered findings' reference removed (no such dir); pre-commit gate list updated to the six core gates + Go gate) · verified this pass: [profile.tdd] in workspace Cargo.toml, scripts/{test-tdd,test-changed,test-ui-changed,wtree-guard}.sh + scan-unwrap-panic.py, docs/guides/{api-reference,user-guide}.md, JOURNAL.md all exist -->

# TDD Workflow — Test-Driven Development for kasir.mu

TDD is the default way to change code in this repo: it makes bugs reproducible before they are fixed, keeps every fix attached to a regression test, and produces small, reviewable, well-documented commits.

---

## When to use

- Fixing a bug (reproduce it with a failing test first).
- Adding a feature or behavior change (write the spec as a test first).
- Refactoring (the existing test suite is the safety net; add tests for any gap you find).
- Reviewing someone else's change (check whether it was test-driven and whether the test actually pins the behavior).

Not for: pure docs, dependency bumps, or mechanical renames with no behavior change — those still follow the Verify + Commit phases but skip the Red/Green cycle.

---

## Golden rules

| # | Rule | Why |
|---|------|-----|
| 1 | **Test first. Never write implementation code without a failing test in flight.** | The test is the specification. Without Red first, "Green" proves nothing. |
| 2 | **Pick the smallest valuable slice.** | A one-behavior cycle is fast, reviewable, and bisectable. Big changes are many small TDD cycles. |
| 3 | **Every fix ships with its regression test.** | The test is the only durable record of the bug. No test, no fix. |
| 4 | **Evidence over assertion.** | "I think this is slow/broken" is not a finding. A failing test, a log line, or an audit entry is. |
| 5 | **Verify only the area you changed during the loop.** | Area-scoped tests (`test-tdd.sh` / `test-changed.sh` / `test-ui-changed.sh`) catch regressions fast. Full `check.sh` is reserved for pre-push or explicit request. |
| 6 | **Journal, docs, and commit while context is fresh.** | The 20-minute-old-you knows why the code is the way it is. Record it before it evaporates. |
| 7 | **Never kill running processes — other agents work in the same tree.** | Do not stop any `.exe` or running process; another agent or the user may still need it. |
| 8 | **Never `git push` without an explicit, direct user order.** | This skill ends at commit. Even after everything is green, stop and let the user say "push" (AGENTS.md). |

---

## The 7-phase loop

### Phase 1 — Analyze

Understand the current state and pick the smallest valuable slice.

1. **Read the layer skill first** — `rust-backend` (kasirmu-* crates), `ui-components` (React/TS), `tauri-ipc` (commands + `pos.ts`), `hal-drivers` (hardware). The skill names the conventions the code must follow.
2. **Read the relevant code** — the module, its existing tests, and its callers. Note what is *not* tested yet.
3. **Scope the slice** — one behavior, one error path, one invariant. Write it down as a sentence: *"When X happens, the system must Y."*

### Phase 2 — Find Weaknesses

Spot concrete problems with evidence.

| Evidence source | What to look for |
|---|---|
| Failing tests | `cargo nextest run -p <crate>` / `npm run test` failures — flaky, skipped, or wrong |
| Logs | `tracing` error/warn lines, panic traces, sync daemon errors |
| Audit docs | numbered findings in docs/records/ and `JOURNAL.md` entries |
| Code review | A prior review flagged this path; the review comment is evidence |
| `scripts/scan-unwrap-panic.py` | Production `unwrap()`/`expect()` without `// SAFETY:` / `// INVARIANT:` |
| `cargo clippy -D warnings` | Warnings are bugs-in-waiting |

Reproduce the weakness in a test before touching any implementation.

### Phase 3 — TDD: Red → Green → Refactor

The core cycle. Use the fast loop (below) so each iteration is seconds, not minutes.

**Red — write the failing test.**

- Prefer the smallest possible failing test that still expresses the desired behavior. One assertion is usually enough for the first Red.
- Rust: add the failing test to the module's sibling `*_tests.rs` (e.g. `sales.rs` → `sales_tests.rs`, wired via `#[cfg(test)] #[path = "sales_tests.rs"] mod tests;` — never inline in the production file).
- UI: add a test in `ui/src/__tests__/` for the component/hook you're changing.
- Run it and confirm it fails **for the right reason** — the assertion, not a compile error.
- Test the *behavior*, not the implementation: assert on return values, DB state, rendered output, or emitted events — not on which private function got called.

**Green — minimal code.**

- Write the smallest change that makes the test pass. No gold-plating, no speculative generality.
- Follow the layer skill's conventions: `Money` in i64 minor units, `rusqlite` transactions, `thiserror` errors, `<Localized>` for user-visible strings.
- If the test passes without any code change, it was a bad test — either it doesn't pin the behavior or it's testing something that already worked. Fix the test.

**Refactor — clean up with the safety net on.**

- Remove duplication, rename for clarity, extract helpers. The test must stay green.
- Run `cargo fmt` on the changed files.
- Repeat the cycle for the next slice.

### Phase 4 — Verify

> 🛑 **On Windows, run these through Git's bash by full path.** Bare `bash scripts/...` resolves to
> `C:\Windows\System32\bash.exe` — WSL, not Git Bash — and it **hangs** rather than failing:
> `c:\windows\system32\bash.exe -c 'echo wsl-ok'` never returned in 12s, while
> `C:\Program Files\Git\bin\bash.exe -c 'echo gitbash-ok'` returned instantly. A hang attributes to
> the script, so the reasonable-looking conclusion is "wtree-guard is broken", which is false — and
> skipping the drift check because it hangs loses exactly the protection it exists to give. Use
> `& 'C:\Program Files\Git\bin\bash.exe' -c 'bash scripts/wtree-guard.sh check'`. See
> [`AGENTS.md`](../../../AGENTS.md) § *Running CLI Tools on Windows*; the same root cause produced
> an opposite-looking symptom on 2026-08-22 (WSL runs the Linux node against Windows-built
> UI dependencies, so vitest crashes on the missing `rollup-linux-x64` binary and the i18n gate
> appears red when nothing in the repo is wrong).

Confirm the fix and no regressions — **scoped to the area you changed**. Full `scripts/check.sh` is **not** part of routine TDD validation.

Required during the loop:

```bash
bash scripts/test-tdd.sh -p crates/kasirmu-core   # the crate you changed — [profile.tdd] + nextest
bash scripts/test-changed.sh                 # only crates touched vs origin/main
bash scripts/test-ui-changed.sh              # only UI tests affected by changed files
cargo fmt --all -- --check                   # formatting gate
bash scripts/wtree-guard.sh check            # nothing changed under you since you verified
```

`-p` takes a crate **directory** (`crates/kasirmu-core`), not a package name. The script resolves cargo across PowerShell / Git Bash / WSL PATHs; if it cannot find one, set `CARGO=/path/to/cargo` rather than editing the script.

Static checks on the changed area:
- Rust: cargo clippy -p <crate> -- -D warnings
- Front-end: npm run lint and npm run typecheck from ui/

Full gate — only before pushing or when explicitly required:

```bash
bash scripts/check.sh          # mirrors CI (fmt, clippy, nextest, migrations, UI, i18n, drift) — NOT part of routine TDD validation
```

### Phase 5 — Journal

Record the why, decisions, and remaining risks — while fresh.
- `docs/records/JOURNAL.md`: append a dated entry. Follow the existing format — ### <date> — <title>, then Problem: / Solution: / Commits: / test counts. (Was at the repo root until `f3d9cca6`; an agent following the old instruction creates a second journal at the root rather than appending to the real one.)
- Note remaining risks and follow-ups explicitly — a known limitation written down is a future TDD slice.
- Do not put CHANGELOG entries here (that belongs in Phase 6).

### Phase 6 — Update Docs

Sync anything the change affects.

- The affected layer's README, `docs/guides/api-reference.md`, `docs/guides/user-guide.md`, examples, or the code's `///` doc comments.
- If the change touches a path/type/trait/convention a skill describes, run the drift guard:
  ```bash
  bash .agents/skills/skill-drift-guard/scripts/detect.sh
  ```
- Spec-driven changes (`docs/specs/_active/`): update `plan.md` / `validation.md`, then move the folder to `_done/` when complete.

### Phase 7 — Commit

Small, focused, well-described — while context is fresh.

- Branch naming: `feat/<name>`, `fix/<name>`, `test/<name>`, `refactor/<name>`, `docs/<name>`, `chore/<name>`.
- Conventional Commits: `fix(sync): quarantine poison remote items after retry budget` — summary ≤ 72 chars, imperative mood, body explains *why*.
- One behavior per commit. The commit is the unit of review and bisect.
- The `.githooks/pre-commit` hook runs automatically if `core.hooksPath` is set — don't bypass with `--no-verify`; fix the issue instead. **Source of truth is the hook itself: `grep -n '^# ──' .githooks/pre-commit`, and `AGENTS.md` enumerates every step with its rationale.** As of 0.0.39 there are seven: LF normalization, staged bundle parity, FTL dedupe, migration column-type lint, PG drift guard, Go, and FTL orphan lint (step 7, fires only when a `.ftl` is staged). cargo fmt was a pre-commit step until 2026-09-13, when it was removed — the step ran `cargo fmt --all`, the whole workspace, so under concurrent agents it reformatted every other session's in-flight `.rs` files in the working tree; formatting is now check-only (`cargo fmt --all -- --check`) in pre-push/CI/`check.sh`/`release.sh`. Heavy UI typecheck and Vitest i18n run under pre-push (`scripts/run-pre-push.py`) and CI. `scripts/verify-agents-mirrors.py` polices `AGENTS.md` and its mirrors against the hook, so a restated count that disagrees is a red build.
- **Never run `git push` without an explicit, direct user order.** The default end state is a local commit plus a report; the human pushes.

---

## Working alongside other agents

This repo is often edited by several agents and the user concurrently. TDD cycles run in the same working tree as everyone else.

- **Never stop or kill a running process.** Do not `taskkill`, `kill`, or terminate any `.exe` (dev servers, `esbuild.exe`, `node.exe`, Tauri, Vite, etc.) — another agent or the user may still need it. If a script fails because a process is busy, leave it running and note the conflict instead.
- **Inspect existing listeners before choosing a port.** If you need a dev server or test runner, check what is already running first and reuse it.
- **Own your files and hunks.** Stage and commit only what you changed — avoid broad `git add -A`; never discard or overwrite another agent's uncommitted work. Note that `git commit -- <path>` commits the **working-tree version of that path**, not "your hunks": if someone else has in-flight edits to the same file they land in your commit. Re-run the tests for that path immediately before committing, not minutes before.
- **Track the drift window with `scripts/wtree-guard.sh`.** Claim the files you are working on, stamp them once your tests pass, and check again right before you commit:
  ```bash
  bash scripts/wtree-guard.sh own crates/kasirmu-core/src/cache.rs   # claim
  bash scripts/wtree-guard.sh verify                            # after tests pass
  bash scripts/wtree-guard.sh check                             # immediately before commit; exit 1 on drift
  ```
  It reports `OK` / `DRIFT` / `REVERTED` / `DELETED` per file and tells you when HEAD moved under you. It is opt-in, not a hook: the claim file is per-repository, so enforcing it in `pre-commit` would let one agent's claim block another agent's commit.
- **Assume the tree moves under you.** Re-check `git status` and the current branch before any consequential git operation. Another agent's `git stash` or `git checkout --` can silently replace an in-flight file — the symptom is not an error, it is tests behaving impossibly. If `wtree-guard check` says `REVERTED`, look for a stash entry and restore **without popping** (`git checkout 'stash@{N}' -- <path>`), leaving other agents' stashes intact.
- **After restoring a file, touch its mtime.** PowerShell's `Copy-Item` preserves the *source* file's timestamp, so a restored file can look older than the build artifact compiled from the wrong version — and cargo will silently re-run the **stale binary**, making a working fix appear broken. Use `(Get-Item <path>).LastWriteTime = Get-Date` after any restore, and hold test scope constant when comparing two states of the tree.

---

## The fast TDD loop

The workspace ships a dedicated TDD profile and scripts so Red→Green→Refactor iterations are seconds long.

### `scripts/test-tdd.sh` — the core loop

```bash
bash scripts/test-tdd.sh -p crates/kasirmu-core   # compile + test one crate via nextest
bash scripts/test-tdd.sh                 # auto-detect the crate from cwd
bash scripts/test-tdd.sh --watch         # re-run on every .rs change (recommended)
bash scripts/test-tdd.sh --vanilla       # fall back to cargo test (no nextest)
```

`-p` takes the **crate directory path** (e.g. `crates/kasirmu-core`, `platform/sync`) — not the package name — because the script resolves `--manifest-path <dir>/Cargo.toml` from the workspace root.

It sets `CARGO_PROFILE=tdd`, which uses the `[profile.tdd]` section in the workspace `Cargo.toml` (inherits `dev`, `debug = false`, `incremental = true`) — the fastest possible edit-compile-test cycle. Recommended workflow:

```bash
cd crates/kasirmu-core
bash scripts/test-tdd.sh --watch
```

If the fast loop is broken (script missing, nextest not installed, profile absent, etc.):
- `test-tdd.sh` names the missing piece itself (cargo, cargo-nextest, cargo-watch) and falls back to `cargo test` when nextest is absent — read its message before working around it.
- Fall back to cargo test -p <package> or cargo nextest run -p <package>.
- For UI: cd ui && npm run test -- <file> or npm run test:watch.
- Note the breakage in the Journal so it can be fixed later.

### Support scripts

| Script | What it does |
|---|---|
| `scripts/test-tdd.sh` | Fast loop for one crate (`--watch`, `-p <crate-dir>`, `--vanilla`) |
| `scripts/wtree-guard.sh` | Detect concurrent drift in files you claimed (`own`, `verify`, `check`, `status`, `release`) |
| `scripts/test-changed.sh` | Runs tests only for crates whose files changed vs `origin/main` (`--all`, `--check`, `--vanilla`) |
| `scripts/test-ui-changed.sh` | `vitest --changed` — only UI tests affected by changed files (`--all`, `--check`) |
| `scripts/check.sh` | The FULL local matrix, run by hand. NOT what `git push` runs — `.githooks/pre-push` invokes `scripts/run-pre-push.py`, a subset of these steps that never calls check.sh — and it mirrors no workflow: the `ci.yml` workflow under `.github/workflows/` was retired to `.github/workflows/attic/ci.yml.bak` at `23c96330`, so the live pair is `dev-ci.yml` and `release.yml` |

### UI loop

```bash
cd ui
npm run test                 # full vitest suite
npm run test -- <file>       # single test file (vitest filter)
npm run test:watch           # vitest watch mode — the UI TDD loop
npm run typecheck            # strict TS
npm run check:all            # lint → typecheck → test → i18n → E2E (Docker-aware)
```

---

## Per-layer testing conventions

| Layer | Test location | Conventions |
|---|---|---|
| Rust crate (`kasirmu-*`, `platform/*`, `modules/*`) | sibling `*_tests.rs` per module, wired via `#[cfg(test)] #[path = ...] mod tests;` | Every new module needs ≥ 1 unit test (AGENTS.md). Tests never live inline in production files. Tests may use `unwrap()`/`expect()` freely. DB tests use transactions and assert atomicity (rollback on error). |
| HAL driver | `crates/kasirmu-hal/src/drivers/mock.rs` | Every driver needs a **mock** — required by the coding standard (`AGENTS.md` → *Database & Hardware* → **HAL Drivers**), enforced by review only — no CI job, no hook step and no checker under `scripts/` looks for it, so an unmocked driver reaches main and the first person to run it on a machine without that hardware finds out. The mock is also the harness: tests and hardware-free dev machines can only exercise a driver through it. |
| Tauri command | sibling `*_tests.rs` in the commands module + IPC contract tests in `ui/src/__tests__/` (the `api-*-contract.test.ts` files) | `invoke` calls go through `ui/src/api/`; contract tests pin the wire shape. |
| React component/hook | `ui/src/__tests__/` | One test file per component/hook. Use `<Localized>` ids that exist in both the English `.ftl` and the `.id.ftl` bundle for the feature (bundle-parity gate fails otherwise). |
| Money logic | anywhere in `kasirmu-core`/`foundation` | Assert on `minor_units: i64`, never `f32`/`f64`. Test `checked_add`/`from_major` overflow and currency-mismatch paths. |

---

## Common pitfalls

1. **Skipping Red.** Writing the fix first and the test after — the test then validates the fix instead of pinning the bug. Write the test, watch it fail, then fix.
2. **Testing implementation details.** Asserting on private helpers or call counts makes refactoring impossible. Assert on observable behavior.
3. **Green without refactor.** Passing test + messy code = the next slice gets harder. Refactor while the test is green.
4. **Full-workspace tests during iteration.** `cargo test --workspace` / `check.sh` are minutes. Use `test-tdd.sh`/`test-changed.sh` during the loop and reserve `check.sh` for pre-push.
5. **Committing without Verify.** "It passes my one test" is not enough. At minimum run the changed crate's tests + `fmt` + `clippy` before committing; run `check.sh` before pushing.
6. **Forgetting the regression test in a bugfix PR.** Without it, the bug WILL come back. Phase 3's Red test is the regression test — keep it.
7. **Journaling "what" instead of "why".** The diff already shows what. Record the decision, the tradeoff, and what you deliberately did NOT do.
8. **Killing processes or grabbing ports another agent needs.** This tree runs concurrently — never terminate a running `.exe` or take over a busy port. Inspect existing listeners first and reuse what's running.
9. **Committing a file you verified "a few minutes ago".** `git commit -- <path>` commits the working-tree version of that path, so another agent's in-flight edits ride along — a shared `*_tests.rs` is the usual casualty, and it turns HEAD red without any error from git. Run `wtree-guard check` (or at minimum re-run that path's tests) *immediately* before committing, and fix forward rather than amending a commit someone may already be based on.
10. **Believing a stale binary.** PowerShell's `Copy-Item` preserves the *source* file's mtime, so a restored file can appear older than the artifact built from the wrong content — cargo then re-runs the stale binary and a working fix looks broken. Touch `LastWriteTime` after any restore. Related: when comparing two states of the tree, hold scope constant — an isolated test run and a full-package run are different experiments (package tests share process state).
11. **Declaring code untestable because it needs infrastructure.** A rule buried in a spawned thread or behind a feature flag is usually a pure decision wrapped in I/O — extract the decision, put it *outside* the cfg gate, and it becomes testable in the default build. Check what CI actually compiles (`nextest --workspace --all-features`) before assuming a path never runs.
12. **Pushing.** `git push` is never part of this skill's workflow — the default end state is a local commit plus a report, even when everything is green. Push only when the user gives an explicit, direct order (AGENTS.md), and stop at commit otherwise.

---

## See also

- **[`rust-backend`](../rust-backend/SKILL.md)** — Rust & DB standards the Green phase must follow (Money, transactions, errors).
- **[`ui-components`](../ui-components/SKILL.md)** — React/TS conventions, `<Localized>`, ARIA, strict TS.
- **[`tauri-ipc`](../tauri-ipc/SKILL.md)** — command registration + `ui/src/api/` wrappers.
- **[`hal-drivers`](../hal-drivers/SKILL.md)** — driver traits and the mandatory mock.
- **[`project-scaffold`](../project-scaffold/SKILL.md)** — workspace layout, CI matrix, Conventional Commits, spec workflow.
- **[`skill-drift-guard`](../skill-drift-guard/SKILL.md)** — run in Phase 6 after any change that touches a path/type/trait a skill describes.

---

> last audited 22-09-26 by Budak-Korporat
