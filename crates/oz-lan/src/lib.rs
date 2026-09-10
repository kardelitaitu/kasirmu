/*
last audited 25-07-26 by RSA-Agent (desktop-client slice A: lan_server deep read; DC-1 FIXED 25-07-26; DC-1 FULL FIX 30-08-26)
crate: oz-lan | status: SAFE | lint: CLEAN
findings: DC-1 FIXED (mitigation) — the PSK handshake compare is now constant-time (psk_matches hashes both inputs with HMAC-SHA256 and compares digests via verify_slice; string == short-circuited on the first differing byte). Threat-model note added to the helper doc: the PSK still travels in cleartext in the hello JSON, so this handshake remains LAN discovery-filtering, not transport security. DC-1 FULL FIX 30-08-26 — noise-psk-v1 transport implemented: Noise_XXpsk3_25519_ChaChaPoly_SHA256 via `snow`, PSK mixed into message 3 so it never crosses the wire; first-byte transport selection (0x01 noise / '{' legacy) keeps old KDS clients working; static key derived deterministically from the PSK (domain-separated SHA-256). 5 new tests: handshake+encrypted-event roundtrip, wrong-PSK drop, unknown-selector drop, legacy hello accept, legacy hello reject. DC-2 FIXED — per-peer offline buffer pushes now route through buffer_event_for_peer with a drop-oldest cap of 1,024 events/peer (2 new tests: cap + per-peer isolation; 27 lan_server tests pass). Otherwise solid: handshake inside the spawned task (accept-loop DoS-safe), bounded broadcast with lagged-peer handling, safe 127.0.0.1 default with PSK required for external bind, heartbeat/replay design documented
next: deprecate legacy-psk-v1 once all KDS clients speak noise-psk-v1 | perf: N/A
*/
//! Headless LAN event transport for OZ-POS, extracted from
//! `apps/desktop-client/src/lan_server.rs` (Agent 1, Phase 1.1).
//!
//! Owns the TCP listener, the per-peer offline buffers and both PSK
//! transports; it has no dependency on Tauri, windowing or any GUI
//! crate, so a headless binary can drive it directly.
//!
//! Entry points: [`LanEventForwarder`] (construct with a bind address +
//! optional PSK, then `handle()` for a cloneable [`LanForwarderHandle`]
//! and `run()` to spawn the accept loop). Event-bus bridges are
//! [`SaleCompletedHandler`] / [`CourseFiredHandler`]; KDS discovery
//! payloads are [`KdsDiscoverResponse`].
//!
//! LAN event forwarder — a lightweight TCP server that broadcasts domain
//! events to KDS tablet peers on the local network.
//!
//! # Features
//!
//! - Broadcasts `sale.completed` and `order.course_fired` events to all
//!   connected LAN peers via newline-delimited JSON over TCP.
//! - Sends a `{"type":"ping"}` heartbeat every 5 seconds to detect
//!   silent disconnections.
//! - When a TCP write fails, buffers the undelivered event in an
//!   in-memory per-peer queue.
//! - When a peer reconnects, automatically flushes buffered events
//!   before entering the normal broadcast loop.
//!
//! # Wire format
//!
//! Each forwarded event is a single line of JSON terminated by `\n`:
//!
//! - `sale.completed`: `{"sale_id":"...","line_items":[...],...}`
//! - `order.course_fired`: `{"sale_id":"...","course_id":"...",...}`
//! - Heartbeat: `{"type":"ping"}`
//!
//! # Transports
//!
//! When a PSK is configured (external bind), the first stream byte
//! selects the transport:
//!
//! - `'{'` — **legacy-psk-v1**: the original cleartext JSON hello
//!   (`{"op":"hello","psk":"..."}`). Deprecated: the PSK travels in
//!   cleartext, so the handshake is LAN discovery-filtering only.
//! - `0x01` — **noise-psk-v1**: a `Noise_XXpsk3_25519_ChaChaPoly_SHA256`
//!   handshake in which the PSK is mixed into message 3 and never
//!   crosses the wire; a peer without the correct PSK cannot complete
//!   the handshake (the real DC-1 fix). Every message — handshake and
//!   transport — is framed as a 4-byte big-endian length followed by the
//!   payload; in transport mode each frame carries exactly one JSON
//!   event (the frame boundary replaces the newline), including
//!   discovery requests/responses and heartbeats.
//!
//! The reference client sequence lives in `lib_tests.rs`.
//!
//! # Example
//!
//! ```no_run
//! use oz_lan::LanEventForwarder;
//!
//! let forwarder = LanEventForwarder::default();
//! ```

