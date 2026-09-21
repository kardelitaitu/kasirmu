//! Build-integrity reporting — the client leg of ADR #57 §2.1.
//!
//! One function, [`apk_signing_fingerprint`], which returns this installation’s
//! APK signing-certificate fingerprint when — and only when — the platform can
//! produce one. It is the single place the rest of the bridge asks, so the
//! licence-status call and any future caller agree on how a fingerprint is
//! obtained and how a failure is spelled.
//!
//! # Always fail-open
//!
//! Every failure returns `None`, never an error: no Android (desktop shells),
//! no captured JVM, no package info, absent signature. `None` omits the field
//! from the request, and the server classifies an absent value as `unknown`
//! (§2.2), which is never a `mismatch` — so a device we cannot fingerprint is
//! never refused a renewal because of it. Turning this into an error would make
//! a reporting failure into a lockout, which is the failure mode §2.2 exists to
//! prevent.
//!
//! # Why the value is computed in native code
//!
//! The fingerprint is read through the JNI bridge in `kasirmu-hal`, not from the
//! webview. A patched JS bundle can therefore lie about many things, but it
//! cannot simply rewrite the value this function returns — it would have to
//! patch the native library, which is a strictly higher bar and the reason
//! §2.1 chose a native computation over a JS one.

/// Compute this installation’s APK signing-certificate fingerprint, if any.

/// Returns lowercase bare 64-hex — the form `classify_build_fingerprint`
/// compares against. `None` on every non-Android platform and on every failure
/// inside the Android path (see the module docs for why that direction is the
/// only safe one).
#[must_use]
pub fn apk_signing_fingerprint() -> Option<String> {
    #[cfg(target_os = "android")]
    {
        match kasirmu_hal::transport::apk_signature::apk_signing_fingerprint() {
            Ok(fp) => fp,
            Err(e) => {
                // Logged, not surfaced: a reporting failure is a diagnostic,
                // and promoting it to an error would let a broken fingerprint
                // path block a licence check the merchant depends on.
                tracing::warn!("APK signing fingerprint unavailable: {e}");
                None
            }
        }
    }
    // Desktop shells have no APK and no JVM. The field is simply absent from
    // the request, which the server reads as `unknown`.
    #[cfg(not(target_os = "android"))]
    {
        None
    }
}

#[cfg(test)]
#[path = "build_integrity_tests.rs"]
mod tests;
