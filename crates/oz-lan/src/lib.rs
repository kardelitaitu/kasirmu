/*
last audited 25-07-26 by RSA-Agent (desktop-client slice A: lan_server deep read; DC-1 FIXED 25-07-26; DC-1 FULL FIX 30-08-26)
crate: oz-lan | status: SAFE | lint: CLEAN
findings: DC-1 FIXED (mitigation) — the PSK handshake compare is now constant-time (psk_matches hashes both inputs with HMAC-SHA256 and compares digests via verify_slice; string == short-circuited on the first differing byte). Threat-model note added to the helper doc: the PSK still travels in cleartext in the hello JSON, so this handshake remains LAN discovery-filtering, not transport security. DC-1 FULL FIX 30-08-26 — noise-psk-v1 transport implemented: Noise_XXpsk3_25519_ChaChaPoly_SHA256 via `snow`, PSK mixed into message 3 so it never crosses the wire; first-byte transport selection (0x01 noise / '{' legacy) keeps old KDS clients working; static key derived deterministically from the PSK (domain-separated SHA-256). 5 new tests: handshake+encrypted-event roundtrip, wrong-PSK drop, unknown-selector drop, legacy hello accept, legacy hello reject. DC-2 FIXED — per-peer offline buffer pushes now route through buffer_event_for_peer with a drop-oldest cap of 1,024 events/peer (2 new tests: cap + per-peer isolation; 27 lan_server tests pass). DEVICE-KEYED REPLAY 13-09-26 (agent 5) — the offline buffer moved into the `replay` module and is now keyed by the hello/discover `device_id` when the peer presents one: a reconnecting tablet dials from a NEW ephemeral port, so address keying could never find its queue in production (stamped by agent 4's live validation); device-less peers keep `peer_addr` keying. The drain moved from the accept loop into `handle_peer` phase 2 (the device_id is only known after the handshake), replay still obeys the station filter, and retention is bounded twice (1,024/queue + 8,192 total, drop-oldest, tracing::warn!). Wire format untouched. Otherwise solid: handshake inside the spawned task (accept-loop DoS-safe), bounded broadcast with lagged-peer handling, safe 127.0.0.1 default with PSK required for external bind, heartbeat/replay design documented
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
//! [`SaleCompletedHandler`] / [`CourseFiredHandler`] / [`KdsSyncHandler`];
//! KDS discovery payloads are [`KdsDiscoverResponse`]; multi-terminal KDS
//! state sync (typed events, station-scoped delivery, reconnect
//! snapshots) lives in the `kds_sync` module (re-exported here).
//!
//! LAN event forwarder — a lightweight TCP server that broadcasts domain
//! events to KDS tablet peers on the local network.
//!
//! # Features
//!
//! - Broadcasts `sale.completed` and `order.course_fired` events to all
//!   connected LAN peers via newline-delimited JSON over TCP.
//! - Broadcasts tagged [`kds_sync::KdsSyncEvent`] lines (`kds.order_placed`,
//!   `kds.line_item_bumped`, `kds.order_ready`, `kds.order_recalled`) with
//!   station-scoped delivery: peers subscribe via `station_ids` on their
//!   hello/discover line; peers with no or empty `station_ids` (Expo and
//!   all legacy clients) keep receiving everything.
//! - Sends a `{"type":"ping"}` heartbeat every 5 seconds to detect
//!   silent disconnections.
//! - When a TCP write fails, buffers the undelivered event in an
//!   in-memory queue keyed by replay identity: the peer's `device_id`
//!   when its hello/discover presented one (a reconnecting tablet dials
//!   from a new ephemeral port, so device keying is what makes replay
//!   reachable in production), else its TCP address (legacy peers).
//! - When a peer reconnects, automatically flushes the queues its
//!   identity owns — the device queue plus any queue parked at its
//!   exact address — before entering the normal broadcast loop.
//! - A booting KDS peer can request an active-queue snapshot with
//!   `{"op":"discover","want_queue":true}`; the discovery response then
//!   carries a live `active_queue` [`KdsQueueSnapshot`]
//!   (see [`LanEventForwarder::with_kds_queue`]).
//!
//! # Wire format
//!
//! Each forwarded event is a single line of JSON terminated by `\n`:
//!
//! - `sale.completed`: `{"sale_id":"...","line_items":[...],...}`
//! - `order.course_fired`: `{"sale_id":"...","course_id":"...",...}`
//! - `kds.*`: `{"type":"kds.order_placed","kds_order_id":"...","stations":[...],...}`
//!   — the `"type"` tag is always the first key.
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

use std::collections::VecDeque;
use std::sync::Arc;

use foundation::contracts::{EventHandler, ModuleResult};
use oz_core::events::{CourseFired, SaleCompleted};
use serde::Deserialize;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;

mod kds_sync;
mod noise;
mod replay;

use replay::{OfflineReplayBuffer, ReplayKey};

pub(crate) use noise::{
    NOISE_MAGIC_BYTE, PeerTx, noise_handshake_responder, read_frame, write_frame,
};
// Re-exported only for the reference noise initiator sequence in
// `lib_tests.rs` (the module doc points at it).
#[cfg(test)]
pub(crate) use noise::{NOISE_MAX_FRAME, NOISE_PATTERN, noise_psk_bytes, noise_static_secret};

pub use kds_sync::{
    EVENT_LINE_ITEM_BUMPED, EVENT_ORDER_PLACED, EVENT_ORDER_READY, EVENT_ORDER_RECALLED,
    KDS_EVENT_TAG_PREFIX, KdsLineItemBumped, KdsOrderPlaced, KdsOrderReady, KdsOrderRecalled,
    KdsQueueProvider, KdsQueueSnapshot, KdsQueueTicket, KdsSyncEvent, KdsSyncHandler,
    PeerSubscription, event_station_scope, should_deliver,
};

/// Maximum number of pending broadcast messages before old ones are
/// dropped (avoids unbounded memory growth for slow peers).
const CHANNEL_CAPACITY: usize = 256;

/// Interval between heartbeat pings sent to each peer (seconds).
const HEARTBEAT_INTERVAL_SECS: u64 = 5;

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
///
/// `station_ids`/`device_id` are the kds-sync subscription fields; both
/// are `#[serde(default)]` so a pre-kds-sync hello line parses unchanged
/// and yields no subscription (see [`kds_sync`] for the wire-compat story).
#[derive(Debug, Deserialize)]
struct HelloMsg {
    op: String,
    psk: String,
    #[serde(default)]
    station_ids: Vec<String>,
    #[serde(default)]
    device_id: Option<String>,
}

/// A peer request for KDS discovery information.
///
/// `want_queue` opts the response into a live `active_queue` snapshot
/// injection (see `kds_sync::build_discovery_response`); `station_ids`
/// and `device_id` carry the same subscription semantics as on
/// [`HelloMsg`] for loopback binds without a PSK. All are
/// `#[serde(default)]` — legacy `{"op":"discover"}` bytes parse as before.
#[derive(Debug, Deserialize)]
struct DiscoverMsg {
    op: String,
    #[serde(default)]
    want_queue: bool,
    #[serde(default)]
    station_ids: Vec<String>,
    #[serde(default)]
    device_id: Option<String>,
}

// ── LanEventForwarder ────────────────────────────────────────────────

/// A lightweight TCP event forwarder that broadcasts domain events to
/// LAN peers (KDS tablets, secondary displays, etc.).
///
/// Clone the handle for passing into `tokio::spawn` or event handlers.
#[derive(Clone)]
pub struct LanEventForwarder {
    tx: broadcast::Sender<String>,
    /// Undelivered events awaiting replay, keyed by replay identity:
    /// `device_id` when the peer presented one, else the peer address
    /// (see the `replay` module).
    offline_buffer: OfflineReplayBuffer,
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
    /// Live active-queue snapshot source for reconnecting KDS peers
    /// (`{"op":"discover","want_queue":true}`). `None` disables snapshot
    /// injection — legacy discovery responses are then byte-identical.
    kds_queue: Option<KdsQueueProvider>,
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
            offline_buffer: OfflineReplayBuffer::new(),
            bind_addr,
            psk: psk.map(Arc::new),
            discovery_payload: None,
            kds_queue: None,
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

    /// Attach a live active-queue snapshot provider for KDS reconnect
    /// reconciliation.
    ///
    /// When set **and** a peer's discovery request carries
    /// `want_queue: true`, the discovery response gains an `active_queue`
    /// key holding a [`KdsQueueSnapshot`] captured at response time
    /// (injection logic: [`kds_sync::build_discovery_response`]). Peers
    /// that do not opt in — every pre-kds-sync client — receive the
    /// payload byte-identically, so this is wire-compatible by
    /// construction. Requires [`Self::with_discovery`] as the response
    /// envelope.
    ///
    /// The provider runs synchronously inside the per-peer accept task:
    /// keep it cheap (serve from an in-memory cache; never block on a
    /// long SQLite read from inside the tokio task).
    //
    // INTEGRATION(oz-lan kds-sync): desktop-client owns the provider
    // wiring — build the KdsQueueProvider at startup in lib.rs next to
    // `LanEventForwarder::new(...)` (chain `.with_kds_queue(...)` after
    // `.with_discovery(...)`), sourcing tickets from the kds_orders /
    // kds_line_items rows and stations from `oz_core::kds::
    // resolve_kds_targets`. Not edited here: apps/desktop-client/** is
    // owned by the live registration-gate session.
    pub fn with_kds_queue(mut self, provider: KdsQueueProvider) -> Self {
        self.kds_queue = Some(provider);
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
    /// 2. Negotiates the peer's subscription and replays the buffered
    ///    events its replay identity owns — the `device_id` queue (when
    ///    the hello/discover carried one) plus any queue parked at the
    ///    exact peer address — before streaming goes live
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
        let kds_queue = self.kds_queue.clone();

        loop {
            match listener.accept().await {
                Ok((stream, peer_addr)) => {
                    let addr = peer_addr.to_string();
                    tracing::debug!(peer = %addr, "LAN peer connected");

                    // Replay-buffer draining happens inside `handle_peer`
                    // once the hello/discover line has revealed the
                    // peer's `device_id` (the accept loop knows only the
                    // ephemeral address, which a reconnecting tablet
                    // never presents twice).
                    let rx = self.tx.subscribe();
                    let buffer = self.offline_buffer.clone();
                    let psk_clone = psk.clone();
                    let discovery = self.discovery_payload.clone();
                    let kds_queue_clone = kds_queue.clone();
                    tokio::spawn(handle_peer(
                        stream,
                        addr,
                        rx,
                        buffer,
                        psk_clone,
                        discovery,
                        kds_queue_clone,
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
    /// Exception (kds-sync): lines tagged `{"type":"kds.*", ...}` are
    /// filtered **server-side** per peer by their station subscription
    /// ([`should_deliver`]) before delivery, so a station terminal never
    /// receives another station's tickets; Expo/legacy peers still get
    /// every line.
    ///
    /// This is non-blocking — broadcast messages are queued in the
    /// channel and delivered asynchronously.
    pub fn broadcast(&self, event_json: String) {
        let _ = self.tx.send(event_json);
    }

    /// Return the number of buffered events across all disconnected peers.
    pub async fn buffered_count(&self) -> usize {
        self.offline_buffer.event_count().await
    }

    /// Return the number of distinct replay identities (a `device_id`, or
    /// a legacy peer address) with buffered events.
    pub async fn buffered_peer_count(&self) -> usize {
        self.offline_buffer.queue_count().await
    }
}

impl Default for LanEventForwarder {
    fn default() -> Self {
        Self::new("127.0.0.1:9180".to_string(), None)
    }
}

/// Discovery endpoint response for KDS device enrollment.
///
/// Deserializes too (kds-sync): a reconnecting KDS peer parses the
/// response — including the optional [`KdsQueueSnapshot`] injected under
/// `active_queue` — with this same type. Pre-kds-sync payloads omit the
/// field and still deserialize thanks to `#[serde(default)]`.
///
/// Fields are owned `String`s: `&'static str` fields make the serde
/// derive emit `Deserialize<'static>` only, which is not
/// `DeserializeOwned`, so a peer could never parse a wire response held
/// in an owned buffer. The JSON bytes are unchanged by the field types.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct KdsDiscoverResponse {
    /// The Restaurant POS terminal ID.
    pub restaurant_pos_id: String,
    /// Active KDS devices registered under this POS.
    pub devices: Vec<oz_core::kds::KdsDevice>,
    /// Application version.
    pub version: String,
    /// LAN transports this POS accepts, in preference order:
    /// `"noise-psk-v1"` (encrypted, PSK never crosses the wire) then
    /// `"legacy-psk-v1"` (cleartext JSON hello, deprecated for external
    /// binds). Clients should use the first transport they support.
    pub transports: Vec<String>,
    /// Reconnect reconciliation (kds-sync): the live active-queue
    /// snapshot, present only when the peer's discovery request opted
    /// in with `want_queue: true` **and** a provider is configured via
    /// [`LanEventForwarder::with_kds_queue`]. `skip_serializing_if`
    /// keeps non-opting traffic byte-identical to the pre-kds-sync
    /// response.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_queue: Option<KdsQueueSnapshot>,
}

// ── Peer handler ─────────────────────────────────────────────────────

/// Read events from the broadcast channel and forward them to one peer.
///
/// Phase 0 selects and authenticates the transport (noise-psk-v1 or
/// legacy-psk-v1 hello) when a PSK is configured; loopback binds without
/// a PSK keep the original passive-connect behavior. A legacy hello may
/// additionally carry the kds-sync subscription fields (`station_ids`,
/// `device_id`) — absent on pre-kds-sync clients, which then receive
/// every event as before. Phase 1 answers an optional discovery request,
/// injecting a live `active_queue` snapshot when the peer opts in with
/// `want_queue` and a [`KdsQueueProvider`] is configured, and may refine
/// the subscription on loopback binds. Phase 2 flushes offline-buffered
/// events, phase 3 streams broadcast events with a 5-second heartbeat —
/// both gated by [`should_deliver`], so a station-scoped peer only ever
/// sees tickets routed to its stations (and all unscoped/legacy traffic;
/// Expo peers and unregistered peers see everything). All writes go
/// through [`PeerTx`], so a noise peer receives the same JSON events
/// inside encrypted frames. When a write fails, the undelivered message
/// is pushed to the offline replay buffer under the peer's replay
/// identity — its `device_id` when the hello/discover carried one, so
/// the queue survives a reconnect on a new ephemeral port, else
/// `peer_addr` (the pre-kds-sync contract). Phase 2 drains that
/// identity's queues — the device queue plus any queue parked at the
/// exact address — and replays them through the same station filter;
/// if a replay write itself fails, every still-undelivered line is
/// re-buffered under the queue it came from.
///
/// All reads share one connection-level [`BufReader`] created before
/// the first byte is read and moved into [`PeerTx`] at the end of the
/// handshake, so bytes a buffered read pulls past a newline — e.g. a
/// `discover` line pipelined into the same TCP segment as the legacy
/// `hello` — survive into phase 1 instead of dying with a transient
/// reader (the Phase-0 over-read defect this replaced).
///
/// The handshake runs inside the spawned task so a slow/malicious peer
/// cannot block the accept loop (DoS protection).
async fn handle_peer(
    stream: TcpStream,
    peer_addr: String,
    mut rx: broadcast::Receiver<String>,
    offline_buffer: OfflineReplayBuffer,
    psk: Option<Arc<String>>,
    discovery_payload: Option<Arc<String>>,
    kds_queue: Option<KdsQueueProvider>,
) {
    let timeout_dur = std::time::Duration::from_secs(PSK_HANDSHAKE_TIMEOUT_SECS);
    // Per-peer kds-sync subscription; None = receive everything
    // (pre-kds-sync peers and Expo devices keep the legacy behavior).
    let mut subscription: Option<PeerSubscription> = None;

    // One connection-level BufReader for the entire connection: created
    // before the first byte is read, used by the phase-0 selector read,
    // the legacy hello, the noise handshake frames, and the phase-1
    // discovery read, then moved into `PeerTx` so nothing ever reads the
    // raw socket underneath it. A BufReader fills its 8 KB buffer past
    // the current newline; if that reader were transient (as the
    // phase-0 hello reader used to be) the over-read bytes die with it,
    // and a client that pipelines `hello\n{"op":"discover",...}\n` in
    // one TCP segment loses the discover line forever. Two readers must
    // never cover one stream at once.
    let mut reader = BufReader::new(stream);

    // Phase 0: authentication + transport selection (only when a PSK is
    // configured — the external-bind mode). The first stream byte picks
    // the protocol: 0x01 = noise-psk-v1 (encrypted, key never crosses
    // the wire), '{' = legacy-psk-v1 cleartext JSON hello.
    let mut conn: PeerTx = if let Some(expected_psk) = &psk {
        let mut sel = [0u8; 1];
        match tokio::time::timeout(timeout_dur, reader.read_exact(&mut sel)).await {
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
                // The reader already owns this borrow of the stream: the
                // selector read may have buffered message 1 (or more)
                // into it, so the handshake must consume through the
                // same reader to keep the frame sequence in wire order.
                match tokio::time::timeout(
                    timeout_dur,
                    noise_handshake_responder(&mut reader, expected_psk),
                )
                .await
                {
                    Ok(Ok(state)) => {
                        tracing::debug!(peer = %peer_addr, "LAN noise-psk-v1 handshake accepted");
                        PeerTx::Noise(reader, state)
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
                // The shared reader keeps any bytes that arrived after
                // the hello newline alive for phase 1.
                let mut line = String::from("{");
                let read_result =
                    tokio::time::timeout(timeout_dur, reader.read_line(&mut line)).await;
                match read_result {
                    Ok(Ok(_)) => match serde_json::from_str::<HelloMsg>(line.trim()) {
                        // DC-1 fix: constant-time comparison (see
                        // `psk_matches`) instead of plain string equality.
                        Ok(msg) if msg.op == "hello" && psk_matches(&msg.psk, expected_psk) => {
                            // kds-sync: honor optional subscription
                            // fields; a legacy hello yields None and the
                            // peer keeps receiving everything.
                            subscription =
                                kds_sync::subscription_from_wire(msg.station_ids, msg.device_id);
                            tracing::debug!(peer = %peer_addr, "LAN legacy-psk-v1 handshake accepted");
                            PeerTx::Plain(reader)
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
        PeerTx::Plain(reader)
    };

    // Phase 1: Handle discovery request (if enabled). KDS devices send
    // `{"op":"discover"}` after connecting to learn the Restaurant POS
    // identity and available devices. The wire shape follows the
    // negotiated transport: plain peers read/write JSON lines, noise
    // peers read/write encrypted frames.
    if let Some(ref payload) = discovery_payload {
        match &mut conn {
            PeerTx::Noise(stream, state) => {
                // Frames are read through the same connection-level
                // reader that consumed the selector byte and the
                // handshake frames, so a discover frame the client
                // wrote back-to-back with message 3 (buffered during
                // the handshake) is read in exact order.
                match tokio::time::timeout(timeout_dur, read_frame(stream)).await {
                    Ok(Ok(ct)) => {
                        let mut pt = vec![0u8; ct.len()];
                        let mut answered = false;
                        if let Ok(n) = state.read_message(&ct, &mut pt) {
                            let text = std::str::from_utf8(&pt[..n]).unwrap_or("");
                            if let Ok(d) = serde_json::from_str::<DiscoverMsg>(text)
                                && d.op == "discover"
                            {
                                // kds-sync: the discover line can carry
                                // the subscription on noise binds (there
                                // is no hello frame to attach it to), and
                                // `want_queue` opts the response into a
                                // live active-queue snapshot.
                                if let Some(sub) =
                                    kds_sync::subscription_from_wire(d.station_ids, d.device_id)
                                {
                                    subscription = Some(sub);
                                }
                                let response = kds_sync::build_discovery_response(
                                    payload,
                                    d.want_queue,
                                    kds_queue.as_ref(),
                                );
                                let mut out = vec![0u8; response.len() + 32];
                                if let Ok(en) = state.write_message(response.as_bytes(), &mut out) {
                                    let sent = tokio::time::timeout(
                                        timeout_dur,
                                        write_frame(stream.get_mut(), &out[..en]),
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
                // Reads go through the phase-0 reader: a discover line
                // that arrived in the same TCP segment as the hello is
                // already sitting in its buffer. Writes bypass the
                // reader via `get_mut()` — it never buffers writes, so
                // the socket sees the response byte-identically.
                let mut line = String::new();
                let read_result =
                    tokio::time::timeout(timeout_dur, stream.read_line(&mut line)).await;
                match read_result {
                    Ok(Ok(_)) => {
                        if let Ok(d) = serde_json::from_str::<DiscoverMsg>(line.trim())
                            && d.op == "discover"
                        {
                            // kds-sync: subscription refinement + opt-in
                            // snapshot injection (see the noise branch
                            // above for the same rules on PSK binds).
                            if let Some(sub) =
                                kds_sync::subscription_from_wire(d.station_ids, d.device_id)
                            {
                                subscription = Some(sub);
                            }
                            let response = kds_sync::build_discovery_response(
                                payload,
                                d.want_queue,
                                kds_queue.as_ref(),
                            );
                            let response = format!("{response}\n");
                            if let Err(e) = stream.get_mut().write_all(response.as_bytes()).await {
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

    // Phase 2: Replay buffered events, applying the peer's station
    // scope so replayed lines obey the same filter as live traffic (a
    // line outside this peer's scope is dropped here). The replay
    // identity is the peer's `device_id` when the handshake presented
    // one — the queue then survives a reconnect on a new ephemeral
    // port, which is the production case (a tablet's source port
    // changes every dial, so an address-keyed buffer was never found
    // again). The queue parked at this exact address is also always
    // claimed first: that is the legacy contract for device-less
    // peers, and it keeps the pre-device behavior byte-for-byte when
    // an address genuinely recurs (the old accept-loop drain keyed
    // solely on `peer_addr` and ran before any handshake).
    let replay_key = ReplayKey::from_subscription(subscription.as_ref(), &peer_addr);
    let addr_key = ReplayKey::Addr(peer_addr.clone());
    let mut pending: VecDeque<(ReplayKey, String)> = VecDeque::new();
    pending.extend(
        offline_buffer
            .drain(&addr_key)
            .await
            .events
            .into_iter()
            .map(|event| (addr_key.clone(), event)),
    );
    if let ReplayKey::Device(device_id) = &replay_key {
        let device_drain = offline_buffer.drain(&replay_key).await;
        if !device_drain.events.is_empty() {
            if let Some(source) = device_drain.source_addr.as_deref() {
                if source != peer_addr {
                    tracing::info!(
                        device = %device_id,
                        buffered_at = %source,
                        reconnected_at = %peer_addr,
                        count = device_drain.events.len(),
                        "offline replay buffer handed off to a new peer address"
                    );
                }
            }
            pending.extend(
                device_drain
                    .events
                    .into_iter()
                    .map(|event| (replay_key.clone(), event)),
            );
        }
    }
    if !pending.is_empty() {
        tracing::info!(
            peer = %peer_addr,
            count = pending.len(),
            "flushing buffered LAN events on reconnection"
        );
    }
    while let Some((key, event)) = pending.pop_front() {
        if !should_deliver(subscription.as_ref(), &event) {
            continue;
        }
        if let Err(e) = conn.send_line(&event).await {
            tracing::debug!(
                peer = %peer_addr,
                error = %e,
                "failed to flush buffered events to reconnecting peer"
            );
            // Re-buffer the failed line plus every still-queued one,
            // each under the key it was drained from (caps enforced by
            // `push`).
            let mut undelivered: VecDeque<(ReplayKey, String)> =
                std::iter::once((key, event)).collect();
            undelivered.append(&mut pending);
            for (rk, ev) in undelivered {
                offline_buffer.push(&rk, &peer_addr, ev).await;
            }
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
                        // kds-sync: station-scoped peer filter — a line
                        // outside this peer's stations is dropped, not
                        // buffered (it belongs to another station).
                        if !should_deliver(subscription.as_ref(), &msg) {
                            continue;
                        }
                        if let Err(e) = conn.send_line(&msg).await {
                            tracing::debug!(
                                peer = %peer_addr,
                                error = %e,
                                "LAN peer disconnected, event buffered"
                            );
                            // Buffer the event for replay on reconnection
                            // under this peer's replay identity (caps
                            // enforced by `push`).
                            offline_buffer.push(&replay_key, &peer_addr, msg).await;
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

    /// Create an `EventHandler<KdsSyncEvent>` that serialises the
    /// tagged multi-terminal KDS sync event to JSON and broadcasts it
    /// to connected LAN peers, subject to per-peer station filtering
    /// (see [`should_deliver`] and the `kds_sync` module docs).
    //
    // INTEGRATION(oz-lan kds-sync): desktop-client registers this next
    // to the existing two in apps/desktop-client/src/lib.rs `setup`:
    //     bus.subscribe("kds.sync", Box::new(handle.kds_sync_handler()));
    // Commands in apps/desktop-client/src/commands/kds.rs then publish
    // the four `kds.*` transitions as `KdsSyncEvent` values (placed /
    // bumped / ready / recalled) on the kernel event bus. Not edited
    // here: apps/desktop-client/** is owned by the live
    // registration-gate session.
    pub fn kds_sync_handler(&self) -> KdsSyncHandler {
        KdsSyncHandler {
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
