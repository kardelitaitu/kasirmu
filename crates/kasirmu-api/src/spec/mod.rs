//! Shared OpenAPI 3.1 document for the `kasirmu-api` surface.
//!
//! Single source of truth for the contract served by BOTH the cloud
//! server (`apps/cloud-server`, which merges its own sync/webhook/docs
//! paths on top) and the desktop local API
//! (`apps/desktop-tauri/src/local_api.rs`, which serves exactly this
//! base document). Every operation carries `x-oz-scope`:
//!
//! - `"both"` — served by the cloud server AND the desktop local API
//!   (everything in this module);
//! - `"cloud"` — cloud-only (added by the cloud server's builder).
//!
//! The document is generated programmatically (no utoipa dependency —
//! spec 0047 records the migration as deliberately deferred). Drift is
//! policed by `apps/cloud-server/src/openapi_tests.rs`: the merged spec
//! must equal the route set registered in the router sources, in BOTH
//! directions.

use serde_json::{Value, json};

mod paths;
mod schemas;
use paths::build_base_paths;
use schemas::{build_base_parameters, build_base_schemas};

/// Scope value: operation served by cloud server and desktop local API.
pub const SCOPE_BOTH: &str = "both";
/// Scope value: cloud-server-only operation (sync, webhooks, docs UI).
pub const SCOPE_CLOUD: &str = "cloud";

/// The OpenAPI 3.1 document for the shared (`x-oz-scope: "both"`)
/// surface: exactly what `router()` serves, plus the self-documenting
/// `/api/openapi.json` path that both embedders register.
pub fn base_spec() -> Value {
    let mut spec = json!({
        "openapi": "3.1.0",
        "info": {
            "title": "OZ-POS API",
            "version": env!("CARGO_PKG_VERSION"),
            "description": "REST API for the OZ-POS point-of-sale system.\n\n## Authentication\nMost endpoints require a JWT bearer token from `POST /api/v1/tokens`. Pass it as `Authorization: Bearer <token>`.\n\n## Endpoint scope\nEvery operation carries `x-oz-scope`: `both` means the endpoint is served by the cloud server AND the desktop app's loopback local API (Settings → Local API); `cloud` means cloud-server-only (sync, webhooks, docs UI). This document describes the `both` surface; the cloud server serves the merged superset at its own `/api/openapi.json`.\n\n## Versioning\nThe API is versioned by URL path prefix (`/api/v1/`). Breaking changes will ship under a new version prefix (`/api/v2/`) — the old version remains available for at least 6 months after the new one lands.\n\n## Pagination\nList endpoints accept `?limit` (default 50, max 200) and `?offset` (default 0) query parameters and return a `PaginatedResponse` envelope with `data`, `total`, `limit`, and `offset` fields.\n\n## Errors\nAll error responses share a common envelope: `{ \"error\": { \"code\": \"MACHINE_READABLE\", \"message\": \"Human description\", \"details\": [...] } }`. The `code` field is stable across versions — use it for programmatic error handling, not the message string.\n\n## Changelog\n- **Read tiers (0.0.34, spec 0047):** terminal client-credential tokens now bind the `terminal` preset — reads are gated by `permissions` claim keys (403 `insufficient_scope` when missing). Legacy tokens without the claim keep full read. The `OZ_TERMINAL_READ_TIER=full` escape hatch restores legacy terminal reads and is **deprecated** (removal after one release cycle).",
            "contact": { "name": "OZ-POS" }
        },
        "externalDocs": {
            "description": "OZ-POS documentation",
            "url": "https://github.com/oz-pos/oz-pos"
        },
        "tags": [
            { "name": "Health", "description": "Server health and monitoring endpoints" },
            { "name": "Auth", "description": "Token generation and authentication. **Read tiers (spec 0047):** a token may carry an optional `permissions` claim (list of permission-registry keys). Reads are then gated per route: a missing key returns `403 insufficient_scope`. A token without the claim is grandfathered as full-read. Presets (`terminal`, `dashboard`, `audit`) are mint-time sugar — terminal client-credential tokens automatically bind the `terminal` preset; admin-key mints accept `read_preset`/`read_permissions`. The `OZ_TERMINAL_READ_TIER=full` escape hatch preserves legacy terminal reads (deprecated, one release window)." },
            { "name": "Products", "description": "Product CRUD and stock management" },
            { "name": "Images", "description": "Content-addressed product/menu-item image store (spec 0046b)" },
            { "name": "Categories", "description": "Product category listing" },
            { "name": "Tax Rates", "description": "Tax rate configuration" },
            { "name": "Exchange Rates", "description": "Currency exchange rate management (global reference data)" },
            { "name": "Users", "description": "User account management" },
            { "name": "Sales", "description": "Sale creation, retrieval, and status transitions" },
            { "name": "Memos", "description": "Cloud memo serving layer (2026-09-07 ruling): the desktop pushes its complete memo state and terminals read their active memos. Serving is cloud-Postgres-backed; both endpoints are JWT-protected." },
            { "name": "Plans", "description": "Tenant cloud sync plans (ADR sync-plan-gating)" },
            { "name": "Terminals", "description": "Terminal registration for client-credential authentication" },
            { "name": "Settings", "description": "Per-tenant cloud settings provisioning (SMTP, report schedule, store name). Gated by the admin key (X-Admin-Key), not by JWT — see the operation descriptions." },
            { "name": "Docs", "description": "Self-describing API documentation endpoints (OpenAPI 3.1 document)" },
            { "name": "Inventory", "description": "Stock movements, transfers, low-stock alerts, and purchase order management" },
            { "name": "Orders", "description": "Kitchen display order routing, course firing, and production tracking" },
            { "name": "Reports", "description": "Sales summaries, category breakdowns, hourly heatmaps, and staff performance reports" },
            { "name": "Customers", "description": "Customer profiles, loyalty points, gift card balances, and CRM integrations" },
            { "name": "Notifications", "description": "Push notification registration, email alerts, and in-app messaging" },
            { "name": "Analytics", "description": "Menu engineering scores, popularity metrics, trend forecasts, and margin analysis" }
        ],
        "components": {
            "securitySchemes": {
                "bearerAuth": {
                    "type": "http",
                    "scheme": "bearer",
                    "bearerFormat": "JWT",
                    "description": "JWT token obtained from `POST /api/v1/tokens`. Include as `Authorization: Bearer <token>`."
                }
            },
            "parameters": build_base_parameters(),
            "schemas": build_base_schemas()
        },
        "paths": build_base_paths()
    });
    annotate_scope(&mut spec["paths"], SCOPE_BOTH);
    spec
}

