# Plan: Track 1 — Android Hardware & Thermal Printing (HAL) 🖨️

<!-- Audit stamp: 2026-10-05 · AGY · status: PLANNED · version lock: 0.0.41 -->

## Executive Summary
Track 1 focuses on connecting physical point-of-sale peripherals to the Android tablet client (`apps/mobile-tauri`).
The scope spans four core pillars:
1. **Bluetooth ESC/POS Printer (Android HAL)**: Device discovery, pairing, and byte streaming over Android RFCOMM / JNI sockets in `kasirmu-hal`.
2. **Network / LAN Thermal Printer**: Raw TCP socket printing (port 9100) over local store Wi-Fi with resilient auto-reconnect.
3. **Cash Drawer Kick Integration**: Firing standard drawer kick pulse (`ESC p 0 25 250` / `ESC p 1 25 250`) through Bluetooth, Network, and USB thermal printers.
4. **Android Runtime Permissions & Dynamic Configuration**: Polished permission flow (`BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN`) and seamless real-time registry reload without needing app restarts.

---

## Architecture & Codebase State Analysis

### 1. Bluetooth RFCOMM / SPP Transport (`kasirmu-hal`)
- **Transport (`crates/kasirmu-hal/src/transport/bt_android.rs`)**:
  - Implements Android RFCOMM serial stream over JNI (`BluetoothAdapter`, `createRfcommSocketToServiceRecord`, `BluetoothSocket`).
  - ART calls `JNI_OnLoad` in `bt_android.rs` upon loading `libkasirmu_mobile_lib.so` to capture `JavaVM`.
  - `paired_devices()` queries bonded devices via `BluetoothAdapter.getBondedDevices()`.
  - `BtRfcommStream::connect(address)` binds to SPP UUID `00001101-0000-1000-8000-00805F9B34FB` on a blocking background thread (`spawn_blocking`).
  - Implements `std::io::Read` and `std::io::Write`.
- **Driver (`crates/kasirmu-hal/src/drivers/bt_android_printer.rs`)**:
  - `AndroidBtReceiptPrinter` implements `ReceiptPrinter` (`print_receipt`, `print_raw`, `cut`, `device_info`).
  - Lazy connection on first print; formats ESC/POS payloads via `escpos::format_receipt`.

### 2. Network / LAN Thermal Printer (`tcp_printer.rs`)
- **Driver (`crates/kasirmu-hal/src/drivers/tcp_printer.rs`)**:
  - `TcpReceiptPrinter` communicates over raw TCP sockets on port 9100.
  - Automatically reconnects if a cached connection drops or times out.
  - Implements `ReceiptPrinter` cross-platform (Android tablet and desktop POS).

### 3. Cash Drawer Kick (`drawer.rs`)
- **Driver (`crates/kasirmu-hal/src/drivers/drawer.rs`)**:
  - `PrinterKickCashDrawer` wraps `Arc<dyn ReceiptPrinter>` and sends `escpos::KICK_DRAWER_PIN2` (`[0x1B, 0x70, 0x00, 0x19, 0xFA]`) or PIN5.
- **Identified Gap (G1 — Drawer Registry Id Mismatch)**:
  - `apply_config` registers printer companion cash drawers under `drawer:kick:{printer.id}` (e.g. `drawer:kick:default`).
  - `open_cash_drawer_scoped` in `kasirmu_bridge::hardware` defaults `device_id` to `"default"`:
    `ctx.registry.cash_drawer("default").await`.
  - Lookup currently returns `None` unless the caller explicitly passes `deviceId: "drawer:kick:default"`.
  - **Fix**: In `DriverRegistry::cash_drawer`, if `id == "default"`, fall back to `"drawer:kick:default"`, or register an alias `"default"` pointing to the default printer's companion drawer during `apply_config`.

### 4. Dynamic Hardware Reconfiguration & Persistence (G2)
- **Identified Gap (G2 — Mobile Profile Persistence & Live Reload)**:
  - In `apps/mobile-tauri/src/commands/settings.rs:662`, `set_hardware_settings_scoped` writes to the store's `settings` table instead of persisting to `hardware_profiles` (which is where `platform_startup::hardware::load_profile` loads from).
  - When an operator changes printer configuration in Settings and clicks "Save", `state.registry` was not reloaded. Running "Test Print" immediately afterwards would fail or use the stale device until the application was restarted.
  - **Fix**:
    1. Align `apps/mobile-tauri/src/commands/settings.rs` to write the `hardware_profiles` table (via `kasirmu_bridge::settings::set_hardware_settings_scoped`).
    2. After updating `hardware_profiles`, reload `state.registry` dynamically using `platform_startup::hardware::register_hardware(&state.registry, &profile)`.

### 5. Android Permissions & WebView Bridge
- `AndroidManifest.xml` already contains:
  - `BLUETOOTH` & `BLUETOOTH_ADMIN` (maxSdk 30).
  - `BLUETOOTH_CONNECT` & `BLUETOOTH_SCAN` (`neverForLocation`).
