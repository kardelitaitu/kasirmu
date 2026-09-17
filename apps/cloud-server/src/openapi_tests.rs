use super::*;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use std::collections::{BTreeMap, BTreeSet};
use tower::ServiceExt;

fn test_app() -> axum::Router {
    use axum::routing::get;
    axum::Router::new()
        .route("/api/openapi.json", get(openapi_json_handler))
        .route("/api/docs", get(swagger_ui_handler))
        .route("/api/docs/scalar", get(scalar_ui_handler))
}

#[tokio::test]
async fn openapi_json_returns_200() {
    let app = test_app();
    let req = Request::builder()
        .uri("/api/openapi.json")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn openapi_json_has_required_fields() {
    let app = test_app();
    let req = Request::builder()
        .uri("/api/openapi.json")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    let body = resp.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["openapi"], "3.1.0");
    assert!(json["info"]["title"].is_string());
    assert!(json["info"]["version"].is_string());
    assert!(json["paths"].is_object());
    assert!(json["components"]["schemas"].is_object());
    assert!(json["components"]["securitySchemes"]["bearerAuth"].is_object());
}

#[tokio::test]
async fn openapi_json_documents_all_tag_groups() {
    let app = test_app();
    let req = Request::builder()
        .uri("/api/openapi.json")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    let body = resp.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    let tags: Vec<&str> = json["tags"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    assert!(tags.contains(&"Health"));
    assert!(tags.contains(&"Auth"));
    assert!(tags.contains(&"Products"));
    assert!(tags.contains(&"Categories"));
    assert!(tags.contains(&"Tax Rates"));
    assert!(tags.contains(&"Users"));
    assert!(tags.contains(&"Sales"));
    assert!(tags.contains(&"Sync"));
    assert!(tags.contains(&"Plans"));
    assert!(tags.contains(&"Terminals"));
    assert!(tags.contains(&"Webhooks"));
    // Future tag groups — reserved for planned features.
    assert!(tags.contains(&"Inventory"));
    assert!(tags.contains(&"Orders"));
    assert!(tags.contains(&"Reports"));
    assert!(tags.contains(&"Customers"));
    assert!(tags.contains(&"Notifications"));
    assert!(tags.contains(&"Analytics"));
    assert!(tags.contains(&"Images"));
}

#[tokio::test]
async fn openapi_json_documents_all_paths() {
    let app = test_app();
    let req = Request::builder()
        .uri("/api/openapi.json")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    let body = resp.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    let paths = json["paths"].as_object().unwrap();
    assert!(paths.contains_key("/health"), "missing /health");
    assert!(paths.contains_key("/api/health"), "missing /api/health");
    assert!(
        paths.contains_key("/api/v1/health"),
        "missing /api/v1/health"
    );
    assert!(paths.contains_key("/metrics"), "missing /metrics");
    assert!(paths.contains_key("/api/v1/tokens"), "missing tokens");
    assert!(paths.contains_key("/api/v1/products"), "missing products");
    assert!(
        paths.contains_key("/api/v1/products/{sku}"),
        "missing product by SKU"
    );
    assert!(
        paths.contains_key("/api/v1/products/{sku}/stock"),
        "missing stock adjustment"
    );
    assert!(
        paths.contains_key("/api/v1/tenants/me/plan"),
        "missing self plan read"
    );
    assert!(
        paths.contains_key("/api/v1/tenants/{tenant_id}/plan"),
        "missing plan set"
    );
    assert!(
        paths.contains_key("/api/v1/categories"),
        "missing categories"
    );
    assert!(paths.contains_key("/api/v1/tax-rates"), "missing tax rates");
    assert!(
        paths.contains_key("/api/v1/exchange-rates"),
        "missing exchange rates"
    );
    assert!(
        paths.contains_key("/api/v1/exchange-rates/latest"),
        "missing exchange rates latest listing"
    );
    assert!(
        paths.contains_key("/api/v1/exchange-rates/latest/{from}/{to}"),
        "missing exchange rates pair lookup"
    );
    assert!(
        paths.contains_key("/api/v1/exchange-rates/{id}"),
        "missing exchange rate delete"
    );
    assert!(paths.contains_key("/api/v1/users"), "missing users");
    assert!(paths.contains_key("/api/v1/sales"), "missing sales");
    assert!(
        paths.contains_key("/api/v1/sales/{id}"),
        "missing sale by ID"
    );
    assert!(
        paths.contains_key("/api/v1/sales/{id}/status"),
        "missing sale status update"
    );
    assert!(
        paths.contains_key("/api/v1/terminals"),
        "missing terminal registration"
    );
    assert!(
        paths.contains_key("/api/sync/status"),
        "missing sync status"
    );
    assert!(paths.contains_key("/api/sync/push"), "missing sync push");
    assert!(paths.contains_key("/api/sync/pull"), "missing sync pull");
    assert!(
        paths.contains_key("/api/webhooks/stripe"),
        "missing stripe webhook"
    );
    assert!(
        paths.contains_key("/api/webhooks/square"),
        "missing square webhook"
    );
    assert!(paths.contains_key("/api/v1/images"), "missing images");
    assert!(
        paths.contains_key("/api/v1/images:pack"),
        "missing images pack"
    );
    assert!(
        paths.contains_key("/api/v1/images:missing"),
        "missing images missing-set"
    );
    assert!(
        paths.contains_key("/api/v1/images/{hash16}"),
        "missing images by hash"
    );
    // Router→spec drift class (2026-09-03): these were live-but-undocumented.
    assert!(paths.contains_key("/api/v1/settings"), "missing settings");
    assert!(
        paths.contains_key("/api/sync/snapshot"),
        "missing sync snapshot"
    );
    assert!(
        paths.contains_key("/api/openapi.json"),
        "missing openapi.json self-documentation"
    );
    assert!(paths.contains_key("/api/docs"), "missing swagger docs page");
    assert!(
        paths.contains_key("/api/docs/scalar"),
        "missing scalar docs page"
    );
}

#[tokio::test]
async fn swagger_ui_returns_html() {
    let app = test_app();
    let req = Request::builder()
        .uri("/api/docs")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = resp.into_body().collect().await.unwrap().to_bytes();
    let html = String::from_utf8_lossy(&body);
    assert!(html.contains("<!DOCTYPE html>"));
    assert!(html.contains("swagger-ui"));
    assert!(html.contains("/api/openapi.json"));
}

#[tokio::test]
async fn scalar_ui_returns_html() {
    let app = test_app();
    let req = Request::builder()
        .uri("/api/docs/scalar")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = resp.into_body().collect().await.unwrap().to_bytes();
    let html = String::from_utf8_lossy(&body);
    assert!(html.contains("<!DOCTYPE html>"));
    assert!(html.contains("api-reference"));
    assert!(html.contains("/api/openapi.json"));
}

#[test]
fn openapi_spec_is_valid_json() {
    let spec = openapi_spec();
    // Verify it serializes without panicking
    let _json_str = serde_json::to_string_pretty(&spec).unwrap();
}

#[test]
fn security_scheme_has_bearer_auth() {
    let spec = openapi_spec();
    let security = &spec["components"]["securitySchemes"]["bearerAuth"];
    assert_eq!(security["type"], "http");
    assert_eq!(security["scheme"], "bearer");
    assert_eq!(security["bearerFormat"], "JWT");
}

#[test]
fn all_protected_routes_have_security() {
    let spec = openapi_spec();
    let paths = spec["paths"].as_object().unwrap();

    // Routes that should have bearerAuth security
    let protected_routes = [
        ("/api/v1/products", "get"),
        ("/api/v1/products", "post"),
        ("/api/v1/products/{sku}", "get"),
        ("/api/v1/products/{sku}/stock", "patch"),
        ("/api/v1/categories", "get"),
        ("/api/v1/tax-rates", "post"),
        ("/api/v1/exchange-rates", "get"),
        ("/api/v1/exchange-rates", "post"),
        ("/api/v1/exchange-rates/latest", "get"),
        ("/api/v1/exchange-rates/latest/{from}/{to}", "get"),
        ("/api/v1/exchange-rates/{id}", "delete"),
        ("/api/v1/users", "post"),
        ("/api/v1/sales", "post"),
        ("/api/v1/sales/{id}", "get"),
        ("/api/v1/sales/{id}/status", "patch"),
        ("/api/sync/status", "get"),
        ("/api/sync/push", "post"),
        ("/api/sync/pull", "post"),
        // Images (spec 0046b) — all operations require bearerAuth.
        ("/api/v1/images", "put"),
        ("/api/v1/images", "post"),
        ("/api/v1/images:pack", "get"),
        ("/api/v1/images:missing", "get"),
        ("/api/v1/images/{hash16}", "get"),
    ];

    for (path, method) in &protected_routes {
        let operation = &paths[*path][*method];
        let security = operation
            .get("security")
            .unwrap_or_else(|| panic!("{method} {path} must have security defined"));
        let has_bearer = security
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s.as_object().unwrap().contains_key("bearerAuth"));
        assert!(has_bearer, "{method} {path} must have bearerAuth security");
    }
}

