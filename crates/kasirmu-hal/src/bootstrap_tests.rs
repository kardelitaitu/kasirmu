//! Registry bootstrap — config parsing and fail-open registration.

use std::sync::Arc;

use super::*;
use crate::traits::edc::EdcTerminal;

fn info(model: &str) -> DeviceInfo {
    DeviceInfo::new("vendor", model, "SN-1")
}

fn printer(id: &str, connection: Connection) -> PrinterConfig {
    PrinterConfig {
        id: id.into(),
        connection,
        info: info(id),
    }
}

// ── Connection::parse ────────────────────────────────────────────────

#[test]
fn parse_accepts_the_profile_vocabulary() {
    assert_eq!(Connection::parse("usb", "", 0), Some(Connection::Usb));
    assert_eq!(
        Connection::parse("serial", "COM3", 115200),
        Some(Connection::Serial {
            port: "COM3".into(),
            baud: 115200
        })
    );
    assert_eq!(
        Connection::parse("bluetooth", "COM7", 0),
        Some(Connection::Bluetooth {
            port: "COM7".into()
        })
    );
    assert_eq!(
        Connection::parse("network", "10.0.0.5:9100", 0),
        Some(Connection::Network {
            addr: "10.0.0.5:9100".into()
        })
    );
}

#[test]
fn parse_is_case_insensitive_and_trims() {
    // Profiles saved by older builds used "USB" and "Network" verbatim from
    // the UI select; settings_tests.rs still asserts both spellings.
    assert_eq!(Connection::parse("USB", "", 0), Some(Connection::Usb));
    assert_eq!(
        Connection::parse("  Network ", " 10.0.0.5:9100 ", 0),
        Some(Connection::Network {
            addr: "10.0.0.5:9100".into()
        })
    );
    assert_eq!(
        Connection::parse("TCP", "host:1", 0),
        Some(Connection::Network {
            addr: "host:1".into()
        })
    );
}

#[test]
fn parse_treats_absent_disabled_and_auto_as_no_connection() {
    for kind in ["none", "disabled", "auto", "", "wat"] {
        assert_eq!(
            Connection::parse(kind, "COM3", 9600),
            None,
            "{kind:?} must not produce a connection"
        );
    }
    // A named transport with no address is unusable, not a default.
    assert_eq!(Connection::parse("serial", "   ", 9600), None);
    assert_eq!(Connection::parse("network", "", 9600), None);
}

#[test]
fn zero_baud_falls_back_to_the_documented_default() {
    assert_eq!(
        Connection::parse("serial", "COM3", 0),
        Some(Connection::Serial {
            port: "COM3".into(),
            baud: DEFAULT_BAUD
        })
    );
    assert_eq!(DEFAULT_BAUD, 9600);
}

// ── apply_config ─────────────────────────────────────────────────────

#[tokio::test]
async fn empty_config_registers_nothing_and_is_not_an_error() {
    let reg = DriverRegistry::default();
    let report = apply_config(&reg, &HardwareConfig::empty()).await;
    assert!(report.ok());
    assert_eq!(report.registered_count(), 0);
    assert!(reg.printer_ids().await.is_empty());
}

#[tokio::test]
async fn network_printer_lands_under_the_id_the_receipt_path_looks_up() {
    // run_print_receipt_inner does registry.printer("default"); before the
    // bootstrap existed that lookup could never resolve.
    let reg = DriverRegistry::default();
    let cfg = HardwareConfig {
        printers: vec![printer(
            "default",
            Connection::Network {
                addr: "10.0.0.5:9100".into(),
            },
        )],
        ..HardwareConfig::default()
    };
    let report = apply_config(&reg, &cfg).await;
    assert_eq!(report.registered, vec!["printer:default".to_string()]);
    let printer = reg.printer("default").await.expect("registered");
    assert_eq!(printer.device_info().model, "default");
}

