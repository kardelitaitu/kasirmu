//! Settings command bodies: the shared key guards, the setting DTOs, and the read side.
//!
//! Extracted from the desktop shell (apps/desktop-client/src/commands/settings.rs) as
//! Wave E slice E1a. Nothing here names a tauri type: each shell shim borrows a
//! BridgeCtx, calls the matching function and maps BridgeError back onto AppError
//! variant-for-variant, so the wire shape stays byte-identical. The writer half (the
//! set_* commands, set_hardware_settings_scoped and the secret-key mutators) and the
//! shim conversion of the readers both land in E1b; the shared surface is hoisted
//! whole so that move is a pure command-body port.
//!
//! Two permission behaviours coexist here by design and must NOT be unified:
//!  * the session-gated readers run the SCOPE-AWARE
//!    BridgeCtx::require_session_permission (settings:read) - except
//!    list_credit_sales_scoped, which keeps sales:view exactly as the shell has it;
//!  * get_user_preferences_scoped only resolves the session (the shell never gated it),
//!    and the six global-DB readers (get_receipt_settings, get_store_settings,
//!    get_credit_settings, get_hardware_settings, get_setting, gateway_status) carry no
//!    gate at all. No gate is invented here.
//!
//! get_hardware_settings and get_hardware_settings_scoped take the profile directory
//! as base_dir: BridgeCtx carries the app CACHE dir, which is a different directory
//! from the db_path parent the shell derives, so the shim threads it in rather than
//! having the bridge re-derive it.

use std::collections::HashMap;
use std::path::Path;

use oz_core::permissions;
use oz_core::{Settings, Store, UserPreferences};
use platform_core::terminal_profile::TerminalProfile;
use serde::{Deserialize, Serialize};

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// The credential deny list — the ONE shared source of truth, owned by
/// `platform_core::settings::keys` and re-exported here so the desktop lane
/// keeps its historical `oz_bridge::settings::SECRET_KEY_DENY_LIST` path.
///
/// It holds every key that must never be returned via the raw get_setting IPC
/// command nor travel in a portable package: credentials, API keys, passwords
/// and pre-shared keys (C-2: CWE-200 information disclosure). The list is
/// built FROM the key constants in that module rather than from retyped
/// literals, so a rename moves the guard with the key; the tablet shell
/// imports the same list instead of carrying its own copy.
pub use platform_core::settings::keys::{
    NON_EXPORTABLE_DEVICE_KEYS, SECRET_KEY_DENY_LIST, is_non_exportable_setting_key,
    is_secret_setting_key,
};

/// Returns true if the given settings key should be blocked from
/// the raw get_setting IPC surface.
///
/// Delegates to the shared predicate in platform_core so the tablet shell and
/// this lane can never answer the same question differently.
pub fn is_secret_key(key: &str) -> bool {
    is_secret_setting_key(key)
}

/// Which dedicated lifecycle manager owns a key, if any.
///
/// local_api.* is managed exclusively by the Local API commands: writing
/// local_api.enabled through the generic path would persist an intent the server never
/// acts on (fail-open disable), and writing local_api.secret would silently invalidate
/// every minted token. lan_server.* is the same class (PSK + bind + enabled owned by
/// the LAN server module); no UI surface writes those through the generic path, so
/// widening the guard closes the pre-existing hole without breaking any caller.
pub fn managed_key_owner(key: &str) -> Option<&'static str> {
    if key.starts_with("local_api.") {
        Some("Local API")
    } else if key.starts_with("lan_server.") {
        Some("LAN server")
    } else {
        None
    }
}

/// Returns true if a key is owned by a dedicated lifecycle manager.
pub fn is_managed_key(key: &str) -> bool {
    managed_key_owner(key).is_some()
}

