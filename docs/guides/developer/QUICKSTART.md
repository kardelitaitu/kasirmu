# Quickstart

<!-- Audit stamp: 2026-09-08 · DSH · status: ACCURATE after repair (4 command-level errors fixed, 1 config bug flagged) · FIXED 08-09: (a) the page told you to run bare `cargo tauri dev` from the repo root and `npm run tauri dev` from ui/ — there is no `tauri` script in ui/package.json (the UI scripts are dev, dev:mobile, build, build:mobile and none of them start the Tauri shell); (b) setup-dev.ps1 was described as six steps, it runs seven, and the list now comes from the script's own step -Label calls; (c) "the CI matrix runs on Linux, Windows and macOS" was false — every dev-ci.yml job is ubuntu-latest, and Windows/macOS exist only in release.yml on v* tags, so a platform-specific bug is not caught before merge; (d) `cargo fmt --check` was attributed to AGENTS.md, which says `cargo fmt --all` and re-stages. FLAGGED NOT FIXED: apps/desktop-tauri/tauri.conf.json beforeDevCommand is `npm run dev --prefix ../ui`, which resolves to apps/ui and does not exist — proved with npm (ENOENT on apps\ui\package.json, versus ../../ui which reaches package.json). Its own frontendDist and the tablet config both use ../../ui from the same depth, so desktop is the outlier; the workaround is documented in the page. That is a config change, not a doc change. Every bash line now carries the WSL-vs-Git-bash warning from AGENTS.md. · HISTORY 2026-08-31: removed the false 'mock feature gate' claim (mocks always compile), corrected the crate list to 13 and the HAL driver list · verified accurate this pass: rust-version 1.88 and edition 2024 in Cargo.toml, engines node>=22/npm>=11 in ui/package.json, all 13 crates, the five payment drivers, the onboarding-guide #first-time-setup anchor, and every relative link on the page -->

This guide gets kasir.mu building and running on your machine in under 15 minutes. It's aimed at first-time contributors — for the deeper project conventions, see `CONTRIBUTING.md`, `AGENTS.md`, and the skills under `.agents/skills/`.

---

## Prerequisites

