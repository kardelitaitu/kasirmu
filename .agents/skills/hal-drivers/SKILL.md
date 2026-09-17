---
name: hal-drivers
description: Hardware Abstraction Layer (HAL) conventions for kasir.mu — async_trait device traits, drivers for barcode scanners, receipt printers, cash drawers, customer displays, weight scales, and EDC payment terminals, plus mandatory mock implementations. Use when adding a new device driver or wiring hardware into a feature.
---

<!-- Audit stamp: 2026-09-03 · DSH · status: ACCURATE (rev 2 — error.rs sample added the real Unsupported(String) variant and the HalErrorKind discriminator contract the checklist already referenced; all other structural claims re-verified) · verified this pass: traits/{barcode,printer,cash_drawer,customer_display,weight_scale,edc}.rs + *_tests.rs siblings, transport/{usb,serial,tcp}.rs (+ mod), bootstrap.rs + registry.rs + error.rs + types.rs at crate root, drivers/edc/ dir, register_serial_printer/register_bluetooth_printer/HardwareConfig/BootstrapReport/HalErrorKind/discover_never_registers_a_card_terminal symbols all present, useBarcodeScanner.ts uses scanners[0]?.id autodetect, start_scanner_scoped in apps/desktop-client/src/commands/hardware.rs, real HalError has Timeout(u32) · prior: 2026-08-31 docs-auditor rev (F1-F4 repaired + EdcTerminal documented; dc07f32a bootstrap doc; 6624df1c registry-id contract; 1c8957ac serial-printer unification) · STAMPS MERGED INTO THIS ONE on 2026-09-08 (§13: replace, do not stack) — carrying forward the superseded audits’ evidence verbatim:  ·· [2026-08-31] · docs-auditor · status: ACCURATE (F1-F4 repaired + EdcTerminal documented) · F1 FIXED: removed the false 'embedded-hal' claim (no such dep; plain async_trait) · F2 FIXED: traits list corrected to the 6 real traits (barcode/printer/cash_drawer/customer_display/weight_scale/edc) — fictional nfc.rs/payment_terminal.rs removed · F3 FIXED: drivers are transport-named (usb/bt/serial_scanner, usb/bt/tcp_printer, escpos, receipt, kds_chit, drawer, serial_display, scale, edc/{wired,wireless,protocol}) — fictional honeywell_barcode/star_printer/acr122u_nfc/idtech_payment removed; example struct now UsbHidBarcodeScanner (real) · F4 FIXED: mocks are always compiled (no `mock` feature gate) · NEW: EdcTerminal trait (traits/edc.rs) + edc/ drivers now documented · verified accurate: BarcodeScanner signature (connect/poll/cancel/device_info), DriverRegistry + discover, mock.rs location, async Result<T,HalError> convention · NEW (31-08, dc07f32a): documented bootstrap.rs (`HardwareConfig` + `apply_config()` → `BootstrapReport`) as the production registration path; corrected `discover()` framing (auto-probe, not startup registration) · CORRECTED 31-08 by DSH-Agent: the bootstrap note had carried "registration never blocks", which 6624df1c superseded (Connection::Usb enumerates the bus); added the registry-id contract that 6624df1c proved — discover() mints hardware-derived ids while commands look up fixed strings, so wiring a driver into discover() leaves it unreachable, and the checklist said to do exactly that · F5 (31-08, DSH-Agent, 1c8957ac): the driver tree omitted serial_printer.rs and presented bt_printer.rs as a separate driver. There is one serial printer implementation; Bluetooth SPP is a serial port to the application. Note this one ran the other way: this skill already listed "serial" as an addressed transport, and it was the CODE that was wrong — bootstrap.rs rejected every serial printer as having no driver. Marked scale.rs and edc/ as stubs so nobody wires a stub into a path and calls it a feature. · F6 (01-09, DSH-Agent, 1844626d): the registry-id rule was stated as absolute ("commands look up fixed strings, so discover() never resolves") and it is only half true — it holds where a caller hardcodes the id, not where the UI lists ids and hands one back. Scanners are the second case, and applying the absolute rule to them is what left barcode input dead in both clients. Rewrote the rule as "who picks the id", recorded that discovery enumerates without opening ports, and documented discover_scanners() as the startup path. -->
# Hardware Abstraction Layer (HAL)

kasir.mu runs on real hardware: barcode scanners, receipt printers, cash drawers, customer displays, weight scales, and EDC payment terminals. The HAL (`oz-hal`) is the seam between the **business logic** (which wants "scan a barcode") and the **physical device** (which sends bytes over USB, Bluetooth, or serial).

