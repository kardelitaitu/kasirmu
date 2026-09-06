//! Memo domain model — the schema-independent logic behind the Memo
//! lifecycle (Phase 2 P1): the memo status state machine, the per-recipient
//! delivery/acknowledgement state machine, the author-chosen duration and its
//! expiry computation, and the display cadence constants.
//!
//! This module deliberately owns NO database access and NO authorization
//! vocabulary: the store/IPC layer persists these enums as `TEXT` columns and
//! enforces author-or-`memo:stop` (the 2026-09-07 early-stop ruling) at the
//! command gate. Keeping the pure rules here (and fully unit-tested) means
//! the migration only had to persist states this module already validates
//! transitions between.
//!
//! Two orthogonal state dimensions (conflating them is the classic memo bug):
//! - A memo's own lifecycle: [`MemoStatus`] `draft → published → {expired |
//!   stopped} → archived`.
//! - Each recipient's view of that memo: [`DeliveryStatus`] `pending →
//!   delivered → acknowledged`.
//!
//! Invariants: a published memo is immutable-by-revision (an edit bumps
//! `revision` and snapshots a new `memo_revisions` row; prior revisions are
//! never mutated — enforced by the store, modeled here by there being no
//! "edit" status transition); expiry is a sweep comparing `expires_at` to now,
//! not a DB clock trigger; terminal states never reopen.

use chrono::{DateTime, Duration as ChronoDuration, Utc};
use core::str::FromStr;
use serde::{Deserialize, Serialize};

// ── Scope ───────────────────────────────────────────────────────────

/// Whether a memo targets the whole organization or a set of locations.
///
/// Derived from the memo's targeting rows (`memo_locations`): zero rows ⇒
/// Organization, one or more ⇒ Location. Modeled explicitly so the store and
/// UI share one vocabulary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoScope {
    /// Organization Memo — owner/admin author, delivered to all registered
    /// terminals across every location.
    Organization,
    /// Location Memo — owner/admin/manager author, delivered to the terminals
    /// bound to one or more selected locations.
    Location,
}

impl MemoScope {
    /// Build the scope from a memo's targeting set: empty ⇒ Organization.
    pub fn from_location_ids(location_ids: &[String]) -> Self {
        if location_ids.is_empty() {
            MemoScope::Organization
        } else {
            MemoScope::Location
        }
    }
}

// ── Memo lifecycle status ───────────────────────────────────────────

/// The memo's own lifecycle state. Persisted as `memos.status`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoStatus {
    /// Composing; visible only to the author. Not yet delivered.
    Draft,
    /// Live and displayed to its audience until it expires or is stopped.
    Published,
    /// Its chosen duration elapsed (`expires_at` passed); no longer displayed.
    Expired,
    /// Ended early by the author or a higher role before natural expiry.
    Stopped,
    /// Past its retention window; retained for audit/compliance only.
    Archived,
}

impl MemoStatus {
    /// Stable `TEXT` form written to the database.
    pub fn as_str(self) -> &'static str {
        match self {
            MemoStatus::Draft => "draft",
            MemoStatus::Published => "published",
            MemoStatus::Expired => "expired",
            MemoStatus::Stopped => "stopped",
            MemoStatus::Archived => "archived",
        }
    }

    /// Parse a stored `TEXT` value. Unknown values return `None` so callers
    /// fail closed rather than guessing a state.
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "draft" => Some(MemoStatus::Draft),
            "published" => Some(MemoStatus::Published),
            "expired" => Some(MemoStatus::Expired),
            "stopped" => Some(MemoStatus::Stopped),
            "archived" => Some(MemoStatus::Archived),
            _ => None,
        }
    }

    /// Whether the memo should currently be surfaced to recipients. Only a
    /// live `Published` memo displays; expiry/stopping immediately stop display
    /// even before the retention sweep archives the row.
    pub fn is_active(self) -> bool {
        matches!(self, MemoStatus::Published)
    }

    /// Terminal lifecycle states that can never be re-opened.
    pub fn is_terminal(self) -> bool {
        matches!(self, MemoStatus::Archived)
    }

    /// Valid lifecycle transitions.
    ///
    /// - `Draft → Published` (publish) or `Draft → Archived` (discard).
    /// - `Published → Expired` (sweep) or `Published → Stopped` (early stop).
    /// - `Expired → Archived` / `Stopped → Archived` (retention sweep).
    ///
    /// A live `Published` memo may NOT go straight to `Archived`: ending a live
    /// memo is an explicit `Stopped` (early stop), never a silent archive, so
    /// the reason for ending is always recorded. Editing a published memo is
    /// not a status transition (it stays `Published` with a bumped `revision`),
    /// so it is intentionally absent here.
    pub fn can_transition(from: Self, to: Self) -> bool {
        use MemoStatus::*;
        matches!(
            (from, to),
            (Draft, Published)
                | (Draft, Archived)
                | (Published, Expired)
                | (Published, Stopped)
                | (Expired, Archived)
                | (Stopped, Archived)
        )
    }
}

