//! Relocated browser-command tests (Wave-F test relocation: moved out of
//! `apps/desktop-client/src/commands/browser_tests.rs`, since renamed to desktop-tauri).
//!
//! Mounted at the foot of `browser.rs` with `#[cfg(test)] #[path]`, so
//! `use super::*` resolves the percent-encoder `urlencoding` (defined in
//! this module) exactly as the desktop re-export did. Pure-encoder cases:
//! no context, no harness, assertions unchanged.

use super::*;

#[test]
fn urlencoding_encodes_query() {
    assert_eq!(urlencoding("Coca Cola"), "Coca+Cola");
    assert_eq!(urlencoding("Indomie&Co"), "Indomie%26Co");
    assert_eq!(urlencoding("Bakso 100%"), "Bakso+100%25");
    assert_eq!(urlencoding("日本語"), "%E6%97%A5%E6%9C%AC%E8%AA%9E");
}

#[test]
fn urlencoding_keeps_unreserved_chars() {
    assert_eq!(urlencoding("a-z_A.Z~0"), "a-z_A.Z~0");
}

#[tokio::test]
async fn product_image_search_url_refuses_session_lacking_products_read() {
    let bridge = crate::testing::TestBridge::new();
    let token = bridge.token_granting(permissions::CUSTOMERS_VIEW).await;
    let ctx = bridge.ctx();

    let err = product_image_search_url(&ctx, &token, "SKU-123")
        .await
        .unwrap_err();
    assert!(
        matches!(err, BridgeError::PermissionDenied(_)),
        "expected PermissionDenied, got: {err:?}"
    );
}

#[tokio::test]
async fn product_image_search_url_accepts_session_with_products_read() {
    let bridge = crate::testing::TestBridge::new();
    let token = bridge.token_granting(permissions::PRODUCTS_READ).await;
    let ctx = bridge.ctx();

    // Past permission gate, but product does not exist -> NotFound
    let err = product_image_search_url(&ctx, &token, "SKU-NOTFOUND")
        .await
        .unwrap_err();
    assert!(
        matches!(
            err,
            BridgeError::Core {
                sub_kind: kasirmu_core::CoreErrorKind::NotFound,
                ..
            }
        ),
        "expected NotFound core error past permission gate, got: {err:?}"
    );
}
