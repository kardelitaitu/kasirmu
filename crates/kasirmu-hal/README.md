# oz-hal

<!-- Audit stamp: 2026-08-31 · docs-auditor · status: ACCURATE (3 findings repaired) · F1: removed dead `Scanner`/`drivers/scanner.rs` row (file deleted at HEAD; scanners covered by usb/bt/serial_scanner) · F2: added `EdcTerminal` trait row (traits/edc.rs — status/authorize/capture/sale/refund/void/print_receipt/device_info; re-exported with EdcPaymentResult/TerminalStatus) · F3: added EDC drivers WiredEdcTerminal (drivers/edc/wired.rs), WirelessEdcTerminal (drivers/edc/wireless.rs), protocol codecs Ingenico/PAX/Verifone (drivers/edc/protocol/), and MockEdcTerminal (drivers/mock.rs) · verified accurate: remaining traits (barcode/printer/cash_drawer/customer_display/weight_scale), drivers (usb/bt/serial/tcp printer, drawer, serial_display, scale, kds_chit), mocks, escpos consts + format_receipt, receipt format_sales_receipt/SalesReceipt/ReceiptConfig, DriverRegistry methods; unsafe confined to lib.rs with SAFETY comment. NOTE: EdcTerminal migration is now complete — trait (217554f5), drivers (bbd74c01), registry category (459f852c) and the oz-payment switchover (ad908e96, which deleted the duplicate trait and made the commands fail closed) · F4 (31-08, post dc07f32a): documented the new `bootstrap` module (`HardwareConfig` + `apply_config()` → `BootstrapReport`) as the production registration path and corrected the registry example — `discover()` was never wired into startup, so the registry was empty at runtime · CORRECTED 31-08 by DSH-Agent (F5-F7): F5 WiredEdcTerminal/WirelessEdcTerminal were labelled "Real" but every op returns HalError::Unsupported — they are stubs, and the mislabel was on a money path; F6 "registration never blocks" was superseded by 6624df1c (Connection::Usb enumerates the bus); F7 the registry example would not compile — apply_config is a free function not a method, register_tcp_printer takes a DeviceInfo, and the ids shown were discover()-style ones that no command looks up · F8 (31-08, DSH-Agent): six drivers were labelled "Stub" with no evidence — bt_scanner, serial_scanner, usb_printer, bt_printer, tcp_printer, serial_display. All six do real device I/O (rusb write_bulk, tokio TcpStream, serialport read/write) and none contains todo!/unimplemented!/Unsupported. Only HidWeightScale and the two EDC terminals are genuine stubs; the table now says which primitive each driver uses so the claim is checkable. F9: added SerialReceiptPrinter and relabelled BtReceiptPrinter as an alias — drivers/serial_printer.rs is the implementation, and the crate never had a second one. · F10 (01-09, DSH-Agent, 1844626d): "no app calls it today" had become false and "discovery opens serial/Bluetooth ports" had always been false. Scanners are now registered at startup via discover_scanners(); enumeration calls available_ports() and every driver's new() leaves the handle None until connect(). Rewrote the id section around the rule that actually decides it — who picks the id — since a fixed-string lookup and a UI that hands an id back need opposite mechanisms. -->

Hardware Abstraction Layer — the seam between business logic and physical devices (USB, Bluetooth, serial, TCP).

## Traits

| Trait | File | Methods |
|-------|------|---------|
| `BarcodeScanner` | `traits/barcode.rs` | `connect`, `poll`, `cancel` |
| `ReceiptPrinter` | `traits/printer.rs` | `print_receipt`, `print_raw`, `cut` |
| `CashDrawer` | `traits/cash_drawer.rs` | `open`, `is_open` |
| `CustomerDisplay` | `traits/customer_display.rs` | Pole/line display for customer-facing screen |
| `WeightScale` | `traits/weight_scale.rs` | `WeightScale`, `WeightReading` — re-exported at crate root |
| `EdcTerminal` | `traits/edc.rs` | `status`, `authorize`, `capture`, `sale`, `refund`, `void`, `print_receipt`, `device_info` — card-payment terminals; re-exported with `EdcPaymentResult`/`TerminalStatus` |

Business code never imports a specific driver — only traits via `DriverRegistry`.

### Public modules

| Module | Contents |
|--------|----------|
| `error` | `HalError`, `HalErrorKind` — `thiserror`-based error types |
| `transport` | USB/serial/BT/TCP transport abstractions |
| `types` | `Barcode`, `BarcodeSymbology`, `DeviceInfo` |
| `registry` | `DriverRegistry` — auto-discovery, manual registration, and config bootstrap (`apply_config`) |
| `bootstrap` | `HardwareConfig` (printer/display/drawer/terminal) + `apply_config()` → `BootstrapReport` — turns saved operator config into registered drivers (the production registration path) |

## Drivers

