//! Multi-terminal CRDT and offline mutation delta sync over LAN.
//!
//! Broadcasts batches of offline queue items (`OfflineQueueItem`) across
//! LAN peer terminals so multi-terminal POS setups can replicate stock
//! adjustments, sale operations, and product updates peer-to-peer without
//! waiting for a cloud sync cycle.

use foundation::contracts::{DomainEvent, EventHandler, HandlerType, ModuleResult};
use kasirmu_core::offline::OfflineQueueItem;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

/// Fast-path prefix identifying a CRDT sync event line.
pub const CRDT_EVENT_TAG_PREFIX: &str = r#"{"type":"crdt."#;

/// Tag value for [`CrdtSyncEvent::DeltaBroadcast`] on the wire.
pub const EVENT_CRDT_DELTA_BROADCAST: &str = "crdt.delta_broadcast";

/// Payload for a batch of offline mutation deltas.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrdtDeltaBroadcast {
    /// The batch of queued mutations to replicate across peers.
    pub batch: Vec<OfflineQueueItem>,
    /// Originating terminal identifier.
    pub origin_terminal_id: String,
    /// ISO-8601 timestamp of when the batch was created/broadcast.
    pub occurred_at: String,
}

/// The typed CRDT sync event broadcast on the LAN channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum CrdtSyncEvent {
    /// Batch of offline mutations broadcast to peer terminals.
    #[serde(rename = "crdt.delta_broadcast")]
    DeltaBroadcast(CrdtDeltaBroadcast),
}

impl CrdtSyncEvent {
    /// Wire tag of this event.
    #[must_use]
    pub fn tag(&self) -> &'static str {
        match self {
            Self::DeltaBroadcast(_) => EVENT_CRDT_DELTA_BROADCAST,
        }
    }
}

impl DomainEvent for CrdtSyncEvent {
    fn event_name(&self) -> &'static str {
        "crdt.sync"
    }
}

/// Forwards [`CrdtSyncEvent`]s to LAN peers as tagged JSON lines/frames.
pub struct CrdtSyncHandler {
    pub(crate) tx: broadcast::Sender<String>,
}

impl EventHandler<CrdtSyncEvent> for CrdtSyncHandler {
    fn handler_type(&self) -> HandlerType {
        HandlerType::PluginBridge
    }

    fn handle(&self, event: &CrdtSyncEvent) -> ModuleResult {
        let json = serde_json::to_string(event)
            .map_err(|e| anyhow::anyhow!("serialising CrdtSyncEvent: {e}"))?;
        let _ = self.tx.send(json);
        Ok(())
    }
}

#[cfg(test)]
#[path = "crdt_sync_tests.rs"]
mod tests;
