//! API write-audit hook (desktop local API; the cloud surface keeps its
//! own logging).
//!
//! A thin axum middleware ([`audit_middleware`]) observes every
//! mutating request on the `/api/v1/*` surface AFTER authentication
//! (it is layered inside the auth middleware, so the validated
//! [`ApiTokenClaims`] are already in request extensions) and hands a
//! lossless [`ApiWriteEvent`] to an embedder-provided [`AuditSink`].
//!
//! The crate deliberately knows nothing about WHERE events go: the
//! desktop app implements the sink against the served store's
//! `audit_log` table (so API writes appear in the merchant's audit
//! review UI), and tests use an in-memory collector. Sinks must be
//! fire-and-forget — `record` is called on the request path and must
//! not block (spawn the write).

use std::sync::Arc;

use axum::extract::{Request, State};
use axum::http::Method;
use axum::middleware::Next;
use axum::response::Response;

use crate::auth::ApiTokenClaims;

/// One observed mutating API request.
#[derive(Debug, Clone)]
pub struct ApiWriteEvent {
    /// HTTP method as string (POST/PUT/PATCH/DELETE).
    pub method: String,
    /// Request path (e.g. `/api/v1/products/COFFEE/stock`).
    pub path: String,
    /// Response status code.
    pub status: u16,
    /// Token label (`sub` claim) when the request was authenticated.
    pub token_label: Option<String>,
    /// Registered terminal id for device-minted tokens, if any.
    pub terminal_id: Option<String>,
}

/// Embedder-provided destination for [`ApiWriteEvent`]s.
///
/// `record` runs on the request path: implementations must return
/// immediately (spawn the actual write) and never panic.
pub trait AuditSink: Send + Sync + 'static {
    /// Record a write event. Implementations must return immediately
    /// (spawn the actual write) and never panic.
    fn record(&self, event: &ApiWriteEvent);
}

/// True when `method` is a mutating verb we audit.
fn is_write(method: &Method) -> bool {
    matches!(
        method,
        &Method::POST | &Method::PUT | &Method::PATCH | &Method::DELETE
    )
}

/// Middleware recording every `/api/v1/*` write into the sink.
///
/// Layer this INSIDE the auth middleware so validated claims are in
/// extensions; when auth rejects (401) the request never reaches here,
/// which is intended — failed auth attempts are not merchant-relevant
/// write events (and unauthenticated noise must not fill the audit).
pub async fn audit_middleware(
    State(sink): State<Arc<dyn AuditSink>>,
    req: Request,
    next: Next,
) -> Response {
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let claims = req.extensions().get::<ApiTokenClaims>().cloned();
    let watch = is_write(&method) && path.starts_with("/api/v1/");

    let response = next.run(req).await;

    if watch {
        let status = response.status().as_u16();
        sink.record(&ApiWriteEvent {
            method: method.as_str().to_string(),
            path,
            status,
            token_label: claims.as_ref().map(|c| c.sub.clone()),
            terminal_id: claims.as_ref().and_then(|c| c.terminal_id.clone()),
        });
    }
    response
}

#[cfg(test)]
#[path = "api_audit_tests.rs"]
mod tests;
