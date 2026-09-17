<!-- TODO: update badge URLs after repo rename — rebrand Tier 3 item T3-7 (kardelitaitu/oz-pos → kasirmu/kasir.mu). The URLs below still resolve today; the GitHub repo move has NOT happened, so do not pre-empt it. -->
![GitHub code size in bytes](https://img.shields.io/github/languages/code-size/kardelitaitu/oz-pos?style=flat-square) ![GitHub repo size](https://img.shields.io/github/repo-size/kardelitaitu/oz-pos?style=flat-square) [![Dev CI](https://github.com/kardelitaitu/oz-pos/actions/workflows/dev-ci.yml/badge.svg)](https://github.com/kardelitaitu/oz-pos/actions/workflows/dev-ci.yml)


# kasir.mu

> **A modular, offline-first Point-of-Sale platform built with Rust and Tauri v2.**

kasir.mu is a Point-of-Sale platform designed for **retail, restaurants, cafés, and specialty businesses** that require reliability, performance, and long-term maintainability.

Unlike traditional monolithic POS applications, kasir.mu is built around a modular architecture where business capabilities are implemented as independent modules. Organizations can deploy only the features they need while developers can extend the platform without modifying the core.

---

## Why kasir.mu?

Modern POS systems often suffer from vendor lock-in, expensive subscriptions, cloud dependency, limited customization, and difficult maintenance. kasir.mu addresses these challenges through a modern software architecture.

| Traditional POS | kasir.mu |
|---|---|
| Monolithic | Modular architecture |
| Cloud required | Offline-first |
| Proprietary integrations | Hardware abstraction layer |
| Difficult customization | Plug-in modules |
| Large desktop footprint | Lightweight Tauri application |
| Vendor lock-in | Open ecosystem |

### Core Principles

- **Offline-first** — Operates without internet connectivity; sync when available
- **Modular by design** — Independent modules for inventory, CRM, reporting, etc.
- **Secure by default** — Encrypted `.kasirpkg` snapshots (whole-file `.db` backups are unencrypted), PAN masking, platform keychains
- **Hardware abstraction** — Vendor-independent drivers for printers, scanners, displays, payment terminals, scales
- **Enterprise-grade code quality** — 8,355 Rust `#[test]` functions and 593 front-end test files (measured 2026-09-18: `grep -rn --include='*.rs' -o '#\[test\]' . | wc -l` → 8,355; `find ui/src/__tests__ -type f | wc -l` → 593); strict Clippy (a project standard that developers and `scripts/check.sh` enforce, not CI); typed Money; transactional DB. The Vitest case total is not measured — it exists only in a run, and none is recorded here.

---

## Key Features

| Area | Capabilities |
|------|-------------|
| **Sales** | Fast checkout, barcode scanning, receipt printing, multiple payments, refunds, discounts |
| **Inventory** | Product management, categories, stock adjustments, purchase tracking, movement history |
| **Customer Management** | Profiles, purchase history, loyalty support, CRM (dedicated module) |
| **Reporting** | Daily sales, product performance, cash reconciliation, inventory reports, export |
| **Security** | Encrypted `.kasirpkg` snapshots (Argon2id + AES-256-GCM; whole-file `.db`/`.backup.db` backups are unencrypted), PAN masking, TLS, platform keychain, audit logging |
| **Hardware** | Receipt printers, barcode scanners, cash drawers, customer displays, EDC payment terminals, weight scales — USB, Bluetooth, TCP, serial, plus mock drivers for testing |

---

## Architecture

```
                         Applications
      ┌─────────────────────────────────────────────┐
      │  Desktop Client  │  Mobile Client  │ Future │
      └─────────────────────────────────────────────┘
                        │
                        ▼
                   Tauri v2 Shell
                        │
                        ▼
                   Platform Kernel
      ┌────────────────────────────────────────┐
      │ Event Bus │ Sync Engine │ Lifecycle    │
      │ Auth      │ Startup                    │
      └────────────────────────────────────────┘
             │                    │
      ┌──────┴────────────────────┴──────────────┐
      ▼                                         ▼
 Foundation                              Domain Modules
 ┌──────────────┐                    ┌─────────────────┐
 │ Money  SKU   │                    │ Inventory       │
 │ Cart         │                    │ Reporting       │
 │ Contracts    │                    │ CRM             │
 └──────────────┘                    │ Tax / Discounts │
                                     │ Promotions      │
      │                              │ Loyalty         │
      ▼                              └─────────────────┘
 Infrastructure
 ┌──────────────────────────────────────────────┐
 │ SQLite   │  HAL  │  Security  │  Logging     │
 │ Export   │  Lua Runtime                      │
 │ Bridge   │  LAN     │  Local API             │
 └──────────────────────────────────────────────┘
```

Business logic, UI, hardware drivers, and platform services are isolated — new modules and applications can be added without changing the kernel.

---

## Repository Structure

```
kasir.mu/
├─ apps/                     # deployable processes + UI shells
│   ├─ desktop-tauri/        # Tauri v2, pkg `kasirmu-app`
│   ├─ mobile-tauri/         # Tauri v2, pkg `kasirmu-mobile`
│   ├─ cloud-server/         # axum HTTP API — pkg `kasirmu-cloud`
│   ├─ license-server/       # Go (go.mod, no Cargo.toml) — stays, release.yml builds it
│   └─ unified/              # container glue: Caddyfile, supervisord.conf — no Cargo.toml
│
│   # A Slint shell will get its own directory here — for the TOOLKIT, not the Raspberry Pi.
│   # Do not create it empty: that is how ui/src/frontend/ became a ghost (principle 2).
│   #
│   # Where per-OS difference actually lives — never a shell-named directory:
│   #   #[cfg(target_os)]  → kasirmu-logging/{lib,eventlog}.rs · kasirmu-security/lib.rs   (3 files)
│   #   target deps        → [target.'cfg(…)'.dependencies] in security / logging / core manifests
│   #   tauri.conf.json    → bundle.targets · bundle.windows.nsis.installMode · android.minSdkVersion
│   #   delivery           → gen/android · ops/packaging/linux/deb/ · ops/install/win/ · ops/docker/
│
├─ foundation/               # unchanged — 1 crate, flat src/
├─ platform/                 # unchanged — core, kernel, startup, sync
├─ modules/                  # unchanged — the 14 verticals
├─ crates/                   # unchanged — the 17 libraries
│
├─ shared-ui/                # NEW — assets no UI toolkit owns
│   ├─ locales/              # ← ui/src/locales/  (54 .ftl, ~9,841 message definitions, en+id)
│   └─ tokens/               # ← token VALUES lifted out of tokens.css (DEFERRED — see P9b)
│                              #   (NOT created empty — see principle 2)
│
├─ ui/                       # the React + Vite binding (one toolkit's frontend)
│   ├─ index.html            # unchanged — <script src="/src/main.tsx">  (so main.tsx stays put)
│   ├─ index.mobile.html     # unchanged — <script src="/src/main.mobile.tsx">
│   └─ src/
│       ├─ app/              # ← frontend/shell/        (11 files + 1 subdir)
│       ├─ components/       # ← components/ (55, survives) MERGED WITH frontend/shared/ (22)
│       ├─ theme/            # ← frontend/themes/       (CSS binding only — values lift in P9b)
│       ├─ registries/       # ← platform/ui/           (4 files: page/menu/widget registry + icon)
│       ├─ api/              # unchanged (51 files)
│       ├─ features/         # unchanged (35 dirs + index.ts barrel)
│       ├─ hooks/ utils/ contexts/ types/ i18n/ test-utils/ dev-mock/ __tests__/
│       ├─ App.tsx           # unchanged
│       ├─ main.tsx          # unchanged — Vite entry, referenced by index.html
│       └─ main.mobile.tsx   # unchanged — referenced by index.mobile.html
│       #   DELETED: frontend/ · platform/   (both emptied by the moves above)
│       #   MOVED OUT: locales/ → shared-ui/locales/ (P9a) — the .ftl corpus serves any toolkit.
│       #   i18n/ STAYS: it is the @fluent/react binding, which is React-specific.
│
├─ ops/                      # NEW tier — everything that builds, ships or installs; never code
│   ├─ docker/               # ← Dockerfile.server, Dockerfile.unified,
│   │                         #   docker-compose{,.prod,.pg,.e2e,.override}.yml
│   ├─ install/              # ← install/          (install.sh, uninstall.sh, README.md, win/)
│   ├─ packaging/            # ← packaging/        (debian maintainer scripts + .desktop entry)
│   └─ gateway/              # ← gateway/          (Caddyfile.example)
│
├─ prototypes/               # ← dev/              (KDS PWA prototype: kds-pwa/, app.js, sw.js…)
│
├─ docs/                     # unchanged 15 subdirs, PLUS:
│   └─ plans/                #   NO CHANGE — the root .md files are the owner's working files
│                              #   and stay at the root. Includes this file and
│                              #   DSH.md, which is also a root-name tool contract
│
├─ website/                  # unchanged (separate Cloudflare deploy, 208 tracked files)
├─ scripts/                  # unchanged (165 tracked files)
├─ assets/  fuzz/            # unchanged — fuzz/ stays workspace-excluded on purpose
│
├─ .github/workflows/        # 2 live: dev-ci.yml, release.yml
│   └─ attic/                # ← the retired *.yml.bak files
│
└─ <root files>              # see §5 of todo-project-folder-restructure.md — only what a tool looks up BY NAME at the project root,
                              # plus the four human entry points
```

> **Why this shape.** The five-tier Rust workspace (`foundation/` → `platform/` → `modules/` → `crates/` → `apps/`) is sound and deliberately structured; `Cargo.toml` documents the glob-vs-explicit member split and it should be left alone. What was *not* sound: the UI had two competing shared component libraries, `ui/src/frontend/` was a half-built scaffold whose name described nothing, the repo root had accumulated files that belong in directories, and the architecture docs described a tree that no longer exists. Full context: [`todo-project-folder-restructure.md`](./todo-project-folder-restructure.md) — 13 phases, principles, accepted and declined designs.

---

## Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Backend | Rust | Domain logic, DB access, hardware control |
| Desktop Shell | Tauri v2 | Native window, IPC bridge, updater |
| Mobile Shell | Tauri v2 | Native window, IPC bridge, updater (Android) |
| Frontend | React 18 + TypeScript + Vite 6 | POS UI |
| Database | SQLite (rusqlite) | On-device persistence, 59 migration files (2026-09-13: `ls crates/kasirmu-core/migrations/*.sql \| wc -l` = 59, of which 58 are SQLite and one is the generated `20260813_init.pg.sql`; the 131 pre-Aug-2026 ones squashed into `20260813_init.sql`) |
| Localization | @fluent/react | All UI strings in `.ftl` files (54 files, shared-ui/locales/) |
| Hardware | kasirmu-hal traits | USB/TCP/BT/serial/mock drivers |
| Money | `i64` minor units | Never `f32`/`f64` — Currency, Money structs |
| Security | Argon2id + AES-256-GCM + zstd | Encrypted `.kasirpkg` snapshots |
| Automation | Lua (mlua) | Discount, tax, validation rules |

---

## Quick Start

```bash
# TODO: update URLs after repo rename — rebrand T3-7
git clone https://github.com/kardelitaitu/oz-pos.git
cd oz-pos  # TODO: will be "kasir.mu" after repo rename (T3-7)
cargo build --workspace
cd ui && npm ci --no-audit --no-fund && cd ..  # see ui/README.md#install-script-approvals
cd apps/desktop-tauri && cargo tauri dev
```

See [docs/guides/QUICKSTART.md](./docs/guides/QUICKSTART.md) for detailed setup instructions.

---

## Development Commands

### Frontend (ui/)

| Command | Action |
|---|---|
| `npm run dev` | Development server |
| `npm run dev:mobile` | Mobile development server |
| `npm run check:all` | One command — `node ../scripts/check-ui.mjs` — chaining nine legs: ESLint → TypeScript → Unit tests (vitest) → i18n lint → FTL dedupe → Bundle budget → Bundle budget (mobile) → E2E* → Perf smoke (Playwright), then a `scripts/gates.json` self-audit* |
| `npm run build` | Production build |
| `npm run build:mobile` | Mobile production build |
| `npm run typecheck` | TypeScript validation |
| `npm run lint` | ESLint + jsx-a11y |
| `npm run test` | Vitest — 593 files under `ui/src/__tests__` (`find ui/src/__tests__ -type f \| wc -l`). No case total: that number exists only in a run, and none is recorded here. |
| `npm run e2e` | Full E2E suite: Docker → Vite → Playwright → cleanup |
| `npm run e2e:headed` | E2E with browser visible |
| `npm run e2e:api` | API integration tests only |
| `npm run e2e:ui` | All UI E2E tests (excl. API) |
| `npm run bundle:check` | Desktop bundle budget |
| `npm run bundle:check:mobile` | Mobile bundle budget |

### Backend (root)

| Command | Action |
|---|---|
| `cargo fmt --all` | Format Rust code (CI checks it: the `Cargo fmt check` step in `dev-ci.yml` runs `cargo fmt --all -- --check` — cited by step name, not line number, because lines move) |
| `cargo clippy --all-targets -- -D warnings` | Lint — **local only**: `grep -c clippy` over the two live workflows (`dev-ci.yml`, `release.yml`) returns 0, so this gate is run by `scripts/release.sh` and by the step NAMED `clippy workspace` inside `scripts/check.sh` — re-find it by that name with `grep -n 'clippy workspace' scripts/check.sh`, because the `:44` this row carried predates `ee5aacd46`, which moved the step, and a pointer verified today is false the next time anyone inserts a leg above it — never by CI |
| `cargo test --workspace` | Run tests (8,355 `#[test]` fns — `grep -rn --include='*.rs' -o '#\[test\]' . \| wc -l`, 2026-09-18; 8,280 on 2026-09-15) |
| `bash scripts/check.sh` | The FULL local matrix (Rust + UI + migrations), run by hand — **not** what `git push` runs. `.githooks/pre-push` invokes `scripts/run-pre-push.py` and nothing else (one call site, re-find it with `grep -n 'run-pre-push.py \$FLAGS' .githooks/pre-push`; the `:83-84` this row carried moved to a lower line inside the hour when `f5ec19201` widened the hook, which is the reason it is cited by pattern and not by number), and that script never calls `check.sh` (`grep -n check.sh .githooks/pre-push scripts/run-pre-push.py` exits 1, on the working copy and on the `HEAD` blob). What a push does run is a SUBSET of this matrix: the always-on static gates, then path-routed `cargo check --workspace`, `cargo fmt --check`, `ui typecheck`, `ui vite… |
| `bash scripts/coverage.sh` | Rust + UI coverage reports |
| `bash scripts/reset-dev-pg.sh` | Reset the dev PostgreSQL container to the committed PG_INIT schema (`.ps1` twin on Windows) |

---

## Testing Strategy

| Layer | Approach |
|---|---|
| **Rust** | Unit tests, integration tests, DB migration tests, HAL mock tests |
| **Frontend** | Component tests, feature tests, localization validation, accessibility checks |
| **Coverage** | LLVM source-based (Rust) + v8 (UI) — HTML + JSON in `coverage/` |

Every PR must pass `cargo fmt`, Clippy, `tsc --noEmit`, and all tests before merge — as policy. As enforcement only three of the four fail a build: `cargo fmt --all -- --check` is CI (the `Cargo fmt check` step in `dev-ci.yml`), typecheck and Vitest are CI (`dev-ci.yml#ui-test`), and **Clippy runs in no live workflow** — `grep -c clippy .github/workflows/dev-ci.yml .github/workflows/release.yml` prints `:0` for both files and exits 1 (re-verified 2026-09-18); the only clippy left anywhere under `.github/workflows/` is inside the retired `.github/workflows/attic/ci.yml.bak` (moved to `attic/` in P4 of the folder restructure), which `grep -rln clippy .github/workflows/` names alone (3 matches) — so it is local policy: it runs in `scripts/release.sh` and in the step NAMED `clippy workspace` inside `scripts/check.sh` (`grep -n 'clippy workspace' scripts/check.sh` — ci…

---

## Status

**Where we are: v0.0.39 — all six roadmap phases delivered, four follow-through gaps open.** The phase table in `docs/guides/ROADMAP.md` is the authority. (Note: the ROADMAP's phase *names* differ from the shorthand this section used until 2026-09-17 — "CRM, Restaurant, Accounting" and "Multi-store topology, Cloud Sync, Plugin system" were never ROADMAP phases. The real names are used below.)

| Phase (ROADMAP) | State | What's real | What's still open |
|---|---|---|---|
| 1 — Foundation & MVP | Done | Scan → cart → pay → receipt, setup wizard, feature flags, Money/CRUD core | Windows/Linux launch box unchecked |
| 2 — Hardening | Done | kasirmu-security, kasirmu-logging, backup/restore, updaters, packaging | Log sinks exist but are never wired (no log file on any shipped binary); security/nightly CI retired to `.bak` |
| 3 — Transactions & Staff | Done | Void/refund/hold/split, PIN auth + RBAC, shifts + EOD, tax engine, Lua runtime | — |
| 4 — Scaling | Done, 2 gaps | Cloud sync (outbox → PG/HTTP), multi-store + terminals, Stripe/Square/QRIS, Android tablet build, responsive UI | Exchange-rate auto-sync daemon never starts (rates are manager-entered); receipt carries charge currency only, no base-currency line |
| 5 — Intelligence | Done, 1 gap | Daily/weekly/monthly + EOD reporting, revenue/COGS/gross-profit, dashboards, en+id i18n | Custom report builder + cloud-warehouse export never built |
| 6 — Ecosystem | Done, 1 gap | Loyalty, promotions, bundles, KDS, kiosk, table management, plugin sandbox, theming | Voice checkout (research, deferred) |

Module-level truth (`modules/`): 10 active (`inventory`, `crm`, `tax`, `settings`, `staff`, `terminal`, `currency`, `sales`, `reporting`, `loyalty`), 4 still stubs with no domain logic (`purchasing`, `promotions`, `giftcards`, `kitchen` — the KDS UI in `ui/src/features/kds/` is frontend-only; the PROMO-3 engine lives in `kasirmu-core`, not `modules/promotions`; gift-card types still sit in `modules/loyalty`). There is **no accounting module** — no chart of accounts, journal, or expense tracking exists anywhere in `modules/`, migrations, or UI. What the platform does have is sales accounting's raw material: revenue/COGS/gross-profit reporting (`crates/kasirmu-core/src/db/reports/revenue.rs`), shift cash reconciliation, and purchase-order history.

Latest release: **v0.0.39** (on branch `0.0.39`).

See [ROADMAP.md](./docs/guides/ROADMAP.md) for the full phased delivery plan, and [MODULAR_APP_PLAN.md](./docs/guides/MODULAR_APP_PLAN.md) for detailed granular checklists covering feature presets, restaurant workflows, LAN KDS discovery, and Docker cloud server containerization (`apps/cloud-server`).

---

## Contributing

Contributions of all sizes are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for:

- Branch naming and commit conventions
- PR checklist and review guidelines
- Coding standards (Money, DB, errors, etc.)
- Adding new skills and modules
- Security issue reporting

New contributors are encouraged to start with documentation improvements, UI polish, accessibility enhancements, additional tests, or bug fixes labelled **Good First Issue**.

---

## License & Commercial Use

**Proprietary and Confidential — Copyright (c) 2024-2026 kasir.mu Contributors / All Rights Reserved.**

This software (`kasir.mu`) is **NOT open source**. No part of this codebase, associated binaries, or documentation may be copied, modified, distributed, sublicensed, hosted, or deployed in any commercial, non-commercial, or production setting without explicit written permission and a valid executed Commercial License Agreement.

See [LICENSE](./LICENSE) for terms and restrictions. For commercial licensing and pricing inquiries, contact: **adikaradwiatmaja@gmail.com**.

![GitHub Profile Stats](https://kgnio-profile-card.vercel.app/api/card?user=kardelitaitu&theme=azure-noir)
