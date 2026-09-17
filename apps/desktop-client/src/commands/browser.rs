//! External-browser commands (ADR #38).
//!
//! `open_product_images_scoped` opens the OS default browser in a new
//! tab at a Google Images search for a product's name (+ brand when
//! set). This is the app's first browser-opening mechanism, exposed
//! through `tauri-plugin-opener` with an https-only, percent-encoded
//! URL built server-side.
//!
//! Wave F: the URL construction moved to `kasirmu_bridge::browser` so the query
//! builder and the percent-encoder are callable headlessly. `open_in_browser`
//! deliberately STAYS here, body byte-identical, because it hands the finished URL
//! to `tauri-plugin-opener::open_url` — a Tauri plugin the bridge must never
//! depend on. The gate order (resolve_store, then the scoped lock, then the read)
//! and every error string are unchanged; `urlencoding` is re-exported so the
//! sibling `browser_tests.rs` keeps exercising it by name.

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

pub use kasirmu_bridge::browser::urlencoding;

/// Open a Google Images search for a product in the default browser.
///
/// ADR #38 D2/D3: the query is `name` plus `brand` (when the product
/// has one), percent-encoded server-side. The URL is https-only and
/// never reflects user-controlled input outside the query string.
///
/// Returns `Ok(())` when the opener accepted the request.
#[tauri::command]
pub async fn open_product_images_scoped(
    session_token: String,
    sku: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    let url = kasirmu_bridge::browser::product_image_search_url(&ctx, &session_token, &sku).await?;

    open_in_browser(&url).await
}

/// Open a URL in the OS default browser via `tauri-plugin-opener`.
async fn open_in_browser(url: &str) -> Result<(), AppError> {
    tauri_plugin_opener::open_url(url, None::<&str>)
        .map_err(|e| AppError::Internal(format!("opening browser: {e}")))
}
