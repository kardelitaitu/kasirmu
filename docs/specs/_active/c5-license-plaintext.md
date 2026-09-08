<!-- Audit stamp: 2026-07-22 · Hermes-Agent · status: STALE (1 finding — status + baseline outdated) · Finding: the Summary/Baseline claim "license.api_key written plaintext via set_batch into SQLite settings" is no longer accurate — apps/desktop-client/src/commands/license.rs now ENCRYPTS the API key (encrypted_api_key with decrypt-with-legacy-plaintext-fallback, lines 78-85/139-145/187-194). SQLCipher (bundled-sqlcipher) and the keyring crate are NOT in desktop-client/oz-core Cargo.toml, and docs/security/LICENSE-ENCRYPTION.md is still MISSING — so full closure (at-rest SQLCipher + OS-credential-store move + 128-bit machine-id + migration guide) is incomplete, but the "plaintext at rest" premise is already addressed. Status "TODO" understates the API-key encryption that exists. Referenced baseline file license.rs exists. -->

# C-5 — License material: encrypt SQLite at rest + move API key to OS credential store

- **Status:** TODO
- **Sprint:** 0.0.5-rc
- **Severity:** CRITICAL
- **Owner:** TBD (audit-triage)
- **Implementer:** pending
- **Closes:** audit finding C-5 (2026-07-12-desktop-app-audit)
- **Audit source:** `docs/specs/_active/2026-07-12-desktop-app-audit.md` §2

## Summary

`apps/desktop-client/src/commands/license.rs:108` writes
`license.payload`, `license.signature`, `license.tenant_id`, and
`license.api_key` via `Settings::set_batch` into the global SQLite
settings table. SQLite is plaintext at rest; on Windows any user with
file-system access to `%APPDATA%\com.ozpos.app\` can read the
license. Combined with a 60-bit-entropy machine-id that is
guessable, this is a one-step credential-exfiltration primitive
yielding tenant-API takeover. Encrypt the SQLite database at rest
with SQLCipher and move the API key to the OS credential store via
the `keyring` crate; bump machine-id entropy to ≥128 bits.

## Baseline (pre-fix)

```rust
// apps/desktop-client/src/commands/license.rs:108
Settings::set_batch(&conn, &[
    ("license.payload", &payload),
    ("license.signature", &signature),
    ("license.tenant_id", &tenant_id),
    ("license.api_key", &api_key),
])?;
```

The machine-id is a 60-bit value derived from `wmic.exe` /
`reg.exe` shell-outs (already audited as a false positive on
injection, but the entropy is too low).

## Acceptance criteria

- [ ] SQLite database is encrypted at rest using SQLCipher
      (rusqlite `bundled-sqlcipher` feature or `sqlcipher` crate)
- [ ] Existing unencrypted databases are migrated to encrypted on
      first run (no data loss)
- [ ] `license.api_key` is moved out of the SQLite settings table
      and stored in the OS credential store via the `keyring` crate
      (Windows Credential Manager / macOS Keychain / Linux
      Secret Service)
- [ ] `license.payload`, `license.signature`, and `license.tenant_id`
      may remain in the encrypted SQLite (they are not credentials
      per se, but signatures; storing them encrypted-at-rest is
      sufficient)
- [ ] Machine-id entropy is ≥128 bits (use a cryptographically
      secure RNG; the existing wmic/reg-based 60-bit value is
      insufficient)
- [ ] License is re-keyed on machine identity change
- [ ] New unit test: SQLite file header is the SQLCipher magic
      (not the standard SQLite header) after the migration
- [ ] New unit test: `license.api_key` is NOT in the settings table
      after a license set
- [ ] New unit test: `license.api_key` IS in the OS credential
      store after a license set
- [ ] New unit test: machine-id entropy is ≥128 bits
- [ ] All previously-passing tests still pass
- [ ] `cargo fmt --all -- --check` and
      `cargo clippy --workspace --all-targets -- -D warnings` clean
- [ ] Audit doc §2 marks C-5 CLOSED; §6 (epic), §7 release-blocker
      list, and §10 grep caption updated
- [ ] Migration guide in `docs/security/LICENSE-ENCRYPTION.md`
      documents the operator upgrade path

## Plan (proposed)

1. **Add `rusqlite` with `bundled-sqlcipher` feature** to
   `crates/oz-core/Cargo.toml` (and any other crates that open
   the database directly). The `sqlcipher` feature compiles
   SQLCipher into rusqlite and exposes an `KEY` PRAGMA.
2. **Add a key-derivation step** at database open: read or
   generate a per-install key from the OS credential store
   (via `keyring` crate), then `PRAGMA key = ?;` to unlock the
   encrypted database.
3. **Add a one-time migration** for existing unencrypted
   databases: open without the key, dump the schema and data
   via `sqlite3 .dump`-style logic, close, then re-open with
   the key and import. The migration is idempotent (no-op on
   already-encrypted databases).
4. **Add `keyring` crate** to `apps/desktop-client/Cargo.toml`
   and the tablet client. Store the per-install DB key AND
   the license API key in the OS credential store under
   service-name `com.ozpos.app`.
5. **Move `license.api_key` out of the settings table**:
   - On `set_license(...)`, store the API key in
     `keyring::Entry::new("com.ozpos.app", "license.api_key")`.
   - On `get_license(...)`, read from the same keyring entry.
   - Delete the `license.api_key` row from the settings table
     on first run after the upgrade.
6. **Bump machine-id entropy to ≥128 bits**:
   - Replace the wmic/reg-based 60-bit value with a
     cryptographically-secure 128-bit random value stored
     encrypted in the SQLite `machine_identity` table.
   - On hardware change (detected via SMBIOS or volume
     serial number changes), re-key the license and rotate
     the API key.
7. **Add unit tests** in `crates/oz-core/src/db/encryption.rs`:
   - `sqlite_header_is_encrypted` — opens a fresh DB, reads
     the first 16 bytes, asserts they match the SQLCipher
     magic (not the standard SQLite header).
   - `license_api_key_not_in_settings` — sets a license,
     queries the settings table for `license.api_key`, asserts
     it returns None.
   - `license_api_key_in_keyring` — sets a license, reads
     from the keyring, asserts the value matches.
   - `machine_id_entropy_at_least_128` — calls
     `Settings::get_machine_id(&conn)`, parses as bytes,
     asserts the byte length is ≥16 (i.e., 128 bits).
8. **Update `docs/security/LICENSE-ENCRYPTION.md`** with the
   operator upgrade path: backup the existing unencrypted
   database, run the migration, verify the encrypted header,
   store the new DB key in the OS credential store.
9. **Update `docs/specs/_active/2026-07-12-desktop-app-audit.md`**
   to mark C-5 CLOSED in §2, §6, §7, and §10.

## Verification (post-implementation)

```bash
# 1. SQLite is encrypted at rest
# Open a fresh database, then:
xxd -l 16 target/test-data/test.db
# expect: starts with the SQLCipher magic (not "SQLite format 3\0")

