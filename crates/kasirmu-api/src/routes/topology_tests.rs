use super::*;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use std::sync::Arc;
use tokio::sync::Mutex;
use tower::ServiceExt;

use crate::DEFAULT_CORS_ORIGINS;
use crate::router;

const TEST_SECRET: &str = "test-secret-key-32b-length-ok!";

fn test_app() -> (axum::Router, Arc<Mutex<rusqlite::Connection>>) {
    let conn = kasirmu_core::migrations::fresh_db();
    let db = Arc::new(Mutex::new(conn));
    let state = AppState {
        db: Arc::clone(&db),
        pg: None,
        admin_key: None,
        api_secret: TEST_SECRET.to_string(),
        allow_terminal_credentials: true,
        db_path: ":memory:".into(),
        port: 3099,
        cors_origins: DEFAULT_CORS_ORIGINS.iter().map(|s| s.to_string()).collect(),
        image_dir: std::path::PathBuf::from("./data/images"),
    };
    (router(state), db)
}

async fn body_json(resp: axum::response::Response) -> serde_json::Value {
    let bytes = resp
        .into_body()
        .collect()
        .await
        .expect("collect body")
        .to_bytes();
    serde_json::from_slice(&bytes).expect("parse JSON body")
}

fn authed_req(
    method: &str,
    uri: &str,
    tenant_id: Option<&str>,
    body: Option<&str>,
) -> Request<Body> {
    let token = crate::auth::create_token("test-user", Some(1), tenant_id, Some(TEST_SECRET))
        .unwrap()
        .token;
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .header("Authorization", format!("Bearer {token}"));
    if let Some(body) = body {
        builder = builder.header("Content-Type", "application/json");
        builder.body(Body::from(body.to_owned())).unwrap()
    } else {
        builder.body(Body::empty()).unwrap()
    }
}

fn seed_tenant_plan(
    db: &rusqlite::Connection,
    tenant_id: &str,
    tier_key: &str,
    max_locations: i64,
) {
    let _ = db.execute(
        "INSERT INTO tenant_subscription (
            tenant_id, tier_key, status, max_locations, max_pos_instances,
            allowed_types_json, signature, signed_payload, api_key, updated_at
        ) VALUES (
            ?1, ?2, 'active', ?3, 10, '[]', 'BOOTSTRAP', '{}', '', ''
        ) ON CONFLICT(tenant_id) DO UPDATE SET
            tier_key = excluded.tier_key,
            max_locations = excluded.max_locations",
        params![tenant_id, tier_key, max_locations],
    );
}

fn sample_valid_graph(branch_id: &str) -> (Vec<Value>, Vec<Value>) {
    let nodes = vec![
        serde_json::json!({
            "id": "branch",
            "type": "branch-location",
            "name": "Downtown Branch",
            "store_profile_id": branch_id
        }),
        serde_json::json!({
            "id": "node-pos-1",
            "type": "workspace",
            "name": "Register 1",
            "metadata": {
                "typeKey": "store-pos"
            }
        }),
    ];
    let wires = vec![serde_json::json!({
        "id": "wire-1",
        "from_node_id": "branch",
        "to_node_id": "node-pos-1",
        "direction": "one-way",
        "from_port_id": "location-out",
        "to_port_id": "location-in",
        "relationship_type": "location"
    })];
    (nodes, wires)
}

// ── T11: Eligibility Gate (ADR-66 D2) ─────────────────────────────────

#[tokio::test]
async fn single_store_tenant_free_is_rejected_with_plan_gate_exceeded() {
    let (app, db) = test_app();
    {
        let conn = db.lock().await;
        seed_tenant_plan(&conn, "tenant-free", "free", 1);
    }

    let (nodes, wires) = sample_valid_graph("loc-main");
    let req_body = serde_json::json!({
        "branch_id": "loc-main",
        "nodes": nodes,
        "wires": wires
    })
    .to_string();

    let resp = app
        .oneshot(authed_req(
            "POST",
            "/api/v1/topology/plan",
            Some("tenant-free"),
            Some(&req_body),
        ))
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    let json = body_json(resp).await;
    assert_eq!(json["error"], "plan_gate_exceeded");
}

