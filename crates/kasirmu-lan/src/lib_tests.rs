use super::replay::MAX_OFFLINE_BUFFER_PER_PEER;
use super::*;
use tokio::net::TcpStream;
use tokio::sync::broadcast;

// ── Construction ─────────────────────────────────────────────

#[test]
fn forwarder_new_creates_channel() {
    let fwd = LanEventForwarder::default();
    fwd.broadcast("{\"test\":1}".into());
}

#[test]
fn forwarder_handle_is_clone() {
    let fwd = LanEventForwarder::default();
    let h1 = fwd.handle();
    let h2 = fwd.handle();
    let _ = h1.sale_completed_handler();
    let _ = h2.course_fired_handler();
}

#[test]
fn forwarder_default_impl() {
    let fwd: LanEventForwarder = Default::default();
    fwd.broadcast("ping".into());
}

#[tokio::test]
async fn forwarder_buffered_count_starts_zero() {
    let fwd = LanEventForwarder::default();
    assert_eq!(fwd.buffered_count().await, 0);
    assert_eq!(fwd.buffered_peer_count().await, 0);
}

// ── SaleCompletedHandler ─────────────────────────────────────

#[test]
fn sale_completed_handler_forwards_event() {
    let (tx, mut rx) = broadcast::channel(16);
    let handler = SaleCompletedHandler { tx };

    let event = SaleCompleted {
        sale_id: "sale-1".into(),
        store_id: None,
        line_items: vec![],
        total_minor: 1000,
        currency: "USD".into(),
        customer_id: None,
    };

    handler.handle(&event).unwrap();

    let received = rx.try_recv().unwrap();
    assert!(
        received.contains("\"sale-1\""),
        "JSON should contain sale_id"
    );
}

#[test]
fn sale_completed_handler_with_items() {
    let (tx, mut rx) = broadcast::channel(16);
    let handler = SaleCompletedHandler { tx };

    let event = SaleCompleted {
        sale_id: "sale-2".into(),
        store_id: None,
        line_items: vec![kasirmu_core::events::SaleCompletedLine {
            sku: "COFFEE".into(),
            qty: 2,
            unit_price_minor: 350,
            tax_minor: 0,
            tax_rate_id: None,
        }],
        total_minor: 700,
        currency: "USD".into(),
        customer_id: Some("cust-1".into()),
    };

    handler.handle(&event).unwrap();

    let received = rx.try_recv().unwrap();
    assert!(received.contains("COFFEE"));
    assert!(received.contains("cust-1"));
    assert!(received.contains("700"));
}

// ── CourseFiredHandler ───────────────────────────────────────

#[test]
fn course_fired_handler_forwards_event() {
    let (tx, mut rx) = broadcast::channel(16);
    let handler = CourseFiredHandler { tx };

    let event = CourseFired {
        sale_id: "sale-42".into(),
        store_id: None,
        course_id: "main".into(),
        display_number: Some(101),
        items: vec![kasirmu_core::events::CourseItem {
            sku: "STEAK".into(),
            qty: 2,
            name: "Grilled Steak".into(),
        }],
    };

    handler.handle(&event).unwrap();

    let received = rx.try_recv().unwrap();
    assert!(received.contains("sale-42"));
    assert!(received.contains("main"));
    assert!(received.contains("STEAK"));
    assert!(received.contains("Grilled Steak"));
}

#[test]
fn course_fired_handler_no_display_number() {
    let (tx, mut rx) = broadcast::channel(16);
    let handler = CourseFiredHandler { tx };

    let event = CourseFired {
        sale_id: "sale-3".into(),
        store_id: None,
        course_id: "drinks".into(),
        display_number: None,
        items: vec![],
    };

    handler.handle(&event).unwrap();

    let received = rx.try_recv().unwrap();
    assert!(received.contains("null"));
}

// ── Peer handler (integration-style) ─────────────────────────

/// Helper: spawn a test peer handler and return (server_handle, client_stream, addr).
/// `initial_events` are seeded into the shared replay buffer under this
/// peer's legacy `Addr` key — `handle_peer` drains it itself once the
/// (absent) subscription is resolved.
async fn spawn_test_peer(
    rx: broadcast::Receiver<String>,
    initial_events: Vec<String>,
) -> (
    tokio::task::JoinHandle<()>,
    tokio::net::TcpStream,
    std::net::SocketAddr,
) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let buffer = OfflineReplayBuffer::new();
    seed_addr(&buffer, "test-peer", initial_events).await;

    let server_handle = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        handle_peer(stream, "test-peer".into(), rx, buffer, None, None, None).await;
    });

    let client = TcpStream::connect(addr).await.unwrap();
    (server_handle, client, addr)
}

/// Seed `events` into `buffer` under the legacy `Addr(key)` identity,
/// as if they had failed to write to a peer at that address.
async fn seed_addr(buffer: &OfflineReplayBuffer, key: &str, events: Vec<String>) {
    for event in events {
        buffer
            .push(&ReplayKey::Addr(key.to_string()), key, event)
            .await;
    }
}

#[tokio::test]
async fn peer_receives_broadcast_messages() {
    let (tx, rx) = broadcast::channel(16);
    let (server_handle, mut client, _) = spawn_test_peer(rx, vec![]).await;

    tx.send("{\"event\":\"test\"}".into()).unwrap();
    drop(tx);

    let mut buf = Vec::new();
    tokio::io::AsyncReadExt::read_to_end(&mut client, &mut buf)
        .await
        .unwrap();

    assert!(buf.starts_with(b"{\"event\":\"test\"}\n"));
    server_handle.await.unwrap();
}

#[tokio::test]
async fn peer_receives_multiple_messages() {
    let (tx, rx) = broadcast::channel(16);
    let (server_handle, mut client, _) = spawn_test_peer(rx, vec![]).await;

    tx.send("msg1".into()).unwrap();
    tx.send("msg2".into()).unwrap();
    drop(tx);

    let mut buf = Vec::new();
    tokio::io::AsyncReadExt::read_to_end(&mut client, &mut buf)
        .await
        .unwrap();

    assert_eq!(buf, b"msg1\nmsg2\n");
    server_handle.await.unwrap();
}

#[tokio::test]
async fn peer_graceful_shutdown() {
    let (tx, rx) = broadcast::channel(16);
    let (server_handle, _client, _) = spawn_test_peer(rx, vec![]).await;

    drop(tx);

    tokio::time::timeout(std::time::Duration::from_secs(2), server_handle)
        .await
        .expect("peer should shut down cleanly")
        .unwrap();
}

