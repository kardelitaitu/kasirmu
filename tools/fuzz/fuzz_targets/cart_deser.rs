//! Fuzz target for Cart JSON deserialization — feeds arbitrary
//! JSON byte sequences to `serde_json::from_str` and verifies
//! no panics during deserialization.
//!
//! The canonical cart types live in `foundation` (kasirmu-core re-exports them;
//! the former `kasirmu_core::Sale` type was removed with the migration).
//!
//! Requires `kasirmu-core-fuzz` feature (adds bundled SQLite via kasirmu-core):
//!   `cargo fuzz run --features kasirmu-core-fuzz cart_deser`

#![no_main]

use libfuzzer_sys::fuzz_target;

#[cfg(feature = "kasirmu-core-fuzz")]
fuzz_target!(|data: &[u8]| {
    if let Ok(s) = std::str::from_utf8(data) {
        // Attempt to deserialize a Cart from arbitrary JSON.
        // This must never panic — only return Err or Ok.
        let _result: Result<foundation::cart::Cart, _> = serde_json::from_str(s);
    }
});

#[cfg(not(feature = "kasirmu-core-fuzz"))]
fuzz_target!(|_data: &[u8]| {
    // Stub: kasirmu-core-fuzz feature not enabled. Run with:
    //   cargo fuzz run --features kasirmu-core-fuzz cart_deser
});
