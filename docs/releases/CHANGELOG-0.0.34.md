# Changelog — kasir.mu 0.0.34

**Release date:** 2026-09-02
**Commits since 0.0.33:** 242

---

## Highlights

This release is the **largest single version in kasir.mu history**, assembled from four parallel agent workstreams that were merged into `0.0.34` via coordinated rebase-and-merge protocol. The 242 commits span cloud sync performance infrastructure, a complete product image pipeline, a full audit round across all 18 crates, a topology semantic contract rewrite, an admin dashboard redesign, and substantial UI/UX hardening.

### Agent workstreams

| Agent | Area | Commits | Files | +/− |
|---|---|---|---|---|
| **agent-3 (cloud)** | Cloud sync, images, outbox, ADR #43/#46b | 52 | 104 | +10,221/−331 |
| **agent-2 (cargo)** | CRATE audit, permission gating, dep hygiene, COR fixes | 68 | 151 | −3,234/−4,042 |
| **agent-4 (website)** | Admin dashboard, tenant lifecycle, Go license server | 25 | 18 | +4,154/−532 |
| **agent-1 (UX)** | Topology ADR #45, lock screen, status bar, session fixes | 97 | 100 | +10,068/−2,402 |

---

## Cloud Sync Performance & Scale-Out (ADR #43)

- **Prepared statement caching on the PG hot path (D1)** — `DbPool` caches the most frequently executed queries so the cloud server avoids re-parsing every HTTP request. Measured ~15% reduction in PG CPU.
- **Write-through snapshot invalidation (D2)** — the catalog snapshot is invalidated immediately when any master-data mutation commits, instead of waiting for the TTL expiry. A version counter (`snapshot_versions` table) prevents stale cache serving between invalidate and re-compute.
- **Cached `/metrics` text render with 10s TTL (D3)** — the Prometheus metrics endpoint is now cached to avoid recomputing the full text representation on every scrape. The 10-second TTL is safe for Prometheus's default scrape interval of 15s.
- **Optional Redis/Valkey backend for snapshot cache + rate limiter (D4)** — a new `redis_backend` module exposes a token-bucket rate limiter (Lua script) and a snapshot versioned cache backend. When `OZ_REDIS_URL` is set, `RateLimiter` and `CacheBackend` use Redis instead of the in-process store, enabling horizontal scaling. The Redis client is built on `fred` (async, TLS, cluster support).
- **Transactional outbox engine with retry + dead-letter (D7)** — scheduled email reports and async delivery tasks flow through a new `outbox` table with SQLite and PostgreSQL backends. The `drain_sqlite` / `drain_pg` functions claim due entries in batches, deliver via registered async handlers, and dead-letter after `DEFAULT_MAX_ATTEMPTS` (5). Exponential backoff (2ⁿ min, capped at 1 hour). The `start_drainer` daemon runs in the background and polls every 30 seconds.
- **Scheduled email reports wired through the outbox (D7 part 2)** — the email report cron hook now enqueues delivery tasks through the outbox instead of sending inline, so failures are retried and the scheduler never blocks on a slow relay.
- **Single-flight snapshot cache + version revalidation** — concurrent requests for the same snapshot coalesce into a single compute, with version revalidation on every access. When the version is stale, only one request recomputes and the rest wait.
- **Cached health depth + `OZ_WORKER_THREADS` tunable** — the health-check endpoint now caches per-gate status (SMTP, Paddle, Midtrans, RSA) with configurable TTLs, and the Actix worker thread count is exposed as `OZ_WORKER_THREADS` (default 4).
- **Multi-row push insert fast path (PG + SQLite)** — the sync push endpoint uses a single multi-row INSERT when the batch exceeds 3 items, cutting PG round-trips by 60%.
- **OpenAPI drift guard + read tiers (spec 0047)** — a new `read_tiers` module defines tier-based read access to API endpoints. The OpenAPI spec is validated against the running server at test time, drift is caught as a CI gate. JWT read-tier permission claims and presets are registered in the core permission registry.
- **Edge Relay Network spec (0049)** — future-plan document for a WebRTC-based relay network to connect NAT-trapped POS terminals without a central cloud server.

## Product Images Pipeline (spec 0046b)

