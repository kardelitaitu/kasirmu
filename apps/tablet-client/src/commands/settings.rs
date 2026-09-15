//! Settings Tauri commands: get and persist receipt display options.
/*
last audited 25-07-26 by RSA-Agent (tablet-client UI-1 investigation + fix)
crate: tablet-client | status: SAFE | lint: CLEAN
findings: UI-1 FIXED 25-07-26 — SECRET_KEY_DENY_LIST extended with stripe.api_key, square.api_key, midtrans.server_key (payment credentials never reach the renderer); new gateway_status command computes configured/online booleans server-side; deny-list test extended with the three keys. Verified during UI-1: deny-list check on run_get_setting. sync.auth_token: the cross-screen readability tests were inverted by b2196d701 — they now assert the read is refused while the written row persists, and that both untrusted ingest policies (RemoteSync, PortablePackage) refuse to carry it; no readability test is retained
next: none | perf: N/A
*/
//!
//! This module exposes the receipt-related subset of the `settings` table
//! to the front-end. Other settings (store name, currency, features) are
//! managed by the setup wizard and may be exposed here in the future.

use serde::{Deserialize, Serialize};
use tauri::State;
use tauri::command;

use std::collections::HashMap;

use oz_core::export::email_report::SMTP_CONFIG_SETTINGS_KEY;
use oz_core::permissions;
use oz_core::settings::{IngestPolicy, IngestPolicyKind};
use oz_core::{Settings, Store, UserPreferences};

use crate::commands::authz::{require_permission_for_session, require_permission_for_user};
use crate::error::AppError;
use crate::state::AppState;

/// Phase 3.3 T4: these settings wire types are re-exported from
/// `oz_bridge::settings` — the same move T3 made for `LocalPaymentRailArgs`
/// and the regional DTOs — so a field rename or a `rename_all` edit lands once
/// instead of having to be made twice and noticed a third time. Until this
/// slice each was a byte-identical second definition in this file, and the
/// renderer's TypeScript interface was the only place the three copies agreed.
///
/// `HardwareSettingsDto` is deliberately NOT on the list, and that is a defect
/// being reported rather than a shortcut being taken: the bridge type carries
/// fifteen keys (scale connection / path / baud / zero-on-boot / auto-zero,
/// kitchen printer connection / path, sound volume, dark mode, schema version)
/// while this shell's type — and both of its command bodies — carry five. A
/// re-export here would let `set_hardware_settings[_scoped]` ACCEPT ten keys
/// it then never writes, converting a visible absence into a silent drop. The
/// two shells also read different stores for the same screen (this one reads
/// the `settings` KV table through `Settings::get_printer_*`; the bridge reads
/// `hardware_profiles` through `TerminalProfile` and needs `base_dir`), so the
/// repair is a storage-source decision plus the `AppState` → `BridgeCtx` seam
/// T2 deferred — not a `pub use`. Measured and recorded in the 2026-09-15 T4
/// entry of `todo-refactor-oz-pos-app-agents-3.md`.
pub use oz_bridge::settings::{
    CreditSaleDto, CreditSettingsDto, DeploymentInfo, GatewayStatusEntry, ReceiptSettingsDto,
    StoreSettingsDto, UserPrefEntry,
};

// ── Receipt settings DTO ─────────────────────────────────
//
// `ReceiptSettingsDto` comes from `oz_bridge::settings` (see the re-export
// above); the eleven camelCase keys it carries are pinned against
// `ui/src/api/settings.ts` by
// `wire_pin_receipt_settings_carries_every_key_the_renderer_declares`.
// `taxRoundingMode` is the one key of the eleven that is optional on the wire:
// absent means "leave the stored mode alone", because the restaurant POS card
// sends ten of the eleven (T4-2 in `todo-refactor-oz-pos-app-agents-3.md`).

// ── Get receipt settings ──────────────────────────────────