#[test]
fn health_endpoints_have_no_security() {
    let spec = openapi_spec();
    let paths = spec["paths"].as_object().unwrap();

    for path in &["/health", "/api/health", "/api/v1/health", "/metrics"] {
        let operation = &paths[*path]["get"];
        assert!(
            operation.get("security").is_none()
                || operation
                    .get("security")
                    .unwrap()
                    .as_array()
                    .unwrap()
                    .is_empty(),
            "{path} should not require security"
        );
    }
}

// ── Drift guard (spec 0047 §3) — liveness probe ──────────────────────

/// Build a full router backed by an in-memory SQLite database, used by
/// the drift-guard liveness probe to confirm every documented path+method
/// resolves to a real route (≠ 404 ≠ 405).
fn test_full_router() -> axum::Router {
    let state = crate::CloudServerState {
        db: std::sync::Arc::new(tokio::sync::Mutex::new(kasirmu_core::migrations::fresh_db())),
        pg: None,
        started_at: std::time::Instant::now(),
        health_depth_cache: crate::HealthDepthCache::default(),
        stripe_webhook_secret: None,
        square_webhook_signature_key: None,
        square_webhook_url: None,
        midtrans_server_key: None,
        midtrans_sandbox: false,
        midtrans_qris_acquirer: None,
    };
    let config = crate::config::CloudServerConfig {
        db_path: ":memory:".into(),
        database_url: None,
        require_tls: false,
        db_pool_size: 20,
        apply_schema: true,
        port: 3099,
        admin_key: None,
        enforce_plans: false,
        production: false,
        log_format: crate::config::LogFormat::Plain,
        redirect_only: false,
        sync_redirect_url: None,
        stripe_webhook_secret: None,
        square_webhook_signature_key: None,
        square_webhook_url: None,
        midtrans_server_key: None,
        midtrans_sandbox: false,
        midtrans_qris_acquirer: None,
        api_secret: Some("test-secret".into()),
        redis_url: None,
    };
    crate::build_router(
        state,
        crate::rate_limit::RateLimiterState::new(),
        &config,
        None,
    )
}