The HAL is implemented in Rust as plain `async_trait` traits — there is **no** `embedded-hal` dependency. The rest of the system only ever sees the trait — it never imports a specific driver.

---

## When to use

- Adding a new device category (e.g., scale, customer display, EMV terminal).
- Writing a driver for a specific device model.
- Wiring hardware into a Tauri command or a feature.
- Writing the **mandatory** mock implementation for a new driver.
- Reviewing hardware code for thread safety, error handling, or platform support.

---

## Golden rules

| # | Rule | Why |
|---|------|-----|
| 1 | **Every device implements a trait.** Business code never imports a specific driver. | Swap hardware without changing features. |
| 2 | **A mock implementation lives in `crates/oz-hal/src/drivers/mock.rs` for every new trait.** | Tests must run without physical hardware. |
| 3 | **Traits are `async` and return `Result<T, HalError>`.** | Hardware fails in surprising ways. Make it explicit. |
| 4 | **No `unwrap()` in driver code.** A flaky USB device must not panic the cashier's flow. | |
| 5 | **Drivers register through `DriverRegistry`**, not via `static`s. | Hot-plug, multiple devices, plug-and-play. |

---

## Crate layout

```
crates/oz-hal/
├── Cargo.toml
└── src/
    ├── lib.rs
    ├── traits/
    │   ├── mod.rs
    │   ├── barcode.rs          # BarcodeScanner trait
    │   ├── printer.rs          # ReceiptPrinter trait
    │   ├── cash_drawer.rs      # CashDrawer trait
    │   ├── customer_display.rs # CustomerDisplay trait
    │   ├── weight_scale.rs     # WeightScale trait
    │   └── edc.rs              # EdcTerminal trait (payment terminals)
    ├── error.rs                # HalError enum (thiserror)
    ├── registry.rs             # DriverRegistry + discovery
    ├── transport/
    │   ├── usb.rs
    │   ├── bluetooth.rs
    │   └── serial.rs           # platform-conditional
    └── drivers/                # transport-named, NOT vendor-named
        ├── mod.rs
        ├── usb_scanner.rs / bt_scanner.rs / serial_scanner.rs
        ├── serial_printer.rs   # RS-232, USB-serial and Bluetooth SPP alike
        ├── bt_printer.rs       # alias of SerialReceiptPrinter, not a 2nd driver
        ├── usb_printer.rs / tcp_printer.rs
        ├── escpos.rs           # ESC/POS command codec
        ├── receipt.rs / kds_chit.rs   # receipt + kitchen-chit rendering
        ├── drawer.rs           # cash drawer
        ├── serial_display.rs   # customer display
        ├── scale.rs            # weight scale — STUB, read_weight always fails
        ├── edc/                # payment terminals — STUBS, every op Unsupported
        │   ├── wired.rs / wireless.rs
        │   └── protocol/       # Ingenico / PAX / Verifone codecs
        └── mock.rs             # <-- mandatory mocks (always compiled)
```

Bluetooth SPP surfaces as an ordinary COM/rfcomm port, so there is one serial
printer driver, not two. `register_serial_printer` and
`register_bluetooth_printer` both build a `SerialReceiptPrinter`; they stay
separate so logs and the setup wizard report the transport the operator chose.

---

## Defining a trait

```rust
// crates/oz-hal/src/traits/barcode.rs

use async_trait::async_trait;
use crate::error::HalError;
use crate::types::{Barcode, ScanOutcome};

/// A device that produces barcode scans. Implementations may be USB HID,
/// Bluetooth, serial, or a camera-based software scanner.
#[async_trait]
pub trait BarcodeScanner: Send + Sync {
    /// Open a connection to the device. Idempotent — calling twice returns
    /// the same connection.
    async fn connect(&self) -> Result<Box<dyn BarcodeScanner>, HalError>;

    /// Poll for the next scan. Blocks until a code is read or the timeout
    /// elapses. Returns `Ok(None)` on timeout (not an error).
    async fn poll(&mut self, timeout_ms: u32) -> Result<Option<Barcode>, HalError>;

    /// Cancel an in-flight poll. Used when the user navigates away.
    async fn cancel(&self) -> Result<(), HalError>;

    /// Device identity, used in logs and the setup wizard.
    fn device_info(&self) -> DeviceInfo;
}
```

**Rules:**
- Traits are object-safe. Use `Box<dyn Trait>` for the registry.
- `Send + Sync` so the trait can be shared across Tauri command threads.
- Methods are `async` and never block the executor. Driver code that does CPU-heavy work should use `spawn_blocking`.
- `cancel()` is mandatory on long-running operations.
- Errors are `HalError`, with rich variants. The cashier's flow depends on knowing *why* a scan failed.

