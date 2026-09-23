//! Offline queue domain type — queued transactions for later sync.

use serde::{Deserialize, Serialize};

/// Sync priority tier for offline queue items (P-2 spec §Priority tiers).
///
/// Lower numeric values indicate higher priority. Items are sorted by
/// priority before batching so Critical items always transmit before
/// Normal items, which always transmit before Low items.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[repr(i32)]
pub enum SyncPriority {
    /// Sale completions, voids — must propagate before anything else.
    Critical = 0,
    /// Product creation, stock adjustments, inventory changes.
    Normal = 1,
    /// Settings changes, branding updates, low-urgency metadata.
    Low = 2,
}

/// Default priority for new queue items.
fn default_priority() -> SyncPriority {
    SyncPriority::Normal
}

impl From<i32> for SyncPriority {
    fn from(v: i32) -> Self {
        match v {
            0 => SyncPriority::Critical,
            2 => SyncPriority::Low,
            _ => SyncPriority::Normal,
        }
    }
}

impl SyncPriority {
    /// Stable lowercase string for DTO serialization (OFF-09).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Critical => "critical",
            Self::Normal => "normal",
            Self::Low => "low",
        }
    }

    /// Parse a lowercase priority string back into a tier (OFF-09).
    ///
    /// Unknown values fall back to `Normal` so a stale front-end can
    /// never escalate a payload into a `Critical` tier by accident.
    pub fn from_str_lenient(s: &str) -> Self {
        match s {
            "critical" => Self::Critical,
            "low" => Self::Low,
            _ => Self::Normal,
        }
    }
}

/// A queued offline transaction.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OfflineQueueItem {
    /// Internal row id (UUID v7).
    pub id: String,
    /// The action to perform (e.g. "complete_sale", "void_sale").
    pub action: String,
    /// JSON-serialized payload for the action.
    pub payload: String,
    /// Queue status: pending, synced, or failed.
    pub status: OfflineQueueStatus,
    /// Number of retry attempts.
    pub retry_count: i64,
    /// Last error message, if any.
    pub last_error: Option<String>,
    /// Tenant / store ID for multi-tenant cloud isolation.
    /// Defaults to "default" for single-store deployments.
    #[serde(default = "default_tenant_id")]
    pub tenant_id: String,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// ISO-8601 sync timestamp.
    pub synced_at: Option<String>,
    /// Sync priority tier (P-2). Critical items transmit before Normal/Low.
    #[serde(default = "default_priority")]
    pub priority: SyncPriority,
    /// Terminal that ORIGINATED this mutation, when its producer knew it (C3).
    ///
    /// Nullable on purpose, and a `None` means "unknown" — never an empty
    /// string and never a default. The column was added with no backfill,
    /// because a guessed origin would make the self-origin check suppress a
    /// legitimate deduction (silent stock loss), so a reader must treat a
    /// `None` as "not proven self-originated" rather than as "not
    /// self-originated".
    #[serde(default)]
    pub origin_terminal_id: Option<String>,
}

/// Status of an offline queue item.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfflineQueueStatus {
    /// Waiting to be synced.
    Pending,
    /// Successfully synced to the server.
    Synced,
    /// Sync failed after multiple retries.
    Failed,
}

/// Default tenant ID for single-store deployments.
fn default_tenant_id() -> String {
    String::from("default")
}

impl OfflineQueueStatus {
    /// Return the status as a stored string value.
    pub fn as_stored_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Synced => "synced",
            Self::Failed => "failed",
        }
    }

    /// Parse a stored string value into a status.
    pub fn from_stored_str(s: &str) -> Option<Self> {
        match s {
            "pending" => Some(Self::Pending),
            "synced" => Some(Self::Synced),
            "failed" => Some(Self::Failed),
            _ => None,
        }
    }
}

impl OfflineQueueItem {
    /// Create a new offline queue item with the default tenant ("default").
    pub fn new(action: impl Into<String>, payload: impl Into<String>) -> Self {
        Self {
            id: uuid::Uuid::now_v7().to_string(),
            action: action.into(),
            payload: payload.into(),
            status: OfflineQueueStatus::Pending,
            retry_count: 0,
            last_error: None,
            created_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            synced_at: None,
            tenant_id: String::from("default"),
            priority: SyncPriority::Normal,
            origin_terminal_id: None,
        }
    }

    /// Create a new offline queue item scoped to the given tenant.
    pub fn with_tenant(
        action: impl Into<String>,
        payload: impl Into<String>,
        tenant_id: impl Into<String>,
    ) -> Self {
        let mut item = Self::new(action, payload);
        item.tenant_id = tenant_id.into();
        item
    }

    /// Create a new queue item with a specific sync priority.
    pub fn with_priority(
        action: impl Into<String>,
        payload: impl Into<String>,
        priority: SyncPriority,
    ) -> Self {
        let mut item = Self::new(action, payload);
        item.priority = priority;
        item
    }
}

/// Order a pending batch the way a push MUST send it — THE shared expression.
///
/// This is the ONE definition of the queue's transmit order. It lives here, in
/// `kasirmu_core::offline`, because every push path already depends on this
/// crate: the daemon and the engine (platform-sync), the desktop bridge
/// (kasirmu-bridge), and the tablet (kasirmu-mobile). Before this existed the
/// same rule was written out at each of those sites, which is how they came to
/// disagree — one of them sorted by priority only.
///
/// # The order, and why priority ALONE is not enough
///
/// Ascending `priority` is the P-2 contract: [`SyncPriority`] derives `Ord`
/// with Critical=0 < Normal=1 < Low=2, so lower transmits first. But that is
/// not a total order. It has three values and most items are `Critical`
/// (every sale, void, refund and payment split), so ties are the COMMON case
/// rather than the corner. The key is therefore total, in three parts:
///
/// 1. `priority` — the contract above, higher tier first;
/// 2. `created_at` — the arrival order `Store::list_pending_offline`
///    already returns and documents (`ORDER BY created_at ASC`), preserved
///    WITHIN a tier so the oldest critical sale still goes first;
/// 3. `id` — a UUID v7 primary key: unique, and itself time-ordered.
///    This is the part that makes the order DETERMINISTIC rather than merely
///    stable. `created_at` is millisecond precision, so two items enqueued
///    in the same millisecond compare equal on the first two keys and would
///    otherwise fall back to SQLite's unspecified row order, reordering
///    between runs.
///
/// # Reorders in place, on purpose
///
/// The sort is applied ONCE, before the push, and every downstream consumer
/// iterates that SAME vector: the batch is sent as-is, and the per-item
/// outcomes are matched back by index. The server is explicit that this
/// alignment is load-bearing — a reordering would mark the WRONG items as
/// synced or failed. So this takes `&mut` and reorders the caller's own
/// vector rather than returning a parallel sorted copy.
pub fn order_for_push(items: &mut [OfflineQueueItem]) {
    items.sort_by(|a, b| {
        (a.priority, &a.created_at, &a.id).cmp(&(b.priority, &b.created_at, &b.id))
    });
}

#[cfg(test)]
#[path = "offline_tests.rs"]
mod tests;
