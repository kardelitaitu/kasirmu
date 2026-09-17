//! Cloud-server build script — declares the `tokio_unstable` cfg and embeds
//! the Windows application manifest.

// ── OZ-POS Cloud Server — Windows application manifest (build script) ──
//
// Embeds `app.manifest` (a `<requestedExecutionLevel level="asInvoker"/>`
// assembly manifest) into the Windows `kasirmu-cloud.exe`. Without an
// embedded manifest, Windows applies unknown-app/installer-detection
// heuristics to this unsigned binary, raising a UAC consent prompt on every
// launch (seen empirically on the updater-compat harness — see the `.rc`
// comment for the numeric-24 gotcha). Windows-only: the server also builds
// for Linux/Docker, where embedding is a no-op.
fn main() {
    println!("cargo::rustc-check-cfg=cfg(tokio_unstable)");

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let _ = embed_resource::compile("app.rc", embed_resource::NONE);
    }
}
