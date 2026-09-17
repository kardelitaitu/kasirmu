/*
last audited 25-07-26 by RSA-Agent (oz-hal slice A: registry deep read)
crate: oz-hal | status: SAFE | lint: CLEAN
findings: clean — per-category RwLock maps with documented overwrite semantics; discovery fail-open per driver (one failure never aborts the rest); deterministic device-id scheme with serial/model fallback; companion cash-drawer registration for every printer. Six categories as of 31-08-26: the EDC terminal slot arrived with the HAL unification, closing the bypass where a card terminal was reachable only through a hardcoded AppState field rather than the registry. EDC is registered by configuration (register_wired_terminal / register_wireless_terminal, the same shape register_tcp_printer uses) and is deliberately absent from discover() — auto-probing and silently binding a money device would let an unconfigured terminal show up in the tender list. That decision is pinned by discover_never_registers_a_card_terminal. GAP (open, Phase 2): discover() also never registers a WeightScale, but for the opposite reason — no discovery path exists for it yet (drivers/scale.rs HidWeightScale has no discover_all(), and no caller invokes register_scale()), so read_scale_weight_scoped always resolves to None in production even though both clients expose the command and Feature::UsbScale is declarable. register_mock_scale() was removed 31-08-26: zero callers, it injected a mock into the production registry, and it was the crate's only library-side panic path (try_write().expect())
next: scale discovery + TCP printer discovery (Phase 2) | perf: short-lived read locks on lookup
*/
//! `DriverRegistry` — the runtime's catalogue of available hardware.
//!
//! The registry holds `Arc<dyn Trait>` per device category, indexed by a
//! user-defined string id. Commands reach hardware through the registry
//! (`state.registry.scanner(id)`) and never construct a specific driver.
//!
//! Discovery (`DriverRegistry::discover()`) probes USB, Bluetooth, and
//! serial at startup and populates the registry. Failure of one driver
//! does not abort discovery; the rest still get registered.

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::RwLock;

use crate::drivers::drawer::PrinterKickCashDrawer;
use crate::traits::barcode::BarcodeScanner;
use crate::traits::cash_drawer::CashDrawer;
use crate::traits::customer_display::CustomerDisplay;
use crate::traits::edc::EdcTerminal;
use crate::traits::printer::ReceiptPrinter;
use crate::traits::weight_scale::WeightScale;
use crate::types::DeviceInfo;

/// Shared, mutable catalogue of HAL drivers.
#[derive(Default)]
pub struct DriverRegistry {
    scanners: RwLock<HashMap<String, Arc<dyn BarcodeScanner>>>,
    printers: RwLock<HashMap<String, Arc<dyn ReceiptPrinter>>>,
    drawers: RwLock<HashMap<String, Arc<dyn CashDrawer>>>,
    displays: RwLock<HashMap<String, Arc<dyn CustomerDisplay>>>,
    scales: RwLock<HashMap<String, Arc<dyn WeightScale>>>,
    terminals: RwLock<HashMap<String, Arc<dyn EdcTerminal>>>,
}

impl DriverRegistry {
    /// Construct an empty registry. Use `register_*` to add devices.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a barcode scanner under `id`. Overwrites any previous
    /// entry with the same id.
    pub async fn register_scanner(&self, id: &str, driver: Arc<dyn BarcodeScanner>) {
        self.scanners.write().await.insert(id.to_owned(), driver);
    }

    /// Register a receipt printer under `id`. Overwrites any previous
    /// entry with the same id.
    pub async fn register_printer(&self, id: &str, driver: Arc<dyn ReceiptPrinter>) {
        self.printers.write().await.insert(id.to_owned(), driver);
    }

    /// Register a cash drawer under `id`. Overwrites any previous
    /// entry with the same id.
    pub async fn register_cash_drawer(&self, id: &str, driver: Arc<dyn CashDrawer>) {
        self.drawers.write().await.insert(id.to_owned(), driver);
    }

    /// Look up a scanner by id. Returns `None` if no scanner is registered.
    pub async fn scanner(&self, id: &str) -> Option<Arc<dyn BarcodeScanner>> {
        self.scanners.read().await.get(id).cloned()
    }

    /// Look up a printer by id. Returns `None` if no printer is registered.
    pub async fn printer(&self, id: &str) -> Option<Arc<dyn ReceiptPrinter>> {
        self.printers.read().await.get(id).cloned()
    }

