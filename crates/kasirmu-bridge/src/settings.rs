//! Settings command bodies: the shared key guards, the setting DTOs, and the read side.
//!
//! Extracted from the desktop shell (apps/desktop-tauri/src/commands/settings.rs) as
//! Wave E slice E1a. Nothing here names a tauri type: each shell shim borrows a
//! BridgeCtx, calls the matching function and maps BridgeError back onto AppError
//! variant-for-variant, so the wire shape stays byte-identical. The writer half (the
//! set_* commands, set_hardware_settings_scoped and the secret-key mutators) and the
//! shim conversion of the readers both land in E1b; the shared surface is hoisted
//! whole so that move is a pure command-body port.
//!
//! The session-gated doors run the SCOPE-AWARE
//! BridgeCtx::require_session_permission - readers on settings:read (except
//! list_credit_sales_scoped, which keeps sales:view exactly as the shell has it), and
//! since 2026-09-25 the WRITERS too, on settings:edit (R10's gate-KIND half: they used
//! the non-scope-aware require_permission_for_user over a store db that only
//! `open_store` could supply, so the gate ran after filesystem work and ignored the
//! caller's branch/workspace assignment). The one remaining unscoped call is the
//! DEPRECATED `set_setting`, which takes a caller-supplied `user_id` and a global-db
//! `Store` and has no session to scope against - retiring it is a separate decision, not
//! a gate migration.
//!
//! Two doors carry no gate at all, and that is deliberate, not an omission:
//!  * get_user_preferences_scoped only resolves the session (the shell never gated it);
//!  * the six global-DB readers (get_receipt_settings, get_store_settings,
//!    get_credit_settings, get_hardware_settings, get_setting, gateway_status) carry no
//!    gate at all. No gate is invented here.
//!
//! set_user_preferences_scoped is in the same position — it resolves a session and writes
//! through the store db WITHOUT a gate. Same class of open question as the reader above,
//! and deliberately not folded into R10's sweep, which is about the FORM of existing gates
//! rather than about inventing new ones.
//!
//! get_hardware_settings and get_hardware_settings_scoped take the profile directory
//! as base_dir: BridgeCtx carries the app CACHE dir, which is a different directory
//! from the db_path parent the shell derives, so the shim threads it in rather than
//! having the bridge re-derive it.

use std::collections::HashMap;
use std::path::Path;

use kasirmu_core::permissions;
use kasirmu_core::{Settings, UserPreferences};
// `settings_tests.rs` reaches these through `use super::*` to pin the
// SMTP-secret exemption, the ingest policy, the tracked-write type and the
// `Store` façade directly; the library build gets them via `settings::core`
// instead, so unconditional imports here would be unused in the lib build.
#[cfg(test)]
use kasirmu_core::Store;
#[cfg(test)]
use kasirmu_core::export::email_report::SMTP_CONFIG_SETTINGS_KEY;
#[cfg(test)]
use kasirmu_core::settings::{IngestPolicy, IngestPolicyKind};
#[cfg(test)]
use platform_core::settings::Settings as TrackedSettings;
use platform_core::settings::is_manager_owned_key;
use platform_core::settings::keys::{LAN_SERVER_PSK, LOCAL_API_SECRET, normalised_candidate};
use platform_core::terminal_profile::TerminalProfile;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// The credential deny list — the ONE shared source of truth, owned by
/// `platform_core::settings::keys` and re-exported here so the desktop lane
/// keeps its historical `kasirmu_bridge::settings::SECRET_KEY_DENY_LIST` path.
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

