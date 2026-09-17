/*
last audited 25-07-26 by RSA-Agent (oz-core slice A)
crate: oz-core | status: SAFE | lint: CLEAN
findings: CourseFired/SettingsUpdated implement DomainEvent; published post-commit per docs; no findings
next: none | perf: N/A
*/
//! Domain events published on the kernel event bus.
//!
//! These events are defined in `oz-core` so that all modules can
//! reference them without circular dependencies. Each event
//! implements `foundation::contracts::DomainEvent` for use with
//! the kernel's `EventBus`.

use foundation::contracts::DomainEvent;

pub use foundation::events::{ProductCreated, SaleCompleted, SaleCompletedLine, StockAdjusted};

/// Published when a course is fired from the Resto POS to the kitchen.
///
/// Handlers should forward this to the KDS screen so the kitchen
/// knows which items to start preparing.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CourseFired {
    /// Sale/order ID this course belongs to.
    ///
    /// Firing happens pre-sale on the active cart, so when published from
    /// `fire_course_scoped` this carries the cart ID as the correlation ID
    /// (no `sale.id` exists yet and no display number has been assigned).
    /// A KDS consumer correlates by cart/table, not by joining to `sales`.
    pub sale_id: String,
    /// The store where the order was placed (ADR #8).
    ///
    /// `None` in single-store/legacy deployments or test contexts.
    /// In multi-store mode, always set from the session's `store_id`.
    pub store_id: Option<String>,
    /// Course identifier in the canonical KDS vocabulary
    /// (`appetizer | main | side | dessert | beverage`).
    pub course_id: String,
    /// Display number shown on the ticket.
    pub display_number: Option<i64>,
    /// Items in this course.
    pub items: Vec<CourseItem>,
}

/// A single item within a fired course.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CourseItem {
    /// Stock-keeping unit.
    pub sku: String,
    /// Quantity fired.
    pub qty: i64,
    /// Human-readable item name.
    pub name: String,
}

impl DomainEvent for CourseFired {
    fn event_name(&self) -> &'static str {
        "order.course_fired"
    }
}

/// Published when one or more settings are changed at a terminal.
///
/// Handlers should use this event to trigger side effects:
/// - **SettingsContext (UI)** → debounced refetch of changed settings scopes
/// - **Sync** → queue the settings delta for cloud propagation
/// - **Audit** → log the configuration change
///
/// Published AFTER the SQLite transaction commits so handlers see the
/// new values. Delta rows are written by `Settings::write_delta()` (Phase 0d).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SettingsUpdated {
    /// The keys that changed (e.g. `["receipt.footer", "store.name"]`).
    pub changed_keys: Vec<String>,
    /// The terminal that made the change.
    pub terminal_id: String,
}

impl DomainEvent for SettingsUpdated {
    fn event_name(&self) -> &'static str {
        "settings.updated"
    }
}

#[cfg(test)]
#[path = "events_tests.rs"]
mod tests;
