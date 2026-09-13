//! Kitchen Display System (KDS) domain types.
/*
last audited 25-07-26 by RSA-Agent (oz-core slice D3: kds domain deep read)
crate: oz-core | status: SAFE | lint: CLEAN
findings: clean pure domain types + resolve_kds_targets routing (station-based with broadcast fallback and dedup, documented semantics); pairing token arrives as SHA-256 hash; no logic risks
next: none | perf: N/A
*/
//!
//! Types for order tickets that route completed sales to the kitchen
//! display system with status tracking and timestamps.

use serde::{Deserialize, Serialize};

/// Status of a KDS order in the kitchen workflow.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum KdsStatus {
    /// Order received, not yet being worked on.
    Pending,
    /// Kitchen is actively preparing the order.
    Preparing,
    /// Order is ready to be served.
    Ready,
    /// Order has been served to the customer.
    Served,
    /// Order was cancelled.
    Cancelled,
}

impl KdsStatus {
    /// Serialize to the database string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Preparing => "preparing",
            Self::Ready => "ready",
            Self::Served => "served",
            Self::Cancelled => "cancelled",
        }
    }

    /// Parse from a database string representation.
    #[allow(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "pending" => Some(Self::Pending),
            "preparing" => Some(Self::Preparing),
            "ready" => Some(Self::Ready),
            "served" => Some(Self::Served),
            "cancelled" => Some(Self::Cancelled),
            _ => None,
        }
    }
}

/// A KDS order ticket displayed in the kitchen.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KdsOrder {
    /// Primary key (UUID v7).
    pub id: String,
    /// FK to the originating sale.
    pub sale_id: String,
    /// The store where the order belongs (ADR #8).
    ///
    /// Populated from the sale's store context. Used by KDS tablets
    /// to filter orders for defense-in-depth in multi-store deployments.
    pub store_id: Option<String>,
    /// Topology-selected KDS workspace instance for this ticket.
    ///
    /// `None` is retained for tickets created before runtime route
    /// compilation or by legacy unscoped callers.
    #[serde(default)]
    pub target_instance_id: Option<String>,
    /// Current kitchen status ("pending", "preparing", "ready", "served", "cancelled").
    pub status: String,
    /// Comma-separated item names for display.
    pub items_summary: String,
    /// Total number of items in the order.
    pub item_count: i64,
    /// Human-readable display number (auto-increment per day).
    pub display_number: Option<i64>,
    /// Ticket prefix frozen onto the row at insert time from the location's
    /// config (D16) — the chit renders it as `#{prefix}{n}` when non-empty.
    /// Empty for legacy rows (no backfill) and prefix-less locations.
    #[serde(default)]
    pub ticket_prefix: String,
    /// ISO-8601 timestamp of when the order was received.
    pub received_at: String,
    /// ISO-8601 timestamp of when preparation started.
    pub started_at: Option<String>,
    /// ISO-8601 timestamp of when preparation finished.
    pub ready_at: Option<String>,
    /// ISO-8601 timestamp of when the order was served.
    pub served_at: Option<String>,
    /// Estimated preparation time in seconds.
    pub prep_time_seconds: i64,
    /// Kitchen zone this order belongs to (e.g., "front", "back").
    ///
    /// Populated from the product's `kitchen_zone` at sale completion time.
    /// Used by KDS devices to filter their queue to only their assigned zone.
    pub kitchen_zone: Option<String>,
    /// Special notes from the POS (e.g., "no onions").
    pub notes: String,
    /// Table number assigned to this order (e.g., "T5").
    ///
    /// Populated from the `tables` table at order-creation time via
    /// the sale's `active_sale_id` link. `None` for takeaway orders.
    pub table_number: Option<String>,
    /// Priority/rush flag: when true the ticket visually escalates above normal SLA.
    /// Set by FOH to signal an urgent order (e.g., VIP, long wait, special request).
    pub priority: bool,
}

/// A modifier choice attached to a line item.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KdsModifier {
    /// Modifier group name (e.g., "Temperature", "Add-ons").
    pub name: String,
    /// Selected option (e.g., "Medium Rare", "Extra Cheese").
    pub choice: String,
    /// Price impact in minor units (0 when included).
    #[serde(default)]
    pub price_minor: i64,
}