#[command]
/// Get receipt settings.
///
/// ADR #49: the body is the bridge's, and this delegation is a pure identity
/// rather than a merge. `oz_bridge::settings::get_receipt_settings` locks
/// `ctx.db` — which `AppState::bridge_ctx` binds to this same `state.db` — and
/// calls the same `run_get_receipt_settings` in the same order, and the bridge
/// documents its twin as "gate-free exactly as in the shell". So delegating adds
/// no gate and removes none. `run_get_receipt_settings` stays below as this
/// suite's seam, because 25 of this file's 50 tests drive the `run_*` helpers
/// rather than the doors (measured 2026-09-16, not carried over).
pub async fn get_receipt_settings(
    state: State<'_, AppState>,
) -> Result<ReceiptSettingsDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::settings::get_receipt_settings(&ctx)
        .await
        .map_err(Into::into)
}

/// Business logic for `get_receipt_settings` (extracted for testing). The body
/// is the bridge's; what is tablet-specific is the error type, converted by the
/// `From<BridgeError> for AppError` seam in `authz.rs` that landed with T1.
fn run_get_receipt_settings(conn: &rusqlite::Connection) -> Result<ReceiptSettingsDto, AppError> {
    Ok(oz_bridge::settings::run_get_receipt_settings(conn)?)
}

// ── Set receipt settings ──────────────────────────────────

/// Business logic behind `set_receipt_settings_scoped` (extracted for testing). Body is
/// the bridge's; see `run_get_receipt_settings` for why a forwarder stays.
fn run_set_receipt_settings(
    conn: &rusqlite::Connection,
    args: &ReceiptSettingsDto,
) -> Result<(), AppError> {
    Ok(oz_bridge::settings::run_set_receipt_settings(conn, args)?)
}

// ── Store info DTO ────────────────────────────────────────────
//
// `StoreSettingsDto` comes from `oz_bridge::settings`; its six camelCase keys
// are pinned by `wire_pin_store_settings_carries_every_key_the_renderer_declares`.

// ── Get store settings ────────────────────────────────────────

#[command]
/// Get store settings.
///
/// ADR #49: the body is the bridge's, and as with `get_receipt_settings` the
/// delegation is a pure identity — same `ctx.db` (bound to this `state.db`),
/// same `run_get_store_settings`, same order, and the bridge's twin is
/// documented "gate-free exactly as in the shell".
pub async fn get_store_settings(state: State<'_, AppState>) -> Result<StoreSettingsDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::settings::get_store_settings(&ctx)
        .await
        .map_err(Into::into)
}

/// Business logic for `get_store_settings` (extracted for testing).
fn run_get_store_settings(conn: &rusqlite::Connection) -> Result<StoreSettingsDto, AppError> {
    Ok(oz_bridge::settings::run_get_store_settings(conn)?)
}

// ── Set store settings ────────────────────────────────────────

/// Business logic behind `set_store_settings_scoped` (extracted for testing).
fn run_set_store_settings(
    conn: &rusqlite::Connection,
    args: &StoreSettingsDto,
) -> Result<(), AppError> {
    Ok(oz_bridge::settings::run_set_store_settings(conn, args)?)
}

// ── Credit Settings DTO ─────────────────────────────────────────
//
// `CreditSettingsDto` comes from `oz_bridge::settings`.

#[command]
/// Get credit settings.
///
/// ADR #49: the body is the bridge's. Its twin
/// `oz_bridge::settings::get_credit_settings` is documented there as
/// "gate-free exactly as in the shell", so delegating adds no gate and removes
/// none — what stood here was a byte-identical second copy of that body.
pub async fn get_credit_settings(
    state: State<'_, AppState>,
) -> Result<CreditSettingsDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::settings::get_credit_settings(&ctx)
        .await
        .map_err(Into::into)
}

