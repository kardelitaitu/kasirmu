//! Unit tests for the desktop device-link client (super).

use super::*;

/// Serve exactly one canned HTTP response and hand back the request the client sent.
///
/// Reads until the declared body length arrives: a single `read` can return only the
/// headers, and asserting on a half-read request is a flake waiting for load.
#[cfg(feature = "sync-http")]
fn one_shot_server(
    status_line: &'static str,
    body: String,
) -> (String, std::thread::JoinHandle<String>) {
    use std::io::{Read, Write};
    use std::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let handle = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept");
        let mut buffer: Vec<u8> = Vec::new();
        let mut chunk = [0_u8; 4096];
        loop {
            let read = stream.read(&mut chunk).unwrap_or(0);
            if read == 0 {
                break;
            }
            buffer.extend_from_slice(&chunk[..read]);
            let text = String::from_utf8_lossy(&buffer);
            if let Some(headers_end) = text.find("\r\n\r\n") {
                let declared = text[..headers_end]
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .and_then(|value| value.trim().parse::<usize>().ok())
                    })
                    .unwrap_or(0);
                if buffer.len() >= headers_end + 4 + declared {
                    break;
                }
            }
        }
        let request = String::from_utf8_lossy(&buffer).to_string();
        let response = format!(
            "{status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let _ = stream.write_all(response.as_bytes());
        request
    });
    (format!("http://127.0.0.1:{port}"), handle)
}

#[test]
fn pkce_challenge_matches_rfc7636_appendix_b() {
    // The RFC's own worked example. If this drifts, Google rejects every exchange with
    // invalid_grant — and a round-trip test against our own verifier would not notice.
    let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    assert_eq!(
        pkce_challenge(verifier),
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
}

#[test]
fn generate_pkce_produces_a_usable_fresh_pair() {
    let first = generate_pkce();
    let second = generate_pkce();
    assert_eq!(first.challenge, pkce_challenge(&first.verifier));
    assert!(
        (43..=128).contains(&first.verifier.len()),
        "RFC 7636 requires 43-128 characters, got {}",
        first.verifier.len()
    );
    assert!(
        first
            .verifier
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-._~".contains(c)),
        "the verifier uses only unreserved characters"
    );
    assert_ne!(
        first.verifier, second.verifier,
        "each attempt needs its own verifier"
    );
}

#[cfg(feature = "sync-http")]
#[tokio::test]
async fn start_desktop_link_posts_the_verifier_and_returns_the_consent_url() {
    let (origin, server) = one_shot_server(
        "HTTP/1.1 200 OK",
        r#"{"authorizeUrl":"https://accounts.google.com/o/oauth2/v2/auth?state=s-1"}"#.to_string(),
    );
    let url = start_desktop_link(
        &origin,
        "key-abc",
        "mach-1",
        "s-1",
        "verifier-1",
        "http://127.0.0.1:49152",
    )
    .await
    .expect("start");
    let request = server.join().expect("server thread");
    let lower = request.to_ascii_lowercase();

    assert_eq!(
        url,
        "https://accounts.google.com/o/oauth2/v2/auth?state=s-1"
    );
    assert!(
        request.starts_with(&format!("POST {LINK_START_PATH} ")),
        "unexpected request line: {request}"
    );
    assert!(
        lower.contains("authorization: bearer key-abc"),
        "the device key must authenticate the request: {request}"
    );
    // The verifier is the half that must reach the server; the challenge is what went
    // to Google inside the URL the server returned.
    assert!(
        request.contains(r#""code_verifier":"verifier-1""#),
        "{request}"
    );
    assert!(request.contains(r#""machine_id":"mach-1""#), "{request}");
    assert!(request.contains(r#""state":"s-1""#), "{request}");
    assert!(
        request.contains(r#""redirect_uri":"http://127.0.0.1:49152""#),
        "the loopback target must be sent verbatim: {request}"
    );
}

#[cfg(feature = "sync-http")]
#[tokio::test]
async fn consume_desktop_link_parses_the_linked_account() {
    let (origin, server) = one_shot_server(
        "HTTP/1.1 200 OK",
        r#"{"tenantId":"t-1","provider":"google","email":"owner@example.com"}"#.to_string(),
    );
    let account = consume_desktop_link(&origin, "key-abc", "mach-1", "code-1")
        .await
        .expect("consume");
    let request = server.join().expect("server thread");

    assert_eq!(account.tenant_id, "t-1");
    assert_eq!(account.provider, "google");
    assert_eq!(account.email, "owner@example.com");
    assert!(
        request.starts_with(&format!("POST {LINK_CONSUME_PATH} ")),
        "unexpected request line: {request}"
    );
    assert!(request.contains(r#""link_code":"code-1""#), "{request}");
    assert!(request.contains(r#""machine_id":"mach-1""#), "{request}");
}

#[cfg(feature = "sync-http")]
#[tokio::test]
async fn consume_maps_a_refused_code_to_a_field_error_and_an_outage_to_internal() {
    // A refused code is the expected failure and must be actionable in the wizard:
    // "that link expired, start again" is a different message from "the server is down".
    let (origin, server) = one_shot_server(
        "HTTP/1.1 400 Bad Request",
        r#"{"error":"invalid or expired link code"}"#.to_string(),
    );
    let refused = consume_desktop_link(&origin, "key-abc", "mach-1", "stale").await;
    server.join().expect("server thread");
    match refused {
        Err(CoreError::Validation { field, .. }) => assert_eq!(field, "link_code"),
        other => panic!("a 400 must map to a link_code validation error, got {other:?}"),
    }

    let (origin, server) = one_shot_server("HTTP/1.1 503 Service Unavailable", "{}".to_string());
    let outage = consume_desktop_link(&origin, "key-abc", "mach-1", "code-1").await;
    server.join().expect("server thread");
    assert!(
        matches!(outage, Err(CoreError::Internal(_))),
        "a 503 is an outage, not a bad code: {outage:?}"
    );
}
