# Windows Desktop Launch Test — kasir.mu
<!-- Audit stamp: 2026-09-09 . DSH . status: ACCURATE, 1 precision note (seed references flagged, not fixed) . Verified-true: scripts/build-exe-release.ps1 exists with -BuildConfig (line 5) and -NoInstaller (line 11) params; expected binary path apps/desktop-client/target/release/oz-pos-app.exe matches the script (scripts/build-exe-release.ps1:211); Tauri productName kasir.mu (apps/desktop-client/tauri.conf.json) so installer is kasir.mu_0.0.X_x64-setup.exe; window 1280x800 confirmed; internal doc links resolve (../releases/checklist.md; ../operations/vps-migration.md, docker-deployment.md, runbook.md tracked); Rust MSRV 1.88 (rust-toolchain.toml), Node>=22/npm>=11 (ui/package.json:80-82). FLAGGED not fixed: Option A runs cargo run --bin seeder (line 30) but no seeder binary exists in the repo (git grep name=seeder empty; apps/desktop-client/Cargo.toml defines only oz-pos-app and oz_pos_app_lib); Settings to Database to Seed Sample Data (line 34) and login error No staff accounts found (line 44) do not exist in code (absent from ui/src/features/settings/ and all .rs). Doc claims about a seed path that does not exist; left for the doc owner under code/config drift rule D. -->