#[tokio::test]
async fn single_store_tenant_plus_is_rejected_on_publish() {
    let (app, db) = test_app();
    {
        let conn = db.lock().await;
        seed_tenant_plan(&conn, "tenant-plus", "plus", 1);
    }

    let (nodes, wires) = sample_valid_graph("loc-main");
    let req_body = serde_json::json!({
        "branch_id": "loc-main",
        "nodes": nodes,
        "wires": wires
    })
    .to_string();

    let resp = app
        .oneshot(authed_req(
            "POST",
            "/api/v1/topology/publish",
            Some("tenant-plus"),
            Some(&req_body),
        ))
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    let json = body_json(resp).await;
    assert_eq!(json["error"], "plan_gate_exceeded");
}

#[tokio::test]
async fn multi_store_tenant_pro_is_admitted() {
    let (app, db) = test_app();
    {
        let conn = db.lock().await;
        seed_tenant_plan(&conn, "tenant-pro", "pro", 2);
    }

    let (nodes, wires) = sample_valid_graph("loc-main");
    let req_body = serde_json::json!({
        "branch_id": "loc-main",
        "nodes": nodes,
        "wires": wires
    })
    .to_string();

    let resp = app
        .oneshot(authed_req(
            "POST",
            "/api/v1/topology/plan",
            Some("tenant-pro"),
            Some(&req_body),
        ))
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    assert_eq!(json["valid"], true);
    assert_eq!(json["branchId"], "loc-main");
    assert_eq!(json["summary"]["created"], 1);
}

// ── T4: Bad Revision Rejection ─────────────────────────────────────────

#[tokio::test]
async fn invalid_semantic_graph_is_rejected_with_bad_request() {
    let (app, db) = test_app();
    {
        let conn = db.lock().await;
        seed_tenant_plan(&conn, "tenant-pro", "pro", 2);
    }

    // Invalid: workspace marked semantic but missing branch location
    let nodes = vec![serde_json::json!({
        "id": "node-orphan-1",
        "type": "workspace",
        "name": "Orphan Register",
        "store_profile_id": "loc-main",
        "metadata": { "typeKey": "store-pos" }
    })];
    let wires: Vec<Value> = vec![];

    let req_body = serde_json::json!({
        "branch_id": "loc-main",
        "nodes": nodes,
        "wires": wires
    })
    .to_string();

    let resp = app
        .oneshot(authed_req(
            "POST",
            "/api/v1/topology/plan",
            Some("tenant-pro"),
            Some(&req_body),
        ))
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let json = body_json(resp).await;
    assert_eq!(json["error"], "invalid_topology");
}

// ── T9: Location Containment ──────────────────────────────────────────

#[tokio::test]
async fn branch_profile_mismatch_is_rejected() {
    let (app, db) = test_app();
    {
        let conn = db.lock().await;
        seed_tenant_plan(&conn, "tenant-pro", "pro", 2);
    }

    let (nodes, wires) = sample_valid_graph("loc-branch-alpha");
    // Caller requests "loc-branch-beta" while graph declares "loc-branch-alpha"
    let req_body = serde_json::json!({
        "branch_id": "loc-branch-beta",
        "nodes": nodes,
        "wires": wires
    })
    .to_string();

    let resp = app
        .oneshot(authed_req(
            "POST",
            "/api/v1/topology/plan",
            Some("tenant-pro"),
            Some(&req_body),
        ))
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let json = body_json(resp).await;
    assert_eq!(json["error"], "branch_mismatch");
}

// ── T8: Branch Concurrency & Monotonicity ─────────────────────────────

