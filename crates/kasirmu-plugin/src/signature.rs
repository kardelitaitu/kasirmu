//! Signature verification for plugin packages (C2, D7's last clause).
//!
//! # What this adds that the grant store could not
//!
//! `crate::grants` turned a plugin's self-declared permissions into an operator
//! approval, but it stated plainly what it does **not** buy: `plugin-grants.json`
//! lives in the plugins directory, so anyone able to add a plugin is able to add
//! a grant for it. This module is the missing half — a signature over the plugin's
//! contents that the operator's key can check and a plugin author cannot forge.
//!
//! # The digest is over the plugin's whole behaviour, not just its manifest
//!
//! A signature that covered only `plugin.toml` would be decorative: the manifest
//! names its scripts, so an attacker who may rewrite `discount.lua` while leaving
//! the manifest untouched would keep a valid signature over a plugin that now does
//! something else entirely. The digest therefore covers, in a fixed order:
//!
//! 1. the plugin id and version,
//! 2. the **canonicalised** declared permission set (sorted, deduplicated — the
//!    same canonicalisation `hash_plugin_set` documents, because the manager tests
//!    each permission independently so order and duplicates cannot change behaviour),
//! 3. each resolved script's **relative path** and its **exact bytes**.
//!
//! Relative rather than absolute paths, deliberately: an absolute path embeds the
//! installation directory, so a plugin signed on one machine would fail to verify
//! on another. Verification must be reproducible across installs.
//!
//! # What this does NOT buy
//!
//! * **It does not make the plugin sandbox stronger.** It decides whether a plugin
//!   may run at all; the Lua sandbox and the capability-gated `oz` table still
//!   govern what it can do once running.
//! * **Signature verification is opt-in per install.** With no public key
//!   configured, unsigned plugins load exactly as they did before. That is
//!   deliberate — a mandatory signature would make every existing plugin
//!   unloadable on upgrade, and the honest first step is to make signing
//!   *available and verified where configured*. Set a key to require it.
//! * **It does not verify the grant file.** `plugin-grants.json` is the operator's
//!   own approval; it is local policy, not signed material.
//! * **Revocation is not handled.** A key that leaks cannot be un-trusted without
//!   a new build, because the key is embedded/configured rather than fetched from
//!   a CRL. `kasirmu-core` has a CRL mechanism for licences; extending it here is
//!   deliberately out of scope.

use std::path::Path;

use base64::Engine;
use rsa::RsaPublicKey;
use rsa::pkcs1v15::Signature;
use rsa::pkcs8::DecodePublicKey;
use rsa::signature::Verifier;
use sha2::{Digest, Sha256};

use crate::error::PluginError;

/// File name of a plugin's detached signature, beside its `plugin.toml`.
pub const SIGNATURE_FILE_NAME: &str = "plugin.toml.sig";

/// Domain-separation prefix, so a signature over a plugin digest cannot be
/// replayed as a signature over anything else this codebase signs.
const PLUGIN_SIGNATURE_PREFIX: &str = "ozpos-plugin-v1:";

/// Compute the SHA-256 digest a plugin's signature must cover.
///
/// See the module docs for why each part is included. `scripts` must be pairs of
/// (path **relative to the plugin directory**, contents). The caller resolves the
/// paths; this function only orders and hashes, so it is pure and testable.
///
/// The parts are length-prefixed and separated by a field marker rather than
/// concatenated raw: without that, plugin id `"ab"` + version `"c"` and id
/// `"a"` + version `"bc"` would produce the same digest, which is a
/// signature-collision an author could exploit to move a permission between
/// two plugins.
#[must_use]
pub fn plugin_digest(
    plugin_id: &str,
    version: &str,
    permissions: &[String],
    scripts: &[(String, Vec<u8>)],
) -> [u8; 32] {
    let mut hasher = Sha256::new();

    // Field helper: a namespaced, length-prefixed write.
    fn field(hasher: &mut Sha256, name: &str, bytes: &[u8]) {
        hasher.update(name.as_bytes());
        hasher.update(b":");
        hasher.update(bytes.len().to_le_bytes());
        hasher.update(b":");
        hasher.update(bytes);
        hasher.update(b"|");
    }

    field(&mut hasher, "id", plugin_id.as_bytes());
    field(&mut hasher, "version", version.as_bytes());

    // Canonicalise the permission set (sorted + deduplicated), matching
    // `hash_plugin_set`'s reasoning exactly.
    let mut granted: Vec<String> = permissions.to_vec();
    granted.sort();
    granted.dedup();
    field(&mut hasher, "permissions", granted.join(",").as_bytes());

    // Scripts in path order, so a reordered directory listing is not a
    // different digest but a changed byte is.
    let mut ordered: Vec<&(String, Vec<u8>)> = scripts.iter().collect();
    ordered.sort_by(|a, b| a.0.cmp(&b.0));
    for (path, contents) in ordered {
        field(&mut hasher, "script-path", path.as_bytes());
        field(&mut hasher, "script-body", contents);
    }

    hasher.finalize().into()
}