/// Returns true if a key must never leave the backend through a bulk surface:
/// the deny-listed credential secrets, keys owned by a dedicated lifecycle
/// manager (local_api.* - writing/restoring those through the generic path
/// desyncs the manager, see is_managed_key), and the device-bound identity keys
/// (sync_terminal_id, machine_id - see NON_EXPORTABLE_DEVICE_KEYS). Used by the
/// data export and, symmetrically, by the import arm (review MED-2: the export
/// carried local_api.secret, so an exported-then-restored backup would give two
/// installs the same signing secret, breaking the per-install property).
///
/// Note this is WIDER than the IPC guard: the device-bound identity keys stay
/// readable through get_setting (they are identifiers the shipped UI reads),
/// they are only barred from portable packages.
pub fn is_non_exportable_key(key: &str) -> bool {
    is_non_exportable_setting_key(key) || is_managed_key(key)
}

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
    /// Tax rounding mode: "half_up" or "truncate". Default "half_up".
    #[serde(default = "default_tax_rounding_mode")]
    pub tax_rounding_mode: String,
}

/// Default for ReceiptSettingsDto::tax_rounding_mode when the field is absent.
pub fn default_tax_rounding_mode() -> String {
    "half_up".to_string()
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
#[derive(Debug, Serialize, Deserialize)]
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
#[derive(Debug, Serialize, Deserialize)]
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

/// Build the deployment-info payload. Split out so tests exercise the exact
/// production path without standing up a session.
pub fn build_deployment_info() -> DeploymentInfo {
    DeploymentInfo {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

/// Business logic for get_receipt_settings (extracted for testing).
pub fn run_get_receipt_settings(
    conn: &rusqlite::Connection,
) -> Result<ReceiptSettingsDto, BridgeError> {
    Ok(ReceiptSettingsDto {
        show_currency: Settings::get_receipt_show_currency(conn)?,
        decimal_separator: Settings::get_receipt_decimal_separator(conn)?,
        show_tax: Settings::get_receipt_show_tax(conn)?,
        footer: Settings::get_receipt_footer(conn)?,
        paper_width: Settings::get_receipt_paper_width(conn)?,
        show_table_number: Settings::get_receipt_show_table_number(conn)?,
        margin_top: Settings::get_receipt_margin_top(conn)?,
        margin_bottom: Settings::get_receipt_margin_bottom(conn)?,
        margin_left: Settings::get_receipt_margin_left(conn)?,
        margin_right: Settings::get_receipt_margin_right(conn)?,
        tax_rounding_mode: Settings::get_tax_rounding_mode(conn)?
            .wire_name()
            .to_string(),
    })
}

/// Business logic for get_store_settings (extracted for testing).
pub fn run_get_store_settings(
    conn: &rusqlite::Connection,
) -> Result<StoreSettingsDto, BridgeError> {
    Ok(StoreSettingsDto {
        name: Settings::get_store_name(conn)?.unwrap_or_default(),
        address: Settings::get_store_address(conn)?.unwrap_or_default(),
        tax_id: Settings::get_store_tax_id(conn)?.unwrap_or_default(),
        currency: Settings::get_default_currency(conn)?.unwrap_or_else(|| "IDR".into()),
        branch: Settings::get_store_branch(conn)?.unwrap_or_default(),
        logo: Settings::get_store_logo(conn)?.unwrap_or_default(),
    })
}

/// Business logic for listing credit sales (extracted for testing).
pub fn run_list_credit_sales(
    conn: &rusqlite::Connection,
) -> Result<Vec<CreditSaleDto>, BridgeError> {
    let mut stmt = conn.prepare(
        "SELECT s.id, p.gateway_reference, s.total_minor, s.currency, s.created_at,
                p.settled_at, COALESCE(u.display_name, '')
         FROM sales s
         JOIN payments p ON p.sale_id = s.id
         LEFT JOIN users u ON u.id = s.user_id
         WHERE s.status = 'completed'
           AND p.method = 'credit'
         ORDER BY s.created_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(CreditSaleDto {
            sale_id: row.get(0)?,
            customer_name: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            total_minor: row.get(2)?,
            currency: row.get(3)?,
            created_at: row.get(4)?,
            settled_at: row.get(5)?,
            cashier_name: row.get(6)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

/// Business logic for get_setting (extracted for testing).
///
/// C-2: Secret keys are denied - never return plaintext credentials,
/// API keys, passwords, or PSKs to the IPC surface.
pub fn run_get_setting(
    conn: &rusqlite::Connection,
    key: &str,
) -> Result<Option<String>, BridgeError> {
    if is_secret_key(key) {
        return Ok(None);
    }
    Ok(Settings::get(conn, key)?)
}

/// Business logic for set_setting (extracted for testing).
/// Uses set_tracked so every settings change writes a delta record (ADR #22).
pub fn run_set_setting(
    conn: &rusqlite::Connection,
    key: &str,
    value: &str,
    terminal_id: &str,
) -> Result<(), BridgeError> {
    if let Some(owner) = managed_key_owner(key) {
        return Err(BridgeError::Invalid(format!(
            "{key} is managed by the {owner} controls — use those"
        )));
    }
    Ok(Settings::set_tracked(conn, key, value, terminal_id)?)
}

/// Enqueue one settings.update sync item per changed key (SYNC-10).
///
/// Delegates to Store::enqueue_settings_update_superseding (oz-core), which owns the
/// settings.update wire contract: payload shape, Low priority, and
/// supersede-any-pending-same-key semantics. Callers enqueue on the GLOBAL db (the
/// sync daemon only watches the global queue), never the store db the value was written to.
pub fn enqueue_settings_updates(
    store: &Store,
    entries: &HashMap<String, String>,
    terminal_id: &str,
    tenant_id: &str,
) -> Result<(), BridgeError> {
    for (key, value) in entries {
        store.enqueue_settings_update_superseding(key, value, terminal_id, tenant_id)?;
    }
    Ok(())
}
// ---------------------------------------------------------------- readers

/// Get receipt settings (global DB; gate-free exactly as in the shell).
pub async fn get_receipt_settings(ctx: &BridgeCtx<'_>) -> Result<ReceiptSettingsDto, BridgeError> {
    let conn = ctx.db.lock().await;
    run_get_receipt_settings(&conn)
}

/// Get receipt settings resolved from a session token. ADR #7.
pub async fn get_receipt_settings_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<ReceiptSettingsDto, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_READ)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    run_get_receipt_settings(&db)
}

/// Get store settings (global DB; gate-free exactly as in the shell).
pub async fn get_store_settings(ctx: &BridgeCtx<'_>) -> Result<StoreSettingsDto, BridgeError> {
    let conn = ctx.db.lock().await;
    run_get_store_settings(&conn)
}

/// Get store settings resolved from a session token. ADR #7.
pub async fn get_store_settings_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<StoreSettingsDto, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_READ)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    run_get_store_settings(&db)
}

/// Get credit settings (global DB; gate-free exactly as in the shell).
pub async fn get_credit_settings(ctx: &BridgeCtx<'_>) -> Result<CreditSettingsDto, BridgeError> {
    let conn = ctx.db.lock().await;
    Ok(CreditSettingsDto {
        enabled: Settings::is_credit_enabled(&conn)?,
        reminder_interval_hours: Settings::get_credit_reminder_interval(&conn)?,
        max_limit_minor: Settings::get_credit_max_limit(&conn)?,
    })
}

/// Scoped variant of get_credit_settings (ADR #7).
pub async fn get_credit_settings_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<CreditSettingsDto, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_READ)
        .await?;
    let (_session, _conn) = ctx.resolve_scope(session_token)?;
    let conn = _conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(CreditSettingsDto {
        enabled: Settings::is_credit_enabled(&conn)?,
        reminder_interval_hours: Settings::get_credit_reminder_interval(&conn)?,
        max_limit_minor: Settings::get_credit_max_limit(&conn)?,
    })
}

/// List credit sales for the store resolved from a session token. ADR #7.
pub async fn list_credit_sales_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<CreditSaleDto>, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    // This one keeps sales:view, not settings:read - verbatim from the shell.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SALES_VIEW)
        .await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    run_list_credit_sales(&db)
}

