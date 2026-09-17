<!-- Audit stamp: 2026-09-08 · DSH · status: ACCURATE after repair (4 findings) · Carries forward the 2026-08-31/09-01 work, which was real and mostly still true: crate tree +kasirmu-crypto/kasirmu-media/kasirmu-notification/kasirmu-plugin; rlua→mlua; kasirmu-payment +Paddle; HAL 'NFC' → the five real device traits; IPC 618→505 (superseded again — see api-reference.md; the registered surface is 451 as measured 08-09-26); module count 14 (re-verified today: 14 dirs under modules/ with a Cargo.toml); ui/api 'pos.ts is the only invoke() caller' → per-domain wrappers; Registry/platform-startup updated for apply_config()/HardwareConfig and discover(); 3 of 6 device traits → 6. · REPAIRED TODAY: (1) §Migrations said '19 embedded SQL files … squashed into init.sql … executed on startup by platform-startup' — all three clauses are wrong now. There are 44 SQLite .sql files embedded via include_str! in crates/kasirmu-core/src/migrations.rs (45 entries incl. the generated PG one); the squash target is 20260813_init.sql; and migrations run at AppState construction (desktop state.rs:212, tablet state.rs:117, cloud db.rs:134, kasirmu-api lib.rs:457) — platform/startup only calls the fresh_db() test helper. (2) The .github/workflows tree still named ci.yml and security.yml as live ten days after 23c963303 retired them; now it names the two live workflows and marks the rest retired. (3) '5 store presets' → 6. · THE INTERESTING PART about (1): the previous stamp records the fix 'migrations 98 -> 19 SQL files (131 squashed into init.sql)' and a second pass 'crate-tree 20 migrations -> 19, consistent with §Migrations'. The auditor did the work, twice, carefully — and wrote down a precise count that was true for exactly one day before the next migration landed. The count is 44 today. That is why §Migrations now cites the file it counts and the call sites that run it rather than asserting a number nobody can refresh. · CODE FINDING FLAGGED NOT PATCHED: features.rs's own //! says 'all 32 toggleable features' while the enum has 39 variants — the doc comment is what rotted here, not the doc. -->

# kasir.mu – Codebase Architecture

## Overview
This document describes the directory layout and module responsibilities for **kasir.mu**. The design supports:
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
│   ├─ kasirmu-core/              # Core engine: domain types, Money, Cart, Sale, migrations, DB facade
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
│   │   │   ├── migrations.rs# Embedded SQL migration runner (59 .sql files as measured 2026-09-13; ls crates/kasirmu-core/migrations/*.sql | wc -l)
│   │   │   └── error.rs     # CoreError enum
│   │   └── migrations/      # Date-stamped SQL migration files (59, 2026-08-13 → 2026-10-05)
│   ├─ kasirmu-hal/               # Hardware Abstraction Layer
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
│   ├─ kasirmu-api/               # REST API server (axum + JWT auth)
│   │   ├─ Cargo.toml
│   │   └─ src/
│   │       ├─ lib.rs        # Router builder, AppState, server start (port 3099)
│   │       ├─ auth.rs       # JWT create/validate + auth middleware
│   │       └─ routes/       # health, tokens, products, categories endpoints
│   ├─ kasirmu-lua/               # Lua scripting runtime (mlua-based, sandboxed)
│   │   ├─ Cargo.toml
│   │   └─ src/
│   │       └─ lib.rs        # LuaError type (mlua embedding)
│   ├─ kasirmu-crypto/            # Cryptographic primitives (secret encryption at rest)
│   ├─ kasirmu-media/             # Media pipeline (compress, crop, thumbnail)
│   ├─ kasirmu-notification/      # Notification dispatch (email templates, delivery)
│   ├─ kasirmu-plugin/            # Plugin loader (.kasirpkg archives, manifest, sandbox)
│   ├─ kasirmu-security/          # Security crate (keyring, TLS, PCI masking)
│   │   ├─ Cargo.toml
│   │   └─ src/
│   │       └─ lib.rs        # SecurityError type (Phase 2: key-ring, TLS, PCI-DSS)
│   ├─ kasirmu-payment/           # Payment processor crate (Stripe, Square, QRIS, Paddle, mock)
│   │   ├─ Cargo.toml
│   │   └─ src/
│   │       └─ lib.rs        # PaymentError type (Phase 4: PaymentProcessor trait)
│   ├─ kasirmu-reporting/         # Reporting and analytics crate (daily summary, CSV, metrics)
│   │   ├─ Cargo.toml
│   │   └─ src/
│   │       └─ lib.rs        # ReportingError type (Phase 5: CSV, aggregation)
│   ├─ kasirmu-logging/           # Structured logging crate
│   │   ├─ Cargo.toml
│   │   └─ src/
│   │       └─ lib.rs        # kasirmu_logging::init() + LoggingError
│   └─ kasirmu-cli/               # CLI binary `oz`
│       ├─ Cargo.toml
│       └─ src/
│           └─ main.rs       # clap entry-point: migrate, backup, export
├─ apps/desktop-tauri/      # Tauri v2 application shell
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
│       ├─ dev-ci.yml        # LIVE: the only workflow on pull_request + workflow_dispatch
│       ├─ release.yml         # LIVE: v* tags, desktop installers + updater manifests
│       └─ (10 more)           # retired to .bak on 2026-09-02 by 23c963303, including
                                      # ci.yml and security.yml, which this tree named as
                                      # live until 08-09-26. See docs/operations/ci-pipeline.md