/// A single line item on a KDS order ticket.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KdsLineItem {
    /// Primary key (UUIDv7).
    pub id: String,
    /// FK to the parent KDS order.
    pub kds_order_id: String,
    /// Product SKU.
    pub sku: String,
    /// Product display name (resolved at creation time).
    pub display_name: String,
    /// Quantity (≥ 1).
    pub qty: i64,
    /// Course assignment ("appetizer", "main", "dessert", "beverage", or NULL).
    pub course: Option<String>,
    /// Modifier choices (empty vec when no modifiers).
    #[serde(default)]
    pub modifiers: Vec<KdsModifier>,
    /// Display order within the ticket.
    pub line_position: i64,
    /// Per-item status.
    #[serde(default)]
    pub item_status: String,
    /// ISO-8601 timestamp of when preparation started.
    pub started_at: Option<String>,
    /// ISO-8601 timestamp of when preparation finished.
    pub ready_at: Option<String>,
    /// ISO-8601 timestamp of when the item was served.
    pub served_at: Option<String>,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
}

/// Input for creating a KDS order from a completed sale.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateKdsOrderInput {
    /// FK to the originating sale.
    pub sale_id: String,
    /// The store where this order belongs (ADR #8).
    pub store_id: Option<String>,
    /// Derived flat summary (e.g. "Steak x2, Salad") — populated from items.
    pub items_summary: String,
    /// Total item count — derived from items.
    pub item_count: i64,
    /// Kitchen zone to assign (e.g., "front", "back").
    pub kitchen_zone: Option<String>,
    /// Special notes.
    pub notes: String,
    /// Table number assigned to this order (e.g., "T5").
    pub table_number: Option<String>,
    /// Priority/rush flag: when true the ticket visually escalates above normal SLA.
    pub priority: bool,
}

/// Input for creating a KDS line item.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateKdsLineItemInput {
    /// Product SKU.
    pub sku: String,
    /// Product display name.
    pub display_name: String,
    /// Quantity (≥ 1).
    pub qty: i64,
    /// Course assignment.
    pub course: Option<String>,
    /// Modifier choices.
    pub modifiers: Vec<KdsModifier>,
}

/// Input for updating the items on an existing KDS order.
///
/// Used when FOH adds items to an order mid-preparation, or when
/// kitchen staff need to correct the items shown on a ticket.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateKdsOrderItemsInput {
    /// KDS order ID to update.
    pub id: String,
    /// Updated comma-separated item display names.
    pub items_summary: String,
    /// Updated total item count.
    pub item_count: i64,
    /// Structured line items to replace the existing kds_line_items.
    ///
    /// When `Some`, the existing line items are deleted and replaced
    /// with these. The `items_summary` and `item_count` fields are
    /// re-derived from this data (the string/count inputs are ignored).
    /// When `None`, only the summary/count are updated (legacy behaviour).
    #[serde(default)]
    pub line_items: Option<Vec<CreateKdsLineItemInput>>,
}

/// A registered KDS display device bound to one Restaurant POS.
///
/// Each device is enrolled via QR-code pairing and tracked through
/// the `kds_devices` table. The `station_ids` field determines which
/// topology stations this device is responsible for — an empty vec
/// means the device receives all orders (broadcast mode).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KdsDevice {
    /// Unique device identifier (UUID v7).
    pub id: String,
    /// Human-readable display name (e.g. "Expo Screen").
    pub name: String,
    /// FK to the parent Restaurant POS terminal.
    pub restaurant_pos_id: String,
    /// Topology station IDs this device is responsible for.
    /// Empty vec = receives all orders (broadcast mode).
    pub station_ids: Vec<String>,
    /// Whether this device is currently active/enrolled.
    pub is_active: bool,
    /// ISO-8601 timestamp of last communication, `None` if never connected.
    pub last_seen_at: Option<String>,
    /// Current connection status.
    pub connection_status: KdsConnectionStatus,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// ISO-8601 last-update timestamp.
    pub updated_at: String,
}

/// Connection status of a KDS device.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KdsConnectionStatus {
    /// Device is actively connected and receiving events.
    Connected,
    /// Device is not currently connected.
    Disconnected,
    /// Device was connected but has not communicated recently.
    Stale,
}

impl KdsConnectionStatus {
    /// Serialize to the database string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Connected => "connected",
            Self::Disconnected => "disconnected",
            Self::Stale => "stale",
        }
    }

    /// Parse from a database string representation.
    pub fn parse_db(s: &str) -> Option<Self> {
        match s {
            "connected" => Some(Self::Connected),
            "disconnected" => Some(Self::Disconnected),
            "stale" => Some(Self::Stale),
            _ => None,
        }
    }
}

