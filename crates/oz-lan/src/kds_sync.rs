//! Multi-terminal KDS state sync: typed LAN broadcast events, station-scoped
//! delivery, and reconnect queue reconciliation.
//!
//! Defines the four order-status transition events ([`KdsOrderPlaced`],
//! [`KdsLineItemBumped`], [`KdsOrderReady`], [`KdsOrderRecalled`]) carried on
//! the wire inside the tagged [`KdsSyncEvent`] enum, the [`KdsSyncHandler`]
//! event-bus bridge (same shape as `SaleCompletedHandler`/`CourseFiredHandler`
//! in `lib.rs`), and the per-peer [`PeerSubscription`] filtering used by
//! `handle_peer`. Station semantics mirror the frozen routing engine in
//! `oz_core::kds`: an empty `stations` list on an event (or an empty
//! `station_ids` on a subscription) means "see everything" — that is the Expo
//! surface. Ticket payloads reuse the frozen [`KdsOrder`]/[`KdsLineItem`]
//! types; this module deliberately contains no routing logic of its own.
//!
//! # Reconnect reconciliation
//!
//! A booting KDS peer sends `{"op":"discover","want_queue":true}`; the
//! responder injects a live [`KdsQueueSnapshot`] under the `active_queue`
//! key of the discovery response via [`LanEventForwarder::with_kds_queue`].
//! Consumers should apply snapshot-first ordering and ignore replayed
//! events whose `occurred_at` predates `generated_at` (ISO-8601 strings
//! compare lexicographically).
//!
//! # Wire compatibility (old peers must not break)
//!
//! - New request fields on the existing `hello`/`discover` messages are
//!   `#[serde(default)]`: a legacy `{"op":"hello","psk":"…"}` or
//!   `{"op":"discover"}` parses unchanged and yields no subscription, no
//!   queue request, and therefore byte-identical responses and full event
//!   traffic — exactly the pre-kds-sync behaviour.
//! - `KdsSyncEvent` is a *new* `"type"` namespace (`kds.*`); legacy
//!   `sale.completed` / `order.course_fired` lines never carry station
//!   scope and are delivered to every peer as before.
//! - `KdsDiscoverResponse.active_queue` is `Option` + `skip_serializing_if`,
//!   so hand-built legacy payloads and responses to non-opting peers omit it.
//! - Filtering fails **open**: an unparsable `kds.*` line is delivered to
//!   every peer rather than silently dropped.
//!
//! [`LanEventForwarder::with_kds_queue`]: crate::LanEventForwarder::with_kds_queue

use std::sync::Arc;

use foundation::contracts::{DomainEvent, EventHandler, ModuleResult};
use oz_core::kds::{KdsLineItem, KdsOrder};
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

/// Fast-path prefix identifying a station-scoped KDS sync event line.
///
/// `serde`'s internally-tagged enum representation writes the `"type"`
/// key first, so every [`KdsSyncEvent`] serialisation begins with this
/// exact prefix. `kds_sync_tests.rs` pins that invariant down; if it ever
/// regressed, [`event_station_scope`] would return `None` for KDS lines
/// and delivery would fail open (deliver-to-all), never mis-drop.
pub const KDS_EVENT_TAG_PREFIX: &str = r#"{"type":"kds."#;

/// Tag value for [`KdsSyncEvent::OrderPlaced`] on the wire.
pub const EVENT_ORDER_PLACED: &str = "kds.order_placed";
/// Tag value for [`KdsSyncEvent::LineItemBumped`] on the wire.
pub const EVENT_LINE_ITEM_BUMPED: &str = "kds.line_item_bumped";
/// Tag value for [`KdsSyncEvent::OrderReady`] on the wire.
pub const EVENT_ORDER_READY: &str = "kds.order_ready";
/// Tag value for [`KdsSyncEvent::OrderRecalled`] on the wire.
pub const EVENT_ORDER_RECALLED: &str = "kds.order_recalled";

// ── Event payloads ───────────────────────────────────────────────────

// All timestamps are ISO-8601 strings (same convention as `KdsOrder`), all
// quantities are `i64` — no floats anywhere on the money/qty path.