/// Get hardware settings for the current terminal from the DB.
///
/// Read order:
/// 1. DB (hardware_profiles table) - canonical store (TODO 4e)
/// 2. JSON file (terminal_profiles/<id>.json) - fallback
/// 3. Old SQLite settings - legacy fallback
///
/// Returns defaults only when none of the above have saved values.
pub async fn get_hardware_settings(
    ctx: &BridgeCtx<'_>,
    base_dir: &Path,
) -> Result<HardwareSettingsDto, BridgeError> {
    let terminal_id = ctx
        .terminal_id
        .lock()
        .await
        .clone()
        .unwrap_or_else(|| "unknown".to_string());

    // 1. Try DB first (canonical store).
    {
        let conn = ctx.db.lock().await;
        let profile_json: Option<String> = conn
            .query_row(
                "SELECT profile_json FROM hardware_profiles WHERE terminal_id = ?1",
                rusqlite::params![&terminal_id],
                |row| row.get(0),
            )
            .ok();
        if let Some(json) = profile_json {
            if let Ok(profile) = serde_json::from_str::<TerminalProfile>(&json) {
                return Ok(HardwareSettingsDto::from(profile));
            }
            tracing::warn!(
                terminal_id = %terminal_id,
                "failed to parse hardware profile JSON from DB — falling back to file"
            );
        }
    } // conn dropped

    let path = TerminalProfile::profile_path(base_dir, &terminal_id);

    // 2. Try JSON file as fallback.
    if let Some(profile) = TerminalProfile::load(&path)? {
        // Sync the JSON profile into the DB for future fast reads.
        let json = serde_json::to_string(&profile)
            .map_err(|e| BridgeError::Internal(format!("serializing profile: {e}")))?;
        let conn = ctx.db.lock().await;
        if let Err(e) = conn.execute(
            "INSERT OR REPLACE INTO hardware_profiles (terminal_id, profile_json, schema_version, updated_at)
             VALUES (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
            rusqlite::params![&terminal_id, &json, profile.schema_version],
        ) {
            tracing::warn!(
                terminal_id = %terminal_id,
                error = %e,
                "failed to sync JSON profile to DB — will retry next read"
            );
        }
        return Ok(HardwareSettingsDto::from(profile));
    }

    // 3. Fallback: read from old SQLite settings (pre-ADR #22).
    let conn = ctx.db.lock().await;
    let profile = TerminalProfile {
        printer_connection: Settings::get_printer_connection(&conn)?,
        printer_device_path: Settings::get_printer_device_path(&conn)?,
        printer_paper_size: Settings::get_printer_paper_size(&conn)?,
        scanner_device_id: Settings::get_scanner_device_id(&conn)?,
        scanner_input_mode: Settings::get_scanner_input_mode(&conn)?,
        ..Default::default()
    };

    // Persist to both JSON (for backward compat readers) and DB (canonical).
    let json = serde_json::to_string(&profile)
        .map_err(|e| BridgeError::Internal(format!("serializing profile: {e}")))?;
    if let Err(e) = profile.save(&path) {
        tracing::warn!(
            terminal_id = %terminal_id,
            error = %e,
            "failed to save migrated hardware settings to JSON — will retry"
        );
    }
    if let Err(e) = conn.execute(
        "INSERT OR REPLACE INTO hardware_profiles (terminal_id, profile_json, schema_version, updated_at)
         VALUES (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
        rusqlite::params![&terminal_id, &json, profile.schema_version],
    ) {
        tracing::warn!(
            terminal_id = %terminal_id,
            error = %e,
            "failed to save migrated hardware settings to DB — will retry next read"
        );
    }

    // Clean up old SQLite keys after successful migration.
    let hw_keys = [
        "printer.connection",
        "printer.device_path",
        "printer.paper_size",
        "scanner.device_id",
        "scanner.input_mode",
    ];
    for key in hw_keys {
        if let Err(e) = Settings::remove(&conn, key) {
            tracing::warn!(
                key,
                error = %e,
                "failed to remove orphaned SQLite hardware setting"
            );
        }
    }

    Ok(HardwareSettingsDto::from(profile))
}

/// Get hardware settings (scoped - multi-phase with session validation).
pub async fn get_hardware_settings_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    base_dir: &Path,
) -> Result<HardwareSettingsDto, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_READ)
        .await?;
    // Validate session; hardware profiles use the global db.
    ctx.resolve_scope(session_token)?;
    get_hardware_settings(ctx, base_dir).await
}