use std::collections::HashMap;
use std::sync::Arc;

use foundation::contracts::{EventHandler, ModuleResult};
use oz_core::events::{CourseFired, SaleCompleted};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Mutex, broadcast};

/// Maximum number of pending broadcast messages before old ones are
/// dropped (avoids unbounded memory growth for slow peers).
const CHANNEL_CAPACITY: usize = 256;

/// Interval between heartbeat pings sent to each peer (seconds).
const HEARTBEAT_INTERVAL_SECS: u64 = 5;

/// Maximum number of events buffered for one disconnected peer (DC-2
/// fix: drop-oldest cap keeps a connect/disconnect cycle from growing
/// its per-peer queue without bound — each queued event is a JSON line,
/// so 1024 keeps memory per absent peer in the ~hundreds-of-KB range).
const MAX_OFFLINE_BUFFER_PER_PEER: usize = 1024;

/// Push `event` into the per-peer offline buffer with a drop-oldest cap.
///
/// DC-2 fix: both buffer sites (flush-failure re-buffer and live-write
/// failure) route through here so neither can grow a peer's queue past
/// [`MAX_OFFLINE_BUFFER_PER_PEER`]; when full, the oldest event is
/// dropped to make room.
async fn buffer_event_for_peer(
    buffer: &Mutex<HashMap<String, Vec<String>>>,
    peer_addr: &str,
    event: String,
) {
    let mut map = buffer.lock().await;
    let queue = map.entry(peer_addr.to_string()).or_default();
    if queue.len() >= MAX_OFFLINE_BUFFER_PER_PEER {
        queue.remove(0);
        tracing::debug!(peer = %peer_addr, "offline buffer full, oldest event dropped");
    }
    queue.push(event);
}

/// Timeout for the PSK handshake (seconds).
const PSK_HANDSHAKE_TIMEOUT_SECS: u64 = 5;

/// Constant-time equality for PSK comparison (DC-1 fix).
///
/// Both inputs are hashed with HMAC-SHA256 under a fixed local key and the
/// digests are compared with `verify_slice` (constant-time). String `==`
/// short-circuits on the first differing byte, leaking the matching-prefix
/// length of the secret through response timing. Length differences are
/// also absorbed because both sides collapse to equal-length digests.
///
/// # Threat-model note (DC-1)
///
/// The PSK still travels **in cleartext** inside the hello JSON, so a LAN
/// observer who sees the first connect learns the key — this handshake is
/// LAN discovery-filtering, not transport security. Upgrading to TLS (or a
/// noise-PSK handshake where the key never crosses the wire) is the real
/// fix and is tracked as future work.
fn psk_matches(provided: &str, expected: &str) -> bool {
    use hmac::{Hmac, Mac};
    type HmacSha256 = Hmac<sha2::Sha256>;
    let mut mac_provided = HmacSha256::new_from_slice(b"oz-lan-psk-compare")
        // INVARIANT: HMAC accepts keys of any length (RFC 2104), so a fixed
        // literal domain-separation key cannot fail.
        .expect("fixed key length is valid");
    mac_provided.update(provided.as_bytes());
    let mut mac_expected = HmacSha256::new_from_slice(b"oz-lan-psk-compare")
        // INVARIANT: HMAC accepts keys of any length (RFC 2104), so a fixed
        // literal domain-separation key cannot fail.
        .expect("fixed key length is valid");
    mac_expected.update(expected.as_bytes());
    mac_provided
        .verify_slice(&mac_expected.finalize().into_bytes())
        .is_ok()
}

/// First message a peer must send when PSK is configured.
#[derive(Debug, Deserialize)]
struct HelloMsg {
    op: String,
    psk: String,
}

/// A peer request for KDS discovery information.
#[derive(Debug, Deserialize)]
struct DiscoverMsg {
    op: String,
}