/// Which dedicated lifecycle manager owns a key, if any — the LABEL only.
///
/// Whether a key is manager-owned is not decided here. It is answered by the
/// one shared predicate, [`platform_core::settings::is_manager_owned_key`] — the
/// same call the tablet write funnel refuses at
/// (`apps/mobile-tauri/src/commands/settings.rs`) and the same one the sealed
/// ingest policy admits against (`IngestPolicy::PortablePackage`,
/// `IngestPolicy::RemoteSync`). This lane used to carry its own `starts_with`
/// pair: two definitions of one ownership rule, and the drift hazard is
/// silent — the day a third prefix joins the shared predicate, the tablet and
/// the ingest lane refuse it while this funnel keeps accepting it, and nothing
/// fails.
///
/// What stays local is the label, because the shared predicate answers a
/// boolean while the refusal message names the owner the UI shows. Even that
/// takes its prefixes FROM the platform-core key constants rather than from a
/// retyped list, so this crate holds no manager-owned prefix of its own. A key
/// the predicate claims under a prefix this lane cannot name still refuses,
/// with a generic label — the fallback errs towards refusing, never towards
/// accepting.
///
/// The lookup folds its candidate through the same shared fold the gate uses
/// (`keys::normalised_candidate`, `pub` for exactly this), so a refused key
/// carries the name of the manager that owns it however the caller spelled it:
/// `LAN_SERVER.BIND` and `" lan_server.bind "` both label as LAN server, which
/// is how the guard already refuses them. Until that fold was routed here this
/// was the third half-folded comparison in the settings family — the guard said
/// manager-owned, the label said `dedicated`.
pub fn managed_key_owner(key: &str) -> Option<&'static str> {
    if !is_manager_owned_key(key) {
        return None;
    }
    // The guard above folds; a raw comparison here would answer the same key
    // two ways. Fold the SAME candidate, AFTER the guard, so this can only ever
    // re-label a key the shared rule already claims — never claim a new one.
    let candidate = normalised_candidate(key);
    if candidate.starts_with(family_prefix(LOCAL_API_SECRET)) {
        Some("Local API")
    } else if candidate.starts_with(family_prefix(LAN_SERVER_PSK)) {
        Some("LAN server")
    } else {
        Some("dedicated")
    }
}

/// The dotted-family prefix of a settings key: `local_api.secret` → `local_api.`.
///
/// Lets [`managed_key_owner`] build its labels from the shared key constants
/// instead of from a second list of manager-owned prefixes.
fn family_prefix(key: &str) -> &str {
    match key.find('.') {
        Some(dot) => &key[..=dot],
        None => key,
    }
}

/// All receipt display options in one shot - the UI loads these on
pub mod dto;
pub use dto::{
    CreditSaleDto, CreditSettingsDto, DeploymentInfo, GatewayStatusEntry, HardwareSettingsDto,
    ReceiptSettingsDto, StoreSettingsDto, UserPrefEntry,
};