/// Get user preferences resolved from a session token. ADR #7.
/// Uses session.user_id for the preference lookup. The shell gated nothing here but
/// the session, so nothing here is gated beyond the session either.
pub async fn get_user_preferences_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<HashMap<String, String>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(UserPreferences::get_all(&db, &session.user_id)?)
}

/// Read a single setting value by key.
///
/// Returns None when the key does not exist.
pub async fn get_setting(ctx: &BridgeCtx<'_>, key: &str) -> Result<Option<String>, BridgeError> {
    let conn = ctx.db.lock().await;
    run_get_setting(&conn, key)
}

/// Scoped variant of get_setting (ADR #7).
pub async fn get_setting_scoped(
    ctx: &BridgeCtx<'_>,
    key: &str,
    session_token: &str,
) -> Result<Option<String>, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_READ)
        .await?;
    let (_session, _conn) = ctx.resolve_scope(session_token)?;
    let conn = _conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    run_get_setting(&conn, key)
}

/// Report which payment gateways have credentials configured.
///
/// UI-1: computes the configured/online booleans server-side so the raw
/// credential values never leave the backend - the gateway keys are on
/// the SECRET_KEY_DENY_LIST, and the renderer only ever sees booleans.
pub async fn gateway_status(ctx: &BridgeCtx<'_>) -> Result<Vec<GatewayStatusEntry>, BridgeError> {
    let conn = ctx.db.lock().await;
    let configured = |key: &str| -> Result<bool, BridgeError> {
        Ok(Settings::get(&conn, key)?.is_some_and(|v| !v.is_empty()))
    };
    let stripe = configured("stripe.api_key")?;
    let square = configured("square.api_key")?;
    let midtrans = configured("midtrans.server_key")?;
    Ok(vec![
        GatewayStatusEntry {
            name: "Stripe".into(),
            configured: stripe,
            online: stripe,
        },
        GatewayStatusEntry {
            name: "Square".into(),
            configured: square,
            online: square,
        },
        GatewayStatusEntry {
            name: "QRIS (Midtrans)".into(),
            configured: midtrans,
            online: midtrans,
        },
    ])
}

