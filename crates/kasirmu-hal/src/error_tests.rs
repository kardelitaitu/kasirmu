use super::*;

#[test]
fn not_found_displays_id() {
    let e = HalError::NotFound("scanner-01".into());
    assert_eq!(e.to_string(), "device not found: scanner-01");
}

#[test]
fn timeout_displays_ms() {
    let e = HalError::Timeout(250);
    assert_eq!(e.to_string(), "operation timed out after 250 ms");
}

#[test]
fn io_conversion_via_from() {
    let io = std::io::Error::new(std::io::ErrorKind::NotFound, "no such file");
    let e: HalError = io.into();
    assert!(matches!(e, HalError::Io(_)));
}

#[test]
fn disconnected_display() {
    let e = HalError::Disconnected;
    assert_eq!(e.to_string(), "device disconnected");
}

#[test]
fn usb_display() {
    let e = HalError::Usb("permission denied".into());
    assert_eq!(e.to_string(), "usb error: permission denied");
}

#[test]
fn bluetooth_display() {
    let e = HalError::Bluetooth("adapter not found".into());
    assert_eq!(e.to_string(), "bluetooth error: adapter not found");
}

#[test]
fn protocol_display() {
    let e = HalError::Protocol("unexpected NAK".into());
    assert_eq!(e.to_string(), "protocol error: unexpected NAK");
}

#[test]
fn busy_display() {
    let e = HalError::Busy;
    assert_eq!(e.to_string(), "device busy");
}
