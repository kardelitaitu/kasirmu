//! Tablet-client build script: runs `tauri_build::try_build(...)` with an explicit
//! Windows manifest (`level="asInvoker"` + Common-Controls v6).
//!
//! Windows manifest embedding for test binaries is deliberately NOT done
//! here — see the comment inside `main` for why it lives in `src/lib.rs`.

fn main() {
    let mut windows = tauri_build::WindowsAttributes::new();
    windows = windows.app_manifest(include_str!("app.manifest"));
    let attrs = tauri_build::Attributes::new().windows_attributes(windows);

    tauri_build::try_build(attrs).expect("failed to run tauri-build");

    // The manifest embedding for test binaries is handled via a
    // `.drectve` linker directive section in `src/lib.rs` (gated on
    // `#[cfg(all(test, windows, target_env = "msvc"))]`).  We can't do it
    // here because `cargo:rustc-link-arg` only accepts `/MANIFESTINPUT`
    // (which causes `CVT1100: duplicate resource` on `[[bin]]` test
    // targets that already receive a manifest from `tauri-build`'s
    // `resource.lib`) and `/MANIFESTDEPENDENCY` (which fails with
    // `LNK1181` because Cargo splits the argument on spaces).
    //
    // The `.drectve` approach injects linker directives directly into
    // the object file, bypassing Cargo's argument parsing entirely.
    //
    // See: https://github.com/orgs/tauri-apps/discussions/11179
}
