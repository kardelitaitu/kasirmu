//! HAL hardware-control command bodies (Wave D / D3a) — the tauri-free half
//! of `apps/desktop-client/src/commands/hardware.rs`.
//!
//! Key functions: the cash-drawer, receipt-printing, barcode-scanner and
//! pole-display operations, each consuming a [`BridgeCtx`]. Device access
//! goes through [`BridgeCtx::registry`] (`oz_hal` mock drivers per the repo
//! rule) — this module never constructs a concrete driver, exactly like the
//! shell it was extracted from.
//!
//! Two shell behaviours are re-created without tauri types:
//!
//! * UI events (`receipt:printed`, `barcode:scanned`, `barcode:error`) go
//!   through the injected [`EventSink`]. A `None` sink is a silent no-op,
//!   matching the shell's `if let Some(app) = state.app` pattern; a lost UI
//!   event is never a command failure.
//! * [`start_scanner_scoped`] spawns its own poll task (the shell spawned one
//!   over `state.app`). The sink Arc is cloned OUT of the context before the
//!   spawn (it is `'static`), so the task holds no borrow of the per-call
//!   context; cancellation rides [`BridgeCtx::scanner_cancel`], the same
//!   `oneshot` slot `state.scanner_cancel` exposes.
//!
//! Gate order, store construction, guard-drop placement (the
//! `MutexGuard dropped here before any .await` blocks) and error paths are
//! verbatim ports of the command bodies: a shim builds the context, calls one
//! function here, and maps [`BridgeError`] back to `AppError` so the wire
//! shape never moves.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;

use oz_core::permissions;
use oz_core::{Currency, Money, Settings};
use oz_hal::drivers::receipt;
use oz_hal::transport::usb::{UsbDeviceInfo, probe_all};
use oz_hal::{BarcodeScanner, DisplayContent};

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

// ── Cash drawer ─────────────────────────────────────────

#[derive(Debug, Deserialize)]
/// Opencashdrawerargs.
pub struct OpenCashDrawerArgs {
    /// Optional device id; defaults to "default" which is the mock drawer
    /// registered in every build.
    pub device_id: Option<String>,
}

#[derive(Debug, Serialize)]
/// Opencashdrawerresult.
pub struct OpenCashDrawerResult {
    /// Opened.
    pub opened: bool,
}

/// Open cash drawer.
///
/// # Errors
///
/// [`BridgeError::Invalid`] when no drawer is registered under the resolved
/// id; HAL errors surface as the hardware mirror of the shell's mapping.
pub async fn open_cash_drawer(
    ctx: &BridgeCtx<'_>,
    args: OpenCashDrawerArgs,
) -> Result<OpenCashDrawerResult, BridgeError> {
    let id = args.device_id.as_deref().unwrap_or("default");
    let drawer = ctx
        .registry
        .cash_drawer(id)
        .await
        .ok_or_else(|| BridgeError::Invalid(format!("no cash drawer registered as '{id}'")))?;
    drawer.open().await?;
    Ok(OpenCashDrawerResult { opened: true })
}

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