/// Every (path, method) declared in the OpenAPI spec must resolve to a
/// real route in the merged router.  We fire a `tower::ServiceExt::oneshot`
/// request for each and assert the status is **not 404 and not 405**
/// (401 is a pass — it proves the route + method exist; auth is not this
/// test's job).  Catches renamed/removed/retyped endpoints.
#[tokio::test]
async fn every_spec_path_method_is_alive() {
    let spec = openapi_spec();
    let paths = spec["paths"].as_object().unwrap().clone();
    let router = test_full_router();
    let mut results = Vec::new();

    for (path_template, methods) in &paths {
        let methods_obj = methods.as_object().unwrap();
        for (method, _operation) in methods_obj {
            // Build a concrete URL from the path template.
            let url = concrete_url(path_template);
            // OpenAPI method keys are lowercase ("get"); HTTP methods are
            // case-sensitive and must be uppercase to match the router.
            let uppercase = method.to_uppercase();
            let http_method = axum::http::Method::from_bytes(uppercase.as_bytes())
                .expect("OpenAPI methods are standard HTTP verbs");
            let req = Request::builder()
                .method(http_method)
                .uri(&url)
                .body(Body::empty())
                .unwrap();
            let resp = router.clone().oneshot(req).await.unwrap();
            let status = resp.status();
            if status == StatusCode::NOT_FOUND || status == StatusCode::METHOD_NOT_ALLOWED {
                results.push(format!(
                    "[{method} {path_template}] ({url}) → {status} — route missing or method mismatch"
                ));
            }
        }
    }

    if !results.is_empty() {
        panic!(
            "Drift detected — {} spec-declared route(s) are not alive:\n{}",
            results.len(),
            results.join("\n")
        );
    }
}

/// Replace OpenAPI path parameters (`{param}`) with test values.
fn concrete_url(template: &str) -> String {
    template
        .replace("{sku}", "TEST-SKU")
        .replace("{id}", "00000000-0000-0000-0000-000000000000")
        .replace("{from}", "USD")
        .replace("{to}", "IDR")
        .replace("{tenant_id}", "tenant-a")
        .replace("{hash16}", "aaaaaaaaaaaaaaaa")
}

// ── Drift guard — router→spec coverage (reverse direction) ──────────

/// HTTP method verbs recognized inside a `.route()` method-router expr.
const ROUTE_VERBS: [&str; 8] = [
    "get", "post", "put", "patch", "delete", "head", "options", "trace",
];