---

## Implementing a driver

```rust
// crates/oz-hal/src/drivers/usb_scanner.rs (illustrative — the real
// `UsbHidBarcodeScanner` wraps a `rusb` device handle)

use async_trait::async_trait;
use crate::error::HalError;
use crate::traits::barcode::{BarcodeScanner, DeviceInfo};
use crate::types::Barcode;
use tokio::sync::Mutex;

pub struct UsbHidBarcodeScanner {
    inner: Mutex<rusb::DeviceHandle<rusb::Context>>,
    info: DeviceInfo,
}

impl UsbHidBarcodeScanner {
    pub fn new() -> Self { /* ... */ }
}

#[async_trait]
impl BarcodeScanner for UsbHidBarcodeScanner {
    async fn connect(&self) -> Result<Box<dyn BarcodeScanner>, HalError> {
        // idempotent; return self
        Ok(Box::new(UsbHidBarcodeScanner { /* ... */ }))
    }

    async fn poll(&mut self, timeout_ms: u32) -> Result<Option<Barcode>, HalError> {
        let mut guard = self.inner.lock().await;
        tokio::time::timeout(
            Duration::from_millis(timeout_ms as u64),
            guard.read_barcode(),
        )
        .await
        .map_err(|_| HalError::Timeout)?
        .map(Some)
    }

    async fn cancel(&self) -> Result<(), HalError> {
        // signal the USB read to abort
        Ok(())
    }

    fn device_info(&self) -> DeviceInfo {
        self.info.clone()
    }
}
```

**Rules:**
- Use `tokio::sync::Mutex` (not `std::sync::Mutex`) when holding across `.await`.
- Wrap blocking I/O in `tokio::task::spawn_blocking`.
- Map low-level errors to `HalError` at the trait boundary. Don't leak `rusb`, `btleplug`, or `serialport` types past the driver.
- Each driver has a `mod.rs` re-export and a `DriverInfo` constant used by the registry.

---

## The mandatory mock implementation

Every trait must have a mock. The mock is used by every test in the rest of the codebase that touches hardware.

```rust
// crates/oz-hal/src/drivers/mock.rs

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};   // std::sync::Mutex — held only briefly, no .await between lock and unlock
use async_trait::async_trait;
use crate::traits::barcode::{BarcodeScanner, DeviceInfo};
use crate::types::Barcode;

/// A programmable mock for `BarcodeScanner`. Tests push scans into a queue;
/// the mock returns them in order.
#[derive(Default, Clone)]
pub struct MockBarcodeScanner {
    queue: Arc<Mutex<VecDeque<Barcode>>>,
    pub connect_calls: Arc<AtomicUsize>,
    pub poll_calls: Arc<AtomicUsize>,
}

impl MockBarcodeScanner {
    pub fn new() -> Self { Self::default() }

    /// Queue a barcode to be returned by the next `poll`. Safe to call from
    /// any context (sync test setup or async runtime) — uses `std::sync::Mutex`
    /// which never panics inside a Tokio runtime.
    pub fn push(&self, code: Barcode) {
        self.queue.lock().expect("mock queue poisoned").push_back(code);
    }
}

#[async_trait]
impl BarcodeScanner for MockBarcodeScanner {
    async fn connect(&self) -> Result<Box<dyn BarcodeScanner>, HalError> {
        self.connect_calls.fetch_add(1, Ordering::SeqCst);
        Ok(Box::new(self.clone()))
    }

    async fn poll(&mut self, timeout_ms: u32) -> Result<Option<Barcode>, HalError> {
        self.poll_calls.fetch_add(1, Ordering::SeqCst);
        // Lock is acquired and released in the same statement — never held across .await
        Ok(self.queue.lock().expect("mock queue poisoned").pop_front())
    }

    async fn cancel(&self) -> Result<(), HalError> { Ok(()) }

    fn device_info(&self) -> DeviceInfo {
        DeviceInfo {
            vendor: "mock".into(),
            model: "MockBarcode".into(),
            serial: "0000".into(),
        }
    }
}
```

**Rules:**
- Mocks are **stateful** and **programmable**. Tests push inputs, then assert what the system did with them.
- Counters (`connect_calls`, `poll_calls`, …) make assertions on driver behavior trivial.
- Mocks implement the **same trait** as the real driver. No special "mock mode" in business code.
- Mocks are `Send + Sync + Clone` so multiple tests can share them.

---

## The DriverRegistry