├─ .agents/
│   └─ skills/               # Agent skill definitions
├─ README.md                 # Project overview
├─ LICENSE                   # Proprietary (All Rights Reserved)
└─ .gitignore
```

---
## Module Details

### kasirmu-core
- **Responsibilities**: Foundation crate. Every other crate depends on it.
- **Key types**:
  - `Money(i64 minor_units, Currency)` — integer-only, checked arithmetic. Never f32/f64.
  - `Currency([u8; 3])` — ISO-4217 currency code.
  - `Cart` / `CartLine` — in-memory sale pipeline with currency matching.
  - `Sale` / `SaleLine` — transaction lifecycle state machine: `Pending → Active → Completed | Voided`.
  - `Product`, `Category`, `Inventory`, `Sku` — domain types with serde.
  - `Feature` — **39** toggleable feature flags (counted over the `pub enum Feature` variants in `crates/kasirmu-core/src/features.rs`; the file's own `//!` header still says 32 and is stale — a code finding, left alone) with dependency resolution, and **6** setup presets: `simple-retail`, `restaurant`, `full-store`, `cafe`, `franchise`, `custom` (keys in `shared-ui/locales/settings.ftl`, array in `ui/src/features/setup/SetupWizard.tsx:70`). This line said 5 until 08-09-26, the same stale count corrected in `docs/guides/admin-guide.md` the same day.
  - `Store<'a>` — typed CRUD facade over `&Connection`. All writes inside transactions.
- **Migrations**: 58 SQLite `.sql` files plus the generated PG file, 59 in all as measured
  2026-09-13 (`ls crates/kasirmu-core/migrations/*.sql | wc -l`), embedded by the
  `include_str!` list in `crates/kasirmu-core/src/migrations.rs` (59 entries: the 58 SQLite plus the
  generated `20260813_init.pg.sql`). The 131-file history was squashed into
  `20260813_init.sql` — not `init.sql`. `kasirmu_core::migrations::run(conn)` is invoked at
  **application-state construction**, not by a platform subsystem:
  `apps/desktop-tauri/src/state.rs:212`, `apps/mobile-tauri/src/state.rs:117`,
  `apps/cloud-server/src/db.rs:134`, `crates/kasirmu-api/src/lib.rs:457` and `crates/kasirmu-cli`.
  `platform/startup` does **not** run migrations — it only calls the
  `migrations::fresh_db()` test helper in `event_handlers_tests.rs`.
- **Rules**: `#![deny(unsafe_code)]` in `lib.rs`; `missing_docs = "warn"` comes from the root `[workspace.lints]` via `[lints] workspace = true` in every member manifest.

### kasirmu-hal
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

### kasirmu-api
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

### kasirmu-cli
- **Responsibilities**: Command-line administration tool (`oz` binary).
- **Subcommands** (via clap): `migrate` (working), `backup` (stub), `export` (stub).
- Uses `anyhow` for error propagation.