#[tokio::test]
async fn registering_a_printer_also_gives_it_a_kick_drawer() {
    let reg = DriverRegistry::default();
    let cfg = HardwareConfig {
        printers: vec![printer(
            "default",
            Connection::Network { addr: "h:1".into() },
        )],
        ..HardwareConfig::default()
    };
    apply_config(&reg, &cfg).await;
    assert!(
        reg.cash_drawer("drawer:kick:default").await.is_some(),
        "the companion drawer must come from the same config entry"
    );
}

#[tokio::test]
async fn kitchen_and_main_printers_coexist_under_their_own_ids() {
    let reg = DriverRegistry::default();
    let cfg = HardwareConfig {
        printers: vec![
            printer("default", Connection::Network { addr: "a:1".into() }),
            printer(
                "kitchen",
                Connection::Bluetooth {
                    port: "COM8".into(),
                },
            ),
        ],
        ..HardwareConfig::default()
    };
    let report = apply_config(&reg, &cfg).await;
    assert_eq!(report.registered_count(), 2);
    assert!(reg.printer("default").await.is_some());
    assert!(reg.printer("kitchen").await.is_some());
}

#[tokio::test]
async fn serial_printer_registers_the_shared_serial_driver() {
    // Serial printers used to be rejected because drivers/ had no serial
    // printer. BtReceiptPrinter turned out to contain nothing
    // Bluetooth-specific, so they are one driver now and a wired operator
    // gets a working printer instead of a log line.
    let reg = DriverRegistry::default();
    let cfg = HardwareConfig {
        printers: vec![printer(
            "default",
            Connection::Serial {
                port: "COM3".into(),
                baud: 19200,
            },
        )],
        ..HardwareConfig::default()
    };
    let report = apply_config(&reg, &cfg).await;
    assert!(report.ok(), "{report}");
    assert!(reg.printer("default").await.is_some());
    // The companion drawer must come from the same entry, as with TCP.
    assert!(reg.cash_drawer("drawer:kick:default").await.is_some());
}

#[tokio::test]
async fn every_printer_transport_the_profile_can_name_now_resolves() {
    let reg = DriverRegistry::default();
    let cfg = HardwareConfig {
        printers: vec![
            printer("net", Connection::Network { addr: "h:1".into() }),
            printer(
                "ser",
                Connection::Serial {
                    port: "COM3".into(),
                    baud: 9600,
                },
            ),
            printer(
                "bt",
                Connection::Bluetooth {
                    port: "COM8".into(),
                },
            ),
        ],
        ..HardwareConfig::default()
    };
    let report = apply_config(&reg, &cfg).await;
    assert!(report.ok(), "{report}");
    assert_eq!(report.registered_count(), 3);
    for id in ["net", "ser", "bt"] {
        assert!(reg.printer(id).await.is_some(), "{id} must resolve");
    }
}

#[tokio::test]
async fn one_unusable_entry_does_not_stop_the_rest() {
    let reg = DriverRegistry::default();
    let cfg = HardwareConfig {
        printers: vec![printer(
            "default",
            Connection::Network { addr: "a:1".into() },
        )],
        terminals: vec![TerminalConfig {
            id: "edc".into(),
            connection: TerminalConnection::Wired {
                port: String::new(), // unusable
                baud: 9600,
            },
            info: info("x"),
        }],
        ..HardwareConfig::default()
    };
    let report = apply_config(&reg, &cfg).await;
    assert_eq!(report.registered_count(), 1, "the printer still lands");
    assert_eq!(report.skipped.len(), 1);
    assert!(reg.printer("default").await.is_some());
    assert!(reg.terminal("edc").await.is_none());
}

