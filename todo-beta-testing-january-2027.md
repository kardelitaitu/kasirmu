# Beta Testing Master Plan (January 2027)

<!-- Audit stamp: 2026-10-02 · Product & Release Engineering · Status: ACTIVE PLAN -->

**Project:** `kasir.mu`  
**Document:** `todo-beta-testing-january-2027.md`  
**Target Milestone:** Public Pilot & Beta Testing Kickoff — January 2027  
**Target Hardware Platforms:** Windows 10/11 (Desktop/Laptop) and Android (8"–10" Tablets)  
**Acceptance Command:** `cargo check -p kasirmu-desktop -p kasirmu-mobile && cd ui && npm run check:all`

---

## 1. Executive Objective

The objective of this plan is to deliver a production-hardened, zero-defect Beta release of `kasir.mu` by **January 2027** for a controlled cohort of 10–20 live retail and F&B merchants across Indonesia.

The Windows desktop engine is already production-ready. The primary focus of the next 90 days (October – December 2026) is **Android tablet stabilization, hardware abstraction layer (HAL) validation, real-world failure injection, and a frictionless 5-minute onboarding experience.**

---

## 2. Platform Readiness Matrix

| Component | Windows 10/11 Target | Android Tablet Target | Current Readiness |
| :--- | :--- | :--- | :--- |
| **Runtime Shell** | Tauri v2 (`apps/desktop-tauri`) | Tauri v2 (`apps/mobile-tauri`) | Windows: 95% / Android: 65% |
| **Embedded DB** | SQLite 3 (`rusqlite` + WAL) | SQLite 3 (`rusqlite` + WAL) | 90% (Common core) |
| **Receipt Printing** | USB / COM / Network ESC/POS | Bluetooth SPP / BLE / Network ESC/POS | Windows: Done / Android: In Progress |
| **Barcode Scanning** | Hardware USB-HID Scanner | USB-OTG Scanner / Camera Scan | Windows: Done / Android: Pending |
| **Cash Drawer** | Printer RJ-11 Kick Pulse | Printer RJ-11 Kick Pulse | Windows: Done / Android: Pending |
| **Packaging** | NSIS `.exe` / MSI Installer | Sideloadable `.apk` / Closed Testing Track | Windows: 80% / Android: 50% |

---

## 3. Actionable Checklist

### Phase 1: Android Parity & Hardware Stabilization (October 2026)
*Target: Complete feature parity and hardware driver support on Android tablets.*

#### 1.1 Android Build & Release Pipeline
- [ ] Stabilize reproducible release APK compilation (`cargo tauri android build --apk`).
- [ ] Configure Android release keystore and automated artifact signing.
- [ ] Verify execution on Android 10, 11, 12, 13, and 14 using real hardware and emulators.
- [ ] Validate memory footprint remains bounded under 150 MB on budget 3GB/4GB RAM tablets.

#### 1.2 Android Hardware Drivers (HAL)
- [ ] **Bluetooth ESC/POS Printer:** Implement Bluetooth device discovery, pairing, and raw ESC/POS byte streaming in `crates/kasirmu-hal`.
- [ ] **Android Runtime Permissions:** Implement native permission requests for `BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN`, and `ACCESS_FINE_LOCATION` (Android 11–12 backward compatibility).
- [ ] **Cash Drawer Kick:** Verify drawer kick pulse (`ESC p 0 25 250`) passes reliably through Bluetooth thermal printers.
- [ ] **Network / LAN Printer Support:** Verify TCP socket printing (`port 9100`) to network thermal receipt printers on the local store Wi-Fi.

#### 1.3 Tablet UX & Ergonomic Refinements
- [ ] **Orientation Lock:** Force default landscape orientation on tablet devices (`SCREEN_ORIENTATION_SENSOR_LANDSCAPE`).
- [ ] **Touch Target Sizing:** Audit all cashier buttons, numpad keys, and cart line items to guarantee minimum 48×48 dp physical touch targets.
- [ ] **Virtual Keyboard Handling:** Add `windowSoftInputMode="adjustResize"` and UI scroll constraints to ensure soft keyboards never obscure the "Pay" button or total amount.
- [ ] **Tablet Split Layout:** Verify responsive master-detail layout (Product Grid on Left, Cart & 10-key on Right) across 1280×800, 1920×1080, and 2000×1200 tablet resolutions.

---

### Phase 2: Failure Injection, Offline Resilience & Packaging (November 2026)
*Target: Bulletproof stability under harsh, real-world retail conditions.*

