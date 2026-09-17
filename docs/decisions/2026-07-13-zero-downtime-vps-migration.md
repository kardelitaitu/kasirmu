---
num: 11
area: release
title: ADR #11: Zero-Downtime VPS Migration Strategy
status: Implemented (2026-07-15)
---
<!-- Audit stamp: 2026-07-24 · Hermes-Agent · status: ACCURATE (1 noted finding) · F1: "22 tests" historical snapshot -> current files grown (transport.rs 38, redirect.rs 4, lib.rs 35, daemon.rs 16 = 90+) since 2026-07-15; count is dated, not false · verified accurate: apps/cloud-server/src/redirect.rs (OZ_SYNC_REDIRECT_URL, HTTP 421) + main.rs (OZ_REDIRECT_ONLY); platform/sync/src/lib.rs ServerMigrated variant (:90) + transport.rs parse_server_migrated (:166/:225); Settings::set_sync_server_url at crates/oz-core/src/settings.rs:393; all 8 referenced files exist -->

# ADR #11: Zero-Downtime VPS Migration Strategy

**Status:** Implemented (2026-07-15)
**Date:** 2026-07-13
**Updated:** 2026-07-15 (all layers shipped — 22 tests, 6 commits, redirect-only mode, deployment docs)
**Author:** Architecture Team & kasir.mu Contributors
**Tags:** vps, migration, dns, routing, fallback, server-redirection, client-config

---

## Context

As the business scales, it will be necessary to migrate the cloud synchronization server (`oz-cloud-server`) to new virtual private servers (VPS) or hosting providers. During such migrations, we must prevent connection disruptions and avoid requiring store staff to manually reconfigure settings on local POS registers. 

We need a structured, automated, and self-healing migration strategy that redirects thousands of active, offline, or waking registers to the new VPS destination with zero manual intervention.

---

## Decision

To support seamless server migrations, we will implement a multi-layered routing and redirection architecture:

### 1. DNS-Based Routing (Primary Migration Path)
- **Rule**: Client registers must never connect to hardcoded IP addresses (e.g., `http://203.0.113.5:3099`). The `server_url` setting on the client must always point to a qualified domain name backed by SSL/TLS (e.g., `https://sync.ozpos.com`).
- **Migration Execution**:
  1. Deploy the new server instance on the target VPS.
  2. Copy the active SQLite tenant sync databases from the old VPS.
  3. Update the DNS `A`/`AAAA` record at the domain provider (e.g., Cloudflare) to point to the new VPS IP address.
  4. Client registers automatically begin resolving to the new VPS on their next sync checkin.

### 2. Server-Led Auto-Redirection (Secondary Fallback)
If the domain name itself must be changed (e.g., moving from `https://sync.ozpos.com` to `https://pos-cloud.com`), the old server will run a temporary "deprecated redirection mode" service:
- **Redirection Protocol**: If a register connects to the old server, the old server returns an HTTP response containing a `server_migrated` error state and the new destination URL:
  ```json
  {
    "error": "server_migrated",
    "new_url": "https://pos-cloud.com"
  }
  ```
- **Client Auto-Update**: The client's `SyncEngine` transport parser will intercept this error, update the local SQLite database settings via `Settings::set_sync_server_url`, and seamlessly reconnect to the new URL on the next cycle.

```rust
if response.error == "server_migrated" {
    Settings::set_sync_server_url(store.conn(), &response.new_url)?;
}
```

### 3. Manual UI Configuration (Final Safety Net)
- The settings UI will retain the `Server URL` input field. If a terminal has been shut down or offline past the deprecation window of the old redirection server, a store manager can manually input the new domain to restore connection.

---

## Consequences

### Positive
- **Zero Friction**: 99.9% of migrations are handled at the DNS layer and require no code execution.
- **Self-Healing**: If domain changes occur, active and waking terminals follow the new address dynamically without administrative support tickets.
- **Robustness**: Older offline devices can always be manually reconfigured as a final fallback.

### Negative
- **Old Server Costs**: The old VPS must be kept active for a brief period (e.g., 15–30 days) to run the redirection service until all active terminals have checked in and migrated.

---

## Implementation Summary