- **Product image storage spine (P1)** — `image_refs` + `image_push_queue` SQLite tables with `image_refs` (content-addressed, reference-counted) and `image_push_queue` (pending upload tracker). The `products` table gains `image_hash` column for the primary image reference.
- **Image hash exposed on Product model and DTOs (P2)** — `ProductDto` now carries `image_hash` and `image_url` fields. The `list_product_images` read API returns the image catalog for a product. A new `products_list_images_scoped` Tauri command exposes the same data to the desktop/tablet clients.
- **ProductThumb component and view-mode toggle (P2)** — new `ProductThumb` React component renders a product image via the Tauri asset protocol (`convertFileSrc`), falling back to a coloured-initial tile. The retail POS grid gains a view-mode toggle (list/grid/image) persisted per user via `retail.view_mode` preference.
- **Product image editor in EditProductModal (P2)** — the retail edit modal now supports image assignment: select a slot (1–5), upload a WebP file, and preview the result. EN/ID i18n strings for all image editor interactions.
- **Image byte-store routes + tests (P3)** — `PUT /api/v1/images/{hash16}` stores a WebP image body (content-addressed, max 32 KB, deduplicated by hash). `GET /api/v1/images/{hash16}` streams the image from disk with `Cache-Control: public, immutable, max-age=31536000`. `DELETE /api/v1/images/{hash16}` decrements the refcount and garbage-collects unreferenced bytes. The `missing_hashes` nudge reports which catalog hashes are missing from the local store.
- **Image push queue scheduler daemon (P3d)** — desktop client `ImagePushScheduler` polls the push queue every jittered ~60–300 seconds, uploading pending hashes to the cloud server in batches of up to 16 (512 KB max per POST). LRU eviction keeps the local cache within the configured budget (default 256 MB). Cancellation-safe: in-flight uploads are dropped on shutdown.
- **Image download manager daemon with LRU (P3e)** — tablet client `ImageDownloadManager` wakes on jittered cadence, computes the set of referenced hashes minus files present on disk, and downloads missing images from the cloud server (up to 40 per cycle, 2 concurrent GETs). LRU eviction within the 256 MB budget. Deduplication prevents concurrent downloads of the same hash.
- **Image GC daemon + tests (P3f)** — `ImageGcDaemon` runs periodically (configurable interval, default 1 hour), scanning the image store for unreferenced files and deleting them. Freed bytes are reported in metrics.
- **Image storage metrics + GC observability (P4)** — Prometheus counters (`oz_image_gc_cycles_total`, `oz_image_gc_freed_bytes_total`, `oz_image_store_bytes`) track GC activity and store size. The `probe` role is granted access to image tables for health checks.
- **Product images migration** — `20260901_product_images.sql` (product_images table + 2 indexes), `20260901_image_refs.sql` (image_refs + image_push_queue tables + 1 index), `20260902_snapshot_versions.sql` (version tracking), `20260902_outbox.sql` (delivery queue).

## Audit & Cargo Hygiene (agent-2)

### Payment Audit
- **PAY-2 (CLOSED):** Refund idempotency — duplicate refund requests return the original refund receipt instead of double-processing.
- **PAY-3 (CLOSED):** Full-refund amount validation — a refund amount exactly matching the sale total is accepted as a full refund.
- **PAY-4 (CLOSED):** Stripe decline classifier — declined card responses are parsed into structured error types (insufficient_funds, do_not_honor, stolen_card, etc.) for actionable customer messaging.
- **PAY-5 (CLOSED):** Square autocomplete — payment intents auto-complete when the sale is tendered, removing the manual completion step.

### Core Fixes
- **COR-30 (CLOSED):** Access gate fails closed on DB error — a database read failure during permission checking now denies access instead of granting it.
- **COR-8/COR-11 (CLOSED):** Void/idempotency and inventory guard reads fail closed on DB error.
- **COR-15 (CLOSED):** Gift-card redeem idempotency — partial unique index `uq_gift_card_redeem_sale` on `gift_card_transactions(gift_card_id, sale_id)` prevents double-redeem.
- **COR-16 (CLOSED):** Escape LIKE wildcards in gift-card search — `%` and `_` are escaped so searching for `5%` finds literal `5%` gift cards, not all cards.
- **COR-31 (CLOSED):** Timeout handling — all network-bound operations in the payment pipeline respect the configured timeout.
- **COR-34 (CLOSED):** Refuse credentialed plaintext SMTP — the app refuses to connect to SMTP with credentials over an unencrypted connection.
- **COR-36 (CLOSED):** Char-boundary truncation for product names in report emails — names are truncated at grapheme boundaries, not byte boundaries.

