//! Settings IPC wire types: the request args and response DTOs the settings
//! commands read and write.
//!
//! Split out of `settings.rs` on 2026-09-27 because the declarations alone were
//! 258 of its lines while carrying no logic - the `run_*` and `*_scoped`
//! command bodies that consume them import from here.
//!
//! Note the serde shape: these are RETURN DTOs, so they serialize with their own
//! `rename_all = "camelCase"` rather than relying on Tauri argument renaming.

use serde::{Deserialize, Serialize};

use platform_core::terminal_profile::TerminalProfile;

/// All receipt display options in one shot - the UI loads these on
/// mount and sends the whole struct back on save.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptSettingsDto {
    /// Show currency symbol prefix on amounts.
    pub show_currency: bool,
    /// Decimal separator: "dot", "comma", or "none".
    pub decimal_separator: String,
    /// Show the tax line.
    pub show_tax: bool,
    /// Footer text (empty = disabled).
    pub footer: String,
    /// Paper width: "standard" or "narrow".
    pub paper_width: String,
    /// Show table number on cart and receipts.
    pub show_table_number: bool,
    /// Top margin (mm).
    pub margin_top: i64,
    /// Bottom margin (mm).
    pub margin_bottom: i64,
    /// Left margin (mm).
    pub margin_left: i64,
    /// Right margin (mm).
    pub margin_right: i64,
    /// Tax rounding mode: "half_up" or "truncate".
    ///
    /// `None` means the caller did not speak to this key, and the stored value
    /// must be left alone. It is deliberately **not** defaulted: the restaurant
    /// POS settings card sends ten of these eleven keys and omits this one,
    /// so a serde default here silently rewrote a merchant's `truncate` back to
    /// `half_up` on every save from that card. The read path always answers
    /// `Some`.
    pub tax_rounding_mode: Option<String>,
}

/// Store name, address, tax ID, currency, branch, and logo - shown on printed receipts.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreSettingsDto {
    /// Display name.
    pub name: String,
    /// Street address.
    pub address: String,
    /// ID of the associated tax.
    pub tax_id: String,
    /// ISO-4217 currency code.
    pub currency: String,
    /// Branch.
    pub branch: String,
    /// Logo.
    pub logo: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Creditsettingsdto.
pub struct CreditSettingsDto {
    /// Enabled.
    pub enabled: bool,
    /// Reminder Interval Hours.
    pub reminder_interval_hours: i64,
    /// Max Limit Minor.
    pub max_limit_minor: i64,
}

/// A credit sale for the reminders list.
///
/// Wire contract (fixed 2026-09-15, Phase 3.3 T4): camelCase. This struct
/// carried no `rename_all` from the Wave E extraction until tonight, so it
/// emitted `sale_id` / `customer_name` / `total_minor` / `created_at` /
/// `settled_at` / `cashier_name` while its only consumer — the retail credit
/// list — reads the camelCase names its interface declares
/// (`ui/src/api/settings.ts:74`; read at the retail credit modals and filtered
/// in the retail POS screen). Every field but `currency` was
/// therefore `undefined` against a real backend: em-dash customer, NaN amount,
/// "Invalid Date", a Settle button that sent `sale_id: undefined`, and — the
/// part that raised no error anywhere — a `!c.settledAt` filter that passed
/// every row, so a settled tab stayed on the unpaid list. Nothing caught it
/// because `ui/src/dev-mock/handlers/payment.ts:231-232` answers both
/// `list_credit_sales` variants with `[]`, and no test in the repo serialized
/// this type before the two that landed with the repair
/// (`settings_tests.rs::credit_sale_dto_emits_the_camel_case_wire_the_retail_list_reads`
/// and the tablet's
/// `settings_tests.rs::wire_pin_credit_sale_carries_every_key_the_renderer_declares`).
/// Outbound is the direction that crosses the boundary, so camelCase is the
/// only form accepted; there was no inbound snake_case caller to keep an alias
/// for.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreditSaleDto {
    /// ID of the associated sale.
    pub sale_id: String,
    /// Customer Name.
    pub customer_name: String,
    /// Total amount in minor currency units.
    pub total_minor: i64,
    /// ISO-4217 currency code.
    pub currency: String,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// Settled At.
    pub settled_at: Option<String>,
    /// Cashier Name.
    pub cashier_name: String,
}

/// One key-value pair within a user's preferences.
#[derive(Debug, Serialize, Deserialize)]
pub struct UserPrefEntry {
    /// Key.
    pub key: String,
    /// Value.
    pub value: String,
}

/// Status entry for one payment gateway.
#[derive(Debug, Serialize)]
pub struct GatewayStatusEntry {
    /// Display name of the gateway.
    pub name: String,
    /// Whether a credential is configured.
    pub configured: bool,
    /// Whether the gateway is usable for charging (same as configured
    /// today; kept separate so reachability checks can land later without
    /// changing the wire shape).
    pub online: bool,
}