# 2. License API key is in keyring, not in SQLite
# Set a license, then:
sqlite3 target/test-data/test.db "SELECT key FROM settings WHERE key = 'license.api_key';"
# expect: 0 rows
# And via the OS credential store:
# Windows: `cmdkey /list:com.ozpos.app`
# macOS:   `security find-generic-password -s com.ozpos.app`
# Linux:   `secret-tool search service com.ozpos.app`
# expect: license.api_key is present

# 3. Machine-id is ≥128 bits
cargo test -p oz-core --lib machine_id_entropy
# expect: ok

# 4. All tests pass
cargo test -p oz-pos-app -p oz-pos-tablet -p oz-core --lib

# 5. Lint + fmt clean
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all -- --check
```

## Risks

- **Migration data loss**: a failed migration could leave the
  operator with an encrypted database that doesn't have the
  original data. The migration must be transactional and
  backed-up before being applied.
- **Key rotation**: rotating the per-install DB key requires
  re-encrypting the entire database. This is a one-time
  operation per install; document the operator runbook.
- **Cross-platform keyring availability**: the `keyring` crate
  supports Windows, macOS, and Linux (via Secret Service). For
  Linux headless deployments without a Secret Service (e.g.,
  embedded), a fallback to a file-based key with restrictive
  permissions is needed. Document the fallback in the
  deployment guide.
- **License-server contract**: the upstream license server must
  be aware of the machine-id change so the re-keying flow
  works end-to-end. Coordinate with the license-server team
  before landing the front-end change.

## Non-goals

- End-to-end license validation encryption: the validation
  request is still sent over HTTPS to the license server; this
  card only addresses storage at rest.
- HSM-based key storage: out of scope; the OS credential store
  is the right level for a single-terminal POS.
- Multi-tenant machine-id: each terminal has its own identity;
  shared machine-id is a future card.

## References

- `docs/specs/_active/2026-07-12-desktop-app-audit.md` §2 C-5
- `docs/specs/_active/2026-07-12-desktop-app-audit.md` §7 release-blocker list
- `apps/desktop-client/src/commands/license.rs:108`
- `crates/oz-core/src/db/mod.rs` (where the SQLCipher open
  logic will live)
- `apps/desktop-client/Cargo.toml` (where `keyring` will be added)
- `apps/desktop-client/src/main.rs` (where the keyring init
  will run at startup)
- `docs/security/LICENSE-ENCRYPTION.md` (to be created)
- SQLCipher: <https://www.zetetic.net/sqlcipher/>
- `keyring` crate: <https://crates.io/crates/keyring>

> last audited 22-07-26 by Hermes-Agent