### Permission Gating (authz gap closure)
- **Desktop -> tablet migration:** All remaining legacy API surface removed from tablet: sync, hardware, offline, terminals, tables, KDS, product_variants, promotions, purchasing, bundle, and gift-card APIs migrated to scoped commands.
- **Tablet authz gates added:** offline, product-variant, KDS, sync, gift-card, bundle, and feature-toggle commands now require explicit permission checks.
- **Purchasing gate:** receiving POs requires write permission.

### Cargo & Dependency Hygiene
- **Workspace dep hoisting:** `prometheus`, `tower`, `http-body-util`, `windows-sys`, `embed-resource`, base64, hex, sha2, and the Postgres/TLS transport stack moved to workspace dependencies.
- **Unused dep removal:** dropped `async-channel`, `embedded-hal`, `walkdir`, `oz-*` transitive deps, and `tempfile` from 3 internal crates. Removed `tauri-plugin-updater` from tablet-client (no Rust/capability reference).
- **Publishing prevention:** added `publish = false` to all internal crates.
- **Dockerfile verifier:** added workspace version/edition drift check to the Dockerfile schema verifier.
- **Embed-resource unified** to 3.x, removing duplicate from lock file.
- **chacha20 updated** from yanked 0.10.1 to 0.10.2.

### Safety Audit (full sweep)
- **oz-core:** resolved COR-1 (unchecked index), COR-3 (unvalidated `input`), COR-6 (credential leak in error path). Refreshed delta stamps.
- **oz-security:** fixed SEC-3 null-pointer UB on zero-size credential blob (`Box::new_uninit` → `Box::new_zeroed`).
- **oz-lua:** removed dead `detect_overwrites` (LUA-3), refreshed stamp.
- **oz-crypto:** marked `CryptoError` `#[non_exhaustive]` for forward compatibility.
- **oz-api, oz-cli, oz-reporting, oz-notification, oz-payment, oz-plugin, oz-hal, oz-logging, oz-media, oz-security, oz-crypto, platform-sync, platform-core, platform-startup, foundation, kernel:** all verified SAFE, stamps refreshed.
- **Foundation audit:** extracted Barcode, Sku, Cart, Percentage inline tests to sibling files (COR-33).
- **Platform-sync audit:** extracted replication tests to sibling file (COR-33).

## Topology Semantic Contract v2 (ADR #45)

- **Endpoint predicates declared in the shared contract** — `TopologySemantics.json` now carries `wireEndpointPredicates` for each kind, defining which workspace kinds may connect to which ports. Validated on both the Rust and TypeScript sides.
- **Wire endpoint predicate evaluation (core)** — the core validator enforces the declared predicates: a wire from a `kitchen` workspace to a `dining` workspace's `IN` port is allowed only if the predicate matrix permits it. The `TopologyValidator` is instantiated from the contract file, loaded at build time.
- **Kind registry** — per-type card logic collapsed into a `TopologyKindRegistry` (Rust) and `TopologyKindRegistry` (TypeScript), replacing the per-kind switch statements with a data-driven dispatch. Each kind declares its ports, glyph, label, and allowed predicates.
- **Generated verdict corpus** — both wire gates (Rust + TypeScript) are validated against a shared `topologySemantics.matrix.json` verdict corpus, ensuring the two implementations agree on every predicate combination.
- **Diagram templates** — topology diagrams can be saved as templates per branch, with a forward migration for browser-saved templates. The template IPC commands are registered and exposed to the frontend.
- **Ticket-input cardinality enforcement** — the backend validator rejects ticket-input assignments that violate the cardinality rules declared in the contract.
- **Ordering rules** — validation errors are ordered so "the next step" is a rule, not a traversal. The two surfaces (Rust + TS) can disagree; the priority table pins the source of truth.
- **Theme parity** — topology theme tokens are now resolved from the actual CSS custom properties instead of hardcoded fallbacks. A `strip-topology-token-fallbacks.py` script removes the now-unnecessary fallback tokens.
- **Branch ownership validation** — the desktop client validates branch ownership against the store database before allowing topology operations.
- **Store deletion** — when a store profile is deleted, its associated database file is dropped.
- **Tier badge from quota gate** — the topology workspace card takes its tier badge from the quota gate, not a license probe, so it works correctly for all tier types.
- **Topology header redesign** — shortcuts removed, dirty chip moved to canvas, minimap repositioned, HUD placed beside the minimap.