    /// Look up a cash drawer by id. Returns `None` if no drawer is registered.
    pub async fn cash_drawer(&self, id: &str) -> Option<Arc<dyn CashDrawer>> {
        self.drawers.read().await.get(id).cloned()
    }

    /// Snapshot of registered scanner ids (for the setup wizard's "what's
    /// plugged in?" view).
    pub async fn scanner_ids(&self) -> Vec<String> {
        sorted_keys(&*self.scanners.read().await)
    }

    /// Snapshot of registered printer ids.
    pub async fn printer_ids(&self) -> Vec<String> {
        sorted_keys(&*self.printers.read().await)
    }

    /// Register a customer display under `id`. Overwrites any previous
    /// entry with the same id.
    pub async fn register_display(&self, id: &str, driver: Arc<dyn CustomerDisplay>) {
        self.displays.write().await.insert(id.to_owned(), driver);
    }

    /// Look up a customer display by id. Returns `None` if no display is registered.
    pub async fn display(&self, id: &str) -> Option<Arc<dyn CustomerDisplay>> {
        self.displays.read().await.get(id).cloned()
    }

    /// Snapshot of registered cash drawer ids.
    pub async fn drawer_ids(&self) -> Vec<String> {
        sorted_keys(&*self.drawers.read().await)
    }

    /// Snapshot of registered customer display ids.
    pub async fn display_ids(&self) -> Vec<String> {
        sorted_keys(&*self.displays.read().await)
    }

    /// Register a weight scale under `id`. Overwrites any previous
    /// entry with the same id.
    pub async fn register_scale(&self, id: &str, driver: Arc<dyn WeightScale>) {
        self.scales.write().await.insert(id.to_owned(), driver);
    }

    /// Look up a weight scale by id. Returns `None` if no scale is registered.
    pub async fn scale(&self, id: &str) -> Option<Arc<dyn WeightScale>> {
        self.scales.read().await.get(id).cloned()
    }

    /// Snapshot of registered scale ids.
    pub async fn scale_ids(&self) -> Vec<String> {
        sorted_keys(&*self.scales.read().await)
    }

    /// Register an EDC card-payment terminal under `id`. Overwrites any
    /// previous entry with the same id.
    pub async fn register_terminal(&self, id: &str, driver: Arc<dyn EdcTerminal>) {
        self.terminals.write().await.insert(id.to_owned(), driver);
    }

    /// Look up an EDC terminal by id. Returns `None` if none is registered.
    pub async fn terminal(&self, id: &str) -> Option<Arc<dyn EdcTerminal>> {
        self.terminals.read().await.get(id).cloned()
    }

    /// Snapshot of registered EDC terminal ids.
    pub async fn terminal_ids(&self) -> Vec<String> {
        sorted_keys(&*self.terminals.read().await)
    }

    /// Register a wired EDC terminal under the given id. The setup wizard
    /// calls this when an operator configures a card terminal by serial
    /// port, mirroring [`register_tcp_printer`].
    ///
    /// [`register_tcp_printer`]: Self::register_tcp_printer
    pub async fn register_wired_terminal(
        &self,
        id: &str,
        port_name: &str,
        baud_rate: u32,
        info: DeviceInfo,
    ) {
        let terminal = Arc::new(crate::drivers::edc::WiredEdcTerminal::new(
            port_name, baud_rate, info,
        ));
        self.register_terminal(id, terminal).await;
    }

    /// Register a wireless EDC terminal under the given id. The setup
    /// wizard calls this when an operator configures a Bluetooth or network
    /// card terminal.
    pub async fn register_wireless_terminal(
        &self,
        id: &str,
        target: crate::drivers::edc::WirelessTarget,
        info: DeviceInfo,
    ) {
        let terminal = Arc::new(crate::drivers::edc::WirelessEdcTerminal::new(target, info));
        self.register_terminal(id, terminal).await;
    }