// ── noise-psk-v1 transport ───────────────────────────────────────────

/// Noise-PSK-v1 protocol selector byte. A peer whose first stream byte
/// is this value negotiates the encrypted transport; any other byte is
/// treated as the start of a legacy JSON hello.
const NOISE_MAGIC_BYTE: u8 = 0x01;

/// Noise handshake pattern for the `noise-psk-v1` LAN transport.
///
/// `XXpsk3` = mutual ephemeral key exchange with the pre-shared key
/// mixed into message 3: the PSK never crosses the wire, and a peer
/// without it cannot complete the handshake (unlike the legacy hello,
/// which sends the PSK in cleartext JSON — see the DC-1 note on
/// [`psk_matches`]).
const NOISE_PATTERN: &str = "Noise_XXpsk3_25519_ChaChaPoly_SHA256";

/// Maximum frame (ciphertext) size — the Noise protocol hard cap
/// (65535 bytes, enforced by snow's `write_message`/`read_message`).
const NOISE_MAX_FRAME: usize = 65535;

/// Derive the 32-byte Noise PSK from the configured passphrase.
///
/// snow requires exactly 32 bytes; SHA-256 expands the human-chosen
/// `lan_server.psk` setting deterministically so both ends derive the
/// same key from the shared secret without ever transmitting it.
fn noise_psk_bytes(psk: &str) -> [u8; 32] {
    Sha256::digest(psk.as_bytes()).into()
}

/// Derive the responder's Noise static private key from the PSK.
///
/// `XXpsk3` requires a responder static key (message 2 carries `s`).
/// Deriving it deterministically from the PSK — domain-separated from
/// [`noise_psk_bytes`] so the two 32-byte keys can never collide —
/// avoids persisting a key file for a LAN-only transport while still
/// binding each peer's advertised identity to the shared secret.
fn noise_static_secret(psk: &str) -> [u8; 32] {
    Sha256::digest(format!("oz-pos-lan-static|{psk}").as_bytes()).into()
}

/// Read one length-prefixed frame (4-byte big-endian length + payload).
async fn read_frame(stream: &mut TcpStream) -> std::io::Result<Vec<u8>> {
    let mut len_buf = [0u8; 4];
    stream.read_exact(&mut len_buf).await?;
    let len = u32::from_be_bytes(len_buf) as usize;
    if len > NOISE_MAX_FRAME {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("frame too large: {len} > {NOISE_MAX_FRAME}"),
        ));
    }
    let mut buf = vec![0u8; len];
    stream.read_exact(&mut buf).await?;
    Ok(buf)
}

/// Write one length-prefixed frame (4-byte big-endian length + payload).
async fn write_frame(stream: &mut TcpStream, data: &[u8]) -> std::io::Result<()> {
    stream.write_all(&(data.len() as u32).to_be_bytes()).await?;
    stream.write_all(data).await
}

/// Handshake step timed out.
fn handshake_timeout(step: &str) -> std::io::Error {
    std::io::Error::new(
        std::io::ErrorKind::TimedOut,
        format!("noise handshake {step} timed out"),
    )
}

/// Handshake step failed cryptographically or on the wire.
fn handshake_failed(step: &str, reason: impl std::fmt::Display) -> std::io::Error {
    std::io::Error::new(
        std::io::ErrorKind::InvalidData,
        format!("noise handshake {step} failed: {reason}"),
    )
}