/// The document the desktop local API serves: [`base_spec`] with
/// loopback server info and local-facing wording injected.
pub fn local_spec(port: u16) -> Value {
    let mut spec = base_spec();
    spec["info"]["title"] = json!("OZ-POS Local Terminal API");
    spec["info"]["description"] = json!(
        "REST API served by the OZ-POS desktop app on this machine only \
         (127.0.0.1). Enable it in Settings → Local API. Tokens are minted \
         in that panel; every operation here is `x-oz-scope: \"both\"` — \
         cloud-only endpoints (sync, webhooks, docs UI) are absent. This \
         server reads and writes the PRIMARY STORE's database — the same \
         data the register UI shows; note `POST /api/v1/users` therefore \
         does not create register login accounts (identity lives outside \
         this server). See docs/guides/EXTENDING.md in the source tree \
         for scripting recipes.\n\n\
         ## Authentication\nJWT bearer from the Settings panel: \
         `Authorization: Bearer <token>`. Master-data writes additionally \
         require `X-Admin-Key` (the per-install secret — see the guide §2.2). \
         The terminal client-credentials mint path is disabled on this \
         surface — device credentials are cloud-fleet provisioning."
    );
    spec["servers"] = json!([
        { "url": format!("http://127.0.0.1:{port}"), "description": "This terminal (loopback only)" }
    ]);
    // The desktop server ALWAYS has an admin key configured (the
    // per-install secret), so the dev-open escape hatch the shared
    // descriptions mention does not exist on this surface (review
    // LOW-10: false affordance).
    strip_dev_mode_clauses(&mut spec);
    spec
}

/// Recursively drop the "; open in dev mode" / " (open in dev mode)"
/// clauses from every string in the document tree.
fn strip_dev_mode_clauses(value: &mut Value) {
    match value {
        Value::String(s) => {
            if s.contains("open in dev mode") {
                *s = s
                    .replace(" (open in dev mode)", "")
                    .replace("; open in dev mode", "");
            }
        }
        Value::Array(items) => {
            for item in items {
                strip_dev_mode_clauses(item);
            }
        }
        Value::Object(map) => {
            for v in map.values_mut() {
                strip_dev_mode_clauses(v);
            }
        }
        _ => {}
    }
}

/// Insert `x-oz-scope: <scope>` into every operation object under
/// `paths` (mutating in place). Path-item keys that are not HTTP
/// operations (`parameters`, `summary`, …) are skipped.
pub fn annotate_scope(paths: &mut Value, scope: &str) {
    let Some(items) = paths.as_object_mut() else {
        return;
    };
    for item in items.values_mut() {
        let Some(op_map) = item.as_object_mut() else {
            continue;
        };
        for (key, operation) in op_map.iter_mut() {
            if !is_operation_key(key) {
                continue;
            }
            if let Some(op) = operation.as_object_mut() {
                op.insert("x-oz-scope".to_string(), json!(scope));
            }
        }
    }
}

/// True for OpenAPI path-item operation keys (HTTP verbs).
pub fn is_operation_key(key: &str) -> bool {
    matches!(
        key,
        "get" | "put" | "post" | "delete" | "options" | "head" | "patch" | "trace"
    )
}

#[cfg(test)]
#[path = "spec_tests.rs"]
mod tests;