Hardware is discovered at startup and exposed to the rest of the app through a single registry. Commands ask the registry for a device by category; the registry picks an available driver.

```rust
// crates/oz-hal/src/registry.rs

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use crate::traits::barcode::BarcodeScanner;

#[derive(Default)]
pub struct DriverRegistry {
    scanners: RwLock<HashMap<String, Arc<dyn BarcodeScanner>>>,
    printers: RwLock<HashMap<String, Arc<dyn ReceiptPrinter>>>,
    // ...
}

impl DriverRegistry {
    pub async fn register_scanner(&self, id: &str, driver: Arc<dyn BarcodeScanner>) {
        self.scanners.write().await.insert(id.into(), driver);
    }

    pub async fn scanner(&self, id: &str) -> Option<Arc<dyn BarcodeScanner>> {
        self.scanners.read().await.get(id).cloned()
    }
}
```

**Rules:**
- Registry is held in `AppState` and reached via `State<'_, AppState>` in Tauri commands.
- Production registration is config-driven: `apply_config(&HardwareConfig)` (in `bootstrap.rs`) turns the operator's saved config into registered drivers and returns a `BootstrapReport` (registered / skipped / rejected). Apps map their persistence (`TerminalProfile`) → `HardwareConfig` via `platform_startup::hardware`; the HAL never reads a settings table. Addressed transports (network, Bluetooth-on-a-COM-port, serial) are constructed without touching the device, so a stale profile cannot stall startup. `Connection::Usb` is the exception — it names no address, so it enumerates the bus.
- **The registry id is the contract, and the question is who chooses it.** Some commands hardcode their lookup string (`printer("default")`, `printer("kitchen")`, `scale("default")`); for those, only config can bind a usable id, because `discover()` mints hardware-derived ones like `printer:vendor:model` that can never satisfy a fixed string. Other devices are never named by a caller at all: the UI lists the registered ids and hands one back. Barcode scanners work this way — `useBarcodeScanner.ts` auto-detects with `scanners[0]?.id`, then `start_scanner_scoped` looks that id up — so a discovery-minted id round-trips correctly and config would be pure friction. **Decide which case a device is in before choosing a registration path.** Getting it backwards is what left barcode input dead in both clients for as long as the registry had no write side.
- `discover()` is the auto-probe phase (USB/Bluetooth/serial); failure of one driver does not abort discovery. Its scanner half runs at startup as `discover_scanners()`, reached through `HardwareConfig::autodetect_scanners`; the printer/display half is still uncalled, for the id reason above. Enumeration opens no port — `probe_ports`/`probe_bluetooth` call `available_ports()`, and each driver's `new()` leaves the handle `None` until `connect()` — so "discovery touches hardware" is not a reason to avoid it.
- A device the operator did not name must not appear on a **money** path because it was found. Card terminals are deliberately absent from `discover()` for this reason — see `discover_never_registers_a_card_terminal`. Scanners carry no such risk, which is why they are the exception.
- Setup wizard uses the registry to show "what's plugged in."

---

## Error type

```rust
// crates/oz-hal/src/error.rs

use thiserror::Error;

#[derive(Debug, Error)]
#[non_exhaustive]
pub enum HalError {
    #[error("device not found: {0}")]
    NotFound(String),

    #[error("device disconnected")]
    Disconnected,

    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),

    #[error("usb error: {0}")]
    Usb(String),

    #[error("bluetooth error: {0}")]
    Bluetooth(String),

    #[error("operation timed out after {0} ms")]
    Timeout(u32),

    #[error("protocol error: {0}")]
    Protocol(String),

    #[error("device busy")]
    Busy,

    /// The driver is present but this operation is not implemented — the
    /// fail-closed default for every stubbed device path, so an
    /// unimplemented driver can never silently report success.
    #[error("operation not supported: {0}")]
    Unsupported(String),
}
```

**Rules:**
- `HalError` is `#[non_exhaustive]`. Add variants without breaking semver.
- Every variant maps to a `HalErrorKind` discriminator (`error.rs`, camelCase-serialized) that the front-end mirrors as `AppError.subKind` so UI code branches on the failure mode without parsing strings — map with `.kind()`. The Tauri command layer fails closed with `HalErrorKind::NotFound` for unknown registry ids.
- Always include enough context to debug. "I/O error" is not enough; include the operation.
- Drivers convert third-party errors with `.map_err(|e| HalError::Usb(e.to_string()))` at the boundary.

---

## Testing

Driver tests use the mock to simulate hardware. No physical device required.

