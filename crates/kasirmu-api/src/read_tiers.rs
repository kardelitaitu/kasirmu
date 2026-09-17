//! Read-tier presets, READ_KEY_MAP, and read-gate middleware for JWT
//! tokens (spec 0047 Part B F2–F3).
//!
//! A token may carry an optional `permissions` claim — a list of registry
//! keys. Reads are gated through [`oz_core::has_permission`] against a
//! static route-to-key map. A token without the claim = legacy full-read
//! (grandfathered, backward compatible).
//!
//! Presets are named key lists used at mint time: terminal client-credential
//! tokens bind the `terminal` preset unconditionally; admin-key mints
//! accept an optional `read_preset` or `read_permissions` field.

use axum::{
    Json,
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};

use crate::auth::ApiTokenClaims;

/// One entry in the static read-key map.
pub struct ReadKeyEntry {
    /// HTTP method (e.g. "GET").
    pub method: &'static str,
    /// Axum-style path template with `{param}` placeholders.
    pub path: &'static str,
    /// Registry key required to read this route.
    pub key: &'static str,
    /// Whether the route may carry PII (customer references, staff
    /// identity, etc.). Used by the `dashboard` preset derivation and
    /// the PII-invariant test.
    pub pii: bool,
}

/// Read-key map covering every JWT-protected GET route.
///
/// Sync routes (under `/api/sync/`) keep their existing gating — they
/// are excluded from this map. Health/metrics/docs are public and also
/// excluded.
pub const READ_KEY_MAP: &[ReadKeyEntry] = &[
    // ── Products ─────────────────────────────────────────────────
    ReadKeyEntry {
        method: "GET",
        path: "/api/v1/products",
        key: "products:read",
        pii: false,
    },
    ReadKeyEntry {
        method: "GET",
        path: "/api/v1/products/{sku}",
        key: "products:read",
        pii: false,
    },
    // ── Categories ───────────────────────────────────────────────
    ReadKeyEntry {
        method: "GET",
        path: "/api/v1/categories",
        key: "categories:read",
        pii: false,
    },
    // ── Exchange rates ───────────────────────────────────────────
    ReadKeyEntry {
        method: "GET",
        path: "/api/v1/exchange-rates",
        key: "reference:read",
        pii: false,
    },
    ReadKeyEntry {
        method: "GET",
        path: "/api/v1/exchange-rates/latest",
        key: "reference:read",
        pii: false,
    },
    ReadKeyEntry {
        method: "GET",
        path: "/api/v1/exchange-rates/latest/{from}/{to}",
        key: "reference:read",
        pii: false,
    },
    // ── Plan ─────────────────────────────────────────────────────
    ReadKeyEntry {
        method: "GET",
        path: "/api/v1/tenants/me/plan",
        key: "plan:read",
        pii: false,
    },
    // ── Sales ────────────────────────────────────────────────────
    ReadKeyEntry {
        method: "GET",
        path: "/api/v1/sales/{id}",
        key: "sales:view",
        pii: true, // customer refs + notes can ride sale payloads
    },
    // ── Images (spec 0046b) ──────────────────────────────────────
    ReadKeyEntry {
        method: "GET",
        path: "/api/v1/images:pack",
        key: "products:read",
        pii: false,
    },
    ReadKeyEntry {
        method: "GET",
        path: "/api/v1/images:missing",
        key: "products:read",
        pii: false,
    },
    ReadKeyEntry {
        method: "GET",
        path: "/api/v1/images/{hash16}",
        key: "products:read",
        pii: false,
    },
];

// ── Presets ──────────────────────────────────────────────────────────

/// `terminal` preset — POS terminal reads (minimal, non-PII).
pub const TERMINAL_PRESET: &[&str] = &[
    "products:read",
    "categories:read",
    "reference:read",
    "plan:read",
];

/// `dashboard` preset — third-party dashboard reads, derived by
/// excluding pii-marked routes (spec 0047 decision 3).
pub const DASHBOARD_PRESET: &[&str] = &["products:read", "reports:view", "analytics:view"];

