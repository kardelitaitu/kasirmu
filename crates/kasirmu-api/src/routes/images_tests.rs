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

/// A unique scratch directory for image storage, kept INSIDE the checkout.
///
/// Delegates to [`kasirmu_test_support::ScratchDir`], which owns the whole
/// `C:\WINDOWS\TEMP` rationale in one place (see that crate's docs). Measured
/// 2026-10-21: all twelve image tests failed here with `Os { code: 5 }` before
/// the fixture moved under the gitignored `target/` tree.
///
/// A GUARD, not a bare path: [`kasirmu_test_support::scratch_dir`] deletes
/// nothing on drop, so every call leaked one `kasirmu-api-img-*` directory per
/// run forever. The guard is returned alongside the path and the caller keeps it
/// bound for the whole test body, so the directory outlives every write the
/// test makes into it and is removed when the test ends.
fn scratch_image_dir() -> (std::path::PathBuf, kasirmu_test_support::ScratchDir) {
    let scratch = kasirmu_test_support::ScratchDir::new("kasirmu-api-img");
    (scratch.path().to_path_buf(), scratch)
}

/// Create a unique scratch directory for image storage (no `tempfile` dep).
///
/// The third element is the `ScratchDir` that owns `image_dir`; bind it and
/// keep it alive for the whole test, and drop the explicit `cleanup` call —
/// the guard removes the directory when it goes out of scope.
fn temp_image_dir() -> (
    AppState,
    std::path::PathBuf,
    kasirmu_test_support::ScratchDir,
) {
    let (dir, scratch) = scratch_image_dir();
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
    (state, dir, scratch)
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

#[tokio::test]
async fn store_image_atomic_writes_file() {
    let (_, dir, _scratch) = temp_image_dir();
    let hash = "abcdef0123456789";
    let bytes = b"test image data";
    let duplicate = store_image_atomic(&dir, hash, bytes).await.unwrap();
    assert!(!duplicate);
    let path = dir.join(format!("{hash}.webp"));
    assert!(path.exists());
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
    cleanup(&dir);
}

#[tokio::test]
async fn store_image_atomic_detects_duplicate() {
    let (_, dir, _scratch) = temp_image_dir();
    let hash = "abcdef0123456789";
    let bytes = b"test image data";
    store_image_atomic(&dir, hash, bytes).await.unwrap();
    let duplicate = store_image_atomic(&dir, hash, bytes).await.unwrap();
    assert!(duplicate);
    cleanup(&dir);
}

#[test]
fn process_image_rejects_empty_body() {
    let (state, dir, _scratch) = temp_image_dir();
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
    let (state, dir, _scratch) = temp_image_dir();
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
    let (state, dir, _scratch) = temp_image_dir();
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
    let (state, dir, _scratch) = temp_image_dir();
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
        .conn()
        .query_row("SELECT COUNT(*) FROM image_refs", [], |r| r.get(0))
        .unwrap();
    assert_eq!(n, 0, "hash mismatch must not create a refcount");
    drop(db);
    cleanup(&dir);
}

#[tokio::test]
async fn put_image_hash_match_stores_successfully() {
    let (state, dir, _scratch) = temp_image_dir();
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
    let (state, dir, _scratch) = temp_image_dir();
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
async fn put_image_db_refcount_failure_returns_500_not_400() {
    let (state, dir, _scratch) = temp_image_dir();
    // Drop image_refs table to simulate an internal database failure
    {
        let db = state.db.lock().await;
        db.execute_batch("DROP TABLE image_refs;").unwrap();
    }
    let app = router(state.clone());
    let token = test_token(&state, "tenant-a");
    let body = make_webp_body();

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

    // O-L07: Must be 500 Internal Server Error, NOT 400 Bad Request
    assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let json = body_json(resp).await;
    assert!(
        json["error"]
            .as_str()
            .unwrap()
            .contains("refcount write failed"),
        "error message must describe the internal failure: {json:?}"
    );
    cleanup(&dir);
}

#[tokio::test]
async fn get_image_returns_404_for_unknown_hash() {
    let (state, dir, _scratch) = temp_image_dir();
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
    let (state, dir, _scratch) = temp_image_dir();
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
    let (state, dir, _scratch) = temp_image_dir();
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
    let (state, dir, _scratch) = temp_image_dir();
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
    let (state, dir, _scratch) = temp_image_dir();
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
    let missing_uri = format!("/api/v1/images:missing?hashes={hash},bbbbbbbbbbbbbbbb");
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

// ── Image pack (O-M24) ───────────────────────────────────────────────

/// Build `n` DISTINCT WebP bodies so each hashes differently. Size matters:
/// one body is `body_len` bytes and the pack frames are what the 2 MB
/// ceiling counts.
fn make_webp_bodies(n: usize, body_len: usize) -> Vec<Vec<u8>> {
    (0..n)
        .map(|i| {
            let mut b = make_webp_body();
            b.resize(body_len.max(16), 0);
            // Distinguish the bodies past the 16-byte WebP header, so the
            // size is preserved and the hashes still differ.
            b[12..16].copy_from_slice(&(i as u32).to_be_bytes());
            b
        })
        .collect()
}

/// Upload `bodies` through the real PUT route so the files AND the
/// `image_refs` rows both exist, exactly as in production.
async fn upload_all(state: &AppState, tenant: &str, bodies: &[Vec<u8>]) {
    let token = test_token(state, tenant);
    for body in bodies {
        let resp = router(state.clone())
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
    }
}

/// Decode `[u32 be len][bytes]` frames into the list of frame payloads.
/// Deliberately strict: a trailing partial frame is a failure, not tail-
/// truncation — the pack either frames cleanly or it does not.
fn decode_pack_frames(bytes: &[u8]) -> Vec<Vec<u8>> {
    let mut frames = Vec::new();
    let mut off = 0usize;
    while off < bytes.len() {
        assert!(off + 4 <= bytes.len(), "truncated length prefix at {off}");
        let len = u32::from_be_bytes(bytes[off..off + 4].try_into().unwrap()) as usize;
        off += 4;
        assert!(off + len <= bytes.len(), "truncated frame body at {off}");
        frames.push(bytes[off..off + len].to_vec());
        off += len;
    }
    frames
}

async fn get_pack(state: &AppState, tenant: &str, hashes: &[&str]) -> axum::response::Response {
    let token = test_token(state, tenant);
    router(state.clone())
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/api/v1/images:pack?hashes={}", hashes.join(",")))
                .header("Authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
}

/// O-M24, half (a): the pack answers with EXACTLY the same bytes, in exactly
/// the same order, after the per-hash `image_ref_exists` loop was replaced by
/// one batched lookup. The request mixes present hashes, absent hashes, a
/// hash that only ANOTHER tenant references, a hash repeated mid-list, and
/// malformed entries (dropped by the grammar filter, they do not 400 the
/// request) — every case the old per-hash loop handled.
#[tokio::test]
async fn pack_batched_lookup_matches_the_per_hash_answer() {
    let (state, dir, _scratch) = temp_image_dir();
    let imgs = make_webp_bodies(3, 64);
    upload_all(&state, "tenant-a", &imgs).await;
    let foreign = make_webp_bodies(4, 64).pop().unwrap();
    upload_all(&state, "tenant-b", &[foreign]).await;

    let h: Vec<String> = imgs.iter().map(|b| sha256_hex16(b)).collect();
    let foreign_h = sha256_hex16(&make_webp_bodies(4, 64)[3]);
    let order = [
        h[1].as_str(),
        "aaaaaaaaaaaaaaaa", // absent
        h[0].as_str(),
        foreign_h.as_str(), // present for tenant-b only → skipped
        "nonsense",         // malformed → filtered, request still 200
        h[2].as_str(),
        h[0].as_str(), // repeated → appears twice, in place
    ];
    let resp = get_pack(&state, "tenant-a", &order).await;
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(
        resp.headers()
            .get("content-type")
            .unwrap()
            .to_str()
            .unwrap(),
        "application/octet-stream",
        "the pack Content-Type is part of the wire contract"
    );
    assert_eq!(
        resp.headers()
            .get("cache-control")
            .unwrap()
            .to_str()
            .unwrap(),
        "max-age=31536000, immutable"
    );
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();

    // The caller-visible ordering IS the request order, missing entries
    // skipped — not the query's row order and not a re-sort.
    let frames = decode_pack_frames(&bytes);
    assert_eq!(
        frames,
        vec![
            imgs[1].clone(),
            imgs[0].clone(),
            imgs[2].clone(),
            imgs[0].clone()
        ]
    );
    cleanup(&dir);
}

/// A pack whose hashes are ALL absent (or foreign) is an empty 200 body —
/// not a 404 — the same answer the per-hash loop gave when every hash was
/// skipped, and the puller's cue that nothing in this pack is available.
#[tokio::test]
async fn pack_with_no_referenced_hashes_is_an_empty_ok_body() {
    let (state, dir, _scratch) = temp_image_dir();
    let foreign = make_webp_bodies(1, 64).pop().unwrap();
    upload_all(&state, "tenant-b", std::slice::from_ref(&foreign)).await;
    let foreign_h = sha256_hex16(&foreign);
    let resp = get_pack(&state, "tenant-a", &["aaaaaaaaaaaaaaaa", &foreign_h]).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    assert!(
        bytes.is_empty(),
        "no referenced hash → no frames, not a 404"
    );
    cleanup(&dir);
}

/// The 400 for a request with no USABLE hash is unchanged by the batching:
/// the grammar filter runs before any database work, and an empty result
/// never reaches the store.
#[tokio::test]
async fn pack_with_no_valid_hashes_is_bad_request() {
    let (state, dir, _scratch) = temp_image_dir();
    let resp = get_pack(&state, "tenant-a", &["short", "UPPERCASE0000000", ""]).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let json = body_json(resp).await;
    assert_eq!(json["error"], "no valid hashes");
    cleanup(&dir);
}

/// The file cap (64) and the BYTE cap (2 MB) are both still enforced.
///
/// `PACK_MAX_BYTES` pins the exact ceiling: 2 MB of frames is the most a
/// pack may carry, and the frame that would cross it is dropped, not
/// truncated. `PACK_MAX_FILES` takes the earlier 413 path — a distinct
/// status, and the only one that depends on `hashes.len()` rather than on
/// the bytes.
#[tokio::test]
async fn pack_enforces_the_file_and_byte_ceilings() {
    let (state, dir, _scratch) = temp_image_dir();
    // Thin WebP bodies: the frame overhead is 4 bytes per image, so the cap
    // must be reached by IMAGE BYTES, which is what O-M24's ledger note
    // (`a Vec growing to PACK_MAX_BYTES`) is about.
    let body_len = 32 * 1024;
    let imgs = make_webp_bodies(PACK_MAX_FILES, body_len);
    upload_all(&state, "tenant-a", &imgs).await;
    let hashes: Vec<String> = imgs.iter().map(|b| sha256_hex16(b)).collect();
    let refs: Vec<&str> = hashes.iter().map(String::as_str).collect();

    let resp = get_pack(&state, "tenant-a", &refs).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    assert!(
        bytes.len() <= PACK_MAX_BYTES,
        "pack body {} exceeded PACK_MAX_BYTES {PACK_MAX_BYTES}",
        bytes.len()
    );
    let frames = decode_pack_frames(&bytes);
    let expected_max = PACK_MAX_BYTES / (body_len + 4);
    assert_eq!(
        frames.len(),
        expected_max,
        "the byte cap keeps floor(PACK_MAX_BYTES / frame_size) whole frames"
    );
    // Every frame is a WHOLE image — a truncated frame would mean the cap cut
    // through a body instead of before it.
    for (i, frame) in frames.iter().enumerate() {
        assert_eq!(frame, &imgs[i], "frame {i} is a whole, ordered body");
    }

    // 65 hashes is over the FILE cap, regardless of size → 413.
    let mut too_many: Vec<&str> = refs.clone();
    too_many.push("aaaaaaaaaaaaaaaa");
    let resp = get_pack(&state, "tenant-a", &too_many).await;
    assert_eq!(resp.status(), StatusCode::PAYLOAD_TOO_LARGE);
    let json = body_json(resp).await;
    assert_eq!(json["error"], "pack exceeds 64 files");
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
