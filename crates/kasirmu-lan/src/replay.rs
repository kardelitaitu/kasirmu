//! Bounded offline-replay buffer for disconnected LAN peers.
//!
//! One queue per *replay identity*: a peer whose `hello`/`discover`
//! carried a `device_id` keeps a [`ReplayKey::Device`] queue that
//! survives source-port changes (a reconnecting tablet gets a new
//! ephemeral TCP port on every dial, so address keying could never find
//! its queue again); a device-less (pre-kds-sync) peer keeps the legacy
//! [`ReplayKey::Addr`] queue keyed by that address. The
//! [`OfflineReplayBuffer`] is cheap to clone (one `Arc` inside) and is
//! shared by the accept loop and every `handle_peer` task. Retention is
//! bounded twice: each queue holds at most [`MAX_OFFLINE_BUFFER_PER_PEER`]
//! lines and the whole buffer at most [`MAX_OFFLINE_BUFFER_TOTAL`], both
//! enforced drop-oldest with a `tracing::warn!`. Wire bytes are never
//! touched here — the buffer stores already-serialised JSON lines
//! verbatim for byte-identical replay.
//!
//! # Eviction order
//!
//! The total cap evicts strictly by **insertion order**, which is exactly
//! the order the original `min_by_key(front.seq)` full scan produced:
//! `seq` is assigned monotonically under the buffer mutex and every queue
//! is FIFO, so the smallest `seq` still buffered is the oldest insertion.
//! [`BufferInner::fifo`] is that order kept incrementally: every process
//! that removes an event (per-peer drop, global eviction, drain) removes
//! its `seq` from the index in the same step, so eviction pops the true
//! global oldest without scanning the queue map — and can never target a
//! `seq` that is no longer buffered.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;

use tokio::sync::Mutex;

use crate::kds_sync::PeerSubscription;

/// Maximum number of events buffered for one replay identity (device or
/// address) — the DC-2 cap, unchanged: each queued event is a JSON line,
/// so 1024 keeps one absent peer in the ~hundreds-of-KB range.
pub(crate) const MAX_OFFLINE_BUFFER_PER_PEER: usize = 1024;

/// Maximum number of events retained across **all** queues combined.
/// Device keying made queue count follow *device* count rather than the
/// number of live connections, so the sum needs its own bound: 8× the
/// per-peer cap ≈ a few MB worst case on a POS machine, evicted globally
/// oldest-first (a starved queue dies before it can cannibalise the
/// freshest devices' history).
pub(crate) const MAX_OFFLINE_BUFFER_TOTAL: usize = 8192;

/// Identity an offline-replay queue is keyed by.
///
/// The two variants are distinct namespaces even for equal strings: a
/// `device_id` that happens to look like an address never mixes queues.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) enum ReplayKey {
    /// A `device_id` the peer presented on its `hello`/`discover` line.
    /// Stable across reconnections — including a new ephemeral port.
    Device(String),
    /// Legacy fallback: the peer's ephemeral TCP address (`ip:port`),
    /// claimed only by a connection arriving on exactly that address.
    Addr(String),
}

impl ReplayKey {
    /// Replay identity for one connection: the `device_id` from the
    /// negotiated subscription when present, else the peer address.
    pub(crate) fn from_subscription(
        subscription: Option<&PeerSubscription>,
        peer_addr: &str,
    ) -> ReplayKey {
        subscription
            .and_then(|s| s.device_id.as_deref())
            .map(|device_id| Self::Device(device_id.to_string()))
            .unwrap_or_else(|| Self::Addr(peer_addr.to_string()))
    }

    /// Short human-readable label for log fields.
    fn label(&self) -> String {
        match self {
            Self::Device(device_id) => format!("device:{device_id}"),
            Self::Addr(addr) => format!("addr:{addr}"),
        }
    }
}