```rust
#[tokio::test]
async fn sale_completes_after_scan() {
    let scanner = MockBarcodeScanner::new();
    scanner.push(Barcode::new("ABC123"));
    let mut pos = PosTerminal::new(scanner.clone());
    pos.scan().await.unwrap();
    assert_eq!(pos.cart().lines().count(), 1);
    assert_eq!(scanner.poll_calls.load(Ordering::SeqCst), 1);
}
```

**Rules:**
- Tests use `MockBarcodeScanner`, `MockReceiptPrinter`, etc. — never a real driver.
- For driver-internal tests (e.g., parsing a USB packet), use synthetic byte buffers.
- Mocks live in `crates/oz-hal/src/drivers/mock.rs` and are **always compiled** — there is no `mock` feature gate; just `cargo test`.

---

## Adding a new device — checklist

- [ ] Define the trait in `crates/oz-hal/src/traits/<device>.rs` with `async` methods returning `Result<T, HalError>`.
- [ ] Re-export from `crates/oz-hal/src/traits/mod.rs`.
- [ ] Add the `HalError` variant(s) if needed.
- [ ] Implement the driver in `crates/oz-hal/src/drivers/<transport>_<device>.rs` (e.g. `usb_scanner.rs`, `tcp_printer.rs`, `edc/wired.rs`) — drivers are named by transport, not by vendor.
- [ ] Re-export the driver from `crates/oz-hal/src/drivers/mod.rs`.
- [ ] **Add the mock to `crates/oz-hal/src/drivers/mock.rs`.** Required by the coding standard (`AGENTS.md` → *Database & Hardware* → **HAL Drivers**), enforced by review only — no CI job, no hook step and no checker under `scripts/` looks for it, so an unmocked driver reaches main and the first person to run it on a machine without that hardware finds out. That is not the reason to write it: the mock IS the harness — it is how the driver is exercised at all, in tests and on every dev machine that has no such device bolted to it.
- [ ] Make it reachable, by asking **who picks the id**. If a command looks the device up under a name the operator configured, add a `HardwareConfig` entry in `bootstrap.rs` and map the profile field in `platform_startup::hardware::config_from_profile`, registering under the **exact id the command looks up**. If instead the UI lists registered ids and hands one back, enumerate it — see `discover_scanners()`, which is that case. A fixed-string lookup will never find a discovery-minted id, and requiring an operator to name a device no screen ever asked them about is how a feature ends up unreachable with correct code behind it.
- [ ] Add a Tauri command in `apps/desktop-client/src/commands/hardware.rs` that takes the registry from `State` and returns a `Result`. Fail closed with `HalErrorKind::NotFound` when the id is absent; never substitute a mock.
- [ ] Add a TS wrapper in `ui/src/api/<feature>.ts` and a hook in `ui/src/features/<feature>/`.
- [ ] Tests: a unit test in the driver, a feature test using the mock, and a UI test with the hook.

---

## Common pitfalls

1. **Holding `std::sync::Mutex` across `.await`.** Use `tokio::sync::Mutex` or restructure.
2. **Forgetting the mock.** Tests then need a real device, which makes CI fragile.
3. **Leaking low-level errors** like `rusb::Error` past the driver. Wrap in `HalError`.
4. **Hardcoding a vendor name** in business code (`UsbHidBarcodeScanner::new()`). Use the registry.
5. **Blocking the executor** with a `read_exact` call. Wrap in `spawn_blocking`.
6. **Not handling the `Disconnected` case** — the cashier unplugs the scanner mid-shift. The system must reconnect or surface a clear error.
7. **Polling with `loop { sleep(1ms) }`** instead of waiting on a real event. Burns CPU and battery.
8. **Mixing sync and async traits.** Pick one. The HAL is `async`.

---

## See also

- **[`tauri-ipc`](../tauri-ipc/SKILL.md)** — the Tauri command layer that reaches into `DriverRegistry`. Hardware commands (e.g. `subscribe_barcode_scans`, `open_cash_drawer`, `print_receipt`) live in `apps/desktop-client/src/commands/hardware.rs` and follow the IPC patterns in `tauri-ipc`. The mock in `crates/oz-hal/src/drivers/mock.rs` is what makes those commands testable.
- **[`rust-backend`](../rust-backend/SKILL.md)** — defines the error and money patterns (`HalError`, `Money`, currency codes) that the HAL's traits and drivers must respect.
- **[`project-scaffold`](../project-scaffold/SKILL.md)** — the workspace layout (the `hal` crate's `Cargo.toml` follows the conventions there) and CI rules that gate the HAL into release.

---

> last audited 03-09-26 by DSH