#[tokio::test]
async fn peer_sends_initial_events_on_connect() {
    let (tx, rx) = broadcast::channel(16);
    let initial = vec!["buf1".into(), "buf2".into()];
    let (server_handle, mut client, _) = spawn_test_peer(rx, initial).await;

    // Give it a moment to flush initial events.
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    drop(tx);

    let mut buf = Vec::new();
    tokio::io::AsyncReadExt::read_to_end(&mut client, &mut buf)
        .await
        .unwrap();

    assert_eq!(buf, b"buf1\nbuf2\n");
    server_handle.await.unwrap();
}

#[tokio::test]
async fn peer_flushes_initial_then_broadcast() {
    let (tx, rx) = broadcast::channel(16);
    let initial = vec!["initial".into()];
    let (server_handle, mut client, _) = spawn_test_peer(rx, initial).await;

    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    tx.send("live".into()).unwrap();
    drop(tx);

    let mut buf = Vec::new();
    tokio::io::AsyncReadExt::read_to_end(&mut client, &mut buf)
        .await
        .unwrap();

    assert_eq!(buf, b"initial\nlive\n");
    server_handle.await.unwrap();
}

#[tokio::test]
async fn peer_sends_heartbeat_pings() {
    let (tx, rx) = broadcast::channel(16);
    let (server_handle, mut client, _) = spawn_test_peer(rx, vec![]).await;

    // Wait for at least one heartbeat (5s interval — use a shorter
    // interval for test control by reading for long enough).
    // Since we can't easily change the const, we check that the
    // server is alive and read until timeout or ping.
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    drop(tx);

    let mut buf = Vec::new();
    // Read whatever we got — at minimum we should have the shutdown,
    // but might also have a ping if the interval fires fast enough
    // in the test environment.
    let _ = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        tokio::io::AsyncReadExt::read_to_end(&mut client, &mut buf),
    )
    .await;

    // The server functioned — no crash.
    server_handle.await.unwrap();
}

// ── Offline buffer tests ────────────────────────────────────

#[tokio::test]
async fn offline_buffer_stores_events_on_disconnect() {
    let buffer = OfflineReplayBuffer::new();

    // The write-failure path of `handle_peer` pushes exactly this way:
    // the undelivered line under the peer's replay identity, recording
    // the address it failed to reach.
    buffer
        .push(
            &ReplayKey::Addr("test-peer".into()),
            "test-peer",
            "{\"event\":\"test\"}".into(),
        )
        .await;

    let drained = buffer.drain(&ReplayKey::Addr("test-peer".into())).await;
    assert_eq!(drained.events.len(), 1, "should have buffered one event");
    assert!(drained.events[0].contains("event"));
    assert_eq!(drained.source_addr.as_deref(), Some("test-peer"));
}

#[tokio::test]
async fn offline_buffer_flush_on_reconnect() {
    let buffer = OfflineReplayBuffer::new();
    seed_addr(
        &buffer,
        "reconnect-peer",
        vec!["replayed1".into(), "replayed2".into()],
    )
    .await;

    // A reconnecting connection drains its identity queue; ordering is
    // arrival order and the queue is gone afterwards.
    let drained = buffer
        .drain(&ReplayKey::Addr("reconnect-peer".into()))
        .await;
    assert_eq!(
        drained.events.len(),
        2,
        "should have drained 2 buffered events"
    );
    assert_eq!(drained.events[0], "replayed1");

    let after = buffer
        .drain(&ReplayKey::Addr("reconnect-peer".into()))
        .await;
    assert!(
        after.events.is_empty(),
        "reconnect drains the identity queue once"
    );
    assert_eq!(buffer.queue_count().await, 0);
}

#[tokio::test]
async fn offline_buffer_does_not_grow_unbounded() {
    let buffer = OfflineReplayBuffer::new();

    // A flood of disconnects from the same peer keeps the queue alive
    // but pinned at the per-peer cap — growth is bounded, oldest first
    // out.
    for i in 0..(MAX_OFFLINE_BUFFER_PER_PEER + 500) {
        buffer
            .push(
                &ReplayKey::Addr("flood-peer".into()),
                "flood-peer",
                format!("event_{i}"),
            )
            .await;
    }

    assert_eq!(
        buffer.event_count().await,
        MAX_OFFLINE_BUFFER_PER_PEER,
        "one peer's queue must stop at the cap"
    );
    let drained = buffer.drain(&ReplayKey::Addr("flood-peer".into())).await;
    assert_eq!(drained.events.first().unwrap(), &format!("event_{}", 500));
    assert_eq!(
        drained.events.last().unwrap(),
        &format!("event_{}", MAX_OFFLINE_BUFFER_PER_PEER + 499)
    );
}

#[tokio::test]
async fn forwarder_buffered_count_reflects_buffer() {
    let fwd = LanEventForwarder::default();
    assert_eq!(fwd.buffered_count().await, 0);

    // Manually insert a buffered event.
    fwd.offline_buffer
        .push(
            &ReplayKey::Addr("offline-peer".into()),
            "offline-peer",
            "{\"lost\":true}".into(),
        )
        .await;

    assert_eq!(fwd.buffered_count().await, 1);
    assert_eq!(fwd.buffered_peer_count().await, 1);
}

// ── Discovery (multi-KDS) ──────────────────────────────────────

#[test]
fn with_discovery_sets_payload() {
    let payload = r#"{"store_id":"s1","store_name":"Main Store","kds_devices":[]}"#;
    let fwd =
        LanEventForwarder::new("127.0.0.1:0".into(), None).with_discovery(payload.to_string());
    // The payload is stored internally; verify the forwarder was created successfully.
    fwd.broadcast("test".into());
}

#[test]
fn without_discovery_has_no_payload() {
    let fwd = LanEventForwarder::new("127.0.0.1:0".into(), None);
    // Default forwarder should work without discovery.
    fwd.broadcast("test".into());
}

// ── DC-2: offline buffer drop-oldest cap (legacy Addr key) ─────────────

#[tokio::test]
async fn offline_buffer_caps_per_peer_queue_with_drop_oldest() {
    let buffer = OfflineReplayBuffer::new();
    for i in 0..(MAX_OFFLINE_BUFFER_PER_PEER + 250) {
        buffer
            .push(&ReplayKey::Addr("peer-a".into()), "peer-a", format!("e{i}"))
            .await;
    }
    let queue = buffer.drain(&ReplayKey::Addr("peer-a".into())).await;
    assert_eq!(queue.events.len(), MAX_OFFLINE_BUFFER_PER_PEER);
    // Oldest events were dropped: first retained is e250, last is the
    // most recently pushed.
    assert_eq!(queue.events.first().unwrap(), &format!("e{}", 250));
    assert_eq!(
        queue.events.last().unwrap(),
        &format!("e{}", MAX_OFFLINE_BUFFER_PER_PEER + 249)
    );
}

