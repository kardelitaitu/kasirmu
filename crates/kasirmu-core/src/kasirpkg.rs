//! Encrypted OZ-POS data export/import format (`.kasirpkg`).
//!
//! # Format
//!
//! An `.kasirpkg` file is a binary envelope:
//!
//! 1. **JSON header** (`HEADER_LEN` = 512 bytes, space-padded) — format
//!    version, store name, app version, creation timestamp, feature-flag
//!    metadata, data types, and the encryption parameters (salt, nonce).
//!    No key material or row data lives here. Export FAILS if this
//!    metadata does not fit the block rather than truncating it into an
//!    archive that can never be opened (B46).
//! 2. **Compressed + encrypted payload** — the actual data rows are
//!    serialized to JSON, compressed with zstd, then encrypted with
//!    AES-256-GCM using a key derived from the user's password via
//!    Argon2id.
//!
//! # Security properties
//!
//! - Password is never stored — only the Argon2id salt is in the header.
//!   Because that salt is public, an empty password is not a weak key but
//!   no key: the file's own header lets anyone derive it. Export therefore
//!   REFUSES an empty or whitespace-only password (B50). Import
//!   deliberately still accepts one — archives written before that check
//!   must stay restorable.
//! - AES-256-GCM provides authenticated encryption (integrity +
//!   secrecy). Since format v2 the header block is bound in as
//!   additional authenticated data, so its fields cannot be rewritten
//!   undetected (B47). v1 archives predate that and remain readable,
//!   but their header is NOT authenticated.
//! - zstd compression runs before encryption (optimal compression ratio).
//! - Each export uses a fresh random salt and random nonce.

use std::collections::HashMap;

use aead::{Aead, KeyInit, OsRng, Payload};
use aes_gcm::Aes256Gcm;
use aes_gcm::Nonce;
use argon2::Argon2;
use rand::RngCore;
use serde::{Deserialize, Serialize};

use crate::CoreError;

// ── Constants ──────────────────────────────────────────────────────────

/// Current `.kasirpkg` format version.
///
/// v2 binds the plaintext header block into the AES-GCM tag as
/// additional authenticated data (B47); v1 left it unauthenticated.
/// Import still accepts v1 so backups taken before the fix stay
/// readable — export only ever writes v2.
const FORMAT_VERSION: u32 = 2;

/// Length of the plaintext header in bytes (space-padded).
const HEADER_LEN: usize = 512;

/// Argon2id parameters (tuned for < 1s on modern hardware).
const ARGON_MEMORY: u32 = 19456; // 19 MB
const ARGON_ITERATIONS: u32 = 2;
const ARGON_PARALLELISM: u32 = 1;

/// Salt length in bytes (16 = 128 bits).
const SALT_LEN: usize = 16;

/// AES-GCM nonce length (96 bits = 12 bytes).
const NONCE_LEN: usize = 12;

/// AES-256 key length (256 bits = 32 bytes).
const KEY_LEN: usize = 32;

// ── Header types ──────────────────────────────────────────────────────

/// Metadata written at the start of every `.kasirpkg` file. It stays
/// plaintext (it carries no secrets) but from format v2 it is bound into
/// the AES-GCM tag, so it is authenticated rather than merely readable.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KasirpkgHeader {
    /// Format version: 1 = header unauthenticated, 2 = header bound as
    /// additional authenticated data. Export writes 2; import reads both.
    pub version: u32,
    /// Store name (from settings).
    pub store_name: String,
    /// OZ-POS version that created this export.
    pub app_version: String,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// Data types included (e.g. `["products", "categories"]`).
    pub data_types: Vec<String>,
    /// Argon2id salt (hex-encoded, 32 hex chars).
    pub salt: String,
    /// AES-GCM nonce (hex-encoded, 24 hex chars).
    pub nonce: String,
    /// Feature flags embedded as plaintext metadata.
    pub features: HashMap<String, String>,
}

// ── Payload types ─────────────────────────────────────────────────────

/// All data that can be exported from an OZ-POS store.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KasirpkgPayload {
    /// Product records.
    pub products: Vec<serde_json::Value>,
    /// Category records.
    pub categories: Vec<serde_json::Value>,
    /// Sale records (header only, no lines for privacy). Optional.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sales: Option<Vec<serde_json::Value>>,
    /// Customer records.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub customers: Option<Vec<serde_json::Value>>,
    /// User records (no PIN hashes).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub users: Option<Vec<serde_json::Value>>,
    /// Settings rows.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settings: Option<Vec<serde_json::Value>>,
}

