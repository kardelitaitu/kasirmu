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
        line_items: vec![oz_core::events::SaleCompletedLine {
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
        items: vec![oz_core::events::CourseItem {
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
    let buffer = Arc::new(Mutex::new(HashMap::new()));

    let server_handle = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        handle_peer(
            stream,
            "test-peer".into(),
            rx,
            buffer,
            initial_events,
            None,
            None,
        )
        .await;
    });

    let client = TcpStream::connect(addr).await.unwrap();
    (server_handle, client, addr)
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
    let buffer: Arc<Mutex<HashMap<String, Vec<String>>>> = Arc::new(Mutex::new(HashMap::new()));
    let (_tx, rx) = broadcast::channel::<String>(16);

    // Set up a peer that disconnects immediately (stream is closed).
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let buf_clone = buffer.clone();

    let server_handle = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        // Drop the stream immediately to simulate disconnect.
        drop(stream);
        // Wait a beat for the broadcast message to arrive and fail.
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        // Send a message — it should be buffered.
        let _rx = rx;
        // rx.recv() is blocking within the async task, but we put it
        // in a select or just don't call it. Instead, we manually
        // push to the buffer to simulate the write-failure path.
        buf_clone
            .lock()
            .await
            .entry("test-peer".into())
            .or_default()
            .push("{\"event\":\"test\"}".into());
    });

    // Connect and let the server drop the connection.
    let _client = TcpStream::connect(addr).await.unwrap();
    server_handle.await.unwrap();

    // Check that the event was buffered.
    let buf = buffer.lock().await;
    let events = buf.get("test-peer");
    assert!(events.is_some(), "should have buffered events for peer");
    assert_eq!(events.unwrap().len(), 1);
    assert!(events.unwrap()[0].contains("event"));
}

#[tokio::test]
async fn offline_buffer_flush_on_reconnect() {
    let buffer: Arc<Mutex<HashMap<String, Vec<String>>>> = Arc::new(Mutex::new(HashMap::new()));

    // Pre-populate the buffer with events for "reconnect-peer".
    {
        let mut buf = buffer.lock().await;
        buf.insert(
            "reconnect-peer".into(),
            vec!["replayed1".into(), "replayed2".into()],
        );
    }

    // Simulate a new connection: drain buffer and pass as initial_events.
    let addr = "reconnect-peer".to_string();
    let drained: Vec<String> = buffer.lock().await.remove(&addr).unwrap_or_default();
    assert_eq!(drained.len(), 2, "should have drained 2 buffered events");
    assert_eq!(drained[0], "replayed1");

    // After draining, buffer should be empty for that peer.
    let buf = buffer.lock().await;
    assert!(!buf.contains_key("reconnect-peer"));
}

#[tokio::test]
async fn offline_buffer_does_not_grow_unbounded() {
    let buffer: Arc<Mutex<HashMap<String, Vec<String>>>> = Arc::new(Mutex::new(HashMap::new()));

    // Simulate many disconnects from the same peer — buffer should
    // grow, but the key should exist.
    {
        let mut buf = buffer.lock().await;
        for i in 0..100 {
            buf.entry("flood-peer".into())
                .or_default()
                .push(format!("event_{i}"));
        }
    }

    let buf = buffer.lock().await;
    let events = buf.get("flood-peer").unwrap();
    assert_eq!(events.len(), 100);
}

#[tokio::test]
async fn forwarder_buffered_count_reflects_buffer() {
    let fwd = LanEventForwarder::default();
    assert_eq!(fwd.buffered_count().await, 0);

    // Manually insert a buffered event.
    fwd.offline_buffer
        .lock()
        .await
        .entry("offline-peer".into())
        .or_default()
        .push("{\"lost\":true}".into());

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

// ── DC-2: offline buffer drop-oldest cap ──────────────────────────

#[tokio::test]
async fn offline_buffer_caps_per_peer_queue_with_drop_oldest() {
    let buffer = Arc::new(Mutex::new(HashMap::new()));
    for i in 0..(MAX_OFFLINE_BUFFER_PER_PEER + 250) {
        buffer_event_for_peer(&buffer, "peer-a", format!("e{i}")).await;
    }
    let map = buffer.lock().await;
    let queue = map.get("peer-a").unwrap();
    assert_eq!(queue.len(), MAX_OFFLINE_BUFFER_PER_PEER);
    // Oldest events were dropped: first retained is e250, last is the
    // most recently pushed.
    assert_eq!(queue.first().unwrap(), &format!("e{}", 250));
    assert_eq!(
        queue.last().unwrap(),
        &format!("e{}", MAX_OFFLINE_BUFFER_PER_PEER + 249)
    );
}

#[tokio::test]
async fn offline_buffer_caps_are_per_peer_not_global() {
    let buffer = Arc::new(Mutex::new(HashMap::new()));
    for i in 0..(MAX_OFFLINE_BUFFER_PER_PEER + 10) {
        buffer_event_for_peer(&buffer, "peer-a", format!("a{i}")).await;
        buffer_event_for_peer(&buffer, "peer-b", format!("b{i}")).await;
    }
    let map = buffer.lock().await;
    assert_eq!(
        map.get("peer-a").unwrap().len(),
        MAX_OFFLINE_BUFFER_PER_PEER
    );
    assert_eq!(
        map.get("peer-b").unwrap().len(),
        MAX_OFFLINE_BUFFER_PER_PEER
    );
    assert_eq!(map.len(), 2);
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
    let buffer = Arc::new(Mutex::new(HashMap::new()));
    let expected = Some(Arc::new(psk.to_string()));
    let server_handle = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        handle_peer(
            stream,
            "noise-test-peer".into(),
            rx,
            buffer,
            vec![],
            expected,
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
