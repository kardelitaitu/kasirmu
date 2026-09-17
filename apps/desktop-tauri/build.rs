//! Tauri build script for the desktop client.
//!
//! Delegates to `tauri_build::build()` for code generation and resource bundling.
//! Manifest embedding for test binaries is handled in `src/lib.rs` via a
//! `.drectve` linker directive section.

fn main() {
    tauri_build::build();

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