/// Perform the server (responder) side of the noise-psk-v1 handshake.
///
/// Reads initiator message 1 (`-> e`), responds with message 2
/// (`<- e ee s es`), then authenticates message 3 (`-> s es psk3`),
/// where the PSK is mixed: a peer without the correct pre-shared key
/// fails here and is dropped, and the PSK itself never crosses the
/// wire. Every step is bounded by [`PSK_HANDSHAKE_TIMEOUT_SECS`].
async fn noise_handshake_responder(
    stream: &mut TcpStream,
    psk: &str,
) -> std::io::Result<snow::TransportState> {
    let dur = std::time::Duration::from_secs(PSK_HANDSHAKE_TIMEOUT_SECS);
    let params: snow::params::NoiseParams = NOISE_PATTERN
        .parse()
        .map_err(|e| handshake_failed("pattern", e))?;
    // Bound before the builder chain: `Builder<'builder>` keeps the key
    // references alive for its whole lifetime, so temporaries won't do.
    let static_secret = noise_static_secret(psk);
    let psk_bytes = noise_psk_bytes(psk);
    let mut hs = snow::Builder::new(params)
        .local_private_key(&static_secret)
        .map_err(|e| handshake_failed("static key", e))?
        .psk(3, &psk_bytes)
        .map_err(|e| handshake_failed("psk", e))?
        .build_responder()
        .map_err(|e| handshake_failed("responder init", e))?;
    let mut buf = vec![0u8; NOISE_MAX_FRAME];

    // Message 1: -> e
    let msg1 = match tokio::time::timeout(dur, read_frame(stream)).await {
        Ok(Ok(m)) => m,
        Ok(Err(e)) => return Err(e),
        Err(_) => return Err(handshake_timeout("msg1 read")),
    };
    if let Err(e) = hs.read_message(&msg1, &mut buf) {
        return Err(handshake_failed("msg1", e));
    }

    // Message 2: <- e ee s es
    let n = hs
        .write_message(&[], &mut buf)
        .map_err(|e| handshake_failed("msg2", e))?;
    match tokio::time::timeout(dur, write_frame(stream, &buf[..n])).await {
        Ok(Ok(())) => {}
        Ok(Err(e)) => return Err(e),
        Err(_) => return Err(handshake_timeout("msg2 write")),
    }

    // Message 3: -> s es psk3 — the PSK authenticates the initiator
    // here; a wrong PSK fails the MAC check and the peer is dropped.
    let msg3 = match tokio::time::timeout(dur, read_frame(stream)).await {
        Ok(Ok(m)) => m,
        Ok(Err(e)) => return Err(e),
        Err(_) => return Err(handshake_timeout("msg3 read")),
    };
    if let Err(e) = hs.read_message(&msg3, &mut buf) {
        return Err(handshake_failed("msg3 (bad PSK or tampering)", e));
    }

    hs.into_transport_mode()
        .map_err(|e| handshake_failed("transport switch", e))
}

/// Write surface for one authenticated peer session.
///
/// `Plain` preserves the original wire format (newline-delimited JSON).
/// `Noise` wraps each event in one encrypted frame — the frame boundary
/// replaces the newline, so the JSON payload inside a frame carries no
/// trailing `\n`. Events larger than [`NOISE_MAX_FRAME`] cannot be
/// encrypted as a single Noise message; the resulting write error is
/// treated like any delivery failure (the event is offline-buffered,
/// itself capped at [`MAX_OFFLINE_BUFFER_PER_PEER`]).
enum PeerTx {
    Plain(TcpStream),
    Noise(TcpStream, snow::TransportState),
}

impl PeerTx {
    /// Write one event or heartbeat: a JSON line for plain peers, one
    /// encrypted frame for noise peers.
    async fn send_line(&mut self, line: &str) -> std::io::Result<()> {
        match self {
            PeerTx::Plain(stream) => stream.write_all(format!("{line}\n").as_bytes()).await,
            PeerTx::Noise(stream, state) => {
                let mut out = vec![0u8; line.len() + 32];
                let n = state
                    .write_message(line.as_bytes(), &mut out)
                    .map_err(|e| {
                        std::io::Error::new(
                            std::io::ErrorKind::InvalidData,
                            format!("noise encrypt failed: {e}"),
                        )
                    })?;
                write_frame(stream, &out[..n]).await
            }
        }
    }
}

// ── LanEventForwarder ────────────────────────────────────────────────

