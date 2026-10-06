//! Multi-terminal table and floor plan state sync.
//!
//! Broadcasts table status transitions (occupied, reserved, cleaning, available)
//! across LAN peer terminals so floor-plan screens update in real time.

use foundation::contracts::{DomainEvent, EventHandler, HandlerType, ModuleResult};
use kasirmu_core::Table;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

/// Fast-path prefix identifying a table sync event line.
pub const TABLE_EVENT_TAG_PREFIX: &str = r#"{"type":"table."#;

/// Tag value for [`TableSyncEvent::StatusChanged`] on the wire.
pub const EVENT_TABLE_STATUS_CHANGED: &str = "table.status_changed";

/// Payload for a table status transition event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableStatusChanged {
    /// The affected table with full position and occupancy state.
    pub table: Table,
    /// ISO-8601 timestamp of the transition.
    pub occurred_at: String,
}

/// The typed table sync event broadcast on the LAN channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum TableSyncEvent {
    /// Table status changed (occupied, cleaning, available, reserved).
    #[serde(rename = "table.status_changed")]
    StatusChanged(TableStatusChanged),
}

impl TableSyncEvent {
    /// Wire tag of this event.
    #[must_use]
    pub fn tag(&self) -> &'static str {
        match self {
            Self::StatusChanged(_) => EVENT_TABLE_STATUS_CHANGED,
        }
    }
}

impl DomainEvent for TableSyncEvent {
    fn event_name(&self) -> &'static str {
        "table.sync"
    }
}

/// Forwards [`TableSyncEvent`]s to LAN peers as tagged JSON lines/frames.
pub struct TableSyncHandler {
    pub(crate) tx: broadcast::Sender<String>,
}

impl EventHandler<TableSyncEvent> for TableSyncHandler {
    fn handler_type(&self) -> HandlerType {
        HandlerType::PluginBridge
    }

    fn handle(&self, event: &TableSyncEvent) -> ModuleResult {
        let json = serde_json::to_string(event)
            .map_err(|e| anyhow::anyhow!("serialising TableSyncEvent: {e}"))?;
        let _ = self.tx.send(json);
        Ok(())
    }
}

#[cfg(test)]
#[path = "table_sync_tests.rs"]
mod tests;
