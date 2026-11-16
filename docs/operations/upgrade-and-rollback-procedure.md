<!-- Audit stamp: 2026-11-13 · dev · status: ACCURATE · version lock: 0.0.41 -->
# Desktop and Mobile Upgrade Round-Trip & Rollback Procedure

This document specifies the standard operating procedure for upgrading kasir.mu across releases, verifying installer and update manifest signatures, preserving SQLite databases and settings, and executing an emergency rollback if an upgrade encounters fatal regressions or schema incompatibility.

---

## 1. Cryptographic Signature & Manifest Verification

All automated updates and release installers are signed with an Ed25519 Minisign key before distribution. The public key is embedded at `apps/desktop-tauri/tauri.conf.json` under `plugins.updater.pubkey`.

### 1.1 Local & Pipeline Self-Test

Before triggering or applying updates, run the updater signature self-test:

```bash
node scripts/verify-updater-signature.mjs --self-test
```

**Acceptance criteria:** Must print `self-test: signature verification (incl. tamper rejection) PASSED` and exit with code 0.

### 1.2 Release Manifest Verification

For each release asset, the updater client checks the manifest (`latest.json` or `beta.json`):

```bash
node scripts/verify-updater-signature.mjs <manifest.json> <platform> <installer-path>
```

Example for Windows x64:
```bash
node scripts/verify-updater-signature.mjs latest.json windows-x86_64 "kasir.mu_0.0.41_x64-setup.nsis.zip"
```

---

## 2. Upgrade Procedure (v0.0.41 → Next Version)

Upgrades are designed to be non-destructive to user state, settings, and business ledgers.

### Step 1: Pre-Upgrade State & Database Snapshot
1. Locate the active store database:
   - **Windows Desktop:** `%LOCALAPPDATA%\kasirmu\kasirmu.db` (or custom path set via `--db`)
   - **Android Tablet:** `/data/user/0/mu.kasir.mobile/files/kasir.db`
2. Ensure active shifts are reconciled or all open transactions committed.
3. Take a manual snapshot of the database before initiating the installer:
   ```bash
   # Desktop CLI snapshot
   kasir --db "%LOCALAPPDATA%\kasirmu\kasirmu.db" backup --output "%LOCALAPPDATA%\kasirmu\pre_upgrade_0.0.41.db"
   ```
   Or via the desktop UI: **Settings** → **Data Management** → **Create Backup**.

### Step 2: Executing the Binary Upgrade
- **Via In-App Updater:**
  1. Open **Settings** → **About** → Click **Check for Updates**.
  2. When prompted with the update banner, click **Install Update**.
  3. Tauri executes the installer with `basicUi` mode, terminating the app and replacing application binaries in `%PROGRAMFILES%\kasir.mu`.
- **Via Manual Installer:**
  1. Download the verified installer `kasir.mu_<version>_x64-setup.exe`.
  2. Run the installer. NSIS automatically detects existing installations, replaces executable files, and preserves `%LOCALAPPDATA%\kasirmu` untouched.

### Step 3: First-Boot Migration & State Preservation
1. Launch the updated application.
2. During initialization, the recovery validator inspects the schema:
   - Candidate status is evaluated as `OlderButAcceptable` (`crates/kasirmu-core/src/db/recovery.rs`).
   - `kasirmu-core` runs pending SQLite migrations idempotently forward inside a transaction (`crates/kasirmu-core/src/migrations.rs`).
3. Settings in the `settings` table (tax rates, terminal ID, store preferences) and SQLite WAL data remain intact.

### Step 4: Post-Upgrade Verification
1. Verify app boots to the POS screen without errors.
2. Confirm the version indicator displays the target version.
3. Verify that the previous sales ledger, product catalog, and audit log hash continuity are intact:
   - `Store::verify_audit_chain` returns `is_valid: true`.

---

## 3. Rollback Procedure (Emergency Reversion to v0.0.41)

If an upgrade fails, causes boot crashes, or introduces fatal defects in the retail lane, follow these numbered steps to rollback cleanly without data corruption.

### Step 1: Terminate the Application Process
1. Stop any running instances of the application to release all SQLite database handles:
   ```powershell
   Stop-Process -Name "kasirmu" -Force -ErrorAction SilentlyContinue
   ```
2. Confirm no locks exist on `kasirmu.db`, `kasirmu.db-wal`, or `kasirmu.db-shm`.

### Step 2: Downgrade Application Binaries
1. Locate the previous installer `kasir.mu_0.0.41_x64-setup.exe` (preserved from the prior release or GitHub Releases).
2. Execute the installer to overwrite the current binaries in `%PROGRAMFILES%\kasir.mu` back to v0.0.41:
   ```powershell
   Start-Process -FilePath ".\kasir.mu_0.0.41_x64-setup.exe" -ArgumentList "/S" -Wait
   ```

### Step 3: Database Compatibility Check & Restore
1. Evaluate if new schema migrations introduced by the failed version are incompatible with v0.0.41:
   - If the v0.0.41 binary starts and the recovery validator reports `NewerThanThisBuild`, v0.0.41 will safely refuse startup to prevent corrupting data.
2. If schema rollback is required, restore the pre-upgrade database snapshot taken in §2 Step 1:
   - **Method A (CLI Direct Restore - Preferred):**
     ```bash
     kasir --db "%LOCALAPPDATA%\kasirmu\kasirmu.db" restore --input "%LOCALAPPDATA%\kasirmu\pre_upgrade_0.0.41.db"
     ```
   - **Method B (Boot Request Swap):**
     Place `<db>.restore-request.json` alongside `kasirmu.db`:
     ```json
     {
       "candidate_path": "%LOCALAPPDATA%\\kasirmu\\pre_upgrade_0.0.41.db",
       "created_at": "2026-11-13T12:00:00.000Z"
     }
     ```
     On launch, the boot supervisor verifies the candidate (`PRAGMA integrity_check`), creates `<db>.pre-restore.db` as a safety net, swaps the candidate in place, and archives the request as `<db>.restore-request.json.done`.
3. Clear any orphaned `<db>.restore-boot.lock` file if a crash interrupted a previous swap.

### Step 4: Launch and Re-Verify v0.0.41
1. Launch the v0.0.41 desktop application.
2. Verify that:
   - About page reports version `0.0.41`.
   - All catalog products, inventory stock counts, and completed sales match the pre-upgrade state.
   - Sync daemon reconnects to the sync relay server (`/api/sync/status`).
   - Audit hash chain verifies with zero broken links.
