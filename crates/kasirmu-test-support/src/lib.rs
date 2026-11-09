//! Test-only helpers shared across the kasir.mu workspace.
//!
//! This crate exists for ONE reason, stated once instead of five times.
//!
//! ## The `C:\WINDOWS\TEMP` trap
//!
//! `std::env::temp_dir()` and `tempfile::tempdir()` both resolve through the
//! `TEMP`/`TMP` environment variables. On this project's Windows machines the
//! MACHINE-level value (`HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment`)
//! is `C:\WINDOWS\TEMP`, while the USER-level value is the correct
//! `%LOCALAPPDATA%\Temp`. An ordinary user can CREATE inside `C:\WINDOWS\TEMP`
//! but cannot DELETE from it, so:
//!
//! - a fixture there can never be cleaned up, and
//! - once a stale directory exists the create itself fails with
//!   `PermissionDenied` (os error 5), which reads as a broken test.
//!
//! Measured across one session (2026-10-21): 19 sites in `kasirmu-core` broke
//! `concurrent_complete_sale_serialized_by_begin_immediate`, 1 in `kasirmu-api`
//! broke all twelve image tests, 4 in `kasirmu-cloud` broke five, and 46 across
//! 26 files in `mobile-tauri` broke **144 tests at once**. Every one of those
//! failures said the code was wrong when the environment was.
//!
//! ## The remedy, in one place
//!
//! Fixtures live under `<workspace>/target/test-scratch/`. `target/` is already
//! gitignored (`.gitignore:2`), so nothing created here can be committed, and
//! each helper appends a per-call UUID so parallel tests cannot collide.
//!
//! The workspace root is found by walking UP from `CARGO_MANIFEST_DIR` for the
//! directory holding both `Cargo.lock` and `target/`, never from the process
//! CWD — tests run from a crate directory while `target/` lives at the root.
//!
//! ## Which helper to use
//!
//! | need | call |
//! |---|---|
//! | a directory that cleans itself up | [`ScratchDir::new`] — **the default** |
//! | a `tempfile::TempDir` (same auto-delete, working parent) | [`tempdir`] |
//! | a bare path you will delete yourself | [`scratch_dir`] — see the warning |
//!
//! ## ⚠️ `scratch_dir` returns an UNGUARDED path, and that leaked 1,455 directories
//!
//! This table used to list `scratch_dir` first, as though "you manage the
//! lifetime" were an ordinary choice. It is not: dropping the returned `PathBuf`
//! deletes nothing, so a caller that does not explicitly remove the directory
//! leaves it behind **forever** — `target/` has no OS temp cleaner.
//!
//! Measured 2026-10-23: `target/test-scratch/` held 1,455 directories. The
//! bridge half (706) came from a harness that dropped the guard when replacing
//! its store manager; the rest were 30 direct `scratch_dir` call sites across 20
//! files, several of which deleted the FILE inside the directory and never the
//! directory itself.
//!
//! **Prefer `ScratchDir::new`.** Reach for `scratch_dir` only when the path must
//! outlive a guard you cannot thread — and then remove it explicitly.

#![deny(unsafe_code)]

use std::path::{Path, PathBuf};

/// The workspace root: the nearest ancestor of `CARGO_MANIFEST_DIR` holding
/// both `Cargo.lock` and `target/`.
///
/// Falls back to `CARGO_MANIFEST_DIR` itself when no such ancestor exists (an
/// unpacked crate outside a workspace), which keeps the helper usable rather
/// than panicking on a layout it did not expect.
fn workspace_root() -> PathBuf {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    manifest
        .ancestors()
        .find(|p| p.join("Cargo.lock").is_file() && p.join("target").is_dir())
        .unwrap_or(manifest)
        .to_path_buf()
}

/// `<workspace>/target/test-scratch`, created if absent.
///
/// # Panics
///
/// Panics if the directory cannot be created: a test that cannot obtain its
/// scratch space has nothing further it can usefully do.
pub fn scratch_root() -> PathBuf {
    let root = workspace_root().join("target").join("test-scratch");
    // INVARIANT: target directory in workspace is writable by test processes.
    std::fs::create_dir_all(&root).expect("test scratch root under target/ must be creatable");
    root
}

/// A fresh, empty, uniquely-named directory under [`scratch_root`].
///
/// # ⚠️ UNGUARDED — you must delete this yourself
///
/// The return value is a bare [`PathBuf`]. Dropping it removes **nothing**, and
/// `target/` is never swept by the OS. A caller that forgets to clean up leaks
/// one directory per run, permanently.
///
/// This is not theoretical. Thirty call sites used this helper, several of them
/// deleting a file *inside* the directory and never the directory itself; 1,455
/// directories accumulated in `target/test-scratch/` before it was measured on
/// 2026-10-23.
///
/// **Use [`ScratchDir::new`]** unless the path genuinely must outlive a guard you
/// cannot thread through a signature. `crates/kasirmu-bridge/src/testing.rs`
/// shows the accepted pattern for that case: return the path *and* the guard as
/// a tuple, so ownership travels with the directory.
///
/// # Panics
///
/// Panics if the directory cannot be created.
pub fn scratch_dir(prefix: &str) -> PathBuf {
    let dir = scratch_root().join(format!("{prefix}-{}", uuid::Uuid::new_v4()));
    // INVARIANT: scratch_root exists and is writable with unique UUID suffix.
    std::fs::create_dir_all(&dir).expect("test scratch dir under target/ must be creatable");
    dir
}

