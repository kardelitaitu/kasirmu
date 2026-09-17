# oz-api

<!-- Audit stamp: 2026-09-08 · DSH · status: ACCURATE after repair (2 findings) · SUPERSEDES the 2026-09-03 stamp, whose work stands: the route table was re-repaired and its Auth column corrected against the handlers, and the local-API notes it added are still accurate. Two gaps since: the three /api/v1/memos/* routes from the 2026-09-07 cloud-read ruling were absent, and GET /api/openapi.json was never in the table at all even though it is a public, no-auth route this crate serves and docs/guides/EXTENDING.md §2.3 documents it. Reconciled by counting, not by eye: the crate registers 27 route() literals; the table now has 31 rows covering all 27 literals — 31 = 27 + 4, because /api/v1/settings, /api/v1/products, /api/v1/exchange-rates and /api/v1/images each carry two rows for their two methods, and every row maps back to a real literal. A third footnote records require_tenant_write, the tenant-scoped sibling of the operator-write gate, which is NOT the same rule - it does not exclude the desktop path outright. Re-verified: OZ_API_PORT default 3099 and OZ_DB_PATH default kasir.db match lib.rs, and the AppState/CORS notes in §State hold. -->

REST API server for kasir.mu. An axum HTTP API for third-party scripts, kitchen displays, and inventory scanners. Mounted by `apps/cloud-server`, and embedded loopback-only by the desktop app (`apps/desktop-client/src/local_api.rs`, off by default — see [EXTENDING guide](../../docs/guides/EXTENDING.md) §2.2).

## Quick start

```rust
// Standalone (binds 0.0.0.0, env-configured):
kasirmu_api::serve().await?;

// Embedded on loopback (what the desktop app does — never serve()):
let app = kasirmu_api::router(app_state); // AppState carries db + api_secret
let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;
axum::serve(listener, app).await?;
```

Listens on `OZ_API_PORT` (default `3099`). DB path from `OZ_DB_PATH` (default `kasir.db`).

## API routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/health` | No | Health check |
| GET | `/api/openapi.json` | No | OpenAPI 3.1 document for this surface (see §OpenAPI below and docs/guides/EXTENDING.md §2.3) |
| POST | `/api/v1/tokens` | Admin¹ | Mint JWT (admin-key path or terminal client-credentials path) |
| POST | `/api/v1/terminals` | Admin¹ | Register terminal; returns `device_secret` once, re-register rotates |
| PUT | `/api/v1/tenants/{tenant_id}/plan` | Admin¹ | Set tenant plan |
| GET | `/api/v1/settings` | Admin¹ | Read tenant effective settings (SMTP / report schedule) |
| PUT | `/api/v1/settings` | Admin¹ | Update tenant scoped settings |
| GET | `/api/v1/products` | JWT | List products |
| POST | `/api/v1/products` | JWT + Admin² | Create product |
| GET | `/api/v1/products/{sku}` | JWT | Get product by SKU |
| PATCH | `/api/v1/products/{sku}/stock` | JWT + Admin² | Adjust stock (signed delta) |
| GET | `/api/v1/categories` | JWT | List categories |
| POST | `/api/v1/tax-rates` | JWT + Admin² | Create tax rate |
| GET | `/api/v1/exchange-rates` | JWT | Full rate history |
| POST | `/api/v1/exchange-rates` | JWT + Admin² | Create rate (6-decimal fixed point) |
| GET | `/api/v1/exchange-rates/latest` | JWT | Newest rate per pair |
| GET | `/api/v1/exchange-rates/latest/{from}/{to}` | JWT | Newest rate for one pair |
| DELETE | `/api/v1/exchange-rates/{id}` | JWT + Admin² | Delete rate |
| GET | `/api/v1/tenants/me/plan` | JWT | Get my plan |
| POST | `/api/v1/users` | JWT + Admin² | Create user |
| POST | `/api/v1/sales` | JWT | Create sale |
| GET | `/api/v1/sales/{id}` | JWT | Get sale |
| PATCH | `/api/v1/sales/{id}/status` | JWT | Update sale status |
| PUT | `/api/v1/images` | JWT | Store one WebP (≤ 32 KB, content-addressed) |
| POST | `/api/v1/images` | JWT | Batch store (≤ 16 files / 512 KB, length-prefixed frames) |
| GET | `/api/v1/images:pack` | JWT | Fetch ≤ 64 files as binary frames |
| GET | `/api/v1/images:missing` | JWT | Missing-hash set difference |
| GET | `/api/v1/images/{hash16}` | JWT | Immutable WebP bytes |
| POST | `/api/v1/memos/sync` | JWT³ | Desktop pushes its COMPLETE memo state; server reconciles by upsert + delete-by-omission. `tenant_id` comes from the claims, never the body |
| GET | `/api/v1/memos/active` | JWT | Memos a terminal should currently display (`?terminal_id=`); same DTO as the desktop command so the banner consumes one type everywhere |
| POST | `/api/v1/memos/{memo_id}/ack` | JWT (terminal only) | Acknowledge a memo. An admin-minted token has no terminal identity and cannot ack |

¹ `X-Admin-Key` header required when the server has an admin key configured (`OZ_ADMIN_KEY` on the cloud server; the per-install secret on the desktop local API); open in dev mode.
  Docker deploys: `docker-compose.yml` hard-requires `OZ_ADMIN_KEY` (`:?` fail-fast at parse time, matching `OZ_API_SECRET`) — unset now means no stack, not an open mint.
² Operator write tier (D1): admin key **and** a non-terminal token — device credentials
must never mutate master data. Sales writes are exempt (terminals sell).
³ `require_tenant_write`: tenant-scoped sibling of ² — a non-terminal caller needs the
admin key when one is configured, but the desktop path is not excluded outright.
GETs on JWT routes are additionally gated by read-tier permissions (spec 0047).
The three `memos` routes were added by the 2026-09-07 cloud-read ruling and were absent
from this table until 08-09-26 — the same four-day gap that hit docs/guides/EXTENDING.md
§3.2. `spec/paths.rs` declared them throughout, so the machine-readable contract stayed
current and only the prose tables drifted.
Full contract, auth model, and recipes: [docs/guides/EXTENDING.md](../../docs/guides/EXTENDING.md).

```bash
# Generate token
curl -X POST http://localhost:3099/api/v1/tokens \
  -H "Content-Type: application/json" \
  -d '{"label": "my-script"}'

# Use token
curl http://localhost:3099/api/v1/products \
  -H "Authorization: Bearer <token>"
```

## State

`AppState` wraps SQLite in `Arc<Mutex<Connection>>`. CORS uses a configurable origin allowlist (`OZ_CORS_ORIGINS`, default `DEFAULT_CORS_ORIGINS`; `"*"` is an explicit dev opt-in, otherwise fail-closed). All JWT-protected routes return 401 without a valid token.

## OpenAPI document (`spec/`)

This crate owns the machine-readable contract: `spec::base_spec()` builds the OpenAPI 3.1 document for every route above (all operations tagged `x-oz-scope: "both"`), and `spec::local_spec(port)` adds the loopback server info the desktop app serves at `GET /api/openapi.json`. `apps/cloud-server/src/openapi.rs` merges its cloud-only paths (`x-oz-scope: "cloud"`: sync, webhooks, docs UI, host health/metrics) on top. Drift is policed by the cloud-server guard tests in both directions, including `$ref` resolution across the split.

> last audited 08-09-26 by DSH
