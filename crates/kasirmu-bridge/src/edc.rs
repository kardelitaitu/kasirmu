//! EDC payment-terminal bridge module (Wave D & R4 multi-terminal).
//!
//! Card-present payment through whatever terminal the operator configured,
//! resolved from the HAL driver registry ([`BridgeCtx::registry`](crate::ctx::BridgeCtx::registry)) rather
//! than held on shell state, so a card tender can only reach hardware that
//! exists. With no terminal registered every command fails closed with
//! [`BridgeError::Hardware`](crate::error::BridgeError::Hardware)
//! (`HalErrorKind::NotFound`).
//!
//! When multiple card terminals exist per store / register, commands route
//! explicitly via `terminal_id: Option<&str>`. Omitted or blank ids fall back
//! to [`DEFAULT_TERMINAL_ID`](crate::edc::DEFAULT_TERMINAL_ID), maintaining 100%
//! backward compatibility. Fully-qualified because a module-level `//!` doc
//! resolves links in the ENCLOSING scope, where this module's own items are not
//! yet in scope; the bare label and the `self::` form both fail
//! `rustdoc::broken_intra_doc_links`, which the `rust-doc` gate raises to an error.
//! Dynamic configuration changes are synced with the driver registry without
//! requiring an application restart.

use serde::{Deserialize, Serialize};
use std::sync::Arc;

use kasirmu_core::db::edc_terminals::{EdcTerminalConfig, NewEdcTerminal};
use kasirmu_hal::{EdcPaymentResult, EdcTerminal, HalErrorKind, TerminalStatus};

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// Registry id the card tender uses when the caller names none.
///
/// The startup bootstrap binds this to the earliest-created active row in
/// `edc_terminals` (see `platform_startup::hardware::register_card_terminals`),
/// so a store that has configured a terminal resolves here and one that has
/// not fails closed.
pub const DEFAULT_TERMINAL_ID: &str = "default";

/// Terminal status, serialisable for the front-end.
///
/// `TerminalStatus` is `#[serde(rename_all = "camelCase")]`, so this emits
/// the same `"ready" | "busy" | "offline" | "paperError" | "error"` strings
/// the previous hand-written match produced and `ui/src/api/edc.ts` expects.
#[derive(Debug, Serialize, Deserialize)]
pub struct EdcStatusDto {
    /// Current status as the terminal reported it.
    pub status: TerminalStatus,
}

/// Result of a card-present sale/refund/void.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdcResultDto {
    /// Whether the transaction was approved.
    pub success: bool,
    /// Gateway / acquirer transaction id (present on success).
    pub transaction_id: Option<String>,
    /// Authorisation code from the card network.
    pub auth_code: Option<String>,
    /// Card scheme (e.g. "Visa").
    pub card_scheme: Option<String>,
    /// Last 4 digits of the card.
    pub card_last4: Option<String>,
    /// Human-readable message.
    pub message: String,
}

impl From<EdcPaymentResult> for EdcResultDto {
    fn from(r: EdcPaymentResult) -> Self {
        Self {
            success: r.success,
            transaction_id: r.transaction_id,
            auth_code: r.auth_code,
            card_scheme: r.card_scheme,
            card_last4: r.card_last4,
            message: r.message,
        }
    }
}

/// DTO for a configured EDC card-payment terminal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdcTerminalDto {
    /// Database UUID v7 identifier.
    pub id: String,
    /// Human-readable label (e.g. "Counter 1 - BCA EDC").
    pub name: String,
    /// Connection type ("wired" or "wireless").
    pub connection_type: String,
    /// Transport protocol ("serial", "usb", "bluetooth", "tcp").
    pub transport: String,
    /// Address (COM port, MAC address, IP:port).
    pub address: String,
    /// Hardware vendor, if specified.
    pub vendor: Option<String>,
    /// Terminal model identifier, if specified.
    pub model: Option<String>,
    /// Whether this terminal is active for transactions.
    pub is_active: bool,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// ISO-8601 last update timestamp.
    pub updated_at: String,
}

