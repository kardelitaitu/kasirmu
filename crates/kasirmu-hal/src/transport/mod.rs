/*
last audited 25-07-26 by RSA-Agent (kasirmu-hal slice A: verified)
crate: kasirmu-hal | status: SAFE | lint: CLEAN
findings: clean
next: none | perf: N/A
*/
/// Android APK signing-certificate fingerprint (ADR #57 §2.1, client leg).
///
/// Android-only, and deliberately a sibling of `bt_android` rather than a
/// second JNI bridge: that module owns the single `JNI_OnLoad` symbol, and this
/// one borrows its captured VM through `bt_android::with_env`.
#[cfg(target_os = "android")]
pub mod apk_signature;
/// Android Bluetooth (SPP/RFCOMM) transport — JNI over BluetoothSocket.
#[cfg(target_os = "android")]
pub mod bt_android;
pub mod serial;
pub mod tcp;
pub mod usb;