    /// Discover and register barcode scanners, returning their ids.
    ///
    /// Scanners are the one device class an operator never names. The UI
    /// lists the registered ids and `useBarcodeScanner.ts` auto-detects by
    /// taking the first, so a hardware-derived id is the correct key here:
    /// it round-trips through the same call that produced it. Every other
    /// category in [`Self::discover`] is bound by configuration instead,
    /// because a command hardcodes its lookup string (`printer("default")`,
    /// `printer("kitchen")`) and a discovery-minted id can never satisfy it.
    ///
    /// Enumerates only — `discover_all()` opens no port and each driver
    /// connects on first use — so calling this at startup touches no
    /// hardware.
    pub async fn discover_scanners(&self) -> Vec<String> {
        let mut found = Vec::new();

        // --- USB HID barcode scanners ---
        for scanner in crate::drivers::usb_scanner::UsbHidBarcodeScanner::discover_all() {
            let info = scanner.device_info();
            let id = if info.serial.is_empty() || info.serial == "0000" {
                format!("scanner:usb:{}:{}", info.vendor, info.model)
            } else {
                format!("scanner:usb:{}", info.serial)
            };
            self.register_scanner(&id, Arc::new(scanner)).await;
            found.push(id);
        }

        // --- Serial barcode scanners ---
        for scanner in crate::drivers::serial_scanner::SerialBarcodeScanner::discover_all() {
            let info = scanner.device_info();
            // Serial port name is used as the identity key.
            let id = format!("scanner:serial:{}", info.serial);
            self.register_scanner(&id, Arc::new(scanner)).await;
            found.push(id);
        }

        // --- Bluetooth (SPP) barcode scanners ---
        for scanner in crate::drivers::bt_scanner::BtBarcodeScanner::discover_all() {
            let info = scanner.device_info();
            let id = format!("scanner:bt:{}", info.serial);
            self.register_scanner(&id, Arc::new(scanner)).await;
            found.push(id);
        }

        found.sort();
        found
    }

    /// Discover and register available hardware. Failure of one driver
    /// does not abort the rest. Probes USB HID scanners, serial scanners,
    /// and USB receipt printers, then registers them all.
    pub async fn discover(&self) {
        self.discover_scanners().await;

        // --- USB receipt printers (and companion cash drawers) ---
        for printer in crate::drivers::usb_printer::UsbReceiptPrinter::discover_all() {
            let info = printer.device_info();
            let id = if info.serial.is_empty() {
                format!("printer:{}:{}", info.vendor, info.model)
            } else {
                format!("printer:{}", info.serial)
            };
            let printer_arc = Arc::new(printer);
            self.register_printer(&id, printer_arc.clone()).await;
            // Register a companion cash drawer that kicks through this printer.
            let drawer_id = format!("drawer:kick:{}", id);
            let drawer = Arc::new(PrinterKickCashDrawer::new_pin2(printer_arc));
            self.register_cash_drawer(&drawer_id, drawer).await;
        }

        // --- Serial customer-facing pole displays ---
        for display in crate::drivers::serial_display::SerialCustomerDisplay::discover_all() {
            let info = display.device_info();
            let id = format!("display:serial:{}", info.serial);
            self.register_display(&id, Arc::new(display)).await;
        }

        // --- Bluetooth (SPP) receipt printers (and companion cash drawers) ---
        let bt_ports = crate::transport::serial::probe_bluetooth().unwrap_or_default();
        for port_info in bt_ports {
            let info = DeviceInfo::new("bluetooth", &port_info.description, &port_info.port_name);
            let printer =
                crate::drivers::bt_printer::BtReceiptPrinter::new(&port_info.port_name, 9600, info);
            let id = format!("printer:bt:{}", port_info.port_name);
            let printer_arc = Arc::new(printer);
            self.register_printer(&id, printer_arc.clone()).await;
            // Companion drawer for BT printers.
            let drawer_id = format!("drawer:kick:{}", id);
            let drawer = Arc::new(PrinterKickCashDrawer::new_pin2(printer_arc));
            self.register_cash_drawer(&drawer_id, drawer).await;
        }

        // EDC card terminals are deliberately NOT probed here. A money
        // device must be named by an operator before the register can take
        // a card on it: silently binding whatever serial device answers the
        // probe would let an unconfigured terminal appear in the tender
        // list. They are registered through register_wired_terminal /
        // register_wireless_terminal from the edc_terminals configuration
        // instead, the same way TCP printers and pole displays are.
        //
        // Weight scales are also absent, but for a different reason: no
        // discovery path exists for them yet. See the crate stamp.
    }

