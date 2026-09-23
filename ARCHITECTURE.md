# kasir.mu Architecture

<!-- Audit stamp: 2026-08-31 · docs-auditor · status: ACCURATE (5 structural majors repaired) · FIXED 31-08: Core Traits rewritten verbatim from foundation/src/contracts.rs (Module id/dependencies/on_load/on_start/on_stop->ModuleResult; Service id/start/stop; EventHandler<E> generic; DomainEvent added; invented `trait Integration` removed); Platform Core Services tree trimmed to the 6 real services (auth/rbac/rbac_presets/permission_registry/database/settings/terminal_profile) with a note that logging/audit/cache live elsewhere; permission delimiter domain.action -> domain:action with real keys (sales:process/view/refund); Event Flow invented names (stock.updated/customer.history.updated/points.awarded/report.data.changed) replaced with real handlers (SaleSyncEnqueuer/InventorySyncEnqueuer/AuditLogHandler/LoyaltyEarnHandler) incl. the Rule-2 diagram; ADR #31 -> #43 (react-only); foundation/ -> foundation/src/; HAL/payment/reporting device lists synced; module tree corrected to the 14 active modules (loyalty/purchasing were wrongly marked 'planned', 8 real modules omitted); apps/unified added; foundation contracts list +DomainEvent · REMAINING (minor backlog, not falsehoods): no dedicated HAL/driver-trait section (EdcTerminal detail lives in crates/kasirmu-hal/README.md); manifest example now complete (description+permissions); scoped-IPC (ADR #7) noted at commands/; remaining: PROMO-3/CUR-11/LOY-03/COR-7 not shown in any flow · counts (35 members / 13 crates / 14 modules / 61 ADRs) verified accurate at the time · SUPERSEDED 2026-09-18 by the P7 tree rewrite in this file (39 members / 17 crates / 14 modules / 71 ADRs) -->

**Version:** 2.0 (Post-Restructuring)
**Status:** Active — restructuring complete

This document defines the long-term target architecture for kasir.mu. The 6-phase
restructuring has been completed (tracked historically in `CHANGELOG.md`;
`RESTRUCTURING.md` was removed when the phases closed), migrating the
codebase from a flat monolith to the modular architecture described below.

---

## Core Goals

- **Offline First** — POS works without internet. Cloud is optional, sync is eventual.
- **Modular** — Every feature is a self-contained module with its own backend + frontend.
- **Rust First** — Core business logic, database, and API are all Rust.
- **Multi-Platform** — Windows, Linux, Android Tablet, iPad.
- **Feature Toggle System** — Modules are enabled/disabled at runtime.
- **Multi-Store Ready** — Architecture supports single store, multi-store, and franchise.
- **Sync Ready** — Offline-first with eventual consistency.
- **Long Term Maintainability** — Clear boundaries, no spaghetti.
- **Fast Development** — Module isolation enables parallel teams.

---

## Technology Stack

| Layer            | Technology             |
| ---------------- | ---------------------- |
| Core Backend     | Rust                   |
| UI Shell         | Tauri v2               |
| Frontend         | React                 |
| Database         | SQLite                 |
| API              | Rust (Tauri IPC + HTTP)|
| State Management | React hooks (useState, useCallback, useContext) |
| Build System     | Cargo Workspace                                    |
| Testing          | Rust Test + Vitest + Playwright                    |
| Documentation    | Markdown + ADRs        |


The architecture was originally designed to be framework-agnostic but was unified
under React exclusively per ADR #43 (2026-07-24 react-only-decision).

---

## Architecture Principles

### Rule 1 — Modules Own Business Logic

Modules are the atomic unit of business capability. Each module owns its entire
vertical slice: database models, services, API routes, and UI pages.

Inventory owns inventory logic.
Sales owns sales logic.
CRM owns CRM logic.

### Rule 2 — No Direct Module-to-Module Calls

Modules communicate exclusively through an event bus. This prevents coupling
and enables independent testing, loading, and replacement. New production
module-to-module, upward `kasirmu-core`, and non-composition platform dependencies
are blocked by `scripts/verify-architecture-boundaries.py`; existing
transitional findings are explicitly baselined with owners and expiry dates.

```
  Sales              Inventory
    |                    |
    ▼                    ▼
  ┌──────────────────────────┐
  │       Event Bus          │
  └──────────────────────────┘
    |                    |
    ▼                    ▼
  sale.completed      stock.adjusted
```