/// A new kitchen ticket was created and routed to one or more stations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KdsOrderPlaced {
    /// KDS order (ticket) primary key (UUID v7).
    pub kds_order_id: String,
    /// Originating sale ID.
    pub sale_id: String,
    /// Store the order belongs to (ADR #8); `None` in single-store mode.
    #[serde(default)]
    pub store_id: Option<String>,
    /// Target station IDs for this ticket (from `resolve_kds_targets`).
    /// Empty = broadcast to every peer, matching `KdsDevice` semantics.
    #[serde(default)]
    pub stations: Vec<String>,
    /// Display number shown on the ticket.
    #[serde(default)]
    pub display_number: Option<i64>,
    /// Table number (e.g. "T5"); `None` for takeaway.
    #[serde(default)]
    pub table_number: Option<String>,
    /// Frozen ticket prefix for the location (rendered as `#{prefix}{n}`).
    #[serde(default)]
    pub ticket_prefix: String,
    /// Structured line items on the ticket (frozen `oz-core` type).
    #[serde(default)]
    pub items: Vec<KdsLineItem>,
    /// Special notes from the POS (e.g. "no onions").
    #[serde(default)]
    pub notes: String,
    /// Priority/rush flag: escalates above normal SLA on the display.
    #[serde(default)]
    pub priority: bool,
    /// ISO-8601 timestamp of when the transition happened on the POS.
    pub occurred_at: String,
}

/// One line item on a ticket was bumped to a new per-item status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KdsLineItemBumped {
    /// KDS order (ticket) primary key.
    pub kds_order_id: String,
    /// Originating sale ID.
    pub sale_id: String,
    /// The line item bumped (UUID v7).
    pub line_item_id: String,
    /// Target station IDs — the stations responsible for this item.
    /// Empty = broadcast to every peer.
    #[serde(default)]
    pub stations: Vec<String>,
    /// New per-item status (`KdsStatus::as_str()`, e.g. "ready").
    #[serde(default)]
    pub to_status: String,
    /// Terminal/user that performed the bump (audit display only).
    #[serde(default)]
    pub bumped_by: Option<String>,
    /// ISO-8601 timestamp of the transition.
    pub occurred_at: String,
}

/// The whole ticket is ready to be served (Expo / runner view).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KdsOrderReady {
    /// KDS order (ticket) primary key.
    pub kds_order_id: String,
    /// Originating sale ID.
    pub sale_id: String,
    /// Target station IDs. Empty = broadcast to every peer.
    #[serde(default)]
    pub stations: Vec<String>,
    /// Display number shown on the ticket.
    #[serde(default)]
    pub display_number: Option<i64>,
    /// ISO-8601 ready timestamp on the ticket (may lag `occurred_at`).
    #[serde(default)]
    pub ready_at: Option<String>,
    /// Terminal/user that performed the action.
    #[serde(default)]
    pub bumped_by: Option<String>,
    /// ISO-8601 timestamp of the transition.
    pub occurred_at: String,
}

/// A ticket (or one line on it) was recalled from ready back to working.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KdsOrderRecalled {
    /// KDS order (ticket) primary key.
    pub kds_order_id: String,
    /// Originating sale ID.
    pub sale_id: String,
    /// Recalled line item; `None` = recall the whole ticket.
    #[serde(default)]
    pub line_item_id: Option<String>,
    /// Target station IDs. Empty = broadcast to every peer.
    #[serde(default)]
    pub stations: Vec<String>,
    /// Status to revert to (`KdsStatus::as_str()`, usually "preparing").
    pub recall_to: String,
    /// Optional human-readable reason shown on the display.
    #[serde(default)]
    pub reason: Option<String>,
    /// ISO-8601 timestamp of the transition.
    pub occurred_at: String,
}

// ── Tagged event envelope ────────────────────────────────────────────

/// The typed multi-terminal KDS sync event broadcast on the LAN channel.
///
/// Serialises as a JSON object whose **first** key is `"type"` with one of
/// the `kds.*` tag constants, followed by the variant's fields flattened
/// into the same object — one parse, one demux, on the client side.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum KdsSyncEvent {
    /// New ticket routed to the kitchen.
    #[serde(rename = "kds.order_placed")]
    OrderPlaced(KdsOrderPlaced),
    /// Single line item bumped to a new status.
    #[serde(rename = "kds.line_item_bumped")]
    LineItemBumped(KdsLineItemBumped),
    /// Whole ticket ready to serve.
    #[serde(rename = "kds.order_ready")]
    OrderReady(KdsOrderReady),
    /// Ticket or line recalled back to preparation.
    #[serde(rename = "kds.order_recalled")]
    Recalled(KdsOrderRecalled),
}

