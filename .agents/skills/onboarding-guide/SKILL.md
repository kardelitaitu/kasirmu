---
name: onboarding-guide
description: Meta-skill that routes tasks to the right kasir.mu skill. Use when starting a new task and unsure which specialized skill applies. Read this first when joining the project or picking up an unfamiliar area.
---

<!-- Audit stamp: 2026-09-22 · Budak-Korporat · status: REPAIRED — 1 finding, fixed in place · Audited against branch `0.0.39` at `e56bf8307`, working tree clean. · F1 (MEDIUM, fixed): `northflank-deploy-diagnosis` had **no router row at all** — `grep -c northflank-deploy-diagnosis` over this file returned **0**, while every other skill in `.agents/skills/` except this guide itself appears at least once. The router had 19 rows for 21 skill directories. Per this repo's own authoring rule ("a skill nothing routes to is invisible to the next agent"), the skill was unreachable: an agent hitting a failed Northflank deploy would have found `deploy-northflank` — which is the happy-path skill — and never the diagnosis skill written for that exact failure. Row added, phrased to distinguish the two (`deploy-northflank` = deploy/verify; `northflank-deploy-diagnosis` = a build or deploy already failed). · Verified this pass: all 33 paths this file cites exist, including `.agents/skills/codebase-memory/`, `crates/kasirmu-core/src/db/reports.rs`, the four crate READMEs (`kasirmu-lua`, `kasirmu-payment`, `kasirmu-reporting`, `kasirmu-security`), `platform/sync`, `apps/cloud-server`, `scripts/{test-tdd.sh,run-pre-push.py,setup-dev.ps1}`, `.agents/skills/skill-drift-guard/scripts/detect.sh`, and the tablet trio `ui/src/app/tablet/{tablet.css,TabletAppLayout.tsx}` + `ui/src/__tests__/restaurantCardHeight.test.ts`. The "ask Buffy (the AI agent)" line flagged by the 18-09-26 audit is confirmed repaired — `:178` now reads "ask Budak Korporat (the AI agent)". No `oz-*` crate-reference drift remains in this file. · NOT re-measured: the pre-commit gate count and the `dev-ci.yml#static-gates` fail-closed claim in the setup paragraph (§:46) — both are statements about `AGENTS.md` and the workflow rather than about this file's own claims, and the workflow half was already re-verified during the `project-scaffold` pass. -->

<!-- Superseded audit stamp: 2026-09-21 · Buffy · status: PARTIAL — router only. Added two rows to the
skill router — `deploy-northflank` and `deploy-cloudflare` — each pointing at
`.agents/skills/<name>/SKILL.md`. Both skill files exist and declare the matching `name`; every
path they cite was checked to exist before being written (ops/docker/Dockerfile.unified,
website/wrangler.toml, website/worker.ts, scripts/wrangler-deploy.sh, scripts/verify-deployment.py,
docs/operations/runbook.md, docs/operations/go-live-checklist.md, apps/license-server/DEPLOY.md).
Nothing else in this file was re-audited this pass; the 2026-09-20, 2026-09-19, 2026-09-08 and
2026-09-15 stamps below still stand for the rest. -->

<!-- Audit stamp: 2026-09-20 · Budak-Korporat · status: PARTIAL — router only. Added the
`css-layout-verification` row to the skill router, pointing at
`.agents/skills/css-layout-verification/SKILL.md`. Verified this pass: that skill file exists and
declares the matching `name`; the paths the new skill cites (`ui/src/app/tablet/tablet.css`,
`ui/src/app/tablet/TabletAppLayout.tsx`, `ui/src/__tests__/restaurantCardHeight.test.ts`,
`ui/e2e/playwright.config.ts`, `ui/src/theme/tokens.css`) all exist; `@playwright/test` resolves from
`ui/node_modules` with Chromium under AppData/Local/ms-playwright, and the measurements quoted in the
skill were re-run this pass rather than transcribed. Nothing else in this file was re-audited this
pass; the 2026-09-19, 2026-09-08 and 2026-09-15 stamps below still stand for the rest. -->

<!-- Audit stamp: 2026-09-19 · Budak-Korporat · status: PARTIAL — router only. Added two rows to the
skill router — `brand-asset-pipeline` and `android-apk-build` — each pointing at
`.agents/skills/<name>/SKILL.md`. Also merged a DUPLICATE `brand-asset-pipeline` row and its duplicate
audit stamp, both introduced earlier the same day by two separate commits (49322db5f, 7f23c35eb);
§13 replace-don't-stack applies. Verified this pass: both skill files exist and declare the matching
`name`; `ui/public/branding/` (cited by brand-asset-pipeline) exists; the per-check drift guard reports
no drift, and its `paths` check was confirmed live first by injecting a probe skill that cited a
nonexistent crates path (it fired), then removing it (it went clean). Nothing else in this file was
re-audited this pass; the 2026-09-08 and 2026-09-15 stamps below still stand for the rest. -->