    /// Register a TCP (network) printer under the given id. Also registers
    /// a companion cash drawer that kicks through this printer. This is
    /// not auto-discovered; the setup wizard calls this when the user
    /// configures a printer by IP address or hostname.
    pub async fn register_tcp_printer(&self, id: &str, addr: &str, info: DeviceInfo) {
        let printer_arc = Arc::new(crate::drivers::tcp_printer::TcpReceiptPrinter::new(
            addr, info,
        ));
        self.register_printer(id, printer_arc.clone()).await;
        // Companion drawer for TCP printer.
        let drawer_id = format!("drawer:kick:{id}");
        let drawer = Arc::new(PrinterKickCashDrawer::new_pin2(printer_arc));
        self.register_cash_drawer(&drawer_id, drawer).await;
    }

    /// Register a serial receipt printer under the given id, plus its
    /// companion cash drawer.
    ///
    /// Covers RS-232, USB-serial and Bluetooth SPP alike — see
    /// [`crate::drivers::serial_printer`] for why one driver serves all
    /// three. The setup wizard calls this when an operator names a port.
    pub async fn register_serial_printer(
        &self,
        id: &str,
        port_name: &str,
        baud_rate: u32,
        info: DeviceInfo,
    ) {
        let printer_arc = Arc::new(crate::drivers::serial_printer::SerialReceiptPrinter::new(
            port_name, baud_rate, info,
        ));
        self.register_printer(id, printer_arc.clone()).await;
        let drawer_id = format!("drawer:kick:{id}");
        let drawer = Arc::new(PrinterKickCashDrawer::new_pin2(printer_arc));
        self.register_cash_drawer(&drawer_id, drawer).await;
    }

    /// Register a Bluetooth (SPP) printer under the given id, plus its
    /// companion cash drawer.
    ///
    /// `port_name` is the COM port the OS Bluetooth stack bound the device
    /// to — Bluetooth SPP is exposed as serial, so this registers the same
    /// [`crate::drivers::serial_printer::SerialReceiptPrinter`] that
    /// [`Self::register_serial_printer`] does. The two helpers stay separate
    /// because the setup wizard and the logs should report the transport the
    /// operator chose, not the socket class behind it.
    /// [`Self::discover`] binds one automatically for every Bluetooth port
    /// it finds.
    pub async fn register_bluetooth_printer(
        &self,
        id: &str,
        port_name: &str,
        baud_rate: u32,
        info: DeviceInfo,
    ) {
        let printer_arc = Arc::new(crate::drivers::bt_printer::BtReceiptPrinter::new(
            port_name, baud_rate, info,
        ));
        self.register_printer(id, printer_arc.clone()).await;
        let drawer_id = format!("drawer:kick:{id}");
        let drawer = Arc::new(PrinterKickCashDrawer::new_pin2(printer_arc));
        self.register_cash_drawer(&drawer_id, drawer).await;
    }

    /// Register a serial customer display under the given id. The setup
    /// wizard calls this when the user configures a pole display by port name.
    pub async fn register_serial_display(&self, id: &str, port_name: &str, info: DeviceInfo) {
        let display = Arc::new(crate::drivers::serial_display::SerialCustomerDisplay::new(
            port_name,
            crate::drivers::serial_display::DISPLAY_DEFAULT_BAUD,
            info,
        ));
        self.register_display(id, display).await;
    }

    /// Register a serial cash drawer under the given id. The setup wizard
    /// calls this when the user configures a standalone drawer by port name.
    pub async fn register_serial_drawer(&self, id: &str, port_name: &str, info: DeviceInfo) {
        let drawer = Arc::new(crate::drivers::drawer::SerialCashDrawer::new(
            port_name, 9600, info,
        ));
        self.register_cash_drawer(id, drawer).await;
    }
}

/// Sorted snapshot of a category's keys.
///
/// Sorted rather than `HashMap` order because these lists are handed
/// straight to the UI, and `ui/src/features/sales/useBarcodeScanner.ts`
/// auto-detects with `scanners[0]?.id`. Under `HashMap` iteration that
/// "first" is arbitrary and can change between two restarts of the same
/// register with the same hardware — the picker would silently follow a
/// different device. A stable order makes the choice reproducible; it does
/// not make it *meaningful*, which is what the configured-device preference
/// in `list_scanners_scoped` is for.
fn sorted_keys<T>(map: &HashMap<String, T>) -> Vec<String> {
    let mut keys: Vec<String> = map.keys().cloned().collect();
    keys.sort();
    keys
}

#[cfg(test)]
#[path = "registry_tests.rs"]
mod tests;
