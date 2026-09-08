# OZ-POS Architecture

<!-- Audit stamp: 2026-08-31 · docs-auditor · status: ACCURATE (5 structural majors repaired) · FIXED 31-08: Core Traits rewritten verbatim from foundation/src/contracts.rs (Module id/dependencies/on_load/on_start/on_stop->ModuleResult; Service id/start/stop; EventHandler<E> generic; DomainEvent added; invented `trait Integration` removed); Platform Core Services tree trimmed to the 6 real services (auth/rbac/rbac_presets/permission_registry/database/settings/terminal_profile) with a note that logging/audit/cache live elsewhere; permission delimiter domain.action -> domain:action with real keys (sales:process/view/refund); Event Flow invented names (stock.updated/customer.history.updated/points.awarded/report.data.changed) replaced with real handlers (SaleSyncEnqueuer/InventorySyncEnqueuer/AuditLogHandler/LoyaltyEarnHandler) incl. the Rule-2 diagram; ADR #31 -> #43 (react-only); foundation/ -> foundation/src/; HAL/payment/reporting device lists synced; module tree corrected to the 14 active modules (loyalty/purchasing were wrongly marked 'planned', 8 real modules omitted); apps/unified added; foundation contracts list +DomainEvent · REMAINING (minor backlog, not falsehoods): no dedicated HAL/driver-trait section (EdcTerminal detail lives in crates/oz-hal/README.md); manifest example now complete (description+permissions); scoped-IPC (ADR #7) noted at commands/; remaining: PROMO-3/CUR-11/LOY-03/COR-7 not shown in any flow · counts (35 members / 13 crates / 14 modules / 61 ADRs) verified accurate -->

**Version:** 2.0 (Post-Restructuring)
**Status:** Active — restructuring complete

This document defines the long-term target architecture for OZ-POS. The 6-phase
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
module-to-module, upward `oz-core`, and non-composition platform dependencies
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
oz-pos/
│
├─ apps/              Deployable applications
│   ├─ cloud-server/    Cloud HTTP API (axum, for hosted tenants)
│   ├─ desktop-client/  Windows + Linux (keyboard/mouse, Tauri v2)
│   ├─ license-server/  License activation & validation (Go)
│   ├─ tablet-client/   Android + iPad (touch, Tauri v2)
│   └─ unified/         Containerized all-in-one deployment (Caddy + supervisord)
│
├─ platform/          System infrastructure
│   ├─ kernel/         Module system (load, unload, lifecycle)
│   ├─ core/           Shared services (auth, rbac, database, etc.)
│   ├─ sync/           Offline-first sync engine
│   ├─ api/            Backend HTTP API (today: crates/oz-api/)
│   └─ ui/             Frontend infrastructure (today: ui/src/frontend/)
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
│   (planned, not yet a crate: accounting, warehouse, restaurant, ecommerce)
│
├─ integrations/      External adapters (planned; today in crates/oz-hal, crates/oz-payment)
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
├─ frontend/          Shared frontend infrastructure (today: ui/src/frontend/)
│   ├─ shell/          App host (layout, sidebar, routing)
│   ├─ shared/         Reusable UI components
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

> Logging lives in `crates/oz-logging`; audit trail and caching live in
> `crates/oz-core`. Notifications, scheduler, localization, and tenancy are
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
defined above. This layout shows the **actual current state** after all 6
restructuring phases. For the long-term target vision (with `integrations/`,
top-level `frontend/`, additional modules, etc.), see the **Repository
Structure (Target — Long-Term Vision)** section above.

```
oz-pos/
│
├─ apps/              Deployable applications
│   ├─ cloud-server/    Cloud HTTP API (axum, for hosted tenants)
│   ├─ desktop-client/  Windows + Linux (moved from src-tauri/)
│   │   └─ src/
│   │       ├─ commands/  IPC command handlers (store-scoped `*_scoped` variants per ADR #7 Data Scope Guard)
│   │       ├─ error.rs
│   │       ├─ lib.rs     (uses platform_startup::init_module_system)
│   │       ├─ main.rs
│   │       └─ state.rs
│   ├─ license-server/  License activation & validation (Go)
│   └─ tablet-client/   Android + iPad (touch-optimized shell)
│       └─ src/
│           ├─ commands/  (shared with desktop-client)
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
│   ├─ oz-core/        Database migrations, domain types, Store, sync_client, events
│   ├─ oz-api/         HTTP API server (axum) — now injects config via AppState
│   ├─ oz-cli/         CLI tool for data import/export and maintenance
│   ├─ oz-crypto/      Cryptographic primitives (key generation, hashing, encryption)
│   ├─ oz-hal/         Hardware abstraction layer (printers, scanners, cash drawers, customer displays, scales, EDC payment terminals)
│   ├─ oz-logging/     Structured logging setup
│   ├─ oz-lua/         Lua scripting integration
│   ├─ oz-media/       Media/image handling
│   ├─ oz-notification/ Email & push notification dispatching
│   ├─ oz-payment/     Card payment processing (Stripe, QRIS, Square, Paddle, mock)
│   ├─ oz-plugin/      Plugin sandbox & lifecycle (Lua scripting bridge)
│   ├─ oz-reporting/   Report generation (CSV export, daily summaries, menu engineering)
│   └─ oz-security/    Auth, hashing, encryption
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
│   │   ├─ frontend/    Shell, shared components, themes, registries
│   │   ├─ platform/    UI registries (page, menu, widget)
│   │   ├─ locales/     Fluent i18n (domain-split .ftl files)
│   │   └─ main.tsx     Entry point with registrations
│   └─ package.json
│
├─ docs/
│   ├─ decisions/      ADRs (module-system, event-bus, frontend-restructure)
│   └─ specs/          Module manifest format spec
│
├─ ARCHITECTURE.md    This file
├─ AGENTS.md           AI agent configuration
└─ Cargo.toml          Workspace definition (35 members)
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
- [x] Create `apps/tablet-client/` — Tauri v2 mobile target (oz-pos-tablet)
- [x] Move `src-tauri/` → `apps/desktop-client/`
- [x] Build touch-optimized shell (bottom nav, larger hit targets)
- [x] Create `platform/startup/` — shared module registration + event wiring

### Phase 6 — Sync Engine ✅
- [x] Implement `platform/sync/` with queue, transport, push/pull replication
- [x] LWW conflict resolution (server-authoritative on tie)
- [x] Wire sync into sales module (SaleSyncEnqueuer)
- [x] Wire sync into inventory module (InventorySyncEnqueuer)
- [x] Integration tests (4 tests: single item, empty queue, multiple items, server error)

---

## Documentation Requirements

Every module must contain:
- `README.md` — Purpose, usage, configuration
- `CHANGELOG.md` — Version history

Every architectural change must create an Architecture Decision Record (ADR).
As of August 2026 there are 61 ADRs in `docs/decisions/`. Key documents include:
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

> status: ACCURATE (5 structural majors repaired 31-08-26) · Core Traits rewritten verbatim from foundation/src/contracts.rs (invented `Integration` removed, `DomainEvent` added); Platform Core Services trimmed to the 6 real services; permission delimiter corrected to `domain:action`; Event Flow invented names replaced with real handlers; ADR #43 and foundation/src/ corrected; counts verified accurate (35 members / 13 crates / 14 modules / 61 ADRs). Minor backlog in the top audit comment (no dedicated HAL section; feature flows not shown).

