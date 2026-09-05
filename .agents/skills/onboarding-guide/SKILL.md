---
name: onboarding-guide
description: Meta-skill that routes tasks to the right OZ-POS skill. Use when starting a new task and unsure which specialized skill applies. Read this first when joining the project or picking up an unfamiliar area.
---

<!-- Audit stamp: 2026-09-03 · DSH · status: ACCURATE (rev 2 — pre-commit gate count corrected: the hook now runs six gates (cargo fmt, i18n lint, bundle parity, FTL dedupe, migration column-type lint, PG schema drift guard) plus LF normalization and a conditional Go gate for apps/license-server; verified against .githooks/pre-commit itself) · verified this pass: the oz-lua, oz-payment, oz-security and oz-reporting crate READMEs, crates/oz-core/src/db/reports.rs, platform/sync, apps/cloud-server, scripts/test-tdd.sh, .agents/skills/skill-drift-guard/scripts/detect.sh all exist · prior: 2026-08-31 docs-auditor rev (obsolete-defer section rewritten; EdcTerminal/mlua/per-domain api fixes; embedded-hal removed) -->

<!-- Audit stamp: 2026-08-31 · docs-auditor · status: ACCURATE (obsolete-defer + convention refs repaired) · FIXED 31-08: 'Skills to defer (no code yet)' was obsolete — oz-lua/oz-payment/oz-security/cloud-sync/oz-reporting all ship code now; rewritten to 'Areas with code but no dedicated skill yet' pointing at each crate README; nonexistent PaymentTerminal trait -> EdcTerminal (hal-drivers); rlua -> mlua; pos.ts -> per-domain ui/src/api/<feature>.ts (router + workflow); device list NFC -> real (customer display, weight scale, EDC); embedded-hal -> async-trait · verified accurate: exit-animation-pattern skill exists, scripts verify-bundle-parity.py + dedupe-ftl.py + lint-i18n.sh + check.sh exist, .githooks/pre-commit 4-gate description matches -->

# OZ-POS Onboarding Guide

OZ-POS is a Rust + Tauri v2 POS framework. The codebase is organized into clear layers, and each layer has a dedicated skill. This guide routes you to the right skill for the work you want to do.

> *"Pay no attention to the man behind the curtain."* — The Wizard of Oz
>
> The OZ-POS philosophy: keep the **merchant's** experience effortless by hiding complexity behind a lean Rust engine. Skills are how we keep the engine clean.

## First-time setup

Before you read the skill router below, enable the project's pre-commit hook so its gates fire on every commit. Without this setup, the hooks are silently bypassed at commit time. **CI does fail-closed on bundle parity** — `dev-ci.yml#static-gates` runs `verify-bundle-parity.py` as a plain failing step with no `continue-on-error`, across `features,components,frontend,contexts,hooks,platform` and *without* `--staged-only`, so CI's scan is broader than the hook's. An earlier revision of this line asserted the opposite ("only as an informational stderr surface... Pre-commit is currently the only fail-closed path"), which stopped being true when the `i18n` and `static-gates` jobs were restored in 0.0.37 and would have told an agent to trust the hook over CI exactly backwards. **The hook is still the only thing that catches a bad commit before it is made**, and `core.hooksPath` is local config that `scripts/setup-dev.ps1` sets but never versions — so a fresh clone that skips setup has no local gate and learns about it only from CI.

```bash
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit
```

