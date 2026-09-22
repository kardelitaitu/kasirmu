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
/// Path an emailed link code is requested on (ADR #54 §2.6): no browser involved.
pub const LINK_EMAIL_REQUEST_PATH: &str = "/api/v1/desktop/link/email/request";
/// Path an emailed link code is spent on.
pub const LINK_EMAIL_CONSUME_PATH: &str = "/api/v1/desktop/link/email/consume";
/// Path a tablet device-code pairing session is started on (ADR #56 §2.5 / §5 Q1).
pub const PAIRING_START_PATH: &str = "/api/v1/pairing/start";
/// Path a tablet device-code pairing session is polled on.
pub const PAIRING_POLL_PATH: &str = "/api/v1/pairing/poll";
/// How long either link request may take.
const LINK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

/// Response from starting a device-code pairing session (ADR #56 §2.5).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PairingSessionStart {
    /// 8-character Crockford Base32 human-friendly code (e.g. ABCD-1234).
    pub code: String,
    /// Secure random token the terminal presents when polling.
    pub poll_token: String,
    /// When this pairing session expires (RFC 3339).
    pub expires_at: String,
    /// Direct QR URL that operators can scan on their phone.
    pub qr_url: String,
}

/// Response from polling an active device-code pairing session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PairingPollResponse {
    /// Pairing status: "pending" | "claimed".
    pub status: String,
    /// Tenant ID assigned to this device upon claim.
    #[serde(default)]
    pub tenant_id: Option<String>,
    /// Account email that claimed this device.
    #[serde(default)]
    pub email: Option<String>,
    /// Sync terminal credentials issued upon claim.
    #[serde(default)]
    pub terminal: Option<TerminalCredential>,
}


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

/// The sync credential a completed link earned (ADR #54 §2.5 step 6).
///
/// `issued` is always present, so a caller can tell a device that was linked but holds no
/// credential — the sync service was unconfigured, unreachable, or refused the key — from one
/// that got everything. A missing field parses as `None`, so an older server is still readable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCredential {
    /// Whether the sync service issued a credential.
    pub issued: bool,
    /// The registered terminal id, when one was issued.
    pub terminal_id: Option<String>,
    /// The device secret, shown once, when one was issued.
    pub device_secret: Option<String>,
    /// Why nothing was issued, when `issued` is false.
    pub reason: Option<String>,
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
    /// The sync credential this link earned, when the server issued one.
    pub terminal: Option<TerminalCredential>,
}

/// The account an emailed code proved, as the licence server reports it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifiedAccount {
    /// Tenant record id the account belongs to.
    pub tenant_id: String,
    /// The address that received the code.
    pub email: String,
    /// Whether the account now counts as verified (true on success).
    pub verified: bool,
    /// The sync credential this link earned, when the server issued one.
    pub terminal: Option<TerminalCredential>,
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
        "account",
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
        "link_code",
    )
    .await?;
    response
        .json()
        .await
        .map_err(|e| CoreError::Internal(format!("link consume response: {e}")))
}

/// Asks the licence server to email a link code to this device's account address.
///
/// The server accepts only the tenant's OWN address (it is proven by the device's key), so a
/// mismatch answers `403` and maps to a validation on `email` — a field the user typed and can
/// correct, rather than an outage.
#[cfg(feature = "sync-http")]
pub async fn request_desktop_link_code(
    base_url: &str,
    api_key: &str,
    machine_id: &str,
    email: &str,
) -> Result<(), CoreError> {
    post_json(
        base_url,
        LINK_EMAIL_REQUEST_PATH,
        api_key,
        &serde_json::json!({ "machine_id": machine_id, "email": email }),
        "link email request",
        "email",
    )
    .await?;
    Ok(())
}

/// Spends an emailed link code and returns the account it proved.
#[cfg(feature = "sync-http")]
pub async fn consume_desktop_link_code(
    base_url: &str,
    api_key: &str,
    machine_id: &str,
    code: &str,
) -> Result<VerifiedAccount, CoreError> {
    let response = post_json(
        base_url,
        LINK_EMAIL_CONSUME_PATH,
        api_key,
        &serde_json::json!({ "machine_id": machine_id, "code": code }),
        "link email consume",
        "code",
    )
    .await?;
    response
        .json()
        .await
        .map_err(|e| CoreError::Internal(format!("link email consume response: {e}")))
}

/// Starts a tablet device-code pairing session (ADR #56 §2.5 / §5 Q1).
#[cfg(feature = "sync-http")]
pub async fn start_device_pairing(
    base_url: &str,
    machine_id: &str,
    device_name: &str,
) -> Result<PairingSessionStart, CoreError> {
    let url = format!("{}{PAIRING_START_PATH}", base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(LINK_TIMEOUT)
        .build()
        .map_err(|e| CoreError::Internal(format!("pairing start client: {e}")))?;
    let response = client
        .post(&url)
        .json(&serde_json::json!({
            "machine_id": machine_id,
            "device_name": device_name,
        }))
        .send()
        .await
        .map_err(|e| CoreError::Internal(format!("pairing start request to {base_url} failed: {e}")))?;
    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().await.unwrap_or_default();
        return Err(CoreError::Validation {
            field: "pairing",
            message: format!("pairing start failed ({status}): {detail}"),
        });
    }
    response
        .json()
        .await
        .map_err(|e| CoreError::Internal(format!("pairing start response: {e}")))
}

/// Polls an active tablet device-code pairing session (ADR #56 §2.5 / §5 Q1).
#[cfg(feature = "sync-http")]
pub async fn poll_device_pairing(
    base_url: &str,
    poll_token: &str,
) -> Result<PairingPollResponse, CoreError> {
    let url = format!("{}{PAIRING_POLL_PATH}", base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(LINK_TIMEOUT)
        .build()
        .map_err(|e| CoreError::Internal(format!("pairing poll client: {e}")))?;
    let response = client
        .post(&url)
        .json(&serde_json::json!({
            "poll_token": poll_token,
        }))
        .send()
        .await
        .map_err(|e| CoreError::Internal(format!("pairing poll request to {base_url} failed: {e}")))?;
    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().await.unwrap_or_default();
        return Err(CoreError::Validation {
            field: "pairing",
            message: format!("pairing poll failed ({status}): {detail}"),
        });
    }
    response
        .json()
        .await
        .map_err(|e| CoreError::Internal(format!("pairing poll response: {e}")))
}


/// POSTs a JSON body with the device's bearer key, mapping failures to typed errors.
#[cfg(feature = "sync-http")]
async fn post_json(
    base_url: &str,
    path: &str,
    api_key: &str,
    body: &serde_json::Value,
    what: &str,
    field: &'static str,
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
    // The user-actionable refusals, not outages: 400 (a bad or spent code), 403 (an address
    // that is not this store's, or an inactive account) and 429 (too many attempts) all become
    // field validations, so the wizard can point at the field instead of saying "try again".
    if matches!(
        status,
        reqwest::StatusCode::BAD_REQUEST
            | reqwest::StatusCode::FORBIDDEN
            | reqwest::StatusCode::TOO_MANY_REQUESTS
    ) {
        let detail = response.text().await.unwrap_or_default();
        return Err(CoreError::Validation {
            field,
            message: format!("the licence server refused {what}: {detail}"),
        });
    }
    Err(CoreError::Internal(format!(
        "{what} at {base_url} answered {status}"
    )))
}

#[cfg(test)]
#[path = "desktop_link_tests.rs"]
mod tests;