// ── Credit sale DTO ──────────────────────────────────────────────
//
// `CreditSaleDto` comes from `oz_bridge::settings`. Its wire keys are camelCase
// as of the 2026-09-15 T4 repair, because the retail credit list reads
// `saleId`/`customerName`/`totalMinor`/`createdAt`/`settledAt`; the pin lives in
// `settings_tests.rs::wire_pin_credit_sale_carries_every_key_the_renderer_declares`.

// ── Hardware settings (printer + scanner) ───────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Hardwaresettingsdto.
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
}

#[command]
/// Get hardware settings.
pub async fn get_hardware_settings(
    state: State<'_, AppState>,
) -> Result<HardwareSettingsDto, AppError> {
    let conn = state.db.lock().await;
    Ok(HardwareSettingsDto {
        printer_connection: Settings::get_printer_connection(&conn)?,
        printer_device_path: Settings::get_printer_device_path(&conn)?,
        printer_paper_size: Settings::get_printer_paper_size(&conn)?,
        scanner_device_id: Settings::get_scanner_device_id(&conn)?,
        scanner_input_mode: Settings::get_scanner_input_mode(&conn)?,
    })
}

#[command]
/// Set hardware settings.
pub async fn set_hardware_settings(
    args: HardwareSettingsDto,
    user_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let conn = state.db.lock().await;
    let store = oz_core::db::Store::new(&conn);
    require_permission_for_user(&store, &user_id, permissions::SETTINGS_EDIT)?;
    let tx = conn.unchecked_transaction()?;
    Settings::set_printer_connection(&tx, &args.printer_connection)?;
    Settings::set_printer_device_path(&tx, &args.printer_device_path)?;
    Settings::set_printer_paper_size(&tx, &args.printer_paper_size)?;
    Settings::set_scanner_device_id(&tx, &args.scanner_device_id)?;
    Settings::set_scanner_input_mode(&tx, &args.scanner_input_mode)?;
    tx.commit()?;
    Ok(())
}

// ── User preferences ───────────────────────────────────────────
//
// `UserPrefEntry` comes from `oz_bridge::settings` (two single-word keys; the
// pin is `wire_pin_user_pref_entry_carries_every_key_the_renderer_declares`).
//
// The unscoped `get_user_preferences` / `set_user_preferences` pair used to sit
// here. It was **dead surface**: registered in neither shell's
// `generate_handler!` block, absent from the desktop crate altogether, and
// called by nothing in the tree — only the dev-mock and the UI's test mocks
// answered those names, which is what made them read as live. Both also took a
// caller-supplied `user_id`, the forgeable shape the six scoped setters above
// dropped the same day (T4-1), so *registering* them would have re-opened it.
// Deleted under T4-4 of `todo-refactor-oz-pos-app-agents-3.md`; the scoped twins
// below derive the user from the session and are what both shells register.

#[command]
/// Get user preferences resolved from a session token. ADR #7.
///
/// Uses `session.user_id` for the preference lookup against the
/// session's store database, so a tablet terminal persists the same
/// per-user preferences (menu sort, card/font size) that the desktop
/// client writes.
///
/// ADR #49 NOT APPLIED, deliberately. The body is still the shell's, even
/// though `oz_bridge::settings::get_user_preferences_scoped` is byte-identical
/// to it. Delegating would make this shell's registration-gate sweep read the
/// `oz_bridge::` call as evidence that the shared funnel owns the RBAC — and
/// for this pair it does not: the bridge twin is ungated beyond the session,
/// by design, because a caller's own UI preferences need no `settings:read`.
/// So the delegation would flip `settings::get_user_preferences_scoped` from
/// "ungated debt on the ledger" to "gated" without a permission being added,
/// i.e. it would erase a real entry from the ratchet — the same mechanism
/// `list_credit_sales` above refuses. §4 of the ADR forbids exactly this:
/// an extraction must not widen a gate. Measured: delegating this pair turned
/// `registration_gate_tests::drift_pin_three_way_partition_is_complete_and_sums`
/// red with "on the ledger but no longer ungated: settings::get_user_preferences_scoped,
/// settings::set_user_preferences_scoped".
pub async fn get_user_preferences_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<HashMap<String, String>, AppError> {
    let session = state.resolve_session(&session_token)?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    Ok(UserPreferences::get_all(&db, &session.user_id)?)
}