> **Status:** Implemented (2026-07-20)
> **Target audience:** QA / developers testing on Windows 10/11
> **Related:** [Release Checklist](../releases/checklist.md) · [Build Script](https://github.com/kardelitaitu/oz-pos/blob/main/scripts/build-exe-release.ps1) · [Tauri Config](https://github.com/kardelitaitu/oz-pos/blob/main/apps/desktop-client/tauri.conf.json)

This guide covers building the kasir.mu desktop client on Windows and
running the core POS flow end-to-end on a physical Windows machine.

---

## Prerequisites

| Requirement | Version | Check |
|-------------|---------|-------|
| Windows 10 or 11 | 22H2+ (10.0.19045+) | `winver` |
| Rust toolchain | stable (1.88+) | `rustc --version` |
| Node.js | >=22 LTS | `node --version` |
| npm | >=11 | `npm --version` |
| Visual Studio Build Tools | 2022+ | `cl.exe` on PATH (from "Developer Command Prompt") |
| WebView2 Runtime | Included with Windows 11 / Edge | `winget list Microsoft.EdgeWebView2Runtime` or check `HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00FB3A96A4B7}` in Registry Editor |

### Test Data Seeding

Before running the launch test, ensure the database has seed data so
the login → POS → payment → receipt flow can execute:

```powershell
# Option A: demo seeder, from the repo root (the oz CLI)
cargo run -p kasirmu-cli -- seed-demo --all
cargo run -p kasirmu-cli -- seed-demo --retail --days 30

# Option B: first-run default settings and feature flags on a fresh DB
cargo run -p kasirmu-cli -- seed

> ⚠️ **Corrected 09-09-26 — the commands and menus this section listed were not real.**
> There is no `seeder` binary in the workspace (the 11 `[[bin]]` targets are `oz`,
> `oz-cloud-server`, `oz-pos-app`, `oz-pos-tablet`, and seven example/test bins), and
> `--seed-staff` / `--seed-products` / `--seed-workspace` appear nowhere. `oz seed-demo` is the
> real thing: the `SeedDemo` variant at `crates/kasirmu-cli/src/cli.rs:95`, dispatched at
> `crates/kasirmu-cli/src/commands/mod.rs:90` into `run_seed_demo`
> (`crates/kasirmu-cli/src/seed_demo.rs:64`), with flags `--retail`, `--restaurant`, `--all` and
> `--days <n>` (default 90) at `cli.rs:99-112`. `oz seed` (`cli.rs:39`) is the separate
> subcommand provisioning default settings and feature flags.
>
> Read the module header before relying on `seed-demo`: it generates ~10k time-series sales
> rows in about 2 seconds for analytics and report development. That is **not** a minimal
> first-launch dataset, and it does not guarantee a staff PIN you can log in with — a launch
> test that needs a PIN should create staff through the app.
>
> The `Settings → Database → Seed Sample Data` menu does not exist: that string occurs only in
> these launch guides and in nothing under `ui/src`, so it cannot be offered as a fallback. Nor
> is there a CI artifact — `test-data` appears in no workflow and in no file under `scripts/`
> (0 hits), so `target/release/test-data/kasir.db` has never been produced by a build.
```

> ⚠️ With no staff rows, login cannot succeed. The literal sentence once quoted here as on-screen
> copy — “No staff accounts found. Please seed the database first.” — exists nowhere in the
> code and in no `.ftl` bundle; it appears only in these two guides. Do not use it as an
> expected string, and do not read its absence from the screen as a result either way.

### Installing Prerequisites

**Rust:**
```powershell
winget install Rustup.Rustup
rustup default stable
rustup target add x86_64-pc-windows-msvc
```

**Node.js:**
```powershell
winget install OpenJS.NodeJS.LTS
```

**Visual Studio Build Tools:**
```powershell
# Install via Visual Studio Installer or winget
winget install Microsoft.VisualStudio.2022.BuildTools
# Then install "Desktop development with C++" workload
```

> ⚠️ **Important:** Open a **Developer Command Prompt for VS 2022** (not
> plain PowerShell) to ensure `cl.exe`, `link.exe`, and the Windows SDK
> headers are on `PATH`. Alternatively, run `vcvars64.bat`:
> ```cmd
> "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
> ```

---

## Build Steps

### Option A — Use the Build Script (Recommended)

```powershell
# From the repository root
.\scripts\build-exe-release.ps1 -BuildConfig Release
```

The script runs three phases:
1. **Frontend build:** `npm run build` in `ui/`
2. **Rust build:** `cargo build --release --target x86_64-pc-windows-msvc`
3. **Tauri build:** `cargo tauri build` → produces installer + portable EXE

Expected output location:
```
apps\desktop-client\target\release\oz-pos-app.exe           # Portable EXE
apps\desktop-client\target\release\bundle\nsis\kasir.mu_0.0.X_x64-setup.exe   # Installer
```

### Option B — Manual Build

```powershell
# Step 1: Build frontend
cd ui
npm ci --no-audit --no-fund --ignore-scripts
npm run build
cd ..

# Step 2: Build Tauri app (builds Rust + bundles installer)
cd apps\desktop-client
cargo tauri build
cd ..\..
```

### Option C — Build Portable EXE Only (No Installer)

```powershell
.\scripts\build-exe-release.ps1 -BuildConfig Release -NoInstaller
```

This skips the NSIS installer step and produces just `oz-pos-app.exe`.

---

## Launch Test Procedure

### Phase 1: Application Launch

| Step | Action | Expected Result |
|------|--------|----------------|
| 1.1 | Double-click `oz-pos-app.exe` (or launch installed app) | Splash screen appears within **5 seconds** |
| 1.2 | Wait for full load | Main window appears (1280×800 default). Login screen visible. |
| 1.3 | Check window chrome | Title bar shows **kasir.mu**. Window is centered. |
| 1.4 | Check taskbar | Icon renders correctly (not broken/blank). |
| 1.5 | Resize window | Drag edges — window resizes smoothly, no visual glitches. |

**Pass criteria:** App launches cleanly without crash dialog, console errors, or WebView2 failures.

**Common failures:**
- **"WebView2 Runtime not found"** — Install from [Microsoft](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)
- **"Side-by-side configuration is incorrect"** — Missing VC++ redistributable. Install from [Microsoft](https://aka.ms/vs/17/release/vc_redist.x64.exe)
- **"The application was unable to start correctly (0xc000007b)"** — 32-bit/64-bit mismatch. Ensure Rust target is `x86_64-pc-windows-msvc`.
- **"Entry point not found"** — Outdated Windows 10 build. Update to 22H2+.

### Phase 2: Login Flow

| Step | Action | Expected Result | Check |
|------|--------|----------------|-------|
| 2.1 | Enter staff PIN on numpad | Each digit highlights on press | ☐ |
| 2.2 | Submit PIN (press enter or OK) | Loading spinner appears briefly | ☐ |
| 2.3 | Successful login | Workspace picker screen appears with store cards | ☐ |
| 2.4 | Try wrong PIN | Error message: "Invalid PIN. 3 attempts remaining." After 3 attempts, account locks. | ☐ |
| 2.5 | Try empty PIN | Validation message: "Please enter a PIN." | ☐ |

**Pass criteria:** Login accepts valid PIN, rejects invalid PIN with user-friendly message, and navigates to workspace picker.

### Phase 3: Workspace Picker

| Step | Action | Expected Result | Check |
|------|--------|----------------|-------|
| 3.1 | Verify workspace cards | At least one card visible with store name and type | ☐ |
| 3.2 | Click a workspace card | Loading state → transitions to POS main screen | ☐ |
| 3.3 | Click "Switch Workspace" (if available) | Returns to workspace picker | ☐ |
| 3.4 | Keyboard navigation | Tab through cards. Enter selects. | ☐ |

**Pass criteria:** Workspace selection works, transitions are smooth, and can switch back.

### Phase 4: POS Main Screen

| Step | Action | Expected Result | Check |
|------|--------|----------------|-------|
| 4.1 | Product grid loads | Products visible with name, price, and image (or placeholder) | ☐ |
| 4.2 | Search products | Type in search bar — results filter in real-time (< 300ms per keystroke) | ☐ |
| 4.3 | Category filter | Click a category tab — grid filters to that category | ☐ |
| 4.4 | Scroll product list | Smooth scroll, no stutter or blank tiles | ☐ |
| 4.5 | Cart panel visible | Right-side cart panel shows empty state: "No items in cart" | ☐ |

**Pass criteria:** Products display correctly, search is responsive, categories work, cart panel renders.

### Phase 5: Add Items to Cart

| Step | Action | Expected Result | Check |
|------|--------|----------------|-------|
| 5.1 | Click a product | Item appears in cart with quantity 1, name, price | ☐ |
| 5.2 | Click same product again | Quantity updates to 2. Line total doubles. | ☐ |
| 5.3 | Click different product | Second line item added to cart | ☐ |
| 5.4 | Increase quantity in cart | Click + button → quantity increments | ☐ |
| 5.5 | Decrease quantity to 0 | Item removed from cart | ☐ |
| 5.6 | Cart total updates | Subtotal, tax, and total recalculate on every change | ☐ |

**Pass criteria:** Cart add/remove/update works with correct arithmetic.

### Phase 6: Payment Flow

| Step | Action | Expected Result | Check |
|------|--------|----------------|-------|
| 6.1 | Click "Pay" or "Checkout" | Payment modal/screen opens | ☐ |
| 6.2 | Select payment method | Cash, Card, or mixed options available | ☐ |
| 6.3 | For cash: enter amount tendered | Change due calculated and displayed | ☐ |
| 6.4 | Complete payment | Sale completes. Success animation/message. | ☐ |
| 6.5 | Navigate back | Cart is now empty. New sale ready. | ☐ |

**Pass criteria:** Payment modal opens, amount is correct, sale completes without error.

### Phase 7: Receipt

| Step | Action | Expected Result | Check |
|------|--------|----------------|-------|
| 7.1 | After sale completion | Receipt preview displays (or print dialog if printer configured) | ☐ |
| 7.2 | Verify receipt content | Items, quantities, prices, subtotal, tax, total, date, store name | ☐ |
| 7.3 | Close receipt | Returns to POS main screen with empty cart | ☐ |

**Pass criteria:** Receipt shows correct information. Returning to POS works cleanly.

### Phase 8: Edge Cases

| Step | Action | Expected Result | Check |
|------|--------|----------------|-------|
| 8.1 | Rapid product clicks | No duplicate line items at quantity 0 | ☐ |
| 8.2 | Empty cart checkout | Payment button disabled or validation message | ☐ |
| 8.3 | Network disconnect | Offline banner appears. Sale can still complete. | ☐ |
| 8.4 | App close during sale | Warning dialog: "Sale in progress. Discard?" | ☐ |
| 8.5 | Window minimization | App minimizes to taskbar. Restore returns to POS. | ☐ |
| 8.6 | Fullscreen toggle | F11 (or setting) toggles fullscreen. Windowed mode restores position. | ☐ |
| 8.7 | Multiple monitor | Drag to second monitor — app renders correctly. | ☐ |
| 8.8 | High DPI (150%+, 200%+) | All text, icons, and touch targets render at correct scale (no blur, no cutoff). | ☐ |

**Pass criteria:** All edge cases handled gracefully — no crashes, no data loss, no blank screens.

---

## Performance Checkpoints

| Metric | Acceptable | Target | Measurement |
|--------|-----------|--------|-------------|
| Cold start (first launch after boot) | < 10 s | < 5 s | Stopwatch from double-click to login screen |
| Warm start (subsequent launch) | < 5 s | < 3 s | Stopwatch |
| Product grid load (500 products) | < 2 s | < 500 ms | DevTools → Network tab |
| Search response (type-ahead) | < 500 ms | < 100 ms | Perceived latency |
| Cart total recalculation | < 100 ms | < 16 ms (60 fps) | Console time |
| Sale completion (click Pay to done) | < 2 s | < 500 ms | Stopwatch |
| Memory usage (idle) | < 200 MB | < 120 MB | Task Manager |
| Memory usage (with 50-item cart) | < 350 MB | < 200 MB | Task Manager |

### Measuring Performance

**Using Windows Task Manager:**
1. Open Task Manager (`Ctrl+Shift+Esc`)
2. Go to **Details** tab
3. Right-click column headers → **Select columns**
4. Enable **Memory (active private working set)**
5. Sort by name to find `oz-pos-app.exe`

**Using Tauri DevTools:**
```powershell
# Launch with DevTools enabled (debug build only)
cargo tauri dev
# Then Ctrl+Shift+I to open DevTools → Performance tab
```

---

## Log Capture

### Application Logs

Standard output is captured to the Tauri log directory:

```
%APPDATA%\mu.kasir.app\logs\
```

Or check the current directory for `oz-pos-app.log`.

### Debug Logs

For verbose logging during testing, set `RUST_LOG` before launching.
Note: `debug!` and `trace!` level logs are typically stripped in
release builds. Use a **debug build** for detailed log output:

```powershell
# Debug build (verbose logs)
cargo tauri dev 2>&1 | tee launch-log.txt

# Release build with RUST_LOG (only info/warn/error visible)
$env:RUST_LOG = "info"
.\oz-pos-app.exe > launch-log.txt 2>&1

# Check console output for errors
findstr /I "error panic fail" launch-log.txt
```

**To build a debug EXE for verbose logging:**
```powershell
# From apps/desktop-client
cargo tauri build --debug
# EXE at: target\debug\oz-pos-app.exe
```

### Crash Dumps

If the app crashes:

1. Open **Event Viewer** → **Windows Logs** → **Application**
2. Search for `.NET Runtime` or `Application Error` events from `oz-pos-app.exe`
3. Note the **Faulting module name** and **Exception code**

---

## Known Windows-Specific Issues

| Issue | Symptom | Workaround | Status |
|-------|---------|-----------|--------|
| WebView2 not installed | "WebView2 Runtime not found" on launch | Install from Microsoft | External |
| VC++ redist missing | "Side-by-side configuration error" | Install vc_redist.x64.exe | External |
| Windows Defender SmartScreen | "Windows protected your PC" on first launch | Click "More info" → "Run anyway" | External |
| High DPI blurry text | UI renders at wrong scale on 150%+ displays | Tauri v2 handles DPI scaling automatically — if blurry, check `tauri.conf.json` `dpi` settings | Investigate |
| Antivirus false positive | EXE flagged as suspicious (Rust+Tauri bundle) | Submit to Microsoft Defender portal | Expected |
| Touch-screen calibration | Touch targets offset on some devices | Check Windows touch calibration. kasir.mu targets are ≥ 44px. | Verify |
| Network firewall | App can't sync to cloud server | Allow `oz-pos-app.exe` through Windows Firewall | Configure |

---

## Verification Checklist

Use this checklist during every Windows launch test. Print it or copy
into a spreadsheet.

```
☐ Prerequisites: Rust, Node.js, VS Build Tools, WebView2

☐ BUILD
   ☐ Frontend builds without errors (npm run build)
   ☐ Rust builds without errors (cargo build)
   ☐ Tauri bundle produces EXE
   ☐ EXE file size < 50 MB

☐ PHASE 1 — Launch
   ☐ App launches within 5 seconds
   ☐ Window renders correctly (1280×800)
   ☐ No crash dialogs or errors

☐ PHASE 2 — Login
   ☐ PIN entry works (numpad, keyboard)
   ☐ Wrong PIN rejected with message
   ☐ Account locks after 3 attempts
   ☐ Valid PIN navigates to workspace picker

☐ PHASE 3 — Workspace Picker
   ☐ Workspace cards display correctly
   ☐ Workspace selection transitions to POS
   ☐ Switch workspace works

☐ PHASE 4 — POS Screen
   ☐ Product grid loads (< 2 s)
   ☐ Search is responsive (< 300 ms)
   ☐ Category filters work
   ☐ Cart panel displays empty state

☐ PHASE 5 — Cart Operations
   ☐ Add item to cart
   ☐ Update quantity
   ☐ Remove item
   ☐ Total recalculates correctly

☐ PHASE 6 — Payment
   ☐ Payment modal opens
   ☐ Cash/card/mixed payment methods
   ☐ Change due calculated correctly
   ☐ Sale completes without error

☐ PHASE 7 — Receipt
   ☐ Receipt preview displays
   ☐ All receipt fields are correct
   ☐ Return to POS works

☐ PHASE 8 — Edge Cases
   ☐ Empty cart checkout prevented
   ☐ Offline mode works
   ☐ High DPI rendering (150%+)
   ☐ Multiple monitors
   ☐ Window resize/minimize/fullscreen

☐ PERFORMANCE
   ☐ Cold start < 10 s
   ☐ Memory usage < 200 MB (idle)
   ☐ Memory usage < 350 MB (loaded)

☐ LOGS
   ☐ Log files captured
   ☐ No ERROR or FATAL entries
   ☐ Crash dumps saved (if crashed)
```

---

## Reporting Results

After completing the test, report:

```yaml
Date: YYYY-MM-DD
Tester: <name>
Build: release / debug
Version: 0.0.X
Windows build: <from `winver`>
Hardware: CPU / RAM / GPU / Display resolution + scaling
Result: PASS / FAIL / PARTIAL

Failures:
  - Phase X, Step Y: <description>
  - Phase X, Step Y: <description>

Notes:
  - <any observations, flaky tests, or environmental quirks>
```

---

## Related

- [Build Script](https://github.com/kardelitaitu/oz-pos/blob/main/scripts/build-exe-release.ps1) — Automated Windows build
- [Release Checklist](../releases/checklist.md) — Pre-release verification
- [Tauri Config](https://github.com/kardelitaitu/oz-pos/blob/main/apps/desktop-client/tauri.conf.json) — Window size, CSP, bundle settings
- [VPS Migration Guide](../operations/vps-migration.md) — Cloud server deployment
- [Docker Deployment Guide](../operations/docker-deployment.md) — Full stack deployment
- [Runbook](../operations/runbook.md) — Incident response procedures

> last audited 09-09-26 by docs-auditor