// ── Per-recipient delivery status ───────────────────────────────────

/// One recipient/terminal's view of a memo. Persisted as
/// `memo_recipients.delivery_status`. Independent of [`MemoStatus`]: a memo can
/// be `Published` while some recipients are still `Pending` (offline delivery).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryStatus {
    /// Enqueued for the terminal; not yet received (e.g. terminal offline).
    Pending,
    /// The terminal received the memo; awaiting acknowledgement.
    Delivered,
    /// A user at the terminal acknowledged it.
    Acknowledged,
}

impl DeliveryStatus {
    /// Stable `TEXT` form written to the database.
    pub fn as_str(self) -> &'static str {
        match self {
            DeliveryStatus::Pending => "pending",
            DeliveryStatus::Delivered => "delivered",
            DeliveryStatus::Acknowledged => "acknowledged",
        }
    }

    /// Parse a stored `TEXT` value; unknown ⇒ `None` (fail closed).
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "pending" => Some(DeliveryStatus::Pending),
            "delivered" => Some(DeliveryStatus::Delivered),
            "acknowledged" => Some(DeliveryStatus::Acknowledged),
            _ => None,
        }
    }

    /// Valid delivery transitions. Monotonic: pending → delivered →
    /// acknowledged. `Pending → Acknowledged` is allowed because an
    /// acknowledgement is itself proof of delivery (an online terminal can ack
    /// without a separate delivered event); the reverse (de-acknowledging) and
    /// any skip backwards are invalid.
    pub fn can_transition(from: Self, to: Self) -> bool {
        use DeliveryStatus::*;
        matches!(
            (from, to),
            (Pending, Delivered) | (Pending, Acknowledged) | (Delivered, Acknowledged)
        )
    }
}

// ── Duration & expiry ───────────────────────────────────────────────

/// Author-chosen display duration. Persisted as `memos.duration`; the expiry
/// instant is derived, not stored separately from `published_at`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MemoDuration {
    /// 12 hours.
    Hours12,
    /// 24 hours — the default when the author does not choose.
    Hours24,
    /// 3 days.
    Days3,
    /// 7 days.
    Days7,
    /// 30 days.
    Days30,
}

/// The spec's default duration when the author does not choose one.
pub const DEFAULT_MEMO_DURATION: MemoDuration = MemoDuration::Hours24;

impl MemoDuration {
    /// Stable `TEXT` form written to the database.
    pub fn as_str(self) -> &'static str {
        match self {
            MemoDuration::Hours12 => "12h",
            MemoDuration::Hours24 => "24h",
            MemoDuration::Days3 => "3d",
            MemoDuration::Days7 => "7d",
            MemoDuration::Days30 => "30d",
        }
    }

    /// The full set of selectable durations (for UI rendering).
    pub const ALL: [MemoDuration; 5] = [
        MemoDuration::Hours12,
        MemoDuration::Hours24,
        MemoDuration::Days3,
        MemoDuration::Days7,
        MemoDuration::Days30,
    ];

    /// Duration in whole seconds.
    pub fn seconds(self) -> i64 {
        match self {
            MemoDuration::Hours12 => 12 * 3600,
            MemoDuration::Hours24 => 24 * 3600,
            MemoDuration::Days3 => 3 * 24 * 3600,
            MemoDuration::Days7 => 7 * 24 * 3600,
            MemoDuration::Days30 => 30 * 24 * 3600,
        }
    }

    /// The instant a memo published at `published_at` expires.
    pub fn expires_at(self, published_at: DateTime<Utc>) -> DateTime<Utc> {
        published_at + ChronoDuration::seconds(self.seconds())
    }

    /// Whether a memo published at `published_at` is expired at `now`.
    ///
    /// Boundary is exclusive: a memo is active up to but not including its
    /// expiry instant, so `now == expires_at` reads as expired.
    pub fn is_expired(self, published_at: DateTime<Utc>, now: DateTime<Utc>) -> bool {
        now >= self.expires_at(published_at)
    }
}

impl FromStr for MemoDuration {
    type Err = ();
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "12h" => Ok(MemoDuration::Hours12),
            "24h" => Ok(MemoDuration::Hours24),
            "3d" => Ok(MemoDuration::Days3),
            "7d" => Ok(MemoDuration::Days7),
            "30d" => Ok(MemoDuration::Days30),
            _ => Err(()),
        }
    }
}

// ── Early-stop authorization ────────────────────────────────────────

