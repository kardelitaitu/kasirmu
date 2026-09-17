<!-- Audit stamp: 2026-09-08 · DSH · status: ACCURATE after repair (8 findings) · SUPERSEDES the 2026-08-29 stamp, whose repairs are carried forward: it fixed 156->354 commands and 42 files->52 modules, both of which were true on 29-08 and both of which are wrong today. That is the finding worth keeping: the command count on this page has been re-audited three times in ten days (156 -> 354 -> 385 -> 426) and has been stale every time it was written down, because the number tracks every commit that touches lib.rs. It is now stated as a dated measurement with the command to re-derive it, not as a fact. · RECONCILED the commands/ tree against the directory: 63 entries, 0 dead. Removed store_profiles.rs (the store→location rename made it locations.rs, and the entry also sat in the wrong alphabetical block); added legal_entities.rs, local_api.rs, locations.rs, memo.rs, payables.rs, products_images.rs — six command modules that exist in src/commands/ and appeared in no listing, including local_api.rs, which is the whole desktop extension surface that docs/guides/EXTENDING.md §2 documents. Counts now 58 production modules / 114 .rs files, 426 registered commands. · verified accurate: build.rs, main.rs, lib.rs, error.rs, state.rs at src/ level; the tree's remaining 57 command entries all resolve. -->

# `apps/desktop-client/` — OZ-POS desktop shell

> **Count note 2026-09-14 · DSH · comment-only pass ·** the 08-09-26 figures above are left exactly as written because they are dated point-in-time records; current values are appended next to them, not substituted. Measured this pass against this checkout: **453 distinct registered command paths** in `src/lib.rs:845-1340` (`python scripts/verify-ipc-parity.py` → 458 UI command strings / 453 registered / 27 unregistered, EXIT 0; an independent `sed -n '/tauri::generate_handler!\[/,/^        \])/p' src/lib.rs | grep -cE '^[[:space:]]*commands::'` returns the same 453), so the `lib.rs` line grew from 426 (08-09-26) to 453 — the same drift that page's own history predicts. **7 command modules that exist on disk were named in no listing** (`fiscal.rs`, `local_payment.rs`, `qris_auto.rs`, `receipt_format.rs`, `regional.rs`, `registration_gate_debt.generated.rs`, and the `topology/` submodule dir), each added to the tree from its own `//!` header; **5 `src/` production modules were likewise unlisted** (`email_scheduler.rs`, `image_push.rs`, `lan_server.rs`, `local_api.rs`, `sync_bootstrap.rs` — `ls src/*.rs`), plus `gen/` and `tests/` at the crate root. **0 dead entries removed**: every path the old listing named still resolves (`comm` of the listing against `ls src/commands/*.rs` returns only `store_profiles.rs`, which is prose inside a comment, not a listing row). `Key state` corrected where the source disagrees: `AppState.db` is `Arc<Mutex<Connection>>` not `Mutex<Connection>`, `registry` is `Arc<DriverRegistry>`, and this shell no longer calls `app.emit("barcode:scanned")` itself — `kasirmu-bridge` owns that emit; `platform_startup::hardware::register_hardware` → `kasirmu_hal::apply_config` (`platform/startup/src/hardware.rs:163`) was checked and is still accurate. **Not verified, therefore unchanged:** `cargo tauri build` output paths, the `icons/` regeneration claim, `tauri.conf.json` contents, and every per-command description in the tree comments (descriptions were spot-checked only for the seven new rows, from each file's own module doc). **Out of fence, reported not fixed:** `docs/guides/api-reference.md:18` still asserts "454 distinct commands … 429 in [desktop]" against today's measured 453 desktop / 322 tablet, and `apps/desktop-client` is only one of the two pages it claims to reconcile.

Tauri v2 binary that hosts the React front-end, wires `kasirmu-core` + `kasirmu-hal` behind typed IPC commands, and produces installable bundles.

## Layout