#[tokio::test]
async fn display_and_drawer_register_from_their_ports() {
    let reg = DriverRegistry::default();
    let cfg = HardwareConfig {
        displays: vec![DisplayConfig {
            id: "pole".into(),
            port: "COM2".into(),
            baud: 9600,
            info: info("Bixolon"),
        }],
        drawers: vec![DrawerConfig {
            id: "till".into(),
            port: "COM4".into(),
            baud: 9600,
            info: info("CD-110"),
        }],
        ..HardwareConfig::default()
    };
    let report = apply_config(&reg, &cfg).await;
    assert_eq!(report.registered_count(), 2);
    assert!(reg.display("pole").await.is_some());
    assert!(reg.cash_drawer("till").await.is_some());
}

#[tokio::test]
async fn blank_port_entries_are_skipped_not_registered() {
    let reg = DriverRegistry::default();
    let cfg = HardwareConfig {
        displays: vec![DisplayConfig {
            id: "pole".into(),
            port: "  ".into(),
            baud: 9600,
            info: info("x"),
        }],
        terminals: vec![TerminalConfig {
            id: "edc".into(),
            connection: TerminalConnection::Wired {
                port: String::new(),
                baud: 9600,
            },
            info: info("x"),
        }],
        ..HardwareConfig::default()
    };
    let report = apply_config(&reg, &cfg).await;
    assert!(report.ok(), "unconfigured is not a failure");
    assert_eq!(report.skipped.len(), 2);
    assert_eq!(report.registered_count(), 0);
}

#[tokio::test]
async fn card_terminals_register_wired_and_wireless() {
    let reg = DriverRegistry::default();
    let cfg = HardwareConfig {
        terminals: vec![
            TerminalConfig {
                id: "edc-front".into(),
                connection: TerminalConnection::Wired {
                    port: "COM3".into(),
                    baud: 115200,
                },
                info: info("iPP320"),
            },
            TerminalConfig {
                id: "edc-mobile".into(),
                connection: TerminalConnection::Wireless {
                    target: crate::drivers::edc::WirelessTarget::Network("10.0.0.9:9500".into()),
                },
                info: info("S920"),
            },
        ],
        ..HardwareConfig::default()
    };
    let report = apply_config(&reg, &cfg).await;
    assert_eq!(report.registered_count(), 2);

    let front = reg.terminal("edc-front").await.expect("registered");
    assert_eq!(front.device_info().model, "iPP320");
    // Registered means reachable, not working: the driver is still a stub
    // and must fail closed rather than approve a card.
    assert!(matches!(
        front
            .authorize(oz_core::Money {
                minor_units: 100,
                currency: "USD".parse::<oz_core::Currency>().unwrap(),
            })
            .await,
        Err(crate::error::HalError::Unsupported(_))
    ));
    assert!(reg.terminal("edc-mobile").await.is_some());
}

#[tokio::test]
async fn applying_the_same_config_twice_is_idempotent() {
    let reg = DriverRegistry::default();
    let cfg = HardwareConfig {
        printers: vec![printer(
            "default",
            Connection::Network { addr: "a:1".into() },
        )],
        ..HardwareConfig::default()
    };
    apply_config(&reg, &cfg).await;
    apply_config(&reg, &cfg).await;
    // Overwrite semantics mean one entry per id, not two.
    assert_eq!(reg.printer_ids().await.len(), 1);
    assert_eq!(reg.drawer_ids().await.len(), 1);
}

#[tokio::test]
async fn usb_printer_enumerates_and_never_faults_on_an_empty_bus() {
    // The one branch that touches hardware. On a machine with no printer it
    // must skip rather than reject or panic, and it must never claim a
    // registration the lookup cannot confirm.
    let reg = DriverRegistry::default();
    let cfg = HardwareConfig {
        printers: vec![printer("default", Connection::Usb)],
        ..HardwareConfig::default()
    };
    let report = apply_config(&reg, &cfg).await;
    assert!(report.ok(), "an absent USB printer is not a fault");
    assert_eq!(
        report.registered.is_empty(),
        reg.printer("default").await.is_none(),
        "a reported registration must match the lookup"
    );
}