/// Input for registering a new KDS device.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisterKdsDeviceInput {
    /// Display name for the device.
    pub name: String,
    /// The Restaurant POS terminal ID this device is bound to.
    pub restaurant_pos_id: String,
    /// Topology station IDs this device is responsible for.
    pub station_ids: Vec<String>,
    /// SHA-256 hash of the enrollment token.
    pub pairing_token_hash: String,
    /// ISO-8601 expiry timestamp for the enrollment token.
    pub pairing_expires_at: String,
}

/// Resolve which KDS devices should receive an order based on its line items.
///
/// 1. For each line item, look up its product's topology station assignment.
/// 2. Match station → KDS devices via `kds_devices.station_ids`.
/// 3. If a device has an empty `station_ids` (broadcast mode), it receives all orders.
/// 4. If no device claims a station, the order broadcasts to all devices (safe fallback).
/// 5. Deduplicate — a device never receives the same order twice.
///
/// `station_for_sku` is a callback that maps a SKU to its topology station ID.
/// Return `None` if the SKU has no station assignment.
pub fn resolve_kds_targets<F>(
    line_items: &[KdsLineItem],
    devices: &[KdsDevice],
    station_for_sku: F,
) -> Vec<String>
where
    F: Fn(&str) -> Option<String>,
{
    resolve_targets_by_station(line_items, devices, |item| station_for_sku(&item.sku))
}

/// Shared 3-phase core behind [`resolve_kds_targets`] and
/// [`resolve_kds_targets_with_rules`]. Same algorithm, same order of
/// phases; the only generalization is that the station for a line item is
/// supplied per line item instead of derived from the SKU alone, so the
/// rule-aware caller can let rules override the zone default first.
fn resolve_targets_by_station<F>(
    line_items: &[KdsLineItem],
    devices: &[KdsDevice],
    station_of: F,
) -> Vec<String>
where
    F: Fn(&KdsLineItem) -> Option<String>,
{
    use std::collections::HashSet;

    let mut targeted_devices: HashSet<String> = HashSet::new();
    let mut untargeted_stations: HashSet<String> = HashSet::new();

    // Phase 1: Station-based targeting
    for item in line_items {
        if let Some(station) = station_of(item) {
            let mut any_device_claimed = false;
            for device in devices {
                if device.is_active && device.station_ids.contains(&station) {
                    targeted_devices.insert(device.id.clone());
                    any_device_claimed = true;
                }
            }
            if !any_device_claimed {
                untargeted_stations.insert(station);
            }
        }
    }

    // Phase 2: Broadcast fallback — empty station_ids means "show everything"
    for device in devices {
        if device.is_active && device.station_ids.is_empty() {
            targeted_devices.insert(device.id.clone());
        }
    }

    // Phase 3: If any station has no claiming device, broadcast to all
    if !untargeted_stations.is_empty() {
        for device in devices {
            if device.is_active {
                targeted_devices.insert(device.id.clone());
            }
        }
    }

    targeted_devices.into_iter().collect()
}

/// Which product attribute a [`KdsRoutingRule`] matches a line item against.
///
/// `Tag` is declared for schema stability, but the catalog does not model
/// product tags yet (no tags table exists), so a `Tag` rule NEVER matches:
/// the line falls through to the next-ranked rule or the zone default.
/// Wiring it later needs only a tags-by-sku fact source in the caller and
/// one match arm here — the table CHECK already admits `'tag'`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KdsRuleMatcher {
    /// Exact match against the line item's product SKU.
    Sku,
    /// Match against the product's category id (`products.category_id`).
    Category,
    /// Match against a product tag — NOT MODELED in the catalog; never matches.
    Tag,
}

impl KdsRuleMatcher {
    /// Serialize to the database string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Sku => "sku",
            Self::Category => "category",
            Self::Tag => "tag",
        }
    }

    /// Parse from a database string representation.
    pub fn parse_db(s: &str) -> Option<Self> {
        match s {
            "sku" => Some(Self::Sku),
            "category" => Some(Self::Category),
            "tag" => Some(Self::Tag),
            _ => None,
        }
    }
}