// ── Export / Import functions ─────────────────────────────────────────

/// Export data into an encrypted `.kasirpkg` byte vector.
///
/// `password` is the user-chosen encryption password. `data_types` lists
/// the types of data included (for the plaintext header). `payload` is
/// the actual data to encrypt.
///
/// # Errors
///
/// Returns [`CoreError::Validation`] if `password` is empty or all
/// whitespace, and `CoreError::Internal` if the header cannot fit or
/// encryption setup fails.
pub fn export_kasirpkg(
    password: &str,
    store_name: &str,
    app_version: &str,
    data_types: Vec<String>,
    features: HashMap<String, String>,
    payload: &KasirpkgPayload,
) -> Result<Vec<u8>, CoreError> {
    // B50: an empty password is not a weak key, it is NO key. The key is
    // Argon2id(password, salt) and the salt is written into the plaintext
    // header, so anyone holding the file can derive the same empty-password
    // key without guessing anything. The desktop UI already refuses this
    // (the data-management screen requires >= 8 chars) but `kasirmu-cli
    // export-kasirpkg --password ""` passes clap — the arg must be present,
    // not non-empty — and reached here unchecked, as would any future
    // caller. A crypto-critical precondition belongs at the choke point
    // every caller must pass through, not in one screen's validation.
    //
    // import_kasirpkg deliberately keeps no such check: backups already
    // written with an empty password must stay restorable.
    if password.trim().is_empty() {
        return Err(CoreError::Validation {
            field: "password",
            message: "an encryption password is required; an empty password would leave the \
                      backup readable by anyone holding the file, because the Argon2id salt is \
                      stored in the header in the clear"
                .into(),
        });
    }

    // 1. Generate random salt and nonce.
    let mut salt = [0u8; SALT_LEN];
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce_bytes);

    // 2. Derive AES-256 key via Argon2id.
    let mut key = [0u8; KEY_LEN];
    Argon2::new(
        argon2::Algorithm::Argon2id,
        argon2::Version::V0x13,
        argon2::Params::new(
            ARGON_MEMORY,
            ARGON_ITERATIONS,
            ARGON_PARALLELISM,
            Some(KEY_LEN),
        )
        .map_err(|e| CoreError::Internal(format!("Argon2 params: {e}")))?,
    )
    .hash_password_into(password.as_bytes(), &salt, &mut key)
    .map_err(|e| CoreError::Internal(format!("Argon2 key derivation: {e}")))?;

    // 3. Serialize payload to JSON.
    let payload_json = serde_json::to_vec(payload)
        .map_err(|e| CoreError::Internal(format!("JSON serialize: {e}")))?;

    // 4. Compress with zstd.
    let compressed = zstd::encode_all(std::io::Cursor::new(&payload_json), 3)
        .map_err(|e| CoreError::Internal(format!("zstd compress: {e}")))?;

    // 5. Build the plaintext header BEFORE encrypting (B47): it is bound
    //    into the AES-GCM tag as additional authenticated data, so the
    //    metadata can no longer be rewritten undetected.
    let header = KasirpkgHeader {
        version: FORMAT_VERSION,
        store_name: store_name.to_owned(),
        app_version: app_version.to_owned(),
        created_at: chrono::Utc::now().to_rfc3339(),
        data_types,
        salt: hex::encode(salt),
        nonce: hex::encode(nonce_bytes),
        features,
    };

    let header_json = serde_json::to_vec(&header)
        .map_err(|e| CoreError::Internal(format!("header JSON: {e}")))?;

    // B46: the header is written into a fixed HEADER_LEN block. The old
    // code truncated header_json with `min(HEADER_LEN)` to fit, which
    // produced a file whose header block was invalid JSON — export()
    // returned Ok and the archive was permanently unopenable (silent
    // backup loss; ~12 enabled feature flags is enough to trip it).
    // Fail loudly instead: the CLI propagates this and writes no file.
    if header_json.len() > HEADER_LEN {
        return Err(CoreError::Internal(format!(
            "kasirpkg header is {} bytes, which exceeds the {HEADER_LEN}-byte limit; \
             shorten the store name or disable feature flags before exporting",
            header_json.len()
        )));
    }

    // Pad header to HEADER_LEN bytes.
    let mut header_padded = vec![b' '; HEADER_LEN];
    header_padded[..header_json.len()].copy_from_slice(&header_json);

    // 6. Encrypt with AES-256-GCM, authenticating the padded header block.
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| CoreError::Internal(format!("AES-GCM init: {e}")))?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(
            nonce,
            Payload {
                msg: compressed.as_ref(),
                aad: &header_padded,
            },
        )
        .map_err(|e| CoreError::Internal(format!("AES-GCM encrypt: {e}")))?;

    // 7. Concatenate header + ciphertext.
    let mut result = header_padded;
    result.extend_from_slice(&ciphertext);

    Ok(result)
}

