//! Unit tests for the loopback listener (super).

use super::*;
use std::io::{Read, Write};
use std::net::TcpStream;

/// Sends one request to the listener and returns the raw response.
fn send(port: u16, target: &str) -> String {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect");
    let request =
        format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).expect("write");
    let mut response = String::new();
    let _ = stream.read_to_string(&mut response);
    response
}

#[test]
fn parse_callback_target_reads_the_code_and_the_reason() {
    let cases: Vec<(&str, Option<LinkCallback>)> = vec![
        ("GET /?link_code=abc123 HTTP/1.1", Some(LinkCallback::Code("abc123".into()))),
        (
            "GET /?link_error=access_denied HTTP/1.1",
            Some(LinkCallback::Error("access_denied".into())),
        ),
        ("GET /cb?link_code=zzz&extra=1 HTTP/1.1", Some(LinkCallback::Code("zzz".into()))),
        ("GET / HTTP/1.1", None),
        ("GET /favicon.ico HTTP/1.1", None),
        ("GET /?foo=bar HTTP/1.1", None),
        ("GET /?link_code= HTTP/1.1", None),
        ("", None),
    ];
    for (line, want) in cases {
        assert_eq!(parse_callback_target(line), want, "for {line:?}");
    }
}

#[test]
fn parse_prefers_the_code_and_decodes_components() {
    // A code wins: if the server handed one over, the flow succeeded even if a reason
    // tag rode along.
    assert_eq!(
        parse_callback_target("GET /?link_error=busy&link_code=abc HTTP/1.1"),
        Some(LinkCallback::Code("abc".into()))
    );
    assert_eq!(
        parse_callback_target("GET /?link_error=invalid+token HTTP/1.1"),
        Some(LinkCallback::Error("invalid token".into()))
    );
    assert_eq!(
        parse_callback_target("GET /?link_code=a%2Bb HTTP/1.1"),
        Some(LinkCallback::Code("a+b".into()))
    );
}

#[test]
fn decode_component_handles_escapes_and_never_panics() {
    assert_eq!(decode_component("%C3%A9"), "é");
    assert_eq!(decode_component("a+b"), "a b");
    // A malformed or truncated escape passes through rather than eating the value.
    assert_eq!(decode_component("%zz"), "%zz");
    assert_eq!(decode_component("%4"), "%4");
}

#[test]
fn bind_hands_out_a_loopback_uri_with_a_port() {
    let listener = LoopbackListener::bind().expect("bind");
    let uri = listener.redirect_uri();
    assert!(
        uri.starts_with("http://127.0.0.1:"),
        "the server accepts only the literal loopback form: {uri}"
    );
    assert!(listener.port() > 0, "an ephemeral port must be reported");
}

#[test]
fn wait_for_callback_returns_the_code_and_answers_the_browser() {
    let listener = LoopbackListener::bind().expect("bind");
    let port = listener.port();
    let client = std::thread::spawn(move || send(port, "/?link_code=abc123"));

    let outcome = listener
        .wait_for_callback(Duration::from_secs(5))
        .expect("callback");
    let response = client.join().expect("client thread");

    assert_eq!(outcome, LinkCallback::Code("abc123".into()));
    assert!(response.starts_with("HTTP/1.1 200 OK"), "{response}");
    assert!(response.contains("close this window"), "{response}");
}

#[test]
fn a_favicon_request_does_not_end_the_wait() {
    // Browsers ask for /favicon.ico right after the redirect. Consuming the one-shot
    // accept on that request would strand the user at a blank page.
    let listener = LoopbackListener::bind().expect("bind");
    let port = listener.port();
    let client = std::thread::spawn(move || {
        let icon = send(port, "/favicon.ico");
        std::thread::sleep(Duration::from_millis(80));
        let real = send(port, "/?link_code=late");
        (icon, real)
    });

    let outcome = listener
        .wait_for_callback(Duration::from_secs(5))
        .expect("callback");
    let (icon, real) = client.join().expect("client thread");

    assert_eq!(outcome, LinkCallback::Code("late".into()));
    assert!(icon.starts_with("HTTP/1.1 404"), "{icon}");
    assert!(real.starts_with("HTTP/1.1 200"), "{real}");
}

