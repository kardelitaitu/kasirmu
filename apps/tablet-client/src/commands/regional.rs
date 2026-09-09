//! Regional-configuration read commands (regional slice 2, saas-2 design
//! slice queue #2).
//!
//! Exposes the slice-1 core read model (`Store::regional_config_for_location`)
//! over IPC: the effective locale/timezone/currency for one location with
//! per-axis provenance. Read-only by design — the write path is slice 3 and
//! needs the settings-scope ruling first.
//!
//! Wire contract: the core `RegionalConfig` is returned **as-is** — its
//! fields are documented "serialized as snake_case so the IPC DTOs of later
//! slices reuse these names verbatim" (`oz_core::regional`), so there is no
//! shell-side mirror DTO to drift. `ConfigScope` rides along with its
//! serde names ("location", "legal_entity", "organization", "built_in").
//!
//! ADR #48 (87114abf6) settled the design's timezone-representation question:
//! storage is an IANA zone name and offsets are derived at display/report
//! time (`oz_core::timezone::business_date_in_zone`). This read model is
//! therefore a faithful pass-through of the **stored** string — it never
//! re-derives or formats an offset on this side of the boundary, and the
//! front-end must not either.

use oz_core::{Store, permissions};
use tauri::State;

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;

/// Read the effective regional configuration for one location of the
/// session's store (regional slice 2, saas-2 design slice queue #2).
///
/// Resolves the session's store database (ADR #7), checks `settings:read`
/// inline, and walks Location → Legal Entity → Organization in core. The
/// location id is explicit — the caller knows which location it is asking
/// about (primary via `get_primary_location_scoped`, or the inspector's
/// selection) — so a read can never silently answer for a different
/// location than the caller meant. An unknown location is a typed
/// `CoreErrorKind::NotFound` — the walk refuses to invent defaults for a
/// typo'd id.
#[tauri::command]
pub async fn get_regional_config_scoped(
    location_id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<oz_core::RegionalConfig, AppError> {
    let (session, conn) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_READ).await?;
    let conn = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&conn);
    let config = store.regional_config_for_location(&location_id)?;
    Ok(config)
}

#[cfg(test)]
#[path = "regional_tests.rs"]
mod tests;
