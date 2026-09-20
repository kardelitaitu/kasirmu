//! Tests for the Android Bluetooth transport (run only on the Android
//! target — the module itself is `cfg(target_os = "android")`).
//!
//! Unit tests never run inside a JVM (no `JNI_OnLoad` fires under `cargo
//! test`), so the no-VM error paths are deterministic and are exactly the
//! graceful-degradation contract the module documents.

use super::*;

#[test]
fn spp_uuid_is_the_standard_spp_service() {
    assert_eq!(SPP_UUID, "00001101-0000-1000-8000-00805F9B34FB");
    // java.util.UUID.fromString accepts exactly the canonical 8-4-4-4-12 form.
    assert_eq!(SPP_UUID.len(), 36);
    assert_eq!(SPP_UUID.matches('-').count(), 4);
}

#[test]
fn transport_fails_plainly_without_a_captured_vm() {
    // `cargo test` never loads the library through ART, so JNI_OnLoad has
    // not run and the VM slot is empty. The entry point must return a
    // plain HalError::Bluetooth — never panic, never abort.
    match paired_devices() {
        Err(HalError::Bluetooth(msg)) => {
            assert!(
                msg.contains("JNI VM not captured"),
                "unexpected message: {msg}"
            );
        }
        Ok(devices) => panic!("paired_devices() succeeded without a VM: {devices:?}"),
        Err(other) => panic!("unexpected non-Bluetooth error: {other:?}"),
    }
}
