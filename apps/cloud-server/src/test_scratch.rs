//! Scratch-directory helpers for tests that need a real file on disk.
//!
//! Why this module exists rather than each test calling
//! `std::env::temp_dir()` or `tempfile::tempdir()`: both resolve through
//! `TEMP`/`TMP`, and on this project's Windows machines the MACHINE-level
//! value is `C:\WINDOWS\TEMP` — a directory an ordinary user may create
//! inside but cannot delete from. A fixture there can never be cleaned up,
//! and once a stale entry exists the create itself fails with
//! `PermissionDenied`, which reads as a broken test rather than as a hostile
//! environment. Measured 2026-10-21: five tests in this crate failed that way,
//! including three with nothing in common.
//!
//! `target/` is already gitignored (`.gitignore:2`), so nothing created here
//! can be committed, and the per-call UUID keeps parallel tests apart. The
//! workspace root is found by walking up from `CARGO_MANIFEST_DIR` rather than
//! from the process CWD, because tests run from the crate directory while
//! `target/` lives at the workspace root.

#![cfg(test)]

use std::path::{Path, PathBuf};

/// Path to `<workspace>/target/test-scratch`, creating it if absent.
///
/// # Panics
///
/// Panics if the directory cannot be created: a test that cannot obtain its
/// scratch space has nothing further it can usefully do.
pub fn scratch_root() -> PathBuf {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let workspace = manifest
        .ancestors()
        .find(|p| p.join("Cargo.lock").is_file() && p.join("target").is_dir())
        .unwrap_or(manifest);
    let root = workspace.join("target").join("test-scratch");
    std::fs::create_dir_all(&root).expect("test scratch root under target/ must be creatable");
    root
}

/// A fresh, empty, uniquely-named directory under [`scratch_root`].
///
/// # Panics
///
/// Panics if the directory cannot be created.
pub fn scratch_dir(prefix: &str) -> PathBuf {
    let dir = scratch_root().join(format!("{prefix}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("test scratch dir under target/ must be creatable");
    dir
}

/// An owned scratch directory that removes itself on drop.
///
/// A drop-in for `tempfile::TempDir`: same [`TempScratch::path`] accessor, same
/// delete-on-drop lifetime, but rooted in the gitignored `target/` tree instead
/// of whatever `TEMP` happens to point at. The removal is best-effort — a
/// failed cleanup must not fail the test that already passed — but unlike a
/// `C:\WINDOWS\TEMP` fixture it CAN succeed, which is the entire point.
#[derive(Debug)]
pub struct TempScratch {
    path: PathBuf,
}

impl TempScratch {
    /// Create a fresh scratch directory named `prefix-<uuid>`.
    ///
    /// # Panics
    ///
    /// Panics if the directory cannot be created.
    pub fn new(prefix: &str) -> Self {
        Self {
            path: scratch_dir(prefix),
        }
    }

    /// The directory this guard owns.
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempScratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}