/// Read-only deployment metadata for the signed-in operator. Authenticates the
/// session and checks settings:read inline (category 2 unscoped command).
pub async fn get_deployment_info(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<DeploymentInfo, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_READ)
        .await?;
    Ok(build_deployment_info())
}

// ------------------------------------------------- write commands (E1c)

/// Business logic for `set_receipt_settings` (extracted for testing).
pub fn run_set_receipt_settings(
    conn: &rusqlite::Connection,
    args: &ReceiptSettingsDto,
) -> Result<(), BridgeError> {
    let tx = conn.unchecked_transaction()?;

    Settings::set_receipt_show_currency(&tx, args.show_currency)?;
    Settings::set_receipt_decimal_separator(&tx, &args.decimal_separator)?;
    Settings::set_receipt_show_tax(&tx, args.show_tax)?;
    Settings::set_receipt_footer(&tx, &args.footer)?;
    Settings::set_receipt_paper_width(&tx, &args.paper_width)?;
    Settings::set_receipt_show_table_number(&tx, args.show_table_number)?;
    Settings::set_receipt_margin_top(&tx, args.margin_top)?;
    Settings::set_receipt_margin_bottom(&tx, args.margin_bottom)?;
    Settings::set_receipt_margin_left(&tx, args.margin_left)?;
    Settings::set_receipt_margin_right(&tx, args.margin_right)?;
    Settings::set_tax_rounding_mode_str(&tx, &args.tax_rounding_mode)?;

    tx.commit()?;

    Ok(())
}