<!-- Audit stamp: 2026-09-08 · DSH · status: PARTIAL — router only. Added the `codebase-memory` row and the standing graph-first-discovery note under the router table; verified `.agents/skills/codebase-memory/` exists and that `AGENTS.md` really does mandate graph-first discovery. Nothing else in this file was re-audited this pass; the 03-09-26 rev-2 stamp below still stands for the rest. · STAMPS MERGED INTO THIS ONE on 2026-09-08 (§13: replace, do not stack) — carrying forward the superseded audits’ evidence verbatim:  ·· [2026-09-03] · DSH · status: ACCURATE (rev 2 — pre-commit gate count corrected: the hook now runs six gates (cargo fmt, i18n lint, bundle parity, FTL dedupe, migration column-type lint, PG schema drift guard) plus LF normalization and a conditional Go gate for apps/license-server; verified against .githooks/pre-commit itself) · verified this pass: the kasirmu-lua, kasirmu-payment, kasirmu-security and kasirmu-reporting crate READMEs, crates/kasirmu-core/src/db/reports.rs, platform/sync, apps/cloud-server, scripts/test-tdd.sh, .agents/skills/skill-drift-guard/scripts/detect.sh all exist · prior: 2026-08-31 docs-auditor rev (obsolete-defer section rewritten; EdcTerminal/mlua/per-domain api fixes; embedded-hal removed)  ·· [2026-08-31] · docs-auditor · status: ACCURATE (obsolete-defer + convention refs repaired) · FIXED 31-08: 'Skills to defer (no code yet)' was obsolete — kasirmu-lua/kasirmu-payment/kasirmu-security/cloud-sync/kasirmu-reporting all ship code now; rewritten to 'Areas with code but no dedicated skill yet' pointing at each crate README; nonexistent PaymentTerminal trait -> EdcTerminal (hal-drivers); rlua -> mlua; pos.ts -> per-domain ui/src/api/<feature>.ts (router + workflow); device list NFC -> real (customer display, weight scale, EDC); embedded-hal -> async-trait · verified accurate: exit-animation-pattern skill exists, scripts verify-bundle-parity.py + dedupe-ftl.py + lint-i18n.sh + check.sh exist, .githooks/pre-commit 4-gate description matches -->
# kasir.mu Onboarding Guide

kasir.mu is a Rust + Tauri v2 POS framework. The codebase is organized into clear layers, and each layer has a dedicated skill. This guide routes you to the right skill for the work you want to do.

> *"Pay no attention to the man behind the curtain."* — The Wizard of Oz
>
> The kasir.mu philosophy: keep the **merchant's** experience effortless by hiding complexity behind a lean Rust engine. Skills are how we keep the engine clean.

## First-time setup

Before you read the skill router below, enable the project's pre-commit hook so its gates fire on every commit. Without this setup, the hooks are silently bypassed at commit time. **CI does fail-closed on bundle parity** — `dev-ci.yml#static-gates` runs `verify-bundle-parity.py` as a plain failing step with no `continue-on-error`, across `features,components,frontend,contexts,hooks,platform` and *without* `--staged-only`, so CI's scan is broader than the hook's. An earlier revision of this line asserted the opposite ("only as an informational stderr surface... Pre-commit is currently the only fail-closed path"), which stopped being true when the `i18n` and `static-gates` jobs were restored in 0.0.37 and would have told an agent to trust the hook over CI exactly backwards. **The hook is still the only thing that catches a bad commit before it is made**, and `core.hooksPath` is local config that `scripts/setup-dev.ps1` sets but never versions — so a fresh clone that skips setup has no local gate and learns about it only from CI.

```bash
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit
```