#[tokio::test]
async fn optimistic_concurrency_conflict_returns_409() {
    let (app, db) = test_app();
    {
        let conn = db.lock().await;
        seed_tenant_plan(&conn, "tenant-pro", "pro", 2);
    }

    let (nodes, wires) = sample_valid_graph("loc-main");
    let req_body = serde_json::json!({
        "branch_id": "loc-main",
        "nodes": nodes,
        "wires": wires,
        "change_note": "Initial publish"
    })
    .to_string();

    // 1. First publish succeeds (revision 1)
    let resp1 = app
        .clone()
        .oneshot(authed_req(
            "POST",
            "/api/v1/topology/publish",
            Some("tenant-pro"),
            Some(&req_body),
        ))
        .await
        .unwrap();
    assert_eq!(resp1.status(), StatusCode::CREATED);
    let json1 = body_json(resp1).await;
    assert_eq!(json1["revision"], 1);

    // 2. Second publish presenting base_revision: 0 (or None when revision 1 exists)
    let stale_body = serde_json::json!({
        "branch_id": "loc-main",
        "nodes": nodes,
        "wires": wires,
        "base_revision": 0,
        "change_note": "Stale concurrent publish"
    })
    .to_string();

    let resp2 = app
        .clone()
        .oneshot(authed_req(
            "POST",
            "/api/v1/topology/publish",
            Some("tenant-pro"),
            Some(&stale_body),
        ))
        .await
        .unwrap();

    assert_eq!(resp2.status(), StatusCode::CONFLICT);
    let json2 = body_json(resp2).await;
    assert_eq!(json2["error"], "topology_revision_conflict");
    assert_eq!(json2["current_revision"], 1);
    assert_eq!(json2["expected_base"], 0);

    // 3. Publishing with base_revision: 1 succeeds (advances to revision 2)
    let correct_body = serde_json::json!({
        "branch_id": "loc-main",
        "nodes": nodes,
        "wires": wires,
        "base_revision": 1,
        "change_note": "Follow-up publish"
    })
    .to_string();

    let resp3 = app
        .oneshot(authed_req(
            "POST",
            "/api/v1/topology/publish",
            Some("tenant-pro"),
            Some(&correct_body),
        ))
        .await
        .unwrap();

    assert_eq!(resp3.status(), StatusCode::CREATED);
    let json3 = body_json(resp3).await;
    assert_eq!(json3["revision"], 2);
    assert_eq!(json3["baseRevision"], 1);
}

// ── T1: Cross-Tenant Isolation ────────────────────────────────────────

#[tokio::test]
async fn replication_pull_strictly_isolates_by_tenant() {
    let (app, db) = test_app();
    {
        let conn = db.lock().await;
        seed_tenant_plan(&conn, "tenant-alpha", "pro", 2);
        seed_tenant_plan(&conn, "tenant-beta", "pro", 2);
    }

    let (nodes, wires) = sample_valid_graph("shared-branch-name");
    let req_body = serde_json::json!({
        "branch_id": "shared-branch-name",
        "nodes": nodes,
        "wires": wires
    })
    .to_string();

    // Tenant Alpha publishes
    let resp_pub = app
        .clone()
        .oneshot(authed_req(
            "POST",
            "/api/v1/topology/publish",
            Some("tenant-alpha"),
            Some(&req_body),
        ))
        .await
        .unwrap();
    assert_eq!(resp_pub.status(), StatusCode::CREATED);

    // Tenant Beta pulls for "shared-branch-name" -> MUST receive 0 revisions
    let resp_beta = app
        .clone()
        .oneshot(authed_req(
            "GET",
            "/api/v1/topology/revisions/pull?branch_id=shared-branch-name",
            Some("tenant-beta"),
            None,
        ))
        .await
        .unwrap();

    assert_eq!(resp_beta.status(), StatusCode::OK);
    let json_beta = body_json(resp_beta).await;
    assert_eq!(json_beta["tenantId"], "tenant-beta");
    assert_eq!(json_beta["revisions"].as_array().unwrap().len(), 0);

    // Tenant Alpha pulls -> receives 1 revision
    let resp_alpha = app
        .oneshot(authed_req(
            "GET",
            "/api/v1/topology/revisions/pull?branch_id=shared-branch-name",
            Some("tenant-alpha"),
            None,
        ))
        .await
        .unwrap();

    assert_eq!(resp_alpha.status(), StatusCode::OK);
    let json_alpha = body_json(resp_alpha).await;
    assert_eq!(json_alpha["tenantId"], "tenant-alpha");
    let alpha_revs = json_alpha["revisions"].as_array().unwrap();
    assert_eq!(alpha_revs.len(), 1);
    assert_eq!(alpha_revs[0]["revision"], 1);
    assert!(alpha_revs[0]["signature"].is_string());
}

// ── Cryptographic Signing & Audit Verification ────────────────────────