/// Business logic for `set_store_settings` (extracted for testing).
pub fn run_set_store_settings(
    conn: &rusqlite::Connection,
    args: &StoreSettingsDto,
) -> Result<(), BridgeError> {
    let tx = conn.unchecked_transaction()?;

    Settings::set_store_name(&tx, &args.name)?;
    Settings::set_store_address(&tx, &args.address)?;
    Settings::set_store_tax_id(&tx, &args.tax_id)?;
    Settings::set_default_currency(&tx, &args.currency)?;
    Settings::set_store_branch(&tx, &args.branch)?;
    Settings::set_store_logo(&tx, &args.logo)?;

    tx.commit()?;

    Ok(())
}

/// Set receipt settings resolved from a session token. ADR #7.
pub async fn set_receipt_settings_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: ReceiptSettingsDto,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = oz_core::db::Store::new(&db);
    ctx.require_permission_for_user(&store, &session.user_id, permissions::SETTINGS_EDIT)?;
    run_set_receipt_settings(&db, &args)
}

/// Set store settings resolved from a session token. ADR #7.
pub async fn set_store_settings_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: StoreSettingsDto,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = oz_core::db::Store::new(&db);
    ctx.require_permission_for_user(&store, &session.user_id, permissions::SETTINGS_EDIT)?;
    run_set_store_settings(&db, &args)
}

/// Set credit settings resolved from a session token. ADR #7.
pub async fn set_credit_settings_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: CreditSettingsDto,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = oz_core::db::Store::new(&db);
    ctx.require_permission_for_user(&store, &session.user_id, permissions::SETTINGS_EDIT)?;
    let tx = db.unchecked_transaction()?;
    Settings::set_credit_enabled(&tx, args.enabled)?;
    Settings::set_credit_reminder_interval(&tx, args.reminder_interval_hours)?;
    Settings::set_credit_max_limit(&tx, args.max_limit_minor)?;
    tx.commit()?;
    Ok(())
}

/// Settle a credit sale resolved from a session token. ADR #7.
pub async fn settle_credit_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    sale_id: &str,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = oz_core::db::Store::new(&db);
    ctx.require_permission_for_user(&store, &session.user_id, permissions::SETTINGS_EDIT)?;
    let tx = db.unchecked_transaction()?;
    let now = chrono::Utc::now().to_rfc3339();
    tx.execute(
        "UPDATE payments SET settled_at = ?1 WHERE sale_id = ?2 AND method = 'credit'",
        rusqlite::params![now, sale_id],
    )?;
    tx.commit()?;
    Ok(())
}

