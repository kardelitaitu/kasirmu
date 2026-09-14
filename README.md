![GitHub code size in bytes](https://img.shields.io/github/languages/code-size/kardelitaitu/oz-pos?style=flat-square) ![GitHub repo size](https://img.shields.io/github/repo-size/kardelitaitu/oz-pos?style=flat-square) [![Dev CI](https://github.com/kardelitaitu/oz-pos/actions/workflows/dev-ci.yml/badge.svg)](https://github.com/kardelitaitu/oz-pos/actions/workflows/dev-ci.yml)


<!-- Audit stamp: 2026-09-08 · DSH · status: ACCURATE after repair (7 counts corrected, all measured not estimated) · every stale figure was replaced with a measurement taken against HEAD and the command to reproduce it is named in the line · migrations 19 -> 44 (the column-type checker prints "44 files scanned"; AGENTS.md said 28 and docs/guides/ARCHITECTURE.md said 19 for the same fact — three docs, three numbers, none current) · IPC 505 -> 450 distinct registered (425 desktop / 297 tablet / 272 both; see docs/guides/api-reference.md for the full reconciliation) · Rust tests 5,800+ -> 8,709 #[test] fns · frontend tests ~6,700 -> 8,056 cases in 516 files · Fluent 5,700+ IDs across 50 files -> 9,146 across 52 · "55+ audited screen components" -> 183 feature .tsx files, because the audit's unit is surfaces and key sites, not screens · structural claims verified accurate: all 13 crates, all 10 npm scripts, all 3 scripts/*, the 5 payment drivers, ui/e2e/README.md, the ui/README.md anchor, and every path in both architecture diagrams · SUPERSEDES the 2026-08-31 stamp, whose repairs are kept here: repointed 3 broken links docs/archived/{QUICKSTART,ROADMAP,MODULAR_APP_PLAN}.md -> docs/guides/, crate inventory 11 -> 13 (oz-crypto, oz-media), "future CRM module" -> CRM ships, diagram "Restaurant" -> "Promotions", HAL lists gained EDC terminals + weight scales (traits/edc.rs, drivers/scale.rs), oz-payment drivers gained Paddle, footer version 0.0.25 -> 0.0.33 · WHY IT IS REPLACED RATHER THAN KEPT BELOW: that audit recorded "migrations 19 re-confirmed" when the tree already held 23, and "IPC 505 unique (matches api-reference.md)" — the 505 was the count of entries on a page that itself was wrong, and matching a wrong number to a wrong number was treated as confirmation. Two of its structural claims were also still true, which is the point: only the counts rotted. · NOTE test-file and ID counts stay volatile (parallel sessions add tests continuously) -->

<!-- Migration count note: 2026-09-13 · DSH · the 09-08 stamp above records migrations 19 -> 44 and is left exactly as it was written; the measured count today is 59 (`ls crates/oz-core/migrations/*.sql | wc -l`), and the two live claims in this file (Technology Stack, Status) now carry that number. -->

<!-- Audit stamp: 2026-09-14 · DSH · status: ACCURATE AFTER REPAIR (8 live claims re-measured; the 09-08 stamp and the 09-13 note above are left exactly as written, per this file's own convention) · every number below is a measurement against `C:/dev/ozpos` at HEAD `ec2edf258`, with its reproducing command inline in the line it fixes · Rust tests 8,709 -> **8,252** `#[test]` (`grep -rno --include=*.rs '#\[test\]' . | wc -l`; two of the 8,252 are prose mentions inside `//!` comments — `crates/oz-bridge/src/currency_tests.rs:12`, `crates/oz-core/src/features.rs:5` — so a strict-attribute count reads 8,250, and async tests using `#[tokio::test]` (1,397 by the same method) are NOT included in either figure) · front-end tests: **572 files** under `ui/src/__tests__` (303 .tsx + 268 .ts + 1 .json), and the **case total was deleted, not updated** — 8,056 was a runtime property of one Vitest run and nothing in the repo re-derives it, so it is removed from every live line (Core Principles, Repository Structure, the `npm run test` row, Status) · feature `.tsx` 183 -> **277** (`find ui/src/features -name '*.tsx' | wc -l`) · Fluent 9,146 IDs across 52 files -> **54 `.ftl` files (27 en + 27 id), 9,825 message definitions (4,875 en + 4,950 id), 4,950 distinct IDs, and 75 of those IDs have NO English definition** — every en ID has an id counterpart, the gap runs one way (the per-file counts are exact and agree with the language split: 4,875 en + 4,950 id = 9,825, 4,950 distinct IDs, 75 without an English definition — `ls ui/src/locales/*.ftl | xargs grep -hcE '^[A-Za-z][A-Za-z0-9_-]*[[:space:]]*=' | awk '{s+=$1} END {print s}'` = 9,825. Any `cat ui/src/locales/*.ftl | grep -c` pipeline under-reads by exactly 1 (9,824 definitions / 4,949 distinct) because `sales.ftl` is the only one of the 54 files with NO final newline (last byte `}`), so `cat` welds its last definition onto the next file's first line — an artifact of concatenation, not a second method. There are no dotted `key.attr =` definitions anywhere in the tree: `cat ui/src/locales/*.ftl | grep -cE '^[a-zA-Z][a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]+[[:space:]]*='` = 0.) · IPC 450 (425/297/272) -> **453 desktop / 322 tablet / 297 both / 478 distinct** (entries inside each shell's `tauri::generate_handler!` in `apps/desktop-client/src/lib.rs` and `apps/tablet-client/src/lib.rs`, deduped by qualified path; re-check `python scripts/verify-ipc-parity.py`) · Repository Structure listed **13 crates and the tree holds 16** (`ls -d crates/*/ | wc -l`): added `oz-bridge` (tauri-free command bodies behind both shells' IPC shims — `BridgeCtx`, `BridgeError`), `oz-lan` (TCP accept loop, per-peer offline buffers, PSK + Noise transports, KDS discovery and multi-terminal sync), `oz-local-api` (loopback REST on the shared `oz-api` router, settings-gated, default-off, token-minted); all three described from their own `src/lib.rs` module docs, and both now-stale structural claims in the 09-08 stamp — "all 13 crates" and "the 5 payment drivers" — are left untouched there and corrected only here: `crates/oz-payment/src/drivers/` holds 5 drivers but **Paddle is a `#[cfg(feature = "paddle")]` stub self-labelled "PLANNED — not yet implemented"** (`paddle.rs:7,13`; the feature is in `default`, so it compiles but returns `Unsupported` on every op), i.e. 4 real drivers + 1 mock + 1 stub, which is also what `crates/oz-payment/README.md` still states as fact · PR-gate sentence rewritten to separate policy from enforcement, because Clippy is in **zero** live workflows (see Testing Strategy) · diagram: added a fourth Infrastructure row for the three new crates; **the Applications box still reads "Future" and was NOT redrawn** — `apps/` does contain `cloud-server` and `license-server` today, but they are axum/Go services, not clients of the Tauri v2 Shell the box feeds, so naming them there would draw a false arrow rather than a false label; `license-server` has no Cargo.toml at all (Go, `go.mod`) · left unverified: the Vitest case total (needs a run), the `npm run test` execution time, and whether the 09-08 "all 10 npm scripts" claim still holds — `ui/package.json` defines 21 scripts today, only 10 of which this page names. -->

# OZ-POS

> **A modular, offline-first Point-of-Sale platform built with Rust and Tauri v2.**

OZ-POS is a Point-of-Sale platform designed for **retail, restaurants, cafés, and specialty businesses** that require reliability, performance, and long-term maintainability.

Unlike traditional monolithic POS applications, OZ-POS is built around a modular architecture where business capabilities are implemented as independent modules. Organizations can deploy only the features they need while developers can extend the platform without modifying the core.

---

## Why OZ-POS?

Modern POS systems often suffer from vendor lock-in, expensive subscriptions, cloud dependency, limited customization, and difficult maintenance. OZ-POS addresses these challenges through a modern software architecture.

| Traditional POS | OZ-POS |
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
- **Secure by default** — Encrypted `.ozpkg` snapshots (whole-file `.db` backups are unencrypted), PAN masking, platform keychains
- **Hardware abstraction** — Vendor-independent drivers for printers, scanners, displays, payment terminals, scales
- **Enterprise-grade code quality** — 8,252 Rust `#[test]` functions and 572 front-end test files (measured 2026-09-14: `grep -rno --include=*.rs '#\[test\]' . | wc -l`; `ls ui/src/__tests__/* | wc -l`), strict Clippy (a project standard that developers and `scripts/check.sh` enforce, not CI), typed Money, transactional DB. The Vitest **case** total is not measured — it exists only in a test run, and no command here re-derives it.

---

## Key Features

| Area | Capabilities |
|------|-------------|
| **Sales** | Fast checkout, barcode scanning, receipt printing, multiple payments, refunds, discounts |
| **Inventory** | Product management, categories, stock adjustments, purchase tracking, movement history |
| **Customer Management** | Profiles, purchase history, loyalty support, CRM (dedicated module) |
| **Reporting** | Daily sales, product performance, cash reconciliation, inventory reports, export |
| **Security** | Encrypted `.ozpkg` snapshots (Argon2id + AES-256-GCM; whole-file `.db`/`.backup.db` backups are unencrypted), PAN masking, TLS, platform keychain, audit logging |
| **Hardware** | Receipt printers, barcode scanners, cash drawers, customer displays, EDC payment terminals, weight scales — USB, Bluetooth, TCP, serial, plus mock drivers for testing |

---

## Architecture

```
                         Applications
      ┌─────────────────────────────────────────────┐
      │  Desktop Client  │  Tablet Client  │ Future │
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
oz-pos/
├── apps/
│   ├── desktop-client/     # Tauri v2 shell: IPC commands, app state, plugins
│   ├── tablet-client/      # Tablet-optimised Tauri shell
│   ├── cloud-server/       # Cloud HTTP API (axum, hosted tenants)
│   └── license-server/     # License activation & validation
├── crates/                 # 16 libraries (`ls -d crates/*/ | wc -l` = 16, 2026-09-14)
│   ├── oz-api/             # HTTP API server (axum)
│   ├── oz-bridge/          # Command bodies behind the desktop/tablet IPC shims — tauri-free (BridgeCtx, BridgeError)
│   ├── oz-cli/             # CLI tool (backup, export/import .ozpkg, migrations)
│   ├── oz-core/            # Domain models, SQLite Store, migrations, settings
│   ├── oz-crypto/          # Cryptographic primitives (secret encryption at rest)
│   ├── oz-hal/             # Hardware Abstraction Layer (printer, scanner, drawer, display, scale, EDC terminal)
│   ├── oz-lan/             # LAN event transport: TCP accept loop, per-peer offline buffers, PSK + Noise, KDS discovery & sync
│   ├── oz-local-api/       # Loopback REST server on the shared oz-api router — settings-gated, default-off, token-minted
│   ├── oz-logging/         # Structured logging (console, file, syslog, eventlog)
│   ├── oz-lua/             # Lua scripting engine (mlua — discount, tax, validation)
│   ├── oz-media/           # Media pipeline (compress, crop, thumbnail)
│   ├── oz-notification/    # Email & push notification dispatching
│   ├── oz-payment/         # Payment gateway integrations (Stripe, Square, QRIS, Paddle, mock)
│   ├── oz-plugin/          # Plugin sandbox & lifecycle (Lua scripting bridge)
│   ├── oz-reporting/       # Report generation (EOD, sales summaries)
│   └── oz-security/        # TLS config, PAN masking, platform keychains
├── foundation/             # Shared primitives: Money, SKU, Cart, contracts
├── modules/                # Pluggable domain modules (CRM, inventory, tax, etc.)
├── platform/               # Kernel, event bus, sync engine, startup
├── ui/                     # React 18 + TypeScript + Vite
│   └── src/
│       ├── api/            # Per-domain invoke() wrappers — no invoke() in components
│       ├── frontend/       # Shared components, shell layout, design tokens
│       ├── features/       # 277 .tsx files across the domain feature dirs
│       ├── locales/        # Fluent (.ftl) — 54 files (27 en + 27 id), 9,825 message definitions (4,875 en + 4,950 id), 4,950 distinct IDs; 75 of them have NO English definition
│       └── __tests__/      # Vitest + testing-library (572 files: 303 .tsx, 268 .ts, 1 .json; case total not measured)
├── docs/                   # guides/ (QUICKSTART, ROADMAP, ARCHITECTURE, API, WHITEPAPER), decisions/ (ADRs), specs/, plans/, records/, operations/
├── scripts/                # Example Lua business rule scripts, coverage scripts
└── packaging/              # Linux .deb maintainer scripts + .desktop entry, mobile build guide (MSI/AppImage/DMG come from the Tauri bundler, not this dir)
```

---

## Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Backend | Rust | Domain logic, DB access, hardware control |
| Desktop Shell | Tauri v2 | Native window, IPC bridge, updater |
| Frontend | React 18 + TypeScript + Vite 6 | POS UI |
| Database | SQLite (rusqlite) | On-device persistence, 59 migration files (2026-09-13: `ls crates/oz-core/migrations/*.sql \| wc -l` = 59, of which 58 are SQLite and one is the generated `20260813_init.pg.sql`; the 131 pre-Aug-2026 ones squashed into `20260813_init.sql`) |
| Localization | @fluent/react | All UI strings in `.ftl` files |
| Hardware | oz-hal traits | USB/TCP/BT/serial/mock drivers |
| Money | `i64` minor units | Never `f32`/`f64` — `Currency`, `Money` structs |
| Security | Argon2id + AES-256-GCM + zstd | Encrypted `.ozpkg` snapshots |
| Automation | Lua (mlua) | Discount, tax, validation rules |

---

## Quick Start

```bash
git clone https://github.com/kardelitaitu/oz-pos.git
cd oz-pos
cargo build --workspace
cd ui && npm ci --no-audit --no-fund && cd ..  # see ui/README.md#install-script-approvals
cd apps/desktop-client && cargo tauri dev
```

See [docs/guides/QUICKSTART.md](./docs/guides/QUICKSTART.md) for detailed setup instructions.

---

## Development Commands

### Frontend (ui/)

| Command | Action |
|---|---|
| `npm run dev` | Development server |
| `npm run check:all` | Chained validation: lint → typecheck → test → i18n → E2E* |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript validation |
| `npm run lint` | ESLint + jsx-a11y |
| `npm run test` | Vitest — 572 files under `ui/src/__tests__` (`ls ui/src/__tests__/* \| wc -l`). No case total: that number exists only in a run, and none is recorded here. |
| `npm run e2e` | Full E2E suite: Docker → Vite → Playwright → cleanup |
| `npm run e2e:headed` | E2E with browser visible |
| `npm run e2e:api` | API integration tests only |
| `npm run e2e:ui` | All UI E2E tests (excl. API) |

> * E2E requires Docker; check:all skips it gracefully if unavailable. See [`ui/README.md`](./ui/README.md) and [`ui/e2e/README.md`](./ui/e2e/README.md) for details.

### Backend (root)

| Command | Action |
|---|---|
| `cargo fmt --all` | Format Rust code (CI checks it: `dev-ci.yml:195` runs `cargo fmt --all -- --check`) |
| `cargo clippy --all-targets -- -D warnings` | Lint — **local only**: `grep -c clippy` over the two live workflows (`dev-ci.yml`, `release.yml`) returns 0, so this gate is run by `scripts/check.sh:44` and `scripts/release.sh`, never by CI |
| `cargo test --workspace` | Run tests (8,252 `#[test]` fns — `grep -rno --include=*.rs '#\[test\]' . \| wc -l`, 2026-09-14) |
| `bash scripts/check.sh` | Full local pre-push gate (Rust + UI + migrations) |
| `bash scripts/coverage.sh` | Rust + UI coverage reports |
| `bash scripts/reset-dev-pg.sh` | Reset the dev PostgreSQL container to the committed PG_INIT schema (`.ps1` twin on Windows) |

---

## Testing Strategy

| Layer | Approach |
|---|---|
| **Rust** | Unit tests, integration tests, DB migration tests, HAL mock tests |
| **Frontend** | Component tests, feature tests, localization validation, accessibility checks |
| **Coverage** | LLVM source-based (Rust) + v8 (UI) — HTML + JSON in `coverage/` |

Every PR must pass `cargo fmt`, Clippy, `tsc --noEmit`, and all tests before merge — as policy. As enforcement only three of the four fail a build: `cargo fmt --all -- --check` is CI (`dev-ci.yml:195`), typecheck and Vitest are CI (`dev-ci.yml#ui-test`), and **Clippy runs in no live workflow** — `grep -c clippy .github/workflows/dev-ci.yml .github/workflows/release.yml` prints `:0` for both files and exits 1 (2026-09-14); the only clippy left anywhere under `.github/workflows/` is inside the inert `ci.yml.bak`, which `grep -rln clippy .github/workflows/` names alone (lines 5, 230, 251) — so it is local policy, run by `scripts/check.sh:44` and `scripts/release.sh`. A green PR is not proof Clippy passed.

---

## Status

**Phase 4 (CRM, Restaurant, Accounting) in progress.** Measured 2026-09-14 against this checkout: 59 migration files (`ls crates/oz-core/migrations/*.sql | wc -l`), 453 desktop / 322 tablet IPC commands registered — 297 in both, 478 distinct (re-check with `python scripts/verify-ipc-parity.py`), 277 feature `.tsx` files (`find ui/src/features -name '*.tsx' | wc -l`), 572 files under `ui/src/__tests__` (`ls ui/src/__tests__/* | wc -l`), 8,252 Rust `#[test]` functions (`grep -rno --include=*.rs '#\[test\]' . | wc -l`), and 16 crates (`ls -d crates/*/ | wc -l`). Earlier readings of these same facts are dated history, not current: the 08-09-26 stamp above records 450 distinct IPC (425 / 297 / 272), 183 feature `.tsx`, 8,709 tests and 13 crates, and each has moved since.

| Phase | Status | Focus |
|---|---|---|
| 1 | Complete | Platform foundation |
| 2 | Complete | Inventory & Products |
| 3 | Complete | Transactions & Staff |
| 4 | In Progress | CRM, Restaurant, Accounting |
| 5 | In Progress | Multi-store topology, Cloud Sync, Plugin system |

Latest release: **v0.0.37** (on branch `0.0.37`).

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

**Proprietary and Confidential — Copyright (c) 2024-2026 OZ-POS Contributors / All Rights Reserved.**

This software (`oz-pos`) is **NOT open source**. No part of this codebase, associated binaries, or documentation may be copied, modified, distributed, sublicensed, hosted, or deployed in any commercial, non-commercial, or production setting without explicit written permission and a valid executed Commercial License Agreement.

See [LICENSE](./LICENSE) for terms and restrictions. For commercial licensing and pricing inquiries, contact: **adikaradwiatmaja@gmail.com**.

> last audited 08-09-26 by docs-auditor