/// Parse `.route("<path>", <expr>)` registrations out of the router
/// source files.
///
/// axum 0.8 removed `Router::into_iter()` — the introspection that
/// spec 0047's reverse walk assumed (its ground-truth table still claims
/// axum 0.7.9; the lockfile has since moved to 0.8.9, where `Router`
/// offers no enumeration API at all). The version-stable equivalent is a
/// compile-time source scan: `include_str!` every file that registers
/// routes on the merged cloud router and extract the literals. Any new
/// `.route()` registration missing from the OpenAPI spec turns
/// [`every_registered_route_is_documented`] red — the drift class that
/// let `/api/v1/settings` and `/api/sync/snapshot` go undocumented.
///
/// Known limitation: the scan is raw text, so a `.route("...")` literal
/// inside a comment is also picked up — a false positive that fails
/// loudly and is trivially reworded, the safe direction for a guard.
fn source_registered_routes() -> BTreeMap<String, BTreeSet<String>> {
    let sources: &[&str] = &[
        include_str!("../../../crates/kasirmu-api/src/lib.rs"),
        include_str!("main.rs"),
        include_str!("sync_api.rs"),
        include_str!("webhooks.rs"),
        include_str!("outbound_webhooks.rs"),
        include_str!("payment_api.rs"),
    ];
    let mut routes: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for &src in sources {
        let mut from = 0usize;
        while let Some(rel) = src[from..].find(".route(") {
            let mut pos = from + rel + ".route(".len();
            from = pos; // continuation default if this site does not parse
            // first argument: whitespace, then a plain string literal
            let Some((path, after)) = read_str_lit(src, pos) else {
                continue;
            };
            pos = after;
            // comma separating the two args
            let Some(comma) = src[pos..].find(',') else {
                continue;
            };
            pos += comma + 1;
            // method-router expr runs to the `)` closing `.route(`
            let Some(expr_end) = match_paren(src, pos) else {
                continue;
            };
            let expr = &src[pos..expr_end];
            from = expr_end + 1;
            let methods = routes.entry(path).or_default();
            for verb in ROUTE_VERBS {
                if contains_verb_call(expr, verb) {
                    methods.insert(verb.to_owned());
                }
            }
            // `any(...)` registers every verb
            if contains_verb_call(expr, "any") {
                for verb in ROUTE_VERBS {
                    methods.insert(verb.to_owned());
                }
            }
        }
    }
    routes
}

/// Read a `"`-delimited literal (no escapes expected in route paths)
/// starting at or after `pos`. Returns the value and the index after the
/// closing quote.
fn read_str_lit(src: &str, pos: usize) -> Option<(String, usize)> {
    let bytes = src.as_bytes();
    let mut i = pos;
    while i < bytes.len() && bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    if bytes.get(i) != Some(&b'"') {
        return None;
    }
    i += 1;
    let start = i;
    while i < bytes.len() && bytes[i] != b'"' {
        if bytes[i] == b'\\' {
            return None; // escaped literals are not expected here
        }
        i += 1;
    }
    if i >= bytes.len() {
        return None;
    }
    Some((src[start..i].to_owned(), i + 1))
}