| Driver | File | Status |
|--------|------|--------|
| `UsbHidBarcodeScanner` | `drivers/usb_scanner.rs` | Real — USB HID interrupt read + keycode→ASCII |
| `BtBarcodeScanner` | `drivers/bt_scanner.rs` | Real — reads bytes over a Bluetooth SPP serial port (`port.read`) |
| `SerialBarcodeScanner` | `drivers/serial_scanner.rs` | Real — reads bytes over a serial port |
| `UsbReceiptPrinter` | `drivers/usb_printer.rs` | Real — `rusb` `write_bulk` to the OUT endpoint |
| `SerialReceiptPrinter` | `drivers/serial_printer.rs` | Real — `serialport` write; covers RS-232, USB-serial and Bluetooth SPP alike |
| `BtReceiptPrinter` | `drivers/bt_printer.rs` | **Alias** of `SerialReceiptPrinter`, not a second driver — SPP presents as a serial port |
| `TcpReceiptPrinter` | `drivers/tcp_printer.rs` | Real — `tokio::net::TcpStream` to port 9100 |
| `CashDrawer` | `drivers/drawer.rs` | Real — serial pulse, plus `PrinterKickCashDrawer` which kicks through a printer |
| `SerialCustomerDisplay` | `drivers/serial_display.rs` | Real — serial ESC/POS display commands |
| `HidWeightScale` | `drivers/scale.rs` | **Stub** — `read_weight` always returns `NotFound`; the vid/pid fields are placeholders (`_vendor_id`) |
| `KdsChit` | `drivers/kds_chit.rs` | Chit formatter, not a device driver |
| `WiredEdcTerminal` | `drivers/edc/wired.rs` | Stub — every op fails closed with `HalError::Unsupported`; the Ingenico/PAX/Verifone codecs in `drivers/edc/protocol/` are stubs too |
| `WirelessEdcTerminal` | `drivers/edc/wireless.rs` | Stub — same `Unsupported` behaviour, shares the `drivers/edc/protocol/` codecs |
| `MockBarcodeScanner` | `drivers/mock.rs` | Programmable mock |
| `MockReceiptPrinter` | `drivers/mock.rs` | Programmable mock |
| `MockCashDrawer` | `drivers/mock.rs` | Programmable mock |
| `MockWeightScale` | `drivers/mock.rs` | Programmable mock |
| `MockCustomerDisplay` | `drivers/mock.rs` | Programmable mock |
| `MockEdcTerminal` | `drivers/mock.rs` | Programmable mock |

## ESC/POS & receipt formatting

All printer drivers share a single ESC/POS module at `drivers::escpos`:

- `escpos::format_receipt(body)` — wraps text in init + font + commands
- `escpos::CUT_FULL` / `CUT_PARTIAL` — cut command bytes
- `escpos::ALIGN_CENTER`, `BOLD_ON`, `BOLD_OFF` — formatting constants
- Receipt formatting lives in `drivers::receipt`: `format_sales_receipt()` builds a full ESC/POS buffer from structured `SalesReceipt` + `ReceiptConfig` data.

## Registry

`DriverRegistry` holds `Arc<dyn Trait>` per device behind `RwLock`. In production it is populated at startup from the operator's saved config via `apply_config()` (apps map their `TerminalProfile` → `HardwareConfig` in `platform_startup::hardware`; the HAL never reads a settings table):

```rust
use kasirmu_hal::{apply_config, DriverRegistry, HardwareConfig};

let registry = DriverRegistry::default();
// Production path — register the devices the operator configured:
let report = apply_config(&registry, &hardware_config).await; // → registered / skipped / rejected
for (id, reason) in &report.rejected {
    tracing::warn!(device = %id, reason = %reason, "configured device not registered");
}

// Manual add — note the id: commands look up fixed strings.
registry.register_tcp_printer("default", "192.168.1.100:9100", info).await;
if let Some(printer) = registry.printer("default").await {
    printer.print_raw(&escpos_bytes).await?; // or print_receipt(&body) for the text path
}
```

**The id is the contract, and who picks it decides how a device is registered.** Receipt printing asks for `printer("default")`, KDS for `printer("kitchen")`, the scale commands for `scale("default")`. `discover()` mints hardware-derived ids like `printer:vendor:model`, so registering those through it leaves every lookup empty — which is exactly how the registry ended up unreadable at runtime. Barcode scanners are the opposite case: no caller names one, the UI lists the registered ids and hands one back, so a discovery id is the right key.

`discover_scanners()` runs at startup through `HardwareConfig::autodetect_scanners` and is the only registration path barcode input has. The rest of `discover()` — printers, drawers, displays — is still uncalled, for the id reason above. Enumeration opens no port either way: `probe_ports()` and `probe_bluetooth()` call `available_ports()`, and each driver's `new()` leaves the handle `None` until `connect()`. Addressed transports from `apply_config()` are likewise constructed without touching the device, so a stale profile cannot stall startup — `Connection::Usb` is the exception, since it names no address and has to enumerate the bus.

## Mocks

Every trait has a programmable mock in `drivers/mock.rs`:

```rust
let scanner = MockBarcodeScanner::new();
scanner.push(Barcode::new("ABC123"));
```

## Conventions

- `unsafe` allowed with `// SAFETY:` comment.
- Every trait must have a mock (`Send + Sync + Clone` with `AtomicUsize` counters).
- No `unwrap()` in driver code — map errors to `HalError` at the trait boundary.
- Wrap blocking I/O in `tokio::task::spawn_blocking`.

> last audited 31-08-26 by docs-auditor