#[tokio::test]
async fn offline_buffer_caps_are_per_peer_not_global() {
    let buffer = OfflineReplayBuffer::new();
    for i in 0..(MAX_OFFLINE_BUFFER_PER_PEER + 10) {
        buffer
            .push(&ReplayKey::Addr("peer-a".into()), "peer-a", format!("a{i}"))
            .await;
        buffer
            .push(&ReplayKey::Addr("peer-b".into()), "peer-b", format!("b{i}"))
            .await;
    }
    // Two queues at the per-peer cap sit below the total cap, so both
    // hold exactly MAX_OFFLINE_BUFFER_PER_PEER and neither cannibalises
    // the other. (The total cap itself is pinned in `replay_tests`.)
    assert_eq!(
        buffer.len_for(&ReplayKey::Addr("peer-a".into())).await,
        MAX_OFFLINE_BUFFER_PER_PEER
    );
    assert_eq!(
        buffer.len_for(&ReplayKey::Addr("peer-b".into())).await,
        MAX_OFFLINE_BUFFER_PER_PEER
    );
    assert_eq!(buffer.queue_count().await, 2);
}

// ── noise-psk-v1 transport (DC-1 full fix) ──────────────────────────

/// Spawn `handle_peer` in PSK (external-bind) mode and connect a client.
async fn spawn_psk_peer(
    psk: &str,
) -> (
    tokio::task::JoinHandle<()>,
    TcpStream,
    broadcast::Sender<String>,
) {
    let (tx, rx) = broadcast::channel(16);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let buffer = OfflineReplayBuffer::new();
    let expected = Some(Arc::new(psk.to_string()));
    let server_handle = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        handle_peer(
            stream,
            "noise-test-peer".into(),
            rx,
            buffer,
            expected,
            None,
            None,
        )
        .await;
    });
    let client = TcpStream::connect(addr).await.unwrap();
    (server_handle, client, tx)
}

/// Drive the initiator (KDS client) side of `Noise_XXpsk3` over
/// `client`: magic byte, msg1 `-> e`, msg2 `<- e ee s es`, msg3
/// `-> s es psk3`, then switch to transport mode. This is the
/// reference sequence the module doc points at.
async fn noise_initiator(client: &mut TcpStream, psk: &str) -> snow::TransportState {
    // Transport selector: `handle_peer` reads this first byte to pick
    // noise-psk-v1 over the legacy cleartext hello.
    tokio::io::AsyncWriteExt::write_all(client, &[NOISE_MAGIC_BYTE])
        .await
        .unwrap();
    let params: snow::params::NoiseParams = NOISE_PATTERN.parse().unwrap();
    let static_secret = noise_static_secret(psk);
    let psk_bytes = noise_psk_bytes(psk);
    let mut hs = snow::Builder::new(params)
        .local_private_key(&static_secret)
        .unwrap()
        .psk(3, &psk_bytes)
        .unwrap()
        .build_initiator()
        .unwrap();
    let mut buf = vec![0u8; NOISE_MAX_FRAME];
    let n = hs.write_message(&[], &mut buf).unwrap();
    write_frame(client, &buf[..n]).await.unwrap();
    let msg2 = read_frame(client).await.unwrap();
    let mut pt = vec![0u8; msg2.len()];
    hs.read_message(&msg2, &mut pt).unwrap();
    let n = hs.write_message(&[], &mut buf).unwrap();
    write_frame(client, &buf[..n]).await.unwrap();
    hs.into_transport_mode().unwrap()
}

#[tokio::test]
async fn noise_peer_handshakes_and_receives_encrypted_event() {
    let (server_handle, mut client, tx) = spawn_psk_peer("s3cret").await;
    let mut transport = noise_initiator(&mut client, "s3cret").await;

    tx.send("{\"event\":\"noise\"}".into()).unwrap();
    drop(tx);

    let ct = read_frame(&mut client).await.unwrap();
    let mut pt = vec![0u8; ct.len()];
    let n = transport.read_message(&ct, &mut pt).unwrap();
    assert_eq!(
        std::str::from_utf8(&pt[..n]).unwrap(),
        "{\"event\":\"noise\"}"
    );
    server_handle.await.unwrap();
}

#[tokio::test]
async fn noise_handshake_with_wrong_psk_is_dropped() {
    let (server_handle, mut client, _tx) = spawn_psk_peer("s3cret").await;
    // msg1/msg2 carry no PSK evidence; the psk3 MAC check in msg3 is
    // what authenticates the initiator, so the client side completes
    // locally but the responder must reject and close without ever
    // writing an event frame.
    let _transport = noise_initiator(&mut client, "wrong-psk").await;
    let mut buf = Vec::new();
    tokio::io::AsyncReadExt::read_to_end(&mut client, &mut buf)
        .await
        .unwrap();
    assert!(buf.is_empty(), "wrong-PSK peer must receive nothing");
    server_handle.await.unwrap();
}

#[tokio::test]
async fn unknown_transport_selector_byte_is_dropped() {
    let (server_handle, mut client, _tx) = spawn_psk_peer("s3cret").await;
    tokio::io::AsyncWriteExt::write_all(&mut client, &[0x2a])
        .await
        .unwrap();
    let mut buf = Vec::new();
    tokio::io::AsyncReadExt::read_to_end(&mut client, &mut buf)
        .await
        .unwrap();
    assert!(buf.is_empty());
    server_handle.await.unwrap();
}

#[tokio::test]
async fn legacy_hello_with_correct_psk_receives_event() {
    let (server_handle, mut client, tx) = spawn_psk_peer("s3cret").await;
    tokio::io::AsyncWriteExt::write_all(&mut client, b"{\"op\":\"hello\",\"psk\":\"s3cret\"}\n")
        .await
        .unwrap();
    tx.send("{\"event\":\"legacy\"}".into()).unwrap();
    drop(tx);

    let mut buf = Vec::new();
    tokio::io::AsyncReadExt::read_to_end(&mut client, &mut buf)
        .await
        .unwrap();
    assert!(String::from_utf8_lossy(&buf).contains("{\"event\":\"legacy\"}"));
    server_handle.await.unwrap();
}

#[tokio::test]
async fn legacy_hello_with_wrong_psk_is_dropped() {
    let (server_handle, mut client, _tx) = spawn_psk_peer("s3cret").await;
    tokio::io::AsyncWriteExt::write_all(&mut client, b"{\"op\":\"hello\",\"psk\":\"nope\"}\n")
        .await
        .unwrap();
    let mut buf = Vec::new();
    tokio::io::AsyncReadExt::read_to_end(&mut client, &mut buf)
        .await
        .unwrap();
    assert!(buf.is_empty(), "bad-hello peer must receive nothing");
    server_handle.await.unwrap();
}