#### 2.1 Fault Tolerance & Dirty Shutdown Testing
- [ ] **Process-Kill Simulation:** Script automated process termination (`kill -9` / taskkill) mid-transaction and verify SQLite WAL recovers cleanly with zero corrupted records.
- [ ] **Multi-Day Disconnected Operation:** Run 200 consecutive sales in disconnected offline mode; verify zero memory leaks and instantaneous local receipt printing.
- [ ] **Reconnection & Delta Sync:** Re-establish network after offline sales; verify deterministic monotonic delta sync to cloud without duplicates or ledger divergence.
- [ ] **Network Jitter Resilience:** Simulate spotty 3G mobile hotspot connections with 40% packet drop; verify sync daemon retries gracefully with exponential backoff.

#### 2.2 Telemetry & Self-Service Diagnostics
- [ ] **One-Click Diagnostic Export:** Build a "Export Diagnostic Logs" button in Settings that generates an encrypted, sanitized `.zip` containing recent sync logs and error traces.
- [ ] **Crash Telemetry:** Wire crash reporter hook to capture unhandled panics and fatal WebView JavaScript exceptions without collecting sensitive customer PII.
- [ ] **Storage Health Monitor:** Add automatic warning banner when terminal local disk space drops below 500 MB.

#### 2.3 Production Packaging
- [ ] **Windows Packaging:** Build signed NSIS `.exe` installer bundling Microsoft Edge WebView2 Evergreen bootstrapper for fresh Windows 10/11 installs.
- [ ] **Android Packaging:** Generate signed standalone `.apk` for direct merchant download from `kasir.mu/download`.
- [ ] **Google Play Closed Testing:** Setup internal/closed testing track on Google Play Console for frictionless 1-click merchant invite links.

---

### Phase 3: Pilot Cohort Onboarding & Code Freeze (December 2026)
*Target: Frictionless merchant onboarding, pilot recruitment, and complete bug burn-down.*

#### 3.1 Pilot Merchant Recruitment (10–20 Outlets)
- [ ] **Cohort A (Windows):** Recruit 5–10 retail shops, mini-markets, or boutiques with existing Windows laptops/desktops.
- [ ] **Cohort B (Android):** Recruit 5–10 coffee shops, bakeries, or quick-service food stalls with Android tablets.
- [ ] **Establish Direct VIP Support:** Create dedicated WhatsApp/Telegram merchant group for rapid 24-hour bug turnaround during beta.

#### 3.2 The 5-Minute "First-Run" Onboarding Wizard
- [ ] Step 1: Store Name, Category (Retail vs F&B), and Currency (IDR).
- [ ] Step 2: Tax configuration preset (PPN 11%, service charge, or 0% tax-free).
- [ ] Step 3: Seed 5 customizable sample products (e.g., Americano, Croissant, Mineral Water).
- [ ] Step 4: Printer Pairing & "Print Test Receipt" button to prove hardware connectivity before the first customer arrives.

#### 3.3 Strict Code Freeze (December 15 – December 31, 2026)
- [ ] Enforce strict code freeze: **zero new features or scope additions**.
- [ ] Dedicated bug triage: fix all P1/P2 defects discovered during internal dry runs.
- [ ] Perform complete end-to-end dry run: install from scratch $\to$ onboarding $\to$ 50 sales $\to$ print receipts $\to$ end of shift $\to$ cloud sync.

---

### Phase 4: Beta Launch Day (January 2027)
*Target: Official distribution to pilot merchants and live operational monitoring.*

- [ ] **Day 1 Deployment:** Distribute installer links to Cohort A and Cohort B.
- [ ] **Live Telemetry Watch:** Monitor cloud server CPU, memory, and sync throughput during lunch (11:30–14:00 WIB) and dinner (18:00–21:00 WIB) rushes.
- [ ] **Daily Sync Audit:** Verify 100% convergence across all active pilot stores with zero unresolved vector-clock conflicts.
- [ ] **Feedback Log:** Maintain daily feedback log with categorized merchant suggestions (Usability, Hardware, Feature Request).

---

## 4. Success Criteria for Beta Graduation

A merchant is considered successfully graduated from Beta when:
1. **Zero Cashier Downtime:** Store operates for 14 consecutive business days without a fatal crash or checkout interruption.
2. **Zero Financial Discrepancies:** End-of-day cash drawer totals match the system financial report down to the exact Rupiah (`i64` Money).
3. **Hardware Reliability:** Thermal printer prints 100% of receipts without requiring app or device restarts.
4. **Frictionless Sync:** All offline transactions sync to the central cloud dashboard within 60 seconds of reconnecting to the internet.
