//! Wire-contract tests for `qris_auto`: the `sync_client` charge/status
//! round-trips against a loopback server pinning path, bearer header, and
//! response parsing (the same idiom as the `request_token` wire test in
//! `sync_tests.rs`), plus the camelCase IPC DTO shapes. No `BridgeCtx`
//! needed — the scoped auth chain is exercised where it is enforced.

use super::*;

use std::sync::Arc;

/// Serve one canned HTTP response on a loopback port and capture the raw
/// request (headers + full body) for assertions. reqwest may split headers
/// and body across writes, so reads continue until Content-Length is met.
async fn serve_once(
    response_body: &'static str,
    status: &'static str,
) -> (String, Arc<tokio::sync::Mutex<Option<String>>>) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server_url = format!("http://{}", listener.local_addr().unwrap());
    let captured: Arc<tokio::sync::Mutex<Option<String>>> = Arc::new(tokio::sync::Mutex::new(None));
    let captured_server = captured.clone();
    tokio::spawn(async move {
        let Ok((mut socket, _)) = listener.accept().await else {
            return;
        };
        let mut acc: Vec<u8> = Vec::new();
        let mut buf = vec![0_u8; 16 * 1024];
        // Until headers terminate and the declared body has fully arrived.
        for _ in 0..8 {
            let Ok(n) = socket.read(&mut buf).await else {
                break;
            };
            if n == 0 {
                break;
            }
            acc.extend_from_slice(&buf[..n]);
            let head_end = match acc.windows(4).position(|w| w == b"\r\n\r\n") {
                Some(p) => p,
                None => continue,
            };
            let head = String::from_utf8_lossy(&acc[..head_end]).into_owned();
            let cl: usize = head
                .lines()
                .find_map(|l| {
                    let (k, v) = l.split_once(':')?;
                    k.trim()
                        .eq_ignore_ascii_case("content-length")
                        .then(|| v.trim().parse().ok())
                        .flatten()
                })
                .unwrap_or(0);
            if acc.len() >= head_end + 4 + cl {
                break;
            }
        }
        let request = String::from_utf8_lossy(&acc).into_owned();
        *captured_server.lock().await = Some(request);
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            response_body.len(),
            response_body
        );
        let _ = socket.write_all(response.as_bytes()).await;
    });
    (server_url, captured)
}

#[tokio::test]
async fn qris_charge_posts_order_shape_with_bearer() {
    // Response uses the LIVE cloud wire shape (snake_case, expires field).
    let body = r#"{"order_id":"QRIS-WIRE-1","qr_string":"0002010201...","status":"qr_issued","amount_minor":15000,"currency":"IDR","sale_id":"sale-7","expires_in_secs":300}"#;
    let (server_url, captured) = serve_once(body, "200 OK").await;
    let config = SyncConfig {
        server_url,
        api_key: Some("jwt-abc".into()),
    };

    let result = sync_client::qris_charge_on_server(&config, "sale-7", 15000, Some("idem-1"))
        .await
        .expect("charge round-trip");
    assert_eq!(result.order_id, "QRIS-WIRE-1");
    assert_eq!(result.qr_string.as_deref(), Some("0002010201..."));
    assert_eq!(result.expires_in_secs, 300);

    let request = captured.lock().await.clone().unwrap();
    assert!(
        request.starts_with("POST /api/payment/midtrans/qris HTTP/1.1"),
        "wrong path: {request}"
    );
    assert!(
        request
            .to_ascii_lowercase()
            .contains("authorization: bearer jwt-abc"),
        "charge did not carry the sync bearer token: {request}"
    );
    assert!(
        request.contains("idempotency_key"),
        "body lost the key: {request}"
    );
}

#[tokio::test]
async fn qris_status_reads_braced_path_and_404_maps_to_server_error() {
    let body = r#"{"order_id":"QRIS-WIRE-2","status":"settlement","settled":true}"#;
    let (server_url, captured) = serve_once(body, "200 OK").await;
    let config = SyncConfig {
        server_url: server_url.clone(),
        api_key: Some("jwt-abc".into()),
    };

    let result = sync_client::qris_status_from_server(&config, "QRIS-WIRE-2")
        .await
        .expect("status round-trip");
    assert!(result.settled);
    let request = captured.lock().await.clone().unwrap();
    assert!(
        request.starts_with("GET /api/payment/midtrans/QRIS-WIRE-2/status HTTP/1.1"),
        "order id must ride in the path: {request}"
    );

    // Uniform-miss 404 from the cloud must surface as a typed Server error
    // (never an auth refresh loop — the caller cannot distinguish "not mine"
    // from "not there", by design).
    let (server_url, _cap) = serve_once(r#"no such order"#, "404 Not Found").await;
    let config = SyncConfig {
        server_url,
        api_key: None,
    };
    let err = sync_client::qris_status_from_server(&config, "gone")
        .await
        .expect_err("404 must not parse as success");
    match err {
        sync_client::SyncHttpError::Server { status: 404, .. } => {}
        other => panic!("expected typed 404, got {other:?}"),
    }
}

#[test]
fn charge_dto_is_camel_case_for_ipc() {
    let dto: QrisAutoChargeDto = sync_client::QrisChargeResult {
        order_id: "o-1".into(),
        qr_string: None,
        status: "qr_issued".into(),
        amount_minor: 2500,
        currency: "IDR".into(),
        sale_id: "s-1".into(),
        expires_in_secs: 300,
    }
    .into();
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["orderId"], "o-1");
    assert_eq!(json["amountMinor"], 2500);
    assert_eq!(json["expiresInSecs"], 300);
    assert!(json["qrString"].is_null());
}

#[test]
fn status_dto_is_camel_case_for_ipc() {
    let dto: QrisAutoStatusDto = sync_client::QrisStatusResult {
        order_id: "o-1".into(),
        status: "expire".into(),
        settled: false,
    }
    .into();
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["orderId"], "o-1");
    assert_eq!(json["status"], "expire");
    assert_eq!(json["settled"], false);
}
