//! Platform-startup build script — declares the `tokio_unstable` cfg.
//!
//! `console.rs` gates tokio-console integration on the bare (non-feature) cfg
//! `tokio_unstable`, which is set from `RUSTFLAGS` rather than by Cargo. Without
//! a `rustc-check-cfg` declaration rustc's `unexpected_cfgs` lint calls it an
//! undeclared cfg name, and CI runs with `RUSTFLAGS: -D warnings`, so a warning
//! is a build error. Declaring the cfg is the fix; the crate-level
//! `#![allow(unexpected_cfgs)]` this replaces silenced the lint wholesale and
//! also hid a genuinely undeclared `feature = "metrics"` gate. Same mechanism
//! as `apps/cloud-server/build.rs`, the in-tree precedent.

fn main() {
    println!("cargo::rustc-check-cfg=cfg(tokio_unstable)");
}