impl From<EdcTerminalConfig> for EdcTerminalDto {
    fn from(c: EdcTerminalConfig) -> Self {
        Self {
            id: c.id,
            name: c.name,
            connection_type: c.connection_type,
            transport: c.transport,
            address: c.address,
            vendor: c.vendor,
            model: c.model,
            is_active: c.is_active,
            created_at: c.created_at,
            updated_at: c.updated_at,
        }
    }
}

/// Arguments to create a new EDC card-payment terminal.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEdcTerminalArgs {
    /// Human-readable label.
    pub name: String,
    /// Connection type ("wired" or "wireless").
    pub connection_type: String,
    /// Transport protocol ("serial", "usb", "bluetooth", "tcp").
    pub transport: String,
    /// Address (COM port, MAC address, IP:port).
    pub address: String,
    /// Hardware vendor, if specified.
    pub vendor: Option<String>,
    /// Terminal model identifier, if specified.
    pub model: Option<String>,
    /// Whether active; defaults to true when omitted.
    pub is_active: Option<bool>,
}

/// Arguments to update an existing EDC card-payment terminal.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateEdcTerminalArgs {
    /// ID of the terminal to update.
    pub id: String,
    /// Human-readable label.
    pub name: String,
    /// Connection type ("wired" or "wireless").
    pub connection_type: String,
    /// Transport protocol ("serial", "usb", "bluetooth", "tcp").
    pub transport: String,
    /// Address (COM port, MAC address, IP:port).
    pub address: String,
    /// Hardware vendor, if specified.
    pub vendor: Option<String>,
    /// Terminal model identifier, if specified.
    pub model: Option<String>,
    /// Whether active.
    pub is_active: bool,
}

/// Synchronize a terminal row into the runtime HAL driver registry.
async fn sync_terminal_driver(ctx: &BridgeCtx<'_>, row: &EdcTerminalConfig) {
    if !row.is_active {
        ctx.registry.unregister_terminal(&row.id).await;
        return;
    }

    let address = row.address.trim();
    if address.is_empty() {
        ctx.registry.unregister_terminal(&row.id).await;
        return;
    }

    if address.starts_with("loopback")
        || row.transport == "loopback"
        || row.connection_type == "loopback"
        || row.vendor.as_deref() == Some("loopback")
        || row.vendor.as_deref() == Some("simulator")
    {
        let sim = Arc::new(kasirmu_hal::drivers::edc::LoopbackEdcTerminal::from_address(address));
        ctx.registry
            .register_loopback_terminal_with(&row.id, sim)
            .await;
        return;
    }

    let info = kasirmu_hal::types::DeviceInfo::new(
        row.vendor.clone().unwrap_or_else(|| "unknown".into()),
        row.model.clone().unwrap_or_else(|| "card".into()),
        address,
    );

    match (row.connection_type.as_str(), row.transport.as_str()) {
        ("wired", "serial" | "usb") => {
            ctx.registry
                .register_wired_terminal(
                    &row.id,
                    address,
                    kasirmu_hal::drivers::edc::wired::DEFAULT_BAUD,
                    info,
                )
                .await;
        }
        ("wireless", "bluetooth") => {
            ctx.registry
                .register_wireless_terminal(
                    &row.id,
                    kasirmu_hal::drivers::edc::WirelessTarget::Bluetooth(address.to_owned()),
                    info,
                )
                .await;
        }
        ("wireless", "tcp") => {
            ctx.registry
                .register_wireless_terminal(
                    &row.id,
                    kasirmu_hal::drivers::edc::WirelessTarget::Network(address.to_owned()),
                    info,
                )
                .await;
        }
        _ => {
            ctx.registry.unregister_terminal(&row.id).await;
        }
    }
}

/// Keep the `"default"` alias pointing to the earliest active row in the table.
async fn sync_default_alias(ctx: &BridgeCtx<'_>, active_rows: &[EdcTerminalConfig]) {
    // A let-chain rather than a nested `if let`: edition 2024, and clippy's
    // `collapsible_if` is a hard error under the workspace's `-D warnings`, so
    // the nested form fails CI's cargo-clippy job. Both conditions must hold to
    // register the alias; anything else unregisters it.
    if let Some(earliest) = active_rows.first()
        && let Some(terminal) = ctx.registry.terminal(&earliest.id).await
    {
        ctx.registry
            .register_terminal(DEFAULT_TERMINAL_ID, terminal)
            .await;
        return;
    }
    ctx.registry.unregister_terminal(DEFAULT_TERMINAL_ID).await;
}

