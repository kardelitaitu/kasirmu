/*
last audited 25-07-26 by RSA-Agent (kasirmu-hal slice A: verified)
crate: kasirmu-hal | status: SAFE | lint: CLEAN
findings: clean
next: none | perf: N/A
*/
/// Android Bluetooth (SPP/RFCOMM) transport — JNI over BluetoothSocket.
#[cfg(target_os = "android")]
pub mod bt_android;
pub mod serial;
pub mod tcp;
pub mod usb;
