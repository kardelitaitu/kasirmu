# Tablet device verification — close the b-full `[unrun]` blocker (b-full §9 follow-on)

<!-- Audit stamp: 2026-09-20 · DSH · status: NEW, UNEXECUTED · extends todo-tablet-dialog-content-uri.md §9. Builds a real arm64 debug APK for apps/mobile-tauri (mu.kasir.mobile) and exercises the four behaviours that plan could only assert as [unrun]. The todo- token stays until the four device exercises have RUN and PASSED (AGENTS.md rename rule). -->

**Document:** `todo-tablet-device-verify.md`
**Role:** Verification pass — one workstream, one gate (the device)
**Goal:** Build `app-arm64-debug.apk`, install it on a tablet the owner attaches, and exercise: (1) image picker, (2) export `.kasirpkg`, (3) import `.kasirpkg`, (4) backup-to-chosen-destination. On success, convert the `[unrun]` marks in `todo-tablet-dialog-content-uri.md` to verified and rename both docs `todo-` → `done-todo-`.

## Prerequisites — verified present 2026-09-20 (read-only)
- `cargo-tauri` + `cargo-ndk` at `~/.cargo/bin` ✓
- `aarch64-linux-android` rust target installed ✓
- NDK 30.0.14904198 (`ANDROID_NDK_HOME`) ✓
- JDK 21 pinned in `%USERPROFILE%\.gradle\gradle.properties` (`org.gradle.java.home`) — neutralises the JBR-25 Gradle crash ✓
- debug keystore `~/.android/debug.keystore` + `gen/android/keystore.properties` ✓
- `gen/android/` committed ✓

**External dependency:** a connected tablet. `adb devices` was empty at plan time; the owner attaches a Redmi 23073RPBFG (arm64-v8a, API 35) over USB / wireless ADB.

> Why the earlier bare `cargo build --target aarch64-linux-android` failed: it bypassed Tauri's NDK wiring, so `cc-rs` (libsqlite3-sys) could not find the NDK clang. `cargo tauri android build` wires it. No toolchain change needed.

## Steps
1. **This doc** (plan-doc-first). Commit `docs(agents): ...`.
2. **Env** (Git Bash, SKILL.md:46-57): export `PATHEXT`, `SystemRoot`, `COMSPEC`, `ProgramData`, `APPDATA`, `ProgramFiles`, `JAVA_HOME` (JDK 21), `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `ANDROID_NDK_HOME`. Optional `bash scripts/android-preflight.sh`.
3. **Build:** `cargo tauri android build --apk --debug --target aarch64` (~15 min, background). `beforeBuildCommand` bundles current `ui/dist-mobile` (includes the §9 `create_backup_to` / `useBackupStatus` changes). Verify `aapt2 dump badging` → `package mu.kasir.mobile`, `native-code arm64-v8a`, `mu.kasir.mobile/.MainActivity`; confirm `ui/dist-mobile/index.html` mtime advanced.
4. **Connect + install:** `adb devices` lists the tablet → `adb install -r <apk>`. MIUI gate flaky: retry `adb install -r --user 0`.
5. **Exercise** (Settings → Data Management, owner signed in): image picker, export, import, backup-to-destination. Screenshot (`scripts/android-screen.mjs`) + logcat (`grep -iE "forbidden path|not allowed|backup_ungated|create_backup_to|export_data|import_data"`) per flow.
6. **Close out:** if all four pass, resolve `[unrun]` in parent doc, rename both docs `todo-` → `done-todo-`. Commit. No push.

## Traps (SKILL.md)
- `PATHEXT` export required in Git Bash or Tauri dies immediately.
- Leave the `org.gradle.java.home` JDK-21 pin; do not switch `JAVA_HOME` to the JBR.
- Killing a stalled Gradle wrapper kills sccache → next build dies `os error 10054`; re-run.
- Debug APK ~420 MB arm64 — prefer USB install.
- Status read on tablet still calls unscoped `get_backup_status` (tablet-unregistered) → expect a silent no-op / `data-mgmt-toast-backup-status-fail` on mount fetch; that is the pre-existing F-017 hole, not a regression.

## Results (filled during execution)

| # | Flow | Result | Evidence |
|---|---|---|---|
| 1 | Image picker | _pending_ | _ |
| 2 | Export .kasirpkg | _pending_ | _ |
| 3 | Import .kasirpkg | _pending_ | _ |
| 4 | Backup to destination | _pending_ | _ |