/// Build the deployment-info payload. Split out so tests exercise the exact
/// production path without standing up a session.
pub fn build_deployment_info() -> DeploymentInfo {
    DeploymentInfo {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

pub mod core;
pub use core::{
    enqueue_settings_updates, run_get_receipt_settings, run_get_setting, run_get_store_settings,
    run_list_credit_sales, run_set_setting, run_set_settings_batch,
};
// The sync-egress gate is private to `settings::core`, but `settings_tests.rs`
// reaches it through `use super::*` to pin the policy directly. Gated to the
// test build so the library keeps it internal.
#[cfg(test)]
use core::remote_sync_admits;

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
/// Read order (the `hardware_profiles` DB row is the authoritative store):
/// 1. DB (hardware_profiles table) - canonical store.
/// 2. JSON file (`terminal_profiles/<id>.json`) - **one-time seed only**: read
///    ONLY when no `hardware_profiles` row exists for this terminal id, and the
///    row it seeds then wins on every later read.
/// 3. Old SQLite settings - legacy seed, reached only under the same
///    no-row condition as (2).
///
/// Once a terminal has a DB row, steps (2) and (3) are unreachable for it, so a
/// process that can write the profile directory can no longer change the
/// resolved profile behind the database's back. If the row is present but its
/// JSON is unreadable, this returns defaults rather than the file, so the row
/// stays authoritative in that case too.
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

    // 1. Try DB first — the row is the authoritative store.
    //
    // A present row ends the read, whether or not its JSON parses: returning
    // defaults on a parse failure keeps the row authoritative instead of
    // silently resurrecting a JSON or legacy value the row was meant to
    // supersede. The previous code returned here only on a successful parse and
    // fell through to the file otherwise.
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
            return match serde_json::from_str::<TerminalProfile>(&json) {
                Ok(profile) => Ok(HardwareSettingsDto::from(profile)),
                Err(e) => {
                    tracing::warn!(
                        terminal_id = %terminal_id,
                        error = %e,
                        "hardware profile row exists but its JSON is unreadable — using defaults, \
                         not the JSON file (the row is authoritative)"
                    );
                    Ok(HardwareSettingsDto::from(TerminalProfile::default()))
                }
            };
        }
    } // conn dropped

    let path = TerminalProfile::profile_path(base_dir, &terminal_id);

    // 2. No row yet: seed one from the JSON file, once. From the next read on,
    //    step (1) short-circuits before reaching here.
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
    // Absent means "leave the stored value alone" — see
    // `ReceiptSettingsDto::tax_rounding_mode`. A value that IS present still
    // goes through the validating setter, so an unknown mode is refused rather
    // than written.
    if let Some(mode) = &args.tax_rounding_mode {
        Settings::set_tax_rounding_mode_str(&tx, mode)?;
    }

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
    // R10 gate-KIND + gate-ORDER (2026-09-25): scope-aware gate BEFORE the store is
    // opened, matching this module's own readers. The unscoped form checked the
    // permission but not the caller's branch/workspace assignment, and it could only run
    // after `open_store` — which is not free (it creates the directory, the db file and
    // runs migrations), so an out-of-scope caller got filesystem work and an
    // `Internal("opening store db")` instead of `PermissionDenied`.
    ctx.require_session_permission(&session, permissions::SETTINGS_EDIT)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    run_set_receipt_settings(&db, &args)
}

/// Set store settings resolved from a session token. ADR #7.
pub async fn set_store_settings_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: StoreSettingsDto,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    // R10 gate-KIND + gate-ORDER (2026-09-25), as in `set_receipt_settings_scoped`:
    // scope-aware, and before `open_store` so an out-of-scope caller cannot make the
    // store do filesystem work on its way to being refused.
    ctx.require_session_permission(&session, permissions::SETTINGS_EDIT)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    run_set_store_settings(&db, &args)
}

