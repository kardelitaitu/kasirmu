//! OpenAPI 3.1 API documentation for the OZ-POS cloud server.
//!
//! The shared surface (`x-oz-scope: "both"`) lives in
//! `oz_api::spec::base_spec()` — the single source of truth also served
//! by the desktop local API. This module merges the cloud-only paths
//! (`x-oz-scope: "cloud"`: host health/metrics, sync, webhooks, docs
//! UI) and cloud-only schemas on top, and provides the docs handlers:
//!
//! - `GET /api/openapi.json` — the merged OpenAPI 3.1 specification
//! - `GET /api/docs` — Swagger UI (loaded from CDN) pointing at the spec
//! - `GET /api/docs/scalar` — Scalar API Reference (modern, interactive docs)

use axum::{Json, response::Html};
use serde_json::{Value, json};

/// Returns the merged OpenAPI 3.1 specification (base `both` surface +
/// cloud-only paths/schemas/tags).
///
/// The path set and per-operation `security` declarations are guarded by
/// the drift-guard tests in `openapi_tests.rs` (spec 0047 §3): every
/// path declared here must resolve to a live route in `build_router`,
/// every operation must carry `bearerAuth` unless on the public
/// allowlist, the reverse direction is enforced by a compile-time source
/// scan of the router files, and every operation must carry a valid
/// `x-oz-scope` (base paths `"both"`, cloud paths `"cloud"`).
pub fn openapi_spec() -> Value {
    let mut spec = oz_api::spec::base_spec();
    spec["info"]["title"] = json!("OZ-POS Cloud Server API");
    spec["info"]["description"] = json!(
        "REST API for the OZ-POS point-of-sale cloud sync server.\n\n\
         ## Authentication\nMost endpoints require a JWT bearer token from \
         `POST /api/v1/tokens`. Pass it as `Authorization: Bearer <token>`.\n\n\
         ## Endpoint scope\nEvery operation carries `x-oz-scope`: `both` means \
         the endpoint is also served by the desktop app's loopback local API \
         (Settings → Local API); `cloud` means cloud-server-only (sync, \
         webhooks, docs UI, host health/metrics). See docs/guides/EXTENDING.md.\n\n\
         ## Versioning\nThe API is versioned by URL path prefix (`/api/v1/`). \
         Breaking changes will ship under a new version prefix (`/api/v2/`) — \
         the old version remains available for at least 6 months after the new \
         one lands.\n\n\
         ## Pagination\nList endpoints accept `?limit` (default 50, max 200) and \
         `?offset` (default 0) query parameters and return a `PaginatedResponse` \
         envelope with `data`, `total`, `limit`, and `offset` fields.\n\n\
         ## Errors\nAll error responses share a common envelope: \
         `{ \"error\": { \"code\": \"MACHINE_READABLE\", \"message\": \"Human description\", \
         \"details\": [...] } }`. The `code` field is stable across versions — \
         use it for programmatic error handling, not the message string.\n\n\
         ## Rate Limiting\nSync endpoints return `X-RateLimit-Remaining`, \
         `X-RateLimit-Reset`, and `Retry-After` headers when nearing the \
         per-tenant limit.\n\n\
         ## Changelog\n- **Read tiers (0.0.34, spec 0047):** terminal \
         client-credential tokens now bind the `terminal` preset — reads are \
         gated by `permissions` claim keys (403 `insufficient_scope` when \
         missing). Legacy tokens without the claim keep full read. The \
         `OZ_TERMINAL_READ_TIER=full` escape hatch restores legacy terminal \
         reads and is **deprecated** (removal after one release cycle).\n\
          - **Push outcome shape (0.0.37):** the `PushOutcome` schema now \
          describes the internally tagged object the server actually sends — \
          `{\"outcome\":\"accepted\"}`, `{\"outcome\":\"conflict\", <every queue \
          item field>}`, `{\"outcome\":\"rejected\",\"reason\":\"...\"}`. The wire \
          format never changed; only the description of it did. A client \
          written against the earlier externally tagged description could not \
          parse any push response and should move to the shape documented here."
    );
    spec["servers"] = json!([
        { "url": "http://localhost:{port}", "description": "Local development server", "variables": { "port": { "default": "3099", "description": "Server port (OZ_API_PORT env var)" } } },
        { "url": "https://{host}", "description": "Production server (behind reverse proxy)", "variables": { "host": { "default": "pos.example.com", "description": "Your deployment hostname" } } }
    ]);
    // Cloud-only tag groups (Docs already exists in the base tags).
    if let Some(tags) = spec["tags"].as_array_mut() {
        tags.extend_from_slice(&build_cloud_tags());
    }
    // Cloud-only schemas.
    if let Some(dst) = spec["components"]["schemas"].as_object_mut()
        && let Some(src) = build_cloud_schemas().as_object()
    {
        for (k, v) in src {
            dst.insert(k.clone(), v.clone());
        }
    }
    // Cloud-only paths, annotated with their scope before merging.
    let mut cloud_paths = build_cloud_paths();
    oz_api::spec::annotate_scope(&mut cloud_paths, oz_api::spec::SCOPE_CLOUD);
    if let Some(dst) = spec["paths"].as_object_mut()
        && let Some(src) = cloud_paths.as_object()
    {
        for (k, v) in src {
            dst.insert(k.clone(), v.clone());
        }
    }
    spec
}

