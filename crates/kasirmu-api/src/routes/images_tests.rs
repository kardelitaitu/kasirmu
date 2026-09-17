//! Tests for the image byte-store endpoints (spec 0046b §3.4, §3.7).

use super::*;
use crate::DEFAULT_CORS_ORIGINS;
use crate::router;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use std::sync::Arc;
use tokio::sync::Mutex;
use tower::ServiceExt;

// ── Helpers ──────────────────────────────────────────────────────────

/// Create a unique temp directory for image storage (no `tempfile` dep).
fn temp_image_dir() -> (AppState, std::path::PathBuf) {
    let base = std::env::temp_dir();
    let dir = base.join(format!("kasirmu-api-img-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let state = AppState {
        db: Arc::new(Mutex::new(kasirmu_core::migrations::fresh_db())),
        pg: None,
        admin_key: None,
        api_secret: "test-secret".into(),
        allow_terminal_credentials: true,
        db_path: ":memory:".into(),
        port: 3099,
        cors_origins: DEFAULT_CORS_ORIGINS.iter().map(|s| s.to_string()).collect(),
        image_dir: dir.clone(),
    };
    (state, dir)
}

/// Clean up the temp image dir created by [`temp_image_dir`].
fn cleanup(dir: &std::path::Path) {
    let _ = std::fs::remove_dir_all(dir);
}

/// Generate a test JWT for the given tenant_id, signed with the same
/// secret the stateful auth middleware validates against
/// (`AppState::api_secret`).
fn test_token(state: &AppState, tenant_id: &str) -> String {
    use crate::auth::create_token;
    create_token("test", Some(1), Some(tenant_id), Some(&state.api_secret))
        .unwrap()
        .token
}

fn make_webp_body() -> Vec<u8> {
    // Minimal valid WebP (RIFF + WEBP + 1px black VP8L)
    // Length: 30 bytes total
    let mut data = Vec::with_capacity(30);
    data.extend_from_slice(b"RIFF"); // 0-3
    data.extend_from_slice(&22u32.to_le_bytes()); // 4-7: file size - 8
    data.extend_from_slice(b"WEBP"); // 8-11
    data.extend_from_slice(b"VP8L"); // 12-15: lossless chunk tag
    data.extend_from_slice(&[0x2f, 0x00, 0x00, 0x00, 0x00]); // 16-20: chunk header + initial
    data.push(0x00); // 21: padding
    data.extend_from_slice(&[0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    data
}

// ── Helper tests ─────────────────────────────────────────────────────

#[test]
fn sha256_hex16_produces_16_hex_chars() {
    let hash = sha256_hex16(b"hello");
    assert_eq!(hash.len(), 16);
    assert!(hash.bytes().all(|b| b.is_ascii_hexdigit()));
}

#[test]
fn is_valid_hash16_accepts_correct_hash() {
    assert!(is_valid_hash16("abcdef0123456789"));
    assert!(!is_valid_hash16("")); // empty
    assert!(!is_valid_hash16("abc")); // too short
    assert!(!is_valid_hash16("abcdef0123456789Z")); // 17 chars
    assert!(!is_valid_hash16("ABCDEF0123456789")); // uppercase
    assert!(!is_valid_hash16("abcdef012345678!")); // invalid char
}

#[test]
fn is_webp_magic_detects_valid_webp() {
    let data = make_webp_body();
    assert!(is_webp_magic(&data));
}

#[test]
fn is_webp_magic_rejects_non_webp() {
    assert!(!is_webp_magic(b""));
    assert!(!is_webp_magic(b"not webp"));
    assert!(!is_webp_magic(b"RIFF....XXXX"));
}

#[test]
fn store_image_atomic_writes_file() {
    let (_, dir) = temp_image_dir();
    let hash = "abcdef0123456789";
    let bytes = b"test image data";
    let duplicate = store_image_atomic(&dir, hash, bytes).unwrap();
    assert!(!duplicate);
    let path = dir.join(format!("{hash}.webp"));
    assert!(path.exists());
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
    cleanup(&dir);
}

#[test]
fn store_image_atomic_detects_duplicate() {
    let (_, dir) = temp_image_dir();
    let hash = "abcdef0123456789";
    let bytes = b"test image data";
    store_image_atomic(&dir, hash, bytes).unwrap();
    let duplicate = store_image_atomic(&dir, hash, bytes).unwrap();
    assert!(duplicate);
    cleanup(&dir);
}

#[test]
fn process_image_rejects_empty_body() {
    let (state, dir) = temp_image_dir();
    let claims = crate::auth::ApiTokenClaims {
        sub: "test".into(),
        jti: uuid::Uuid::new_v4().to_string(),
        exp: 9999999999,
        iat: 1000000000,
        tenant_id: Some("tenant-a".into()),
        terminal_id: None,
        permissions: None,
    };
    let rt = tokio::runtime::Runtime::new().unwrap();
    let outcome = rt.block_on(process_image(&state, &claims, b""));
    assert_eq!(outcome, ImageOutcome::Rejected);
    cleanup(&dir);
}

// ── Endpoint tests ───────────────────────────────────────────────────

#[tokio::test]
async fn put_image_accepts_valid_webp() {
    let (state, dir) = temp_image_dir();
    let app = router(state.clone());
    let token = test_token(&state, "tenant-a");
    let body = make_webp_body();
    let hash = sha256_hex16(&body);

    let resp = app
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/api/v1/images")
                .header("Authorization", format!("Bearer {token}"))
                .header("Content-Type", "application/octet-stream")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::CREATED);
    let json = body_json(resp).await;
    assert_eq!(json["hash16"], hash);
    cleanup(&dir);
}

#[tokio::test]
async fn put_image_rejects_non_webp() {
    let (state, dir) = temp_image_dir();
    let app = router(state.clone());
    let token = test_token(&state, "tenant-a");

    let resp = app
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/api/v1/images")
                .header("Authorization", format!("Bearer {token}"))
                .body(Body::from(Vec::from(b"not a webp image" as &[u8])))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    cleanup(&dir);
}

#[tokio::test]
async fn put_image_hash_mismatch_returns_409_without_storing() {
    let (state, dir) = temp_image_dir();
    let app = router(state.clone());
    let token = test_token(&state, "tenant-a");
    let body = make_webp_body();
    // A valid-format but wrong hash — must NOT persist the bytes.
    let wrong_hash = "ffffffffffffffff";
    let uri = format!("/api/v1/images?hash={wrong_hash}");

    let resp = app
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(&uri)
                .header("Authorization", format!("Bearer {token}"))
                .header("Content-Type", "application/octet-stream")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::CONFLICT);

    // The content-addressed file must NOT exist (bytes were discarded,
    // not orphaned) and the refcount must be zero.
    let stored_count = std::fs::read_dir(&dir)
        .unwrap()
        .filter(|e| {
            e.as_ref()
                .unwrap()
                .path()
                .extension()
                .is_some_and(|x| x == "webp")
        })
        .count();
    assert_eq!(stored_count, 0, "hash mismatch must not persist any file");

    let db = state.db.lock().await;
    let n: i64 = kasirmu_core::db::Store::new(&db)
        .conn
        .query_row("SELECT COUNT(*) FROM image_refs", [], |r| r.get(0))
        .unwrap();
    assert_eq!(n, 0, "hash mismatch must not create a refcount");
    drop(db);
    cleanup(&dir);
}

#[tokio::test]
async fn put_image_hash_match_stores_successfully() {
    let (state, dir) = temp_image_dir();
    let app = router(state.clone());
    let token = test_token(&state, "tenant-a");
    let body = make_webp_body();
    let hash = sha256_hex16(&body);
    let uri = format!("/api/v1/images?hash={hash}");

    let resp = app
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(&uri)
                .header("Authorization", format!("Bearer {token}"))
                .header("Content-Type", "application/octet-stream")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::CREATED);
    let json = body_json(resp).await;
    assert_eq!(json["hash16"], hash);
    cleanup(&dir);
}

