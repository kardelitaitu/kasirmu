//! Multi-terminal table and floor plan state sync.
//!
//! Broadcasts table status transitions (occupied, reserved, cleaning, available)
//! across LAN peer terminals so floor-plan screens update in real time.

use foundation::contracts::{DomainEvent, EventHandler, HandlerType, ModuleResult};
use kasirmu_core::Table;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

use std::collections::HashMap;

/// Fast-path prefix identifying a table sync event line.
pub const TABLE_EVENT_TAG_PREFIX: &str = r#"{"type":"table."#;

/// Tag value for [`TableSyncEvent::StatusChanged`] on the wire.
pub const EVENT_TABLE_STATUS_CHANGED: &str = "table.status_changed";

/// Tag value for [`TableSyncEvent::LockAcquired`] on the wire.
pub const EVENT_TABLE_LOCK_ACQUIRED: &str = "table.lock_acquired";

/// Tag value for [`TableSyncEvent::LockReleased`] on the wire.
pub const EVENT_TABLE_LOCK_RELEASED: &str = "table.lock_released";

/// Tag value for [`TableSyncEvent::ClaimRequested`] on the wire.
pub const EVENT_TABLE_CLAIM_REQUESTED: &str = "table.claim_requested";

/// Default lease TTL for table locking (5 minutes in ms).
pub const DEFAULT_TABLE_LEASE_TTL_MS: u64 = 300_000;

/// Payload for a table status transition event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableStatusChanged {
    /// The affected table with full position and occupancy state.
    pub table: Table,
    /// ISO-8601 timestamp of the transition.
    pub occurred_at: String,
}

/// Payload when a terminal acquires an optimistic lock/lease on a table or held cart.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TableLockAcquired {
    /// ID of the table being locked.
    pub table_id: String,
    /// Terminal holding the lease.
    pub terminal_id: String,
    /// Human-readable terminal name/label (e.g. "Tablet Waiter 1").
    #[serde(default)]
    pub terminal_label: Option<String>,
    /// Optional held cart / active bill ID associated with this lease.
    #[serde(default)]
    pub held_cart_id: Option<String>,
    /// Lease duration in milliseconds (default: 300_000 = 5 minutes).
    #[serde(default = "default_lease_ttl")]
    pub lease_ttl_ms: u64,
    /// ISO-8601 acquisition timestamp.
    pub acquired_at: String,
}

fn default_lease_ttl() -> u64 {
    DEFAULT_TABLE_LEASE_TTL_MS
}

/// Payload when a terminal explicitly releases its lease on a table.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TableLockReleased {
    /// ID of the table being unlocked.
    pub table_id: String,
    /// Terminal releasing the lease.
    pub terminal_id: String,
    /// ISO-8601 release timestamp.
    pub released_at: String,
}

/// Payload when another terminal requests handover/claim of a locked table.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TableClaimRequested {
    /// ID of the table requested.
    pub table_id: String,
    /// Terminal requesting the lease handover.
    pub requester_terminal_id: String,
    /// ISO-8601 timestamp.
    pub requested_at: String,
}

/// Represents an active distributed lease on a table with expiration tracking.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TableLease {
    /// Target table identifier.
    pub table_id: String,
    /// Terminal holding the lease.
    pub terminal_id: String,
    /// Optional human-readable terminal label for UI display.
    #[serde(default)]
    pub terminal_label: Option<String>,
    /// Optional held cart identifier locked to this table.
    #[serde(default)]
    pub held_cart_id: Option<String>,
    /// Duration of lease in milliseconds.
    pub lease_ttl_ms: u64,
    /// ISO-8601 acquisition timestamp.
    pub acquired_at: String,
    /// Epoch timestamp in milliseconds when this lease expires.
    pub expires_at_epoch_ms: u64,
}

/// Thread-safe in-memory tracker for active distributed table leases.
#[derive(Debug, Default, Clone)]
pub struct TableLeaseTracker {
    leases: HashMap<String, TableLease>,
}

impl TableLeaseTracker {
    /// Create a new empty tracker.
    #[must_use]
    pub fn new() -> Self {
        Self {
            leases: HashMap::new(),
        }
    }

