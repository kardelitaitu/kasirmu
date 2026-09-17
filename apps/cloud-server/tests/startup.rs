//! Startup integration tests for the cloud server binary.
//!
//! These tests spawn the real `kasirmu-cloud` executable as a subprocess
//! and assert on its exit code and stderr. They verify the production-
//! hardening gates that must fail startup *before* the server binds a port —
//! the process has to exit with a clear, actionable error instead of falling
//! back to the hard-coded dev secret or an open token mint.

use std::process::Command;

/// Absolute path to the compiled `kasirmu-cloud` binary.
///
/// Cargo sets `CARGO_BIN_EXE_<name>` at *runtime* for integration tests (not
/// at compile time, so `env!` cannot see it). The name is the bin target name
/// exactly as-is, so it keeps the hyphen.
fn bin_path() -> String {
    std::env::var("CARGO_BIN_EXE_kasirmu-cloud").expect(
        "CARGO_BIN_EXE_kasirmu-cloud must be set; run via `cargo test` so \
         Cargo injects the binary path",
    )
}

/// Boot the binary in production mode with the given extra env vars and
/// return `(exit_ok, stderr)`.
///
/// Every startup-affecting variable is cleared first so the test is hermetic
/// regardless of the developer's shell environment.
fn run_production(extra: &[(&str, &str)]) -> (bool, String) {
    let mut cmd = Command::new(bin_path());
    for var in [
        "OZ_PRODUCTION",
        "OZ_API_SECRET",
        "OZ_ADMIN_KEY",
        "OZ_REDIRECT_ONLY",
        "OZ_SYNC_REDIRECT_URL",
        "OZ_DB_REQUIRE_TLS",
        "DATABASE_URL",
        "OZ_DB_PATH",
    ] {
        cmd.env_remove(var);
    }
    cmd.env("OZ_PRODUCTION", "1");
    for (key, value) in extra {
        cmd.env(key, value);
    }

    let output = cmd.output().expect("failed to spawn cloud server binary");
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    (output.status.success(), stderr)
}

#[test]
fn production_without_api_secret_exits_with_clear_error() {
    let (success, stderr) = run_production(&[("OZ_ADMIN_KEY", "test-admin-key")]);

    assert!(
        !success,
        "server must exit non-zero when OZ_API_SECRET is missing"
    );
    assert!(
        stderr.contains("OZ_PRODUCTION=1 requires OZ_API_SECRET"),
        "expected a clear OZ_API_SECRET error on stderr, got: {stderr}"
    );
}

#[test]
fn production_without_admin_key_exits_with_clear_error() {
    let (success, stderr) = run_production(&[("OZ_API_SECRET", "test-secret")]);

    assert!(
        !success,
        "server must exit non-zero when OZ_ADMIN_KEY is missing"
    );
    assert!(
        stderr.contains("OZ_PRODUCTION=1 requires OZ_ADMIN_KEY"),
        "expected a clear OZ_ADMIN_KEY error on stderr, got: {stderr}"
    );
}
