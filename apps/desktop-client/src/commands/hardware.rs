//! Hardware-facing Tauri commands: cash drawer, receipt printer, and
//! barcode scanner lifecycle (start/stop/list). All commands reach into
//! the HAL via `state.registry` — they never construct a concrete driver.
//!
//! Wave D / D3a: the bodies now live in the headless
//! `oz_bridge::hardware` module. Each `#[tauri::command]` below keeps its
//! exact name, parameter list, attributes and `Result<_, AppError>` wire
//! contract; it builds a `BridgeCtx` from `AppState` and delegates. UI
//! events ride the bridge's injected `EventSink` and the scanner poll task
//! is spawned inside the bridge; the DTOs moved with the bodies and are
//! re-exported so `use super::*` in `hardware_tests.rs` still resolves
//! them. `prefer_first` stays as a local adapter — the sibling test module
//! calls it directly.

use tauri::State;

use kasirmu_hal::transport::usb::UsbDeviceInfo;

use crate::error::AppError;
use crate::state::AppState;

pub use oz_bridge::hardware::{
    DisplayShowArgs, LineItemDto, MoneyDto, OpenCashDrawerArgs, OpenCashDrawerResult, PaymentDto,
    PrintReceiptArgs, PrintReceiptResult, PrintSalesReceiptArgs, PrintSalesReceiptResult,
    ScannerInfo,
};

/// Print sales receipt for the store resolved from a session token. ADR #7.
/// Settings (store name, address, receipt config) are loaded from the
/// store-scoped database, while the printer hardware itself is not
/// store-specific.
#[tauri::command]
pub async fn print_sales_receipt_scoped(
    session_token: String,
    args: PrintSalesReceiptArgs,
    state: State<'_, AppState>,
) -> Result<PrintSalesReceiptResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::hardware::print_sales_receipt_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Async inner: format and print receipt (no DB reference — all config
/// already loaded). Retained as a shim adapter under the keep-every-`run_*`
/// rule; the body lives in `oz_bridge::hardware::run_print_receipt_inner`.
pub async fn run_print_receipt_inner(
    args: PrintSalesReceiptArgs,
    config: kasirmu_hal::drivers::receipt::ReceiptConfig,
    store_info: kasirmu_hal::drivers::receipt::StoreInfo,
    state: State<'_, AppState>,
) -> Result<PrintSalesReceiptResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::hardware::run_print_receipt_inner(&ctx, args, config, store_info)
        .await
        .map_err(Into::into)
}

/// Open cash drawer (scoped — requires valid session).
#[tauri::command]
pub async fn open_cash_drawer_scoped(
    args: OpenCashDrawerArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<OpenCashDrawerResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::hardware::open_cash_drawer_scoped(&ctx, args, &session_token)
        .await
        .map_err(Into::into)
}

/// Print receipt (scoped — requires valid session).
#[tauri::command]
pub async fn print_receipt_scoped(
    args: PrintReceiptArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<PrintReceiptResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::hardware::print_receipt_scoped(&ctx, args, &session_token)
        .await
        .map_err(Into::into)
}

/// Shim adapter retained for the sibling test module, which reaches
/// `prefer_first` through its glob import of this module; the command body
/// calls the bridge's copy.
#[allow(dead_code)] // sibling hardware_tests.rs depends on it
fn prefer_first(scanners: Vec<ScannerInfo>, preferred: &str) -> Vec<ScannerInfo> {
    oz_bridge::hardware::prefer_first(scanners, preferred)
}

/// List all registered barcode scanners (scoped), preference-ordered.
///
/// `useBarcodeScanner.ts` auto-detects by taking element 0 and never asks
/// the operator, so fronting the saved `scanner_device_id` is the only way
/// that setting has any effect. Unset reads as an empty string and leaves
/// discovery's order alone.
#[tauri::command]
pub async fn list_scanners_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<ScannerInfo>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::hardware::list_scanners_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Start a barcode scanner (scoped).
#[tauri::command]
pub async fn start_scanner_scoped(
    scanner_id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::hardware::start_scanner_scoped(&ctx, &scanner_id, &session_token)
        .await
        .map_err(Into::into)
}

/// Stop the active barcode scanner (scoped).
#[tauri::command]
pub async fn stop_scanner_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::hardware::stop_scanner_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// List all registered customer displays (scoped).
#[tauri::command]
pub async fn list_displays_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::hardware::list_displays_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Show content on a customer-facing pole display (scoped).
#[tauri::command]
pub async fn display_show_scoped(
    args: DisplayShowArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::hardware::display_show_scoped(&ctx, args, &session_token)
        .await
        .map_err(Into::into)
}

/// Discover all connected USB hardware devices (scoped).
#[tauri::command]
pub async fn discover_hardware_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<UsbDeviceInfo>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::hardware::discover_hardware_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Clear a customer-facing pole display (scoped).
#[tauri::command]
pub async fn display_clear_scoped(
    display_id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::hardware::display_clear_scoped(&ctx, &display_id, &session_token)
        .await
        .map_err(Into::into)
}
