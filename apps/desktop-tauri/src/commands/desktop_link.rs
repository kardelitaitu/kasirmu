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
    let account = kasirmu_bridge::desktop_link::link_device(
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
    .await?;
    // The link earned a sync credential whenever the server could issue one; store it now so
    // the device is ready to sync (ADR #54 §2.5 step 7).
    store_earned_credential(&state, account.terminal.as_ref()).await?;
    Ok(account)
}

// ── Email account auth (the wizard's email login) ─────────────────────
//
// Deliberately credential-free and stateless: these establish a session, so
// there is no device key to read and nothing to store. They exist as commands
// rather than as `fetch` calls because `/web/*` enforces an Origin allowlist
// the Tauri origins are not on — see `kasirmu_core::desktop_link`.

/// Emails a 6-digit sign-in code to an address (register-or-login).
#[tauri::command]
pub async fn request_email_login_code(email: String) -> Result<(), AppError> {
    let base_url = kasirmu_core::attestation::resolved_origin().url;
    kasirmu_core::desktop_link::request_web_login_code(&base_url, &email)
        .await
        .map_err(Into::into)
}

/// Spends an emailed sign-in code, returning the session it proved.
#[tauri::command]
pub async fn verify_email_login_code(
    email: String,
    code: String,
) -> Result<kasirmu_core::desktop_link::WebSession, AppError> {
    let base_url = kasirmu_core::attestation::resolved_origin().url;
    kasirmu_core::desktop_link::verify_web_login_code(&base_url, &email, &code)
        .await
        .map_err(Into::into)
}

/// Signs in with an email address and the account's password.
#[tauri::command]
pub async fn login_with_email_password(
    email: String,
    password: String,
) -> Result<kasirmu_core::desktop_link::WebSession, AppError> {
    let base_url = kasirmu_core::attestation::resolved_origin().url;
    kasirmu_core::desktop_link::login_web_password(&base_url, &email, &password)
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
    let account = kasirmu_core::desktop_link::consume_desktop_link_code(
        &base_url,
        &api_key,
        &machine_id,
        &code,
    )
    .await?;
    store_earned_credential(&state, account.terminal.as_ref()).await?;
    Ok(account)
}

/// Stores the sync credential a completed link earned, when one was issued.
///
/// A link that earned nothing is not an error: the account is linked either way, and the reply's
/// `issued` flag is what tells the two apart.
async fn store_earned_credential(
    state: &State<'_, AppState>,
    terminal: Option<&kasirmu_core::desktop_link::TerminalCredential>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::sync::store_linked_terminal(&ctx, terminal).await?;
    Ok(())
}

/// Starts a device-code pairing session (ADR #56 §2.5 / §5 Q1).
#[tauri::command]
pub async fn start_device_pairing(
    device_name: Option<String>,
    state: State<'_, AppState>,
) -> Result<kasirmu_core::desktop_link::PairingSessionStart, AppError> {
    let ctx = state.bridge_ctx();
    let machine_id = kasirmu_bridge::license::get_machine_id(&ctx).await?;
    let base_url = kasirmu_core::attestation::resolved_origin().url;
    let name = device_name.unwrap_or_else(|| "Desktop POS".to_string());
    kasirmu_core::desktop_link::start_device_pairing(&base_url, &machine_id, &name)
        .await
        .map_err(AppError::from)
}

/// Polls an active device-code pairing session (ADR #56 §2.5 / §5 Q1).
#[tauri::command]
pub async fn poll_device_pairing(
    poll_token: String,
    state: State<'_, AppState>,
) -> Result<kasirmu_core::desktop_link::PairingPollResponse, AppError> {
    let base_url = kasirmu_core::attestation::resolved_origin().url;
    let resp = kasirmu_core::desktop_link::poll_device_pairing(&base_url, &poll_token)
        .await
        .map_err(AppError::from)?;
    if resp.status == "claimed"
        && let Some(ref terminal) = resp.terminal
    {
        store_earned_credential(&state, Some(terminal)).await?;
    }
    Ok(resp)
}
