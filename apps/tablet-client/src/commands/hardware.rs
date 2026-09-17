//! Hardware-facing Tauri commands: cash drawer, receipt printer, barcode
//! scanner lifecycle (start/stop/list), customer displays, and USB
//! discovery. All commands reach into the HAL via `state.registry` — they
//! never construct a concrete driver.
//!
//! The command surface mirrors `apps/desktop-client/src/commands/hardware.rs`
//! so one React setup wizard works on both. Where the two differ, the
//! tablet authenticates with `resolve_session` rather than `resolve_scope`
//! for commands that touch no database row.

use serde::{Deserialize, Serialize};
use tauri::{Emitter, State, command};

use oz_core::{Currency, Money, Settings};
use oz_hal::DisplayContent;
use oz_hal::drivers::receipt;
use oz_hal::transport::usb::{UsbDeviceInfo, probe_all};

use crate::error::AppError;
use crate::state::AppState;

// ── Cash drawer ─────────────────────────────────────────

// ADR #49: re-exported from the bridge rather than redefined, because
// `open_cash_drawer_scoped` now delegates and the bridge's signature names its
// own two types. Both sides declare the same fields with no `rename_all`, so
// the wire shape is unchanged: `device_id: Option<String>` in, `opened: bool`
// out.
//
// One asymmetry is real and is recorded rather than assumed harmless: this
// shell's `OpenCashDrawerArgs` carried `#[serde(default)]` on `device_id` and
// the bridge's does not. If that attribute was load-bearing, a caller that
// omits `device_id` entirely would have deserialised before and error now.
// `hardware_tests.rs::open_cash_drawer_args_default_device` deserialises `{}`
// and asserts `None`, so it is the pin: it passes today and must still pass.
pub use oz_bridge::hardware::{OpenCashDrawerArgs, OpenCashDrawerResult};

// ── Raw text receipt (legacy) ───────────────────────────

#[derive(Debug, Deserialize)]
/// Printreceiptargs.
pub struct PrintReceiptArgs {
    /// Raw receipt text (lines separated by '\n'). ESC/POS commands are
    /// added by the printer driver; the command layer only knows about
    /// plain text.
    pub body: String,
}

#[derive(Debug, Serialize)]
/// Printreceiptresult.
pub struct PrintReceiptResult {
    /// Printed Lines.
    pub printed_lines: usize,
}

// ── Structured sales receipt ────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Printsalesreceiptargs.
pub struct PrintSalesReceiptArgs {
    /// Date.
    pub date: String,
    /// Receipt Number.
    pub receipt_number: String,
    /// Items.
    pub items: Vec<LineItemDto>,
    /// Subtotal.
    pub subtotal: MoneyDto,
    /// Tax.
    pub tax: Option<MoneyDto>,
    /// Total amount in minor currency units.
    pub total: MoneyDto,
    /// Payments.
    pub payments: Vec<PaymentDto>,
    #[serde(default)]
    /// Table Number.
    pub table_number: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Lineitemdto.
pub struct LineItemDto {
    /// Display name.
    pub name: String,
    /// Quantity.
    pub quantity: u32,
    /// Unit price in minor currency units.
    pub unit_price: MoneyDto,
    /// Total Price.
    pub total_price: MoneyDto,
    #[serde(default)]
    /// Tax Amount.
    pub tax_amount: Option<MoneyDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Paymentdto.
pub struct PaymentDto {
    /// Method.
    pub method: String,
    /// Amount.
    pub amount: MoneyDto,
    /// Change.
    pub change: Option<MoneyDto>,
}

/// Flat serialisable representation of Money — the front-end sends
/// these instead of a nested Money object for simplicity.
#[derive(Debug, Deserialize)]
pub struct MoneyDto {
    /// Minor Units.
    pub minor_units: i64,
    /// ISO-4217 currency code.
    pub currency: String,
}

impl MoneyDto {
    fn to_money(&self) -> Result<Money, AppError> {
        let currency: Currency = self
            .currency
            .parse()
            .map_err(|_| AppError::Invalid(format!("invalid currency code '{}'", self.currency)))?;
        Ok(Money {
            minor_units: self.minor_units,
            currency,
        })
    }
}

#[derive(Debug, Serialize)]
/// Printsalesreceiptresult.
pub struct PrintSalesReceiptResult {
    /// Printed.
    pub printed: bool,
}

// ── Barcode scanner ──────────────────────────────────────

#[derive(Debug, Serialize)]
/// Scannerinfo.
pub struct ScannerInfo {
    /// Unique identifier.
    pub id: String,
}

/// Open cash drawer resolved from a session token. ADR #7.
///
/// ADR #49: the body is the bridge's. This door earned its delegation in two
/// steps, and the order matters. **First the gate:** this shell resolved the
/// session and discarded it as `_session`, so the drawer opened for any
/// authenticated caller, while the twin gates with `permissions::PAYMENTS_CASH`
/// under the same `F-017` finding. That was closed here *before* delegating,
/// because §4 forbids widening **or narrowing** a gate inside an extraction —
/// delegating an ungated door would have flipped the ledger's reading of it.
/// With the gate at parity the rest is an identity: same `resolve_session`
/// first, same `"no cash drawer registered as '{id}'"` text, same
/// `drawer.open()`.
///
/// One delta, reported rather than hidden: the bridge calls
/// `ctx.resolve_scope(session_token)?` after the gate and discards the result,
/// so it also requires the session's *store* DB to resolve. This shell opened
/// nothing. That is the desktop's behaviour, so it is parity — but it means a
/// cash-drawer command now depends on the store DB being openable, which it
/// never did before. The same delta was accepted for `start_scanner_scoped`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn open_cash_drawer_scoped(
    session_token: String,
    args: OpenCashDrawerArgs,
    state: State<'_, AppState>,
) -> Result<OpenCashDrawerResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::hardware::open_cash_drawer_scoped(&ctx, args, &session_token)
        .await
        .map_err(Into::into)
}

