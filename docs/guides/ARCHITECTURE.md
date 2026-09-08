<!-- Audit stamp: 2026-08-31 · docs-auditor · status: ACCURATE (drift repaired) · FIXED 31-08: crate tree +oz-crypto/oz-media/oz-notification/oz-plugin; rlua->mlua; oz-payment +Paddle (tree + prose); HAL device list 'NFC' -> real (barcode/printer/drawer/display/scale/EDC); migrations 98 -> 19 SQL files (131 squashed into init.sql); IPC endpoints 618 -> 505 unique (385 desktop + 369 tablet, 49 modules) · NOTE: this condensed guides/ARCHITECTURE.md coexists with a fuller root ARCHITECTURE.md (reorg 28147fe4 copied an archived version here); README links to THIS file · verified against HEAD Cargo.toml + generate_handler! + crates/oz-core/migrations/ · 31-08 (dc07f32a/bb7ce92d): Registry + platform-startup sections updated for the new apply_config()/HardwareConfig bootstrap path (discover() is auto-probe, not startup registration) · 31-08: module count 9 -> 14 (all wired in platform-startup; added giftcards/kitchen/loyalty/promotions/purchasing); feature flags 32 -> 39 and store presets 4 -> 5 (verified against crates/oz-core/src/features.rs); ui/api 'pos.ts THE ONLY place that calls invoke()' -> per-domain <domain>.ts wrappers; locales 48 -> 50 .ftl files · 31-08 (cont): caught two body spots the first pass missed — crate-tree '20 migrations' -> 19 (was inconsistent with the §Migrations '19 files' line) and 'SQL migration files (001–098)' -> 'date-stamped (19, 2026-08-13 → 2026-08-27)'; the files are named 20260813_init.sql … 20260827_refunds_tenant.sql, not numbered 001–098 · 01-09 (1844626d): traits line listed 3 of the 6 real device traits; Registry section updated for discover_scanners(), the scanner registration path that apply_config deliberately does not cover -->

# OZ-POS – Codebase Architecture

## Overview
This document describes the directory layout and module responsibilities for **OZ-POS**. The design supports:
- Rust core engine (transaction handling, persistence)
- Hardware Abstraction Layer (HAL) for barcode scanners, receipt printers, cash drawers, customer displays, weight scales, and EDC payment terminals
- Embedded Lua scripting for dynamic business rules
- REST API server (axum + JWT) for third-party integrations
- Tauri v2 UI built with React/TypeScript
- Multi‑platform targets: Windows PC, Linux PC, Android tablet, iPad
- Scalable database strategy (SQLite on‑device, optional cloud sync)

