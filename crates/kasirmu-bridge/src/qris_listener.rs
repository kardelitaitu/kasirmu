//! Zero-MDR QRIS Notification Listener bridge commands.
//!
//! Provides headless command middleware for querying notification listener
//! status, retrieving recent incoming bank payments, and simulating bank push
//! notifications in test and development environments.
//!
//! Key types:
//! - [`QrisListenerStatusDto`](crate::qris_listener::QrisListenerStatusDto): Status of the
//!   platform's notification listener.
//! - [`QrisRecentPaymentDto`](crate::qris_listener::QrisRecentPaymentDto): Parsed incoming
//!   payment event data.
//! - [`SimulateQrisNotificationArgs`](crate::qris_listener::SimulateQrisNotificationArgs):
//!   Input payload for testing/simulation.
//!
//! The links are QUALIFIED on purpose. The bare short form does not resolve here even
//! though all three types are declared in THIS file -- an outer doc on one of them
//! referencing another fails the same way, and neither `self::` nor moving the list to a
//! struct-level doc changes that. Every other module doc in this crate already writes the
//! qualified form (diagnostics.rs:9, qris_auto.rs:5, lib.rs:9), so this is the crate's own
//! convention rather than a workaround invented here.

use kasirmu_core::permissions;
use serde::{Deserialize, Serialize};

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// Status of the Android / Desktop QRIS push notification listener.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QrisListenerStatusDto {
    /// Whether background push notification listening is supported on this platform.
    /// (True on Android POS tablets; false on desktop unless simulation is enabled).
    pub is_supported: bool,
    /// Whether system notification access permission is granted by the operator.
    pub is_enabled: bool,
    /// Whether the background notification listener service is currently active and bound.
    pub is_connected: bool,
    /// Platform identifier (`"android"` or `"desktop"`).
    pub platform: String,
}

/// Parsed payment record extracted from a banking push alert.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QrisRecentPaymentDto {
    /// Canonical provider name (e.g. "BCA", "Mandiri", "BRI", "Bank Jatim", "GoPay", "ShopeePay").
    pub provider: String,
    /// Amount extracted in minor currency units (whole IDR rupiah as `i64`).
    pub amount_minor: i64,
    /// Formatted rupiah string (e.g. "Rp 50.000").
    pub amount_formatted: String,
    /// Full unparsed raw notification text.
    pub raw_text: String,
    /// Originating Android package name (e.g. `com.bca`).
    pub package_name: String,
    /// Delivery timestamp in epoch milliseconds.
    pub timestamp_ms: u64,
    /// Customer/payer name or identifier if present in the push alert.
    pub sender_name: Option<String>,
}

impl From<qris_core::BankNotification> for QrisRecentPaymentDto {
    fn from(n: qris_core::BankNotification) -> Self {
        Self {
            provider: n.provider,
            amount_minor: n.amount_minor,
            amount_formatted: n.amount_formatted,
            raw_text: n.raw_text,
            package_name: n.package_name,
            timestamp_ms: n.timestamp_ms,
            sender_name: n.sender_name,
        }
    }
}

/// Arguments for [`simulate_qris_notification_scoped`].
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulateQrisNotificationArgs {
    /// Optional package name override (defaults to `"com.bca"`).
    pub package_name: Option<String>,
    /// Optional title line from the notification.
    pub title: Option<String>,
    /// Notification body text (e.g. `"QRIS Masuk: Rp 50.000 dari BUDI"`).
    pub text: String,
    /// Optional timestamp in milliseconds (defaults to current system time).
    pub timestamp_ms: Option<u64>,
}

/// Query the platform status of the QRIS notification listener.
pub async fn get_qris_listener_status_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<QrisListenerStatusDto, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SALES_PROCESS)
        .await?;

    let is_android = cfg!(target_os = "android");
    Ok(QrisListenerStatusDto {
        is_supported: is_android,
        is_enabled: is_android,
        is_connected: is_android,
        platform: if is_android {
            "android".to_string()
        } else {
            "desktop".to_string()
        },
    })
}

/// Simulate an incoming bank push notification using the core regex parser.
///
/// Enables headless integration tests, desktop development, and cashier training
/// without requiring active banking credentials.
pub async fn simulate_qris_notification_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: SimulateQrisNotificationArgs,
) -> Result<Option<QrisRecentPaymentDto>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SALES_PROCESS)
        .await?;

    let pkg = args.package_name.as_deref().unwrap_or("com.bca");
    let now = args.timestamp_ms.unwrap_or_else(|| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    });

    let parsed = qris_core::parse_notification(pkg, args.title.as_deref(), &args.text, now);
    Ok(parsed.map(Into::into))
}

#[cfg(test)]
#[path = "qris_listener_tests.rs"]
mod tests;
