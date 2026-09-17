/*
last audited 25-07-26 by RSA-Agent (desktop-client slice C: verified)
crate: desktop-client | status: SAFE | lint: CLEAN
findings: clean — no unwrap/panic/unsafe in production paths; sibling tests per convention. Coverage note: file verified structurally under the risk-ranked sampling protocol (global sweep clean), not line-by-line deep read
next: none | perf: N/A
*/
//! Debug-only bootstrap that auto-connects the desktop client to the
//! cloud sync server.
//!
//! A fresh app DB ships with an empty `sync_server_url` and sync
//! disabled — so the background sync daemon silently no-ops
//! (`SyncConfig::from_settings` returns `None`) until the user manually
//! configures Settings → Sync. This module closes that gap: on debug
//! builds, if no server URL is configured yet and the server answers a
//! health probe, we request a JWT and persist the connection so sync
//! works out of the box.
//!
//! Release builds never run this code (the call site in `lib.rs` is
//! `#[cfg(debug_assertions)]`-gated), so a production install's
//! configuration can never be touched by a stray local server.
//!
//! **Configuration invariant:** an empty or missing URL is unconfigured,
//! even when an old API key remains. The debug bootstrap repairs that state
//! by restoring the local URL and enabling sync. To deliberately disable
//! sync, keep the configured URL and turn off the enabled flag; that state
//! is never overwritten.

use std::sync::Arc;
use std::time::Duration;

use kasirmu_core::CoreError;
use kasirmu_core::settings::Settings;
use kasirmu_core::sync_client;
use rusqlite::Connection;
use tokio::sync::Mutex;

/// Default cloud sync server — the unified auth+sync service at the custom domain.
const LOCAL_SYNC_URL: &str = "https://license.ozpos.my.id";

/// How many probe + token attempts before giving up. The docker backend
/// can take a few seconds to answer on a cold start, so a bounded retry
/// lets the app connect even when it boots before the container is ready.
const PROBE_ATTEMPTS: u32 = 3;

/// Delay between probe attempts.
const PROBE_RETRY_DELAY: Duration = Duration::from_secs(2);

/// Decide whether auto-provisioning should run.
///
/// Returns `true` whenever no usable URL is configured. A retained API key
/// does not make an empty URL usable: the bootstrap restores the local dev
/// URL and enables sync. An explicit disable is preserved when a real URL
/// remains configured and only the enabled flag is turned off.
fn should_auto_provision(
    configured_url: Option<&str>,
    _sync_enabled: bool,
    _has_api_key: bool,
) -> bool {
    match configured_url {
        // No settings row at all — a fresh install that has never been
        // configured. Provision regardless of the enabled flag (a fresh
        // DB ships with sync off but no URL row).
        None => true,
        // An empty URL is unconfigured, regardless of the enabled flag or
        // whether an old API key remains. Restore the local dev connection.
        Some(url) if url.trim().is_empty() => true,
        // A real URL is configured — never touch it.
        Some(_) => false,
    }
}

/// Persist a provisioned sync connection: server URL + API key + enabled.
///
/// All three writes happen in one transaction so a failure partway can't
/// leave a half-provisioned state (e.g. a URL without a key) that would
/// block future auto-provisioning on the next launch.
fn persist_provisioned_sync(
    conn: &mut Connection,
    url: &str,
    api_key: &str,
) -> Result<(), CoreError> {
    let tx = conn.transaction()?;
    Settings::set_sync_server_url(&tx, url)?;
    Settings::set_sync_api_key(&tx, api_key)?;
    Settings::set_sync_enabled(&tx, true)?;
    tx.commit()?;
    Ok(())
}

/// Auto-connect the app to the local dev sync server (debug builds only).
///
/// 1. If a server URL is already configured, return immediately — an
///    existing install is never clobbered.
/// 2. Otherwise probe the local dev server; on success request a JWT and
///    persist URL + key + enabled so the background sync daemon picks the
///    connection up on its next tick.
/// 3. If the server is unreachable, leave settings untouched and return
///    quietly (sync stays unconfigured; the app still runs fine).
pub async fn auto_provision_local_sync(db: Arc<Mutex<Connection>>) {
    auto_provision_local_sync_with_url(db, LOCAL_SYNC_URL).await;
}