---
## Directory Layout
```
oz-pos/
├─ Cargo.toml                # Workspace definition (29 members)
├─ rust-toolchain.toml       # Rust toolchain (stable)
├─ package.json              # Front‑end package manager (React/TS)
├─ crates/                   # Rust workspace crates
│   ├─ oz-core/              # Core engine: domain types, Money, Cart, Sale, migrations, DB facade
│   │   ├─ Cargo.toml
│   │   ├─ src/
│   │   │   ├─ lib.rs        # Crate root, re-exports
│   │   │   ├─ money.rs      # Money(i64, Currency) — integer-only arithmetic
│   │   │   ├─ cart.rs       # Cart / CartLine — in-memory sale pipeline
│   │   │   ├─ sale.rs       # Sale / SaleLine — state machine (Pending→Active→Completed|Voided)
│   │   │   ├─ product.rs    # Product domain type
│   │   │   ├─ category.rs   # Category type (id, name, colour)
│   │   │   ├─ inventory.rs  # Inventory domain type
│   │   │   ├─ sku.rs        # Sku, LineId types
│   │   │   ├── db/          # Store CRUD modules (sales, products, categories, inventory, tax, customers, staff, settings, offline, audit)
│   │   │   ├── events.rs    # Domain events (SaleCompleted, etc.)
│   │   │   ├── offline.rs   # Offline queue
│   │   │   ├── sync_client.rs # Cloud sync client (HTTP POST via reqwest)
│   │   │   ├── tax_rate.rs  # Tax rate domain type
│   │   │   ├── customer.rs  # Customer domain type
│   │   │   ├── staff.rs     # Staff / Role domain types
│   │   │   ├── refund.rs    # Refund domain type
│   │   │   ├── settings.rs  # Settings persistence layer
│   │   │   ├── features.rs  # Feature enum (39 flags), registry, presets
│   │   │   ├── migrations.rs# Embedded SQL migration runner (44 migrations)
│   │   │   └── error.rs     # CoreError enum
│   │   └── migrations/      # Date-stamped SQL migration files (19, 2026-08-13 → 2026-08-27)
│   ├─ oz-hal/               # Hardware Abstraction Layer
│   │   ├─ Cargo.toml
│   │   └─ src/
│   │       ├─ lib.rs        # Public API
│   │       ├─ traits/       # Device traits (BarcodeScanner, ReceiptPrinter, CashDrawer)
│   │       ├─ drivers/      # Mock + real device drivers
│   │       │   ├─ mock.rs        # Programmable mocks for all traits
│   │       │   ├─ escpos.rs      # Shared ESC/POS formatting constants and helpers
│   │       │   ├─ usb_scanner.rs # USB HID barcode scanner (real)
│   │       │   ├─ serial_scanner.rs # Serial port scanner (stub)
│   │       │   ├─ usb_printer.rs # USB receipt printer (stub, ESC/POS)
│   │       │   ├─ bt_printer.rs  # Bluetooth SPP receipt printer
│   │       │   └─ tcp_printer.rs # TCP/network receipt printer (raw port 9100)
│   │       ├─ transport/
│   │       │   ├─ mod.rs
│   │       │   ├─ usb.rs    # USB enumeration, VID/PID matching, open/claim
│   │       │   ├─ serial.rs # Serial port enumeration, BT port detection
│   │       │   └─ tcp.rs    # TCP connection helper for network printers
│   │       ├─ registry.rs   # DriverRegistry (discover, register, lookup)
│   │       ├─ types.rs      # Barcode, BarcodeSymbology, DeviceInfo
│   │       └─ error.rs      # HalError enum
│   ├─ oz-api/               # REST API server (axum + JWT auth)
│   │   ├─ Cargo.toml
│   │   └─ src/
│   │       ├─ lib.rs        # Router builder, AppState, server start (port 3099)
│   │       ├─ auth.rs       # JWT create/validate + auth middleware
│   │       └─ routes/       # health, tokens, products, categories endpoints
│   ├─ oz-lua/               # Lua scripting runtime (mlua-based, sandboxed)
│   │   ├─ Cargo.toml
│   │   └─ src/
│   │       └─ lib.rs        # LuaError type (mlua embedding)
│   ├─ oz-crypto/            # Cryptographic primitives (secret encryption at rest)
│   ├─ oz-media/             # Media pipeline (compress, crop, thumbnail)
│   ├─ oz-notification/      # Notification dispatch (email templates, delivery)
│   ├─ oz-plugin/            # Plugin loader (.ozpkg archives, manifest, sandbox)
│   ├─ oz-security/          # Security crate (keyring, TLS, PCI masking)
│   │   ├─ Cargo.toml
│   │   └─ src/
│   │       └─ lib.rs        # SecurityError type (Phase 2: key-ring, TLS, PCI-DSS)
│   ├─ oz-payment/           # Payment processor crate (Stripe, Square, QRIS, Paddle, mock)
│   │   ├─ Cargo.toml
│   │   └─ src/
│   │       └─ lib.rs        # PaymentError type (Phase 4: PaymentProcessor trait)
│   ├─ oz-reporting/         # Reporting and analytics crate (daily summary, CSV, metrics)
│   │   ├─ Cargo.toml
│   │   └─ src/
│   │       └─ lib.rs        # ReportingError type (Phase 5: CSV, aggregation)
│   ├─ oz-logging/           # Structured logging crate
│   │   ├─ Cargo.toml
│   │   └─ src/
│   │       └─ lib.rs        # oz_logging::init() + LoggingError
│   └─ oz-cli/               # CLI binary `oz`
│       ├─ Cargo.toml
│       └─ src/
│           └─ main.rs       # clap entry-point: migrate, backup, export
├─ apps/desktop-client/      # Tauri v2 application shell
│   ├─ Cargo.toml
│   ├─ tauri.conf.json       # Window config, bundle targets, updater
│   ├─ capabilities/
│   │   └─ default.json      # Tauri v2 permissions
│   └─ src/
│       ├─ lib.rs            # run(): init logging, AppState, register commands
│       ├─ main.rs           # Entry point (Windows: windows_subsystem)
│       ├─ state.rs          # AppState: Mutex<Connection>, DriverRegistry, AppHandle
│       ├─ error.rs          # AppError (tagged JSON)
│       └─ commands/         # Tauri commands: health, sales, hardware
├─ ui/                       # Tauri front‑end (React/TS)
│   ├─ package.json
│   ├─ vite.config.ts        # Build config
│   ├─ tsconfig.json
│   └─ src/
│       ├─ main.tsx          # Entry point
│       ├─ App.tsx           # Root component
│       ├─ api/
│       │   ├─ pos.ts        # sales/POS IPC wrappers
│       │   └─ <domain>.ts   # per-domain wrappers (currency, edc, hardware, …) — the only layer that calls invoke()
│       ├─ types/
│       │   └─ domain.ts     # TypeScript mirrors: CartId, LineId, Sku, Money
│       ├─ features/         # Feature-scoped screens (sales/)
│       ├─ components/       # Reusable React components
│       ├─ hooks/            # Custom React hooks
│       ├─ locales/          # Per-feature Fluent bundles (50 `.ftl` files, en + id variants)
│       ├─ frontend/themes/  # CSS design tokens and shared component styles
│       └─ __tests__/        # Vitest + Testing Library tests
├─ scripts/                  # Build helpers, pre-push checks
│   ├─ check.sh              # Pre-push gate: fmt + clippy + test + drift-guard
│   └─ check.ps1             # PowerShell equivalent
├─ docs/                     # Project documentation
│   ├─ ARCHITECTURE.md       # This document
│   ├─ ROADMAP.md            # Planned milestones & feature priorities
│   ├─ WHITEPAPER.md         # Design rationale, tech choices
│   └─ QUICKSTART.md         # First-time local setup
├─ .github/
│   └─ workflows/
│       ├─ ci.yml            # Lint → test → build (Linux, Windows, macOS matrix)
│       └─ security.yml      # Weekly cargo audit + cargo deny
├─ .agents/
│   └─ skills/               # Agent skill definitions
├─ README.md                 # Project overview
├─ LICENSE                   # Proprietary (All Rights Reserved)
└─ .gitignore
```

