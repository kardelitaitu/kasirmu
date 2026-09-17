//! OpenAPI 3.1 API documentation for the OZ-POS cloud server.
//!
//! The shared surface (`x-oz-scope: "both"`) lives in
//! `kasirmu_api::spec::base_spec()` — the single source of truth also served
//! by the desktop local API. This module merges the cloud-only paths
//! (`x-oz-scope: "cloud"`: host health/metrics, sync, webhooks, docs
//! UI) and cloud-only schemas on top, and provides the docs handlers:
//!
//! - `GET /api/openapi.json` — the merged OpenAPI 3.1 specification
//! - `GET /api/docs` — Swagger UI (loaded from CDN) pointing at the spec
//! - `GET /api/docs/scalar` — Scalar API Reference (modern, interactive docs)

mod cloud;

use axum::{Json, response::Html};
use cloud::{build_cloud_paths, build_cloud_schemas};
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
    let mut spec = kasirmu_api::spec::base_spec();
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
    kasirmu_api::spec::annotate_scope(&mut cloud_paths, kasirmu_api::spec::SCOPE_CLOUD);
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
