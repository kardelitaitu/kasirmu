//! Fuzz target for SKU parsing — feeds arbitrary byte sequences to
//! `Sku`'s fallible constructor and verifies no panics on the accept
//! path, plus the invariants `Sku` actually guarantees.

#![no_main]

use libfuzzer_sys::fuzz_target;
use foundation::sku::Sku;

fuzz_target!(|data: &[u8]| {
    if let Ok(s) = std::str::from_utf8(data) {
        // Empty / whitespace-only input is a *legitimate rejection*:
        // `Sku::new` panics by contract on such input, so the harness
        // must use the fallible constructor and treat rejection as the
        // expected outcome rather than a crash.
        if let Some(sku) = Sku::try_new(s) {
            // Accepted SKUs are trimmed — no leading/trailing whitespace.
            assert_eq!(
                sku.as_str().trim(),
                sku.as_str(),
                "accepted SKU must be trimmed"
            );

            // Display must round-trip to the same value.
            assert_eq!(
                sku.to_string(),
                sku.as_str(),
                "Display round-trip mismatch"
            );
        }
    }
});