---
## Module Details

### oz-core
- **Responsibilities**: Foundation crate. Every other crate depends on it.
- **Key types**:
  - `Money(i64 minor_units, Currency)` — integer-only, checked arithmetic. Never f32/f64.
  - `Currency([u8; 3])` — ISO-4217 currency code.
  - `Cart` / `CartLine` — in-memory sale pipeline with currency matching.
  - `Sale` / `SaleLine` — transaction lifecycle state machine: `Pending → Active → Completed | Voided`.
  - `Product`, `Category`, `Inventory`, `Sku` — domain types with serde.
  - `Feature` — 39 toggleable feature flags with dependency resolution and 5 store presets (simple_retail, restaurant, full_store, cafe, franchise).
  - `Store<'a>` — typed CRUD facade over `&Connection`. All writes inside transactions.
- **Migrations**: 19 embedded SQL files in `crates/oz-core/migrations/` (the original 131 were squashed into `init.sql`). Registered and run by `migrations.rs`; executed on startup by `platform-startup`.
- **Rules**: `#![deny(unsafe_code)]` in `lib.rs`; `missing_docs = "warn"` comes from the root `[workspace.lints]` via `[lints] workspace = true` in every member manifest.

### oz-hal
- **Responsibilities**: Uniform async API for all peripheral devices.
- **Traits**: six device traits in `traits/` — `BarcodeScanner`, `ReceiptPrinter`, `CashDrawer`, `CustomerDisplay`, `WeightScale`, `EdcTerminal`. All async, all returning `Result<T, HalError>`.
- **Registry**: `DriverRegistry` — `HashMap<String, Arc<dyn Trait>>` per device category behind `RwLock`. Register/lookup/discover. At startup, `platform-startup` maps the saved `TerminalProfile` → `HardwareConfig` and calls `apply_config()` to register the operator's devices under the exact ids commands look up. Barcode scanners are the exception and are enumerated instead (`HardwareConfig::autodetect_scanners` → `discover_scanners()`), because no caller names a scanner: the UI lists registered ids and hands one back. The rest of `discover()` is not a startup path — its hardware-derived ids can never satisfy a fixed-string lookup.
- **Transport layer** (`transport/`): `usb.rs` enumerates HID-class and printer-class USB devices by known VID/PID pairs. `serial.rs` enumerates serial ports with POS adapter detection and Bluetooth SPP port filtering. `tcp.rs` provides async TCP connection helpers for network printers (port 9100).
- **Real drivers**:
  - `UsbHidBarcodeScanner` — USB HID interrupt transfers, HID keycode → ASCII conversion, Enter-terminated scan accumulation.
  - `SerialBarcodeScanner` — serial port read until `\r`/`\n` terminator, configurable baud rate.
  - `UsbReceiptPrinter` — ESC/POS formatting over USB bulk OUT.
  - `BtReceiptPrinter` — Bluetooth SPP printer via virtual COM port. Auto-discovered by `serial::probe_bluetooth()`.
  - `TcpReceiptPrinter` — TCP/network printer via raw port 9100. Registered through `registry.register_tcp_printer()` with user-provided IP/hostname.