#[test]
fn report_display_names_the_counts() {
    // The sample reason is one the bootstrap can still actually produce;
    // it used to quote the serial-printer rejection, which no longer exists.
    let report = BootstrapReport {
        registered: vec!["printer:default".into()],
        skipped: vec![],
        rejected: vec![(
            "terminal:t-1".into(),
            "no HAL terminal driver for wired + tcp".into(),
        )],
    };
    let text = report.to_string();
    assert!(text.contains("1 registered"), "{text}");
    assert!(text.contains("1 rejected"), "{text}");
    assert!(text.contains("no HAL terminal driver"), "{text}");
}

#[test]
fn config_len_counts_every_category() {
    let cfg = HardwareConfig {
        printers: vec![printer("a", Connection::Usb)],
        displays: vec![DisplayConfig {
            id: "d".into(),
            port: "COM1".into(),
            baud: 9600,
            info: info("d"),
        }],
        drawers: vec![],
        terminals: vec![],
        autodetect_scanners: true,
    };
    assert_eq!(cfg.len(), 2);
    assert!(!cfg.is_empty());
    // Autodetect is a behaviour, not a device the operator named: it must
    // not count toward len() or flip is_empty(), or "nothing configured"
    // would read as "two devices set up" on a fresh install.
    assert_eq!(cfg.len(), 2, "autodetect adds no device count");
    assert!(HardwareConfig::empty().is_empty());
    assert!(
        !HardwareConfig::empty().autodetect_scanners,
        "default must not enumerate; config_from_profile opts in"
    );
}

#[tokio::test]
async fn autodetect_off_registers_no_scanner() {
    // The opt-out has to be real, or "I configured no scanners" would still
    // bind whatever was attached.
    let reg = DriverRegistry::default();
    let report = apply_config(&reg, &HardwareConfig::empty()).await;
    assert!(report.ok());
    assert!(
        reg.scanner_ids().await.is_empty(),
        "an empty config must not enumerate"
    );
}

#[tokio::test]
async fn autodetect_binds_scanners_and_reports_exactly_those() {
    // What the bootstrap reports must be what a lookup can find, and it must
    // be scanners only — a printer bound here would never be reached, since
    // the receipt path asks for "default".
    let reg = DriverRegistry::default();
    let cfg = HardwareConfig {
        autodetect_scanners: true,
        ..HardwareConfig::empty()
    };
    let report = apply_config(&reg, &cfg).await;
    assert!(report.ok(), "no attached scanner is not a fault");
    assert!(
        report.rejected.is_empty(),
        "autodetect must not reject anything: {:?}",
        report.rejected
    );
    assert_eq!(report.registered, reg.scanner_ids().await);
    assert!(reg.printer_ids().await.is_empty());
    assert!(reg.drawer_ids().await.is_empty());
}

#[tokio::test]
async fn autodetect_leaves_a_configured_printer_on_default_reachable() {
    // The whole point of splitting the two mechanisms: enumeration must not
    // disturb the id the receipt path actually looks up.
    let reg = DriverRegistry::default();
    let cfg = HardwareConfig {
        printers: vec![printer(
            "default",
            Connection::Serial {
                port: "COM9".into(),
                baud: 9600,
            },
        )],
        autodetect_scanners: true,
        ..HardwareConfig::empty()
    };
    let report = apply_config(&reg, &cfg).await;
    assert!(report.registered.contains(&"printer:default".to_string()));
    assert!(reg.printer("default").await.is_some());
}

#[allow(dead_code)]
fn trait_objects_are_send_sync() {
    // The registry stores Arc<dyn Trait>; this would fail to build if a
    // config-registered driver were not usable as one.
    let _printer: Option<Arc<dyn crate::traits::printer::ReceiptPrinter>> = None;
    let _terminal: Option<Arc<dyn EdcTerminal>> = None;
}
