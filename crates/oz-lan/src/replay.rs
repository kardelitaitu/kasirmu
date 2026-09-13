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

use std::collections::{HashMap, VecDeque};
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
#[derive(Debug, Default)]
struct BufferInner {
    queues: HashMap<ReplayKey, PeerQueue>,
    /// Live event total across every queue (maintained on push, drain,
    /// and eviction — the O(1) form of what `buffered_count` sums).
    total: usize,
    /// Monotonic insertion sequence for [`BufferedEvent`].
    next_seq: u64,
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
        // (`queues` alongside `total`/`next_seq`) are rejected through
        // the guard's `DerefMut`.
        let inner = &mut *guard;
        let queue = inner.queues.entry(key.clone()).or_default();
        if queue.events.len() >= MAX_OFFLINE_BUFFER_PER_PEER {
            // The queue is non-empty at cap, so the pop always yields.
            if let Some(dropped) = queue.events.pop_front() {
                inner.total -= 1;
                tracing::warn!(
                    key = %key.label(),
                    peer = %peer_addr,
                    dropped_seq = dropped.seq,
                    cap = MAX_OFFLINE_BUFFER_PER_PEER,
                    "offline replay buffer at per-peer cap, oldest event dropped"
                );
            }
        }
        queue.events.push_back(BufferedEvent {
            seq: inner.next_seq,
            line,
        });
        queue.last_addr = Some(peer_addr.to_string());
        inner.next_seq += 1;
        inner.total += 1;
        // Global bound: evict the oldest buffered line across *all*
        // queues until the total fits. Per-queue caps make each queue
        // FIFO, so the global oldest is always some queue's front.
        while inner.total > MAX_OFFLINE_BUFFER_TOTAL {
            let oldest = inner
                .queues
                .iter()
                .filter(|(_, queue)| !queue.events.is_empty())
                .min_by_key(|(_, queue)| queue.events.front().map_or(u64::MAX, |event| event.seq))
                .map(|(key, _)| key.clone());
            let Some(oldest) = oldest else {
                break; // total says non-empty but no queue is — stop, never loop
            };
            let evicted = inner.queues.get_mut(&oldest).and_then(|queue| {
                let evicted = queue.events.pop_front();
                if queue.events.is_empty() {
                    queue.last_addr = None;
                }
                evicted
            });
            if let Some(evicted) = evicted {
                inner.total -= 1;
                tracing::warn!(
                    key = %oldest.label(),
                    dropped_seq = evicted.seq,
                    cap = MAX_OFFLINE_BUFFER_TOTAL,
                    "offline replay buffer at total cap, oldest event dropped"
                );
            } else {
                break; // defensive: nothing to evict despite the count
            }
            if inner
                .queues
                .get(&oldest)
                .is_some_and(|queue| queue.events.is_empty())
            {
                inner.queues.remove(&oldest);
            }
        }
    }

    /// Remove and return everything buffered under `key`, resetting that
    /// identity's history. A missed key drains nothing (empty, no log).
    pub(crate) async fn drain(&self, key: &ReplayKey) -> ReplayDrain {
        let mut inner = self.inner.lock().await;
        match inner.queues.remove(key) {
            Some(queue) => {
                inner.total -= queue.events.len();
                ReplayDrain {
                    events: queue.events.into_iter().map(|event| event.line).collect(),
                    source_addr: queue.last_addr,
                }
            }
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
}

#[cfg(test)]
#[path = "replay_tests.rs"]
mod tests;