#[command]
/// Set user preferences resolved from a session token. ADR #7.
///
/// Uses `session.user_id` for the preference write against the
/// session's store database — parity with the desktop client so
/// the restaurant-menu hamburger configuration persists to the
/// shared user settings on tablet terminals.
///
/// ADR #49 NOT APPLIED — see the getter above for the measurement. The pair
/// moves together or not at all.
pub async fn set_user_preferences_scoped(
    session_token: String,
    prefs: Vec<UserPrefEntry>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let session = state.resolve_session(&session_token)?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let pairs: Vec<(String, String)> = prefs.into_iter().map(|e| (e.key, e.value)).collect();
    Ok(UserPreferences::set_batch(&db, &session.user_id, &pairs)?)
}

// ── Generic key-value settings ────────────────────────────────

/// Read a single setting value by key.
///
/// Returns `None` when the key does not exist.
#[command]
pub async fn get_setting(
    key: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::settings::get_setting(&ctx, &key)
        .await
        .map_err(Into::into)
}

/// Business logic for `get_setting`, kept as this suite's seam.
///
/// ADR #49: the body is the bridge's. What stood here was not a forwarder but
/// a second copy of the body — the secret-key refusal plus `Settings::get` —
/// and the local `is_secret_key` wrapper that fed it goes with it, because
/// `platform_core::settings::keys` is the one list both shells read.
fn run_get_setting(conn: &rusqlite::Connection, key: &str) -> Result<Option<String>, AppError> {
    Ok(oz_bridge::settings::run_get_setting(conn, key)?)
}

// The hand copy of SECRET_KEY_DENY_LIST that used to sit here is deleted. The
// tablet and the desktop lane now answer from the SAME list, owned by
// platform_core::settings::keys and built there from the key constants.
// The private copy had drifted exactly the way an unenforced duplicate
// drifts: it spelled the terminal secret "sync.terminal_secret" while the
// stored key is "sync_terminal_secret", and it omitted "local_api.secret"
// entirely - so both credentials were readable through this shell's
// get_setting while the tests that named them stayed green.

// `GatewayStatusEntry` is re-exported from `oz_bridge::settings`. The three
// emitted keys are the whole contract, and they are pinned in
// `settings_tests.rs` because a fourth key here would put a credential on the
// wire that UI-1 exists to keep off it.

/// Report which payment gateways have credentials configured.
///
/// UI-1: computes the configured/online booleans server-side so the raw
/// credential values never leave the backend — the gateway keys are on the
/// shared `SECRET_KEY_DENY_LIST` (platform_core::settings::keys), and the
/// renderer only ever sees booleans.
///
/// ADR #49: the body is the bridge's. This one was byte-identical to
/// `oz_bridge::settings::gateway_status` — same closure, same three entries,
/// same order — so the credential contract does not move with it.
#[tauri::command]
pub async fn gateway_status(
    state: State<'_, AppState>,
) -> Result<Vec<GatewayStatusEntry>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::settings::gateway_status(&ctx)
        .await
        .map_err(Into::into)
}

/// Write (or overwrite) a single setting value.
///
/// Pass an empty string to store an empty value.
#[command]
pub async fn set_setting(
    key: String,
    value: String,
    user_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    // Extract terminal_id before locking the DB — no await inside the lock.
    let terminal_id = state
        .terminal_id
        .lock()
        .await
        .clone()
        .unwrap_or_else(|| "unknown".to_string());

    let conn = state.db.lock().await;
    let store = oz_core::db::Store::new(&conn);
    require_permission_for_user(&store, &user_id, permissions::SETTINGS_EDIT)?;
    run_set_setting(&conn, &key, &value, &terminal_id)?;
    // SYNC-10 parity: enqueue the change so the tablet's sync daemon
    // pushes it to the cloud (and the desktop's pull re-applies it).
    // Warn-and-continue — the local write already committed.
    if let Err(e) = enqueue_settings_update(&store, &key, &value, &terminal_id) {
        tracing::warn!(key = %key, error = %e, "failed to enqueue settings.update sync item");
    }
    Ok(())
}

