use super::*;

// ── Construction ─────────────────────────────────────────────

#[test]
fn new_discoverer_creates_unstarted() {
    let d = LanDiscoverer::new("term-1", "counter_pos", 9180);
    assert_eq!(d.terminal_id, "term-1");
    assert_eq!(d.role, "counter_pos");
    assert_eq!(d.tcp_port, 9180);
    assert!(!d.is_running());
    assert!(d.daemon.is_none());
}

#[test]
fn new_discoverer_accepts_any_string_types() {
    let d = LanDiscoverer::new(String::from("term-kds"), "kds_kiosk", 9180);
    assert_eq!(d.terminal_id, "term-kds");
    assert_eq!(d.role, "kds_kiosk");
}

#[test]
fn new_discoverer_kds_role() {
    let d = LanDiscoverer::new("kds-01", "kds_kiosk", 0);
    assert_eq!(d.role, "kds_kiosk");
}

#[test]
fn new_discoverer_unrestricted_role() {
    let d = LanDiscoverer::new("admin-01", "unrestricted", 3099);
    assert_eq!(d.role, "unrestricted");
}

#[test]
fn new_discoverer_zero_port() {
    let d = LanDiscoverer::new("t", "counter_pos", 0);
    assert_eq!(d.tcp_port, 0);
}

#[test]
fn new_discoverer_max_port() {
    let d = LanDiscoverer::new("t", "counter_pos", 65535);
    assert_eq!(d.tcp_port, 65535);
}

// ── Build service info (unit-level, no daemon) ──────────────

#[test]
fn build_service_info_succeeds() {
    let d = LanDiscoverer::new("term-1", "counter_pos", 9180);
    let info = d.build_service_info().unwrap();
    let fullname = info.get_fullname();
    assert!(
        fullname.contains("term-1"),
        "fullname should contain the instance name: {fullname}"
    );
    assert!(
        fullname.contains("_oz-pos._tcp.local."),
        "fullname should contain service type: {fullname}"
    );
    assert_eq!(info.get_port(), 9180);
    assert_eq!(info.get_property_val_str("terminal_id"), Some("term-1"));
    assert_eq!(info.get_property_val_str("role"), Some("counter_pos"));
    assert_eq!(info.get_property_val_str("tcp_port"), Some("9180"));
    assert!(info.is_addr_auto(), "addr_auto should be enabled");
}

#[test]
fn build_service_info_empty_terminal_id() {
    let d = LanDiscoverer::new("", "counter_pos", 9180);
    let info = d.build_service_info().unwrap();
    // Empty terminal_id produces hostname ".local." — mdns-sd accepts
    // it but the service instance name will be empty.
    assert!(info.get_fullname().starts_with("."));
}

#[test]
fn build_service_info_long_instance_name() {
    let long = "a".repeat(63);
    let d = LanDiscoverer::new(&long, "counter_pos", 9180);
    let info = d.build_service_info().unwrap();
    assert!(info.get_fullname().contains(&long));
}

#[test]
fn build_service_info_properties_match_input() {
    let d = LanDiscoverer::new("t-42", "kds_kiosk", 8080);
    let info = d.build_service_info().unwrap();
    assert_eq!(info.get_property_val_str("terminal_id"), Some("t-42"));
    assert_eq!(info.get_property_val_str("role"), Some("kds_kiosk"));
    assert_eq!(info.get_property_val_str("tcp_port"), Some("8080"));
}

// ── Start/stop lifecycle ───────────────────────────────────—

#[test]
fn start_stop_lifecycle() {
    let mut d = LanDiscoverer::new("lifecycle-test", "counter_pos", 9180);
    assert!(!d.is_running());

    d.start().unwrap();
    assert!(d.is_running());

    // double-start is a no-op
    d.start().unwrap();
    assert!(d.is_running());

    d.stop().unwrap();
    assert!(!d.is_running());

    // double-stop is a no-op
    d.stop().unwrap();
    assert!(!d.is_running());
}

#[test]
fn start_stop_cycle_twice() {
    let mut d = LanDiscoverer::new("cycle-twice", "counter_pos", 9180);

    d.start().unwrap();
    assert!(d.is_running());
    d.stop().unwrap();
    assert!(!d.is_running());

    d.start().unwrap();
    assert!(d.is_running());
    d.stop().unwrap();
    assert!(!d.is_running());
}

#[test]
fn stop_before_start_is_noop() {
    let mut d = LanDiscoverer::new("noop", "counter_pos", 9180);
    d.stop().unwrap();
    assert!(!d.is_running());
}

// ── Debug output ─────────────────────────────────────────────

#[test]
fn debug_output_contains_fields() {
    let d = LanDiscoverer::new("term-debug", "counter_pos", 9180);
    let debug = format!("{d:?}");
    assert!(debug.contains("term-debug"));
    assert!(debug.contains("counter_pos"));
    assert!(debug.contains("9180"));
    assert!(debug.contains("None"), "daemon should be None");
}

#[test]
fn discoverer_is_not_clone() {
    fn assert_not_clone<T>() {}
    assert_not_clone::<LanDiscoverer>();
}
