//! Startup hardware registration — profile mapping and profile loading.

use std::path::Path;

use platform_core::terminal_profile::TerminalProfile;
use rusqlite::Connection;

use super::*;
use kasirmu_hal::bootstrap::Connection as HalConnection;

/// Build a profile from a partial JSON object. Every field carries a serde
/// default, so this also pins forward-compatibility: an old profile missing
/// newer keys must still load.
fn profile(json: &str) -> TerminalProfile {
    serde_json::from_str(json).expect("profile fields all have serde defaults")
}

fn create_profiles_table(conn: &Connection) {
    conn.execute_batch(
        "CREATE TABLE hardware_profiles (
             terminal_id    TEXT PRIMARY KEY,
             profile_json   TEXT NOT NULL,
             schema_version INTEGER NOT NULL DEFAULT 1,
             updated_at     TEXT NOT NULL DEFAULT ''
         );",
    )
    .expect("create table");
}

fn put_profile(conn: &Connection, terminal_id: &str, json: &str) {
    conn.execute(
        "INSERT INTO hardware_profiles (terminal_id, profile_json) VALUES (?1, ?2)",
        rusqlite::params![terminal_id, json],
    )
    .expect("insert profile");
}

// ── config_from_profile ──────────────────────────────────────────────

#[test]
fn every_profile_turns_scanner_autodetect_on() {
    // Barcode input depends on it: start_scanner_scoped looks the device up
    // by id and useBarcodeScanner.ts auto-detects with scanners[0], so with
    // nothing registering scanners both clients silently lose scanning.
    // Tested on an empty profile too — a first run has no printer configured
    // and must still see its scanner.
    for json in ["{}", r#"{"printer_connection":"disabled"}"#] {
        let cfg = config_from_profile(&profile(json));
        assert!(
            cfg.autodetect_scanners,
            "profile {json} must still enumerate scanners"
        );
    }
}

#[test]
fn autodetect_is_not_reported_as_a_configured_device() {
    // A fresh install enumerates but has configured nothing; if the flag
    // counted, the startup log would claim hardware the operator never set
    // up and is_empty() would never be true.
    let cfg = config_from_profile(&profile("{}"));
    assert!(cfg.is_empty(), "an empty profile configures no device");
    assert_eq!(cfg.len(), 0);
    assert!(cfg.autodetect_scanners);
}

#[test]
fn a_network_printer_becomes_the_id_the_receipt_path_looks_up() {
    let cfg = config_from_profile(&profile(
        r#"{"printer_connection":"network","printer_device_path":"10.0.0.5:9100"}"#,
    ));
    assert_eq!(cfg.printers.len(), 1);
    assert_eq!(cfg.printers[0].id, MAIN_PRINTER_ID);
    assert_eq!(
        cfg.printers[0].connection,
        HalConnection::Network {
            addr: "10.0.0.5:9100".into()
        }
    );
}

#[test]
fn kitchen_and_main_printers_get_distinct_ids() {
    let cfg = config_from_profile(&profile(
        r#"{
            "printer_connection":"network","printer_device_path":"10.0.0.5:9100",
            "kitchen_printer_connection":"network","kitchen_printer_device_path":"10.0.0.6:9100"
        }"#,
    ));
    assert_eq!(cfg.printers.len(), 2);
    assert_eq!(cfg.printers[0].id, MAIN_PRINTER_ID);
    assert_eq!(cfg.printers[1].id, KITCHEN_PRINTER_ID);
}

#[test]
fn a_disabled_kitchen_printer_does_not_shadow_a_working_one() {
    let cfg = config_from_profile(&profile(
        r#"{
            "printer_connection":"network","printer_device_path":"10.0.0.5:9100",
            "kitchen_printer_connection":"disabled","kitchen_printer_device_path":"10.0.0.6:9100"
        }"#,
    ));
    assert_eq!(cfg.printers.len(), 1);
    assert_eq!(cfg.printers[0].id, MAIN_PRINTER_ID);
}

#[test]
fn auto_and_none_and_blank_are_not_connections() {
    // "auto" is the profile default. Treating it as a connection would
    // register a device the operator never chose.
    for kind in ["auto", "none", "disabled", "", "usb-but-typed-wrong"] {
        let cfg = config_from_profile(&profile(&format!(
            r#"{{"printer_connection":"{kind}","printer_device_path":"10.0.0.5:9100"}}"#
        )));
        assert_eq!(
            cfg.printers.len(),
            0,
            "{kind:?} must not register a printer"
        );
    }
}