/// Outcome of draining one key: its buffered lines in arrival order,
/// plus the peer address they were last buffered from (the handoff the
/// caller logs when the reconnecting address differs).
#[derive(Debug, Default)]
pub(crate) struct ReplayDrain {
    /// Buffered JSON lines, oldest first.
    pub(crate) events: Vec<String>,
    /// The `peer_addr` recorded at the newest push into this queue.
    pub(crate) source_addr: Option<String>,
}

/// One buffered event. `seq` is the global insertion counter that lets
/// the total cap evict the oldest line anywhere, not just per queue.
#[derive(Debug, Clone)]
struct BufferedEvent {
    seq: u64,
    line: String,
}

/// One identity's queue plus the address it was last written from.
#[derive(Debug, Default)]
struct PeerQueue {
    events: VecDeque<BufferedEvent>,
    last_addr: Option<String>,
}

/// Shared mutable state behind the buffer's mutex.
///
/// Every event lives in exactly one `queues` slot **and** its `seq` in
/// `fifo`; `total` is that same population as a count. The three must
/// move together — see `pop_front_event` / `take_queue`, the only
/// functions allowed to remove an event.
#[derive(Debug, Default)]
struct BufferInner {
    queues: HashMap<ReplayKey, PeerQueue>,
    /// Global insertion order of every still-buffered event: `(seq, replay
    /// identity)`, oldest first. This is the eviction index the total cap
    /// pops from, replacing the full scan over `queues` that used to run
    /// on every push past the cap.
    fifo: VecDeque<(u64, ReplayKey)>,
    /// Every still-buffered `seq`. Pairs with `fifo` exactly, and makes
    /// removing an arbitrary `seq` (a drain of a whole queue) O(1) per
    /// event instead of a `VecDeque::retain`.
    live: HashSet<u64>,
    /// Live event total across every queue (maintained on push, drain,
    /// and eviction — the O(1) form of what `buffered_count` sums).
    total: usize,
    /// Monotonic insertion sequence for [`BufferedEvent`].
    next_seq: u64,
}

impl BufferInner {
    /// Remove one event from a queue's front, keeping `total` and `live`
    /// in step. The caller owns the global index: `push` pops its head
    /// (the evicted event *is* the head), `take_queue` scrubs the whole
    /// queue's seqs at once.
    ///
    /// `total` is decremented here and **only** here — evicting twice
    /// (once in the caller, once here) would leave `total` below the
    /// real population, and the total cap would then stop evicting while
    /// the buffer grew unbounded. `assert_invariants` pins that.
    fn pop_front_event(&mut self, key: &ReplayKey) -> Option<BufferedEvent> {
        let queue = self.queues.get_mut(key)?;
        let event = queue.events.pop_front()?;
        if queue.events.is_empty() {
            queue.last_addr = None;
        }
        self.total -= 1;
        self.live.remove(&event.seq);
        Some(event)
    }

    /// Remove a whole queue and return it, keeping `fifo`/`live`/`total`
    /// in step with the events it removes.
    fn take_queue(&mut self, key: &ReplayKey) -> Option<PeerQueue> {
        let queue = self.queues.remove(key)?;
        self.total -= queue.events.len();
        for event in &queue.events {
            self.live.remove(&event.seq);
        }
        self.fifo.retain(|(seq, _)| self.live.contains(seq));
        Some(queue)
    }
}

/// In-memory store for events that could not be delivered, keyed by
/// [`ReplayKey`] — see the module docs for the two identities.
///
/// All thresholds are enforced inside [`Self::push`]; callers never see
/// an unbounded queue.
#[derive(Debug, Clone, Default)]
pub(crate) struct OfflineReplayBuffer {
    inner: Arc<Mutex<BufferInner>>,
}