/// Business logic for `set_setting` (extracted for testing).
/// Uses `set_tracked` so every settings change writes a delta record
/// (ADR #22) — the basis for version-LWW when the change syncs.
///
/// Twin of `oz_bridge::settings::run_set_setting`: this shell has its own
/// write funnel, not the bridge's, so the `smtp_config` exception has to be
/// made here too or the same save destroys the stored password on tablet.
/// `smtp_config` is deny-listed against [`run_get_setting`], so the
/// email-report card cannot read the stored password back and posts a blob
/// whose `password` is null; the key's owner answers what should land and
/// the write still goes through the tracked path so the delta is recorded.
///
/// The credential pre-flight has to be made here for the same twin reason.
/// Without it the write is STILL refused — `Settings::set_tracked` asks the
/// rule itself before it opens its transaction (`refuse_cleartext_credential`
/// at the head of `set_tracked` in `platform/core/src/settings/raw.rs`, and
/// again per row in `set_tracked_in_tx`) — but it refuses with
/// `PlatformError::Internal`, which crosses this shell as
/// `AppError::Core { sub_kind: Platform }`: the operator is told the shell
/// broke, while the desktop, which pre-flights, says "invalid request". This
/// door now raises `AppError::Invalid` carrying platform-core's own sentence,
/// so one key and one refusal produce one error class on both shells. The
/// per-row refusal stays as the floor under this ask, not its substitute.
fn run_set_setting(
    conn: &rusqlite::Connection,
    key: &str,
    value: &str,
    terminal_id: &str,
) -> Result<(), AppError> {
    // The rule AND the wording belong to the producer in platform-core, exactly
    // like the credential door under it: `manager_owned_key_refusal` answers
    // `None` for a key nobody owns and the refusal for one somebody does. No
    // tablet-side prefix list, so the shells cannot drift on what the prefixes
    // mean; and no tablet-side sentence, so they cannot drift on the refusal
    // either. This lane has no manager-name lookup (no manager surface on the
    // tablet), so it passes `None` and takes the generic label. Both lanes
    // calling one producer is what the parity sweep under this function holds
    // the lanes to: restating the sentence in this file is the failure IT
    // reports, and the failure it cannot see — a word leaving the producer — is
    // what `tablet_manager_refusal_sentence_drift_pin` exists to report.
    if let Some(refusal) = platform_core::settings::Settings::manager_owned_key_refusal(key, None) {
        return Err(AppError::Invalid(refusal));
    }
    // The credential door under it works the same way: the producer answers with
    // the rule and this lane only chooses the variant. The message names the key
    // and never the value — a value in an error string is a leak through the log
    // lane.
    if let Some(refusal) = platform_core::settings::Settings::cleartext_credential_refusal(key) {
        return Err(AppError::Invalid(refusal));
    }
    let merged;
    let value = if key == SMTP_CONFIG_SETTINGS_KEY {
        merged = Store::new(conn).merged_smtp_password_json(value)?;
        &merged
    } else {
        value
    };
    Ok(Settings::set_tracked(conn, key, value, terminal_id)?)
}

