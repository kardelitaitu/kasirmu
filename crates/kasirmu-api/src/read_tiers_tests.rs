use super::*;
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
    middleware,
    routing::get,
};
use tower::ServiceExt;

// ── Preset resolution ───────────────────────────────────────────────

#[test]
fn resolve_preset_terminal_binds_read_keys() {
    let keys = resolve_preset("terminal").unwrap();
    assert!(keys.contains(&"products:read"));
    assert!(keys.contains(&"categories:read"));
    assert!(keys.contains(&"reference:read"));
    assert!(keys.contains(&"plan:read"));
    // Terminal preset must never carry PII-scoped keys.
    assert!(!keys.contains(&"sales:view"));
    assert!(!keys.contains(&"staff:read"));
}

#[test]
fn resolve_preset_dashboard_excludes_pii_routes() {
    let keys = resolve_preset("dashboard").unwrap();
    assert!(keys.contains(&"products:read"));
    assert!(keys.contains(&"reports:view"));
    assert!(keys.contains(&"analytics:view"));
    // Dashboard is derived by excluding pii-marked routes (decision 3):
    // sales:view gates the pii-flagged /api/v1/sales/{id} route.
    assert!(!keys.contains(&"sales:view"));
}

#[test]
fn resolve_preset_audit_has_audit_and_reports() {
    let keys = resolve_preset("audit").unwrap();
    assert!(keys.contains(&"audit:view"));
    assert!(keys.contains(&"reports:view"));
}

#[test]
fn resolve_preset_unknown_returns_none() {
    assert!(resolve_preset("superuser").is_none());
    assert!(resolve_preset("").is_none());
}

// ── Key validation ──────────────────────────────────────────────────

#[test]
fn validate_keys_accepts_registered_keys() {
    let keys = vec!["products:read".to_string(), "sales:view".to_string()];
    assert!(validate_keys(&keys).is_ok());
}

#[test]
fn validate_keys_rejects_unknown_keys() {
    let keys = vec!["products:read".to_string(), "not:a_key".to_string()];
    let err = validate_keys(&keys).unwrap_err();
    assert_eq!(err, vec!["not:a_key".to_string()]);
}

#[test]
fn validate_keys_accepts_new_read_tier_keys() {
    // reference:read / plan:read / categories:read were added for 0047.
    let keys = vec![
        "reference:read".to_string(),
        "plan:read".to_string(),
        "categories:read".to_string(),
    ];
    assert!(validate_keys(&keys).is_ok());
}

// ── Path matching ───────────────────────────────────────────────────

#[test]
fn path_matches_concrete_route() {
    assert!(path_matches("/api/v1/products", "/api/v1/products"));
    assert!(path_matches(
        "/api/v1/products/{sku}",
        "/api/v1/products/BEV-01"
    ));
    assert!(path_matches(
        "/api/v1/exchange-rates/latest/{from}/{to}",
        "/api/v1/exchange-rates/latest/USD/IDR"
    ));
    assert!(path_matches("/api/v1/images:pack", "/api/v1/images:pack"));
    assert!(path_matches(
        "/api/v1/images/{hash16}",
        "/api/v1/images/aaaaaaaaaaaaaaaa"
    ));
}

#[test]
fn path_matches_rejects_wrong_segments() {
    assert!(!path_matches("/api/v1/products", "/api/v1/categories"));
    assert!(!path_matches(
        "/api/v1/products/{sku}",
        "/api/v1/products/BEV-01/extra"
    ));
    assert!(!path_matches(
        "/api/v1/products/{sku}",
        "/api/v1/categories/BEV-01"
    ));
}

// ── Read-gate middleware ────────────────────────────────────────────

/// Build a tiny router exercising the read gate directly.
fn gate_app() -> Router {
    async fn ok_handler() -> StatusCode {
        StatusCode::OK
    }
    let handler = get(ok_handler);
    Router::new()
        .route("/api/v1/products", handler.clone())
        .route("/api/v1/products/{sku}", handler.clone())
        .route("/api/v1/sales/{id}", handler.clone())
        .route("/api/sync/status", handler) // not in map → always passes
        .layer(middleware::from_fn(read_gate_middleware))
}

