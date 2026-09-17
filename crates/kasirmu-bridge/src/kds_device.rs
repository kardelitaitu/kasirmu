//! KDS device command bodies (Wave D / D2b) — the tauri-free half of
//! `apps/desktop-tauri/src/commands/kds_device.rs`.

//! Registration, listing, single-device lookup, connection-status update,
//! deactivation and order acknowledgement. Each operation is a verbatim port of
//! its command body: session resolve -> the session permission gate ->
//! `db_manager.open_store` -> the store lock -> `Store::new` -> one store call,
//! in that order. Nothing here re-sequences a gate.

//! The gate goes through [`BridgeCtx::require_session_permission`], the
//! byte-for-byte mirror of `commands/authz.rs::require_permission_for_session`
//! (global identity DB plus `require_permission_for_user_scoped` over the
//! session store id and workspace type key), so authorization is unchanged.
//! Errors are `BridgeError`s that the shims map to `AppError`
//! variant-for-variant, including the exact `opening store db: {e}` and
//! `store db lock: {e}` texts.

use kasirmu_core::db::Store;
use kasirmu_core::kds::{KdsConnectionStatus, KdsDevice, RegisterKdsDeviceInput};
use kasirmu_core::permissions;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// Register a new KDS device bound to a Restaurant POS.
///
/// The caller supplies a pre-hashed pairing token (SHA-256 of the QR
/// enrollment token) and its expiry timestamp. The device starts in
/// `disconnected` status and `is_active = true`.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for a dead token,
/// [`BridgeError::PermissionDenied`] without `kds:update`, and
/// [`BridgeError::Core`] or [`BridgeError::Internal`] for the store access.
pub async fn register_kds_device(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    input: RegisterKdsDeviceInput,
) -> Result<KdsDevice, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::KDS_UPDATE)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let device = store.register_kds_device(input)?;
    Ok(device)
}

/// List all KDS devices for the Restaurant POS bound to the current session.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for a dead token,
/// [`BridgeError::PermissionDenied`] without `kds:view`, and
/// [`BridgeError::Core`] or [`BridgeError::Internal`] for the store access.
pub async fn list_kds_devices(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<KdsDevice>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::KDS_VIEW)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    // Use the restaurant_pos_id from the session, or fall back to terminal_id.
    let resto_id = session
        .restaurant_pos_id
        .as_deref()
        .unwrap_or(&session.terminal_id);
    let devices = store.list_kds_devices_for_restaurant(resto_id)?;
    Ok(devices)
}

/// Get a single KDS device by ID.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for a dead token,
/// [`BridgeError::PermissionDenied`] without `kds:view`, and
/// [`BridgeError::Core`] or [`BridgeError::Internal`] for the store access.
pub async fn get_kds_device(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    device_id: &str,
) -> Result<Option<KdsDevice>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::KDS_VIEW)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let device = store.get_kds_device(device_id)?;
    Ok(device)
}

/// Update a KDS device's connection status.
///
/// The Restaurant POS calls this when a KDS device connects or
/// disconnects. Setting `Connected` also updates `last_seen_at`.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for a dead token,
/// [`BridgeError::PermissionDenied`] without `kds:update`, and
/// [`BridgeError::Core`] or [`BridgeError::Internal`] for the store access.
pub async fn update_kds_device_status(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    device_id: &str,
    status: KdsConnectionStatus,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::KDS_UPDATE)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    store.update_kds_device_status(device_id, status)?;
    Ok(())
}

/// Deactivate a KDS device (soft-delete).
///
/// Deactivated devices no longer receive routed orders. The device
/// record is retained for audit purposes.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for a dead token,
/// [`BridgeError::PermissionDenied`] without `kds:update`, and
/// [`BridgeError::Core`] or [`BridgeError::Internal`] for the store access.
pub async fn deactivate_kds_device(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    device_id: &str,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::KDS_UPDATE)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    store.deactivate_kds_device(device_id)?;
    Ok(())
}

/// Acknowledge a KDS order — the device accepted the ticket and started
/// prep, advancing it pending -> preparing.
///
/// Uses optimistic locking: if another device already acknowledged
/// this order, returns `false` instead of erroring.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for a dead token,
/// [`BridgeError::PermissionDenied`] without `kds:update`, and
/// [`BridgeError::Core`] or [`BridgeError::Internal`] for the store access.
pub async fn ack_kds_order(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    order_id: &str,
    device_id: &str,
) -> Result<bool, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::KDS_UPDATE)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let acked = store.ack_kds_order(order_id, device_id)?;
    Ok(acked)
}