/// Enqueue a `settings.update` sync item for a tablet settings save,
/// scoped to the "default" tenant on the global queue (SYNC-10).
/// Supersede semantics live in oz-core's
/// [`Store::enqueue_settings_update_superseding`].
fn enqueue_settings_update(
    store: &Store,
    key: &str,
    value: &str,
    terminal_id: &str,
) -> Result<(), AppError> {
    // Egress gate — symmetric with the bridge funnel (`oz_bridge::settings`):
    // a key the ingest side would refuse must not be OFFERED to the network
    // either. Both tablet call sites (global and scoped set_setting) funnel
    // through THIS function, so this is the one boundary to keep in sync.
    // Warn-and-skip, never an error: the local write already committed, and
    // the warn names the key and the policy, never the value.
    if !IngestPolicy::RemoteSync.admits(key) {
        tracing::warn!(
            key = %key,
            policy = IngestPolicy::RemoteSync.label(),
            "settings key refused by sync egress policy (not enqueued)"
        );
        return Ok(());
    }
    Ok(store.enqueue_settings_update_superseding(key, value, terminal_id, "default")?)
}

/// Session-scoped variant of `get_receipt_settings`.
#[command]
pub async fn get_receipt_settings_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<ReceiptSettingsDto, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    // F-017/T10: the `oz_bridge::settings` twin gates this command and this shell
    // resolved the session, bound it to a store, then ignored it. Gated here before
    // the store lock is taken, so no await sits inside a held lock.
    require_permission_for_session(&state, &session, permissions::SETTINGS_READ).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    run_get_receipt_settings(&db_guard)
}

/// Session-scoped variant of `set_receipt_settings`.
#[command]
pub async fn set_receipt_settings_scoped(
    session_token: String,
    args: ReceiptSettingsDto,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    // The session names the user; the caller cannot. `require_permission_for_session`
    // is also scope-aware (ADR #35 D5), so this is strictly stronger than the
    // `user_id` argument it replaces — and that argument was unfillable from the
    // renderer, which sends only `{ sessionToken, args }`.
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    run_set_receipt_settings(&db_guard, &args)
}

/// Session-scoped variant of `get_store_settings`.
#[command]
pub async fn get_store_settings_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<StoreSettingsDto, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    // F-017/T10: the `oz_bridge::settings` twin gates this command and this shell
    // resolved the session, bound it to a store, then ignored it. Gated here before
    // the store lock is taken, so no await sits inside a held lock.
    require_permission_for_session(&state, &session, permissions::SETTINGS_READ).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    run_get_store_settings(&db_guard)
}

/// Session-scoped variant of `set_store_settings`.
#[command]
pub async fn set_store_settings_scoped(
    session_token: String,
    args: StoreSettingsDto,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    run_set_store_settings(&db_guard, &args)
}

/// Session-scoped variant of `get_credit_settings`.
#[command]
pub async fn get_credit_settings_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<CreditSettingsDto, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    // F-017/T10: the `oz_bridge::settings` twin gates this command and this shell
    // resolved the session, bound it to a store, then ignored it. Gated here before
    // the store lock is taken, so no await sits inside a held lock.
    require_permission_for_session(&state, &session, permissions::SETTINGS_READ).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    Ok(CreditSettingsDto {
        enabled: Settings::is_credit_enabled(&db_guard)?,
        reminder_interval_hours: Settings::get_credit_reminder_interval(&db_guard)?,
        max_limit_minor: Settings::get_credit_max_limit(&db_guard)?,
    })
}

/// Session-scoped variant of `set_credit_settings`.
#[command]
pub async fn set_credit_settings_scoped(
    session_token: String,
    args: CreditSettingsDto,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let tx = db_guard.unchecked_transaction()?;
    Settings::set_credit_enabled(&tx, args.enabled)?;
    Settings::set_credit_reminder_interval(&tx, args.reminder_interval_hours)?;
    Settings::set_credit_max_limit(&tx, args.max_limit_minor)?;
    tx.commit()?;
    Ok(())
}

