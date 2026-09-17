//! OZ-POS CLI build script — embeds the Windows application manifest.

// ── OZ-POS CLI — Windows application manifest (build script) ───────
//
// Embeds `app.manifest` (a `<requestedExecutionLevel level="asInvoker"/>`
// assembly manifest) into the Windows `oz.exe`. Without an embedded
// manifest, Windows applies unknown-app/installer-detection heuristics to
// this unsigned binary, raising a UAC consent prompt on every launch (seen
// empirically on the updater-compat harness — see the `.rc` comment for the
// numeric-24 gotcha). Windows-only: the CLI also builds for Linux/macOS,
// where embedding is a no-op.
fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let _ = embed_resource::compile("app.rc", embed_resource::NONE);
    }
}