/// Given an index inside `.route(`'s argument list (one paren already
/// open), find the byte index of the `)` that closes it.
fn match_paren(src: &str, from: usize) -> Option<usize> {
    let bytes = src.as_bytes();
    let mut depth = 1usize;
    let mut in_str = false;
    let mut i = from;
    while i < bytes.len() {
        match bytes[i] {
            b'"' => in_str = !in_str,
            b'(' if !in_str => depth += 1,
            b')' if !in_str => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

/// True if `expr` contains `<verb>(` with a word boundary before it
/// (so `get_settings_handler` never matches `get`).
fn contains_verb_call(expr: &str, verb: &str) -> bool {
    let mut from = 0usize;
    while let Some(rel) = expr[from..].find(verb) {
        let at = from + rel;
        let before_ok = at == 0
            || !matches!(
                expr.as_bytes()[at - 1],
                b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_'
            );
        if before_ok && expr[at + verb.len()..].starts_with('(') {
            return true;
        }
        from = at + verb.len();
    }
    false
}

/// Reverse direction of [`every_spec_path_method_is_alive`]: the route
/// set registered in the router sources and the path set documented in
/// the spec must be EQUAL — both paths and per-path methods. Historically
/// the guard was one-directional and `/api/v1/settings` +
/// `/api/sync/snapshot` drifted live-but-undocumented (found 2026-09-03
/// while writing `docs/guides/EXTENDING.md`); this test closes that
/// class. Set equality (not just containment) also self-verifies the
/// source parser: a path the scan silently misses breaks the equality
/// from the spec side, so a broken parser cannot pass vacuously.
#[test]
fn every_registered_route_is_documented() {
    let spec = openapi_spec();
    let paths = spec["paths"].as_object().unwrap();

    let registered = source_registered_routes();
    // Sanity floor: the merged cloud router registers 35 paths today; a
    // wholesale parser failure must fail loudly even before the walk.
    assert!(
        registered.len() >= 30,
        "source scan found only {} registered paths — parser broken?",
        registered.len()
    );

    let spec_paths: BTreeSet<&String> = paths.keys().collect();
    let registered_paths: BTreeSet<&String> = registered.keys().collect();

    let mut violations = Vec::new();
    for path in registered_paths.difference(&spec_paths) {
        violations.push(format!(
            "{path} is registered in the router sources but missing from the spec"
        ));
    }
    for path in spec_paths.difference(&registered_paths) {
        violations.push(format!(
            "{path} is declared in the spec but registered in no scanned router source \
             (new route file? add it to source_registered_routes, or remove the path)"
        ));
    }

    // Method level: registered verbs must equal declared verbs.
    for (path, methods) in &registered {
        let Some(entry) = paths.get(path.as_str()) else {
            continue; // path-level violation already recorded above
        };
        let declared: BTreeSet<String> = ROUTE_VERBS
            .iter()
            .filter(|v| entry.get(**v).is_some())
            .map(|v| (*v).to_string())
            .collect();
        for verb in methods.difference(&declared) {
            violations.push(format!("{verb} {path} is registered but not documented"));
        }
        for verb in declared.difference(methods) {
            violations.push(format!(
                "{verb} {path} is documented but not registered in the scanned sources"
            ));
        }
    }

    assert!(
        violations.is_empty(),
        "Router↔spec drift — {} violation(s):\n{}",
        violations.len(),
        violations.join("\n")
    );
}

/// Every operation in the spec must declare `security: [{bearerAuth: []}]`
/// unless the path is on the explicit public allowlist.  A new endpoint
/// silently missing the security block becomes a red test (spec 0047 §3
/// assertion 3 — the mechanical audit-stamp guard).
#[test]
fn security_coverage_walk_every_operation() {
    let spec = openapi_spec();
    let paths = spec["paths"].as_object().unwrap();

    /// Paths that are intentionally public (no bearerAuth).  Everything
    /// else must carry bearerAuth.
    fn is_public(path: &str) -> bool {
        path == "/health"
            || path == "/api/health"
            || path == "/api/v1/health"
            || path == "/metrics"
            || path == "/api/openapi.json"
            || path == "/api/docs"
            || path == "/api/docs/scalar"
            || path == "/api/v1/tokens" // mints tokens — cannot require one
            // Admin-key gated (X-Admin-Key header), not JWT — so no
            // bearerAuth; they are public in the JWT sense.
            || path == "/api/v1/terminals"
            || path == "/api/v1/tenants/{tenant_id}/plan"
            || path == "/api/v1/settings"
            || path == "/api/webhooks"
            || path.starts_with("/api/webhooks/")
    }

    let mut violations = Vec::new();
    for (path, methods) in paths {
        for (method, operation) in methods.as_object().unwrap() {
            let has_bearer = operation
                .get("security")
                .and_then(|s| s.as_array())
                .is_some_and(|arr| {
                    arr.iter().any(|entry| {
                        entry
                            .as_object()
                            .is_some_and(|m| m.contains_key("bearerAuth"))
                    })
                });
            if is_public(path) {
                // Public endpoints must NOT require auth.
                if has_bearer {
                    violations.push(format!("{method} {path} is public but declares bearerAuth"));
                }
            } else if !has_bearer {
                violations.push(format!("{method} {path} is missing bearerAuth security"));
            }
        }
    }

    assert!(
        violations.is_empty(),
        "Security-coverage drift — {} violation(s):\n{}",
        violations.len(),
        violations.join("\n")
    );
}

// ── Scope tagging (x-oz-scope) ───────────────────────────────────────

/// Every operation in the merged document must carry `x-oz-scope`, and
/// the scope must match the path family: the shared `/api/v1/*` surface
/// and the self-documenting `/api/openapi.json` are `"both"`; host
/// health/metrics, sync, payments, webhooks, and the docs UI pages are
/// `"cloud"`.
/// This is the contract scripts use to decide whether an endpoint
/// exists on their desktop local API.
#[test]
fn every_operation_carries_correct_scope() {
    let spec = openapi_spec();
    let paths = spec["paths"].as_object().unwrap();

    fn expected_scope(path: &str) -> &'static str {
        if path.starts_with("/api/sync/")
            || path.starts_with("/api/payment/")
            || path == "/api/webhooks"
            || path.starts_with("/api/webhooks/")
            || path == "/health"
            || path == "/api/health"
            || path == "/metrics"
            || path == "/api/docs"
            || path == "/api/docs/scalar"
        {
            "cloud"
        } else {
            "both"
        }
    }

    let mut violations = Vec::new();
    let mut seen = 0usize;
    for (path, item) in paths {
        for (verb, operation) in item.as_object().unwrap() {
            if !kasirmu_api::spec::is_operation_key(verb) {
                continue;
            }
            seen += 1;
            let want = expected_scope(path);
            let got = operation.get("x-oz-scope").and_then(|v| v.as_str());
            if got != Some(want) {
                violations.push(format!(
                    "{verb} {path}: x-oz-scope={got:?}, expected \"{want}\""
                ));
            }
        }
    }
    assert!(seen >= 35, "only {seen} operations walked — broken?");
    assert!(
        violations.is_empty(),
        "Scope drift — {} violation(s):\n{}",
        violations.len(),
        violations.join("\n")
    );
}

/// The merged document must not lose schemas the cloud paths reference —
/// guards the base/cloud schema split against accidental deletion.
#[test]
fn every_merged_ref_resolves() {
    fn collect(v: &Value, out: &mut Vec<String>) {
        match v {
            Value::Object(map) => {
                for c in map.values() {
                    collect(c, out);
                }
            }
            Value::Array(arr) => {
                for c in arr {
                    collect(c, out);
                }
            }
            Value::String(s) if s.starts_with("#/components/") => {
                out.push(s.clone());
            }
            _ => {}
        }
    }
    let spec = openapi_spec();
    let mut refs = Vec::new();
    collect(&spec, &mut refs);
    assert!(!refs.is_empty());
    for pointer in &refs {
        let mut cur = &spec;
        for seg in pointer.trim_start_matches("#/").split('/') {
            cur = cur
                .get(seg)
                .unwrap_or_else(|| panic!("dangling $ref {pointer} in merged spec"));
        }
    }
}

// ── Drift-guard assertion 4 (spec 0047 §3) — READ_KEY_MAP coverage ──
/// Every protected GET operation in the spec must have a corresponding
/// entry in `kasirmu_api::read_tiers::READ_KEY_MAP`.  Public/health/docs and
/// sync routes are excluded (they keep their own gating).
#[test]
fn every_spec_get_operation_has_read_key_entry() {
    let spec = openapi_spec();
    let paths = spec["paths"].as_object().unwrap();

    let mut missing = Vec::new();

    for (path, methods) in paths {
        for (method, operation) in methods.as_object().unwrap() {
            // Non-GET methods are not in the read-key map.
            if *method != "get" {
                continue;
            }
            // Public routes (no bearerAuth) are excluded from the map.
            let has_bearer = operation
                .get("security")
                .and_then(|s| s.as_array())
                .is_some_and(|arr| {
                    arr.iter().any(|entry| {
                        entry
                            .as_object()
                            .is_some_and(|m| m.contains_key("bearerAuth"))
                    })
                });
            if !has_bearer {
                continue;
            }
            // Sync routes keep their existing gating (spec 0047 §4 F3) —
            // they are excluded from the read-key map. The memo active read
            // keeps its own too: it is a device-facing poll whose audience
            // is already terminal-scoped by the recipient join and the
            // token's claims, with no read-tier key in the registry.
            // The QRIS status poll joins that family for the same reason: the
            // caller is the checkout device itself, its authority is the
            // tenant-scoped JWT claim (and a foreign order answers 404), and no
            // registry key fits — minting a "payments:read" just to pass this
            // gate would widen every terminal token for an endpoint terminals
            // alone call.
            if path.starts_with("/api/sync/")
                || path == "/api/v1/memos/active"
                || path.starts_with("/api/payment/")
            {
                continue;
            }

            // Check if READ_KEY_MAP has an entry for this (method, path).
            let in_map = kasirmu_api::read_tiers::READ_KEY_MAP
                .iter()
                .any(|e| e.method == "GET" && e.path == path.as_str());
            if !in_map {
                missing.push(format!("GET {path}"));
            }
        }
    }

    assert!(
        missing.is_empty(),
        "Drift detected — {} GET operation(s) in the spec have no READ_KEY_MAP entry:\n{}",
        missing.len(),
        missing.join("\n")
    );
}

// ── Drift-guard assertion 5 — the document vs the type that writes it ──
//
// The push-outcome schema used to describe an EXTERNALLY tagged enum (a bare
// "Accepted" string, a {"Conflict": ...} wrapper) while the Rust type that
// actually writes the response body, platform_sync::transport::PushOutcome,
// has always been INTERNALLY tagged (#[serde(tag = "outcome",
// rename_all = "snake_case")]). Rust-to-Rust agreement meant nothing caught
// it: the sync client and the server share the type, so only a third-party
// client written from the published contract was broken. Everything below
// derives its expectation from the TYPE — variants are constructed in Rust and
// handed to serde_json::to_value — so flipping the tag attribute, rename_all,
// or the tagging style fails this test instead of quietly rotting the contract.

// Resolve a "#/..." pointer against the merged document.
fn resolve_ref<'a>(spec: &'a Value, pointer: &str) -> &'a Value {
    let mut cur = spec;
    for seg in pointer.trim_start_matches("#/").split('/') {
        cur = cur
            .get(seg)
            .unwrap_or_else(|| panic!("dangling $ref {pointer}"));
    }
    cur
}

