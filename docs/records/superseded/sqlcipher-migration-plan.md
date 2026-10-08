<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · The CORRECTION banner at the top of this file is the most valuable content in it, and I verified its central claim rather than accepting it. The banner says the "export `.ozpkg` before a hardware change" mitigation in §Risks is false in both directions, because settings secrets are handled differently today and filtered on every `.ozpkg` lane by `is_non_exportable_setting_key`. That predicate EXISTS — `crates/kasirmu-bridge/src/settings.rs` defines it, with dedicated coverage in `settings_tests.rs`, and it is also referenced from `crates/kasirmu-bridge/src/data/helpers.rs`, which is the export path. So the corrected position is backed by code, and a reader who needs to know what actually protects a settings secret in an export has a real symbol to go and read. · ONE CORRECTION TO THE CORRECTION, small but it matters to anyone following the pointer: the banner attributes the predicate to "the shared platform-core predicate". It is not in `platform/core` — it is in `kasirmu-bridge`, which is the crate that owns the settings surface. Recorded so a reader does not go looking in the wrong crate. · The plan body is left exactly as written, and the unchecked Implementation Checklist stays unchecked. That is the correct state for a plan the banner declares NEVER ADOPTED: ticking "Add `bundled-sqlcipher` feature" would assert work that the file itself says did not happen. The pre-restructure identifiers throughout (`oz_core::crypto`, `oz_security::Keyring`, `state.rs`, `oz-pos.db`) are left in place as the record of what was proposed, and the `Status: NEVER ADOPTED` line plus the banner already prevent anyone reading it as a live plan. · The referenced audit `tauri-security-audit.md` exists at `docs/archived/tauri-security-audit.md`. · The pre-restructure crypto module is now `crates/kasirmu-crypto` behind a re-export shim at `crates/kasirmu-core/src/crypto.rs` — noted because the plan's Phase 1 step 2 would be written against that shim today, not against `oz_core`. -->
# SQLCipher At-Rest Encryption Migration Plan

> **⚠️ CORRECTION 2026-09-11 — this plan was never adopted; read its mitigations as historical.**
> SQLCipher at-rest encryption did not ship. Settings secrets are handled differently today:
> encrypted at rest, and filtered on every `.ozpkg` lane by the shared platform-core predicate
> `is_non_exportable_setting_key`. That makes the "export `.ozpkg` before a hardware change"
> mitigation in §Risks false in both directions — an `.ozpkg` carries neither `machine_id` nor
> the credential keys, while an unfiltered `.db` / `.backup.db` snapshot carries everything and
> is therefore never a file to hand to anyone.

**Security Audit Reference:** M-6 (tauri-security-audit.md)
**Status:** NEVER ADOPTED — superseded (see banner above)
**Date:** 2026-08

## Problem

All SQLite databases (`oz-pos.db`, per-store DBs) are opened plaintext.
They contain:
- Staff PIN hashes
- Customer data (names, emails, phones)
- Sales and financial records
- Settings secrets (sync API keys, terminal device secrets, PG passwords, exchange-rate API keys, LAN PSK — per H-5)

Physical/backup/adb/file-read access yields the whole store in cleartext (CWE-311).

## Current State

- `state.rs:194-199`: DB opened with only `foreign_keys` + `WAL` pragmas — no encryption.
- `state.rs:4` header: already notes "next: SQLCipher".
- The `oz_core::crypto` module already provides `machine_id`-based key derivation for license key encryption. This same primitive can derive the SQLCipher passphrase.
- `oz_security::Keyring` exists and is used for the device-binding HMAC secret.

## Recommended Approach

### Phase 1: SQLCipher for Global DB

1. **Replace `rusqlite` with `rusqlite-bundled` + SQLCipher feature** (or `bundled-sqlcipher`):
   ```toml
   [dependencies]
   rusqlite = { version = "0.31", features = ["bundled-sqlcipher"] }
   ```

2. **Derive passphrase from `machine_id`** using the existing `oz_core::crypto` module:
   ```rust
   let passphrase = oz_core::crypto::derive_db_passphrase(&machine_id)?;
   conn.pragma_update(None, "key", &passphrase)?;
   ```

3. **Open encrypted connection before migrations** — SQLCipher requires `PRAGMA key` as the very first statement after `open`.

4. **Handle first-run migration**: Existing plaintext DBs must be:
   - Opened plaintext
   - Exported via `VACUUM INTO` or backup API
   - Re-opened encrypted
   - Data imported

### Phase 2: Per-Store DBs

- `StoreDatabaseManager` creates per-store SQLite files — same pattern applies.
- The passphrase is process-wide (derived once at startup from `machine_id`).

### Phase 3: Backup Compatibility

- `backup()` in `Store` must use SQLCipher's encrypted backup (the encrypted bytes ARE the backup).
- `export_ozpkg` / `import_ozpkg` already serialize to JSON — unaffected.
- `.backup.db` files must also be encrypted (same passphrase).

## Key Decisions

| Decision | Option A | Option B (Recommended) |
|----------|----------|------------------------|
| Cipher library | `rusqlite/bundled-sqlcipher` | Same — battle-tested, CI-friendly |
| Key derivation | OS keyring secret | `machine_id` + HKDF (already exists) |
| Migration strategy | Auto-migrate on first run | Prompt user, backup first |
| WAL mode | Keep WAL (SQLCipher supports it) | Yes — performance benefit retained |

## Risks

1. **First-run migration**: A corrupted migration could lose data. Mitigation: backup plaintext DB before encrypting.
2. **Key loss**: If `machine_id` changes (hardware swap), the DB is unrecoverable. ~~Mitigation: export `.ozpkg` before hardware change~~ — false as written (corrected 2026-09-11): an `.ozpkg` carries master data and ordinary settings only, never `machine_id`/`sync_terminal_id` and never the credential keys filtered by `is_non_exportable_setting_key`, so it cannot restore a machine identity or its secrets. Only a whole-file DB backup survives the swap, and because nothing filters it, it is the sensitive artifact in the pair — never something to send anywhere.
3. **Performance**: SQLCipher adds ~5-10% overhead for encrypt/decrypt per page. Acceptable for POS workload.
4. **Cross-platform**: SQLCipher compiles on Windows, Linux, macOS, Android. CI already builds for all targets.

## Implementation Checklist

- [ ] Add `bundled-sqlcipher` feature to `rusqlite` dependency
- [ ] Implement `derive_db_passphrase` in `oz_core::crypto`
- [ ] Update `AppState::new` to open encrypted connection
- [ ] Add first-run plaintext → encrypted migration path
- [ ] Update `StoreDatabaseManager` for encrypted per-store DBs
- [ ] Verify backup/export/import work with encrypted DBs
- [ ] Update CI to test with encrypted DBs
- [ ] Document key management and recovery procedures
- [ ] Update `tauri-security-audit.md` M-6 status to IMPLEMENTED

> last audited 29-09-26 by docs-auditor
