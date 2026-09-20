//! Device-link commands (ADR #54 §2.5): link this POS to an account with Google.
//!
//! The body lives in `kasirmu_bridge::desktop_link`; this shim supplies the two things the
//! bridge must not own — where the licence server is, and the OS opener — and maps the error
//! back to `AppError`.
//!
//! The device's own credentials are read here, from the encrypted Settings row
//! (`stored_credentials`), and NOT passed from the renderer. `activate_license` takes them
//! because the user types them; here the app already holds them, and a secret that never has to
//! cross IPC should not — the renderer sees only the account it was linked to.

use std::time::Duration;

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

/// How long the wizard waits for the browser round trip.
///
/// The server's pending link lives for ten minutes; five is enough for a human to finish a
/// consent screen and short enough that a forgotten tab does not pin a spinner forever.
const LINK_WAIT: Duration = Duration::from_secs(300);

/// Link this device to the account that signs in with Google.
///
/// Opens the system browser at Google's consent screen and waits on a loopback port for the
/// licence server's one-time code, then exchanges it for the account. Returns the account the
/// identity was bound to.
#[tauri::command]
pub async fn link_device_google(
    state: State<'_, AppState>,
) -> Result<kasirmu_core::desktop_link::LinkedAccount, AppError> {
    let (api_key, machine_id) = {
        let ctx = state.bridge_ctx();
        kasirmu_bridge::license::stored_credentials(&ctx).await?
    };
    let base_url = kasirmu_core::attestation::resolved_origin().url;
    kasirmu_bridge::desktop_link::link_device(
        &base_url,
        &api_key,
        &machine_id,
        LINK_WAIT,
        |url: String| async move {
            // The app's own opener: https-only and percent-encoded by ADR #38's rule, so the
            // consent URL — which carries our loopback redirect as a query value — is the only
            // thing this can be talked into opening.
            crate::commands::browser::open_in_browser(&url)
                .await
                .map_err(|e| kasirmu_bridge::error::BridgeError::Internal(e.to_string()))
        },
    )
    .await
    .map_err(Into::into)
}

/// Email a link code to this device's account address (ADR #54 §2.6).
///
/// The no-browser route: the tablet cannot use Google's browser flows, and an account that is
/// not a Google one needs a way to prove itself. The address is confirmed against the tenant the
/// device already holds, so it can never aim a code at somebody else's mailbox.
#[tauri::command]
pub async fn link_device_email_request(
    email: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let (api_key, machine_id) = {
        let ctx = state.bridge_ctx();
        kasirmu_bridge::license::stored_credentials(&ctx).await?
    };
    let base_url = kasirmu_core::attestation::resolved_origin().url;
    kasirmu_core::desktop_link::request_desktop_link_code(&base_url, &api_key, &machine_id, &email)
        .await
        .map_err(Into::into)
}

/// Spend the emailed code and return the account it proved.
#[tauri::command]
pub async fn link_device_email_consume(
    code: String,
    state: State<'_, AppState>,
) -> Result<kasirmu_core::desktop_link::VerifiedAccount, AppError> {
    let (api_key, machine_id) = {
        let ctx = state.bridge_ctx();
        kasirmu_bridge::license::stored_credentials(&ctx).await?
    };
    let base_url = kasirmu_core::attestation::resolved_origin().url;
    kasirmu_core::desktop_link::consume_desktop_link_code(&base_url, &api_key, &machine_id, &code)
        .await
        .map_err(Into::into)
}