    /// Try to acquire or renew a lease on a table.
    ///
    /// If table is not locked or its lease has expired, or if locked by the
    /// same terminal, the lease is granted/renewed and returns `Ok(lease)`.
    /// If locked by another terminal and lease is still valid, returns `Err(current_lease)`.
    #[allow(clippy::result_large_err)] // see the comment inside
    pub fn try_acquire(
        &mut self,
        lock: TableLockAcquired,
        now_epoch_ms: u64,
    ) -> Result<TableLease, TableLease> {
        // The Err variant deliberately carries the CONFLICTING lease, so a refused
        // caller can report which terminal holds the table without a second lookup.
        // Boxing it would save 136 bytes on a path that runs once per acquisition
        // attempt and complicate every caller for no measured benefit.
        self.prune_expired(now_epoch_ms);
        if let Some(existing) = self.leases.get(&lock.table_id)
            && existing.terminal_id != lock.terminal_id
            && existing.expires_at_epoch_ms > now_epoch_ms
        {
            return Err(existing.clone());
        }
        let lease = TableLease {
            table_id: lock.table_id.clone(),
            terminal_id: lock.terminal_id,
            terminal_label: lock.terminal_label,
            held_cart_id: lock.held_cart_id,
            lease_ttl_ms: lock.lease_ttl_ms,
            acquired_at: lock.acquired_at,
            expires_at_epoch_ms: now_epoch_ms.saturating_add(lock.lease_ttl_ms),
        };
        self.leases.insert(lock.table_id, lease.clone());
        Ok(lease)
    }

    /// Release a lease if held by the given terminal.
    pub fn release(&mut self, release: &TableLockReleased) -> bool {
        if let Some(existing) = self.leases.get(&release.table_id)
            && existing.terminal_id == release.terminal_id
        {
            self.leases.remove(&release.table_id);
            return true;
        }
        false
    }

    /// Force-release a lease regardless of holder (e.g. manager override or bill settlement).
    pub fn force_release(&mut self, table_id: &str) -> Option<TableLease> {
        self.leases.remove(table_id)
    }

    /// Look up the active lease on a table if valid.
    #[must_use]
    pub fn get_lease(&self, table_id: &str, now_epoch_ms: u64) -> Option<&TableLease> {
        self.leases
            .get(table_id)
            .filter(|l| l.expires_at_epoch_ms > now_epoch_ms)
    }

    /// List all currently active (unexpired) leases.
    #[must_use]
    pub fn active_leases(&self, now_epoch_ms: u64) -> Vec<TableLease> {
        self.leases
            .values()
            .filter(|l| l.expires_at_epoch_ms > now_epoch_ms)
            .cloned()
            .collect()
    }

    /// Prune expired leases.
    pub fn prune_expired(&mut self, now_epoch_ms: u64) {
        self.leases
            .retain(|_, lease| lease.expires_at_epoch_ms > now_epoch_ms);
    }
}

/// The typed table sync event broadcast on the LAN channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum TableSyncEvent {
    /// Table status changed (occupied, cleaning, available, reserved).
    #[serde(rename = "table.status_changed")]
    StatusChanged(TableStatusChanged),
    /// Terminal acquired exclusive lease on a table/cart.
    #[serde(rename = "table.lock_acquired")]
    LockAcquired(TableLockAcquired),
    /// Terminal released lease on a table.
    #[serde(rename = "table.lock_released")]
    LockReleased(TableLockReleased),
    /// Another terminal requests handover of a locked table/cart.
    #[serde(rename = "table.claim_requested")]
    ClaimRequested(TableClaimRequested),
}

impl TableSyncEvent {
    /// Wire tag of this event.
    #[must_use]
    pub fn tag(&self) -> &'static str {
        match self {
            Self::StatusChanged(_) => EVENT_TABLE_STATUS_CHANGED,
            Self::LockAcquired(_) => EVENT_TABLE_LOCK_ACQUIRED,
            Self::LockReleased(_) => EVENT_TABLE_LOCK_RELEASED,
            Self::ClaimRequested(_) => EVENT_TABLE_CLAIM_REQUESTED,
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
