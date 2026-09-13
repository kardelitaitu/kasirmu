<!-- Audit stamp: 2026-09-08 · DSH · status: ACCURATE after repair (8 findings) · SUPERSEDES the 2026-08-29 stamp, whose repairs are carried forward: it fixed 156->354 commands and 42 files->52 modules, both of which were true on 29-08 and both of which are wrong today. That is the finding worth keeping: the command count on this page has been re-audited three times in ten days (156 -> 354 -> 385 -> 426) and has been stale every time it was written down, because the number tracks every commit that touches lib.rs. It is now stated as a dated measurement with the command to re-derive it, not as a fact. · RECONCILED the commands/ tree against the directory: 63 entries, 0 dead. Removed store_profiles.rs (the store→location rename made it locations.rs, and the entry also sat in the wrong alphabetical block); added legal_entities.rs, local_api.rs, locations.rs, memo.rs, payables.rs, products_images.rs — six command modules that exist in src/commands/ and appeared in no listing, including local_api.rs, which is the whole desktop extension surface that docs/guides/EXTENDING.md §2 documents. Counts now 58 production modules / 114 .rs files, 426 registered commands. · verified accurate: build.rs, main.rs, lib.rs, error.rs, state.rs at src/ level; the tree's remaining 57 command entries all resolve. -->

# `apps/desktop-client/` — OZ-POS desktop shell

Tauri v2 binary that hosts the React front-end, wires `oz-core` + `oz-hal` behind typed IPC commands, and produces installable bundles.

## Layout

```
apps/desktop-client/
├── Cargo.toml              # oz-pos-app crate
├── tauri.conf.json         # Tauri v2 config (window, updater, capabilities)
├── build.rs                # tauri_build::build()
├── capabilities/
│   └── default.json        # ACL for the main window
├── icons/                  # Full platform icon set (generated via cargo tauri icon)
└── src/
    ├── main.rs             # Binary entry; calls lib::run()
    ├── lib.rs              # Builder, invoke_handler!, run() — 426 commands registered as measured 08-09-26 (see docs/guides/api-reference.md for the authoritative list)
    ├── error.rs            # AppError (typed, non_exhaustive)
    ├── state.rs            # AppState (DB, driver registry, scanner cancel channel)
    └── commands/           # 58 production modules (114 .rs files incl. tests), grouped by domain
        ├── analytics.rs    # analytics queries
        ├── audit.rs        # list_audit_log
        ├── auth.rs         # staff_login
        ├── authz.rs        # authorization checks
        ├── branding.rs     # store branding config
        ├── browser.rs      # in-app browser
        ├── bundles.rs      # product bundles
        ├── categories.rs   # CRUD for product categories
        ├── currencies.rs   # currency_info, list_currencies, get/set_default_currency
        ├── customers.rs    # CRUD for customers
        ├── data.rs         # data management commands
        ├── edc.rs          # EDC payment terminal
        ├── email.rs        # report email scheduling
        ├── exchange_rates.rs # CRUD for exchange rates
        ├── features.rs     # list_all_features, set_feature
        ├── gift_cards.rs   # gift card management
        ├── hardware.rs     # cash drawer, receipt printing, scanner lifecycle
        ├── health.rs       # ping, version
        ├── history.rs      # sales history
        ├── inventory.rs    # inventory CRUD and stock adjustments
        ├── inventory_counts.rs # stock counting
        ├── kds.rs          # Kitchen Display System
        ├── kds_device.rs   # KDS device management
        ├── kds_routing.rs  # KDS routing
        ├── legal_entities.rs # Organization/Tenant legal-entity management
        ├── license.rs      # license status/activation
        ├── local_api.rs      # loopback local API server: enable, status, token mint
        ├── locations.rs        # location-profile CRUD (what store_profiles.rs became)
        ├── loyalty.rs      # loyalty program
        ├── memo.rs           # memo lifecycle (author, ack, active-for-terminal)
        ├── mod.rs          # module re-exports
        ├── offline.rs      # offline mode commands
        ├── payables.rs       # accounts payable (hutang / beli)
        ├── picker_ticket.rs # picker ticket
        ├── plugins.rs      # plugin management
        ├── pos.rs          # core POS pipeline
        ├── product_variants.rs # variant CRUD
        ├── products.rs     # CRUD, barcode lookup, stock adjustment
        ├── products_images.rs # product/menu image ingest (spec 0046b)
        ├── promotions.rs   # promotion management
        ├── purchasing.rs   # purchase orders
        ├── refunds.rs      # refund/void processing
        ├── reports.rs      # report generation
        ├── scale.rs        # weight scale integration
        ├── security.rs     # security/encryption commands
        ├── settings.rs     # receipt & store settings get/set
        ├── setup.rs        # setup wizard status, complete, feature discovery
        ├── shifts.rs       # staff shift management
        ├── staff.rs        # CRUD for staff, list_roles
        ├── stock_transfers.rs # transfer stock between locations
        ├── subscription.rs # subscription status
        ├── sync.rs         # sync commands
        ├── tables.rs       # restaurant table management
        ├── tax.rs          # CRUD for tax rates
        ├── terminals.rs    # terminal management
        ├── topology.rs     # workspace topology
        ├── void.rs         # void transactions
        └── workspaces.rs   # workspace management
```

## Adding a command

1. Create `apps/desktop-client/src/commands/<feature>.rs` with `#[tauri::command] async fn`.
2. Add `pub mod <feature>;` to `apps/desktop-client/src/commands/mod.rs`.
3. Register in `invoke_handler!` in `apps/desktop-client/src/lib.rs`.
4. Add typed wrapper in `ui/src/api/<feature>.ts`.

Full checklist in `.agents/skills/tauri-ipc/SKILL.md`.

## Icons

Generated from source image:
```bash
cargo tauri icon path/to/1024x1024.png
```
Writes to `icons/` and updates `tauri.conf.json`.

## Running

```bash
cd ui && npm run dev          # Terminal 1: Vite dev server
cargo tauri dev               # Terminal 2: Tauri dev shell
```

`cargo tauri build` produces platform bundles in `target/release/bundle/`.

## Key state

- `AppState` holds a `Mutex<Connection>` for SQLite, a `DriverRegistry` for HAL devices, and a `Mutex<Option<oneshot::Sender<()>>>` for scanner cancellation. At startup the client calls `platform_startup::hardware::register_hardware`, which maps the saved `TerminalProfile` → `HardwareConfig` and applies it to the registry (`apply_config`) so the operator's configured printers/displays/drawers are usable at runtime.
- Scanner background tasks emit `barcode:scanned` events via `app.emit()`.
- The `app` handle is `Option<AppHandle>` — always unwrap via `if let Some(ref app)`.

> last audited 08-09-26 by docs-auditor
