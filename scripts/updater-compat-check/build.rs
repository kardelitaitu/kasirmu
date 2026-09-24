// ── kasir.mu Updater Compatibility Check — Windows manifest (build script) ──
//
// Embeds `app.manifest` (a `<requestedExecutionLevel level="asInvoker"/>`
// assembly manifest) into the Windows exe. Without an embedded manifest,
// Windows cannot determine the app's requested execution level and applies
// unknown-app/installer-detection heuristics to this unsigned binary — which
// raises a UAC consent prompt on every run (seen empirically with the
// manifest-less `oz-updater-compat-check.exe`).
//
// Windows-only: the harness is also built on Linux in release.yml's
// `release-validate` compat-check job, where embedding is a no-op.
// embed-resource's `compile` is cheap and dependency-light (rc.exe on MSVC).

fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        embed_resource::compile("app.rc", embed_resource::NONE);
    }
}
