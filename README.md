![GitHub code size in bytes](https://img.shields.io/github/languages/code-size/kardelitaitu/oz-pos?style=flat-square) ![GitHub repo size](https://img.shields.io/github/repo-size/kardelitaitu/oz-pos?style=flat-square) [![CircleCI](https://dl.circleci.com/status-badge/img/circleci/HDf3r2ytbY29BkmQrjTbXh/RFZqxGUuPhYDUZBhcsjnNR/tree/main.svg?style=svg)](https://dl.circleci.com/status-badge/redirect/circleci/HDf3r2ytbY29BkmQrjTbXh/RFZqxGUuPhYDUZBhcsjnNR/tree/main)


<!-- Audit stamp: 2026-08-31 · docs-auditor · status: ACCURATE (6 major + 2 minor repaired) · F1: migration count 117 -> 19 files (131 squashed into init.sql, db6198a3) · F2: repointed 3 broken links docs/archived/{QUICKSTART,ROADMAP,MODULAR_APP_PLAN}.md -> docs/guides/ · F3: crate inventory 11 -> 13 (added oz-crypto, oz-media) · F4: "future CRM module" -> CRM ships (modules/crm registered in kernel) · F5: architecture diagram "Restaurant" (no such module) -> "Promotions" (real module) · F6: HAL device lists now include EDC payment terminals + weight scales (traits/edc.rs, drivers/scale.rs) · m1: oz-payment drivers add Paddle · m2: footer version 0.0.25 -> 0.0.33 · NOTE: test-file/ID counts kept approximate (volatile — parallel session adds tests continuously) · RE-AUDITED 31-08: reconciled internally inconsistent counts (UI files listed as both 228 and 265; Rust as both 5,200+ and 5,800+) to consistent approximate figures (400+ UI files, ~6,700 UI tests, 5,800+ Rust); corrected non-volatile structural counts — IPC 435+ -> 505 unique (matches api-reference.md), locales 48 -> 50 files (25 bundles x 2, matches ROADMAP/ui-README); migrations 19 re-confirmed -->

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
- **Secure by default** — Encrypted backups, PAN masking, platform keychains
- **Hardware abstraction** — Vendor-independent drivers for printers, scanners, displays, payment terminals, scales
- **Enterprise-grade code quality** — 5,800+ Rust tests, ~6,700 frontend tests (400+ files), strict Clippy, typed Money, transactional DB

---

## Key Features

| Area | Capabilities |
|------|-------------|
| **Sales** | Fast checkout, barcode scanning, receipt printing, multiple payments, refunds, discounts |
| **Inventory** | Product management, categories, stock adjustments, purchase tracking, movement history |
| **Customer Management** | Profiles, purchase history, loyalty support, CRM (dedicated module) |
| **Reporting** | Daily sales, product performance, cash reconciliation, inventory reports, export |
| **Security** | Encrypted backups (Argon2id + AES-256-GCM), PAN masking, TLS, platform keychain, audit logging |
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
├── crates/
│   ├── oz-api/             # HTTP API server (axum)
│   ├── oz-cli/             # CLI tool (backup, export/import .ozpkg, migrations)
│   ├── oz-core/            # Domain models, SQLite Store, migrations, settings
│   ├── oz-crypto/          # Cryptographic primitives (secret encryption at rest)
│   ├── oz-hal/             # Hardware Abstraction Layer (printer, scanner, drawer, display, scale, EDC terminal)
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
│       ├── features/       # 55+ audited screen components by domain
│       ├── locales/        # Fluent (.ftl) files — 5,700+ IDs across 50 files
│       └── __tests__/      # Vitest + testing-library (400+ files, ~6,700 tests)
├── docs/                   # ROADMAP.md, ADRs, specs, whitepaper
├── scripts/                # Example Lua business rule scripts, coverage scripts
└── packaging/              # MSI, .deb, .AppImage build configs
```

---

## Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Backend | Rust | Domain logic, DB access, hardware control |
| Desktop Shell | Tauri v2 | Native window, IPC bridge, updater |
| Frontend | React 18 + TypeScript + Vite 6 | POS UI |
| Database | SQLite (rusqlite) | On-device persistence, 19 migration files (131 squashed into init.sql) |
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
| `npm run test` | Vitest (400+ files, ~6,700 tests) |
| `npm run e2e` | Full E2E suite: Docker → Vite → Playwright → cleanup |
| `npm run e2e:headed` | E2E with browser visible |
| `npm run e2e:api` | API integration tests only |
| `npm run e2e:ui` | All UI E2E tests (excl. API) |

> * E2E requires Docker; check:all skips it gracefully if unavailable. See [`ui/README.md`](./ui/README.md) and [`ui/e2e/README.md`](./ui/e2e/README.md) for details.

### Backend (root)

| Command | Action |
|---|---|
| `cargo fmt --all` | Format Rust code |
| `cargo clippy --all-targets -- -D warnings` | Lint |
| `cargo test --workspace` | Run tests (5,800+) |
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

Every PR must pass `cargo fmt`, Clippy, `tsc --noEmit`, and all tests before merge.

---

## Status

**Phase 4 (CRM, Restaurant, Accounting) in progress.** 19 migration files, 505 IPC commands, 55+ audited screen components, 400+ front-end test files, 5,800+ Rust tests.

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

> last audited 31-08-26 by docs-auditor