impl OfflineReplayBuffer {
    /// An empty buffer.
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Buffer one undelivered JSON line under `key`, recording
    /// `peer_addr` as the queue's latest source address (the next
    /// `drain` reports it for the handoff log). Enforces both retention
    /// caps drop-oldest.
    pub(crate) async fn push(&self, key: &ReplayKey, peer_addr: &str, line: String) {
        let mut guard = self.inner.lock().await;
        // Reborrow as a plain `&mut BufferInner`: field-disjoint borrows
        // (`queues` alongside `fifo`/`total`/`next_seq`) are rejected
        // through the guard's `DerefMut`.
        let inner = &mut *guard;
        let seq = inner.next_seq;
        // Insert the owned key only on a miss. `contains_key` borrows
        // `key`, so a hit costs no allocation — `entry` would clone the
        // key on every single push, hit or miss (`ReplayKey` owns a
        // `String`). Between the probe and the insert the map is only
        // ever read, so the two steps cannot disagree.
        if !inner.queues.contains_key(key) {
            inner.queues.insert(key.clone(), PeerQueue::default());
        }
        // Enforce the PER-PEER cap first, exactly as the original code did:
        // its `>= cap` check ran before the append, dropping the head of a
        // full queue and then appending. Same comparison, same length,
        // same position — only the drop now also maintains the index.
        let per_peer_capped = inner
            .queues
            .get(key)
            .is_some_and(|queue| queue.events.len() >= MAX_OFFLINE_BUFFER_PER_PEER);
        if per_peer_capped && let Some(dropped) = inner.pop_front_event(key) {
            // The popped event is this queue's oldest, hence the head of
            // the global index (every queue is FIFO).
            if inner.fifo.front().is_some_and(|(_, k)| k == key) {
                inner.fifo.pop_front();
            } else {
                // Defensive: scrub by seq rather than trust the position.
                inner.fifo.retain(|(s, _)| *s != dropped.seq);
            }
            tracing::warn!(
                key = %key.label(),
                peer = %peer_addr,
                dropped_seq = dropped.seq,
                cap = MAX_OFFLINE_BUFFER_PER_PEER,
                "offline replay buffer at per-peer cap, oldest event dropped"
            );
        }
        if let Some(queue) = inner.queues.get_mut(key) {
            queue.events.push_back(BufferedEvent { seq, line });
            queue.last_addr = Some(peer_addr.to_string());
        }
        inner.fifo.push_back((seq, key.clone()));
        inner.live.insert(seq);
        inner.next_seq = seq + 1;
        inner.total += 1;
        // Then the GLOBAL bound: evict the oldest buffered line across *all*
        // queues until the total fits. The index head is that line, so this
        // is O(evictions) instead of one scan of every queue per eviction.
        while inner.total > MAX_OFFLINE_BUFFER_TOTAL {
            let Some((oldest_seq, oldest_key)) = inner.fifo.pop_front() else {
                break; // total says non-empty but the index is — stop, never loop
            };
            if !inner.live.remove(&oldest_seq) {
                // Stale index entry (already removed elsewhere): it holds
                // no event, so nothing is evicted and nothing is logged.
                continue;
            }
            // `pop_front_event` decrements `total` — the only place that
            // does, so one eviction removes exactly one event from every
            // count.
            if inner.pop_front_event(&oldest_key).is_none() {
                break; // defensive: nothing to evict despite the count
            }
            tracing::warn!(
                key = %oldest_key.label(),
                dropped_seq = oldest_seq,
                cap = MAX_OFFLINE_BUFFER_TOTAL,
                "offline replay buffer at total cap, oldest event dropped"
            );
            if inner
                .queues
                .get(&oldest_key)
                .is_some_and(|queue| queue.events.is_empty())
            {
                inner.queues.remove(&oldest_key);
            }
        }
    }

    /// Remove and return everything buffered under `key`, resetting that
    /// identity's history. A missed key drains nothing (empty, no log).
    pub(crate) async fn drain(&self, key: &ReplayKey) -> ReplayDrain {
        let mut inner = self.inner.lock().await;
        let inner = &mut *inner;
        match inner.take_queue(key) {
            Some(queue) => ReplayDrain {
                events: queue.events.into_iter().map(|event| event.line).collect(),
                source_addr: queue.last_addr,
            },
            None => ReplayDrain::default(),
        }
    }