/// Cloud-only tag groups appended to the base tags.
fn build_cloud_tags() -> Vec<Value> {
    vec![
        json!({ "name": "Sync", "description": "Offline queue push/pull sync endpoints (cloud-only)" }),
        json!({ "name": "Webhooks", "description": "Third-party payment provider webhook receivers (cloud-only)" }),
    ]
}

/// Returns a Swagger UI HTML page that loads the spec from `/api/openapi.json`.
///
/// Uses the unpkg CDN for Swagger UI assets. No additional dependencies needed.
pub fn swagger_ui_html() -> Html<String> {
    Html(
        r##"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OZ-POS API Docs — Swagger UI</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>
        html {{ box-sizing: border-box; overflow-y: scroll; }}
        *, *::before, *::after {{ box-sizing: inherit; }}
        body {{ margin: 0; background: #fafafa; }}
        .topbar {{ display: none; }}
        .swagger-ui .info {{ margin: 20px 0; }}
        .swagger-ui .info .title {{ font-size: 28px; }}
        .swagger-ui .scheme-container {{ display: none; }}
        .version-badge {{
            display: inline-block;
            background: #49cc90;
            color: #fff;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 13px;
            margin-left: 8px;
            vertical-align: middle;
        }}
    </style>
</head>
<body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js" crossorigin></script>
    <script>
        window.onload = function() {{
            window.ui = SwaggerUIBundle({{
                url: "/api/openapi.json",
                dom_id: "#swagger-ui",
                deepLinking: true,
                presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
                plugins: [SwaggerUIBundle.plugins.DownloadUrl],
                layout: "StandaloneLayout",
                defaultModelsExpandDepth: 1,
                defaultModelExpandDepth: 1,
                docExpansion: "list",
                filter: true,
                showExtensions: true,
                showCommonExtensions: true,
                tryItOutEnabled: true,
            }});
        }};
    </script>
</body>
</html>"##.to_string()
    )
}

/// Returns a Scalar API Reference HTML page that loads the spec from `/api/openapi.json`.
///
/// Scalar is a modern, interactive API documentation UI with a clean design.
/// Loaded from CDN — no additional dependencies needed.
pub fn scalar_html() -> Html<String> {
    Html(
        r##"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OZ-POS API Docs — Scalar</title>
    <style>
        body { margin: 0; padding: 0; }
    </style>
</head>
<body>
    <script
        id="api-reference"
        data-url="/api/openapi.json"
        data-proxy-url="https://proxy.scalar.com">
    </script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>"##
            .to_string(),
    )
}

// ── Cloud-only schemas ─────────────────────────────────────────────

fn build_cloud_schemas() -> Value {
    json!({
        "HealthResponse": {
            "type": "object",
            "properties": {
                "status": { "type": "string", "description": "Server status: 'ok' or 'degraded'", "example": "ok" },
                "version": { "type": "string", "description": "Server version", "example": env!("CARGO_PKG_VERSION") },
                "db": { "type": "string", "description": "Database backend type", "example": "sqlite" },
                "uptime_seconds": { "type": "integer", "format": "int64", "description": "Seconds since server start" },
                "db_connected": { "type": "boolean", "description": "Whether the database responded to a ping" },
                "db_latency_us": { "type": "integer", "format": "int64", "description": "Database ping latency in microseconds" },
                "sync_queue_depth": { "type": "integer", "format": "int64", "description": "Number of pending items in the sync queue" },
                "last_sync_at": { "type": ["string", "null"], "description": "ISO-8601 timestamp of most recent sync" }
            }
        },
        "SyncStatusResponse": {
            "type": "object",
            "required": ["status", "version", "pending_count", "heartbeat_interval_secs"],
            "properties": {
                "status": { "type": "string", "description": "Server health status", "example": "ok" },
                "version": { "type": "string", "description": "Server package version" },
                "pending_count": { "type": "integer", "format": "int64", "description": "Queue items with status pending for this tenant" },
                "heartbeat_interval_secs": { "type": "integer", "format": "int64", "description": "Recommended client poll interval (P-3 tiered heartbeat: <1000 tenants → 120s, 1000–5000 → 300s, above → scaled)" }
            }
        },
        "WebhookEndpoint": {
            "type": "object",
            "description": "A registered outbound webhook endpoint. The HMAC signing secret is never included — it is returned once at creation.",
            "properties": {
                "id": { "type": "string" },
                "tenant_id": { "type": "string" },
                "url": { "type": "string", "format": "uri" },
                "events": { "type": "array", "items": { "type": "string" }, "description": "Subscribed queue actions, or [\"*\"]" },
                "active": { "type": "boolean" },
                "created_at": { "type": "string", "format": "date-time" },
                "updated_at": { "type": "string", "format": "date-time" }
            }
        },
        // One offline queue item exactly as it crosses the wire. The Rust type
        // is `oz_core::offline::OfflineQueueItem`: the push handler
        // deserialises `Json<Vec<OfflineQueueItem>>`, the pull response
        // returns the same struct, and the `conflict` branch of `PushOutcome`
        // flattens it next to its tag. Field names, nullability and casing are
        // that struct's serde output — held honest by
        // `push_outcome_documented_schema_matches_serde_wire_shape`.
        "SyncPushItem": {
            "type": "object",
            "description": "One offline sync queue item. Element of the `POST /api/sync/push` request body and of the `POST /api/sync/pull` response, and the payload a `conflict` push outcome flattens alongside its tag.",
            "required": ["id", "action", "payload", "status", "retry_count", "created_at"],
            "properties": {
                "id": { "type": "string", "description": "Queue item ID (UUID v7), generated by the client; a duplicate is reported per item as a rejected outcome", "example": "0190a4b2-7c1e-7a33-9df2-9f2f1b2c3d4e" },
                "action": { "type": "string", "description": "Domain action to apply — a free-form action name, not a CRUD verb", "example": "complete_sale" },
                "payload": { "type": "string", "description": "JSON-serialized action payload — a STRING containing JSON, not an object", "example": "{\"sale_id\":\"0190a4b2\"}" },
                "status": { "type": "string", "enum": ["pending", "synced", "failed"], "description": "Queue status (snake_case)" },
                "retry_count": { "type": "integer", "format": "int64", "description": "Sync attempts already made" },
                "last_error": { "type": ["string", "null"], "description": "Last transport error; serialised as null when there is none" },
                "tenant_id": { "type": "string", "description": "Owning tenant; defaults to \"default\" when omitted. The server overrides it from the JWT claims, so a client-supplied value is ignored", "default": "default" },
                "created_at": { "type": "string", "description": "ISO-8601 creation timestamp", "example": "2026-09-11T12:34:56.789Z" },
                "synced_at": { "type": ["string", "null"], "description": "ISO-8601 sync timestamp; serialised as null until the item is applied" },
                "priority": { "type": "string", "enum": ["Critical", "Normal", "Low"], "description": "Sync priority tier (P-2). Serialised as the variant name — capitalised, NOT snake_case — and defaulted to Normal when omitted", "default": "Normal" }
            }
        },
        "SyncPushRequest": {
            "type": "array",
            "items": { "$ref": "#/components/schemas/SyncPushItem" },
            "description": "Array of offline queue items to push"
        },
        "SyncPullResponse": {
            "type": "object",
            "required": ["items"],
            "properties": {
                "items": { "type": "array", "items": { "$ref": "#/components/schemas/SyncPushItem" }, "description": "Pending items from other terminals" },
                "next_cursor": { "type": ["string", "null"], "description": "Opaque cursor for the next page (P-3); null when no more pages" }
            }
        },
        // Per-item push outcome. `platform_sync::transport::PushOutcome` is an
        // INTERNALLY tagged enum — `#[serde(tag = "outcome",
        // rename_all = "snake_case")]` — so every variant is a JSON object
        // carrying the discriminator, and the `Conflict` newtype payload (a
        // whole queue item) is flattened NEXT TO the tag rather than nested
        // under a "Conflict" key. Wire truth, pinned on the type side by the
        // platform-sync test
        // `push_outcome_serialises_as_internally_tagged_flat_object`:
        //   {"outcome":"accepted"}
        //   {"outcome":"conflict", ...every SyncPushItem field}
        //   {"outcome":"rejected","reason":"duplicate id: <uuid>"}
        // This document and those three values are held together by
        // `push_outcome_documented_schema_matches_serde_wire_shape`, which
        // derives its expectation from serde_json::to_value of the real enum:
        // change the tag on the type and a test fails instead of the published
        // contract rotting silently.
        "PushOutcome": {
            "description": "Per-item push outcome: a JSON object whose `outcome` member is the discriminator — `accepted`, `conflict` or `rejected`. Never a bare variant string, and never a single-key `{\"Conflict\": ...}` wrapper: the fields a variant carries sit flat beside the tag.",
            "oneOf": [
                {
                    "description": "Item was accepted and applied by the server. Carries no fields beyond the discriminator.",
                    "type": "object",
                    "required": ["outcome"],
                    "additionalProperties": false,
                    "properties": {
                        "outcome": { "type": "string", "enum": ["accepted"], "description": "Discriminator" }
                    }
                },
                {
                    "description": "Item conflicted with the server version. The server's copy of the queue item is returned FLATTENED into this same object (serde internal tagging), so `outcome` sits beside every SyncPushItem field and the client resolves the conflict from them.",
                    "type": "object",
                    "required": ["outcome"],
                    "allOf": [
                        { "$ref": "#/components/schemas/SyncPushItem" },
                        {
                            "type": "object",
                            "properties": {
                                "outcome": { "type": "string", "enum": ["conflict"], "description": "Discriminator" }
                            }
                        }
                    ]
                },
                {
                    "description": "Item was rejected; `reason` says why.",
                    "type": "object",
                    "required": ["outcome", "reason"],
                    "additionalProperties": false,
                    "properties": {
                        "outcome": { "type": "string", "enum": ["rejected"], "description": "Discriminator" },
                        "reason": { "type": "string", "description": "Human-readable reason, e.g. \"duplicate id: <uuid>\" or \"invalid id: <raw>\"" }
                    }
                }
            ]
        },
        "PushResponse": {
            "type": "object",
            "required": ["results"],
            "properties": {
                "results": { "type": "array", "items": { "$ref": "#/components/schemas/PushOutcome" }, "description": "Per-item outcomes in the same order as the push request" }
            }
        },
        "SnapshotResponse": {
            "type": "object",
            "required": ["products", "tax_rates", "users"],
            "properties": {
                "products": { "type": "array", "items": { "type": "object" }, "description": "Tenant's product rows" },
                "tax_rates": { "type": "array", "items": { "type": "object" }, "description": "Tenant's tax rates" },
                "users": { "type": "array", "items": { "type": "object" }, "description": "Tenant's user rows" }
            }
        },
    })
}

// ── Cloud-only paths ───────────────────────────────────────────────

fn build_cloud_paths() -> Value {
    json!({
        // ── Health ──────────────────────────────────────────────────
        "/health": {
            "get": {
                "tags": ["Health"],
                "summary": "Health check",
                "description": "Returns server status, version, DB connectivity, uptime, and sync queue depth. Public — no authentication required.",
                "operationId": "healthCheck",
                "responses": {
                    "200": { "description": "Server is healthy", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/HealthResponse" } } } },
                    "503": { "description": "Server is degraded (DB unreachable)", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } }
                }
            }
        },
        "/api/health": {
            "get": {
                "tags": ["Health"],
                "summary": "Health check (API alias)",
                "description": "Alias for /health. Returns the same response.",
                "operationId": "healthCheckApi",
                "responses": {
                    "200": { "description": "Server is healthy", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/HealthResponse" } } } }
                }
            }
        },
        "/metrics": {
            "get": {
                "tags": ["Health"],
                "summary": "Prometheus metrics",
                "description": "Returns Prometheus text-format metrics including sync counters, health check metrics, and HTTP request histograms.",
                "operationId": "metricsEndpoint",
                "responses": {
                    "200": { "description": "Prometheus metrics in text/plain format", "content": { "text/plain": { "schema": { "type": "string" } } } }
                }
            }
        },
        // ── Sync ────────────────────────────────────────────────────
        "/api/sync/status": {
            "get": {
                "tags": ["Sync"],
                "summary": "Sync status",
                "description": "Returns the current state of the offline sync queue: server status, version, this tenant's pending count, and the recommended heartbeat poll interval. Scoped to the tenant in the JWT.\n\nRate limit headers returned when approaching per-tenant limits: `X-RateLimit-Remaining` (int), `X-RateLimit-Reset` (Unix timestamp), `Retry-After` (seconds).",
                "operationId": "syncStatus",
                "security": [{ "bearerAuth": [] }],
                "responses": {
                    "200": { "description": "Sync queue status", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/SyncStatusResponse" } } } },
                    "401": { "description": "Missing or invalid JWT", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } }
                }
            }
        },
        "/api/sync/push": {
            "post": {
                "tags": ["Sync"],
                "summary": "Push offline items to the server",
                "description": "Accepts a JSON array of offline queue items and stores them in the server's database. Each item is stamped with the tenant ID from the JWT for multi-tenant isolation. Duplicate item ids are reported per-item as `Rejected` (the request itself still succeeds). Plan-gated when `OZ_ENFORCE_PLANS` is on.",
                "operationId": "syncPush",
                "security": [{ "bearerAuth": [] }],
                "requestBody": {
                    "required": true,
                    "content": { "application/json": { "schema": { "$ref": "#/components/schemas/SyncPushRequest" } } }
                },
                "responses": {
                    "200": { "description": "Per-item outcomes in request order", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/PushResponse" } } } },
                    "401": { "description": "Missing or invalid JWT", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "403": { "description": "Plan gate (`OZ_ENFORCE_PLANS`): free tenant (`plan_required`)", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "429": { "description": "Rate limited (per-tenant)", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } }
                }
            }
        },
        "/api/sync/pull": {
            "post": {
                "tags": ["Sync"],
                "summary": "Pull pending items from the server",
                "description": "Returns items pushed by other terminals in the same tenant since the given timestamp, paginated via an opaque cursor (P-3). Each terminal polls this endpoint to stay in sync. Plan-gated when `OZ_ENFORCE_PLANS` is on.",
                "operationId": "syncPull",
                "security": [{ "bearerAuth": [] }],
                "requestBody": {
                    "required": true,
                    "content": {
                        "application/json": {
                            "schema": {
                                "type": "object",
                                "properties": {
                                    "since": { "type": ["string", "null"], "description": "ISO-8601 timestamp to filter items from (null = all)" },
                                    "cursor": { "type": ["string", "null"], "description": "Opaque pagination cursor from the previous page's `next_cursor` (null = first page)" }
                                }
                            },
                            "example": { "since": null, "cursor": null }
                        }
                    }
                },
                "responses": {
                    "200": { "description": "Items to sync (may be empty)", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/SyncPullResponse" } } } },
                    "401": { "description": "Missing or invalid JWT", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "403": { "description": "Plan gate (`OZ_ENFORCE_PLANS`): free tenant (`plan_required`)", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "421": { "description": "Server migrated — use new URL", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } }
                }
            }
        },
        "/api/sync/snapshot": {
            "get": {
                "tags": ["Sync"],
                "summary": "Full reference-data snapshot for the tenant",
                "description": "Returns the tenant's reference data (products, tax rates, users) as one JSON document — used to provision a fresh terminal without thousands of per-row pulls. Per-tenant cached (15-min TTL, single-flight recompute, version revalidation; Redis-shared when configured). Responses carry `ETag` + `Cache-Control: public, max-age=60`; a matching `If-None-Match` returns `304` with no body. A failed snapshot returns a non-2xx status — it never masquerades as a valid empty snapshot (SYNC-09). Plan-gated when `OZ_ENFORCE_PLANS` is on.",
                "operationId": "syncSnapshot",
                "security": [{ "bearerAuth": [] }],
                "parameters": [
                    { "name": "If-None-Match", "in": "header", "required": false, "schema": { "type": "string" }, "description": "ETag from a previous response; a match returns 304 Not Modified" }
                ],
                "responses": {
                    "200": { "description": "Reference-data snapshot", "headers": { "ETag": { "description": "SHA-256 digest of the response bytes", "schema": { "type": "string" } }, "Cache-Control": { "description": "public, max-age=60", "schema": { "type": "string" } } }, "content": { "application/json": { "schema": { "$ref": "#/components/schemas/SnapshotResponse" } } } },
                    "304": { "description": "Not Modified (If-None-Match matched the current ETag)" },
                    "401": { "description": "Missing or invalid JWT", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "403": { "description": "Plan gate (`OZ_ENFORCE_PLANS`): free tenant (`plan_required`)", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "429": { "description": "Rate limited (per-tenant)", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "500": { "description": "Snapshot query failed — body carries `{\"error\": msg}`; never a fake empty snapshot", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } }
                }
            }
        },

        // ── Webhooks ────────────────────────────────────────────────
        "/api/webhooks/stripe": {
            "post": {
                "tags": ["Webhooks"],
                "summary": "Stripe webhook receiver",
                "description": "Receives Stripe webhook events. Payloads are verified using HMAC-SHA256 with the STRIPE_WEBHOOK_SECRET signing secret. Unauthenticated — verification is via the Stripe-Signature header. Subscription lifecycle events (customer.subscription.*, checkout.session.completed, invoice.paid) update the tenant's sync plan; payment events queue a finalize_sale action.",
                "operationId": "stripeWebhook",
                "requestBody": {
                    "content": { "application/json": { "schema": { "type": "object", "description": "Raw Stripe webhook event" } } }
                },
                "responses": {
                    "200": { "description": "Webhook processed successfully" },
                    "400": { "description": "Invalid signature or malformed event", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } }
                }
            }
        },
        "/api/webhooks/square": {
            "post": {
                "tags": ["Webhooks"],
                "summary": "Square webhook receiver",
                "description": "Receives Square webhook events. Payloads are verified using HMAC-SHA256 with the SQUARE_WEBHOOK_SIGNATURE_KEY. Unauthenticated — verification is via the x-square-hmacsha256-signature header.",
                "operationId": "squareWebhook",
                "requestBody": {
                    "content": { "application/json": { "schema": { "type": "object", "description": "Raw Square webhook event" } } }
                },
                "responses": {
                    "200": { "description": "Webhook processed successfully" },
                    "400": { "description": "Invalid signature or malformed event", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } }
                }
            }
        },
        "/api/webhooks": {
            "get": {
                "tags": ["Webhooks"],
                "summary": "List outbound webhook endpoints",
                "description": "Returns the tenant's registered outbound webhook endpoints (signing secrets are never listed — shown once at creation only). Gated by the server's admin key (X-Admin-Key header); open in dev mode.",
                "operationId": "listWebhookEndpoints",
                "parameters": [
                    { "name": "tenant_id", "in": "query", "required": false, "schema": { "type": "string", "default": "default" } }
                ],
                "responses": {
                    "200": { "description": "Endpoint list", "content": { "application/json": { "schema": { "type": "object", "properties": { "endpoints": { "type": "array", "items": { "$ref": "#/components/schemas/WebhookEndpoint" } } } } } } },
                    "401": { "description": "Missing or invalid `X-Admin-Key` when configured", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } }
                }
            },
            "post": {
                "tags": ["Webhooks"],
                "summary": "Register an outbound webhook endpoint",
                "description": "Registers a URL to receive signed event POSTs (`sale`/`stock`/`product` queue actions, see the guide §7.4). `events` is a JSON array of action names or `[\"*\"]` for all. The response `secret` is shown exactly once — it is the HMAC-SHA256 key for `X-OZ-Signature: sha256=<hex>` verification. Gated by the server's admin key (X-Admin-Key header); open in dev mode.",
                "operationId": "createWebhookEndpoint",
                "requestBody": {
                    "required": true,
                    "content": { "application/json": { "schema": { "type": "object", "required": ["url"], "properties": { "tenant_id": { "type": "string", "default": "default" }, "url": { "type": "string", "format": "uri", "example": "https://scripts.example.com/oz-events" }, "events": { "type": "array", "items": { "type": "string" }, "example": ["complete_sale", "stock.adjusted"] } } } } }
                },
                "responses": {
                    "201": { "description": "Endpoint created; secret shown once", "content": { "application/json": { "schema": { "type": "object", "properties": { "endpoint": { "$ref": "#/components/schemas/WebhookEndpoint" }, "secret": { "type": "string" }, "note": { "type": "string" } } } } } },
                    "400": { "description": "Invalid url or event list", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "401": { "description": "Missing or invalid `X-Admin-Key` when configured", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } }
                }
            }
        },
        "/api/webhooks/{id}": {
            "delete": {
                "tags": ["Webhooks"],
                "summary": "Delete an outbound webhook endpoint",
                "description": "Stops NEW events from fanning out to this endpoint; in-flight outbox retries continue (delivery payloads are self-contained). Idempotent: 204 whether or not the endpoint existed. Gated by the server's admin key (X-Admin-Key header); open in dev mode.",
                "operationId": "deleteWebhookEndpoint",
                "parameters": [
                    { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } },
                    { "name": "tenant_id", "in": "query", "required": false, "schema": { "type": "string", "default": "default" } }
                ],
                "responses": {
                    "204": { "description": "Deleted (or already absent)" },
                    "401": { "description": "Missing or invalid `X-Admin-Key` when configured", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } }
                }
            }
        },
        "/api/docs": {
            "get": {
                "tags": ["Docs"],
                "summary": "Swagger UI",
                "description": "Interactive Swagger UI loading the spec from /api/openapi.json (assets from the unpkg CDN). Public.",
                "operationId": "swaggerUi",
                "responses": {
                    "200": { "description": "Swagger UI HTML page", "content": { "text/html": { "schema": { "type": "string" } } } }
                }
            }
        },
        "/api/docs/scalar": {
            "get": {
                "tags": ["Docs"],
                "summary": "Scalar API reference",
                "description": "Interactive Scalar API reference loading the spec from /api/openapi.json. Public.",
                "operationId": "scalarUi",
                "responses": {
                    "200": { "description": "Scalar API reference HTML page", "content": { "text/html": { "schema": { "type": "string" } } } }
                }
            }
        }
    })
}

/// Handler: `GET /api/openapi.json` — returns the OpenAPI 3.1 specification.
pub async fn openapi_json_handler() -> Json<Value> {
    Json(openapi_spec())
}

/// Handler: `GET /api/docs` — returns the Swagger UI HTML page.
pub async fn swagger_ui_handler() -> Html<String> {
    swagger_ui_html()
}

/// Handler: `GET /api/docs/scalar` — returns the Scalar API Reference HTML page.
pub async fn scalar_ui_handler() -> Html<String> {
    scalar_html()
}

#[cfg(test)]
#[path = "openapi_tests.rs"]
mod tests;