// Field names a schema node documents, following $ref and allOf composition.
fn documented_fields(spec: &Value, schema: &Value, out: &mut BTreeSet<String>) {
    if let Some(pointer) = schema.get("$ref").and_then(Value::as_str) {
        documented_fields(spec, resolve_ref(spec, pointer), out);
    }
    if let Some(props) = schema.get("properties").and_then(Value::as_object) {
        out.extend(props.keys().cloned());
    }
    if let Some(members) = schema.get("allOf").and_then(Value::as_array) {
        for member in members {
            documented_fields(spec, member, out);
        }
    }
}

// Field names a schema node requires, following $ref and allOf composition.
fn documented_required(spec: &Value, schema: &Value, out: &mut BTreeSet<String>) {
    if let Some(pointer) = schema.get("$ref").and_then(Value::as_str) {
        documented_required(spec, resolve_ref(spec, pointer), out);
    }
    if let Some(req) = schema.get("required").and_then(Value::as_array) {
        out.extend(req.iter().filter_map(Value::as_str).map(str::to_string));
    }
    if let Some(members) = schema.get("allOf").and_then(Value::as_array) {
        for member in members {
            documented_required(spec, member, out);
        }
    }
}

// Discriminator values a schema node documents on its "outcome" member.
fn documented_tags(spec: &Value, schema: &Value, out: &mut BTreeSet<String>) {
    if let Some(pointer) = schema.get("$ref").and_then(Value::as_str) {
        documented_tags(spec, resolve_ref(spec, pointer), out);
    }
    if let Some(members) = schema.get("allOf").and_then(Value::as_array) {
        for member in members {
            documented_tags(spec, member, out);
        }
    }
    let outcome = schema.get("properties").and_then(|p| p.get("outcome"));
    if let Some(allowed) = outcome
        .and_then(|o| o.get("enum"))
        .and_then(Value::as_array)
    {
        out.extend(allowed.iter().filter_map(Value::as_str).map(str::to_string));
    }
    if let Some(fixed) = outcome.and_then(|o| o.get("const")).and_then(Value::as_str) {
        out.insert(fixed.to_string());
    }
}

