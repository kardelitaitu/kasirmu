//! Fuzz target for plugin manifest parsing and validation (PLG-08 boundary).
//!
//! Feeds arbitrary UTF-8 as a `plugin.toml` through the same path the
//! loader uses: TOML deserialization into `PluginManifest` followed by
//! `validate()`. The manifest schema now rejects unknown fields
//! (`deny_unknown_fields`), unknown permissions, invalid plugin IDs and
//! SemVer versions — the fuzz target proves no byte sequence can panic
//! the deserializer or the validator, and that every input either parses
//! into a valid manifest or fails with an error.
//!
//! A panic here is a real bug in the manifest schema code — CI uploads
//! the crashing input as an artifact.
//!
//! This target requires the `kasirmu-plugin-fuzz` feature:
//!   `cargo fuzz run --features kasirmu-plugin-fuzz manifest_parse`

#![no_main]

use libfuzzer_sys::fuzz_target;

// When kasirmu-plugin-fuzz feature is not enabled, compile a no-op stub so the
// binary still links cleanly without pulling in kasirmu-plugin's C deps.
#[cfg(feature = "kasirmu-plugin-fuzz")]
use kasirmu_plugin::manifest::PluginManifest;

#[cfg(feature = "kasirmu-plugin-fuzz")]
fuzz_target!(|data: &[u8]| {
    // Manifests are TOML text; non-UTF-8 bytes are simply not manifests.
    if let Ok(text) = std::str::from_utf8(data) {
        match toml::from_str::<PluginManifest>(text) {
            Ok(manifest) => {
                // A parseable manifest must still pass schema validation
                // without panicking (invalid IDs/versions/names reject).
                let _ = manifest.validate();
            }
            Err(_) => {
                // Malformed TOML / unknown fields / unknown permissions /
                // bad shapes are expected rejections — no panic allowed.
            }
        }
    }
});

#[cfg(not(feature = "kasirmu-plugin-fuzz"))]
fuzz_target!(|_data: &[u8]| {
    // Stub: kasirmu-plugin-fuzz feature not enabled. Run with:
    //   cargo fuzz run --features kasirmu-plugin-fuzz manifest_parse
});
