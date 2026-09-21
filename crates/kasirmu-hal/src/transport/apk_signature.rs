//! Android APK signing-certificate fingerprint (ADR #57 §2.1, client leg).
//!
//! Computes this installation’s APK signing certificate as a lowercase SHA-256
//! hex fingerprint, which is the value the licence server compares against the
//! pinned set for this release channel (`release_channels`, ADR #57 §Q-B).
//!
//! # Why this lives beside the Bluetooth transport
//!
//! A `JavaVM` reaches application code through exactly ONE `JNI_OnLoad` symbol
//! in the final shared library, and [`super::bt_android`] defines it. A second
//! definition anywhere in the same `.so` is a duplicate-symbol link failure, so
//! the VM can only be widened from the module that already owns it — this is
//! that widening rather than a parallel bridge. Nothing in tauri/tao/wry offers
//! app code a `JavaVM` (`tauri::android_binding!` is `#[doc(hidden)]` and only
//! *receives* a `JNIEnv` at the Kotlin boundary).
//!
//! # Why the caller gets a String and not a JNIEnv
//!
//! [`apk_signing_fingerprint`] is deliberately narrow: it returns a plain
//! fingerprint, never an environment handle. Exposing the env would force
//! `#![allow(unsafe_code)]` on every consumer, and this crate denies unsafe at
//! the root (`lib.rs`) with a file-local allow only where JNI is unavoidable.
//!
//! # Fail-open
//!
//! Every failure path — no captured VM, no application context, no package
//! info, absent signature, malformed certificate — returns `Ok(None)`, never an
//! error the caller might treat as a verdict. `None` reaches
//! `classify_build_fingerprint` as `Unknown` (ADR #57 §2.2), which is never a
//! `Mismatch`, so a device we cannot fingerprint is never refused a renewal.

// RUST-06 scoped exception: this module is JNI by nature (raw `JNIEnv` calls and
// byte-array handling). The allow is confined to this android-only file; every
// `unsafe` block carries its own justification. Mirrors the precedent in
// `transport/bt_android.rs`.
#![allow(unsafe_code)]

use jni::objects::{JByteArray, JObjectArray, JValue};
use sha2::{Digest, Sha256};

use super::bt_android::with_env;

/// `PackageManager.GET_SIGNATURES` (android.content.pm.PackageManager).
///
/// Deprecated on API 28+ in favour of `GET_SIGNING_CERTIFICATES`, but it still
/// returns the correct signing certificate for the whole APK, it predates the
/// crate’s `minSdk 26` floor, and it needs no Play Services — which is the
/// property ADR #57 chose it for. The API 28+ replacement returns a
/// `SigningInfo` whose historical-certificate chain must itself be reduced to
/// the oldest signature, so it is strictly more work for the same answer here.
const GET_SIGNATURES: i32 = 0x00000040;

/// Compute the APK signing-certificate fingerprint, or `None` if unavailable.
///
/// Returns lowercase, bare, 64-hex — the normalised form
/// `kasirmu_core::build_fingerprint::classify_build_fingerprint` compares
/// against, and NOT the uppercase colon-separated form `keytool` prints. The
/// two spellings describe one certificate, so folding happens here at the
/// source rather than being re-derived by each consumer.
///
/// Blocking: it performs JNI calls. Call it from a blocking context (the
/// tablet shell’s command layer uses `spawn_blocking`), never from the
/// Android main thread — the same discipline the Bluetooth transport follows.
pub fn apk_signing_fingerprint() -> Result<Option<String>, String> {
    with_env(|env| {
        // Application context: `ActivityThread.currentApplication()` is the
        // documented route from library code with no Activity in hand, and is
        // what this crate already assumes needs no extra permission.
        let activity_thread = env.find_class("android/app/ActivityThread")?;
        let application = env
            .call_static_method(
                activity_thread,
                "currentApplication",
                "()Landroid/app/Application;",
                &[],
            )?
            .l()?;
        if application.is_null() {
            // Not an error: without a context there is simply no answer, and
            // `None` is the fail-open direction.
            return Ok(None);
        }

        let manager = env
            .call_method(
                &application,
                "getPackageManager",
                "()Landroid/content/pm/PackageManager;",
                &[],
            )?
            .l()?;
        if manager.is_null() {
            return Ok(None);
        }

        let package_name = env
            .call_method(&application, "getPackageName", "()Ljava/lang/String;", &[])?
            .l()?;
        if package_name.is_null() {
            return Ok(None);
        }

        let package_info = env
            .call_method(
                &manager,
                "getPackageInfo",
                "(Ljava/lang/String;I)Landroid/content/pm/PackageInfo;",
                &[JValue::Object(&package_name), JValue::Int(GET_SIGNATURES)],
            )?
            .l()?;
        if package_info.is_null() {
            return Ok(None);
        }

        // `signatures` is an array of `android.content.pm.Signature`; index 0
        // is the current signing certificate. An APK signed with more than one
        // certificate (signing lineage) still reports the current one first,
        // which is the certificate a re-sign would have replaced.
        let signatures = env
            .get_field(
                &package_info,
                "signatures",
                "[Landroid/content/pm/Signature;",
            )?
            .l()?;
        if signatures.is_null() {
            return Ok(None);
        }

        let signatures_array = JObjectArray::from(signatures);
        let signature_bytes = env.get_object_array_element(&signatures_array, 0)?;
        if signature_bytes.is_null() {
            return Ok(None);
        }

        // `Signature.toByteArray()` yields the DER-encoded X.509 certificate.
        let der = env
            .call_method(&signature_bytes, "toByteArray", "()[B", &[])?
            .l()?;
        if der.is_null() {
            return Ok(None);
        }
        let der_bytes = JByteArray::from(der);
        let der: Vec<u8> = env.convert_byte_array(&der_bytes)?;
        if der.is_empty() {
            return Ok(None);
        }

        // SHA-256 over the DER certificate, which is exactly what `keytool
        // -printcert -digest SHA-256` reports — so an operator can verify a
        // pin against a keystore without this code in the loop.
        let digest = Sha256::digest(&der);
        Ok(Some(hex::encode(digest)))
    })
    .map_err(|e| e.to_string())
}