fn type_matches(kind: &str, value: &Value) -> bool {
    match kind {
        "object" => value.is_object(),
        "array" => value.is_array(),
        "string" => value.is_string(),
        "boolean" => value.is_boolean(),
        "null" => value.is_null(),
        "integer" => value.is_i64() || value.is_u64(),
        "number" => value.is_number(),
        _ => true,
    }
}

// Validate a value against the JSON-Schema subset this document uses: $ref,
// allOf, oneOf, type, enum, const, required, properties, items and
// additionalProperties:false. Deliberately test-local — what is pinned here is
// that a real serde output satisfies the published schema keyword by keyword,
// not that this repo ships a draft-2020-12 validator.
fn validates(spec: &Value, schema: &Value, value: &Value) -> bool {
    if let Some(pointer) = schema.get("$ref").and_then(Value::as_str)
        && !validates(spec, resolve_ref(spec, pointer), value)
    {
        return false;
    }
    if let Some(members) = schema.get("allOf").and_then(Value::as_array)
        && !members.iter().all(|m| validates(spec, m, value))
    {
        return false;
    }
    if let Some(members) = schema.get("oneOf").and_then(Value::as_array)
        && members.iter().filter(|m| validates(spec, m, value)).count() != 1
    {
        return false;
    }
    match schema.get("type") {
        Some(Value::String(kind)) if !type_matches(kind, value) => return false,
        Some(Value::Array(kinds))
            if !kinds
                .iter()
                .filter_map(Value::as_str)
                .any(|kind| type_matches(kind, value)) =>
        {
            return false;
        }
        _ => {}
    }
    if let Some(allowed) = schema.get("enum").and_then(Value::as_array)
        && !allowed.contains(value)
    {
        return false;
    }
    if let Some(fixed) = schema.get("const")
        && fixed != value
    {
        return false;
    }
    if let (Some(obj), Some(req)) = (
        value.as_object(),
        schema.get("required").and_then(Value::as_array),
    ) && !req
        .iter()
        .all(|k| k.as_str().is_some_and(|k| obj.contains_key(k)))
    {
        return false;
    }
    let props = schema.get("properties").and_then(Value::as_object);
    if let Some(obj) = value.as_object() {
        for (key, member) in obj {
            if let Some(s) = props.and_then(|p| p.get(key))
                && !validates(spec, s, member)
            {
                return false;
            }
        }
        if schema.get("additionalProperties").and_then(Value::as_bool) == Some(false)
            && obj.keys().any(|k| props.is_none_or(|p| !p.contains_key(k)))
        {
            return false;
        }
    }
    if let Some(items) = schema.get("items").and_then(Value::as_object)
        && let Some(arr) = value.as_array()
    {
        let items = Value::Object(items.clone());
        if !arr.iter().all(|e| validates(spec, &items, e)) {
            return false;
        }
    }
    true
}