/// Set hardware settings resolved from a session token. ADR #7.
///
/// Writes to both DB (canonical) and JSON file (fallback).
///
/// The `hardware_profiles` table lives in the global DB (not per-store)
/// since terminal hardware configuration is global across all stores.
/// Permission checking uses the store-scoped DB from the session.
pub async fn set_hardware_settings_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: HardwareSettingsDto,
    base_dir: &Path,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;

    // Extract terminal_id before locking DB (avoids Send guard across .await).
    let terminal_id = ctx
        .terminal_id
        .lock()
        .await
        .clone()
        .unwrap_or_else(|| "unknown".to_string());

    // Permission check requires the store-scoped DB.
    {
        let conn = ctx
            .db_manager
            .open_store(&session.store_id)
            .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        let store = oz_core::db::Store::new(&db);
        ctx.require_permission_for_user(&store, &session.user_id, permissions::SETTINGS_EDIT)?;
    }

    let profile = TerminalProfile::from(args);
    let json = serde_json::to_string(&profile)
        .map_err(|e| BridgeError::Internal(format!("serializing profile: {e}")))?;

    // Write to DB (canonical store).
    // We use the global DB since hardware_profiles is a global table.
    {
        let conn = ctx.db.lock().await;
        conn.execute(
            "INSERT OR REPLACE INTO hardware_profiles (terminal_id, profile_json, schema_version, updated_at)
             VALUES (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
            rusqlite::params![&terminal_id, &json, profile.schema_version],
        )?;
    }

    // Write to JSON file (backward compat fallback).
    // base_dir is threaded in by the shim (db_path parent, not the cache dir)
    let path = TerminalProfile::profile_path(base_dir, &terminal_id);
    if let Err(e) = profile.save(&path) {
        tracing::warn!(
            terminal_id = %terminal_id,
            error = %e,
            "failed to save hardware settings to JSON — DB write succeeded"
        );
    }

    Ok(())
}

/// Set user preferences resolved from a session token. ADR #7.
/// Uses `session.user_id` for the preference write.
pub async fn set_user_preferences_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    prefs: Vec<UserPrefEntry>,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let pairs: Vec<(String, String)> = prefs.into_iter().map(|e| (e.key, e.value)).collect();
    Ok(UserPreferences::set_batch(&db, &session.user_id, &pairs)?)
}

/// **Deprecated — use `set_setting_scoped` (ADR #7).**
///
/// Write (or overwrite) a single setting value.
///
/// Pass an empty string to store an empty value.
pub async fn set_setting(
    ctx: &BridgeCtx<'_>,
    key: &str,
    value: &str,
    user_id: &str,
) -> Result<(), BridgeError> {
    // Extract terminal_id first.
    let terminal_id = ctx
        .terminal_id
        .lock()
        .await
        .clone()
        .unwrap_or_else(|| "unknown".to_string());

    // Scope block: drop sync guards before .await below.
    {
        let conn = ctx.db.lock().await;
        let store = oz_core::db::Store::new(&conn);
        ctx.require_permission_for_user(&store, &user_id, permissions::SETTINGS_EDIT)?;
        run_set_setting(&conn, key, value, &terminal_id)?;
        if let Err(e) = enqueue_settings_updates(
            &store,
            &HashMap::from([(key.to_string(), value.to_string())]),
            &terminal_id,
            "default",
        ) {
            tracing::warn!(key = %key, error = %e, "failed to enqueue settings.update sync item");
        }
    } // conn, store dropped here

    // Publish SettingsUpdated event for cross-terminal reactivity (ADR #22).
    let kernel = ctx.kernel.lock().await;
    let bus = kernel.event_bus();
    let event = oz_core::events::SettingsUpdated {
        changed_keys: vec![key.to_string()],
        terminal_id,
    };
    if let Err(e) = bus.publish(&event) {
        tracing::warn!(key = %key, error = %e, "failed to publish SettingsUpdated event");
    }

    Ok(())
}