/// Full terminal hardware and local-preference configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareSettingsDto {
    /// Printer Connection.
    pub printer_connection: String,
    /// Printer Device Path.
    pub printer_device_path: String,
    /// Printer Paper Size.
    pub printer_paper_size: String,
    /// ID of the associated scanner device.
    pub scanner_device_id: String,
    /// Scanner Input Mode.
    pub scanner_input_mode: String,
    /// Scale connection type: "serial", "usb", "none".
    #[serde(default = "default_scale_connection")]
    pub scale_connection: String,
    /// Scale device path.
    #[serde(default)]
    pub scale_device_path: String,
    /// Scale baud rate (default 9600).
    #[serde(default = "default_scale_baud_rate")]
    pub scale_baud_rate: i64,
    /// Zero the scale automatically on boot.
    #[serde(default)]
    pub scale_zero_on_boot: bool,
    /// Sound volume percentage (0-100).
    #[serde(default = "default_sound_volume")]
    pub sound_volume: i64,
    /// Dark mode enabled.
    #[serde(default)]
    pub dark_mode: bool,
    /// Kitchen printer connection type.
    #[serde(default = "default_kitchen_printer_connection")]
    pub kitchen_printer_connection: String,
    /// Kitchen printer device path or IP.
    #[serde(default)]
    pub kitchen_printer_device_path: String,
    /// Schema version of the hardware profile (for forward-compatible evolution).
    #[serde(default = "default_hw_schema_version")]
    pub schema_version: i64,
    /// Scale auto-zero after each transaction.
    #[serde(default = "default_scale_auto_zero")]
    pub scale_auto_zero: bool,
}

/// Default scale connection when absent: none.
pub fn default_scale_connection() -> String {
    "none".into()
}
/// Default scale baud rate when absent: 9600.
pub fn default_scale_baud_rate() -> i64 {
    9600
}
/// Default kitchen printer connection when absent: disabled.
pub fn default_kitchen_printer_connection() -> String {
    "disabled".into()
}
/// Default hardware profile schema version when absent: 1.
pub fn default_hw_schema_version() -> i64 {
    1
}
/// Default sound volume percentage when absent: 80.
pub fn default_sound_volume() -> i64 {
    80
}
/// Default scale auto-zero flag when absent: true.
pub fn default_scale_auto_zero() -> bool {
    true
}

impl From<TerminalProfile> for HardwareSettingsDto {
    fn from(p: TerminalProfile) -> Self {
        Self {
            printer_connection: p.printer_connection,
            printer_device_path: p.printer_device_path,
            printer_paper_size: p.printer_paper_size,
            scanner_device_id: p.scanner_device_id,
            scanner_input_mode: p.scanner_input_mode,
            scale_connection: p.scale_connection,
            scale_device_path: p.scale_device_path,
            scale_baud_rate: p.scale_baud_rate as i64,
            scale_zero_on_boot: p.scale_zero_on_boot,
            kitchen_printer_connection: p.kitchen_printer_connection,
            kitchen_printer_device_path: p.kitchen_printer_device_path,
            schema_version: p.schema_version as i64,
            sound_volume: p.sound_volume as i64,
            dark_mode: p.dark_mode,
            scale_auto_zero: p.scale_auto_zero,
        }
    }
}

impl From<HardwareSettingsDto> for TerminalProfile {
    fn from(dto: HardwareSettingsDto) -> Self {
        Self {
            printer_connection: dto.printer_connection,
            printer_device_path: dto.printer_device_path,
            printer_paper_size: dto.printer_paper_size,
            scanner_device_id: dto.scanner_device_id,
            scanner_input_mode: dto.scanner_input_mode,
            scale_connection: dto.scale_connection,
            scale_device_path: dto.scale_device_path,
            scale_baud_rate: dto.scale_baud_rate as u32,
            scale_zero_on_boot: dto.scale_zero_on_boot,
            kitchen_printer_connection: dto.kitchen_printer_connection,
            kitchen_printer_device_path: dto.kitchen_printer_device_path,
            schema_version: dto.schema_version as u32,
            sound_volume: dto.sound_volume as u32,
            dark_mode: dto.dark_mode,
            scale_auto_zero: dto.scale_auto_zero,
        }
    }
}

/// Running deployment metadata for the operator/support "About" surface in
/// Diagnostics (todo-global-saas-3.md, L162 operator tooling). The version is
/// organization-global - the build version is identical across every store - so
/// there is no store to resolve; a _scoped variant would be an empty ceremony
/// (category 2, per scripts/verify-scoped-coverage.sh, alongside
/// get_over_quota_report). It is still gated on settings:read inline so only
/// roles that can already read store/system settings see it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentInfo {
    /// The running build version (CARGO_PKG_VERSION, locked to the release
    /// line - 0.0.37 at this writing).
    pub app_version: String,
}