/// Print receipt resolved from a session token. ADR #7.
///
/// ADR #49 — NOT delegated. The bridge's twin (`crates/kasirmu-bridge/src/hardware.rs:443`)
/// is this body plus one block: it calls `printer.get_status()`, rejects the print with
/// `"Printer is not ready: check paper supply and cover"` when `status.has_fault()`
/// (`:454-459`), and warns on low paper (`:460-462`). This shell has neither, so
/// delegating would add a refusal path to a command that currently prints — a check that
/// can start refusing what it accepted before, which §4 forbids inside an extraction.
/// Same shape as the `set_brand_logo_path` refusal in `branding.rs`. Whether the tablet
/// should gain the fault check is an owner call, not a port.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn print_receipt_scoped(
    session_token: String,
    args: PrintReceiptArgs,
    state: State<'_, AppState>,
) -> Result<PrintReceiptResult, AppError> {
    let _session = state.resolve_session(&session_token)?;
    let printer = state
        .registry
        .printer("default")
        .await
        .ok_or_else(|| AppError::Invalid("no receipt printer registered".into()))?;
    let lines: Vec<&str> = args.body.lines().collect();
    let n = lines.len();
    printer.print_receipt(&args.body).await?;
    // Emit a completion event so the front-end can show a toast.
    if let Some(ref app) = state.app {
        let _ = app.emit("receipt:printed", serde_json::json!({ "lines": n }));
    }
    Ok(PrintReceiptResult { printed_lines: n })
}