/// Set credit settings resolved from a session token. ADR #7.
pub async fn set_credit_settings_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: CreditSettingsDto,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    // R10 gate-KIND + gate-ORDER (2026-09-25): scope-aware, before `open_store`.
    ctx.require_session_permission(&session, permissions::SETTINGS_EDIT)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
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
    // R10 gate-KIND + gate-ORDER (2026-09-25): scope-aware, before `open_store`.
    ctx.require_session_permission(&session, permissions::SETTINGS_EDIT)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
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

    // R10 gate-KIND + gate-ORDER (2026-09-25): the scope-aware gate authorizes against
    // the GLOBAL identity db, so it needs no store connection at all — the temporary
    // store open that used to exist only to run the unscoped check is gone with it. The
    // `hardware_profiles` write below still uses the global db, which is where that table
    // lives.
    ctx.require_session_permission(&session, permissions::SETTINGS_EDIT)
        .await?;

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
        let store = kasirmu_core::db::Store::new(&conn);
        ctx.require_permission_for_user(&store, user_id, permissions::SETTINGS_EDIT)?;
        let effective = run_set_setting(&conn, key, value, &terminal_id)?;
        if let Err(e) = enqueue_settings_updates(
            &store,
            &HashMap::from([(key.to_string(), effective)]),
            &terminal_id,
            "default",
        ) {
            tracing::warn!(key = %key, error = %e, "failed to enqueue settings.update sync item");
        }
    } // conn, store dropped here

    // Publish SettingsUpdated event for cross-terminal reactivity (ADR #22).
    let kernel = ctx.kernel.lock().await;
    let bus = kernel.event_bus();
    let event = kasirmu_core::events::SettingsUpdated {
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
    // R10 gate-KIND + gate-ORDER (2026-09-25): scope-aware, and before the store is
    // opened. This door used to check `require_permission_for_user` over the store db,
    // which ignores the caller's branch/workspace assignment and could only run after
    // `open_store` had already done filesystem work.
    ctx.require_session_permission(&session, permissions::SETTINGS_EDIT)
        .await?;

    // Extract terminal_id before locking the store DB to avoid
    // holding a non-Send MutexGuard across an .await point.
    let terminal_id = ctx
        .terminal_id
        .lock()
        .await
        .clone()
        .unwrap_or_else(|| "unknown".to_string());

    // Scope block: all sync guards (MutexGuard, Store) must be
    // dropped before any .await below. The block YIELDS the value as written,
    // so the enqueue below can never be handed the request as posted.
    let effective = {
        let conn = ctx
            .db_manager
            .open_store(&session.store_id)
            .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        run_set_setting(&db, key, value, &terminal_id)?
    }; // db, store, conn dropped here — safe to .await below

    // Enqueue `settings.update` sync items on the GLOBAL db — the sync
    // daemon only watches the global queue, so a store-scoped write must
    // fan out from here (SYNC-10 enqueue side).
    {
        let conn = ctx.db.lock().await;
        let store = kasirmu_core::db::Store::new(&conn);
        if let Err(e) = enqueue_settings_updates(
            &store,
            &HashMap::from([(key.to_string(), effective)]),
            &terminal_id,
            &session.store_id,
        ) {
            tracing::warn!(key = %key, error = %e, "failed to enqueue settings.update sync item");
        }
    } // conn dropped — safe to .await below

    // Publish SettingsUpdated event for cross-terminal reactivity (ADR #22).
    let kernel = ctx.kernel.lock().await;
    let bus = kernel.event_bus();
    let event = kasirmu_core::events::SettingsUpdated {
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
    // R10 gate-KIND + gate-ORDER (2026-09-25), as in `set_setting_scoped`: scope-aware,
    // and before `open_store`.
    ctx.require_session_permission(&session, permissions::SETTINGS_EDIT)
        .await?;

    let terminal_id = ctx
        .terminal_id
        .lock()
        .await
        .clone()
        .unwrap_or_else(|| "unknown".to_string());

    let keys: Vec<String> = entries.keys().cloned().collect();

    // Scope block: the store guards must be dropped before the .await below.
    // It YIELDS the map of values as written — the batch funnel merges
    // `smtp_config` internally, so this (not `entries`) is what replication
    // is offered. SYNC-10.
    let written = {
        let conn = ctx
            .db_manager
            .open_store(&session.store_id)
            .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        let tx = db.unchecked_transaction()?;
        let written = run_set_settings_batch(&tx, &entries, &terminal_id)?;
        tx.commit()?;
        written
    };

    // Enqueue `settings.update` sync items on the GLOBAL db — the sync
    // daemon only watches the global queue, so a store-scoped write must
    // fan out from here (SYNC-10 enqueue side).
    {
        let conn = ctx.db.lock().await;
        let store = kasirmu_core::db::Store::new(&conn);
        if let Err(e) = enqueue_settings_updates(&store, &written, &terminal_id, &session.store_id)
        {
            tracing::warn!(key_count = written.len(), error = %e, "failed to enqueue settings.update sync items");
        }
    } // conn dropped — safe to .await below

    // Publish a single SettingsUpdated event for all changed keys.
    let kernel = ctx.kernel.lock().await;
    let bus = kernel.event_bus();
    let event = kasirmu_core::events::SettingsUpdated {
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