/// Verify `signature_base64` over `digest` against an RSA public key PEM.
///
/// The algorithm is RSA-2048 PKCS1v15/SHA-256, matching
/// `kasirmu_core::attestation::verify_attestation_signature` so the codebase has
/// one signature story rather than two. The digest is signed as its hex rendering
/// under this crate's private signature prefix constant, which is what the
/// companion signing helper (`scripts/sign-plugin.py`) produces. The constant is
/// named here in prose rather than linked: an intra-doc link from this public
/// item to the private one is refused by `rustdoc::private_intra_doc_links`,
/// which the `rust-doc` gate raises to an error.
pub fn verify_plugin_signature(
    public_pem: &str,
    digest: &[u8; 32],
    signature_base64: &str,
) -> Result<(), PluginError> {
    let public_key = RsaPublicKey::from_public_key_pem(public_pem)
        .map_err(|e| PluginError::Signature(format!("plugin public key is unusable: {e}")))?;

    let signature_bytes = base64::engine::general_purpose::STANDARD
        .decode(signature_base64.trim())
        .map_err(|e| PluginError::Signature(format!("plugin signature is not base64: {e}")))?;

    let signature = Signature::try_from(signature_bytes.as_slice())
        .map_err(|e| PluginError::Signature(format!("invalid plugin signature format: {e}")))?;

    let payload = signed_payload(digest);
    let verifying_key = rsa::pkcs1v15::VerifyingKey::<Sha256>::new(public_key);
    verifying_key
        .verify(payload.as_bytes(), &signature)
        .map_err(|_| {
            PluginError::Signature(
                "the plugin signature did not verify against the configured key".into(),
            )
        })
}

/// The exact bytes a plugin signature is computed over.
///
/// Exposed so the signing helper and any test agree with verification by
/// construction rather than by a comment.
#[must_use]
pub fn signed_payload(digest: &[u8; 32]) -> String {
    format!("{PLUGIN_SIGNATURE_PREFIX}{}", hex::encode(digest))
}

/// Read and verify a plugin's detached signature, if one is required.
///
/// Returns `Ok(true)` when a signature was present and verified, `Ok(false)` when
/// none was present and none is required, and `Err` when verification was
/// required and failed (or the signature was present but malformed).
///
/// `public_pem` is `None` when the operator has configured no key. In that case a
/// signature, if present, is **still verified** when it is well-formed — a plugin
/// shipping a bad signature is reported rather than ignored, because silently
/// ignoring it would train an author to believe a broken signature is harmless.
pub fn verify_plugin(
    plugin_dir: &Path,
    plugin_id: &str,
    version: &str,
    permissions: &[String],
    scripts: &[(String, Vec<u8>)],
    public_pem: Option<&str>,
) -> Result<bool, PluginError> {
    let sig_path = plugin_dir.join(SIGNATURE_FILE_NAME);
    let signature = match std::fs::read_to_string(&sig_path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // No signature on disk.
            return match public_pem {
                Some(_) => Err(PluginError::Signature(format!(
                    "plugin '{plugin_id}' has no {SIGNATURE_FILE_NAME} and this install \
                     requires signed plugins — refused"
                ))),
                None => Ok(false),
            };
        }
        Err(e) => {
            return Err(PluginError::Signature(format!(
                "cannot read {}: {e}",
                sig_path.display()
            )));
        }
    };

    let Some(pem) = public_pem else {
        // A signature exists but no key is configured. Report it rather than
        // silently passing: an author who signed a plugin must not be told
        // "fine" by an install that never checked.
        return Err(PluginError::Signature(format!(
            "plugin '{plugin_id}' ships a {SIGNATURE_FILE_NAME} but no plugin public key \
             is configured, so it cannot be verified. Configure the key or remove the \
             signature file"
        )));
    };

    let digest = plugin_digest(plugin_id, version, permissions, scripts);
    verify_plugin_signature(pem, &digest, &signature)?;
    Ok(true)
}

#[cfg(test)]
#[path = "signature_tests.rs"]
mod tests;