/// Print sales receipt resolved from a session token. ADR #7.
///
/// ADR #49 — NOT delegated, on the same ground as `print_receipt_scoped`: the bridge's
/// `run_print_receipt_inner` (`crates/kasirmu-bridge/src/hardware.rs:309`) is this body plus
/// the `get_status()` / `has_fault()` rejection at `:321-333`. Everything after that
/// block matches — same `format_sales_receipt`, same `line_count = receipt.items.len()
/// + 6`, same `print_raw` — so the added refusal is the only obstacle.
///
/// A second, smaller delta is worth an owner's eye rather than a port: this body
/// resolves the printer *before* the session (`:350-354`), so a missing printer is
/// reported ahead of an invalid token, whereas the bridge resolves the store first. That
/// ordering lets an unauthenticated caller distinguish printer states.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn print_sales_receipt_scoped(
    session_token: String,
    args: PrintSalesReceiptArgs,
    state: State<'_, AppState>,
) -> Result<PrintSalesReceiptResult, AppError> {
    let printer = state
        .registry
        .printer("default")
        .await
        .ok_or_else(|| AppError::Invalid("no receipt printer registered".into()))?;

    // Load store info + display settings from the DB in a block
    // so the MutexGuard is dropped before any .await point.
    let (config, store_info) = {
        let (_session, conn_arc) = state.resolve_scope(&session_token)?;
        let db_guard = conn_arc
            .lock()
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        let conn = &*db_guard;
        let store_name = Settings::get_store_name(&conn)?.unwrap_or_else(|| "OZ-POS Store".into());
        let store_address = Settings::get_store_address(&conn)?.unwrap_or_default();
        let store_tax_id = Settings::get_store_tax_id(&conn)?;
        let decimals = Settings::get_receipt_decimal_separator(&conn)?;
        let decimal_separator = match decimals.as_str() {
            "comma" => receipt::DecimalSeparator::Comma,
            "none" => receipt::DecimalSeparator::None,
            _ => receipt::DecimalSeparator::Dot,
        };
        let paper_width = match Settings::get_receipt_paper_width(&conn)?.as_str() {
            "narrow" => receipt::PaperWidth::Narrow,
            _ => receipt::PaperWidth::Standard,
        };
        let cfg = receipt::ReceiptConfig {
            paper_width,
            show_currency: Settings::get_receipt_show_currency(&conn)?,
            decimal_separator,
            show_tax: Settings::get_receipt_show_tax(&conn)?,
            footer: {
                let f = Settings::get_receipt_footer(&conn)?;
                if f.is_empty() { None } else { Some(f) }
            },
            show_table_number: Settings::get_receipt_show_table_number(&conn)?,
            barcode_enabled: false,
            payment_link_template: None,
        };
        (
            cfg,
            receipt::StoreInfo {
                name: store_name,
                address: store_address,
                tax_id: store_tax_id,
            },
        )
    }; // db_guard dropped here

    let receipt = receipt::SalesReceipt {
        store: store_info,
        date: args.date,
        receipt_number: args.receipt_number,
        table_number: args.table_number,
        items: args
            .items
            .into_iter()
            .map(|i| {
                Ok::<_, AppError>(receipt::LineItem {
                    name: i.name,
                    quantity: i.quantity,
                    unit_price: i.unit_price.to_money()?,
                    total_price: i.total_price.to_money()?,
                    tax_amount: i.tax_amount.map(|t| t.to_money()).transpose()?,
                })
            })
            .collect::<Result<Vec<_>, _>>()?,
        subtotal: args.subtotal.to_money()?,
        tax: args.tax.map(|t| t.to_money()).transpose()?,
        total: args.total.to_money()?,
        payments: args
            .payments
            .into_iter()
            .map(|p| {
                Ok::<_, AppError>(receipt::PaymentInfo {
                    method: p.method,
                    amount: p.amount.to_money()?,
                    change: p.change.map(|c| c.to_money()).transpose()?,
                })
            })
            .collect::<Result<Vec<_>, _>>()?,
    };

    let data = receipt::format_sales_receipt(&receipt, &config);
    let line_count = receipt.items.len() + 6;

    printer.print_raw(&data).await?;

    if let Some(ref app) = state.app {
        let _ = app.emit(
            "receipt:printed",
            serde_json::json!({ "lines": line_count }),
        );
    }

    Ok(PrintSalesReceiptResult { printed: true })
}

/// Move the preferred scanner to the front, leaving the rest in order.
///
/// Mirrors the desktop helper: the UI auto-detects with `scanners[0]`, so
/// the saved device must come first or the setting does nothing. A no-op
/// when `preferred` is empty or matches nothing.
fn prefer_first(mut scanners: Vec<ScannerInfo>, preferred: &str) -> Vec<ScannerInfo> {
    if preferred.is_empty() {
        return scanners;
    }
    if let Some(pos) = scanners.iter().position(|s| s.id == preferred) {
        let chosen = scanners.remove(pos);
        scanners.insert(0, chosen);
    }
    scanners
}

/// List all registered barcode scanners resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn list_scanners_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<ScannerInfo>, AppError> {
    let _session = state.resolve_session(&session_token)?;
    let ids = state.registry.scanner_ids().await;
    let preferred = {
        let conn = state.db.lock().await;
        oz_core::Settings::get_scanner_device_id(&conn).unwrap_or_default()
    }; // guard dropped: Connection is !Send
    Ok(prefer_first(
        ids.into_iter().map(|id| ScannerInfo { id }).collect(),
        &preferred,
    ))
}

