//! Loopback listener for the desktop device link (ADR #54 §2.5).
//!
//! The app cannot receive Google's redirect itself — embedded webviews are prohibited and
//! a custom URI scheme is unsupported on Android — so it opens the system browser and
//! waits on a loopback port. This module owns that wait: bind, hand the shell a redirect
//! URI, then accept until a request actually carries the code or the failure reason.
//!
//! Key items: [`LoopbackListener`] and [`LinkCallback`].
//!
//! Invariants: the query is parsed and never reflected (the served page is static, so a
//! crafted `link_error` cannot inject markup into the browser), and a request carrying
//! neither parameter — the favicon fetch a browser makes right after the redirect — is
//! answered and ignored rather than ending the wait.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant};

use crate::error::BridgeError;

/// What the browser redirect carried back to the loopback listener.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkCallback {
    /// A one-time code to exchange for the linked account.
    Code(String),
    /// The flow failed; the server's short reason token, for the wizard to explain.
    Error(String),
}

/// The static page shown in the browser tab once the redirect lands.
///
/// Static on purpose: nothing from the query is interpolated, so no `link_error` value
/// can inject markup into a page the user is looking at.
const RELAY_PAGE: &str = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">\
    <title>OZ-POS</title></head><body style=\"font-family:system-ui;padding:3rem;text-align:center\">\
    <p>You can close this window and return to the app.</p></body></html>";

/// A bound loopback listener waiting for one device-link redirect.
#[derive(Debug)]
pub struct LoopbackListener {
    listener: TcpListener,
    port: u16,
}

impl LoopbackListener {
    /// Binds `127.0.0.1` on an ephemeral port.
    pub fn bind() -> Result<Self, BridgeError> {
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| {
            BridgeError::Internal(format!("could not bind the loopback listener: {e}"))
        })?;
        let port = listener
            .local_addr()
            .map_err(|e| BridgeError::Internal(format!("loopback address: {e}")))?
            .port();
        Ok(Self { listener, port })
    }

    /// The ephemeral port the browser must be sent back to.
    pub fn port(&self) -> u16 {
        self.port
    }

    /// The `redirect_uri` to hand the licence server.
    ///
    /// The literal loopback address, not `localhost`: the server accepts only the literal,
    /// and it is the form a hosts file or DNS cannot re-point at another host.
    pub fn redirect_uri(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    /// Waits for the redirect, answers the browser, and returns what it carried.
    ///
    /// Requests that carry neither parameter are answered and skipped, because the browser
    /// asks for `/favicon.ico` immediately after the redirect and consuming the one-shot
    /// accept on that request would hang the user's sign-in.
    pub fn wait_for_callback(self, timeout: Duration) -> Result<LinkCallback, BridgeError> {
        let deadline = Instant::now() + timeout;
        // Non-blocking so the deadline is honoured without a second thread.
        self.listener.set_nonblocking(true).map_err(|e| {
            BridgeError::Internal(format!("loopback listener setup: {e}"))
        })?;
        loop {
            if Instant::now() >= deadline {
                return Err(BridgeError::Internal(
                    "timed out waiting for the browser to return".to_string(),
                ));
            }
            match self.listener.accept() {
                Ok((stream, _)) => {
                    if let Some(outcome) = serve(stream)? {
                        return Ok(outcome);
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(20));
                }
                Err(e) => {
                    return Err(BridgeError::Internal(format!("loopback accept failed: {e}")));
                }
            }
        }
    }
}

/// Answers one request; `Some` when it carried the code or the reason.
fn serve(mut stream: TcpStream) -> Result<Option<LinkCallback>, BridgeError> {
    // The listener is non-blocking so the deadline is honoured; whether an accepted socket
    // inherits that is platform-defined, so say it explicitly — otherwise `read_line` can
    // return early on a request that has not arrived yet and the callback is lost.
    if let Err(e) = stream.set_nonblocking(false) {
        return Err(BridgeError::Internal(format!("loopback stream setup: {e}")));
    }
    let mut request_line = String::new();
    {
        let mut reader = BufReader::new(match stream.try_clone() {
            Ok(clone) => clone,
            Err(e) => return Err(BridgeError::Internal(format!("loopback clone: {e}"))),
        });
        // Only the request line is needed, and reading exactly one line keeps a browser
        // that never finishes its request from holding the wait open.
        let _ = reader.read_line(&mut request_line);
    }
    let outcome = parse_callback_target(&request_line);
    let (status, body) = if outcome.is_some() {
        ("200 OK", RELAY_PAGE)
    } else {
        ("404 Not Found", "")
    };
    write_response(&mut stream, status, body)?;
    Ok(outcome)
}