| Tool | Version | Why |
|------|---------|-----|
| **Rust** | 1.88+ stable (`rustup install stable`) | The workspace uses edition 2024 and axum/tower-http deps that require rustc ≥ 1.88 |
| **Node.js** | >=22 LTS | Tauri v2 webview (React 18 + TypeScript) |
| **npm** | >=11 | Required by `ui/package.json` `engines`; needed for `allowScripts`/`npm approve-scripts` |
| **Tauri v2 prerequisites** | Per [Tauri docs](https://tauri.app/v2/guides/) | WebView2 on Windows, webkit2gtk on Linux, etc. |
| **SQLite** | 3.x (bundled via `rusqlite`) | Local persistence — no separate install needed |
| **Git** | any recent | Source control |

**Tauri v2 platform-specific deps:**

- **Windows 10/11**: Install [WebView2 runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (preinstalled on Windows 11). Install the [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the "Desktop development with C++" workload.
- **Linux (Ubuntu/Debian)**: `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`.
- **Linux (Fedora)**: `sudo dnf install webkit2gtk4.1-devel gcc gcc-c++ make curl wget file openssl-devel libappindicator-gtk3-devel librsvg2-devel`.
- **macOS**: Xcode Command Line Tools (`xcode-select --install`).

---

## Quick setup (Windows)

Run the automated setup script from the workspace root:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-dev.ps1
```

This single command does everything below automatically — **seven** steps, read from
the `step -Label` calls in `scripts/setup-dev.ps1` itself (grep for them; the script's
own `.DESCRIPTION` header still lists six and omits idempotency):
1. Prerequisites (Rust, Node.js, Git)
2. Git hooks (`git config core.hooksPath .githooks`)
3. npm install
4. database migration
5. migration idempotency (re-runs it to prove it is safe to run twice)
6. demo data seed (if the CLI subcommand is available)
7. `cargo check --workspace --all-features` excluding the two app crates

> **Note:** The setup script is Windows-only. Linux/macOS users follow the manual steps below.

## Clone and build (manual)

```bash
# 1. Clone the repository
git clone https://github.com/kardelitaitu/oz-pos.git
cd oz-pos

# 2. Build the Rust workspace
cargo build --workspace

# 3. Install front-end dependencies
#    Uses the pinned install-script approvals in ui/package.json.
#    See ui/README.md#install-script-approvals for details.
cd ui && npm ci --no-audit --no-fund
cd ..

# 4. Run the Tauri app in development mode — from the app directory, not the root
cd apps/desktop-tauri && cargo tauri dev
# tablet shell:
cd apps/mobile-tauri && cargo tauri dev
```

> ⚠️ **The desktop dev command currently fails at its own pre-dev step.**
> `apps/desktop-tauri/tauri.conf.json` sets `beforeDevCommand` to
> `npm run dev --prefix ../ui`, but from `apps/desktop-tauri` that resolves to
> `apps/ui`, which does not exist. Proved, not inferred:
>
> ```text
> $ npm run __probe__ --prefix ../ui        # as beforeDevCommand runs it
> npm error ENOENT: no such file or directory,
>   open 'C:\\dev\\ozpos\\0.0.35\\oz-pos\\apps\\ui\\package.json'
> $ npm run __probe__ --prefix ../../ui     # the form that works
> npm error Missing script: "__probe__"     # <- reached package.json fine
> ```
>
> The same file's `frontendDist` is `../../ui/dist` and the tablet config uses
> `npm run dev:mobile --prefix ../../ui` — both two levels up, from the same directory
> depth. Desktop's `../ui` is the outlier and is almost certainly a missing `../`.
> Until it is fixed, blank the hook with a config merge and start Vite yourself.
> Verified against this tree — with the override the ENOENT disappears and the CLI goes
> straight to `Running DevCommand`:
>
> ```bash
> # terminal 1 — from apps/desktop-tauri
> npm run dev --prefix ../../ui
>
> # terminal 2 — from apps/desktop-tauri
> cargo tauri dev --config '{"build":{"beforeDevCommand":""}}' --no-dev-server-wait
> ```
>
> `--no-dev-server-wait` alone is **not** the answer: it stops the CLI waiting for Vite
> but still runs `beforeDevCommand`, so it fails the same way. `-c/--config` accepts JSON
> merged over `tauri.conf.json`, which is what actually sidesteps the bad path.
>
> There is **no `npm run tauri` script** in `ui/package.json` (an earlier revision of
> this page told you to run one). The UI scripts are `dev`, `dev:mobile`, `build`,
> `build:mobile` — they start Vite only, not the Tauri shell.

The first build will take several minutes (Rust crates + Tauri binaries). Subsequent builds are fast.

---

## Run the tests

```bash
# All library tests (no browser required)
cargo test --workspace --all-features

# UI tests
cd ui && npm run test
```

The Rust test suite is fully offline — no browser, no network, no hardware. Mocks live in `crates/kasirmu-hal/src/drivers/mock.rs` and are always compiled (there is no `mock` feature gate).

---

## Lint and format

```bash
# Format
cargo fmt --all

# Lint — `-D warnings` at the end is what makes this command fail on a warning
cargo clippy --all-targets --all-features -- -D warnings

# UI lint — plain `eslint .`, no --max-warnings 0: it REPORTS warnings and still exits 0
cd ui && npm run lint

# UI types — this one does fail on what it finds
cd ui && npm run typecheck
```

`AGENTS.md` makes formatting and `cargo clippy -- -D warnings` mandatory — as policy, on you.
The commit path will not do either one for you. **The pre-commit hook runs seven steps and none
of them formats Rust**: line-ending normalization, bundle parity, FTL dedupe, migration
column types, PG schema drift, the Go gate, and FTL orphans
(`grep -c '^# ──' .githooks/pre-commit` → 7, and `grep -n 'cargo fmt\|rustfmt' .githooks/pre-commit`
returns nothing). A whole-workspace `cargo fmt --all` step did live there until **2026-09-13,
when it was removed** — and the reason it was removed is the reason it must stay out: it fired
whenever any `.rs` file was staged but formatted the *entire* workspace in the working tree, so
with several sessions in the checkout at once it rewrote other people's in-flight, unstaged,
unrecoverable `.rs` files. Format your own files (`cargo fmt --all` before you stage, or
`cargo fmt` scoped to what you touched); never re-add a workspace-wide format to a hook.

Formatting is still enforced — check-only, and after the commit. `cargo fmt --all -- --check`
runs in CI, in `pre-push`, in `scripts/check.sh` and in `scripts/release.sh`:
`grep -c 'cargo fmt --all -- --check' .github/workflows/dev-ci.yml scripts/check.sh scripts/release.sh`
prints `1` for each, and `grep -n 'cargo fmt --check' scripts/run-pre-push.py` names the push task.

CI's `cargo-check` job runs **fmt → check**, and that is all. Its two steps are `Cargo fmt check`
then `Cargo check workspace` — `cargo fmt --all -- --check`, then
`cargo check --workspace --all-targets --all-features` — so what a PR is rejected for is
unformatted Rust, or a workspace that fails to compile across every target and every feature.
**It runs no Clippy, and no live workflow does** — re-measure with
`grep -c clippy .github/workflows/dev-ci.yml .github/workflows/release.yml`
and it prints `0` for both files. Clippy is local policy —
`scripts/check.sh` runs it in the step named `clippy workspace`, and `scripts/release.sh` runs it
too (`grep -n 'clippy workspace' scripts/check.sh`, `grep -n 'cargo clippy' scripts/release.sh`;
cite them by those names, not by line number, because lines move whenever a step is inserted
above them). A green PR is therefore not proof Clippy passed — running
`cargo clippy --all-targets --all-features -- -D warnings` yourself before you push is the only thing that makes it so.

---

## Local validation helper

`scripts/check.sh` runs the same checks locally in one shot, mirroring the CI matrix:

```bash
bash scripts/check.sh   # several minutes on a clean tree; faster on a focused subset or after `cargo build`

> 🛑 **On Windows, `bash <script>` means WSL, not Git Bash.** `C:\Windows\System32\bash.exe`
> is WSL's bash; where a distro isn't running it **hangs without output** until something
> kills it — it does not fail, which makes it look like the script is broken. Use Git's
> bash by full path:
>
> ```powershell
> & 'C:\Program Files\Git\bin\bash.exe' -c 'bash scripts/check.sh'
> ```
>
> This applies to every `bash …` line below. `AGENTS.md` §Running CLI Tools on Windows
> records the same trap costing two agents, in two opposite-looking ways (a silent hang,
> or a red i18n gate that is not the repo's fault, because WSL runs the Linux node against
> a Windows-built `ui/node_modules`).
```

For the full sub-step list and what each gate catches, see `.agents/skills/onboarding-guide/SKILL.md#first-time-setup` (canonical verbose source). Use the one-liner before opening a PR to catch 90% of issues locally before CI.

If you only want the i18n quality gate as a quick pre-flight, run `bash scripts/lint-i18n.sh` once — it fails-closed on Fluent key duplicates + byte-identical `.id.ftl` files.

## Project structure (at a glance)

```
oz-pos/
├── Cargo.toml                  # workspace root
├── crates/                     # Rust workspace members (one per oz-* responsibility)
│   ├── kasirmu-core/                # money, currency, cart, sale, inventory
│   ├── kasirmu-crypto/              # cryptographic primitives (secret encryption at rest)
│   ├── kasirmu-hal/                 # hardware abstraction + drivers
│   ├── kasirmu-lua/                 # mlua runtime + script bindings
│   ├── kasirmu-media/               # media pipeline (compress, crop, thumbnail)
│   ├── kasirmu-security/            # encryption, secrets, PCI helpers
│   ├── kasirmu-payment/             # Stripe, Square, QRIS, Paddle, mock
│   ├── kasirmu-reporting/           # analytics + CSV export
│   ├── kasirmu-logging/             # structured logging
│   ├── kasirmu-api/                 # HTTP API server (axum)
│   ├── kasirmu-notification/        # email & push notification dispatching
│   ├── kasirmu-plugin/              # plugin sandbox & lifecycle
│   └── kasirmu-cli/                 # migrations, backup, export CLI
├── apps/desktop-tauri/        # the desktop Tauri shell
│   └── src/commands/           # Tauri commands (one folder per feature)
├── ui/                         # React + TypeScript front-end
│   └── src/api/                # per-domain invoke() wrappers
├── crates/kasirmu-core/migrations/  # SQL migration files
├── docs/                       # project documentation
├── .agents/skills/             # agent skills (read these when contributing)
└── .github/workflows/          # CI pipelines
```

For the full layout, see [`ARCHITECTURE.md`](../../ARCHITECTURE.md).

---

## Skills you'll read most

The first time you work on a layer, read the matching skill under `.agents/skills/`. The onboarding guide will route you:

| If you're touching… | Read this skill |
|---|---|
| Rust in any `oz-*` crate, `Money`, SQL, error types | `rust-backend` |
| A Tauri command, a per-domain `ui/src/api/<feature>.ts` wrapper, events | `tauri-ipc` |
| A React component, Fluent strings, accessibility | `ui-components` |
| A device driver, the mock, the registry | `hal-drivers` |
| The workspace, CI, branches, commit messages | `project-scaffold` |
| Drift between skills and code | `skill-drift-guard` |

After making your change, run the drift guard:

```bash
bash .agents/skills/skill-drift-guard/scripts/detect.sh --report
```

---

## Your first commit

A safe first change is one of:

1. **Fix a typo in the docs** (branch: `docs/<short-name>`, commit: `docs: ...`).
2. **Add a unit test for a public function** (branch: `test/<short-name>`, commit: `test: ...`).
3. **Address a `clippy` warning** in an existing file (branch: `chore/<short-name>`, commit: `chore: ...`).

For any of these, the full pre-PR checklist is:

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
bash .agents/skills/skill-drift-guard/scripts/detect.sh --report
```

All green? Open the PR.

---

## Troubleshooting

### "error: package `kasirmu-core` cannot be built because it requires rustc 1.88 or newer"

(The version in that message is whatever the workspace is currently locked at — the
sentence is about the toolchain floor, not the release.)

You're on an old Rust. Update:

```bash
rustup update stable
rustup show
```

### `cargo tauri dev` fails on Linux with "webkit2gtk not found"

Install the Tauri Linux prerequisites (see the table at the top of this file). The exact package name depends on your distro.

### Tests pass locally but fail in CI

**PR CI is Linux-only.** Every job in `.github/workflows/dev-ci.yml` is
`runs-on: ubuntu-latest` — there is no OS matrix. Windows and macOS appear only in
`release.yml`, which builds desktop installers on `v*` tags and never runs on a PR. So a
Windows- or macOS-specific failure is **not** caught before merge here, and a green Dev CI
run is not proof the code works on the platform you ship to (the same caveat AGENTS.md
makes about E2E, a11y, security and nightly). If you hit one, reproduce it locally on that
OS and say so in the PR — CI will not surface it for you. re-run. Don't disable platform-specific tests — fix them.

### `npm install` / `npm ci` fails in `ui/`

Make sure you're on Node.js >=22 and npm >=11 (`node --version && npm --version`). The UI pins install-script approvals in `ui/package.json` (`allowScripts`) and requires npm 11+ for `npm approve-scripts`.

If `npm ci` warns about unapproved install scripts, see `ui/README.md#install-script-approvals`.

### "permission denied" running `scripts/check.sh`

```bash
chmod +x scripts/check.sh
```

### Drift guard reports findings on day 1

Expected. The drift guard no-ops the checks that need code (checks 2–4, 7) in the pre-code state. The remaining checks (paths, golden rules, cross-references, audit dates) catch the most common first-day issues — a broken link in `README.md`, a stale skill, an uncommitted `.env` reference.

---

## Where to go next

- `AGENTS.md` — the project's coding standards
- [`ARCHITECTURE.md`](../../ARCHITECTURE.md) — the deep layout
- [`ROADMAP.md`](../product/ROADMAP.md) — what's being built and in what order
- [`WHITEPAPER.md`](../product/WHITEPAPER.md) — the "why" behind the tech choices
- `.agents/skills/onboarding-guide` — pick the right skill for the layer you're touching

Welcome to kasir.mu. Keep the curtain closed, the merchant happy, and the money integer.

---

> last audited 08-09-26 by docs-auditor
