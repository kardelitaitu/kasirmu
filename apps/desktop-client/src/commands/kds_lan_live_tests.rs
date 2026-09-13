//! Dual-terminal LIVE validation of the LAN KDS sync (todo-kds-agents-4).
//!
//! Unlike the crate's own unit tests, these run the real stack end to end:
//! a live `LanEventForwarder` on 127.0.0.1 with a PSK, two peers speaking
//! the real wire protocol (a `["grill"]` station terminal and an Expo
//! terminal with empty `station_ids`), events published on the *real*
//! kernel bus of an `AppState::for_test()` through the production
//! `publish_kds_sync` shim, and assertions made over the socket bytes each
//! peer actually reads.
//!
//! Proofs: (1) station-scoped live delivery, (2) offline-buffer replay on
//! reconnect to the same peer address — positive and filter-respecting,
//! (3) the reconnect snapshot served from `AppState::kds_queue_cache` with
//! legacy byte-identity of the plain discovery response.
//!
//! Layer reached: bus + production publish seam. The command wrappers
//! above `publish_kds_sync` need a `tauri::State<AppState>` *and* a seeded
//! store DB + session + routing rows (owned by a live sibling session),
//! so they stay un-invoked — stamped in `todo-kds-agents-4.md`.
//!
//! One genuine `oz-lan` defect was found and NOT fixed (fence): the
//! Phase-0 hello reader over-reads and can swallow a following discover
//! line. The green proofs pace their writes client-side; the red-by-
//! construction `kds_lan_live_bugdemo_...` test documents the bug.

use std::net::SocketAddr;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpSocket;
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};

use crate::lan_server::{KdsDiscoverResponse, KdsQueueProvider, LanEventForwarder};

use super::*;

/// PSK the live forwarder is started with — every peer must hello with it.
const PSK: &str = "kds-live-test-psk";

/// Discovery payload shaped exactly like the lib.rs one (hand-built so the
/// byte-identity assertion has a fixed reference).
const PAYLOAD: &str = r#"{"restaurant_pos_id":"pos-live-1","devices":[],"version":"0.0.37-live","transports":["noise-psk-v1","legacy-psk-v1"]}"#;

/// Non-`kds.*` line broadcast after the last event: `should_deliver` has
/// "no opinion" about it, so every peer gets it — the end-of-stream mark.
const SENTINEL: &str = r#"{"sentinel":"kds-live-end"}"#;

/// The 5-second heartbeat line (skipped when collecting event lines).
const PING: &str = r#"{"type":"ping"}"#;

/// Bounded per-line read timeout. Comfortably above the 5 s heartbeat and
/// the 5 s Phase-1 discovery stall we always escape by sending a discover
/// line — no socket read in this file ever waits unbounded.
const LINE_TIMEOUT: Duration = Duration::from_secs(15);

// ── Wiring helpers ─────────────────────────────────────────────────────

/// Build the same queue provider lib.rs wires: a cheap `std` read lock on
/// `AppState::kds_queue_cache`, cloned verbatim from the setup block.
fn queue_provider_for(state: &AppState) -> KdsQueueProvider {
    let cache = state.kds_queue_cache.clone();
    Arc::new(move || {
        cache
            .read()
            .map(|snapshot| snapshot.clone())
            .unwrap_or_default()
    })
}

/// Register the forwarder's KDS handler on the real kernel bus of `state`,
/// exactly like the `kds.sync` subscriber in lib.rs setup does.
async fn wire_kds_handler(state: &AppState, hub: &LanEventForwarder) {
    let handle = hub.handle();
    let kernel = state.kernel.lock().await;
    let bus = kernel.event_bus();
    bus.subscribe("kds.sync", Box::new(handle.kds_sync_handler()));
}