/// Resolve the configured card terminal, or fail closed.
///
/// When `terminal_id` is `Some` and non-empty, looks up that specific terminal.
/// Otherwise, resolves [`DEFAULT_TERMINAL_ID`].
/// Returns `Hardware`/`NotFound` if no matching driver exists in the registry.
async fn resolve_terminal(
    ctx: &BridgeCtx<'_>,
    terminal_id: Option<&str>,
) -> Result<Arc<dyn EdcTerminal>, BridgeError> {
    let id = terminal_id
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_TERMINAL_ID);

    ctx.registry.terminal(id).await.ok_or_else(|| {
        if id == DEFAULT_TERMINAL_ID {
            BridgeError::Hardware {
                sub_kind: HalErrorKind::NotFound,
                message: "no card terminal configured — add one under Settings › Hardware".into(),
            }
        } else {
            BridgeError::Hardware {
                sub_kind: HalErrorKind::NotFound,
                message: format!(
                    "EDC card terminal '{id}' not found — check device connection in Settings › Hardware"
                ),
            }
        }
    })
}

/// Parse a minor-units amount and currency from the front-end.
fn parse_amount(amount_minor: i64, currency: &str) -> Result<foundation::Money, BridgeError> {
    let parsed = currency
        .parse::<foundation::Currency>()
        .map_err(|_| BridgeError::Invalid(format!("invalid currency code: {currency}")))?;
    Ok(foundation::Money {
        minor_units: amount_minor,
        currency: parsed,
    })
}

/// Query the EDC terminal's current status.
///
/// # Errors
///
/// Returns [`BridgeError::Hardware`] (`NotFound`) when no matching terminal is
/// registered and propagates terminal [`kasirmu_hal::HalError`]s.
pub async fn edc_terminal_status(
    ctx: &BridgeCtx<'_>,
    terminal_id: Option<&str>,
) -> Result<EdcStatusDto, BridgeError> {
    let terminal = resolve_terminal(ctx, terminal_id).await?;
    Ok(EdcStatusDto {
        status: terminal.status().await?,
    })
}

/// Session-scoped variant of [`edc_terminal_status`].
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] and the errors of
/// [`edc_terminal_status`].
pub async fn edc_terminal_status_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    terminal_id: Option<&str>,
) -> Result<EdcStatusDto, BridgeError> {
    let _session = ctx.resolve_session(session_token)?;
    edc_terminal_status(ctx, terminal_id).await
}

/// Process a card-present sale (authorize + capture in one call).
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`],
/// [`BridgeError::Invalid`] for a bad currency, [`BridgeError::Hardware`]
/// when no matching terminal is registered and propagated terminal errors.
pub async fn edc_sale(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    amount_minor: i64,
    currency: &str,
    terminal_id: Option<&str>,
) -> Result<EdcResultDto, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, kasirmu_core::permissions::SALES_PROCESS)
        .await?;
    let amount = parse_amount(amount_minor, currency)?;
    let terminal = resolve_terminal(ctx, terminal_id).await?;
    Ok(terminal.sale(amount).await?.into())
}

/// Refund a previously captured card transaction.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`],
/// [`BridgeError::Invalid`] for a bad currency, [`BridgeError::Hardware`]
/// when no matching terminal is registered and propagated terminal errors.
pub async fn edc_refund(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    transaction_id: &str,
    amount_minor: i64,
    currency: &str,
    terminal_id: Option<&str>,
) -> Result<EdcResultDto, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, kasirmu_core::permissions::SALES_REFUND)
        .await?;
    let amount = parse_amount(amount_minor, currency)?;
    let terminal = resolve_terminal(ctx, terminal_id).await?;
    Ok(terminal.refund(transaction_id, Some(amount)).await?.into())
}

/// Void a pending authorisation before capture.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`],
/// [`BridgeError::Hardware`] when no matching terminal is registered and propagated
/// terminal errors.
pub async fn edc_void(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    transaction_id: &str,
    terminal_id: Option<&str>,
) -> Result<EdcResultDto, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, kasirmu_core::permissions::SALES_VOID)
        .await?;
    let terminal = resolve_terminal(ctx, terminal_id).await?;
    Ok(terminal.void(transaction_id).await?.into())
}