impl KdsSyncEvent {
    /// Wire tag of this event ([`EVENT_ORDER_PLACED`] and friends).
    #[must_use]
    pub fn tag(&self) -> &'static str {
        match self {
            Self::OrderPlaced(_) => EVENT_ORDER_PLACED,
            Self::LineItemBumped(_) => EVENT_LINE_ITEM_BUMPED,
            Self::OrderReady(_) => EVENT_ORDER_READY,
            Self::Recalled(_) => EVENT_ORDER_RECALLED,
        }
    }

    /// Target station IDs carried by this event. An empty vec is the
    /// broadcast fallback: the event goes to every peer, Expo or not.
    #[must_use]
    pub fn stations(&self) -> &[String] {
        match self {
            Self::OrderPlaced(e) => &e.stations,
            Self::LineItemBumped(e) => &e.stations,
            Self::OrderReady(e) => &e.stations,
            Self::Recalled(e) => &e.stations,
        }
    }
}

impl DomainEvent for KdsSyncEvent {
    fn event_name(&self) -> &'static str {
        "kds.sync"
    }
}

// ── Event-bus bridge ─────────────────────────────────────────────────

/// Forwards [`KdsSyncEvent`]s to LAN peers as tagged JSON lines/frames.
///
/// Same shape as `SaleCompletedHandler` / `CourseFiredHandler`; obtained
/// from `LanForwarderHandle::kds_sync_handler()` and registered on the
/// kernel event bus.
pub struct KdsSyncHandler {
    pub(crate) tx: broadcast::Sender<String>,
}

impl EventHandler<KdsSyncEvent> for KdsSyncHandler {
    fn handle(&self, event: &KdsSyncEvent) -> ModuleResult {
        let json = serde_json::to_string(event)
            .map_err(|e| anyhow::anyhow!("serialising KdsSyncEvent: {e}"))?;
        let _ = self.tx.send(json);
        Ok(())
    }
}

// ── Station-scoped delivery ──────────────────────────────────────────

/// Per-peer delivery subscription negotiated at connect time.
///
/// Built from the optional serde-default fields on the `hello` (PSK mode)
/// or `discover` (discovery enabled) message. A peer that never supplies
/// either field is `None` and receives all traffic — the legacy behaviour.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct PeerSubscription {
    /// Stable KDS device ID for logging/diagnostics (optional).
    #[serde(default)]
    pub device_id: Option<String>,
    /// Station IDs this peer renders. **Empty = Expo/see-everything**,
    /// matching the `KdsDevice::station_ids` broadcast convention in the
    /// frozen routing engine.
    #[serde(default)]
    pub station_ids: Vec<String>,
}

impl PeerSubscription {
    /// True when this peer receives every station's traffic (Expo or
    /// unscoped legacy peer).
    #[must_use]
    pub fn receives_all(&self) -> bool {
        self.station_ids.is_empty()
    }
}

/// Build a subscription from wire fields, or `None` when the peer
/// supplied neither — i.e. a pure legacy hello/discover that must keep
/// the pre-kds-sync see-everything behaviour.
pub(crate) fn subscription_from_wire(
    station_ids: Vec<String>,
    device_id: Option<String>,
) -> Option<PeerSubscription> {
    if station_ids.is_empty() && device_id.is_none() {
        None
    } else {
        Some(PeerSubscription {
            device_id,
            station_ids,
        })
    }
}

/// Station scope carried by one wire line, if it is a KDS sync event.
///
/// Returns `Some(stations)` for a parsable `kds.*` line (empty `stations`
/// = broadcast-intent), `None` for everything else — legacy events,
/// heartbeats, non-JSON, and *unparsable* `kds.*` lines alike. `None`
/// means "no opinion": the caller delivers the line to every peer, so
/// filtering always fails open.
pub fn event_station_scope(line: &str) -> Option<Vec<String>> {
    if !line.starts_with(KDS_EVENT_TAG_PREFIX) {
        return None;
    }
    // Minimal probe: only the delivery-relevant field is read, so a
    // future event variant with different payload fields still filters.
    #[derive(Deserialize)]
    struct ScopeProbe {
        #[serde(default)]
        stations: Vec<String>,
    }
    serde_json::from_str::<ScopeProbe>(line)
        .ok()
        .map(|probe| probe.stations)
}