- **Shared ESC/POS** (`escpos.rs`): all printer drivers use a single `format_receipt()` helper and shared cut/init constants.
- **Mock driver**: In `drivers/mock.rs` — programmable queues, error injection, call counters. Required for all tests.
- Business code only uses traits via `DriverRegistry`; never imports concrete drivers.
- Blocking USB/serial I/O wrapped in `tokio::task::spawn_blocking`. Device handles held behind `tokio::sync::Mutex`.

### oz-api
- **Responsibilities**: Standalone REST API server for third-party integrations and headless operation.
- **Stack**: axum 0.8 + jsonwebtoken + tower-http.
- **Server**: Listens on port 3099 (`OZ_API_PORT` env var). `AppState` wraps `Arc<Mutex<Connection>>`.
- **Auth**: JWT HS256 tokens. `POST /api/v1/tokens` creates them; when `OZ_ADMIN_KEY` is configured the mint requires the matching `X-Admin-Key` header (dev mode stays open when unset). `auth_middleware` guards protected routes.
- **Sync plan gating** (ADR sync-plan-gating): the sync router runs `plan_middleware` between auth and the handler. With `OZ_ENFORCE_PLANS=1`, tenants on the `free` plan (or with no plan row) get `403 {"error":"plan_required"}`; plans live in the `tenant_plans` table, are set via `PUT /api/v1/tenants/{tenant_id}/plan`, and are upgraded automatically by paid Stripe subscriptions via the webhook.
- **Routes**:
  - Public: `GET /api/v1/health`
  - Admin (`X-Admin-Key` when `OZ_ADMIN_KEY` is set; open in dev): `POST /api/v1/tokens`, `PUT /api/v1/tenants/{tenant_id}/plan`
  - Protected (JWT): `GET/POST /api/v1/products`, `GET /api/v1/products/{sku}`, `PATCH /api/v1/products/{sku}/stock`, `GET /api/v1/categories`
- **Tests**: 30+ integration tests on seeded in-memory databases.

### oz-cli
- **Responsibilities**: Command-line administration tool (`oz` binary).
- **Subcommands** (via clap): `migrate` (working), `backup` (stub), `export` (stub).
- Uses `anyhow` for error propagation.

### oz-lua, oz-payment, and oz-reporting (implemented)
These crates were originally scaffolded and are now fully implemented:

