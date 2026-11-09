use std::collections::{HashMap, VecDeque};

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
// ── O-M51: eviction order equivalence and index upkeep ───────────────
//
// The pre-O-M51 push evicted the total-cap victim with a full scan:
//
//     inner.queues.iter()
//         .filter(|(_, q)| !q.events.is_empty())
//         .min_by_key(|(_, q)| q.events.front().map_or(u64::MAX, |e| e.seq))
//
// i.e. the queue whose FRONT holds the smallest insertion `seq`. Because
// `seq` is monotonic under the mutex and every queue is FIFO, that is the
// globally oldest INSERTED event — insertion order, not timestamp order.
// `ScanOracle` below reimplements that scan verbatim, so these tests
// compare the two victims after every single push instead of trusting the
// argument above.

/// FIFO reference model: a replay of the pre-O-M51 full-scan eviction.
struct ScanOracle {
    queues: HashMap<ReplayKey, VecDeque<u64>>,
    next_seq: u64,
    total: usize,
}

impl ScanOracle {
    fn new() -> Self {
        Self {
            queues: HashMap::new(),
            next_seq: 0,
            total: 0,
        }
    }

    /// Mirrors the old `push` — per-peer drop-oldest, then the scan.
    /// Returns the seqs evicted by this push, oldest first.
    fn push(&mut self, key: &ReplayKey) -> Vec<u64> {
        let mut evicted = Vec::new();
        {
            let queue = self.queues.entry(key.clone()).or_default();
            if queue.len() >= MAX_OFFLINE_BUFFER_PER_PEER
                && let Some(dropped) = queue.pop_front()
            {
                self.total -= 1;
                evicted.push(dropped);
            }
            queue.push_back(self.next_seq);
        }
        self.next_seq += 1;
        self.total += 1;
        while self.total > MAX_OFFLINE_BUFFER_TOTAL {
            let oldest = self
                .queues
                .iter()
                .filter(|(_, queue)| !queue.is_empty())
                .min_by_key(|(_, queue)| queue.front().copied().unwrap_or(u64::MAX))
                .map(|(key, _)| key.clone());
            let Some(oldest) = oldest else {
                break;
            };
            let mut emptied = false;
            let evicted_seq = self.queues.get_mut(&oldest).and_then(|queue| {
                let seq = queue.pop_front();
                emptied = queue.is_empty();
                seq
            });
            let Some(evicted_seq) = evicted_seq else {
                break;
            };
            self.total -= 1;
            evicted.push(evicted_seq);
            if emptied {
                self.queues.remove(&oldest);
            }
        }
        evicted
    }

    /// The event the scan would evict next, as `(seq, label)`.
    fn head(&self) -> Option<(u64, String)> {
        self.queues
            .iter()
            .filter(|(_, queue)| !queue.is_empty())
            .min_by_key(|(_, queue)| queue.front().copied().unwrap_or(u64::MAX))
            .map(|(key, queue)| (*queue.front().unwrap(), key.label()))
    }

    fn drain(&mut self, key: &ReplayKey) -> Vec<u64> {
        let queue = self.queues.remove(key).unwrap_or_default();
        self.total -= queue.len();
        queue.into_iter().collect()
    }
}

/// A deliberately adversarial push sequence: bulk fills, a per-peer cap
/// flush, single-event dribbles, re-fills, a second identity, and a burst
/// past the total cap that forces several evictions from one push.
fn scripted_ops() -> Vec<(ReplayKey, usize)> {
    let keys = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    let mut ops: Vec<(ReplayKey, usize)> = Vec::new();
    for (i, k) in keys.iter().enumerate() {
        ops.push((dev(k), MAX_OFFLINE_BUFFER_PER_PEER + 7 * i));
    }
    ops.push((addr("10.0.0.9:5000"), 3));
    for i in 0..600 {
        ops.push((dev(keys[i % keys.len()]), 1));
    }
    ops.push((dev("a"), MAX_OFFLINE_BUFFER_PER_PEER));
    ops.push((dev("j"), 40));
    ops.push((dev("b"), 900));
    ops.push((addr("10.0.0.9:5000"), 5));
    ops.push((dev("c"), MAX_OFFLINE_BUFFER_PER_PEER));
    ops.push((dev("k"), 300));
    ops
}