/// Delivery predicate for one peer: may `line` go to `subscription`?
///
/// The full matrix (see `kds_sync_tests.rs`):
///
/// | peer state                      | scoped event match | scoped event miss | unscoped/legacy line |
/// |---------------------------------|--------------------|-------------------|----------------------|
/// | no subscription (legacy)        | deliver            | deliver           | deliver              |
/// | Expo (`station_ids` empty)      | deliver            | deliver           | deliver              |
/// | station-scoped peer             | deliver            | **skip**          | deliver              |
///
/// An event with an empty `stations` list is broadcast-intent and always
/// delivered (the `resolve_kds_targets` fallback).
#[must_use]
pub fn should_deliver(subscription: Option<&PeerSubscription>, line: &str) -> bool {
    let Some(sub) = subscription else {
        return true;
    };
    if sub.receives_all() {
        return true;
    }
    match event_station_scope(line) {
        None => true,
        Some(stations) if stations.is_empty() => true,
        Some(stations) => stations
            .iter()
            .any(|station| sub.station_ids.iter().any(|mine| mine == station)),
    }
}

// ── Reconnect reconciliation ─────────────────────────────────────────

/// One active ticket inside a [`KdsQueueSnapshot`].
///
/// Reuses the frozen `oz-core::kds` row types verbatim; `stations` is the
/// per-ticket routing computed by the producer (via `resolve_kds_targets`)
/// because `oz-lan` must not re-implement routing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KdsQueueTicket {
    /// The ticket header row.
    pub order: KdsOrder,
    /// Structured line items on the ticket (empty = header-only legacy).
    #[serde(default)]
    pub line_items: Vec<KdsLineItem>,
    /// Stations currently responsible for this ticket (empty = visible to all).
    #[serde(default)]
    pub stations: Vec<String>,
}

/// Point-in-time active kitchen queue served to a reconnecting KDS peer.
///
/// "Active" is the producer's call, conventionally every ticket whose
/// status is `pending`, `preparing`, or `ready` — served/cancelled
/// tickets are deliberately absent so a snapshot *replaces* the client's
/// queue rather than merging into it.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct KdsQueueSnapshot {
    /// ISO-8601 capture time. Events with `occurred_at` <= this value are
    /// already reflected in the snapshot and may be discarded by the
    /// client after applying it.
    pub generated_at: String,
    /// Active tickets at capture time.
    #[serde(default)]
    pub tickets: Vec<KdsQueueTicket>,
}

/// Source of live active-queue snapshots for reconnecting KDS peers.
///
/// The provider runs **synchronously inside the accept task**, so it must
/// be cheap — serve from an in-memory cache or a short lock, never a long
/// blocking DB scan (see the integration note on
/// `LanEventForwarder::with_kds_queue`).
pub type KdsQueueProvider = Arc<dyn Fn() -> KdsQueueSnapshot + Send + Sync>;

/// Answer one discovery request, optionally injecting the live active
/// queue under the `active_queue` key of the JSON-object payload.
///
/// The payload is returned **byte-identical** unless the peer opted in
/// with `want_queue: true`, a provider is configured, and the payload
/// parses as a JSON object — so non-opting (legacy) peers can never
/// observe a changed discovery response.
pub(crate) fn build_discovery_response(
    payload: &str,
    want_queue: bool,
    provider: Option<&KdsQueueProvider>,
) -> String {
    if !want_queue {
        return payload.to_string();
    }
    let Some(provider) = provider else {
        return payload.to_string();
    };
    let Ok(mut value) = serde_json::from_str::<serde_json::Value>(payload) else {
        tracing::warn!("KDS discovery payload is not JSON — active_queue not injected");
        return payload.to_string();
    };
    if !value.is_object() {
        tracing::warn!("KDS discovery payload is not a JSON object — active_queue not injected");
        return payload.to_string();
    }
    let snapshot = provider();
    match serde_json::to_value(&snapshot) {
        Ok(queue) => {
            value["active_queue"] = queue;
            serde_json::to_string(&value).unwrap_or_else(|_| payload.to_string())
        }
        Err(e) => {
            tracing::warn!(error = %e, "failed to serialise KDS queue snapshot — omitted");
            payload.to_string()
        }
    }
}

#[cfg(test)]
#[path = "kds_sync_tests.rs"]
mod tests;