/// One row of `kds_routing_rules`: an explicit station assignment for the
/// line items it matches, overriding/augmenting the product `kitchen_zone`
/// default without touching catalog data. Rules COMPOSE with the frozen
/// 3-phase router — they only change which station a line resolves to;
/// device matching, broadcast fallback and catch-all stay as they are.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KdsRoutingRule {
    /// Primary key (UUID v7).
    pub id: String,
    /// FK to the owning Restaurant POS terminal (rule scope).
    pub restaurant_pos_id: String,
    /// Rank across matching rules for one line: lower number = higher
    /// priority (1 outranks 10). Equal priority: a `Sku` matcher outranks
    /// `Category` (more specific), then input order (first rule wins).
    pub priority: i64,
    /// What the rule matches a line against.
    pub matcher: KdsRuleMatcher,
    /// SKU string or category id, depending on `matcher`.
    pub matcher_value: String,
    /// Topology station the matched line routes to.
    pub target_station: String,
    /// Whether the rule participates in routing.
    pub is_active: bool,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// ISO-8601 last-update timestamp.
    pub updated_at: String,
}

/// Client-supplied shape for one routing rule in the save IPC.
///
/// The server assigns `id` and both timestamps; the restaurant scope comes
/// from the session, never from the payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KdsRoutingRuleInput {
    /// Lower number = higher priority (1 outranks 10).
    pub priority: i64,
    /// What the rule matches a line against.
    pub matcher: KdsRuleMatcher,
    /// SKU string or category id, depending on `matcher`.
    pub matcher_value: String,
    /// Topology station the matched line routes to.
    pub target_station: String,
    /// Omitted means active — mirrors the column default (`1`).
    #[serde(default = "kds_rule_default_active")]
    pub is_active: bool,
}

fn kds_rule_default_active() -> bool {
    true
}

/// Resolve which KDS devices should receive an order with dynamic routing
/// rules composed ON TOP of the static zone routing.
///
/// Per line item: the highest-priority active rule that matches the line
/// supplies its station; a line no rule matches falls back to
/// `station_for_sku` (the `kitchen_zone` default). The resulting per-line
/// stations then go through the exact same 3 phases as
/// [`resolve_kds_targets`] — rules never bypass broadcast fallback or the
/// unclaimed-station catch-all.
///
/// With `rules` empty the output is identical to [`resolve_kds_targets`]
/// for the same inputs (pinned by a test).
///
/// `category_for_sku` supplies the category id a `Category` rule compares
/// its `matcher_value` against; return `None` when the SKU has no category
/// (or is unknown). Unused for other matcher kinds, so callers without a
/// category lookup cheaply pass `|_| None` — `Tag` rules never match while
/// tags are unmodeled, so no tag callback exists yet.
pub fn resolve_kds_targets_with_rules<F, C>(
    line_items: &[KdsLineItem],
    devices: &[KdsDevice],
    rules: &[KdsRoutingRule],
    station_for_sku: F,
    category_for_sku: C,
) -> Vec<String>
where
    F: Fn(&str) -> Option<String>,
    C: Fn(&str) -> Option<String>,
{
    resolve_targets_by_station(line_items, devices, |item| {
        rule_station_for_line(rules, item, &category_for_sku).or_else(|| station_for_sku(&item.sku))
    })
}

/// The station the highest-ranked active matching rule assigns to this
/// line, if any. Ranking: `priority` ascending (lower number = higher
/// priority), then matcher specificity (`Sku` before `Category`), then
/// input order — fully deterministic regardless of how the rules arrived.
fn rule_station_for_line<C>(
    rules: &[KdsRoutingRule],
    item: &KdsLineItem,
    category_for_sku: &C,
) -> Option<String>
where
    C: Fn(&str) -> Option<String>,
{
    rules
        .iter()
        .enumerate()
        .filter(|(_, rule)| rule.is_active)
        .filter(|(_, rule)| rule_matches(rule, item, category_for_sku))
        .min_by_key(|(index, rule)| (rule.priority, matcher_rank(rule.matcher), *index))
        .map(|(_, rule)| rule.target_station.clone())
}

fn rule_matches<C>(rule: &KdsRoutingRule, item: &KdsLineItem, category_for_sku: &C) -> bool
where
    C: Fn(&str) -> Option<String>,
{
    match rule.matcher {
        KdsRuleMatcher::Sku => rule.matcher_value == item.sku,
        KdsRuleMatcher::Category => {
            category_for_sku(&item.sku).is_some_and(|category| category == rule.matcher_value)
        }
        // Tags are not modeled in the catalog yet — see KdsRuleMatcher.
        KdsRuleMatcher::Tag => false,
    }
}

const fn matcher_rank(matcher: KdsRuleMatcher) -> u8 {
    match matcher {
        KdsRuleMatcher::Sku => 0,
        KdsRuleMatcher::Category => 1,
        KdsRuleMatcher::Tag => 2,
    }
}

#[cfg(test)]
#[path = "kds_tests.rs"]
mod tests;