#[tokio::test]
async fn eviction_matches_the_old_full_scan_for_the_same_insertion_sequence() {
    let buffer = OfflineReplayBuffer::new();
    let mut oracle = ScanOracle::new();
    let mut total_drops = 0usize;
    // Every line is tagged with its insertion seq so a queued event can be
    // traced back to the oracle's own numbering.
    let mut seq = 0u64;

    for (i, (key, count)) in scripted_ops().into_iter().enumerate() {
        for _ in 0..count {
            buffer
                .push(&key, "127.0.0.1:1", format!("line#{seq}"))
                .await;
            seq += 1;
            total_drops += oracle.push(&key).len();
            buffer.assert_invariants().await;
            assert_eq!(
                buffer.event_count().await,
                oracle.total,
                "op {i}: population diverged from the scan oracle"
            );
            assert_eq!(
                buffer.eviction_head().await,
                oracle.head(),
                "op {i}: the next eviction victim must be the one the old scan picked"
            );
        }
    }
    assert!(
        total_drops > MAX_OFFLINE_BUFFER_PER_PEER,
        "the scripted sequence must exercise eviction (got {total_drops} drops)"
    );

    // Contents agree queue by queue, oldest first: the survivors must be
    // the same seqs, in the same order, as the scan model's.
    for key in ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"] {
        let drained = buffer.drain(&dev(key)).await;
        let mine: Vec<u64> = drained
            .events
            .iter()
            .map(|line| {
                line.strip_prefix("line#")
                    .and_then(|s| s.parse().ok())
                    .unwrap_or_else(|| panic!("unexpected line payload {line}"))
            })
            .collect();
        assert_eq!(
            mine,
            oracle.drain(&dev(key)),
            "queue {key}: surviving seqs must match the scan oracle exactly"
        );
    }
    let addr_key = addr("10.0.0.9:5000");
    assert_eq!(
        buffer.drain(&addr_key).await.events.len(),
        oracle.drain(&addr_key).len()
    );
    buffer.assert_invariants().await;
    assert_eq!(buffer.event_count().await, 0);
}

#[tokio::test]
async fn per_peer_cap_and_global_eviction_interleave_without_drift() {
    // Every queue at the total cap, then repeated pushes on the queue
    // whose front is also the global index head: both caps fire on the
    // same push. If the per-peer pop did not also leave the global index,
    // the index head would drift onto a seq that is no longer buffered and
    // total-cap eviction would start eating the untouched queues.
    let buffer = OfflineReplayBuffer::new();
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
        buffer.assert_invariants().await;
    }
    for round in 0..(MAX_OFFLINE_BUFFER_PER_PEER * 2) {
        buffer
            .push(&dev("d0"), "127.0.0.1:1", format!("r{round}"))
            .await;
        buffer.assert_invariants().await;
    }
    assert_eq!(buffer.event_count().await, MAX_OFFLINE_BUFFER_TOTAL);
    let d0 = buffer.drain(&dev("d0")).await;
    assert_eq!(d0.events.len(), MAX_OFFLINE_BUFFER_PER_PEER);
    assert_eq!(
        d0.events.last().unwrap(),
        &format!("r{}", MAX_OFFLINE_BUFFER_PER_PEER * 2 - 1),
        "the freshest line of the churning queue must survive"
    );
    for q in 1..queues {
        assert_eq!(
            buffer.len_for(&dev(&format!("d{q}"))).await,
            MAX_OFFLINE_BUFFER_PER_PEER,
            "an untouched queue must not lose events to a drifted index"
        );
    }
    buffer.assert_invariants().await;
}