fn claims(permissions: Option<Vec<String>>) -> ApiTokenClaims {
    ApiTokenClaims {
        sub: "test".into(),
        jti: "jti-1".into(),
        exp: 9_999_999_999,
        iat: 1_700_000_000,
        tenant_id: Some("tenant-a".into()),
        terminal_id: None,
        permissions,
    }
}

fn req_with_claims(uri: &str, claims: ApiTokenClaims) -> Request<Body> {
    let mut req = Request::builder().uri(uri).body(Body::empty()).unwrap();
    req.extensions_mut().insert(claims);
    req
}

#[tokio::test]
async fn gate_passes_legacy_token_without_permissions() {
    let app = gate_app();
    let resp = app
        .clone()
        .oneshot(req_with_claims("/api/v1/products", claims(None)))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn gate_passes_with_matching_permission() {
    let app = gate_app();
    let resp = app
        .clone()
        .oneshot(req_with_claims(
            "/api/v1/products",
            claims(Some(vec!["products:read".into()])),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn gate_denies_without_matching_permission() {
    let app = gate_app();
    let resp = app
        .clone()
        .oneshot(req_with_claims(
            "/api/v1/sales/00000000-0000-0000-0000-000000000000",
            claims(Some(vec!["products:read".into()])),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    let body = axum::body::to_bytes(resp.into_body(), 1024).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "insufficient_scope");
}

#[tokio::test]
async fn gate_passes_route_not_in_map() {
    let app = gate_app();
    let resp = app
        .clone()
        .oneshot(req_with_claims(
            "/api/sync/status",
            claims(Some(vec!["products:read".into()])),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn gate_uses_has_permission_wildcards() {
    // products:* grants products:read through the registry resolver.
    let app = gate_app();
    let resp = app
        .clone()
        .oneshot(req_with_claims(
            "/api/v1/products",
            claims(Some(vec!["products:*".into()])),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

// ── PII invariant (spec 0047 decision 3) ────────────────────────────

#[test]
fn dashboard_preset_disjoint_from_pii_routes() {
    // Every key the dashboard preset carries must gate only non-PII routes.
    let dashboard: Vec<&str> = DASHBOARD_PRESET.to_vec();
    for entry in READ_KEY_MAP {
        if entry.pii {
            assert!(
                !dashboard.contains(&entry.key),
                "dashboard preset leaks into PII route {} ({})",
                entry.path,
                entry.key
            );
        }
    }
}

#[test]
fn read_key_map_covers_all_protected_get_routes() {
    // API-B: this test used to assert against a HAND-TYPED list of paths, so
    // adding a route to the router without adding it to READ_KEY_MAP changed
    // nothing and the suite stayed green — which is how GET /api/v1/memos/active
    // came to be unmapped while the gate passed it through unchecked. It now
    // reads the ROUTER SOURCE and derives the route set from it.
    //
    // Parsing source is the available option: axum does not expose route
    // enumeration on `Router`. The parse is deliberately dumb (find `.route(`,
    // take the quoted path, look for a `get(` in the same call) and its failure
    // mode is a MISSED route, not a false alarm — so it can only under-report,
    // never wrongly fail.
    let src = include_str!("lib.rs");

    // Routes that are intentionally NOT in READ_KEY_MAP: public (no auth), or
    // GET-with-no-read-key because the handler does its own gate.
    let exempt: &[&str] = &[
        "/api/v1/health",       // public
        "/api/v1/settings",     // admin-key gated in the handler
        "/api/openapi.json",    // public document
        "/api/v1/terminals",    // POST-only registration
        "/api/v1/tokens",       // POST-only mint
    ];

    let mut get_routes: Vec<String> = Vec::new();
    for chunk in src.split(".route(").skip(1) {
        // The path is the first quoted literal in the call.
        let Some(open) = chunk.find('"') else { continue };
        let rest = &chunk[open + 1..];
        let Some(close) = rest.find('"') else { continue };
        let path = &rest[..close];
        // Only GET routes are read-gated. The call's own text runs to the next
        // `.route(` boundary; look for a `get(` there.
        if chunk.contains("get(") {
            get_routes.push(path.to_string());
        }
    }

    assert!(
        get_routes.len() >= 10,
        "the router parse found only {} GET routes — the parse itself broke,          so this test would pass vacuously: {get_routes:?}",
        get_routes.len()
    );

    let mut missing: Vec<&String> = Vec::new();
    for path in &get_routes {
        if exempt.contains(&path.as_str()) {
            continue;
        }
        if !READ_KEY_MAP.iter().any(|e| e.path == path) {
            missing.push(path);
        }
    }

    assert!(
        missing.is_empty(),
        "READ_KEY_MAP is missing GET route(s) that the router registers, so the \
         read gate would pass them through unchecked (API-A): {missing:?}. Add a \
         ReadKeyEntry for each, or add it to the `exempt` list with a reason."
    );
}

// ── Tier matrix (spec 0047 F3) ──────────────────────────────────────

/// Register every READ_KEY_MAP path on a probe router.
fn matrix_app() -> Router {
    async fn ok_handler() -> StatusCode {
        StatusCode::OK
    }
    let handler = get(ok_handler);
    let mut router = Router::new();
    for entry in READ_KEY_MAP {
        router = router.route(entry.path, handler.clone());
    }
    router.layer(middleware::from_fn(read_gate_middleware))
}

/// Concrete URL for a READ_KEY_MAP path template.
fn concrete_url(template: &str) -> String {
    template
        .replace("{sku}", "TEST-SKU")
        .replace("{id}", "00000000-0000-0000-0000-000000000000")
        .replace("{from}", "USD")
        .replace("{to}", "IDR")
        .replace("{hash16}", "aaaaaaaaaaaaaaaa")
}

/// Expected grant for a preset across the map:
/// `(path, granted)` where granted = has_permission(preset_keys, key).
fn preset_matrix(preset: &[&str]) -> Vec<(&'static str, bool)> {
    READ_KEY_MAP
        .iter()
        .map(|e| {
            let owned: Vec<String> = preset.iter().map(|k| k.to_string()).collect();
            (e.path, kasirmu_core::has_permission(&owned, e.key))
        })
        .collect()
}

#[tokio::test]
async fn tier_matrix_terminal_preset_grants_only_read_keys() {
    let app = matrix_app();
    let matrix = preset_matrix(TERMINAL_PRESET);

    // Sanity: the terminal preset must reach products/categories/reference
    // reads but never sales (PII-scoped).
    let granted: Vec<&str> = matrix.iter().filter(|(_, g)| *g).map(|(p, _)| *p).collect();
    assert!(granted.contains(&"/api/v1/products"));
    assert!(granted.contains(&"/api/v1/categories"));
    assert!(granted.contains(&"/api/v1/tenants/me/plan"));
    assert!(!granted.contains(&"/api/v1/sales/{id}"));

    for (template, expected) in &matrix {
        let resp = app
            .clone()
            .oneshot(req_with_claims(
                &concrete_url(template),
                claims(Some(
                    TERMINAL_PRESET.iter().map(|k| k.to_string()).collect(),
                )),
            ))
            .await
            .unwrap();
        let expected_status = if *expected {
            StatusCode::OK
        } else {
            StatusCode::FORBIDDEN
        };
        assert_eq!(
            resp.status(),
            expected_status,
            "terminal preset on {template}"
        );
    }
}

#[tokio::test]
async fn tier_matrix_dashboard_preset_never_reaches_pii() {
    let app = matrix_app();
    let matrix = preset_matrix(DASHBOARD_PRESET);
    for (template, expected) in &matrix {
        let resp = app
            .clone()
            .oneshot(req_with_claims(
                &concrete_url(template),
                claims(Some(
                    DASHBOARD_PRESET.iter().map(|k| k.to_string()).collect(),
                )),
            ))
            .await
            .unwrap();
        let expected_status = if *expected {
            StatusCode::OK
        } else {
            StatusCode::FORBIDDEN
        };
        assert_eq!(
            resp.status(),
            expected_status,
            "dashboard preset on {template}"
        );
    }
    // The PII route must be denied for the dashboard preset.
    let pii_resp = app
        .oneshot(req_with_claims(
            &concrete_url("/api/v1/sales/{id}"),
            claims(Some(
                DASHBOARD_PRESET.iter().map(|k| k.to_string()).collect(),
            )),
        ))
        .await
        .unwrap();
    assert_eq!(pii_resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn tier_matrix_grandfathered_token_without_claim_passes_everything() {
    let app = matrix_app();
    for entry in READ_KEY_MAP {
        let resp = app
            .clone()
            .oneshot(req_with_claims(&concrete_url(entry.path), claims(None)))
            .await
            .unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::OK,
            "legacy full-read must pass {}",
            entry.path
        );
    }
}

#[tokio::test]
async fn tier_matrix_audit_preset_only_reads_audit_and_reports() {
    let app = matrix_app();
    let matrix = preset_matrix(AUDIT_PRESET);
    for (template, expected) in &matrix {
        let resp = app
            .clone()
            .oneshot(req_with_claims(
                &concrete_url(template),
                claims(Some(AUDIT_PRESET.iter().map(|k| k.to_string()).collect())),
            ))
            .await
            .unwrap();
        let expected_status = if *expected {
            StatusCode::OK
        } else {
            StatusCode::FORBIDDEN
        };
        assert_eq!(resp.status(), expected_status, "audit preset on {template}");
    }
}
/// Every `key` in [`READ_KEY_MAP`] must be a REGISTERED permission.
///
/// The map's keys are hand-typed literals, and the gate resolves them through
/// the registry, which fails CLOSED: an unregistered key denies. So a typo here
/// is not a crash — it is a route that silently 403s for every token, with
/// nothing in the failure naming the cause.
///
/// `validate_keys` cannot catch it: that function validates a TOKEN's claims at
/// mint time (`routes/tokens.rs:363`) and never sees this table. And
/// `permission_registry_tests` covers the permission CONSTANTS and the role
/// PRESETS — not the read-key map. So the one table deciding which key gates
/// which route was the only one of the three never checked against the registry.
#[test]
fn every_read_key_map_entry_names_a_registered_permission() {
    let mut unregistered: Vec<(&str, &str)> = Vec::new();
    for entry in READ_KEY_MAP {
        if !kasirmu_core::permission_registry::is_registered(entry.key) {
            unregistered.push((entry.path, entry.key));
        }
    }
    assert!(
        unregistered.is_empty(),
        "READ_KEY_MAP gates these routes with a permission the registry does not know, so \
         they 403 for every token: {unregistered:?}"
    );

    // Floor: a broken walk would make the assertion above vacuous.
    assert!(
        READ_KEY_MAP.len() >= 5,
        "the map must be walked in full, found {} entries",
        READ_KEY_MAP.len()
    );
}

/// Every key a preset grants must gate at least one route in [`READ_KEY_MAP`].
///
/// A preset key with no map entry is a DEAD GRANT: the token is minted carrying a
/// permission that opens nothing, so an operator who mints an `audit` token gets
/// one that can read no route at all. It is not a security hole — over-narrow,
/// never over-broad — but it is a contract the presets' own tests never checked,
/// because they assert the key LISTS and not what the keys reach.
///
/// The three keys this currently excludes are pinned explicitly below rather than
/// silently allowed, so that WIRING a reports route is a deliberate edit here:
/// when `/api/v1/reports*` lands and gains map entries, this list must shrink, and
/// the assertion makes that visible instead of letting a real grant stay unusable.
#[test]
fn preset_keys_that_gate_no_route_are_pinned_explicitly() {
    // Grants that reach no route YET. Every one is a read key for a surface the
    // API does not serve (reports, analytics and the audit trail are produced by
    // the cloud server's email bundle, not exposed as read-tier GETs).
    const NOT_YET_ROUTED: &[&str] = &["reports:view", "analytics:view", "audit:view"];

    let mut dead: Vec<&str> = Vec::new();
    for preset in [TERMINAL_PRESET, DASHBOARD_PRESET, AUDIT_PRESET] {
        for key in preset {
            if READ_KEY_MAP.iter().any(|e| e.key == *key) {
                continue;
            }
            if !dead.contains(key) {
                dead.push(key);
            }
        }
    }
    dead.sort_unstable();
    let mut expected = NOT_YET_ROUTED.to_vec();
    expected.sort_unstable();
    assert_eq!(
        dead, expected,
        "the set of preset grants that open no route changed: a key here that is now \
         routed should be removed from NOT_YET_ROUTED (it works!), and a NEW key here \
         means a preset grants something unusable"
    );

    // Floor: the presets must actually have been walked.
    assert!(TERMINAL_PRESET.len() >= 4 && DASHBOARD_PRESET.len() >= 3);
}
