//! Restaurant table domain type — floor plan positions and statuses.
//!
//! A [`Table`] represents a physical table in the restaurant's floor plan
//! with position coordinates, capacity, and current status (available,
//! occupied, reserved, cleaning). The [`TableStatus`] enum drives the
//! state machine that prevents double-seating.

use serde::{Deserialize, Serialize};

/// Status of a restaurant table in the floor plan.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TableStatus {
    /// Table is free to seat guests.
    Available,
    /// Table has an active order.
    Occupied,
    /// Table is booked for a future guest.
    Reserved,
    /// Table is being cleaned after release.
    Cleaning,
}

impl TableStatus {
    /// Return the serialised string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Available => "available",
            Self::Occupied => "occupied",
            Self::Reserved => "reserved",
            Self::Cleaning => "cleaning",
        }
    }

    /// Parse a status from its string representation.
    #[allow(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "available" => Some(Self::Available),
            "occupied" => Some(Self::Occupied),
            "reserved" => Some(Self::Reserved),
            "cleaning" => Some(Self::Cleaning),
            _ => None,
        }
    }
}

/// A restaurant table with position on the floor plan and current status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Table {
    /// Unique identifier (UUID v7).
    pub id: String,
    /// Human-readable name (e.g. "Table 1", "Patio A").
    pub name: String,
    /// Maximum number of guests.
    pub capacity: i64,
    /// X position on the floor plan (0-100 percentage).
    pub pos_x: f64,
    /// Y position on the floor plan (0-100 percentage).
    pub pos_y: f64,
    /// Shape: 'circle' or 'rectangle'.
    pub shape: String,
    /// Width in percentage (for rectangle tables).
    pub width: f64,
    /// Height in percentage (for rectangle tables).
    pub height: f64,
    /// Current status: 'available', 'occupied', 'reserved', 'cleaning'.
    pub status: String,
    /// Active sale ID when the table is occupied.
    pub active_sale_id: Option<String>,
    /// Section/area (e.g. "Indoor", "Patio", "Bar").
    pub section: String,
    /// Whether the table is active (soft-delete flag).
    pub active: bool,
    /// Ordinal position for sorted display.
    pub sort_order: i64,
    /// RFC-3339 creation timestamp.
    pub created_at: String,
    /// RFC-3339 last-update timestamp.
    pub updated_at: String,
}

#[cfg(test)]
#[path = "table_tests.rs"]
mod tests;