/// A lightweight TCP event forwarder that broadcasts domain events to
/// LAN peers (KDS tablets, secondary displays, etc.).
///
/// Clone the handle for passing into `tokio::spawn` or event handlers.
#[derive(Clone)]
pub struct LanEventForwarder {
    tx: broadcast::Sender<String>,
    /// Per-peer offline buffer. Maps peer address → buffered JSON events
    /// that could not be delivered due to disconnection.
    offline_buffer: Arc<Mutex<HashMap<String, Vec<String>>>>,
    /// TCP bind address (e.g. `"127.0.0.1:9180"` or `"0.0.0.0:9180"`).
    bind_addr: String,
    /// Optional pre-shared key for external bind mode.
    /// When `Some`, peers must authenticate on connect — either the
    /// legacy `{"op":"hello","psk":"<value>"}` JSON hello or the
    /// noise-psk-v1 handshake (first byte `0x01`) — or the connection
    /// is dropped. The noise handshake is preferred: the PSK never
    /// crosses the wire.
    psk: Option<Arc<String>>,
    /// Discovery payload returned when a peer sends `{"op":"discover"}`.
    /// Set at construction time; `None` disables discovery responses.
    discovery_payload: Option<Arc<String>>,
}

/// Handle for registering event bus handlers.
///
/// Obtained via [`LanEventForwarder::handle()`].
#[derive(Clone)]
pub struct LanForwarderHandle {
    tx: broadcast::Sender<String>,
}

impl LanEventForwarder {
    /// Create a new forwarder with an empty offline buffer.
    pub fn new(bind_addr: String, psk: Option<String>) -> Self {
        let (tx, _) = broadcast::channel(CHANNEL_CAPACITY);
        Self {
            tx,
            offline_buffer: Arc::new(Mutex::new(HashMap::new())),
            bind_addr,
            psk: psk.map(Arc::new),
            discovery_payload: None,
        }
    }

    /// Set the discovery payload for KDS device enrollment.
    ///
    /// When set, a peer can send `{"op":"discover"}` after the
    /// PSK handshake (if any) and receive this JSON payload as a
    /// response. The payload should contain the restaurant POS
    /// identity, active devices, and version information.
    pub fn with_discovery(mut self, payload: String) -> Self {
        self.discovery_payload = Some(Arc::new(payload));
        self
    }

    /// Return a handle for registering event bus subscribers.
    pub fn handle(&self) -> LanForwarderHandle {
        LanForwarderHandle {
            tx: self.tx.clone(),
        }
    }

    /// Bind the TCP listener and start accepting connections.
    ///
    /// Spawns a tokio task for each accepted connection that:
    /// 1. Optionally performs a PSK handshake (for external bind)
    /// 2. Flushes any buffered events for this peer address
    /// 3. Subscribes to the broadcast channel
    /// 4. Sends heartbeat pings every 5s
    /// 5. Buffers events on write failure and exits
    pub async fn run(self) {
        let listener = match TcpListener::bind(&self.bind_addr).await {
            Ok(l) => {
                tracing::info!(address = %self.bind_addr, "LAN event forwarder started");
                l
            }
            Err(e) => {
                tracing::error!(address = %self.bind_addr, error = %e, "failed to bind LAN forwarder");
                return;
            }
        };

        let psk = self.psk.clone();

        loop {
            match listener.accept().await {
                Ok((stream, peer_addr)) => {
                    let addr = peer_addr.to_string();
                    tracing::debug!(peer = %addr, "LAN peer connected");

                    // Drain buffered events for this peer before subscribing.
                    let initial_events: Vec<String> = self
                        .offline_buffer
                        .lock()
                        .await
                        .remove(&addr)
                        .unwrap_or_default();

                    if !initial_events.is_empty() {
                        tracing::info!(
                            peer = %addr,
                            count = initial_events.len(),
                            "flushing buffered LAN events on reconnection"
                        );
                    }

                    let rx = self.tx.subscribe();
                    let buffer = self.offline_buffer.clone();
                    let psk_clone = psk.clone();
                    let discovery = self.discovery_payload.clone();
                    tokio::spawn(handle_peer(
                        stream,
                        addr,
                        rx,
                        buffer,
                        initial_events,
                        psk_clone,
                        discovery,
                    ));
                }
                Err(e) => {
                    tracing::warn!(error = %e, "LAN accept failed");
                }
            }
        }
    }

    /// Send an event JSON string to all connected peers.
    ///
    /// Multi-terminal: events broadcast to ALL connected terminals in the
    /// same store. Terminal-specific events (e.g., KDS ack) should be
    /// filtered by the receiver using terminal_id from the event payload.
    ///
    /// This is non-blocking — broadcast messages are queued in the
    /// channel and delivered asynchronously.
    pub fn broadcast(&self, event_json: String) {
        let _ = self.tx.send(event_json);
    }