### Rule 3 — Platform Provides Infrastructure Only

The platform layer (kernel, core, sync, etc.) contains zero business logic.
It provides infrastructure that modules consume.

### Rule 4 — Integrations Are Adapters

External service integrations (Stripe, Midtrans, Epson Printer, WhatsApp) are
thin adapters with no business logic. Business rules live in modules.

### Rule 5 — SQLite Is the Source of Truth

Cloud is optional. The POS must continue working without internet. SQLite is
the authoritative data store. Cloud sync is eventual and non-blocking.

---

## Repository Structure (Target — Long-Term Vision)

> ⚠️ The diagram below shows the **long-term target architecture** the codebase
> is evolving toward. It is NOT the current state — many of these directories
> (`integrations/`, top-level `frontend/`, `tooling/`, `config/`, `tests/`,
> and modules like `accounting`, `warehouse`,
> `restaurant`, `ecommerce`) do not yet exist (`loyalty`, `purchasing`,
> `kitchen`, `giftcards`, `promotions` were added since this diagram was
> drawn). See the **Project Layout
> (Post-Restructuring) — Current State** section below for the actual
> current directory structure.

```
kasir.mu/
│
├─ apps/              Deployable applications
│   ├─ cloud-server/    Cloud HTTP API (axum, for hosted tenants)
│   ├─ desktop-tauri/   Windows + Linux (keyboard/mouse, Tauri v2)
│   ├─ license-server/  License activation & validation (Go)
│   ├─ mobile-tauri/    Android + iPad (touch, Tauri v2)
│   └─ unified/         Containerized all-in-one deployment (Caddy + supervisord)
│
├─ platform/          System infrastructure
│   ├─ kernel/         Module system (load, unload, lifecycle)
│   ├─ core/           Shared services (auth, rbac, database, etc.)
│   ├─ sync/           Offline-first sync engine
│   ├─ api/            Backend HTTP API (today: crates/kasirmu-api/)
│   └─ ui/             Frontend infrastructure (today: ui/src/registries/ + ui/src/app/)
│
├─ modules/           Business features (14 active, all registered in the kernel)
│   ├─ sales/
│   ├─ inventory/
│   ├─ crm/
│   ├─ loyalty/
│   ├─ promotions/
│   ├─ currency/
│   ├─ tax/
│   ├─ reporting/
│   ├─ purchasing/
│   ├─ giftcards/
│   ├─ kitchen/
│   ├─ settings/
│   ├─ staff/
│   └─ terminal/
│   (planned, not yet a crate: accounting, warehouse, restaurant, ecommerce — and of the 14 on disk, purchasing/promotions/giftcards/kitchen are still stubs with no domain logic)
│
├─ integrations/      External adapters (planned; today in crates/kasirmu-hal, crates/kasirmu-payment)
│   ├─ payments/       (cash, stripe, midtrans, xendit)
│   ├─ hardware/       (printers, scanners, cash-drawers, customer displays, scales, EDC terminals)
│   ├─ messaging/      (whatsapp, email, telegram)
│   ├─ shipping/
│   └─ tax/
│
├─ foundation/        Reusable zero-business-logic code
│   ├─ contracts/      Core traits (Module, Service, EventHandler, DomainEvent)
│   ├─ dto/            Shared DTOs                 (planned)
│   ├─ value-objects/  Money, Currency, Email, etc. (today: money.rs)
│   ├─ errors/         Shared error types
│   ├─ validation/     Validation utilities         (planned)
│   ├─ enums/          Shared enumerations
│   ├─ constants/      Shared constants             (planned)
│   └─ utils/          Pure utility functions       (planned)
│
├─ frontend/          Shared frontend infrastructure (today: ui/src/app/ for the shell, ui/src/components/ for shared components, ui/src/theme/ for tokens)
│   ├─ shell/          App host (layout, sidebar, routing)
│   ├─ shared/         Reusable UI components   (P2 decision: components/ survives as the name and location — ui/src/components/)
│   ├─ desktop/        Desktop-specific layouts
│   ├─ tablet/         Tablet-specific layouts
│   ├─ widgets/        Dashboard widget framework
│   └─ themes/         Branding and theming
│
├─ tooling/           Build tools, scaffolding, generators (planned)
├─ config/            Shared configuration           (planned)
├─ docs/              Documentation + ADRs
│   └─ decisions/      Architecture Decision Records
├─ assets/            Icons, fonts, branding         (exists at root)
└─ tests/             End-to-end and integration tests (planned)
```

