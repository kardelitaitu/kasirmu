//! Terminal profile domain type — kiosk/kds lockdown per terminal.

use serde::{Deserialize, Serialize};

/// A terminal profile controls which UI is rendered on a POS device.
///
/// Profiles can lock a terminal to a specific screen (e.g. KDS kiosk)
/// and restrict navigation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TerminalProfile {
    /// FK to terminals.id.
    pub terminal_id: String,
    /// Profile type: 'counter_pos', 'kds_kiosk', 'customer_display', 'unrestricted'.
    pub profile_type: String,
    /// Optional locked screen route (e.g. 'kds' for KDS kiosk).
    pub locked_screen: Option<String>,
    /// ISO-8601 last-update timestamp.
    pub updated_at: String,
}

/// Well-known terminal profile types.
impl TerminalProfile {
    /// Default unrestricted profile for admin/back-office terminals.
    pub const UNRESTRICTED: &'static str = "unrestricted";
    /// Front counter POS (full POS interface).
    pub const COUNTER_POS: &'static str = "counter_pos";
    /// KDS-only locked-down kiosk (no navigation, force KDS route).
    pub const KDS_KIOSK: &'static str = "kds_kiosk";
    /// Customer-facing secondary display.
    pub const CUSTOMER_DISPLAY: &'static str = "customer_display";
}

#[cfg(test)]
#[path = "terminal_profile_tests.rs"]
mod tests;