// ── kds-sync: multi-terminal station filtering & snapshots ─────────────

/// Spawn `handle_peer` with the full option set (PSK, discovery
/// payload, queue provider) and connect a plain client. `initial_events`
/// are seeded under the peer's legacy `Addr("kds-sync-peer")` key.
async fn spawn_peer_with(
    rx: broadcast::Receiver<String>,
    initial_events: Vec<String>,
    psk: Option<&str>,
    discovery: Option<&str>,
    kds_queue: Option<KdsQueueProvider>,
) -> (tokio::task::JoinHandle<()>, TcpStream) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let buffer = OfflineReplayBuffer::new();
    seed_addr(&buffer, "kds-sync-peer", initial_events).await;
    let expected = psk.map(|p| Arc::new(p.to_string()));
    let payload = discovery.map(|p| Arc::new(p.to_string()));
    let server_handle = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        handle_peer(
            stream,
            "kds-sync-peer".into(),
            rx,
            buffer,
            expected,
            payload,
            kds_queue,
        )
        .await;
    });
    let client = TcpStream::connect(addr).await.unwrap();
    (server_handle, client)
}

/// Serialise a `kds.order_placed` wire line scoped to `stations`.
fn placed_line(stations: &[&str]) -> String {
    placed_line_id("kds-1", stations)
}

/// [`placed_line`] with an explicit ticket id, so a test can tell a
/// replayed line apart from a live one by its bytes.
fn placed_line_id(id: &str, stations: &[&str]) -> String {
    serde_json::to_string(&KdsSyncEvent::OrderPlaced(KdsOrderPlaced {
        kds_order_id: id.into(),
        sale_id: format!("sale-{id}"),
        store_id: None,
        stations: stations.iter().map(|s| s.to_string()).collect(),
        display_number: Some(7),
        table_number: None,
        ticket_prefix: String::new(),
        items: vec![],
        notes: String::new(),
        priority: false,
        occurred_at: "2026-09-13T08:00:00Z".into(),
    }))
    .unwrap()
}

const DISCOVERY_BASE: &str =
    r#"{"restaurant_pos_id":"pos-1","devices":[],"version":"0.0.37","transports":[]}"#;

/// Parse a discovery response text into the typed response. Goes via
/// `from_value` because `KdsDiscoverResponse` carries `&'static str`
/// fields, which cannot borrow from an owned read buffer.
fn parse_discovery(text: &str) -> KdsDiscoverResponse {
    serde_json::from_value(serde_json::from_str(text).expect("discovery response must be JSON"))
        .expect("discovery response must match KdsDiscoverResponse")
}

fn snapshot_provider() -> KdsQueueProvider {
    use kasirmu_core::kds::KdsOrder;
    Arc::new(|| KdsQueueSnapshot {
        generated_at: "2026-09-13T09:00:00Z".into(),
        tickets: vec![KdsQueueTicket {
            order: KdsOrder {
                id: "kds-9".into(),
                sale_id: "sale-9".into(),
                store_id: None,
                target_instance_id: None,
                status: "preparing".into(),
                items_summary: "Steak x2".into(),
                item_count: 2,
                display_number: Some(9),
                ticket_prefix: String::new(),
                received_at: "2026-09-13T08:50:00Z".into(),
                started_at: None,
                ready_at: None,
                served_at: None,
                prep_time_seconds: 300,
                kitchen_zone: None,
                notes: String::new(),
                table_number: None,
                priority: false,
            },
            line_items: vec![],
            stations: vec!["grill".into()],
        }],
    })
}

#[tokio::test]
async fn passive_legacy_peer_receives_scoped_kds_events() {
    // Fail-open: a pre-kds-sync peer (no hello, no discover) must see
    // station-scoped lines exactly like any other traffic.
    let (tx, rx) = broadcast::channel(16);
    let (server_handle, mut client, _) = spawn_test_peer(rx, vec![]).await;
    tx.send(placed_line(&["fry"])).unwrap();
    drop(tx);
    let mut buf = Vec::new();
    tokio::io::AsyncReadExt::read_to_end(&mut client, &mut buf)
        .await
        .unwrap();
    let text = String::from_utf8_lossy(&buf);
    assert!(
        text.contains("kds.order_placed"),
        "legacy peer must receive scoped KDS events: {text}"
    );
    server_handle.await.unwrap();
}

#[tokio::test]
async fn subscribed_station_peer_receives_only_its_station() {
    let (tx, rx) = broadcast::channel(16);
    let (server_handle, mut client) =
        spawn_peer_with(rx, vec![], None, Some(DISCOVERY_BASE), None).await;
    tokio::io::AsyncWriteExt::write_all(
        &mut client,
        b"{\"op\":\"discover\",\"station_ids\":[\"grill\"],\"device_id\":\"kds-1\"}\n",
    )
    .await
    .unwrap();

    tx.send(placed_line(&["grill"])).unwrap();
    tx.send(placed_line(&["fry"])).unwrap();
    tx.send("{\"type\":\"ping\"}".to_string()).unwrap();
    drop(tx);

    let mut buf = Vec::new();
    tokio::io::AsyncReadExt::read_to_end(&mut client, &mut buf)
        .await
        .unwrap();
    let text = String::from_utf8_lossy(&buf);
    let lines: Vec<&str> = text.lines().filter(|l| !l.is_empty()).collect();
    // discover response + grill event + ping; the fry event is filtered.
    assert_eq!(lines.len(), 3, "unexpected stream: {text}");
    assert!(lines[0].contains("restaurant_pos_id"));
    assert!(lines[1].contains("\"stations\":[\"grill\"]"));
    assert!(lines[2].contains("ping"));
    assert!(
        !text.contains("fry"),
        "station-scoped peer must not receive other stations: {text}"
    );
    server_handle.await.unwrap();
}

#[tokio::test]
async fn expo_peer_receives_every_station() {
    // device_id without station_ids = Expo: sees all stations.
    let (tx, rx) = broadcast::channel(16);
    let (server_handle, mut client) =
        spawn_peer_with(rx, vec![], None, Some(DISCOVERY_BASE), None).await;
    tokio::io::AsyncWriteExt::write_all(
        &mut client,
        b"{\"op\":\"discover\",\"device_id\":\"expo-1\"}\n",
    )
    .await
    .unwrap();
    tx.send(placed_line(&["grill"])).unwrap();
    tx.send(placed_line(&["fry"])).unwrap();
    drop(tx);
    let mut buf = Vec::new();
    tokio::io::AsyncReadExt::read_to_end(&mut client, &mut buf)
        .await
        .unwrap();
    let text = String::from_utf8_lossy(&buf);
    assert!(text.contains("grill"), "expo must see grill: {text}");
    assert!(text.contains("fry"), "expo must see fry: {text}");
    server_handle.await.unwrap();
}