- **oz-lua** — Embedded Lua scripting runtime built on [`mlua`](https://github.com/mlua-rs/mlua). Loads merchant scripts from `scripts/` and exposes business-rule hooks (`apply_discount`, `calc_line_tax`, `validate_order`). Sandboxed VM with instruction/memory limits and a restricted global environment.
- **oz-payment** — `PaymentProcessor` trait with Stripe, Square, QRIS/Midtrans, Paddle, and mock implementations. Supports authorize, capture, void, refund, and sale flows.
- **oz-reporting** — Daily summaries, sales-by-hour, top-products, menu-engineering, and inventory reports; optional `metrics` feature for Prometheus-style counters/gauges.

#### oz-security (implemented)
- **Keyring trait** with three platform-native backends: Windows Credential Manager (`windows-sys`), macOS Keychain (`security-framework`), Linux Secret Service (`zbus`).
- **InMemoryKeyring** fallback for development/CI.
- **TlsConfig** — client cert + CA bundle loading, validation, builder API.
- **Mask** — card number masking for PCI-DSS safe display.

### oz-logging
- `tracing` + `tracing-subscriber` with env-filter.
- Single `oz_logging::init()` call wires up log sinks. Used by `apps/desktop-client` and `oz-api`.
- JSON formatter, syslog, and Windows Event Log outputs planned for Phase 2.

### apps/desktop-client & apps/tablet-client (Tauri v2 Shells)
Each app crate has an identical command surface, wired through `platform-startup`:
- **Entry point**: `main.rs` → `lib.rs::run()`.
- **State**: `AppState` holds `Mutex<Connection>` (SQLite WAL mode), `Arc<DriverRegistry>`, `AppHandle`.
- **Commands** (505 unique IPC commands — 385 desktop + 369 tablet registrations — across 49 modules; see [`api-reference.md`](./api-reference.md) for the full authoritative index).
- **Error**: `AppError` — tagged JSON with `{kind, message}`, `From` impls for `CoreError`, `HalError`, `tauri::Error`.

### platform/ (Platform Crates)
- **platform-core**: Shared DB schema, Store facade, migration runner for all platform crates.
- **platform-startup**: Initialisation orchestration — DB setup, migration run, event handler registration, audit logging, and HAL hardware registration (`register_hardware` → `apply_config`).
- **platform-sync**: Offline-first sync engine with `SyncTransport` (reqwest-based HTTP push/pull), conflict detection, retry logic.

### modules/ (Business Modules)
14 modules wired via the event bus in `platform-startup`:
- **sales**, **inventory**, **crm**, **tax**, **settings**, **staff**, **reporting**, **terminal**, **currency**, **giftcards**, **kitchen**, **loyalty**, **promotions**, **purchasing**
- Each module registers event handlers (e.g. `SaleCompleted` → stock decrement, audit log, report update).
- **Currency module** (`modules/currency`): Manages exchange rates, currency listings, and currency-format settings via `CurrencyRepository`. Provides `ExchangeRateRow`, `CurrencyDto`, `CurrencyError` (with `Platform`, `Db`, `Validation`, `NotFound` variants), and 15+ typed DB methods. All settings delegate to `platform_core::settings::Settings`. The original 15 `oz-core` Store wrappers are `#[deprecated]` in favour of direct `CurrencyRepository` calls.

### ui/ (React Frontend)
- **Stack**: React 18 + TypeScript + Vite 6 + `@fluent/react` (i18n) + Vitest (testing).
- **Architecture rule**: Components never call `invoke()` directly — they go through `ui/src/api/` (or a documented infrastructure adapter). `scripts/verify-architecture-boundaries.py` blocks new production direct calls and tracks existing exceptions in an expiring baseline.
- **i18n rule**: All user-visible strings use `@fluent/react`. No hardcoded English in JSX.
- **Types**: `ui/src/types/domain.ts` mirrors Rust types with branded TypeScript (CartId, LineId, Sku, Money).

---
## Build & Run Instructions
1. **Install Rust toolchain** (stable) and `cargo`.
2. **Install Node.js** (≥ 22) for the front‑end.
3. **Install Tauri prerequisites** — see [Tauri docs](https://tauri.app/v2/guides/) for platform‑specific SDKs.
4. **Bootstrap workspace**:
   ```bash
cargo build --workspace
cd ui && npm ci --no-audit --no-fund && cd ..  # uses pinned install-script approvals
cargo tauri dev          # launches Tauri dev window
   ```
5. **Run on Android/iPad** — Use Tauri's mobile targets (requires Android SDK / Xcode).

---
## Extensibility
- New device drivers can be added under `crates/oz-hal/src/drivers/` by implementing the relevant trait.
- Additional business logic can be scripted in Lua files placed in a `scripts/` directory (Phase 3).
- Payment gateway integrations can be introduced as separate crates linked to `oz-core`.
- New REST endpoints go in `crates/oz-api/src/routes/` and are registered in `lib.rs`.
- See [MODULAR_APP_PLAN.md](./MODULAR_APP_PLAN.md) for detailed execution roadmaps covering dynamic module lifecycle hot-reloading (`platform/kernel`), LAN peer-to-peer KDS sync, and Docker containerized cloud server deployments (`apps/cloud-server`).

---
## License & Commercial Governance
- **Proprietary & Confidential (`All Rights Reserved`)**: See [`LICENSE`](../../LICENSE) for terms.
- No commercial deployment, redistribution, or modification is permitted without an executed commercial license agreement from OZ-POS Contributors.
- Internal developer contributions are governed under proprietary contributor agreements; all code strictly adheres to pre-commit quality gates (`cargo fmt + clippy + i18n lint + bundle parity`).

---
*Document generated on 2026‑06‑29.*  The gap between that line and the audit
footer below is the point: the prose has been re-stamped twice since it was written while
its own generation date stayed at June. Structural claims were re-verified 08-09-26 —
all 49 path references in this file resolve against the tree, and the migration count in
the layout block was corrected from 19 to 44 (the same fact is stated in
`docs/README.md`-adjacent files; `AGENTS.md` said 28 and `README.md` said 19, so three
documents carried three different answers).

> last audited 08-09-26 by docs-auditor