#[tokio::test]
async fn publish_signs_payload_and_writes_audit_trail() {
    let (app, db) = test_app();
    {
        let conn = db.lock().await;
        seed_tenant_plan(&conn, "tenant-signed", "enterprise", 100);
    }

    let (nodes, wires) = sample_valid_graph("branch-hq");
    let req_body = serde_json::json!({
        "branch_id": "branch-hq",
        "org_id": "org-global",
        "nodes": nodes,
        "wires": wires,
        "change_note": "Signed revision check"
    })
    .to_string();

    let resp = app
        .oneshot(authed_req(
            "POST",
            "/api/v1/topology/publish",
            Some("tenant-signed"),
            Some(&req_body),
        ))
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::CREATED);
    let json = body_json(resp).await;
    let signature = json["signature"].as_str().unwrap();
    let key_id = json["keyId"].as_str().unwrap();
    assert!(!signature.is_empty());
    assert!(!key_id.is_empty());

    // Verify database row and audit log
    let conn = db.lock().await;
    let diagram: String = conn
        .query_row(
            "SELECT diagram FROM topology_revisions WHERE branch_id = 'branch-hq' AND revision = 1",
            [],
            |r| r.get(0),
        )
        .unwrap();

    let (_, signing_key) = resolved_topology_signing_key("test-secret-key-32b-length-ok!");
    let canonical = canonical_topology_revision_payload(
        "tenant-signed",
        "org-global",
        "branch-hq",
        1,
        None,
        &diagram,
    );
    assert!(verify_topology_revision_signature(
        &signing_key,
        &canonical,
        signature
    ));

    // Audit log check (ADR-66 D5)
    let audit_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM audit_log WHERE action = 'topology.publish' AND target_id = 'branch-hq'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(audit_count, 1, "audit_log must record published revision");
}

#[tokio::test]
async fn kill_switch_disables_web_authoring_plan_and_publish() {
    let (app, db) = test_app();
    {
        let conn = db.lock().await;
        seed_tenant_plan(&conn, "tenant-kill-switch", "pro", 2);
        // Activate kill switch in settings
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('topology:kill_switch', '1')",
            [],
        )
        .unwrap();
    }

    let plan_req = authed_req(
        "POST",
        "/api/v1/topology/plan",
        Some("tenant-kill-switch"),
        Some(
            &serde_json::json!({
                "branch_id": "branch-1",
                "nodes": [],
                "wires": [],
            })
            .to_string(),
        ),
    );
    let plan_resp = app.clone().oneshot(plan_req).await.unwrap();
    assert_eq!(plan_resp.status(), StatusCode::SERVICE_UNAVAILABLE);

    let pub_req = authed_req(
        "POST",
        "/api/v1/topology/publish",
        Some("tenant-kill-switch"),
        Some(
            &serde_json::json!({
                "branch_id": "branch-1",
                "nodes": [],
                "wires": [],
            })
            .to_string(),
        ),
    );
    let pub_resp = app.oneshot(pub_req).await.unwrap();
    assert_eq!(pub_resp.status(), StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test]
async fn shadow_mode_withholds_revisions_from_terminal_pull() {
    let (app, db) = test_app();
    {
        let conn = db.lock().await;
        seed_tenant_plan(&conn, "tenant-shadow", "pro", 2);
    }

    // Publish revision 1
    let (nodes, wires) = sample_valid_graph("branch-shadow");
    let pub_req = authed_req(
        "POST",
        "/api/v1/topology/publish",
        Some("tenant-shadow"),
        Some(
            &serde_json::json!({
                "branch_id": "branch-shadow",
                "nodes": nodes,
                "wires": wires,
            })
            .to_string(),
        ),
    );
    let pub_resp = app.clone().oneshot(pub_req).await.unwrap();
    assert_eq!(pub_resp.status(), StatusCode::CREATED);

    // Normal pull sees the revision
    let pull_req1 = authed_req(
        "GET",
        "/api/v1/topology/revisions/pull?branch_id=branch-shadow&since_revision=0",
        Some("tenant-shadow"),
        None,
    );
    let pull_resp1 = app.clone().oneshot(pull_req1).await.unwrap();
    assert_eq!(pull_resp1.status(), StatusCode::OK);
    let pull_json1 = body_json(pull_resp1).await;
    assert_eq!(pull_json1["revisions"].as_array().unwrap().len(), 1);

    // Activate shadow mode in settings
    {
        let conn = db.lock().await;
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('topology:shadow_mode', '1')",
            [],
        )
        .unwrap();
    }

    let pull_req2 = authed_req(
        "GET",
        "/api/v1/topology/revisions/pull?branch_id=branch-shadow&since_revision=0",
        Some("tenant-shadow"),
        None,
    );
    let pull_resp2 = app.oneshot(pull_req2).await.unwrap();
    assert_eq!(pull_resp2.status(), StatusCode::OK);
    let pull_json2 = body_json(pull_resp2).await;
    assert_eq!(pull_json2["revisions"].as_array().unwrap().len(), 0);
}