/// Import data from an encrypted `.kasirpkg` byte slice.
///
/// Returns the header (plaintext metadata) and the decrypted payload.
///
/// # Errors
///
/// Returns `CoreError::Internal` if decryption fails (wrong password or
/// corrupt data).
pub fn import_kasirpkg(
    data: &[u8],
    password: &str,
) -> Result<(KasirpkgHeader, KasirpkgPayload), CoreError> {
    if data.len() < HEADER_LEN {
        return Err(CoreError::Internal("file too short: missing header".into()));
    }

    // 1. Parse header from first HEADER_LEN bytes.
    // Trim trailing spaces (padding) while preserving spaces inside JSON.
    let header_bytes = &data[..HEADER_LEN];
    let trimmed_len = header_bytes
        .iter()
        .rposition(|&b| b != b' ')
        .map(|pos| pos + 1)
        .unwrap_or(0);
    let header: KasirpkgHeader = serde_json::from_slice(&header_bytes[..trimmed_len])
        .map_err(|e| CoreError::Internal(format!("invalid header: {e}")))?;

    // B47: v1 archives never authenticated the header block, so they are
    // decrypted with empty AAD (GCM treats "no AAD" and a zero-length AAD
    // identically) and still open — users already hold v1 backups from
    // both the CLI and the desktop UI. v2 binds the padded header into
    // the tag. Any other version is rejected.
    let aad: &[u8] = match header.version {
        1 => &[],
        FORMAT_VERSION => &data[..HEADER_LEN],
        other => {
            return Err(CoreError::Internal(format!(
                "unsupported format version: {other} (expected {FORMAT_VERSION})"
            )));
        }
    };

    // 2. Decode salt and nonce.
    let salt = hex::decode(&header.salt)
        .map_err(|e| CoreError::Internal(format!("invalid salt hex: {e}")))?;
    let nonce_bytes = hex::decode(&header.nonce)
        .map_err(|e| CoreError::Internal(format!("invalid nonce hex: {e}")))?;

    if salt.len() != SALT_LEN || nonce_bytes.len() != NONCE_LEN {
        return Err(CoreError::Internal("invalid salt or nonce length".into()));
    }

    // 3. Derive AES-256 key via Argon2id.
    let mut key = [0u8; KEY_LEN];
    Argon2::new(
        argon2::Algorithm::Argon2id,
        argon2::Version::V0x13,
        argon2::Params::new(
            ARGON_MEMORY,
            ARGON_ITERATIONS,
            ARGON_PARALLELISM,
            Some(KEY_LEN),
        )
        .map_err(|e| CoreError::Internal(format!("Argon2 params: {e}")))?,
    )
    .hash_password_into(password.as_bytes(), &salt, &mut key)
    .map_err(|e| CoreError::Internal(format!("Argon2 key derivation: {e}")))?;

    // 4. Decrypt with AES-256-GCM.
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| CoreError::Internal(format!("AES-GCM init: {e}")))?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let compressed = cipher
        .decrypt(
            nonce,
            Payload {
                msg: &data[HEADER_LEN..],
                aad,
            },
        )
        .map_err(|_| {
            CoreError::Internal("decryption failed: wrong password or corrupt data".into())
        })?;

    // 5. Decompress with zstd.
    let decompressed = zstd::decode_all(std::io::Cursor::new(&compressed))
        .map_err(|e| CoreError::Internal(format!("zstd decompress: {e}")))?;

    // 6. Deserialize payload.
    let payload: KasirpkgPayload = serde_json::from_slice(&decompressed)
        .map_err(|e| CoreError::Internal(format!("JSON deserialize: {e}")))?;

    Ok((header, payload))
}

#[cfg(test)]
#[path = "kasirpkg_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "kasirpkg_password_tests.rs"]
mod password_tests;
