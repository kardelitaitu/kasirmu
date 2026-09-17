use super::*;

#[test]
fn raw_port_is_9100() {
    assert_eq!(RAW_PORT, 9100);
}

#[test]
fn connect_timeout_is_reasonable() {
    const {
        assert!(CONNECT_TIMEOUT_SECS > 0 && CONNECT_TIMEOUT_SECS <= 30);
    }
}