---

## Module Structure

> ⚠️ **Target state, not current reality.** Today every module is a Rust crate
> with `Cargo.toml`, `README.md`, `manifest.json`, `src/`, and (where relevant)
> `tests/` — there are **no** `ui/`, `migrations/`, `services/`, `events/`, or
> `permissions/` directories inside any module. Module frontends live in
> `ui/src/features/` and register via the `@/features` barrel (ADR #31). The
> layout below is the long-term target for a full vertical-slice module:

```
modules/inventory/  (today: Cargo.toml · README.md · manifest.json · src/{lib,models,service,repository,handlers}.rs · tests/)
│
├─ manifest.json       Module metadata (id, name, version, dependencies)
├─ migrations/         SQLite migrations            (target)
├─ src/                Rust backend
│   ├─ services/        Business logic               (target)
│   ├─ repositories/    Database access              (target)
│   ├─ models/          Domain entities
│   ├─ events/          Published event types        (target)
│   ├─ permissions/     Module-specific permission keys (target)
│   └─ lib.rs           Module entry point
├─ ui/                 Frontend                     (target — today in ui/src/features/)
│   ├─ pages/           Full-page routes
│   ├─ components/      Module-specific components
│   ├─ routes/          Route definitions
│   └─ widgets/         Dashboard widgets
└─ tests/              Module-specific tests
```

### Module Manifest Example

```json
{
  "id": "inventory",
  "name": "Inventory",
  "version": "1.0.0",
  "description": "Product catalog and stock management module: product CRUD, barcode lookup, variants, categories, stock adjustments, inventory tracking.",
  "dependencies": [],
  "permissions": [
    "inventory:view",
    "inventory:edit",
    "inventory:adjust"
  ]
}
```

---

## Platform Core Services

```
platform/core/src/
│
├─ auth.rs               Authentication (login, logout, sessions, PIN verify)
├─ rbac.rs               Authorization (roles, permissions, policies)
├─ rbac_presets.rs       Seeded role/permission presets
├─ permission_registry.rs Canonical permission keys (domain:action)
├─ database/             SQLite management (connection, transactions, migrations)
├─ settings/             Application configuration (store name, tax, currency)
└─ terminal_profile.rs   Terminal profile resolution
```

> Logging lives in `crates/kasirmu-logging`; audit trail and caching live in
> `crates/kasirmu-core`. Notifications, scheduler, localization, and tenancy are
> **not** implemented as platform/core services.

### Permission Examples

Permissions follow a `domain:action` pattern (colon delimiter):
- `sales:process`
- `sales:view`
- `sales:refund`

---

## Event Bus

The event bus is the critical architectural boundary. Modules publish events;
other modules subscribe. No module ever imports another module directly.

### Event Flow Example

```
Sale Completed   (DomainEvent: "sale.completed")
     │
     ▼
Event Bus
     │
     ├── Sales       → SaleSyncEnqueuer      (enqueue for cloud sync)
     ├── Inventory   → InventorySyncEnqueuer (stock movement + sync)
     ├── Audit       → AuditLogHandler       (immutable trail)
     └── Loyalty     → LoyaltyEarnHandler    (points awarded)
```

Foundation domain events (`foundation/src/events.rs`) are `SaleCompleted`,
`ProductCreated`, and `StockAdjusted`; `SettingsUpdated` is published from the
platform layer. Handlers are registered at startup in
`platform/startup/src/event_handlers.rs`.

### Core Traits

```rust
type ModuleId = &'static str;
type ModuleResult<T = ()> = Result<T, anyhow::Error>;

trait Module: Debug + Send + Sync {
    fn id(&self) -> ModuleId;
    fn dependencies(&self) -> &'static [ModuleId] { &[] }
    fn on_load(&mut self) -> ModuleResult { Ok(()) }
    fn on_start(&mut self) -> ModuleResult { Ok(()) }
    fn on_stop(&mut self) -> ModuleResult { Ok(()) }
}

trait Service: Debug + Send + Sync {
    fn id(&self) -> &'static str;
    fn start(&mut self) -> ModuleResult;
    fn stop(&mut self) -> ModuleResult;
}

trait EventHandler<E>: Send + Sync
where E: Send + Sync + 'static {
    fn handle(&self, event: &E) -> ModuleResult;
}

trait DomainEvent: Send + Sync + 'static {
    fn event_name(&self) -> &'static str;
}
```

---

## Module Loading Flow

```
Application Start
     │
     ▼
Load Settings
     │
     ▼
Load Enabled Modules
     │
     ▼
Register Routes
     │
     ▼
Register Menus
     │
     ▼
Register Widgets
     │
     ▼
Start Application
```

Feature toggles are persisted in settings and control which modules load:

```
Settings → Modules → Inventory  [ON]
                      CRM        [OFF]
                      Loyalty    [OFF]
                      Reporting  [ON]
     │
     ▼
Save → Restart → Load Enabled Modules Only
```

---

## Project Layout (Post-Restructuring) — Current State

The codebase has been restructured from a flat monolith into the modular architecture
defined above. This layout shows the **actual current state** as of 2026-09-18, after the
6 restructuring phases **and the repository folder restructure** (`ops/`, `prototypes/`,
`tools/`, `ui/src/app|theme|registries`, `shared-ui/locales` — see
`todo-project-folder-restructure.md`). For the long-term target vision (with `integrations/`,
top-level `frontend/`, additional modules, etc.), see the **Repository
Structure (Target — Long-Term Vision)** section above.

```
kasir.mu/
│
├─ apps/              Deployable applications
│   ├─ cloud-server/    Cloud HTTP API (axum, for hosted tenants)
│   ├─ desktop-tauri/   Windows + Linux (moved from src-tauri/, renamed from desktop-client/)
│   │   └─ src/
│   │       ├─ commands/  IPC command handlers (store-scoped `*_scoped` variants per ADR #7 Data Scope Guard)
│   │       ├─ error.rs
│   │       ├─ lib.rs     (uses platform_startup::init_module_system)
│   │       ├─ main.rs
│   │       └─ state.rs
│   ├─ license-server/  License activation & validation (Go)
│   └─ mobile-tauri/   Android + iPad (touch-optimized shell)
│       └─ src/
│           ├─ commands/  (shared with desktop-tauri)
│           └─ same structure
│
├─ platform/          System infrastructure
│   ├─ core/           Shared services (database, settings, auth stubs)
│   ├─ kernel/         Module system lifecycle (register → load → start → stop)
│   ├─ startup/        Shared startup: module registration + event wiring
│   └─ sync/           Offline-first sync engine (queue, transport, replication, LWW conflict)
│
├─ modules/           Business features (14 modules)
│   ├─ sales/          Point-of-sale (core cart, checkout, sales history)
│   ├─ inventory/      Product catalog, stock management
│   ├─ crm/            Customer management
│   ├─ tax/            Tax rate configuration
│   ├─ settings/       Feature toggles, store configuration, sync settings
│   ├─ staff/          Employee management, roles
│   ├─ reporting/      Dashboard widgets, sales reports
│   ├─ terminal/       POS terminal management
│   ├─ currency/       Multi-currency + exchange rates
│   ├─ loyalty/        Customer loyalty & rewards management
│   ├─ giftcards/      Gift card management
│   ├─ kitchen/        Kitchen Display System (KDS)
│   ├─ promotions/     Promotions & discounts
│   └─ purchasing/     Purchase orders & suppliers
│
├─ crates/            Low-level utility crates
│   ├─ kasirmu-core/        Database migrations, domain types, Store, sync_client, events
│   ├─ kasirmu-api/         HTTP API server (axum) — now injects config via AppState
│   ├─ kasirmu-cli/         CLI tool for data import/export and maintenance
│   ├─ kasirmu-crypto/      Cryptographic primitives (key generation, hashing, encryption)
│   ├─ kasirmu-hal/         Hardware abstraction layer (printers, scanners, cash drawers, customer displays, scales, EDC payment terminals)
│   ├─ kasirmu-logging/     Structured logging setup
│   ├─ kasirmu-lua/         Lua scripting integration
│   ├─ kasirmu-media/       Media/image handling
│   ├─ kasirmu-notification/ Email & push notification dispatching
│   ├─ kasirmu-payment/     Card payment processing (Stripe, QRIS, Square, Paddle, mock)
│   ├─ kasirmu-plugin/      Plugin sandbox & lifecycle (Lua scripting bridge)
│   ├─ kasirmu-reporting/   Report generation (CSV export, daily summaries, menu engineering)
│   └─ kasirmu-security/    Auth, hashing, encryption
│
├─ foundation/src/    Reusable zero-business-logic code
│   ├─ contracts.rs    Core traits (Module, Service, EventHandler, DomainEvent)
│   ├─ errors.rs       Shared error types (MoneyError, SkuError)
│   ├─ enums.rs        Shared enumerations (SaleStatus, PaymentMethod)
│   ├─ money.rs        Money, Currency value objects
│   ├─ barcode.rs      Barcode generation and parsing
│   ├─ cart.rs         Cart-line domain type
│   ├─ constants.rs    Shared constants
│   ├─ contact.rs      Contact-info value objects
│   ├─ dto.rs          Shared DTOs
│   ├─ events.rs       Domain event type definitions
│   ├─ percentage.rs   Percentage value object
│   ├─ sku.rs          SKU value object
│   └─ validation.rs   Validation utilities
│
├─ ui/                Frontend (React/TypeScript)
│   ├─ src/
│   │   ├─ api/         Per-domain API files (sales.ts, products.ts, etc.)
│   │   ├─ features/    Feature screens (sales, products, customers, etc.)
│   │   ├─ app/         Shell (AppLayout, AppShell)
│   │   ├─ components/  Shared UI components
│   │   ├─ theme/       Design tokens + theme CSS
│   │   ├─ registries/  Page, menu, widget registries
│   │   └─ main.tsx     Entry point with registrations
│   └─ package.json
│
├─ ops/               Build & ship artifacts (docker/, install/, packaging/, gateway/)
├─ prototypes/        Design-language & KDS prototypes (not product code)
├─ tools/             Repo tooling (fuzz targets)
├─ website/           kasir.mu marketing site (Astro)
├─ shared-ui/         Toolkit-neutral shared UI assets (locales/ — the Fluent corpus)
├─ docs/
│   ├─ decisions/      ADRs (module-system, event-bus, frontend-restructure)
│   └─ specs/          Module manifest format spec
│
├─ ARCHITECTURE.md    This file
├─ AGENTS.md           AI agent configuration
└─ Cargo.toml          Workspace definition — 39 packages resolve from the glob members (17 crates, 14 modules, 4 platform dirs, foundation, 3 apps)
```

---

## Migration Roadmap (Complete ✅)

All 6 restructuring phases have been completed.

### Phase 1 — Foundation ✅
- [x] Rust workspace with crate separation
- [x] Design tokens and component library
- [x] Shared modal/toast/empty-state components
- [x] Fluent localization infrastructure

### Phase 2 — Module Extraction ✅
- [x] Define `Module` trait and kernel skeleton (`foundation/src/contracts.rs`)
- [x] Extract `foundation/` crate (Money, Currency, contracts, errors, enums)
- [x] Create `platform/core/` (database, auth, rbac, settings stubs)
- [x] Create `platform/kernel/` (Kernel struct, lifecycle, dependency resolution)
- [x] Create 10 business modules (sales, inventory, crm, tax, settings, staff, reporting, terminal, currency, loyalty)
- [x] Wire all modules into both desktop + tablet clients via shared startup

### Phase 3 — Event Bus ✅
- [x] Implement in-process event bus in `platform/kernel/`
- [x] Wire `sale.completed` → inventory stock update + CRM history + audit log + reporting
- [x] Wire `product.created` → audit log + sync enqueuer
- [x] Wire `stock.adjusted` → audit log + sync enqueuer
- [x] Remove all direct module-to-module Store calls

### Phase 4 — Frontend Infrastructure ✅
- [x] Split `api/pos.ts` into 12 per-domain API files
- [x] Create `frontend/shell/` (AppLayout, AppShell extracted from App.tsx)
- [x] Create `frontend/shared/` (Button, Card, Modal, etc. from components/)
- [x] Create `frontend/themes/` (tokens, components, reset CSS from styles/)
- [x] Build page-registry, menu-registry, widget-registry
- [x] Refactor `App.tsx` to render from registries with feature gating
- [x] Split `en-US.ftl` into 12 per-domain Fluent files

### Phase 5 — Tablet Client ✅
- [x] Create `apps/mobile-tauri/` — Tauri v2 mobile target (dir renamed from `tablet-client/` in 2026-09; the `oz-pos-tablet` package-name rename belongs to the rebrand campaign's T3-2)
- [x] Move `src-tauri/` → the desktop shell dir (named "desktop-client" at the time of the move; renamed to desktop-tauri/ in 2026-09)
- [x] Build touch-optimized shell (bottom nav, larger hit targets)
- [x] Create `platform/startup/` — shared module registration + event wiring

### Phase 6 — Sync Engine ✅
- [x] Implement `platform/sync/` with queue, transport, push/pull replication
- [x] LWW conflict resolution (server-authoritative on tie)
- [x] Wire sync into sales module (SaleSyncEnqueuer)
- [x] Wire sync into inventory module (InventorySyncEnqueuer)
- [x] Integration tests (4 tests: single item, empty queue, multiple items, server error)

---

## Module Details

> Merged here from `docs/architecture/ARCHITECTURE.md` on 2026-09-23 (documentation
> audit): two files both claimed authority over this system and had diverged by 841
> diff lines. This file is canonical; that path is now a pointer stub. Section content
> carries the audit lineage of the source file (DSH 2026-09-08 stamp, C30 count pass
> 2026-09-23), with one repair at the port: the `SetupWizard.tsx:70` citation named a
> file deleted in the wizard retirement, so preset facts now point at their live owners.

### kasirmu-core
- **Responsibilities**: Foundation crate. Every other crate depends on it.
- **Key types**:
  - `Money(i64 minor_units, Currency)` — integer-only, checked arithmetic. Never f32/f64.
  - `Currency([u8; 3])` — ISO-4217 currency code.
  - `Cart` / `CartLine` — in-memory sale pipeline with currency matching.
  - `Sale` / `SaleLine` — transaction lifecycle state machine: `Pending → Active → Completed | Voided`.
  - `Product`, `Category`, `Inventory`, `Sku` — domain types with serde.
  - `Feature` — **39** toggleable feature flags (counted over the `pub enum Feature` variants in `crates/kasirmu-core/src/features.rs`; the file's own `//!` header still says 32 and is stale — a code finding, left alone) with dependency resolution, and **6** setup presets: `simple-retail`, `restaurant`, `full-store`, `cafe`, `franchise`, `custom` (union in `ui/src/api/settings.ts`, keys in `shared-ui/locales/settings.ftl`, preset→feature bundles owned by `preset_feature_keys` in `crates/kasirmu-core/src/features.rs`). The count on this line said 5 until 08-09-26, the same stale count corrected in `docs/guides/developer/admin-guide.md` the same day.
  - `Store<'a>` — typed CRUD facade over `&Connection`. All writes inside transactions.
- **Migrations**: 66 SQLite `.sql` files plus the generated PG file, **67 in all as measured
  2026-09-23** (`ls crates/kasirmu-core/migrations/*.sql | wc -l` → 67;
  `ls crates/kasirmu-core/migrations/*.pg.sql | wc -l` → 1), embedded by the
  `include_str!` list in `crates/kasirmu-core/src/migrations.rs`. Re-derive both numbers — this
  line has now been corrected twice (44 → 59 → 67) because a migration lands with most slices.
  The 131-file history was squashed into `20260813_init.sql` — not `init.sql`. `kasirmu_core::migrations::run(conn)` is invoked at
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

### kasirmu-security (implemented)
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
- **Commands**: the registered IPC surface is indexed by [`docs/guides/developer/api-reference.md`](./docs/guides/developer/api-reference.md), which owns the count — quote the number from there (the 505 figure that used to sit here counted registrations across 49 modules and was superseded by that file's audit of the registered surface).
- **Error**: `AppError` — tagged JSON with `{kind, message}`, `From` impls for `CoreError`, `HalError`, `tauri::Error`.

### platform/ (Platform Crates)
- **platform-core**: Shared DB schema, Store facade, migration runner for all platform crates.
- **platform-startup**: Initialisation orchestration — DB setup, event-handler registration, audit logging, and HAL hardware registration (`register_hardware` → `apply_config`). (It does **not** run the kasirmu-core migrations — see the Migrations line above.)
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
cd apps/desktop-tauri && cargo tauri dev       # launches Tauri dev window
   ```
5. **Run on Android/iPad** — Use Tauri's mobile targets (requires Android SDK / Xcode).

---

## Extensibility
- New device drivers can be added under `crates/kasirmu-hal/src/drivers/` by implementing the relevant trait.
- Additional business logic can be scripted in Lua files placed in a `scripts/` directory (Phase 3).
- Payment gateway integrations can be introduced as separate crates linked to `kasirmu-core`.
- New REST endpoints go in `crates/kasirmu-api/src/routes/` and are registered in `lib.rs`.
- See [MODULAR_APP_PLAN.md](./docs/architecture/MODULAR_APP_PLAN.md) for detailed execution roadmaps covering dynamic module lifecycle hot-reloading (`platform/kernel`), LAN peer-to-peer KDS sync, and Docker containerized cloud server deployments (`apps/cloud-server`).

---

## License & Commercial Governance
- **Proprietary & Confidential (`All Rights Reserved`)**: See [`LICENSE`](./LICENSE) for terms.
- No commercial deployment, redistribution, or modification is permitted without an executed commercial license agreement from kasir.mu Contributors.
- Internal developer contributions are governed under proprietary contributor agreements; all code strictly adheres to quality gates enforced at pre-commit and beyond (pre-commit: LF normalization, bundle parity, FTL dedupe, migration column-type lint, PG drift guard, Go, FTL orphan lint; pre-push/CI additionally check `cargo fmt` and clippy — fmt left pre-commit on 2026-09-13). The live list of gates is whatever [`docs/operations/ci-pipeline.md`](./docs/operations/ci-pipeline.md) and `scripts/gates.json` say — do not re-derive it from this sentence.

---

## Documentation Requirements

Every module must contain:
- `README.md` — Purpose, usage, configuration

Version history lives in the single root `CHANGELOG.md` (plus per-release
`CHANGELOG-0.0.XX.md` files under `docs/releases/`). A per-module
`CHANGELOG.md` was previously required here; 0 of 14 modules carried one and
no tooling reads them, so the rule was dropped by the 2026-09-23 documentation
audit rather than kept as a requirement nothing satisfies.

Every architectural change must create an Architecture Decision Record (ADR).
As of September 2026 there are 71 ADRs in `docs/decisions/` (plus 2 archived). Key documents include:
```
docs/decisions/2026-01-15-module-system-design.md
docs/decisions/2026-02-01-event-bus-design.md
docs/decisions/2026-03-01-frontend-restructure.md
docs/decisions/2026-07-10-workspace-type-instance-design.md
docs/decisions/archived/2026-07-10-subscription-tier-entitlement.md
docs/decisions/2026-07-15-whitelabel-branding-system.md
docs/decisions/2026-07-18-kds-multi-layout-system.md
docs/decisions/2026-07-20-node-based-store-topology-builder.md
docs/decisions/2026-07-24-domain-module-extraction.md
docs/decisions/2026-07-24-react-only-decision.md
docs/decisions/2026-07-25-db-extraction-and-platform-split.md
```

For the full list see the `docs/decisions/` directory.

---

## Non-Negotiable Rules

1. No business logic in platform.
2. No business logic in integrations.
3. No direct module-to-module calls.
4. Events first.
5. SQLite first.
6. Offline first.
7. Module owns backend and frontend.
8. Shared code contains no business logic.
9. Every module is independently testable.
10. Documentation updated with every architecture change.

---

*This document is a living specification. Phase boundaries are guidelines,
not hard deadlines. Every PR should move the codebase closer to the target
architecture.*

> last audited 08-09-26 by docs-auditor

> status: ACCURATE (5 structural majors repaired 31-08-26) · Core Traits rewritten verbatim from foundation/src/contracts.rs (invented `Integration` removed, `DomainEvent` added); Platform Core Services trimmed to the 6 real services; permission delimiter corrected to `domain:action`; Event Flow invented names replaced with real handlers; ADR #43 and foundation/src/ corrected; counts verified accurate at the time (35 members / 13 crates / 14 modules / 61 ADRs — superseded 2026-09-18: 39 members / 17 crates / 14 modules / 71 ADRs). Minor backlog in the top audit comment (no dedicated HAL section; feature flows not shown).