    /// Return the number of buffered events across all disconnected peers.
    pub async fn buffered_count(&self) -> usize {
        let buf = self.offline_buffer.lock().await;
        buf.values().map(|v| v.len()).sum()
    }

    /// Return the number of distinct peer addresses with buffered events.
    pub async fn buffered_peer_count(&self) -> usize {
        self.offline_buffer.lock().await.len()
    }
}

impl Default for LanEventForwarder {
    fn default() -> Self {
        Self::new("127.0.0.1:9180".to_string(), None)
    }
}

/// Discovery endpoint response for KDS device enrollment.
#[derive(Debug, serde::Serialize)]
pub struct KdsDiscoverResponse {
    /// The Restaurant POS terminal ID.
    pub restaurant_pos_id: String,
    /// Active KDS devices registered under this POS.
    pub devices: Vec<oz_core::kds::KdsDevice>,
    /// Application version.
    pub version: &'static str,
    /// LAN transports this POS accepts, in preference order:
    /// `"noise-psk-v1"` (encrypted, PSK never crosses the wire) then
    /// `"legacy-psk-v1"` (cleartext JSON hello, deprecated for external
    /// binds). Clients should use the first transport they support.
    pub transports: Vec<&'static str>,
}

// ── Peer handler ─────────────────────────────────────────────────────

