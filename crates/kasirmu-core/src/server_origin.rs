//! Server origin resolution for the unified auth+sync deployment (ADR #55).
//!
//! One Northflank service serves both functions behind caddy — PocketBase for
//! /api/v1/license/* and /api/v1/web/*, the Rust cloud server for /api/v1/sync/*,
//! /api/v1/tokens and the REST surface (ADR #11). "The auth server URL" and "the
//! sync server URL" are therefore one fact, and this module is its only compiled
//! definition.
//!
//! Resolution precedence, highest first:
//!
//! 1. the OZ_LICENSE_SERVER_URL environment override (dev/test only — a shipped
//!    installer's user cannot set it)
//! 2. a pinned origin persisted after a successful boot
//! 3. MAIN_SERVER_ORIGIN
//! 4. FALLBACK_SERVER_ORIGIN — the same deployment under its second name
//!
//! Invariants:
//!
//! - **No I/O.** Callers pass the environment and pinned values in, which is what
//!   makes the precedence table testable without mutating process state.
//! - **An empty value is unconfigured**, never an empty base URL. This mirrors the
//!   invariant the sync bootstrap already applies to the sync URL.
//! - **Loopback is cfg(debug_assertions).** A release binary must contain no
//!   localhost origin at all, because any local process that binds the port could
//!   then impersonate the server and harvest the tenant api_key.

/// The canonical compiled origin for the unified deployment.
pub const MAIN_SERVER_ORIGIN: &str = "https://license.kasir.mu";

/// The second name for the same deployment, tried after MAIN_SERVER_ORIGIN.
///
/// This is an **alias, not a replica**: both names must resolve to the same
/// caddy host and the same data. A fallback answering from a different database
/// would silently fork a shop's data, which is why the reachability cascade is
/// only meaningful under that assumption (ADR #55).
pub const FALLBACK_SERVER_ORIGIN: &str = "https://license.ozpos.my.id";

/// Environment variable that overrides the compiled origin.
///
/// Intended for developers pointing a debug build at a local Docker backend. It
/// is read from the process environment, so no installed copy can use it to move
/// hosts.
pub const ORIGIN_ENV_OVERRIDE: &str = "OZ_LICENSE_SERVER_URL";

/// Loopback auth origin for the split dev stack (PocketBase container).
#[cfg(debug_assertions)]
pub const DEBUG_AUTH_ORIGIN: &str = "http://localhost:8080";

/// Loopback sync origin for the split dev stack (cloud-server container).
#[cfg(debug_assertions)]
pub const DEBUG_SYNC_ORIGIN: &str = "http://localhost:3099";

/// Which tier produced a resolution.
///
/// Carried alongside the URL so diagnostics can state *why* an origin won —
/// "sync is pointed at the fallback" is otherwise indistinguishable from "sync is
/// misconfigured".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OriginSource {
    /// The process environment override won.
    EnvOverride,
    /// A previously pinned origin won.
    Pinned,
    /// The canonical compiled origin won.
    Main,
    /// The second name for the same deployment won.
    Fallback,
    /// A loopback dev origin won (debug builds only).
    DebugLocal,
}

impl OriginSource {
    /// Stable lowercase label for logs, diagnostics and settings display.
    pub fn as_str(self) -> &'static str {
        match self {
            OriginSource::EnvOverride => "env-override",
            OriginSource::Pinned => "pinned",
            OriginSource::Main => "main",
            OriginSource::Fallback => "fallback",
            OriginSource::DebugLocal => "debug-local",
        }
    }
}

/// A resolved origin together with the tier that supplied it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedServerOrigin {
    /// Origin URL, trailing slashes trimmed.
    pub url: String,
    /// The tier that produced the URL.
    pub source: OriginSource,
}

/// Trim a candidate origin, ignoring blanks and rejecting non-HTTP schemes.
///
/// Returns None for a value that must not be used as a base URL: blank,
/// whitespace-only, or carrying a scheme that is not http/https. A trailing slash
/// is trimmed so callers can append /api/... without producing a double slash; an
/// interior path is preserved because the env override has always been allowed to
/// carry one.
pub fn normalize_origin(raw: &str) -> Option<String> {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return None;
    }
    let lowered = trimmed.to_ascii_lowercase();
    if !(lowered.starts_with("http://") || lowered.starts_with("https://")) {
        return None;
    }
    Some(trimmed.to_string())
}

/// Resolve the server origin from the two inputs that can precede the compiled
/// default.
///
/// env_override is the value of ORIGIN_ENV_OVERRIDE when set; pinned is the
/// origin persisted from a previous boot. Both are ignored when blank or
/// malformed, so a stray "OZ_LICENSE_SERVER_URL=" line cannot blank out the base
/// URL.
pub fn resolve_origin(env_override: Option<String>, pinned: Option<String>) -> ResolvedServerOrigin {
    if let Some(url) = env_override.as_deref().and_then(normalize_origin) {
        return ResolvedServerOrigin { url, source: OriginSource::EnvOverride };
    }
    if let Some(url) = pinned.as_deref().and_then(normalize_origin) {
        return ResolvedServerOrigin { url, source: OriginSource::Pinned };
    }
    ResolvedServerOrigin {
        url: MAIN_SERVER_ORIGIN.to_string(),
        source: OriginSource::Main,
    }
}

/// The ordered reachability ladder for a release build.
///
/// Both entries are names for the same deployment; a caller walks this list only
/// on a *transport* failure and never on an HTTP status, so that a credential
/// rejection can never be retried against a second host.
pub fn release_ladder() -> [&'static str; 2] {
    [MAIN_SERVER_ORIGIN, FALLBACK_SERVER_ORIGIN]
}

#[cfg(test)]
#[path = "server_origin_tests.rs"]
mod tests;
