//! EDC payment-terminal bridge module (Wave D).
//!
//! Card-present payment through whatever terminal the operator configured,
//! resolved from the HAL driver registry ([`BridgeCtx::registry`]) rather
//! than held on shell state, so a card tender can only reach hardware that
//! exists. With no terminal registered every command fails closed with
//! [`BridgeError::Hardware`] (`HalErrorKind::NotFound`) — the drivers
//! behind this surface are stubs until a vendor protocol ships, and a
//! payment result that looks approved is worse than one that fails.

use serde::Serialize;

use kasirmu_hal::{EdcPaymentResult, EdcTerminal, HalErrorKind, TerminalStatus};

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// Registry id the card tender uses when the caller names none.
///
/// The startup bootstrap binds this to the earliest-created active row in
/// `edc_terminals` (see `platform_startup::hardware::register_card_terminals`),
/// so a store that has configured a terminal resolves here and one that has
/// not fails closed. It is a single-terminal convention: the table has no
/// `is_default` column, so with two rows configured the operator gets the
/// oldest. Making the commands take a `terminal_id` is the follow-up that
/// removes that.
pub const DEFAULT_TERMINAL_ID: &str = "default";

/// Terminal status, serialisable for the front-end.
///
/// `TerminalStatus` is `#[serde(rename_all = "camelCase")]`, so this emits
/// the same `"ready" | "busy" | "offline" | "paperError" | "error"` strings
/// the previous hand-written match produced and `ui/src/api/edc.ts` expects.
#[derive(Debug, Serialize)]
pub struct EdcStatusDto {
    /// Current status as the terminal reported it.
    pub status: TerminalStatus,
}

/// Result of a card-present sale/refund/void.
#[derive(Debug, Serialize)]
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

/// Resolve the configured card terminal, or fail closed.
///
/// The error is `Hardware`/`NotFound` rather than `Invalid`: nothing the
/// caller sent was wrong, the register simply has no card reader.
async fn resolve_terminal(
    ctx: &BridgeCtx<'_>,
) -> Result<std::sync::Arc<dyn EdcTerminal>, BridgeError> {
    ctx.registry
        .terminal(DEFAULT_TERMINAL_ID)
        .await
        .ok_or_else(|| BridgeError::Hardware {
            sub_kind: HalErrorKind::NotFound,
            message: "no card terminal configured — add one under Settings › Hardware".into(),
        })
}

/// Parse a minor-units amount and currency from the front-end.
///
/// # Errors
///
/// Returns [`BridgeError::Invalid`] for an unknown ISO-4217 code.
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
/// Returns [`BridgeError::Hardware`] (`NotFound`) when no terminal is
/// registered and propagates terminal [`kasirmu_hal::HalError`]s.
pub async fn edc_terminal_status(ctx: &BridgeCtx<'_>) -> Result<EdcStatusDto, BridgeError> {
    let terminal = resolve_terminal(ctx).await?;
    Ok(EdcStatusDto {
        status: terminal.status().await?,
    })
}

/// Process a card-present sale (authorize + capture in one call).
///
/// `amount_minor` is in the currency's minor units (e.g. cents for USD,
/// rupiah for IDR). `currency` is an ISO-4217 code. Gate order mirrors the
/// command body: resolve the session, enforce `sales_process`, parse the
/// amount, then resolve the terminal.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`],
/// [`BridgeError::Invalid`] for a bad currency, [`BridgeError::Hardware`]
/// when no terminal is registered and propagated terminal errors.
pub async fn edc_sale(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    amount_minor: i64,
    currency: &str,
) -> Result<EdcResultDto, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, oz_core::permissions::SALES_PROCESS)
        .await?;
    let amount = parse_amount(amount_minor, currency)?;
    let terminal = resolve_terminal(ctx).await?;
    Ok(terminal.sale(amount).await?.into())
}

/// Refund a previously captured card transaction.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`],
/// [`BridgeError::Invalid`] for a bad currency, [`BridgeError::Hardware`]
/// when no terminal is registered and propagated terminal errors.
pub async fn edc_refund(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    transaction_id: &str,
    amount_minor: i64,
    currency: &str,
) -> Result<EdcResultDto, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, oz_core::permissions::SALES_REFUND)
        .await?;
    let amount = parse_amount(amount_minor, currency)?;
    let terminal = resolve_terminal(ctx).await?;
    Ok(terminal.refund(transaction_id, Some(amount)).await?.into())
}

/// Void a pending authorisation before capture.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`],
/// [`BridgeError::Hardware`] when no terminal is registered and propagated
/// terminal errors.
pub async fn edc_void(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    transaction_id: &str,
) -> Result<EdcResultDto, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, oz_core::permissions::SALES_VOID)
        .await?;
    let terminal = resolve_terminal(ctx).await?;
    Ok(terminal.void(transaction_id).await?.into())
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
) -> Result<EdcStatusDto, BridgeError> {
    let _session = ctx.resolve_session(session_token)?;
    edc_terminal_status(ctx).await
}