/// Read events from the broadcast channel and forward them to one peer.
///
/// Phase 0 selects and authenticates the transport (noise-psk-v1 or
/// legacy-psk-v1 hello) when a PSK is configured; loopback binds without
/// a PSK keep the original passive-connect behavior. Phase 1 answers an
/// optional discovery request, Phase 2 flushes offline-buffered events,
/// and Phase 3 streams broadcast events with a 5-second heartbeat. All
/// writes go through [`PeerTx`], so a noise peer receives the same JSON
/// events inside encrypted frames. When a write fails, the undelivered
/// message is pushed to the offline buffer keyed by `peer_addr` so it
/// can be replayed on reconnection.
///
/// The handshake runs inside the spawned task so a slow/malicious peer
/// cannot block the accept loop (DoS protection).
async fn handle_peer(
    mut stream: TcpStream,
    peer_addr: String,
    mut rx: broadcast::Receiver<String>,
    offline_buffer: Arc<Mutex<HashMap<String, Vec<String>>>>,
    initial_events: Vec<String>,
    psk: Option<Arc<String>>,
    discovery_payload: Option<Arc<String>>,
) {
    let timeout_dur = std::time::Duration::from_secs(PSK_HANDSHAKE_TIMEOUT_SECS);

    // Phase 0: authentication + transport selection (only when a PSK is
    // configured — the external-bind mode). The first stream byte picks
    // the protocol: 0x01 = noise-psk-v1 (encrypted, key never crosses
    // the wire), '{' = legacy-psk-v1 cleartext JSON hello.
    let mut conn: PeerTx = if let Some(expected_psk) = &psk {
        let mut sel = [0u8; 1];
        match tokio::time::timeout(timeout_dur, stream.read_exact(&mut sel)).await {
            Ok(Ok(_)) => {}
            Ok(Err(e)) => {
                tracing::warn!(peer = %peer_addr, error = %e, "LAN handshake failed — read error");
                return;
            }
            Err(_elapsed) => {
                tracing::warn!(peer = %peer_addr, "LAN handshake timed out");
                return;
            }
        }
        match sel[0] {
            NOISE_MAGIC_BYTE => {
                match tokio::time::timeout(
                    timeout_dur,
                    noise_handshake_responder(&mut stream, expected_psk),
                )
                .await
                {
                    Ok(Ok(state)) => {
                        tracing::debug!(peer = %peer_addr, "LAN noise-psk-v1 handshake accepted");
                        PeerTx::Noise(stream, state)
                    }
                    Ok(Err(e)) => {
                        tracing::warn!(peer = %peer_addr, error = %e, "LAN noise-psk-v1 handshake rejected");
                        return;
                    }
                    Err(_elapsed) => {
                        tracing::warn!(peer = %peer_addr, "LAN noise-psk-v1 handshake timed out");
                        return;
                    }
                }
            }
            b'{' => {
                // Legacy-psk-v1: the selector byte was the opening brace,
                // so rebuild the line and parse the rest of the hello.
                let mut line = String::from("{");
                let read_result = {
                    let mut reader = BufReader::new(&mut stream);
                    tokio::time::timeout(timeout_dur, reader.read_line(&mut line)).await
                };
                match read_result {
                    Ok(Ok(_)) => match serde_json::from_str::<HelloMsg>(line.trim()) {
                        // DC-1 fix: constant-time comparison (see
                        // `psk_matches`) instead of plain string equality.
                        Ok(msg) if msg.op == "hello" && psk_matches(&msg.psk, expected_psk) => {
                            tracing::debug!(peer = %peer_addr, "LAN legacy-psk-v1 handshake accepted");
                            PeerTx::Plain(stream)
                        }
                        _ => {
                            tracing::warn!(peer = %peer_addr, "LAN PSK handshake rejected — bad credentials");
                            return;
                        }
                    },
                    Ok(Err(e)) => {
                        tracing::warn!(peer = %peer_addr, error = %e, "LAN PSK handshake failed — read error");
                        return;
                    }
                    Err(_elapsed) => {
                        tracing::warn!(peer = %peer_addr, "LAN PSK handshake timed out");
                        return;
                    }
                }
            }
            other => {
                tracing::warn!(
                    peer = %peer_addr,
                    selector = other,
                    "LAN handshake rejected — unknown protocol selector"
                );
                return;
            }
        }
    } else {
        PeerTx::Plain(stream)
    };

    // Phase 1: Handle discovery request (if enabled). KDS devices send
    // `{"op":"discover"}` after connecting to learn the Restaurant POS
    // identity and available devices. The wire shape follows the
    // negotiated transport: plain peers read/write JSON lines, noise
    // peers read/write encrypted frames.
    if let Some(ref payload) = discovery_payload {
        match &mut conn {
            PeerTx::Noise(stream, state) => {
                match tokio::time::timeout(timeout_dur, read_frame(stream)).await {
                    Ok(Ok(ct)) => {
                        let mut pt = vec![0u8; ct.len()];
                        let mut answered = false;
                        if let Ok(n) = state.read_message(&ct, &mut pt) {
                            let text = std::str::from_utf8(&pt[..n]).unwrap_or("");
                            if serde_json::from_str::<DiscoverMsg>(text)
                                .map(|m| m.op == "discover")
                                .unwrap_or(false)
                            {
                                let mut out = vec![0u8; payload.len() + 32];
                                if let Ok(en) = state.write_message(payload.as_bytes(), &mut out) {
                                    let sent = tokio::time::timeout(
                                        timeout_dur,
                                        write_frame(stream, &out[..en]),
                                    )
                                    .await;
                                    if matches!(sent, Ok(Ok(()))) {
                                        tracing::debug!(
                                            peer = %peer_addr,
                                            "KDS discovery response sent (noise-psk-v1)"
                                        );
                                        answered = true;
                                    }
                                }
                            }
                        }
                        if !answered {
                            tracing::debug!(
                                peer = %peer_addr,
                                "noise discovery request invalid — proceeding to event stream"
                            );
                        }
                    }
                    Ok(Err(e)) => {
                        tracing::debug!(
                            peer = %peer_addr,
                            error = %e,
                            "discovery read failed"
                        );
                    }
                    Err(_elapsed) => {
                        // No discovery request — proceed to normal event streaming.
                    }
                }
            }
            PeerTx::Plain(stream) => {
                let mut line = String::new();
                let read_result = {
                    let mut reader = BufReader::new(&mut *stream);
                    tokio::time::timeout(timeout_dur, reader.read_line(&mut line)).await
                };
                match read_result {
                    Ok(Ok(_)) => {
                        if let Ok(msg) = serde_json::from_str::<DiscoverMsg>(line.trim())
                            && msg.op == "discover"
                        {
                            let response = format!("{payload}\n");
                            if let Err(e) = stream.write_all(response.as_bytes()).await {
                                tracing::debug!(
                                    peer = %peer_addr,
                                    error = %e,
                                    "failed to send discovery response"
                                );
                                return;
                            }
                            tracing::debug!(peer = %peer_addr, "KDS discovery response sent");
                        }
                    }
                    Ok(Err(e)) => {
                        tracing::debug!(
                            peer = %peer_addr,
                            error = %e,
                            "discovery read failed"
                        );
                    }
                    Err(_elapsed) => {
                        // No discovery request — proceed to normal event streaming.
                    }
                }
            }
        }
    }

    // Phase 2: Flush any buffered events first.
    for event in initial_events {
        if let Err(e) = conn.send_line(&event).await {
            tracing::debug!(
                peer = %peer_addr,
                error = %e,
                "failed to flush buffered events to reconnecting peer"
            );
            // Re-buffer the remaining events for next reconnect attempt
            // (drop-oldest capped).
            buffer_event_for_peer(&offline_buffer, &peer_addr, event).await;
            return;
        }
    }

    // Phase 3: Normal broadcast loop with heartbeat.
    let mut heartbeat =
        tokio::time::interval(std::time::Duration::from_secs(HEARTBEAT_INTERVAL_SECS));
    // Skip the immediate first tick so the heartbeat doesn't fire
    // before initial events are flushed.
    heartbeat.tick().await;

    loop {
        tokio::select! {
            biased;

            msg = rx.recv() => {
                match msg {
                    Ok(msg) => {
                        if let Err(e) = conn.send_line(&msg).await {
                            tracing::debug!(
                                peer = %peer_addr,
                                error = %e,
                                "LAN peer disconnected, event buffered"
                            );
                            // Buffer the event for replay on reconnection
                            // (drop-oldest capped).
                            buffer_event_for_peer(&offline_buffer, &peer_addr, msg).await;
                            return;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(count)) => {
                        tracing::warn!(peer = %peer_addr, skipped = count, "LAN peer lagged");
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        tracing::debug!(peer = %peer_addr, "LAN forwarder shutting down");
                        return;
                    }
                }
            }

            _ = heartbeat.tick() => {
                if let Err(e) = conn.send_line("{\"type\":\"ping\"}").await {
                    tracing::debug!(
                        peer = %peer_addr,
                        error = %e,
                        "LAN peer disconnected (heartbeat)"
                    );
                    return;
                }
            }
        }
    }
}

// ── Event bus handlers ───────────────────────────────────────────────

/// Handlers that bridge domain events to the LAN broadcast channel.
impl LanForwarderHandle {
    /// Create an `EventHandler<SaleCompleted>` that serialises the
    /// event to JSON and broadcasts it to all connected LAN peers.
    pub fn sale_completed_handler(&self) -> SaleCompletedHandler {
        SaleCompletedHandler {
            tx: self.tx.clone(),
        }
    }

    /// Create an `EventHandler<CourseFired>` that serialises the
    /// event to JSON and broadcasts it to all connected LAN peers.
    pub fn course_fired_handler(&self) -> CourseFiredHandler {
        CourseFiredHandler {
            tx: self.tx.clone(),
        }
    }
}

// ── SaleCompletedHandler ─────────────────────────────────────────────

/// Forwards `sale.completed` events to LAN peers as JSON.
pub struct SaleCompletedHandler {
    tx: broadcast::Sender<String>,
}

impl EventHandler<SaleCompleted> for SaleCompletedHandler {
    fn handle(&self, event: &SaleCompleted) -> ModuleResult {
        let json = serde_json::to_string(event)
            .map_err(|e| anyhow::anyhow!("serialising SaleCompleted: {e}"))?;
        let _ = self.tx.send(json);
        Ok(())
    }
}

// ── CourseFiredHandler ───────────────────────────────────────────────

/// Forwards `order.course_fired` events to LAN peers as JSON.
pub struct CourseFiredHandler {
    tx: broadcast::Sender<String>,
}

impl EventHandler<CourseFired> for CourseFiredHandler {
    fn handle(&self, event: &CourseFired) -> ModuleResult {
        let json = serde_json::to_string(event)
            .map_err(|e| anyhow::anyhow!("serialising CourseFired: {e}"))?;
        let _ = self.tx.send(json);
        Ok(())
    }
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