#[test]
fn wait_for_callback_gives_up_at_the_deadline() {
    let listener = LoopbackListener::bind().expect("bind");
    let started = Instant::now();
    let outcome = listener.wait_for_callback(Duration::from_millis(120));
    assert!(
        matches!(outcome, Err(BridgeError::Internal(ref m)) if m.contains("timed out")),
        "{outcome:?}"
    );
    assert!(started.elapsed() < Duration::from_secs(3), "must not overrun the deadline");
}

#[test]
fn the_relay_page_never_reflects_the_query() {
    // Anything can navigate the user's browser to the loopback port; reflecting the query
    // would be script injection into a page they are looking at.
    let listener = LoopbackListener::bind().expect("bind");
    let port = listener.port();
    let client = std::thread::spawn(move || send(port, "/?link_error=%3Cscript%3Ealert(1)%3C/script%3E"));

    let outcome = listener
        .wait_for_callback(Duration::from_secs(5))
        .expect("callback");
    let response = client.join().expect("client thread");

    assert!(
        matches!(outcome, LinkCallback::Error(ref r) if r.contains("<script>")),
        "the reason is captured: {outcome:?}"
    );
    assert!(
        !response.contains("<script"),
        "the page must stay static: {response}"
    );
}

// ── the whole flow, with a stub licence server and a fake browser ─────

/// One canned response, chosen from the request the responder sees.
type Responder = Box<dyn Fn(usize, &str) -> (String, String) + Send>;