#[test]
fn usb_is_a_connection_even_without_an_address() {
    // The HAL resolves it by enumerating the bus, so the profile saying
    // "usb" with no path is meaningful and must survive the mapping.
    let cfg = config_from_profile(&profile(r#"{"printer_connection":"usb"}"#));
    assert_eq!(cfg.printers.len(), 1);
    assert_eq!(cfg.printers[0].connection, HalConnection::Usb);
}

#[test]
fn serial_maps_to_serial_so_the_hal_can_report_it() {
    // The mapping does not decide what is supported; it forwards the
    // operator's intent and apply_config reports the missing driver.
    let cfg = config_from_profile(&profile(
        r#"{"printer_connection":"serial","printer_device_path":"COM3"}"#,
    ));
    assert_eq!(
        cfg.printers[0].connection,
        HalConnection::Serial {
            port: "COM3".into(),
            baud: 9600
        }
    );
}

#[test]
fn an_unconfigured_profile_describes_no_devices() {
    let cfg = config_from_profile(&profile("{}"));
    // Default printer_connection is "auto", default kitchen is "network"
    // with an empty path; neither is usable.
    assert!(cfg.is_empty(), "{cfg:?}");
}

#[test]
fn scanner_and_scale_settings_produce_no_drivers() {
    // Documented gaps, asserted so they cannot be "fixed" by guessing an id.
    let cfg = config_from_profile(&profile(
        r#"{
            "scanner_device_id":"vid:0x0c2e pid:0x0200","scanner_input_mode":"keyboard",
            "scale_connection":"serial","scale_device_path":"COM5","scale_baud_rate":9600
        }"#,
    ));
    assert!(cfg.is_empty());
}

#[test]
fn the_info_recorded_names_the_transport_and_address() {
    let cfg = config_from_profile(&profile(
        r#"{"printer_connection":"network","printer_device_path":"10.0.0.5:9100"}"#,
    ));
    let info = &cfg.printers[0].info;
    assert_eq!(info.vendor, "configured");
    assert_eq!(info.model, "printer");
    assert_eq!(info.serial, "10.0.0.5:9100");
}

// ── load_profile ─────────────────────────────────────────────────────

#[test]
fn the_database_row_wins_over_the_file() {
    let dir = tempfile::tempdir().expect("tempdir");
    let conn = Connection::open_in_memory().expect("in-memory db");
    create_profiles_table(&conn);
    put_profile(
        &conn,
        "term-1",
        r#"{"printer_connection":"network","printer_device_path":"1.1.1.1:9100"}"#,
    );

    // A file that disagrees must lose.
    let path = TerminalProfile::profile_path(dir.path(), "term-1");
    let from_file = profile(r#"{"printer_connection":"usb"}"#);
    from_file.save(&path).expect("save file profile");

    let loaded = load_profile(&conn, "term-1", dir.path()).expect("db row loads");
    assert_eq!(loaded.printer_device_path, "1.1.1.1:9100");
}

#[test]
fn a_missing_database_row_falls_back_to_the_file() {
    let dir = tempfile::tempdir().expect("tempdir");
    let conn = Connection::open_in_memory().expect("in-memory db");
    create_profiles_table(&conn);

    let path = TerminalProfile::profile_path(dir.path(), "term-2");
    profile(r#"{"printer_connection":"serial","printer_device_path":"COM4"}"#)
        .save(&path)
        .expect("save file profile");

    let loaded = load_profile(&conn, "term-2", dir.path()).expect("file loads");
    assert_eq!(loaded.printer_connection, "serial");
    assert_eq!(loaded.printer_device_path, "COM4");
}

#[test]
fn an_unparsable_database_row_falls_back_instead_of_failing_startup() {
    let dir = tempfile::tempdir().expect("tempdir");
    let conn = Connection::open_in_memory().expect("in-memory db");
    create_profiles_table(&conn);
    put_profile(&conn, "term-3", "{ not json");

    let path = TerminalProfile::profile_path(dir.path(), "term-3");
    profile(r#"{"printer_connection":"usb"}"#)
        .save(&path)
        .expect("save file profile");

    let loaded = load_profile(&conn, "term-3", dir.path()).expect("falls back to the file");
    assert_eq!(loaded.printer_connection, "usb");
}

#[test]
fn no_profile_anywhere_is_none_not_a_panic() {
    let dir = tempfile::tempdir().expect("tempdir");
    let conn = Connection::open_in_memory().expect("in-memory db");
    create_profiles_table(&conn);
    assert!(load_profile(&conn, "ghost", dir.path()).is_none());
}

#[test]
fn a_missing_table_does_not_panic_either() {
    // First run before migrations, or a store db that never got the table.
    let dir = tempfile::tempdir().expect("tempdir");
    let conn = Connection::open_in_memory().expect("in-memory db");
    assert!(load_profile(&conn, "term-1", dir.path()).is_none());
}

// ── register_hardware ────────────────────────────────────────────────

/// Report entries for devices the operator named.
///
/// Scanner ids come from enumeration, so they depend on what happens to be
/// plugged into the machine running the test — asserting a total count here
/// would pass on a bare CI box and fail on a developer's desk. Every
/// assertion about "what the profile configured" filters through this.
fn configured(registered: &[String]) -> Vec<String> {
    registered
        .iter()
        .filter(|id| !id.starts_with("scanner:"))
        .cloned()
        .collect()
}

fn scanner_entries(registered: &[String]) -> Vec<String> {
    registered
        .iter()
        .filter(|id| id.starts_with("scanner:"))
        .cloned()
        .collect()
}

#[tokio::test]
async fn register_hardware_makes_the_default_printer_resolvable() {
    let registry = DriverRegistry::default();
    let prof = profile(r#"{"printer_connection":"network","printer_device_path":"10.0.0.5:9100"}"#);
    let report = register_hardware(&registry, &prof).await;
    assert!(report.ok(), "{report}");
    assert_eq!(
        configured(&report.registered),
        [format!("printer:{MAIN_PRINTER_ID}")],
        "the report keys entries as \"<category>:<id>\""
    );
    assert!(
        registry.printer(MAIN_PRINTER_ID).await.is_some(),
        "the whole point: this lookup used to always return None"
    );
}

#[tokio::test]
async fn an_unconfigured_profile_registers_nothing_and_reports_no_failure() {
    let registry = DriverRegistry::default();
    let report = register_hardware(&registry, &profile("{}")).await;
    assert!(report.ok());
    assert!(configured(&report.registered).is_empty(), "{report}");
    assert!(registry.printer_ids().await.is_empty());
}

#[tokio::test]
async fn register_hardware_enumerates_scanners_even_with_no_profile() {
    // The reason barcode input was dead: nothing ever registered a scanner,
    // and the UI auto-detects with scanners[0]. Asserted as an equality
    // rather than a count so it holds with or without a scanner attached.
    let registry = DriverRegistry::default();
    let report = register_hardware(&registry, &profile("{}")).await;
    assert_eq!(
        scanner_entries(&report.registered),
        registry.scanner_ids().await,
        "the report and the registry must agree on what was found"
    );
    for id in scanner_entries(&report.registered) {
        assert!(
            registry.scanner(&id).await.is_some(),
            "{id} reported but not bound"
        );
    }
}

// ── register_card_terminals ──────────────────────────────────────────

fn row(id: &str, connection_type: &str, transport: &str, address: &str) -> EdcTerminalConfig {
    EdcTerminalConfig {
        id: id.into(),
        name: format!("terminal {id}"),
        connection_type: connection_type.into(),
        transport: transport.into(),
        address: address.into(),
        vendor: Some("ingenico".into()),
        model: Some("iPP320".into()),
        is_active: true,
        created_at: "2026-01-01T00:00:00.000Z".into(),
        updated_at: "2026-01-01T00:00:00.000Z".into(),
    }
}

#[tokio::test]
async fn a_wired_row_is_reachable_under_its_own_id_and_under_default() {
    let registry = DriverRegistry::default();
    let rows = [row("t-1", "wired", "serial", "COM3")];
    let report = register_card_terminals(&registry, &rows).await;
    assert!(report.ok(), "{report}");
    assert!(registry.terminal("t-1").await.is_some());
    assert!(
        registry.terminal(DEFAULT_TERMINAL_ID).await.is_some(),
        "the commands look up \"default\"; without the alias they still see None"
    );
}

#[tokio::test]
async fn default_follows_row_order_not_hash_order() {
    // Callers pass list_active_edc_terminals(), which is ORDER BY
    // created_at, id. Whichever row arrives first owns the default id, so
    // the binding is reproducible across restarts.
    let registry = DriverRegistry::default();
    let rows = [
        row("first", "wired", "serial", "COM3"),
        row("second", "wireless", "tcp", "10.0.0.9:9500"),
    ];
    register_card_terminals(&registry, &rows).await;
    assert_eq!(registry.terminal_ids().await.len(), 3, "two rows + default");
    let bound = registry
        .terminal(DEFAULT_TERMINAL_ID)
        .await
        .expect("default");
    assert_eq!(
        bound.device_info().serial,
        "COM3",
        "default must be the earliest-created row"
    );
}

#[tokio::test]
async fn wireless_transports_map_to_their_own_targets() {
    let registry = DriverRegistry::default();
    let rows = [
        row("bt", "wireless", "bluetooth", "00:11:22:33:44:55"),
        row("net", "wireless", "tcp", "10.0.0.9:9500"),
    ];
    let report = register_card_terminals(&registry, &rows).await;
    assert!(report.ok(), "{report}");
    assert_eq!(report.registered_count(), 3, "two rows + the default alias");
}

#[tokio::test]
async fn a_registered_terminal_still_fails_closed() {
    // Registration makes a terminal reachable, not functional: the drivers
    // are stubs until a vendor protocol ships, and a configured terminal must
    // still never report an approval.
    let registry = DriverRegistry::default();
    register_card_terminals(&registry, &[row("t-1", "wired", "usb", "/dev/ttyUSB0")]).await;
    let terminal = registry.terminal("t-1").await.expect("registered");
    let money = kasirmu_core::Money {
        minor_units: 100,
        currency: "USD".parse::<kasirmu_core::Currency>().unwrap(),
    };
    assert!(matches!(
        terminal.authorize(money).await,
        Err(kasirmu_hal::HalError::Unsupported(_))
    ));
}

#[tokio::test]
async fn an_unpairable_row_is_rejected_not_dropped_silently() {
    // The CRUD layer blocks this at the door; the bootstrap still guards,
    // because a row can predate the rule.
    let registry = DriverRegistry::default();
    let report = register_card_terminals(&registry, &[row("t-1", "wired", "tcp", "1.2.3.4")]).await;
    assert!(!report.ok());
    assert_eq!(report.rejected.len(), 1);
    assert!(report.rejected[0].1.contains("no HAL terminal driver"));
    assert!(registry.terminal("t-1").await.is_none());
}

#[tokio::test]
async fn a_blank_address_never_becomes_a_terminal() {
    let registry = DriverRegistry::default();
    let report = register_card_terminals(&registry, &[row("t-1", "wired", "serial", "   ")]).await;
    assert!(!report.ok(), "an address of nothing is not a terminal");
    assert!(registry.terminal_ids().await.is_empty());
}

#[tokio::test]
async fn no_rows_leaves_the_registry_without_a_default_terminal() {
    let registry = DriverRegistry::default();
    let report = register_card_terminals(&registry, &[]).await;
    assert!(report.ok());
    assert_eq!(report.registered_count(), 0);
    assert!(registry.terminal(DEFAULT_TERMINAL_ID).await.is_none());
}

#[tokio::test]
async fn one_bad_row_does_not_stop_the_good_ones() {
    let registry = DriverRegistry::default();
    let rows = [
        row("t-1", "wired", "tcp", "1.2.3.4"), // unpairable
        row("t-2", "wired", "serial", "COM4"),
    ];
    let report = register_card_terminals(&registry, &rows).await;
    assert_eq!(report.rejected.len(), 1);
    assert!(registry.terminal("t-2").await.is_some());
    // The default alias follows the first *registrable* row's slot: row 0 was
    // rejected, so nothing claims "default" from it.
    assert!(
        registry.terminal(DEFAULT_TERMINAL_ID).await.is_some(),
        "t-2 is rows[1]; the alias must still land somewhere usable"
    );
}

#[allow(dead_code)]
fn path_arg_is_a_str_slice() {
    // Keeps the signature honest: base_dir is a &Path, not a String.
    fn _takes(_: &Path) {}
}
