//! External-browser URL construction (ADR #38) — the tauri-free half of
//! apps/desktop-tauri/src/commands/browser.rs.
//!
//! Key items: build_image_query (product name + optional brand), urlencoding
//! (the percent-encoder for the query component) and product_image_search_url,
//! which resolves the session's store, reads the product row and returns the
//! finished https-only URL.
//!
//! The actual open does NOT live here: `open_in_browser` shells out to the platform
//! opener through `tauri-plugin-opener`, a Tauri plugin dependency the bridge is
//! forbidden to carry, so it stays in the desktop shell and receives the URL this
//! module builds. Query text is taken from the database, never from the caller,
//! and the encoding rules, the NotFound message and the lock scope are
//! byte-identical to the original body.

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// Build the Google Images search query: product name plus brand (when set).
pub fn build_image_query(product: &kasirmu_core::Product) -> String {
    let mut query = product.name.trim().to_owned();
    if let Some(brand) = product
        .brand
        .as_deref()
        .map(str::trim)
        .filter(|b| !b.is_empty())
    {
        query.push(' ');
        query.push_str(brand);
    }
    query
}

/// Percent-encode a UTF-8 query for use in a URL query component.
pub fn urlencoding(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// Resolve the product and build its Google Images search URL.
///
/// # Errors
///
/// Returns BridgeError::InvalidSession for a bad token, BridgeError::Core
/// (NotFound) when the SKU is unknown, and BridgeError::Internal for a poisoned
/// store lock or a database read failure.
pub async fn product_image_search_url(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    sku: &str,
) -> Result<String, BridgeError> {
    // Resolve the session so only signed-in store sessions can trigger
    // browser opening, and read the product's name/brand from the DB
    // (never trust the frontend with the query text).
    let conn = ctx.resolve_store(session_token)?;
    // Scope the DB borrow so `Store` (!Send) is dropped before the await
    // below; only the owned query string crosses the await point.
    let query = {
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        let store = kasirmu_core::db::Store::new(&db);
        let product = store.get_product(sku)?.ok_or_else(|| BridgeError::Core {
            sub_kind: kasirmu_core::CoreErrorKind::NotFound,
            message: format!("product {sku} not found"),
        })?;
        build_image_query(&product.product)
    };

    let url = format!(
        "https://www.google.com/search?tbm=isch&q={}",
        urlencoding(&query)
    );

    Ok(url)
}

#[cfg(test)]
#[path = "browser_tests.rs"]
mod browser_tests;