/// A scratch directory that removes itself when dropped.
///
/// The removal is best-effort — a failed cleanup must not fail a test that
/// already passed — but unlike a `C:\WINDOWS\TEMP` fixture it CAN succeed,
/// which is the whole point.
#[derive(Debug)]
pub struct ScratchDir {
    path: PathBuf,
}

impl ScratchDir {
    /// Create a fresh scratch directory named `<prefix>-<uuid>`.
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

impl Drop for ScratchDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// A `tempfile::TempDir` rooted in [`scratch_root`] instead of `TEMP`.
///
/// `tempfile::tempdir()` and `TempDir`'s own `Drop` are kept — only the PARENT
/// changes — so this is a drop-in for the ~42 call sites that just want the
/// same auto-delete behaviour in a working directory.
///
/// # Panics
///
/// Panics if the directory cannot be created.
pub fn tempdir() -> tempfile::TempDir {
    // INVARIANT: scratch_root exists and is writable for tempdir creation.
    tempfile::tempdir_in(scratch_root()).expect("test scratch tempdir under target/")
}

/// A `tempfile::TempDir` under [`scratch_root`] with a caller-chosen prefix.
///
/// # Panics
///
/// Panics if the directory cannot be created.
pub fn tempdir_with_prefix(prefix: &str) -> tempfile::TempDir {
    // INVARIANT: scratch_root exists and is writable for tempdir creation.
    tempfile::Builder::new()
        .prefix(prefix)
        .tempdir_in(scratch_root())
        .expect("test scratch tempdir under target/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scratch_root_is_under_target_and_exists() {
        let root = scratch_root();
        assert!(root.is_dir(), "scratch root must exist: {}", root.display());
        assert!(
            root.ends_with(Path::new("target").join("test-scratch")),
            "scratch root must be target/test-scratch, got {}",
            root.display()
        );
    }

    #[test]
    fn scratch_root_is_never_windows_temp() {
        // The regression this crate exists to prevent. Case-insensitive
        // because Windows paths are.
        let root = scratch_root().to_string_lossy().to_lowercase();
        assert!(
            !root.contains("windows\\temp"),
            "scratch root must not be Windows TEMP, got {root}"
        );
    }

    #[test]
    fn scratch_dir_is_unique_per_call() {
        let a = scratch_dir("uniq");
        let b = scratch_dir("uniq");
        assert_ne!(a, b, "parallel tests must never share a scratch dir");
        assert!(a.is_dir() && b.is_dir());
    }

    #[test]
    fn scratch_dir_removes_itself_on_drop() {
        let path = {
            let guard = ScratchDir::new("drop");
            assert!(guard.path().is_dir());
            guard.path().to_path_buf()
        };
        assert!(!path.exists(), "ScratchDir must delete itself on drop");
    }

    #[test]
    fn scratch_dir_does_not_remove_itself_and_that_is_the_hazard() {
        // The negative half of `scratch_dir_removes_itself_on_drop`, and the
        // reason 30 call sites leaked: `scratch_dir` returns a bare `PathBuf`,
        // so dropping it deletes NOTHING. Every caller that used it and walked
        // away left a directory behind forever — 38 `oz-test-backup-*` and 74
        // `oz-pos-test-csv-*` were measured in `target/test-scratch/`.
        //
        // This test asserts the hazard rather than the fix, deliberately: if
        // someone ever gives `scratch_dir` a guard, this fails and they must
        // come here and read why the two APIs are not interchangeable.
        let path = scratch_dir("hazard");
        drop(path);
        let leftover = scratch_root();
        let leaked = std::fs::read_dir(&leftover)
            .expect("scratch root readable")
            .filter_map(Result::ok)
            .any(|e| e.file_name().to_string_lossy().starts_with("hazard-"));
        assert!(
            leaked,
            "scratch_dir is documented as unguarded; if this now deletes itself, \
             the API changed and every ScratchDir call site should be revisited"
        );
        // Clean up after ourselves — this test exists to PROVE the leak, not to
        // contribute to it.
        for entry in std::fs::read_dir(&leftover).expect("scratch root readable") {
            let entry = entry.expect("entry");
            if entry.file_name().to_string_lossy().starts_with("hazard-") {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    }

    #[test]
    fn tempdir_lands_under_the_scratch_root() {
        let tmp = tempdir();
        assert!(tmp.path().starts_with(scratch_root()));
    }

    #[test]
    fn tempdir_with_prefix_keeps_its_prefix() {
        let tmp = tempdir_with_prefix("kasirmu-probe-");
        let name = tmp
            .path()
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();
        assert!(name.starts_with("kasirmu-probe-"), "got {name}");
    }
}
