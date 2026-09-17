//! Media storage — STUB test placeholder.
//!
//! Tests will be added when the real backends are implemented.

use crate::MediaError;
use crate::storage::{LocalStorage, MediaStorage};

#[tokio::test]
async fn stub_returns_not_implemented() {
    let store = LocalStorage::new("/tmp/media");
    let result = store
        .put(
            "products/a/photo.jpg",
            vec![1, 2, 3],
            crate::ImageFormat::Jpeg,
        )
        .await;
    assert!(
        matches!(result, Err(MediaError::NotImplemented(_))),
        "expected NotImplemented error, got {result:?}"
    );
}