### Layer 1 — DNS-Based Routing
- **Status**: Operational (no code — update DNS A/AAAA record at the domain provider)
- Clients connect via domain name (e.g., `https://sync.ozpos.com`), never hardcoded IPs.

### Layer 2 — Server Auto-Redirection (6 commits, 22 tests)

**Server-side** (`apps/cloud-server/`):
- `src/redirect.rs` — Redirect middleware gated by `OZ_SYNC_REDIRECT_URL` env var.
  Intercepts all `/api/sync/*` requests and returns HTTP 421 (Misdirected Request)
  with `{"error":"server_migrated","new_url":"<url>"}`. 421 chosen over 301/308
  because `reqwest` follows redirects and would never expose the response body.
  4 tests with `Mutex`-serialized env var isolation.
- `src/main.rs` — Middleware wired into the router. `OZ_REDIRECT_ONLY=true` mode
  skips all infrastructure (DB, prune, metrics, API) and runs a minimal redirect
  service (~5 MB RAM) for the 15–30 day migration window.

**Client-side** (`platform/sync/`):
- `src/lib.rs` — `SyncError::ServerMigrated { new_url }` variant. `run_sync_cycle`
  propagates `ServerMigrated` from all three paths: pull, snapshot (via anchor
  expiry), and push.
- `src/transport.rs` — `parse_server_migrated()` helper detects the redirect JSON
  in push, pull, and snapshot error responses. 11 tests (6 parser + 3 integration
  + 2 snapshot struct).
- `src/daemon.rs` — Push and pull `ServerMigrated` handlers call
  `Settings::set_sync_server_url()` via `spawn_blocking` and log the migration.
  3 integration tests including push-only and pull-only paths.
- `src/test_helpers.rs` — Shared test module with `spawn_redirect_server` (421 on
  all endpoints) and `spawn_anchor_then_redirect_server` (410 on pull, 421 on
  snapshot) for E2E testing.

**Test coverage** (22 tests across 4 modules + 1 shared helper):
| Module | Tests | Focus |
|--------|-------|-------|
| `transport.rs` | 11 | `parse_server_migrated` (6) + push/pull/snapshot redirect (3) + snapshot struct (3) |
| `redirect.rs` | 4 | Middleware env set/pass-through/non-sync/pull endpoints |
| `lib.rs` | 4 | `ServerMigrated` display/debug + E2E pull/snapshot propagation |
| `daemon.rs` | 3 | E2E push path + pull-only path + spawn helper |

### Layer 3 — Manual UI Configuration
- **Status**: Pre-existing. Settings → Cloud Sync → Server URL input field.
  If a terminal was offline past the redirection window, a store manager can
  manually enter the new domain.

### Files Modified
| File | Change |
|------|--------|
| `platform/sync/src/lib.rs` | `ServerMigrated` variant + propagation in `run_sync_cycle` + tests |
| `platform/sync/src/transport.rs` | `parse_server_migrated()` + redirect detection in 3 methods + tests |
| `platform/sync/src/daemon.rs` | Push/pull `ServerMigrated` handlers + tests |
| `platform/sync/src/test_helpers.rs` | **New** — shared test helpers |
| `apps/cloud-server/src/redirect.rs` | **New** — redirect middleware + tests |
| `apps/cloud-server/src/main.rs` | Middleware wiring + `OZ_REDIRECT_ONLY` mode |
| `docs/operations/vps-migration.md` | **New** — step-by-step migration guide |
| `docs/decisions/2026-07-13-zero-downtime-vps-migration.md` | This document |

---

## Related
- ADR #4 — Store-First Tenancy
- ADR #10 — Sync Performance, Ultra-Low-Cost Server, and 3-Month Retention Strategy
- `crates/oz-core/src/settings.rs` — Settings DB getters/setters
- `platform/sync/src/transport.rs` — Client transport parsing

> last audited 09-08-26 by buffy
> audit: Phase 1 Core Architecture & API Docs Audit; Phase 4 ADR Deep Audit
> status: ACCURATE (0 findings) · verified accurate: cargo check passed, no structural orphans, no stale version headers
> status: ACCURATE (verified against actual codebase)