Once enabled, verify with `git config --get core.hooksPath` (output should be the path you set; empty result means the commands above didn't take). `.githooks/pre-commit` then runs **ten steps** before every commit: cargo fmt (re-stages formatted `.rs`) + LF line-ending normalization + i18n lint (`scripts/lint-i18n.sh`) + bundle parity: staged files only (`scripts/verify-bundle-parity.py --staged-only …`) + FTL dedupe dry-run (`scripts/dedupe-ftl.py --dry-run`) + migration column-type lint (`scripts/verify-migration-column-types.py --staged-only`, when migrations are staged) + PG schema drift guard (`scripts/generate-pg-migration.py --check`, when any migration file, the migration registry, or the generator script is staged) + a conditional Go gate (gofmt re-stage + `go vet ./...`, only when `apps/license-server/*.go` is staged) + **UI typecheck** (`npm run typecheck`, only when `ui/src/*.ts`/`*.tsx` is staged; `OZPOS_SKIP_TYPECHECK=1` skips that step alone) + **FTL orphan lint** (`scripts/verify-ftl-orphans.py --staged-only`, only when a `.ftl` is staged). **Source of truth is the hook: `grep -n '^# ──' .githooks/pre-commit`.** This list said "six core gates plus a Go gate" for a while and went stale twice as steps 9 and 10 landed; `verify-agents-mirrors.py` now compares a count claimed here against the hook and fails, so the prose cannot drift silently again.

For comprehensive local validation that mirrors the entire CI matrix (not just the pre-commit subset), run `bash scripts/check.sh`. For the rationale, see [`AGENTS.md`](../../AGENTS.md) Quick Setup.

---

## 30-second tour

- **Domain types and money**: `oz-core` (Rust library, no I/O).
- **Database**: SQLite via `rusqlite`, all writes in transactions.
- **Hardware**: `oz-hal` (drivers behind `async` traits, mandatory mocks).
- **UI**: Tauri v2 + React 18 + TypeScript, strict, accessible, localized.
- **IPC**: Rust commands in `apps/desktop-client/src/commands/`, front-end wrappers in `ui/src/api/` (per-domain files).
- **Scripting**: `mlua` runtime in `oz-lua` for runtime business rules.
- **Payment**: PCI-aware, swappable processors in `oz-payment`.
- **CI**: GitHub Actions matrix (Linux, Windows, macOS), blocking fmt/clippy/test/UI lint.

If a change touches more than one layer, you will use more than one skill. That's normal.

---

## Skill router

What do you want to do?

| If you want to… | Read this skill first |
|---|---|
| Add or change Rust code in any `oz-*` crate, work with the `Money` struct, write SQL transactions, define error types, or add a `#[cfg(test)]` block | **`rust-backend`** |
| Write or review tests, drive a change test-first (red-green-refactor), or run the fast TDD loop (`scripts/test-tdd.sh`) | **`tdd`** |
| Add a new Tauri command on the backend, register it, and call it from the front-end via a per-domain `ui/src/api/<feature>.ts` wrapper | **`tauri-ipc`** |
| Add or change React component, screen, hook, or any user-visible string; review accessibility, i18n, or strict TypeScript | **`ui-components`** |
| Add a symmetric CSS entry/exit animation (mirror keyframe + class toggle + useRef cleanup + ID-set-compare race guard) on a pill, badge, banner, modal, or any dismissable UI element | **`exit-animation-pattern`** |
| Add a new device category or transport driver (barcode scanner, receipt printer, cash drawer, customer display, weight scale, EDC payment terminal); write the **mandatory mock** | **`hal-drivers`** |
| Scaffold the workspace, add a new crate, configure CI, write commit messages, set up the GitHub Actions matrix | **`project-scaffold`** |
| Detect or patch drift between a skill and the code (broken paths, renamed crates, stale `last audited` dates, outdated dependency versions) | **`skill-drift-guard`** |
| Audit any project document (README, ARCHITECTURE.md, api-reference, spec, admin guide) against the current codebase — verify claims, classify drift, patch the doc, stamp it audited | **`docs-auditor`** |
| Diagnose, reproduce, and repair failing tests or CI checks on an active pull request | **`pr-repair`** |
| Create a new pull request with branch-prefixed title and comprehensive description derived from 50–100 commits | **`pr-create-pull-request`** |

If your task touches more than one layer, read each relevant skill in the order shown above (rust-backend → tauri-ipc → ui-components). The skills are designed to be cross-referenced. After making your change, run `skill-drift-guard` to verify the skills still match the code.

**If a code change is touching something a skill describes** (e.g., renaming a public type, moving a file, bumping a dependency), also read `skill-drift-guard` and run its `.agents/skills/skill-drift-guard/scripts/detect.sh` before opening the PR.

---

## Areas with code but no dedicated skill yet

These crates now ship real code (they were "pre-code" when this guide was first written). There is still no dedicated skill for each, so read **`rust-backend`** plus the crate's own `README.md` for conventions:

- **`oz-lua` scripting** — `mlua` runtime; discount/tax/validation rules. See the oz-lua crate README (`crates/oz-lua/README.md`).
- **`oz-payment` processors** — Stripe, Square, QRIS, Paddle, mock. Card-present terminals are the `oz-hal` **`EdcTerminal`** trait (see `hal-drivers`). See `crates/oz-payment/README.md`.
- **`oz-security`** — encryption, PAN masking, platform keychains. See `crates/oz-security/README.md`.
- **Cloud sync** — `platform/sync` + `apps/cloud-server` (PostgreSQL). See `ARCHITECTURE.md`.
- **Reporting / analytics** — `crates/oz-reporting` + `crates/oz-core/src/db/reports.rs` (REP-03: store-timezone bucketing). See `crates/oz-reporting/README.md`.

When one of these grows a dedicated skill, add it to the router table above.

---

## Common workflows

### "I'm adding a new feature end-to-end"

1. Read `rust-backend`. Add the domain type and the `Money` flow.
2. Read `tauri-ipc`. Add the command and the per-domain `ui/src/api/<feature>.ts` wrapper.
3. Read `ui-components`. Add the screen, hook, and Fluent strings.
4. Read `hal-drivers` only if the feature needs hardware.
5. Read `project-scaffold` to confirm the branch name and commit format.

### "I'm adding a new device"

1. Read `hal-drivers`. Define the trait, implement the driver.
2. Add the **mandatory mock** in `crates/oz-hal/src/drivers/mock.rs` — CI fails without it.
3. If the device has a user-facing setup screen, read `ui-components` for the screen.
4. If the device is invoked from a Tauri command, read `tauri-ipc` for the wiring.

### "I'm fixing a bug"

1. Read **`tdd`** first — reproduce with a failing test, then go Red → Green → Refactor.
2. Read the skill for the layer where the bug lives.
3. Make the fix. Add a regression test. Run the full local check script.
4. Commit with `fix(<scope>): <summary>`.

### "I'm setting up CI for the first time"

1. Read `project-scaffold`. Copy the workflow files.
2. Confirm `cargo fmt`, `clippy -- -D warnings`, and `cargo test --workspace` run green on Linux first.
3. Add Windows and macOS to the matrix.
4. Add the UI job (`npm run lint && typecheck && test && build`).
5. Add a security job (`cargo audit`, `cargo deny`).

---

## When NOT to use these skills

These skills are scoped to the OZ-POS codebase. They do **not** apply if you are working on:

- A different project (the skills reference `oz-core`, `oz-hal`, etc. by name).
- A feature that has nothing to do with a POS (a CLI for a totally different domain, a web app, a game).
- An LLM-driven workflow (OZ-POS does not use LLMs at the framework level).
- A browser-automation workflow (OZ-POS does not drive browsers; it is a desktop app).
- A social-media automation workflow (OZ-POS is not a Twitter/X bot; it runs cash registers).

If any of those describe the task, the right move is to ask the user which codebase they meant, or to spawn a skill-discovery workflow rather than applying these skills.

---

## Where to ask for help

| Question | Where to ask |
|---|---|
| "What does this Rust trait do?" | Read the `///` docs on the trait itself. The skills are guides, not the source of truth — the code is. |
| "How should this work in OZ-POS?" | Read the matching skill. If the skill doesn't cover it, ask Buffy (the AI agent) to extend the skill. |
| "How should this work in general?" | The relevant upstream docs (`async-trait`, `rusqlite`, Tauri, React, Fluent). The skills assume familiarity with these. |
| "Is this a security concern?" | Read `AGENTS.md` first. If still unclear, spawn a security review — OZ-POS handles money and (eventually) card data. |

---

## Keeping the skills fresh

When you discover a pattern that the skills don't cover — a new crate convention, a new CI check, a new accessibility rule — update the relevant skill. The skills are living documents. Add a one-line note at the bottom of the file with `> last audited <DD-MM-YY> by <who>`.

If a skill disagrees with the code, **the code is correct** until proven otherwise. Patch the skill to match, then file an issue if the skill was right and the code is wrong.

---

## Pre-commit checklist (one-liner)

```bash
cargo fmt --all -- --check && \
cargo clippy --all-targets --all-features -- -D warnings && \
cargo test --workspace --all-features && \
(cd ui && npm run lint && npm run typecheck && npm run test && npm run build)
```

If this passes locally, the PR is ready.

---

> last audited 03-09-26 by DSH