/// A stub licence server answering `count` requests, returning the raw requests it saw.
fn stub_server(count: usize, responder: Responder) -> (String, std::thread::JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let handle = std::thread::spawn(move || {
        let mut seen = Vec::new();
        for i in 0..count {
            let (mut stream, _) = listener.accept().expect("accept");
            stream.set_nonblocking(false).ok();
            let request = read_request(&mut stream);
            let (status, body) = responder(i, &request);
            let response = format!(
                "{status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();
            seen.push(request);
        }
        seen
    });
    (format!("http://127.0.0.1:{port}"), handle)
}

/// Reads a full request: headers plus the declared body length.
fn read_request(stream: &mut TcpStream) -> String {
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
    String::from_utf8_lossy(&buffer).to_string()
}

/// Best-effort `"field":"value"` read from a request body — enough for a stub.
fn field(request: &str, name: &str) -> String {
    let needle = format!("\"{name}\":\"");
    match request.find(&needle) {
        Some(at) => {
            let rest = &request[at + needle.len()..];
            rest[..rest.find('"').unwrap_or(0)].to_string()
        }
        None => String::new(),
    }
}

/// Plays the browser: finds the loopback port in the consent URL and sends the callback.
fn fake_browser(url: &str, target: &str) {
    // The real server percent-encodes the redirect_uri inside the consent URL; a stub may
    // echo it raw. Accept both, so this helper is about the flow rather than one encoding.
    let encoded = "127.0.0.1%3A";
    let plain = "127.0.0.1:";
    let at = if let Some(found) = url.find(encoded) {
        found + encoded.len()
    } else if let Some(found) = url.find(plain) {
        found + plain.len()
    } else {
        panic!("the consent URL must carry our loopback redirect: {url}");
    };
    let port: u16 = url[at..]
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect::<String>()
        .parse()
        .expect("port");
    let target = target.to_string();
    std::thread::spawn(move || send(port, &target));
}

fn ok_status() -> String {
    "HTTP/1.1 200 OK".to_string()
}

#[tokio::test]
async fn link_device_walks_bind_start_redirect_consume() {
    let (stub, server) = stub_server(
        2,
        Box::new(|i, request| {
            if i == 0 {
                // Echo the caller's own redirect_uri, exactly as the real server does.
                let redirect = field(request, "redirect_uri");
                (
                    ok_status(),
                    format!("{{\"authorizeUrl\":\"https://accounts.google.com/auth?redirect_uri={redirect}\"}}"),
                )
            } else {
                (
                    ok_status(),
                    r#"{"tenantId":"t-1","provider":"google","email":"owner@example.com"}"#.to_string(),
                )
            }
        }),
    );

    let account = link_device(
        &stub,
        "key-abc",
        "mach-1",
        Duration::from_secs(5),
        |url: String| {
            fake_browser(&url, "/?link_code=code-1");
            async { Ok(()) }
        },
    )
    .await
    .expect("a completed link");
    let seen = server.join().expect("stub thread");

    assert_eq!(account.tenant_id, "t-1");
    assert_eq!(account.email, "owner@example.com");
    assert!(
        seen[0].starts_with(&format!("POST {} ", kasirmu_core::desktop_link::LINK_START_PATH)),
        "{}",
        seen[0]
    );
    assert!(
        seen[1].starts_with(&format!("POST {} ", kasirmu_core::desktop_link::LINK_CONSUME_PATH)),
        "{}",
        seen[1]
    );
    // The code the browser carried is what the second call spends, and the device is
    // named on both calls so the server can bind the code to it.
    assert!(seen[1].contains(r#""link_code":"code-1""#), "{}", seen[1]);
    assert!(seen[1].contains(r#""machine_id":"mach-1""#), "{}", seen[1]);
    // The verifier goes to the server, never to the browser.
    assert!(!seen[0].contains(&field(&seen[1], "link_code")), "nonsense guard");
}

#[tokio::test]
async fn link_device_reports_a_refused_flow_as_invalid() {
    let (stub, server) = stub_server(
        1,
        Box::new(|_, request| {
            let redirect = field(request, "redirect_uri");
            (
                ok_status(),
                format!("{{\"authorizeUrl\":\"https://accounts.google.com/auth?redirect_uri={redirect}\"}}"),
            )
        }),
    );

    let outcome = link_device(
        &stub,
        "key-abc",
        "mach-1",
        Duration::from_secs(5),
        |url: String| {
            fake_browser(&url, "/?link_error=access_denied");
            async { Ok(()) }
        },
    )
    .await;
    server.join().expect("stub thread");

    match outcome {
        Err(BridgeError::Invalid(message)) => {
            assert!(message.contains("access_denied"), "{message}");
        }
        other => panic!("a declined consent must be an Invalid error, got {other:?}"),
    }
}

#[tokio::test]
async fn link_device_gives_up_when_the_browser_never_returns() {
    let (stub, server) = stub_server(
        1,
        Box::new(|_, _| (ok_status(), r#"{"authorizeUrl":"https://accounts.google.com/auth"}"#.to_string())),
    );

    let started = Instant::now();
    let outcome = link_device(
        &stub,
        "key-abc",
        "mach-1",
        Duration::from_millis(150),
        |_| async { Ok(()) },
    )
    .await;
    server.join().expect("stub thread");

    assert!(
        matches!(outcome, Err(BridgeError::Internal(ref m)) if m.contains("timed out")),
        "{outcome:?}"
    );
    assert!(started.elapsed() < Duration::from_secs(3), "must not overrun the timeout");
}

#[tokio::test]
async fn link_device_propagates_an_opener_failure() {
    let (stub, server) = stub_server(
        1,
        Box::new(|_, _| (ok_status(), r#"{"authorizeUrl":"https://accounts.google.com/auth"}"#.to_string())),
    );

    let outcome = link_device(&stub, "key-abc", "mach-1", Duration::from_secs(5), |_| async {
        Err(BridgeError::Internal("no browser available".to_string()))
    })
    .await;
    server.join().expect("stub thread");

    assert!(
        matches!(outcome, Err(BridgeError::Internal(ref m)) if m.contains("no browser")),
        "{outcome:?}"
    );
}