/// Start a background polling task for the named scanner resolved from a session token. ADR #7.
///
/// ADR #49: the body is the bridge's. This was a byte-identical second copy of
/// `oz_bridge::hardware::start_scanner_scoped` — same cancel-then-take, same
/// `"no scanner registered as '{}'"` text, same `AppHandle unavailable` error
/// for the headless case, same `poll(300)`, same 500 ms backoff, and the same
/// four log strings and two `barcode:*` payloads. The only deltas are the ones
/// the delegation exists to remove: the emit moves from a held `AppHandle` to
/// `ctx.emitter` (the same `TauriEventSink` this shell installs), and the
/// error type converts through the `From<BridgeError> for AppError` seam.
///
/// One delta is real and is reported rather than hidden: the bridge resolves
/// with `ctx.resolve_scope(..)`, which opens the session's store DB, where this
/// body used `resolve_session` and opened nothing. That is the desktop's
/// behaviour (the desktop has delegated this door all along), so it is parity
/// rather than a regression — but it does add a store open to every scanner
/// start, and the scanner state it writes (`scanner_cancel`) is the same
/// `Arc<Mutex<..>>` this shell hands to the bridge and that `stop_scanner_scoped`
/// below locks, because
/// `bridge_ctx()` binds `scanner_cancel: &self.scanner_cancel`. The unscoped
/// `stop_scanner` that also read this field was retired in T21 (b2): it was registered
/// in neither shell, so no client could reach it to read anything. The field and its
/// binding are unchanged.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn start_scanner_scoped(
    session_token: String,
    scanner_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::hardware::start_scanner_scoped(&ctx, &scanner_id, &session_token)
        .await
        .map_err(Into::into)
}

/// Stop the active barcode scanner background task (if any) resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn stop_scanner_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let _session = state.resolve_session(&session_token)?;
    let mut cancel = state.scanner_cancel.lock().await;
    if let Some(sender) = cancel.take() {
        let _ = sender.send(());
    }
    Ok(())
}

// ── Displays and discovery (ADR #7 parity with desktop) ──────────────
//
// These four existed only in the desktop client, so the tablet's setup
// wizard could list scanners but never a customer display, and could not
// probe at all. They authenticate with resolve_session rather than
// resolve_scope: the desktop versions call resolve_scope, which additionally
// opens the store database, and none of these four reads or writes a row.
// An invalid session is rejected identically either way.

/// Arguments for [`display_show_scoped`].
#[derive(Debug, Deserialize)]
pub struct DisplayShowArgs {
    /// ID of the associated display.
    pub display_id: String,
    /// Line1.
    pub line1: String,
    /// Line2.
    pub line2: String,
}

/// List all registered customer displays (scoped).
#[command]
pub async fn list_displays_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let _session = state.resolve_session(&session_token)?;
    Ok(state.registry.display_ids().await)
}

/// Show content on a customer-facing pole display (scoped).
#[command]
pub async fn display_show_scoped(
    args: DisplayShowArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let _session = state.resolve_session(&session_token)?;
    let display = state
        .registry
        .display(&args.display_id)
        .await
        .ok_or_else(|| {
            AppError::Invalid(format!("no display registered as '{}'", args.display_id))
        })?;
    let content = DisplayContent {
        line1: args.line1,
        line2: args.line2,
    };
    display.connect().await?;
    display.show(&content).await?;
    Ok(())
}

/// Clear a customer-facing pole display (scoped).
#[command]
pub async fn display_clear_scoped(
    display_id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let _session = state.resolve_session(&session_token)?;
    let display = state
        .registry
        .display(&display_id)
        .await
        .ok_or_else(|| AppError::Invalid(format!("no display registered as '{display_id}'")))?;
    display.clear().await?;
    Ok(())
}

/// Discover all connected USB hardware devices (scoped).
///
/// On Android this needs USB host mode (OTG) and the `android.hardware.usb
/// .host.xml` feature; a tablet without it gets an error rather than an
/// empty list, which is the same shape the desktop returns when libusb
/// cannot enumerate. The setup wizard treats the error as "no devices".
#[command]
pub async fn discover_hardware_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<UsbDeviceInfo>, AppError> {
    let _session = state.resolve_session(&session_token)?;
    probe_all().map_err(|e| AppError::Internal(format!("hardware discovery failed: {e}")))
}

#[cfg(test)]
#[path = "hardware_tests.rs"]
mod tests;
