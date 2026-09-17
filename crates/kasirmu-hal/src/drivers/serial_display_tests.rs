use super::*;

#[test]
fn write_line_pads_to_20_cols() {
    let cmd = write_line("HELLO");
    // 2-byte CMD_WRITE + 20 chars + CR
    assert_eq!(cmd.len(), 2 + 20 + 1);
    assert!(cmd.starts_with(&[0x1B, b'D']));
    assert_eq!(&cmd[2..7], b"HELLO");
    assert_eq!(cmd[2 + 20], b'\r');
    // The padding should be spaces.
    for &b in &cmd[7..2 + 20] {
        assert_eq!(b, b' ', "remaining chars should be spaces");
    }
}

#[test]
fn write_line_truncates_long_text() {
    let long = "A".repeat(30);
    let cmd = write_line(&long);
    assert_eq!(cmd.len(), 2 + 20 + 1);
    assert_eq!(&cmd[2..2 + 20], b"A".repeat(20).as_slice());
}

#[test]
fn discover_does_not_panic() {
    let displays = SerialCustomerDisplay::discover_all();
    assert!(displays.is_empty() || !displays.is_empty());
}

#[test]
fn device_info_roundtrip() {
    let info = DeviceInfo::new("Test", "PoleDisplay", "COM5");
    let d = SerialCustomerDisplay::new("COM5", 9600, info.clone());
    assert_eq!(d.device_info(), info);
}

#[tokio::test]
async fn set_brightness_returns_not_supported() {
    let info = DeviceInfo::new("Test", "PoleDisplay", "COM6");
    let d = SerialCustomerDisplay::new("COM6", 9600, info);
    let err = d.set_brightness(0.5).await.unwrap_err();
    assert!(matches!(err, HalError::Protocol(_)));
}