/// The provisioning loop, parameterised over the target server URL so tests
/// can run it against an ephemeral loopback server.
async fn auto_provision_local_sync_with_url(db: Arc<Mutex<Connection>>, server_url: &str) {
    // 1. Never touch an already-configured install. This guard runs before
    //    any network I/O so a configured production URL can never be
    //    clobbered by a local dev server. A settings READ error is treated
    //    as "leave it alone", not as "not configured" — we must never
    //    provision over an install we couldn't inspect.
    {
        let conn = db.lock().await;
        let (configured, enabled, has_api_key) = match (
            Settings::get_sync_server_url(&conn),
            Settings::is_sync_enabled(&conn),
            Settings::get_sync_api_key(&conn),
        ) {
            (Ok(url), Ok(enabled), Ok(api_key)) => (
                url.map(|u| u.trim().to_string()),
                enabled,
                api_key.is_some_and(|key| !key.trim().is_empty()),
            ),
            (Err(e), _, _) | (_, Err(e), _) | (_, _, Err(e)) => {
                tracing::warn!("reading sync settings failed — leaving sync unconfigured: {e}");
                return;
            }
        };
        if !should_auto_provision(configured.as_deref(), enabled, has_api_key) {
            tracing::debug!(
                server_url = %configured.unwrap_or_default(),
                enabled,
                has_api_key,
                "sync already configured or deliberately disabled — skipping auto-provision"
            );
            return;
        }
    }

    // 2. Bounded probe + token request against the local dev server. The
    //    retry absorbs a cold-start docker container that is still warming
    //    up when the app boots.
    for attempt in 1..=PROBE_ATTEMPTS {
        let ping = sync_client::ping_server(server_url).await;
        if ping.ok {
            // ADR sync-auth-hardening P3: pair this terminal once (register
            // with the server and store the device secret), then mint tokens
            // with client credentials. Pairing is skipped when credentials
            // are already stored, and falls back to admin-key / open minting
            // when the server does not support registration.
            let client_credentials = resolve_terminal_credentials(&db, server_url).await;

            let token = match client_credentials {
                Some((client_id, client_secret)) => {
                    sync_client::request_token_client_credentials(
                        server_url,
                        &client_id,
                        &client_secret,
                    )
                    .await
                }
                None => {
                    // ADR sync-auth-hardening P2: a server started with
                    // OZ_ADMIN_KEY rejects minting without the matching
                    // header — pass it through when available.
                    sync_client::request_token(
                        server_url,
                        sync_client::admin_key_from_env().as_deref(),
                    )
                    .await
                }
            };
            if let (true, Some(key)) = (token.ok, token.token) {
                let mut conn = db.lock().await;
                match persist_provisioned_sync(&mut conn, server_url, &key) {
                    Ok(()) => tracing::info!(
                        expires_at = token.expires_at.as_deref().unwrap_or("unknown"),
                        "auto-provisioned sync connection to {LOCAL_SYNC_URL}"
                    ),
                    Err(e) => tracing::warn!("persisting auto-provisioned sync failed: {e}"),
                }
                return;
            }
        }
        if attempt == PROBE_ATTEMPTS {
            tracing::debug!(
                url = server_url,
                "local sync server not reachable — leaving sync unconfigured"
            );
            return;
        }
        tokio::time::sleep(PROBE_RETRY_DELAY).await;
    }
}

/// Resolve this terminal's client credentials, pairing it with the server
/// on first run (ADR sync-auth-hardening P3).
///
/// Returns `Some((terminal_id, device_secret))` when the terminal is paired
/// (either already stored or freshly registered). Returns `None` when the
/// server rejected registration — the caller falls back to admin-key/open
/// minting so legacy dev servers keep working.
async fn resolve_terminal_credentials(
    db: &Arc<Mutex<Connection>>,
    server_url: &str,
) -> Option<(String, String)> {
    // Already paired — reuse the stored credentials.
    {
        let conn = db.lock().await;
        if let (Ok(Some(id)), Ok(Some(secret))) = (
            Settings::get_sync_terminal_id(&conn),
            Settings::get_sync_terminal_secret(&conn),
        ) {
            return Some((id, secret));
        }
    }

    // Fresh pair: generate a stable terminal id (kept even if the server is
    // unreachable, so a later launch retries registration with the same id).
    let terminal_id = {
        let conn = db.lock().await;
        match Settings::get_sync_terminal_id(&conn) {
            Ok(Some(id)) => id,
            _ => {
                let id = uuid::Uuid::new_v4().simple().to_string();
                let _ = Settings::set_sync_terminal_id(&conn, &id);
                id
            }
        }
    };

    let registration = sync_client::register_terminal(
        server_url,
        sync_client::admin_key_from_env().as_deref(),
        &terminal_id,
        "pos-terminal",
    )
    .await;
    if !registration.ok {
        tracing::debug!(
            status = %registration.status,
            "terminal registration failed — falling back to label minting"
        );
        return None;
    }

    let device_secret = registration.device_secret?;
    let conn = db.lock().await;
    if let Err(e) = Settings::set_sync_terminal_secret(&conn, &device_secret) {
        tracing::warn!(error = %e, "persisting terminal device secret failed");
        return None;
    }
    tracing::info!(terminal_id, "paired sync terminal with server");
    Some((terminal_id, device_secret))
}

#[cfg(test)]
#[path = "sync_bootstrap_tests.rs"]
mod tests;