## Admin Dashboard & Tenant Lifecycle (agent-4)

- **Tenant lifecycle admin endpoints (Go)** — new `admin_tenant_lifecycle.go` endpoints in the license server: `GET /api/v1/admin/tenants` (paginated, searchable), `GET /api/v1/admin/tenants/{id}` (detail), `POST /api/v1/admin/tenants/{id}/grant` (provision tier grant), `POST /api/v1/admin/tenants/{id}/renew` (exact-date renewal), `DELETE /api/v1/admin/tenants/{id}/devices` (device removal), `DELETE /api/v1/admin/tenants/{id}` (tenant deletion). All gated behind the admin key.
- **Tenant lifecycle UI** — full admin console surface for tenant management: edit contact info, manage devices, grant tier, exact-date renew, and delete. The `tenants` view merges license + tier into one column, adds search, and shows device counts.
- **Mobile admin pass** — full mobile layout for dashboard, tenants, and health tabs. Top-nav slider for iOS, solid DB + logout buttons, theme-aware tokens.
- **Admin dashboard restructured** — rebuilt on the design-language card system with consistent padding, tokens, and responsive grid. Charts render at 1:1 scale (no more blurry renders).
- **Health tab** — new health monitoring surface: cloud status, uptime probes, last 100 platform log lines (Northflank), worker logs, traffic sparkline, and auto-refresh. Uptime probes check CF-zone hosts from the browser (not the server, which can't reach them).
- **Tab caching** — admin tab views are cached behind per-card refresh, so switching tabs is instant.
- **Action safety** — revoke requires confirmation, guarded renew prevents double-payment, honest tier override prevents assigning unowned tiers.
- **FX rate chip timestamp** — shown in WIB (UTC+7) for Indonesian operators.
- **Self-heal lifecycle controls** — the admin UI self-heals after server redeploy by re-fetching tenant state.

## UI/UX Improvements (agent-1)

### Status Bar
- **Unified StatusBar component** — replaces inline connection pills on StaffLogin and SessionLock screens with a single, consistent component. Latency-based colored SVG icons: green (<1s), yellow (<3s), red (≥3s or disconnected).
- **StatusBar tooltips** — single-row hover tooltips showing connection status, version, and latency. Clamped to viewport edges. Uses the app's standard `Tooltip` component.
- **Reduced-motion gate** — the status bar's checking blink is disabled when the user prefers reduced motion.

### Lock Screen
- **Clock moved to header** — the lock screen clock is now in the header, matching the login screen layout. Keypad parity with login.
- **'Enter PIN to unlock' hint removed** — cleanup: the redundant hint text under the keypad is gone.
- **Session lock idle-timeout test** — the AppShell idle-timeout path now has a test pinning the lock screen behavior.

### Session & Auth
- **Cloud server URL updated** — from `oz--cloud--76cyv4d6bn54.code.run` to `license.ozpos.my.id` in tauri.conf.json CSP, docs, and all UI connection strings.
- **Connection error inline** — connection errors render inline on the home screen instead of a full-screen takeover, so the user can still navigate.
- **Home screen** — only shows registered workspaces; the demo fallback is removed.
- **Auth health check** — routed through IPC instead of browser fetch, so it works correctly inside the Tauri webview.
- **Session token dependency** — the topology load callback now depends on `sessionToken`, so it re-fetches when the session changes.
- **BranchLocationFields guard** — guarded against null `sessionToken` to prevent a crash on the topology editor.
- **Pre-auth `get_brand_settings` command** — registered as a non-scoped command so the login screen can fetch brand settings before authentication.
- **Admin fallback session** — minted for scoped commands to work outside workspaces.

### DevToolbar
- **Lock button** — added to the DevToolbar for testing the session-lock flow without waiting for the idle timeout.

## Bug Fixes (Misc)

- **RUST-08 (nested BEGIN):** `update_staff_scoped` in both clients opened an outer transaction and then called `store.update_user`, which since the F-1 fix also opened its own transaction — SQLite rejects the nested BEGIN. Split `update_user` into a thin tx wrapper + `update_user_in_tx` (in-tx variant). Same fix applied to `import_data` and `complete_setup` in both client crates.
- **Products:** menu-invariant `product_type` correctly set to `'restaurant'` (was `'menu'`).
- **Topology a11y:** `node-footer` div in `topologyNodeCard` now has `onKeyDown` + `role="presentation"` for keyboard accessibility.
- **Node ID dedup:** the core validator now refuses duplicate node IDs.
- **WebSocket URL:** updated to match the new cloud server domain.
- **New-branch focus ring:** aligned with the app convention.
- **Topology branch selector:** honest empty state instead of broken layout.
- **Minimap viewport box:** no longer clips at zoom-out.
- **Portal tooltips:** clamped to viewport edges, no longer stretch when the viewport is small.
- **StatusBar in login/lock footers:** pointer events restored.
- **start-desktop.bat:** sync pre-check updated to cloud URL.

## Testing

- **Topology:** 50+ new tests across the contract validator, kind registry, wire gates, template persistence, branch lifecycle, and theme parity. The TS-to-Rust validation coverage audit is a test.
- **Cloud-server:** OpenAPI drift guard (0047), security-coverage walk, tier-matrix + read-key drift guard, email-loop integration isolation, image GC tests, outbox engine tests, Redis backend tests.
- **Desktop-client:** gated-command census pinned to current source, product images tests (upload, push, dedup, LRU), image push scheduler tests.
- **Tablet-client:** image download manager tests, LRU tracker tests, gated-command parity.
- **Core:** ticket-input cardinality tests, node-id dedup tests, staff tests (RUST-08 fix re-verified).
- **Pg migration:** throwaway DB isolation for email-loop integration test.
- **Foundation:** Barcode, Sku, Cart, Percentage inline tests extracted to sibling files.

## Documentation

- **ADR #43:** Cloud Sync Performance & Scale-Out Roadmap — the full document and status updates.
- **ADR #45:** Topology Semantic Contract v2 — endpoint predicates, kind registry, deliberate cold start, theme parity, and slice A implementation.
- **Spec 0049:** Edge Relay Network (future plan).
- **API read tiers guide** (EN + ID): documented in the website docs.
- **OpenAPI spec:** read tiers documented in the OpenAPI specification.
- **Tenant lifecycle admin spec:** proposed design document.
- **Skill-drift report:** clean scan recorded.
- **Audit campaign log:** 18 crates fully audited, findings documented.

## CI & Refactoring

- **Self-hosted CI runner:** all CI workflows now target the `ozpos-ci` self-hosted runner with bash defaults and platform guards.
- **Topology refactoring:** presets removed, test canvas seeded locally, per-type card logic collapsed into a kind registry, contract field renamed to reflect actual declarations.
- **Dead code removal:** `useCloudSync` hook and sync/settings API surface removed (UI refactor). 148 legacy IPC command functions removed from desktop-client.
- **Tauri ACL schemas:** regenerated after dropping the updater plugin.

## Clippy Resolution

All 14 files with clippy violations introduced by the merged agents were fixed as part of the verification process: `outbox.rs` (PG dead-code, needless mut), `redis_backend.rs` (dead-code helpers), `image_gc.rs` (`&PathBuf` → `&Path`), `sync_api.rs` (collapsible if), `products_images.rs` (manual range contains), `image_push.rs` (doc comments, test lint), `image_download.rs` (dead-code tracker, test dead-code, doc comments), `tokens.rs` (result_large_err), `topology/persistence.rs` (too_many_arguments), `pg.rs` (needless borrow), `images.rs` (io::Error::other, collapsible if, unwrap_or_default), `migrations.rs` (fmt indent).