# Linux Desktop Launch Test — OZ-POS
<!-- Audit stamp: 2026-09-09 . DSH . status: ACCURATE, 1 precision note (seed references flagged, not fixed) . Verified-true: Tauri window size 1280x800 (apps/desktop-client/tauri.conf.json:18-19), internal doc links resolve (../releases/checklist.md; ./windows-launch-test.md; ../operations/vps-migration.md, docker-deployment.md, runbook.md all tracked), Rust MSRV 1.88 (rust-toolchain.toml), Node>=22/npm>=11 (ui/package.json:80-82), Tauri v2 apt dependency names (libwebkit2gtk-4.1-dev etc.) valid, cargo tauri build produces .deb/.AppImage via targets=all. FLAGGED not fixed: Settings to Database to Seed Sample Data (line 88) and the login error No staff accounts found (line 98) appear only in docs - no such Settings action exists in ui/src/features/settings/DataManagementScreen.tsx and the string is absent from code; no seeder binary exists in the repo (git grep name=seeder and ls-files grep seeder both empty). These are doc claims about a seed path that does not exist; left for the doc owner under code/config drift rule D. -->

> **Status:** Implemented (2026-07-21)
> **Target audience:** QA / developers testing on Ubuntu 22.04+ or Debian 12+
> **Related:** [Release Checklist](../releases/checklist.md) · [Tauri Config](https://github.com/kardelitaitu/oz-pos/blob/main/apps/desktop-client/tauri.conf.json) · [Windows Launch Test](./windows-launch-test.md)

This guide covers building the OZ-POS desktop client on Linux and
running the core POS flow end-to-end on a physical Linux machine.

---

## Prerequisites

| Requirement | Version | Check |
|-------------|---------|-------|
| Ubuntu 22.04+ / Debian 12+ | LTS recommended | `lsb_release -a` or `cat /etc/os-release` |
| Rust toolchain | stable (1.88+) | `rustc --version` |
| Node.js | >=22 LTS | `node --version` |
| npm | >=11 | `npm --version` |
| WebKitGTK | 4.1+ | `pkg-config --modversion webkit2gtk-4.1` |
| GTK+ 3 | 3.24+ | `pkg-config --modversion gtk+-3.0` |
| OpenSSL | 3.0+ | `openssl version` |

### Installing Prerequisites

**System dependencies (one command):**

```bash
sudo apt update && sudo apt install -y \
  build-essential \
  curl \
  wget \
  file \
  libssl-dev \
  libgtk-3-dev \
  libwebkit2gtk-4.1-dev \
  libjavascriptcoregtk-4.1-dev \
  libsoup-3.0-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libxdo-dev \
  pkg-config
```

> ℹ️ **Ubuntu 22.04 note:** `libwebkit2gtk-4.1-dev` is available from
> the standard repos. If you get a "package not found" error, run
> `sudo apt update` first.
>
> ℹ️ **Other distributions:** These are the Debian/Ubuntu package names.
> For Fedora: `sudo dnf install webkit2gtk4.1-devel gtk3-devel libsoup3-devel`
> For Arch: `sudo pacman -S webkit2gtk-4.1 gtk3 libsoup3`

**Rust:**

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustup default stable
```

**Node.js:**

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

### Verify Dependencies

```bash
# Quick check that all Tauri-required libraries are available
pkg-config --exists webkit2gtk-4.1 && echo "webkit2gtk-4.1: OK"
pkg-config --exists gtk+-3.0 && echo "gtk+-3.0: OK"
pkg-config --exists libsoup-3.0 && echo "libsoup-3.0: OK"
pkg-config --exists librsvg-2.0 && echo "librsvg-2.0: OK"

# If any of these fail, re-run the apt install command above.
```

### Test Data Seeding

Before running the launch test, ensure the database has seed data so
the login → POS → payment → receipt flow can execute:

```bash
# Option A: demo seeder, from the repo root (the oz CLI)
cargo run -p oz-cli -- seed-demo --all
cargo run -p oz-cli -- seed-demo --restaurant --days 30

# Option B: first-run default settings and feature flags on a fresh DB
cargo run -p oz-cli -- seed

> ⚠️ **Corrected 09-09-26.** Neither option listed here existed as written. The `Settings →
> Database → Seed Sample Data` menu is not in the app — that string appears only in these
> launch guides, in nothing under `ui/src`. There is no CI-produced seeded database either:
> `test-data` is absent from every workflow and from `scripts/` (0 hits), so
> `target/release/test-data/oz-pos.db` has never existed as a build artifact. What is real is
> the `oz` CLI: `seed-demo` (`crates/oz-cli/src/cli.rs:95`, dispatched at
> `crates/oz-cli/src/commands/mod.rs:90`, implemented at
> `crates/oz-cli/src/seed_demo.rs:64`) with `--retail` / `--restaurant` / `--all` /
> `--days <n>` (`cli.rs:99-112`), and `seed` for default settings and feature flags
> (`cli.rs:39`). Read the module header before relying on it: it writes ~10k time-series
> sales rows for analytics/report development, which is not a minimal first-launch dataset.

> ⚠️ With no staff rows, login cannot succeed. The exact sentence previously quoted here as
> on-screen text (“No staff accounts found. Please seed the database first.”) is not in the
> code and not in any `.ftl` bundle — it occurs only in these two guides — so treat it as a
> documentation artifact, not as an expected string.

---

## Build Steps

### Option A — Full Tauri Build (Produces .deb + .AppImage)

```bash
# From the repository root
cd apps/desktop-client

# Build the Tauri app (frontend + Rust + bundle)
cargo tauri build
```

Expected output location:
```
target/release/oz-pos-app                          # Portable binary
target/release/bundle/deb/oz-pos_0.0.X_amd64.deb   # Debian/Ubuntu installer
target/release/bundle/appimage/oz-pos_0.0.X_amd64.AppImage  # Portable AppImage
```

### Option B — Build Portable Binary Only

```bash
# Step 1: Build frontend
cd ui
npm ci --no-audit --no-fund --ignore-scripts
npm run build
cd ..

# Step 2: Build Rust binary
cargo build --release -p oz-pos-app

# Binary at:
# target/release/oz-pos-app
```

### Option C — Quick Dev Launch

```bash
# From apps/desktop-client, builds on demand and launches:
cargo tauri dev
```

---

## Launch Test Procedure

### Phase 1: Application Launch

| Step | Action | Expected Result |
|------|--------|----------------|
| 1.1 | Run `./oz-pos-app` (or launch installed .deb) | Splash screen appears within **5 seconds** |
| 1.2 | Wait for full load | Main window appears (1280×800 default). Login screen visible. |
| 1.3 | Check window chrome | Title bar shows **OZ-POS**. Window is centered. |
| 1.4 | Check taskbar/dock | Icon renders correctly in GNOME/KDE launcher. |
| 1.5 | Resize window | Drag edges — window resizes smoothly, no visual glitches. |

**Pass criteria:** App launches cleanly without segfault, assertion error, or WebKitGTK failures.

**Common failures:**
- **`error while loading shared libraries: libwebkit2gtk-4.1.so.0`** — Missing WebKitGTK runtime. Install `libwebkit2gtk-4.1-dev`.
- **`GLib-GIO-ERROR **: No GSettings schema for 'org.gnome.shell.overrides'`** — Missing GNOME schemas. Install `glib-networking` and `gsettings-desktop-schemas`.
- **`Segmentation fault (core dumped)`** — Often GPU/driver related. Try `WEBKIT_DISABLE_COMPOSITING_MODE=1 ./oz-pos-app`.
- **`Cannot open display`** — Running over SSH without X forwarding. Use `export DISPLAY=:0` or a physical terminal.
- **`Failed to load module "appmenu-gtk-module"`** — Cosmetic. Install `appmenu-gtk2-module appmenu-gtk3-module` or ignore.

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

### Phase 8: Linux-Specific Edge Cases

| Step | Action | Expected Result | Check |
|------|--------|----------------|-------|
| 8.1 | Wayland session | App launches under Wayland (GNOME/KDE). No rendering artifacts. | ☐ |
| 8.2 | X11 session | App launches under X11. Window chrome correct. | ☐ |
| 8.3 | HiDPI display (200% scaling) | UI scales correctly via `GDK_SCALE` environment. | ☐ |
| 8.4 | Touchscreen input | Tap targets register correctly (≥ 44px). | ☐ |
| 8.5 | Multi-monitor (extended) | Drag to second display — renders correctly, no corruption. | ☐ |
| 8.6 | suspend/resume | Close laptop lid, reopen — app resumes without crash. | ☐ |
| 8.7 | No audio device | App starts without sound-related errors. | ☐ |
| 8.8 | Disconnect network | Offline banner appears. Sale can still complete in offline mode. | ☐ |
| 8.9 | Rapid product clicks | No duplicate line items at quantity 0. | ☐ |
| 8.10 | App close during sale | Warning dialog: "Sale in progress. Discard?" | ☐ |

**Pass criteria:** All edge cases handled gracefully — no crashes, no data loss, no blank screens.

---

## Performance Checkpoints

| Metric | Acceptable | Target | Measurement |
|--------|-----------|--------|-------------|
| Cold start (first launch after boot) | < 10 s | < 5 s | `time ./oz-pos-app` or stopwatch to login screen |
| Warm start (subsequent launch) | < 5 s | < 3 s | Stopwatch |
| Product grid load (500 products) | < 2 s | < 500 ms | DevTools → Network tab |
| Search response (type-ahead) | < 500 ms | < 100 ms | Perceived latency |
| Cart total recalculation | < 100 ms | < 16 ms (60 fps) | Console time |
| Sale completion (click Pay to done) | < 2 s | < 500 ms | Stopwatch |
| Memory usage (idle) | < 200 MB | < 120 MB | `ps -o rss,cmd -C oz-pos-app` |
| Memory usage (with 50-item cart) | < 350 MB | < 200 MB | `ps -o rss,cmd -C oz-pos-app` |

### Measuring Performance

**Using `ps`:**

```bash
# Memory usage (RSS in KB — divide by 1024 for MB)
ps -o rss:1 --sort=-rss -C oz-pos-app | awk '{print $1/1024 " MB"}'
```

**Using `htop`:**

```bash
# Interactive process viewer
sudo apt install htop
htop -p $(pgrep -d',' -f oz-pos-app)
```

**Using Tauri DevTools:**

```bash
# Launch with DevTools (debug build only)
cd apps/desktop-client
cargo tauri dev
# Then Ctrl+Shift+I to open DevTools → Performance tab
```

---

## Log Capture

### Application Logs

Tauri logs output to `stderr` by default. Capture it on launch:

```bash
# Redirect stderr to a file
./oz-pos-app 2> launch-log.txt

# Or run in background with logging
./oz-pos-app > /dev/null 2> oz-pos-$(date +%Y%m%d).log &

# Check for errors
grep -iE "error|panic|fail|segfault" launch-log.txt
```

### Journalctl (if installed as systemd service)

If the app is launched via a systemd service, use `journalctl`:

```bash
# Recent logs from OZ-POS service
journalctl --user -u oz-pos --since "5 minutes ago" --no-pager
```

> Note: The `.deb` package from `cargo tauri build` does **not** install a
> systemd service automatically — it creates a `.desktop` launcher.
> The `journalctl` approach only applies if you manually configure a
> systemd service unit.

### Debug Build Logs

For verbose logging with `RUST_LOG`:

```bash
# Debug build (verbose logs — trace! and debug! are visible)
RUST_LOG=debug cargo tauri dev 2>&1 | tee launch-log.txt

# Release build (only info/warn/error)
RUST_LOG=info ./oz-pos-app 2> launch-log.txt
```

### Crash Reports

If the app crashes:

```bash
# Check dmesg for segfault or OOM killer messages
dmesg | grep -iE "oz-pos|segfault|oom"

# Check systemd journal
journalctl -xe | grep -i "oz-pos"

# Check coredumpctl (if systemd-coredump is enabled)
coredumpctl list
coredumpctl info oz-pos-app  # Most recent crash
```

---

## Known Linux-Specific Issues

| Issue | Symptom | Workaround | Status |
|-------|---------|-----------|--------|
| WebKitGTK missing | `error while loading shared libraries: libwebkit2gtk-4.1.so.0` | Install `libwebkit2gtk-4.1-dev` | External |
| NVIDIA GPU rendering | White screen or graphical corruption on proprietary drivers | `export WEBKIT_DISABLE_COMPOSITING_MODE=1` before launch | Investigate |
| Wayland clipboard | Copy/paste not working in Wayland session | Set `GDK_BACKEND=x11` or wait for Tauri v2 Wayland fix | External |
| AppImage FUSE error | `FUSE: mount failed: Operation not permitted` | Extract AppImage: `./oz-pos.AppImage --appimage-extract && ./squashfs-root/AppRun` | External |
| GNOME shell integration | Dark theme not followed | Tauri uses its own theme — set manually in Settings | By Design |
| Snap confinement | Can't access files outside sandbox | Install via `.deb` instead of AppImage | External |
| **libssl version mismatch** | `error while loading shared libraries: libssl.so.3` | Install `libssl3` or symlink: `ln -s /usr/lib/x86_64-linux-gnu/libssl.so.1.1 /usr/lib/libssl.so.3` | External |
| Chinese/Japanese IME | Input method not working in WebKit | Set `GTK_IM_MODULE=fcitx` or `ibus` | Investigate |

---

## Verification Checklist

Use this checklist during every Linux launch test.

```
☐ Prerequisites: Rust, Node.js, WebKitGTK, GTK3, OpenSSL

☐ BUILD
   ☐ Frontend builds without errors (npm run build)
   ☐ Rust builds without errors (cargo build)
   ☐ Tauri bundle produces .deb and .AppImage
   ☐ Binary size < 50 MB

☐ PHASE 1 — Launch
   ☐ App launches within 5 seconds
   ☐ Window renders correctly (1280×800)
   ☐ No segfaults or assertion errors

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

☐ PHASE 8 — Linux Edge Cases
   ☐ Wayland session renders correctly
   ☐ X11 session renders correctly
   ☐ HiDPI (200% scaling)
   ☐ Multi-monitor
   ☐ Suspend/resume
   ☐ Offline mode

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
Distribution: Ubuntu 22.04 / Debian 12 / Fedora 40
Desktop: GNOME / KDE / XFCE / Sway
Display Server: Wayland / X11
Kernel: $(uname -r)
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

- [Windows Launch Test](./windows-launch-test.md) — Windows equivalent guide
- [Release Checklist](../releases/checklist.md) — Pre-release verification
- [Tauri Config](https://github.com/kardelitaitu/oz-pos/blob/main/apps/desktop-client/tauri.conf.json) — Window size, CSP, bundle settings
- [VPS Migration Guide](../operations/vps-migration.md) — Cloud server deployment
- [Docker Deployment Guide](../operations/docker-deployment.md) — Full stack deployment
- [Runbook](../operations/runbook.md) — Incident response procedures
- [QUICKSTART](./QUICKSTART.md) — Project quick start

> last audited 09-09-26 by docs-auditor