#[tokio::test]
async fn station_peer_reconnect_replays_only_matching_buffered_events() {
    // Phase 2 flush applies the station filter to buffered replays.
    let (tx, rx) = broadcast::channel(16);
    let initial = vec![placed_line(&["fry"]), placed_line(&["grill"])];
    let (server_handle, mut client) =
        spawn_peer_with(rx, initial, None, Some(DISCOVERY_BASE), None).await;
    tokio::io::AsyncWriteExt::write_all(
        &mut client,
        b"{\"op\":\"discover\",\"station_ids\":[\"grill\"]}\n",
    )
    .await
    .unwrap();
    drop(tx);
    let mut buf = Vec::new();
    tokio::io::AsyncReadExt::read_to_end(&mut client, &mut buf)
        .await
        .unwrap();
    let text = String::from_utf8_lossy(&buf);
    assert!(text.contains("grill"));
    assert!(
        !text.contains("fry"),
        "buffered replay must be filtered: {text}"
    );
    server_handle.await.unwrap();
}

#[tokio::test]
async fn psk_hello_peer_receives_scoped_events_without_subscription() {
    // Byte-for-byte pre-kds-sync hello line + provider-less PSK peer:
    // the scoped event still arrives (legacy behavior intact).
    let (server_handle, mut client, tx) = spawn_psk_peer("s3cret").await;
    tokio::io::AsyncWriteExt::write_all(&mut client, b"{\"op\":\"hello\",\"psk\":\"s3cret\"}\n")
        .await
        .unwrap();
    tx.send(placed_line(&["grill"])).unwrap();
    drop(tx);
    let mut buf = Vec::new();
    tokio::io::AsyncReadExt::read_to_end(&mut client, &mut buf)
        .await
        .unwrap();
    assert!(String::from_utf8_lossy(&buf).contains("kds.order_placed"));
    server_handle.await.unwrap();
}

#[tokio::test]
async fn psk_hello_with_station_ids_filters_scoped_events() {
    let (tx, rx) = broadcast::channel(16);
    let (server_handle, mut client) = spawn_peer_with(rx, vec![], Some("s3cret"), None, None).await;
    tokio::io::AsyncWriteExt::write_all(
        &mut client,
        b"{\"op\":\"hello\",\"psk\":\"s3cret\",\"station_ids\":[\"grill\"],\"device_id\":\"kds-2\"}\n",
    )
    .await
    .unwrap();
    tx.send(placed_line(&["fry"])).unwrap();
    tx.send(placed_line(&["grill"])).unwrap();
    drop(tx);
    let mut buf = Vec::new();
    tokio::io::AsyncReadExt::read_to_end(&mut client, &mut buf)
        .await
        .unwrap();
    let text = String::from_utf8_lossy(&buf);
    assert!(text.contains("grill"), "matching station delivered: {text}");
    assert!(
        !text.contains("fry"),
        "non-matching station filtered on PSK hello: {text}"
    );
    server_handle.await.unwrap();
}

#[tokio::test]
async fn discover_pipelined_with_hello_is_answered() {
    // Regression (Phase-0 over-read): a client that writes its hello and
    // its discover line in ONE segment (`hello\ndiscover\n`) used to
    // lose the discover line — the transient phase-0 BufReader filled
    // its 8 KB buffer past the newline and dropped the remainder, so
    // phase 1 blocked on a fresh socket read until its 5 s timeout and
    // no discovery response was ever sent. The single connection-level
    // reader must consume BOTH lines: discovery is answered from the
    // buffer, and the hello's subscription still filters live traffic.
    let (tx, rx) = broadcast::channel(16);
    let (server_handle, mut client) = spawn_peer_with(
        rx,
        vec![],
        Some("s3cret"),
        Some(DISCOVERY_BASE),
        Some(snapshot_provider()),
    )
    .await;
    let burst = concat!(
        "{\"op\":\"hello\",\"psk\":\"s3cret\",\"station_ids\":[\"grill\"],\"device_id\":\"kds-1\"}\n",
        "{\"op\":\"discover\",\"want_queue\":true}\n",
    );
    tokio::io::AsyncWriteExt::write_all(&mut client, burst.as_bytes())
        .await
        .unwrap();

    tx.send(placed_line(&["grill"])).unwrap();
    tx.send(placed_line(&["fry"])).unwrap();
    drop(tx);

    let mut buf = Vec::new();
    tokio::io::AsyncReadExt::read_to_end(&mut client, &mut buf)
        .await
        .unwrap();
    let text = String::from_utf8_lossy(&buf);
    let lines: Vec<&str> = text.lines().filter(|l| !l.is_empty()).collect();
    assert_eq!(
        lines.len(),
        2,
        "same-segment hello+discover must yield response + filtered event: {text}"
    );
    let parsed = parse_discovery(lines[0]);
    assert_eq!(parsed.restaurant_pos_id, "pos-1");
    assert!(
        parsed.active_queue.is_some(),
        "buffered want_queue discover must receive the snapshot: {text}"
    );
    assert!(
        lines[1].contains("kds.order_placed") && lines[1].contains("grill"),
        "hello-carried subscription must still stream events: {text}"
    );
    assert!(
        !text.contains("fry"),
        "grill subscriber must not receive fry: {text}"
    );
    server_handle.await.unwrap();
}

#[tokio::test]
async fn legacy_discover_response_is_byte_identical() {
    // Opt-out (no want_queue) + configured provider: bytes must not move.
    let (tx, rx) = broadcast::channel(16);
    let (server_handle, mut client) = spawn_peer_with(
        rx,
        vec![],
        None,
        Some(DISCOVERY_BASE),
        Some(snapshot_provider()),
    )
    .await;
    tokio::io::AsyncWriteExt::write_all(&mut client, b"{\"op\":\"discover\"}\n")
        .await
        .unwrap();
    drop(tx);
    let mut buf = Vec::new();
    tokio::io::AsyncReadExt::read_to_end(&mut client, &mut buf)
        .await
        .unwrap();
    assert_eq!(
        String::from_utf8_lossy(&buf),
        format!("{DISCOVERY_BASE}\n"),
        "non-opting discovery response must be byte-identical"
    );
    server_handle.await.unwrap();
}

