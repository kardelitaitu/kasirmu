<!-- Audit stamp: 2026-07-22 · Hermes-Agent · status: ACCURATE (0 findings, code matches doc) · verified against crates/kasirmu-security/src: all 6 modules present (error.rs, mask.rs, tls.rs, linux.rs, macos.rs, windows.rs); Keyring trait at lib.rs:78; default_keyring() at lib.rs:139 returns platform-native or InMemoryKeyring (lib.rs:166); #![deny(unsafe_code)] at lib.rs:24 (windows.rs uses #![allow(unsafe_code)] for FFI, documented with SAFETY comments) · doc's "scaffold" label at docs/ARCHITECTURE.md:79 is itself stale (this crate is fully implemented) · RE-AUDITED 2026-08-31 by docs-auditor: all 6 modules + Keyring/default_keyring/InMemoryKeyring/deny(unsafe_code) re-confirmed against current HEAD; three post-08-29 commits are additive, not contradicting — b6692a92 mask_token (bearer-credential masking, covered by the "sensitive-data masking" row), fe655711 SEC-4 staged rotate_key + SEC-6 entropy scrubbing (rotate_key is an extra trait method beyond the illustrative set/get/delete example), 
20dc2054 clippy lint repairs · REPAIRED 12-09-26 by DSH: the opening headline asserted at-rest encryption, which 7b3a7291c had already corrected away in the module doc; the headline and the two scope paragraphs now mirror that doc rather than restating it in new words, the keyring example value was a live-key-shaped string (a payment-provider secret prefix followed by hex-ish text) that a secret scanner would match, and is now an angle-bracketed non-value, and crates/kasirmu-security/Cargo.toml carries the same description field corrected the same way -->

# oz-security

TLS configuration, PAN masking, and OS credential-store helpers for OZ-POS.

> This headline, and the two paragraphs below, are mirrored from the crate module
> doc in `src/lib.rs` rather than written fresh, so the README and the doc cannot
> drift the next time somebody edits one of them. That drift is the reason this
> file used to open with a claim about encryption.

`oz-security` owns TLS configuration (`tls`), sensitive-data masking including the
masked-PAN display the cashier flow renders (`mask`), and platform keychain
storage behind the `Keyring` trait (with `Keyring::rotate_key` staging the SEC-4
rotation). It is **not** the crate that encrypts stored values: at-rest encryption
of settings and profile credentials is the `encrypt_*` / `decrypt_*` surface in the
`oz-crypto` crate, applied by the typed accessors in
`platform/core/src/settings/typed.rs`.

Those are two different mechanisms and must not be read as one story about
"secrets": a keychain entry is an OS credential store addressed by name, while the
settings columns are encoded by `oz-crypto` under a derived key. They are not
wired to each other — the entry this crate rotates is read back only to report
rotation status (three functions in `crates/kasirmu-bridge/src/security.rs`), and it is
NOT the key that any settings or PII ciphertext is derived from.

## Public API

| Module | What |
|--------|------|
| `error` | `SecurityError` (thiserror) |
| `mask` | PAN / sensitive-data masking |
| `tls` | TLS configuration helpers |
| `linux` | `LibSecretKeyring` — Linux Secret Service (libsecret/DBus) |
| `macos` | `MacOsKeychain` — macOS Keychain (Security framework) |
| `windows` | `WindowsCredentialManager` — Windows Credential Manager |

The `Keyring` trait, `default_keyring()` and `RotationInfo` live in the crate root
(`src/lib.rs`); the three platform modules are compile-gated per target OS, and
`InMemoryKeyring` is the development fallback.

### Keyring trait

OS-level credential store abstraction:

```rust
use kasirmu_security::Keyring;

let keyring = kasirmu_security::default_keyring()?;
keyring.set_secret("api-key", "<example-value-not-a-real-key>")?;
let secret = keyring.get_secret("api-key")?;
keyring.delete_secret("api-key")?;
```

`default_keyring()` returns the platform-native keyring. CI/dev fallback is `InMemoryKeyring` (not secure).

## Conventions

- `#![deny(unsafe_code)]` — platform modules may use FFI with `// SAFETY:`.

> last audited 12-09-26 by DSH