#[tokio::test]
async fn put_image_malformed_body_with_wrong_hash_returns_400_not_409() {
    let (state, dir) = temp_image_dir();
    let app = router(state.clone());
    let token = test_token(&state, "tenant-a");
    // The body is NOT a WebP AND the supplied hash doesn't match. The
    // malformed body must win (400, not 409) — the client-hash handshake
    // only ever applies to a storable payload.
    let uri = "/api/v1/images?hash=ffffffffffffffff";
    let resp = app
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(uri)
                .header("Authorization", format!("Bearer {token}"))
                .header("Content-Type", "application/octet-stream")
                .body(Body::from(Vec::from(b"not a webp image" as &[u8])))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    cleanup(&dir);
}

#[tokio::test]
async fn get_image_returns_404_for_unknown_hash() {
    let (state, dir) = temp_image_dir();
    let app = router(state.clone());
    let token = test_token(&state, "tenant-a");

    let resp = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/api/v1/images/abcdef0123456789")
                .header("Authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    cleanup(&dir);
}

#[tokio::test]
async fn get_image_returns_404_for_invalid_hash() {
    let (state, dir) = temp_image_dir();
    let app = router(state.clone());
    let token = test_token(&state, "tenant-a");

    let resp = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/api/v1/images/short")
                .header("Authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    cleanup(&dir);
}

#[tokio::test]
async fn get_image_succeeds_when_refcounted() {
    let (state, dir) = temp_image_dir();
    let token = test_token(&state, "tenant-a");
    let app = router(state.clone());

    // Upload an image first
    let body = make_webp_body();
    let hash = sha256_hex16(&body);

    // PUT the image
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/api/v1/images")
                .header("Authorization", format!("Bearer {token}"))
                .body(Body::from(body.clone()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    // Now GET it
    let resp = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/api/v1/images/{hash}"))
                .header("Authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let headers = resp.headers();
    assert_eq!(
        headers.get("content-type").unwrap().to_str().unwrap(),
        "image/webp"
    );
    assert_eq!(
        headers.get("cache-control").unwrap().to_str().unwrap(),
        "max-age=31536000, immutable"
    );
    assert_eq!(
        headers.get("etag").unwrap().to_str().unwrap(),
        format!("\"{hash}\"")
    );
    cleanup(&dir);
}

#[tokio::test]
async fn batch_put_accepts_multiple_images() {
    let (state, dir) = temp_image_dir();
    let app = router(state.clone());
    let token = test_token(&state, "tenant-a");

    // Build a batch body: two frames
    let img1 = make_webp_body();
    let img2 = make_webp_body();
    let mut batch = Vec::new();
    batch.extend_from_slice(&(img1.len() as u32).to_be_bytes());
    batch.extend_from_slice(&img1);
    batch.extend_from_slice(&(img2.len() as u32).to_be_bytes());
    batch.extend_from_slice(&img2);

    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/images")
                .header("Authorization", format!("Bearer {token}"))
                .body(Body::from(batch))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::CREATED);
    let json = body_json(resp).await;
    let results = json["results"].as_array().unwrap();
    assert_eq!(results.len(), 2);
    // Both frames carry identical bytes → content-addressed dedupe: the
    // first is stored, the second is a duplicate (same hash).
    assert_eq!(results[0]["status"], "stored");
    assert_eq!(results[1]["status"], "duplicate");
    cleanup(&dir);
}

#[tokio::test]
async fn missing_returns_only_hashes_not_in_image_refs() {
    let (state, dir) = temp_image_dir();
    let token = test_token(&state, "tenant-a");
    let app = router(state.clone());

    // Upload an image → refcount becomes 1.
    let body = make_webp_body();
    let hash = sha256_hex16(&body);

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/api/v1/images")
                .header("Authorization", format!("Bearer {token}"))
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    // The uploaded hash has refcount=1 → NOT missing.
    // Some other random hash → IS missing.
    let missing_uri = format!("/api/v1/images:missing?hashes={},bbbbbbbbbbbbbbbb", hash);
    let resp = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(&missing_uri)
                .header("Authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    let missing = json["missing_hashes"].as_array().unwrap();
    assert_eq!(missing.len(), 1, "only the unknown hash should be missing");
    assert_eq!(missing[0], "bbbbbbbbbbbbbbbb");
    cleanup(&dir);
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