#[tokio::test]
async fn drain_punches_a_hole_the_index_survives() {
    // A drain removes a whole queue from the middle of the insertion
    // index. If the index kept the drained seqs, the total cap would pop
    // them first, find no event, and skip the eviction that push owed —
    // the cap would quietly stop evicting. Pin the hole and its repair.
    //
    // Every observable below is read from this buffer under one lock, so
    // the test holds whatever else runs in parallel.
    let buffer = OfflineReplayBuffer::new();
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

    // Drain the globally-oldest queue entirely: the head of the index.
    let drained = buffer.drain(&dev("d0")).await;
    assert_eq!(drained.events.len(), MAX_OFFLINE_BUFFER_PER_PEER);
    buffer.assert_invariants().await;
    assert_eq!(
        buffer.event_count().await,
        MAX_OFFLINE_BUFFER_TOTAL - MAX_OFFLINE_BUFFER_PER_PEER
    );
    // The index must point at the oldest SURVIVING event immediately, not
    // at a stale d0 entry — a drifted index would pick a drained seq.
    let survivor_head = buffer.eviction_order().await.first().cloned();
    assert_eq!(
        survivor_head.as_ref().map(|(_, k)| k.as_str()),
        Some("device:d1"),
        "after a drain, the index head must be the oldest live event"
    );
    let survivor_head_seq = survivor_head.unwrap().0;

    // Refill the hole: d1..d7 hold 7 × 1,024 = 7,168 events, so 1,024
    // pushes on the fresh identity n0 land exactly on the cap and evict
    // nothing (the filler's own per-peer cap is never reached, so the
    // global path stays dormant and cannot be the thing under test here).
    push_n(
        &buffer,
        &dev("n0"),
        "n",
        MAX_OFFLINE_BUFFER_PER_PEER,
        "127.0.0.1:2",
    )
    .await;
    buffer.assert_invariants().await;
    assert_eq!(buffer.event_count().await, MAX_OFFLINE_BUFFER_TOTAL);
    for q in 1..queues {
        assert_eq!(
            buffer.len_for(&dev(&format!("d{q}"))).await,
            MAX_OFFLINE_BUFFER_PER_PEER,
            "refilling the drained hole must not cost any survivor anything"
        );
    }

    // Now the total cap alone must drive the next pushes. n0 is FULL, so
    // a push into it would be absorbed by n0's own per-peer cap and the
    // global eviction would never fire (`push` runs per-peer first, as the
    // original code did). Push into a DRAINED-nothing queue with full
    // headroom instead — index QUEUE, which starts empty — so every one of
    // these pushes genuinely crosses the total cap and must evict exactly
    // one live event: always the globally oldest, d1's front.
    let mut expected_d1 = MAX_OFFLINE_BUFFER_PER_PEER;
    for step in 1..=3usize {
        buffer
            .push(&dev("extra"), "127.0.0.1:3", format!("x{step}"))
            .await;
        buffer.assert_invariants().await;
        expected_d1 -= 1;
        assert_eq!(
            buffer.event_count().await,
            MAX_OFFLINE_BUFFER_TOTAL,
            "step {step}: the total cap stays a hard bound"
        );
        assert_eq!(
            buffer.len_for(&dev("d1")).await,
            expected_d1,
            "step {step}: the push past the cap evicted a live event from the oldest survivor"
        );
        for q in 2..queues {
            assert_eq!(
                buffer.len_for(&dev(&format!("d{q}"))).await,
                MAX_OFFLINE_BUFFER_PER_PEER,
                "step {step}: a queue behind d1 keeps its history"
            );
        }
        assert_eq!(
            buffer.len_for(&dev("extra")).await,
            step,
            "step {step}: the fresh queue keeps what it pushed"
        );
        assert_eq!(
            buffer.eviction_order().await.first().cloned(),
            Some((survivor_head_seq + step as u64, "device:d1".to_string())),
            "step {step}: the next victim is d1's next-oldest line — never a drained seq"
        );
    }
}

#[tokio::test]
async fn replay_after_eviction_reports_exactly_the_survivors() {
    // A replay buffer's contract is *which lines a reconnecting peer still
    // gets*. Pin it after a global eviction: the evicted events are gone
    // (forgotten), every survivor replays byte-identically and in order,
    // and the queue is emptied so it cannot replay twice.
    let buffer = OfflineReplayBuffer::new();
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
    push_n(&buffer, &dev("d-new"), "n", 100, "127.0.0.1:2").await;
    buffer.assert_invariants().await;
    assert_eq!(buffer.event_count().await, MAX_OFFLINE_BUFFER_TOTAL);

    let d0 = buffer.drain(&dev("d0")).await;
    let expected: Vec<String> = (100..MAX_OFFLINE_BUFFER_PER_PEER)
        .map(|i| format!("q0-{i}"))
        .collect();
    assert_eq!(
        d0.events, expected,
        "replay must hand back exactly the surviving lines, oldest first"
    );
    assert!(
        !d0.events.iter().any(|line| line == "q0-99"),
        "the evicted line must never resurface in a replay"
    );
    assert_eq!(
        d0.source_addr.as_deref(),
        Some("127.0.0.1:1"),
        "the surviving queue keeps its source address for the handoff log"
    );
    let again = buffer.drain(&dev("d0")).await;
    assert!(
        again.events.is_empty(),
        "a drained queue must not replay twice"
    );
    assert_eq!(again.source_addr, None);
    buffer.assert_invariants().await;
}
