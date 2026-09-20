//! Device-link commands (ADR #54 §2.5): link this POS to an account with Google.
//!
//! The body lives in `kasirmu_bridge::desktop_link`; this shim supplies the two things the
//! bridge must not own — where the licence server is, and the OS opener — and maps the error
//! back to `AppError`.
//!
//! The caller passes the device's own `api_key` and `machine_id` (the wizard holds both after
//! activation), exactly as `activate_license` takes its credentials, so the command authorises
//! nothing on its own: the licence server decides, from the key and the registered machine.
//!
//! It takes no `State` because it needs none — no database, no session map. An unused handle
//! would be noise standing in for a dependency that does not exist.

use std::time::Duration;

use crate::error::AppError;

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
    api_key: String,
    machine_id: String,
) -> Result<kasirmu_core::desktop_link::LinkedAccount, AppError> {
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
