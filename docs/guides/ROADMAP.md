<!-- Audit stamp: 2026-07-25 · Hermes-Agent · status: ACCURATE (0 findings) · resolved F1: styles/tokens.css -> ui/src/frontend/themes/ (no ui/src/styles/) · resolved F2: ui/src/locales/en-US.ftl -> per-feature English bundles (*.ftl) · resolved F3: ui/src/i18n/id.ftl -> per-feature Bahasa Indonesia bundles (*.id.ftl) · resolved F4: "25 translation files" -> 24 per-feature bundles × 2 locales = 48 .ftl files · resolved F5: "48 Fluent bundles" -> 24 per-feature bundles, each with en + id variants · verified accurate: oz-reporting implemented (Phase 5 daily/weekly/monthly engines present in src/), oz-payment Square+QRIS/Midtrans (square.rs+qris.rs exist), redis optional dep present (line 375), i18n-gap self-note (line 486: EmailReportSettings.tsx + SettingsPage.tsx still hardcoded English) matches the settings audit finding · re-audited 2026-08-08 by docs-auditor: 3 stale checkboxes flipped (scheduled email, Android APK CI, CRDT sync), counts refreshed (39 Feature variants, 265 UI test files, 5,800+ Rust tests), rlua->mlua, i18n note narrowed to EmailReportSettings.tsx · RE-AUDITED 2026-08-31 by docs-auditor: .ftl count refreshed 24→25 bundles / 48→50 files (one per-feature bundle added since 08-08; canonical ui/src/locales/ = 25 bare + 25 .id.ftl, matching ARCHITECTURE.md + ui/README "50 .ftl files"); RESOLVED 2026-09-03 by the Fluent page audit: the stray files ui/locales/sales.ftl + ui/locales/sales.id.ftl are deleted (proven unreferenced by any code; their only keys absent from the canonical bundle (receipt-preview-barcode-visual, receipt-preview-qr-visual) are CSS class names in ReceiptPreview.tsx, not Fluent message ids); UI test count refreshed 265 files / 3,476 tests -> 405 files / ~6,700 tests (matches ui/README 08-29; grew with the test campaign); mock_integration.rs test count corrected 25 -> 21 (file has 21 #[test]/#[tokio::test] fns, no parameterized cases, unchanged since 06-30); init-db role seed corrected owner/manager/cashier -> owner/manager/staff (db.rs:104-108 seeds role-owner/role-manager/role-staff — 'cashier' is never seeded by the CLI); repointed 3 stale inline-code path refs to docs archived in d0fe7481 (a11y.md x2, benchmarks.md) -> docs/archived/; crates/oz-core/benches/ (4 files) re-confirmed -->

# OZ-POS — Roadmap

> *Small codebase. Limitless possibilities.*

This document defines the phased delivery plan for OZ-POS. Each phase has a clear goal, an ordered task list, and acceptance criteria. Phases build on one another — no phase begins until the previous one's criteria are met.

**Status legend:**
- `[x]` Completed
- `[/]` In progress
- `[ ]` Planned

---

## Overview

| Phase | Name | Target | Goal |
|-------|------|--------|------|
| **1** | Foundation & MVP | Month 1–2 | Working POS terminal: scan, sell, receipt |
| **2** | Hardening | Month 3–4 | Secure, tested, deployable on all platforms |
| **3** | Transactions & Staff | Month 5–6 | Full transaction lifecycle + staff management |
| **4** | Scaling | Month 7–8 | Multi-store, multi-terminal, payment gateways |
| **5** | Intelligence | Month 9–10 | Reporting, analytics, dashboards |
| **6** | Ecosystem | Month 11+ | Plugins, marketplace, advanced features |

---

## Phase 1 — Foundation & MVP
> **Goal:** A working, minimal POS terminal that can scan a barcode and complete a sale. The Setup Wizard gates everything.

### Infrastructure
- [x] Project repository: `oz-pos`
- [x] Cargo workspace with `oz-*` crate naming convention
- [x] Architecture & whitepaper documentation
- [x] `AGENTS.md` coding standards & rules
- [x] `Cargo.toml` workspace definition with all crate members
- [x] GitHub repository init, branch policy (`feat/`, `fix/`, `docs/`, `chore/`)

### Feature Flag System
- [x] `Feature` enum declared in `oz-core` (32 features at declaration; ~39 variants today)
- [x] `is_enabled()`, `enable()`, `disable()` helpers in `oz-core`
- [x] Feature flags stored in `settings` table as `feature.<name>` rows
- [x] Feature dependency resolution (`dependencies()` fn + auto-enable)
- [x] Store presets: **Simple Retail**, **Restaurant**, **Full Store**, **Custom**
- [x] Property-based tests (proptest) for dependency invariants, return values, serialization
- [x] 47+ comprehensive unit tests for all dependency declarations and edge cases
- [x] Doc-test on `enable()` demonstrating auto-enable behavior

### Setup Wizard (UI — First Run)
- [x] 8-step Setup Wizard UI (Tauri, React/TS)
  - Step 1: Store type / preset selection
  - Step 2: Payment methods (cash, card, multi-currency)
  - Step 3: Products (barcode, variants, inventory tracking)
  - Step 4: Staff (login, roles, shifts)
  - Step 5: Hardware (printer, cash drawer, customer display)
  - Step 6: Business rules (discounts, tax, loyalty)
  - Step 7: Data & reporting (reports, export/import, cloud sync)
  - Step 8: Review & confirm
- [x] Wizard skipped on subsequent launches (flags already set)
- [x] `useFeatures()` hook in React — UI conditionally renders based on active flags
- [x] `get_enabled_features` Tauri IPC command returning kebab-case feature keys
- [x] Feature-gated sidebar navigation — nav items hidden when required feature is disabled

### oz-core — Data Models & Engine
- [x] SQLite schema: `products`, `categories`, `sales`, `sale_lines`
- [x] SQLite schema: `settings`
- [x] SQLite schema: `currency`, `exchange_rate`
- [x] SQLite schema: `customers`, `users`, `roles`
- [x] `Money` struct (integer minor units + `Currency` reference)
- [x] `Currency` struct + ISO-4217 validation
- [x] `Customer` domain type with builder pattern (new, with_email, with_phone)
- [x] `User`/`Role` domain types with builtin role constants (owner, manager, cashier)
- [x] ISO-4217 seed data (39 currencies + 3 roles + admin user in `oz-cli init-db`)
- [x] `Product` domain type with builder pattern (new, with_category, with_barcode)
- [x] `Category` domain type (id, name, colour)
- [x] `Inventory` domain type (product_id, qty, updated_at) + is_in_stock, adjust_qty
- [x] `Sale`/`SaleLine` domain types with state machine `Pending → Active → Completed | Voided`
- [x] `Settings` store: typed key-value access + feature persistence
- [x] `Store<'a>` database facade: typed CRUD for Product, Category, Inventory, Settings
- [x] ACID write wrapper: all multi-statement writes inside explicit transactions
- [x] `updated_at` auto-update via SQLite `DEFAULT (strftime(...))` on mutable tables

### oz-hal — Hardware
- [x] `BarcodeScanner`, `ReceiptPrinter`, `CashDrawer` async trait definitions
- [x] `DriverRegistry` for lookup/injection per device category
- [x] USB barcode scanner driver (HID)
- [x] Serial barcode scanner driver (stub)
- [x] Receipt printer driver (USB, stub output)
- [x] Bluetooth (SPP) receipt printer driver
- [x] TCP/network receipt printer driver (port 9100, raw ESC/POS)
- [x] Shared ESC/POS formatting module (`escpos.rs`)
- [x] Mock HAL driver for unit tests (`crates/oz-hal/src/drivers/mock.rs`)

### UI — Design System & Component Library
- [x] CSS design tokens: colour palette, spacing scale, border-radius, shadows (`ui/src/frontend/themes/tokens.css`)
- [x] CSS reset (`ui/src/frontend/themes/reset.css`)
- [x] Shared component styles (`ui/src/frontend/themes/components.css`)
- [x] Dark mode + light mode — system-preference aware, user-toggleable (`ThemeProvider` + `ThemeToggle`)
- [x] Core component library: `Button`, `Input`, `Card`, `Modal`, `Badge`, `Toast`, `Spinner`, `Skeleton`
- [x] Components: `EmptyState`, `ErrorState` — consistent empty/error patterns
- [x] Micro-animations: button press, modal fade/slide, toast slide-in, skeleton pulse, setup completion bounce
- [x] ARIA labels and keyboard support on all interactive elements
- [x] Focus trap + Escape-to-close in Modal
- [x] Design System showcase page at `/design` route

### UI — Core Checkout Flow
- [x] Product lookup screen (barcode scan → product card) — `ProductLookupScreen`
- [x] Product card with name, price, stock badge, category chip, add-to-cart
- [x] Category filter chips (radiogroup pattern)
- [x] Barcode scan input with scan button and Enter-key support
- [x] Shopping cart (add/remove/quantity) — inline cart panel in `PosScreen`
- [x] Cart line items with quantity stepper (minus/plus), remove button, line total
- [x] Subtotal and Pay button in cart footer
- [x] Payment modal: Cash / Card / Other payment methods
- [x] Cash tendered input with change calculation and insufficient-amount warning
- [x] Sale completion via IPC (`startSale` → `addLine` → `completeSale`)
- [x] Receipt printing via IPC (`printSalesReceipt`)
- [x] Auto-close after successful payment with change-due display
- [x] Global navigation sidebar with SVG icons (`AppLayout`)

### UI — Setup Wizard
- [x] Preset selection cards (🛒 Retail, 🍽️ Restaurant, 🏪 Full Store, ⚙️ Custom)
- [x] Feature toggle switches across 6 categories (Payments, Products, Staff, Hardware, Business Rules, Data)
- [x] Step progress indicator with completed/active/pending dots
- [x] Review step with feature tag cloud (enabled + disabled)
- [x] Completion screen with checkmark bounce animation
- [x] Back / Next / Skip navigation with memoized callbacks

### UI — Settings & Product Management
- [x] Settings UI — store name, address, tax ID, receipt preferences (`SettingsPage`)
- [x] Product Management UI — data table with add/edit/delete (`ProductManagementScreen`)
- [x] Barcode field in product form
- [x] Category Management UI — standalone colour-coded category list with add/delete + colour picker
- [x] Category management IPC commands: `list_categories`, `create_category`, `delete_category`
- [x] `useFeatures()` hook — sidebar nav hides items for disabled features
- [x] `get_enabled_features` IPC endpoint — backend returns enabled feature keys
- [x] Feature-gated sidebar navigation — categories route hidden behind `categories-enabled` flag

### Database
- [x] `migrations/001_sales.sql` + `002_products.sql` + `003_barcode.sql` + `004_sale_status.sql`
- [x] `oz-core` migration runner (embedded via `include_str!`, run on startup)
- [x] Domain-to-schema mapping: `Product`, `Category`, `Inventory`, `Sale`, `SaleLine`, `Settings`
- [x] `Cart` (in-memory) → `Sale` (persisted) pipeline with `Sale::from_cart()`
- [x] `oz-cli init-db` — seeds default settings + preset flags + feature flags
- [x] `oz-cli init-db` — seeds 39 ISO-4217 currencies, 3 built-in roles (owner/manager/staff), and admin user

### API — REST Endpoints (Phase 1 MVP)
- [x] `GET /api/v1/health` — server health + version
- [x] `POST /api/v1/tokens` — JWT token creation (label + expiry)
- [x] JWT auth middleware on all protected routes
- [x] `GET /api/v1/products` — list products with category name + stock (LEFT JOIN)
- [x] `GET /api/v1/products/{sku}` — product detail by SKU
- [x] `POST /api/v1/products` — create product (validates, inserts, optional inventory)
- [x] `PATCH /api/v1/products/{sku}/stock` — adjust stock with transaction + checked arithmetic
- [x] `GET /api/v1/categories` — list categories ordered by name
- [x] CORS enabled, tracing/logging layer
- [x] Integration tests with in-memory SQLite + seeded data

### Acceptance Criteria
- [x] Full checkout flow validated: scan barcode → add to cart → pay → print receipt
- [x] Setup Wizard completes and persists flags to SQLite
- [x] UI hides all inactive features (e.g., no loyalty tab in Simple Retail) via `useFeatures()` hook + feature-gated nav
- [x] Dark mode and light mode both render without visual glitches
- [x] Design tokens applied consistently — no hardcoded hex colours in components
- [x] `cargo test` passes across all crates (5,800+ tests, 0 failed)
- [x] `cargo clippy -- -D warnings` passes with zero warnings
- [x] 5,800+ unit tests across the `oz-*` crate ecosystem, plus ~6,700 UI tests across 405 test files
- [x] Data Management UI wired to real IPC (backup, export/import .ozpkg)
- [x] `oz-cli import-ozpkg` writes data to DB (products, categories, sales, customers, users, settings) — except settings rows the shared platform-core predicate `is_non_exportable_setting_key` marks non-exportable, which are skipped rather than written
- [x] StaffLoginScreen supports hardware keyboard PIN entry (digits, Backspace, Enter, Escape)
- [ ] App launches on Windows and Linux

---

## Phase 2 — Hardening
> **Goal:** Secure, fully tested, and deployable on all four target platforms with a CI/CD pipeline.

### oz-security
- [x] OS key-ring abstraction (`Keyring` trait + `InMemoryKeyring` + platform stubs)
    - Windows: `WindowsCredentialManager` (stub)
    - Linux: `LibSecretKeyring` (stub)
    - macOS: `MacOsKeychain` (stub)
    - Fallback: `InMemoryKeyring` with 5 unit tests
- [x] TLS configuration helpers for cloud sync traffic (`TlsConfig` + builder)
    - Certificate/key/CA path loading with existence validation
    - ALPN protocol support, insecure-skip-verify option (dev only)
    - 7 unit tests for builder, validation, file loading
- [x] PCI-DSS checklist helpers (`mask::mask_pan`, `mask::is_valid_pan`, etc.)
    - PAN masking (first 6 + last 4) per PCI-DSS 3.3
    - Luhn validation for PAN format checks
    - Cardholder name masking, CVV masking
    - 15 unit tests
- [x] `docs/security/PCI-DSS_CHECKLIST.md` — full PCI-DSS v4.0 compliance checklist
- [x] `.env.example` template for development secrets

### oz-logging
- [x] `tracing` + `tracing-subscriber` initialiser (`oz_logging::init()`)
- [x] JSON log formatter (`oz_logging::init_json()`) — ELK/Loki compatible
- [x] File writer with rotation (`oz_logging::init_with_file()`, `oz_logging::init_json_with_file()`)
    - Uses `tracing-appender` for hourly rolling files
    - Spawns background cleanup thread for log retention (configurable days)
    - **Implemented, never wired — corrected 2026-09-12.** The two sentences
      above are true of the crate and are kept checked: the functions exist,
      rotate hourly, run the retention cleanup thread, and are exercised by
      `lib_tests`. What no shipped binary does is **call** them. `git grep` for
      `init_with_file` / `init_json_with_file` across the tree returns their
      definitions and doc examples in `crates/oz-logging`, this box, and
      `docs/operations/runbook.md` §8.6 — no hit under `apps/`, `modules/` or
      `platform/`, and the `try_*` variants are called only from the crate's own
      tests. Both Tauri clients initialise with `oz_logging::try_init()`
      (`apps/desktop-client/src/lib.rs`, `apps/tablet-client/src/lib.rs`), which
      installs an `EnvFilter` + `fmt` subscriber with **no writer**, so a
      double-clicked desktop build discards its stdout and **no POS device has a
      log file to open.** Name the missing call site: a client `setup` calling
      `init_with_file(app_log_dir, "oz-pos", retention_days)` — there is no
      `log_dir` / `LogRoot` / `app_log` / `path_resolver` anywhere in `apps/` to
      hand it, so the call site needs a directory resolver with it. Not the same
      as "no file writer": `docs/operations/runbook.md` §8.6 carries the
      consequence for an operator.
- [x] Syslog output (Linux) — `oz_logging::syslog::init_syslog()`
    - Uses `libc` FFI for syslog API
    - Combined subscriber: stdout + syslog via `tracing_subscriber::registry()`
    - Configurable facility (local0–local7, daemon, user, etc.)
    - **Implemented, never wired — corrected 2026-09-12.** Capability as
      described: true, tested in `syslog_tests`, and left checked. `git grep`
      `init_syslog` returns its definition, its module doc example and that
      test file only — nothing in `apps/`, `modules/` or `platform/` calls it,
      including `apps/cloud-server`, which is the one Linux process that ships
      and which picks `try_init()` / `try_init_json()` instead. So no deployment
      emits to a syslog daemon today; the container's stdout is the whole
      surface (see runbook §8.6).
- [x] ~~Windows Event Log output~~ **Windows debug-output** sink — `oz_logging::eventlog::init_eventlog()`
    - Uses `OutputDebugStringW` via windows-sys FFI
    - Combined subscriber: stdout + debug output via registry()
    - **Title corrected 2026-09-12, and also never wired.** Two separate
      problems, stated in the order a reader will be harmed by them. (a) The
      heading said
      "Event Log", but `OutputDebugStringW` is the Win32 **debugger** channel —
      visible to an attached debugger and to DebugView, gone when neither is
      present. The Event Log API is a different thing (`RegisterEventSource` /
      `ReportEvent`), and `git grep` for either returns nothing in this crate.
      That is why a machine inspection of registered EventLog sources shows no
      OZ-POS entry: nothing ever wrote one, so the surface cannot be diagnosed
      by looking for our source name. The sub-bullet below was always honest —
      it says "debug output", not "event log" — the heading oversold it. (b) The
      sink itself is never installed: `git grep` `init_eventlog` returns its
      definition, its module doc example and `eventlog_tests` only, with no
      caller in `apps/`, `modules/` or `platform/` — including
      `apps/desktop-client`, the only Windows binary that ships, which calls
      `try_init()`.
    - So the accurate statement of what a Windows field install gives you:
      **no log file, no Event Log entry, and no debug channel** — one discarded
      stdout stream. Anything reading this box as "Windows logs exist" is wrong
      twice over.
    - Kept checked as a delivered *capability* (it compiles, is tested, and
      works when called); the wiring and the name were the lies, not the code.
- [x] Shared `MessageVisitor` for field formatting (extracted to `visitor.rs`)

### Testing
- [x] Unit test `#[cfg(test)]` blocks in all `oz-*` crates
- [x] Integration tests with mock HAL drivers (21 tests in `oz-hal/tests/mock_integration.rs`)
- [x] Front-end: Vitest + React Testing Library (`ui/src/__tests__/`)
- [x] `eslint-plugin-jsx-a11y` enabled in `ui/eslint.config.js`
- [x] Test coverage target: ≥ 80% on `oz-core`, `oz-hal`, `oz-lua` (requires tarpaulin)
- [x] `.tarpaulin.toml` config + coverage CI job + local coverage gate in `scripts/check.sh`

### CI/CD
- [x] `.github/workflows/ci.yml`: lint → test → Tauri bundle — **retired to `ci.yml.bak` by `23c96330`**; the live pipeline is `dev-ci.yml`, and `release.yml` was restored desktop-only in 0.0.36. Kept because it records what shipped, not what runs.
  - `cargo fmt --check`
  - `cargo clippy -- -D warnings`
  - `cargo test --workspace`
  - `npm run lint` + `npm run test` in `ui/`
  - Tauri build for `x86_64-pc-windows-msvc` and `x86_64-unknown-linux-gnu`
  - `.github/workflows/security.yml`: weekly `cargo audit` + `cargo deny` — **never lived; the file exists only as `security.yml.bak`.** Security and nightly suites are not enforced in CI, so a green Dev CI run is not proof they passed.
- [x] `.github/workflows/release.yml`: tag → build all targets → draft GitHub release
  - Verify job: fmt, clippy, tests (cargo + npm)
  - Build matrix: ubuntu-latest, windows-latest, macos-latest
  - Platform bundles: .deb + .AppImage (Linux), .msi + .nsis (Windows), .dmg (macOS)
  - Artifact upload + softprops/action-gh-release (draft)
  - `latest.json` metadata generation for auto-update

### Data Management
- [x] `oz-cli backup` — raw SQLite snapshot (`.db` file)
- [x] `oz-cli restore` — restore from snapshot
- [x] `oz-cli export` — encrypted `.ozpkg` (Argon2id + AES-256-GCM + zstd)
  - Flags: `--types`, `--password`
- [x] `oz-cli import` — decrypt and apply `.ozpkg`
  - Flags: `--dry-run`, `--password`
- [x] Feature flags embedded in `.ozpkg` plaintext metadata

### Updates & Packaging
- [x] Tauri auto-update (`tauri.conf.json` updater section → GitHub releases)
  - `tauri-plugin-updater` registered in `lib.rs` + `Cargo.toml`
  - Updater signing key pair generated (`oz-pos-updater.key` + `.pub`)
  - Public key set in `tauri.conf.json`
  - Endpoint: GitHub releases `latest.json`
- [x] Windows: NSIS installer (configured in `tauri.conf.json`)
- [x] Windows: MSI installer (WiX configured via `bundle.targets: "all"`)
- [x] Linux: `.deb` + `.AppImage` packages
- [x] macOS: `.dmg` package
- [x] `packaging/README.md` — packaging overview and build guide
- [x] `packaging/linux/oz-pos.desktop` — freedesktop entry
- [x] `packaging/linux/deb/postinst` — Debian post-install script
- [x] `packaging/linux/deb/prerm` — Debian pre-removal script

### UI / UX — Data Management & Feature Toggle Screens
- [x] **Data Management screen** (Settings → Data)
  - Export wizard: select data types (checkboxes + select all/none), date range picker, encryption password with confirmation, progress bar, completion state
  - Import wizard: file dropzone, native file dialog (`@tauri-apps/plugin-dialog`), plaintext metadata preview, decryption password, dry-run diff table, progress bar, completion state
  - Backup status panel: last backup timestamp + size, one-click create backup button with loading state
  - All flows wired to real Tauri IPC commands (`get_backup_status`, `create_backup`, `export_data`, `import_preview`, `import_data`)
  - Accessible tabbed layout with ARIA roles, full dark-mode compatible CSS
- [x] **Feature Toggle screen** (Settings → Features) — master on/off panel for all 39 flags post-setup
  - `list_all_features` + `set_feature` IPC commands with automatic dependency resolution
  - Grouped by category with toggle switches, dependency info, and toast notifications
  - Route: Features (lightning bolt icon sidebar nav, always visible)
- [x] **Update notification banner** (`UpdateBanner` component)
    - Auto-checks via `@tauri-apps/plugin-updater` on mount
    - Dismissible banner with "Install" action button
    - Slide-in animation, dark mode support
    - Graceful fallback when Tauri not available

### Acceptance Criteria
- [x] CI pipeline passes on every PR
- [x] Export + import round-trip: data survives encrypt → decrypt → import (verified with 7 ozpkg tests)
- [x] `cargo clippy -- -D warnings` passes with zero warnings
- [x] App auto-updates from a published GitHub release (config verified — endpoint + pubkey match release workflow)
- [x] Installable via MSI on Windows and `.deb` on Ubuntu (release pipeline verified — all platform bundles configured)
- [x] Data Management UI: export and import wizard screens complete

---

## Phase 3 — Transactions & Staff
> **Goal:** Full transaction lifecycle (void, refund, hold), staff roles, shifts, audit trail, and tax rules.

### Transaction Lifecycle
- [x] Audit log SQL migration + domain type (`010_audit_log.sql`, `audit.rs`)
- [x] Store methods: `log_audit`, `list_audit_entries`, `void_sale` (atomic tx with stock restoration)
- [x] `void_sale` Tauri IPC command — lives in `apps/desktop-client/src/commands/void.rs` as `void_sale_scoped` (there is no `commands/sales.rs`)
- [x] **Void Sale UI** — Orders screen with search, status filters, detail view, reason picker, void confirmation
- [x] Refund / return flow (partial or full, linked to original order) — `RefundModal.tsx`, `SalesHistoryScreen.tsx` integration, previous refunds display
- [x] Hold order (park a sale, resume later — multiple holds simultaneously)
- [x] Split bill (divide order across multiple payment methods or customers)
- [x] End-of-Day (EOD) report: cash tally, payment breakdown, shift summary

### Staff & Auth
- [x] `StaffLogin` feature: argon2id PIN hashing + verification (`oz_core::auth`)
- [x] `staff_login` IPC command (username lookup, PIN verify, role resolution)
- [x] `list_staff`, `create_staff`, `update_staff` IPC commands with PIN hashing on create
- [x] `AuthContext` + `useAuth` hook — React context for session state, login/logout, isManager/isOwner
- [x] **Staff Login UI** — full-screen PIN pad (2-step: username → numeric PIN entry), auto-submit at 6 digits or manual submit for shorter PINs
- [x] **Role badge** — sidebar user info with avatar letter, display name, colour-coded role, logout button
- [x] **Permission denied screen** — reusable `PermissionDenied` component with lock icon and role requirement
- [x] `StaffRoles` feature: owner, manager, cashier permission model (backend role-based route gating)
- [x] `ShiftManagement` feature: open/close shift with opening balance
- [x] Cash drawer reconciliation: expected vs. actual cash at close
- [x] `AuditLog` UI: view and filter audit log entries

### Tax Engine
- [x] Tax inclusive vs. exclusive toggle (per rate)
- [x] Tax rate per category (via category_taxes junction table)
- [x] Multi-rate support (e.g., 0%, 7%, 10% on different product types)
- [x] Tax breakdown on receipt and in order records

### oz-lua — Scripting Runtime
- [x] Embed Lua VM in `oz-lua` (rlua initially; **mlua** since 0.0.19)
- [x] Expose `apply_discount()`, `calc_line_tax()`, `validate_order()` to Lua
- [x] Merchant Lua scripts loaded from `scripts/` at runtime (`load_dir`)
- [x] Lua sandbox: no filesystem or network access from scripts
- [x] Example Lua scripts in `scripts/examples/`

### Hardware Expansion
- [x] Bluetooth barcode scanner driver
- [x] Cash drawer trigger (via receipt printer GPIO)
- [x] Customer display driver (secondary screen, shows cart total)

### UI / UX — Staff, Transaction & Management Screens

**Staff & Auth**
- [x] **Staff Login screen** — full-screen PIN pad (2-step: username → PIN entry with numeric keypad)
- [x] **Role badge** — sidebar user info with avatar letter, name, role colour, logout button
- [x] **Staff Management IPC** — `list_staff`, `create_staff`, `update_staff` commands with argon2 PIN hashing
- [x] **Permission denied screen** — reusable lock-icon component with role requirement message
- [x] **Staff Management UI** — table with avatar, role badges, add/edit modal with PIN hashing, deactivate/restore toggle

**Transaction Screens**
- [x] **Void Sale UI** — Orders screen with search, status filter chips, detail view, reason picker (8 presets + custom), void confirmation with success/error feedback
- [x] **Refund / Return UI** — select items to refund (partial or full), amount preview, confirm
- [x] **Hold Order UI** — name/tag a held order, resume from holds list
- [x] **Split Bill UI** — assign amounts per payment method (cash/card/other) with even-split, add/remove, remaining tracker
- [x] **Order History UI** — searchable list with filters (date, status, cashier), tap to view detail
- [x] **Order Detail UI** — full receipt view with void/refund actions for managers

**Shift & Cash**
- [x] **Open Shift screen** — enter opening cash balance, confirm
- [x] **Close Shift screen** — count cash by denomination, compare to expected, print EOD summary
- [x] **EOD Report screen** — sales total, cash, card, voids, discounts breakdown, shift data, print

**Business Rule UI**
- [x] **Discount UI** — apply % or fixed discount to whole cart or individual line items
- [x] **Tax Configuration UI** — inclusive/exclusive toggle per rate, type column in table, category tax rates section
- [x] **Customer Management UI** — searchable table with avatar initials, add/edit modal (name/email/phone/notes), delete
- [x] **Inventory Adjustment UI** — manual stock-in / stock-out with reason field

### Acceptance Criteria
- [x] Void and refund flows update stock and produce audit entries
- [x] Shift open/close persists cash reconciliation report
- [x] A Lua discount script applies correctly at checkout
- [x] Audit log entries are write-once (no UPDATE/DELETE allowed on `audit_log`)
- [x] RBAC: cashier cannot access manager-only screens
- [x] PIN login screen renders correctly on all target platforms (hardware keyboard support: digits, Backspace, Enter, Escape; touch targets ≥ 56×72px; ARIA labels)

---

## Phase 4 — Scaling
> **Goal:** Multi-store, multi-terminal, cloud sync, payment gateways, and mobile builds.

### Cloud Sync (Optional On-Feature)
- [x] SQLite outbox pattern (`offline_queue` table in `oz-core` + `platform-sync` queue/transport/replication layer)
- [x] Background sync daemon: outbox → PostgreSQL (via `tokio-postgres`)
- [x] Background sync daemon: outbox → HTTP server (via `reqwest`)
- [x] Conflict resolution strategy (last-write-wins with timestamp in `platform/sync/src/conflict.rs`)
- [x] Cloud DB add-on: AWS RDS or Azure Database for PostgreSQL (configurable via settings — `PgTransport` connects to any PostgreSQL host)
- [x] Redis cache: product look-ups, pricing rules, inventory pub/sub

### Multi-Store & Multi-Terminal
- [x] Store entity: each store has its own settings + feature flags
- [x] Store profile seeded on first startup + IPC commands (list, get, create, update, set-primary, delete)
- [x] Multi-store management UI (owner view across all locations) — Store Switcher + Multi-Store Dashboard + Terminal Status Panel
- [x] Multi-terminal: terminals in the same store share inventory via cloud sync
- [x] Per-terminal feature overrides (e.g., terminal A has KDS, terminal B does not) — migration `028_terminal_feature_overrides.sql` + IPC + UI in TerminalManagementScreen

### oz-payment
- [x] `PaymentProcessor` trait definition
- [x] Mock payment processor (for testing and offline demo)
- [x] Stripe integration (card present + card not present)
- [x] Square integration (`SquarePaymentProcessor` — REST API via reqwest)
- [x] QRIS / local payment gateway support (Indonesian market) — via Midtrans
- [x] Payment result stored in `payments` table linked to `sale_id` (gateway reference, status, response in migration `027_payment_gateway_fields.sql`)

### Multi-Currency
- [ ] ~~`exchange_rate` table populated by background sync from external API (`RateSyncDaemon` — Frankfurter API via `platform/startup/src/rate_sync.rs`)~~ **NOT WIRED — corrected 2026-09-12 (the box was checked; the feature does not run).** Unwired, not broken: storage and crypto are complete (`RateSyncDaemon::run_tick` fetches `https://api.frankfurter.app`, converts to `rate_millionths`, upserts via `CurrencyRepository::upsert_exchange_rate` into `exchange_rates`; `Settings::set_rate_sync_api_key` encrypts the key at rest), but nothing starts the daemon. Its only start path, **`init_rate_sync` in `platform/startup/src/lib.rs` (line 337 as measured 2026-09-12), has zero callers** — neither Tauri client starts it — no `platform_startup::spawn_daemon` call in `apps/desktop-client/src/lib.rs` or `apps/tablet-client/src/lib.rs` names rate sync, `rate_sync` and `RateSyncDaemon` appear nowhere in `apps/`, `ui/` or `crates/oz-bridge`, and `git grep init_rate_sync` over the tree matches only its own definition. **Exchange rates today are entered by a manager on the exchange-rates screen** (`ui/src/features/currency/ExchangeRateScreen.tsx`, route `exchange-rates`, `requiredRole: 'manager'`) — manual create and delete only; that is the sentence an operator or a sales conversation needs. The UI has no API-key field and no auto-sync toggle, and no IPC command writes `rate_sync.*`, so all four keys (`platform/core/src/settings/keys.rs:159-165`) have zero production writers; three are read only by the daemon that never starts, and `rate_sync.api_key` is read by nothing at all — the fetcher targets a keyless endpoint, so there was never a credential for that accessor to feed. To turn it on: call `platform_startup::init_rate_sync(db)` from a client `setup` (and note `run_tick` discards `rate_sync.interval`, so the interval would still need wiring). ⚠️ Deleting those dormant keys is not a dead-code cleanup — `rate_sync.api_key` "encrypted at rest" is a claimed remediation row in `docs/security/security-audit-completion.md` (H-5), so that doc must be updated in the same change. `CHANGELOG.md` keeps its original entry: a changelog records what was believed at release time.
- [x] Currency selector in checkout UI (when `MultiCurrency` flag enabled)
- [ ] ~~Receipts show both charge currency and base currency~~ **FALSE FOR RECEIPTS — corrected 2026-09-12: a receipt carries one currency per amount, and it is the charge one.** Measured at the same sha as the box above, on the two payload types rather than inherited: `PrintSalesReceiptArgs` in `ui/src/api/sales.ts` and `SalesReceipt` in `crates/oz-hal/src/drivers/receipt.rs` each hold a single `subtotal`, `tax` and `total`, and their `Money` type carries exactly one `currency` — there is no base-currency amount anywhere in either, so the thermal renderer has no second figure to print. The base currency and base total do exist and are persisted on the sale (`20260821_tender_currency.sql`, surfaced as the sale-detail fields), and the checkout dialog shows both amounts side by side — that pairing is real one screen earlier, and never on the receipt. What a merchant can do today: see charge and base side by side on the payment screen, and print a receipt denominated only in the charge currency. The honest alternative to implementing it is to scope the box to the checkout screen, where it is true. Not fixed here: adding a base-currency line is a payload, bridge and driver change plus a printed-artefact decision.
- [x] **R2 — Currency DB Extraction (ADR #30)**: 6-phase extraction of currency, exchange-rate, and currency-format settings from the monolithic `oz-core` Store facade into a dedicated `modules/currency` crate:
  - Phase 1: `ExchangeRateRow`, `CurrencyRepository`, `CurrencyError` moved into `modules/currency`; `oz-core` Store methods became thin delegating wrappers
  - Phase 2: Shared DTOs (`ExchangeRateDto`, `CreateExchangeRateArgs`) in `modules/currency/src/commands.rs`
  - Phase 3: `list_currencies` moved into `CurrencyRepository` with `CurrencyDto` shared type
  - Phase 4: Removed `oz_core::exchange_rate` shim file and inline module
  - Phase 5: Currency-format settings added to `CurrencyRepository` with `Platform` error variant on `CurrencyError`
  - Phase 6: All 15 delegated Store methods marked `#[deprecated]`; tests annotated `#[allow(deprecated)]`

### Mobile Builds
- [x] Android tablet build (Tauri mobile → APK, signed) — CI **no longer** builds it: `android.yml` and `ios.yml` are retired `.bak`, and `release.yml` covers desktop only. The build path exists (`cargo tauri android build`); the automation does not.; physical-device testing still needs infra
- [ ] iPad build (Tauri mobile → `.ipa`, TestFlight distribution)
- [x] Touch-optimised UI layout for tablet screen sizes (tablet shell + responsive breakpoints + touch targets)
- [x] `packaging/mobile/README.md` — Tauri v2 mobile build guide for Android & iOS

### UI / UX — Responsive, Mobile & Multi-Store Screens

**Responsive & Adaptive Layout**
- [x] Breakpoint system: desktop (≥1024px), tablet landscape (768–1023px), tablet portrait (<768px)
- [x] Checkout layout: split-view on desktop, stacked on tablet portrait
- [x] Navigation: sidebar on desktop → collapsible drawer on tablet → bottom bar on mobile
- [x] Touch targets: minimum 44×44px on all interactive elements (Apple HIG / Material)
- [x] Swipe gestures: swipe cart item to remove, swipe order to void (tablet)

**Multi-Store & Multi-Terminal**
- [x] **Store Switcher** — dropdown in header showing active store + quick-switch
- [x] **Multi-Store Dashboard** — owner view: all stores, revenue per location, active terminals
- [x] **Terminal Status UI** — which terminals are online/offline in a store
- [x] **Per-Terminal Settings UI** — override feature flags in terminal edit modal

**Payment & Currency UI**
- [x] **Payment Gateway status badge** — online / offline indicator in sidebar
- [x] **QRIS QR code display** — full-screen QR overlay on checkout, auto-dismiss on payment confirm
- [x] **Currency selector** — dropdown at checkout when MultiCurrency enabled
- [ ] ~~**Exchange rate notice** — show rate used and timestamp on receipt~~ **ONE SCREEN SHORT — corrected 2026-09-12: the notice is real and rich, but it is in the checkout dialog, not on the receipt.** Unwired at the last layer, not broken. What ships: `ui/src/features/sales/PaymentModal.tsx` renders an exchange-rate notice (rate, rate source, rate timestamp) whenever the tendered currency differs from the sale currency, backed by the `payment-exchange-*` / `payment-rate-*` keys in `ui/src/locales/sales.ftl`. What does not: that notice never reaches a receipt, on screen or on paper, because the same `PrintSalesReceiptArgs` object feeds the preview and the print call, and the type has no rate field, no source field and no effective date — and one layer down, the struct the thermal renderer consumes (`SalesReceipt` in `crates/oz-hal/src/drivers/receipt.rs`) defines the same absence, so the ESC/POS path has nothing to print. Confirmed by searching `exchange`, `rate_millionths`, `base_currency` and `tender_rate` across all four layers of the print path — the payload type (`ui/src/api/sales.ts`), the on-screen preview (`ui/src/features/sales/ReceiptPreview.tsx`), the bridge builder that turns the args into the driver struct (`crates/oz-bridge/src/hardware.rs`) and the thermal driver (`crates/oz-hal/src/drivers/receipt.rs`): zero hits in every one. The `show_currency` hits that do appear across those files are the currency-symbol prefix toggle, a different feature. The rate itself is captured and persisted — `crates/oz-core/migrations/20260821_tender_currency.sql` adds `base_currency`, `base_total_minor` and `tender_rate_millionths` to the sale header, and they round-trip through `crates/oz-bridge/src/pos.rs` into the sale-detail fields — so storage is complete and display is not. What is **not** persisted is the rate's `source` and `effective_date`, which live only on the `exchange_rates` row, and at checkout the number displayed comes from a live latest-rate lookup rather than from the stored list row: **so a printed receipt can show the converted total without being able to reproduce the conversion, and editing or deleting that rate row erases the provenance of a conversion already booked on a sale.** A merchant today: a multi-currency sale records the converted amount and the rate used in the database, the checkout screen shows the rate with its source and date before payment, and the printed receipt shows neither — the customer walks out with a paper record of the converted total and no record of the conversion. Both endings are legitimate and only one is claimed: put the notice on the receipt (payload type, bridge builder and driver struct, with the source and effective date persisted on the sale rather than re-looked-up), or drop the box. That is a behaviour change with a product decision attached — a merchant record, not a wiring fix — so it is listed, not made.

**Hardware Integration UI**
- [x] **Customer display wired to PosScreen** — `useCustomerDisplay` hook auto-detects the first registered display, shows cart total + item count on two 20-char lines, clears on payment complete or cart empty

### Acceptance Criteria
- [x] Cloud sync: a product updated on terminal A appears on terminal B within 5 seconds (integration tests verify push+pull cycle < 1s)
- [x] Payment via Stripe sandbox succeeds end-to-end (wiremock-verified: full lifecycle, void, partial refund, EUR, errors)
- [ ] App installs and runs on Android tablet (Android 10+) — needs Android SDK
- [ ] App installs and runs on iPad (iPadOS 16+) — needs macOS + Xcode
- [x] Checkout layout adapts correctly at all defined breakpoints (split-view → stacked, sidebar → drawer → bottom bar)
- [x] Touch targets pass Apple HIG 44px minimum on tablet builds (@media (pointer: coarse) enforces --touch-target-min: 44px on all interactive elements)

---

## Phase 5 — Intelligence
> **Goal:** Actionable merchant insights, dashboards, analytics, and i18n.

### oz-reporting
- [x] Daily / weekly / monthly sales summary queries
- [x] Inventory low-stock alerts and reorder notifications
- [x] Top products, category breakdown, hourly heatmap
- [x] CSV export: `sales_report.csv`, `inventory_report.csv`
- [x] Dashboard UI: revenue chart, top products panel, inventory status widget

### Analytics (Optional On-Feature)
- [ ] Analytics export to cloud warehouse (BigQuery / Snowflake)
- [x] Scheduled report delivery (email PDF) — shipped in 0.0.22 (`apps/desktop-client/src/email_scheduler.rs` + `oz-core` email export)
- [ ] Custom report builder (drag-and-drop columns)

### Accessibility & i18n
- [x] WCAG-2.1 AA audit checklist (`docs/archived/a11y.md`)
- [x] ARIA labels on all interactive elements
- [x] `ui/src/locales/*.ftl` — English per-feature bundles
- [x] `ui/src/locales/*.id.ftl` — Bahasa Indonesia per-feature bundles
- [x] 25 per-feature bundles × 2 locales = 50 `.ftl` files
- [x] `@fluent/react` integration — no hardcoded strings in JSX
- [x] `docs/archived/a11y.md` — accessibility compliance checklist
- [x] Lighthouse a11y score ≥ 90 on all pages (CI gate via `.lighthouserc.json`, 0.90 threshold)
- [x] UI fully translated in English + Bahasa Indonesia (25 per-feature Fluent bundles, 50 `.ftl` files, lint-i18n.sh clean)
- [x] Thai locale removed — not a target market

### oz-reporting — Performance & Profiling
- [ ] `tokio-console` integration macros
- [ ] `cargo flamegraph` helpers
- [x] Benchmark suite: barcode lookup < 1 ms, transaction commit < 5 ms (criterion benches in `crates/oz-core/benches/`, targets defined in `docs/archived/benchmarks.md`)
- [ ] ~~Prometheus metrics endpoint (optional, in `oz-reporting` behind `metrics` feature — counters, gauges, histograms + HTTP server in `platform-startup`)~~ **NOT STARTED — corrected 2026-09-12: the app-side server half was never finished, and on 2026-09-12 it was retired.** What ships: `oz-reporting`'s feature-gated counters, gauges and histograms. What never did: the `platform-startup` HTTP endpoint — its whole `pub mod server` sat behind `#[cfg(feature = "metrics")]`, a feature `platform/startup/Cargo.toml` does not declare, so it compiled in no build, and `start_metrics_server` had no call site in either Tauri client or in `apps/cloud-server`. The box stays unchecked: nothing serves `/metrics` in the desktop or tablet app today, and the only `/metrics` route in the tree is the cloud server's own separate registry (`apps/cloud-server/src/metrics.rs`), which this box never described. `CHANGELOG.md` keeps its original entry: a changelog records what was believed at release time.

### UI / UX — Reports, Dashboard & i18n Screens

**Dashboard & Reports**
- [x] **Home Dashboard** — today's revenue card, orders count, top product, low-stock alert widget
- [x] **Sales Report screen** — bar chart (revenue over time), pie chart (by category), heatmap, date range filter, daily/weekly/monthly toggle
- [x] **Inventory Report screen** — stock table with low-stock highlighted in amber/red, threshold input
- [x] **Top Products screen** — ranked list (integrated in Sales Report), filter by date range
- [x] **Hourly Heatmap** — grid showing busiest hours of the day/week (7×24 colored cells)
- [x] **Export Report button** — one-tap CSV download from Sales Report and Inventory Report screens
- [x] **Print Report button** — sends formatted report to receipt printer (SalesReportScreen, InventoryReportScreen, EodReportScreen)

**i18n UI**
- [x] Language selector in Settings (dropdown in SettingsPage, 2 locales: en/id)
- [ ] RTL layout support — planned (no `ui/src/styles/rtl.css` scaffolded yet); future Arabic/Hebrew locales.
- [x] All number, date, and currency formats respect `Intl.NumberFormat` with currency style (dashboard/report screens)
- [ ] Full i18n migration: all existing pages use `Localized` instead of hardcoded strings. The original 200+ TSX audit (P15-2) landed and the 0.0.24 i18n audit closed SettingsPage; `EmailReportSettings.tsx` still renders hardcoded English (verified 2026-08-08), violating the AGENTS.md i18n rule. Tracked for cleanup.

### Acceptance Criteria
- [x] Dashboard loads and renders with real SQLite data
- [x] Lighthouse a11y score ≥ 90 on all pages
- [x] UI fully translated in English + Bahasa Indonesia
- [x] Barcode lookup benchmark consistently < 1 ms on all target platforms
- [x] All report screens render correctly with empty data (no crashes, good empty states)

---

## Phase 6 — Ecosystem
> **Goal:** Plugin marketplace, advanced merchant features, and long-term extensibility.

### Advanced Business Features
- [x] Loyalty program: customer points, tiers, redemption (earn_points, redeem_points, 4 tiers, event handler on sale completion)
- [x] Promotions engine: buy-X-get-Y, % off, fixed discount, time-limited (PromotionType enum, Promotion struct, PromotionManagementScreen)
- [x] Product bundles (sell multiple SKUs as one item — BundleWithItems, product_bundles DB, BundleManagementScreen)
- [x] Kitchen Display System (KDS) — restaurant order routing (KdsScreen, multi-layout, overdue escalation, sound alerts)
- [x] Self-service kiosk mode (locked-down fullscreen UI — KioskScreen, attract screen, idle timeout)
- [x] Table management UI (restaurant floor plan — TableManagementScreen, integrated into PosScreen/RetailPosScreen)

### Plugin System
- [x] Stable plugin API for third-party HAL drivers (v1.0 API versioning, deprecation policy, runtime feature detection)
- [x] Plugin manifest format (`plugin.toml` — Permission enum with 8 variants, enforced at load time)
- [x] Plugin sandbox: Lua-based, no unsafe Rust from plugins (14 dangerous globals nil, instruction limit 100k, safe env)
- [x] Plugin discovery and hot-reload (notify-based file watcher in desktop-client, auto-reload on .lua changes)
- [x] Developer docs: `docs/guides/plugin-guide.md` + CONTRIBUTING.md + `docs/guides/QUICKSTART.md` + HAL example driver (both moved out of `docs/` root into `docs/guides/`)

### Developer Experience
- [x] `cargo doc` generated and shipped in the docs portal (hosted on Cloudflare via `website/` + `scripts/build-docs.sh`, sccache, preserves workspace index)
- [x] `CONTRIBUTING.md` — contribution guide, PR template
- [x] `docs/guides/QUICKSTART.md` — local dev setup
- [x] Example Lua scripts in `scripts/examples/` (discount_bulk, tax_overrides, validate_order)
- [x] Example custom HAL driver in `crates/oz-hal/examples/custom_barcode_scanner.rs`

### Future Research
- [ ] AI-driven product recommendations (demand forecasting)
- [x] Offline-first sync with CRDTs for conflict-free replication — ADR #21 resolvers shipped (`resolve_lww`/`resolve_version_lww`/`resolve_sale_lww`/`resolve_stock_crdt` in `platform/sync/src/conflict.rs`); tombstone propagation remains future work
- [ ] Voice-controlled checkout (accessibility extension)

### UI / UX — Advanced Screens & Theming

**Advanced Business Screens**
- [x] **Loyalty UI** — customer points balance on checkout, redeem button, tier badge (PaymentModal + LoyaltyManagementScreen)
- [x] **Promotions UI** — active promotions banner on cart, promotion management screen for managers (PromotionManagementScreen)
- [x] **Product Bundles UI** — bundle card in product grid, items listed on receipt (BundleManagementScreen, registered route)
- [x] **Kitchen Display System (KDS)** — fullscreen order queue, ticket cards with status (New / In Progress / Done), tap to advance (KdsScreen + multi-layout)
- [x] **Self-Service Kiosk UI** — locked-down fullscreen layout, large product grid, no nav bar, attract screen when idle (KioskScreen)
- [x] **Table Management UI** — interactive restaurant floor plan, table status colours (Available / Occupied / Reserved), tap to open order (TableManagementScreen)

**Theming & White-Label**
- [x] Merchant logo upload (shown in header, on receipts, on kiosk attract screen — AppearanceSettings)
- [x] Brand primary colour picker → applies to buttons, accents, active states AND the per-theme primary tokens across the whole UI (deriveAccentPalette); per-theme primaries: light `#147EFB`, dark `#1155CC`; reset returns to "follow theme" (empty sentinel)
- [x] Theme preview in Settings before applying (live preview in AppearanceSettings, real-time reconciliation)
- [x] Dark / light / system-default theme saved per device (ThemeProvider, persisted preference)

### Acceptance Criteria
- [x] A third-party plugin installs and a custom barcode scanner works (custom_barcode_scanner example, 6 tests)
- [x] Loyalty points accrue and redeem correctly at checkout (16+ tests across unit + integration)
- [x] `cargo doc` builds without warnings
- [x] KDS shows incoming restaurant orders in real time
- [x] Kiosk mode: no way to exit to OS without manager PIN
- [x] Custom brand colour applies immediately across all screens

---

## On-Features — Optional Paid Add-ons

These features are available as opt-in services, billed per usage or per store.

| Add-on | Description | Phase Available |
|--------|-------------|-----------------|
| **Cloud Database** | Managed PostgreSQL / CockroachDB; auto-backup, multi-region, point-in-time restore | Phase 4 |
| **Cloud Sync** | SQLite → PostgreSQL outbox sync daemon, hosted | Phase 4 |
| **Analytics Export** | Push sales data to BigQuery / Snowflake; scheduled reports | Phase 5 |
| **Advanced Reporting** | Custom report builder with email delivery | Phase 5 |
| **Loyalty Program** | Customer points, rewards tiers, and redemption engine | Phase 6 |
| **Priority Support** | SLA-backed support tickets, dedicated onboarding, and setup assistance | Any phase |

---

## Dependency Graph

```
Phase 1 (MVP)
    └── Phase 2 (Hardening)
            └── Phase 3 (Transactions & Staff)
                    └── Phase 4 (Scaling)
                            └── Phase 5 (Intelligence)
                                    └── Phase 6 (Ecosystem)
```

On-Features can be activated at any phase once the core infrastructure is in place.

> [!NOTE]
> For granular, step-by-step checklists covering admin feature configuration, restaurant workflows (`Resto POS + KDS + Inventory`), LAN peer-to-peer sync, and Docker containerized cloud server deployments (`apps/cloud-server`), see **[MODULAR_APP_PLAN.md](./MODULAR_APP_PLAN.md)**.

---

*Last updated: 2026-08-31 (re-audited by docs-auditor).* (Phases 1–3 ✓. Phase 4 ~96% — R2 currency module extraction complete; Android APK CI exists but physical device testing needs infra. Phase 5 ~95% — scheduled report delivery shipped in 0.0.22; Thai locale removed (not a target market); custom report builder + cloud warehouse export remain. Phase 6 ~98% — all features implemented and verified; voice-controlled checkout research deferred.)

> last audited 08-09-26 by docs-auditor

