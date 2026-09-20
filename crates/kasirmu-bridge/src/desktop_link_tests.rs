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
