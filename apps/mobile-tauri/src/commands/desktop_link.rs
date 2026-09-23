//! Device-link commands (ADR #54 §2.5) — the tablet shell's copy of the desktop command.
//!
//! The setup wizard lives in the shared `ui/`, so this step renders in BOTH shells; a command
//! only one shell registered would be an IPC parity gap the tablet discovers at runtime.
//!
//! The body is the same bridge call; the device's own credentials are read from the encrypted
//! Settings row, so no licence secret crosses IPC.

use std::time::Duration;

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

/// How long the wizard waits for the browser round trip (the server's pending link lives ten
/// minutes; five is enough for a consent screen and short enough not to pin a spinner).
const LINK_WAIT: Duration = Duration::from_secs(300);

/// Link this device to the account that signs in with Google.
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

/// Starts a tablet device-code pairing session (ADR #56 §2.5 / §5 Q1).
#[tauri::command]
pub async fn start_device_pairing(
    device_name: Option<String>,
    state: State<'_, AppState>,
) -> Result<kasirmu_core::desktop_link::PairingSessionStart, AppError> {
    let ctx = state.bridge_ctx();
    let machine_id = kasirmu_bridge::license::get_machine_id(&ctx).await?;
    let base_url = kasirmu_core::attestation::resolved_origin().url;
    let name = device_name.unwrap_or_else(|| "Tablet POS".to_string());
    kasirmu_core::desktop_link::start_device_pairing(&base_url, &machine_id, &name)
        .await
        .map_err(AppError::from)
}

/// Polls an active tablet device-code pairing session (ADR #56 §2.5 / §5 Q1).
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
