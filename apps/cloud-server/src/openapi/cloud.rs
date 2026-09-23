//! Cloud-only OpenAPI 3.1 fragments: the `components.schemas` and `paths`
//! objects that exist only on the cloud deployment, as plain data.
//!
//! Both builders moved out of `openapi.rs` unchanged; `openapi_spec` is their
//! only caller, and it merges their output into the shared `kasirmu-api` document
//! and stamps the cloud scope (`kasirmu_api::spec::annotate_scope`) itself, so
//! nothing here knows about scopes, tags, or the base spec.
//!
//! Both functions are named by the parent, so both are `pub(super)` and
//! nothing is re-exported: `openapi_tests.rs` reaches the document only
//! through `openapi_spec()`, never through these builders.

use serde_json::{Value, json};

// ── Cloud-only schemas ─────────────────────────────────────────────

pub(super) fn build_cloud_schemas() -> Value {
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
                "last_sync_at": { "type": ["string", "null"], "description": "ISO-8601 timestamp of most recent sync" },
                // Which portable-key derivation THIS process selected; see
                // `HealthResponse` in main.rs. Selection provenance only -
                // never the value, its length, or a digest of it, and false
                // reports that this process is not using a master key rather
                // than that no such variable exists.
                "portable_derivation_uses_master_key": {
                    "type": "boolean",
                    "description": "Which portable at-rest key derivation this process selected: true = master-key path, false = legacy static path. Reports the derivation only: no key material is exposed, and false means this process is not using a master key, not that no such variable was set.",
                    "example": false
                },
                // Whether PostgreSQL row-level security actually applies to
                // this process's connection. See 'HealthResponse' in main.rs.
                "rls_posture": {
                    "type": "string",
                    "description": "Whether tenant isolation (PostgreSQL row-level security) is in force on the connection this process uses: 'enforced' (all protected tenant tables FORCEd, role not a superuser), 'bypassed_by_superuser', 'bypassed_by_owner_role' (no table FORCEd), 'partially_enforced', 'no_protected_tables' (schema not applied here), 'not_applicable' (SQLite), or 'unknown' (catalog unreadable). A report only: the policies being present is not the same claim as their being effective.",
                    "enum": ["enforced", "bypassed_by_superuser", "bypassed_by_owner_role", "partially_enforced", "no_protected_tables", "not_applicable", "unknown"],
                    "example": "bypassed_by_owner_role"
                }
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
        // is `kasirmu_core::offline::OfflineQueueItem`: the push handler
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
                "priority": { "type": "string", "enum": ["Critical", "Normal", "Low"], "description": "Sync priority tier (P-2). Serialised as the variant name — capitalised, NOT snake_case — and defaulted to Normal when omitted", "default": "Normal" },
                // Nullable on purpose: a pre-existing row has no recorded origin,
                // and null means unknown — never an empty string. See
                // `20261007_sync_origin_and_effect_key.sql`.
                "origin_terminal_id": { "type": ["string", "null"], "description": "Terminal that originated this mutation, when its producer knew it; serialised as null when unknown. Consumers must treat null as not proven self-originated, never as not self-originated" }
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

pub(super) fn build_cloud_paths() -> Value {
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
        "/api/sync/conflicts": {
            "get": {
                "tags": ["Sync"],
                "summary": "List this tenant's flagged sync conflicts",
                "description": "Returns the conflicts flagged by server-side version-vector detection (a push concurrent with what the tenant's stored vector has already observed), newest first. Tenant scoping comes from the JWT, never the query string. Both filters are optional; an unrecognised value simply matches nothing.",
                "operationId": "syncConflictList",
                "security": [{ "bearerAuth": [] }],
                "parameters": [
                    { "name": "status", "in": "query", "required": false, "schema": { "type": "string", "enum": ["open", "resolved", "dismissed"] }, "description": "Filter by conflict status" },
                    { "name": "severity", "in": "query", "required": false, "schema": { "type": "string", "enum": ["high", "medium", "low"] }, "description": "Filter by conflict severity" }
                ],
                "responses": {
                    "200": { "description": "Matching conflicts with a count", "content": { "application/json": { "schema": { "type": "object", "properties": { "conflicts": { "type": "array", "description": "SyncConflictRow objects: id, entity_type, entity_id, severity, status, both vectors and both payloads verbatim, resolution fields null while open", "items": { "type": "object" } }, "count": { "type": "integer", "description": "Number of rows returned" } } } } } },
                    "401": { "description": "Missing or invalid JWT", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "500": { "description": "Conflict store query failed", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } }
                }
            }
        },
        "/api/sync/conflicts/{id}/resolve": {
            "post": {
                "tags": ["Sync"],
                "summary": "Record a manager's decision on a flagged conflict",
                "description": "Stores the chosen side or custom merge on the conflict row (the payload is recorded verbatim; the server never sums or merges money bodies). 404 when the id does not exist, belongs to another tenant, or is already closed — a second resolve must not overwrite the first decision, because the row is the audit trail.",
                "operationId": "syncConflictResolve",
                "security": [{ "bearerAuth": [] }],
                "parameters": [
                    { "name": "id", "in": "path", "required": true, "schema": { "type": "string" }, "description": "Conflict row id (UUIDv7)" }
                ],
                "requestBody": {
                    "required": true,
                    "content": {
                        "application/json": {
                            "schema": {
                                "type": "object",
                                "properties": {
                                    "resolution": { "type": "string", "description": "The chosen side or a custom merge, recorded verbatim on the row" }
                                },
                                "required": ["resolution"]
                            }
                        }
                    }
                },
                "responses": {
                    "200": { "description": "Decision recorded", "content": { "application/json": { "schema": { "type": "object", "properties": { "id": { "type": "string" }, "status": { "type": "string", "description": "\"resolved\"" }, "resolution": { "type": "string" } } } } } },
                    "401": { "description": "Missing or invalid JWT", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "404": { "description": "Unknown id, foreign tenant, or already closed", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "500": { "description": "Conflict store write failed", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } }
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
        "/api/webhooks/midtrans": {
            "post": {
                "tags": ["Webhooks"],
                "summary": "Midtrans QRIS transaction notification receiver",
                "description": "Receives Midtrans Core-API notifications for QRIS charges issued via this server. Unauthenticated — the notification is verified as SHA512(order_id + transaction_status_code + gross_amount + MIDTRANS_SERVER_KEY) against the `signature_key` field, in constant time. Settlement routing goes through the `midtrans_transactions` ledger written at QR-issue time, so a payment that completes before the device's sync push still resolves to its sale. Signature failures answer 401 (delivery stops); verified notifications for orders never issued here answer 200 `ignored`. A settlement whose signed amount differs from the issued amount is journaled as `amount_mismatch` and NOT finalized (fail closed).",
                "operationId": "midtransWebhook",
                "requestBody": {
                    "content": { "application/json": { "schema": { "type": "object", "description": "Raw Midtrans transaction notification" } } }
                },
                "responses": {
                    "200": { "description": "Processed (finalization_queued | recorded | already_processed | ignored)" },
                    "400": { "description": "Malformed notification body", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "401": { "description": "Missing or invalid signature_key", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "500": { "description": "Ledger or queue write failed — Midtrans will retry", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "503": { "description": "MIDTRANS_SERVER_KEY not configured", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } }
                }
            }
        },
        "/api/payment/midtrans/qris": {
            "post": {
                "tags": ["Payments"],
                "summary": "Issue a Midtrans QRIS charge for a sale",
                "description": "Raises a dynamic QR through the Midtrans Core-API (sandbox with MIDTRANS_SANDBOX=1) and records the issuance in the server-side ledger keyed by the returned `order_id`. TENANT COMES FROM THE JWT, never the body; a token without a tenant scope is rejected. HONEST TWO-PHASE CONTRACT: HTTP 200 means the QR was ISSUED, not paid — settlement arrives asynchronously via `POST /api/webhooks/midtrans` (QR validity is Midtrans-side, 300 s). Retrying with the same `idempotency_key` re-uses the same live QR (order_id is derived from the key) instead of minting a second one.",
                "operationId": "midtransQrisCharge",
                "security": [{ "bearerAuth": [] }],
                "requestBody": {
                    "content": {
                        "application/json": {
                            "schema": {
                                "type": "object",
                                "required": ["sale_id", "amount_minor"],
                                "properties": {
                                    "sale_id": { "type": "string", "description": "Device-side sale this QR will settle (no cloud-side FK: the ledger row is written before the sale syncs)" },
                                    "amount_minor": { "type": "integer", "format": "int64", "description": "IDR minor units — for IDR the minor unit IS the Rupiah (exp-0, PAY-1 convention); must be positive" },
                                    "currency": { "type": "string", "description": "Only IDR accepted (case-insensitive); absent implies IDR" },
                                    "idempotency_key": { "type": ["string", "null"], "description": "Optional caller key; reusing it re-uses the same order_id/live QR" },
                                    "description": { "type": ["string", "null"], "description": "Optional description forwarded to Midtrans" }
                                }
                            }
                        }
                    }
                },
                "responses": {
                    "200": { "description": "QR issued (status: qr_issued — NOT settled)", "content": { "application/json": { "schema": { "type": "object", "properties": { "order_id": { "type": "string" }, "qr_string": { "type": ["string", "null"] }, "status": { "type": "string", "const": "qr_issued" }, "amount_minor": { "type": "integer", "format": "int64" }, "currency": { "type": "string", "const": "IDR" }, "sale_id": { "type": "string" }, "expires_in_secs": { "type": "integer", "description": "Midtrans-side QR validity (300 s) — the UI countdown's single source of truth" } } } } } },
                    "400": { "description": "Validation failed (amount ≤ 0, missing sale_id, non-IDR currency)", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "401": { "description": "Missing/invalid JWT, or token not tenant-scoped", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "429": { "description": "Per-tenant rate limit", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "500": { "description": "Charge succeeded at Midtrans but the ledger write failed — body names the order_id; reconcile manually", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "502": { "description": "Midtrans refused or unreachable", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "503": { "description": "MIDTRANS_SERVER_KEY not configured; charging disabled", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } }
                }
            }
        },
        "/api/payment/midtrans/{order_id}/status": {
            "get": {
                "tags": ["Payments"],
                "summary": "Poll a QRIS charge's settlement status from the ledger",
                "description": "Read-only ledger lookup backing the checkout UI's polling fallback while the settlement webhook races the device's sync push. `settled` is true exactly when the ledger records `settlement`/`capture`. Tenant isolation is uniform-miss: an order belonging to another tenant answers the SAME 404 as a nonexistent one, so nothing leaks which order ids exist elsewhere.",
                "operationId": "midtransQrisStatus",
                "security": [{ "bearerAuth": [] }],
                "parameters": [
                    { "name": "order_id", "in": "path", "required": true, "schema": { "type": "string" }, "description": "Midtrans order id returned at charge time (the ledger key)" }
                ],
                "responses": {
                    "200": { "description": "Current ledger status", "content": { "application/json": { "schema": { "type": "object", "properties": { "order_id": { "type": "string" }, "status": { "type": "string" }, "settled": { "type": "boolean" } } } } } },
                    "401": { "description": "Missing/invalid JWT or token not tenant-scoped", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "404": { "description": "No such order for this tenant (also the answer for another tenant's order — uniform miss)", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "429": { "description": "Per-tenant rate limit", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } }
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