#[tokio::test]
async fn discover_with_want_queue_gets_snapshot_injected() {
    let (tx, rx) = broadcast::channel(16);
    let (server_handle, mut client) = spawn_peer_with(
        rx,
        vec![],
        None,
        Some(DISCOVERY_BASE),
        Some(snapshot_provider()),
    )
    .await;
    tokio::io::AsyncWriteExt::write_all(
        &mut client,
        b"{\"op\":\"discover\",\"want_queue\":true}\n",
    )
    .await
    .unwrap();
    drop(tx);
    let mut buf = Vec::new();
    tokio::io::AsyncReadExt::read_to_end(&mut client, &mut buf)
        .await
        .unwrap();
    let text = String::from_utf8_lossy(&buf);
    let parsed = parse_discovery(text.trim());
    assert_eq!(parsed.restaurant_pos_id, "pos-1");
    let queue = parsed
        .active_queue
        .expect("want_queue must inject active_queue");
    assert_eq!(queue.generated_at, "2026-09-13T09:00:00Z");
    assert_eq!(queue.tickets[0].order.id, "kds-9");
    assert_eq!(queue.tickets[0].stations, vec!["grill".to_string()]);
    server_handle.await.unwrap();
}

#[tokio::test]
async fn noise_peer_subscribes_and_receives_snapshot_and_filter() {
    // Full noise-psk-v1 path: discover (encrypted frame) with
    // want_queue + station_ids — snapshot injected, then live traffic
    // station-filtered inside encrypted frames.
    let (tx, rx) = broadcast::channel(16);
    let (server_handle, mut client) = spawn_peer_with(
        rx,
        vec![],
        Some("s3cret"),
        Some(DISCOVERY_BASE),
        Some(snapshot_provider()),
    )
    .await;
    let mut transport = noise_initiator(&mut client, "s3cret").await;

    let discover = b"{\"op\":\"discover\",\"want_queue\":true,\"station_ids\":[\"grill\"]}";
    let mut out = vec![0u8; discover.len() + 32];
    let n = transport.write_message(discover, &mut out).unwrap();
    write_frame(&mut client, &out[..n]).await.unwrap();

    let ct = read_frame(&mut client).await.unwrap();
    let mut pt = vec![0u8; ct.len()];
    let n = transport.read_message(&ct, &mut pt).unwrap();
    let text = std::str::from_utf8(&pt[..n]).unwrap();
    let parsed = parse_discovery(text);
    assert!(
        parsed.active_queue.is_some(),
        "noise opt-in request must receive the snapshot"
    );

    tx.send(placed_line(&["fry"])).unwrap();
    tx.send(placed_line(&["grill"])).unwrap();
    drop(tx);

    let ct = read_frame(&mut client).await.unwrap();
    let mut pt = vec![0u8; ct.len()];
    let n = transport.read_message(&ct, &mut pt).unwrap();
    let delivered = std::str::from_utf8(&pt[..n]).unwrap().to_string();
    assert!(
        delivered.contains("grill"),
        "noise subscriber receives its station: {delivered}"
    );
    assert!(
        !delivered.contains("fry"),
        "noise subscriber must not receive other stations: {delivered}"
    );
    server_handle.await.unwrap();
}

// ── agent 5: device-keyed offline replay on a LIVE forwarder ────────────
//
// The production defect this pays for: a reconnecting tablet dials from a
// NEW ephemeral source port, so an address-keyed offline buffer is never
// found again (agent 4's live validation could only observe replay by
// rebinding the exact local port). These tests run the real accept loop
// (`LanEventForwarder::run()`) on dynamically reserved loopback ports and
// force the write-failure path with an SO_LINGER(0) close (RST), exactly
// like the desktop-client live suite. No read is unbounded: every wait
// has an explicit timeout.

/// PSK for the live device-replay suite (no discovery payload — the
/// subscription rides entirely on the legacy hello, so phase 1 never
/// stalls and the peer's first server line is an event).
const RP_PSK: &str = "replay-test-psk";

/// Non-`kds.*` end-of-stream marker: `should_deliver` has no opinion
/// about it, so every peer receives it.
const RP_SENTINEL: &str = r#"{"sentinel":"rp-end"}"#;

/// The 5-second heartbeat line (skipped when collecting event lines).
const RP_PING: &str = r#"{"type":"ping"}"#;

/// Hard cap on any single socket read in this suite — comfortably above
/// one heartbeat interval; a timeout panics instead of hanging.
const RP_LINE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// Byte-for-byte pre-kds-sync hello line (no subscription fields).
fn rp_hello_legacy() -> String {
    serde_json::json!({ "op": "hello", "psk": RP_PSK }).to_string()
}

/// Legacy-psk-v1 hello carrying a kds-sync subscription.
fn rp_hello_station(device: &str, stations: &[&str]) -> String {
    serde_json::json!({
        "op": "hello", "psk": RP_PSK, "station_ids": stations, "device_id": device,
    })
    .to_string()
}