/// Session-scoped variant of `list_credit_sales`. Its body stays inline for the
/// same registration-gate reason spelled out on `list_credit_sales`, and it is
/// the command that carries the real gap: this path resolves a session and then
/// drops it (`_session`) without asking for `sales:view`, which the bridge's own
/// `list_credit_sales_scoped` does require.
#[command]
pub async fn list_credit_sales_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<CreditSaleDto>, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    // F-017/T10: the `oz_bridge::settings` twin gates this command and this shell
    // resolved the session, bound it to a store, then ignored it. Gated here before
    // the store lock is taken, so no await sits inside a held lock.
    require_permission_for_session(&state, &session, permissions::SALES_VIEW).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let mut stmt = db_guard.prepare(
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

/// Session-scoped variant of `settle_credit`.
#[command]
pub async fn settle_credit_scoped(
    session_token: String,
    sale_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let tx = db_guard.unchecked_transaction()?;
    let now = chrono::Utc::now().to_rfc3339();
    tx.execute(
        "UPDATE payments SET settled_at = ?1 WHERE sale_id = ?2 AND method = 'credit'",
        rusqlite::params![now, sale_id],
    )?;
    tx.commit()?;
    Ok(())
}

/// Session-scoped variant of `get_hardware_settings`.
#[command]
pub async fn get_hardware_settings_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<HardwareSettingsDto, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    // F-017/T10: the `oz_bridge::settings` twin gates this command and this shell
    // resolved the session, bound it to a store, then ignored it. Gated here before
    // the store lock is taken, so no await sits inside a held lock.
    require_permission_for_session(&state, &session, permissions::SETTINGS_READ).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    Ok(HardwareSettingsDto {
        printer_connection: Settings::get_printer_connection(&db_guard)?,
        printer_device_path: Settings::get_printer_device_path(&db_guard)?,
        printer_paper_size: Settings::get_printer_paper_size(&db_guard)?,
        scanner_device_id: Settings::get_scanner_device_id(&db_guard)?,
        scanner_input_mode: Settings::get_scanner_input_mode(&db_guard)?,
    })
}

/// Session-scoped variant of `set_hardware_settings`.
#[command]
pub async fn set_hardware_settings_scoped(
    session_token: String,
    args: HardwareSettingsDto,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let tx = db_guard.unchecked_transaction()?;
    Settings::set_printer_connection(&tx, &args.printer_connection)?;
    Settings::set_printer_device_path(&tx, &args.printer_device_path)?;
    Settings::set_printer_paper_size(&tx, &args.printer_paper_size)?;
    Settings::set_scanner_device_id(&tx, &args.scanner_device_id)?;
    Settings::set_scanner_input_mode(&tx, &args.scanner_input_mode)?;
    tx.commit()?;
    Ok(())
}

/// Session-scoped variant of `get_setting`.
#[command]
pub async fn get_setting_scoped(
    session_token: String,
    key: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    // F-017/T10: the `oz_bridge::settings` twin gates this command and this shell
    // resolved the session, bound it to a store, then ignored it. Gated here before
    // the store lock is taken, so no await sits inside a held lock.
    require_permission_for_session(&state, &session, permissions::SETTINGS_READ).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    run_get_setting(&db_guard, &key)
}

/// Session-scoped variant of `set_setting`.
#[command]
pub async fn set_setting_scoped(
    session_token: String,
    key: String,
    value: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    // Extract terminal_id before locking the DB — no await inside the lock.
    let terminal_id = state
        .terminal_id
        .lock()
        .await
        .clone()
        .unwrap_or_else(|| "unknown".to_string());

    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    // The permission check is awaited BEFORE the store conn is locked, so no
    // await is ever held inside that lock.
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = oz_core::db::Store::new(&db_guard);
    run_set_setting(&db_guard, &key, &value, &terminal_id)?;
    // SYNC-10 parity: enqueue the change so the tablet's sync daemon
    // pushes it to the cloud (and the desktop's pull re-applies it).
    // Warn-and-continue — the local write already committed.
    if let Err(e) = enqueue_settings_update(&store, &key, &value, &terminal_id) {
        tracing::warn!(key = %key, error = %e, "failed to enqueue settings.update sync item");
    }
    Ok(())
}