```
apps/desktop-client/
├── Cargo.toml              # oz-pos-app crate
├── tauri.conf.json         # Tauri v2 config (window, updater, capabilities)
├── build.rs                # tauri_build::build() (build.rs:8, verified 2026-09-14)
├── gen/schemas/            # tauri-generated ACL/capability/schema JSON — generated, never hand-edited
├── tests/                  # 6 integration test files (capability_parity, gate_audit, kernel_lifecycle, window_state_multi_monitor, window_visibility, wiring_audit)
├── capabilities/
│   └── default.json        # ACL for the main window
├── icons/                  # Full platform icon set (generated via cargo tauri icon)
└── src/
    ├── main.rs             # Binary entry; calls lib::run()
    ├── lib.rs              # Builder, invoke_handler! (src/lib.rs:845-1340), run() — 426 commands registered as measured 08-09-26; 453 distinct registered command paths as measured 2026-09-14 by `python scripts/verify-ipc-parity.py` (458 UI command strings / 453 registered / 27 unregistered, EXIT 0) — re-measure, this number moves with every commit that touches the handler list (see docs/guides/api-reference.md for the per-command list)
    ├── error.rs            # AppError (typed, non_exhaustive)
    ├── email_scheduler.rs  # background report-email scheduler
    ├── image_push.rs       # image_push_queue drainer → cloud batch endpoint
    ├── lan_server.rs       # LAN event forwarding for multi-terminal stores
    ├── local_api.rs        # loopback REST server (daemon-residue module)
    ├── sync_bootstrap.rs   # sync daemon wiring at startup
    ├── state.rs            # AppState (DB, driver registry, scanner cancel channel; 23 `pub` fields as measured 2026-09-14 by `grep -c '^    pub [a-z_]*:' src/state.rs` — run from `apps/desktop-client/`; a looser `grep -c "^    pub "` reads 34 because it also catches `pub(crate)` and `pub fn` lines, so use the exact pattern)
    └── commands/           # 58 production modules (114 .rs files incl. tests) as measured 08-09-26; 64 non-test .rs files here (63 domain modules + mod.rs) and 79 .rs in this dir including the topology/ submodules and 10 *_tests.rs, as measured 2026-09-14 by `find apps/desktop-client/src/commands -maxdepth 1 -name '*.rs' ! -name '*_tests.rs' | wc -l` and `find apps/desktop-client/src/commands -name '*.rs' | wc -l` — the tree below names each domain module once
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
        ├── fiscal.rs       # fiscal scheme + statutory numbering (regional slice 5)
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
        ├── local_payment.rs  # local payment-method rails, entity → location (regional slice 6)
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
        ├── qris_auto.rs    # QRIS Auto dynamic-charge IPC (thin shim over kasirmu_bridge::qris_auto)
        ├── receipt_format.rs # regional receipt-format axis (EffectiveReceiptFormat)
        ├── refunds.rs      # refund/void processing
        ├── regional.rs     # regional configuration (saas-2 slices 2–3)
        ├── registration_gate_debt.generated.rs # GENERATED — registration-gate sweep ledger, never hand-edit
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
        ├── topology.rs     # workspace topology (its submodules live in topology/)
        │   ├── commands.rs     # topology IPC command bodies
        │   ├── model.rs        # topology model types
        │   ├── persistence.rs  # topology read/write against the store
        │   ├── revisions.rs    # revision history
        │   └── semantics.rs    # resolution rules shared by the commands
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

- `AppState` holds an `Arc<Mutex<Connection>>` for SQLite (shared with the background sync daemon), an `Arc<DriverRegistry>` for HAL devices, and a `Mutex<Option<oneshot::Sender<()>>>` for scanner cancellation — field types read from the `pub struct AppState` body (`src/state.rs:75`, closing brace at `:211`) on 2026-09-14. At startup the client calls `platform_startup::hardware::register_hardware`, which maps the saved `TerminalProfile` → `HardwareConfig` and applies it to the registry (`apply_config`) so the operator's configured printers/displays/drawers are usable at runtime.
- Scanner background tasks broadcast `barcode:scanned` / `barcode:error` to the UI. As measured 2026-09-14 the emit happens in the bridge, not in this shell: `crates/kasirmu-bridge/src/hardware.rs:577` and `:582` call `sink.emit(...)` on the injected `EventSink` (`apps/desktop-client/src/commands/hardware.rs:9` says so in its module doc); `app.emit("barcode:scanned", …)` survives as a direct call only in `apps/tablet-client/src/commands/hardware.rs:352` and `:629`.
- The `app` handle is `Option<AppHandle>` — always unwrap via `if let Some(ref app)`.

> last audited 08-09-26 by docs-auditor