/// Print receipt.
///
/// # Errors
///
/// [`BridgeError::Invalid`] when no receipt printer is registered or the
/// printer reports a fault; HAL errors surface as the hardware mirror of the
/// shell's mapping.
pub async fn print_receipt(
    ctx: &BridgeCtx<'_>,
    args: PrintReceiptArgs,
) -> Result<PrintReceiptResult, BridgeError> {
    let printer = ctx
        .registry
        .printer("default")
        .await
        .ok_or_else(|| BridgeError::Invalid("no receipt printer registered".into()))?;

    // Check printer status before printing
    let status = printer.get_status().await?;
    if status.has_fault() {
        return Err(BridgeError::Invalid(
            "Printer is not ready: check paper supply and cover".into(),
        ));
    }
    if status.paper != oz_hal::PaperStatus::Ok {
        // Low paper — warn but continue
        tracing::warn!(
            paper = ?status.paper,
            "printer paper is low, continuing"
        );
    }

    let lines: Vec<&str> = args.body.lines().collect();
    let n = lines.len();
    printer.print_receipt(&args.body).await?;
    // Emit a completion event so the front-end can show a toast.
    if let Some(sink) = &ctx.emitter {
        sink.emit("receipt:printed", serde_json::json!({ "lines": n }));
    }
    Ok(PrintReceiptResult { printed_lines: n })
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
    /// Convert to an `oz_core::Money`, validating the currency code.
    ///
    /// # Errors
    ///
    /// [`BridgeError::Invalid`] when `currency` is not a known ISO-4217 code.
    pub fn to_money(&self) -> Result<Money, BridgeError> {
        let currency: Currency = self.currency.parse().map_err(|_| {
            BridgeError::Invalid(format!("invalid currency code '{}'", self.currency))
        })?;
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

/// Print sales receipt (global database).
///
/// # Errors
///
/// Settings read failures ([`BridgeError::Core`]), printer registration /
/// status / print failures, and DTO conversion errors
/// ([`BridgeError::Invalid`]).
pub async fn print_sales_receipt(
    ctx: &BridgeCtx<'_>,
    args: PrintSalesReceiptArgs,
) -> Result<PrintSalesReceiptResult, BridgeError> {
    let (config, store_info) = {
        let db = ctx.db.lock().await;
        read_receipt_config(&db)?
    }; // MutexGuard dropped here before any .await
    run_print_receipt_inner(ctx, args, config, store_info).await
}

/// Print sales receipt for the store resolved from a session token. ADR #7.
/// Settings (store name, address, receipt config) are loaded from the
/// store-scoped database, while the printer hardware itself is not
/// store-specific.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`] for an unknown or expired token;
/// settings read failures ([`BridgeError::Core`]); printer registration /
/// status / print failures; DTO conversion errors ([`BridgeError::Invalid`]).
pub async fn print_sales_receipt_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: PrintSalesReceiptArgs,
) -> Result<PrintSalesReceiptResult, BridgeError> {
    let (config, store_info) = {
        let conn = ctx.resolve_store(session_token)?;
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        read_receipt_config(&db)?
    }; // MutexGuard dropped here before any .await
    run_print_receipt_inner(ctx, args, config, store_info).await
}

/// Read receipt configuration and store info from the DB (synchronous — no async).
fn read_receipt_config(
    conn: &rusqlite::Connection,
) -> Result<(receipt::ReceiptConfig, receipt::StoreInfo), BridgeError> {
    let store_name = Settings::get_store_name(conn)?.unwrap_or_else(|| "OZ-POS Store".into());
    let store_address = Settings::get_store_address(conn)?.unwrap_or_default();
    let store_tax_id = Settings::get_store_tax_id(conn)?;
    let decimals = Settings::get_receipt_decimal_separator(conn)?;
    let decimal_separator = match decimals.as_str() {
        "comma" => receipt::DecimalSeparator::Comma,
        "none" => receipt::DecimalSeparator::None,
        _ => receipt::DecimalSeparator::Dot,
    };
    let paper_width = match Settings::get_receipt_paper_width(conn)?.as_str() {
        "narrow" => receipt::PaperWidth::Narrow,
        _ => receipt::PaperWidth::Standard,
    };
    let config = receipt::ReceiptConfig {
        paper_width,
        show_currency: Settings::get_receipt_show_currency(conn)?,
        decimal_separator,
        show_tax: Settings::get_receipt_show_tax(conn)?,
        footer: {
            let f = Settings::get_receipt_footer(conn)?;
            if f.is_empty() { None } else { Some(f) }
        },
        show_table_number: Settings::get_receipt_show_table_number(conn)?,
        barcode_enabled: false,
        payment_link_template: None,
    };
    let store_info = receipt::StoreInfo {
        name: store_name,
        address: store_address,
        tax_id: store_tax_id,
    };
    Ok((config, store_info))
}

/// Async inner: format and print receipt (no DB reference — all config already loaded).
pub async fn run_print_receipt_inner(
    ctx: &BridgeCtx<'_>,
    args: PrintSalesReceiptArgs,
    config: receipt::ReceiptConfig,
    store_info: receipt::StoreInfo,
) -> Result<PrintSalesReceiptResult, BridgeError> {
    let printer = ctx
        .registry
        .printer("default")
        .await
        .ok_or_else(|| BridgeError::Invalid("no receipt printer registered".into()))?;

    // Check printer status before printing
    let status = printer.get_status().await?;
    if status.has_fault() {
        return Err(BridgeError::Invalid(
            "Printer is not ready: check paper supply and cover".into(),
        ));
    }
    if status.paper != oz_hal::PaperStatus::Ok {
        tracing::warn!(
            paper = ?status.paper,
            "printer paper is low, continuing"
        );
    }

    let receipt = receipt::SalesReceipt {
        store: store_info,
        date: args.date,
        receipt_number: args.receipt_number,
        table_number: args.table_number,
        items: args
            .items
            .into_iter()
            .map(|i| {
                Ok::<_, BridgeError>(receipt::LineItem {
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
                Ok::<_, BridgeError>(receipt::PaymentInfo {
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

    if let Some(sink) = &ctx.emitter {
        sink.emit(
            "receipt:printed",
            serde_json::json!({ "lines": line_count }),
        );
    }

    Ok(PrintSalesReceiptResult { printed: true })
}

// ── Barcode scanner ──────────────────────────────────────

#[derive(Debug, Serialize)]
/// Scannerinfo.
pub struct ScannerInfo {
    /// Unique identifier.
    pub id: String,
}

// ── Customer Display ───────────────────────────────────

#[derive(Debug, Deserialize)]
/// Displayshowargs.
pub struct DisplayShowArgs {
    /// ID of the associated display.
    pub display_id: String,
    /// Line1.
    pub line1: String,
    /// Line2.
    pub line2: String,
}

// ── Scoped variants (ADR #7) ────────────────────────────────────

/// Open cash drawer (scoped — requires valid session).
///
/// # Errors
///
/// [`BridgeError::InvalidSession`] for an unknown or expired token;
/// [`BridgeError::PermissionDenied`] without `payments:cash`;
/// [`BridgeError::Invalid`] when no drawer is registered under the resolved
/// id; HAL errors surface as the hardware mirror of the shell's mapping.
pub async fn open_cash_drawer_scoped(
    ctx: &BridgeCtx<'_>,
    args: OpenCashDrawerArgs,
    session_token: &str,
) -> Result<OpenCashDrawerResult, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::PAYMENTS_CASH)
        .await?;
    ctx.resolve_scope(session_token)?;
    let id = args.device_id.as_deref().unwrap_or("default");
    let drawer = ctx
        .registry
        .cash_drawer(id)
        .await
        .ok_or_else(|| BridgeError::Invalid(format!("no cash drawer registered as '{id}'")))?;
    drawer.open().await?;
    Ok(OpenCashDrawerResult { opened: true })
}

/// Print receipt (scoped — requires valid session).
///
/// # Errors
///
/// [`BridgeError::InvalidSession`], [`BridgeError::Invalid`] on printer
/// registration or fault, and HAL errors surfacing as the hardware mirror of
/// the shell's mapping.
pub async fn print_receipt_scoped(
    ctx: &BridgeCtx<'_>,
    args: PrintReceiptArgs,
    session_token: &str,
) -> Result<PrintReceiptResult, BridgeError> {
    ctx.resolve_scope(session_token)?;
    let printer = ctx
        .registry
        .printer("default")
        .await
        .ok_or_else(|| BridgeError::Invalid("no receipt printer registered".into()))?;
    let status = printer.get_status().await?;
    if status.has_fault() {
        return Err(BridgeError::Invalid(
            "Printer is not ready: check paper supply and cover".into(),
        ));
    }
    if status.paper != oz_hal::PaperStatus::Ok {
        tracing::warn!(paper = ?status.paper, "printer paper is low, continuing");
    }
    let lines: Vec<&str> = args.body.lines().collect();
    let n = lines.len();
    printer.print_receipt(&args.body).await?;
    if let Some(sink) = &ctx.emitter {
        sink.emit("receipt:printed", serde_json::json!({ "lines": n }));
    }
    Ok(PrintReceiptResult { printed_lines: n })
}

/// Move the preferred scanner to the front, leaving the rest in order.
///
/// A no-op when `preferred` is empty or matches nothing, which is the
/// common case: nothing in the UI writes `scanner_device_id` today.
pub fn prefer_first(mut scanners: Vec<ScannerInfo>, preferred: &str) -> Vec<ScannerInfo> {
    if preferred.is_empty() {
        return scanners;
    }
    if let Some(pos) = scanners.iter().position(|s| s.id == preferred) {
        let chosen = scanners.remove(pos);
        scanners.insert(0, chosen);
    }
    scanners
}

/// List all registered barcode scanners (scoped), preference-ordered.
///
/// `useBarcodeScanner.ts` auto-detects by taking element 0 and never asks
/// the operator, so fronting the saved `scanner_device_id` is the only way
/// that setting has any effect. Unset reads as an empty string and leaves
/// discovery's order alone.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`] for an unknown or expired token;
/// [`BridgeError::Core`] when the saved scanner setting cannot be read.
pub async fn list_scanners_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<ScannerInfo>, BridgeError> {
    ctx.resolve_scope(session_token)?;
    let ids = ctx.registry.scanner_ids().await;
    let preferred = {
        let conn = ctx.db.lock().await;
        Settings::get_scanner_device_id(&conn).unwrap_or_default()
    }; // guard dropped: Connection is !Send
    Ok(prefer_first(
        ids.into_iter().map(|id| ScannerInfo { id }).collect(),
        &preferred,
    ))
}

/// Start a barcode scanner (scoped).
///
/// Takes over the shell's scanner lifecycle: any running scanner is cancelled
/// first, the driver is resolved from the registry, and a poll task is spawned
/// that broadcasts `barcode:scanned` / `barcode:error` through the injected
/// [`EventSink`]. The cancel handle is stored in
/// [`BridgeCtx::scanner_cancel`] for [`stop_scanner_scoped`].
///
/// # Errors
///
/// [`BridgeError::InvalidSession`] for an unknown or expired token;
/// [`BridgeError::Invalid`] when no scanner is registered under `scanner_id`;
/// [`BridgeError::Internal`]`("AppHandle unavailable")` when no event sink is
/// configured (the headless case — the shell could not emit scan events, so
/// starting a scanner would be silent).
pub async fn start_scanner_scoped(
    ctx: &BridgeCtx<'_>,
    scanner_id: &str,
    session_token: &str,
) -> Result<(), BridgeError> {
    ctx.resolve_scope(session_token)?;
    {
        let mut cancel = ctx.scanner_cancel.lock().await;
        if let Some(sender) = cancel.take() {
            let _ = sender.send(());
        }
    }
    let driver: Arc<dyn BarcodeScanner> =
        ctx.registry.scanner(scanner_id).await.ok_or_else(|| {
            BridgeError::Invalid(format!("no scanner registered as '{scanner_id}'"))
        })?;
    let sink = ctx
        .emitter
        .clone()
        .ok_or_else(|| BridgeError::Internal("AppHandle unavailable".into()))?;
    let scanner_id = scanner_id.to_string();
    let (tx, mut rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        let mut scanner = match driver.connect().await {
            Ok(s) => s,
            Err(e) => {
                tracing::error!(scanner = %scanner_id, error = %e, "scanner connect failed");
                sink.emit(
                    "barcode:error",
                    serde_json::json!({ "error": e.to_string() }),
                );
                return;
            }
        };
        tracing::info!(scanner = %scanner_id, "barcode scanner started");
        loop {
            tokio::select! {
                _ = &mut rx => {
                    tracing::info!(scanner = %scanner_id, "barcode scanner stopped");
                    break;
                }
                result = scanner.poll(300) => {
                    match result {
                        Ok(Some(barcode)) => {
                            let payload = serde_json::json!({
                                "code": barcode.code,
                                "symbology": format!("{:?}", barcode.symbology),
                            });
                            sink.emit("barcode:scanned", payload);
                        }
                        Ok(None) => {}
                        Err(e) => {
                            tracing::warn!(scanner = %scanner_id, error = %e, "scanner poll error");
                            sink.emit("barcode:error", serde_json::json!({ "error": e.to_string() }));
                            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                        }
                    }
                }
            }
        }
    });
    ctx.scanner_cancel.lock().await.replace(tx);
    Ok(())
}

/// Stop the active barcode scanner (scoped).
///
/// # Errors
///
/// [`BridgeError::InvalidSession`] for an unknown or expired token.
pub async fn stop_scanner_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<(), BridgeError> {
    ctx.resolve_scope(session_token)?;
    let mut cancel = ctx.scanner_cancel.lock().await;
    if let Some(sender) = cancel.take() {
        let _ = sender.send(());
    }
    Ok(())
}

/// List all registered customer displays (scoped).
///
/// # Errors
///
/// [`BridgeError::InvalidSession`] for an unknown or expired token.
pub async fn list_displays_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<String>, BridgeError> {
    ctx.resolve_scope(session_token)?;
    Ok(ctx.registry.display_ids().await)
}

/// Show content on a customer-facing pole display (scoped).
///
/// # Errors
///
/// [`BridgeError::InvalidSession`], [`BridgeError::Invalid`] when no
/// display is registered under the id, and HAL errors surfacing as the
/// hardware mirror of the shell's mapping.
pub async fn display_show_scoped(
    ctx: &BridgeCtx<'_>,
    args: DisplayShowArgs,
    session_token: &str,
) -> Result<(), BridgeError> {
    ctx.resolve_scope(session_token)?;
    let display = ctx
        .registry
        .display(&args.display_id)
        .await
        .ok_or_else(|| {
            BridgeError::Invalid(format!("no display registered as '{}'", args.display_id))
        })?;
    let content = DisplayContent {
        line1: args.line1,
        line2: args.line2,
    };
    display.connect().await?;
    display.show(&content).await?;
    Ok(())
}

/// Discover all connected USB hardware devices (scoped).
///
/// # Errors
///
/// [`BridgeError::InvalidSession`]; [`BridgeError::Internal`] when the USB
/// probe itself fails (message text verbatim from the shell).
pub async fn discover_hardware_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<UsbDeviceInfo>, BridgeError> {
    ctx.resolve_scope(session_token)?;
    match probe_all() {
        Ok(devices) => Ok(devices),
        Err(e) => Err(BridgeError::Internal(format!(
            "hardware discovery failed: {e}"
        ))),
    }
}

/// Clear a customer-facing pole display (scoped).
///
/// # Errors
///
/// [`BridgeError::InvalidSession`], [`BridgeError::Invalid`] when no
/// display is registered under the id, and HAL errors surfacing as the
/// hardware mirror of the shell's mapping.
pub async fn display_clear_scoped(
    ctx: &BridgeCtx<'_>,
    display_id: &str,
    session_token: &str,
) -> Result<(), BridgeError> {
    ctx.resolve_scope(session_token)?;
    let display =
        ctx.registry.display(display_id).await.ok_or_else(|| {
            BridgeError::Invalid(format!("no display registered as '{display_id}'"))
        })?;
    display.clear().await?;
    Ok(())
}

#[cfg(test)]
#[path = "hardware_tests.rs"]
mod hardware_tests;
