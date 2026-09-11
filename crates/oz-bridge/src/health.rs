//! Health-check command bodies (startup smoke test and About dialog).
//!
//! Wave F: extracted from `apps/desktop-client/src/commands/health.rs`.
//! The runtime host probes (`std::env::var` COMPUTERNAME/HOSTNAME and the
//! `UdpSocket` local-IP trick) moved VERBATIM — plain std, headless-safe.
//! The compile-time identity fields are the one deliberate restructure:
//! `env!`/`option_env!` resolve per-crate, so they stay evaluated in the
//! desktop shim and are threaded here as extra parameters — a byte-identical
//! wire shape (`name` would otherwise answer `"oz-bridge"` post-move).
//! The scoped variants keep the resolve-then-delegate shape (no permission
//! gate on any health command).

use serde::Serialize;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// Build/version information for the About dialog.
#[derive(Debug, Serialize)]
pub struct VersionInfo {
    /// Display name.
    pub name: &'static str,
    /// Version.
    pub version: &'static str,
    /// Rust Version.
    pub rust_version: &'static str,
    /// Target.
    pub target: &'static str,
}

/// Liveness probe. Returns `Ok("pong")` if the Tauri runtime is alive.
pub async fn ping() -> Result<String, BridgeError> {
    Ok("pong".into())
}

/// Version information from the shell's compile-time constants (see module
/// doc: the `env!` reads live in the desktop shim, threaded in as params).
pub async fn version(
    name: &'static str,
    version: &'static str,
    rust_version: &'static str,
    target: &'static str,
) -> Result<VersionInfo, BridgeError> {
    Ok(VersionInfo {
        name,
        version,
        rust_version,
        target,
    })
}

/// Version info resolved from a session token. ADR #7.
/// Validates the session token and returns the same compile-time version info.
pub async fn version_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    name: &'static str,
    version: &'static str,
    rust_version: &'static str,
    target: &'static str,
) -> Result<VersionInfo, BridgeError> {
    let _session = ctx.resolve_session(session_token)?;
    Ok(VersionInfo {
        name,
        version,
        rust_version,
        target,
    })
}

/// Get the stable device identifier (hostname) for terminal binding.
///
/// Reads `COMPUTERNAME` on Windows, `HOSTNAME` on Unix, or falls back
/// to `"unknown-device"`. This is used by WorkspaceContext to populate
/// the `terminal_id` field when creating session tokens (ADR #7).
pub async fn get_device_id() -> Result<String, BridgeError> {
    Ok(std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "unknown-device".to_string()))
}

/// Get the local IP address of the machine.
pub async fn get_local_ip() -> Result<String, BridgeError> {
    use std::net::UdpSocket;
    // A trick to get the local IP address without making actual network requests.
    let socket = match UdpSocket::bind("0.0.0.0:0") {
        Ok(s) => s,
        Err(_) => return Ok("127.0.0.1".into()),
    };
    if let Ok(()) = socket.connect("8.8.8.8:80")
        && let Ok(local_addr) = socket.local_addr()
    {
        return Ok(local_addr.ip().to_string());
    }
    Ok("127.0.0.1".into())
}

/// Session-scoped variant of [`ping`].
pub async fn ping_scoped(ctx: &BridgeCtx<'_>, session_token: &str) -> Result<String, BridgeError> {
    let _session = ctx.resolve_session(session_token)?;
    ping().await
}

/// Session-scoped variant of [`get_device_id`].
pub async fn get_device_id_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<String, BridgeError> {
    let _session = ctx.resolve_session(session_token)?;
    get_device_id().await
}

/// Session-scoped variant of [`get_local_ip`].
pub async fn get_local_ip_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<String, BridgeError> {
    let _session = ctx.resolve_session(session_token)?;
    get_local_ip().await
}

#[cfg(test)]
#[path = "health_tests.rs"]
mod tests;