/// Write (or overwrite) a single setting value resolved from a session token. ADR #7.
///
/// Pass an empty string to store an empty value.
/// Writes a delta record and publishes a `SettingsUpdated` event (ADR #22).
pub async fn set_setting_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    key: &str,
    value: &str,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;

    // Extract terminal_id before locking the store DB to avoid
    // holding a non-Send MutexGuard across an .await point.
    let terminal_id = ctx
        .terminal_id
        .lock()
        .await
        .clone()
        .unwrap_or_else(|| "unknown".to_string());

    // Scope block: all sync guards (MutexGuard, Store) must be
    // dropped before any .await below.
    {
        let conn = ctx
            .db_manager
            .open_store(&session.store_id)
            .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        let store = oz_core::db::Store::new(&db);
        ctx.require_permission_for_user(&store, &session.user_id, permissions::SETTINGS_EDIT)?;
        run_set_setting(&db, key, value, &terminal_id)?;
    } // db, store, conn dropped here — safe to .await below

    // Enqueue `settings.update` sync items on the GLOBAL db — the sync
    // daemon only watches the global queue, so a store-scoped write must
    // fan out from here (SYNC-10 enqueue side).
    {
        let conn = ctx.db.lock().await;
        let store = oz_core::db::Store::new(&conn);
        if let Err(e) = enqueue_settings_updates(
            &store,
            &HashMap::from([(key.to_string(), value.to_string())]),
            &terminal_id,
            &session.store_id,
        ) {
            tracing::warn!(key = %key, error = %e, "failed to enqueue settings.update sync item");
        }
    } // conn dropped — safe to .await below

    // Publish SettingsUpdated event for cross-terminal reactivity (ADR #22).
    let kernel = ctx.kernel.lock().await;
    let bus = kernel.event_bus();
    let event = oz_core::events::SettingsUpdated {
        changed_keys: vec![key.to_string()],
        terminal_id,
    };
    if let Err(e) = bus.publish(&event) {
        tracing::warn!(key = %key, error = %e, "failed to publish SettingsUpdated event");
    }

    Ok(())
}

/// Write (or overwrite) multiple settings in a single transaction, resolved from a session token. ADR #7.
///
/// All entries are written atomically — either all succeed or none
/// do. A single `SettingsUpdated` event is published with all changed
/// keys after the transaction commits.
pub async fn set_settings_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    entries: HashMap<String, String>,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;

    // Managed keys are rejected batch-wide before any write so the
    // all-or-nothing transaction semantics hold (same guard as
    // `run_set_setting`; the batch loop below bypasses it by design).
    if let Some(key) = entries.keys().find(|k| is_managed_key(k)) {
        let owner = managed_key_owner(key).unwrap_or("a dedicated");
        return Err(BridgeError::Invalid(format!(
            "{key} is managed by the {owner} controls — use those"
        )));
    }

    let terminal_id = ctx
        .terminal_id
        .lock()
        .await
        .clone()
        .unwrap_or_else(|| "unknown".to_string());

    let keys: Vec<String> = entries.keys().cloned().collect();

    {
        let conn = ctx
            .db_manager
            .open_store(&session.store_id)
            .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        let store = oz_core::db::Store::new(&db);
        ctx.require_permission_for_user(&store, &session.user_id, permissions::SETTINGS_EDIT)?;
        let tx = db.unchecked_transaction()?;
        for (key, value) in &entries {
            Settings::set_tracked(&tx, key, value, &terminal_id)?;
        }
        tx.commit()?;
    }

    // Enqueue `settings.update` sync items on the GLOBAL db — the sync
    // daemon only watches the global queue, so a store-scoped write must
    // fan out from here (SYNC-10 enqueue side).
    {
        let conn = ctx.db.lock().await;
        let store = oz_core::db::Store::new(&conn);
        if let Err(e) = enqueue_settings_updates(&store, &entries, &terminal_id, &session.store_id)
        {
            tracing::warn!(key_count = entries.len(), error = %e, "failed to enqueue settings.update sync items");
        }
    } // conn dropped — safe to .await below

    // Publish a single SettingsUpdated event for all changed keys.
    let kernel = ctx.kernel.lock().await;
    let bus = kernel.event_bus();
    let event = oz_core::events::SettingsUpdated {
        changed_keys: keys,
        terminal_id,
    };
    if let Err(e) = bus.publish(&event) {
        tracing::warn!(
            key_count = entries.len(),
            error = %e,
            "failed to publish SettingsUpdated event"
        );
    }

    Ok(())
}

#[cfg(test)]
#[path = "settings_tests.rs"]
mod settings_tests;
