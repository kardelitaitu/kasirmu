//! External-browser commands (ADR #38).
//!
//! `open_product_images` opens the OS default browser in a new tab at a
//! Google Images search for a product's name (+ brand when set), via
//! `tauri-plugin-opener` with an https-only, percent-encoded URL built
//! server-side. Tablet variant of the desktop `open_product_images_scoped`
//! (global-db, non-scoped — matches the tablet's other product commands).
//!
//! Phase 3.3 T2: the URL-building half moved to the shared
//! `kasirmu_bridge::browser` module (Agent 2's Wave F extraction); the helpers
//! are re-exported so the sibling `browser_tests.rs` keeps exercising
//! them by name. The body stays tablet-native this slice (global-db
//! `Store` read, no BridgeCtx) because the tablet `AppState` cannot yet
//! build one — see the T2 seam notes in `void.rs`. The desktop twin
//! (`open_product_images_scoped`) is store-scoped through
//! `BridgeCtx::resolve_store`; the tablet command reads the global db
//! like every other tablet product command, so only the pure helpers
//! are shared, not the resolution.

use tauri::{State, command};

use crate::error::AppError;
use crate::state::AppState;

pub use kasirmu_bridge::browser::{build_image_query, urlencoding};

/// Open a Google Images search for a product in the default browser.
///
/// ADR #38 D2/D3: the query is `name` plus `brand` (when the product
/// has one), percent-encoded server-side. The URL is https-only.
#[command]
pub async fn open_product_images(sku: String, state: State<'_, AppState>) -> Result<(), AppError> {
    let query = {
        let db = state.db.lock().await;
        let store = kasirmu_core::db::Store::new(&db);
        let product = store.get_product(&sku)?.ok_or_else(|| AppError::Core {
            sub_kind: kasirmu_core::CoreErrorKind::NotFound,
            message: format!("product {sku} not found"),
        })?;
        build_image_query(&product.product)
    };

    let url = format!(
        "https://www.google.com/search?tbm=isch&q={}",
        urlencoding(&query)
    );

    open_in_browser(&url).await
}

/// Open a URL in the OS default browser via `tauri-plugin-opener`.
/// Shared with the device-link command (ADR #54 §2.5), which hands it the consent URL.
pub(crate) async fn open_in_browser(url: &str) -> Result<(), AppError> {
    tauri_plugin_opener::open_url(url, None::<&str>)
        .map_err(|e| AppError::Internal(format!("opening browser: {e}")))
}

#[cfg(test)]
#[path = "browser_tests.rs"]
mod tests;