/// Writes a minimal HTTP/1.1 response and closes the connection.
fn write_response(stream: &mut TcpStream, status: &str, body: &str) -> Result<(), BridgeError> {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream
        .write_all(response.as_bytes())
        .map_err(|e| BridgeError::Internal(format!("loopback response: {e}")))?;
    let _ = stream.flush();
    Ok(())
}

/// Extracts the outcome from a request line, or `None` when it carries neither parameter.
///
/// A code wins over a reason: if both are present the server did hand one over.
fn parse_callback_target(request_line: &str) -> Option<LinkCallback> {
    let mut parts = request_line.split_whitespace();
    let _method = parts.next()?;
    let target = parts.next()?;
    let query = target.split_once('?')?.1;
    let mut code: Option<String> = None;
    let mut reason: Option<String> = None;
    for pair in query.split('&') {
        let (key, value) = match pair.split_once('=') {
            Some((key, value)) => (key, value),
            None => (pair, ""),
        };
        match key {
            "link_code" if !value.is_empty() => code = Some(decode_component(value)),
            "link_error" if !value.is_empty() => reason = Some(decode_component(value)),
            _ => {}
        }
    }
    if let Some(code) = code {
        return Some(LinkCallback::Code(code));
    }
    reason.map(LinkCallback::Error)
}

/// Decodes one query component: `%XX` escapes and `+` for space.
///
/// The values we expect are unreserved, but a decoder that does not decode is a bug
/// waiting for the first value that needs it — and the server escapes its reasons.
/// Works on bytes, so a stray non-ASCII sequence cannot panic on a char boundary.
fn decode_component(raw: &str) -> String {
    fn nibble(byte: u8) -> Option<u8> {
        match byte {
            b'0'..=b'9' => Some(byte - b'0'),
            b'a'..=b'f' => Some(byte - b'a' + 10),
            b'A'..=b'F' => Some(byte - b'A' + 10),
            _ => None,
        }
    }
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => match (nibble(bytes[i + 1]), nibble(bytes[i + 2])) {
                (Some(high), Some(low)) => {
                    out.push(high * 16 + low);
                    i += 3;
                }
                _ => {
                    out.push(bytes[i]);
                    i += 1;
                }
            },
            byte => {
                out.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}


/// Runs one device link from bind to linked account.
///
/// `open` receives the consent URL and is responsible for launching the browser; injecting
/// it is what keeps this function free of any UI toolkit, and lets a test drive the whole
/// flow — bind, PKCE, start, redirect, consume — without a window or a real browser. It is
/// async because every real opener is (the Tauri plugin is), and wrapping that in a
/// blocking call would park the very runtime the command runs on.
///
/// A failure the server reports through the redirect (`link_error`) becomes
/// [`BridgeError::Invalid`] so the wizard can explain it; a transport failure or a silent
/// browser stays [`BridgeError::Internal`].
pub async fn link_device<F, Fut>(
    base_url: &str,
    api_key: &str,
    machine_id: &str,
    timeout: std::time::Duration,
    open: F,
) -> Result<kasirmu_core::desktop_link::LinkedAccount, BridgeError>
where
    F: FnOnce(String) -> Fut,
    Fut: std::future::Future<Output = Result<(), BridgeError>>,
{
    use kasirmu_core::desktop_link::{generate_pkce, start_desktop_link, consume_desktop_link};

    let listener = LoopbackListener::bind()?;
    let redirect_uri = listener.redirect_uri();
    let pkce = generate_pkce();
    let state = kasirmu_core::attestation::generate_nonce();

    let authorize_url = start_desktop_link(
        base_url,
        api_key,
        machine_id,
        &state,
        &pkce.verifier,
        &redirect_uri,
    )
    .await?;

    // Open only after the flow is recorded server-side: a browser that arrives before the
    // pending state exists has nothing to complete.
    open(authorize_url).await?;

    // The wait blocks; parking it keeps the caller's runtime free.
    let outcome = tokio::task::spawn_blocking(move || listener.wait_for_callback(timeout))
        .await
        .map_err(|e| BridgeError::Internal(format!("loopback task failed: {e}")))??;

    let code = match outcome {
        LinkCallback::Code(code) => code,
        LinkCallback::Error(reason) => {
            return Err(BridgeError::Invalid(format!(
                "the sign-in was not completed ({reason})"
            )));
        }
    };
    // The `?` above converts through `From<CoreError>`; a tail expression must say so.
    consume_desktop_link(base_url, api_key, machine_id, &code)
        .await
        .map_err(BridgeError::from)
}
#[cfg(test)]
#[path = "desktop_link_tests.rs"]
mod tests;