    /// Total events held across every queue (backs `buffered_count`).
    pub(crate) async fn event_count(&self) -> usize {
        self.inner.lock().await.total
    }

    /// Number of distinct replay identities still holding events (backs
    /// `buffered_peer_count`).
    pub(crate) async fn queue_count(&self) -> usize {
        self.inner.lock().await.queues.len()
    }

    /// Events currently held under one key (diagnostics for tests).
    #[cfg(test)]
    pub(crate) async fn len_for(&self, key: &ReplayKey) -> usize {
        self.inner
            .lock()
            .await
            .queues
            .get(key)
            .map_or(0, |queue| queue.events.len())
    }

    /// Structural consistency check for tests: the per-queue events, the
    /// global insertion index, the live-`seq` set and the running total
    /// must describe the same population, and the index must be in
    /// strictly increasing `seq` order (oldest insertion first).
    #[cfg(test)]
    pub(crate) async fn assert_invariants(&self) {
        let inner = self.inner.lock().await;
        let mut counted = 0usize;
        let mut seqs_from_queues: Vec<u64> = Vec::new();
        for queue in inner.queues.values() {
            assert!(
                !queue.events.is_empty(),
                "an empty queue must have been removed from the map"
            );
            assert!(
                queue.events.len() <= MAX_OFFLINE_BUFFER_PER_PEER,
                "per-peer cap breached: {} > {}",
                queue.events.len(),
                MAX_OFFLINE_BUFFER_PER_PEER
            );
            counted += queue.events.len();
            seqs_from_queues.extend(queue.events.iter().map(|event| event.seq));
        }
        assert_eq!(counted, inner.total, "total must equal the sum of queues");
        assert_eq!(
            inner.fifo.len(),
            inner.total,
            "index length must equal the buffered population"
        );
        assert_eq!(
            inner.live.len(),
            inner.total,
            "live set must equal the buffered population"
        );
        assert!(
            inner.total <= MAX_OFFLINE_BUFFER_TOTAL,
            "total cap breached: {} > {}",
            inner.total,
            MAX_OFFLINE_BUFFER_TOTAL
        );
        let index_seqs: Vec<u64> = inner.fifo.iter().map(|(seq, _)| *seq).collect();
        assert!(
            index_seqs.windows(2).all(|pair| pair[0] < pair[1]),
            "index must be in strictly increasing insertion order: {index_seqs:?}"
        );
        // Every buffered event is in the index, and vice versa — no
        // orphan on either side.
        let mut indexed = index_seqs.clone();
        indexed.sort_unstable();
        let mut buffered = seqs_from_queues.clone();
        buffered.sort_unstable();
        assert_eq!(
            indexed, buffered,
            "index and queues must hold the same seqs"
        );
        assert!(
            index_seqs.iter().all(|seq| inner.live.contains(seq)),
            "every indexed seq must be live"
        );
    }

    /// The next eviction victim only — the head of the insertion index
    /// with its identity label. The differential test reads exactly this
    /// after every push; materializing the whole labeled order (up to
    /// MAX_OFFLINE_BUFFER_TOTAL entries, one String each) per push pushed
    /// the test past the 30s quick-profile timeout (measured 2026-11-08:
    /// 33.3s under the default profile, dominated by ~40M throwaway
    /// String allocations).
    #[cfg(test)]
    pub(crate) async fn eviction_head(&self) -> Option<(u64, String)> {
        self.inner
            .lock()
            .await
            .fifo
            .front()
            .map(|(seq, key)| (*seq, key.label()))
    }

    /// The global eviction order as it stands (oldest insertion first) —
    /// the exact list the total cap will pop from, oldest first.
    #[cfg(test)]
    pub(crate) async fn eviction_order(&self) -> Vec<(u64, String)> {
        self.inner
            .lock()
            .await
            .fifo
            .iter()
            .map(|(seq, key)| (*seq, key.label()))
            .collect()
    }
}

#[cfg(test)]
#[path = "replay_tests.rs"]
mod tests;