/// List all configured EDC card terminals (session-scoped).
///
/// Accessible to operators with `SETTINGS_READ` (Settings view) or
/// cashiers with `SALES_PROCESS` (Checkout terminal selection).
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`],
/// or [`BridgeError::Core`] on DB read failure.
pub async fn list_edc_terminals_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<EdcTerminalDto>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    if ctx
        .require_session_permission(&session, kasirmu_core::permissions::SETTINGS_READ)
        .await
        .is_err()
    {
        ctx.require_session_permission(&session, kasirmu_core::permissions::SALES_PROCESS)
            .await?;
    }

    let rows = {
        let db = ctx.db.lock().await;
        let store = kasirmu_core::db::Store::new(&db);
        store.list_edc_terminals().map_err(BridgeError::from)?
    };

    Ok(rows.into_iter().map(Into::into).collect())
}

/// Create a new EDC card terminal and dynamically register it.
///
/// Requires `SETTINGS_EDIT` permission.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`],
/// or [`BridgeError::Core`].
pub async fn create_edc_terminal_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: CreateEdcTerminalArgs,
) -> Result<EdcTerminalDto, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, kasirmu_core::permissions::SETTINGS_EDIT)
        .await?;

    let new_terminal = NewEdcTerminal {
        name: args.name,
        connection_type: args.connection_type,
        transport: args.transport,
        address: args.address,
        vendor: args.vendor,
        model: args.model,
        is_active: args.is_active,
    };

    let (stored, all_active) = {
        let db = ctx.db.lock().await;
        let store = kasirmu_core::db::Store::new(&db);
        let stored = store
            .create_edc_terminal(&new_terminal)
            .map_err(BridgeError::from)?;
        let all_active = store
            .list_active_edc_terminals()
            .map_err(BridgeError::from)?;
        (stored, all_active)
    };

    sync_terminal_driver(ctx, &stored).await;
    sync_default_alias(ctx, &all_active).await;
    Ok(stored.into())
}

/// Update an existing EDC card terminal and synchronize driver registration.
///
/// Requires `SETTINGS_EDIT` permission.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`],
/// [`BridgeError::Core`] (e.g. NotFound), or validation errors.
pub async fn update_edc_terminal_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: UpdateEdcTerminalArgs,
) -> Result<EdcTerminalDto, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, kasirmu_core::permissions::SETTINGS_EDIT)
        .await?;

    let new_terminal = NewEdcTerminal {
        name: args.name,
        connection_type: args.connection_type,
        transport: args.transport,
        address: args.address,
        vendor: args.vendor,
        model: args.model,
        is_active: Some(args.is_active),
    };

    let (stored, all_active) = {
        let db = ctx.db.lock().await;
        let store = kasirmu_core::db::Store::new(&db);
        let stored = store
            .update_edc_terminal(&args.id, &new_terminal)
            .map_err(BridgeError::from)?;
        let all_active = store
            .list_active_edc_terminals()
            .map_err(BridgeError::from)?;
        (stored, all_active)
    };

    sync_terminal_driver(ctx, &stored).await;
    sync_default_alias(ctx, &all_active).await;
    Ok(stored.into())
}

/// Delete an EDC card terminal and unregister its driver.
///
/// Requires `SETTINGS_EDIT` permission.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`],
/// or [`BridgeError::Core`] (e.g. NotFound).
pub async fn delete_edc_terminal_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: &str,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, kasirmu_core::permissions::SETTINGS_EDIT)
        .await?;

    let all_active = {
        let db = ctx.db.lock().await;
        let store = kasirmu_core::db::Store::new(&db);
        store.delete_edc_terminal(id).map_err(BridgeError::from)?;
        store
            .list_active_edc_terminals()
            .map_err(BridgeError::from)?
    };

    ctx.registry.unregister_terminal(id).await;
    sync_default_alias(ctx, &all_active).await;
    Ok(())
}

#[cfg(test)]
#[path = "edc_tests.rs"]
mod tests;