/// Start a live `LanEventForwarder` (PSK + discovery payload + queue
/// provider) on a dynamically reserved loopback port and wait until its
/// accept loop answers connections. If the reserved port is stolen in the
/// drop→bind window, `run()` logs and returns; retry with a fresh one.
async fn spawn_live_forwarder(provider: KdsQueueProvider) -> (LanEventForwarder, SocketAddr) {
    for _attempt in 0..8u32 {
        let probe = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("no free loopback port for the probe bind");
        let port = probe.local_addr().expect("probe local_addr").port();
        drop(probe);
        let addr: SocketAddr = format!("127.0.0.1:{port}").parse().expect("server addr");
        let fwd = LanEventForwarder::new(addr.to_string(), Some(PSK.to_string()))
            .with_discovery(PAYLOAD.to_string())
            .with_kds_queue(provider.clone());
        let hub = fwd.clone();
        tokio::spawn(fwd.run());
        // Poll until the listener actually accepts. Each probe connection
        // is dropped by the PSK Phase-0 (no hello line) — harmless.
        let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
        while tokio::time::Instant::now() < deadline {
            if tokio::net::TcpStream::connect(addr).await.is_ok() {
                return (hub, addr);
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
    panic!("could not bring up a live LAN forwarder on a free loopback port");
}

/// One connected LAN peer: owned halves so the BufReader's buffered bytes
/// can never be lost between reads (a fresh reader per line would drop
/// events coalesced into one TCP segment).
struct LanPeer {
    /// Local (peer-side) socket port — the offline buffer's peer key.
    local_port: u16,
    w: OwnedWriteHalf,
    r: BufReader<OwnedReadHalf>,
}

/// PSK hello for a station-scoped peer (legacy-psk-v1 cleartext line —
/// the byte shape from the crate's own reference tests).
fn hello_station(stations: &[&str], device: &str) -> String {
    serde_json::json!({
        "op": "hello", "psk": PSK, "station_ids": stations, "device_id": device,
    })
    .to_string()
}

/// PSK hello with an explicit empty `station_ids` — the Expo shape.
fn hello_expo(device: &str) -> String {
    serde_json::json!({ "op": "hello", "psk": PSK, "station_ids": [], "device_id": device })
        .to_string()
}

/// Byte-for-byte pre-kds-sync hello: no subscription fields at all.
fn hello_legacy() -> String {
    serde_json::json!({ "op": "hello", "psk": PSK }).to_string()
}

impl LanPeer {
    /// Connect; when `hello` is Some, send it as the Phase-0 PSK line.
    /// With `bind_port` Some, the peer socket is bound to that exact
    /// local port — the same address the server keys its offline buffer
    /// under. Binds and connects retry briefly (an explicitly-bound port
    /// is free again after an RST, but the OS may take a few
    /// milliseconds to release it).
    //
    // The 150 ms pacing sleep after the hello line is a client-side
    // workaround for an oz-lan defect stamped in todo-kds-agents-4.md:
    // handle_peer's Phase-0 BufReader over-reads past the hello newline
    // and DISCARDS whatever else has already arrived, so a discover line
    // written immediately after the hello can be silently lost (the
    // `kds_lan_live_bugdemo_...` test below demonstrates it on one
    // segment). Sleeping lets the accept task consume the hello first;
    // if a pathologically starved machine still beats the guard, the
    // discovery asserts fail loudly — never silently.
    //
    // The deprecated `set_linger` calls are deliberate: SO_LINGER with a
    // ZERO timeout does not block the thread on drop (the warning's
    // general case) — it aborts the connection with an RST, which is what
    // makes the server-side write-failure / offline-buffer path
    // observable deterministically in the reconnect proofs.
    #[allow(deprecated)]
    async fn connect(server: SocketAddr, hello: Option<&str>, bind_port: Option<u16>) -> LanPeer {
        let local: SocketAddr = format!("127.0.0.1:{}", bind_port.unwrap_or(0))
            .parse()
            .expect("peer local addr");
        let mut last_err = String::from("no attempt");
        for _attempt in 0..20u32 {
            let Ok(sock) = TcpSocket::new_v4() else {
                last_err = "TcpSocket::new_v4 failed".to_string();
                continue;
            };
            // Best effort: lets an explicit rebind succeed even if the OS
            // still considers the just-reset tuple reserved.
            sock.set_reuseaddr(true).ok();
            // Linger-0 so the eventual close sends RST: the server-side
            // socket becomes permanently errored, making the write-failure
            // offline-buffer path deterministic instead of racing FIN.
            sock.set_linger(Some(Duration::ZERO)).ok();
            if let Err(e) = sock.bind(local) {
                last_err = format!("bind {local}: {e}");
                tokio::time::sleep(Duration::from_millis(100)).await;
                continue;
            }
            let stream = match sock.connect(server).await {
                Ok(stream) => stream,
                Err(e) => {
                    last_err = format!("connect to {server}: {e}");
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    continue;
                }
            };
            stream.set_linger(Some(Duration::ZERO)).ok();
            let local_port = stream.local_addr().expect("peer local_addr").port();
            let (r, w) = stream.into_split();
            let mut peer = LanPeer {
                local_port,
                w,
                r: BufReader::new(r),
            };
            if let Some(hello) = hello {
                peer.write_line(hello).await;
                tokio::time::sleep(Duration::from_millis(150)).await;
            }
            return peer;
        }
        panic!(
            "peer could not reach {server} from {}: {last_err}",
            bind_port.map_or("any port".to_string(), |p| p.to_string()),
        );
    }

    async fn write_line(&mut self, line: &str) {
        self.w
            .write_all(format!("{line}\n").as_bytes())
            .await
            .expect("peer write line");
    }

    /// Read one `\n`-terminated line under a hard timeout. `None` only on
    /// EOF; a timeout panics — no read in this file can hang the suite.
    async fn read_line(&mut self) -> Option<String> {
        let mut buf = Vec::new();
        match tokio::time::timeout(LINE_TIMEOUT, self.r.read_until(b'\n', &mut buf)).await {
            Ok(Ok(0)) => None,
            Ok(Ok(_)) => Some(String::from_utf8_lossy(&buf).trim_end().to_string()),
            Ok(Err(e)) => panic!("peer read failed: {e}"),
            Err(_) => panic!("peer read timed out after {LINE_TIMEOUT:?}"),
        }
    }

    /// Send a discovery line (escaping the 5 s Phase-1 stall) and return
    /// the raw response line.
    async fn discover(&mut self, request: &str) -> String {
        self.write_line(request).await;
        self.read_line()
            .await
            .expect("discovery response line before EOF")
    }

    /// Collect event lines (heartbeat skipped) until the sentinel.
    async fn read_until_sentinel(&mut self) -> Vec<String> {
        let mut out = Vec::new();
        loop {
            let line = self
                .read_line()
                .await
                .expect("peer stream closed before the sentinel line");
            if line == SENTINEL {
                return out;
            }
            if line == PING {
                continue;
            }
            out.push(line);
        }
    }
}

/// Wait (bounded) for the forwarder's offline buffer to hold `want` lines.
async fn wait_buffered(hub: &LanEventForwarder, want: usize) -> bool {
    for _ in 0..60 {
        if hub.buffered_count().await == want {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    hub.buffered_count().await == want
}

// ── Event / ticket constructors ───────────────────────────────────────

fn stamp() -> String {
    "2026-09-13T08:00:00Z".to_string()
}

fn scoped(stations: &[&str]) -> Vec<String> {
    stations.iter().map(|s| s.to_string()).collect()
}

fn placed(stations: &[&str], id: &str) -> KdsSyncEvent {
    KdsSyncEvent::OrderPlaced(KdsOrderPlaced {
        kds_order_id: id.to_string(),
        sale_id: format!("sale-{id}"),
        store_id: None,
        stations: scoped(stations),
        display_number: Some(7),
        table_number: Some("T7".to_string()),
        ticket_prefix: "#".to_string(),
        items: vec![],
        notes: String::new(),
        priority: false,
        occurred_at: stamp(),
    })
}

fn bumped(stations: &[&str], id: &str) -> KdsSyncEvent {
    KdsSyncEvent::LineItemBumped(KdsLineItemBumped {
        kds_order_id: id.to_string(),
        sale_id: format!("sale-{id}"),
        line_item_id: format!("line-{id}"),
        stations: scoped(stations),
        to_status: "ready".to_string(),
        bumped_by: Some("term-live".to_string()),
        occurred_at: stamp(),
    })
}

fn ready(stations: &[&str], id: &str) -> KdsSyncEvent {
    KdsSyncEvent::OrderReady(KdsOrderReady {
        kds_order_id: id.to_string(),
        sale_id: format!("sale-{id}"),
        stations: scoped(stations),
        display_number: Some(7),
        ready_at: Some(stamp()),
        bumped_by: Some("term-live".to_string()),
        occurred_at: stamp(),
    })
}

fn recalled(stations: &[&str], id: &str) -> KdsSyncEvent {
    KdsSyncEvent::Recalled(KdsOrderRecalled {
        kds_order_id: id.to_string(),
        sale_id: format!("sale-{id}"),
        line_item_id: None,
        stations: scoped(stations),
        recall_to: "preparing".to_string(),
        reason: Some("forgot the steak".to_string()),
        occurred_at: stamp(),
    })
}

fn snapshot_order(id: &str) -> KdsOrder {
    KdsOrder {
        id: id.to_string(),
        sale_id: format!("sale-{id}"),
        store_id: None,
        target_instance_id: None,
        status: "preparing".to_string(),
        items_summary: format!("{id} summary"),
        item_count: 2,
        display_number: Some(9),
        ticket_prefix: String::new(),
        received_at: stamp(),
        started_at: None,
        ready_at: None,
        served_at: None,
        prep_time_seconds: 300,
        kitchen_zone: None,
        notes: String::new(),
        table_number: None,
        priority: false,
    }
}

// ── Proof 1+2: live forwarder, dual terminals, filtered delivery ──────
//
// Phase 4.0 note: events are published through `publish_kds_sync` — the
// private *production* publish site in this very module, the exact
// function every kitchen-transition command shim calls after its bridge
// commit — against the real `AppState::for_test()` kernel bus. The public
// command wrappers themselves cannot run here: beyond a constructible
// `tauri::State` they need a seeded store DB, a live session token, real
// KDS rows and `kds_routing` config (a file owned by a live sibling
// session) before a single publish happens. The bus seam above is the
// deepest layer the fence can honestly reach.

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn kds_lan_live_dual_terminal_filtered_broadcast() {
    let state = AppState::for_test();
    let (hub, addr) = spawn_live_forwarder(queue_provider_for(&state)).await;
    wire_kds_handler(&state, &hub).await;

    // Peer A: station terminal subscribed to "grill". Peer B: Expo.
    let mut grill =
        LanPeer::connect(addr, Some(&hello_station(&["grill"], "kds-grill-1")), None).await;
    let mut expo = LanPeer::connect(addr, Some(&hello_expo("expo-1")), None).await;
    // Both escape the Phase-1 stall with a plain legacy discover.
    assert_eq!(
        grill.discover(r#"{"op":"discover"}"#).await,
        PAYLOAD,
        "legacy discover response must be the configured payload"
    );
    assert_eq!(expo.discover(r#"{"op":"discover"}"#).await, PAYLOAD);

    // All four typed transitions, published on the real bus.
    publish_kds_sync(&state, placed(&["grill"], "t-grill")).await;
    publish_kds_sync(&state, bumped(&["fry"], "t-fry")).await;
    publish_kds_sync(&state, ready(&[], "t-bcast")).await;
    publish_kds_sync(&state, recalled(&["grill", "fry"], "t-both")).await;
    hub.broadcast(SENTINEL.to_string());

    let grill_lines = grill.read_until_sentinel().await;
    let expo_lines = expo.read_until_sentinel().await;
    let grill_all = grill_lines.join("\n");
    let expo_all = expo_lines.join("\n");

    // Station A: only its own station's tickets + empty-stations broadcast.
    assert_eq!(grill_lines.len(), 3, "grill stream: {grill_all}");
    assert!(grill_all.contains("t-grill"), "grill must see its ticket");
    assert!(grill_all.contains("kds.order_placed"));
    assert!(grill_all.contains("t-bcast"), "grill must see broadcasts");
    assert!(grill_all.contains("kds.order_ready"));
    assert!(
        grill_all.contains("t-both"),
        "grill must see multi-station events naming it"
    );
    assert!(grill_all.contains("kds.order_recalled"));
    assert!(
        !grill_all.contains("t-fry") && !grill_all.contains("kds.line_item_bumped"),
        "grill must NOT see the fry-only event: {grill_all}"
    );

    // Expo (empty station_ids): every event, all four tags on the wire.
    assert_eq!(expo_lines.len(), 4, "expo stream: {expo_all}");
    for (id, tag) in [
        ("t-grill", "kds.order_placed"),
        ("t-fry", "kds.line_item_bumped"),
        ("t-bcast", "kds.order_ready"),
        ("t-both", "kds.order_recalled"),
    ] {
        assert!(expo_all.contains(id), "expo must see {id}: {expo_all}");
        assert!(expo_all.contains(tag), "expo must see tag {tag}");
    }
}

// ── Proof 3a: offline buffer replays to the reconnecting peer ─────────

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn kds_lan_live_offline_buffer_replays_station_event_on_reconnect() {
    let state = AppState::for_test();
    let (hub, addr) = spawn_live_forwarder(queue_provider_for(&state)).await;
    wire_kds_handler(&state, &hub).await;

    let mut a1 =
        LanPeer::connect(addr, Some(&hello_station(&["grill"], "kds-grill-1")), None).await;
    assert_eq!(a1.discover(r#"{"op":"discover"}"#).await, PAYLOAD);
    let peer_port = a1.local_port;
    // Simulated kitchen-tablet disconnect: the linger-0 close sends an RST,
    // so the server-side socket is permanently errored within milliseconds.
    drop(a1);
    tokio::time::sleep(Duration::from_millis(250)).await;

    // The first bus event now hits the server's write-failure path and is
    // buffered under the peer address. If (pathologically) the write was
    // still accepted before the abort was processed, the second event is
    // guaranteed to see the failed write — track which one got buffered.
    publish_kds_sync(&state, placed(&["grill"], "t-rp-1")).await;
    let mut replayed_id = "t-rp-1";
    if !wait_buffered(&hub, 1).await {
        publish_kds_sync(&state, placed(&["grill"], "t-rp-2")).await;
        assert!(
            wait_buffered(&hub, 1).await,
            "offline buffer never filled after RST + two published events \
             (disconnect was never observed on the server side)",
        );
        replayed_id = "t-rp-2";
    }

    // Reconnect from the SAME local port (the offline buffer's peer key).
    let mut a2 = LanPeer::connect(
        addr,
        Some(&hello_station(&["grill"], "kds-grill-1")),
        Some(peer_port),
    )
    .await;
    assert_eq!(a2.discover(r#"{"op":"discover"}"#).await, PAYLOAD);
    // A live event + sentinel fired after reconnect: the replayed buffer
    // must arrive first (the Phase-2 flush precedes Phase-3 streaming).
    publish_kds_sync(&state, placed(&["grill"], "t-live-1")).await;
    hub.broadcast(SENTINEL.to_string());

    let lines = a2.read_until_sentinel().await;
    assert_eq!(lines.len(), 2, "reconnect stream: {lines:?}");
    assert!(
        lines[0].contains(replayed_id),
        "first line after reconnect must be the buffered event {replayed_id}, got {:?}",
        lines[0],
    );
    assert!(
        lines[1].contains("t-live-1"),
        "second line must be the live event, got {:?}",
        lines[1],
    );
    assert_eq!(
        hub.buffered_count().await,
        0,
        "the reconnecting accept must drain the peer buffer",
    );
}

// ── Proof 3b: buffered replay respects the station filter ─────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn kds_lan_live_offline_buffer_replay_respects_station_filter() {
    let state = AppState::for_test();
    let (hub, addr) = spawn_live_forwarder(queue_provider_for(&state)).await;
    wire_kds_handler(&state, &hub).await;

    // A legacy (no-subscription) peer disconnects at a known address after
    // one fry-scoped event fails to write to it and gets buffered there.
    let mut l1 = LanPeer::connect(addr, Some(&hello_legacy()), None).await;
    assert_eq!(l1.discover(r#"{"op":"discover"}"#).await, PAYLOAD);
    let peer_port = l1.local_port;
    drop(l1);
    tokio::time::sleep(Duration::from_millis(250)).await;
    publish_kds_sync(&state, bumped(&["fry"], "t-fry-buf")).await;
    if !wait_buffered(&hub, 1).await {
        publish_kds_sync(&state, bumped(&["fry"], "t-fry-buf-2")).await;
        assert!(
            wait_buffered(&hub, 1).await,
            "offline buffer never filled for the disconnected legacy peer",
        );
    }

    // Reconnect from the same address, but now as a GRILL subscriber: the
    // buffered fry lines are outside its scope and must be dropped, not
    // replayed. The sentinel proves the stream finished with nothing in
    // between.
    let mut g2 = LanPeer::connect(
        addr,
        Some(&hello_station(&["grill"], "kds-grill-2")),
        Some(peer_port),
    )
    .await;
    assert_eq!(g2.discover(r#"{"op":"discover"}"#).await, PAYLOAD);
    hub.broadcast(SENTINEL.to_string());

    let lines = g2.read_until_sentinel().await;
    assert!(
        lines.is_empty(),
        "a foreign-station buffered line must not be replayed: {lines:?}",
    );
    assert_eq!(hub.buffered_count().await, 0);
}

// ── Proof 4: reconnect snapshot from AppState::kds_queue_cache ────────

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn kds_lan_live_reconnect_snapshot_serves_seeded_queue_cache() {
    let state = AppState::for_test();

    // Seed the app-owned queue cache (brief std write lock, exactly as
    // refresh_kds_queue_cache does) with two tickets.
    {
        let mut guard = state
            .kds_queue_cache
            .write()
            .expect("kds_queue_cache write lock");
        *guard = KdsQueueSnapshot {
            generated_at: "2026-09-13T09:00:00Z".to_string(),
            tickets: vec![
                KdsQueueTicket {
                    order: snapshot_order("snap-1"),
                    line_items: vec![],
                    stations: vec!["grill".to_string()],
                },
                KdsQueueTicket {
                    order: snapshot_order("snap-2"),
                    line_items: vec![],
                    stations: vec!["fry".to_string(), "expo".to_string()],
                },
            ],
        };
    }

    let (_hub, addr) = spawn_live_forwarder(queue_provider_for(&state)).await;

    // Opting peer: want_queue=true injects the live snapshot under
    // active_queue while preserving every base field of the payload.
    let mut boot =
        LanPeer::connect(addr, Some(&hello_station(&["grill"], "kds-boot-1")), None).await;
    let resp = boot
        .discover(r#"{"op":"discover","want_queue":true,"station_ids":["grill"]}"#)
        .await;
    assert!(
        resp.contains(r#""active_queue""#),
        "want_queue response must carry the active_queue key: {resp}"
    );
    let parsed: KdsDiscoverResponse = serde_json::from_str(&resp)
        .expect("want_queue discovery response parses as KdsDiscoverResponse");
    assert_eq!(parsed.restaurant_pos_id, "pos-live-1");
    assert_eq!(parsed.version, "0.0.37-live");
    assert_eq!(
        parsed.transports,
        vec!["noise-psk-v1".to_string(), "legacy-psk-v1".to_string()]
    );
    let queue = parsed
        .active_queue
        .expect("want_queue must receive the snapshot");
    assert_eq!(queue.generated_at, "2026-09-13T09:00:00Z");
    let ids: Vec<String> = queue.tickets.iter().map(|t| t.order.id.clone()).collect();
    assert_eq!(ids, vec!["snap-1".to_string(), "snap-2".to_string()]);
    assert_eq!(
        queue.tickets[1].stations,
        vec!["fry".to_string(), "expo".to_string()]
    );

    // Non-opting (legacy) peer on the same live server: byte-identical
    // payload even with a provider configured and the cache seeded.
    let mut legacy = LanPeer::connect(addr, Some(&hello_legacy()), None).await;
    let resp = legacy.discover(r#"{"op":"discover"}"#).await;
    assert_eq!(
        resp, PAYLOAD,
        "a non-opting discovery response must be byte-identical"
    );
    assert!(!resp.contains("active_queue"));
}

// ── Crate-bug demonstration (kept #[ignore]d: fails by design) ────────

/// **oz-lan defect (found by this suite, NOT fixed per the work-order
/// fence):** `handle_peer`'s Phase-0 (legacy-psk-v1 hello) reads the hello
/// line through a *transient* `BufReader` that is dropped at the end of
/// the read. A line-delimited protocol must never discard bytes read past
/// the newline, but a `TcpStream` read can return several buffered lines
/// at once — so a KDS tablet that writes its `hello` and `discover` lines
/// in quick succession (or, as here, in one segment) has the discover
/// line silently swallowed: no discovery response, no `active_queue`, a 5
/// s Phase-1 stall, and the peer's subscription can only ever come from
/// the hello fields. The same transient-`BufReader` pattern exists at
/// Phase 1 for a second post-discover request. The crate's own tests miss
/// it because no test sends hello *and* discover over one PSK connection.
///
/// This test asserts the CORRECT behaviour, so it is red by construction:
/// run with `cargo test kds_lan_live -- --ignored` to see the failure
/// text, or read it as documentation.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "demonstrates the oz-lan handle_peer Phase-0 over-read defect; the assert below fails by design"]
async fn kds_lan_live_bugdemo_discovery_lost_when_sent_with_hello() {
    let state = AppState::for_test();
    let (_hub, addr) = spawn_live_forwarder(queue_provider_for(&state)).await;

    // Burst client: hello + discover in ONE segment — a valid
    // newline-delimited stream. No pacing, no sleep.
    let mut p = LanPeer::connect(addr, None, None).await;
    let burst = format!(
        "{}\n{}",
        hello_station(&["grill"], "kds-bugdemo"),
        r#"{"op":"discover","want_queue":true}"#
    );
    p.write_line(&burst).await;

    // Correct: the server answers the discover with the (queued) response
    // as the first line back. Actual: the over-read drops it, and the
    // first line arrives only as the heartbeat ~5 s later.
    let first = p
        .read_line()
        .await
        .expect("stream closed before any server line");
    assert!(
        first.contains("restaurant_pos_id"),
        "discover sent in the same segment as hello must be answered; \
         first server line was {first:?} instead \
         (oz-lan handle_peer Phase-0 BufReader over-read)",
    );
}
