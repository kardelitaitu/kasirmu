//! Unit tests for the branding DTOs and logo-path validation (test
//! relocation: moved out of `apps/desktop-tauri/src/commands/branding_tests.rs`).
//!
//! Mounted at the foot of `branding.rs` with `#[cfg(test)] #[path]`, so
//! `use super::*` resolves `BrandSettingsDto` and `ALLOWED_LOGO_EXTENSIONS`
//! from the bridge module directly. The dialog-backed `pick_logo_file`
//! commands stay desktop-side (parked tauri-plugin-dialog seam) and carry
//! no unit tests of their own.

use super::*;

use crate::testing::{TestBridge, temp_conn};
use kasirmu_core::session::SessionContext;

#[test]
fn brand_settings_debug() {
    let s = BrandSettingsDto {
        primary_colour: "#10b981".into(),
        logo_path: Some("/assets/logo.png".into()),
        store_name: "My Shop".into(),
    };
    let debug = format!("{s:?}");
    assert!(debug.contains("#10b981"));
    assert!(debug.contains("logo.png"));
    assert!(debug.contains("My Shop"));
}

#[test]
fn brand_settings_serialize() {
    let s = BrandSettingsDto {
        primary_colour: "#ff0000".into(),
        logo_path: Some("/logo.svg".into()),
        store_name: "OZ MART".into(),
    };
    let json = serde_json::to_value(&s).unwrap();
    assert_eq!(json["primary_colour"], "#ff0000");
    assert_eq!(json["logo_path"], "/logo.svg");
    assert_eq!(json["store_name"], "OZ MART");
}

#[test]
fn brand_settings_no_logo_path() {
    let s = BrandSettingsDto {
        primary_colour: "#000000".into(),
        logo_path: None,
        store_name: "Store".into(),
    };
    let json = serde_json::to_value(&s).unwrap();
    assert!(json["logo_path"].is_null());
}

#[test]
fn brand_settings_deserialize_no_logo() {
    let json = r##"{"primary_colour":"#abcdef","logo_path":null,"store_name":"Test"}"##;
    let s: BrandSettingsDto = serde_json::from_str(json).unwrap();
    assert_eq!(s.primary_colour, "#abcdef");
    assert!(s.logo_path.is_none());
    assert_eq!(s.store_name, "Test");
}

#[test]
fn validate_logo_empty_path_is_allowed() {
    // Empty path means "clear the logo" — always allowed.
    assert!(validate_logo_path_inner("").unwrap().is_empty());
}

#[test]
fn validate_logo_empty_path_is_allowed_duplicate() {
    assert!(validate_logo_path_inner("").is_ok());
}

/// Inline helper that bypasses the AppHandle requirement for unit tests.
fn validate_logo_path_inner(path: &str) -> Result<String, BridgeError> {
    if path.is_empty() {
        return Ok(String::new());
    }
    // Check extension even without app_data_dir validation.
    let p = Path::new(path);
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    if !ALLOWED_LOGO_EXTENSIONS.contains(&ext.as_str()) {
        return Err(BridgeError::Invalid(format!(
            "logo file type '.{ext}' is not allowed"
        )));
    }
    // Skip canonicalization in unit tests — it requires a real filesystem.
    Ok(path.to_string())
}

// ── Scoped write/read targeting ─────────────────────────────────

fn seed_owner(conn: &rusqlite::Connection) {
    let store = Store::new(conn);
    store.seed_default_roles().unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
}

/// Headless scoped bridge: the caller's connection becomes the GLOBAL identity
/// db, the harness supplies the per-store manager, and the session is seeded.
fn scoped_bridge(
    conn: rusqlite::Connection,
    token: &str,
    user_id: &str,
    role_id: &str,
    store_id: &str,
) -> TestBridge {
    let tb = TestBridge::new().with_conn(conn);
    tb.sessions().write().unwrap().insert(
        token.into(),
        SessionContext::new(
            user_id.into(),
            role_id.into(),
            "terminal-1".into(),
            store_id.into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );
    tb
}

/// A logo the operator picks through Settings must be readable back through the
/// same scoped door that renders it.
///
/// `set_brand_logo_path_scoped` used to open the session's store database (via
/// `resolve_scope`) and then **discard** it, writing the GLOBAL identity db
/// instead — while its reader `get_brand_settings_scoped`, its two sibling
/// setters (`set_brand_primary_colour_scoped` / `set_brand_store_name_scoped`)
/// and the tablet's own copy all use the session store. The picked logo was
/// therefore write-only on desktop: it vanished the moment the renderer read it
/// back, and nothing said so.
#[tokio::test]
async fn scoped_brand_logo_round_trips_through_the_store_db() {
    let conn = temp_conn();
    seed_owner(&conn);
    let tb = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");
    let ctx = tb.ctx();

    set_brand_logo_path_scoped(&ctx, "/logo.png", "tok", None)
        .await
        .unwrap();

    // The write must land where the scoped reader reads.
    let settings = get_brand_settings_scoped(&ctx, "tok").await.unwrap();
    assert_eq!(
        settings.logo_path.as_deref(),
        Some("/logo.png"),
        "a logo written through the scoped setter must be read back by the scoped reader"
    );

    // And it must NOT have gone into the global identity db, where no branding
    // reader looks for it.
    {
        let global = ctx.lock_global().await;
        assert!(
            Settings::get_brand_logo_path(&global).unwrap().is_none(),
            "the scoped logo write must not be stranded in the global identity db"
        );
    }
}

#[test]
fn validate_logo_rejects_disallowed_extension() {
    let err = validate_logo_path_inner("/etc/passwd").unwrap_err();
    let msg = format!("{err}");
    assert!(
        msg.contains("not allowed"),
        "expected 'not allowed', got: {msg}"
    );
}

#[test]
fn validate_logo_allows_png() {
    let result = validate_logo_path_inner("/tmp/logo.png");
    assert!(result.is_ok(), "png extension should be allowed");
}

#[test]
fn validate_logo_allows_svg() {
    let result = validate_logo_path_inner("/tmp/logo.svg");
    assert!(result.is_ok(), "svg extension should be allowed");
}