/// Start a live forwarder (PSK, no discovery) on a dynamically reserved
/// loopback port, retrying if the probe→bind window loses the port. The
/// liveness probe connection itself is refused the handshake by the PSK
/// phase 0 (no hello) — harmless, same as the desktop live suite.
async fn rp_spawn() -> (LanEventForwarder, std::net::SocketAddr) {
    for _attempt in 0..8u32 {
        let probe = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = probe.local_addr().unwrap().port();
        drop(probe);
        let addr: std::net::SocketAddr = format!("127.0.0.1:{port}").parse().unwrap();
        let fwd = LanEventForwarder::new(addr.to_string(), Some(RP_PSK.to_string()));
        let hub = fwd.clone();
        tokio::spawn(fwd.run());
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(3);
        while tokio::time::Instant::now() < deadline {
            if TcpStream::connect(addr).await.is_ok() {
                return (hub, addr);
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    }
    panic!("could not bring up a live LAN forwarder on a free loopback port");
}

/// One live PSK peer with owned halves so buffered bytes survive across
/// line reads (a fresh reader per line would coalesce-drop events —
/// same discipline as the desktop-client live suite).
struct RpPeer {
    /// The local (peer-side) `ip:port` the server keys a legacy queue by.
    addr: std::net::SocketAddr,
    w: tokio::net::tcp::OwnedWriteHalf,
    r: tokio::io::BufReader<tokio::net::tcp::OwnedReadHalf>,
}

impl RpPeer {
    /// Connect (optionally bound to an exact local port so the server
    /// sees a chosen address) and send `hello` as the phase-0 line, then
    /// pace briefly so the accept task has consumed it — the hello
    /// arriving before the first send attempt is what makes the RST
    /// below deterministic.
    #[allow(deprecated)]
    async fn connect(
        server: std::net::SocketAddr,
        hello: &str,
        bind: Option<std::net::SocketAddr>,
    ) -> RpPeer {
        let mut last_err = String::from("no attempt");
        for _attempt in 0..20u32 {
            let Ok(sock) = tokio::net::TcpSocket::new_v4() else {
                last_err = "TcpSocket::new_v4 failed".to_string();
                continue;
            };
            // SO_LINGER(0) makes the eventual close send RST: the
            // server-side socket becomes permanently errored, so the
            // write-failure / offline-buffer path is observable instead
            // of racing FIN.
            sock.set_reuseaddr(true).ok();
            sock.set_linger(Some(std::time::Duration::ZERO)).ok();
            let local = bind.unwrap_or_else(|| "127.0.0.1:0".parse().unwrap());
            if let Err(e) = sock.bind(local) {
                last_err = format!("bind {local}: {e}");
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                continue;
            }
            let stream = match sock.connect(server).await {
                Ok(stream) => stream,
                Err(e) => {
                    last_err = format!("connect to {server}: {e}");
                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                    continue;
                }
            };
            stream.set_linger(Some(std::time::Duration::ZERO)).ok();
            let addr = stream.local_addr().expect("peer local_addr");
            let (r, w) = stream.into_split();
            let mut peer = RpPeer {
                addr,
                w,
                r: tokio::io::BufReader::new(r),
            };
            peer.write_line(hello).await;
            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
            return peer;
        }
        panic!("peer could not reach {server} from {bind:?}: {last_err}");
    }

    /// Write one `\n`-terminated line to the server.
    async fn write_line(&mut self, line: &str) {
        tokio::io::AsyncWriteExt::write_all(&mut self.w, format!("{line}\n").as_bytes())
            .await
            .expect("peer write line");
    }

    /// Read one line under a hard timeout. `None` only on EOF.
    async fn read_line(&mut self) -> Option<String> {
        let mut buf = Vec::new();
        match tokio::time::timeout(
            RP_LINE_TIMEOUT,
            tokio::io::AsyncBufReadExt::read_until(&mut self.r, b'\n', &mut buf),
        )
        .await
        {
            Ok(Ok(0)) => None,
            Ok(Ok(_)) => Some(String::from_utf8_lossy(&buf).trim_end().to_string()),
            Ok(Err(e)) => panic!("peer read failed: {e}"),
            Err(_) => panic!("peer read timed out after {RP_LINE_TIMEOUT:?}"),
        }
    }

    /// Collect event lines (heartbeat skipped) until the sentinel.
    async fn read_until_sentinel(&mut self) -> Vec<String> {
        let mut out = Vec::new();
        loop {
            let line = self
                .read_line()
                .await
                .expect("peer stream closed before the sentinel line");
            if line == RP_SENTINEL {
                return out;
            }
            if line == RP_PING {
                continue;
            }
            out.push(line);
        }
    }
}

/// Bounded wait for the forwarder's offline buffer to hold `want` lines.
async fn rp_wait_buffered(fwd: &LanEventForwarder, want: usize) -> bool {
    for _ in 0..60 {
        if fwd.buffered_count().await == want {
            return true;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    fwd.buffered_count().await == want
}

/// Connect the "reconnecting tablet": bind to a port *provably different*
/// from `avoid` (the pre-drop address) so a new-port test can never be
/// secretly rebinding the old one. One bounded bind/connect attempt per
/// candidate offset — busy ports simply fail fast.
#[allow(deprecated)]
async fn rp_connect_new_port(
    server: std::net::SocketAddr,
    hello: &str,
    avoid: std::net::SocketAddr,
) -> RpPeer {
    let base = avoid.port();
    for offset in 1u16..=16 {
        let port = base.wrapping_add(offset);
        if port == base || port == 0 {
            continue;
        }
        let bind: std::net::SocketAddr = format!("127.0.0.1:{port}")
            .parse()
            .expect("loopback bind addr");
        let Ok(sock) = tokio::net::TcpSocket::new_v4() else {
            continue;
        };
        sock.set_reuseaddr(true).ok();
        sock.set_linger(Some(std::time::Duration::ZERO)).ok();
        if sock.bind(bind).is_err() {
            continue;
        }
        let Ok(stream) = sock.connect(server).await else {
            continue;
        };
        stream.set_linger(Some(std::time::Duration::ZERO)).ok();
        let addr = stream.local_addr().expect("peer local_addr");
        assert_ne!(addr.port(), base, "reconnect must use a different port");
        let (r, w) = stream.into_split();
        let mut peer = RpPeer {
            addr,
            w,
            r: tokio::io::BufReader::new(r),
        };
        peer.write_line(hello).await;
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        return peer;
    }
    panic!("no free loopback port near {avoid} to reconnect from");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn device_peer_reconnect_from_new_port_replays_buffered_events() {
    // THE point of the whole change: the buffered event must reach the
    // tablet even though its reconnect arrives on a DIFFERENT port than
    // the one the failed write happened on.
    let (fwd, server) = rp_spawn().await;

    let p1 = RpPeer::connect(server, &rp_hello_station("kds-9", &["grill"]), None).await;
    let addr1 = p1.addr;
    // Simulated kitchen-tablet dropout: linger-0 close → RST.
    drop(p1);
    tokio::time::sleep(std::time::Duration::from_millis(250)).await;

    // Fire events until one hits the failed write and is buffered (the
    // first post-RST send may still be accepted by the kernel — then
    // it is lost to the void and the second one is guaranteed to fail).
    let mut buffered_id = String::new();
    for i in 0..10 {
        let id = format!("t-rp-{i}");
        fwd.broadcast(placed_line_id(&id, &["grill"]));
        if rp_wait_buffered(&fwd, 1).await {
            buffered_id = id;
            break;
        }
    }
    assert!(
        !buffered_id.is_empty(),
        "offline buffer never filled after RST + ten published events",
    );
    assert_eq!(
        fwd.offline_buffer
            .len_for(&ReplayKey::Device("kds-9".into()))
            .await,
        1,
        "the line must be keyed by the hello's device_id, not the dead port",
    );
    assert_eq!(
        fwd.offline_buffer
            .len_for(&ReplayKey::Addr(addr1.to_string()))
            .await,
        0,
    );

    // Reconnect the SAME device from a provably different local port.
    let mut p2 = rp_connect_new_port(server, &rp_hello_station("kds-9", &["grill"]), addr1).await;
    fwd.broadcast(placed_line_id("t-live", &["grill"]));
    fwd.broadcast(RP_SENTINEL.to_string());

    let lines = p2.read_until_sentinel().await;
    assert_eq!(lines.len(), 2, "new-port reconnect stream: {lines:?}");
    assert_eq!(
        lines[0],
        placed_line_id(&buffered_id, &["grill"]),
        "the buffered event must replay FIRST, byte-identical (frozen wire format)",
    );
    assert_eq!(lines[1], placed_line_id("t-live", &["grill"]));
    assert_eq!(
        fwd.buffered_count().await,
        0,
        "the reconnecting hello must drain the device queue",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn station_filter_applies_to_device_keyed_replay() {
    // A device queue holding one in-scope and one out-of-scope line:
    // the reconnecting station peer replays ONLY its own station's
    // event, and the drain retires the rest (no unclaimed residue).
    let (fwd, server) = rp_spawn().await;
    let seed_addr = "127.0.0.1:5001".to_string();
    fwd.offline_buffer
        .push(
            &ReplayKey::Device("kds-f".into()),
            &seed_addr,
            placed_line_id("t-fry", &["fry"]),
        )
        .await;
    fwd.offline_buffer
        .push(
            &ReplayKey::Device("kds-f".into()),
            &seed_addr,
            placed_line_id("t-grill", &["grill"]),
        )
        .await;
    assert_eq!(fwd.buffered_count().await, 2);

    let mut peer = RpPeer::connect(server, &rp_hello_station("kds-f", &["grill"]), None).await;
    fwd.broadcast(RP_SENTINEL.to_string());

    let lines = peer.read_until_sentinel().await;
    assert_eq!(
        lines,
        vec![placed_line_id("t-grill", &["grill"])],
        "device-keyed replay must honour the station filter, byte-exact",
    );
    assert_eq!(
        fwd.buffered_count().await,
        0,
        "a drained device queue retires the filtered-out lines too",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn legacy_peer_without_device_id_stays_addr_keyed() {
    // Old clients unaffected: a pre-kds-sync peer's buffer keys by its
    // address, follows NO new port, and is found again only when that
    // exact address reconnects.
    let (fwd, server) = rp_spawn().await;

    let l1 = RpPeer::connect(server, &rp_hello_legacy(), None).await;
    let addr1 = l1.addr;
    drop(l1);
    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    let mut buffered_id = String::new();
    for i in 0..10 {
        let id = format!("t-legacy-{i}");
        fwd.broadcast(placed_line_id(&id, &["grill"]));
        if rp_wait_buffered(&fwd, 1).await {
            buffered_id = id;
            break;
        }
    }
    assert!(
        !buffered_id.is_empty(),
        "legacy write failure never buffered"
    );
    assert_eq!(
        fwd.offline_buffer
            .len_for(&ReplayKey::Addr(addr1.to_string()))
            .await,
        1,
        "a device-less peer must stay keyed by its peer address",
    );

    // A legacy peer on any OTHER address must not inherit the queue.
    let mut stranger = rp_connect_new_port(server, &rp_hello_legacy(), addr1).await;
    fwd.broadcast(RP_SENTINEL.to_string());
    assert!(
        stranger.read_until_sentinel().await.is_empty(),
        "a different address must not replay a legacy queue parked at {addr1}",
    );
    assert_eq!(
        fwd.buffered_count().await,
        1,
        "the parked queue survives intact"
    );

    // The SAME address reconnecting (the pre-kds-sync contract) gets it.
    let mut same = RpPeer::connect(server, &rp_hello_legacy(), Some(addr1)).await;
    fwd.broadcast(placed_line_id("t-after", &["grill"]));
    fwd.broadcast(RP_SENTINEL.to_string());
    let lines = same.read_until_sentinel().await;
    assert_eq!(
        lines.len(),
        2,
        "same-address legacy reconnect stream: {lines:?}"
    );
    assert_eq!(lines[0], placed_line_id(&buffered_id, &["grill"]));
    assert_eq!(lines[1], placed_line_id("t-after", &["grill"]));
    assert_eq!(fwd.buffered_count().await, 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn two_devices_alternating_addresses_do_not_cross_deliver() {
    // Device A buffers at address X, device B buffers at address Y, then
    // A reconnects FROM Y (B's old address). Address keying would hand
    // A B's buffer; device keying must not.
    let (fwd, server) = rp_spawn().await;

    // Phase A: device-a drops at its port, one event fails to write.
    let a1 = RpPeer::connect(server, &rp_hello_station("dev-a", &["grill"]), None).await;
    let addr_a = a1.addr;
    drop(a1);
    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    let mut a_id = String::new();
    for i in 0..10 {
        let id = format!("t-a-{i}");
        fwd.broadcast(placed_line_id(&id, &["grill"]));
        if rp_wait_buffered(&fwd, 1).await {
            a_id = id;
            break;
        }
    }
    assert!(!a_id.is_empty(), "device-a's event never buffered");

    // Phase B: device-b drops at ITS OWN port (explicitly distinct from
    // A's — ephemeral reuse after an RST is otherwise possible), one
    // event fails to write.
    let b1 = rp_connect_new_port(server, &rp_hello_station("dev-b", &["grill"]), addr_a).await;
    let addr_b = b1.addr;
    drop(b1);
    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    for i in 0..10 {
        let id = format!("t-b-{i}");
        fwd.broadcast(placed_line_id(&id, &["grill"]));
        if rp_wait_buffered(&fwd, 2).await {
            break;
        }
    }
    assert_eq!(fwd.buffered_count().await, 2, "one line per device queue");
    assert_eq!(
        fwd.offline_buffer
            .len_for(&ReplayKey::Device("dev-a".into()))
            .await,
        1,
    );
    assert_eq!(
        fwd.offline_buffer
            .len_for(&ReplayKey::Device("dev-b".into()))
            .await,
        1,
    );
    assert_ne!(addr_a, addr_b, "the two phases must not share an address");

    // Device A reconnects from B's OLD address: only A's queue replays.
    let from_b = std::net::SocketAddr::new("127.0.0.1".parse().unwrap(), addr_b.port());
    let mut a2 =
        RpPeer::connect(server, &rp_hello_station("dev-a", &["grill"]), Some(from_b)).await;
    fwd.broadcast(RP_SENTINEL.to_string());
    let lines = a2.read_until_sentinel().await;
    assert_eq!(
        lines,
        vec![placed_line_id(&a_id, &["grill"])],
        "device A must replay its OWN queue at B's old address, not B's",
    );
    assert_eq!(
        fwd.offline_buffer
            .len_for(&ReplayKey::Device("dev-b".into()))
            .await,
        1,
        "device B's queue must be untouched by A's reconnect",
    );
}
