//! Shared request-validation predicates for the OZ-POS API routes.
//!
//! Kept here so validation rules (e.g. the tenant-id charset) are defined
//! once and reused across handlers instead of being copy-pasted per route.

/// A tenant id must be a non-empty string of `[a-zA-Z0-9_-]` (max 64) so
/// scoped keys stay sane and unambiguous (`{base}:{tenant}`).
pub fn valid_tenant(tenant: &str) -> bool {
    !tenant.is_empty()
        && tenant.len() <= 64
        && tenant
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