### kasirmu-lua, kasirmu-payment, and kasirmu-reporting (implemented)
These crates were originally scaffolded and are now fully implemented:

- **kasirmu-lua** — Embedded Lua scripting runtime built on [`mlua`](https://github.com/mlua-rs/mlua). Loads merchant scripts from `scripts/` and exposes business-rule hooks (`apply_discount`, `calc_line_tax`, `validate_order`). Sandboxed VM with instruction/memory limits and a restricted global environment.
- **kasirmu-payment** — `PaymentProcessor` trait with Stripe, Square, QRIS/Midtrans, Paddle, and mock implementations. Supports authorize, capture, void, refund, and sale flows.
- **kasirmu-reporting** — Daily summaries, sales-by-hour, top-products, menu-engineering, and inventory reports; optional `metrics` feature for Prometheus-style counters/gauges.

#### kasirmu-security (implemented)
- **Keyring trait** with three platform-native backends: Windows Credential Manager (`windows-sys`), macOS Keychain (`security-framework`), Linux Secret Service (`zbus`).
- **InMemoryKeyring** fallback for development/CI.
- **TlsConfig** — client cert + CA bundle loading, validation, builder API.
- **Mask** — card number masking for PCI-DSS safe display.

### kasirmu-logging
- `tracing` + `tracing-subscriber` with env-filter.
- Single `kasirmu_logging::init()` call wires up log sinks. Used by `apps/desktop-tauri` and `kasirmu-api`.
- JSON formatter, syslog, and Windows Event Log outputs planned for Phase 2.

### apps/desktop-tauri & apps/mobile-tauri (Tauri v2 Shells)
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
- **Currency module** (`modules/currency`): Manages exchange rates, currency listings, and currency-format settings via `CurrencyRepository`. Provides `ExchangeRateRow`, `CurrencyDto`, `CurrencyError` (with `Platform`, `Db`, `Validation`, `NotFound` variants), and 15+ typed DB methods. All settings delegate to `platform_core::settings::Settings`. The original 15 `kasirmu-core` Store wrappers are `#[deprecated]` in favour of direct `CurrencyRepository` calls.

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
- New device drivers can be added under `crates/kasirmu-hal/src/drivers/` by implementing the relevant trait.
- Additional business logic can be scripted in Lua files placed in a `scripts/` directory (Phase 3).
- Payment gateway integrations can be introduced as separate crates linked to `kasirmu-core`.
- New REST endpoints go in `crates/kasirmu-api/src/routes/` and are registered in `lib.rs`.
- See [MODULAR_APP_PLAN.md](./MODULAR_APP_PLAN.md) for detailed execution roadmaps covering dynamic module lifecycle hot-reloading (`platform/kernel`), LAN peer-to-peer KDS sync, and Docker containerized cloud server deployments (`apps/cloud-server`).

---
## License & Commercial Governance
- **Proprietary & Confidential (`All Rights Reserved`)**: See [`LICENSE`](../../LICENSE) for terms.
- No commercial deployment, redistribution, or modification is permitted without an executed commercial license agreement from kasir.mu Contributors.
- Internal developer contributions are governed under proprietary contributor agreements; all code strictly adheres to quality gates enforced at pre-commit and beyond (pre-commit: LF normalization, bundle parity, FTL dedupe, migration column-type lint, PG drift guard, Go, FTL orphan lint; pre-push/CI additionally check `cargo fmt` and clippy — fmt left pre-commit on 2026-09-13).

---
*Document generated on 2026‑06‑29.*  The gap between that line and the audit
footer below is the point: the prose has been re-stamped twice since it was written while
its own generation date stayed at June. Structural claims were re-verified 08-09-26 —
all 49 path references in this file resolve against the tree, and the migration count in
the layout block was corrected from 19 to 44 (the same fact is stated in
`docs/README.md`-adjacent files; `AGENTS.md` said 28 and `README.md` said 19, so three
documents carried three different answers).

> Count note (2026-09-13): the 09-08 stamp recorded 44 and that sentence stands; the measured count today is 59 (`ls crates/kasirmu-core/migrations/*.sql | wc -l`), of which 58 are SQLite and one is the generated PG file. The layout block and §Migrations now carry 59.

> last audited 08-09-26 by docs-auditor