Once enabled, verify with `git config --get core.hooksPath` (output should be the path you set; empty result means the commands above didn't take). `.githooks/pre-commit` then runs **seven steps** before every commit (<1s): LF line-ending normalization + bundle parity: staged files only (`scripts/verify-bundle-parity.py --staged-only …`) + FTL dedupe dry-run (`scripts/dedupe-ftl.py --dry-run`, when `.ftl` staged) + migration column-type lint (`scripts/verify-migration-column-types.py --staged-only`, when migrations are staged) + PG schema drift guard (`scripts/generate-pg-migration.py --check`, when any migration file, the migration registry, or the generator script is staged) + a conditional Go gate (gofmt re-stage + `go vet ./...`, only when `apps/license-server/*.go` is staged) + **FTL orphan lint** (`scripts/verify-ftl-orphans.py --staged-only`, only when a `.ftl` is staged). cargo fmt was an eighth step until 2026-09-13, when it was removed — it ran `cargo fmt --all` workspace-wide, reformating other agents' in-flight `.rs` files under concurrent sessions; formatting is now check-only in `.githooks/pre-push`, CI, `check.sh`, and `release.sh`. Heavy UI typechecks (`npm run typecheck`) and Vitest i18n (`lint-i18n.sh`) are offloaded to `.githooks/pre-push` (`scripts/run-pre-push.py`) and CI. **Source of truth is the hook: `grep -n '^# ──' .githooks/pre-commit`.**

For comprehensive local validation that mirrors the entire CI matrix (not just the pre-commit subset), run `bash scripts/check.sh`. For the rationale, see [`AGENTS.md`](../../AGENTS.md) Quick Setup.

---

## 30-second tour

- **Domain types and money**: `kasirmu-core` (Rust library, no I/O).
- **Database**: SQLite via `rusqlite`, all writes in transactions.
- **Hardware**: `kasirmu-hal` (drivers behind `async` traits, mandatory mocks).
- **UI**: Tauri v2 + React 18 + TypeScript, strict, accessible, localized.
- **IPC**: Rust commands in `apps/desktop-tauri/src/commands/`, front-end wrappers in `ui/src/api/` (per-domain files).
- **Scripting**: `mlua` runtime in `kasirmu-lua` for runtime business rules.
- **Payment**: PCI-aware, swappable processors in `kasirmu-payment`.
- **CI**: GitHub Actions matrix (Linux, Windows, macOS), blocking fmt/clippy/test/UI lint.

If a change touches more than one layer, you will use more than one skill. That's normal.

---

## Skill router

What do you want to do?

| If you want to… | Read this skill first |
|---|---|
| Add or change Rust code in any `kasirmu-*` crate, work with the `Money` struct, write SQL transactions, define error types, or add a `#[cfg(test)]` block | **`rust-backend`** |
| Add or change a database migration, edit connection setup or a `PRAGMA`, write SQL against money or rate columns, regenerate the PostgreSQL replica, or debug a startup failure that mentions migrations, checksums, or drift | **`database`** |
| Write or review tests, drive a change test-first (red-green-refactor), or run the fast TDD loop (`scripts/test-tdd.sh`) | **`tdd`** |
| Add a new Tauri command on the backend, register it, and call it from the front-end via a per-domain `ui/src/api/<feature>.ts` wrapper | **`tauri-ipc`** |
| Add or change React component, screen, hook, or any user-visible string; review accessibility, i18n, or strict TypeScript | **`ui-components`** |
| Refresh, regenerate or troubleshoot the kasir.mu brand assets — app icons, favicons, PWA icons, the PWA manifest, platform icons, vector logos, the brand-source SVG, the sync script — from a designer export; add a whitelabel tenant; or repair drift between `assets/branding/` and the directories it is copied into | **`brand-asset-pipeline`** |
| Build, sign, install or debug the Android tablet app (`apps/mobile-tauri`, package `mu.kasir.mobile`) — cargo tauri android build, an unsigned APK that will not install, `INSTALL_FAILED_USER_RESTRICTED`, or wireless ADB that will not connect | **`android-apk-build`** |
| Add a symmetric CSS entry/exit animation (mirror keyframe + class toggle + useRef cleanup + ID-set-compare race guard) on a pill, badge, banner, modal, or any dismissable UI element | **`exit-animation-pattern`** |
| Add a new device category or transport driver (barcode scanner, receipt printer, cash drawer, customer display, weight scale, EDC payment terminal); write the **mandatory mock** | **`hal-drivers`** |
| Scaffold the workspace, add a new crate, configure CI, write commit messages, set up the GitHub Actions matrix | **`project-scaffold`** |
| Detect or patch drift between a skill and the code (broken paths, renamed crates, stale `last audited` dates, outdated dependency versions) | **`skill-drift-guard`** |
| Audit any project document (README, ARCHITECTURE.md, api-reference, spec, admin guide) against the current codebase — verify claims, classify drift, patch the doc, stamp it audited | **`docs-auditor`** |
| Diagnose, reproduce, and repair failing tests or CI checks on an active pull request | **`pr-repair`** |
| Create a new pull request with branch-prefixed title and comprehensive description derived from 50–100 commits | **`pr-create-pull-request`** |
| Explore code structurally instead of grepping — find symbols, trace callers and callees, map a change's blast radius, audit dead code or hot paths, query the knowledge graph | **`codebase-memory`** |
| Prove what a stylesheet actually does when jsdom cannot compute layout — which edge a fixed bar lands on, whether a strip overflows, whether a label is clipped or wrapped; or when a CSS-contract test passes but the UI looks wrong | **`css-layout-verification`** |
| Drive, inspect or screenshot the RUNNING Android tablet app over CDP - address elements by data-testid, read the WebView console, capture a frame while the renderer is live (a locked or panel-off tablet is NOT a CDP capture case - use android-screen.mjs), tap an element, or hit 'no devtools socket (release build)' | **`android-ui-automation`** |
| Deploy or re-deploy the backend (the unified auth + sync container) to Northflank, trigger or poll a build, change the service's environment or Dockerfile, or verify that a live deploy actually landed | **`deploy-northflank`** |
| Deploy or verify the kasir.mu website Worker on Cloudflare, change the runtime licence-server URL or a Worker secret, or rotate the Cloudflare API token | **`deploy-cloudflare`** |
| A Northflank build or deploy **failed** — read the build log by phase, tell a failed build from a failed deploy, or prove a fix before spending another deploy cycle | **`northflank-deploy-diagnosis`** |

**Discovery is not a router row — it is a standing rule.** `AGENTS.md` requires the knowledge
graph *before* reading files or grepping for symbols, so `codebase-memory` applies to every
row above; read it first if you have not used the graph from `run_code` before. Its
"Mandatory first two calls" section is the whole on-ramp.

If your task touches more than one layer, read each relevant skill in the order shown above (rust-backend → tauri-ipc → ui-components). The skills are designed to be cross-referenced. After making your change, run `skill-drift-guard` to verify the skills still match the code.

**If a code change is touching something a skill describes** (e.g., renaming a public type, moving a file, bumping a dependency), also read `skill-drift-guard` and run its `.agents/skills/skill-drift-guard/scripts/detect.sh` before opening the PR.

---

## Areas with code but no dedicated skill yet

These crates now ship real code (they were "pre-code" when this guide was first written). There is still no dedicated skill for each, so read **`rust-backend`** plus the crate's own `README.md` for conventions:

- **`kasirmu-lua` scripting** — `mlua` runtime; discount/tax/validation rules. See the kasirmu-lua crate README (`crates/kasirmu-lua/README.md`).
- **`kasirmu-payment` processors** — Stripe, Square, QRIS, Paddle, mock. Card-present terminals are the `kasirmu-hal` **`EdcTerminal`** trait (see `hal-drivers`). See `crates/kasirmu-payment/README.md`.
- **`kasirmu-security`** — encryption, PAN masking, platform keychains. See `crates/kasirmu-security/README.md`.
- **Cloud sync** — `platform/sync` + `apps/cloud-server` (PostgreSQL). See `ARCHITECTURE.md`.
- **Reporting / analytics** — `crates/kasirmu-reporting` + `crates/kasirmu-core/src/db/reports.rs` (REP-03: store-timezone bucketing). See `crates/kasirmu-reporting/README.md`.

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
2. Add the **mock** in `crates/kasirmu-hal/src/drivers/mock.rs` — required by the coding standard (`AGENTS.md` → *Database & Hardware* → **HAL Drivers**), enforced by review only — no CI job, no hook step and no checker under `scripts/` looks for it, so an unmocked driver reaches main and the first person to run it on a machine without that hardware finds out. Write it for the harness reason, not the threat: it is how you and every machine without that device can test the driver at all.
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

These skills are scoped to the kasir.mu codebase. They do **not** apply if you are working on:

- A different project (the skills reference `kasirmu-core`, `kasirmu-hal`, etc. by name).
- A feature that has nothing to do with a POS (a CLI for a totally different domain, a web app, a game).
- An LLM-driven workflow (kasir.mu does not use LLMs at the framework level).
- A browser-automation workflow (kasir.mu does not drive browsers; it is a desktop app).
- A social-media automation workflow (kasir.mu is not a Twitter/X bot; it runs cash registers).

If any of those describe the task, the right move is to ask the user which codebase they meant, or to spawn a skill-discovery workflow rather than applying these skills.

---

## Where to ask for help

| Question | Where to ask |
|---|---|
| "What does this Rust trait do?" | Read the `///` docs on the trait itself. The skills are guides, not the source of truth — the code is. |
| "How should this work in kasir.mu?" | Read the matching skill. If the skill doesn't cover it, ask Budak Korporat (the AI agent) to extend the skill. |
| "How should this work in general?" | The relevant upstream docs (async-trait, rusqlite, Tauri, React, Fluent). The skills assume familiarity with these. |
| "Is this a security concern?" | Read `AGENTS.md` first. If still unclear, spawn a security review — kasir.mu handles money and (eventually) card data. |

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

> last audited 22-09-26 by Budak-Korporat