#[test]
fn push_outcome_documented_schema_matches_serde_wire_shape() {
    use kasirmu_core::offline::OfflineQueueItem;
    use platform_sync::transport::{PushOutcome, PushResponse};

    let spec = openapi_spec();
    let doc = &spec["components"]["schemas"]["PushOutcome"];
    let branches = doc["oneOf"].as_array().unwrap_or_else(|| {
        panic!("PushOutcome must be documented as a oneOf of per-variant branches")
    });

    // Expectations come from the type, never from a typed-out shape: build the
    // real variants, let serde write them, and read the wire shape back.
    let outcomes: Vec<(&str, PushOutcome)> = vec![
        ("Accepted", PushOutcome::Accepted),
        (
            "Conflict",
            PushOutcome::Conflict(OfflineQueueItem::new("void_sale", "{}")),
        ),
        (
            "Rejected",
            PushOutcome::Rejected {
                reason: "duplicate id: 0190a4b2".into(),
            },
        ),
    ];
    let samples: Vec<(&str, Value)> = outcomes
        .iter()
        .map(|(name, o)| (*name, serde_json::to_value(o).unwrap()))
        .collect();

    let mut exercised = vec![false; branches.len()];
    for (name, value) in &samples {
        assert!(
            value.is_object(),
            "variant {name} must serialise as an object carrying the tag, got {value}"
        );
        let hits: Vec<usize> = branches
            .iter()
            .enumerate()
            .filter(|(_, branch)| validates(&spec, branch, value))
            .map(|(i, _)| i)
            .collect();
        assert_eq!(
            hits.len(),
            1,
            "variant {name} serialises to {value}; exactly one documented PushOutcome branch \
             must accept it, {hits:?} did (0 = the document describes a different representation, \
             more than 1 = the branches no longer discriminate)"
        );
        exercised[hits[0]] = true;
        let branch = &branches[hits[0]];

        let actual: BTreeSet<String> = value.as_object().unwrap().keys().cloned().collect();
        let mut fields = BTreeSet::new();
        documented_fields(&spec, branch, &mut fields);
        assert_eq!(
            fields, actual,
            "the branch that accepts {name} documents fields {fields:?} but serde emits              {actual:?} — the document and the type have drifted apart"
        );

        let mut required = BTreeSet::new();
        documented_required(&spec, branch, &mut required);
        assert!(
            required.contains("outcome"),
            "the branch accepting {name} must require the outcome discriminator"
        );
        let phantom: Vec<&String> = required.difference(&actual).collect();
        assert!(
            phantom.is_empty(),
            "the branch accepting {name} requires fields serde never emits: {phantom:?}"
        );
    }

    for (i, hit) in exercised.iter().enumerate() {
        assert!(
            *hit,
            "documented PushOutcome branch #{i} matches no value the real enum produces — a \
             stale branch is as much a lie as a missing one"
        );
    }

    let wire_tags: BTreeSet<String> = samples
        .iter()
        .filter_map(|(_, v)| v.get("outcome").and_then(Value::as_str))
        .map(str::to_string)
        .collect();
    let mut doc_tags = BTreeSet::new();
    for branch in branches {
        documented_tags(&spec, branch, &mut doc_tags);
    }
    assert_eq!(
        doc_tags, wire_tags,
        "documented discriminators {doc_tags:?} disagree with the tags serde puts on the wire \
         {wire_tags:?} — fix the document, never #[serde(tag, rename_all)], to satisfy this test"
    );
    assert_eq!(
        wire_tags.len(),
        outcomes.len(),
        "every variant must carry its own discriminator value on the wire"
    );

    // The representation this document used to publish must now be REJECTED,
    // not merely unmentioned: that shape is what a third-party client was
    // generated from and could never parse against a real response.
    let stale = vec![
        json!("Accepted"),
        json!({ "Conflict": serde_json::to_value(OfflineQueueItem::new("void_sale", "{}")).unwrap() }),
        json!({ "Rejected": { "reason": "duplicate id" } }),
    ];
    for value in &stale {
        assert!(
            !validates(&spec, doc, value),
            "the document still accepts the externally tagged shape {value}"
        );
    }

    // The envelope too: a whole PushResponse, taken from the type.
    let response = serde_json::to_value(PushResponse {
        results: outcomes.iter().map(|(_, o)| o.clone()).collect(),
    })
    .unwrap();
    let resp_doc = &spec["components"]["schemas"]["PushResponse"];
    assert!(
        validates(&spec, resp_doc, &response),
        "a real PushResponse does not validate against the published schema: {response}"
    );
    let mut resp_fields = BTreeSet::new();
    documented_fields(&spec, resp_doc, &mut resp_fields);
    let actual_resp: BTreeSet<String> = response.as_object().unwrap().keys().cloned().collect();
    assert_eq!(
        resp_fields, actual_resp,
        "PushResponse documents {resp_fields:?} but serde emits {actual_resp:?}"
    );

    println!("documented PushOutcome  = {doc}");
    for (name, value) in &samples {
        println!("real     PushOutcome  = {name}: {value}");
    }
    println!("documented PushResponse = {resp_doc}");
    println!("real     PushResponse   = {response}");
}