/// Session-scoped batch write of settings keys. ADR #7.
///
/// The tablet twin of the bridge's `set_settings_scoped`. It exists because
/// three workspace settings cards call this name —
/// `ui/src/features/settings/workspace-cards/WorkspaceRestaurantPosSettings.tsx:114`,
/// `WorkspaceKdsSettings.tsx:136` and `WorkspaceInventorySettings.tsx:97` — and
/// the tablet mounts the same `WorkspaceSettingsModal` the desktop shell does
/// (`ui/src/frontend/shell/tablet/TabletAppShell.tsx:71-91` registers the F10
/// route, `:125` renders it). Before this command existed, those three cards
/// could not save on a tablet at all. The name was registered on desktop and
/// absent here, which is why `scripts/ipc-parity-allowlist.json` carried it
/// (T4-4 in `todo-refactor-oz-pos-app-agents-3.md`).
///
/// Two deliberate differences from the bridge body, both measured rather than
/// assumed:
/// - **The enqueue goes to the STORE queue, not the global one.** The bridge
///   enqueues on `ctx.db` because the desktop daemon watches the global queue
///   (`crates/oz-bridge/src/settings.rs`, "the sync daemon only watches the
///   global queue"). The tablet's daemon drains the *store* queue:
///   `sync_run_scoped` reads it through `resolve_scope` (`sync.rs:400-411`) and
///   its Phase 3 comment at `:437-447` records that writing these marks to the
///   global connection instead stranded the store rows as `pending` forever.
///   This matches the singular `set_setting_scoped` above, which already
///   enqueues on the store.
/// - **The tenant is the tablet's staged sentinel `"default"`**, the same value
///   `enqueue_settings_update` passes, rather than the bridge's
///   `session.store_id`.
#[command]
pub async fn set_settings_scoped(
    session_token: String,
    entries: HashMap<String, String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let terminal_id = state
        .terminal_id
        .lock()
        .await
        .clone()
        .unwrap_or_else(|| "unknown".to_string());

    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db_guard);

    // All-or-nothing, like the desktop twin: the batch funnel pre-flights every
    // key before it writes any, so one refused key aborts the whole batch.
    let written = {
        let tx = db_guard.unchecked_transaction()?;
        let written = oz_bridge::settings::run_set_settings_batch(&tx, &entries, &terminal_id)?;
        tx.commit()?;
        written
    };

    // Enqueue the values AS WRITTEN — the funnel merges `smtp_config`
    // internally, so `entries` is not what replication is offered.
    // Warn-and-continue: the local write already committed. SYNC-10.
    if let Err(e) =
        oz_bridge::settings::enqueue_settings_updates(&store, &written, &terminal_id, "default")
    {
        tracing::warn!(
            key_count = written.len(),
            error = %e,
            "failed to enqueue settings.update sync items"
        );
    }
    Ok(())
}

// ── Deployment / version read (operator tooling, saas-3 L162) ─────

// `DeploymentInfo` is re-exported from `oz_bridge::settings`; the value is
// built HERE, on purpose, because `CARGO_PKG_VERSION` expands against the crate
// that writes it — a tablet terminal reports the tablet build, exactly as the
// About identity constants resolve in the tablet shim (T1's decision).

/// Read-only deployment metadata for the signed-in operator. Authenticates the
/// session and checks `settings:read` inline (category 2 unscoped command).
#[command]
pub async fn get_deployment_info(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<DeploymentInfo, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_READ).await?;
    Ok(build_deployment_info())
}

/// Build the deployment-info payload. Split out so tests exercise the exact
/// production path without standing up a session.
fn build_deployment_info() -> DeploymentInfo {
    DeploymentInfo {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

#[cfg(test)]
#[path = "settings_tests.rs"]
mod tests;
