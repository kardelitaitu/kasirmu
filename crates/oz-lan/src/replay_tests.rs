use super::*;

fn dev(id: &str) -> ReplayKey {
    ReplayKey::Device(id.to_string())
}

fn addr(a: &str) -> ReplayKey {
    ReplayKey::Addr(a.to_string())
}

async fn push_n(buffer: &OfflineReplayBuffer, key: &ReplayKey, prefix: &str, n: usize, at: &str) {
    for i in 0..n {
        buffer.push(key, at, format!("{prefix}-{i}")).await;
    }
}

#[tokio::test]
async fn per_device_cap_drops_oldest_with_bounded_growth() {
    let buffer = OfflineReplayBuffer::new();
    // One absent device floods 250 events past the per-peer cap.
    push_n(
        &buffer,
        &dev("kds-9"),
        "e",
        MAX_OFFLINE_BUFFER_PER_PEER + 250,
        "127.0.0.1:5001",
    )
    .await;
    assert_eq!(
        buffer.len_for(&dev("kds-9")).await,
        MAX_OFFLINE_BUFFER_PER_PEER,
        "per-device queue must stop at the cap"
    );
    assert_eq!(
        buffer.event_count().await,
        MAX_OFFLINE_BUFFER_PER_PEER,
        "total growth must be bounded by the same cap for one device"
    );
    let drained = buffer.drain(&dev("kds-9")).await;
    assert_eq!(drained.events.first().unwrap(), &format!("e-{}", 250));
    assert_eq!(
        drained.events.last().unwrap(),
        &format!("e-{}", MAX_OFFLINE_BUFFER_PER_PEER + 249)
    );
}

#[tokio::test]
async fn total_cap_evicts_global_oldest_across_queues() {
    let buffer = OfflineReplayBuffer::new();
    // Fill exactly the total cap with 8 device queues.
    let queues = MAX_OFFLINE_BUFFER_TOTAL / MAX_OFFLINE_BUFFER_PER_PEER;
    for q in 0..queues {
        push_n(
            &buffer,
            &dev(&format!("d{q}")),
            &format!("q{q}"),
            MAX_OFFLINE_BUFFER_PER_PEER,
            "127.0.0.1:1",
        )
        .await;
    }
    assert_eq!(buffer.event_count().await, MAX_OFFLINE_BUFFER_TOTAL);
    assert_eq!(buffer.queue_count().await, queues);

    // A 9th device arriving must evict globally — the OLDEST events
    // belong to d0, so they go first even though d0's queue is idle.
    push_n(&buffer, &dev("d-new"), "n", 100, "127.0.0.1:2").await;
    assert_eq!(
        buffer.event_count().await,
        MAX_OFFLINE_BUFFER_TOTAL,
        "total cap is a hard bound"
    );
    assert_eq!(
        buffer.len_for(&dev("d0")).await,
        MAX_OFFLINE_BUFFER_PER_PEER - 100,
        "eviction must take the globally oldest events (d0's front), not the newest queue's"
    );
    let d0 = buffer.drain(&dev("d0")).await;
    assert_eq!(d0.events.first().unwrap(), "q0-100");
    assert_eq!(
        buffer.len_for(&dev("d-new")).await,
        100,
        "the newcomer's fresh events must survive"
    );
    assert_eq!(
        buffer.len_for(&dev(&format!("d{}", queues - 1))).await,
        MAX_OFFLINE_BUFFER_PER_PEER,
        "an untouched mid-list queue keeps its full history"
    );
}

#[tokio::test]
async fn drain_reports_source_addr_and_new_pushes_reattach_it() {
    let buffer = OfflineReplayBuffer::new();
    buffer
        .push(&dev("kds-9"), "10.0.0.5:41000", "x".into())
        .await;
    let first = buffer.drain(&dev("kds-9")).await;
    assert_eq!(first.events, vec!["x".to_string()]);
    assert_eq!(first.source_addr.as_deref(), Some("10.0.0.5:41000"));
    // Empty identity drains silently.
    let none = buffer.drain(&dev("kds-9")).await;
    assert!(none.events.is_empty());
    assert_eq!(none.source_addr, None);
    // After the tablet reconnects elsewhere and drops again, the queue
    // follows it: the next drain reports the NEW source address.
    buffer
        .push(&dev("kds-9"), "10.0.0.5:42000", "y".into())
        .await;
    let second = buffer.drain(&dev("kds-9")).await;
    assert_eq!(second.source_addr.as_deref(), Some("10.0.0.5:42000"));
}

#[tokio::test]
async fn device_and_addr_keys_never_collide_under_equal_strings() {
    let buffer = OfflineReplayBuffer::new();
    buffer
        .push(&dev("1.2.3.4:9000"), "1.2.3.4:9000", "dev-line".into())
        .await;
    buffer
        .push(&addr("1.2.3.4:9000"), "1.2.3.4:9000", "addr-line".into())
        .await;
    assert_eq!(buffer.queue_count().await, 2);
    let device = buffer.drain(&dev("1.2.3.4:9000")).await;
    assert_eq!(device.events, vec!["dev-line".to_string()]);
    assert_eq!(
        buffer.len_for(&addr("1.2.3.4:9000")).await,
        1,
        "draining the device key must not touch the address key"
    );
}

#[tokio::test]
async fn two_devices_do_not_see_each_owners_queues() {
    let buffer = OfflineReplayBuffer::new();
    push_n(&buffer, &dev("dev-a"), "a", 3, "127.0.0.1:5001").await;
    push_n(&buffer, &dev("dev-b"), "b", 3, "127.0.0.1:5002").await;
    // dev-a reconnects FROM dev-b's old address: the device queues stay
    // strictly separate no matter which port the reconnect arrives on.
    let a = buffer.drain(&dev("dev-a")).await;
    assert_eq!(
        a.events,
        vec!["a-0".to_string(), "a-1".to_string(), "a-2".to_string()]
    );
    assert_eq!(buffer.len_for(&dev("dev-b")).await, 3);
}

#[tokio::test]
async fn from_subscription_prefers_device_id_then_falls_back_to_addr() {
    let with_device = PeerSubscription {
        device_id: Some("kds-9".into()),
        station_ids: vec!["grill".into()],
    };
    assert_eq!(
        ReplayKey::from_subscription(Some(&with_device), "127.0.0.1:7000"),
        dev("kds-9")
    );
    let without_device = PeerSubscription {
        device_id: None,
        station_ids: vec!["grill".into()],
    };
    assert_eq!(
        ReplayKey::from_subscription(Some(&without_device), "127.0.0.1:7000"),
        addr("127.0.0.1:7000")
    );
    assert_eq!(
        ReplayKey::from_subscription(None, "127.0.0.1:7000"),
        addr("127.0.0.1:7000")
    );
}
