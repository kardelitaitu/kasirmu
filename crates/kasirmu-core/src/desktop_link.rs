//! Desktop device-link client (ADR #54 §2.5).
//!
//! The two calls a POS makes to link itself to an account: ask the licence server for
//! a consent URL, then exchange the loopback code for the linked account. The browser
//! launch, the loopback listener and the wizard UI live in the Tauri shell; everything
//! that can be tested without a window lives here.
//!
//! Key items: [`generate_pkce`], [`pkce_challenge`], [`start_desktop_link`],
//! [`consume_desktop_link`] and [`LinkedAccount`].
//!
//! Invariants: the verifier leaves this process only in the `/start` request (the
//! challenge is what travels to Google), and the server refuses a code presented by a
//! machine other than the one that began the flow.

use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::CoreError;

/// Path a device link is started on.
pub const LINK_START_PATH: &str = "/api/v1/desktop/link/google/start";
/// Path the loopback code is exchanged on.
pub const LINK_CONSUME_PATH: &str = "/api/v1/desktop/link/consume";
/// How long either link request may take.
const LINK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

/// A PKCE pair for one link attempt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pkce {
    /// The secret half; sent only to the licence server at `/start`.
    pub verifier: String,
    /// The S256 of the verifier; travels to Google in the consent URL.
    pub challenge: String,
}

/// Derives the S256 challenge for a verifier (RFC 7636 §4.2).
///
/// Pinned against the RFC's own worked example in the tests, because a challenge that
/// is merely self-consistent with our own verifier would pass every round-trip test and
/// still fail against Google.
pub fn pkce_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
}

/// Generates a fresh PKCE pair.
///
/// The verifier is two UUIDv4s rendered as hex — 64 characters, 244 bits, drawn from the
/// same CSPRNG the crate already trusts. It is deliberately NOT the existing nonce helper:
/// that returns 32 hex characters, and RFC 7636 requires at least 43, so Google rejects
/// the shorter value outright. The test below is what caught that, not inspection.
pub fn generate_pkce() -> Pkce {
    let verifier = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    Pkce {
        challenge: pkce_challenge(&verifier),
        verifier,
    }
}

/// The account a device was linked to, as the licence server reports it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedAccount {
    /// Tenant record id the identity was bound to.
    pub tenant_id: String,
    /// Provider key, e.g. `google`.
    pub provider: String,
    /// The address the provider verified.
    pub email: String,
}

#[derive(Deserialize)]
struct StartResponse {
    #[serde(rename = "authorizeUrl")]
    authorize_url: String,
}

/// Asks the licence server to begin a link and returns the URL to open in a browser.
///
/// The tenant is implied by `api_key`; the server also requires `machine_id` to be
/// registered to it, which is why an un-activated device cannot link.
#[cfg(feature = "sync-http")]
pub async fn start_desktop_link(
    base_url: &str,
    api_key: &str,
    machine_id: &str,
    state: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Result<String, CoreError> {
    let response = post_json(
        base_url,
        LINK_START_PATH,
        api_key,
        &serde_json::json!({
            "machine_id": machine_id,
            "code_verifier": verifier,
            "state": state,
            "redirect_uri": redirect_uri,
        }),
        "link start",
    )
    .await?;
    let body: StartResponse = response
        .json()
        .await
        .map_err(|e| CoreError::Internal(format!("link start response: {e}")))?;
    if body.authorize_url.is_empty() {
        return Err(CoreError::Internal(
            "link start answered without a consent URL".to_string(),
        ));
    }
    Ok(body.authorize_url)
}

/// Exchanges the loopback code for the linked account.
///
/// A code that is unknown, expired, already spent, or bound to another machine answers
/// `400`, which maps to [`CoreError::Validation`] on `link_code` so the wizard can say
/// "that link expired, try again" instead of showing a transport error.
#[cfg(feature = "sync-http")]
pub async fn consume_desktop_link(
    base_url: &str,
    api_key: &str,
    machine_id: &str,
    link_code: &str,
) -> Result<LinkedAccount, CoreError> {
    let response = post_json(
        base_url,
        LINK_CONSUME_PATH,
        api_key,
        &serde_json::json!({ "link_code": link_code, "machine_id": machine_id }),
        "link consume",
    )
    .await?;
    response
        .json()
        .await
        .map_err(|e| CoreError::Internal(format!("link consume response: {e}")))
}

/// POSTs a JSON body with the device's bearer key, mapping failures to typed errors.
#[cfg(feature = "sync-http")]
async fn post_json(
    base_url: &str,
    path: &str,
    api_key: &str,
    body: &serde_json::Value,
    what: &str,
) -> Result<reqwest::Response, CoreError> {
    let url = format!("{}{path}", base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(LINK_TIMEOUT)
        .build()
        .map_err(|e| CoreError::Internal(format!("{what} client: {e}")))?;
    let response = client
        .post(&url)
        .bearer_auth(api_key)
        .json(body)
        .send()
        .await
        .map_err(|e| CoreError::Internal(format!("{what} request to {base_url} failed: {e}")))?;
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    // A refused code is the expected failure, not an outage: surface it as a field
    // validation so the wizard can tell the user to start again.
    if status == reqwest::StatusCode::BAD_REQUEST {
        let detail = response.text().await.unwrap_or_default();
        return Err(CoreError::Validation {
            field: "link_code",
            message: format!("the licence server refused this link: {detail}"),
        });
    }
    Err(CoreError::Internal(format!(
        "{what} at {base_url} answered {status}"
    )))
}

#[cfg(test)]
#[path = "desktop_link_tests.rs"]
mod tests;