// The spec's "early stop by author or higher role" is ruled (2026-09-07,
// option A2) as: the AUTHOR may always stop their own memo, otherwise the
// actor must hold the `memo:stop` permission (Owner/Admin presets; custom
// roles deny by default). "Higher role" is expressed as a registry grant,
// not a rank map, so no hierarchy lives here — the rule is enforced at the
// `stop_memo_scoped` command gate, and the rank-based `may_stop` helper was
// deleted with its tests rather than left as a tested pure rule with no
// caller.

// ── Display cadence constants ───────────────────────────────────────

/// Base notification interval for the dismissible top-left memo banner
/// (15 minutes). Single source of truth so the "KDS doubles it" intent is
/// expressed as a multiplier, not a duplicated literal.
pub const NOTIFICATION_BASE_INTERVAL_SECS: i64 = 15 * 60;

/// Per-cycle tick length the banner re-evaluates on (30 seconds).
pub const NOTIFICATION_CYCLE_SECS: i64 = 30;

/// KDS surfaces show the banner at `2 ×` the base interval (30 minutes).
pub const KDS_INTERVAL_MULTIPLIER: i64 = 2;

/// The KDS notification interval, derived from the base so a change to the
/// base propagates (the spec's "coded as 2× the base interval").
pub fn kds_notification_interval_secs() -> i64 {
    NOTIFICATION_BASE_INTERVAL_SECS * KDS_INTERVAL_MULTIPLIER
}

// ── Persisted shapes ────────────────────────────────────────────────

/// Error surfaced when a stored `status`/`duration` TEXT value is not a known
/// enum variant. Given the schema CHECK constraints this is unreachable except
/// on DB corruption; it exists so the repository fails closed rather than
/// silently defaulting a corrupted row to some other state.
#[derive(Debug, thiserror::Error)]
#[error("unknown memo enum value: {0}")]
pub struct ParseError(pub String);

/// A memo row as persisted in `memos`. `status` and `duration` are the domain
/// enums; the repository maps them to/from the CHECK'd TEXT columns, so a row
/// read back is always a valid state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Memo {
    /// Stable identifier.
    pub id: String,
    /// Owning Organization/Tenant.
    pub tenant_id: String,
    /// Locations this memo targets, empty ⇒ Organization Memo (the empty set
    /// is the organization-wide audience); non-empty ⇒ Location Memo for
    /// exactly those locations.
    pub location_ids: Vec<String>,
    /// Author's user id.
    pub author_user_id: String,
    /// Author's role snapshot at publish time (early-stop authority basis).
    pub author_role: String,
    /// Memo title.
    pub title: String,
    /// Memo body.
    pub body: String,
    /// Lifecycle status.
    pub status: MemoStatus,
    /// Author-chosen display duration.
    pub duration: MemoDuration,
    /// Current published revision (starts at 1 on first publish).
    pub revision: i64,
    /// ISO-8601 publish instant; `None` until first publish.
    pub published_at: Option<String>,
    /// ISO-8601 expiry instant; `None` until first publish.
    pub expires_at: Option<String>,
    /// ISO-8601 early-stop instant; `None` unless stopped.
    pub stopped_at: Option<String>,
    /// User id that stopped the memo; `None` unless stopped.
    pub stopped_by: Option<String>,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// ISO-8601 last-update timestamp.
    pub updated_at: String,
}

impl Memo {
    /// The memo's audience scope, derived from its targeting set.
    pub fn scope(&self) -> MemoScope {
        MemoScope::from_location_ids(&self.location_ids)
    }
}

/// Input for creating a draft memo. The store assigns the id, timestamps,
/// initial status (`draft`), and revision (1); the caller supplies content,
/// scope, author, and duration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewMemo {
    /// Owning Organization/Tenant.
    pub tenant_id: String,
    /// Locations the memo targets; empty ⇒ Organization Memo. The store
    /// normalizes the input (trims, drops blanks, dedupes in order).
    pub location_ids: Vec<String>,
    /// Author's user id.
    pub author_user_id: String,
    /// Author's role at creation (snapshotted again at publish).
    pub author_role: String,
    /// Memo title (must be non-blank).
    pub title: String,
    /// Memo body (must be non-blank).
    pub body: String,
    /// Display duration.
    pub duration: MemoDuration,
}

/// A memo paired with this terminal's delivery state — the projection the
/// display surfaces read. `delivery_status` is per-terminal (from
/// `memo_recipients`), independent of the memo's own lifecycle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActiveMemo {
    /// The memo itself.
    pub memo: Memo,
    /// This terminal's delivery/acknowledgement state for it.
    pub delivery_status: DeliveryStatus,
}

#[cfg(test)]
#[path = "memo_tests.rs"]
mod tests;