- `MainActivity.kt` provides `KasirmuNativeBridge`:
  - `hasBluetoothPermissions()`, `requestBluetoothPermissions()`, `getPairedBluetoothDevices()`.
  - Emits `kasirmu:bluetoothPermissionResult` event back to the WebView on grant.
- `RestaurantReceiptsScreen.tsx` consumes the native bridge for device pairing and test printing.

---

## Implementation Phases

### Phase 1: Registry & Companion Drawer Alias Resolution (✅ Completed — commit 77af354e8)
- **Files**:
  - `crates/kasirmu-hal/src/registry.rs`
  - `crates/kasirmu-hal/src/registry_tests.rs`
  - `crates/kasirmu-bridge/src/hardware_tests.rs`
- **Actions**:
  1. In `DriverRegistry::cash_drawer(&self, id: &str)`:
     If lookup by `id` is `None` and `id == "default"`, checks for `"drawer:kick:default"` before returning `None`.
  2. Verified standalone drawer taking precedence over companion drawer when named `"default"`.
  3. Added unit tests in `kasirmu-hal` and `kasirmu-bridge` asserting `open_cash_drawer_scoped` with default arguments opens companion kick drawer.

### Phase 2: Live Hardware Reload & Tablet Profile Alignment (✅ Completed — commit 77af354e8)
- **Files**:
  - `apps/mobile-tauri/src/commands/settings.rs`
  - `apps/desktop-tauri/src/commands/settings.rs`
  - `crates/kasirmu-bridge/src/settings/dto.rs`
- **Actions**:
  1. Updated `set_hardware_settings_scoped` in `apps/mobile-tauri` to persist to canonical `hardware_profiles` DB table (plus fallback JSON and legacy store settings).
  2. Added live hardware re-registration on `state.registry` via `platform_startup::hardware::register_hardware(&state.registry, &profile)` in both mobile and desktop shells upon save.
  3. Derived `Clone` on `HardwareSettingsDto`. Verified clean checks and test suites across all crates.

### Phase 3: Android Bluetooth & TCP Printer Verification (✅ Completed)
- **Files**:
  - `crates/kasirmu-hal/src/drivers/bt_android_printer.rs`
  - `crates/kasirmu-hal/src/drivers/tcp_printer.rs`
  - `crates/kasirmu-hal/src/transport/bt_android.rs`
  - `apps/mobile-tauri/gen/android/app/src/main/java/mu/kasir/mobile/MainActivity.kt`
- **Actions**:
  1. Verified Bluetooth bond enumeration and exception handling in `bt_android.rs` (`exception_clear()`, `SecurityException` mapped to `HalError::PermissionDenied`, `adapter_absent` guard).
  2. Verified TCP printer socket auto-reconnect logic on broken pipes / network disconnects in `tcp_printer.rs`.
  3. Integrated physical cash drawer kick on cash checkout completion in `PaymentModal.tsx`.

### Phase 4: UI Hardware Setup & Test Print Polish (✅ Completed)
- **Files**:
  - `ui/src/features/sales/PaymentModal.tsx`
  - `ui/src/features/restaurant/screens/RestaurantReceiptsScreen.tsx`
  - `ui/src/features/settings/workspace-cards/WorkspaceStorePosSettings.tsx`
  - `ui/src/features/sales/PosScreen.tsx`
  - `ui/src/features/sales/components/CartPanel.tsx`
  - `ui/src/features/restaurant/components/RestaurantSidebar.tsx`
  - `shared-ui/locales/`
- **Actions**:
  1. Added manual "Open Cash Drawer" buttons in retail POS CartPanel and restaurant POS sidebar popover.
  2. Added "Test Cash Drawer" alongside "Test Print Receipt" in Restaurant Receipts settings with direct toast feedback.
  3. Added Bluetooth connection mode (with MAC address entry) and Hardware Actions ("Test Print", "Test Cash Drawer") in WorkspaceStorePosSettings.
  4. Verified all unit tests and bundle parity across English and Indonesian locales.

---

## Acceptance Criteria & Commands

1. **Rust Crate Tests & Linting**:
   ```bash
   cargo check -p kasirmu-hal && cargo test -p kasirmu-hal
   cargo check -p kasirmu-bridge && cargo test -p kasirmu-bridge
   cargo check -p kasirmu-mobile
   ```

2. **UI Gates**:
   ```bash
   cd ui && npm run check:all
   ```

3. **Behavioral Invariants**:
   - `open_cash_drawer_scoped` with default arguments successfully kicks the drawer when a default receipt printer (Bluetooth, TCP, or USB) is configured.
   - Saving printer settings in Settings immediately updates the active printer without restarting the app.
   - Bluetooth permission checks and pairing list gracefully handle denial on Android API 31+.
