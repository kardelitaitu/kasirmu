//! Re-export shim: the image push scheduler now lives in `platform_sync`.
//!
//! The implementation moved to `platform/sync/src/image_push.rs` so the daemon
//! can build and run headless. The module declaration in `lib.rs` still points
//! here, so every call site (`crate::image_push::ImagePushScheduler`) compiles
//! unchanged. Tests moved with the implementation to the owning crate.

pub use platform_sync::image_push::*;