/// `audit` preset — auditor/accountant reads.
pub const AUDIT_PRESET: &[&str] = &["audit:view", "reports:view"];

/// Resolve a preset name to its permission key list.
///
/// Returns `None` for unknown preset names (the caller should reject
/// with 422).
pub fn resolve_preset(name: &str) -> Option<&'static [&'static str]> {
    match name {
        "terminal" => Some(TERMINAL_PRESET),
        "dashboard" => Some(DASHBOARD_PRESET),
        "audit" => Some(AUDIT_PRESET),
        _ => None,
    }
}

/// Validate that every key is registered in the permission registry.
///
/// Returns the list of unknown keys (empty = all valid). Uses
/// `oz_core::permission_registry::is_registered` for each key.
pub fn validate_keys(keys: &[String]) -> Result<(), Vec<String>> {
    let unknown: Vec<String> = keys
        .iter()
        .filter(|k| !oz_core::permission_registry::is_registered(k))
        .cloned()
        .collect();
    if unknown.is_empty() {
        Ok(())
    } else {
        Err(unknown)
    }
}

// ── Path matching helper ────────────────────────────────────────────

/// Check whether an actual request path matches an axum-style template.
///
/// Axum templates use `{param}` for path parameters.  This function
/// splits both on `/` and compares segment by segment; a `{...}` segment
/// in the template matches any single concrete segment.
///
/// Double-slash, trailing slashes, and empty segments are not expected
/// from a running axum server.
fn path_matches(template: &str, actual: &str) -> bool {
    let t_segs: Vec<&str> = template.split('/').collect();
    let a_segs: Vec<&str> = actual.split('/').collect();
    if t_segs.len() != a_segs.len() {
        return false;
    }
    t_segs
        .iter()
        .zip(a_segs.iter())
        .all(|(t, a)| t.starts_with('{') && t.ends_with('}') || t == a)
}

// ── Read-gate middleware ────────────────────────────────────────────

/// 403 response body: `insufficient_scope`.
fn insufficient_scope() -> Response {
    (
        StatusCode::FORBIDDEN,
        Json(serde_json::json!({"error": "insufficient_scope"})),
    )
        .into_response()
}

/// Axum middleware that gates GET requests against the token's
/// read-tier permissions.
///
/// Must run AFTER [`crate::auth::auth_middleware`] so that
/// `ApiTokenClaims` are available in request extensions.
///
/// - Claims with `permissions: None` → pass (legacy full-read).
/// - Claims with `permissions: Some(list)` → check the current
///   (method, path) against [`READ_KEY_MAP`]; if found, assert
///   `has_permission(key)`; if denied → 403 `insufficient_scope`.
/// - Routes not in the map (sync, public, write-only) → pass through.
#[allow(clippy::result_large_err)]
pub async fn read_gate_middleware(req: Request, next: Next) -> Result<Response, Response> {
    // Claims inserted by auth_middleware — must be ordered after it.
    let Some(claims) = req.extensions().get::<ApiTokenClaims>() else {
        // No claims → not authenticated. This should not happen if the
        // middleware is ordered after auth_middleware, but handle gracefully.
        return Ok(next.run(req).await);
    };

    let Some(permissions) = &claims.permissions else {
        // Legacy token — no read restriction.
        return Ok(next.run(req).await);
    };

    // Look up the current (method, path) in the read-key map.
    let method = req.method().as_str();
    let path = req.uri().path();

    let Some(entry) = READ_KEY_MAP
        .iter()
        .find(|e| e.method == method && path_matches(e.path, path))
    else {
        // Route not in the map — sync, public, or write — pass through.
        return Ok(next.run(req).await);
    };

    if !oz_core::has_permission(permissions, entry.key) {
        return Err(insufficient_scope());
    }

    Ok(next.run(req).await)
}

#[cfg(test)]
#[path = "read_tiers_tests.rs"]
mod tests;
